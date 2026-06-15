import mongoose, { type Document, type Model, Schema } from "mongoose";
import { encryptSecret } from "../crypto.server";

export type ShopTokenType = "offline" | "online" | "session";

export interface IShopToken extends Document {
  shopId: string;
  tokenType: ShopTokenType;
  encryptedToken: string;
  scopes: string[];
  expiresAt?: Date;
  lastRotatedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const shopTokenSchema = new Schema<IShopToken>(
  {
    shopId: { type: String, required: true, index: true },
    tokenType: {
      type: String,
      enum: ["offline", "online", "session"],
      required: true,
      index: true,
    },
    encryptedToken: { type: String, required: true },
    scopes: { type: [String], default: [] },
    expiresAt: { type: Date },
    lastRotatedAt: { type: Date },
  },
  { timestamps: true },
);

shopTokenSchema.index({ shopId: 1, tokenType: 1 }, { unique: true });

export const ShopToken: Model<IShopToken> =
  mongoose.models.ShopToken ||
  mongoose.model<IShopToken>("ShopToken", shopTokenSchema);

export async function upsertShopToken(input: {
  shopId: string;
  tokenType: ShopTokenType;
  token: string;
  scopes?: string[];
  expiresAt?: Date;
}) {
  return ShopToken.findOneAndUpdate(
    { shopId: input.shopId, tokenType: input.tokenType },
    {
      $set: {
        encryptedToken: encryptSecret(input.token),
        scopes: input.scopes || [],
        expiresAt: input.expiresAt,
        lastRotatedAt: new Date(),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}
