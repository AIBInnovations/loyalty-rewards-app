import mongoose, { type Document, type Model, Schema } from "mongoose";

export interface IImageSearchSettings extends Document {
  shopId: string;
  enabled: boolean;
  maxResults: number;
  minScore: number;
  showPrice: boolean;
  showAddToCart: boolean;
  primaryColor: string;
  buttonText: string;
  modalTitle: string;
  lastSyncedAt: Date | null;
  totalIndexed: number;
  _accessToken: string; // cached for background sync
  createdAt: Date;
  updatedAt: Date;
}

const imageSearchSettingsSchema = new Schema<IImageSearchSettings>(
  {
    shopId: { type: String, required: true, unique: true },
    enabled: { type: Boolean, default: false },
    maxResults: { type: Number, default: 8, min: 1, max: 20 },
    minScore: { type: Number, default: 0.5, min: 0, max: 1 },
    showPrice: { type: Boolean, default: true },
    showAddToCart: { type: Boolean, default: true },
    primaryColor: { type: String, default: "#5C6AC4" },
    buttonText: { type: String, default: "Find Similar Products" },
    modalTitle: { type: String, default: "Image Search" },
    lastSyncedAt: { type: Date, default: null },
    totalIndexed: { type: Number, default: 0 },
    _accessToken: { type: String, default: "" },
  },
  { timestamps: true },
);

export const ImageSearchSettings: Model<IImageSearchSettings> =
  mongoose.models.ImageSearchSettings ||
  mongoose.model<IImageSearchSettings>(
    "ImageSearchSettings",
    imageSearchSettingsSchema,
  );

export async function getOrCreateImageSearchSettings(
  shopId: string,
): Promise<IImageSearchSettings> {
  let settings = await ImageSearchSettings.findOne({ shopId });
  if (!settings) {
    settings = await ImageSearchSettings.create({ shopId });
  }
  return settings;
}
