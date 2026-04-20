import mongoose, { type Document, type Model, Schema } from "mongoose";

export interface ISalesPopEvent extends Document {
  shopId: string;
  sourceOrderId: string;
  productId: string;
  variantId?: string;
  productHandle: string;
  productTitle: string;
  productImage?: string;
  collectionIds: string[];
  vendor?: string;
  // Raw identity fields (server-side only; never exposed)
  rawFirstName?: string;
  rawCity?: string;
  rawState?: string;
  rawCountry?: string;
  // Eligibility / lifecycle
  isActive: boolean;
  purchasedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const salesPopEventSchema = new Schema<ISalesPopEvent>(
  {
    shopId: { type: String, required: true, index: true },
    sourceOrderId: { type: String, required: true },
    productId: { type: String, required: true, index: true },
    variantId: { type: String },
    productHandle: { type: String, required: true },
    productTitle: { type: String, required: true },
    productImage: { type: String },
    collectionIds: { type: [String], default: [], index: true },
    vendor: { type: String },

    rawFirstName: { type: String },
    rawCity: { type: String },
    rawState: { type: String },
    rawCountry: { type: String },

    isActive: { type: Boolean, default: true, index: true },
    purchasedAt: { type: Date, required: true, index: true },
  },
  { timestamps: true },
);

// Prevent duplicate events for the same order+product line
salesPopEventSchema.index(
  { shopId: 1, sourceOrderId: 1, productId: 1 },
  { unique: true },
);

// Feed queries: shop + active + recent
salesPopEventSchema.index({ shopId: 1, isActive: 1, purchasedAt: -1 });

export const SalesPopEvent: Model<ISalesPopEvent> =
  mongoose.models.SalesPopEvent ||
  mongoose.model<ISalesPopEvent>("SalesPopEvent", salesPopEventSchema);
