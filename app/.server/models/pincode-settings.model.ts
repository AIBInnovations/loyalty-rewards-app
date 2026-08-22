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

  // ── Hybrid ETA (manual vs Shiprocket-automatic) ──────────────────────
  // "manual" (default, existing behaviour) uses the fields above as-is.
  // "shiprocket" calls the merchant's own connected Shiprocket account for
  // real courier serviceability/ETA, falling back to the manual fields
  // above whenever Shiprocket is unreachable, unconnected, or errors —
  // the storefront must never be left without an answer.
  etaMode: "manual" | "shiprocket";
  // Origin pincode used for Shiprocket serviceability calls — this app has
  // no Shopify Location integration yet, so this is the one merchant-set
  // pickup point (see eta-engine.server.ts for the fallback chain).
  pickupPincode: string;
  // Processing/handling days added before the courier's own transit time —
  // e.g. an order placed today with 1 handling day + 3 transit days ships
  // tomorrow and arrives the day after that.
  handlingDays: number;
  // Hour of day (0-23, in shopTimezone) after which an order is treated as
  // placed the next working day for handling-time purposes.
  cutoffHour: number;
  // Which weekdays count as working days for handling-time purposes —
  // 0=Sunday .. 6=Saturday. Defaults to Mon-Sat (no Sunday dispatch).
  workingDays: number[];
  // IANA timezone (e.g. "Asia/Kolkata") — fetched once from the Shopify
  // shop's own configured timezone via the Admin API when Shiprocket mode
  // is first enabled, never the server's or a browser's timezone.
  shopTimezone: string;

  // Shiprocket account credentials, isolated per shop. Password and token
  // are stored via encryptSecret()/decryptSecret() (app/.server/crypto.
  // server.ts) — never in plaintext, never sent to the storefront.
  shiprocketEmail: string;
  shiprocketPasswordEncrypted: string;
  shiprocketTokenEncrypted: string;
  shiprocketTokenExpiresAt: Date | null;
  shiprocketConnected: boolean;
  // Last connection/auth error, shown in the admin UI — cleared on the
  // next successful call.
  shiprocketLastError: string;

  // Widget appearance — set from the app's own settings page (not the theme
  // editor), applied by pincode-estimator.js at runtime.
  headingText: string;
  bgColor: string;
  buttonColor: string;
  buttonTextColor: string;
  buttonSize: "small" | "medium" | "large";
  sectionWidth: string;
  sectionHeight: string;
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

    etaMode:            { type: String, enum: ["manual", "shiprocket"], default: "manual" },
    pickupPincode:      { type: String, default: "", maxlength: 6 },
    handlingDays:       { type: Number, default: 1, min: 0, max: 14 },
    cutoffHour:         { type: Number, default: 18, min: 0, max: 23 },
    workingDays:        { type: [Number], default: [1, 2, 3, 4, 5, 6] },
    shopTimezone:       { type: String, default: "" },

    shiprocketEmail:              { type: String, default: "" },
    shiprocketPasswordEncrypted:  { type: String, default: "" },
    shiprocketTokenEncrypted:     { type: String, default: "" },
    shiprocketTokenExpiresAt:     { type: Date, default: null },
    shiprocketConnected:          { type: Boolean, default: false },
    shiprocketLastError:          { type: String, default: "" },

    headingText:     { type: String, default: "📦 Check Delivery & COD", maxlength: 60 },
    bgColor:         { type: String, default: "" },
    buttonColor:     { type: String, default: "" },
    buttonTextColor: { type: String, default: "" },
    buttonSize:      { type: String, enum: ["small", "medium", "large"], default: "medium" },
    sectionWidth:    { type: String, default: "", maxlength: 20 },
    sectionHeight:   { type: String, default: "", maxlength: 20 },
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
