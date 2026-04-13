import mongoose, { type Document, type Model, Schema } from "mongoose";

export interface IImageEmbedding extends Document {
  shopId: string;
  productId: string;
  variantId: string;
  imageUrl: string;
  imageHash: string;
  embedding: number[];
  modelVersion: string;
  productTitle: string;
  productHandle: string;
  price: number;
  isActive: boolean;
  indexedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const imageEmbeddingSchema = new Schema<IImageEmbedding>(
  {
    shopId: { type: String, required: true, index: true },
    productId: { type: String, required: true },
    variantId: { type: String, default: "" },
    imageUrl: { type: String, required: true },
    imageHash: { type: String, default: "" },
    embedding: { type: [Number], required: true },
    modelVersion: { type: String, default: "clip-vit-base-patch32-v1" },
    productTitle: { type: String, default: "" },
    productHandle: { type: String, default: "" },
    price: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true, index: true },
    indexedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

// Compound unique index: one embedding per (shop, imageUrl)
imageEmbeddingSchema.index({ shopId: 1, imageUrl: 1 }, { unique: true });

export const ImageEmbedding: Model<IImageEmbedding> =
  mongoose.models.ImageEmbedding ||
  mongoose.model<IImageEmbedding>("ImageEmbedding", imageEmbeddingSchema);
