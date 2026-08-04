export interface PincodeZone {
  key: string;
  label: string;
  min: number;
  max: number;
}

// Indian PIN code prefix (first 2 digits) → state/region zones.
export const PINCODE_ZONES: PincodeZone[] = [
  { key: "11-19", label: "Delhi, Haryana, Punjab, Himachal Pradesh, Jammu & Kashmir, Ladakh", min: 11, max: 19 },
  { key: "20-28", label: "Uttar Pradesh, Uttarakhand", min: 20, max: 28 },
  { key: "30-39", label: "Rajasthan, Gujarat", min: 30, max: 39 },
  { key: "40-44", label: "Maharashtra", min: 40, max: 44 },
  { key: "45-49", label: "Madhya Pradesh, Chhattisgarh", min: 45, max: 49 },
  { key: "50-59", label: "Andhra Pradesh, Telangana, Karnataka", min: 50, max: 59 },
  { key: "60-69", label: "Tamil Nadu, Kerala (incl. Lakshadweep)", min: 60, max: 69 },
  { key: "70-79", label: "West Bengal, Odisha, Assam, Northeastern states", min: 70, max: 79 },
  { key: "80-85", label: "Bihar, Jharkhand", min: 80, max: 85 },
];

export function getZoneForPincode(code: string): PincodeZone | undefined {
  const prefix = parseInt(code.slice(0, 2), 10);
  return PINCODE_ZONES.find((z) => prefix >= z.min && prefix <= z.max);
}
