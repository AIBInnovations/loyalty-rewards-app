import { Page, Card, BlockStack, Text, List, Divider } from "@shopify/polaris";
import { BundleGenieShell } from "../components/bundle-genie-nav";

export default function BundleGenieDocs() {
  return (
    <Page title="Bundle Genie" subtitle="Docs" backAction={{ url: "/app/bundle-genie" }}>
      <BundleGenieShell active="docs">
      <BlockStack gap="400">
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Creating a campaign</Text>
            <List type="number">
              <List.Item>Go to Campaigns and click "Create Campaign".</List.Item>
              <List.Item>Add an internal name and a customer-facing title, then click "Browse products" to pick at least 2 products for the bundle.</List.Item>
              <List.Item>Set a discount type — percentage off, fixed amount off, fixed bundle price, or none.</List.Item>
              <List.Item>Optionally set colors, corner radius, and grid/list layout under Design — this is how the widget looks on the storefront.</List.Item>
              <List.Item>Click "Publish" to make it live, or "Save as draft" to keep working on it later.</List.Item>
            </List>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Showing it on your storefront</Text>
            <Text as="p">
              Publishing a campaign creates the discount, but the widget itself only appears once
              the "Bundle Genie" app embed is turned on in your theme:
            </Text>
            <List type="number">
              <List.Item>Online Store → Themes → Customize (on your live theme).</List.Item>
              <List.Item>Open App embeds (the puzzle-piece icon in the left sidebar).</List.Item>
              <List.Item>Turn on "Bundle Genie" and save.</List.Item>
            </List>
            <Text as="p" tone="subdued">
              The widget only shows on a product page if that exact product is part of an active,
              published campaign — it stays hidden everywhere else.
            </Text>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Pricing enforcement</Text>
            <Text as="p">
              Publishing a discounted campaign creates a real Shopify automatic discount, so the
              price cut applies at checkout, not just on the product page. The current
              implementation is quantity-based — Shopify checks "does this order have enough
              total units across these products," not "does it have one of each specific
              product." A customer buying several units of a single bundle product can also
              qualify. A stricter "one of each" rule needs a Shopify Function, which isn't built
              yet.
            </Text>
          </BlockStack>
        </Card>

        <Divider />

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">What's not built yet</Text>
            <List>
              <List.Item>Only the Fixed Product Bundle type works end to end — the other bundle types aren't implemented.</List.Item>
              <List.Item>No Cart Transform Function — the storefront cart doesn't visually group bundle line items together.</List.Item>
              <List.Item>Paid Bundle Genie plans (see Billing) aren't set up.</List.Item>
            </List>
          </BlockStack>
        </Card>
      </BlockStack>
      </BundleGenieShell>
    </Page>
  );
}
