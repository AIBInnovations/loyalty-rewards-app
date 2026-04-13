/**
 * Image Index Jobs Service
 *
 * Indexes product images directly and immediately — no cron, no job queue.
 * This is required for Render.com free tier where the server sleeps after
 * 15 minutes of inactivity, making cron-based indexing unreliable.
 *
 * Entry points:
 *   triggerFullCatalogSyncForShop(shopId, admin)
 *     — Called from the image-search-settings loader whenever totalIndexed===0.
 *     — Paginates all active products, downloads their images, generates
 *       512-dim visual embeddings with sharp, and upserts to image_embeddings.
 *     — Fire-and-forget (caller does not await).
 *
 *   enqueueProductForIndexing / processWebhookJob
 *     — Used for webhook-triggered single-product updates (create/update/delete).
 */

import { createHash } from "crypto";
import { connectDB } from "../../db.server";
import { unauthenticated } from "../../shopify.server";
import { ImageEmbedding } from "../models/image-embedding.model";
import { ImageSearchSettings } from "../models/image-search-settings.model";
import { generateEmbedding } from "./embedding.service";

const MAX_IMAGES_PER_PRODUCT = 5;
const MODEL_VERSION = "sharp-visual-v1";

// ─── Init (no-op — cron removed, indexing is now inline) ─────────────────────

export function initImageSearchJobs(): void {
  console.log("[ImageSearch] Inline indexing mode — no cron jobs needed.");
}

// ─── Full Catalog Sync (inline, immediate) ────────────────────────────────────

const PRODUCTS_QUERY = `
  query listProducts($cursor: String) {
    products(first: 50, after: $cursor, query: "status:active") {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        title
        handle
        priceRange { minVariantPrice { amount } }
        images(first: 5) { nodes { url } }
      }
    }
  }
`;

export async function triggerFullCatalogSyncForShop(
  shopId: string,
  authenticatedAdmin?: { graphql: (query: string, opts?: any) => Promise<any> },
): Promise<number> {
  await connectDB();

  const admin = authenticatedAdmin ?? (await unauthenticated.admin(shopId)).admin;

  let cursor: string | null = null;
  let hasNextPage = true;
  let totalIndexed = 0;

  console.log(`[ImageSearch] Starting inline catalog sync for ${shopId}`);

  while (hasNextPage) {
    let productsData: any;
    try {
      const response: any = await admin.graphql(PRODUCTS_QUERY, {
        variables: { cursor },
      });
      const data: any = await response.json();
      productsData = data?.data?.products;
    } catch (err) {
      console.error("[ImageSearch] Failed to fetch products page:", err);
      break;
    }

    if (!productsData) break;

    hasNextPage = productsData.pageInfo?.hasNextPage ?? false;
    cursor = productsData.pageInfo?.endCursor ?? null;

    const products: any[] = productsData.nodes || [];

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
          // Download image
          const res = await fetch(imageUrl, {
            headers: { "User-Agent": "ShopifyImageSearch/1.0" },
            signal: AbortSignal.timeout(15_000),
          });
          if (!res.ok) continue;

          const buffer = Buffer.from(await res.arrayBuffer());

          // Skip if image bytes are unchanged
          const imageHash = createHash("sha256").update(buffer).digest("hex");
          const existing = await ImageEmbedding.findOne({ shopId, imageUrl })
            .select("imageHash")
            .lean();
          if (existing && (existing as any).imageHash === imageHash) {
            totalIndexed++;
            continue;
          }

          // Generate 512-dim visual embedding
          const embedding = await generateEmbedding(buffer);

          // Upsert embedding document
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

          totalIndexed++;
          console.log(
            `[ImageSearch] Indexed ${product.title} — ${imageUrl.slice(-40)}`,
          );
        } catch (imgErr) {
          console.error(
            `[ImageSearch] Error indexing image ${imageUrl}:`,
            imgErr,
          );
        }
      }
    }
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

  console.log(
    `[ImageSearch] Sync complete — ${finalCount} embeddings for ${shopId}`,
  );
  return finalCount;
}

// ─── Full Catalog Sync (all enabled shops — nightly convenience) ──────────────

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
  // For delete: soft-delete all embeddings for this product
  if (jobType === "delete") {
    await ImageEmbedding.updateMany(
      { shopId, productId },
      { $set: { isActive: false } },
    );
    const count = await ImageEmbedding.countDocuments({
      shopId,
      isActive: true,
    });
    await ImageSearchSettings.findOneAndUpdate(
      { shopId },
      { $set: { totalIndexed: count } },
    );
    console.log(
      `[ImageSearch] Deleted embeddings for product ${productId} (${shopId})`,
    );
    return;
  }

  // For index/reindex: fetch fresh images via offline session and embed
  try {
    const { admin } = await unauthenticated.admin(shopId);
    const gid = productId.startsWith("gid://")
      ? productId
      : `gid://shopify/Product/${productId}`;

    const res: any = await admin.graphql(
      `query($id:ID!){product(id:$id){title handle priceRange{minVariantPrice{amount}} images(first:5){nodes{url}}}}`,
      { variables: { id: gid } },
    );
    const data: any = await res.json();
    const product = data?.data?.product;
    if (!product) return;

    const imageUrls: string[] = (product.images?.nodes || []).map(
      (n: any) => n.url as string,
    );
    const price = Math.round(
      parseFloat(product.priceRange?.minVariantPrice?.amount || "0") * 100,
    );

    for (const imageUrl of imageUrls.slice(0, MAX_IMAGES_PER_PRODUCT)) {
      try {
        const imgRes = await fetch(imageUrl, {
          signal: AbortSignal.timeout(15_000),
        });
        if (!imgRes.ok) continue;
        const buffer = Buffer.from(await imgRes.arrayBuffer());
        const imageHash = createHash("sha256").update(buffer).digest("hex");
        const embedding = await generateEmbedding(buffer);
        await ImageEmbedding.findOneAndUpdate(
          { shopId, imageUrl },
          {
            $set: {
              productId,
              productTitle: product.title,
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
      } catch (e) {
        console.error(`[ImageSearch] Webhook index error for ${imageUrl}:`, e);
      }
    }

    const count = await ImageEmbedding.countDocuments({
      shopId,
      isActive: true,
    });
    await ImageSearchSettings.findOneAndUpdate(
      { shopId },
      { $set: { totalIndexed: count } },
    );
  } catch (err) {
    console.error(
      `[ImageSearch] Webhook index failed for product ${productId}:`,
      err,
    );
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractNumericId(gid: string): string {
  const parts = gid.split("/");
  return parts[parts.length - 1];
}
