import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  DataTable,
  InlineStack,
  Badge,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { connectDB } from "../db.server";
import { ImageSearchLog } from "../.server/models/image-search-log.model";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();

  const shopId = session.shop;
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // Aggregate stats for last 30 days
  const [stats] = await ImageSearchLog.aggregate([
    { $match: { shopId, createdAt: { $gte: thirtyDaysAgo } } },
    {
      $group: {
        _id: null,
        totalSearches: { $sum: 1 },
        totalWithResults: {
          $sum: { $cond: [{ $gt: ["$resultsCount", 0] }, 1, 0] },
        },
        totalNoResults: {
          $sum: { $cond: [{ $eq: ["$resultsCount", 0] }, 1, 0] },
        },
        totalClicks: {
          $sum: { $cond: [{ $ne: ["$clickedProductId", ""] }, 1, 0] },
        },
        totalCartAdds: {
          $sum: { $cond: [{ $eq: ["$convertedToCart", true] }, 1, 0] },
        },
        avgResults: { $avg: "$resultsCount" },
        avgScore: { $avg: "$topScore" },
        avgDurationMs: { $avg: "$durationMs" },
      },
    },
  ]);

  // Recent logs
  const logs = await ImageSearchLog.find({ shopId })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  const safeStats = stats ?? {
    totalSearches: 0,
    totalWithResults: 0,
    totalNoResults: 0,
    totalClicks: 0,
    totalCartAdds: 0,
    avgResults: 0,
    avgScore: 0,
    avgDurationMs: 0,
  };

  const ctr =
    safeStats.totalSearches > 0
      ? Math.round((safeStats.totalClicks / safeStats.totalSearches) * 100)
      : 0;

  return json({
    stats: {
      totalSearches: safeStats.totalSearches,
      totalWithResults: safeStats.totalWithResults,
      totalNoResults: safeStats.totalNoResults,
      totalClicks: safeStats.totalClicks,
      totalCartAdds: safeStats.totalCartAdds,
      avgResults: Math.round((safeStats.avgResults || 0) * 10) / 10,
      avgScore: Math.round((safeStats.avgScore || 0) * 100),
      avgDurationMs: Math.round(safeStats.avgDurationMs || 0),
      ctr,
    },
    logs: JSON.parse(JSON.stringify(logs)),
  });
};

export default function ImageSearchLogsPage() {
  const { stats, logs } = useLoaderData<typeof loader>();

  const rows = logs.map((log: any) => [
    new Date(log.createdAt).toLocaleString(),
    log.resultsCount,
    `${Math.round(log.topScore * 100)}%`,
    log.clickedProductId
      ? `#${log.clickedPosition} – ${log.clickedProductId.slice(-8)}`
      : "—",
    log.convertedToCart ? "Yes" : "—",
    `${log.durationMs}ms`,
    log.error ? log.error.slice(0, 40) : "—",
  ]);

  return (
    <Page
      title="Image Search Analytics"
      subtitle="Last 30 days of image search activity"
    >
      <Layout>
        {/* ── Summary Stats ──────────────────────────────────── */}
        <Layout.Section>
          <InlineStack gap="400" wrap>
            <StatCard label="Total Searches" value={String(stats.totalSearches)} />
            <StatCard
              label="Searches with Results"
              value={String(stats.totalWithResults)}
            />
            <StatCard
              label="No-Result Searches"
              value={String(stats.totalNoResults)}
              tone={stats.totalNoResults > 0 ? "warning" : undefined}
            />
            <StatCard label="Result Clicks" value={String(stats.totalClicks)} />
            <StatCard label="Click-Through Rate" value={`${stats.ctr}%`} />
            <StatCard
              label="Add-to-Cart after Search"
              value={String(stats.totalCartAdds)}
            />
            <StatCard
              label="Avg Results per Search"
              value={String(stats.avgResults)}
            />
            <StatCard
              label="Avg Similarity Score"
              value={`${stats.avgScore}%`}
            />
            <StatCard
              label="Avg Response Time"
              value={`${stats.avgDurationMs}ms`}
            />
          </InlineStack>
        </Layout.Section>

        {/* ── Recent Logs ────────────────────────────────────── */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h3">
                Recent Searches
              </Text>
              {rows.length === 0 ? (
                <Text as="p" tone="subdued">
                  No searches yet. Enable image search and add the widget to
                  your theme to start collecting data.
                </Text>
              ) : (
                <DataTable
                  columnContentTypes={[
                    "text",
                    "numeric",
                    "text",
                    "text",
                    "text",
                    "text",
                    "text",
                  ]}
                  headings={[
                    "Time",
                    "Results",
                    "Top Score",
                    "Clicked",
                    "Cart",
                    "Duration",
                    "Error",
                  ]}
                  rows={rows}
                />
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warning" | "critical";
}) {
  return (
    <Card>
      <BlockStack gap="100">
        <Text as="p" tone="subdued" variant="bodySm">
          {label}
        </Text>
        <Text
          variant="headingLg"
          as="p"
          tone={tone === "warning" ? "caution" : undefined}
        >
          {value}
        </Text>
      </BlockStack>
    </Card>
  );
}
