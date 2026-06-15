import type { ActionFunctionArgs } from "@remix-run/node";
import crypto from "crypto";
import { authenticate } from "../shopify.server";
import { connectDB } from "../db.server";
import { WebhookEvent } from "../.server/models/webhook-event.model";
import { PlatformShop, upsertPlatformShop } from "../.server/models/platform-shop.model";
import { recordAuditLog } from "../.server/models/audit-log.model";
import { ProductCache } from "../.server/models/product-cache.model";
import { OrderCache } from "../.server/models/order-cache.model";
import {
  handleOrderPaid,
  handleOrderCancelled,
  handleRefundCreate,
  handleCustomerCreate,
  handleCustomerUpdate,
  handleCustomerDataRequest,
  handleCustomerRedact,
  handleShopRedact,
} from "../.server/services/webhook.service";
import { handleCheckoutWebhook } from "../.server/services/abandoned-cart-poller.service";
import { sendCodConfirmation } from "../.server/services/cod-whatsapp.service";
import { ingestOrderForSalesPop } from "../.server/services/sales-pop.service";
import {
  handleProductCreate,
  handleProductUpdate,
  handleProductDelete,
} from "../.server/services/image-search.service";

async function cacheProductWebhook(shop: string, payload: unknown, status?: string) {
  const product = payload as any;
  const shopifyProductId = String(product.id || "");
  if (!shopifyProductId) return;

  await ProductCache.findOneAndUpdate(
    { shopId: shop, shopifyProductId },
    {
      $set: {
        shopId: shop,
        shopifyProductId,
        title: String(product.title || ""),
        handle: String(product.handle || ""),
        status: status || String(product.status || ""),
        productJson: payload as Record<string, unknown>,
        syncedAt: new Date(),
      },
    },
    { upsert: true, setDefaultsOnInsert: true },
  );
}

async function cacheOrderWebhook(shop: string, payload: unknown, fallbackStatus = "") {
  const order = payload as any;
  const shopifyOrderId = String(order.id || "");
  if (!shopifyOrderId) return;

  await OrderCache.findOneAndUpdate(
    { shopId: shop, shopifyOrderId },
    {
      $set: {
        shopId: shop,
        shopifyOrderId,
        name: String(order.name || ""),
        financialStatus: String(order.financial_status || fallbackStatus),
        fulfillmentStatus: String(order.fulfillment_status || ""),
        totalPrice: Number(order.total_price || 0),
        currency: String(order.currency || ""),
        orderJson: payload as Record<string, unknown>,
        syncedAt: new Date(),
      },
    },
    { upsert: true, setDefaultsOnInsert: true },
  );
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, session, admin, payload } =
    await authenticate.webhook(request);

  await connectDB();
  await upsertPlatformShop({
    shopId: shop,
    shopDomain: shop,
    status: topic === "APP_UNINSTALLED" ? "uninstalled" : "active",
  });

  const webhookId =
    request.headers.get("x-shopify-webhook-id") ||
    crypto
      .createHash("sha256")
      .update(`${shop}:${topic}:${JSON.stringify(payload)}`)
      .digest("hex");
  const payloadHash = crypto
    .createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
  const webhookEvent = await WebhookEvent.findOneAndUpdate(
    { shopId: shop, webhookId },
    {
      $setOnInsert: {
        shopId: shop,
        topic,
        webhookId,
        payloadHash,
        status: "received",
        receivedAt: new Date(),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  // Webhook handlers should return 200 quickly.
  // We process inline here but could move to a job queue for scale.
  try {
    switch (topic) {
      case "ORDERS_PAID":
        if (admin) {
          await handleOrderPaid(shop, payload, admin as any);
        }
        await cacheOrderWebhook(shop, payload, "paid");
        // Fire-and-forget COD WhatsApp confirmation (non-blocking)
        sendCodConfirmation(shop, payload).catch((err) =>
          console.error("[COD-WhatsApp] Error:", err),
        );
        // Fire-and-forget Sales Pop event ingestion (non-blocking)
        if (admin) {
          ingestOrderForSalesPop(shop, payload, admin as any).catch((err) =>
            console.error("[SalesPop] Ingest error:", err),
          );
        }
        break;

      case "ORDERS_CANCELLED":
        if (admin) {
          await handleOrderCancelled(shop, payload, admin as any);
        }
        await cacheOrderWebhook(shop, payload, "cancelled");
        break;

      case "REFUNDS_CREATE":
        if (admin) {
          await handleRefundCreate(shop, payload, admin as any);
        }
        break;

      case "CUSTOMERS_CREATE":
        if (admin) {
          await handleCustomerCreate(shop, payload, admin as any);
        }
        break;

      case "CUSTOMERS_UPDATE":
        await handleCustomerUpdate(shop, payload);
        break;

      case "CHECKOUTS_CREATE":
      case "CHECKOUTS_UPDATE":
        await handleCheckoutWebhook(shop, payload);
        break;

      case "PRODUCTS_CREATE":
        await cacheProductWebhook(shop, payload);
        // Fire-and-forget — must return 200 quickly
        handleProductCreate(shop, payload).catch((err) =>
          console.error("[ImageSearch] PRODUCTS_CREATE error:", err),
        );
        break;

      case "PRODUCTS_UPDATE":
        await cacheProductWebhook(shop, payload);
        handleProductUpdate(shop, payload).catch((err) =>
          console.error("[ImageSearch] PRODUCTS_UPDATE error:", err),
        );
        break;

      case "PRODUCTS_DELETE":
        await cacheProductWebhook(shop, payload, "deleted");
        handleProductDelete(shop, payload).catch((err) =>
          console.error("[ImageSearch] PRODUCTS_DELETE error:", err),
        );
        break;

      case "APP_UNINSTALLED":
        // Session cleanup is handled by the shopify-app-remix package
        console.log(`App uninstalled from ${shop}`);
        await PlatformShop.findOneAndUpdate(
          { shopId: shop },
          {
            $set: {
              status: "uninstalled",
              uninstalledAt: new Date(),
              lastWebhookAt: new Date(),
            },
          },
        );
        await recordAuditLog({
          actorType: "webhook",
          actorId: topic,
          shopId: shop,
          action: "shop.uninstalled",
          targetType: "shop",
          targetId: shop,
          metadata: { webhookId },
        });
        break;

      case "CUSTOMERS_DATA_REQUEST":
        await handleCustomerDataRequest(shop, payload);
        break;

      case "CUSTOMERS_REDACT":
        await handleCustomerRedact(shop, payload);
        break;

      case "SHOP_REDACT":
        await handleShopRedact(shop);
        break;

      default:
        console.log(`Unhandled webhook topic: ${topic}`);
    }

    await webhookEvent.updateOne({
      $set: {
        status: "processed",
        processedAt: new Date(),
      },
    });
    await PlatformShop.findOneAndUpdate(
      { shopId: shop },
      { $set: { lastWebhookAt: new Date() } },
    );
  } catch (error) {
    console.error(`Webhook handler error [${topic}]:`, error);
    await webhookEvent.updateOne({
      $set: {
        status: "failed",
        errorMessage: error instanceof Error ? error.message : String(error),
      },
    });
    // Still return 200 to prevent Shopify from retrying on app errors.
    // Idempotency keys protect us if retries happen for network issues.
  }

  return new Response(null, { status: 200 });
};
