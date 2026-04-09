import mongoose, { type Document, type Model, Schema } from "mongoose";

export interface IUpsellSettings extends Document {
  shopId: string;
  enabled: boolean;
  productHandle: string;
  discountPercent: number;
  headline: string;
  buttonText: string;
  primaryColor: string;
  createdAt: Date;
  updatedAt: Date;
}

const upsellSettingsSchema = new Schema<IUpsellSettings>(
  {
    shopId:          { type: String, required: true, unique: true },
    enabled:         { type: Boolean, default: false },
    productHandle:   { type: String, default: "" },
    discountPercent: { type: Number, default: 10, min: 0, max: 90 },
    headline:        { type: String, default: "Wait — grab this before you go! 🎁" },
    buttonText:      { type: String, default: "Yes! Add to my order" },
    primaryColor:    { type: String, default: "#5C6AC4" },
  },
  { timestamps: true },
);

export const UpsellSettings: Model<IUpsellSettings> =
  mongoose.models.UpsellSettings ||
  mongoose.model<IUpsellSettings>("UpsellSettings", upsellSettingsSchema);

export async function getOrCreateUpsellSettings(shopId: string): Promise<IUpsellSettings> {
  let s = await UpsellSettings.findOne({ shopId });
  if (!s) s = await UpsellSettings.create({ shopId });
  return s;
}
