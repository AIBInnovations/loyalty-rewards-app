import crypto from "crypto";
import { createCookie, redirect } from "@remix-run/node";
import { connectDB } from "../db.server";
import {
  AdminUser,
  type AdminRole,
  type IAdminUser,
} from "./models/admin-user.model";
import { AdminSessionModel } from "./models/admin-session.model";

const SESSION_TTL_SECONDS = 60 * 60 * 8;

/** Failed-login throttling. In-memory is adequate for a single admin surface. */
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

/**
 * The admin cookie signing secret. Required — no fallback.
 *
 * This previously chained to SHOPIFY_API_SECRET and then to the literal
 * "loyalty-admin-dev-secret". Since the cookie payload was a self-asserted
 * {email, role} that was never checked against the database, anyone who knew
 * that public constant could forge {"role":"super_admin"} and read and write
 * every tenant's data without a password. Falling back to SHOPIFY_API_SECRET
 * was also a key-separation failure: one leaked value both forged proxy HMACs
 * and signed admin sessions.
 */
function requireSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "SESSION_SECRET must be set to at least 32 characters. " +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64url'))\"",
    );
  }
  return secret;
}

const adminCookie = createCookie("loyalty_admin_session", {
  httpOnly: true,
  maxAge: SESSION_TTL_SECONDS,
  path: "/",
  sameSite: "lax",
  // Default to secure; opt out only via an explicit dev flag. Tying this to
  // NODE_ENV meant a deploy that forgot to flip it sent admin cookies in clear.
  secure: process.env.ALLOW_INSECURE_COOKIES !== "1",
  secrets: [requireSessionSecret()],
});

/**
 * What the cookie carries. Deliberately only an opaque session id — role and
 * shop scoping are re-read from the database on every request so that
 * disabling an admin, demoting them, or logging them out takes effect
 * immediately rather than at cookie expiry.
 */
type AdminCookiePayload = { sid: string };

export type AdminSession = {
  email: string;
  role: AdminRole;
  allowedShops: string[];
};

const rolePermissions: Record<AdminRole, string[]> = {
  super_admin: ["*"],
  operations_admin: [
    "stores:write",
    "sync:write",
    "plugins:write",
    "storefront:write",
    "logs:read",
  ],
  support_admin: ["stores:read", "logs:read", "catalog:read"],
  billing_admin: ["billing:write", "stores:read"],
};

export function hashAdminPassword(password: string) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto
    .pbkdf2Sync(password, salt, 210000, 32, "sha256")
    .toString("hex");
  return `${salt}:${hash}`;
}

function verifyAdminPassword(password: string, passwordHash: string) {
  const [salt, expected] = passwordHash.split(":");
  if (!salt || !expected) return false;

  const actual = crypto
    .pbkdf2Sync(password, salt, 210000, 32, "sha256")
    .toString("hex");

  // timingSafeEqual throws a RangeError on length mismatch, which turned a
  // malformed stored hash into a 500 instead of a clean auth failure.
  const actualBuf = Buffer.from(actual);
  const expectedBuf = Buffer.from(expected);
  if (actualBuf.length !== expectedBuf.length) return false;

  return crypto.timingSafeEqual(actualBuf, expectedBuf);
}

/** Returns true when the caller is within the failed-login budget. */
function checkLoginRateLimit(key: string): boolean {
  const now = Date.now();
  for (const [k, v] of loginAttempts) {
    if (v.resetAt < now) loginAttempts.delete(k);
  }
  const entry = loginAttempts.get(key);
  if (!entry || entry.resetAt < now) return true;
  return entry.count < LOGIN_MAX_ATTEMPTS;
}

function recordLoginFailure(key: string): void {
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || entry.resetAt < now) {
    loginAttempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
  } else {
    entry.count++;
  }
}

function clearLoginFailures(key: string): void {
  loginAttempts.delete(key);
}

/**
 * Auto-seeding a bootstrap admin has been removed.
 *
 * It previously ran on EVERY login attempt and, when ADMIN_USERNAME /
 * ADMIN_PASSWORD were unset, created a live super_admin with the credentials
 * admin / admin123 and access to every shop. Deleting or disabling the last
 * super_admin silently recreated it. The login page then advertised those
 * credentials to unauthenticated visitors.
 *
 * Create the first admin explicitly instead:
 *   npm run admin:create
 */

export type AdminAuthResult =
  | { ok: true; user: IAdminUser }
  | { ok: false; reason: "invalid" | "rate_limited" };

export async function authenticateAdminUser(
  username: string,
  password: string,
  rateLimitKey = "global",
): Promise<AdminAuthResult> {
  await connectDB();

  const email = username.trim().toLowerCase();
  const throttleKey = `${rateLimitKey}:${email}`;

  if (!checkLoginRateLimit(throttleKey)) {
    return { ok: false, reason: "rate_limited" };
  }

  const user = await AdminUser.findOne({ email, status: "active" });

  if (!user?.passwordHash || !verifyAdminPassword(password, user.passwordHash)) {
    recordLoginFailure(throttleKey);
    return { ok: false, reason: "invalid" };
  }

  clearLoginFailures(throttleKey);
  user.lastLoginAt = new Date();
  await user.save();
  return { ok: true, user };
}

export function canAdmin(
  admin: Pick<IAdminUser, "role"> | AdminSession | null,
  permission: string,
) {
  if (!admin) return false;
  const permissions = rolePermissions[admin.role] || [];
  return permissions.includes("*") || permissions.includes(permission);
}

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Resolve the caller from the session store, re-reading role and shop scope
 * from the database each request so revocation and demotion take effect
 * immediately.
 */
export async function getAdminSession(
  request: Request,
): Promise<AdminSession | null> {
  const cookieHeader = request.headers.get("Cookie");
  const payload = (await adminCookie.parse(cookieHeader)) as
    | AdminCookiePayload
    | null;
  if (!payload || typeof payload !== "object" || !payload.sid) return null;

  await connectDB();

  const record = await AdminSessionModel.findOne({
    tokenHash: hashToken(payload.sid),
    revokedAt: { $exists: false },
    expiresAt: { $gt: new Date() },
  });
  if (!record) return null;

  const user = await AdminUser.findOne({
    _id: record.adminUserId,
    status: "active",
  });
  if (!user) return null;

  return {
    email: user.email,
    role: user.role,
    allowedShops: user.allowedShops || [],
  };
}

/**
 * Enforce per-admin shop scoping.
 *
 * `allowedShops` was stored on AdminUser and shown in the UI but consulted
 * nowhere, so a support_admin nominally restricted to one merchant could read
 * any other merchant's data by changing ?shop=. An empty list means "no shops"
 * for every role except super_admin, which is explicitly platform-wide.
 */
export function canAccessShop(admin: AdminSession | null, shopId: string) {
  if (!admin || !shopId) return false;
  if (admin.role === "super_admin") return true;
  return admin.allowedShops.includes(shopId);
}

export function assertShopAccess(admin: AdminSession | null, shopId: string) {
  if (!canAccessShop(admin, shopId)) {
    throw new Response("Forbidden", { status: 403 });
  }
}

/** The shops this admin may see listed. */
export function shopFilterFor(admin: AdminSession | null) {
  if (admin?.role === "super_admin") return {};
  return { shopId: { $in: admin?.allowedShops || [] } };
}

export async function isAdminAuthenticated(request: Request) {
  return Boolean(await getAdminSession(request));
}

export async function requireAdmin(request: Request) {
  const session = await getAdminSession(request);
  if (session) return session;

  const url = new URL(request.url);
  const redirectTo = `${url.pathname}${url.search}`;
  throw redirect(`/admin/login?redirectTo=${encodeURIComponent(redirectTo)}`);
}

export async function requireAdminPermission(
  request: Request,
  permission: string,
) {
  const session = await requireAdmin(request);
  if (canAdmin(session, permission)) return session;
  throw new Response("Forbidden", { status: 403 });
}

export async function createAdminSession(
  admin: IAdminUser,
  redirectTo = "/admin",
  meta: { ip?: string; userAgent?: string } = {},
) {
  await connectDB();

  // A fresh random id per login — the cookie no longer asserts identity, it
  // only references a server-side record we can revoke.
  const token = crypto.randomBytes(32).toString("base64url");

  await AdminSessionModel.create({
    tokenHash: hashToken(token),
    adminUserId: admin._id,
    ip: meta.ip,
    userAgent: meta.userAgent,
    expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000),
  });

  return redirect(redirectTo, {
    headers: {
      "Set-Cookie": await adminCookie.serialize({ sid: token }),
    },
  });
}

export async function destroyAdminSession(request?: Request) {
  // Revoke server-side too, so a copied cookie stops working immediately.
  if (request) {
    const payload = (await adminCookie.parse(
      request.headers.get("Cookie"),
    )) as AdminCookiePayload | null;
    if (payload?.sid) {
      await connectDB();
      await AdminSessionModel.updateOne(
        { tokenHash: hashToken(payload.sid) },
        { $set: { revokedAt: new Date() } },
      );
    }
  }

  return redirect("/admin/login", {
    headers: {
      "Set-Cookie": await adminCookie.serialize("", { maxAge: 0 }),
    },
  });
}

/** Revoke every session for an admin — use on disable, delete, or role change. */
export async function revokeAdminSessions(adminUserId: unknown) {
  await connectDB();
  await AdminSessionModel.updateMany(
    { adminUserId, revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date() } },
  );
}
