import "@shopify/shopify-app-remix/adapters/node";
import {
  AppDistribution,
  shopifyApp,
  DeliveryMethod,
} from "@shopify/shopify-app-remix/server";
import { MongoSessionStorage } from "./.server/mongo-session-storage.server";
import { connectDB } from "./db.server";
import { upsertPlatformShop } from "./.server/models/platform-shop.model";
import { recordAuditLog } from "./.server/models/audit-log.model";
import { upsertShopToken } from "./.server/models/shop-token.model";
import { Subscription } from "./.server/models/subscription.model";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY!,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: "2025-01",
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new MongoSessionStorage(
    process.env.MONGODB_URI || "mongodb://localhost:27017/loyalty-rewards",
    "loyalty-rewards",
  ),
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
          scopes: session.scope?.split(",") || [],
          status: "active",
        });
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

export default shopify;
export const apiVersion = "2025-01";
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
