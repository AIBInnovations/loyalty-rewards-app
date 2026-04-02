import mongoose, { type Document, type Model, Schema } from "mongoose";

export interface ICustomer extends Document {
  shopId: string;
  shopifyCustomerId: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  currentBalance: number;
  lifetimeEarned: number;
  lifetimeRedeemed: number;
  tier: string;
  referralCode: string;
  referredBy?: string;
  birthday?: Date;
  birthdayBonusLastAwarded?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const customerSchema = new Schema<ICustomer>(
  {
    shopId: { type: String, required: true, index: true },
    shopifyCustomerId: { type: String, required: true },
    email: { type: String },
    firstName: { type: String },
    lastName: { type: String },
    currentBalance: { type: Number, default: 0, min: 0 },
    lifetimeEarned: { type: Number, default: 0 },
    lifetimeRedeemed: { type: Number, default: 0 },
    tier: { type: String, default: "Bronze" },
    referralCode: { type: String, unique: true, sparse: true },
    referredBy: { type: String },
    birthday: { type: Date },
    birthdayBonusLastAwarded: { type: Date },
  },
  { timestamps: true },
);

// Compound unique index: one record per customer per shop
customerSchema.index({ shopId: 1, shopifyCustomerId: 1 }, { unique: true });

export const Customer: Model<ICustomer> =
  mongoose.models.Customer || mongoose.model<ICustomer>("Customer", customerSchema);
