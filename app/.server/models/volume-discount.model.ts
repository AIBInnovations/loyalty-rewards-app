import mongoose, { type Document, type Model, Schema } from "mongoose";

export type VolumeDiscountValueType = "percentage" | "fixed_amount";
export type VolumeDiscountScope = "products" | "collections" | "all";

export interface IVolumeTier {
  minQuantity: number;
  valueType: VolumeDiscountValueType;
  value: number;
  label: string;
  shopifyDiscountId?: string;
}

export interface IVolumeTargetProduct {
  shopifyProductId: string;
  title: string;
  handle: string;
  imageUrl?: string;
  price?: number;
}

export interface IVolumeDiscountCampaign {
  _id?: mongoose.Types.ObjectId;
  id?: string;
  title: string;
  enabled: boolean;
  scope: VolumeDiscountScope;
  products: IVolumeTargetProduct[];
  tiers: IVolumeTier[];
  startsAt?: Date | null;
  endsAt?: Date | null;
  combinesWithShipping: boolean;
  combinesWithOrder: boolean;
  combinesWithProduct: boolean;
  badgeText: string;
  showOnProductPage: boolean;
  showInCart: boolean;
  primaryColor: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IVolumeDiscountSettings extends Document {
  shopId: string;
  campaigns: IVolumeDiscountCampaign[];
  createdAt: Date;
  updatedAt: Date;
}

const tierSchema = new Schema<IVolumeTier>(
  {
    minQuantity: { type: Number, required: true, min: 1 },
    valueType: {
      type: String,
      enum: ["percentage", "fixed_amount"],
      default: "percentage",
    },
    value: { type: Number, required: true, min: 0 },
    label: { type: String, default: "" },
    shopifyDiscountId: { type: String, default: "" },
  },
  { _id: false },
);

const productSchema = new Schema<IVolumeTargetProduct>(
  {
    shopifyProductId: { type: String, required: true },
    title: { type: String, default: "" },
    handle: { type: String, default: "" },
    imageUrl: { type: String, default: "" },
    price: { type: Number, default: 0 },
  },
  { _id: false },
);

const campaignSchema = new Schema<IVolumeDiscountCampaign>(
  {
    title: { type: String, required: true },
    enabled: { type: Boolean, default: false },
    scope: {
      type: String,
      enum: ["products", "collections", "all"],
      default: "products",
    },
    products: { type: [productSchema], default: [] },
    tiers: {
      type: [tierSchema],
      default: [
        { minQuantity: 2, valueType: "percentage", value: 5, label: "Buy 2, save 5%" },
        { minQuantity: 3, valueType: "percentage", value: 10, label: "Buy 3, save 10%" },
        { minQuantity: 5, valueType: "percentage", value: 15, label: "Buy 5, save 15%" },
      ],
    },
    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null },
    combinesWithShipping: { type: Boolean, default: true },
    combinesWithOrder: { type: Boolean, default: false },
    combinesWithProduct: { type: Boolean, default: false },
    badgeText: { type: String, default: "Volume Discount" },
    showOnProductPage: { type: Boolean, default: true },
    showInCart: { type: Boolean, default: true },
    primaryColor: { type: String, default: "#5C6AC4" },
  },
  { timestamps: true },
);

const volumeDiscountSettingsSchema = new Schema<IVolumeDiscountSettings>(
  {
    shopId: { type: String, required: true, unique: true },
    campaigns: { type: [campaignSchema], default: [] },
  },
  { timestamps: true },
);

export const VolumeDiscountSettings: Model<IVolumeDiscountSettings> =
  mongoose.models.VolumeDiscountSettings ||
  mongoose.model<IVolumeDiscountSettings>(
    "VolumeDiscountSettings",
    volumeDiscountSettingsSchema,
  );

export async function getOrCreateVolumeDiscountSettings(
  shopId: string,
): Promise<IVolumeDiscountSettings> {
  let settings = await VolumeDiscountSettings.findOne({ shopId });
  if (!settings) {
    settings = await VolumeDiscountSettings.create({ shopId, campaigns: [] });
  }
  return settings;
}
