import mongoose, { type Document, type Model, Schema } from "mongoose";

export interface IOrderCache extends Document {
  shopId: string;
  shopifyOrderId: string;
  name: string;
  financialStatus: string;
  fulfillmentStatus: string;
  totalPrice: number;
  currency: string;
  orderJson: Record<string, unknown>;
  syncedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const orderCacheSchema = new Schema<IOrderCache>(
  {
    shopId: { type: String, required: true, index: true },
    shopifyOrderId: { type: String, required: true },
    name: { type: String, default: "" },
    financialStatus: { type: String, default: "" },
    fulfillmentStatus: { type: String, default: "" },
    totalPrice: { type: Number, default: 0 },
    currency: { type: String, default: "" },
    orderJson: { type: Schema.Types.Mixed, default: {} },
    syncedAt: { type: Date },
  },
  { timestamps: true },
);

orderCacheSchema.index({ shopId: 1, shopifyOrderId: 1 }, { unique: true });

export const OrderCache: Model<IOrderCache> =
  mongoose.models.OrderCache ||
  mongoose.model<IOrderCache>("OrderCache", orderCacheSchema);
