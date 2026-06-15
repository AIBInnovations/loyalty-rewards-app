import crypto from "crypto";
import { createCookie, redirect } from "@remix-run/node";
import { connectDB } from "../db.server";
import {
  AdminUser,
  type AdminRole,
  type IAdminUser,
} from "./models/admin-user.model";

const adminCookie = createCookie("loyalty_admin_session", {
  httpOnly: true,
  maxAge: 60 * 60 * 8,
  path: "/",
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  secrets: [
    process.env.SESSION_SECRET ||
      process.env.SHOPIFY_API_SECRET ||
      "loyalty-admin-dev-secret",
  ],
});

export function getAdminCredentials() {
  return {
    username: process.env.ADMIN_USERNAME || "admin",
    password: process.env.ADMIN_PASSWORD || "admin123",
  };
}

type AdminSession = {
  email: string;
  role: AdminRole;
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
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

async function ensureBootstrapAdmin() {
  const existing = await AdminUser.countDocuments({});
  if (existing > 0) return;

  const credentials = getAdminCredentials();
  await AdminUser.create({
    email: credentials.username.toLowerCase(),
    name: "Bootstrap admin",
    passwordHash: hashAdminPassword(credentials.password),
    role: "super_admin",
    status: "active",
    allowedShops: [],
  });
}

export async function authenticateAdminUser(username: string, password: string) {
  await connectDB();
  await ensureBootstrapAdmin();

  const user = await AdminUser.findOne({
    email: username.trim().toLowerCase(),
    status: "active",
  });
  if (!user?.passwordHash) return null;
  if (!verifyAdminPassword(password, user.passwordHash)) return null;

  user.lastLoginAt = new Date();
  await user.save();
  return user;
}

export function canAdmin(
  admin: Pick<IAdminUser, "role"> | AdminSession | null,
  permission: string,
) {
  if (!admin) return false;
  const permissions = rolePermissions[admin.role] || [];
  return permissions.includes("*") || permissions.includes(permission);
}

export async function getAdminSession(request: Request) {
  const cookieHeader = request.headers.get("Cookie");
  const session = await adminCookie.parse(cookieHeader);
  if (!session || typeof session !== "object") return null;
  if (!("email" in session) || !("role" in session)) return null;
  return session as AdminSession;
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
  admin: Pick<IAdminUser, "email" | "role">,
  redirectTo = "/admin",
) {
  return redirect(redirectTo, {
    headers: {
      "Set-Cookie": await adminCookie.serialize({
        email: admin.email,
        role: admin.role,
      }),
    },
  });
}

export async function destroyAdminSession() {
  return redirect("/admin/login", {
    headers: {
      "Set-Cookie": await adminCookie.serialize("", { maxAge: 0 }),
    },
  });
}
