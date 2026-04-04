import mongoose, { type Document, type Model, Schema } from "mongoose";

export type TimerType = "fixed" | "evergreen";
export type TimerDisplayMode = "announcement" | "product-page" | "both";

export interface ITimerSettings extends Document {
  shopId: string;
  enabled: boolean;
  timerType: TimerType;
  // Fixed deadline
  endDate?: Date;
  // Evergreen
  durationHours: number;
  durationMinutes: number;
  // Display
  displayMode: TimerDisplayMode;
  messageTemplate: string;
  expiredMessage: string;
  barBackgroundColor: string;
  barTextColor: string;
  timerDigitColor: string;
  // Targeting
  showOnAllProducts: boolean;
  saleItemsOnly: boolean;
  specificTags: string[];
  // Behavior
  hideWhenExpired: boolean;
  showDismissButton: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const timerSettingsSchema = new Schema<ITimerSettings>(
  {
    shopId: { type: String, required: true, unique: true },
    enabled: { type: Boolean, default: false },
    timerType: { type: String, enum: ["fixed", "evergreen"], default: "evergreen" },
    endDate: { type: Date },
    durationHours: { type: Number, default: 2, min: 0 },
    durationMinutes: { type: Number, default: 0, min: 0, max: 59 },
    displayMode: {
      type: String,
      enum: ["announcement", "product-page", "both"],
      default: "announcement",
    },
    messageTemplate: {
      type: String,
      default: "🔥 Flash Sale ends in {timer}",
    },
    expiredMessage: {
      type: String,
      default: "Sale has ended!",
    },
    barBackgroundColor: { type: String, default: "#1a1a1a" },
    barTextColor: { type: String, default: "#ffffff" },
    timerDigitColor: { type: String, default: "#ff4444" },
    showOnAllProducts: { type: Boolean, default: true },
    saleItemsOnly: { type: Boolean, default: false },
    specificTags: { type: [String], default: [] },
    hideWhenExpired: { type: Boolean, default: true },
    showDismissButton: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export const TimerSettings: Model<ITimerSettings> =
  mongoose.models.TimerSettings ||
  mongoose.model<ITimerSettings>("TimerSettings", timerSettingsSchema);

export async function getOrCreateTimerSettings(
  shopId: string,
): Promise<ITimerSettings> {
  let settings = await TimerSettings.findOne({ shopId });
  if (!settings) {
    settings = await TimerSettings.create({ shopId });
  }
  return settings;
}
