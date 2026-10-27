import crypto from "crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";

const SHOP = "second-store.myshopify.com";
const PRIMARY = { apiKey: "primary-key", apiSecret: "primary-secret" };
const SECOND = { apiKey: "second-key", apiSecret: "second-secret" };

const sessions = new Map<string, unknown>();

vi.mock("./.server/mongo-session-storage.server", () => ({
  MongoSessionStorage: class {
    async storeSession(session: { id: string }) {
      sessions.set(session.id, session);
      return true;
    }
    async loadSession(id: string) {
      return sessions.get(id);
    }
    async deleteSession(id: string) {
      sessions.delete(id);
      return true;
    }
    async deleteSessions(ids: string[]) {
      ids.forEach((id) => sessions.delete(id));
      return true;
    }
    async findSessionsByShop() {
      return [];
    }
  },
}));
vi.mock("./db.server", () => ({ connectDB: vi.fn(async () => undefined) }));
vi.mock("./.server/models/platform-shop.model", () => ({
  upsertPlatformShop: vi.fn(async () => undefined),
  PlatformShop: { findOne: () => ({ lean: async () => null }) },
}));
vi.mock("./.server/models/audit-log.model", () => ({ recordAuditLog: vi.fn() }));
vi.mock("./.server/models/shop-token.model", () => ({ upsertShopToken: vi.fn() }));
vi.mock("./.server/models/subscription.model", () => ({
  Subscription: { findOneAndUpdate: vi.fn() },
}));

type ShopifyServer = typeof import("./shopify.server");
let server: ShopifyServer;

beforeAll(async () => {
  process.env.SHOPIFY_API_KEY = PRIMARY.apiKey;
  process.env.SHOPIFY_API_SECRET = PRIMARY.apiSecret;
  process.env.SHOPIFY_APPS = JSON.stringify([{ name: "second", ...SECOND }]);
  process.env.SHOPIFY_APP_URL = "https://app.example.com";
  process.env.SCOPES = "read_products";

  server = await import("./shopify.server");

  const { Session } = await import("@shopify/shopify-api");
  sessions.set(
    `offline_${SHOP}`,
    new Session({
      id: `offline_${SHOP}`,
      shop: SHOP,
      state: "",
      isOnline: false,
      accessToken: "shpat_test",
      scope: "read_products",
    }),
  );
});

function sessionToken(aud: string, secret: string) {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const body = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
    iss: `https://${SHOP}/admin`,
    dest: `https://${SHOP}`,
    aud,
    sub: "1",
    exp: now + 60,
    nbf: now - 5,
    iat: now - 5,
    jti: crypto.randomUUID(),
    sid: "sid",
  })}`;
  const signature = crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("base64url");
  return `${body}.${signature}`;
}

function adminRequest(token: string) {
  return new Request("https://app.example.com/app/settings", {
    headers: { authorization: `Bearer ${token}` },
  });
}

function webhookRequest(secret: string) {
  const body = JSON.stringify({ id: 1 });
  return new Request("https://app.example.com/webhooks", {
    method: "POST",
    body,
    headers: {
      "content-type": "application/json",
      "x-shopify-topic": "products/update",
      "x-shopify-shop-domain": SHOP,
      "x-shopify-api-version": "2025-01",
      "x-shopify-webhook-id": "webhook-1",
      "x-shopify-hmac-sha256": crypto
        .createHmac("sha256", secret)
        .update(body, "utf8")
        .digest("base64"),
    },
  });
}

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (thrown) {
    return thrown;
  }
  throw new Error("expected the call to throw");
}

describe("multi-app dispatch", () => {
  it("authenticates an admin request for an additional app by its token audience", async () => {
    const { session } = await server.authenticate.admin(
      adminRequest(sessionToken(SECOND.apiKey, SECOND.apiSecret)),
    );
    expect(session.shop).toBe(SHOP);
    expect(await server.getApiKeyForShop(SHOP)).toBe(SECOND.apiKey);
  });

  it("rejects a token naming one app but signed with another app's secret", async () => {
    const thrown = await rejection(
      server.authenticate.admin(
        adminRequest(sessionToken(SECOND.apiKey, PRIMARY.apiSecret)),
      ),
    );
    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(401);
  });

  it("authenticates a webhook signed by an additional app's secret", async () => {
    const { shop, topic, session } = await server.authenticate.webhook(
      webhookRequest(SECOND.apiSecret),
    );
    expect(shop).toBe(SHOP);
    expect(topic).toBe("PRODUCTS_UPDATE");
    expect(session?.accessToken).toBe("shpat_test");
  });

  it("rejects a webhook signed with an unknown secret", async () => {
    const thrown = await rejection(
      server.authenticate.webhook(webhookRequest("not-a-configured-secret")),
    );
    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(401);
  });

  it("loads the offline admin client for a shop on an additional app", async () => {
    const { session } = await server.unauthenticated.admin(SHOP);
    expect(session.shop).toBe(SHOP);
  });
});
