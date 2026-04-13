import mongoose, { type Document, type Model, Schema } from "mongoose";

export interface IImageSearchLog extends Document {
  shopId: string;
  sessionId: string;
  customerId: string;
  queryImageHash: string;
  resultsCount: number;
  topScore: number;
  clickedProductId: string;
  clickedPosition: number;
  convertedToCart: boolean;
  durationMs: number;
  error: string;
  createdAt: Date;
  updatedAt: Date;
}

const imageSearchLogSchema = new Schema<IImageSearchLog>(
  {
    shopId: { type: String, required: true, index: true },
    sessionId: { type: String, default: "" },
    customerId: { type: String, default: "" },
    queryImageHash: { type: String, default: "" },
    resultsCount: { type: Number, default: 0 },
    topScore: { type: Number, default: 0 },
    clickedProductId: { type: String, default: "" },
    clickedPosition: { type: Number, default: 0 },
    convertedToCart: { type: Boolean, default: false },
    durationMs: { type: Number, default: 0 },
    error: { type: String, default: "" },
  },
  { timestamps: true },
);

export const ImageSearchLog: Model<IImageSearchLog> =
  mongoose.models.ImageSearchLog ||
  mongoose.model<IImageSearchLog>("ImageSearchLog", imageSearchLogSchema);
