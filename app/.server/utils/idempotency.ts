/**
 * Generate idempotency keys for various operations.
 * These are stored as unique indexes in the transactions collection
 * to prevent duplicate processing from webhook retries.
 */

export function orderPaidKey(orderId: string): string {
  return `order_paid_${orderId}`;
}

export function orderCancelledKey(orderId: string): string {
  return `order_cancelled_${orderId}`;
}

export function refundKey(refundId: string): string {
  return `refund_${refundId}`;
}

export function signupBonusKey(customerId: string): string {
  return `signup_bonus_${customerId}`;
}

export function referralBonusKey(
  referrerId: string,
  referredId: string,
): string {
  return `referral_${referrerId}_${referredId}`;
}

export function birthdayBonusKey(customerId: string, year: number): string {
  return `birthday_${customerId}_${year}`;
}

export function socialShareKey(
  customerId: string,
  platform: string,
  date: string,
): string {
  return `social_${customerId}_${platform}_${date}`;
}
