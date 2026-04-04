import mongoose, { type Document, type Model, Schema } from "mongoose";

export interface IVoiceAgentSettings extends Document {
  shopId: string;
  enabled: boolean;
  // Sarvam AI config
  sarvamApiKey: string;
  sarvamAgentId: string;
  // Call config
  callDelayMinutes: number;
  minCartValue: number;
  maxCallsPerDay: number;
  callWindowStart: number; // hour (0-23)
  callWindowEnd: number;
  // Script
  language: "en" | "hi" | "hinglish";
  greeting: string;
  offerDiscount: boolean;
  discountType: "percentage" | "fixed_amount";
  discountValue: number;
  offerLoyaltyPoints: boolean;
  bonusPoints: number;
  // WhatsApp
  sendWhatsApp: boolean;
  whatsappNumber: string;
  // Analytics (updated by background jobs)
  totalCallsMade: number;
  totalRecovered: number;
  totalRevenueRecovered: number;
  createdAt: Date;
  updatedAt: Date;
}

const voiceAgentSettingsSchema = new Schema<IVoiceAgentSettings>(
  {
    shopId: { type: String, required: true, unique: true },
    enabled: { type: Boolean, default: false },
    sarvamApiKey: { type: String, default: "" },
    sarvamAgentId: { type: String, default: "" },
    callDelayMinutes: { type: Number, default: 15, min: 5, max: 120 },
    minCartValue: { type: Number, default: 500 },
    maxCallsPerDay: { type: Number, default: 100 },
    callWindowStart: { type: Number, default: 9 },
    callWindowEnd: { type: Number, default: 21 },
    language: { type: String, enum: ["en", "hi", "hinglish"], default: "hinglish" },
    greeting: {
      type: String,
      default: "Hi {name}! This is {brand}'s shopping assistant. I noticed you were looking at {product} worth {amount}. It's still in your cart! Complete your purchase now and earn {points} bonus loyalty points. Shall I send the checkout link to your WhatsApp?",
    },
    offerDiscount: { type: Boolean, default: true },
    discountType: { type: String, enum: ["percentage", "fixed_amount"], default: "percentage" },
    discountValue: { type: Number, default: 10 },
    offerLoyaltyPoints: { type: Boolean, default: true },
    bonusPoints: { type: Number, default: 500 },
    sendWhatsApp: { type: Boolean, default: true },
    whatsappNumber: { type: String, default: "" },
    totalCallsMade: { type: Number, default: 0 },
    totalRecovered: { type: Number, default: 0 },
    totalRevenueRecovered: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export const VoiceAgentSettings: Model<IVoiceAgentSettings> =
  mongoose.models.VoiceAgentSettings ||
  mongoose.model<IVoiceAgentSettings>("VoiceAgentSettings", voiceAgentSettingsSchema);

export async function getOrCreateVoiceAgentSettings(
  shopId: string,
): Promise<IVoiceAgentSettings> {
  let s = await VoiceAgentSettings.findOne({ shopId });
  if (!s) s = await VoiceAgentSettings.create({ shopId });
  return s;
}
