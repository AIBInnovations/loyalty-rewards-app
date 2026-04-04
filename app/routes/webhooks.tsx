import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { connectDB } from "../db.server";
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

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, session, admin, payload } =
    await authenticate.webhook(request);

  await connectDB();

  // Webhook handlers should return 200 quickly.
  // We process inline here but could move to a job queue for scale.
  try {
    switch (topic) {
      case "ORDERS_PAID":
        if (admin) {
          await handleOrderPaid(shop, payload, admin as any);
        }
        break;

      case "ORDERS_CANCELLED":
        if (admin) {
          await handleOrderCancelled(shop, payload, admin as any);
        }
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

      case "APP_UNINSTALLED":
        // Session cleanup is handled by the shopify-app-remix package
        console.log(`App uninstalled from ${shop}`);
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
  } catch (error) {
    console.error(`Webhook handler error [${topic}]:`, error);
    // Still return 200 to prevent Shopify from retrying on app errors.
    // Idempotency keys protect us if retries happen for network issues.
  }

  return new Response(null, { status: 200 });
};
