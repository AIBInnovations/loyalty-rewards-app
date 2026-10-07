import "@shopify/shopify-app-remix/adapters/node";
import {
  AppDistribution,
  shopifyApp,
  DeliveryMethod,
} from "@shopify/shopify-app-remix/server";
import { MongoSessionStorage } from "./.server/mongo-session-storage.server";
import { connectDB } from "./db.server";
import {
  PlatformShop,
  upsertPlatformShop,
} from "./.server/models/platform-shop.model";
import { recordAuditLog } from "./.server/models/audit-log.model";
import { upsertShopToken } from "./.server/models/shop-token.model";
import { Subscription } from "./.server/models/subscription.model";
import {
  loadShopifyApps,
  readTokenAudience,
  verifyWebhookHmac,
  type ShopifyAppCredentials,
} from "./.server/shopify-apps.server";

// Shared by every app registration: a shop only ever installs one of them, so
// its offline session id (`offline_<shop>`) never collides.
const sessionStorage = new MongoSessionStorage(
  process.env.MONGODB_URI || "mongodb://localhost:27017/loyalty-rewards",
  "loyalty-rewards",
);

function createShopifyApp(credentials: ShopifyAppCredentials) {
  const shopify = shopifyApp({
    apiKey: credentials.apiKey,
    apiSecretKey: credentials.apiSecret,
    apiVersion: "2025-01",
    scopes: process.env.SCOPES?.split(","),
    appUrl: process.env.SHOPIFY_APP_URL || "",
    authPathPrefix: "/auth",
    sessionStorage,
    distribution: AppDistribution.AppStore,
    isEmbeddedApp: true,
    webhooks: {
      APP_UNINSTALLED: {
        deliveryMethod: DeliveryMethod.Http,
        callbackUrl: "/webhooks",
      },
    },
    hooks: {
      afterAuth: async ({ session }) => {
        try {
          await connectDB();
          await upsertPlatformShop({
            shopId: session.shop,
            shopDomain: session.shop,
            appClientId: credentials.apiKey,
            scopes: session.scope?.split(",") || [],
            status: "active",
          });
          shopAppCache.set(session.shop, credentials.apiKey);
          if (session.accessToken) {
            await upsertShopToken({
              shopId: session.shop,
              tokenType: session.isOnline ? "online" : "offline",
              token: session.accessToken,
              scopes: session.scope?.split(",") || [],
              expiresAt: session.expires,
            });
          }
          await Subscription.findOneAndUpdate(
            { shopId: session.shop },
            {
              $setOnInsert: {
                shopId: session.shop,
                plan: "free",
                billingState: "trial",
              },
            },
            { upsert: true, setDefaultsOnInsert: true },
          );
          await recordAuditLog({
            actorType: "system",
            actorId: "shopify-auth",
            shopId: session.shop,
            action: "shop.authenticated",
            targetType: "shop",
            targetId: session.shop,
            metadata: { scopes: session.scope || "" },
          });
        } catch (error) {
          console.error("Failed to update platform shop after auth:", error);
        }
        shopify.registerWebhooks({ session });
      },
    },
    future: {
      unstable_newEmbeddedAuthStrategy: true,
    },
    ...(process.env.SHOP_CUSTOM_DOMAIN
      ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
      : {}),
  });

  return shopify;
}

// One library instance per app registration this server answers for — see
// .server/shopify-apps.server.ts for why there can be more than one.
const apps = loadShopifyApps().map((credentials) => ({
  credentials,
  shopify: createShopifyApp(credentials),
}));

const primary = apps[0];
if (!primary) {
  throw new Error(
    "Missing required environment variables: SHOPIFY_API_KEY, SHOPIFY_API_SECRET.",
  );
}

export const configuredClientIds = apps.map((app) => app.credentials.apiKey);

const appsByKey = new Map(apps.map((app) => [app.credentials.apiKey, app]));

// shop domain -> client ID of the app it installed. Only ever written after
// the library has verified a request with that app's secret, and persisted on
// PlatformShop so it survives restarts.
const shopAppCache = new Map<string, string>();

async function rememberShopApp(shop: string, apiKey: string) {
  if (shopAppCache.get(shop) === apiKey) return;
  shopAppCache.set(shop, apiKey);
  // Awaited (not fire-and-forget) so the write can't land after a webhook
  // handler such as SHOP_REDACT has already removed the shop's record.
  try {
    await connectDB();
    await upsertPlatformShop({ shopId: shop, appClientId: apiKey });
  } catch (error) {
    console.error("Failed to record which app a shop installed:", error);
  }
}

async function appForShop(shop: string | null | undefined) {
  if (!shop || apps.length === 1) return primary;

  let apiKey = shopAppCache.get(shop);
  if (!apiKey) {
    try {
      await connectDB();
      const record = await PlatformShop.findOne(
        { shopId: shop },
        { appClientId: 1 },
      ).lean();
      apiKey = record?.appClientId || undefined;
    } catch (error) {
      console.error("Failed to look up which app a shop installed:", error);
    }
    if (apiKey) shopAppCache.set(shop, apiKey);
  }

  return (apiKey && appsByKey.get(apiKey)) || primary;
}

/**
 * Pick the app an embedded admin request belongs to. The session token's
 * `aud` claim names it; requests without a token (the session-token bounce
 * page, the login form) fall back to the app the shop is known to have
 * installed.
 */
async function appForAdminRequest(request: Request) {
  if (apps.length === 1) return primary;

  const url = new URL(request.url);
  const bearer = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "");
  const audience =
    readTokenAudience(bearer) ??
    readTokenAudience(url.searchParams.get("id_token"));
  const byAudience = audience ? appsByKey.get(audience) : undefined;

  return byAudience ?? appForShop(url.searchParams.get("shop"));
}

/** Pick the app whose secret signed this webhook. */
async function appForWebhookRequest(request: Request) {
  if (apps.length === 1) return primary;

  const hmac = request.headers.get("x-shopify-hmac-sha256");
  const rawBody = await request.clone().text();

  return (
    apps.find((app) =>
      verifyWebhookHmac(rawBody, hmac, app.credentials.apiSecret),
    ) ?? primary
  );
}

export const authenticate = {
  admin: async (request: Request) => {
    const app = await appForAdminRequest(request);
    const context = await app.shopify.authenticate.admin(request);
    await rememberShopApp(context.session.shop, app.credentials.apiKey);
    return context;
  },
  webhook: async (request: Request) => {
    const app = await appForWebhookRequest(request);
    const context = await app.shopify.authenticate.webhook(request);
    await rememberShopApp(context.shop, app.credentials.apiKey);
    return context;
  },
};

export const unauthenticated = {
  admin: async (shop: string) =>
    (await appForShop(shop)).shopify.unauthenticated.admin(shop),
};

export const login = async (request: Request) =>
  (await appForAdminRequest(request)).shopify.login(request);

/** Client ID App Bridge must be initialised with for this shop. */
export async function getApiKeyForShop(shop: string) {
  return (await appForShop(shop)).credentials.apiKey;
}

export const apiVersion = "2025-01";
// Only sets CSP / preload headers from the `shop` param — identical for every app.
export const addDocumentResponseHeaders =
  primary.shopify.addDocumentResponseHeaders;
export { sessionStorage };
