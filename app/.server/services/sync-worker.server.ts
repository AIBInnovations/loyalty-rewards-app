import { unauthenticated } from "../../shopify.server";
import { ProductCache } from "../models/product-cache.model";
import { OrderCache } from "../models/order-cache.model";
import { SyncJob } from "../models/sync-job.model";
import { PlatformShop } from "../models/platform-shop.model";
import { recordAuditLog } from "../models/audit-log.model";

type AdminClient = Awaited<ReturnType<typeof unauthenticated.admin>>["admin"];

const PRODUCTS_QUERY = `#graphql
  query AdminProductSync($first: Int!) {
    products(first: $first, sortKey: UPDATED_AT, reverse: true) {
      nodes {
        id
        title
        handle
        status
        updatedAt
        featuredImage { url altText }
        variants(first: 25) {
          nodes { id sku price inventoryQuantity }
        }
      }
    }
  }
`;

const ORDERS_QUERY = `#graphql
  query AdminOrderSync($first: Int!) {
    orders(first: $first, sortKey: UPDATED_AT, reverse: true) {
      nodes {
        id
        name
        displayFinancialStatus
        displayFulfillmentStatus
        totalPriceSet { shopMoney { amount currencyCode } }
        updatedAt
        createdAt
      }
    }
  }
`;

function numericId(gid: string) {
  return String(gid || "").split("/").pop() || gid;
}

async function syncProducts(shopId: string, admin: AdminClient) {
  const response = await admin.graphql(PRODUCTS_QUERY, {
    variables: { first: 100 },
  });
  const body = await response.json();
  const products = body.data?.products?.nodes || [];

  for (const product of products) {
    await ProductCache.findOneAndUpdate(
      { shopId, shopifyProductId: numericId(product.id) },
      {
        $set: {
          shopId,
          shopifyProductId: numericId(product.id),
          title: product.title || "",
          handle: product.handle || "",
          status: product.status || "",
          productJson: product,
          syncedAt: new Date(),
        },
      },
      { upsert: true, setDefaultsOnInsert: true },
    );
  }

  return products.length;
}

async function syncOrders(shopId: string, admin: AdminClient) {
  const response = await admin.graphql(ORDERS_QUERY, {
    variables: { first: 100 },
  });
  const body = await response.json();
  const orders = body.data?.orders?.nodes || [];

  for (const order of orders) {
    const money = order.totalPriceSet?.shopMoney || {};
    await OrderCache.findOneAndUpdate(
      { shopId, shopifyOrderId: numericId(order.id) },
      {
        $set: {
          shopId,
          shopifyOrderId: numericId(order.id),
          name: order.name || "",
          financialStatus: order.displayFinancialStatus || "",
          fulfillmentStatus: order.displayFulfillmentStatus || "",
          totalPrice: Number(money.amount || 0),
          currency: money.currencyCode || "",
          orderJson: order,
          syncedAt: new Date(),
        },
      },
      { upsert: true, setDefaultsOnInsert: true },
    );
  }

  return orders.length;
}

export async function processQueuedSyncJobs(limit = 5) {
  const jobs = await SyncJob.find({ state: "queued" })
    .sort({ queuedAt: 1 })
    .limit(limit);
  const results: Array<{
    jobId: string;
    shopId: string;
    state: string;
    products?: number;
    orders?: number;
    error?: string;
  }> = [];

  for (const job of jobs) {
    job.state = "running";
    job.startedAt = new Date();
    job.attempts += 1;
    await job.save();

    try {
      const { admin } = await unauthenticated.admin(job.shopId);
      const products = await syncProducts(job.shopId, admin);
      const orders = await syncOrders(job.shopId, admin);

      job.state = "completed";
      job.completedAt = new Date();
      job.metadata = { ...(job.metadata || {}), products, orders };
      await job.save();

      await PlatformShop.findOneAndUpdate(
        { shopId: job.shopId },
        { $set: { lastSyncAt: new Date(), shopDomain: job.shopId } },
        { upsert: true, setDefaultsOnInsert: true },
      );
      await recordAuditLog({
        actorType: "system",
        actorId: "sync-worker",
        shopId: job.shopId,
        action: "sync.completed",
        targetType: "sync_job",
        targetId: job._id.toString(),
        metadata: { products, orders },
      });
      results.push({
        jobId: job._id.toString(),
        shopId: job.shopId,
        state: "completed",
        products,
        orders,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      job.state = "failed";
      job.errorMessage = message;
      await job.save();
      await recordAuditLog({
        actorType: "system",
        actorId: "sync-worker",
        shopId: job.shopId,
        action: "sync.failed",
        targetType: "sync_job",
        targetId: job._id.toString(),
        metadata: { error: message },
      });
      results.push({
        jobId: job._id.toString(),
        shopId: job.shopId,
        state: "failed",
        error: message,
      });
    }
  }

  return results;
}
