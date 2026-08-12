import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import {
  Page, Layout, Card, BlockStack, Text, InlineGrid, Button,
  EmptyState, Badge, Banner, InlineStack,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { connectDB } from "../db.server";
import { Bundle } from "../.server/models/bundle.model";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();
  const shopId = session.shop;

  const [activeCount, draftCount, pausedCount, recentBundles] = await Promise.all([
    Bundle.countDocuments({ shopId, status: "active" }),
    Bundle.countDocuments({ shopId, status: "draft" }),
    Bundle.countDocuments({ shopId, status: "paused" }),
    Bundle.find({ shopId }).sort({ updatedAt: -1 }).limit(5).lean(),
  ]);

  return json({
    activeCount,
    draftCount,
    pausedCount,
    hasAnyBundles: activeCount + draftCount + pausedCount > 0,
    recentBundles: recentBundles.map((b) => ({
      id: String(b._id),
      title: b.title,
      type: b.type,
      status: b.status,
      updatedAt: b.updatedAt ? new Date(b.updatedAt).toISOString() : "",
    })),
  });
};

const STATUS_TONE: Record<string, "success" | "info" | "attention" | "warning" | "critical"> = {
  active: "success",
  draft: "info",
  scheduled: "info",
  paused: "attention",
  expired: "warning",
  archived: "critical",
};

export default function BundleGenieOverview() {
  const { activeCount, draftCount, pausedCount, hasAnyBundles, recentBundles } =
    useLoaderData<typeof loader>();

  return (
    <Page
      title="Bundle Genie"
      subtitle="Product bundles — fixed sets, tiered offers, and mix-and-match."
      primaryAction={{ content: "Create bundle", url: "/app/bundle-genie/bundles/new" }}
      secondaryActions={[{ content: "All bundles", url: "/app/bundle-genie/bundles" }]}
      backAction={{ url: "/app" }}
    >
      <BlockStack gap="400">
        <Banner tone="info" title="Milestone 1 — foundation">
          <p>
            Bundle creation, editing, and publishing work end to end for the{" "}
            <strong>Fixed Product Bundle</strong> type. The storefront widget
            (Theme App Extension block), Shopify Functions pricing/checkout
            enforcement, and order-attributed analytics haven't been built
            yet — bundles publish and store correctly, but nothing renders
            on the storefront or affects checkout until that ships. The
            other 13 bundle types from the plan aren't implemented yet
            either.
          </p>
        </Banner>

        {!hasAnyBundles ? (
          <Card>
            <EmptyState
              heading="Create your first bundle"
              action={{ content: "Create bundle", url: "/app/bundle-genie/bundles/new" }}
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>Group products together with a discount to increase average order value.</p>
            </EmptyState>
          </Card>
        ) : (
          <>
            <InlineGrid columns={{ xs: 1, sm: 3 }} gap="300">
              <Card>
                <BlockStack gap="100">
                  <Text as="p" tone="subdued">Active bundles</Text>
                  <Text as="p" variant="heading2xl">{activeCount}</Text>
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="100">
                  <Text as="p" tone="subdued">Draft bundles</Text>
                  <Text as="p" variant="heading2xl">{draftCount}</Text>
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="100">
                  <Text as="p" tone="subdued">Paused bundles</Text>
                  <Text as="p" variant="heading2xl">{pausedCount}</Text>
                </BlockStack>
              </Card>
            </InlineGrid>

            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Recent bundles</Text>
                <BlockStack gap="200">
                  {recentBundles.map((b) => (
                    <InlineStack key={b.id} align="space-between" blockAlign="center">
                      <Link to={`/app/bundle-genie/bundles/${b.id}`}>{b.title}</Link>
                      <Badge tone={STATUS_TONE[b.status] || "info"}>{b.status}</Badge>
                    </InlineStack>
                  ))}
                </BlockStack>
              </BlockStack>
            </Card>
          </>
        )}

        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">Setup status</Text>
            <InlineStack gap="200">
              <Badge tone="critical">Not built yet</Badge>
              <Text as="span">Storefront extension (Theme App Extension block)</Text>
            </InlineStack>
            <InlineStack gap="200">
              <Badge tone="critical">Not built yet</Badge>
              <Text as="span">Cart Transform Function</Text>
            </InlineStack>
            <InlineStack gap="200">
              <Badge tone="critical">Not built yet</Badge>
              <Text as="span">Discount Function</Text>
            </InlineStack>
            <InlineStack gap="200">
              <Badge tone="critical">Not built yet</Badge>
              <Text as="span">Checkout provider (Shopify Native / ShipRocket / Shopflo / GoKwik)</Text>
            </InlineStack>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
