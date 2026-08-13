import { Bundle, BundleAnalyticsDaily } from "../models/bundle.model";
import { TAGS_ADD, ORDER_UPDATE_NOTE } from "../graphql/mutations";

interface AdminAPI {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<{ json: () => Promise<{ data?: Record<string, unknown> }> }>;
}

interface OrderLineItemProperty {
  name?: string;
  value?: string;
}

interface OrderLineItem {
  properties?: OrderLineItemProperty[];
  price?: string;
  quantity?: number;
}

/**
 * Called from the ORDERS_PAID webhook. bundle-genie.js sends
 * `_bundle_id`/`_bundle_title` as line-item properties when a bundle is
 * added to cart (see extensions/loyalty-widget/assets/bundle-genie.js) —
 * this reads those properties back off the paid order to attribute real
 * order count and revenue per bundle. Fails silently so it never blocks
 * the webhook; revenue is the line item's own price × quantity, not the
 * order total, since one order can contain non-bundle items too.
 *
 * Also applies each matched bundle's own addOrderTags/addOrderNotes
 * Customize-screen settings — only when a merchant actually turned them on
 * for that specific campaign, not globally.
 */
export async function attributeBundleOrder(
  shop: string,
  payload: Record<string, unknown>,
  admin?: AdminAPI,
): Promise<void> {
  if (payload.test === true) return;
  if (payload.cancelled_at) return;

  const lineItems = (payload.line_items as OrderLineItem[] | undefined) || [];
  if (!lineItems.length) return;

  const date = new Date().toISOString().slice(0, 10);
  const byBundle = new Map<string, { revenue: number; title: string }>();

  for (const item of lineItems) {
    const bundleId = item.properties?.find((p) => p.name === "_bundle_id")?.value;
    if (!bundleId) continue;
    const title = item.properties?.find((p) => p.name === "_bundle_title")?.value || "";
    const lineRevenue = Math.round(parseFloat(item.price || "0") * 100) * (item.quantity || 1);
    const entry = byBundle.get(bundleId) || { revenue: 0, title };
    entry.revenue += lineRevenue;
    byBundle.set(bundleId, entry);
  }

  if (!byBundle.size) return;

  await Promise.all(
    Array.from(byBundle.entries()).map(([bundleId, { revenue }]) =>
      BundleAnalyticsDaily.findOneAndUpdate(
        { shopId: shop, bundleId, date },
        { $inc: { orders: 1, revenue } },
        { upsert: true, setDefaultsOnInsert: true },
      ).catch((err) => console.error("attributeBundleOrder failed:", err)),
    ),
  );

  if (admin) {
    await applyOrderTagsAndNotes(admin, payload, shop, byBundle);
  }
}

async function applyOrderTagsAndNotes(
  admin: AdminAPI,
  payload: Record<string, unknown>,
  shop: string,
  byBundle: Map<string, { revenue: number; title: string }>,
): Promise<void> {
  const orderId = payload.id;
  if (!orderId) return;

  const bundles = await Bundle.find({ shopId: shop, _id: { $in: Array.from(byBundle.keys()) } })
    .select("style title")
    .lean()
    .catch(() => []);

  const tags: string[] = [];
  const noteLines: string[] = [];
  for (const bundle of bundles) {
    if (bundle.style?.addOrderTags) tags.push(`bundle-genie:${bundle.title}`.slice(0, 40));
    if (bundle.style?.addOrderNotes) noteLines.push(`Includes Bundle Genie campaign: ${bundle.title}`);
  }
  if (!tags.length && !noteLines.length) return;

  const orderGid = `gid://shopify/Order/${orderId}`;

  try {
    if (tags.length) {
      await admin.graphql(TAGS_ADD, { variables: { id: orderGid, tags } });
    }
    if (noteLines.length) {
      const existingNote = String(payload.note || "");
      const nextNote = [existingNote, ...noteLines].filter(Boolean).join("\n");
      await admin.graphql(ORDER_UPDATE_NOTE, { variables: { input: { id: orderGid, note: nextNote } } });
    }
  } catch (err) {
    console.error("applyOrderTagsAndNotes failed:", err);
  }
}
