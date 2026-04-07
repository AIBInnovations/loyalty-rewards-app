import mongoose from "mongoose";
import { AbandonedCart } from "../models/abandoned-cart.model";
import { VoiceAgentSettings } from "../models/voice-agent-settings.model";
import { connectDB } from "../../db.server";

/**
 * Poll all shops for abandoned checkouts via Shopify Admin API.
 * Runs every 2 minutes as a cron job.
 */
export async function pollAllShopsForAbandonedCarts(): Promise<void> {
  try {
    await connectDB();

    // Find all shops with voice agent enabled
    const enabledShops = await VoiceAgentSettings.find({ enabled: true }).lean();
    if (!enabledShops.length) return;

    // Get sessions for each shop
    const db = mongoose.connection.db;
    if (!db) return;
    const sessionsCollection = db.collection("shopify_sessions");

    for (const shopSettings of enabledShops) {
      const session = await sessionsCollection.findOne({
        shop: shopSettings.shopId,
        isOnline: false,
        accessToken: { $exists: true, $ne: "" },
      });

      if (!session?.accessToken) continue;

      try {
        await pollShopAbandonedCheckouts(
          shopSettings.shopId,
          session.accessToken,
          shopSettings.callDelayMinutes,
        );
      } catch (err) {
        console.error(`Abandoned cart poll failed for ${shopSettings.shopId}:`, err);
      }
    }
  } catch (err) {
    console.error("pollAllShopsForAbandonedCarts error:", err);
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
  // Fetch recent abandoned checkouts (last 2 hours)
  const sinceDate = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

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
    const checkouts = result?.data?.abandonedCheckouts?.nodes || [];

    for (const checkout of checkouts) {
      await processCheckout(shop, checkout, callDelayMinutes);
    }
  } catch (err) {
    // Fallback: try REST API if GraphQL fails
    try {
      const response = await fetch(
        `https://${shop}/admin/api/2025-01/checkouts.json?updated_at_min=${sinceDate}&limit=50`,
        {
          headers: { "X-Shopify-Access-Token": accessToken },
        },
      );
      const data = await response.json();
      const checkouts = data?.checkouts || [];

      for (const checkout of checkouts) {
        await processRestCheckout(shop, checkout, callDelayMinutes);
      }
    } catch (restErr) {
      console.error(`REST fallback failed for ${shop}:`, restErr);
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

  // Extract phone number (try multiple sources)
  const phone =
    checkout.customer?.phone ||
    checkout.shippingAddress?.phone ||
    "";

  if (!phone) return; // Can't call without phone number

  // Extract customer info
  const customerName = [
    checkout.customer?.firstName,
    checkout.customer?.lastName,
  ]
    .filter(Boolean)
    .join(" ") || "Customer";

  // Extract cart items
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

  const callScheduledAt = new Date(
    Date.now() + callDelayMinutes * 60 * 1000,
  );
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  // Atomic upsert — prevents duplicate key errors from race conditions
  // between the poller and the CHECKOUTS_UPDATE webhook
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

  if (result) return; // Already existed, skip log

  console.log(
    `Abandoned cart detected: ${customerName} (${phone}) - ₹${(cartTotal / 100).toFixed(0)} - call in ${callDelayMinutes}min`,
  );
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

  if (checkout.completed_at) return; // Not abandoned

  const phone =
    checkout.phone ||
    checkout.shipping_address?.phone ||
    checkout.billing_address?.phone ||
    checkout.customer?.phone ||
    "";

  if (!phone) return;

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

  const callScheduledAt = new Date(
    Date.now() + callDelayMinutes * 60 * 1000,
  );
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  // Atomic upsert — prevents duplicate key errors from race conditions
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

  if (result) return; // Already existed, skip log

  console.log(
    `Abandoned cart detected (REST): ${customerName} (${phone}) - ₹${(cartTotal / 100).toFixed(0)}`,
  );
}

/**
 * Handle checkout webhook (checkouts/create or checkouts/update).
 * Used as a faster detection path alongside polling.
 */
export async function handleCheckoutWebhook(
  shop: string,
  payload: Record<string, any>,
): Promise<void> {
  // If checkout is completed, mark as recovered if we were tracking it
  if (payload.completed_at) {
    await AbandonedCart.findOneAndUpdate(
      { shopId: shop, shopifyCheckoutId: String(payload.id), status: { $nin: ["recovered", "expired"] } },
      { $set: { status: "recovered", recoveredOrderId: String(payload.order_id || "") } },
    );
    return;
  }

  // Get voice agent settings
  const settings = await VoiceAgentSettings.findOne({ shopId: shop, enabled: true });
  if (!settings) return;

  // Process as potential abandoned cart
  await processRestCheckout(shop, payload, settings.callDelayMinutes);
}
