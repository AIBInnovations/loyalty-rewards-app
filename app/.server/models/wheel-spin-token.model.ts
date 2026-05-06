import mongoose, { type Document, type Model, Schema } from "mongoose";

export interface IWheelSpinToken extends Document {
  token: string;
  shopId: string;
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
    prizeIndex: { type: Number, required: true },
    prizeLabel: { type: String, required: true },
    prizeDiscountType: { type: String, required: true },
    prizeDiscountValue: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    expireAfterSeconds: 600, // auto-delete after 10 minutes
  },
);

wheelSpinTokenSchema.index({ createdAt: 1 }, { expireAfterSeconds: 600 });

export const WheelSpinToken: Model<IWheelSpinToken> =
  mongoose.models.WheelSpinToken ||
  mongoose.model<IWheelSpinToken>("WheelSpinToken", wheelSpinTokenSchema);
