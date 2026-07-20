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
  // Tenant identity comes ONLY from the verified domain mapping.
  //
  // This previously accepted `?shop=` and let it short-circuit the lookup,
  // which made every merchant's catalog — including draft and archived
  // products with per-variant price, SKU and inventory — readable by anyone
  // who knew their domain, with no authentication of any kind.
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

  // Fail closed on an unknown shop. Using `platformShop?.status && ...` meant a
  // shop with no PlatformShop record fell through and got a 200 with defaults,
  // which distinguished "installed" from "unknown" and allowed enumeration of
  // the whole merchant list. Return an identical 404 in every failure case.
  const platformShop = await PlatformShop.findOne({ shopId }).lean();
  if (!platformShop || platformShop.status !== "active") {
    return json({ error: "Not found" }, { status: 404 });
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
