import mongoose, { type Document, type Model, Schema } from "mongoose";

export type ImageSyncJobType = "index" | "reindex" | "delete";
export type ImageSyncJobStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed";
export type ImageSyncJobTrigger = "webhook" | "manual" | "cron";

export interface IImageSyncJob extends Document {
  shopId: string;
  productId: string;
  productTitle: string;
  jobType: ImageSyncJobType;
  status: ImageSyncJobStatus;
  attempts: number;
  errorMessage: string;
  imageUrls: string[];
  processedImages: number;
  triggeredBy: ImageSyncJobTrigger;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const imageSyncJobSchema = new Schema<IImageSyncJob>(
  {
    shopId: { type: String, required: true, index: true },
    productId: { type: String, required: true },
    productTitle: { type: String, default: "" },
    jobType: {
      type: String,
      enum: ["index", "reindex", "delete"],
      default: "index",
    },
    status: {
      type: String,
      enum: ["pending", "processing", "completed", "failed"],
      default: "pending",
      index: true,
    },
    attempts: { type: Number, default: 0 },
    errorMessage: { type: String, default: "" },
    imageUrls: { type: [String], default: [] },
    processedImages: { type: Number, default: 0 },
    triggeredBy: {
      type: String,
      enum: ["webhook", "manual", "cron"],
      default: "webhook",
    },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

imageSyncJobSchema.index({ shopId: 1, productId: 1, status: 1 });

export const ImageSyncJob: Model<IImageSyncJob> =
  mongoose.models.ImageSyncJob ||
  mongoose.model<IImageSyncJob>("ImageSyncJob", imageSyncJobSchema);
