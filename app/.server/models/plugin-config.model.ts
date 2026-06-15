import mongoose, { type Document, type Model, Schema } from "mongoose";

export interface IPluginConfig extends Document {
  shopId: string;
  pluginKey: string;
  enabled: boolean;
  config: Record<string, unknown>;
  version: string;
  health: "unknown" | "healthy" | "warning" | "failed";
  lastHealthCheckAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const pluginConfigSchema = new Schema<IPluginConfig>(
  {
    shopId: { type: String, required: true, index: true },
    pluginKey: { type: String, required: true, index: true },
    enabled: { type: Boolean, default: false },
    config: { type: Schema.Types.Mixed, default: {} },
    version: { type: String, default: "1.0.0" },
    health: {
      type: String,
      enum: ["unknown", "healthy", "warning", "failed"],
      default: "unknown",
    },
    lastHealthCheckAt: { type: Date },
  },
  { timestamps: true },
);

pluginConfigSchema.index({ shopId: 1, pluginKey: 1 }, { unique: true });

export const PluginConfig: Model<IPluginConfig> =
  mongoose.models.PluginConfig ||
  mongoose.model<IPluginConfig>("PluginConfig", pluginConfigSchema);
