import mongoose, { type Document, type Model, Schema } from "mongoose";

export interface IFeatureFlag extends Document {
  key: string;
  description: string;
  enabledByDefault: boolean;
  shopOverrides: {
    shopId: string;
    enabled: boolean;
  }[];
  createdAt: Date;
  updatedAt: Date;
}

const featureFlagSchema = new Schema<IFeatureFlag>(
  {
    key: { type: String, required: true, unique: true, index: true },
    description: { type: String, default: "" },
    enabledByDefault: { type: Boolean, default: false },
    shopOverrides: {
      type: [
        {
          shopId: { type: String, required: true },
          enabled: { type: Boolean, required: true },
        },
      ],
      default: [],
    },
  },
  { timestamps: true },
);

export const FeatureFlag: Model<IFeatureFlag> =
  mongoose.models.FeatureFlag ||
  mongoose.model<IFeatureFlag>("FeatureFlag", featureFlagSchema);
