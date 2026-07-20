import mongoose, { type Document, type Model, Schema } from "mongoose";

export interface IWheelSpinToken extends Document {
  token: string;
  shopId: string;
  /**
   * Who span. Binds a token to one visitor so a prize cannot be re-rolled:
   * the preview endpoint was previously anonymous and unlimited, so a caller
   * could loop it until the jackpot came up and only then claim.
   */
  visitorKey: string;
  /** Set atomically on claim, so a token can only ever be redeemed once. */
  used: boolean;
  prizeIndex: number;
  prizeLabel: string;
  prizeDiscountType: string;
  prizeDiscountValue: number;
  createdAt: Date;
}

const wheelSpinTokenSchema = new Schema<IWheelSpinToken>(
  {
    token: { type: String, required: true, unique: true },
    shopId: { type: String, required: true },
    visitorKey: { type: String, required: true },
    used: { type: Boolean, default: false },
    prizeIndex: { type: Number, required: true },
    prizeLabel: { type: String, required: true },
    prizeDiscountType: { type: String, required: true },
    prizeDiscountValue: { type: Number, default: 0 },
  },
  { timestamps: true },
);

// Used to detect an outstanding unclaimed spin for a visitor.
wheelSpinTokenSchema.index({ shopId: 1, visitorKey: 1, used: 1, createdAt: -1 });

wheelSpinTokenSchema.index({ createdAt: 1 }, { expireAfterSeconds: 600 });

export const WheelSpinToken: Model<IWheelSpinToken> =
  mongoose.models.WheelSpinToken ||
  mongoose.model<IWheelSpinToken>("WheelSpinToken", wheelSpinTokenSchema);
