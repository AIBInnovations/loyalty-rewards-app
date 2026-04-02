import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { connectDB } from "../db.server";
import {
  verifyAppProxySignature,
  getCustomerIdFromProxy,
} from "../.server/utils/proxy-auth";
import { getBalance, redeemPoints } from "../.server/services/points.service";
import { Customer } from "../.server/models/customer.model";
import { Reward } from "../.server/models/reward.model";
import { Transaction } from "../.server/models/transaction.model";
import { Settings } from "../.server/models/settings.model";
import { unauthenticated } from "../shopify.server";
import { socialShareKey, birthdayBonusKey } from "../.server/utils/idempotency";
import { earnPoints } from "../.server/services/points.service";

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

  return handleGetBalance(shop, shopifyCustomerId);
};

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

  if (!shopifyCustomerId) {
    return json({ error: "Not logged in" }, { status: 401 });
  }

  // Extract sub-route from the catch-all: /api/proxy/redeem -> "redeem"
  const route = routeParams["*"] || "";

  switch (route) {
    case "redeem":
      return handleRedeem(request, shop, shopifyCustomerId);
    case "referral":
      return handleReferral(request, shop, shopifyCustomerId);
    case "social-share":
      return handleSocialShare(request, shop, shopifyCustomerId);
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
