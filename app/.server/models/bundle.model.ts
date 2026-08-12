import mongoose, { type Document, type Model, Schema } from "mongoose";

/**
 * Bundle Genie — Milestone 1 (foundation) data model.
 *
 * Only "fixed_product" is fully wired end to end in this milestone (create,
 * edit, publish, storefront-ready pricing). The other types are listed so
 * the schema doesn't need a breaking migration later, but the UI only
 * offers Fixed Product Bundle for now — do not assume the others work.
 */
export type BundleType =
  | "fixed_product"
  | "offer_tiers"
  | "fixed_price"
  | "byob"
  | "mix_match"
  | "variable"
  | "step"
  | "routine"
  | "buy_any_x"
  | "category"
  | "frequently_bought"
  | "personalized"
  | "custom"
  | "upsell";

export type BundleStatus = "draft" | "active" | "scheduled" | "paused" | "expired" | "archived";
export type BundleDiscountType = "percentage" | "fixed_amount" | "fixed_price" | "none";

export interface IBundleProduct {
  shopifyProductId: string;
  shopifyVariantId?: string;
  title: string;
  handle: string;
  imageUrl: string;
  price: number; // minor units (paise/cents) — same convention as cart-settings.model.ts
  compareAtPrice?: number;
  required: boolean;
  minQuantity: number;
  maxQuantity: number;
  defaultQuantity: number;
  position: number;
}

/**
 * Immutable snapshot taken at publish time. Orders and analytics reference
 * a specific version number even after the merchant edits the bundle again
 * — never overwrite a published version, only append a new one.
 */
export interface IBundleVersion {
  version: number;
  products: IBundleProduct[];
  discountType: BundleDiscountType;
  discountValue: number;
  publishedAt: Date;
}

export interface IBundle extends Document {
  shopId: string;
  type: BundleType;
  internalName: string;
  title: string;
  handle: string;
  description: string;
  status: BundleStatus;
  startAt?: Date;
  endAt?: Date;
  featuredImageUrl: string;
  // Draft working copy — becomes an immutable IBundleVersion on publish.
  draftProducts: IBundleProduct[];
  draftDiscountType: BundleDiscountType;
  draftDiscountValue: number;
  currentVersion: number; // 0 = never published
  versions: IBundleVersion[];
  createdAt: Date;
  updatedAt: Date;
}

const bundleProductSchema = new Schema<IBundleProduct>(
  {
    shopifyProductId: { type: String, required: true },
    shopifyVariantId: { type: String },
    title: { type: String, default: "" },
    handle: { type: String, default: "" },
    imageUrl: { type: String, default: "" },
    price: { type: Number, default: 0 },
    compareAtPrice: { type: Number },
    required: { type: Boolean, default: true },
    minQuantity: { type: Number, default: 1 },
    maxQuantity: { type: Number, default: 1 },
    defaultQuantity: { type: Number, default: 1 },
    position: { type: Number, default: 0 },
  },
  { _id: false },
);

const bundleVersionSchema = new Schema<IBundleVersion>(
  {
    version: { type: Number, required: true },
    products: { type: [bundleProductSchema], default: [] },
    discountType: {
      type: String,
      enum: ["percentage", "fixed_amount", "fixed_price", "none"],
      default: "percentage",
    },
    discountValue: { type: Number, default: 0 },
    publishedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const bundleSchema = new Schema<IBundle>(
  {
    shopId: { type: String, required: true, index: true },
    type: {
      type: String,
      enum: [
        "fixed_product", "offer_tiers", "fixed_price", "byob", "mix_match",
        "variable", "step", "routine", "buy_any_x", "category",
        "frequently_bought", "personalized", "custom", "upsell",
      ],
      default: "fixed_product",
    },
    internalName: { type: String, required: true, maxlength: 80 },
    title: { type: String, required: true, maxlength: 120 },
    handle: { type: String, required: true, maxlength: 100 },
    description: { type: String, default: "", maxlength: 2000 },
    status: {
      type: String,
      enum: ["draft", "active", "scheduled", "paused", "expired", "archived"],
      default: "draft",
      index: true,
    },
    startAt: { type: Date },
    endAt: { type: Date },
    featuredImageUrl: { type: String, default: "" },
    draftProducts: { type: [bundleProductSchema], default: [] },
    draftDiscountType: {
      type: String,
      enum: ["percentage", "fixed_amount", "fixed_price", "none"],
      default: "percentage",
    },
    draftDiscountValue: { type: Number, default: 0 },
    currentVersion: { type: Number, default: 0 },
    versions: { type: [bundleVersionSchema], default: [] },
  },
  { timestamps: true },
);

// A shop can't have two bundles with the same handle (storefront/landing-page URL).
bundleSchema.index({ shopId: 1, handle: 1 }, { unique: true });

export const Bundle: Model<IBundle> =
  mongoose.models.Bundle || mongoose.model<IBundle>("Bundle", bundleSchema);

export interface IBundleSettings extends Document {
  shopId: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const bundleSettingsSchema = new Schema<IBundleSettings>(
  {
    shopId: { type: String, required: true, unique: true },
    enabled: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export const BundleSettings: Model<IBundleSettings> =
  mongoose.models.BundleSettings ||
  mongoose.model<IBundleSettings>("BundleSettings", bundleSettingsSchema);

export async function getOrCreateBundleSettings(shopId: string): Promise<IBundleSettings> {
  let s = await BundleSettings.findOne({ shopId });
  if (!s) s = await BundleSettings.create({ shopId });
  return s;
}
