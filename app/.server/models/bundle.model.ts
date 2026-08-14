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

export interface IBundleStyle {
  bgColor: string;
  textColor: string;
  buttonColor: string;
  buttonTextColor: string;
  borderRadius: number;
  layout: "grid" | "list";

  // Branding
  primaryColor: string;
  primaryContrastColor: string;
  secondaryColor: string;
  secondaryContrastColor: string;
  sectionBgColor: string;
  infoAlignment: "left" | "center" | "right";

  // Title & header
  titleFontSize: number;
  subtitleFontSize: number;
  titleBgColor: string;
  titleTextColor: string;

  // Product cards
  imageAspectRatio: "square" | "portrait";
  cardLayoutStyle: "horizontal" | "vertical" | "auto";
  cardBorderRadius: number;
  cardBorderColor: string;
  cardBgColor: string;
  cardShadow: "none" | "soft" | "spread";
  showPrice: boolean;
  showCompareAtPrice: boolean;

  // CTA button (beyond the quick buttonColor/buttonTextColor above)
  ctaText: string;
  ctaBorderColor: string;
  ctaBorderRadius: number;
  ctaWidth: "fit" | "full";
  ctaPadding: number;
  ctaShadow: "none" | "soft" | "spread";
  ctaHoverEnabled: boolean;
  ctaHoverBgColor: string;
  ctaHoverTextColor: string;

  // Raw override, applied last
  customCss: string;

  // Cart & checkout behavior
  clearCartOnAdd: boolean;
  postAddRedirect: "none" | "cart" | "checkout";

  // Discount naming (the Shopify automatic discount's title, not its value)
  discountPrefix: string;
  discountSuffix: string;

  // Display
  currencySymbol: string;
  showPaymentIcons: boolean;

  // Order behavior — applied when a paid order contains this bundle
  addOrderTags: boolean;
  addOrderNotes: boolean;

  // Product visibility & selection behavior
  visibilityMode: "primary" | "all";
  primaryProductId: string;
  showCheckbox: boolean;
  uncheckByDefault: boolean;
  /** Only matters when showCheckbox is on. "multi" = each product toggles
      independently. "single" = the primary product is always included and
      locked, and the customer picks exactly one of the other products to
      pair with it — picking a new one unchecks whichever was picked before. */
  selectionMode: "multi" | "single";
  enableQuantitySelector: boolean;
  quantityMin: number; // 0 = no bundle-wide override, use each product's own minQuantity
  quantityMax: number; // 0 = no bundle-wide override, use each product's own maxQuantity
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
  /** Shopify automatic-discount node ID enforcing this version's price —
      real server-side enforcement (same discountAutomaticBasicCreate
      mechanism already used by Volume Discounts), not a client-side-only
      number. Empty when discountType is "none" or sync failed. */
  shopifyDiscountId: string;
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
  style: IBundleStyle;
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
    shopifyDiscountId: { type: String, default: "" },
  },
  { _id: false },
);

const bundleStyleSchema = new Schema<IBundleStyle>(
  {
    bgColor: { type: String, default: "" },
    textColor: { type: String, default: "" },
    buttonColor: { type: String, default: "" },
    buttonTextColor: { type: String, default: "" },
    borderRadius: { type: Number, default: 12 },
    layout: { type: String, enum: ["grid", "list"], default: "grid" },

    primaryColor: { type: String, default: "" },
    primaryContrastColor: { type: String, default: "" },
    secondaryColor: { type: String, default: "" },
    secondaryContrastColor: { type: String, default: "" },
    sectionBgColor: { type: String, default: "" },
    infoAlignment: { type: String, enum: ["left", "center", "right"], default: "left" },

    titleFontSize: { type: Number, default: 22 },
    subtitleFontSize: { type: Number, default: 18 },
    titleBgColor: { type: String, default: "" },
    titleTextColor: { type: String, default: "" },

    imageAspectRatio: { type: String, enum: ["square", "portrait"], default: "square" },
    cardLayoutStyle: { type: String, enum: ["horizontal", "vertical", "auto"], default: "auto" },
    cardBorderRadius: { type: Number, default: 12 },
    cardBorderColor: { type: String, default: "" },
    cardBgColor: { type: String, default: "" },
    cardShadow: { type: String, enum: ["none", "soft", "spread"], default: "soft" },
    showPrice: { type: Boolean, default: true },
    showCompareAtPrice: { type: Boolean, default: true },

    ctaText: { type: String, default: "Add Bundle to Cart" },
    ctaBorderColor: { type: String, default: "" },
    ctaBorderRadius: { type: Number, default: 12 },
    ctaWidth: { type: String, enum: ["fit", "full"], default: "full" },
    ctaPadding: { type: Number, default: 14 },
    ctaShadow: { type: String, enum: ["none", "soft", "spread"], default: "none" },
    ctaHoverEnabled: { type: Boolean, default: false },
    ctaHoverBgColor: { type: String, default: "" },
    ctaHoverTextColor: { type: String, default: "" },

    customCss: { type: String, default: "", maxlength: 20000 },

    clearCartOnAdd: { type: Boolean, default: false },
    postAddRedirect: { type: String, enum: ["none", "cart", "checkout"], default: "none" },

    discountPrefix: { type: String, default: "", maxlength: 40 },
    discountSuffix: { type: String, default: "", maxlength: 40 },

    currencySymbol: { type: String, default: "", maxlength: 6 },
    showPaymentIcons: { type: Boolean, default: false },

    addOrderTags: { type: Boolean, default: false },
    addOrderNotes: { type: Boolean, default: false },

    visibilityMode: { type: String, enum: ["primary", "all"], default: "all" },
    primaryProductId: { type: String, default: "" },
    showCheckbox: { type: Boolean, default: false },
    uncheckByDefault: { type: Boolean, default: false },
    selectionMode: { type: String, enum: ["multi", "single"], default: "multi" },
    enableQuantitySelector: { type: Boolean, default: false },
    quantityMin: { type: Number, default: 0 },
    quantityMax: { type: Number, default: 0 },
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
    style: { type: bundleStyleSchema, default: () => ({}) },
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

/**
 * Daily per-bundle counters. One row per (shopId, bundleId, date) — updated
 * with atomic $inc upserts from the storefront ping endpoint and the
 * ORDERS_PAID webhook, never overwritten wholesale. "date" is a plain
 * YYYY-MM-DD string in UTC, not a Date, so grouping/lookup is a simple
 * equality match without timezone math.
 */
export interface IBundleAnalyticsDaily extends Document {
  shopId: string;
  bundleId: string;
  date: string;
  pageSessions: number;
  interactions: number;
  addToCarts: number;
  orders: number;
  revenue: number; // minor units, same convention as IBundleProduct.price
  createdAt: Date;
  updatedAt: Date;
}

const bundleAnalyticsDailySchema = new Schema<IBundleAnalyticsDaily>(
  {
    shopId: { type: String, required: true },
    bundleId: { type: String, required: true },
    date: { type: String, required: true },
    pageSessions: { type: Number, default: 0 },
    interactions: { type: Number, default: 0 },
    addToCarts: { type: Number, default: 0 },
    orders: { type: Number, default: 0 },
    revenue: { type: Number, default: 0 },
  },
  { timestamps: true },
);

bundleAnalyticsDailySchema.index({ shopId: 1, bundleId: 1, date: 1 }, { unique: true });
bundleAnalyticsDailySchema.index({ shopId: 1, date: 1 });

export const BundleAnalyticsDaily: Model<IBundleAnalyticsDaily> =
  mongoose.models.BundleAnalyticsDaily ||
  mongoose.model<IBundleAnalyticsDaily>("BundleAnalyticsDaily", bundleAnalyticsDailySchema);

export type BundleAnalyticsEvent = "view" | "interaction" | "addToCart";

export async function recordBundleAnalyticsEvent(
  shopId: string,
  bundleId: string,
  event: BundleAnalyticsEvent,
): Promise<void> {
  const date = new Date().toISOString().slice(0, 10);
  const field =
    event === "view" ? "pageSessions" : event === "interaction" ? "interactions" : "addToCarts";
  await BundleAnalyticsDaily.findOneAndUpdate(
    { shopId, bundleId, date },
    { $inc: { [field]: 1 } },
    { upsert: true, setDefaultsOnInsert: true },
  );
}
