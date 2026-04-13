/**
 * Image Index Jobs Service — Batch-safe, timeout-proof
 *
 * Uses Shopify REST API directly with access token from MongoDB session,
 * exactly like abandoned-cart-poller.service.ts.
 *
 * Key design decisions:
 * - syncBatch(shopId, accessToken, cursor?): indexes ONE PAGE of products and returns.
 *   Callers can loop over batches. Each batch takes ~10–20s (safe for Render).
 * - No cron, no job queue.
 */

import mongoose from "mongoose";
import { createHash } from "crypto";
import { connectDB } from "../../db.server";
import { ImageEmbedding } from "../models/image-embedding.model";
import { ImageSearchSettings } from "../models/image-search-settings.model";
import { generateEmbedding } from "./embedding.service";

const MAX_IMAGES_PER_PRODUCT = 1; // Only first image — fast and still useful
const MODEL_VERSION = "sharp-visual-v1";
const API = "2025-01";
const PAGE_SIZE = 10; // 10 products × 1 image = ~10s per batch

export function initImageSearchJobs(): void {
  console.log("[ImageSearch] Batch indexing mode ready.");
}

// ─── Access token lookup ──────────────────────────────────────────────────────

export async function getShopAccessToken(shopId: string): Promise<string | null> {
  await connectDB();

  // 1. Check cached token in ImageSearchSettings (saved on every admin visit)
  const settings = await ImageSearchSettings.findOne({ shopId })
    .select("_accessToken")
    .lean();
  if (settings?._accessToken) {
    return settings._accessToken as string;
  }

  // 2. Fallback: shopify_sessions collection (offline session)
  const db = mongoose.connection.db;
  if (!db) return null;
  const col = db.collection("shopify_sessions");

  // Try offline first, then any session
  const session =
    (await col.findOne({ shop: shopId, isOnline: false, accessToken: { $exists: true, $ne: "" } })) ||
    (await col.findOne({ shop: shopId, accessToken: { $exists: true, $ne: "" } }));

  if (!session?.accessToken) {
    console.error(`[ImageSearch] No access token for ${shopId}. Visit Image Search Settings to refresh.`);
    return null;
  }
  return session.accessToken as string;
}

// ─── Fetch one page of products from Shopify REST API ────────────────────────

export async function fetchProductsPage(
  shopId: string,
  accessToken: string,
  pageInfo?: string,
): Promise<{ products: any[]; nextPageInfo?: string }> {
  const url = new URL(`https://${shopId}/admin/api/${API}/products.json`);
  if (pageInfo) {
    url.searchParams.set("page_info", pageInfo);
    url.searchParams.set("limit", String(PAGE_SIZE));
  } else {
    url.searchParams.set("limit", String(PAGE_SIZE));
    url.searchParams.set("status", "active");
    url.searchParams.set("fields", "id,title,handle,images,variants");
  }

  const res = await fetch(url.toString(), {
    headers: { "X-Shopify-Access-Token": accessToken },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Shopify ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as { products: any[] };
  const link = res.headers.get("Link") || "";
  const next = link.match(/<[^>]*[?&]page_info=([^>&"]+)[^>]*>;\s*rel="next"/)?.[1];

  console.log(`[ImageSearch] Fetched ${data.products?.length ?? 0} products, hasNext=${!!next}`);
  return { products: data.products || [], nextPageInfo: next };
}

// ─── Index a list of products (embed first image only) ───────────────────────

async function embedProducts(products: any[], shopId: string): Promise<number> {
  let n = 0;
  for (const product of products) {
    const imageUrl: string | undefined = product.images?.[0]?.src;
    if (!imageUrl) continue;

    const productId = String(product.id);
    const price = Math.round(parseFloat(product.variants?.[0]?.price || "0") * 100);

    try {
      const imgRes = await fetch(imageUrl, {
        headers: { "User-Agent": "ShopifyImageSearch/1.0" },
        signal: AbortSignal.timeout(8_000),
      });
      if (!imgRes.ok) {
        console.warn(`[ImageSearch] Image ${imgRes.status} for "${product.title}"`);
        continue;
      }

      const buffer = Buffer.from(await imgRes.arrayBuffer());
      const imageHash = createHash("sha256").update(buffer).digest("hex");

      // Skip if hash unchanged
      const existing = await ImageEmbedding.findOne({ shopId, imageUrl })
        .select("imageHash")
        .lean();
      if (existing && (existing as any).imageHash === imageHash) {
        n++;
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
      n++;
      console.log(`[ImageSearch] Indexed "${product.title}"`);
    } catch (e) {
      console.error(`[ImageSearch] Failed to embed "${product.title}":`, e);
    }
  }
  return n;
}

// ─── Sync ONE batch and return cursor for next batch ─────────────────────────

export async function syncBatch(
  shopId: string,
  accessToken: string,
  cursor?: string,
): Promise<{ indexed: number; nextCursor?: string; done: boolean }> {
  await connectDB();

  const { products, nextPageInfo } = await fetchProductsPage(shopId, accessToken, cursor);
  if (!products.length) {
    return { indexed: 0, done: true };
  }

  const indexed = await embedProducts(products, shopId);

  // Update running count
  const total = await ImageEmbedding.countDocuments({ shopId, isActive: true });
  await ImageSearchSettings.findOneAndUpdate(
    { shopId },
    { $set: { totalIndexed: total, lastSyncedAt: new Date() } },
  );

  return { indexed, nextCursor: nextPageInfo, done: !nextPageInfo };
}

// ─── Full sync (for background use — no HTTP timeout concern) ─────────────────

export async function triggerFullCatalogSyncForShop(
  shopId: string,
  tokenOrAdmin?: string | object,
): Promise<number> {
  await connectDB();

  // Resolve token
  const accessToken =
    typeof tokenOrAdmin === "string"
      ? tokenOrAdmin
      : await getShopAccessToken(shopId);

  if (!accessToken) {
    console.error(`[ImageSearch] triggerFullCatalogSyncForShop: no token for ${shopId}`);
    return 0;
  }

  let cursor: string | undefined;
  let totalIndexed = 0;

  do {
    try {
      const result = await syncBatch(shopId, accessToken, cursor);
      totalIndexed += result.indexed;
      cursor = result.nextCursor;
      if (result.done) break;
    } catch (err) {
      console.error("[ImageSearch] Batch failed:", err);
      break;
    }
  } while (cursor);

  const finalCount = await ImageEmbedding.countDocuments({ shopId, isActive: true });
  console.log(`[ImageSearch] Full sync done: ${finalCount} embeddings`);
  return finalCount;
}

export async function triggerFullCatalogSync(): Promise<void> {
  await connectDB();
  const shops = await ImageSearchSettings.find({ enabled: true }).select("shopId").lean();
  for (const shop of shops) {
    await triggerFullCatalogSyncForShop(shop.shopId).catch((e) =>
      console.error(`[ImageSearch] Sync failed for ${shop.shopId}:`, e),
    );
  }
}

// ─── Webhook: single product index/delete ────────────────────────────────────

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

  const accessToken = await getShopAccessToken(shopId);
  if (!accessToken) return;

  try {
    const res = await fetch(
      `https://${shopId}/admin/api/${API}/products/${productId}.json?fields=id,title,handle,images,variants`,
      { headers: { "X-Shopify-Access-Token": accessToken }, signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) return;
    const { product } = (await res.json()) as { product: any };
    if (!product) return;
    await embedProducts([product], shopId);
    const count = await ImageEmbedding.countDocuments({ shopId, isActive: true });
    await ImageSearchSettings.findOneAndUpdate({ shopId }, { $set: { totalIndexed: count } });
  } catch (e) {
    console.error(`[ImageSearch] Webhook index failed for product ${productId}:`, e);
  }
}
