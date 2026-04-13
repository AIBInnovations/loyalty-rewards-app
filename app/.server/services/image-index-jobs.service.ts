/**
 * Image Index Jobs Service
 *
 * Background job handlers for indexing product images into MongoDB
 * Atlas Vector Search. Mirrors the pattern in jobs.service.ts.
 *
 * Cron schedule:
 *   - every 15 min  (slash-15 star star star star) -> processPendingIndexJobs
 *   - 30 3 * * *    -> triggerFullCatalogSync (nightly — enqueue all products for all shops)
 *
 * Job pipeline per product:
 *   1. Claim job atomically (status: pending → processing)
 *   2. Fetch product images from Shopify GraphQL
 *   3. For each image URL (max 5):
 *      a. fetch() → Buffer
 *      b. sharp preprocess → 224×224 PNG
 *      c. SHA256 hash → skip if unchanged
 *      d. generateEmbedding() → 512-dim CLIP vector
 *      e. upsert ImageEmbedding
 *   4. Mark job completed / failed
 */

import cron from "node-cron";
import { createHash } from "crypto";
import { connectDB } from "../../db.server";
import { unauthenticated } from "../../shopify.server";
import { ImageSyncJob } from "../models/image-sync-job.model";
import { ImageEmbedding } from "../models/image-embedding.model";
import { ImageSearchSettings } from "../models/image-search-settings.model";
import { generateEmbedding } from "./embedding.service";

const MAX_IMAGES_PER_PRODUCT = 5;
const MAX_JOBS_PER_RUN = 50;  // increased from 10 — faster indexing for typical store sizes
const MAX_ATTEMPTS = 3;
const MODEL_VERSION = "sharp-visual-v1";

// ─── Init ─────────────────────────────────────────────────────────

export function initImageSearchJobs(): void {
  console.log("Initializing image search indexing jobs...");

  // On startup: auto-sync any shop that has image search enabled but 0 indexed
  // products (handles first-time setup without requiring manual intervention).
  // 15-second delay to let the DB connection settle before querying.
  setTimeout(async () => {
    try {
      await connectDB();
      await autoSyncEmptyShops();
      await processPendingIndexJobs();
    } catch (err) {
      console.error("[ImageSearch] Startup auto-sync failed:", err);
    }
  }, 15_000);

  // Every 5 min: process pending index jobs (reduced from 15 min)
  cron.schedule("*/5 * * * *", async () => {
    try {
      await connectDB();
      await processPendingIndexJobs();
    } catch (err) {
      console.error("[ImageSearch] Index job processor failed:", err);
    }
  });

  // 3:30 AM nightly: enqueue full catalog sync for all enabled shops
  cron.schedule("30 3 * * *", async () => {
    try {
      await connectDB();
      await triggerFullCatalogSync();
    } catch (err) {
      console.error("[ImageSearch] Full catalog sync failed:", err);
    }
  });

  console.log("Image search indexing jobs initialized.");
}

// ─── Startup Auto-Sync ────────────────────────────────────────────

/**
 * Called once at server startup. Finds every shop that has image search
 * enabled but totalIndexed === 0 and enqueues a full catalog sync so that
 * products are indexed without any manual "Trigger Sync" click.
 */
async function autoSyncEmptyShops(): Promise<void> {
  const shops = await ImageSearchSettings.find(
    { enabled: true, totalIndexed: 0 },
    { shopId: 1 },
  ).lean();

  if (shops.length === 0) return;

  console.log(
    `[ImageSearch] Auto-syncing ${shops.length} shop(s) with 0 indexed products`,
  );
  for (const shop of shops) {
    try {
      await triggerFullCatalogSyncForShop(shop.shopId);
    } catch (err) {
      console.error(
        `[ImageSearch] Auto-sync failed for shop ${shop.shopId}:`,
        err,
      );
    }
  }
}

// ─── Process Pending Jobs ─────────────────────────────────────────

async function processPendingIndexJobs(): Promise<void> {
  // Claim jobs atomically: pending → processing
  // This prevents double-processing if server restarts mid-run
  const jobs = [];
  for (let i = 0; i < MAX_JOBS_PER_RUN; i++) {
    const job = await ImageSyncJob.findOneAndUpdate(
      {
        status: "pending",
        attempts: { $lt: MAX_ATTEMPTS },
      },
      {
        $set: { status: "processing", startedAt: new Date() },
        $inc: { attempts: 1 },
      },
      { new: true, sort: { createdAt: 1 } }, // FIFO
    );
    if (!job) break;
    jobs.push(job);
  }

  if (jobs.length === 0) return;
  console.log(`[ImageSearch] Processing ${jobs.length} index job(s)`);

  for (const job of jobs) {
    try {
      if (job.jobType === "delete") {
        await processDeleteJob(job);
      } else {
        await processIndexJob(job);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(
        `[ImageSearch] Job failed for product ${job.productId} (${job.shopId}):`,
        errorMessage,
      );

      const newStatus = job.attempts >= MAX_ATTEMPTS ? "failed" : "pending";
      await ImageSyncJob.findByIdAndUpdate(job._id, {
        $set: {
          status: newStatus,
          errorMessage,
          startedAt: null,
        },
      });
    }
  }
}

// ─── Delete Job ───────────────────────────────────────────────────

async function processDeleteJob(job: any): Promise<void> {
  await ImageEmbedding.updateMany(
    { shopId: job.shopId, productId: job.productId },
    { $set: { isActive: false } },
  );

  // Update totalIndexed counter
  const count = await ImageEmbedding.countDocuments({
    shopId: job.shopId,
    isActive: true,
  });
  await ImageSearchSettings.findOneAndUpdate(
    { shopId: job.shopId },
    { $set: { totalIndexed: count } },
  );

  await ImageSyncJob.findByIdAndUpdate(job._id, {
    $set: { status: "completed", completedAt: new Date() },
  });

  console.log(
    `[ImageSearch] Deleted embeddings for product ${job.productId} (${job.shopId})`,
  );
}

// ─── Index Job ────────────────────────────────────────────────────

async function processIndexJob(job: any): Promise<void> {
  // Fetch product images from Shopify
  const imageUrls = await fetchProductImageUrls(
    job.shopId,
    job.productId,
    job,
  );

  if (!imageUrls || imageUrls.length === 0) {
    // Product has no images — mark complete with 0 processed
    await ImageSyncJob.findByIdAndUpdate(job._id, {
      $set: { status: "completed", completedAt: new Date(), processedImages: 0 },
    });
    return;
  }

  const urlsToProcess = imageUrls.slice(0, MAX_IMAGES_PER_PRODUCT);
  let processedCount = 0;

  for (const imageUrl of urlsToProcess) {
    try {
      // Fetch image bytes
      const response = await fetch(imageUrl, {
        headers: { "User-Agent": "ShopifyImageSearch/1.0" },
        signal: AbortSignal.timeout(15_000), // 15s timeout per image
      });

      if (!response.ok) {
        console.warn(`[ImageSearch] Could not fetch image ${imageUrl}: HTTP ${response.status}`);
        continue;
      }

      const arrayBuffer = await response.arrayBuffer();
      const rawBuffer = Buffer.from(arrayBuffer);

      // Compute hash before preprocessing — skip if unchanged
      const imageHash = createHash("sha256").update(rawBuffer).digest("hex");
      const existing = await ImageEmbedding.findOne({
        shopId: job.shopId,
        imageUrl,
      }).select("imageHash").lean();

      if (existing && (existing as any).imageHash === imageHash) {
        console.log(`[ImageSearch] Skipping unchanged image: ${imageUrl}`);
        processedCount++;
        continue;
      }

      // Preprocess: resize to 224×224, normalize to PNG
      const { default: sharp } = await import("sharp");
      const processed = await sharp(rawBuffer)
        .resize(224, 224, { fit: "cover", position: "centre" })
        .png()
        .toBuffer();

      // Generate CLIP embedding
      const embedding = await generateEmbedding(processed);

      // Upsert embedding record
      await ImageEmbedding.findOneAndUpdate(
        { shopId: job.shopId, imageUrl },
        {
          $set: {
            productId: job.productId,
            productTitle: job.productTitle,
            productHandle: (job as any).productHandle || "",
            price: (job as any).price || 0,
            imageHash,
            embedding,
            modelVersion: MODEL_VERSION,
            isActive: true,
            indexedAt: new Date(),
          },
          $setOnInsert: {
            shopId: job.shopId,
            variantId: "",
          },
        },
        { upsert: true },
      );

      processedCount++;
    } catch (imageErr) {
      console.error(
        `[ImageSearch] Error processing image ${imageUrl}:`,
        imageErr,
      );
      // Continue with next image — don't fail the whole job on one bad image
    }
  }

  // Update totalIndexed count
  const total = await ImageEmbedding.countDocuments({
    shopId: job.shopId,
    isActive: true,
  });
  await ImageSearchSettings.findOneAndUpdate(
    { shopId: job.shopId },
    { $set: { totalIndexed: total } },
  );

  await ImageSyncJob.findByIdAndUpdate(job._id, {
    $set: {
      status: "completed",
      completedAt: new Date(),
      processedImages: processedCount,
      imageUrls: urlsToProcess,
    },
  });

  console.log(
    `[ImageSearch] Indexed ${processedCount}/${urlsToProcess.length} images for product ${job.productId} (${job.shopId})`,
  );
}

// ─── Shopify Product Image Fetch ─────────────────────────────────

const PRODUCT_IMAGES_QUERY = `
  query getProductImages($id: ID!) {
    product(id: $id) {
      id
      title
      handle
      priceRange {
        minVariantPrice {
          amount
        }
      }
      images(first: 10) {
        nodes {
          url
        }
      }
    }
  }
`;

async function fetchProductImageUrls(
  shopId: string,
  productId: string,
  job: any,
): Promise<string[]> {
  try {
    const { admin } = await unauthenticated.admin(shopId);

    // Convert numeric ID to GID if needed
    const gid = productId.startsWith("gid://")
      ? productId
      : `gid://shopify/Product/${productId}`;

    const response = await admin.graphql(PRODUCT_IMAGES_QUERY, {
      variables: { id: gid },
    });

    const data = await response.json();
    const product = data?.data?.product;

    if (!product) return [];

    // Update job with fetched product metadata (for denormalization in embeddings)
    await ImageSyncJob.findByIdAndUpdate(job._id, {
      $set: {
        productTitle: product.title || job.productTitle,
        productHandle: product.handle || "",
        price: Math.round(
          parseFloat(product.priceRange?.minVariantPrice?.amount || "0") * 100,
        ),
      },
    });

    // Refresh job object with updated values
    job.productTitle = product.title || job.productTitle;
    job.productHandle = product.handle || "";
    job.price = Math.round(
      parseFloat(product.priceRange?.minVariantPrice?.amount || "0") * 100,
    );

    return (product.images?.nodes || []).map((n: { url: string }) => n.url);
  } catch (err) {
    console.error(
      `[ImageSearch] Failed to fetch images for product ${productId}:`,
      err,
    );
    return [];
  }
}

// ─── Full Catalog Sync ─────────────────────────────────────────────

export async function triggerFullCatalogSync(): Promise<void> {
  const enabledShops = await ImageSearchSettings.find({ enabled: true })
    .select("shopId")
    .lean();

  if (enabledShops.length === 0) return;

  console.log(
    `[ImageSearch] Starting full catalog sync for ${enabledShops.length} shop(s)`,
  );

  for (const shop of enabledShops) {
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

export async function triggerFullCatalogSyncForShop(
  shopId: string,
): Promise<number> {
  let cursor: string | null = null;
  let totalEnqueued = 0;
  let hasNextPage = true;

  const PRODUCTS_QUERY = `
    query listProducts($cursor: String) {
      products(first: 250, after: $cursor, query: "status:active") {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
          title
        }
      }
    }
  `;

  const { admin } = await unauthenticated.admin(shopId);

  while (hasNextPage) {
    const response: any = await admin.graphql(PRODUCTS_QUERY, {
      variables: { cursor },
    });
    const data: any = await response.json();
    const productsData: any = data?.data?.products;

    if (!productsData) break;

    const nodes = productsData.nodes || [];
    hasNextPage = productsData.pageInfo?.hasNextPage ?? false;
    cursor = productsData.pageInfo?.endCursor ?? null;

    // Batch-upsert jobs (ordered:false allows partial success on dup keys)
    const jobDocs = nodes.map((p: { id: string; title: string }) => ({
      updateOne: {
        filter: { shopId, productId: extractNumericId(p.id), status: "pending" },
        update: {
          $set: {
            jobType: "index",
            productTitle: p.title,
            triggeredBy: "cron",
            updatedAt: new Date(),
          },
          $setOnInsert: {
            shopId,
            productId: extractNumericId(p.id),
            attempts: 0,
            imageUrls: [],
            processedImages: 0,
          },
        },
        upsert: true,
      },
    }));

    if (jobDocs.length > 0) {
      await ImageSyncJob.bulkWrite(jobDocs, { ordered: false });
      totalEnqueued += jobDocs.length;
    }
  }

  await ImageSearchSettings.findOneAndUpdate(
    { shopId },
    { $set: { lastSyncedAt: new Date() } },
  );

  console.log(
    `[ImageSearch] Full catalog sync enqueued ${totalEnqueued} products for ${shopId}`,
  );
  return totalEnqueued;
}

// ─── Helpers ──────────────────────────────────────────────────────

function extractNumericId(gid: string): string {
  // "gid://shopify/Product/12345" → "12345"
  const parts = gid.split("/");
  return parts[parts.length - 1];
}
