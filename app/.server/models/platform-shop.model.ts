import mongoose, { type Document, type Model, Schema } from "mongoose";

export type PlatformShopStatus = "active" | "suspended" | "archived" | "uninstalled";

export interface IPlatformShop extends Document {
  shopId: string;
  shopDomain: string;
  shopifyShopId?: string;
  status: PlatformShopStatus;
  plan: string;
  scopes: string[];
  installedAt: Date;
  uninstalledAt?: Date;
  lastSeenAt?: Date;
  lastWebhookAt?: Date;
  lastSyncAt?: Date;
  notes: string;
  createdAt: Date;
  updatedAt: Date;
}

const platformShopSchema = new Schema<IPlatformShop>(
  {
    shopId: { type: String, required: true, unique: true, index: true },
    shopDomain: { type: String, required: true, index: true },
    shopifyShopId: { type: String, default: "" },
    status: {
      type: String,
      enum: ["active", "suspended", "archived", "uninstalled"],
      default: "active",
      index: true,
    },
    plan: { type: String, default: "free", index: true },
    scopes: { type: [String], default: [] },
    installedAt: { type: Date, default: Date.now },
    uninstalledAt: { type: Date },
    lastSeenAt: { type: Date },
    lastWebhookAt: { type: Date },
    lastSyncAt: { type: Date },
    notes: { type: String, default: "" },
  },
  { timestamps: true },
);

export const PlatformShop: Model<IPlatformShop> =
  mongoose.models.PlatformShop ||
  mongoose.model<IPlatformShop>("PlatformShop", platformShopSchema);

export async function upsertPlatformShop(input: {
  shopId: string;
  shopDomain?: string;
  shopifyShopId?: string;
  scopes?: string[];
  status?: PlatformShopStatus;
}) {
  const now = new Date();
  return PlatformShop.findOneAndUpdate(
    { shopId: input.shopId },
    {
      $set: {
        shopDomain: input.shopDomain || input.shopId,
        ...(input.shopifyShopId ? { shopifyShopId: input.shopifyShopId } : {}),
        ...(input.scopes ? { scopes: input.scopes } : {}),
        ...(input.status ? { status: input.status } : {}),
        lastSeenAt: now,
      },
      $setOnInsert: {
        installedAt: now,
        plan: "free",
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}
