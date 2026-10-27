import mongoose from "mongoose";

// Hosts that only ever front a developer's laptop (`shopify app dev` tunnels).
// A webhook subscription pointing at one is dead the moment that session ends,
// but Shopify keeps retrying it, so it's safe to remove. STALE_WEBHOOK_HOSTS
// adds more (e.g. a retired deployment's host) as a comma-separated list.
const TUNNEL_HOST_SUFFIXES = [
  ".trycloudflare.com",
  ".ngrok-free.app",
  ".ngrok.io",
  ".ngrok.app",
  ".loca.lt",
];

export function isStaleWebhookCallback(
  callbackUrl: string,
  currentAppUrl: string,
  extraHosts: string[] = [],
): boolean {
  let host: string;
  let currentHost: string;
  try {
    host = new URL(callbackUrl).hostname.toLowerCase();
    currentHost = new URL(currentAppUrl).hostname.toLowerCase();
  } catch {
    return false;
  }
  // Never touch a subscription that already points at this deployment.
  if (host === currentHost) return false;
  return (
    TUNNEL_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix)) ||
    extraHosts.map((h) => h.trim().toLowerCase()).filter(Boolean).includes(host)
  );
}

async function shopGraphql(shop: string, accessToken: string, query: string, variables = {}) {
  const response = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });
  return response.json();
}

/** Delete this app's webhook subscriptions on a shop that point at a dead host. */
async function pruneStaleWebhooks(shop: string, accessToken: string, appUrl: string) {
  const extraHosts = (process.env.STALE_WEBHOOK_HOSTS || "").split(",");
  const listed = await shopGraphql(
    shop,
    accessToken,
    `query { webhookSubscriptions(first: 100) { nodes { id topic endpoint { ... on WebhookHttpEndpoint { callbackUrl } } } } }`,
  );
  if (!listed?.data?.webhookSubscriptions) {
    const reason = listed?.errors?.[0]?.message || (typeof listed?.errors === "string" ? listed.errors : "no data");
    throw new Error(`could not list webhook subscriptions: ${reason}`);
  }
  const nodes: Array<{ id: string; topic: string; endpoint?: { callbackUrl?: string } }> =
    listed.data.webhookSubscriptions.nodes ?? [];

  for (const node of nodes) {
    const callbackUrl = node.endpoint?.callbackUrl;
    if (!callbackUrl || !isStaleWebhookCallback(callbackUrl, appUrl, extraHosts)) continue;

    const result = await shopGraphql(
      shop,
      accessToken,
      `mutation($id: ID!) { webhookSubscriptionDelete(id: $id) { deletedWebhookSubscriptionId userErrors { message } } }`,
      { id: node.id },
    );
    const errors = result?.data?.webhookSubscriptionDelete?.userErrors;
    if (errors?.length) {
      console.warn(`  ${node.topic}: could not remove stale webhook ${callbackUrl}: ${errors[0].message}`);
    } else {
      console.log(`  ${node.topic}: removed stale webhook -> ${callbackUrl}`);
    }
  }
}

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
      "PRODUCTS_CREATE",
      "PRODUCTS_UPDATE",
      "PRODUCTS_DELETE",
    ];

    for (const session of sessions) {
      const shop = session.shop;
      const accessToken = session.accessToken;

      if (!shop || !accessToken) continue;

      console.log(`Registering webhooks for ${shop}...`);

      try {
        await pruneStaleWebhooks(shop, accessToken, appUrl);
      } catch (err) {
        const message = (err as Error).message;
        // Shopify has rejected this shop's token (app deleted, uninstalled, or
        // secret rotated), so every registration below would fail the same way.
        if (message.includes("Invalid API key or access token")) {
          console.warn(`  ${shop}: access token rejected by Shopify - skipping webhook registration (app uninstalled or deleted?)`);
          continue;
        }
        console.error(`  stale webhook cleanup failed for ${shop}:`, message);
      }

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

          // A rejected token or API failure comes back with top-level `errors`
          // (or no data) and no userErrors; that is a failure, not a success.
          if (!result?.data?.webhookSubscriptionCreate) {
            const reason =
              result?.errors?.[0]?.message ||
              (typeof result?.errors === "string" ? result.errors : `HTTP ${response.status}`);
            console.warn(`  ${topic}: ❌ not registered - ${reason}`);
            continue;
          }

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
