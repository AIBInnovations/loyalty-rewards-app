import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { connectDB } from "../db.server";
import { StorefrontDomain } from "../.server/models/storefront-domain.model";
import { PlatformShop } from "../.server/models/platform-shop.model";
import { Settings } from "../.server/models/settings.model";
import { WishlistSettings } from "../.server/models/wishlist-settings.model";
import { TimerSettings } from "../.server/models/timer-settings.model";
import { PopupSettings } from "../.server/models/popup-settings.model";
import { FaqSettings } from "../.server/models/faq-settings.model";
import { SalesPopSettings } from "../.server/models/sales-pop-settings.model";
import { PincodeSettings } from "../.server/models/pincode-settings.model";
import { TrustBadgesSettings } from "../.server/models/trust-badges.model";
import { ReviewSettings } from "../.server/models/review-settings.model";
import { StorefrontConfig } from "../.server/models/storefront-config.model";
import { FeatureFlag } from "../.server/models/feature-flag.model";

function hostnameFromRequest(request: Request) {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const host = forwardedHost || request.headers.get("host") || "";
  return host.split(":")[0].toLowerCase();
}

async function resolveShopId(request: Request) {
  const url = new URL(request.url);
  const shopFromQuery = url.searchParams.get("shop");
  if (shopFromQuery) return shopFromQuery;

  const hostname = hostnameFromRequest(request);
  const domain = await StorefrontDomain.findOne({ domain: hostname }).lean();
  return domain?.shopId || "";
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await connectDB();

  const shopId = await resolveShopId(request);
  if (!shopId) {
    return json({ error: "Storefront domain is not mapped" }, { status: 404 });
  }

  const platformShop = await PlatformShop.findOne({ shopId }).lean();
  if (platformShop?.status && platformShop.status !== "active") {
    return json({ error: "Store is not active" }, { status: 403 });
  }

  const [
    settings,
    wishlist,
    timer,
    exitPopup,
    faq,
    salesPop,
    pincode,
    trustBadges,
    reviews,
    storefrontConfig,
    featureFlags,
  ] = await Promise.all([
    Settings.findOne({ shopId }).lean(),
    WishlistSettings.findOne({ shopId }).lean(),
    TimerSettings.findOne({ shopId }).lean(),
    PopupSettings.findOne({ shopId }).lean(),
    FaqSettings.findOne({ shopId }).lean(),
    SalesPopSettings.findOne({ shopId }).lean(),
    PincodeSettings.findOne({ shopId }).lean(),
    TrustBadgesSettings.findOne({ shopId }).lean(),
    ReviewSettings.findOne({ shopId }).lean(),
    StorefrontConfig.findOne({ shopId }).lean(),
    FeatureFlag.find({}).lean(),
  ]);
  const effectiveFeatureFlags = featureFlags.reduce<Record<string, boolean>>(
    (flags, flag) => {
      const override = flag.shopOverrides?.find((item) => item.shopId === shopId);
      flags[flag.key] = override?.enabled ?? flag.enabledByDefault;
      return flags;
    },
    { ...(storefrontConfig?.featureFlags || {}) },
  );

  return json({
    shopId,
    status: platformShop?.status || "active",
    theme: {
      ...(storefrontConfig?.theme || {}),
      currencySymbol: settings?.currencySymbol || "₹",
      widgetTitle: settings?.widgetConfig?.title || "Rewards",
      primaryColor: settings?.widgetConfig?.primaryColor || "#5C6AC4",
    },
    navigation: storefrontConfig?.navigation || {},
    banners: storefrontConfig?.banners || [],
    featureFlags: effectiveFeatureFlags,
    plugins: {
      loyalty: {
        enabled: settings?.isActive ?? true,
        earningRate: settings?.earningRate ?? 10,
        signupBonus: settings?.signupBonus ?? 50,
      },
      wishlist: {
        enabled: wishlist?.enabled ?? false,
        buttonLabelAdd: wishlist?.buttonLabelAdd,
        buttonLabelSaved: wishlist?.buttonLabelSaved,
        iconColor: wishlist?.iconColor,
        activeColor: wishlist?.activeColor,
      },
      timer: {
        enabled: timer?.enabled ?? false,
        messageTemplate: timer?.messageTemplate,
        displayMode: timer?.displayMode,
        barBackgroundColor: timer?.barBackgroundColor,
        barTextColor: timer?.barTextColor,
      },
      exitPopup: {
        enabled: exitPopup?.enabled ?? false,
        headline: exitPopup?.headline,
        subtext: exitPopup?.subtext,
        buttonText: exitPopup?.buttonText,
        accentColor: exitPopup?.accentColor,
      },
      faq: {
        enabled: faq?.enabled ?? false,
        heading: faq?.heading,
        placement: faq?.placement,
        items: faq?.items || [],
      },
      salesPop: {
        enabled: salesPop?.enabled ?? false,
        messageTemplate: salesPop?.messageTemplate,
        position: salesPop?.position,
      },
      pincode: {
        enabled: pincode?.enabled ?? true,
        defaultMinDays: pincode?.defaultMinDays ?? 3,
        defaultMaxDays: pincode?.defaultMaxDays ?? 7,
      },
      trustBadges: {
        enabled: trustBadges?.enabled ?? true,
        layout: trustBadges?.layout,
        badges: trustBadges?.badges || [],
      },
      reviews: {
        enabled: reviews?.enabled ?? true,
        allowPhotos: reviews?.allowPhotos ?? true,
        allowVideos: reviews?.allowVideos ?? false,
      },
    },
  });
};
