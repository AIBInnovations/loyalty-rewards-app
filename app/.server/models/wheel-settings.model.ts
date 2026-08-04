import mongoose, { type Document, type Model, Schema } from "mongoose";

export interface IWheelPrize {
  label: string;
  discountType: "percentage" | "fixed_amount" | "free_shipping" | "no_prize";
  discountValue: number;
  probability: number; // 0-100, weights (don't need to sum to 100)
  color: string;
}

export interface IWheelSettings extends Document {
  shopId: string;
  enabled: boolean;
  headline: string;
  subtext: string;
  buttonText: string;
  triggerButtonText: string;
  triggerButtonColor: string;
  prizes: IWheelPrize[];
  bgColor: string;
  centerPointerColor: string;
  outerBorderColor: string;
  createdAt: Date;
  updatedAt: Date;
}

const wheelPrizeSchema = new Schema<IWheelPrize>(
  {
    label: { type: String, required: true },
    discountType: {
      type: String,
      enum: ["percentage", "fixed_amount", "free_shipping", "no_prize"],
      default: "percentage",
    },
    discountValue: { type: Number, default: 0 },
    probability: { type: Number, default: 10 },
    color: { type: String, default: "#5C6AC4" },
  },
  { _id: false },
);

const wheelSettingsSchema = new Schema<IWheelSettings>(
  {
    shopId: { type: String, required: true, unique: true },
    enabled: { type: Boolean, default: false },
    headline: { type: String, default: "Spin to Win! 🎰" },
    subtext: { type: String, default: "Enter your email for a chance to win a discount!" },
    buttonText: { type: String, default: "Try My Luck" },
    triggerButtonText: { type: String, default: "🎰 Spin & Win" },
    triggerButtonColor: { type: String, default: "#e91e63" },
    prizes: {
      type: [wheelPrizeSchema],
      default: [
        { label: "10% OFF", discountType: "percentage", discountValue: 10, probability: 20, color: "#FF6B6B" },
        { label: "Try Again", discountType: "no_prize", discountValue: 0, probability: 30, color: "#4ECDC4" },
        { label: "5% OFF", discountType: "percentage", discountValue: 5, probability: 25, color: "#45B7D1" },
        { label: "Free Ship", discountType: "free_shipping", discountValue: 0, probability: 10, color: "#96CEB4" },
        { label: "Try Again", discountType: "no_prize", discountValue: 0, probability: 30, color: "#FFEAA7" },
        { label: "₹100 OFF", discountType: "fixed_amount", discountValue: 100, probability: 5, color: "#DDA0DD" },
      ],
    },
    bgColor: { type: String, default: "#ffffff" },
    centerPointerColor: { type: String, default: "#5C6AC4" },
    outerBorderColor: { type: String, default: "#000000" },
  },
  { timestamps: true },
);

export const WheelSettings: Model<IWheelSettings> =
  mongoose.models.WheelSettings ||
  mongoose.model<IWheelSettings>("WheelSettings", wheelSettingsSchema);

export async function getOrCreateWheelSettings(shopId: string): Promise<IWheelSettings> {
  let s = await WheelSettings.findOne({ shopId });
  if (!s) s = await WheelSettings.create({ shopId });
  return s;
}
