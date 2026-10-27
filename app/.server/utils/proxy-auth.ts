import crypto from "crypto";
import { loadShopifyApiSecrets } from "../shopify-apps.server";

/**
 * Verify Shopify App Proxy signature.
 *
 * Shopify sends all query params + a `signature` param.
 * To verify: sort all params (except `signature`), concatenate as key=value,
 * then HMAC-SHA256 with the app's API secret.
 *
 * This server can answer for several app registrations (see
 * shopify-apps.server.ts), so the signature is accepted if it verifies
 * against any configured app's secret. Shopify signs with the secret of the
 * app installed on the shop in the `shop` param, and that param is itself
 * covered by the signature.
 *
 * @see https://shopify.dev/docs/apps/online-store/app-proxies#verify-the-signature
 */
export function verifyAppProxySignature(
  queryParams: URLSearchParams,
): boolean {
  const secrets = loadShopifyApiSecrets();
  if (secrets.length === 0) {
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

  const received = Buffer.from(signature, "hex");

  return secrets.some((secret) => {
    const expected = crypto
      .createHmac("sha256", secret)
      .update(message)
      .digest();
    // timingSafeEqual throws if lengths differ, so compare lengths first.
    return (
      received.length === expected.length &&
      crypto.timingSafeEqual(received, expected)
    );
  });
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
