import { Customer } from "../models/customer.model";
import { Redemption } from "../models/redemption.model";
import { Transaction } from "../models/transaction.model";
import { getOrCreateSettings } from "../models/settings.model";
import {
  earnPoints,
  reversePoints,
  getNetEarnedForOrder,
} from "./points.service";

import { generateReferralCode } from "../utils/codes";
import {
  orderPaidKey,
  orderCancelledKey,
  refundKey,
  signupBonusKey,
  referralBonusKey,
} from "../utils/idempotency";

interface AdminAPI {
  graphql: (query: string, options?: { variables: Record<string, unknown> }) => Promise<{
    json: () => Promise<{ data: Record<string, unknown>; errors?: unknown[] }>;
  }>;
}

// ─── ORDERS/PAID ─────────────────────────────────────────────────

export async function handleOrderPaid(
  shop: string,
  payload: Record<string, unknown>,
  admin: AdminAPI,
): Promise<void> {
  const orderId = String(payload.id);
  const customerId = (payload.customer as Record<string, unknown>)?.id;
  if (!customerId) {
    console.log("Order has no customer, skipping points:", orderId);
    return;
  }

  const shopifyCustomerId = String(customerId);
  const settings = await getOrCreateSettings(shop);
  if (!settings.isActive) return;

  // Use subtotal_price (after discounts, before shipping/tax)
  const subtotalPrice = parseFloat(String(payload.subtotal_price || "0"));
  if (subtotalPrice <= 0) return;

  // Look up or create customer atomically (prevents duplicate key on concurrent webhooks)
  let customer = await Customer.findOneAndUpdate(
    { shopId: shop, shopifyCustomerId },
    {
      $setOnInsert: {
        shopId: shop,
        shopifyCustomerId,
        email: (payload.customer as Record<string, unknown>)?.email as string,
        firstName: (payload.customer as Record<string, unknown>)?.first_name as string,
        lastName: (payload.customer as Record<string, unknown>)?.last_name as string,
        referralCode: generateReferralCode(
          (payload.customer as Record<string, unknown>)?.first_name as string,
        ),
      },
    },
    { upsert: true, new: true },
  );

  // Calculate tier multiplier
  const tierMultiplier =
    settings.tiers.find((t) => t.name === customer!.tier)?.earningMultiplier ||
    1.0;

  // Calculate points: floor(subtotalPrice * earningRate / 100) * tierMultiplier
  const basePoints = Math.floor(
    (subtotalPrice * settings.earningRate) / 100,
  );
  const points = Math.floor(basePoints * tierMultiplier);

  if (points > 0) {
    await earnPoints({
      shopId: shop,
      shopifyCustomerId,
      points,
      source: "PURCHASE",
      referenceId: orderId,
      idempotencyKey: orderPaidKey(orderId),
      description: `Earned from order #${payload.order_number || orderId}`,
      admin,
    });
  }

  // Check if this order used a loyalty discount code -> mark redemption as USED
  const discountCodes = payload.discount_codes as Array<{ code: string }> | undefined;
  if (discountCodes?.length) {
    for (const dc of discountCodes) {
      const redemption = await Redemption.findOne({
        shopId: shop,
        discountCode: dc.code,
        status: { $in: ["CREATED", "APPLIED"] },
      });
      if (redemption) {
        redemption.status = "USED";
        redemption.orderId = orderId;
        await redemption.save();
      }
    }
  }

  // Check referral: if this is the customer's first order and they were referred
  if (customer.referredBy) {
    const orderCount = await Transaction.countDocuments({
      shopId: shop,
      customerId: customer._id,
      source: "PURCHASE",
    });

    // Only award referral bonus on the first purchase (this is the first PURCHASE transaction)
    if (orderCount <= 1) {
      // Find the referrer by referral code
      const referrer = await Customer.findOne({
        shopId: shop,
        referralCode: customer.referredBy,
      });

      if (referrer) {
        // Award bonus to referrer
        await earnPoints({
          shopId: shop,
          shopifyCustomerId: referrer.shopifyCustomerId,
          points: settings.referralBonusReferrer,
          source: "REFERRAL",
          referenceId: shopifyCustomerId,
          idempotencyKey: referralBonusKey(
            referrer.shopifyCustomerId,
            shopifyCustomerId,
          ),
          description: `Referral bonus: ${customer.firstName || "someone"} made their first purchase`,
          admin,
        });

        // Award bonus to referred customer
        await earnPoints({
          shopId: shop,
          shopifyCustomerId,
          points: settings.referralBonusReferred,
          source: "REFERRAL",
          referenceId: referrer.shopifyCustomerId,
          idempotencyKey: referralBonusKey(
            shopifyCustomerId,
            referrer.shopifyCustomerId,
          ),
          description: "Welcome referral bonus",
          admin,
        });
      }
    }
  }
}

// ─── ORDERS/CANCELLED ────────────────────────────────────────────

export async function handleOrderCancelled(
  shop: string,
  payload: Record<string, unknown>,
  admin: AdminAPI,
): Promise<void> {
  const orderId = String(payload.id);
  const customerId = (payload.customer as Record<string, unknown>)?.id;
  if (!customerId) return;

  const shopifyCustomerId = String(customerId);

  // Calculate net remaining points for this order (earned - already refunded)
  const netRemaining = await getNetEarnedForOrder(shop, orderId);
  if (netRemaining <= 0) return;

  await reversePoints({
    shopId: shop,
    shopifyCustomerId,
    points: netRemaining,
    source: "CANCELLATION",
    referenceId: orderId,
    idempotencyKey: orderCancelledKey(orderId),
    description: `Order #${payload.order_number || orderId} cancelled`,
    admin,
  });

  // Cancel any unused redemption discount codes from this order
  const redemptions = await Redemption.find({
    shopId: shop,
    orderId,
    status: { $in: ["CREATED", "APPLIED"] },
  });
  for (const redemption of redemptions) {
    redemption.status = "CANCELLED";
    await redemption.save();
  }
}

// ─── REFUNDS/CREATE ──────────────────────────────────────────────

export async function handleRefundCreate(
  shop: string,
  payload: Record<string, unknown>,
  admin: AdminAPI,
): Promise<void> {
  const refundId = String(payload.id);
  const orderId = String(payload.order_id);
  const settings = await getOrCreateSettings(shop);

  // Calculate refund amount from refund line items
  const transactions = payload.transactions as Array<{
    amount: string;
    kind: string;
  }> | undefined;
  let refundAmount = 0;
  if (transactions) {
    for (const tx of transactions) {
      if (tx.kind === "refund") {
        refundAmount += parseFloat(tx.amount || "0");
      }
    }
  }

  if (refundAmount <= 0) return;

  // Calculate points to deduct proportionally
  const pointsToDeduct = Math.floor(
    (refundAmount * settings.earningRate) / 100,
  );
  if (pointsToDeduct <= 0) return;

  // Find the customer via the order's existing transactions
  const existingTx = await Transaction.findOne({
    shopId: shop,
    referenceId: orderId,
    source: "PURCHASE",
  });
  if (!existingTx) {
    console.log("No earned points found for order:", orderId);
    return;
  }

  const customer = await Customer.findById(existingTx.customerId);
  if (!customer) return;

  await reversePoints({
    shopId: shop,
    shopifyCustomerId: customer.shopifyCustomerId,
    points: pointsToDeduct,
    source: "REFUND",
    referenceId: orderId, // use orderId so cancel handler can aggregate
    idempotencyKey: refundKey(refundId),
    description: `Refund of ₹${refundAmount} on order`,
    admin,
  });
}

// ─── CUSTOMERS/CREATE ────────────────────────────────────────────

export async function handleCustomerCreate(
  shop: string,
  payload: Record<string, unknown>,
  admin: AdminAPI,
): Promise<void> {
  const shopifyCustomerId = String(payload.id);
  const settings = await getOrCreateSettings(shop);

  // Create or find customer atomically
  await Customer.findOneAndUpdate(
    { shopId: shop, shopifyCustomerId },
    {
      $setOnInsert: {
        shopId: shop,
        shopifyCustomerId,
        email: payload.email as string,
        firstName: payload.first_name as string,
        lastName: payload.last_name as string,
        referralCode: generateReferralCode(payload.first_name as string),
        birthday: payload.birthday ? new Date(payload.birthday as string) : undefined,
      },
    },
    { upsert: true, new: true },
  );

  // Award signup bonus
  if (settings.signupBonus > 0) {
    await earnPoints({
      shopId: shop,
      shopifyCustomerId,
      points: settings.signupBonus,
      source: "SIGNUP",
      referenceId: shopifyCustomerId,
      idempotencyKey: signupBonusKey(shopifyCustomerId),
      description: "Welcome signup bonus!",
      admin,
    });
  }
}

// ─── CUSTOMERS/UPDATE ────────────────────────────────────────────

export async function handleCustomerUpdate(
  shop: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const shopifyCustomerId = String(payload.id);

  const updateFields: Record<string, unknown> = {};
  if (payload.email) updateFields.email = payload.email;
  if (payload.first_name) updateFields.firstName = payload.first_name;
  if (payload.last_name) updateFields.lastName = payload.last_name;
  if (payload.birthday) updateFields.birthday = new Date(payload.birthday as string);

  if (Object.keys(updateFields).length > 0) {
    await Customer.findOneAndUpdate(
      { shopId: shop, shopifyCustomerId },
      { $set: updateFields },
    );
  }
}

// ─── GDPR HANDLERS ──────────────────────────────────────────────

export async function handleCustomerDataRequest(
  shop: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const shopifyCustomerId = String(
    (payload.customer as Record<string, unknown>)?.id,
  );
  console.log(
    `[GDPR] Customer data request for ${shopifyCustomerId} in ${shop}`,
  );
  // In production: generate and send customer data export
}

export async function handleCustomerRedact(
  shop: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const shopifyCustomerId = String(
    (payload.customer as Record<string, unknown>)?.id,
  );

  // Delete all customer data
  const customer = await Customer.findOne({ shopId: shop, shopifyCustomerId });
  if (customer) {
    await Transaction.deleteMany({ customerId: customer._id });
    await Redemption.deleteMany({ customerId: customer._id });
    await Customer.deleteOne({ _id: customer._id });
  }

  console.log(
    `[GDPR] Customer data redacted for ${shopifyCustomerId} in ${shop}`,
  );
}

export async function handleShopRedact(
  shop: string,
): Promise<void> {
  // Delete all data for this shop (48 hours after uninstall)
  await Transaction.deleteMany({ shopId: shop });
  await Redemption.deleteMany({ shopId: shop });
  await Customer.deleteMany({ shopId: shop });
  await (await import("../models/settings.model")).Settings.deleteOne({
    shopId: shop,
  });
  await (await import("../models/reward.model")).Reward.deleteMany({
    shopId: shop,
  });

  console.log(`[GDPR] Shop data redacted for ${shop}`);
}
