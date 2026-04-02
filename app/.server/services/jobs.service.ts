import cron from "node-cron";
import { Customer } from "../models/customer.model";
import { Transaction } from "../models/transaction.model";
import { Redemption } from "../models/redemption.model";
import { Settings } from "../models/settings.model";
import { earnPoints } from "./points.service";
import { birthdayBonusKey } from "../utils/idempotency";
import { connectDB } from "../../db.server";

/**
 * Initialize all background jobs.
 * Call this once on server startup.
 */
export function initBackgroundJobs(): void {
  console.log("Initializing background jobs...");

  // ─── Expired Redemption Cleanup (every hour) ──────────────────
  cron.schedule("0 * * * *", async () => {
    try {
      await connectDB();
      await cleanupExpiredRedemptions();
    } catch (err) {
      console.error("Expired redemption cleanup failed:", err);
    }
  });

  // ─── Points Expiry (daily at 2 AM) ────────────────────────────
  cron.schedule("0 2 * * *", async () => {
    try {
      await connectDB();
      await expireOldPoints();
    } catch (err) {
      console.error("Points expiry job failed:", err);
    }
  });

  // ─── Birthday Bonus (daily at 8 AM) ───────────────────────────
  cron.schedule("0 8 * * *", async () => {
    try {
      await connectDB();
      await awardBirthdayBonuses();
    } catch (err) {
      console.error("Birthday bonus job failed:", err);
    }
  });

  console.log("Background jobs initialized.");
}

// ─── EXPIRED REDEMPTION CLEANUP ──────────────────────────────────

async function cleanupExpiredRedemptions(): Promise<void> {
  const expiredRedemptions = await Redemption.find({
    status: "CREATED",
    expiresAt: { $lt: new Date() },
  }).limit(100); // Process in batches

  let refundedCount = 0;

  for (const redemption of expiredRedemptions) {
    try {
      // Refund points to customer
      const customer = await Customer.findById(redemption.customerId);
      if (customer) {
        await Customer.findByIdAndUpdate(customer._id, {
          $inc: { currentBalance: redemption.pointsSpent },
        });

        // Create refund transaction
        const updated = await Customer.findById(customer._id);
        await Transaction.create({
          shopId: redemption.shopId,
          customerId: customer._id,
          type: "ADJUST",
          points: redemption.pointsSpent,
          balanceAfter: updated?.currentBalance || 0,
          source: "EXPIRY",
          referenceId: redemption.discountCode,
          description: `Refund for expired discount code ${redemption.discountCode}`,
          idempotencyKey: `expired_refund_${redemption.discountCode}`,
        });

        refundedCount++;
      }

      // Mark redemption as expired
      redemption.status = "EXPIRED";
      await redemption.save();

      // Note: We'd ideally delete the Shopify discount code here too,
      // but we don't have the admin API context in background jobs.
      // The code will auto-expire in Shopify since we set endsAt.
    } catch (err) {
      console.error(
        `Failed to cleanup redemption ${redemption.discountCode}:`,
        err,
      );
    }
  }

  if (refundedCount > 0) {
    console.log(`Cleaned up ${refundedCount} expired redemptions`);
  }
}

// ─── POINTS EXPIRY ───────────────────────────────────────────────

async function expireOldPoints(): Promise<void> {
  // Find all shops with expiry enabled
  const shops = await Settings.find({ "pointsExpiry.enabled": true });

  for (const shopSettings of shops) {
    const expiryDate = new Date(
      Date.now() -
        shopSettings.pointsExpiry.daysToExpire * 24 * 60 * 60 * 1000,
    );

    // Find earned transactions that have expired and haven't been expired yet
    const expiredTransactions = await Transaction.find({
      shopId: shopSettings.shopId,
      type: "EARN",
      expiresAt: { $lt: new Date(), $exists: true },
    }).limit(200);

    // Group by customer
    const customerPoints = new Map<string, number>();
    for (const tx of expiredTransactions) {
      const custId = tx.customerId.toString();
      // Check if already expired (look for matching expiry transaction)
      const alreadyExpired = await Transaction.exists({
        idempotencyKey: `expire_${tx._id}`,
      });
      if (!alreadyExpired) {
        customerPoints.set(
          custId,
          (customerPoints.get(custId) || 0) + tx.points,
        );
      }
    }

    // Deduct expired points from each customer
    for (const [custId, points] of customerPoints) {
      const customer = await Customer.findById(custId);
      if (!customer || points <= 0) continue;

      const actualDeduction = Math.min(points, customer.currentBalance);
      if (actualDeduction <= 0) continue;

      await Customer.findByIdAndUpdate(custId, {
        $inc: { currentBalance: -actualDeduction },
      });

      const updated = await Customer.findById(custId);
      await Transaction.create({
        shopId: shopSettings.shopId,
        customerId: custId,
        type: "EXPIRE",
        points: -actualDeduction,
        balanceAfter: updated?.currentBalance || 0,
        source: "EXPIRY",
        description: `${actualDeduction} points expired`,
        idempotencyKey: `expire_batch_${custId}_${Date.now()}`,
      });
    }
  }
}

// ─── BIRTHDAY BONUSES ────────────────────────────────────────────

async function awardBirthdayBonuses(): Promise<void> {
  const today = new Date();
  const month = today.getMonth() + 1;
  const day = today.getDate();
  const year = today.getFullYear();

  // Find all shops with birthday bonus configured
  const shops = await Settings.find({ birthdayBonus: { $gt: 0 } });

  for (const shopSettings of shops) {
    // Find customers whose birthday is today and haven't received bonus this year
    const customers = await Customer.find({
      shopId: shopSettings.shopId,
      birthday: { $exists: true },
      $expr: {
        $and: [
          { $eq: [{ $month: "$birthday" }, month] },
          { $eq: [{ $dayOfMonth: "$birthday" }, day] },
        ],
      },
      $or: [
        { birthdayBonusLastAwarded: { $exists: false } },
        {
          birthdayBonusLastAwarded: {
            $lt: new Date(`${year}-01-01`),
          },
        },
      ],
    });

    for (const customer of customers) {
      try {
        const result = await earnPoints({
          shopId: shopSettings.shopId,
          shopifyCustomerId: customer.shopifyCustomerId,
          points: shopSettings.birthdayBonus,
          source: "BIRTHDAY",
          referenceId: `birthday_${year}`,
          idempotencyKey: birthdayBonusKey(
            customer.shopifyCustomerId,
            year,
          ),
          description: `Happy Birthday! 🎂 ${shopSettings.birthdayBonus} bonus points`,
        });

        if (result) {
          customer.birthdayBonusLastAwarded = today;
          await customer.save();
          console.log(
            `Birthday bonus awarded to ${customer.email || customer.shopifyCustomerId}`,
          );
        }
      } catch (err) {
        console.error(
          `Failed to award birthday bonus to ${customer.shopifyCustomerId}:`,
          err,
        );
      }
    }
  }
}
