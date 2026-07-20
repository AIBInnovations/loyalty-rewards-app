import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { destroyAdminSession } from "../.server/admin-auth.server";

// Logout must be POST-only. Serving it from the loader meant any page could
// log an admin out with <img src="/admin/logout">.
export const loader = async (_args: LoaderFunctionArgs) => {
  return redirect("/admin");
};

export const action = async ({ request }: ActionFunctionArgs) => {
  return destroyAdminSession(request);
};
