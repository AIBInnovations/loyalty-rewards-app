import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { connectDB } from "../db.server";
import {
  verifyAppProxySignature,
  getCustomerIdFromProxy,
} from "../.server/utils/proxy-auth";
import { parseMultipartImage } from "../.server/utils/multipart";
import {
  searchByImage,
  getPublicSearchConfig,
  trackSearchEvent,
} from "../.server/services/image-search.service";
import { getBalance, redeemPoints } from "../.server/services/points.service";
import { Customer } from "../.server/models/customer.model";
import { Reward } from "../.server/models/reward.model";
import { Transaction } from "../.server/models/transaction.model";
import { Settings } from "../.server/models/settings.model";
import { unauthenticated } from "../shopify.server";
import { socialShareKey, birthdayBonusKey } from "../.server/utils/idempotency";
import { earnPoints } from "../.server/services/points.service";
import { CartDrawerSettings } from "../.server/models/cart-settings.model";
import { VolumeDiscountSettings } from "../.server/models/volume-discount.model";
import { TimerSettings } from "../.server/models/timer-settings.model";
import { PopupSettings } from "../.server/models/popup-settings.model";
import { WheelSettings } from "../.server/models/wheel-settings.model";
import { Subscriber } from "../.server/models/subscriber.model";
import { createRedemptionDiscount } from "../.server/services/discount.service";
import { generateDiscountCode } from "../.server/utils/codes";
import { PincodeSettings } from "../.server/models/pincode-settings.model";
import { sendWheelPrizeEmail } from "../.server/utils/email";
import { UpsellSettings } from "../.server/models/upsell-settings.model";
import { UGCSettings } from "../.server/models/ugc-settings.model";
import { ReviewSettings } from "../.server/models/review-settings.model";
import { Review, Question } from "../.server/models/review.model";
import {
  listForCustomer as listWishlist,
  addItem as addWishlistItem,
  removeWishlistProduct,
  removeSavedVariant,
  mergeGuestItems,
} from "../.server/services/wishlist.service";
import { WishlistSettings } from "../.server/models/wishlist-settings.model";
import { SizeGuideSettings } from "../.server/models/size-guide-settings.model";
import { FaqSettings } from "../.server/models/faq-settings.model";
import { SalesPopSettings } from "../.server/models/sales-pop-settings.model";
import { SalesPopEvent } from "../.server/models/sales-pop-event.model";
import {
  formatDisplayName,
  formatDisplayLocation,
  formatFreshness,
} from "../.server/services/sales-pop.service";
import {
  resolveCampaign,
  findCampaign,
  recordLead,
  trackEvent,
  type VisitorContext,
} from "../.server/services/smart-popup.service";

// Rate limit tracker (in-memory, per-instance)
const rateLimits = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(key: string, maxPerMinute: number): boolean {
  const now = Date.now();
  const entry = rateLimits.get(key);
  if (!entry || entry.resetAt < now) {
    rateLimits.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (entry.count >= maxPerMinute) return false;
  entry.count++;
  return true;
}

/**
 * App Proxy handler -- all storefront requests come through here.
 * Shopify proxies requests from /apps/loyalty/* to this route,
 * adding a verified `signature` and `logged_in_customer_id`.
 *
 * Routes:
 *   GET  /apps/loyalty/balance       - Get customer balance, tier, rewards, history
 *   POST /apps/loyalty/redeem        - Redeem points for a discount code
 *   POST /apps/loyalty/referral      - Record a referral association
 *   POST /apps/loyalty/social-share  - Award social share bonus
 */

// ─── GET: Balance, rewards, history ──────────────────────────────

export const loader = async ({ request, params: routeParams }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const params = url.searchParams;

  // Verify Shopify App Proxy signature
  if (!verifyAppProxySignature(params)) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  await connectDB();

  const shopifyCustomerId = getCustomerIdFromProxy(params);
  const shop = params.get("shop") || "";
  // Extract sub-route from the catch-all: /api/proxy/balance -> "balance"
  const path = routeParams["*"] || "balance";

  // Check if this is an action request (redeem/referral/social-share via GET)
  const action = params.get("action");

  // ─── Public endpoints (no customer auth required) ───────────
  if (path === "cart-settings") {
    if (!checkRateLimit(`cart-settings:${shop}`, 60)) {
      return json({ error: "Rate limited" }, { status: 429 });
    }
    return handleGetCartSettings(shop);
  }

  if (path === "volume-discounts") {
    if (!checkRateLimit(`volume-discounts:${shop}`, 120)) {
      return json({ error: "Rate limited" }, { status: 429 });
    }
    return handleGetVolumeDiscounts(params, shop);
  }

  if (path === "currency-settings") {
    if (!checkRateLimit(`currency-settings:${shop}`, 60)) {
      return json({ error: "Rate limited" }, { status: 429 });
    }
    return handleGetCurrencySettings(shop);
  }

  if (path === "timer-settings") {
    if (!checkRateLimit(`timer-settings:${shop}`, 60)) {
      return json({ error: "Rate limited" }, { status: 429 });
    }
    return handleGetTimerSettings(shop);
  }

  if (path === "timer-css") {
    return handleGetTimerCSS(shop);
  }

  if (path === "popup-settings") {
    return handleGetPopupSettings(shop);
  }

  if (path === "popup-submit" || action === "popup-submit") {
    return handlePopupSubmit(params, shop);
  }

  if (path === "smart-popup/config" || action === "smart-popup-config") {
    if (!checkRateLimit(`smart-popup-config:${shop}`, 120)) {
      return json({ error: "Rate limited" }, { status: 429 });
    }
    return handleSmartPopupConfig(params, shop);
  }

  if (path === "smart-popup/submit" || action === "smart-popup-submit") {
    if (!checkRateLimit(`smart-popup-submit:${shop}`, 30)) {
      return json({ error: "Rate limited" }, { status: 429 });
    }
    return handleSmartPopupSubmit(params, shop);
  }

  if (path === "smart-popup/event" || action === "smart-popup-event") {
    return handleSmartPopupEvent(params, shop);
  }

  if (path === "wheel-settings") {
    return handleGetWheelSettings(shop);
  }

  if (path === "wheel-spin" || action === "wheel-spin") {
    return handleWheelSpin(params, shop);
  }

  if (path === "stock-subscribe" || action === "stock-subscribe") {
    return handleStockSubscribe(params, shop);
  }

  if (path === "pincode") {
    return handlePincodeCheck(params, shop);
  }

  if (path === "upsell-settings") {
    return handleGetUpsellSettings(shop);
  }

  if (path === "ugc-settings") {
    return handleGetUGCSettings(shop);
  }

  if (path === "reviews") {
    return handleGetReviews(params, shop);
  }

  if (path === "reviews/questions") {
    return handleGetQuestions(params, shop);
  }

  if (path === "image-search/config") {
    if (!checkRateLimit(`image-search-config:${shop}`, 60)) {
      return json({ error: "Rate limited" }, { status: 429 });
    }
    return handleGetImageSearchConfig(shop);
  }

  if (path === "wishlist-settings") {
    if (!checkRateLimit(`wishlist-settings:${shop}`, 60)) {
      return json({ error: "Rate limited" }, { status: 429 });
    }
    return handleGetWishlistSettings(shop);
  }

  if (path === "size-guide-settings") {
    if (!checkRateLimit(`size-guide-settings:${shop}`, 60)) {
      return json({ error: "Rate limited" }, { status: 429 });
    }
    return handleGetSizeGuideSettings(shop);
  }

  if (path === "faq-settings") {
    if (!checkRateLimit(`faq-settings:${shop}`, 60)) {
      return json({ error: "Rate limited" }, { status: 429 });
    }
    return handleGetFaqSettings(shop);
  }

  if (path === "sales-pop-settings") {
    if (!checkRateLimit(`sales-pop-settings:${shop}`, 60)) {
      return json({ error: "Rate limited" }, { status: 429 });
    }
    return handleGetSalesPopSettings(shop);
  }

  if (path === "sales-pop-events") {
    if (!checkRateLimit(`sales-pop-events:${shop}`, 120)) {
      return json({ error: "Rate limited" }, { status: 429 });
    }
    return handleGetSalesPopEvents(params, shop);
  }

  if (path === "image-search/status") {
    const { connectDB } = await import("../db.server");
    const { ImageEmbedding } = await import("../.server/models/image-embedding.model");
    const { ImageSearchSettings } = await import("../.server/models/image-search-settings.model");
    await connectDB();
    const count = await ImageEmbedding.countDocuments({ shopId: shop, isActive: true });
    const settings = await ImageSearchSettings.findOne({ shopId: shop }).lean();
    return json({
      shop,
      totalIndexed: count,
      enabled: settings?.enabled ?? false,
      minScore: settings?.minScore ?? 0.25,
      lastSyncedAt: settings?.lastSyncedAt ?? null,
    });
  }

  if (!shopifyCustomerId) {
    return json({ error: "Not logged in" }, { status: 401 });
  }

  if (!checkRateLimit(`get:${shopifyCustomerId}`, 30)) {
    return json({ error: "Rate limited" }, { status: 429 });
  }

  // Handle action requests via GET (App Proxy doesn't forward POST bodies)
  if (action === "redeem" || path === "redeem") {
    return handleRedeemGet(params, shop, shopifyCustomerId);
  }
  if (action === "referral" || path === "referral") {
    return handleReferralGet(params, shop, shopifyCustomerId);
  }
  if (action === "social-share" || path === "social-share") {
    return handleSocialShareGet(params, shop, shopifyCustomerId);
  }

  if (path === "wishlist") {
    return handleWishlistGet(shop, shopifyCustomerId);
  }
  if (path === "wishlist/add" || action === "wishlist-add") {
    return handleWishlistAddGet(params, shop, shopifyCustomerId, "wishlist");
  }
  if (path === "wishlist/remove" || action === "wishlist-remove") {
    return handleWishlistRemoveGet(params, shop, shopifyCustomerId, "wishlist");
  }
  if (path === "saved/add" || action === "saved-add") {
    return handleWishlistAddGet(params, shop, shopifyCustomerId, "saved");
  }
  if (path === "saved/remove" || action === "saved-remove") {
    return handleWishlistRemoveGet(params, shop, shopifyCustomerId, "saved");
  }

  return handleGetBalance(shop, shopifyCustomerId);
};

// ─── Cart Settings (public, no customer auth) ───────────────────

// ─── Popup Settings ──────────────────────────────────────────────

async function handleGetPopupSettings(shop: string) {
  const s = await PopupSettings.findOne({ shopId: shop }).lean();
  if (!s?.enabled) return json({ enabled: false });
  return json({
    enabled: true, headline: s.headline, subtext: s.subtext,
    discountType: s.discountType, discountValue: s.discountValue,
    buttonText: s.buttonText, successMessage: s.successMessage,
    bgColor: s.bgColor, accentColor: s.accentColor,
    showOnMobile: s.showOnMobile, delaySeconds: s.delaySeconds,
  });
}

async function handlePopupSubmit(params: URLSearchParams, shop: string) {
  const email = params.get("email");
  if (!email || !email.includes("@")) return json({ error: "Valid email required" }, { status: 400 });

  // Check if already submitted
  const existing = await Subscriber.findOne({ shopId: shop, email, source: "exit_popup" });
  if (existing?.discountCode) {
    return json({ success: true, discountCode: existing.discountCode });
  }

  // Get popup settings for discount config
  const settings = await PopupSettings.findOne({ shopId: shop });
  if (!settings) return json({ error: "Not configured" }, { status: 400 });

  // Create discount code
  try {
    const { admin } = await unauthenticated.admin(shop);
    const { discountCode } = await createRedemptionDiscount(admin as any, {
      shopifyCustomerId: "gid://shopify/Customer/0", // Generic - not customer-specific
      discountType: settings.discountType === "percentage" ? "PERCENTAGE" : "FIXED_AMOUNT",
      discountValue: settings.discountValue,
      minimumOrderAmount: 0,
      title: `Exit Popup: ${settings.discountValue}${settings.discountType === "percentage" ? "%" : "₹"} off`,
    });

    await Subscriber.create({
      shopId: shop, email, source: "exit_popup",
      discountCode, status: "active",
    });

    return json({ success: true, discountCode });
  } catch (err) {
    return json({ error: "Failed to create discount" }, { status: 500 });
  }
}

// ─── Smart Email Popup ──────────────────────────────────────────

function pageTypeFromParams(params: URLSearchParams): VisitorContext["pageType"] {
  const raw = (params.get("pageType") || "other").toLowerCase();
  const allowed = [
    "home",
    "product",
    "collection",
    "blog",
    "article",
    "page",
    "cart",
    "search",
    "other",
  ];
  return (allowed.includes(raw) ? raw : "other") as VisitorContext["pageType"];
}

function deviceFromParams(params: URLSearchParams): "desktop" | "mobile" {
  return params.get("device") === "mobile" ? "mobile" : "desktop";
}

function visitorContextFromParams(params: URLSearchParams): VisitorContext {
  return {
    pageType: pageTypeFromParams(params),
    device: deviceFromParams(params),
    audience: params.get("audience") === "returning" ? "returning" : "new",
    country: (params.get("country") || "").toUpperCase(),
    pageUrl: params.get("pageUrl") || "",
    referrer: params.get("referrer") || "",
    utmSource: params.get("utm_source") || "",
    utmMedium: params.get("utm_medium") || "",
    utmCampaign: params.get("utm_campaign") || "",
    locale: params.get("locale") || "",
  };
}

async function handleSmartPopupConfig(params: URLSearchParams, shop: string) {
  const ctx = visitorContextFromParams(params);
  const campaign = await resolveCampaign(shop, ctx);
  if (!campaign) {
    return json({ enabled: false }, { headers: { "Cache-Control": "no-store" } });
  }
  return json(
    { enabled: true, campaign },
    { headers: { "Cache-Control": "no-store" } },
  );
}

async function handleSmartPopupSubmit(params: URLSearchParams, shop: string) {
  const campaignId = params.get("campaignId") || "";
  const email = params.get("email") || "";
  if (!campaignId) return json({ error: "campaignId required" }, { status: 400 });
  if (!email) return json({ error: "email required" }, { status: 400 });

  const campaign = await findCampaign(shop, campaignId);
  if (!campaign || campaign.status !== "active") {
    return json({ error: "Campaign not active" }, { status: 400 });
  }

  const { admin } = await unauthenticated.admin(shop);
  const result = await recordLead(
    {
      shopId: shop,
      campaignId,
      email,
      firstName: params.get("firstName") || "",
      visitorKey: params.get("visitorKey") || "",
      ctx: visitorContextFromParams(params),
    },
    campaign,
    admin as any,
  );

  if (!result.success) {
    return json({ error: result.error || "Failed" }, { status: 400 });
  }

  await trackEvent(shop, campaignId, "submit");
  return json({
    success: true,
    discountCode: result.discountCode || "",
    successMessage: campaign.content.successMessage,
  });
}

async function handleSmartPopupEvent(params: URLSearchParams, shop: string) {
  const campaignId = params.get("campaignId") || "";
  const eventRaw = (params.get("event") || "").toLowerCase();
  const allowed = ["impression", "open", "close", "submit", "convert"] as const;
  if (!campaignId || !allowed.includes(eventRaw as (typeof allowed)[number])) {
    return json({ error: "Invalid event" }, { status: 400 });
  }
  await trackEvent(shop, campaignId, eventRaw as (typeof allowed)[number]);
  return json({ success: true }, { headers: { "Cache-Control": "no-store" } });
}

// ─── Wheel Settings ─────────────────────────────────────────────

async function handleGetWheelSettings(shop: string) {
  const s = await WheelSettings.findOne({ shopId: shop }).lean();
  if (!s?.enabled) return json({ enabled: false });
  return json({
    enabled: true, headline: s.headline, subtext: s.subtext,
    buttonText: s.buttonText, triggerButtonText: s.triggerButtonText,
    triggerButtonColor: s.triggerButtonColor,
    prizes: s.prizes, bgColor: s.bgColor,
  }, { headers: { "Cache-Control": "no-store" } });
}

async function handleWheelSpin(params: URLSearchParams, shop: string) {
  const email = params.get("email");
  if (!email || !email.includes("@")) return json({ error: "Valid email required" }, { status: 400 });

  // Check if already spun
  const existing = await Subscriber.findOne({ shopId: shop, email, source: "spin_wheel" });
  if (existing) {
    return json({ error: "You've already spun! Check your email for the result." });
  }

  const settings = await WheelSettings.findOne({ shopId: shop });
  if (!settings || !settings.prizes.length) return json({ error: "Not configured" }, { status: 400 });

  // Weighted random selection
  const prizes = settings.prizes;
  const totalWeight = prizes.reduce((sum, p) => sum + (p.probability || 1), 0);
  let random = Math.random() * totalWeight;
  let selectedIndex = 0;
  for (let i = 0; i < prizes.length; i++) {
    random -= (prizes[i].probability || 1);
    if (random <= 0) { selectedIndex = i; break; }
  }

  const prize = prizes[selectedIndex];
  let discountCode = "";

  // Create discount if it's a winning prize
  if (prize.discountType !== "no_prize") {
    try {
      const { admin } = await unauthenticated.admin(shop);
      const result = await createRedemptionDiscount(admin as any, {
        shopifyCustomerId: "gid://shopify/Customer/0",
        discountType: prize.discountType === "percentage" ? "PERCENTAGE" :
                       prize.discountType === "free_shipping" ? "PERCENTAGE" : "FIXED_AMOUNT",
        discountValue: prize.discountType === "free_shipping" ? 0 : prize.discountValue,
        minimumOrderAmount: 0,
        title: `Spin Wheel: ${prize.label}`,
      });
      discountCode = result.discountCode;
    } catch (err) {
      // If discount creation fails, still record the spin
    }
  }

  await Subscriber.create({
    shopId: shop, email, source: "spin_wheel",
    prizeName: prize.label, discountCode, status: "active",
  });

  // Send prize email (fire-and-forget — don't block the response)
  sendWheelPrizeEmail({
    to: email,
    prizeName: prize.label,
    discountCode,
    shopName: shop,
  }).catch((err) => console.error("Wheel prize email failed:", err));

  return json({
    prizeIndex: selectedIndex,
    prize: { label: prize.label, discountType: prize.discountType },
    discountCode,
  });
}

// ─── Stock Subscribe ────────────────────────────────────────────

async function handleStockSubscribe(params: URLSearchParams, shop: string) {
  const email = params.get("email");
  const productId = params.get("productId");
  const variantId = params.get("variantId");
  const productTitle = params.get("productTitle");
  const variantTitle = params.get("variantTitle");

  if (!email || !email.includes("@")) return json({ error: "Valid email required" }, { status: 400 });
  if (!productId) return json({ error: "Product ID required" }, { status: 400 });

  // Check if already subscribed for this product
  const existing = await Subscriber.findOne({
    shopId: shop, email, source: "back_in_stock", productId, status: "active",
  });
  if (existing) return json({ success: true, message: "Already subscribed" });

  await Subscriber.create({
    shopId: shop, email, source: "back_in_stock",
    productId, variantId, productTitle, variantTitle, status: "active",
  });

  return json({ success: true });
}

// ─── Timer Settings ─────────────────────────────────────────────

async function handleGetTimerCSS(shop: string) {
  const settings = await TimerSettings.findOne({ shopId: shop }).lean();
  const bg = (settings?.barBackgroundColor as string) || "#1a1a1a";
  const text = (settings?.barTextColor as string) || "#ffffff";
  const digit = (settings?.timerDigitColor as string) || "#ff4444";
  const safeColor = (c: string) => /^#[0-9a-fA-F]{3,8}$/.test(c) ? c : "#000";
  const css = `:root{--ct-bg:${safeColor(bg)};--ct-text:${safeColor(text)};--ct-digit:${safeColor(digit)}}`;
  return new Response(css, {
    status: 200,
    headers: { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "no-store" },
  });
}

async function handleGetTimerSettings(shop: string) {
  const settings = await TimerSettings.findOne({ shopId: shop }).lean();

  if (!settings?.enabled) {
    return json({ enabled: false }, { headers: { "Cache-Control": "no-store" } });
  }

  return json({
    enabled: true,
    timerType: settings.timerType,
    endDate: settings.endDate ? new Date(settings.endDate).toISOString() : null,
    durationHours: settings.durationHours,
    durationMinutes: settings.durationMinutes,
    displayMode: settings.displayMode,
    messageTemplate: settings.messageTemplate,
    expiredMessage: settings.expiredMessage,
    barBackgroundColor: settings.barBackgroundColor,
    barTextColor: settings.barTextColor,
    timerDigitColor: settings.timerDigitColor,
    showOnAllProducts: settings.showOnAllProducts,
    saleItemsOnly: settings.saleItemsOnly,
    specificTags: settings.specificTags,
    hideWhenExpired: settings.hideWhenExpired,
    showDismissButton: settings.showDismissButton,
  }, { headers: { "Cache-Control": "no-store" } });
}

async function handleGetFaqSettings(shop: string) {
  const settings = await FaqSettings.findOne({ shopId: shop }).lean();

  if (!settings?.enabled) {
    return json({ enabled: false }, { headers: { "Cache-Control": "no-store" } });
  }

  const maxItems = typeof settings.maxItems === "number" ? settings.maxItems : 0;
  const all = Array.isArray(settings.items) ? settings.items : [];
  const filtered = all.filter(
    (it: any) =>
      it &&
      it.active !== false &&
      typeof it.question === "string" &&
      typeof it.answer === "string" &&
      it.question.trim() !== "" &&
      it.answer.trim() !== "",
  );
  const items = maxItems > 0 ? filtered.slice(0, maxItems) : filtered;

  return json(
    {
      enabled: true,
      heading: settings.heading || "",
      subheading: settings.subheading || "",
      restrictToProduct: settings.restrictToProduct !== false,
      placement: settings.placement || "before-footer",
      iconStyle: settings.iconStyle || "chevron",
      allowMultiple: !!settings.allowMultiple,
      firstOpen: settings.firstOpen !== false,
      enableSchema: settings.enableSchema !== false,
      backgroundColor: settings.backgroundColor || "#ffffff",
      textColor: settings.textColor || "#111827",
      accentColor: settings.accentColor || "#5C6AC4",
      borderColor: settings.borderColor || "#e5e7eb",
      borderRadius: settings.borderRadius ?? 8,
      itemGap: settings.itemGap ?? 8,
      maxWidth: settings.maxWidth ?? 880,
      items: items.map((it: any) => ({
        question: it.question,
        answer: it.answer,
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

async function handleGetSizeGuideSettings(shop: string) {
  const settings = await SizeGuideSettings.findOne({ shopId: shop }).lean();

  if (!settings?.enabled) {
    return json({ enabled: false }, { headers: { "Cache-Control": "no-store" } });
  }

  return json(
    {
      enabled: true,
      triggerLabel: settings.triggerLabel,
      showIcon: settings.showIcon,
      modalTitle: settings.modalTitle,
      chartTitle: settings.chartTitle,
      note: settings.note,
      headersCm: settings.headersCm || [],
      rowsCm: settings.rowsCm || [],
      headersInches: settings.headersInches || [],
      rowsInches: settings.rowsInches || [],
      accentColor: settings.accentColor,
      textColor: settings.textColor,
      rowAltColor: settings.rowAltColor,
      borderColor: settings.borderColor,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

async function handleGetCartSettings(shop: string) {
  const settings = await CartDrawerSettings.findOne({ shopId: shop })
    .lean();

  if (!settings?.enabled) {
    return json({ enabled: false, tiers: [] });
  }

  return json({
    enabled: true,
    tiers: settings.tiers,
    showRecommendations: settings.showRecommendations,
    recommendationsTitle: settings.recommendationsTitle,
    recommendationsCount: settings.recommendationsCount,
    recommendationMode: settings.recommendationMode || "auto",
    manualProducts: settings.manualProducts || [],
    showSavings: settings.showSavings,
    checkoutButtonText: settings.checkoutButtonText,
    prepaidBannerText: settings.prepaidBannerText,
    showPrepaidBanner: settings.showPrepaidBanner,
    primaryColor: settings.primaryColor,
    interceptAddToCart: settings.interceptAddToCart,
  });
}

async function handleGetVolumeDiscounts(
  params: URLSearchParams,
  shop: string,
) {
  const settings = await VolumeDiscountSettings.findOne({ shopId: shop }).lean();
  if (!settings || !settings.campaigns?.length) {
    return json(
      { campaigns: [] },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const now = Date.now();
  const productIdRaw = (params.get("productId") || "").trim();
  const productId = productIdRaw
    ? productIdRaw.startsWith("gid://")
      ? productIdRaw
      : `gid://shopify/Product/${productIdRaw.replace(/\D/g, "")}`
    : "";

  const campaigns = (settings.campaigns || [])
    .filter((c: any) => {
      if (!c.enabled) return false;
      if (c.startsAt && new Date(c.startsAt).getTime() > now) return false;
      if (c.endsAt && new Date(c.endsAt).getTime() < now) return false;
      if (!productId) return true; // unfiltered list (e.g. cart page)
      if (c.scope === "all") return true;
      return (c.products || []).some(
        (p: any) => p.shopifyProductId === productId,
      );
    })
    .map((c: any) => ({
      id: String(c._id),
      title: c.title,
      scope: c.scope,
      productIds: (c.products || []).map((p: any) => p.shopifyProductId),
      badgeText: c.badgeText,
      showOnProductPage: c.showOnProductPage,
      showInCart: c.showInCart,
      primaryColor: c.primaryColor,
      tiers: (c.tiers || [])
        .slice()
        .sort((a: any, b: any) => a.minQuantity - b.minQuantity)
        .map((t: any) => ({
          minQuantity: t.minQuantity,
          valueType: t.valueType,
          value: t.value,
          label: t.label,
        })),
    }));

  return json({ campaigns }, { headers: { "Cache-Control": "no-store" } });
}

async function handleGetCurrencySettings(shop: string) {
  const settings = await Settings.findOne({ shopId: shop }).lean();

  // Only treat explicit `false` as disabled — undefined means "not yet set, default to enabled"
  if (settings && settings.currencySelectorEnabled === false) {
    return json({ enabled: false, currencies: [] }, { headers: { "Cache-Control": "no-store" } });
  }

  return json({
    enabled: true,
    currencies: (settings && settings.currencies) || [],
  }, { headers: { "Cache-Control": "no-store" } });
}

// ─── Balance (customer auth required) ────────────────────────────

async function handleGetBalance(shop: string, shopifyCustomerId: string) {
  const balance = await getBalance(shop, shopifyCustomerId);
  if (!balance) {
    return json({ error: "Customer not found" }, { status: 404 });
  }

  // Get available rewards
  const rewards = await Reward.find({ shopId: shop, isActive: true })
    .select("name pointsCost discountType discountValue minimumOrderAmount")
    .lean();

  // Get recent transactions
  const customer = await Customer.findOne({
    shopId: shop,
    shopifyCustomerId,
  });
  const transactions = customer
    ? await Transaction.find({ customerId: customer._id })
        .sort({ createdAt: -1 })
        .limit(20)
        .select("type points source description createdAt")
        .lean()
    : [];

  // Get settings for widget config
  const settings = await Settings.findOne({ shopId: shop });

  return json({
    balance: balance.currentBalance,
    tier: balance.tier,
    lifetimeEarned: balance.lifetimeEarned,
    referralCode: balance.referralCode,
    nextTier: balance.nextTier,
    rewards: rewards.map((r) => ({
      id: r._id.toString(),
      name: r.name,
      pointsCost: r.pointsCost,
      discountType: r.discountType,
      discountValue: r.discountValue,
      minimumOrderAmount: r.minimumOrderAmount,
      canAfford: balance.currentBalance >= r.pointsCost,
    })),
    transactions: transactions.map((t) => ({
      type: t.type,
      points: t.points,
      source: t.source,
      description: t.description,
      date: t.createdAt,
    })),
    settings: settings
      ? {
          earningRate: settings.earningRate,
          currencySymbol: settings.currencySymbol,
          widgetConfig: settings.widgetConfig,
        }
      : null,
  });
}

// ─── GET-based action handlers (App Proxy doesn't forward POST bodies) ───

async function handleRedeemGet(
  params: URLSearchParams,
  shop: string,
  shopifyCustomerId: string,
) {
  const rewardId = params.get("rewardId");
  if (!rewardId) {
    return json({ error: "rewardId is required" }, { status: 400 });
  }

  if (!checkRateLimit(`redeem:${shopifyCustomerId}`, 5)) {
    return json({ error: "Rate limited" }, { status: 429 });
  }

  try {
    const { admin } = await unauthenticated.admin(shop);

    const result = await redeemPoints({
      shopId: shop,
      shopifyCustomerId,
      rewardId,
      admin: admin as any,
    });

    return json({
      success: true,
      discountCode: result.discountCode,
      pointsSpent: result.pointsSpent,
      newBalance: result.newBalance,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Redemption failed";
    return json({ error: message }, { status: 400 });
  }
}

async function handleReferralGet(
  params: URLSearchParams,
  shop: string,
  shopifyCustomerId: string,
) {
  const referralCode = params.get("referralCode");
  if (!referralCode) {
    return json({ error: "referralCode is required" }, { status: 400 });
  }

  if (!checkRateLimit(`referral:${shopifyCustomerId}`, 3)) {
    return json({ error: "Rate limited" }, { status: 429 });
  }

  const customer = await Customer.findOne({ shopId: shop, shopifyCustomerId });
  if (!customer) {
    return json({ error: "Customer not found" }, { status: 404 });
  }
  if (customer.referralCode === referralCode) {
    return json({ error: "Cannot refer yourself" }, { status: 400 });
  }
  if (customer.referredBy) {
    return json({ error: "Already referred" }, { status: 400 });
  }

  const referrer = await Customer.findOne({ shopId: shop, referralCode });
  if (!referrer) {
    return json({ error: "Invalid referral code" }, { status: 400 });
  }

  customer.referredBy = referralCode;
  await customer.save();

  return json({ success: true, message: "Referral recorded" });
}

async function handleSocialShareGet(
  params: URLSearchParams,
  shop: string,
  shopifyCustomerId: string,
) {
  const platform = params.get("platform");
  const validPlatforms = ["whatsapp", "facebook", "twitter", "copy"];
  if (!platform || !validPlatforms.includes(platform)) {
    return json({ error: "Invalid platform" }, { status: 400 });
  }

  if (!checkRateLimit(`social:${shopifyCustomerId}`, 10)) {
    return json({ error: "Rate limited" }, { status: 429 });
  }

  const settings = await Settings.findOne({ shopId: shop });
  if (!settings || settings.socialShareBonus <= 0) {
    return json({ error: "Social sharing bonus not configured" }, { status: 400 });
  }

  const today = new Date().toISOString().split("T")[0];
  const idempKey = socialShareKey(shopifyCustomerId, platform, today);

  try {
    const { admin } = await unauthenticated.admin(shop);

    const result = await earnPoints({
      shopId: shop,
      shopifyCustomerId,
      points: settings.socialShareBonus,
      source: "SOCIAL_SHARE",
      referenceId: `${platform}_${today}`,
      idempotencyKey: idempKey,
      description: `Shared on ${platform}`,
      admin: admin as any,
    });

    if (!result) {
      return json({ success: false, message: "Already earned for this platform today" });
    }

    return json({
      success: true,
      pointsEarned: settings.socialShareBonus,
      newBalance: result.currentBalance,
    });
  } catch (error) {
    return json({ error: "Failed to award bonus" }, { status: 500 });
  }
}

// ─── POST: Redeem, referral, social-share (kept for non-proxy calls) ────

export const action = async ({ request, params: routeParams }: ActionFunctionArgs) => {
  const url = new URL(request.url);
  const params = url.searchParams;

  // Verify Shopify App Proxy signature
  if (!verifyAppProxySignature(params)) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  await connectDB();

  const shopifyCustomerId = getCustomerIdFromProxy(params);
  const shop = params.get("shop") || "";

  // Extract sub-route from the catch-all: /api/proxy/redeem -> "redeem"
  const route = routeParams["*"] || "";

  // ─── Image search endpoints (no customer auth required) ─────────
  if (route === "image-search/search") {
    if (!checkRateLimit(`image-search:${shop}`, 10)) {
      return json({ error: "Rate limited" }, { status: 429 });
    }
    return handleImageSearch(request, shop, shopifyCustomerId || "");
  }

  if (route === "image-search/event") {
    return handleImageSearchEvent(request, shop);
  }

  // ─── Customer-auth required routes ──────────────────────────────
  if (!shopifyCustomerId) {
    return json({ error: "Not logged in" }, { status: 401 });
  }

  switch (route) {
    case "redeem":
      return handleRedeem(request, shop, shopifyCustomerId);
    case "referral":
      return handleReferral(request, shop, shopifyCustomerId);
    case "social-share":
      return handleSocialShare(request, shop, shopifyCustomerId);
    case "reviews/submit":
      return handleSubmitReview(request, shop);
    case "reviews/question":
      return handleSubmitQuestion(request, shop);
    case "wishlist/merge":
      return handleWishlistMerge(request, shop, shopifyCustomerId);
    default:
      return json({ error: "Not found" }, { status: 404 });
  }
};

// ─── Redeem Handler ──────────────────────────────────────────────

async function handleRedeem(
  request: Request,
  shop: string,
  shopifyCustomerId: string,
) {
  if (!checkRateLimit(`redeem:${shopifyCustomerId}`, 5)) {
    return json({ error: "Rate limited" }, { status: 429 });
  }

  let rewardId: string | null = null;

  // App Proxy can send data as JSON body or as form-encoded
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = await request.json();
    rewardId = body.rewardId;
  } else {
    // Try to get from URL params (App Proxy might forward as query params)
    const url = new URL(request.url);
    rewardId = url.searchParams.get("rewardId");
    if (!rewardId) {
      // Try form data
      try {
        const formData = await request.formData();
        rewardId = formData.get("rewardId") as string;
      } catch (e) {
        // ignore
      }
    }
  }

  if (!rewardId) {
    return json({ error: "rewardId is required" }, { status: 400 });
  }

  try {
    // Get admin API access via offline session
    const { admin } = await unauthenticated.admin(shop);

    const result = await redeemPoints({
      shopId: shop,
      shopifyCustomerId,
      rewardId,
      admin: admin as any,
    });

    return json({
      success: true,
      discountCode: result.discountCode,
      pointsSpent: result.pointsSpent,
      newBalance: result.newBalance,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Redemption failed";
    return json({ error: message }, { status: 400 });
  }
}

// ─── Referral Handler ────────────────────────────────────────────

async function handleReferral(
  request: Request,
  shop: string,
  shopifyCustomerId: string,
) {
  if (!checkRateLimit(`referral:${shopifyCustomerId}`, 3)) {
    return json({ error: "Rate limited" }, { status: 429 });
  }

  const body = await request.json();
  const { referralCode } = body;

  if (!referralCode) {
    return json({ error: "referralCode is required" }, { status: 400 });
  }

  // Find customer
  const customer = await Customer.findOne({
    shopId: shop,
    shopifyCustomerId,
  });
  if (!customer) {
    return json({ error: "Customer not found" }, { status: 404 });
  }

  // Can't refer yourself
  if (customer.referralCode === referralCode) {
    return json({ error: "Cannot refer yourself" }, { status: 400 });
  }

  // Already referred
  if (customer.referredBy) {
    return json({ error: "Already referred" }, { status: 400 });
  }

  // Verify referral code exists
  const referrer = await Customer.findOne({
    shopId: shop,
    referralCode,
  });
  if (!referrer) {
    return json({ error: "Invalid referral code" }, { status: 400 });
  }

  // Record the referral association (bonus awarded on first order via webhook)
  customer.referredBy = referralCode;
  await customer.save();

  return json({ success: true, message: "Referral recorded" });
}

// ─── Social Share Handler ────────────────────────────────────────

async function handleSocialShare(
  request: Request,
  shop: string,
  shopifyCustomerId: string,
) {
  if (!checkRateLimit(`social:${shopifyCustomerId}`, 10)) {
    return json({ error: "Rate limited" }, { status: 429 });
  }

  const body = await request.json();
  const { platform } = body;

  const validPlatforms = ["whatsapp", "facebook", "twitter", "copy"];
  if (!platform || !validPlatforms.includes(platform)) {
    return json({ error: "Invalid platform" }, { status: 400 });
  }

  const settings = await Settings.findOne({ shopId: shop });
  if (!settings || settings.socialShareBonus <= 0) {
    return json({ error: "Social sharing bonus not configured" }, { status: 400 });
  }

  const today = new Date().toISOString().split("T")[0];
  const idempKey = socialShareKey(shopifyCustomerId, platform, today);

  try {
    const { admin } = await unauthenticated.admin(shop);

    const result = await earnPoints({
      shopId: shop,
      shopifyCustomerId,
      points: settings.socialShareBonus,
      source: "SOCIAL_SHARE",
      referenceId: `${platform}_${today}`,
      idempotencyKey: idempKey,
      description: `Shared on ${platform}`,
      admin: admin as any,
    });

    if (!result) {
      return json({
        success: false,
        message: "Already earned for this platform today",
      });
    }

    return json({
      success: true,
      pointsEarned: settings.socialShareBonus,
      newBalance: result.currentBalance,
    });
  } catch (error) {
    return json({ error: "Failed to award bonus" }, { status: 500 });
  }
}

// ─── Pincode Delivery Estimator ──────────────────────────────────

async function handlePincodeCheck(params: URLSearchParams, shop: string) {
  const code = (params.get("code") || "").trim();
  if (!/^\d{6}$/.test(code)) {
    return json({ error: "Invalid pincode" }, { status: 400 });
  }

  const settings = await PincodeSettings.findOne({ shopId: shop }).lean();
  if (!settings?.enabled) {
    // Default: all deliverable, COD available, 3-7 days
    return json({ deliverable: true, cod: true, minDays: 3, maxDays: 7 });
  }

  if (settings.nonServiceablePincodes.includes(code)) {
    return json({ deliverable: false, cod: false, minDays: 0, maxDays: 0 });
  }

  const cod = settings.noCodPincodes.includes(code)
    ? false
    : settings.codPincodes.length === 0 || settings.codPincodes.includes(code);

  return json({
    deliverable: true,
    cod,
    minDays: settings.defaultMinDays,
    maxDays: settings.defaultMaxDays,
  });
}

// ─── Upsell Settings ─────────────────────────────────────────────

async function handleGetUpsellSettings(shop: string) {
  const s = await UpsellSettings.findOne({ shopId: shop }).lean();
  if (!s?.enabled) return json({ enabled: false });
  return json({
    enabled: true,
    productHandle:   s.productHandle,
    discountPercent: s.discountPercent,
    headline:        s.headline,
    buttonText:      s.buttonText,
    primaryColor:    s.primaryColor,
  });
}

// ─── UGC Gallery Settings ────────────────────────────────────────

async function handleGetUGCSettings(shop: string) {
  const s = await UGCSettings.findOne({ shopId: shop }).lean();
  if (!s?.enabled) return json({ enabled: false });
  return json({ enabled: true, title: s.title, photos: s.photos });
}

// ─── Reviews ─────────────────────────────────────────────────────

async function handleGetReviews(params: URLSearchParams, shop: string) {
  const productId = params.get("productId");
  if (!productId) return json({ reviews: [] });

  const settings = await ReviewSettings.findOne({ shopId: shop }).lean();
  if (!settings?.enabled) return json({ reviews: [] });

  const reviews = await Review.find({ shopId: shop, productId, status: "approved" })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  return json({ reviews });
}

async function handleGetQuestions(params: URLSearchParams, shop: string) {
  const productId = params.get("productId");
  if (!productId) return json({ questions: [] });

  const questions = await Question.find({ shopId: shop, productId, answered: true })
    .sort({ createdAt: -1 })
    .limit(20)
    .lean();

  return json({ questions });
}

async function handleSubmitReview(request: Request, shop: string) {
  let body: Record<string, any> = {};
  try {
    const ct = request.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      body = await request.json();
    } else {
      const fd = await request.formData();
      body = Object.fromEntries(fd);
      if (body.photoUrls) {
        try { body.photoUrls = JSON.parse(body.photoUrls as string); } catch { body.photoUrls = []; }
      }
    }
  } catch {
    return json({ error: "Invalid body" }, { status: 400 });
  }

  const { productId, rating, body: reviewBody, photoUrls = [], authorName, authorEmail, customerId } = body;
  if (!productId || !rating || !reviewBody) {
    return json({ error: "productId, rating, and body are required" }, { status: 400 });
  }

  const settings = await ReviewSettings.findOne({ shopId: shop }).lean();
  const status = settings?.autoApprove ? "approved" : "pending";

  await Review.create({
    shopId: shop, productId, rating: Number(rating), body: reviewBody,
    photoUrls, authorName: authorName || "Customer", authorEmail: authorEmail || "",
    customerId: customerId || "", status,
  });

  return json({ success: true, status });
}

async function handleSubmitQuestion(request: Request, shop: string) {
  let body: Record<string, any> = {};
  try {
    const ct = request.headers.get("content-type") || "";
    body = ct.includes("application/json") ? await request.json() : Object.fromEntries(await request.formData());
  } catch {
    return json({ error: "Invalid body" }, { status: 400 });
  }

  const { productId, question } = body;
  if (!productId || !question) {
    return json({ error: "productId and question are required" }, { status: 400 });
  }

  await Question.create({ shopId: shop, productId, question, answered: false });
  return json({ success: true });
}

// ─── Image Search Handlers ────────────────────────────────────────

async function handleGetImageSearchConfig(shop: string) {
  const config = await getPublicSearchConfig(shop);
  return json(config, { headers: { "Cache-Control": "no-store" } });
}

async function handleImageSearch(
  request: Request,
  shop: string,
  customerId: string,
) {
  const parsed = await parseMultipartImage(request);

  if (!parsed) {
    return json(
      {
        error:
          "Invalid image. Please upload a JPEG, PNG, or WebP file under 5 MB.",
      },
      { status: 400 },
    );
  }

  const url = new URL(request.url);
  const sessionId = url.searchParams.get("session_id") || "";

  try {
    const response = await searchByImage(
      parsed.buffer,
      shop,
      sessionId,
      customerId,
    );
    return json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Image search failed";
    return json({ error: message }, { status: 500 });
  }
}

async function handleImageSearchEvent(request: Request, shop: string) {
  let body: Record<string, any> = {};
  try {
    const ct = request.headers.get("content-type") || "";
    body = ct.includes("application/json")
      ? await request.json()
      : Object.fromEntries(await request.formData());
  } catch {
    return json({ error: "Invalid body" }, { status: 400 });
  }

  const { searchId, event, productId, position } = body;
  if (!searchId || !event || !productId) {
    return json({ error: "searchId, event, and productId are required" }, { status: 400 });
  }

  const validEvents = ["click", "add_to_cart"];
  if (!validEvents.includes(event)) {
    return json({ error: "Invalid event type" }, { status: 400 });
  }

  try {
    await trackSearchEvent(
      String(searchId),
      shop,
      event as "click" | "add_to_cart",
      String(productId),
      Number(position) || 0,
    );
    return json({ success: true });
  } catch {
    return json({ success: false });
  }
}

// ─── Wishlist / Save for Later ───────────────────────────────────

async function handleGetWishlistSettings(shop: string) {
  const s = await WishlistSettings.findOne({ shopId: shop }).lean();
  if (!s?.enabled) {
    return json(
      { enabled: false },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  return json(
    {
      enabled: true,
      showWishlistButton: s.showWishlistButton,
      showSavedForLater: s.showSavedForLater,
      buttonLabelAdd: s.buttonLabelAdd,
      buttonLabelSaved: s.buttonLabelSaved,
      iconColor: s.iconColor,
      activeColor: s.activeColor,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

async function isWishlistEnabled(shop: string): Promise<boolean> {
  const s = await WishlistSettings.findOne({ shopId: shop })
    .select("enabled")
    .lean();
  return !!s?.enabled;
}

async function handleWishlistGet(shop: string, shopifyCustomerId: string) {
  if (!(await isWishlistEnabled(shop))) {
    return json({ enabled: false, wishlist: [], saved: [] });
  }
  const data = await listWishlist(shop, shopifyCustomerId);
  return json(data, { headers: { "Cache-Control": "no-store" } });
}

function metaFromParams(params: URLSearchParams) {
  return {
    productHandle: params.get("productHandle") || undefined,
    productTitle: params.get("productTitle") || undefined,
    variantTitle: params.get("variantTitle") || undefined,
    imageUrl: params.get("imageUrl") || undefined,
    price: params.get("price") ? Number(params.get("price")) : undefined,
    quantity: params.get("quantity") ? Number(params.get("quantity")) : 1,
  };
}

async function handleWishlistAddGet(
  params: URLSearchParams,
  shop: string,
  shopifyCustomerId: string,
  kind: "wishlist" | "saved",
) {
  if (!checkRateLimit(`wishlist-add:${shopifyCustomerId}`, 60)) {
    return json({ error: "Rate limited" }, { status: 429 });
  }
  if (!(await isWishlistEnabled(shop))) {
    return json({ error: "Wishlist disabled" }, { status: 403 });
  }

  const productId = params.get("productId");
  const variantId = params.get("variantId") || undefined;
  if (!productId) return json({ error: "productId required" }, { status: 400 });
  if (kind === "saved" && !variantId) {
    return json({ error: "variantId required" }, { status: 400 });
  }

  try {
    await addWishlistItem({
      shopId: shop,
      shopifyCustomerId,
      kind,
      productId,
      variantId,
      ...metaFromParams(params),
    });
    return json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save";
    return json({ error: message }, { status: 400 });
  }
}

async function handleWishlistRemoveGet(
  params: URLSearchParams,
  shop: string,
  shopifyCustomerId: string,
  kind: "wishlist" | "saved",
) {
  if (!checkRateLimit(`wishlist-remove:${shopifyCustomerId}`, 60)) {
    return json({ error: "Rate limited" }, { status: 429 });
  }
  // Removal is allowed even when disabled, so customers can clean up
  // existing items.

  if (kind === "wishlist") {
    const productId = params.get("productId");
    if (!productId) return json({ error: "productId required" }, { status: 400 });
    await removeWishlistProduct(shop, shopifyCustomerId, productId);
  } else {
    const variantId = params.get("variantId");
    if (!variantId) return json({ error: "variantId required" }, { status: 400 });
    await removeSavedVariant(shop, shopifyCustomerId, variantId);
  }
  return json({ success: true });
}

async function handleWishlistMerge(
  request: Request,
  shop: string,
  shopifyCustomerId: string,
) {
  if (!checkRateLimit(`wishlist-merge:${shopifyCustomerId}`, 5)) {
    return json({ error: "Rate limited" }, { status: 429 });
  }

  let body: { wishlist?: any[]; saved?: any[] } = {};
  try {
    const ct = request.headers.get("content-type") || "";
    body = ct.includes("application/json")
      ? await request.json()
      : Object.fromEntries(await request.formData());
    if (typeof body.wishlist === "string") {
      try { body.wishlist = JSON.parse(body.wishlist); } catch { body.wishlist = []; }
    }
    if (typeof body.saved === "string") {
      try { body.saved = JSON.parse(body.saved); } catch { body.saved = []; }
    }
  } catch {
    return json({ error: "Invalid body" }, { status: 400 });
  }

  const merged = await mergeGuestItems(shop, shopifyCustomerId, {
    wishlist: (body.wishlist || []).map((w: any) => ({
      shopId: shop,
      shopifyCustomerId,
      kind: "wishlist" as const,
      productId: String(w.productId || ""),
      productHandle: w.productHandle,
      productTitle: w.productTitle,
      imageUrl: w.imageUrl,
      price: w.price ? Number(w.price) : undefined,
    })),
    saved: (body.saved || []).map((s: any) => ({
      shopId: shop,
      shopifyCustomerId,
      kind: "saved" as const,
      productId: String(s.productId || ""),
      variantId: String(s.variantId || ""),
      productHandle: s.productHandle,
      productTitle: s.productTitle,
      variantTitle: s.variantTitle,
      imageUrl: s.imageUrl,
      price: s.price ? Number(s.price) : undefined,
      quantity: s.quantity ? Number(s.quantity) : 1,
    })),
  });

  return json(merged, { headers: { "Cache-Control": "no-store" } });
}

// ─── Sales Pop ──────────────────────────────────────────────────

async function handleGetSalesPopSettings(shop: string) {
  const s = await SalesPopSettings.findOne({ shopId: shop }).lean();
  if (!s?.enabled) {
    return json({ enabled: false }, { headers: { "Cache-Control": "no-store" } });
  }
  return json(
    {
      enabled: true,
      messageTemplate: s.messageTemplate,
      ctaLabel: s.ctaLabel,
      showCta: s.showCta,
      showThumbnail: s.showThumbnail,
      showOnProduct: s.showOnProduct,
      showOnCollection: s.showOnCollection,
      showOnHome: s.showOnHome,
      matchMode: s.matchMode,
      initialDelaySeconds: s.initialDelaySeconds,
      minIntervalSeconds: s.minIntervalSeconds,
      maxIntervalSeconds: s.maxIntervalSeconds,
      maxPerSession: s.maxPerSession,
      position: s.position,
      accentColor: s.accentColor,
      bgColor: s.bgColor,
      textColor: s.textColor,
      borderRadius: s.borderRadius,
      showOnMobile: s.showOnMobile,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

async function handleGetSalesPopEvents(params: URLSearchParams, shop: string) {
  const s = await SalesPopSettings.findOne({ shopId: shop }).lean();
  if (!s?.enabled) return json({ events: [] });

  const context = (params.get("context") || "global").toLowerCase();
  const productHandle = (params.get("productHandle") || "").trim();
  const collectionId = (params.get("collectionId") || "").trim();
  const limit = Math.max(1, Math.min(20, Number(params.get("limit")) || 10));

  const freshnessMs = (s.freshnessHours || 72) * 60 * 60 * 1000;
  const minAgeMs = (s.minOrderAgeMinutes || 0) * 60 * 1000;
  const now = Date.now();
  const maxPurchasedAt = new Date(now - minAgeMs);
  const minPurchasedAt = new Date(now - freshnessMs);

  const baseQuery: Record<string, unknown> = {
    shopId: shop,
    isActive: true,
    purchasedAt: { $gte: minPurchasedAt, $lte: maxPurchasedAt },
  };

  // Build a tiered match strategy depending on context + merchant setting
  const tiers: Array<Record<string, unknown>> = [];
  const wantsProduct =
    context === "product" &&
    productHandle &&
    (s.matchMode === "product" || s.matchMode === "collection");
  const wantsCollection =
    (context === "product" || context === "collection") &&
    collectionId &&
    (s.matchMode === "collection" || s.matchMode === "global");

  if (wantsProduct) tiers.push({ productHandle });
  if (wantsCollection) tiers.push({ collectionIds: collectionId });
  // Global fallback (for home page, or when product/collection feeds are empty)
  tiers.push({});

  const collected: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  for (const filter of tiers) {
    if (collected.length >= limit) break;
    const docs = await SalesPopEvent.find({ ...baseQuery, ...filter })
      .sort({ purchasedAt: -1 })
      .limit(limit * 2)
      .lean();
    for (const d of docs) {
      const key = String(d._id);
      if (seen.has(key)) continue;
      seen.add(key);
      collected.push(d);
      if (collected.length >= limit) break;
    }
  }

  const events = collected.slice(0, limit).map((d) => ({
    id: String(d._id),
    productHandle: d.productHandle,
    productTitle: d.productTitle,
    productImage: d.productImage || "",
    displayName: formatDisplayName(
      d.rawFirstName as string | undefined,
      s.nameStyle,
      s.genericFallback,
    ),
    displayLocation: formatDisplayLocation(
      d.rawCity as string | undefined,
      d.rawState as string | undefined,
      d.rawCountry as string | undefined,
      s.locationStyle,
    ),
    freshness: formatFreshness(new Date(d.purchasedAt as Date)),
  }));

  return json({ events }, { headers: { "Cache-Control": "no-store" } });
}
