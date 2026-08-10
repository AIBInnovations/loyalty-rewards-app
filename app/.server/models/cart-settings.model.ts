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

export type RecommendationMode = "auto" | "manual" | "collection";

export interface IManualProduct {
  shopifyProductId: string;
  title: string;
  handle: string;
  imageUrl: string;
  price: number;
  compareAtPrice?: number;
  variantId: string;
  /** Manual-mode only — each product gets its own badge, unlike collection
      mode where recommendationsCollectionBadgeText applies to all of them. */
  badgeText?: string;
}

export interface ICartDrawerSettings extends Document {
  shopId: string;
  enabled: boolean;
  tiers: ICartTier[];
  /** Hides the whole tiered progress bar/card in the cart drawer. */
  showProgressBar: boolean;
  showRecommendations: boolean;
  recommendationsTitle: string;
  recommendationsCount: number;
  recommendationMode: RecommendationMode;
  recommendationsSlider: boolean;
  /** "Add to Cart" button on recommendation cards. Empty = use the default accent color. */
  recommendationsAddToCartBg: string;
  recommendationsAddToCartText: string;
  /** Product card badge (manual per-product / collection shared text).
      Empty color = default accent. */
  recommendationsBadgeBg: string;
  recommendationsBadgeTextColor: string;
  recommendationsBadgeAlign: "left" | "right";
  /** Collection mode: every product in this collection is shown, with the
      same badge text on all of them (contrast manual mode's per-product
      badgeText on IManualProduct). */
  recommendationsCollectionId: string;
  recommendationsCollectionHandle: string;
  recommendationsCollectionTitle: string;
  recommendationsCollectionBadgeText: string;
  manualProducts: IManualProduct[];
  showSavings: boolean;
  checkoutButtonText: string;
  prepaidBannerText: string;
  showPrepaidBanner: boolean;
  /** Green banner under the header. Hidden when empty. Legacy single-text
      fallback — superseded by announcementTexts when that's set. */
  shippingBannerText: string;
  /** Announcement bar under the header — multiple messages that slide/rotate.
      Falls back to shippingBannerText (as a single slide) when empty. */
  announcementTexts: string[];
  /** Seconds between slides. 0/unset = built-in default (4s). */
  announcementDelay: number;
  announcementTextColor: string;
  announcementBgColor: string;
  /** Disclaimer line shown above the reward progress message. Hidden when empty. */
  progressBannerText: string;
  /** Small print under the checkout button, e.g. accepted payment methods. */
  paymentMethodsText: string;
  /** Dashed coupon card. Hidden unless enabled AND a code is set. */
  couponEnabled: boolean;
  couponCode: string;
  couponDescription: string;
  couponOffersUrl: string;
  primaryColor: string;
  interceptAddToCart: boolean;
  showUpsell: boolean;
  upsellHeadline: string;
  upsellDiscount: number;
  upsellProduct: IManualProduct | null;
  /** Appearance overrides. Empty string = use the built-in default. */
  fontFamily: string;
  fontSize: number;
  progressBarColor: string;
  offerLineBg: string;
  offerLineTextColor: string;
  buttonColor: string;
  buttonHoverColor: string;
  buttonHoverTextColor: string;
  /** Diameter (px) of the item-count circle next to "Your Cart" in the header. */
  headerCountSize: number;
  /** Drawer panel width (px) on desktop/tablet. 0 = use the built-in default (420px). */
  drawerWidth: number;
  /** Reached milestone pill (tier label badge) colors. */
  pillColor: string;
  pillTextColor: string;
  /** Reached milestone node (checkmark circle) colors. */
  nodeColor: string;
  nodeTextColor: string;
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
    showProgressBar: { type: Boolean, default: true },
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
    recommendationMode: { type: String, enum: ["auto", "manual", "collection"], default: "auto" },
    recommendationsSlider: { type: Boolean, default: false },
    recommendationsAddToCartBg: { type: String, default: "" },
    recommendationsAddToCartText: { type: String, default: "" },
    recommendationsBadgeBg: { type: String, default: "" },
    recommendationsBadgeTextColor: { type: String, default: "" },
    recommendationsBadgeAlign: { type: String, enum: ["left", "right"], default: "right" },
    recommendationsCollectionId: { type: String, default: "" },
    recommendationsCollectionHandle: { type: String, default: "" },
    recommendationsCollectionTitle: { type: String, default: "" },
    recommendationsCollectionBadgeText: { type: String, default: "", maxlength: 30 },
    manualProducts: {
      type: [{
        shopifyProductId: { type: String, required: true },
        title: { type: String },
        handle: { type: String },
        imageUrl: { type: String },
        price: { type: Number },
        compareAtPrice: { type: Number },
        variantId: { type: String },
        badgeText: { type: String, default: "", maxlength: 30 },
      }],
      default: [],
    },
    showSavings: { type: Boolean, default: true },
    checkoutButtonText: { type: String, default: "CHECKOUT" },
    prepaidBannerText: { type: String, default: "5% Off on Prepaid Orders!" },
    showPrepaidBanner: { type: Boolean, default: true },

    // Empty by default: the drawer hides these sections entirely rather than
    // making a shipping or discount promise the merchant hasn't opted into.
    shippingBannerText: { type: String, default: "", maxlength: 80 },
    announcementTexts: { type: [String], default: [] },
    announcementDelay: { type: Number, default: 0, min: 0, max: 30 },
    announcementTextColor: { type: String, default: "" },
    announcementBgColor: { type: String, default: "" },
    progressBannerText: { type: String, default: "", maxlength: 100 },
    paymentMethodsText: { type: String, default: "", maxlength: 120 },
    couponEnabled: { type: Boolean, default: false },
    couponCode: { type: String, default: "", maxlength: 40 },
    couponDescription: { type: String, default: "", maxlength: 80 },
    couponOffersUrl: { type: String, default: "", maxlength: 500 },
    primaryColor: { type: String, default: "#5C6AC4" },
    interceptAddToCart: { type: Boolean, default: true },
    showUpsell: { type: Boolean, default: false },
    upsellHeadline: { type: String, default: "Special Offer Just For You!" },
    upsellDiscount: { type: Number, default: 10, min: 0, max: 70 },
    upsellProduct: {
      type: {
        shopifyProductId: { type: String },
        title: { type: String },
        handle: { type: String },
        imageUrl: { type: String },
        price: { type: Number },
        compareAtPrice: { type: Number },
        variantId: { type: String },
      },
      default: null,
    },
    fontFamily: { type: String, default: "" },
    fontSize: { type: Number, default: 0, min: 0, max: 24 },
    progressBarColor: { type: String, default: "" },
    offerLineBg: { type: String, default: "" },
    offerLineTextColor: { type: String, default: "" },
    buttonColor: { type: String, default: "" },
    buttonHoverColor: { type: String, default: "" },
    buttonHoverTextColor: { type: String, default: "" },
    headerCountSize: { type: Number, default: 0, min: 0, max: 60 },
    drawerWidth: { type: Number, default: 0, min: 0, max: 640 },
    pillColor: { type: String, default: "" },
    pillTextColor: { type: String, default: "" },
    nodeColor: { type: String, default: "" },
    nodeTextColor: { type: String, default: "" },
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
