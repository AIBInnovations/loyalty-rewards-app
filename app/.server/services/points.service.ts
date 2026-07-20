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

  const existingCustomer = await Customer.findOne({ shopId, shopifyCustomerId });
  if (!existingCustomer) {
    console.error(`Customer not found: ${shopifyCustomerId} in ${shopId}`);
    return null;
  }

  const settings = await Settings.findOne({ shopId });
  const expiresAt =
    settings?.pointsExpiry.enabled
      ? new Date(
          Date.now() + settings.pointsExpiry.daysToExpire * 24 * 60 * 60 * 1000,
        )
      : undefined;

  // Claim the idempotency key BEFORE touching the balance.
  //
  // Shopify retries orders/paid aggressively. With the old check-then-increment
  // ordering, two concurrent deliveries both passed the findOne check and both
  // incremented, then the second Transaction.create failed on the unique index —
  // leaving the balance double-credited with only one transaction row.
  // Inserting first lets the unique index act as the lock.
  // balanceAfter is backfilled once the increment lands.
  let transaction;
  try {
    transaction = await Transaction.create({
      shopId,
      customerId: existingCustomer._id,
      type: "EARN" as TransactionType,
      points,
      balanceAfter: 0,
      source,
      referenceId,
      description,
      idempotencyKey,
      expiresAt,
    });
  } catch (error: unknown) {
    if ((error as { code?: number }).code === 11000) {
      console.log(`Skipping duplicate: ${idempotencyKey}`);
      return null;
    }
    throw error;
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
    // Customer vanished between the read and the increment — release the key so
    // a retry can succeed rather than being swallowed as a duplicate.
    await Transaction.deleteOne({ _id: transaction._id });
    console.error(`Customer not found: ${shopifyCustomerId} in ${shopId}`);
    return null;
  }

  await Transaction.updateOne(
    { _id: transaction._id },
    { $set: { balanceAfter: customer.currentBalance } },
  );

  // Update tier. Use a targeted $set rather than customer.save(), which would
  // write back a stale currentBalance and discard concurrent increments.
  if (settings) {
    const newTier = determineTier(customer.lifetimeEarned, settings.tiers);
    if (newTier !== customer.tier) {
      await Customer.updateOne(
        { _id: customer._id, shopId },
        { $set: { tier: newTier } },
      );
      customer.tier = newTier;
    }
  }

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
/**
 * Give back points deducted for a redemption that then failed. Writes a
 * compensating ADJUST row so the ledger reconciles against the balance.
 */
async function refundRedemption(
  customerId: unknown,
  shopId: string,
  points: number,
  reason: string,
): Promise<void> {
  try {
    const restored = await Customer.findOneAndUpdate(
      { _id: customerId, shopId },
      { $inc: { currentBalance: points, lifetimeRedeemed: -points } },
      { new: true },
    );
    await Transaction.create({
      shopId,
      customerId,
      type: "ADJUST" as TransactionType,
      points,
      balanceAfter: restored?.currentBalance ?? 0,
      source: "REDEMPTION",
      description: `Redemption failed (${reason}) — points restored`,
    });
  } catch (err) {
    // Never mask the original failure; this path is best-effort and loud.
    console.error("CRITICAL: failed to restore points after redemption failure", {
      customerId,
      shopId,
      points,
      reason,
      err,
    });
  }
}

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

  // Enforce the per-customer cap, which the schema declared but nothing read.
  if (reward.maxUsesPerCustomer && reward.maxUsesPerCustomer > 0) {
    const usedCount = await Redemption.countDocuments({
      shopId,
      customerId: customer._id,
      rewardId: reward._id,
    });
    if (usedCount >= reward.maxUsesPerCustomer) {
      await refundRedemption(customer._id, shopId, reward.pointsCost, "cap");
      throw new Error(
        "You have already redeemed this reward the maximum number of times",
      );
    }
  }

  // Everything past this point can fail against Shopify's API, so any failure
  // must give the points back. Previously a throttled or errored discount call
  // left the points deducted with no discount and no audit row to reconcile from.
  let discountCode: string;
  let shopifyDiscountId: string;
  try {
    ({ discountCode, shopifyDiscountId } = await createRedemptionDiscount(admin, {
      shopifyCustomerId,
      discountType: reward.discountType,
      discountValue: reward.discountValue,
      minimumOrderAmount: reward.minimumOrderAmount,
      title: `Loyalty: ${reward.name}`,
    }));
  } catch (error) {
    await refundRedemption(customer._id, shopId, reward.pointsCost, "discount-failed");
    throw error;
  }

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  try {
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
      idempotencyKey: `redeem_${discountCode}`,
    });
  } catch (error) {
    await refundRedemption(customer._id, shopId, reward.pointsCost, "ledger-failed");
    throw error;
  }

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

  const customer = await Customer.findOne({ shopId, shopifyCustomerId });
  if (!customer) return null;

  // Claim the idempotency key first — same reasoning as earnPoints. The old
  // check-then-write ordering let concurrent refunds both pass the check.
  let transaction;
  try {
    transaction = await Transaction.create({
      shopId,
      customerId: customer._id,
      type: "ADJUST" as TransactionType,
      points: 0,
      balanceAfter: 0,
      source,
      referenceId,
      description: description || `Reversed ${points} points`,
      idempotencyKey,
    });
  } catch (error: unknown) {
    if ((error as { code?: number }).code === 11000) {
      console.log(`Skipping duplicate reversal: ${idempotencyKey}`);
      return null;
    }
    throw error;
  }

  // Clamp inside the update. Reading the balance, computing min(), then
  // decrementing let two concurrent refunds each deduct the full amount and
  // drive the balance negative — Mongoose's `min: 0` does not apply to $inc.
  const balanceBefore = customer.currentBalance;
  const updated = await Customer.findOneAndUpdate(
    { shopId, shopifyCustomerId },
    [
      {
        $set: {
          currentBalance: {
            $max: [0, { $subtract: ["$currentBalance", points] }],
          },
        },
      },
    ],
    { new: true },
  );

  if (!updated) {
    await Transaction.deleteOne({ _id: transaction._id });
    return null;
  }

  const actualDeduction = Math.max(0, balanceBefore - updated.currentBalance);

  await Transaction.updateOne(
    { _id: transaction._id },
    {
      $set: {
        points: -actualDeduction,
        balanceAfter: updated.currentBalance,
        description: description || `Reversed ${actualDeduction} points`,
      },
    },
  );

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
