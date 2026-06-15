import crypto from "crypto";

const algorithm = "aes-256-gcm";

function getEncryptionKey() {
  const raw =
    process.env.TOKEN_ENCRYPTION_KEY ||
    process.env.SESSION_SECRET ||
    process.env.SHOPIFY_API_SECRET ||
    "loyalty-development-encryption-key";

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
