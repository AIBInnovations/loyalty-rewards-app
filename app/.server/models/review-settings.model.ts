import mongoose, { type Document, type Model, Schema } from "mongoose";

export interface IReviewSettings extends Document {
  shopId: string;
  enabled: boolean;
  autoApprove: boolean;
  allowPhotos: boolean;
  allowVideos: boolean;
  pointsForReview: number;
  createdAt: Date;
  updatedAt: Date;
}

const reviewSettingsSchema = new Schema<IReviewSettings>(
  {
    shopId:          { type: String, required: true, unique: true },
    enabled:         { type: Boolean, default: true },
    autoApprove:     { type: Boolean, default: false },
    allowPhotos:     { type: Boolean, default: true },
    allowVideos:     { type: Boolean, default: false },
    pointsForReview: { type: Number, default: 50 },
  },
  { timestamps: true },
);

export const ReviewSettings: Model<IReviewSettings> =
  mongoose.models.ReviewSettings ||
  mongoose.model<IReviewSettings>("ReviewSettings", reviewSettingsSchema);

export async function getOrCreateReviewSettings(shopId: string): Promise<IReviewSettings> {
  let s = await ReviewSettings.findOne({ shopId });
  if (!s) s = await ReviewSettings.create({ shopId });
  return s;
}
