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
  List,
  Divider,
  Box,
  InlineStack,
  Badge,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

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
  const { shop } = useLoaderData<typeof loader>();

  return (
    <Page
      title="Currency Selector"
      subtitle="Add a native Shopify Markets currency selector to your storefront"
    >
      <Layout>
        {/* Status Banner */}
        <Layout.Section>
          <Banner title="Currency selector is ready to use" tone="success">
            <p>
              The currency selector block is available to add to your theme. To
              offer multiple currencies, configure markets in{" "}
              <a
                href="https://admin.shopify.com/settings/markets"
                target="_blank"
                rel="noreferrer"
              >
                Settings → Markets
              </a>
              .
            </p>
          </Banner>
        </Layout.Section>

        {/* Store Currency */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Store Currency
              </Text>
              <InlineStack gap="400">
                <Box>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Store name
                  </Text>
                  <Text as="p" variant="bodyMd" fontWeight="semibold">
                    {shop.name || "—"}
                  </Text>
                </Box>
                <Box>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Base currency
                  </Text>
                  <Text as="p" variant="bodyMd" fontWeight="semibold">
                    {shop.currencyCode || "—"}
                  </Text>
                </Box>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* How it works */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                How it works
              </Text>
              <Text as="p" variant="bodyMd" tone="subdued">
                The currency selector uses Shopify's native Markets +
                localization form. When a customer picks a currency, Shopify
                switches their market context — prices update across the entire
                storefront including product pages, cart, and checkout.
              </Text>
              <Divider />
              <List type="number">
                <List.Item>
                  <strong>Shopify Markets</strong> defines which countries and
                  currencies are available
                </List.Item>
                <List.Item>
                  The <strong>Currency Selector block</strong> submits the
                  customer's choice via a native localization form
                </List.Item>
                <List.Item>
                  Shopify resolves the active market and{" "}
                  <strong>renders all prices</strong> in the correct
                  presentment currency
                </List.Item>
                <List.Item>
                  Your loyalty widget and cart drawer{" "}
                  <strong>automatically reflect</strong> the selected currency
                </List.Item>
              </List>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Setup Steps */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Setup Steps
              </Text>

              <BlockStack gap="300">
                <BlockStack gap="100">
                  <InlineStack gap="200" blockAlign="center">
                    <Badge tone="info">Step 1</Badge>
                    <Text as="h3" variant="headingSm">
                      Configure Markets in Shopify Admin
                    </Text>
                  </InlineStack>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Go to{" "}
                    <a
                      href="https://admin.shopify.com/settings/markets"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Settings → Markets
                    </a>{" "}
                    in your Shopify admin. Create markets for the regions you
                    sell into and enable local currencies for each.
                  </Text>
                </BlockStack>

                <Divider />

                <BlockStack gap="100">
                  <InlineStack gap="200" blockAlign="center">
                    <Badge tone="info">Step 2</Badge>
                    <Text as="h3" variant="headingSm">
                      Add the block to your theme
                    </Text>
                  </InlineStack>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    In <strong>Online Store → Themes → Customize</strong>, find
                    any section (header, footer, announcement bar) and add the{" "}
                    <strong>"Currency Selector"</strong> app block.
                  </Text>
                </BlockStack>

                <Divider />

                <BlockStack gap="100">
                  <InlineStack gap="200" blockAlign="center">
                    <Badge tone="info">Step 3</Badge>
                    <Text as="h3" variant="headingSm">
                      Customize appearance
                    </Text>
                  </InlineStack>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    In the theme editor, configure the block's colors, border
                    radius, label text, and whether to show country names.
                  </Text>
                </BlockStack>

                <Divider />

                <BlockStack gap="100">
                  <InlineStack gap="200" blockAlign="center">
                    <Badge tone="warning">Note</Badge>
                    <Text as="h3" variant="headingSm">
                      Checkout currency
                    </Text>
                  </InlineStack>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    True end-to-end currency conversion at checkout requires{" "}
                    <strong>Shopify Payments</strong> with local currencies
                    enabled on each market.
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
