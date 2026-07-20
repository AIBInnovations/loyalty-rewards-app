import mongoose, { type Document, type Model, Schema } from "mongoose";

export type TransactionType = "EARN" | "REDEEM" | "EXPIRE" | "ADJUST";

export type TransactionSource =
  | "PURCHASE"
  | "SIGNUP"
  | "REFERRAL"
  | "BIRTHDAY"
  | "SOCIAL_SHARE"
  | "CUSTOM"
  | "REDEMPTION"
  | "REFUND"
  | "EXPIRY"
  | "MANUAL"
  | "CANCELLATION";

export interface ITransaction extends Document {
  shopId: string;
  customerId: mongoose.Types.ObjectId;
  type: TransactionType;
  points: number; // positive for earn, negative for redeem/deduct
  balanceAfter: number;
  source: TransactionSource;
  referenceId?: string; // orderId, refundId, etc.
  description?: string;
  idempotencyKey?: string;
  expiresAt?: Date;
  /** Set once this EARN row has been swept by the expiry job, so it is never swept twice. */
  expiredAt?: Date;
  createdAt: Date;
}

const transactionSchema = new Schema<ITransaction>(
  {
    shopId: { type: String, required: true, index: true },
    customerId: {
      type: Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
    },
    type: {
      type: String,
      enum: ["EARN", "REDEEM", "EXPIRE", "ADJUST"],
      required: true,
    },
    points: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },
    source: {
      type: String,
      enum: [
        "PURCHASE",
        "SIGNUP",
        "REFERRAL",
        "BIRTHDAY",
        "SOCIAL_SHARE",
        "CUSTOM",
        "REDEMPTION",
        "REFUND",
        "EXPIRY",
        "MANUAL",
        "CANCELLATION",
      ],
      required: true,
    },
    referenceId: { type: String },
    description: { type: String },
    idempotencyKey: { type: String, unique: true, sparse: true },
    expiresAt: { type: Date },
    expiredAt: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

transactionSchema.index({ customerId: 1, createdAt: -1 });
transactionSchema.index({ shopId: 1, referenceId: 1 });

// Admin transactions list and dashboard both sort by createdAt within a shop.
// Without this, every list view is an in-memory sort (aborts above 32MB).
transactionSchema.index({ shopId: 1, createdAt: -1 });
transactionSchema.index({ shopId: 1, type: 1, source: 1, createdAt: -1 });

// Dashboard "total points earned" aggregate — covered index, no document fetch.
transactionSchema.index({ shopId: 1, type: 1, points: 1 });

// Nightly expiry sweep.
transactionSchema.index({ shopId: 1, type: 1, expiresAt: 1, expiredAt: 1 });

export const Transaction: Model<ITransaction> =
  mongoose.models.Transaction ||
  mongoose.model<ITransaction>("Transaction", transactionSchema);
