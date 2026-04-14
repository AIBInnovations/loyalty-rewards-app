/**
 * Image Index Jobs Service
 *
 * Uses admin.graphql() to fetch products — the correct Shopify App Remix v3 API.
 * session.accessToken is NOT used (it may be null with unstable_newEmbeddedAuthStrategy).
 *
 * syncBatch(admin, shopId, cursor?) — indexes one page of 10 products, returns cursor.
 * Call repeatedly until done=true.
 */

import { createHash } from "crypto";
import { connectDB } from "../../db.server";
import { ImageEmbedding } from "../models/image-embedding.model";
import { ImageSearchSettings } from "../models/image-search-settings.model";
import { generateEmbedding } from "./embedding.service";

export type AdminGraphQL = (
  query: string,
  opts?: { variables?: Record<string, unknown> },
) => Promise<Response>;

const MODEL_VERSION = "clip-vit-base-patch32-v1";

export function initImageSearchJobs(): void {
  console.log("[ImageSearch] Ready.");
}

// ─── GraphQL query: 10 products per page ─────────────────────────────────────

const PRODUCTS_QUERY = `
  query GetProducts($cursor: String) {
    products(first: 10, after: $cursor, query: "status:active published_status:published") {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        title
        handle
        status
        publishedAt
        priceRange { minVariantPrice { amount } }
        images(first: 1) { nodes { url } }
      }
    }
  }
`;

// ─── Fetch one page of products via admin.graphql ────────────────────────────

async function fetchProductsGraphQL(
  admin: AdminGraphQL,
  cursor?: string,
): Promise<{ products: any[]; nextCursor?: string }> {
  const resp = await admin(PRODUCTS_QUERY, {
    variables: { cursor: cursor ?? null },
  });
  const json = await resp.json() as any;

  console.log(`[ImageSearch] GraphQL raw response: ${JSON.stringify(json).slice(0, 500)}`);

  if (json.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
  }

  const page = json?.data?.products;
  if (!page) throw new Error("No products data in GraphQL response");

  const products = page.nodes ?? [];
  const nextCursor = page.pageInfo?.hasNextPage ? page.pageInfo.endCursor : undefined;

  console.log(`[ImageSearch] GraphQL: ${products.length} products, hasNext=${!!nextCursor}`);
  return { products, nextCursor };
}

// ─── Embed a list of products (first image only) ─────────────────────────────

async function embedProducts(products: any[], shopId: string): Promise<number> {
  let n = 0;
  let failures = 0;
  console.log(`[ImageSearch] embedProducts: ${products.length} products to process`);
  for (const product of products) {
    console.log(`[ImageSearch] Processing: "${product.title}", status=${product.status}, imageUrl=${product.images?.nodes?.[0]?.url}`);

    // Only index products that are active AND published to the Online Store
    if (product.status && product.status !== "ACTIVE") {
      console.log(`[ImageSearch] Skipping "${product.title}" (status: ${product.status})`);
      continue;
    }
    if (!product.publishedAt) {
      console.log(`[ImageSearch] Skipping "${product.title}" (not published to Online Store)`);
      continue;
    }

    const imageUrl: string | undefined = product.images?.nodes?.[0]?.url;
    if (!imageUrl) {
      console.log(`[ImageSearch] No image for "${product.title}", skipping`);
      continue;
    }

    const productId = String(product.id).split("/").pop() ?? String(product.id);
    const price = Math.round(
      parseFloat(product.priceRange?.minVariantPrice?.amount ?? "0") * 100,
    );

    try {
      const imgRes = await fetch(imageUrl, {
        headers: { "User-Agent": "ShopifyImageSearch/1.0" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!imgRes.ok) {
        console.warn(`[ImageSearch] Image HTTP ${imgRes.status} for "${product.title}"`);
        failures++;
        continue;
      }

      const buffer = Buffer.from(await imgRes.arrayBuffer());
      const imageHash = createHash("sha256").update(buffer).digest("hex");

      const existing = await ImageEmbedding.findOne({ shopId, imageUrl })
        .select("imageHash isActive")
        .lean();
      if (existing && (existing as any).imageHash === imageHash) {
        // Same image — but restore isActive if it was soft-deleted (e.g. after "Clear Index")
        if (!(existing as any).isActive) {
          await ImageEmbedding.updateOne(
            { shopId, imageUrl },
            { $set: { isActive: true, indexedAt: new Date() } },
          );
        }
        n++;
        continue; // unchanged — skip re-embedding
      }

      const embedding = await generateEmbedding(buffer);
      await ImageEmbedding.findOneAndUpdate(
        { shopId, imageUrl },
        {
          $set: {
            productId,
            productTitle: product.title ?? "",
            productHandle: product.handle ?? "",
            price,
            imageHash,
            embedding,
            modelVersion: MODEL_VERSION,
            isActive: true,
            indexedAt: new Date(),
          },
          $setOnInsert: { shopId, variantId: "" },
        },
        { upsert: true },
      );
      n++;
      console.log(`[ImageSearch] Indexed "${product.title}"`);
    } catch (e) {
      failures++;
      console.error(`[ImageSearch] Failed to embed "${product.title}":`, e);
    }
  }
  if (failures > 0) {
    console.warn(`[ImageSearch] embedProducts: ${failures} products failed, ${n} succeeded`);
  }
  return n;
}

// ─── Public: sync one batch ──────────────────────────────────────────────────

export async function syncBatch(
  admin: AdminGraphQL,
  shopId: string,
  cursor?: string,
): Promise<{ indexed: number; nextCursor?: string; done: boolean; totalIndexed: number }> {
  await connectDB();

  const { products, nextCursor } = await fetchProductsGraphQL(admin, cursor);

  if (!products.length) {
    const total = await ImageEmbedding.countDocuments({ shopId, isActive: true });
    await ImageSearchSettings.findOneAndUpdate(
      { shopId },
      { $set: { totalIndexed: total, lastSyncedAt: new Date() } },
    );
    return { indexed: 0, done: true, totalIndexed: total };
  }

  const indexed = await embedProducts(products, shopId);

  const total = await ImageEmbedding.countDocuments({ shopId, isActive: true });
  await ImageSearchSettings.findOneAndUpdate(
    { shopId },
    { $set: { totalIndexed: total, lastSyncedAt: new Date() } },
  );

  return {
    indexed,
    nextCursor,
    done: !nextCursor,
    totalIndexed: total,
  };
}

// ─── Background full sync (for storefront auto-index) ────────────────────────
// Uses offline session fallback since no request-bound admin is available.

import mongoose from "mongoose";
import { unauthenticated } from "../../shopify.server";

export async function triggerFullCatalogSyncForShop(
  shopId: string,
  callerAdmin?: AdminGraphQL,
): Promise<number> {
  await connectDB();

  let admin: AdminGraphQL;
  if (callerAdmin) {
    // Use the admin passed by the caller (authenticated request context)
    admin = callerAdmin;
  } else {
    // Fall back to offline session (background/cron context)
    try {
      const result = await unauthenticated.admin(shopId);
      admin = result.admin.graphql.bind(result.admin) as unknown as AdminGraphQL;
    } catch (e) {
      console.error("[ImageSearch] unauthenticated.admin failed:", e);
      return 0;
    }
  }

  let cursor: string | undefined;
  do {
    try {
      const batch = await syncBatch(admin, shopId, cursor);
      cursor = batch.nextCursor;
      if (batch.done) break;
    } catch (e) {
      console.error("[ImageSearch] Background sync batch error:", e);
      break;
    }
  } while (cursor);

  const total = await ImageEmbedding.countDocuments({ shopId, isActive: true });
  console.log(`[ImageSearch] Background sync done: ${total} embeddings`);
  return total;
}

export async function triggerFullCatalogSync(): Promise<void> {
  const shops = await ImageSearchSettings.find({ enabled: true }).select("shopId").lean();
  for (const shop of shops) {
    await triggerFullCatalogSyncForShop(shop.shopId).catch((e) =>
      console.error(`[ImageSearch] sync failed for ${shop.shopId}:`, e),
    );
  }
}

// ─── Webhook: single product ─────────────────────────────────────────────────

export async function enqueueProductForIndexing(
  shopId: string,
  productId: string,
  _title: string,
  jobType: "index" | "reindex" | "delete",
): Promise<void> {
  await connectDB();

  if (jobType === "delete") {
    await ImageEmbedding.updateMany({ shopId, productId }, { $set: { isActive: false } });
    const count = await ImageEmbedding.countDocuments({ shopId, isActive: true });
    await ImageSearchSettings.findOneAndUpdate({ shopId }, { $set: { totalIndexed: count } });
    return;
  }

  try {
    const { admin } = await unauthenticated.admin(shopId);
    const gid = productId.startsWith("gid://")
      ? productId
      : `gid://shopify/Product/${productId}`;

    const resp = await admin.graphql(
      `query($id:ID!){product(id:$id){id title handle status publishedAt priceRange{minVariantPrice{amount}} images(first:1){nodes{url}}}}`,
      { variables: { id: gid } },
    );
    const json = await resp.json() as any;
    const product = json?.data?.product;
    if (!product) return;

    // Remove from index if not active OR not published to Online Store
    if (product.status !== "ACTIVE" || !product.publishedAt) {
      await ImageEmbedding.updateMany({ shopId, productId }, { $set: { isActive: false } });
      console.log(`[ImageSearch] Product "${product.title}" is ${product.status}/unpublished — removed from index`);
      const count = await ImageEmbedding.countDocuments({ shopId, isActive: true });
      await ImageSearchSettings.findOneAndUpdate({ shopId }, { $set: { totalIndexed: count } });
      return;
    }

    await embedProducts([product], shopId);
    const count = await ImageEmbedding.countDocuments({ shopId, isActive: true });
    await ImageSearchSettings.findOneAndUpdate({ shopId }, { $set: { totalIndexed: count } });
  } catch (e) {
    console.error(`[ImageSearch] Webhook index failed for product ${productId}:`, e);
  }
}

// ─── Legacy exports (keep search service imports working) ─────────────────────

export async function getShopAccessToken(_shopId: string): Promise<string | null> {
  return null; // No longer used — admin.graphql() is used instead
}
