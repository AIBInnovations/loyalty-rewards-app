import mongoose, { type Document, type Model, Schema } from "mongoose";

export type AbandonedCartStatus =
  | "detected"
  | "scheduled"
  | "calling"
  | "called"
  | "recovered"
  | "declined"
  | "no_answer"
  | "expired"
  | "skipped";

export interface ICartItem {
  productId: string;
  title: string;
  quantity: number;
  price: number;
  imageUrl: string;
}

export interface IAbandonedCart extends Document {
  shopId: string;
  shopifyCheckoutId: string;
  shopifyCheckoutToken: string;
  customerEmail: string;
  customerPhone: string;
  customerName: string;
  customerId: string;
  cartItems: ICartItem[];
  cartTotal: number;
  currency: string;
  abandonedCheckoutUrl: string;
  // Pipeline
  status: AbandonedCartStatus;
  callScheduledAt?: Date;
  callMadeAt?: Date;
  callDuration?: number;
  callId?: string; // Sarvam call ID
  callOutcome?: string;
  callTranscript?: string;
  callRecordingUrl?: string;
  discountCodeOffered?: string;
  recoveredOrderId?: string;
  // Metadata
  detectedAt: Date;
  expiresAt: Date;
  skipReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const cartItemSchema = new Schema<ICartItem>(
  {
    productId: String,
    title: String,
    quantity: Number,
    price: Number,
    imageUrl: String,
  },
  { _id: false },
);

const abandonedCartSchema = new Schema<IAbandonedCart>(
  {
    shopId: { type: String, required: true, index: true },
    shopifyCheckoutId: { type: String, required: true },
    shopifyCheckoutToken: { type: String },
    customerEmail: { type: String },
    customerPhone: { type: String },
    customerName: { type: String },
    customerId: { type: String },
    cartItems: { type: [cartItemSchema], default: [] },
    cartTotal: { type: Number, default: 0 },
    currency: { type: String, default: "INR" },
    abandonedCheckoutUrl: { type: String },
    status: {
      type: String,
      enum: ["detected", "scheduled", "calling", "called", "recovered", "declined", "no_answer", "expired", "skipped"],
      default: "detected",
    },
    callScheduledAt: { type: Date },
    callMadeAt: { type: Date },
    callDuration: { type: Number },
    callId: { type: String },
    callOutcome: { type: String },
    callTranscript: { type: String },
    callRecordingUrl: { type: String },
    discountCodeOffered: { type: String },
    recoveredOrderId: { type: String },
    detectedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date },
    skipReason: { type: String },
  },
  { timestamps: true },
);

// Compound index: unique per shop + checkout
abandonedCartSchema.index({ shopId: 1, shopifyCheckoutId: 1 }, { unique: true });
// For finding carts ready to call
abandonedCartSchema.index({ status: 1, callScheduledAt: 1 });
// For expiry cleanup
abandonedCartSchema.index({ status: 1, expiresAt: 1 });

export const AbandonedCart: Model<IAbandonedCart> =
  mongoose.models.AbandonedCart ||
  mongoose.model<IAbandonedCart>("AbandonedCart", abandonedCartSchema);
