import mongoose, { type Document, type Model, Schema } from "mongoose";

export type WishlistKind = "wishlist" | "saved";

export interface IWishlistItem extends Document {
  shopId: string;
  shopifyCustomerId: string;
  kind: WishlistKind;
  productId: string;
  variantId?: string;
  productHandle?: string;
  productTitle?: string;
  variantTitle?: string;
  imageUrl?: string;
  price?: number;
  quantity?: number;
  savedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const wishlistSchema = new Schema<IWishlistItem>(
  {
    shopId: { type: String, required: true, index: true },
    shopifyCustomerId: { type: String, required: true, index: true },
    kind: {
      type: String,
      enum: ["wishlist", "saved"],
      required: true,
    },
    productId: { type: String, required: true },
    variantId: { type: String },
    productHandle: { type: String },
    productTitle: { type: String },
    variantTitle: { type: String },
    imageUrl: { type: String },
    price: { type: Number },
    quantity: { type: Number, default: 1 },
    savedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

// Wishlist is product-level: one row per (shop, customer, product).
// Saved-for-later is variant-level: one row per (shop, customer, variant).
// Using a partial unique index per kind keeps both rules in a single collection.
wishlistSchema.index(
  { shopId: 1, shopifyCustomerId: 1, kind: 1, productId: 1 },
  { unique: true, partialFilterExpression: { kind: "wishlist" } },
);
wishlistSchema.index(
  { shopId: 1, shopifyCustomerId: 1, kind: 1, variantId: 1 },
  { unique: true, partialFilterExpression: { kind: "saved" } },
);
wishlistSchema.index({ shopId: 1, kind: 1, productId: 1 });

export const WishlistItem: Model<IWishlistItem> =
  mongoose.models.WishlistItem ||
  mongoose.model<IWishlistItem>("WishlistItem", wishlistSchema);
