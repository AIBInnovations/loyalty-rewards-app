import mongoose, { type Document, type Model, Schema } from "mongoose";

export type DiscountType = "FIXED_AMOUNT" | "PERCENTAGE";

export interface IReward extends Document {
  shopId: string;
  name: string;
  pointsCost: number;
  discountType: DiscountType;
  discountValue: number; // e.g., 100 for ₹100 off, or 10 for 10% off
  minimumOrderAmount: number;
  maxUsesPerCustomer: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const rewardSchema = new Schema<IReward>(
  {
    shopId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    pointsCost: { type: Number, required: true, min: 1 },
    discountType: {
      type: String,
      enum: ["FIXED_AMOUNT", "PERCENTAGE"],
      required: true,
    },
    discountValue: { type: Number, required: true, min: 0.01 },
    minimumOrderAmount: { type: Number, default: 0 },
    maxUsesPerCustomer: { type: Number, default: 1 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export const Reward: Model<IReward> =
  mongoose.models.Reward || mongoose.model<IReward>("Reward", rewardSchema);
