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

export interface CityZone {
  key: string;
  label: string;
  // 3-digit PIN code prefixes for this metro — unlike state zones, a metro
  // area isn't one contiguous prefix range (e.g. Delhi NCR spans Delhi,
  // Gurugram, Noida and Faridabad), so each zone lists the exact prefixes.
  prefixes: string[];
}

// Major metro cities, matched by PIN code prefix — takes priority over the
// state-wise zones above when a merchant wants a tighter delivery estimate
// for these metros specifically.
export const CITY_ZONES: CityZone[] = [
  { key: "mumbai", label: "Mumbai", prefixes: ["400"] },
  { key: "delhi-ncr", label: "Delhi (NCR)", prefixes: ["110", "121", "122", "201"] },
  { key: "bengaluru", label: "Bengaluru", prefixes: ["560"] },
  { key: "hyderabad", label: "Hyderabad", prefixes: ["500"] },
  { key: "chennai", label: "Chennai", prefixes: ["600"] },
  { key: "kolkata", label: "Kolkata", prefixes: ["700"] },
  { key: "pune-ahmedabad", label: "Pune & Ahmedabad", prefixes: ["411", "380"] },
];

export function getCityForPincode(code: string): CityZone | undefined {
  const prefix = code.slice(0, 3);
  return CITY_ZONES.find((c) => c.prefixes.includes(prefix));
}
