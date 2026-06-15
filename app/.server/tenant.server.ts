import { authenticate } from "../shopify.server";

export async function requireMerchantShop(request: Request) {
  const { session } = await authenticate.admin(request);
  return session.shop;
}

export function assertTenantMatch(recordShopId: string, activeShopId: string) {
  if (recordShopId !== activeShopId) {
    throw new Response("Tenant mismatch", { status: 403 });
  }
}
