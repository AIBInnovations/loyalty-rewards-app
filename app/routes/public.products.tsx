import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { connectDB } from "../db.server";
import { StorefrontDomain } from "../.server/models/storefront-domain.model";
import { PlatformShop } from "../.server/models/platform-shop.model";
import { ProductCache } from "../.server/models/product-cache.model";

function hostnameFromRequest(request: Request) {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const host = forwardedHost || request.headers.get("host") || "";
  return host.split(":")[0].toLowerCase();
}

async function resolveShopId(request: Request) {
  const url = new URL(request.url);
  const shopFromQuery = url.searchParams.get("shop");
  if (shopFromQuery) return shopFromQuery;

  const domain = await StorefrontDomain.findOne({
    domain: hostnameFromRequest(request),
  }).lean();
  return domain?.shopId || "";
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await connectDB();

  const url = new URL(request.url);
  const shopId = await resolveShopId(request);
  if (!shopId) {
    return json({ error: "Storefront domain is not mapped" }, { status: 404 });
  }

  const platformShop = await PlatformShop.findOne({ shopId }).lean();
  if (platformShop?.status && platformShop.status !== "active") {
    return json({ error: "Store is not active" }, { status: 403 });
  }

  const limit = Math.min(Number(url.searchParams.get("limit") || 24), 100);
  const products = await ProductCache.find({
    shopId,
    status: { $ne: "deleted" },
  })
    .sort({ updatedAt: -1 })
    .limit(limit)
    .lean();

  return json({
    shopId,
    products: products.map((product) => ({
      id: product.shopifyProductId,
      title: product.title,
      handle: product.handle,
      status: product.status,
      product: product.productJson,
      syncedAt: product.syncedAt,
    })),
  });
};
