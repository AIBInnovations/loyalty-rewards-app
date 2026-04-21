import {
  DISCOUNT_AUTOMATIC_BASIC_CREATE,
  DISCOUNT_AUTOMATIC_BASIC_UPDATE,
  DISCOUNT_AUTOMATIC_DELETE,
} from "../graphql/mutations";
import type {
  IVolumeDiscountCampaign,
  IVolumeTier,
} from "../models/volume-discount.model";

interface AdminAPI {
  graphql: (
    query: string,
    options?: { variables: Record<string, unknown> },
  ) => Promise<{
    json: () => Promise<{ data: Record<string, unknown>; errors?: unknown[] }>;
  }>;
}

/**
 * Build the DiscountAutomaticBasicInput for one tier of a campaign.
 * Shopify picks the highest-value tier that a cart qualifies for when
 * product discounts cannot combine with each other.
 */
function buildTierInput(
  campaign: IVolumeDiscountCampaign,
  tier: IVolumeTier,
): Record<string, unknown> {
  const value =
    tier.valueType === "percentage"
      ? { percentage: tier.value / 100 }
      : {
          discountAmount: {
            amount: tier.value,
            appliesOnEachItem: false,
          },
        };

  const productIds = campaign.products
    .map((p) => p.shopifyProductId)
    .filter(Boolean);

  const items =
    campaign.scope === "all" || productIds.length === 0
      ? { all: true }
      : { products: { productsToAdd: productIds } };

  const title = `${campaign.title} — buy ${tier.minQuantity}+`;

  const input: Record<string, unknown> = {
    title,
    startsAt: new Date(campaign.startsAt || Date.now()).toISOString(),
    customerGets: {
      value,
      items,
      appliesOnOneTimePurchase: true,
    },
    minimumRequirement: {
      quantity: { greaterThanOrEqualToQuantity: String(tier.minQuantity) },
    },
    combinesWith: {
      orderDiscounts: !!campaign.combinesWithOrder,
      productDiscounts: !!campaign.combinesWithProduct,
      shippingDiscounts: !!campaign.combinesWithShipping,
    },
  };

  if (campaign.endsAt) {
    input.endsAt = new Date(campaign.endsAt).toISOString();
  }

  return input;
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
  if (!op) {
    throw new Error(`No data returned from ${resultKey}`);
  }
  if (op.userErrors && op.userErrors.length) {
    const messages = op.userErrors
      .map((e: { message: string }) => e.message)
      .join("; ");
    throw new Error(messages);
  }
  return op;
}

export async function createTierDiscount(
  admin: AdminAPI,
  campaign: IVolumeDiscountCampaign,
  tier: IVolumeTier,
): Promise<string> {
  const input = buildTierInput(campaign, tier);
  const op = await runMutation(
    admin,
    DISCOUNT_AUTOMATIC_BASIC_CREATE,
    { automaticBasicDiscount: input },
    "discountAutomaticBasicCreate",
  );
  const id = (op.automaticDiscountNode as { id?: string } | undefined)?.id;
  if (!id) throw new Error("Discount created but no ID returned");
  return id;
}

export async function updateTierDiscount(
  admin: AdminAPI,
  campaign: IVolumeDiscountCampaign,
  tier: IVolumeTier,
): Promise<string> {
  if (!tier.shopifyDiscountId) {
    return createTierDiscount(admin, campaign, tier);
  }
  const input = buildTierInput(campaign, tier);
  const op = await runMutation(
    admin,
    DISCOUNT_AUTOMATIC_BASIC_UPDATE,
    { id: tier.shopifyDiscountId, automaticBasicDiscount: input },
    "discountAutomaticBasicUpdate",
  );
  const id =
    (op.automaticDiscountNode as { id?: string } | undefined)?.id ||
    tier.shopifyDiscountId;
  return id;
}

export async function deleteDiscount(
  admin: AdminAPI,
  shopifyDiscountId: string,
): Promise<void> {
  if (!shopifyDiscountId) return;
  try {
    await runMutation(
      admin,
      DISCOUNT_AUTOMATIC_DELETE,
      { id: shopifyDiscountId },
      "discountAutomaticDelete",
    );
  } catch (err) {
    console.error("deleteDiscount failed:", err);
  }
}

/**
 * Sync a campaign's tiers to Shopify. Creates/updates/deletes automatic
 * discounts so Shopify has exactly one node per active tier. Mutates the
 * campaign's tiers in place to record returned shopifyDiscountId values.
 *
 * If the campaign is disabled, all tier discounts are deleted and their
 * IDs cleared.
 */
export async function syncCampaign(
  admin: AdminAPI,
  campaign: IVolumeDiscountCampaign,
  previousTiers: IVolumeTier[] = [],
): Promise<IVolumeTier[]> {
  const previousIds = new Set(
    previousTiers.map((t) => t.shopifyDiscountId).filter(Boolean) as string[],
  );
  const keepIds = new Set<string>();

  let resultTiers: IVolumeTier[];

  if (!campaign.enabled) {
    resultTiers = campaign.tiers.map((t) => ({ ...t, shopifyDiscountId: "" }));
  } else {
    resultTiers = [];
    for (const tier of campaign.tiers) {
      const id = tier.shopifyDiscountId
        ? await updateTierDiscount(admin, campaign, tier)
        : await createTierDiscount(admin, campaign, tier);
      keepIds.add(id);
      resultTiers.push({ ...tier, shopifyDiscountId: id });
    }
  }

  // Delete any prior Shopify discount nodes that no longer belong to a tier
  for (const prevId of previousIds) {
    if (!keepIds.has(prevId)) {
      await deleteDiscount(admin, prevId);
    }
  }

  return resultTiers;
}
