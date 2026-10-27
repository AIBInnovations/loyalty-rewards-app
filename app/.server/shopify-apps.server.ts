import crypto from "crypto";

/**
 * The Shopify app registrations this one server answers for.
 *
 * A custom-distribution app can only be installed on a single store, so every
 * merchant onboarded before the public listing is approved needs its own app
 * registration (its own client ID + secret). Rather than run one deployment
 * per registration, the server holds all of their credentials and picks the
 * right one per request:
 *
 *   - embedded admin requests: the session token's `aud` claim is the client ID
 *   - webhooks / app proxy:    whichever secret the HMAC verifies against
 *
 * SHOPIFY_API_KEY / SHOPIFY_API_SECRET stay as the primary app. Additional
 * registrations go in SHOPIFY_APPS as a JSON array:
 *
 *   SHOPIFY_APPS=[{"name":"denzlabel","apiKey":"...","apiSecret":"..."}]
 */
export interface ShopifyAppCredentials {
  name: string;
  apiKey: string;
  apiSecret: string;
}

type EnvSource = Record<string, string | undefined>;

const SHOPIFY_APPS_FORMAT =
  'Expected a JSON array like [{"name":"store","apiKey":"...","apiSecret":"..."}].';

let cachedRaw: string | undefined;
let cachedAdditional: ShopifyAppCredentials[] = [];

function parseAdditionalApps(raw: string | undefined): ShopifyAppCredentials[] {
  if (!raw?.trim()) return [];
  if (raw === cachedRaw) return cachedAdditional;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Never echo the raw value — it contains client secrets.
    throw new Error(`SHOPIFY_APPS is not valid JSON. ${SHOPIFY_APPS_FORMAT}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`SHOPIFY_APPS must be an array. ${SHOPIFY_APPS_FORMAT}`);
  }

  const apps = parsed.map((entry, index) => {
    const { name, apiKey, apiSecret } = (entry ?? {}) as Record<string, unknown>;
    if (
      typeof apiKey !== "string" ||
      !apiKey.trim() ||
      typeof apiSecret !== "string" ||
      !apiSecret.trim()
    ) {
      throw new Error(
        `SHOPIFY_APPS[${index}] needs both "apiKey" and "apiSecret". ${SHOPIFY_APPS_FORMAT}`,
      );
    }
    return {
      name: typeof name === "string" && name.trim() ? name.trim() : `app-${index + 1}`,
      apiKey: apiKey.trim(),
      apiSecret: apiSecret.trim(),
    };
  });

  cachedRaw = raw;
  cachedAdditional = apps;
  return apps;
}

/**
 * Every configured app, primary first. Read lazily from the environment so a
 * missing primary secret yields an empty list (callers fail closed) rather
 * than a stale cached value.
 */
export function loadShopifyApps(
  source: EnvSource = process.env,
): ShopifyAppCredentials[] {
  const apps: ShopifyAppCredentials[] = [];

  const apiKey = source.SHOPIFY_API_KEY?.trim();
  const apiSecret = source.SHOPIFY_API_SECRET?.trim();
  if (apiKey && apiSecret) {
    apps.push({ name: "primary", apiKey, apiSecret });
  }

  apps.push(...parseAdditionalApps(source.SHOPIFY_APPS));

  const seen = new Set<string>();
  for (const app of apps) {
    if (seen.has(app.apiKey)) {
      throw new Error(
        `Shopify app ${app.apiKey} is configured more than once (check SHOPIFY_API_KEY and SHOPIFY_APPS).`,
      );
    }
    seen.add(app.apiKey);
  }

  return apps;
}

/** Every configured app's secret, for HMACs that don't name the app. */
export function loadShopifyApiSecrets(source: EnvSource = process.env): string[] {
  const primary = source.SHOPIFY_API_SECRET?.trim();
  return [
    ...(primary ? [primary] : []),
    ...parseAdditionalApps(source.SHOPIFY_APPS).map((app) => app.apiSecret),
  ];
}

/**
 * Read the `aud` claim (the app's client ID) from a session token WITHOUT
 * verifying it. This only chooses which app's secret to verify against — the
 * Shopify library then checks the signature and the audience with that app's
 * credentials, so a forged token still fails authentication.
 */
export function readTokenAudience(
  token: string | null | undefined,
): string | undefined {
  const payload = token?.split(".")[1];
  if (!payload) return undefined;
  try {
    const { aud } = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );
    return typeof aud === "string" ? aud : undefined;
  } catch {
    return undefined;
  }
}

/** True when `hmacHeader` is the base64 HMAC-SHA256 of the raw webhook body. */
export function verifyWebhookHmac(
  rawBody: string,
  hmacHeader: string | null | undefined,
  apiSecret: string,
): boolean {
  if (!hmacHeader) return false;
  const expected = crypto
    .createHmac("sha256", apiSecret)
    .update(rawBody, "utf8")
    .digest();
  const received = Buffer.from(hmacHeader, "base64");
  return (
    received.length === expected.length &&
    crypto.timingSafeEqual(received, expected)
  );
}
