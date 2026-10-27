import crypto from "crypto";
import { describe, expect, it } from "vitest";

import {
  loadShopifyApps,
  readTokenAudience,
  verifyWebhookHmac,
} from "./shopify-apps.server";

const PRIMARY = { SHOPIFY_API_KEY: "primary-key", SHOPIFY_API_SECRET: "primary-secret" };

/** An unsigned JWT-shaped token carrying the given payload. */
function token(payload: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256" })}.${encode(payload)}.signature`;
}

describe("loadShopifyApps", () => {
  it("returns only the primary app when SHOPIFY_APPS is unset", () => {
    expect(loadShopifyApps(PRIMARY)).toEqual([
      { name: "primary", apiKey: "primary-key", apiSecret: "primary-secret" },
    ]);
  });

  it("appends additional apps after the primary", () => {
    const apps = loadShopifyApps({
      ...PRIMARY,
      SHOPIFY_APPS: JSON.stringify([
        { name: "denzlabel", apiKey: "key-2", apiSecret: "secret-2" },
        { apiKey: "key-3", apiSecret: "secret-3" },
      ]),
    });
    expect(apps.map((app) => app.apiKey)).toEqual(["primary-key", "key-2", "key-3"]);
    expect(apps.map((app) => app.name)).toEqual(["primary", "denzlabel", "app-2"]);
  });

  it("returns no apps when the primary secret is missing", () => {
    expect(loadShopifyApps({ SHOPIFY_API_KEY: "primary-key" })).toEqual([]);
  });

  it("rejects malformed JSON without echoing the value", () => {
    const raw = '[{"apiKey":"key-2","apiSecret":"super-secret"';
    expect(() => loadShopifyApps({ ...PRIMARY, SHOPIFY_APPS: raw })).toThrow(
      /not valid JSON/,
    );
    try {
      loadShopifyApps({ ...PRIMARY, SHOPIFY_APPS: raw });
    } catch (error) {
      expect((error as Error).message).not.toContain("super-secret");
    }
  });

  it("rejects an entry missing its secret", () => {
    expect(() =>
      loadShopifyApps({
        ...PRIMARY,
        SHOPIFY_APPS: JSON.stringify([{ name: "x", apiKey: "key-2" }]),
      }),
    ).toThrow(/SHOPIFY_APPS\[0\]/);
  });

  it("rejects the same client ID configured twice", () => {
    expect(() =>
      loadShopifyApps({
        ...PRIMARY,
        SHOPIFY_APPS: JSON.stringify([
          { apiKey: "primary-key", apiSecret: "other-secret" },
        ]),
      }),
    ).toThrow(/more than once/);
  });
});

describe("readTokenAudience", () => {
  it("reads the aud claim", () => {
    expect(readTokenAudience(token({ aud: "key-2", dest: "https://a.myshopify.com" }))).toBe(
      "key-2",
    );
  });

  it("returns undefined for missing, malformed or aud-less tokens", () => {
    expect(readTokenAudience(null)).toBeUndefined();
    expect(readTokenAudience("not-a-jwt")).toBeUndefined();
    expect(readTokenAudience("a.%%%.c")).toBeUndefined();
    expect(readTokenAudience(token({ dest: "https://a.myshopify.com" }))).toBeUndefined();
  });
});

describe("verifyWebhookHmac", () => {
  const body = JSON.stringify({ id: 1 });
  const sign = (secret: string) =>
    crypto.createHmac("sha256", secret).update(body, "utf8").digest("base64");

  it("accepts the HMAC made with the same secret", () => {
    expect(verifyWebhookHmac(body, sign("secret-2"), "secret-2")).toBe(true);
  });

  it("rejects an HMAC made with another app's secret", () => {
    expect(verifyWebhookHmac(body, sign("secret-2"), "primary-secret")).toBe(false);
  });

  it("rejects a missing or malformed header without throwing", () => {
    expect(verifyWebhookHmac(body, null, "secret-2")).toBe(false);
    expect(verifyWebhookHmac(body, "short", "secret-2")).toBe(false);
  });
});
