import mongoose, { type Document, type Model, Schema } from "mongoose";

export type NameStyle = "masked" | "generic" | "first_name";
export type LocationStyle = "city" | "state" | "country" | "hidden";
export type MatchMode = "product" | "collection" | "global";

export interface ISalesPopSettings extends Document {
  shopId: string;
  enabled: boolean;
  // Message copy
  messageTemplate: string;
  ctaLabel: string;
  showCta: boolean;
  showThumbnail: boolean;
  // Privacy
  nameStyle: NameStyle;
  locationStyle: LocationStyle;
  genericFallback: string;
  // Targeting
  showOnProduct: boolean;
  showOnCollection: boolean;
  showOnHome: boolean;
  matchMode: MatchMode;
  excludedTags: string[];
  // Timing
  initialDelaySeconds: number;
  minIntervalSeconds: number;
  maxIntervalSeconds: number;
  maxPerSession: number;
  minOrderAgeMinutes: number;
  freshnessHours: number;
  // Appearance
  position: "bottom-left" | "bottom-right" | "top-left" | "top-right";
  accentColor: string;
  bgColor: string;
  textColor: string;
  borderRadius: number;
  showOnMobile: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const salesPopSettingsSchema = new Schema<ISalesPopSettings>(
  {
    shopId: { type: String, required: true, unique: true },
    enabled: { type: Boolean, default: false },

    messageTemplate: {
      type: String,
      default: "{name} from {location} just bought {product}",
    },
    ctaLabel: { type: String, default: "View Product" },
    showCta: { type: Boolean, default: true },
    showThumbnail: { type: Boolean, default: true },

    nameStyle: {
      type: String,
      enum: ["masked", "generic", "first_name"],
      default: "masked",
    },
    locationStyle: {
      type: String,
      enum: ["city", "state", "country", "hidden"],
      default: "city",
    },
    genericFallback: { type: String, default: "Someone" },

    showOnProduct: { type: Boolean, default: true },
    showOnCollection: { type: Boolean, default: true },
    showOnHome: { type: Boolean, default: false },
    matchMode: {
      type: String,
      enum: ["product", "collection", "global"],
      default: "collection",
    },
    excludedTags: { type: [String], default: [] },

    initialDelaySeconds: { type: Number, default: 8 },
    minIntervalSeconds: { type: Number, default: 20 },
    maxIntervalSeconds: { type: Number, default: 35 },
    maxPerSession: { type: Number, default: 3 },
    minOrderAgeMinutes: { type: Number, default: 5 },
    freshnessHours: { type: Number, default: 72 },

    position: {
      type: String,
      enum: ["bottom-left", "bottom-right", "top-left", "top-right"],
      default: "bottom-left",
    },
    accentColor: { type: String, default: "#5C6AC4" },
    bgColor: { type: String, default: "#ffffff" },
    textColor: { type: String, default: "#1a1a1a" },
    borderRadius: { type: Number, default: 12 },
    showOnMobile: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export const SalesPopSettings: Model<ISalesPopSettings> =
  mongoose.models.SalesPopSettings ||
  mongoose.model<ISalesPopSettings>(
    "SalesPopSettings",
    salesPopSettingsSchema,
  );

export async function getOrCreateSalesPopSettings(
  shopId: string,
): Promise<ISalesPopSettings> {
  let s = await SalesPopSettings.findOne({ shopId });
  if (!s) s = await SalesPopSettings.create({ shopId });
  return s;
}
