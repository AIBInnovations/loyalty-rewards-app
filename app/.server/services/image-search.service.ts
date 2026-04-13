/**
 * Image Search Service
 *
 * Core service that wires together:
 *  - Image preprocessing (sharp)
 *  - CLIP embedding generation
 *  - MongoDB Atlas $vectorSearch with per-shop tenant isolation
 *  - Job enqueuing for webhook-triggered indexing
 *  - Analytics logging
 *
 * MULTI-TENANT ISOLATION:
 * Every DB query in this file filters on `shopId`. The $vectorSearch
 * pre-filter `{ shopId: { $eq: shopId } }` is enforced at HNSW scan level,
 * so Store A's vectors are structurally unreachable from Store B's queries.
 */

import sharp from "sharp";
import { createHash } from "crypto";
import { ImageEmbedding } from "../models/image-embedding.model";
import {
  ImageSearchSettings,
  getOrCreateImageSearchSettings,
  type IImageSearchSettings,
} from "../models/image-search-settings.model";
import { ImageSearchLog } from "../models/image-search-log.model";
import { ImageSyncJob } from "../models/image-sync-job.model";
import { generateEmbedding } from "./embedding.service";

// ─── Types ────────────────────────────────────────────────────────

export interface SearchResult {
  productId: string;
  title: string;
  handle: string;
  imageUrl: string;
  price: number;
  score: number;
}

export interface SearchResponse {
  results: SearchResult[];
  searchId: string;
  durationMs: number;
}

// ─── Search ──────────────────────────────────────────────────────

/**
 * Perform a reverse image search for a given shopId.
 * 1. Preprocess uploaded image with sharp (224×224 RGB PNG)
 * 2. Generate 512-dim CLIP embedding
 * 3. Run $vectorSearch on image_embeddings with shopId pre-filter
 * 4. Deduplicate at product level (keep best score per product)
 * 5. Log analytics and return results
 */
export async function searchByImage(
  rawBuffer: Buffer,
  shopId: string,
  sessionId: string = "",
  customerId: string = "",
): Promise<SearchResponse> {
  const startMs = Date.now();
  const queryHash = createHash("sha256").update(rawBuffer).digest("hex");
  let logId = "";
  let error = "";

  try {
    const settings = await getOrCreateImageSearchSettings(shopId);

    if (!settings.enabled) {
      throw new Error("Image search is not enabled for this shop");
    }

    // 1. Preprocess: resize to 224×224, convert to PNG (CLIP input format)
    const processed = await sharp(rawBuffer)
      .resize(224, 224, { fit: "cover", position: "centre" })
      .png()
      .toBuffer();

    // 2. Generate CLIP embedding (512 floats)
    const queryEmbedding = await generateEmbedding(processed);

    // 3. Atlas Vector Search — shopId pre-filter is the tenant isolation guard
    const rawResults = await (ImageEmbedding as any).aggregate([
      {
        $vectorSearch: {
          index: "image_vector_index",
          path: "embedding",
          queryVector: queryEmbedding,
          numCandidates: Math.max(100, settings.maxResults * 10),
          limit: settings.maxResults * 3, // over-fetch before dedup
          filter: {
            shopId: { $eq: shopId }, // ← CRITICAL: tenant isolation
            isActive: { $eq: true },
          },
        },
      },
      {
        $addFields: { score: { $meta: "vectorSearchScore" } },
      },
      {
        $match: { score: { $gte: settings.minScore } },
      },
      {
        $project: {
          productId: 1,
          productTitle: 1,
          productHandle: 1,
          imageUrl: 1,
          price: 1,
          score: 1,
          _id: 0,
        },
      },
    ]);

    // 4. Deduplicate at product level — keep only the highest-scoring image per product
    const seen = new Map<string, SearchResult>();
    for (const r of rawResults) {
      const existing = seen.get(r.productId);
      if (!existing || r.score > existing.score) {
        seen.set(r.productId, {
          productId: r.productId,
          title: r.productTitle,
          handle: r.productHandle,
          imageUrl: r.imageUrl,
          price: r.price,
          score: Math.round(r.score * 1000) / 1000,
        });
      }
    }

    const results = Array.from(seen.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, settings.maxResults);

    const durationMs = Date.now() - startMs;
    const topScore = results[0]?.score ?? 0;

    // 5. Log analytics (fire-and-forget — don't block response)
    ImageSearchLog.create({
      shopId,
      sessionId,
      customerId,
      queryImageHash: queryHash,
      resultsCount: results.length,
      topScore,
      durationMs,
      error: "",
    })
      .then((log) => {
        logId = log._id.toString();
      })
      .catch((err) => console.error("[ImageSearch] Log error:", err));

    return { results, searchId: logId, durationMs };
  } catch (err) {
    error = err instanceof Error ? err.message : "Search failed";
    const durationMs = Date.now() - startMs;

    // Log failed search
    ImageSearchLog.create({
      shopId,
      sessionId,
      customerId,
      queryImageHash: queryHash,
      resultsCount: 0,
      topScore: 0,
      durationMs,
      error,
    }).catch(() => {});

    throw err;
  }
}

// ─── Event Tracking ───────────────────────────────────────────────

export async function trackSearchEvent(
  searchId: string,
  shopId: string,
  event: "click" | "add_to_cart",
  productId: string,
  position: number = 0,
): Promise<void> {
  // shopId guard: ensure the log belongs to this shop (prevents cross-shop spoofing)
  const update =
    event === "click"
      ? { clickedProductId: productId, clickedPosition: position }
      : { convertedToCart: true };

  await ImageSearchLog.findOneAndUpdate(
    { _id: searchId, shopId }, // shopId guard
    { $set: update },
  );
}

// ─── Config ───────────────────────────────────────────────────────

export async function getPublicSearchConfig(
  shopId: string,
): Promise<Partial<IImageSearchSettings>> {
  const settings = await ImageSearchSettings.findOne({ shopId }).lean();
  if (!settings) {
    return { enabled: false };
  }
  return {
    enabled: settings.enabled,
    maxResults: settings.maxResults,
    showPrice: settings.showPrice,
    showAddToCart: settings.showAddToCart,
    primaryColor: settings.primaryColor,
    buttonText: settings.buttonText,
    modalTitle: settings.modalTitle,
  };
}

// ─── Job Enqueuing ────────────────────────────────────────────────

/**
 * Upsert a pending sync job for a product.
 * If a pending job already exists for this product, update it.
 * This prevents duplicate jobs when webhooks fire rapidly.
 */
export async function enqueueProductForIndexing(
  shopId: string,
  productId: string,
  productTitle: string,
  jobType: "index" | "reindex" | "delete",
  triggeredBy: "webhook" | "manual" | "cron" = "webhook",
): Promise<void> {
  await ImageSyncJob.findOneAndUpdate(
    { shopId, productId, status: "pending" },
    {
      $set: {
        jobType,
        productTitle,
        triggeredBy,
        updatedAt: new Date(),
      },
      $setOnInsert: {
        shopId,
        productId,
        attempts: 0,
        imageUrls: [],
        processedImages: 0,
      },
    },
    { upsert: true },
  );
}

// ─── Webhook Handlers ─────────────────────────────────────────────

export async function handleProductCreate(
  shop: string,
  payload: Record<string, any>,
): Promise<void> {
  const productId = String(payload.id || "");
  const title = String(payload.title || "");
  if (!productId) return;

  // Only enqueue if image search is enabled for this shop
  const settings = await ImageSearchSettings.findOne({ shopId: shop }).lean();
  if (!settings?.enabled) return;

  await enqueueProductForIndexing(shop, productId, title, "index", "webhook");
  console.log(`[ImageSearch] Enqueued index job for new product ${productId} (${shop})`);
}

export async function handleProductUpdate(
  shop: string,
  payload: Record<string, any>,
): Promise<void> {
  const productId = String(payload.id || "");
  const title = String(payload.title || "");
  if (!productId) return;

  const settings = await ImageSearchSettings.findOne({ shopId: shop }).lean();
  if (!settings?.enabled) return;

  await enqueueProductForIndexing(shop, productId, title, "reindex", "webhook");
  console.log(`[ImageSearch] Enqueued reindex job for updated product ${productId} (${shop})`);
}

export async function handleProductDelete(
  shop: string,
  payload: Record<string, any>,
): Promise<void> {
  const productId = String(payload.id || "");
  if (!productId) return;

  // Always process deletes regardless of enabled state
  // (images must be removed even if feature was disabled after indexing)
  await enqueueProductForIndexing(shop, productId, "", "delete", "webhook");
  console.log(`[ImageSearch] Enqueued delete job for product ${productId} (${shop})`);
}

// ─── Index Management ─────────────────────────────────────────────

/**
 * Soft-delete all embeddings for a shop (used by "Clear Index" admin action).
 */
export async function clearShopIndex(shopId: string): Promise<number> {
  const result = await ImageEmbedding.updateMany(
    { shopId },
    { $set: { isActive: false } },
  );
  await ImageSearchSettings.findOneAndUpdate(
    { shopId },
    { $set: { totalIndexed: 0 } },
  );
  return result.modifiedCount;
}

/**
 * Recalculate and persist the totalIndexed count for a shop.
 */
export async function refreshIndexedCount(shopId: string): Promise<number> {
  const count = await ImageEmbedding.countDocuments({ shopId, isActive: true });
  await ImageSearchSettings.findOneAndUpdate(
    { shopId },
    { $set: { totalIndexed: count } },
  );
  return count;
}
