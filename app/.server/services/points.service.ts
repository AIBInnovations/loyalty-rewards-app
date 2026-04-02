import mongoose from "mongoose";
import { Customer, type ICustomer } from "../models/customer.model";
import { Transaction, type TransactionSource, type TransactionType } from "../models/transaction.model";
import { Reward } from "../models/reward.model";
import { Redemption } from "../models/redemption.model";
import { Settings, type ITier } from "../models/settings.model";
import { createRedemptionDiscount } from "./discount.service";
import { syncCustomerMetafields } from "./metafield.service";

interface AdminAPI {
  graphql: (query: string, options?: { variables: Record<string, unknown> }) => Promise<{
    json: () => Promise<{ data: Record<string, unknown>; errors?: unknown[] }>;
  }>;
}

/**
 * Determine the customer's tier based on lifetime points earned.
 */
function determineTier(lifetimeEarned: number, tiers: ITier[]): string {
  const sorted = [...tiers].sort(
    (a, b) => b.minLifetimePoints - a.minLifetimePoints,
  );
  for (const tier of sorted) {
    if (lifetimeEarned >= tier.minLifetimePoints) {
      return tier.name;
    }
  }
  return tiers[0]?.name || "Bronze";
}

/**
 * Get the earning multiplier for a customer's tier.
 */
function getTierMultiplier(tierName: string, tiers: ITier[]): number {
  const tier = tiers.find((t) => t.name === tierName);
  return tier?.earningMultiplier || 1.0;
}

// ─── EARN POINTS ─────────────────────────────────────────────────

export interface EarnPointsInput {
  shopId: string;
  shopifyCustomerId: string;
  points: number;
  source: TransactionSource;
  referenceId?: string;
  idempotencyKey: string;
  description?: string;
  admin?: AdminAPI;
}

/**
 * Award points to a customer. Idempotent via idempotencyKey.
 * Returns the updated customer or null if already processed.
 */
export async function earnPoints(
  input: EarnPointsInput,
): Promise<ICustomer | null> {
  const {
    shopId,
    shopifyCustomerId,
    points,
    source,
    referenceId,
    idempotencyKey,
    description,
    admin,
  } = input;

  if (points <= 0) return null;

  // Check idempotency -- if a transaction with this key exists, skip
  const existing = await Transaction.findOne({ idempotencyKey });
  if (existing) {
    console.log(`Skipping duplicate: ${idempotencyKey}`);
    return null;
  }

  // Atomic increment on customer balance
  const customer = await Customer.findOneAndUpdate(
    { shopId, shopifyCustomerId },
    {
      $inc: {
        currentBalance: points,
        lifetimeEarned: points,
      },
    },
    { new: true },
  );

  if (!customer) {
    console.error(`Customer not found: ${shopifyCustomerId} in ${shopId}`);
    return null;
  }

  // Update tier based on new lifetime earned
  const settings = await Settings.findOne({ shopId });
  if (settings) {
    const newTier = determineTier(customer.lifetimeEarned, settings.tiers);
    if (newTier !== customer.tier) {
      customer.tier = newTier;
      await customer.save();
    }
  }

  // Create immutable transaction record
  const expiresAt =
    settings?.pointsExpiry.enabled
      ? new Date(
          Date.now() + settings.pointsExpiry.daysToExpire * 24 * 60 * 60 * 1000,
        )
      : undefined;

  await Transaction.create({
    shopId,
    customerId: customer._id,
    type: "EARN" as TransactionType,
    points,
    balanceAfter: customer.currentBalance,
    source,
    referenceId,
    description,
    idempotencyKey,
    expiresAt,
  });

  // Sync to Shopify metafields (non-blocking)
  if (admin) {
    syncCustomerMetafields(admin, shopifyCustomerId, {
      points: customer.currentBalance,
      tier: customer.tier,
      referralCode: customer.referralCode,
    }).catch((err) =>
      console.error("Metafield sync failed (earn):", err.message),
    );
  }

  return customer;
}

// ─── REDEEM POINTS ───────────────────────────────────────────────

export interface RedeemPointsInput {
  shopId: string;
  shopifyCustomerId: string;
  rewardId: string;
  admin: AdminAPI;
}

export interface RedeemPointsResult {
  discountCode: string;
  pointsSpent: number;
  newBalance: number;
}

/**
 * Redeem points for a discount code.
 * Uses atomic check-and-deduct to prevent race conditions.
 */
export async function redeemPoints(
  input: RedeemPointsInput,
): Promise<RedeemPointsResult> {
  const { shopId, shopifyCustomerId, rewardId, admin } = input;

  // Look up the reward
  const reward = await Reward.findOne({
    _id: rewardId,
    shopId,
    isActive: true,
  });
  if (!reward) {
    throw new Error("Reward not found or inactive");
  }

  // Atomic check-and-deduct: only succeeds if balance >= pointsCost
  const customer = await Customer.findOneAndUpdate(
    {
      shopId,
      shopifyCustomerId,
      currentBalance: { $gte: reward.pointsCost },
    },
    {
      $inc: {
        currentBalance: -reward.pointsCost,
        lifetimeRedeemed: reward.pointsCost,
      },
    },
    { new: true },
  );

  if (!customer) {
    throw new Error("Insufficient points or customer not found");
  }

  // Create discount code in Shopify
  const { discountCode, shopifyDiscountId } = await createRedemptionDiscount(
    admin,
    {
      shopifyCustomerId,
      discountType: reward.discountType,
      discountValue: reward.discountValue,
      minimumOrderAmount: reward.minimumOrderAmount,
      title: `Loyalty: ${reward.name}`,
    },
  );

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  // Create redemption record
  await Redemption.create({
    shopId,
    customerId: customer._id,
    rewardId: reward._id,
    pointsSpent: reward.pointsCost,
    discountCode,
    shopifyDiscountId,
    status: "CREATED",
    expiresAt,
  });

  // Create transaction record
  await Transaction.create({
    shopId,
    customerId: customer._id,
    type: "REDEEM" as TransactionType,
    points: -reward.pointsCost,
    balanceAfter: customer.currentBalance,
    source: "REDEMPTION",
    referenceId: discountCode,
    description: `Redeemed for ${reward.name}`,
  });

  // Sync metafields (non-blocking)
  syncCustomerMetafields(admin, shopifyCustomerId, {
    points: customer.currentBalance,
    tier: customer.tier,
    referralCode: customer.referralCode,
  }).catch((err) =>
    console.error("Metafield sync failed (redeem):", err.message),
  );

  return {
    discountCode,
    pointsSpent: reward.pointsCost,
    newBalance: customer.currentBalance,
  };
}

// ─── REVERSE POINTS ──────────────────────────────────────────────

export interface ReversePointsInput {
  shopId: string;
  shopifyCustomerId: string;
  points: number;
  source: TransactionSource;
  referenceId: string;
  idempotencyKey: string;
  description?: string;
  admin?: AdminAPI;
}

/**
 * Reverse previously earned points (for refunds/cancellations).
 * Prevents balance from going below 0.
 */
export async function reversePoints(
  input: ReversePointsInput,
): Promise<ICustomer | null> {
  const {
    shopId,
    shopifyCustomerId,
    points,
    source,
    referenceId,
    idempotencyKey,
    description,
    admin,
  } = input;

  if (points <= 0) return null;

  // Check idempotency
  const existing = await Transaction.findOne({ idempotencyKey });
  if (existing) {
    console.log(`Skipping duplicate reversal: ${idempotencyKey}`);
    return null;
  }

  // Atomic deduct, but don't go below 0
  // Use $max to ensure currentBalance doesn't go negative
  const customer = await Customer.findOne({ shopId, shopifyCustomerId });
  if (!customer) return null;

  const actualDeduction = Math.min(points, customer.currentBalance);
  if (actualDeduction <= 0) return customer;

  const updated = await Customer.findOneAndUpdate(
    { shopId, shopifyCustomerId },
    { $inc: { currentBalance: -actualDeduction } },
    { new: true },
  );

  if (!updated) return null;

  await Transaction.create({
    shopId,
    customerId: updated._id,
    type: "ADJUST" as TransactionType,
    points: -actualDeduction,
    balanceAfter: updated.currentBalance,
    source,
    referenceId,
    description: description || `Reversed ${actualDeduction} points`,
    idempotencyKey,
  });

  // Sync metafields
  if (admin) {
    syncCustomerMetafields(admin, shopifyCustomerId, {
      points: updated.currentBalance,
      tier: updated.tier,
      referralCode: updated.referralCode,
    }).catch((err) =>
      console.error("Metafield sync failed (reverse):", err.message),
    );
  }

  return updated;
}

// ─── GET BALANCE ─────────────────────────────────────────────────

export interface CustomerBalance {
  currentBalance: number;
  lifetimeEarned: number;
  lifetimeRedeemed: number;
  tier: string;
  referralCode: string;
  nextTier: { name: string; pointsNeeded: number } | null;
}

export async function getBalance(
  shopId: string,
  shopifyCustomerId: string,
): Promise<CustomerBalance | null> {
  const customer = await Customer.findOne({ shopId, shopifyCustomerId });
  if (!customer) return null;

  const settings = await Settings.findOne({ shopId });
  const tiers = settings?.tiers || [];

  // Find next tier
  const sortedTiers = [...tiers].sort(
    (a, b) => a.minLifetimePoints - b.minLifetimePoints,
  );
  let nextTier: { name: string; pointsNeeded: number } | null = null;
  for (const tier of sortedTiers) {
    if (tier.minLifetimePoints > customer.lifetimeEarned) {
      nextTier = {
        name: tier.name,
        pointsNeeded: tier.minLifetimePoints - customer.lifetimeEarned,
      };
      break;
    }
  }

  return {
    currentBalance: customer.currentBalance,
    lifetimeEarned: customer.lifetimeEarned,
    lifetimeRedeemed: customer.lifetimeRedeemed,
    tier: customer.tier,
    referralCode: customer.referralCode,
    nextTier,
  };
}

// ─── GET NET EARNED FOR ORDER ────────────────────────────────────

/**
 * Calculate the net remaining points for an order after any prior refund deductions.
 * Used by the ORDERS_CANCELLED handler to avoid double-deduction.
 */
export async function getNetEarnedForOrder(
  shopId: string,
  orderId: string,
): Promise<number> {
  const transactions = await Transaction.find({
    shopId,
    referenceId: orderId,
  });

  let net = 0;
  for (const tx of transactions) {
    net += tx.points; // earn is positive, refund deductions are negative
  }
  return Math.max(0, net);
}
