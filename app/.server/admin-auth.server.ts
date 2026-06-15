import { createCookie, redirect } from "@remix-run/node";

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

export async function isAdminAuthenticated(request: Request) {
  const cookieHeader = request.headers.get("Cookie");
  const session = await adminCookie.parse(cookieHeader);
  return session === "authenticated";
}

export async function requireAdmin(request: Request) {
  if (await isAdminAuthenticated(request)) return;

  const url = new URL(request.url);
  const redirectTo = `${url.pathname}${url.search}`;
  throw redirect(`/admin/login?redirectTo=${encodeURIComponent(redirectTo)}`);
}

export async function createAdminSession(redirectTo = "/admin") {
  return redirect(redirectTo, {
    headers: {
      "Set-Cookie": await adminCookie.serialize("authenticated"),
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
