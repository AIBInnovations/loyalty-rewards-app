import mongoose, { type Document, type Model, Schema } from "mongoose";

export interface IStorefrontConfig extends Document {
  shopId: string;
  theme: Record<string, unknown>;
  navigation: Record<string, unknown>;
  banners: Record<string, unknown>[];
  featureFlags: Record<string, boolean>;
  createdAt: Date;
  updatedAt: Date;
}

const storefrontConfigSchema = new Schema<IStorefrontConfig>(
  {
    shopId: { type: String, required: true, unique: true, index: true },
    theme: { type: Schema.Types.Mixed, default: {} },
    navigation: { type: Schema.Types.Mixed, default: {} },
    banners: { type: [Schema.Types.Mixed], default: [] },
    featureFlags: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

export const StorefrontConfig: Model<IStorefrontConfig> =
  mongoose.models.StorefrontConfig ||
  mongoose.model<IStorefrontConfig>("StorefrontConfig", storefrontConfigSchema);
