import crypto from "crypto";

/**
 * Verify Shopify App Proxy signature.
 *
 * Shopify sends all query params + a `signature` param.
 * To verify: sort all params (except `signature`), concatenate as key=value,
 * then HMAC-SHA256 with the app's API secret.
 *
 * @see https://shopify.dev/docs/apps/online-store/app-proxies#verify-the-signature
 */
export function verifyAppProxySignature(
  queryParams: URLSearchParams,
): boolean {
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) {
    console.error("SHOPIFY_API_SECRET not set, cannot verify proxy signature");
    return false;
  }

  const signature = queryParams.get("signature");
  if (!signature) {
    return false;
  }

  // Build the message: sort ALL params except 'signature', concatenate as key=value.
  // Shopify signs everything in the URL including custom params, and joins
  // repeated keys with a comma (key=v1,v2). Emitting them as separate entries
  // fails closed rather than open, but breaks any endpoint sent an array param.
  const grouped = new Map<string, string[]>();
  for (const [key, value] of queryParams.entries()) {
    if (key === "signature") continue;
    const existing = grouped.get(key);
    if (existing) existing.push(value);
    else grouped.set(key, [value]);
  }

  const message = [...grouped.entries()]
    .map(([key, values]) => `${key}=${values.join(",")}`)
    .sort()
    .join("");

  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(message)
    .digest("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, "hex"),
      Buffer.from(expectedSignature, "hex"),
    );
  } catch (e) {
    // timingSafeEqual throws if lengths differ
    console.error("Signature length mismatch");
    return false;
  }
}

/**
 * Extract the logged-in customer ID from App Proxy request.
 * Shopify adds `logged_in_customer_id` when a customer is authenticated.
 */
export function getCustomerIdFromProxy(
  queryParams: URLSearchParams,
): string | null {
  return queryParams.get("logged_in_customer_id") || null;
}
