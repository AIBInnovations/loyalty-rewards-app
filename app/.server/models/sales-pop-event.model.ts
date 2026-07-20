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
  /** Shopify customer id, so GDPR customers/redact can find these rows. */
  shopifyCustomerId?: string;
  // Raw identity fields.
  //
  // NOTE: the previous "server-side only; never exposed" comment was wrong —
  // these are read by formatDisplayName/formatDisplayLocation and surfaced to
  // anonymous storefront visitors via the proxy feed. Treat them as PII: they
  // are subject to the TTL below and to customers/redact.
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

    shopifyCustomerId: { type: String, index: true },

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

// The feed also filters by productHandle and by collection; without these the
// per-pop queries scan. Each covers its filter plus the purchasedAt sort.
salesPopEventSchema.index({
  shopId: 1,
  isActive: 1,
  productHandle: 1,
  purchasedAt: -1,
});
salesPopEventSchema.index({
  shopId: 1,
  isActive: 1,
  collectionIds: 1,
  purchasedAt: -1,
});

// Retention: these rows hold buyer names and locations and were previously
// kept forever with no cleanup path. 90 days is ample for a "recent purchase"
// feed and bounds the exposure window.
salesPopEventSchema.index(
  { purchasedAt: 1 },
  { expireAfterSeconds: 60 * 60 * 24 * 90 },
);

export const SalesPopEvent: Model<ISalesPopEvent> =
  mongoose.models.SalesPopEvent ||
  mongoose.model<ISalesPopEvent>("SalesPopEvent", salesPopEventSchema);
