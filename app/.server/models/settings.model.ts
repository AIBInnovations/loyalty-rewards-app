import mongoose, { type Document, type Model, Schema } from "mongoose";

export interface ITier {
  name: string;
  minLifetimePoints: number;
  earningMultiplier: number;
}

export interface IWidgetConfig {
  primaryColor: string;
  position: "bottom-right" | "bottom-left";
  title: string;
}

export interface ICurrencyOption {
  currencyCode: string;
  countryCode: string;
  label: string;
  symbol: string;
}

export interface ISettings extends Document {
  shopId: string;
  // Earning configuration
  earningRate: number; // percentage of order subtotal as points (default 10)
  signupBonus: number;
  referralBonusReferrer: number;
  referralBonusReferred: number;
  birthdayBonus: number;
  socialShareBonus: number;
  // Point expiry
  pointsExpiry: {
    enabled: boolean;
    daysToExpire: number;
  };
  // Tiers
  tiers: ITier[];
  // Widget
  widgetConfig: IWidgetConfig;
  // General
  currencySymbol: string;
  currencySelectorEnabled: boolean;
  currencies: ICurrencyOption[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const settingsSchema = new Schema<ISettings>(
  {
    shopId: { type: String, required: true, unique: true },
    earningRate: { type: Number, default: 10, min: 0, max: 100 },
    signupBonus: { type: Number, default: 50 },
    referralBonusReferrer: { type: Number, default: 100 },
    referralBonusReferred: { type: Number, default: 50 },
    birthdayBonus: { type: Number, default: 100 },
    socialShareBonus: { type: Number, default: 10 },
    pointsExpiry: {
      enabled: { type: Boolean, default: false },
      daysToExpire: { type: Number, default: 365 },
    },
    tiers: {
      type: [
        {
          name: { type: String, required: true },
          minLifetimePoints: { type: Number, required: true },
          earningMultiplier: { type: Number, default: 1.0 },
        },
      ],
      default: [
        { name: "Bronze", minLifetimePoints: 0, earningMultiplier: 1.0 },
        { name: "Silver", minLifetimePoints: 1000, earningMultiplier: 1.25 },
        { name: "Gold", minLifetimePoints: 5000, earningMultiplier: 1.5 },
        { name: "Platinum", minLifetimePoints: 10000, earningMultiplier: 2.0 },
      ],
    },
    widgetConfig: {
      primaryColor: { type: String, default: "#5C6AC4" },
      position: { type: String, default: "bottom-right" },
      title: { type: String, default: "Rewards" },
    },
    currencySymbol: { type: String, default: "₹" },
    currencySelectorEnabled: { type: Boolean, default: true },
    currencies: {
      type: [
        {
          currencyCode: { type: String, required: true },
          countryCode: { type: String, required: true },
          label: { type: String, required: true },
          symbol: { type: String, required: true },
        },
      ],
      default: [{ currencyCode: "INR", countryCode: "IN", label: "India", symbol: "₹" }],
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export const Settings: Model<ISettings> =
  mongoose.models.Settings ||
  mongoose.model<ISettings>("Settings", settingsSchema);

/**
 * Get or create settings for a shop.
 * Returns existing settings or creates defaults.
 */
export async function getOrCreateSettings(shopId: string): Promise<ISettings> {
  let settings = await Settings.findOne({ shopId });
  if (!settings) {
    settings = await Settings.create({ shopId });
  }
  return settings;
}
