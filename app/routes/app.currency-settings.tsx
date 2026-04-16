import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  InlineStack,
  Badge,
  Button,
  Select,
  Divider,
  Banner,
  Box,
  ResourceList,
  ResourceItem,
  Thumbnail,
} from "@shopify/polaris";
import { DeleteIcon } from "@shopify/polaris-icons";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import { connectDB } from "../db.server";
import {
  getOrCreateSettings,
  Settings,
  type ICurrencyOption,
} from "../.server/models/settings.model";

// ─── Predefined currency list ─────────────────────────────────
const ALL_CURRENCIES: ICurrencyOption[] = [
  { currencyCode: "INR", countryCode: "IN", label: "India", symbol: "₹" },
  { currencyCode: "USD", countryCode: "US", label: "United States", symbol: "$" },
  { currencyCode: "EUR", countryCode: "DE", label: "Germany (Euro)", symbol: "€" },
  { currencyCode: "GBP", countryCode: "GB", label: "United Kingdom", symbol: "£" },
  { currencyCode: "AUD", countryCode: "AU", label: "Australia", symbol: "A$" },
  { currencyCode: "CAD", countryCode: "CA", label: "Canada", symbol: "CA$" },
  { currencyCode: "SGD", countryCode: "SG", label: "Singapore", symbol: "S$" },
  { currencyCode: "AED", countryCode: "AE", label: "UAE", symbol: "د.إ" },
  { currencyCode: "SAR", countryCode: "SA", label: "Saudi Arabia", symbol: "﷼" },
  { currencyCode: "JPY", countryCode: "JP", label: "Japan", symbol: "¥" },
  { currencyCode: "CNY", countryCode: "CN", label: "China", symbol: "¥" },
  { currencyCode: "HKD", countryCode: "HK", label: "Hong Kong", symbol: "HK$" },
  { currencyCode: "MYR", countryCode: "MY", label: "Malaysia", symbol: "RM" },
  { currencyCode: "THB", countryCode: "TH", label: "Thailand", symbol: "฿" },
  { currencyCode: "IDR", countryCode: "ID", label: "Indonesia", symbol: "Rp" },
  { currencyCode: "PHP", countryCode: "PH", label: "Philippines", symbol: "₱" },
  { currencyCode: "PKR", countryCode: "PK", label: "Pakistan", symbol: "₨" },
  { currencyCode: "BDT", countryCode: "BD", label: "Bangladesh", symbol: "৳" },
  { currencyCode: "LKR", countryCode: "LK", label: "Sri Lanka", symbol: "₨" },
  { currencyCode: "NPR", countryCode: "NP", label: "Nepal", symbol: "₨" },
  { currencyCode: "NZD", countryCode: "NZ", label: "New Zealand", symbol: "NZ$" },
  { currencyCode: "CHF", countryCode: "CH", label: "Switzerland", symbol: "Fr" },
  { currencyCode: "SEK", countryCode: "SE", label: "Sweden", symbol: "kr" },
  { currencyCode: "NOK", countryCode: "NO", label: "Norway", symbol: "kr" },
  { currencyCode: "DKK", countryCode: "DK", label: "Denmark", symbol: "kr" },
  { currencyCode: "ZAR", countryCode: "ZA", label: "South Africa", symbol: "R" },
  { currencyCode: "BRL", countryCode: "BR", label: "Brazil", symbol: "R$" },
  { currencyCode: "MXN", countryCode: "MX", label: "Mexico", symbol: "$" },
  { currencyCode: "KWD", countryCode: "KW", label: "Kuwait", symbol: "KD" },
  { currencyCode: "QAR", countryCode: "QA", label: "Qatar", symbol: "QR" },
  { currencyCode: "OMR", countryCode: "OM", label: "Oman", symbol: "﷼" },
  { currencyCode: "BHD", countryCode: "BH", label: "Bahrain", symbol: "BD" },
];

// ─── Loader ───────────────────────────────────────────────────
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();
  const settings = await getOrCreateSettings(session.shop);

  return json({
    currencySelectorEnabled: settings.currencySelectorEnabled ?? true,
    currencies: JSON.parse(JSON.stringify(settings.currencies || [])) as ICurrencyOption[],
  });
};

// ─── Action ───────────────────────────────────────────────────
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  await connectDB();

  const formData = await request.formData();
  const intent = formData.get("_intent") as string;

  // Get shop GID for metafields
  const shopRes = await admin.graphql(`#graphql
    query { shop { id } }
  `);
  const shopData = await shopRes.json();
  const shopGid = shopData.data.shop.id;

  if (intent === "toggle") {
    const enabled = formData.get("currencySelectorEnabled") === "true";
    await Settings.findOneAndUpdate(
      { shopId: session.shop },
      { $set: { currencySelectorEnabled: enabled } },
      { upsert: true },
    );
    await admin.graphql(
      `#graphql
      mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          userErrors { field message }
        }
      }`,
      {
        variables: {
          metafields: [
            {
              ownerId: shopGid,
              namespace: "loyalty_widget",
              key: "currency_selector_enabled",
              value: String(enabled),
              type: "boolean",
            },
          ],
        },
      },
    );
    return json({ success: true });
  }

  if (intent === "saveCurrencies") {
    const raw = formData.get("currencies") as string;
    let currencies: ICurrencyOption[] = [];
    try { currencies = JSON.parse(raw); } catch { currencies = []; }

    await Settings.findOneAndUpdate(
      { shopId: session.shop },
      { $set: { currencies } },
      { upsert: true },
    );

    // Sync to metafield as JSON so Liquid block can read it
    await admin.graphql(
      `#graphql
      mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          userErrors { field message }
        }
      }`,
      {
        variables: {
          metafields: [
            {
              ownerId: shopGid,
              namespace: "loyalty_widget",
              key: "currencies",
              value: JSON.stringify(currencies),
              type: "json",
            },
          ],
        },
      },
    );
    return json({ success: true });
  }

  return json({ success: false });
};

// ─── Component ────────────────────────────────────────────────
export default function CurrencySettings() {
  const { currencySelectorEnabled, currencies: initialCurrencies } =
    useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isSaving = navigation.state === "submitting";

  const [enabled, setEnabled] = useState(currencySelectorEnabled);
  const [currencies, setCurrencies] = useState<ICurrencyOption[]>(initialCurrencies);
  const [selectedToAdd, setSelectedToAdd] = useState("");
  const [saved, setSaved] = useState(false);

  // Currencies not yet added
  const availableToAdd = ALL_CURRENCIES.filter(
    (c) => !currencies.find((a) => a.currencyCode === c.currencyCode),
  );
  const addOptions = [
    { label: "— Select a currency —", value: "" },
    ...availableToAdd.map((c) => ({
      label: `${c.symbol}  ${c.currencyCode} — ${c.label}`,
      value: c.currencyCode,
    })),
  ];

  const handleToggle = useCallback(() => {
    const newVal = !enabled;
    setEnabled(newVal);
    submit(
      { _intent: "toggle", currencySelectorEnabled: String(newVal) },
      { method: "POST" },
    );
  }, [enabled, submit]);

  const handleAdd = useCallback(() => {
    if (!selectedToAdd) return;
    const cur = ALL_CURRENCIES.find((c) => c.currencyCode === selectedToAdd);
    if (!cur) return;
    setCurrencies((prev) => [...prev, cur]);
    setSelectedToAdd("");
    setSaved(false);
  }, [selectedToAdd]);

  const handleRemove = useCallback((code: string) => {
    setCurrencies((prev) => prev.filter((c) => c.currencyCode !== code));
    setSaved(false);
  }, []);

  const handleSave = useCallback(() => {
    submit(
      { _intent: "saveCurrencies", currencies: JSON.stringify(currencies) },
      { method: "POST" },
    );
    setSaved(true);
  }, [currencies, submit]);

  return (
    <Page
      title="Currency Selector"
      subtitle="Choose which currencies customers can switch to on your storefront"
    >
      <Layout>
        {/* Enable / Disable toggle */}
        <Layout.Section>
          <Card>
            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd">Currency Selector</Text>
                <Text as="p" variant="bodyMd" tone="subdued">
                  Show or hide the currency switcher on your storefront.
                </Text>
              </BlockStack>
              <InlineStack gap="300" blockAlign="center">
                <Badge tone={enabled ? "success" : "critical"}>
                  {enabled ? "Enabled" : "Disabled"}
                </Badge>
                <Button
                  onClick={handleToggle}
                  loading={isSaving && navigation.formData?.get("_intent") === "toggle"}
                  tone={enabled ? "critical" : undefined}
                  variant={enabled ? "secondary" : "primary"}
                >
                  {enabled ? "Disable" : "Enable"}
                </Button>
              </InlineStack>
            </InlineStack>
          </Card>
        </Layout.Section>

        {/* Currency list management */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">Currencies</Text>
                <Badge>{currencies.length} added</Badge>
              </InlineStack>

              <Text as="p" variant="bodyMd" tone="subdued">
                Add the currencies you want to offer. Customers will see these
                in the selector on your storefront.
              </Text>

              {/* Added currencies */}
              {currencies.length === 0 ? (
                <Box
                  padding="400"
                  background="bg-surface-secondary"
                  borderRadius="200"
                >
                  <Text as="p" variant="bodyMd" tone="subdued" alignment="center">
                    No currencies added yet. Add at least one below.
                  </Text>
                </Box>
              ) : (
                <BlockStack gap="200">
                  {currencies.map((cur) => (
                    <Box
                      key={cur.currencyCode}
                      padding="300"
                      background="bg-surface-secondary"
                      borderRadius="200"
                    >
                      <InlineStack align="space-between" blockAlign="center">
                        <InlineStack gap="300" blockAlign="center">
                          <Box
                            padding="150"
                            background="bg-surface"
                            borderRadius="100"
                            minWidth="36px"
                          >
                            <Text as="span" variant="bodyMd" fontWeight="bold" alignment="center">
                              {cur.symbol}
                            </Text>
                          </Box>
                          <BlockStack gap="0">
                            <Text as="span" variant="bodyMd" fontWeight="semibold">
                              {cur.currencyCode}
                            </Text>
                            <Text as="span" variant="bodySm" tone="subdued">
                              {cur.label} · {cur.countryCode}
                            </Text>
                          </BlockStack>
                        </InlineStack>
                        <Button
                          icon={DeleteIcon}
                          tone="critical"
                          variant="plain"
                          onClick={() => handleRemove(cur.currencyCode)}
                          accessibilityLabel={`Remove ${cur.currencyCode}`}
                        />
                      </InlineStack>
                    </Box>
                  ))}
                </BlockStack>
              )}

              <Divider />

              {/* Add currency row */}
              <InlineStack gap="200" blockAlign="end">
                <Box minWidth="260px">
                  <Select
                    label="Add a currency"
                    options={addOptions}
                    value={selectedToAdd}
                    onChange={setSelectedToAdd}
                    disabled={availableToAdd.length === 0}
                  />
                </Box>
                <Box paddingBlockStart="500">
                  <Button
                    onClick={handleAdd}
                    disabled={!selectedToAdd}
                    variant="secondary"
                  >
                    Add
                  </Button>
                </Box>
              </InlineStack>

              <Divider />

              {/* Save button */}
              <InlineStack align="end" gap="300">
                {saved && !isSaving && (
                  <Text as="span" variant="bodySm" tone="success">
                    Saved successfully
                  </Text>
                )}
                <Button
                  variant="primary"
                  onClick={handleSave}
                  loading={isSaving && navigation.formData?.get("_intent") === "saveCurrencies"}
                  disabled={currencies.length === 0}
                >
                  Save currencies
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Info */}
        <Layout.Section>
          <Banner tone="info">
            <p>
              Customers can switch between the currencies you've added above.
              For prices to correctly convert at checkout, the corresponding
              countries must also be set up in{" "}
              <a
                href="https://admin.shopify.com/settings/markets"
                target="_blank"
                rel="noreferrer"
              >
                Shopify Markets
              </a>
              .
            </p>
          </Banner>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
