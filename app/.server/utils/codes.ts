import crypto from "crypto";

/**
 * Generate a unique loyalty discount code.
 * Format: LYL-XXXXXXXX (8 random alphanumeric chars)
 */
export function generateDiscountCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // removed ambiguous chars: I,O,0,1
  let code = "LYL-";
  const bytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

/**
 * Generate a unique referral code for a customer.
 * Format: NAME-XXXXX (5 random alphanumeric chars)
 */
export function generateReferralCode(firstName?: string): string {
  const prefix = firstName
    ? firstName.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4)
    : "REF";
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let suffix = "";
  const bytes = crypto.randomBytes(5);
  for (let i = 0; i < 5; i++) {
    suffix += chars[bytes[i] % chars.length];
  }
  return `${prefix}-${suffix}`;
}
