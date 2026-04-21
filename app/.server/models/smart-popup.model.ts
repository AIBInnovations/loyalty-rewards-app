import mongoose, { type Document, type Model, Schema } from "mongoose";

export type SmartPopupTriggerType =
  | "timer"
  | "scroll"
  | "exit_intent"
  | "inactivity";

export type SmartPopupAudience = "all" | "new" | "returning";

export type SmartPopupPageType =
  | "home"
  | "product"
  | "collection"
  | "blog"
  | "article"
  | "page"
  | "cart"
  | "search"
  | "other";

export type SmartPopupOfferType = "discount" | "none";
export type SmartPopupDiscountType = "percentage" | "fixed_amount";
export type SmartPopupLayout = "center" | "bottom-right" | "bottom-left";

export interface ISmartPopupTrigger {
  type: SmartPopupTriggerType;
  delaySeconds: number;
  scrollPercent: number;
  inactivitySeconds: number;
}

export interface ISmartPopupTargeting {
  includePages: SmartPopupPageType[];
  excludePages: SmartPopupPageType[];
  devices: ("desktop" | "mobile")[];
  audience: SmartPopupAudience;
  countries: string[];
}

export interface ISmartPopupSuppression {
  afterCloseHours: number;
  afterSubmitDays: number;
  afterDismissHours: number;
  maxPerSession: number;
}

export interface ISmartPopupContent {
  headline: string;
  subtext: string;
  buttonText: string;
  successMessage: string;
  consentText: string;
  consentVersion: string;
  collectFirstName: boolean;
  bgColor: string;
  accentColor: string;
  textColor: string;
  layout: SmartPopupLayout;
  imageUrl: string;
}

export interface ISmartPopupOffer {
  type: SmartPopupOfferType;
  discountType: SmartPopupDiscountType;
  discountValue: number;
  minimumOrderAmount: number;
}

export interface ISmartPopupStats {
  impressions: number;
  opens: number;
  closes: number;
  submits: number;
  converts: number;
}

export interface ISmartPopupCampaign {
  _id?: mongoose.Types.ObjectId;
  name: string;
  status: "active" | "paused" | "draft";
  priority: number;
  startAt?: Date | null;
  endAt?: Date | null;
  trigger: ISmartPopupTrigger;
  targeting: ISmartPopupTargeting;
  suppression: ISmartPopupSuppression;
  content: ISmartPopupContent;
  offer: ISmartPopupOffer;
  stats: ISmartPopupStats;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ISmartPopupSettings extends Document {
  shopId: string;
  enabled: boolean;
  campaigns: ISmartPopupCampaign[];
  createdAt: Date;
  updatedAt: Date;
}

const triggerSchema = new Schema<ISmartPopupTrigger>(
  {
    type: {
      type: String,
      enum: ["timer", "scroll", "exit_intent", "inactivity"],
      default: "timer",
    },
    delaySeconds: { type: Number, default: 8, min: 0, max: 600 },
    scrollPercent: { type: Number, default: 40, min: 1, max: 100 },
    inactivitySeconds: { type: Number, default: 30, min: 5, max: 600 },
  },
  { _id: false },
);

const targetingSchema = new Schema<ISmartPopupTargeting>(
  {
    includePages: {
      type: [String],
      default: ["home", "product", "collection", "blog", "article", "page"],
    },
    excludePages: {
      type: [String],
      default: ["cart"],
    },
    devices: { type: [String], default: ["desktop", "mobile"] },
    audience: {
      type: String,
      enum: ["all", "new", "returning"],
      default: "all",
    },
    countries: { type: [String], default: [] },
  },
  { _id: false },
);

const suppressionSchema = new Schema<ISmartPopupSuppression>(
  {
    afterCloseHours: { type: Number, default: 24, min: 0 },
    afterSubmitDays: { type: Number, default: 90, min: 0 },
    afterDismissHours: { type: Number, default: 6, min: 0 },
    maxPerSession: { type: Number, default: 1, min: 1 },
  },
  { _id: false },
);

const contentSchema = new Schema<ISmartPopupContent>(
  {
    headline: { type: String, default: "Get 10% off your first order" },
    subtext: {
      type: String,
      default: "Join our newsletter and we'll send the code right away.",
    },
    buttonText: { type: String, default: "Send my code" },
    successMessage: { type: String, default: "Here's your code" },
    consentText: {
      type: String,
      default:
        "By subscribing you agree to receive marketing emails. You can unsubscribe at any time.",
    },
    consentVersion: { type: String, default: "v1" },
    collectFirstName: { type: Boolean, default: false },
    bgColor: { type: String, default: "#ffffff" },
    accentColor: { type: String, default: "#5C6AC4" },
    textColor: { type: String, default: "#111827" },
    layout: {
      type: String,
      enum: ["center", "bottom-right", "bottom-left"],
      default: "center",
    },
    imageUrl: { type: String, default: "" },
  },
  { _id: false },
);

const offerSchema = new Schema<ISmartPopupOffer>(
  {
    type: { type: String, enum: ["discount", "none"], default: "discount" },
    discountType: {
      type: String,
      enum: ["percentage", "fixed_amount"],
      default: "percentage",
    },
    discountValue: { type: Number, default: 10, min: 0 },
    minimumOrderAmount: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

const statsSchema = new Schema<ISmartPopupStats>(
  {
    impressions: { type: Number, default: 0 },
    opens: { type: Number, default: 0 },
    closes: { type: Number, default: 0 },
    submits: { type: Number, default: 0 },
    converts: { type: Number, default: 0 },
  },
  { _id: false },
);

const campaignSchema = new Schema<ISmartPopupCampaign>(
  {
    name: { type: String, required: true },
    status: {
      type: String,
      enum: ["active", "paused", "draft"],
      default: "draft",
    },
    priority: { type: Number, default: 10 },
    startAt: { type: Date, default: null },
    endAt: { type: Date, default: null },
    trigger: { type: triggerSchema, default: () => ({}) },
    targeting: { type: targetingSchema, default: () => ({}) },
    suppression: { type: suppressionSchema, default: () => ({}) },
    content: { type: contentSchema, default: () => ({}) },
    offer: { type: offerSchema, default: () => ({}) },
    stats: { type: statsSchema, default: () => ({}) },
  },
  { timestamps: true },
);

const smartPopupSettingsSchema = new Schema<ISmartPopupSettings>(
  {
    shopId: { type: String, required: true, unique: true },
    enabled: { type: Boolean, default: false },
    campaigns: { type: [campaignSchema], default: [] },
  },
  { timestamps: true },
);

export const SmartPopupSettings: Model<ISmartPopupSettings> =
  mongoose.models.SmartPopupSettings ||
  mongoose.model<ISmartPopupSettings>(
    "SmartPopupSettings",
    smartPopupSettingsSchema,
  );

export async function getOrCreateSmartPopupSettings(
  shopId: string,
): Promise<ISmartPopupSettings> {
  let s = await SmartPopupSettings.findOne({ shopId });
  if (!s) s = await SmartPopupSettings.create({ shopId, campaigns: [] });
  return s;
}

// ─── Lead (rich submission record with consent + context) ────────

export interface ISmartPopupLead extends Document {
  shopId: string;
  campaignId: string;
  email: string;
  firstName?: string;
  discountCode?: string;
  consentText: string;
  consentVersion: string;
  pageUrl?: string;
  pageType?: string;
  referrer?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  locale?: string;
  country?: string;
  device?: string;
  visitorKey?: string;
  syncStatus: "pending" | "synced" | "failed";
  createdAt: Date;
  updatedAt: Date;
}

const smartPopupLeadSchema = new Schema<ISmartPopupLead>(
  {
    shopId: { type: String, required: true, index: true },
    campaignId: { type: String, required: true, index: true },
    email: { type: String, required: true },
    firstName: { type: String, default: "" },
    discountCode: { type: String, default: "" },
    consentText: { type: String, default: "" },
    consentVersion: { type: String, default: "v1" },
    pageUrl: { type: String, default: "" },
    pageType: { type: String, default: "" },
    referrer: { type: String, default: "" },
    utmSource: { type: String, default: "" },
    utmMedium: { type: String, default: "" },
    utmCampaign: { type: String, default: "" },
    locale: { type: String, default: "" },
    country: { type: String, default: "" },
    device: { type: String, default: "" },
    visitorKey: { type: String, default: "" },
    syncStatus: {
      type: String,
      enum: ["pending", "synced", "failed"],
      default: "pending",
    },
  },
  { timestamps: true },
);

smartPopupLeadSchema.index(
  { shopId: 1, email: 1, campaignId: 1 },
  { unique: true },
);

export const SmartPopupLead: Model<ISmartPopupLead> =
  mongoose.models.SmartPopupLead ||
  mongoose.model<ISmartPopupLead>("SmartPopupLead", smartPopupLeadSchema);
