import mongoose, { type Document, type Model, Schema } from "mongoose";

export interface IStorefrontDomain extends Document {
  shopId: string;
  domain: string;
  isPrimary: boolean;
  verifiedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const storefrontDomainSchema = new Schema<IStorefrontDomain>(
  {
    shopId: { type: String, required: true, index: true },
    domain: { type: String, required: true, lowercase: true, trim: true },
    isPrimary: { type: Boolean, default: false },
    verifiedAt: { type: Date },
  },
  { timestamps: true },
);

storefrontDomainSchema.index({ shopId: 1, domain: 1 }, { unique: true });
storefrontDomainSchema.index({ domain: 1 }, { unique: true });

export const StorefrontDomain: Model<IStorefrontDomain> =
  mongoose.models.StorefrontDomain ||
  mongoose.model<IStorefrontDomain>("StorefrontDomain", storefrontDomainSchema);
