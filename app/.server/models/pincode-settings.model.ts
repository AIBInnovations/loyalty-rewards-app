import mongoose, { type Document, type Model, Schema } from "mongoose";

export interface IPincodeSettings extends Document {
  shopId: string;
  enabled: boolean;
  defaultMinDays: number;
  defaultMaxDays: number;
  // CSV-style lists stored as arrays
  codPincodes: string[];         // COD available pincodes (empty = all)
  noCodPincodes: string[];       // Pincodes where COD is NOT available
  nonServiceablePincodes: string[]; // Undeliverable pincodes
  createdAt: Date;
  updatedAt: Date;
}

const pincodeSettingsSchema = new Schema<IPincodeSettings>(
  {
    shopId:                   { type: String, required: true, unique: true },
    enabled:                  { type: Boolean, default: true },
    defaultMinDays:           { type: Number, default: 3 },
    defaultMaxDays:           { type: Number, default: 7 },
    codPincodes:              { type: [String], default: [] },
    noCodPincodes:            { type: [String], default: [] },
    nonServiceablePincodes:   { type: [String], default: [] },
  },
  { timestamps: true },
);

export const PincodeSettings: Model<IPincodeSettings> =
  mongoose.models.PincodeSettings ||
  mongoose.model<IPincodeSettings>("PincodeSettings", pincodeSettingsSchema);

export async function getOrCreatePincodeSettings(shopId: string): Promise<IPincodeSettings> {
  let s = await PincodeSettings.findOne({ shopId });
  if (!s) s = await PincodeSettings.create({ shopId });
  return s;
}
