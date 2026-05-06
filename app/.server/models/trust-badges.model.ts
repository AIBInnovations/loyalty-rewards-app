import mongoose, { type Document, type Model, Schema } from "mongoose";

export interface ITrustBadge {
  icon: string;
  text: string;
}

export interface ITrustBadgesSettings extends Document {
  shopId: string;
  enabled: boolean;
  layout: "grid" | "inline";
  badges: ITrustBadge[];
  createdAt: Date;
  updatedAt: Date;
}

const trustBadgeSchema = new Schema<ITrustBadge>(
  {
    icon: { type: String, default: "" },
    text: { type: String, default: "" },
  },
  { _id: false },
);

const trustBadgesSettingsSchema = new Schema<ITrustBadgesSettings>(
  {
    shopId: { type: String, required: true, unique: true },
    enabled: { type: Boolean, default: true },
    layout: { type: String, enum: ["grid", "inline"], default: "inline" },
    badges: {
      type: [trustBadgeSchema],
      default: [
        { icon: "cod", text: "COD Available" },
        { icon: "lock", text: "UPI/Razorpay Secure" },
        { icon: "returns", text: "Easy Returns" },
        { icon: "truck", text: "Free Shipping" },
        { icon: "check", text: "100% Genuine" },
      ],
    },
  },
  { timestamps: true },
);

export const TrustBadgesSettings: Model<ITrustBadgesSettings> =
  mongoose.models.TrustBadgesSettings ||
  mongoose.model<ITrustBadgesSettings>("TrustBadgesSettings", trustBadgesSettingsSchema);

export async function getOrCreateTrustBadgesSettings(
  shopId: string,
): Promise<ITrustBadgesSettings> {
  let settings = await TrustBadgesSettings.findOne({ shopId });
  if (!settings) {
    settings = await TrustBadgesSettings.create({ shopId });
  }
  return settings;
}
