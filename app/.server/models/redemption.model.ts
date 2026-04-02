import mongoose, { type Document, type Model, Schema } from "mongoose";

export type RedemptionStatus =
  | "CREATED"
  | "APPLIED"
  | "USED"
  | "EXPIRED"
  | "CANCELLED";

export interface IRedemption extends Document {
  shopId: string;
  customerId: mongoose.Types.ObjectId;
  rewardId: mongoose.Types.ObjectId;
  pointsSpent: number;
  discountCode: string;
  shopifyDiscountId?: string; // GID from discountCodeBasicCreate
  status: RedemptionStatus;
  orderId?: string; // filled when the discount code is used in an order
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const redemptionSchema = new Schema<IRedemption>(
  {
    shopId: { type: String, required: true, index: true },
    customerId: {
      type: Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
    },
    rewardId: {
      type: Schema.Types.ObjectId,
      ref: "Reward",
      required: true,
    },
    pointsSpent: { type: Number, required: true },
    discountCode: { type: String, required: true, unique: true },
    shopifyDiscountId: { type: String },
    status: {
      type: String,
      enum: ["CREATED", "APPLIED", "USED", "EXPIRED", "CANCELLED"],
      default: "CREATED",
    },
    orderId: { type: String },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

redemptionSchema.index({ customerId: 1, status: 1 });
// discountCode index already created by `unique: true` above
redemptionSchema.index({ status: 1, expiresAt: 1 }); // for expired cleanup job

export const Redemption: Model<IRedemption> =
  mongoose.models.Redemption ||
  mongoose.model<IRedemption>("Redemption", redemptionSchema);
