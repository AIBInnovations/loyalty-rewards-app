import { SalesPopEvent } from "../models/sales-pop-event.model";
import { SalesPopSettings } from "../models/sales-pop-settings.model";

interface AdminAPI {
  graphql: (
    query: string,
    options?: { variables: Record<string, unknown> },
  ) => Promise<{
    json: () => Promise<{ data: Record<string, unknown>; errors?: unknown[] }>;
  }>;
}

interface OrderLineItem {
  product_id?: number | string;
  variant_id?: number | string;
  title?: string;
  name?: string;
  vendor?: string;
}

interface OrderAddress {
  first_name?: string;
  city?: string;
  province?: string;
  country?: string;
  country_code?: string;
}

interface OrderCustomer {
  first_name?: string;
  last_name?: string;
  tags?: string;
}

/**
 * Called from the ORDERS_PAID webhook. Converts a paid order into one
 * sanitized, per-line-item Sales Pop event per eligible product.
 * Fails silently on individual errors so it never blocks the webhook.
 */
export async function ingestOrderForSalesPop(
  shop: string,
  payload: Record<string, unknown>,
  admin: AdminAPI,
): Promise<void> {
  const settings = await SalesPopSettings.findOne({ shopId: shop }).lean();
  if (!settings) return;

  // Skip test/draft/imported orders
  if (payload.test === true) return;
  if (payload.cancelled_at) return;

  const lineItems = (payload.line_items as OrderLineItem[] | undefined) || [];
  if (!lineItems.length) return;

  const customer = (payload.customer as OrderCustomer | undefined) || {};
  // Honor merchant-level customer tag exclusions
  if (customer.tags && settings.excludedTags?.length) {
    const customerTags = customer.tags.split(",").map((t) => t.trim().toLowerCase());
    const excluded = settings.excludedTags.map((t) => t.toLowerCase());
    if (customerTags.some((t) => excluded.includes(t))) return;
  }

  const address =
    ((payload.shipping_address as OrderAddress | undefined) ||
      (payload.billing_address as OrderAddress | undefined)) ??
    {};

  const purchasedAt = payload.processed_at
    ? new Date(String(payload.processed_at))
    : payload.created_at
      ? new Date(String(payload.created_at))
      : new Date();

  // Gather unique product IDs from line items
  const productIds = Array.from(
    new Set(
      lineItems
        .map((li) => li.product_id)
        .filter((p): p is number | string => p !== undefined && p !== null),
    ),
  ).map(String);

  if (!productIds.length) return;

  // Fetch product handles/images/collections via GraphQL in one call
  const productMap = await fetchProductMeta(admin, productIds);

  for (const item of lineItems) {
    const productId = item.product_id ? String(item.product_id) : "";
    if (!productId) continue;
    const meta = productMap.get(productId);
    if (!meta) continue;
    if (!meta.handle) continue;

    try {
      await SalesPopEvent.updateOne(
        { shopId: shop, sourceOrderId: String(payload.id), productId },
        {
          $setOnInsert: {
            shopId: shop,
            sourceOrderId: String(payload.id),
            productId,
            variantId: item.variant_id ? String(item.variant_id) : undefined,
            productHandle: meta.handle,
            productTitle: meta.title || item.title || item.name || "a product",
            productImage: meta.image,
            collectionIds: meta.collectionIds,
            vendor: meta.vendor || item.vendor,
            rawFirstName:
              customer.first_name || address.first_name || undefined,
            rawCity: address.city || undefined,
            rawState: address.province || undefined,
            rawCountry: address.country || address.country_code || undefined,
            isActive: true,
            purchasedAt,
          },
        },
        { upsert: true },
      );
    } catch (err) {
      console.error("[SalesPop] Failed to upsert event:", err);
    }
  }
}

interface ProductMeta {
  handle: string;
  title: string;
  image?: string;
  vendor?: string;
  collectionIds: string[];
}

async function fetchProductMeta(
  admin: AdminAPI,
  productIds: string[],
): Promise<Map<string, ProductMeta>> {
  const map = new Map<string, ProductMeta>();
  if (!productIds.length) return map;

  const gids = productIds.map((id) =>
    id.startsWith("gid://") ? id : `gid://shopify/Product/${id}`,
  );

  const query = `
    query SalesPopProducts($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Product {
          id
          handle
          title
          vendor
          featuredImage { url }
          collections(first: 25) { nodes { id } }
        }
      }
    }
  `;

  try {
    const resp = await admin.graphql(query, { variables: { ids: gids } });
    const body = await resp.json();
    const nodes = (body.data?.nodes as Array<Record<string, unknown>>) || [];
    for (const node of nodes) {
      if (!node || !node.id) continue;
      const gid = String(node.id);
      const numericId = gid.split("/").pop() || "";
      const collections =
        ((node.collections as Record<string, unknown> | undefined)
          ?.nodes as Array<{ id: string }> | undefined) || [];
      map.set(numericId, {
        handle: String(node.handle || ""),
        title: String(node.title || ""),
        image: (node.featuredImage as { url?: string } | undefined)?.url,
        vendor: node.vendor ? String(node.vendor) : undefined,
        collectionIds: collections
          .map((c) => (c.id || "").split("/").pop() || "")
          .filter(Boolean),
      });
    }
  } catch (err) {
    console.error("[SalesPop] Product fetch failed:", err);
  }

  return map;
}

// ─── Display formatting (used by proxy feed) ────────────────────────

export function formatDisplayName(
  rawFirstName: string | undefined,
  style: string,
  fallback: string,
): string {
  if (!rawFirstName) return fallback;
  const name = rawFirstName.trim();
  if (!name) return fallback;
  if (style === "first_name") return name;
  if (style === "generic") return fallback;
  // masked: keep first letter, mask rest
  const first = name.charAt(0).toUpperCase();
  return `${first}****`;
}

export function formatDisplayLocation(
  city: string | undefined,
  state: string | undefined,
  country: string | undefined,
  style: string,
): string {
  if (style === "hidden") return "";
  if (style === "city" && city) return city;
  if (style === "state" && state) return state;
  if (style === "country" && country) return country;
  // graceful fallback order
  return city || state || country || "";
}

export function formatFreshness(purchasedAt: Date): string {
  const diffMs = Date.now() - purchasedAt.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return "a few minutes ago";
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return "recently";
}
