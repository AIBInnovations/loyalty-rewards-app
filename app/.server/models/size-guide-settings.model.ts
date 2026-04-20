import mongoose, { type Document, type Model, Schema } from "mongoose";

export interface ISizeGuideSettings extends Document {
  shopId: string;
  enabled: boolean;
  triggerLabel: string;
  showIcon: boolean;
  modalTitle: string;
  chartTitle: string;
  note: string;
  headersCm: string[];
  rowsCm: string[][];
  headersInches: string[];
  rowsInches: string[][];
  accentColor: string;
  textColor: string;
  rowAltColor: string;
  borderColor: string;
  createdAt: Date;
  updatedAt: Date;
}

const DEFAULT_HEADERS = ["AGE GROUP", "CHEST", "WAIST", "CHOLI LENGTH", "HIGH WAIST LEHENGA LENGTH"];

const DEFAULT_ROWS_CM = [
  ["0-3 M", "41", "43", "15", "41"],
  ["3-6 M", "43", "44", "15", "41"],
  ["6-9 M", "44", "44", "17", "43"],
  ["9-12 M", "46", "46", "17", "43"],
  ["1-1.5 Y", "48", "51", "20", "51"],
  ["1.5-2 Y", "51", "51", "22", "53"],
  ["2-3 Y", "53", "51", "22", "56"],
  ["3-4 Y", "55", "53", "23", "60"],
  ["4-5 Y", "56", "56", "24", "64"],
  ["5-6 Y", "57", "58", "24", "67"],
  ["6-7 Y", "58", "61", "25", "71"],
  ["7-8 Y", "61", "62", "27", "76"],
  ["8-9 Y", "64", "64", "28", "81"],
  ["9-10 Y", "66", "65", "29", "85"],
  ["10-11 Y", "69", "66", "29", "89"],
  ["11-12 Y", "72", "70", "30", "93"],
  ["12-13 Y", "76", "74", "33", "97"],
  ["13-14 Y", "80", "76", "36", "99"],
  ["14-15 Y", "84", "79", "38", "102"],
];

const DEFAULT_ROWS_INCHES = [
  ["0-3 M", "16.1", "16.9", "5.9", "16.1"],
  ["3-6 M", "16.9", "17.3", "5.9", "16.1"],
  ["6-9 M", "17.3", "17.3", "6.7", "16.9"],
  ["9-12 M", "18.1", "18.1", "6.7", "16.9"],
  ["1-1.5 Y", "18.9", "20.1", "7.9", "20.1"],
  ["1.5-2 Y", "20.1", "20.1", "8.7", "20.9"],
  ["2-3 Y", "20.9", "20.1", "8.7", "22.0"],
  ["3-4 Y", "21.7", "20.9", "9.1", "23.6"],
  ["4-5 Y", "22.0", "22.0", "9.4", "25.2"],
  ["5-6 Y", "22.4", "22.8", "9.4", "26.4"],
  ["6-7 Y", "22.8", "24.0", "9.8", "28.0"],
  ["7-8 Y", "24.0", "24.4", "10.6", "29.9"],
];

const sizeGuideSettingsSchema = new Schema<ISizeGuideSettings>(
  {
    shopId: { type: String, required: true, unique: true },
    enabled: { type: Boolean, default: false },
    triggerLabel: { type: String, default: "Size Chart" },
    showIcon: { type: Boolean, default: true },
    modalTitle: { type: String, default: "Size Charts" },
    chartTitle: { type: String, default: "Size Chart for Girls' High-Waist Lehengas" },
    note: {
      type: String,
      default: "Measurements may vary slightly. For best fit, compare with a well-fitting garment.",
    },
    headersCm: { type: [String], default: DEFAULT_HEADERS },
    rowsCm: { type: [[String]], default: DEFAULT_ROWS_CM },
    headersInches: { type: [String], default: DEFAULT_HEADERS },
    rowsInches: { type: [[String]], default: DEFAULT_ROWS_INCHES },
    accentColor: { type: String, default: "#d97706" },
    textColor: { type: String, default: "#1f2937" },
    rowAltColor: { type: String, default: "#fafafa" },
    borderColor: { type: String, default: "#e5e7eb" },
  },
  { timestamps: true },
);

export const SizeGuideSettings: Model<ISizeGuideSettings> =
  mongoose.models.SizeGuideSettings ||
  mongoose.model<ISizeGuideSettings>("SizeGuideSettings", sizeGuideSettingsSchema);

export async function getOrCreateSizeGuideSettings(shopId: string): Promise<ISizeGuideSettings> {
  let settings = await SizeGuideSettings.findOne({ shopId });
  if (!settings) {
    settings = await SizeGuideSettings.create({ shopId });
  }
  return settings;
}
