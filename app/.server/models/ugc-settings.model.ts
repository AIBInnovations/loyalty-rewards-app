import mongoose, { type Document, type Model, Schema } from "mongoose";

export interface IUGCPhoto {
  imageUrl: string;
  caption: string;
  productHandle: string;
  instagramUrl: string;
}

export interface IUGCSettings extends Document {
  shopId: string;
  enabled: boolean;
  title: string;
  photos: IUGCPhoto[];
  createdAt: Date;
  updatedAt: Date;
}

const ugcPhotoSchema = new Schema<IUGCPhoto>(
  {
    imageUrl:      { type: String, default: "" },
    caption:       { type: String, default: "" },
    productHandle: { type: String, default: "" },
    instagramUrl:  { type: String, default: "" },
  },
  { _id: false },
);

const ugcSettingsSchema = new Schema<IUGCSettings>(
  {
    shopId:  { type: String, required: true, unique: true },
    enabled: { type: Boolean, default: false },
    title:   { type: String, default: "As Seen On Instagram" },
    photos:  { type: [ugcPhotoSchema], default: [] },
  },
  { timestamps: true },
);

export const UGCSettings: Model<IUGCSettings> =
  mongoose.models.UGCSettings ||
  mongoose.model<IUGCSettings>("UGCSettings", ugcSettingsSchema);

export async function getOrCreateUGCSettings(shopId: string): Promise<IUGCSettings> {
  let s = await UGCSettings.findOne({ shopId });
  if (!s) s = await UGCSettings.create({ shopId });
  return s;
}
