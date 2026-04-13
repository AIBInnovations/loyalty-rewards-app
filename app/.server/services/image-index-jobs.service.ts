/**
 * Image Index Jobs Service
 *
 * Indexes product images directly using the Shopify REST Admin API.
 * Uses the same offline-session pattern as abandoned-cart-poller.service.ts:
 *   - Reads the offline access token directly from the shopify_sessions collection
 *   - Calls /admin/api/products.json with X-Shopify-Access-Token header
 *
 * This avoids unauthenticated.admin() which requires a specific session type.
 *
 * Entry points:
 *   triggerFullCatalogSyncForShop(shopId, accessToken?)
 *     — Pass accessToken directly (from authenticate.admin session) for immediate use,
 *       or omit to look it up from MongoDB offline session.
 */

import mongoose from "mongoose";
import { createHash } from "crypto";
import { connectDB } from "../../db.server";
import { ImageEmbedding } from "../models/image-embedding.model";
import { ImageSearchSettings } from "../models/image-search-settings.model";
import { generateEmbedding } from "./embedding.service";

const MAX_IMAGES_PER_PRODUCT = 3;
const MODEL_VERSION = "sharp-visual-v1";
const SHOPIFY_API_VERSION = "2025-01";

export function initImageSearchJobs(): void {
  console.log("[ImageSearch] Inline indexing mode — no cron jobs needed.");
}

// ─── Get access token from MongoDB session ────────────────────────────────────

async function getAccessToken(shopId: string): Promise<string | null> {
  // 1. Try ImageSearchSettings._accessToken (cached from last admin visit)
  const settings = await ImageSearchSettings.findOne({ shopId }).select("_accessToken").lean();
  if (settings?._accessToken) {
    console.log(`[ImageSearch] Using cached access token from settings for ${shopId}`);
    return settings._accessToken as string;
  }

  // 2. Fall back to shopify_sessions collection
  const db = mongoose.connection.db;
  if (!db) return null;

  const sessionsCollection = db.collection("shopify_sessions");

  let session = await sessionsCollection.findOne({
    shop: shopId,
    isOnline: false,
    accessToken: { $exists: true, $ne: "" },
  });

  if (!session?.accessToken) {
    session = await sessionsCollection.findOne({
      shop: shopId,
      accessToken: { $exists: true, $ne: "" },
    });
  }

  if (!session?.accessToken) {
    console.error(`[ImageSearch] No access token found for ${shopId} — open Image Search Settings page to refresh`);
    return null;
  }

  console.log(`[ImageSearch] Found Shopify session for ${shopId} (isOnline: ${session.isOnline})`);
  return session.accessToken as string;
}

// ─── Fetch products via REST API ──────────────────────────────────────────────

async function fetchProductsPage(
  shopId: string,
  accessToken: string,
  pageInfo?: string,
): Promise<{ products: any[]; nextPageInfo?: string }> {
  const baseUrl = `https://${shopId}/admin/api/${SHOPIFY_API_VERSION}/products.json`;
  const params = new URLSearchParams({
    limit: "20",
    status: "active",
    fields: "id,title,handle,images,variants",
  });
  if (pageInfo) {
    params.set("page_info", pageInfo);
    // When using page_info, other params except limit must be omitted
    params.delete("status");
    params.delete("fields");
  }

  const url = `${baseUrl}?${params.toString()}`;
  console.log(`[ImageSearch] Fetching: ${url.replace(accessToken, "***")}`);

  const response = await fetch(url, {
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Shopify API error ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = await response.json() as { products: any[] };
  const products = data.products || [];

  // Extract next page cursor from Link header
  const linkHeader = response.headers.get("Link") || "";
  const nextMatch = linkHeader.match(/<[^>]*page_info=([^>&"]+)[^>]*>;\s*rel="next"/);
  const nextPageInfo = nextMatch ? nextMatch[1] : undefined;

  console.log(`[ImageSearch] Got ${products.length} products, hasNext: ${!!nextPageInfo}`);
  return { products, nextPageInfo };
}

// ─── Index one batch of products ──────────────────────────────────────────────

async function indexProducts(products: any[], shopId: string): Promise<number> {
  let count = 0;
  for (const product of products) {
    const productId = String(product.id);
    const imageUrls: string[] = (product.images || [])
      .slice(0, MAX_IMAGES_PER_PRODUCT)
      .map((img: any) => img.src as string)
      .filter(Boolean);

    const price = Math.round(
      parseFloat(
        product.variants?.[0]?.price || "0"
      ) * 100,
    );

    for (const imageUrl of imageUrls) {
      try {
        const res = await fetch(imageUrl, {
          headers: { "User-Agent": "ShopifyImageSearch/1.0" },
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) {
          console.warn(`[ImageSearch] Image fetch ${res.status}: ${imageUrl.slice(-50)}`);
          continue;
        }

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
        console.log(`[ImageSearch] Indexed "${product.title}" — ${imageUrl.slice(-40)}`);
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
  accessTokenOrAdmin?: string | { graphql: (query: string, opts?: any) => Promise<any> },
): Promise<number> {
  await connectDB();

  // Resolve access token
  let accessToken: string | null = null;

  if (typeof accessTokenOrAdmin === "string") {
    // Passed directly as a string
    accessToken = accessTokenOrAdmin;
  } else if (accessTokenOrAdmin && typeof accessTokenOrAdmin === "object") {
    // It's an admin object — get token from MongoDB session instead
    // (admin object doesn't expose token directly)
    accessToken = await getAccessToken(shopId);
  } else {
    // No admin provided — look up from MongoDB
    accessToken = await getAccessToken(shopId);
  }

  if (!accessToken) {
    console.error(`[ImageSearch] Cannot sync ${shopId}: no access token available`);
    return 0;
  }

  console.log(`[ImageSearch] Starting catalog sync for ${shopId}`);

  let pageInfo: string | undefined = undefined;
  let isFirst = true;
  let totalIndexed = 0;

  do {
    let products: any[];
    let nextPageInfo: string | undefined;

    try {
      ({ products, nextPageInfo } = await fetchProductsPage(
        shopId,
        accessToken,
        isFirst ? undefined : pageInfo,
      ));
    } catch (err) {
      console.error("[ImageSearch] Failed to fetch products page:", err);
      break;
    }

    if (!products.length && isFirst) {
      console.warn("[ImageSearch] No active products returned from Shopify API");
      break;
    }

    await indexProducts(products, shopId);
    isFirst = false;
    pageInfo = nextPageInfo;
  } while (pageInfo);

  const finalCount = await ImageEmbedding.countDocuments({ shopId, isActive: true });
  await ImageSearchSettings.findOneAndUpdate(
    { shopId },
    { $set: { totalIndexed: finalCount, lastSyncedAt: new Date() } },
  );

  console.log(`[ImageSearch] Sync complete — ${finalCount} embeddings for ${shopId}`);
  return finalCount;
}

// ─── All shops sync ───────────────────────────────────────────────────────────

export async function triggerFullCatalogSync(): Promise<void> {
  await connectDB();
  const shops = await ImageSearchSettings.find({ enabled: true })
    .select("shopId")
    .lean();
  for (const shop of shops) {
    try {
      await triggerFullCatalogSyncForShop(shop.shopId);
    } catch (err) {
      console.error(`[ImageSearch] Full sync failed for shop ${shop.shopId}:`, err);
    }
  }
}

// ─── Webhook single-product update ───────────────────────────────────────────

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
    return;
  }

  const accessToken = await getAccessToken(shopId);
  if (!accessToken) return;

  try {
    const url = `https://${shopId}/admin/api/${SHOPIFY_API_VERSION}/products/${productId}.json?fields=id,title,handle,images,variants`;
    const res = await fetch(url, {
      headers: { "X-Shopify-Access-Token": accessToken },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return;

    const data = await res.json() as { product: any };
    const product = data.product;
    if (!product) return;

    await indexProducts([product], shopId);

    const count = await ImageEmbedding.countDocuments({ shopId, isActive: true });
    await ImageSearchSettings.findOneAndUpdate(
      { shopId },
      { $set: { totalIndexed: count } },
    );
  } catch (err) {
    console.error(`[ImageSearch] Webhook index failed for product ${productId}:`, err);
  }
}
