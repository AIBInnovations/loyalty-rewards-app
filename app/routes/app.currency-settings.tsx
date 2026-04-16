import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  Banner,
  Badge,
  List,
  Divider,
  Box,
  InlineStack,
  Icon,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  // Fetch shop currency info
  const shopRes = await admin.graphql(`#graphql
    query {
      shop {
        currencyCode
        name
      }
    }
  `);

  const data = await shopRes.json();
  const shop = data?.data?.shop || {};

  return json({ shop });
};

export default function CurrencySettings() {
  const { shop, markets } = useLoaderData<typeof loader>();

  const hasMultipleMarkets = markets.length > 1;
  const primaryMarket = markets.find((m: any) => m.primary);

  return (
    <Page
      title="Currency Selector"
      subtitle="Add a native Shopify Markets currency selector to your storefront"
    >
      <Layout>
        {/* Status Banner */}
        <Layout.Section>
          <Banner
            title="Currency selector is ready to use"
            tone="success"
          >
            <p>
              Your store has <strong>{markets.length} {markets.length === 1 ? "market" : "markets"}</strong> configured. The currency selector block is available to add to your theme. To offer multiple currencies, add more markets in{" "}
              <a href="https://admin.shopify.com/settings/markets" target="_blank" rel="noreferrer">
                Settings → Markets
              </a>.
            </p>
          </Banner>
        </Layout.Section>

        {/* How it works */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">How it works</Text>
              <Text as="p" variant="bodyMd" tone="subdued">
                The currency selector uses Shopify's native Markets + localization form. When a customer picks a currency, Shopify switches their market context — prices update across the entire storefront including product pages, cart, and checkout.
              </Text>
              <Divider />
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">Architecture</Text>
                <List type="number">
                  <List.Item>
                    <strong>Shopify Markets</strong> defines which countries and currencies are available
                  </List.Item>
                  <List.Item>
                    The <strong>Currency Selector block</strong> submits the customer's choice via a native localization form (POST to <code>/localization</code>)
                  </List.Item>
                  <List.Item>
                    Shopify resolves the active market and <strong>renders all prices</strong> in the correct presentment currency
                  </List.Item>
                  <List.Item>
                    Your loyalty widget and cart drawer <strong>automatically reflect</strong> the selected currency via <code>shop.money_format</code>
                  </List.Item>
                </List>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Current Markets */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingMd">Your Markets</Text>
                <Badge tone={hasMultipleMarkets ? "success" : "attention"}>
                  {markets.length} {markets.length === 1 ? "market" : "markets"}
                </Badge>
              </InlineStack>

              {markets.length === 0 ? (
                <Text as="p" variant="bodyMd" tone="subdued">No markets found.</Text>
              ) : (
                <BlockStack gap="300">
                  {markets.map((market: any) => {
                    const countries = market.regions?.edges?.map((e: any) => e.node) || [];
                    const baseCurrency = market.currencySettings?.baseCurrency?.currencyCode || "—";
                    const localCurrencies = market.currencySettings?.localCurrencies || false;

                    return (
                      <Box
                        key={market.id}
                        padding="400"
                        background="bg-surface-secondary"
                        borderRadius="200"
                      >
                        <BlockStack gap="200">
                          <InlineStack align="space-between">
                            <InlineStack gap="200">
                              <Text as="span" variant="bodyMd" fontWeight="semibold">
                                {market.name}
                              </Text>
                              {market.primary && <Badge>Primary</Badge>}
                              {!market.enabled && <Badge tone="critical">Disabled</Badge>}
                            </InlineStack>
                            <Badge tone={localCurrencies ? "success" : "attention"}>
                              {localCurrencies ? "Local currency ON" : "Base currency only"}
                            </Badge>
                          </InlineStack>
                          <Text as="p" variant="bodySm" tone="subdued">
                            Base currency: <strong>{baseCurrency}</strong>
                            {countries.length > 0 && (
                              <> · Countries: {countries.map((c: any) => c.name || c.code).join(", ")}</>
                            )}
                          </Text>
                        </BlockStack>
                      </Box>
                    );
                  })}
                </BlockStack>
              )}

              <Text as="p" variant="bodySm" tone="subdued">
                Manage markets in{" "}
                <a
                  href="https://admin.shopify.com/settings/markets"
                  target="_blank"
                  rel="noreferrer"
                >
                  Shopify Admin → Settings → Markets
                </a>
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Shop currency info */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Store Currency</Text>
              <InlineStack gap="300">
                <Box>
                  <Text as="p" variant="bodySm" tone="subdued">Base currency</Text>
                  <Text as="p" variant="bodyMd" fontWeight="semibold">{shop.currencyCode || "—"}</Text>
                </Box>
                <Box>
                  <Text as="p" variant="bodySm" tone="subdued">Money format</Text>
                  <Text as="p" variant="bodyMd" fontWeight="semibold">
                    {shop.currencyFormats?.moneyFormat || "—"}
                  </Text>
                </Box>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Setup steps */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Setup Steps</Text>

              <BlockStack gap="300">
                <BlockStack gap="100">
                  <Text as="h3" variant="headingSm">Step 1 — Configure Markets (Shopify Admin)</Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Go to <strong>Settings → Markets</strong> in your Shopify admin. Create markets for the regions you sell into and enable local currencies for each.
                  </Text>
                </BlockStack>

                <Divider />

                <BlockStack gap="100">
                  <Text as="h3" variant="headingSm">Step 2 — Add the block to your theme</Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    In the <strong>Online Store → Themes → Customize</strong> editor, find any section (header, footer, announcement bar) and add the <strong>"Currency Selector"</strong> block from the app blocks list.
                  </Text>
                </BlockStack>

                <Divider />

                <BlockStack gap="100">
                  <Text as="h3" variant="headingSm">Step 3 — Customize appearance</Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    In the theme editor, configure the block's colors, border radius, label text, and whether to show country names. The block automatically hides itself on single-market stores.
                  </Text>
                </BlockStack>

                <Divider />

                <BlockStack gap="100">
                  <Text as="h3" variant="headingSm">Step 4 — Verify checkout currency</Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    True end-to-end currency conversion (including checkout) requires <strong>Shopify Payments</strong> with local currencies enabled. Without this, the storefront will show the selected currency but checkout will fall back to the base store currency.
                  </Text>
                </BlockStack>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
