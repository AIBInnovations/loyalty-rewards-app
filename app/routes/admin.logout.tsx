import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { destroyAdminSession } from "../.server/admin-auth.server";

export const loader = async (_args: LoaderFunctionArgs) => {
  return destroyAdminSession();
};

export const action = async (_args: ActionFunctionArgs) => {
  return destroyAdminSession();
};
