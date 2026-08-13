import {
  DISCOUNT_AUTOMATIC_BASIC_CREATE,
  DISCOUNT_AUTOMATIC_BASIC_UPDATE,
  DISCOUNT_AUTOMATIC_DELETE,
} from "../graphql/mutations";
import type { IBundle, IBundleVersion } from "../models/bundle.model";

interface AdminAPI {
  graphql: (
    query: string,
    options?: { variables: Record<string, unknown> },
  ) => Promise<{
    json: () => Promise<{ data: Record<string, unknown>; errors?: unknown[] }>;
  }>;
}

/**
 * Real, server-side price enforcement for a published bundle version — same
 * discountAutomaticBasicCreate mechanism Volume Discounts already uses in
 * this codebase (see volume-discount.service.ts), not a client-side-only
 * number the storefront widget could be tricked into trusting.
 *
 * Approximation, stated plainly: Shopify's automatic-discount minimum
 * requirement is "total quantity across these product IDs >= N", not "one
 * of each of these N specific products" — a customer buying N units of a
 * single bundle product also qualifies. Same limitation Volume Discounts
 * already has; a precise "all-of-these" requirement needs a Discount
 * Function (not built — see Bundle Genie overview page's setup status).
 */
function buildDiscountInput(
  bundle: Pick<IBundle, "title"> & { style?: { discountPrefix?: string; discountSuffix?: string } },
  version: IBundleVersion,
): Record<string, unknown> | null {
  if (version.discountType === "none" || version.discountValue <= 0) return null;

  const productIds = version.products.map((p) => p.shopifyProductId).filter(Boolean);
  if (productIds.length === 0) return null;

  let value: Record<string, unknown>;
  if (version.discountType === "percentage") {
    value = { percentage: Math.min(version.discountValue, 100) / 100 };
  } else if (version.discountType === "fixed_amount") {
    value = { discountAmount: { amount: version.discountValue / 100, appliesOnEachItem: false } };
  } else {
    // fixed_price: approximate as a fixed discount off the sum of component
    // prices, since DiscountAutomaticBasic doesn't support "set the total
    // to exactly X" directly.
    const subtotal = version.products.reduce(
      (sum, p) => sum + p.price * (p.defaultQuantity || 1),
      0,
    );
    const targetPrice = version.discountValue; // already in minor units from the form
    const amountOff = Math.max(0, subtotal - targetPrice);
    if (amountOff <= 0) return null;
    value = { discountAmount: { amount: amountOff / 100, appliesOnEachItem: false } };
  }

  const prefix = bundle.style?.discountPrefix ? bundle.style.discountPrefix.trim() + " " : "Bundle Genie — ";
  const suffix = bundle.style?.discountSuffix ? " " + bundle.style.discountSuffix.trim() : "";

  return {
    title: `${prefix}${bundle.title} (v${version.version})${suffix}`,
    startsAt: new Date().toISOString(),
    customerGets: {
      value,
      items: { products: { productsToAdd: productIds } },
      appliesOnOneTimePurchase: true,
    },
    minimumRequirement: {
      quantity: { greaterThanOrEqualToQuantity: String(productIds.length) },
    },
    combinesWith: {
      orderDiscounts: false,
      productDiscounts: false,
      shippingDiscounts: true,
    },
  };
}

async function runMutation(
  admin: AdminAPI,
  query: string,
  variables: Record<string, unknown>,
  resultKey: string,
): Promise<Record<string, unknown>> {
  const response = await admin.graphql(query, { variables });
  const result = await response.json();
  const payload = (result.data || {}) as Record<string, any>;
  const op = payload[resultKey];
  if (!op) throw new Error(`No data returned from ${resultKey}`);
  if (op.userErrors && op.userErrors.length) {
    const messages = op.userErrors.map((e: { message: string }) => e.message).join("; ");
    throw new Error(messages);
  }
  return op;
}

/**
 * Creates (or updates, if a previous version already had one) the automatic
 * discount for a newly-published bundle version. Returns the Shopify
 * discount node ID to store on that version, or "" if this version has no
 * discount (discountType "none") or the sync failed — callers should treat
 * "" as "this version isn't price-enforced server-side yet" rather than
 * silently treating the client-displayed price as authoritative.
 */
export async function syncBundleVersionDiscount(
  admin: AdminAPI,
  bundle: Pick<IBundle, "title"> & { style?: { discountPrefix?: string; discountSuffix?: string } },
  version: IBundleVersion,
  previousShopifyDiscountId?: string,
): Promise<string> {
  const input = buildDiscountInput(bundle, version);

  if (!input) {
    if (previousShopifyDiscountId) {
      await deleteBundleDiscount(admin, previousShopifyDiscountId);
    }
    return "";
  }

  try {
    if (previousShopifyDiscountId) {
      const op = await runMutation(
        admin,
        DISCOUNT_AUTOMATIC_BASIC_UPDATE,
        { id: previousShopifyDiscountId, automaticBasicDiscount: input },
        "discountAutomaticBasicUpdate",
      );
      return (op.automaticDiscountNode as { id?: string } | undefined)?.id || previousShopifyDiscountId;
    }
    const op = await runMutation(
      admin,
      DISCOUNT_AUTOMATIC_BASIC_CREATE,
      { automaticBasicDiscount: input },
      "discountAutomaticBasicCreate",
    );
    return (op.automaticDiscountNode as { id?: string } | undefined)?.id || "";
  } catch (err) {
    console.error("syncBundleVersionDiscount failed:", err);
    return "";
  }
}

export async function deleteBundleDiscount(admin: AdminAPI, shopifyDiscountId: string): Promise<void> {
  if (!shopifyDiscountId) return;
  try {
    await runMutation(admin, DISCOUNT_AUTOMATIC_DELETE, { id: shopifyDiscountId }, "discountAutomaticDelete");
  } catch (err) {
    console.error("deleteBundleDiscount failed:", err);
  }
}
