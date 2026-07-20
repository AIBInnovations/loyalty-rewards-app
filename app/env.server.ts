/**
 * Fail fast on missing configuration.
 *
 * Previously every secret had a silent fallback — `apiSecretKey: ... || ""`,
 * `MONGODB_URI` defaulting to localhost — so a misconfigured production deploy
 * booted "healthy" and then failed at request time with a confusing error.
 * Importing this module throws once, at startup, listing everything missing.
 */

const REQUIRED = [
  "SHOPIFY_API_KEY",
  "SHOPIFY_API_SECRET",
  "SHOPIFY_APP_URL",
  "MONGODB_URI",
  "SCOPES",
] as const;

type RequiredKey = (typeof REQUIRED)[number];

function readEnv(): Record<RequiredKey, string> {
  const missing = REQUIRED.filter((key) => !process.env[key]?.trim());

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}.\n` +
        `See .env.example for the full list.`,
    );
  }

  return Object.fromEntries(
    REQUIRED.map((key) => [key, process.env[key] as string]),
  ) as Record<RequiredKey, string>;
}

export const env = readEnv();

/**
 * Optional per-feature configuration. These are checked at point of use rather
 * than at boot, since a shop may legitimately run without them — but each is
 * expected to fail closed when absent (see api.voice-webhook.tsx).
 */
export const optionalEnv = {
  elevenLabsWebhookSecret: process.env.ELEVENLABS_WEBHOOK_SECRET || "",
  hfApiToken: process.env.HF_API_TOKEN || "",
  smtpUser: process.env.SMTP_USER || "",
  smtpPass: process.env.SMTP_PASS || "",
  smtpFrom: process.env.SMTP_FROM || "",
};
