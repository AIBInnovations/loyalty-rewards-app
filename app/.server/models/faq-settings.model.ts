import mongoose, { type Document, type Model, Schema } from "mongoose";

export interface IFaqItem {
  question: string;
  answer: string;
  active: boolean;
}

export interface IFaqSettings extends Document {
  shopId: string;
  enabled: boolean;
  heading: string;
  subheading: string;
  restrictToProduct: boolean;
  placement: "before-footer" | "after-main" | "end-of-body";
  iconStyle: "chevron" | "plus";
  allowMultiple: boolean;
  firstOpen: boolean;
  maxItems: number;
  enableSchema: boolean;
  backgroundColor: string;
  textColor: string;
  accentColor: string;
  borderColor: string;
  borderRadius: number;
  itemGap: number;
  maxWidth: number;
  items: IFaqItem[];
  createdAt: Date;
  updatedAt: Date;
}

const DEFAULT_ITEMS: IFaqItem[] = [
  {
    question: "What is your return policy?",
    answer:
      "We accept returns within 30 days of delivery for unused items in original packaging.",
    active: true,
  },
  {
    question: "How long does shipping take?",
    answer:
      "Standard shipping takes 3–5 business days. Express options are available at checkout.",
    active: true,
  },
  {
    question: "Do you ship internationally?",
    answer: "Yes, we ship to most countries. Rates and times are calculated at checkout.",
    active: true,
  },
];

const faqItemSchema = new Schema<IFaqItem>(
  {
    question: { type: String, default: "" },
    answer: { type: String, default: "" },
    active: { type: Boolean, default: true },
  },
  { _id: false },
);

const faqSettingsSchema = new Schema<IFaqSettings>(
  {
    shopId: { type: String, required: true, unique: true },
    enabled: { type: Boolean, default: false },
    heading: { type: String, default: "Frequently Asked Questions" },
    subheading: { type: String, default: "" },
    restrictToProduct: { type: Boolean, default: true },
    placement: {
      type: String,
      enum: ["before-footer", "after-main", "end-of-body"],
      default: "before-footer",
    },
    iconStyle: { type: String, enum: ["chevron", "plus"], default: "chevron" },
    allowMultiple: { type: Boolean, default: false },
    firstOpen: { type: Boolean, default: true },
    maxItems: { type: Number, default: 0 },
    enableSchema: { type: Boolean, default: true },
    backgroundColor: { type: String, default: "#ffffff" },
    textColor: { type: String, default: "#111827" },
    accentColor: { type: String, default: "#5C6AC4" },
    borderColor: { type: String, default: "#e5e7eb" },
    borderRadius: { type: Number, default: 8 },
    itemGap: { type: Number, default: 8 },
    maxWidth: { type: Number, default: 880 },
    items: { type: [faqItemSchema], default: DEFAULT_ITEMS },
  },
  { timestamps: true },
);

export const FaqSettings: Model<IFaqSettings> =
  mongoose.models.FaqSettings ||
  mongoose.model<IFaqSettings>("FaqSettings", faqSettingsSchema);

export async function getOrCreateFaqSettings(shopId: string): Promise<IFaqSettings> {
  let settings = await FaqSettings.findOne({ shopId });
  if (!settings) {
    settings = await FaqSettings.create({ shopId });
  }
  return settings;
}
