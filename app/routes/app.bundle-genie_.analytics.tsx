import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, Card, BlockStack, Text, IndexTable, InlineGrid, Banner } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { connectDB } from "../db.server";
import { Bundle, BundleAnalyticsDaily } from "../.server/models/bundle.model";
import { BundleGenieNav } from "../components/bundle-genie-nav";

function formatRevenue(minorUnits: number): string {
  return "₹" + (minorUnits / 100).toFixed(0);
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();
  const shopId = session.shop;

  const since = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);

  const [rows, bundles] = await Promise.all([
    BundleAnalyticsDaily.find({ shopId, date: { $gte: since } }).lean(),
    Bundle.find({ shopId }).select("title").lean(),
  ]);

  const titleById = new Map(bundles.map((b) => [String(b._id), b.title]));

  const totals = new Map<string, { title: string; pageSessions: number; interactions: number; addToCarts: number; orders: number; revenue: number }>();
  for (const r of rows) {
    const entry = totals.get(r.bundleId) || {
      title: titleById.get(r.bundleId) || "(deleted bundle)",
      pageSessions: 0, interactions: 0, addToCarts: 0, orders: 0, revenue: 0,
    };
    entry.pageSessions += r.pageSessions || 0;
    entry.interactions += r.interactions || 0;
    entry.addToCarts += r.addToCarts || 0;
    entry.orders += r.orders || 0;
    entry.revenue += r.revenue || 0;
    totals.set(r.bundleId, entry);
  }

  const perBundle = Array.from(totals.entries())
    .map(([bundleId, t]) => ({ bundleId, ...t }))
    .sort((a, b) => b.revenue - a.revenue);

  const grand = perBundle.reduce(
    (acc, b) => ({
      pageSessions: acc.pageSessions + b.pageSessions,
      interactions: acc.interactions + b.interactions,
      addToCarts: acc.addToCarts + b.addToCarts,
      orders: acc.orders + b.orders,
      revenue: acc.revenue + b.revenue,
    }),
    { pageSessions: 0, interactions: 0, addToCarts: 0, orders: 0, revenue: 0 },
  );

  return json({ perBundle, grand, hasData: rows.length > 0 });
};

export default function BundleGenieAnalytics() {
  const { perBundle, grand, hasData } = useLoaderData<typeof loader>();

  return (
    <Page title="Bundle Genie" subtitle="Analytics — last 30 days" backAction={{ url: "/app/bundle-genie" }}>
      <BlockStack gap="400">
        <BundleGenieNav active="analytics" />

        {!hasData && (
          <Banner tone="info">
            <p>
              No tracked activity yet. Numbers here come from real visits to the storefront
              widget and paid orders that included a bundle — nothing is estimated.
            </p>
          </Banner>
        )}

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Last 30 days — all campaigns</Text>
            <InlineGrid columns={{ xs: 2, sm: 5 }} gap="300">
              <BlockStack gap="050">
                <Text as="p" tone="subdued">Page Sessions</Text>
                <Text as="p" variant="headingLg">{grand.pageSessions}</Text>
              </BlockStack>
              <BlockStack gap="050">
                <Text as="p" tone="subdued">Interactions</Text>
                <Text as="p" variant="headingLg">{grand.interactions}</Text>
              </BlockStack>
              <BlockStack gap="050">
                <Text as="p" tone="subdued">Add to Carts</Text>
                <Text as="p" variant="headingLg">{grand.addToCarts}</Text>
              </BlockStack>
              <BlockStack gap="050">
                <Text as="p" tone="subdued">Orders</Text>
                <Text as="p" variant="headingLg">{grand.orders}</Text>
              </BlockStack>
              <BlockStack gap="050">
                <Text as="p" tone="subdued">Revenue</Text>
                <Text as="p" variant="headingLg">{formatRevenue(grand.revenue)}</Text>
              </BlockStack>
            </InlineGrid>
          </BlockStack>
        </Card>

        <Card padding="0">
          <div style={{ padding: 16 }}>
            <Text as="h2" variant="headingMd">By campaign</Text>
          </div>
          <IndexTable
            itemCount={perBundle.length}
            headings={[
              { title: "Campaign" },
              { title: "Page Sessions" },
              { title: "Interactions" },
              { title: "Add to Carts" },
              { title: "Orders" },
              { title: "Revenue" },
            ]}
            selectable={false}
          >
            {perBundle.map((b, index) => (
              <IndexTable.Row id={b.bundleId} key={b.bundleId} position={index}>
                <IndexTable.Cell>{b.title}</IndexTable.Cell>
                <IndexTable.Cell>{b.pageSessions}</IndexTable.Cell>
                <IndexTable.Cell>{b.interactions}</IndexTable.Cell>
                <IndexTable.Cell>{b.addToCarts}</IndexTable.Cell>
                <IndexTable.Cell>{b.orders}</IndexTable.Cell>
                <IndexTable.Cell>{formatRevenue(b.revenue)}</IndexTable.Cell>
              </IndexTable.Row>
            ))}
          </IndexTable>
        </Card>
      </BlockStack>
    </Page>
  );
}
