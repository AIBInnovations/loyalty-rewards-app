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
      const customer = await Customer.findOne({
        _id: redemption.customerId,
        shopId: redemption.shopId,
      });
      if (customer) {
        await Customer.updateOne(
          { _id: customer._id, shopId: redemption.shopId },
          { $inc: { currentBalance: redemption.pointsSpent } },
        );

        // Create refund transaction
        const updated = await Customer.findOne({
          _id: customer._id,
          shopId: redemption.shopId,
        });
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

    // Only sweep EARN rows past their expiry that have not already been swept.
    //
    // `expiredAt` is what makes this job safe to re-run. Previously the guard
    // looked for idempotencyKey `expire_${tx._id}` while the write used
    // `expire_batch_${custId}_${Date.now()}` — a key that is never the one
    // checked, and which can never dedupe because it embeds the current time.
    // Every nightly run therefore re-expired the same transactions until the
    // customer's balance reached zero.
    const expiredTransactions = await Transaction.find({
      shopId: shopSettings.shopId,
      type: "EARN",
      expiresAt: { $lt: new Date(), $exists: true },
      expiredAt: { $exists: false },
    }).limit(200);

    // Deduct per source transaction, so each deduction has a stable key.
    for (const tx of expiredTransactions) {
      const custId = tx.customerId.toString();
      const markSwept = () =>
        Transaction.updateOne({ _id: tx._id }, { $set: { expiredAt: new Date() } });

      if (tx.points <= 0) {
        await markSwept();
        continue;
      }

      // Clamp at zero inside the update so concurrent deductions cannot drive
      // the balance negative. Mongoose's `min: 0` does not apply to $inc.
      const updated = await Customer.findOneAndUpdate(
        { _id: custId, shopId: shopSettings.shopId },
        [
          {
            $set: {
              currentBalance: {
                $max: [0, { $subtract: ["$currentBalance", tx.points] }],
              },
            },
          },
        ],
        { new: true },
      );

      if (!updated) {
        await markSwept();
        continue;
      }

      try {
        await Transaction.create({
          shopId: shopSettings.shopId,
          customerId: custId,
          type: "EXPIRE",
          points: -tx.points,
          balanceAfter: updated.currentBalance,
          source: "EXPIRY",
          description: `${tx.points} points expired`,
          idempotencyKey: `expire_${tx._id}`,
        });
      } catch (error: unknown) {
        // Another instance already recorded this expiry — undo our deduction.
        if ((error as { code?: number }).code === 11000) {
          await Customer.updateOne(
            { _id: custId, shopId: shopSettings.shopId },
            { $inc: { currentBalance: tx.points } },
          );
        } else {
          throw error;
        }
      }

      await markSwept();
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
