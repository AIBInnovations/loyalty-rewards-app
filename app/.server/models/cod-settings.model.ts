import mongoose, { type Document, type Model, Schema } from "mongoose";

export interface ICodSettings extends Document {
  shopId: string;
  enabled: boolean;
  whatsappToken: string;     // Meta Cloud API permanent token
  whatsappPhoneId: string;   // WhatsApp Business phone number ID
  messageTemplate: string;   // Supports {name}, {order_number}, {amount}, {date}
  createdAt: Date;
  updatedAt: Date;
}

const codSettingsSchema = new Schema<ICodSettings>(
  {
    shopId:          { type: String, required: true, unique: true },
    enabled:         { type: Boolean, default: false },
    whatsappToken:   { type: String, default: "" },
    whatsappPhoneId: { type: String, default: "" },
    messageTemplate: {
      type: String,
      default:
        "Hi {name}! 🎉 Your order #{order_number} worth ₹{amount} has been confirmed. Expected delivery: {date}. Reply CANCEL to cancel your order.",
    },
  },
  { timestamps: true },
);

export const CodSettings: Model<ICodSettings> =
  mongoose.models.CodSettings ||
  mongoose.model<ICodSettings>("CodSettings", codSettingsSchema);

export async function getOrCreateCodSettings(shopId: string): Promise<ICodSettings> {
  let s = await CodSettings.findOne({ shopId });
  if (!s) s = await CodSettings.create({ shopId });
  return s;
}
