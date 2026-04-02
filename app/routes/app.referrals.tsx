import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  DataTable,
  InlineGrid,
  EmptyState,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { connectDB } from "../db.server";
import { Customer } from "../.server/models/customer.model";
import { Transaction } from "../.server/models/transaction.model";
import { getOrCreateSettings } from "../.server/models/settings.model";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();

  const shop = session.shop;
  const settings = await getOrCreateSettings(shop);

  // Get all referrals (customers who have referredBy set)
  const referredCustomers = await Customer.find({
    shopId: shop,
    referredBy: { $exists: true, $ne: null },
  })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();

  // Count successful referrals (those who made at least one purchase)
  const referralTransactions = await Transaction.find({
    shopId: shop,
    source: "REFERRAL",
  }).lean();

  const totalReferrals = referredCustomers.length;
  const successfulReferrals = referralTransactions.length / 2; // each successful referral creates 2 transactions
  const totalBonusPoints = referralTransactions.reduce(
    (sum, t) => sum + t.points,
    0,
  );

  // Build referral list with details
  const referralList = await Promise.all(
    referredCustomers.map(async (customer) => {
      const referrer = await Customer.findOne({
        shopId: shop,
        referralCode: customer.referredBy,
      });

      const hasOrdered = await Transaction.exists({
        customerId: customer._id,
        source: "PURCHASE",
      });

      return {
        referredName:
          `${customer.firstName || ""} ${customer.lastName || ""}`.trim() ||
          customer.email ||
          "Unknown",
        referredEmail: customer.email || "N/A",
        referrerName: referrer
          ? `${referrer.firstName || ""} ${referrer.lastName || ""}`.trim() ||
            referrer.email ||
            "Unknown"
          : "Unknown",
        referralCode: customer.referredBy || "",
        hasPurchased: !!hasOrdered,
        date: customer.createdAt?.toISOString(),
      };
    }),
  );

  return json({
    stats: {
      totalReferrals,
      successfulReferrals: Math.floor(successfulReferrals),
      totalBonusPoints,
      referrerBonus: settings.referralBonusReferrer,
      referredBonus: settings.referralBonusReferred,
    },
    referrals: referralList,
  });
};

export default function ReferralsPage() {
  const { stats, referrals } = useLoaderData<typeof loader>();

  const rows = referrals.map((r) => [
    r.referredName,
    r.referredEmail,
    r.referrerName,
    r.referralCode,
    r.hasPurchased ? "Yes" : "Pending",
    new Date(r.date).toLocaleDateString("en-IN"),
  ]);

  return (
    <Page title="Referral Program">
      <BlockStack gap="500">
        <InlineGrid columns={4} gap="400">
          <Card>
            <BlockStack gap="200">
              <Text as="p" tone="subdued">Total Referrals</Text>
              <Text as="p" variant="headingXl">{stats.totalReferrals}</Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="200">
              <Text as="p" tone="subdued">Successful (Purchased)</Text>
              <Text as="p" variant="headingXl">
                {stats.successfulReferrals}
              </Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="200">
              <Text as="p" tone="subdued">Total Bonus Points</Text>
              <Text as="p" variant="headingXl">
                {stats.totalBonusPoints.toLocaleString("en-IN")}
              </Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="200">
              <Text as="p" tone="subdued">Bonus Config</Text>
              <Text as="p" variant="bodyMd">
                Referrer: {stats.referrerBonus} pts
              </Text>
              <Text as="p" variant="bodyMd">
                Referred: {stats.referredBonus} pts
              </Text>
            </BlockStack>
          </Card>
        </InlineGrid>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Referral Activity
            </Text>
            {rows.length > 0 ? (
              <DataTable
                columnContentTypes={[
                  "text",
                  "text",
                  "text",
                  "text",
                  "text",
                  "text",
                ]}
                headings={[
                  "Referred Customer",
                  "Email",
                  "Referred By",
                  "Code",
                  "Purchased",
                  "Date",
                ]}
                rows={rows}
              />
            ) : (
              <EmptyState
                heading="No referrals yet"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>
                  Referrals will appear here when customers share their referral
                  codes and new customers sign up.
                </p>
              </EmptyState>
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
