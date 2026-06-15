import mongoose, { type Document, type Model, Schema } from "mongoose";

export interface IProductCache extends Document {
  shopId: string;
  shopifyProductId: string;
  title: string;
  handle: string;
  status: string;
  productJson: Record<string, unknown>;
  syncedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const productCacheSchema = new Schema<IProductCache>(
  {
    shopId: { type: String, required: true, index: true },
    shopifyProductId: { type: String, required: true },
    title: { type: String, default: "" },
    handle: { type: String, default: "" },
    status: { type: String, default: "" },
    productJson: { type: Schema.Types.Mixed, default: {} },
    syncedAt: { type: Date },
  },
  { timestamps: true },
);

productCacheSchema.index({ shopId: 1, shopifyProductId: 1 }, { unique: true });
productCacheSchema.index({ shopId: 1, handle: 1 });

export const ProductCache: Model<IProductCache> =
  mongoose.models.ProductCache ||
  mongoose.model<IProductCache>("ProductCache", productCacheSchema);
