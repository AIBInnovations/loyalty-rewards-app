import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  TextField,
  Button,
  Checkbox,
  Select,
  InlineStack,
  InlineGrid,
  Divider,
  Banner,
  Badge,
} from "@shopify/polaris";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import { connectDB } from "../db.server";
import {
  getOrCreateCartSettings,
  CartDrawerSettings,
  type ICartTier,
} from "../.server/models/cart-settings.model";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();
  const settings = await getOrCreateCartSettings(session.shop);
  return json({ settings: JSON.parse(JSON.stringify(settings)) });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();

  const formData = await request.formData();
  const data = Object.fromEntries(formData);

  try {
    const tiers = JSON.parse(String(data.tiers) || "[]");

    await CartDrawerSettings.findOneAndUpdate(
      { shopId: session.shop },
      {
        $set: {
          enabled: data.enabled === "true",
          tiers,
          showRecommendations: data.showRecommendations === "true",
          recommendationsTitle: data.recommendationsTitle || "People Also Bought",
          recommendationsCount: Number(data.recommendationsCount) || 4,
          showSavings: data.showSavings === "true",
          checkoutButtonText: data.checkoutButtonText || "CHECKOUT",
          prepaidBannerText: data.prepaidBannerText || "",
          showPrepaidBanner: data.showPrepaidBanner === "true",
          primaryColor: data.primaryColor || "#5C6AC4",
          interceptAddToCart: data.interceptAddToCart === "true",
        },
      },
      { upsert: true },
    );

    return json({ success: true });
  } catch (error) {
    return json(
      { success: false, error: "Failed to save settings" },
      { status: 500 },
    );
  }
};

const DEFAULT_TIER: ICartTier = {
  threshold: 1,
  type: "items",
  discountType: "percentage",
  discountValue: 5,
  label: "FLAT 5% OFF",
  belowMessage: "Add {remaining} more to get {label}",
  reachedMessage: "{label} unlocked!",
};

export default function CartSettingsPage() {
  const { settings } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isLoading = navigation.state === "submitting";

  const [enabled, setEnabled] = useState(settings.enabled);
  const [interceptAddToCart, setInterceptAddToCart] = useState(
    settings.interceptAddToCart,
  );
  const [showRecommendations, setShowRecommendations] = useState(
    settings.showRecommendations,
  );
  const [recommendationsTitle, setRecommendationsTitle] = useState(
    settings.recommendationsTitle,
  );
  const [recommendationsCount, setRecommendationsCount] = useState(
    String(settings.recommendationsCount),
  );
  const [showSavings, setShowSavings] = useState(settings.showSavings);
  const [checkoutButtonText, setCheckoutButtonText] = useState(
    settings.checkoutButtonText,
  );
  const [prepaidBannerText, setPrepaidBannerText] = useState(
    settings.prepaidBannerText,
  );
  const [showPrepaidBanner, setShowPrepaidBanner] = useState(
    settings.showPrepaidBanner,
  );
  const [primaryColor, setPrimaryColor] = useState(settings.primaryColor);
  const [tiers, setTiers] = useState<ICartTier[]>(settings.tiers || []);

  const addTier = useCallback(() => {
    setTiers((prev) => [
      ...prev,
      { ...DEFAULT_TIER, threshold: prev.length + 1 },
    ]);
  }, []);

  const removeTier = useCallback((index: number) => {
    setTiers((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateTier = useCallback(
    (index: number, field: keyof ICartTier, value: string | number) => {
      setTiers((prev) =>
        prev.map((tier, i) =>
          i === index ? { ...tier, [field]: value } : tier,
        ),
      );
    },
    [],
  );

  const handleSave = useCallback(() => {
    const formData = new FormData();
    formData.set("enabled", String(enabled));
    formData.set("interceptAddToCart", String(interceptAddToCart));
    formData.set("showRecommendations", String(showRecommendations));
    formData.set("recommendationsTitle", recommendationsTitle);
    formData.set("recommendationsCount", recommendationsCount);
    formData.set("showSavings", String(showSavings));
    formData.set("checkoutButtonText", checkoutButtonText);
    formData.set("prepaidBannerText", prepaidBannerText);
    formData.set("showPrepaidBanner", String(showPrepaidBanner));
    formData.set("primaryColor", primaryColor);
    formData.set("tiers", JSON.stringify(tiers));
    submit(formData, { method: "post" });
  }, [
    enabled, interceptAddToCart, showRecommendations, recommendationsTitle,
    recommendationsCount, showSavings, checkoutButtonText, prepaidBannerText,
    showPrepaidBanner, primaryColor, tiers, submit,
  ]);

  return (
    <Page
      title="Custom Cart Drawer"
      primaryAction={{
        content: "Save",
        onAction: handleSave,
        loading: isLoading,
      }}
      backAction={{ content: "Dashboard", url: "/app" }}
    >
      <BlockStack gap="500">
        <Layout>
          <Layout.AnnotatedSection
            title="Cart Drawer"
            description="Replace the default cart with a custom slide-out drawer featuring progress tiers and product recommendations."
          >
            <Card>
              <BlockStack gap="400">
                <Checkbox
                  label="Enable Custom Cart Drawer"
                  checked={enabled}
                  onChange={setEnabled}
                />
                <Checkbox
                  label="Intercept Add-to-Cart clicks"
                  helpText="Opens the cart drawer instead of redirecting to the cart page when customers add products."
                  checked={interceptAddToCart}
                  onChange={setInterceptAddToCart}
                />
              </BlockStack>
            </Card>
          </Layout.AnnotatedSection>

          <Layout.AnnotatedSection
            title="Progress Tiers"
            description="Set up milestone tiers to encourage customers to add more items. Supports item-count or amount-based thresholds."
          >
            <Card>
              <BlockStack gap="400">
                {tiers.map((tier, index) => (
                  <div key={index}>
                    {index > 0 && <Divider />}
                    <BlockStack gap="300">
                      <InlineStack align="space-between">
                        <Text as="h3" variant="headingSm">
                          Tier {index + 1}: {tier.label}
                        </Text>
                        <Button
                          size="slim"
                          tone="critical"
                          onClick={() => removeTier(index)}
                        >
                          Remove
                        </Button>
                      </InlineStack>
                      <InlineGrid columns={3} gap="300">
                        <TextField
                          label="Threshold"
                          type="number"
                          value={String(tier.threshold)}
                          onChange={(v) =>
                            updateTier(index, "threshold", Number(v))
                          }
                          autoComplete="off"
                          min={1}
                        />
                        <Select
                          label="Type"
                          options={[
                            { label: "Item Count", value: "items" },
                            { label: "Cart Amount (₹)", value: "amount" },
                          ]}
                          value={tier.type}
                          onChange={(v) => updateTier(index, "type", v)}
                        />
                        <Select
                          label="Discount Type"
                          options={[
                            { label: "Percentage (%)", value: "percentage" },
                            { label: "Fixed Amount (₹)", value: "fixed_amount" },
                            { label: "Free Shipping", value: "free_shipping" },
                            { label: "No Discount", value: "none" },
                          ]}
                          value={tier.discountType}
                          onChange={(v) => updateTier(index, "discountType", v)}
                        />
                      </InlineGrid>
                      <InlineGrid columns={2} gap="300">
                        {tier.discountType !== "none" &&
                          tier.discountType !== "free_shipping" && (
                            <TextField
                              label="Discount Value"
                              type="number"
                              value={String(tier.discountValue)}
                              onChange={(v) =>
                                updateTier(index, "discountValue", Number(v))
                              }
                              autoComplete="off"
                            />
                          )}
                        <TextField
                          label="Label"
                          value={tier.label}
                          onChange={(v) => updateTier(index, "label", v)}
                          helpText="Shown on the progress bar milestone"
                          autoComplete="off"
                        />
                      </InlineGrid>
                      <TextField
                        label="Below Threshold Message"
                        value={tier.belowMessage}
                        onChange={(v) => updateTier(index, "belowMessage", v)}
                        helpText="Use {remaining} for items/amount left, {label} for tier label"
                        autoComplete="off"
                      />
                      <TextField
                        label="Goal Reached Message"
                        value={tier.reachedMessage}
                        onChange={(v) => updateTier(index, "reachedMessage", v)}
                        helpText="Use {label} for tier label"
                        autoComplete="off"
                      />
                    </BlockStack>
                  </div>
                ))}
                <Button onClick={addTier}>+ Add Tier</Button>
              </BlockStack>
            </Card>
          </Layout.AnnotatedSection>

          <Layout.AnnotatedSection
            title="Product Recommendations"
            description="Show 'People Also Bought' products below the cart items to increase AOV."
          >
            <Card>
              <BlockStack gap="400">
                <Checkbox
                  label="Show product recommendations"
                  checked={showRecommendations}
                  onChange={setShowRecommendations}
                />
                {showRecommendations && (
                  <>
                    <TextField
                      label="Section Title"
                      value={recommendationsTitle}
                      onChange={setRecommendationsTitle}
                      autoComplete="off"
                    />
                    <TextField
                      label="Number of products"
                      type="number"
                      value={recommendationsCount}
                      onChange={setRecommendationsCount}
                      min={2}
                      max={8}
                      autoComplete="off"
                    />
                  </>
                )}
              </BlockStack>
            </Card>
          </Layout.AnnotatedSection>

          <Layout.AnnotatedSection
            title="Checkout & Display"
            description="Customize the checkout button and other display options."
          >
            <Card>
              <BlockStack gap="400">
                <TextField
                  label="Checkout Button Text"
                  value={checkoutButtonText}
                  onChange={setCheckoutButtonText}
                  autoComplete="off"
                />
                <Checkbox
                  label="Show savings amount"
                  helpText="Displays how much the customer is saving (compare_at_price vs price)"
                  checked={showSavings}
                  onChange={setShowSavings}
                />
                <Divider />
                <Checkbox
                  label="Show prepaid discount banner"
                  checked={showPrepaidBanner}
                  onChange={setShowPrepaidBanner}
                />
                {showPrepaidBanner && (
                  <TextField
                    label="Prepaid Banner Text"
                    value={prepaidBannerText}
                    onChange={setPrepaidBannerText}
                    autoComplete="off"
                  />
                )}
                <Divider />
                <TextField
                  label="Primary Color"
                  value={primaryColor}
                  onChange={setPrimaryColor}
                  helpText="Hex color code for progress bar and buttons"
                  autoComplete="off"
                />
              </BlockStack>
            </Card>
          </Layout.AnnotatedSection>
        </Layout>

        <Banner tone="info">
          <p>
            After saving, enable the "Cart Drawer" app embed in your theme:
            Online Store → Themes → Customize → App embeds → Cart Drawer.
          </p>
        </Banner>
      </BlockStack>
    </Page>
  );
}
