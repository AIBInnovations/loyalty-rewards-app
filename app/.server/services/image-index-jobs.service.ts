/**
 * Image Index Jobs Service
 *
 * Indexes product images directly and immediately — no cron, no job queue.
 * This is required for Render.com free tier where the server sleeps after
 * 15 minutes of inactivity, making cron-based indexing unreliable.
 *
 * Entry points:
 *   triggerFullCatalogSyncForShop(shopId, admin)
 *     — Paginates all active products, downloads their images, generates
 *       512-dim visual embeddings with sharp, and upserts to image_embeddings.
 *     — Returns count of indexed embeddings.
 *
 *   enqueueProductForIndexing
 *     — Used for webhook-triggered single-product updates (create/update/delete).
 */

import { createHash } from "crypto";
import { connectDB } from "../../db.server";
import { unauthenticated } from "../../shopify.server";
import { ImageEmbedding } from "../models/image-embedding.model";
import { ImageSearchSettings } from "../models/image-search-settings.model";
import { generateEmbedding } from "./embedding.service";

const MAX_IMAGES_PER_PRODUCT = 3; // Reduced from 5 to speed up sync
const MODEL_VERSION = "sharp-visual-v1";

// ─── Init (no-op — cron removed, indexing is now inline) ─────────────────────

export function initImageSearchJobs(): void {
  console.log("[ImageSearch] Inline indexing mode — no cron jobs needed.");
}

// ─── GraphQL query ────────────────────────────────────────────────────────────

const PRODUCTS_QUERY = `
  query listProducts($cursor: String) {
    products(first: 20, after: $cursor, query: "status:active") {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        title
        handle
        priceRange { minVariantPrice { amount } }
        images(first: 3) { nodes { url } }
      }
    }
  }
`;

// ─── Core indexing: index one page of products ────────────────────────────────

async function indexProductPage(
  products: any[],
  shopId: string,
): Promise<number> {
  let count = 0;
  for (const product of products) {
    const productId = extractNumericId(product.id);
    const imageUrls: string[] = (product.images?.nodes || []).map(
      (n: any) => n.url as string,
    );
    const price = Math.round(
      parseFloat(product.priceRange?.minVariantPrice?.amount || "0") * 100,
    );

    for (const imageUrl of imageUrls.slice(0, MAX_IMAGES_PER_PRODUCT)) {
      try {
        const res = await fetch(imageUrl, {
          headers: { "User-Agent": "ShopifyImageSearch/1.0" },
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) continue;

        const buffer = Buffer.from(await res.arrayBuffer());

        const imageHash = createHash("sha256").update(buffer).digest("hex");
        const existing = await ImageEmbedding.findOne({ shopId, imageUrl })
          .select("imageHash")
          .lean();
        if (existing && (existing as any).imageHash === imageHash) {
          count++;
          continue;
        }

        const embedding = await generateEmbedding(buffer);

        await ImageEmbedding.findOneAndUpdate(
          { shopId, imageUrl },
          {
            $set: {
              productId,
              productTitle: product.title || "",
              productHandle: product.handle || "",
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

        count++;
        console.log(`[ImageSearch] Indexed "${product.title}"`);
      } catch (imgErr) {
        console.error(`[ImageSearch] Error indexing image ${imageUrl}:`, imgErr);
      }
    }
  }
  return count;
}

// ─── Full Catalog Sync ────────────────────────────────────────────────────────

export async function triggerFullCatalogSyncForShop(
  shopId: string,
  authenticatedAdmin?: { graphql: (query: string, opts?: any) => Promise<any> },
): Promise<number> {
  await connectDB();

  let admin: { graphql: (query: string, opts?: any) => Promise<any> };
  try {
    admin = authenticatedAdmin ?? (await unauthenticated.admin(shopId)).admin;
  } catch (authErr) {
    console.error("[ImageSearch] Failed to get admin session:", authErr);
    return 0;
  }

  let cursor: string | null = null;
  let hasNextPage = true;
  let pagesIndexed = 0;

  console.log(`[ImageSearch] Starting catalog sync for ${shopId}`);

  while (hasNextPage) {
    let productsData: any;
    try {
      const response: any = await admin.graphql(PRODUCTS_QUERY, {
        variables: { cursor },
      });
      const json: any = await response.json();

      // Log the raw response for debugging
      if (pagesIndexed === 0) {
        console.log(
          "[ImageSearch] First page GraphQL response:",
          JSON.stringify(json).slice(0, 500),
        );
      }

      productsData = json?.data?.products;
    } catch (err) {
      console.error("[ImageSearch] Failed to fetch products page:", err);
      break;
    }

    if (!productsData) {
      console.error("[ImageSearch] productsData is null/undefined — GraphQL may have failed");
      break;
    }

    hasNextPage = productsData.pageInfo?.hasNextPage ?? false;
    cursor = productsData.pageInfo?.endCursor ?? null;

    const products: any[] = productsData.nodes || [];
    console.log(`[ImageSearch] Page ${pagesIndexed + 1}: ${products.length} products`);

    await indexProductPage(products, shopId);
    pagesIndexed++;
  }

  // Persist final count
  const finalCount = await ImageEmbedding.countDocuments({
    shopId,
    isActive: true,
  });
  await ImageSearchSettings.findOneAndUpdate(
    { shopId },
    { $set: { totalIndexed: finalCount, lastSyncedAt: new Date() } },
  );

  console.log(`[ImageSearch] Sync complete — ${finalCount} embeddings for ${shopId}`);
  return finalCount;
}

// ─── Full Catalog Sync (all enabled shops) ────────────────────────────────────

export async function triggerFullCatalogSync(): Promise<void> {
  await connectDB();
  const shops = await ImageSearchSettings.find({ enabled: true })
    .select("shopId")
    .lean();
  for (const shop of shops) {
    try {
      await triggerFullCatalogSyncForShop(shop.shopId);
    } catch (err) {
      console.error(
        `[ImageSearch] Full sync failed for shop ${shop.shopId}:`,
        err,
      );
    }
  }
}

// ─── Webhook-triggered single product index/delete ───────────────────────────

export async function enqueueProductForIndexing(
  shopId: string,
  productId: string,
  productTitle: string,
  jobType: "index" | "reindex" | "delete",
): Promise<void> {
  if (jobType === "delete") {
    await ImageEmbedding.updateMany(
      { shopId, productId },
      { $set: { isActive: false } },
    );
    const count = await ImageEmbedding.countDocuments({ shopId, isActive: true });
    await ImageSearchSettings.findOneAndUpdate(
      { shopId },
      { $set: { totalIndexed: count } },
    );
    console.log(`[ImageSearch] Deleted embeddings for product ${productId} (${shopId})`);
    return;
  }

  try {
    const { admin } = await unauthenticated.admin(shopId);
    const gid = productId.startsWith("gid://")
      ? productId
      : `gid://shopify/Product/${productId}`;

    const res: any = await admin.graphql(
      `query($id:ID!){product(id:$id){title handle priceRange{minVariantPrice{amount}} images(first:3){nodes{url}}}}`,
      { variables: { id: gid } },
    );
    const data: any = await res.json();
    const product = data?.data?.product;
    if (!product) return;

    await indexProductPage([product], shopId);

    const count = await ImageEmbedding.countDocuments({ shopId, isActive: true });
    await ImageSearchSettings.findOneAndUpdate(
      { shopId },
      { $set: { totalIndexed: count } },
    );
  } catch (err) {
    console.error(`[ImageSearch] Webhook index failed for product ${productId}:`, err);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractNumericId(gid: string): string {
  const parts = gid.split("/");
  return parts[parts.length - 1];
}
