import mongoose, { type Document, type Model, Schema } from "mongoose";

export interface ISubscription extends Document {
  shopId: string;
  plan: "free" | "pro" | "enterprise";
  billingState: "trial" | "active" | "past_due" | "cancelled" | "suspended";
  trialEndsAt?: Date;
  renewsAt?: Date;
  usageCaps: {
    maxPlugins: number;
    maxMonthlyOrders: number;
    maxAdmins: number;
  };
  premiumPlugins: string[];
  createdAt: Date;
  updatedAt: Date;
}

const subscriptionSchema = new Schema<ISubscription>(
  {
    shopId: { type: String, required: true, unique: true, index: true },
    plan: {
      type: String,
      enum: ["free", "pro", "enterprise"],
      default: "free",
      index: true,
    },
    billingState: {
      type: String,
      enum: ["trial", "active", "past_due", "cancelled", "suspended"],
      default: "trial",
      index: true,
    },
    trialEndsAt: { type: Date },
    renewsAt: { type: Date },
    usageCaps: {
      maxPlugins: { type: Number, default: 5 },
      maxMonthlyOrders: { type: Number, default: 1000 },
      maxAdmins: { type: Number, default: 1 },
    },
    premiumPlugins: { type: [String], default: [] },
  },
  { timestamps: true },
);

export const Subscription: Model<ISubscription> =
  mongoose.models.Subscription ||
  mongoose.model<ISubscription>("Subscription", subscriptionSchema);
