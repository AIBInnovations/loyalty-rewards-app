import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  InlineGrid,
  Box,
  Badge,
  DataTable,
  Link,
  EmptyState,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { connectDB } from "../db.server";
import { Customer } from "../.server/models/customer.model";
import { Transaction } from "../.server/models/transaction.model";
import { Redemption } from "../.server/models/redemption.model";
import { getOrCreateSettings } from "../.server/models/settings.model";
import { createMetafieldDefinitions } from "../.server/services/metafield.service";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  await connectDB();

  const shop = session.shop;
  const settings = await getOrCreateSettings(shop);

  // Create metafield definitions on first load (idempotent)
  await createMetafieldDefinitions(admin as any);

  // Aggregate stats
  const [
    totalCustomers,
    totalPointsIssued,
    totalRedemptions,
    activeDiscountCodes,
    recentTransactions,
  ] = await Promise.all([
    Customer.countDocuments({ shopId: shop }),
    Transaction.aggregate([
      { $match: { shopId: shop, type: "EARN" } },
      { $group: { _id: null, total: { $sum: "$points" } } },
    ]).then((r) => r[0]?.total || 0),
    Redemption.countDocuments({ shopId: shop, status: "USED" }),
    Redemption.countDocuments({ shopId: shop, status: "CREATED" }),
    Transaction.find({ shopId: shop })
      .sort({ createdAt: -1 })
      .limit(10)
      .populate("customerId", "email firstName lastName")
      .lean(),
  ]);

  return json({
    stats: {
      totalCustomers,
      totalPointsIssued,
      totalRedemptions,
      activeDiscountCodes,
    },
    recentTransactions: recentTransactions.map((t) => ({
      id: t._id.toString(),
      customer:
        (t.customerId as any)?.email ||
        `${(t.customerId as any)?.firstName || ""} ${(t.customerId as any)?.lastName || ""}`.trim() ||
        "Unknown",
      type: t.type,
      points: t.points,
      source: t.source,
      description: t.description || "",
      date: t.createdAt?.toISOString(),
    })),
    isActive: settings.isActive,
    earningRate: settings.earningRate,
  });
};

export default function Dashboard() {
  const { stats, recentTransactions, isActive, earningRate } =
    useLoaderData<typeof loader>();

  const rows = recentTransactions.map((t) => [
    t.customer,
    t.type,
    t.points > 0 ? `+${t.points}` : String(t.points),
    t.source,
    t.description,
    new Date(t.date).toLocaleDateString("en-IN"),
  ]);

  return (
    <Page title="Loyalty & Rewards Dashboard">
      <BlockStack gap="500">
        <InlineGrid columns={4} gap="400">
          <Card>
            <BlockStack gap="200">
              <Text as="p" variant="bodyMd" tone="subdued">
                Total Members
              </Text>
              <Text as="p" variant="headingXl">
                {stats.totalCustomers.toLocaleString("en-IN")}
              </Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="200">
              <Text as="p" variant="bodyMd" tone="subdued">
                Points Issued
              </Text>
              <Text as="p" variant="headingXl">
                {stats.totalPointsIssued.toLocaleString("en-IN")}
              </Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="200">
              <Text as="p" variant="bodyMd" tone="subdued">
                Redemptions
              </Text>
              <Text as="p" variant="headingXl">
                {stats.totalRedemptions.toLocaleString("en-IN")}
              </Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="200">
              <Text as="p" variant="bodyMd" tone="subdued">
                Active Discount Codes
              </Text>
              <Text as="p" variant="headingXl">
                {stats.activeDiscountCodes}
              </Text>
            </BlockStack>
          </Card>
        </InlineGrid>

        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Program Status
                </Text>
                <InlineGrid columns={2} gap="200">
                  <Text as="span">
                    Status: <Badge tone={isActive ? "success" : "critical"}>
                      {isActive ? "Active" : "Paused"}
                    </Badge>
                  </Text>
                  <Text as="span">
                    Earning Rate: {earningRate}% of order value
                  </Text>
                </InlineGrid>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Recent Activity
            </Text>
            {rows.length > 0 ? (
              <DataTable
                columnContentTypes={[
                  "text",
                  "text",
                  "numeric",
                  "text",
                  "text",
                  "text",
                ]}
                headings={[
                  "Customer",
                  "Type",
                  "Points",
                  "Source",
                  "Description",
                  "Date",
                ]}
                rows={rows}
              />
            ) : (
              <EmptyState
                heading="No activity yet"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>
                  Points will appear here as customers make purchases and earn
                  rewards.
                </p>
              </EmptyState>
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
