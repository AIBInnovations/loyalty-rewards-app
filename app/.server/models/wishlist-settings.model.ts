import mongoose, { type Document, type Model, Schema } from "mongoose";

export interface IWishlistSettings extends Document {
  shopId: string;
  enabled: boolean;
  showWishlistButton: boolean;
  showSavedForLater: boolean;
  buttonLabelAdd: string;
  buttonLabelSaved: string;
  iconColor: string;
  activeColor: string;
  createdAt: Date;
  updatedAt: Date;
}

const wishlistSettingsSchema = new Schema<IWishlistSettings>(
  {
    shopId: { type: String, required: true, unique: true },
    enabled: { type: Boolean, default: false },
    showWishlistButton: { type: Boolean, default: true },
    showSavedForLater: { type: Boolean, default: true },
    buttonLabelAdd: { type: String, default: "Add to Wishlist" },
    buttonLabelSaved: { type: String, default: "In Wishlist" },
    iconColor: { type: String, default: "#222222" },
    activeColor: { type: String, default: "#e63946" },
  },
  { timestamps: true },
);

export const WishlistSettings: Model<IWishlistSettings> =
  mongoose.models.WishlistSettings ||
  mongoose.model<IWishlistSettings>("WishlistSettings", wishlistSettingsSchema);

export async function getOrCreateWishlistSettings(
  shopId: string,
): Promise<IWishlistSettings> {
  let s = await WishlistSettings.findOne({ shopId });
  if (!s) s = await WishlistSettings.create({ shopId });
  return s;
}
