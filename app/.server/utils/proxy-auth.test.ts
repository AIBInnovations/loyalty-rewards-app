import crypto from "crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getCustomerIdFromProxy, verifyAppProxySignature } from "./proxy-auth";

const SECRET = "test-api-secret";

/** Build a correctly-signed param set the way Shopify does. */
function sign(params: Record<string, string | string[]>): URLSearchParams {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) value.forEach((v) => search.append(key, v));
    else search.set(key, value);
  }

  const message = Object.entries(params)
    .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(",") : value}`)
    .sort()
    .join("");

  search.set(
    "signature",
    crypto.createHmac("sha256", SECRET).update(message).digest("hex"),
  );
  return search;
}

describe("verifyAppProxySignature", () => {
  const original = process.env.SHOPIFY_API_SECRET;

  beforeEach(() => {
    process.env.SHOPIFY_API_SECRET = SECRET;
  });

  afterEach(() => {
    process.env.SHOPIFY_API_SECRET = original;
  });

  it("accepts a correctly signed request", () => {
    const params = sign({ shop: "demo.myshopify.com", path_prefix: "/apps/loyalty" });
    expect(verifyAppProxySignature(params)).toBe(true);
  });

  it("accepts repeated params joined with a comma, per Shopify's spec", () => {
    const params = sign({ shop: "demo.myshopify.com", ids: ["1", "2", "3"] });
    expect(verifyAppProxySignature(params)).toBe(true);
  });

  it("rejects a tampered parameter", () => {
    const params = sign({ shop: "demo.myshopify.com" });
    params.set("shop", "attacker.myshopify.com");
    expect(verifyAppProxySignature(params)).toBe(false);
  });

  it("rejects an added parameter", () => {
    const params = sign({ shop: "demo.myshopify.com" });
    params.set("logged_in_customer_id", "999");
    expect(verifyAppProxySignature(params)).toBe(false);
  });

  it("rejects a missing signature", () => {
    const params = sign({ shop: "demo.myshopify.com" });
    params.delete("signature");
    expect(verifyAppProxySignature(params)).toBe(false);
  });

  it("rejects a malformed (non-hex, wrong-length) signature without throwing", () => {
    const params = sign({ shop: "demo.myshopify.com" });
    params.set("signature", "not-a-hex-signature");
    expect(verifyAppProxySignature(params)).toBe(false);
  });

  it("fails closed when the secret is not configured", () => {
    const params = sign({ shop: "demo.myshopify.com" });
    delete process.env.SHOPIFY_API_SECRET;
    expect(verifyAppProxySignature(params)).toBe(false);
  });
});

describe("getCustomerIdFromProxy", () => {
  it("returns the signed customer id when present", () => {
    const params = new URLSearchParams({ logged_in_customer_id: "42" });
    expect(getCustomerIdFromProxy(params)).toBe("42");
  });

  it("returns null for a logged-out visitor", () => {
    expect(getCustomerIdFromProxy(new URLSearchParams())).toBeNull();
  });
});
