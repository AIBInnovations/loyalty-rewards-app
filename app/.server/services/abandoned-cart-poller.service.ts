import mongoose from "mongoose";
import { AbandonedCart } from "../models/abandoned-cart.model";
import { VoiceAgentSettings } from "../models/voice-agent-settings.model";
import { connectDB } from "../../db.server";

const LOG = {
  info: (msg: string) => console.log(`[AbandonedCart] ${msg}`),
  warn: (msg: string) => console.warn(`[AbandonedCart] ⚠️  ${msg}`),
  error: (msg: string, err?: unknown) => console.error(`[AbandonedCart] ❌ ${msg}`, err || ""),
  detect: (msg: string) => console.log(`[AbandonedCart] 🛒 ${msg}`),
  skip: (checkoutId: string, reason: string) => console.log(`[AbandonedCart] ⏭️  SKIP checkout:${checkoutId} | ${reason}`),
};

/**
 * Poll all shops for abandoned checkouts via Shopify Admin API.
 * Runs every 2 minutes as a cron job.
 */
export async function pollAllShopsForAbandonedCarts(): Promise<void> {
  try {
    await connectDB();

    const enabledShops = await VoiceAgentSettings.find({ enabled: true }).lean();

    if (!enabledShops.length) {
      LOG.info("Poll run — no shops with voice agent enabled, skipping");
      return;
    }

    LOG.info(`Poll run — checking ${enabledShops.length} shop(s): ${enabledShops.map(s => s.shopId).join(", ")}`);

    const db = mongoose.connection.db;
    if (!db) return;
    const sessionsCollection = db.collection("shopify_sessions");

    for (const shopSettings of enabledShops) {
      const session = await sessionsCollection.findOne({
        shop: shopSettings.shopId,
        isOnline: false,
        accessToken: { $exists: true, $ne: "" },
      });

      if (!session?.accessToken) {
        LOG.warn(`No offline session found for ${shopSettings.shopId} — cannot poll Shopify API`);
        continue;
      }

      LOG.info(`Polling ${shopSettings.shopId} (session found, delay: ${shopSettings.callDelayMinutes}min)`);

      try {
        await pollShopAbandonedCheckouts(
          shopSettings.shopId,
          session.accessToken,
          shopSettings.callDelayMinutes,
        );
      } catch (err) {
        LOG.error(`Poll failed for ${shopSettings.shopId}:`, err);
      }
    }
  } catch (err) {
    LOG.error("pollAllShopsForAbandonedCarts error:", err);
  }
}

/**
 * Poll a single shop's abandoned checkouts.
 */
async function pollShopAbandonedCheckouts(
  shop: string,
  accessToken: string,
  callDelayMinutes: number,
): Promise<void> {
  const sinceDate = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  LOG.info(`Fetching checkouts updated after ${sinceDate} for ${shop}`);

  const query = `#graphql
    query abandonedCheckouts($query: String!) {
      abandonedCheckouts(first: 50, query: $query) {
        nodes {
          id
          createdAt
          updatedAt
          totalPriceSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          customer {
            id
            email
            phone
            firstName
            lastName
          }
          lineItems(first: 10) {
            nodes {
              title
              quantity
              variant {
                id
                price
                product {
                  id
                  featuredImage {
                    url
                  }
                }
              }
            }
          }
          shippingAddress {
            phone
          }
        }
      }
    }
  `;

  try {
    LOG.info(`Trying GraphQL API for ${shop}`);
    const response = await fetch(
      `https://${shop}/admin/api/2025-01/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": accessToken,
        },
        body: JSON.stringify({
          query,
          variables: { query: `updated_at:>'${sinceDate}'` },
        }),
      },
    );

    const result = await response.json();

    if (result.errors) {
      LOG.warn(`GraphQL errors for ${shop}: ${JSON.stringify(result.errors)}`);
      throw new Error("GraphQL returned errors");
    }

    const checkouts = result?.data?.abandonedCheckouts?.nodes || [];
    LOG.info(`GraphQL returned ${checkouts.length} checkout(s) for ${shop}`);

    for (const checkout of checkouts) {
      LOG.info(`GraphQL checkout | id: ${checkout.id} | customer: ${checkout.customer?.firstName} ${checkout.customer?.lastName} | phone: ${checkout.customer?.phone || checkout.shippingAddress?.phone || "NONE"} | total: ₹${parseFloat(checkout.totalPriceSet?.shopMoney?.amount || "0").toFixed(0)} | items: ${checkout.lineItems?.nodes?.length || 0}`);
      await processCheckout(shop, checkout, callDelayMinutes);
    }
  } catch (err) {
    LOG.warn(`GraphQL failed for ${shop} — falling back to REST API. Error: ${(err as Error).message}`);
    try {
      const restUrl = `https://${shop}/admin/api/2025-01/checkouts.json?updated_at_min=${sinceDate}&limit=50`;
      LOG.info(`REST fallback URL: ${restUrl}`);
      const response = await fetch(restUrl, {
        headers: { "X-Shopify-Access-Token": accessToken },
      });
      const data = await response.json();
      const checkouts = data?.checkouts || [];
      LOG.info(`REST API returned ${checkouts.length} checkout(s) for ${shop}`);

      for (const checkout of checkouts) {
        LOG.info(`REST checkout | id: ${checkout.id} | completed_at: ${checkout.completed_at || "null (abandoned)"} | customer: ${checkout.customer?.first_name} ${checkout.customer?.last_name} | phone: ${checkout.phone || checkout.shipping_address?.phone || checkout.customer?.phone || "NONE"} | total: ₹${parseFloat(checkout.total_price || "0").toFixed(0)} | items: ${checkout.line_items?.length || 0}`);
        await processRestCheckout(shop, checkout, callDelayMinutes);
      }
    } catch (restErr) {
      LOG.error(`REST fallback also failed for ${shop}:`, restErr);
    }
  }
}

/**
 * Process a single checkout from GraphQL response.
 */
async function processCheckout(
  shop: string,
  checkout: Record<string, any>,
  callDelayMinutes: number,
): Promise<void> {
  const checkoutId = checkout.id;

  const phone =
    checkout.customer?.phone ||
    checkout.shippingAddress?.phone ||
    "";

  if (!phone) {
    LOG.skip(checkoutId, "No phone number (customer.phone and shippingAddress.phone both empty)");
    return;
  }

  const customerName = [
    checkout.customer?.firstName,
    checkout.customer?.lastName,
  ]
    .filter(Boolean)
    .join(" ") || "Customer";

  const cartItems = (checkout.lineItems?.nodes || []).map((item: any) => ({
    productId: item.variant?.product?.id || "",
    title: item.title,
    quantity: item.quantity,
    price: parseFloat(item.variant?.price || "0") * 100,
    imageUrl: item.variant?.product?.featuredImage?.url || "",
  }));

  const cartTotal = parseFloat(
    checkout.totalPriceSet?.shopMoney?.amount || "0",
  ) * 100;

  const callScheduledAt = new Date(Date.now() + callDelayMinutes * 60 * 1000);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const result = await AbandonedCart.findOneAndUpdate(
    { shopId: shop, shopifyCheckoutId: checkoutId },
    {
      $setOnInsert: {
        shopId: shop,
        shopifyCheckoutId: checkoutId,
        shopifyCheckoutToken: checkout.token || "",
        customerEmail: checkout.customer?.email || "",
        customerPhone: phone,
        customerName,
        customerId: checkout.customer?.id || "",
        cartItems,
        cartTotal,
        currency: checkout.totalPriceSet?.shopMoney?.currencyCode || "INR",
        abandonedCheckoutUrl: `https://${shop}/checkouts/${checkout.token || ""}`,
        status: "scheduled",
        callScheduledAt,
        expiresAt,
        detectedAt: new Date(),
      },
    },
    { upsert: true, new: false },
  );

  if (result) {
    LOG.skip(checkoutId, "Already tracked in DB — skipping duplicate");
    return;
  }

  LOG.detect(`NEW cart saved | customer: ${customerName} | phone: ${phone} | total: ₹${(cartTotal / 100).toFixed(0)} | items: ${cartItems.map((i: any) => i.title).join(", ")} | call scheduled at: ${callScheduledAt.toISOString()} (in ${callDelayMinutes}min)`);
}

/**
 * Process a single checkout from REST API response.
 */
async function processRestCheckout(
  shop: string,
  checkout: Record<string, any>,
  callDelayMinutes: number,
): Promise<void> {
  const checkoutId = String(checkout.id);

  if (checkout.completed_at) {
    LOG.skip(checkoutId, `Checkout completed at ${checkout.completed_at} — not abandoned`);
    return;
  }

  const phone =
    checkout.phone ||
    checkout.shipping_address?.phone ||
    checkout.billing_address?.phone ||
    checkout.customer?.phone ||
    "";

  if (!phone) {
    LOG.skip(checkoutId, "No phone number in phone/shipping_address/billing_address/customer fields");
    return;
  }

  const customerName = [
    checkout.customer?.first_name,
    checkout.customer?.last_name,
  ]
    .filter(Boolean)
    .join(" ") || "Customer";

  const cartItems = (checkout.line_items || []).map((item: any) => ({
    productId: String(item.product_id || ""),
    title: item.title,
    quantity: item.quantity,
    price: parseFloat(item.price || "0") * 100,
    imageUrl: "",
  }));

  const cartTotal = parseFloat(checkout.total_price || "0") * 100;
  const callScheduledAt = new Date(Date.now() + callDelayMinutes * 60 * 1000);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const result = await AbandonedCart.findOneAndUpdate(
    { shopId: shop, shopifyCheckoutId: checkoutId },
    {
      $setOnInsert: {
        shopId: shop,
        shopifyCheckoutId: checkoutId,
        shopifyCheckoutToken: checkout.token || "",
        customerEmail: checkout.email || checkout.customer?.email || "",
        customerPhone: phone,
        customerName,
        customerId: String(checkout.customer?.id || ""),
        cartItems,
        cartTotal,
        currency: checkout.currency || "INR",
        abandonedCheckoutUrl: checkout.abandoned_checkout_url || "",
        status: "scheduled",
        callScheduledAt,
        expiresAt,
        detectedAt: new Date(),
      },
    },
    { upsert: true, new: false },
  );

  if (result) {
    LOG.skip(checkoutId, "Already tracked in DB — skipping duplicate");
    return;
  }

  LOG.detect(`NEW cart saved (REST) | customer: ${customerName} | phone: ${phone} | total: ₹${(cartTotal / 100).toFixed(0)} | items: ${cartItems.map((i: any) => i.title).join(", ")} | call scheduled at: ${callScheduledAt.toISOString()} (in ${callDelayMinutes}min)`);
}

/**
 * Handle checkout webhook (checkouts/create or checkouts/update).
 */
export async function handleCheckoutWebhook(
  shop: string,
  payload: Record<string, any>,
): Promise<void> {
  LOG.info(`Webhook received | shop: ${shop} | checkout: ${payload.id} | completed_at: ${payload.completed_at || "null"} | phone: ${payload.phone || payload.shipping_address?.phone || "NONE"} | total: ₹${parseFloat(payload.total_price || "0").toFixed(0)}`);

  if (payload.completed_at) {
    LOG.info(`Checkout ${payload.id} completed — marking as recovered if tracked`);
    const updated = await AbandonedCart.findOneAndUpdate(
      { shopId: shop, shopifyCheckoutId: String(payload.id), status: { $nin: ["recovered", "expired"] } },
      { $set: { status: "recovered", recoveredOrderId: String(payload.order_id || "") } },
    );
    if (updated) {
      LOG.detect(`Cart recovered via checkout completion | customer: ${updated.customerName} | order: ${payload.order_id}`);
    } else {
      LOG.info(`Checkout ${payload.id} completed but was not being tracked`);
    }
    return;
  }

  const settings = await VoiceAgentSettings.findOne({ shopId: shop, enabled: true });
  if (!settings) {
    LOG.warn(`Webhook for ${shop} — voice agent not enabled, ignoring checkout`);
    return;
  }

  await processRestCheckout(shop, payload, settings.callDelayMinutes);
}
