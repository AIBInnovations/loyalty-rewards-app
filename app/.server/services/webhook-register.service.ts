import mongoose from "mongoose";

/**
 * Auto-register webhooks on server startup.
 * Reads all active shop sessions from MongoDB and re-registers
 * webhooks with the current app URL (tunnel URL in dev).
 * This ensures webhooks always point to the correct URL even
 * when the tunnel changes on restart.
 */
export async function registerWebhooksOnStartup(): Promise<void> {
  try {
    // Wait a bit for the server to be fully ready and env vars to be set
    await new Promise((resolve) => setTimeout(resolve, 5000));

    const appUrl = process.env.SHOPIFY_APP_URL;
    if (!appUrl) {
      console.log("SHOPIFY_APP_URL not set, skipping webhook auto-registration");
      return;
    }

    console.log(`Auto-registering webhooks with URL: ${appUrl}`);

    // Get all offline sessions from MongoDB (these are shop sessions)
    const db = mongoose.connection.db;
    if (!db) {
      console.error("MongoDB not connected, cannot register webhooks");
      return;
    }

    const sessionsCollection = db.collection("shopify_sessions");
    const sessions = await sessionsCollection
      .find({ isOnline: false, accessToken: { $exists: true, $ne: "" } })
      .toArray();

    if (sessions.length === 0) {
      console.log("No shop sessions found, skipping webhook registration");
      return;
    }

    const webhookTopics = [
      "ORDERS_PAID",
      "ORDERS_CANCELLED",
      "REFUNDS_CREATE",
      "CUSTOMERS_CREATE",
      "CUSTOMERS_UPDATE",
      "CHECKOUTS_CREATE",
      "CHECKOUTS_UPDATE",
      "APP_UNINSTALLED",
    ];

    for (const session of sessions) {
      const shop = session.shop;
      const accessToken = session.accessToken;

      if (!shop || !accessToken) continue;

      console.log(`Registering webhooks for ${shop}...`);

      for (const topic of webhookTopics) {
        try {
          const callbackUrl = `${appUrl}/webhooks`;

          // Use the REST-style webhook registration via GraphQL
          const query = `
            mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
              webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
                webhookSubscription {
                  id
                }
                userErrors {
                  field
                  message
                }
              }
            }
          `;

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
                variables: {
                  topic,
                  webhookSubscription: {
                    callbackUrl,
                    format: "JSON",
                  },
                },
              }),
            },
          );

          const result = await response.json();
          const errors = result?.data?.webhookSubscriptionCreate?.userErrors;

          if (errors && errors.length > 0) {
            // "already exists" is fine - just means it's already registered
            const isAlreadyExists = errors.some((e: { message: string }) =>
              e.message?.includes("already exists") || e.message?.includes("has already been taken"),
            );
            if (!isAlreadyExists) {
              console.warn(`  ${topic}: ${errors[0].message}`);
            }
          } else {
            console.log(`  ${topic}: ✅ registered`);
          }
        } catch (err) {
          console.error(`  ${topic}: failed -`, (err as Error).message);
        }
      }
    }

    console.log("Webhook auto-registration complete.");
  } catch (error) {
    console.error("Webhook auto-registration failed:", error);
  }
}
