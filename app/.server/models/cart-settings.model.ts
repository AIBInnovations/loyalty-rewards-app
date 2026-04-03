import mongoose, { type Document, type Model, Schema } from "mongoose";

export type CartTierType = "amount" | "items";
export type CartDiscountType = "percentage" | "fixed_amount" | "free_shipping" | "none";

export interface ICartTier {
  threshold: number;
  type: CartTierType;
  discountType: CartDiscountType;
  discountValue: number;
  label: string;
  belowMessage: string;
  reachedMessage: string;
}

export type RecommendationMode = "auto" | "manual";

export interface IManualProduct {
  shopifyProductId: string;
  title: string;
  handle: string;
  imageUrl: string;
  price: number;
  compareAtPrice?: number;
  variantId: string;
}

export interface ICartDrawerSettings extends Document {
  shopId: string;
  enabled: boolean;
  tiers: ICartTier[];
  showRecommendations: boolean;
  recommendationsTitle: string;
  recommendationsCount: number;
  recommendationMode: RecommendationMode;
  manualProducts: IManualProduct[];
  showSavings: boolean;
  checkoutButtonText: string;
  prepaidBannerText: string;
  showPrepaidBanner: boolean;
  primaryColor: string;
  interceptAddToCart: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const cartTierSchema = new Schema<ICartTier>(
  {
    threshold: { type: Number, required: true },
    type: { type: String, enum: ["amount", "items"], default: "items" },
    discountType: {
      type: String,
      enum: ["percentage", "fixed_amount", "free_shipping", "none"],
      default: "percentage",
    },
    discountValue: { type: Number, default: 0 },
    label: { type: String, default: "FLAT 5% OFF" },
    belowMessage: { type: String, default: "Add {remaining} more to get {label}" },
    reachedMessage: { type: String, default: "{label} unlocked!" },
  },
  { _id: false },
);

const cartDrawerSettingsSchema = new Schema<ICartDrawerSettings>(
  {
    shopId: { type: String, required: true, unique: true },
    enabled: { type: Boolean, default: false },
    tiers: {
      type: [cartTierSchema],
      default: [
        {
          threshold: 1,
          type: "items",
          discountType: "percentage",
          discountValue: 5,
          label: "FLAT 5% OFF",
          belowMessage: "Add {remaining} more item to get {label}",
          reachedMessage: "{label} unlocked!",
        },
        {
          threshold: 2,
          type: "items",
          discountType: "percentage",
          discountValue: 10,
          label: "FLAT 10% OFF",
          belowMessage: "Add {remaining} more to get {label}",
          reachedMessage: "{label} unlocked!",
        },
        {
          threshold: 3,
          type: "items",
          discountType: "fixed_amount",
          discountValue: 999,
          label: "FLAT ₹999",
          belowMessage: "Add {remaining} more to buy 3 @ ₹999",
          reachedMessage: "Buy 3 @ ₹999 unlocked!",
        },
      ],
    },
    showRecommendations: { type: Boolean, default: true },
    recommendationsTitle: { type: String, default: "People Also Bought" },
    recommendationsCount: { type: Number, default: 4, min: 2, max: 8 },
    recommendationMode: { type: String, enum: ["auto", "manual"], default: "auto" },
    manualProducts: {
      type: [{
        shopifyProductId: { type: String, required: true },
        title: { type: String },
        handle: { type: String },
        imageUrl: { type: String },
        price: { type: Number },
        compareAtPrice: { type: Number },
        variantId: { type: String },
      }],
      default: [],
    },
    showSavings: { type: Boolean, default: true },
    checkoutButtonText: { type: String, default: "CHECKOUT" },
    prepaidBannerText: { type: String, default: "5% Off on Prepaid Orders!" },
    showPrepaidBanner: { type: Boolean, default: true },
    primaryColor: { type: String, default: "#5C6AC4" },
    interceptAddToCart: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export const CartDrawerSettings: Model<ICartDrawerSettings> =
  mongoose.models.CartDrawerSettings ||
  mongoose.model<ICartDrawerSettings>("CartDrawerSettings", cartDrawerSettingsSchema);

export async function getOrCreateCartSettings(
  shopId: string,
): Promise<ICartDrawerSettings> {
  let settings = await CartDrawerSettings.findOne({ shopId });
  if (!settings) {
    settings = await CartDrawerSettings.create({ shopId });
  }
  return settings;
}
