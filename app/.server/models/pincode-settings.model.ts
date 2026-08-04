import mongoose, { type Document, type Model, Schema } from "mongoose";

export interface IStateDeliveryDays {
  zoneKey: string; // PIN code prefix range key, e.g. "45-49" — see app/pincode-zones.ts
  minDays: number;
  maxDays: number;
}

export interface IPincodeSettings extends Document {
  shopId: string;
  enabled: boolean;
  defaultMinDays: number;
  defaultMaxDays: number;
  // CSV-style lists stored as arrays
  codPincodes: string[];         // COD available pincodes (empty = all)
  noCodPincodes: string[];       // Pincodes where COD is NOT available
  nonServiceablePincodes: string[]; // Undeliverable pincodes
  // State-wise (PIN code prefix range) delivery day overrides — takes
  // priority over defaultMinDays/defaultMaxDays for any zone listed here,
  // so a merchant can quote a different delivery window per state instead
  // of one blanket estimate for every deliverable pincode.
  stateDeliveryDays: IStateDeliveryDays[];
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
    stateDeliveryDays: {
      type: [
        {
          _id: false,
          zoneKey: { type: String, required: true },
          minDays: { type: Number, required: true },
          maxDays: { type: Number, required: true },
        },
      ],
      default: [],
    },
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
