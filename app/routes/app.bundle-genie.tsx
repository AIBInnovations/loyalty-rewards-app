import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { Link, useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import {
  Page, Card, BlockStack, Text, InlineGrid, Button,
  EmptyState, Badge, Banner, InlineStack, IndexTable,
} from "@shopify/polaris";
import { ViewIcon, DuplicateIcon, EditIcon, DeleteIcon } from "@shopify/polaris-icons";
import { useState } from "react";
import { authenticate } from "../shopify.server";
import { connectDB } from "../db.server";
import { Bundle, BundleAnalyticsDaily } from "../.server/models/bundle.model";
import { Subscription } from "../.server/models/subscription.model";
import { runBundleQuickAction, type BundleQuickActionIntent } from "../.server/services/bundle-quick-actions.service";
import { BundleGenieShell } from "../components/bundle-genie-nav";

const EMPTY_TOTALS = { pageSessions: 0, interactions: 0, addToCarts: 0, orders: 0, revenue: 0 };

async function sumDaily(shopId: string, date: string) {
  const rows = await BundleAnalyticsDaily.find({ shopId, date }).lean();
  return rows.reduce(
    (acc, r) => ({
      pageSessions: acc.pageSessions + (r.pageSessions || 0),
      interactions: acc.interactions + (r.interactions || 0),
      addToCarts: acc.addToCarts + (r.addToCarts || 0),
      orders: acc.orders + (r.orders || 0),
      revenue: acc.revenue + (r.revenue || 0),
    }),
    { ...EMPTY_TOTALS },
  );
}

function pctChange(today: number, yesterday: number): number | null {
  if (yesterday === 0) return today > 0 ? null : 0;
  return Math.round(((today - yesterday) / yesterday) * 1000) / 10;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();
  const shopId = session.shop;

  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  const [bundles, subscription, todayTotals, yesterdayTotals] = await Promise.all([
    Bundle.find({ shopId, status: { $ne: "archived" } }).sort({ updatedAt: -1 }).limit(10).lean(),
    Subscription.findOne({ shopId }).lean(),
    sumDaily(shopId, today),
    sumDaily(shopId, yesterday),
  ]);

  return json({
    plan: subscription?.plan || "free",
    billingState: subscription?.billingState || "trial",
    shopDomain: shopId,
    hasAnyBundles: bundles.length > 0,
    bundles: bundles.map((b) => ({
      id: String(b._id),
      title: b.title,
      type: b.type,
      status: b.status,
      updatedAt: b.updatedAt ? new Date(b.updatedAt).toISOString() : "",
      productHandle: b.draftProducts?.[0]?.handle || "",
    })),
    metrics: {
      pageSessions: { value: todayTotals.pageSessions, change: pctChange(todayTotals.pageSessions, yesterdayTotals.pageSessions) },
      interactions: { value: todayTotals.interactions, change: pctChange(todayTotals.interactions, yesterdayTotals.interactions) },
      addToCarts: { value: todayTotals.addToCarts, change: pctChange(todayTotals.addToCarts, yesterdayTotals.addToCarts) },
      orders: { value: todayTotals.orders, change: pctChange(todayTotals.orders, yesterdayTotals.orders) },
      revenue: { value: todayTotals.revenue, change: pctChange(todayTotals.revenue, yesterdayTotals.revenue) },
    },
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "") as BundleQuickActionIntent;
  const bundleId = String(formData.get("bundleId") || "");
  if (!bundleId) return json({ success: false }, { status: 400 });
  const result = await runBundleQuickAction(session.shop, bundleId, intent);
  return json(result, { status: result.status || 200 });
};

const STATUS_TONE: Record<string, "success" | "info" | "attention" | "warning" | "critical"> = {
  active: "success",
  draft: "info",
  scheduled: "info",
  paused: "attention",
  expired: "warning",
  archived: "critical",
};

const TYPE_LABEL: Record<string, string> = {
  fixed_product: "Fixed Bundle",
  offer_tiers: "Offer Tiers",
  fixed_price: "Fixed Price Bundle",
  byob: "Build Your Own Bundle",
  mix_match: "Mix and Match",
  variable: "Variable Bundle",
  step: "Step Bundle",
  routine: "Routine Bundle",
  buy_any_x: "Buy Any X for Fixed Price",
  category: "Category-Based Bundle",
  frequently_bought: "Frequently Bought Together",
  personalized: "Personalised Deal",
  custom: "Custom Merchant Deal",
  upsell: "Bundle Upsell/Cross-sell",
};

function StatusToggle({ bundleId, active, disabled, onToggle }: { bundleId: string; active: boolean; disabled: boolean; onToggle: (bundleId: string, next: boolean) => void }) {
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: disabled ? "default" : "pointer" }}>
      <span style={{ position: "relative", display: "inline-flex" }}>
        <input
          type="checkbox"
          checked={active}
          disabled={disabled}
          onChange={() => onToggle(bundleId, !active)}
          style={{ position: "absolute", opacity: 0, width: 1, height: 1 }}
        />
        <span
          style={{
            width: 36, height: 20, borderRadius: 999, boxSizing: "border-box", padding: 2,
            background: active ? "#16a34a" : "#d1d5db", transition: "background 0.15s ease",
            display: "inline-flex", alignItems: "center",
          }}
        >
          <span
            style={{
              width: 16, height: 16, borderRadius: 999, background: "#fff",
              boxShadow: "0 1px 2px rgba(15,23,42,0.25)", transition: "transform 0.15s ease",
              transform: active ? "translateX(16px)" : "translateX(0)",
            }}
          />
        </span>
      </span>
      <Text as="span" tone={active ? "success" : "subdued"}>{active ? "Active" : "Paused"}</Text>
    </label>
  );
}

function formatRevenue(minorUnits: number): string {
  return "₹" + (minorUnits / 100).toFixed(0);
}

function ChangeBadge({ change }: { change: number | null }) {
  if (change === null) return null;
  const up = change >= 0;
  return (
    <Text as="span" tone={up ? "success" : "critical"} variant="bodySm">
      {up ? "↗" : "↘"} {Math.abs(change)}%
    </Text>
  );
}

export default function BundleGenieOverview() {
  const { plan, billingState, shopDomain, hasAnyBundles, bundles, metrics } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isBusy = navigation.state === "submitting";
  const [dismissedBanner, setDismissedBanner] = useState(false);

  const runAction = (bundleId: string, intent: BundleQuickActionIntent) => {
    const fd = new FormData();
    fd.set("bundleId", bundleId);
    fd.set("intent", intent);
    submit(fd, { method: "post" });
  };

  return (
    <Page
      title="Bundle Genie"
      titleMetadata={<Badge tone={billingState === "active" ? "success" : "info"}>{plan === "free" ? "Free plan" : `${plan} — ${billingState}`}</Badge>}
      primaryAction={{ content: "Create Campaign", url: "/app/bundle-genie/bundles/new" }}
      backAction={{ url: "/app" }}
    >
      <BundleGenieShell active="campaigns">
      <BlockStack gap="400">
        {!dismissedBanner && (
          <Banner tone="warning" onDismiss={() => setDismissedBanner(true)}>
            <p>
              Campaigns require the "Bundle Genie" app embed to be enabled in your live theme.
              Enable it from your theme editor's App embeds section.
            </p>
          </Banner>
        )}

        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="050">
                <Text as="h2" variant="headingMd">Analytics</Text>
                <Text as="p" tone="subdued">See how your store is performing with Bundle Genie. Below are today's stats.</Text>
              </BlockStack>
              <Link to="/app/bundle-genie/analytics">View Detailed</Link>
            </InlineStack>
            <InlineGrid columns={{ xs: 2, sm: 5 }} gap="300">
              <BlockStack gap="050">
                <Text as="p" tone="subdued">Page Sessions</Text>
                <Text as="p" variant="headingLg">{metrics.pageSessions.value}</Text>
                <ChangeBadge change={metrics.pageSessions.change} />
              </BlockStack>
              <BlockStack gap="050">
                <Text as="p" tone="subdued">Interactions</Text>
                <Text as="p" variant="headingLg">{metrics.interactions.value}</Text>
                <ChangeBadge change={metrics.interactions.change} />
              </BlockStack>
              <BlockStack gap="050">
                <Text as="p" tone="subdued">Add to Carts</Text>
                <Text as="p" variant="headingLg">{metrics.addToCarts.value}</Text>
                <ChangeBadge change={metrics.addToCarts.change} />
              </BlockStack>
              <BlockStack gap="050">
                <Text as="p" tone="subdued">Orders</Text>
                <Text as="p" variant="headingLg">{metrics.orders.value}</Text>
                <ChangeBadge change={metrics.orders.change} />
              </BlockStack>
              <BlockStack gap="050">
                <Text as="p" tone="subdued">Revenue</Text>
                <Text as="p" variant="headingLg">{formatRevenue(metrics.revenue.value)}</Text>
                <ChangeBadge change={metrics.revenue.change} />
              </BlockStack>
            </InlineGrid>
          </BlockStack>
        </Card>

        <Card padding="0">
          <div style={{ padding: "16px 16px 0" }}>
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">Campaigns</Text>
              <Link to="/app/bundle-genie/bundles">Show more</Link>
            </InlineStack>
          </div>
          {!hasAnyBundles ? (
            <EmptyState
              heading="Create your first bundle"
              action={{ content: "Create Campaign", url: "/app/bundle-genie/bundles/new" }}
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>Group products together with a discount to increase average order value.</p>
            </EmptyState>
          ) : (
            <IndexTable
              itemCount={bundles.length}
              headings={[
                { title: "Date Last Updated" },
                { title: "Campaign Title" },
                { title: "Status" },
                { title: "Actions" },
              ]}
              selectable={false}
            >
              {bundles.map((b, index) => (
                <IndexTable.Row id={b.id} key={b.id} position={index}>
                  <IndexTable.Cell>
                    {b.updatedAt ? new Date(b.updatedAt).toLocaleDateString("en-IN", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : ""}
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <InlineStack gap="150" blockAlign="center">
                      <Link to={`/app/bundle-genie/bundles/${b.id}`}>{b.title}</Link>
                      <Badge tone={STATUS_TONE[b.status] || "info"}>{TYPE_LABEL[b.type] || b.type}</Badge>
                    </InlineStack>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    {b.status === "archived" ? (
                      <Badge tone="critical">Archived</Badge>
                    ) : (
                      <StatusToggle
                        bundleId={b.id}
                        active={b.status === "active"}
                        disabled={isBusy || b.status === "draft"}
                        onToggle={(id, next) => runAction(id, next ? "resume" : "pause")}
                      />
                    )}
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <InlineStack gap="200">
                      <Button
                        size="slim"
                        variant="tertiary"
                        icon={ViewIcon}
                        disabled={!b.productHandle}
                        accessibilityLabel="Preview on storefront"
                        url={b.productHandle ? `https://${shopDomain}/products/${b.productHandle}` : undefined}
                        target={b.productHandle ? "_blank" : undefined}
                      />
                      <Button
                        size="slim"
                        variant="tertiary"
                        icon={DuplicateIcon}
                        disabled={isBusy}
                        accessibilityLabel="Duplicate"
                        onClick={() => runAction(b.id, "duplicate")}
                      />
                      <Button
                        size="slim"
                        variant="tertiary"
                        icon={EditIcon}
                        accessibilityLabel="Edit"
                        url={`/app/bundle-genie/bundles/${b.id}`}
                      />
                      {b.status !== "archived" && (
                        <Button
                          size="slim"
                          variant="tertiary"
                          tone="critical"
                          icon={DeleteIcon}
                          disabled={isBusy}
                          accessibilityLabel="Archive"
                          onClick={() => runAction(b.id, "archive")}
                        />
                      )}
                    </InlineStack>
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          )}
        </Card>
      </BlockStack>
      </BundleGenieShell>
    </Page>
  );
}
