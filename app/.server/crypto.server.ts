import crypto from "crypto";

const algorithm = "aes-256-gcm";

/**
 * The key protecting stored Shopify access tokens. Required — no fallback.
 *
 * This previously chained TOKEN_ENCRYPTION_KEY -> SESSION_SECRET ->
 * SHOPIFY_API_SECRET -> the literal "loyalty-development-encryption-key".
 * With the literal, anyone holding a database dump and the (public) source
 * could decrypt every merchant's Admin API token. Deriving from
 * SHOPIFY_API_SECRET was nearly as bad: one leaked value would both forge
 * app-proxy HMACs and decrypt every token.
 */
function getEncryptionKey() {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY must be set (32 bytes, base64). " +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
    );
  }

  // Accept raw 32-byte base64 directly; fall back to hashing a passphrase so
  // existing deployments that set a non-base64 value keep working.
  const decoded = Buffer.from(raw, "base64");
  if (decoded.length === 32) return decoded;

  return crypto.createHash("sha256").update(raw).digest();
}

export function encryptSecret(value: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(algorithm, getEncryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    iv.toString("base64"),
    authTag.toString("base64"),
    encrypted.toString("base64"),
  ].join(".");
}

export function decryptSecret(value: string) {
  const [ivRaw, authTagRaw, encryptedRaw] = value.split(".");
  if (!ivRaw || !authTagRaw || !encryptedRaw) return "";

  const decipher = crypto.createDecipheriv(
    algorithm,
    getEncryptionKey(),
    Buffer.from(ivRaw, "base64"),
  );
  decipher.setAuthTag(Buffer.from(authTagRaw, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
