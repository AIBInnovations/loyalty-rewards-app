import { BundleAnalyticsDaily } from "../models/bundle.model";

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
 */
export async function attributeBundleOrder(
  shop: string,
  payload: Record<string, unknown>,
): Promise<void> {
  if (payload.test === true) return;
  if (payload.cancelled_at) return;

  const lineItems = (payload.line_items as OrderLineItem[] | undefined) || [];
  if (!lineItems.length) return;

  const date = new Date().toISOString().slice(0, 10);
  const byBundle = new Map<string, number>();

  for (const item of lineItems) {
    const bundleId = item.properties?.find((p) => p.name === "_bundle_id")?.value;
    if (!bundleId) continue;
    const lineRevenue = Math.round(parseFloat(item.price || "0") * 100) * (item.quantity || 1);
    byBundle.set(bundleId, (byBundle.get(bundleId) || 0) + lineRevenue);
  }

  if (!byBundle.size) return;

  await Promise.all(
    Array.from(byBundle.entries()).map(([bundleId, revenue]) =>
      BundleAnalyticsDaily.findOneAndUpdate(
        { shopId: shop, bundleId, date },
        { $inc: { orders: 1, revenue } },
        { upsert: true, setDefaultsOnInsert: true },
      ).catch((err) => console.error("attributeBundleOrder failed:", err)),
    ),
  );
}
