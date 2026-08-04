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
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { connectDB } from "../db.server";
import {
  getOrCreateCartSettings,
  CartDrawerSettings,
  type ICartTier,
  type IManualProduct,
} from "../.server/models/cart-settings.model";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();
  const settings = await getOrCreateCartSettings(session.shop);
  return json({ settings: JSON.parse(JSON.stringify(settings)) });
};

/**
 * Merchants paste a payment gateway's raw embed snippet here (e.g.
 * ShipRocket's Fastrr Boost script tags) to inject into the storefront.
 * Only <script src="https://..."> and <link href="https://..."> tags are
 * kept — everything else in the pasted snippet (any other markup, inline
 * script bodies, non-https URLs) is discarded, so this can't become a
 * generic HTML/script injection point beyond "load this external SDK URL".
 */
function sanitizeCheckoutScriptTags(raw: string): string {
  const tags: string[] = [];
  const scriptRe = /<script\b[^>]*\bsrc=["'](https:\/\/[^"'<>]+)["'][^>]*>\s*<\/script>/gi;
  const linkRe = /<link\b[^>]*\bhref=["'](https:\/\/[^"'<>]+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = scriptRe.exec(raw))) {
    tags.push(`<script src="${match[1]}" defer></script>`);
  }
  while ((match = linkRe.exec(raw))) {
    tags.push(`<link rel="stylesheet" href="${match[1]}">`);
  }
  return tags.slice(0, 10).join("\n");
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();

  const formData = await request.formData();
  const data = Object.fromEntries(formData);

  try {
    const tiers = JSON.parse(String(data.tiers) || "[]");
    const manualProducts = JSON.parse(String(data.manualProducts) || "[]");
    const upsellProduct = data.upsellProduct ? JSON.parse(String(data.upsellProduct)) : null;

    await CartDrawerSettings.findOneAndUpdate(
      { shopId: session.shop },
      {
        $set: {
          enabled: data.enabled === "true",
          showProgressBar: data.showProgressBar === "true",
          tiers,
          showRecommendations: data.showRecommendations === "true",
          recommendationsTitle: data.recommendationsTitle || "People Also Bought",
          recommendationsCount: Number(data.recommendationsCount) || 4,
          recommendationMode: data.recommendationMode || "auto",
          recommendationsSlider: data.recommendationsSlider === "true",
          manualProducts,
          showSavings: data.showSavings === "true",
          checkoutButtonText: data.checkoutButtonText || "CHECKOUT",
          prepaidBannerText: data.prepaidBannerText || "",
          showPrepaidBanner: data.showPrepaidBanner === "true",
          shippingBannerText: String(data.shippingBannerText || "").slice(0, 80),
          announcementTexts: String(data.announcementTexts || "")
            .split("\n")
            .map((t) => t.trim())
            .filter(Boolean)
            .slice(0, 10),
          announcementDelay: Math.min(30, Math.max(0, Number(data.announcementDelay) || 0)),
          announcementTextColor: String(data.announcementTextColor || "").slice(0, 20),
          announcementBgColor: String(data.announcementBgColor || "").slice(0, 20),
          progressBannerText: String(data.progressBannerText || "").slice(0, 100),
          paymentMethodsText: String(data.paymentMethodsText || "").slice(0, 120),
          checkoutScriptTags: sanitizeCheckoutScriptTags(String(data.checkoutScriptTags || "")),
          couponEnabled: data.couponEnabled === "true",
          couponCode: String(data.couponCode || "").trim().slice(0, 40),
          couponDescription: String(data.couponDescription || "").slice(0, 80),
          // Only store http(s) links — this value is rendered into an href.
          couponOffersUrl: /^https?:\/\//i.test(String(data.couponOffersUrl || ""))
            ? String(data.couponOffersUrl).slice(0, 500)
            : "",
          primaryColor: data.primaryColor || "#5C6AC4",
          interceptAddToCart: data.interceptAddToCart === "true",
          showUpsell: data.showUpsell === "true",
          upsellHeadline: data.upsellHeadline || "Special Offer Just For You!",
          upsellDiscount: Math.min(70, Math.max(0, Number(data.upsellDiscount) || 10)),
          upsellProduct,
          fontFamily: String(data.fontFamily || "").slice(0, 120),
          fontSize: Math.min(24, Math.max(0, Number(data.fontSize) || 0)),
          progressBarColor: String(data.progressBarColor || "").slice(0, 20),
          offerLineBg: String(data.offerLineBg || "").slice(0, 20),
          offerLineTextColor: String(data.offerLineTextColor || "").slice(0, 20),
          buttonColor: String(data.buttonColor || "").slice(0, 20),
          buttonHoverColor: String(data.buttonHoverColor || "").slice(0, 20),
          buttonHoverTextColor: String(data.buttonHoverTextColor || "").slice(0, 20),
          headerCountSize: Math.min(60, Math.max(0, Number(data.headerCountSize) || 0)),
          drawerWidth: Math.min(640, Math.max(0, Number(data.drawerWidth) || 0)),
          pillColor: String(data.pillColor || "").slice(0, 20),
          pillTextColor: String(data.pillTextColor || "").slice(0, 20),
          nodeColor: String(data.nodeColor || "").slice(0, 20),
          nodeTextColor: String(data.nodeTextColor || "").slice(0, 20),
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
  const shopify = useAppBridge();

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
  const [recommendationMode, setRecommendationMode] = useState(
    settings.recommendationMode || "auto",
  );
  const [recommendationsSlider, setRecommendationsSlider] = useState(
    settings.recommendationsSlider || false,
  );
  const [manualProducts, setManualProducts] = useState<IManualProduct[]>(
    settings.manualProducts || [],
  );
  const [addProductError, setAddProductError] = useState("");
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
  const [shippingBannerText, setShippingBannerText] = useState(
    settings.shippingBannerText || "",
  );
  const [announcementTexts, setAnnouncementTexts] = useState(
    (settings.announcementTexts || []).join("\n"),
  );
  const [announcementDelay, setAnnouncementDelay] = useState(
    String(settings.announcementDelay || ""),
  );
  const [announcementTextColor, setAnnouncementTextColor] = useState(
    settings.announcementTextColor || "",
  );
  const [announcementBgColor, setAnnouncementBgColor] = useState(
    settings.announcementBgColor || "",
  );
  const [progressBannerText, setProgressBannerText] = useState(
    settings.progressBannerText || "",
  );
  const [paymentMethodsText, setPaymentMethodsText] = useState(
    settings.paymentMethodsText || "",
  );
  const [checkoutScriptTags, setCheckoutScriptTags] = useState(
    settings.checkoutScriptTags || "",
  );
  const [couponEnabled, setCouponEnabled] = useState(
    Boolean(settings.couponEnabled),
  );
  const [couponCode, setCouponCode] = useState(settings.couponCode || "");
  const [couponDescription, setCouponDescription] = useState(
    settings.couponDescription || "",
  );
  const [couponOffersUrl, setCouponOffersUrl] = useState(
    settings.couponOffersUrl || "",
  );
  const [primaryColor, setPrimaryColor] = useState(settings.primaryColor);
  const [showProgressBar, setShowProgressBar] = useState(
    settings.showProgressBar ?? true,
  );
  const [tiers, setTiers] = useState<ICartTier[]>(settings.tiers || []);
  const [showUpsell, setShowUpsell] = useState(settings.showUpsell || false);
  const [upsellHeadline, setUpsellHeadline] = useState(settings.upsellHeadline || "Special Offer Just For You!");
  const [upsellDiscount, setUpsellDiscount] = useState(String(settings.upsellDiscount ?? 10));
  const [upsellProduct, setUpsellProduct] = useState<IManualProduct | null>(settings.upsellProduct || null);
  const [upsellProductUrl, setUpsellProductUrl] = useState("");
  const [addUpsellProductError, setAddUpsellProductError] = useState("");
  const [addingUpsellProduct, setAddingUpsellProduct] = useState(false);

  const [fontFamily, setFontFamily] = useState(settings.fontFamily || "");
  const [fontSize, setFontSize] = useState(String(settings.fontSize || ""));
  const [progressBarColor, setProgressBarColor] = useState(settings.progressBarColor || "");
  const [offerLineBg, setOfferLineBg] = useState(settings.offerLineBg || "");
  const [offerLineTextColor, setOfferLineTextColor] = useState(settings.offerLineTextColor || "");
  const [buttonColor, setButtonColor] = useState(settings.buttonColor || "");
  const [buttonHoverColor, setButtonHoverColor] = useState(settings.buttonHoverColor || "");
  const [buttonHoverTextColor, setButtonHoverTextColor] = useState(settings.buttonHoverTextColor || "");
  const [headerCountSize, setHeaderCountSize] = useState(String(settings.headerCountSize || ""));
  const [drawerWidth, setDrawerWidth] = useState(String(settings.drawerWidth || ""));
  const [pillColor, setPillColor] = useState(settings.pillColor || "");
  const [pillTextColor, setPillTextColor] = useState(settings.pillTextColor || "");
  const [nodeColor, setNodeColor] = useState(settings.nodeColor || "");
  const [nodeTextColor, setNodeTextColor] = useState(settings.nodeTextColor || "");

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
    formData.set("recommendationMode", recommendationMode);
    formData.set("recommendationsSlider", String(recommendationsSlider));
    formData.set("manualProducts", JSON.stringify(manualProducts));
    formData.set("showSavings", String(showSavings));
    formData.set("checkoutButtonText", checkoutButtonText);
    formData.set("prepaidBannerText", prepaidBannerText);
    formData.set("showPrepaidBanner", String(showPrepaidBanner));
    formData.set("shippingBannerText", shippingBannerText);
    formData.set("announcementTexts", announcementTexts);
    formData.set("announcementDelay", announcementDelay);
    formData.set("announcementTextColor", announcementTextColor);
    formData.set("announcementBgColor", announcementBgColor);
    formData.set("progressBannerText", progressBannerText);
    formData.set("paymentMethodsText", paymentMethodsText);
    formData.set("checkoutScriptTags", checkoutScriptTags);
    formData.set("couponEnabled", String(couponEnabled));
    formData.set("couponCode", couponCode);
    formData.set("couponDescription", couponDescription);
    formData.set("couponOffersUrl", couponOffersUrl);
    formData.set("primaryColor", primaryColor);
    formData.set("showProgressBar", String(showProgressBar));
    formData.set("tiers", JSON.stringify(tiers));
    formData.set("showUpsell", String(showUpsell));
    formData.set("upsellHeadline", upsellHeadline);
    formData.set("upsellDiscount", upsellDiscount);
    formData.set("upsellProduct", upsellProduct ? JSON.stringify(upsellProduct) : "");
    formData.set("fontFamily", fontFamily);
    formData.set("fontSize", fontSize);
    formData.set("progressBarColor", progressBarColor);
    formData.set("offerLineBg", offerLineBg);
    formData.set("offerLineTextColor", offerLineTextColor);
    formData.set("buttonColor", buttonColor);
    formData.set("buttonHoverColor", buttonHoverColor);
    formData.set("buttonHoverTextColor", buttonHoverTextColor);
    formData.set("headerCountSize", headerCountSize);
    formData.set("drawerWidth", drawerWidth);
    formData.set("pillColor", pillColor);
    formData.set("pillTextColor", pillTextColor);
    formData.set("nodeColor", nodeColor);
    formData.set("nodeTextColor", nodeTextColor);
    submit(formData, { method: "post" });
  }, [
    enabled, interceptAddToCart, showRecommendations, recommendationsTitle,
    recommendationsCount, recommendationMode, recommendationsSlider, manualProducts, showSavings,
    checkoutButtonText, prepaidBannerText, showPrepaidBanner, primaryColor, showProgressBar,
    tiers, showUpsell, upsellHeadline, upsellDiscount, upsellProduct,
    shippingBannerText, announcementTexts, announcementDelay, announcementTextColor, announcementBgColor,
    progressBannerText, paymentMethodsText, checkoutScriptTags, couponEnabled, couponCode,
    couponDescription, couponOffersUrl,
    fontFamily, fontSize, progressBarColor, offerLineBg, offerLineTextColor,
    buttonColor, buttonHoverColor, buttonHoverTextColor, headerCountSize, drawerWidth,
    pillColor, pillTextColor, nodeColor, nodeTextColor, submit,
  ]);

  const removeManualProduct = useCallback((index: number) => {
    setManualProducts((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleBrowseProducts = useCallback(async () => {
    setAddProductError("");

    try {
      const selected = await shopify.resourcePicker({
        type: "product",
        multiple: true,
        action: "select",
      });
      if (!selected || selected.length === 0) return;

      const already = new Set(manualProducts.map((p) => p.shopifyProductId));
      const picked: IManualProduct[] = [];

      for (const product of selected as any[]) {
        if (already.has(product.id) || picked.some((p) => p.shopifyProductId === product.id)) {
          continue;
        }
        const variant = product.variants?.[0];
        picked.push({
          shopifyProductId: product.id,
          title: product.title,
          handle: product.handle,
          imageUrl: product.images?.[0]?.originalSrc || product.images?.[0]?.url || "",
          price: Math.round(parseFloat(variant?.price || "0") * 100),
          compareAtPrice: variant?.compareAtPrice
            ? Math.round(parseFloat(variant.compareAtPrice) * 100)
            : undefined,
          variantId: variant?.id || "",
        });
      }

      if (picked.length > 0) {
        setManualProducts((prev) => [...prev, ...picked]);
      }
    } catch (err) {
      // A cancelled picker rejects too — only surface real failures.
      if (err instanceof Error && err.message) {
        setAddProductError(err.message);
      }
    }
  }, [shopify, manualProducts]);

  const handleAddUpsellProduct = useCallback(async () => {
    if (!upsellProductUrl.trim()) return;
    setAddingUpsellProduct(true);
    setAddUpsellProductError("");
    try {
      let handle = upsellProductUrl.trim();
      const match = handle.match(/\/products\/([a-zA-Z0-9\-_]+)/);
      if (match) handle = match[1];
      handle = handle.split("?")[0].split("#")[0];
      const res = await fetch(`/api/product-lookup?handle=${encodeURIComponent(handle)}`);
      const body = await res.json().catch(() => null);
      if (!res.ok || !body || body.error) {
        throw new Error(body?.error || `Product lookup failed (${res.status})`);
      }
      const product = body;
      setUpsellProduct({
        shopifyProductId: product.id,
        title: product.title,
        handle: product.handle,
        imageUrl: product.imageUrl,
        price: product.price,
        compareAtPrice: product.compareAtPrice,
        variantId: product.variantId,
      });
      setUpsellProductUrl("");
    } catch (err) {
      setAddUpsellProductError(
        err instanceof Error ? err.message : "Could not find that product. Check the handle or URL and try again.",
      );
    }
    setAddingUpsellProduct(false);
  }, [upsellProductUrl]);

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
                <Checkbox
                  label="Show progress bar"
                  helpText="Turn off to hide the tiered progress bar/card entirely, even with tiers configured below."
                  checked={showProgressBar}
                  onChange={setShowProgressBar}
                />
                <TextField
                  label="Banner Text (optional)"
                  value={progressBannerText}
                  onChange={setProgressBannerText}
                  helpText="Shown as a colored strip above the progress message, e.g. a disclaimer. Hidden when empty."
                  autoComplete="off"
                  maxLength={100}
                  disabled={!showProgressBar}
                />
                {!showProgressBar && (
                  <Text as="p" variant="bodySm" tone="subdued">
                    Progress bar is hidden on the storefront. Turn it on above to manage tiers.
                  </Text>
                )}
                {showProgressBar && tiers.map((tier, index) => (
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
                {showProgressBar && <Button onClick={addTier}>+ Add Tier</Button>}
              </BlockStack>
            </Card>
          </Layout.AnnotatedSection>

          <Layout.AnnotatedSection
            title="Product Recommendations"
            description="Show 'People Also Bought' products below the cart items to increase AOV. Choose auto (AI-powered based on purchase history) or manually pick specific products."
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
                    <Checkbox
                      label="Show as horizontal slider"
                      helpText="Products scroll side-to-side in one row instead of wrapping in a grid."
                      checked={recommendationsSlider}
                      onChange={setRecommendationsSlider}
                    />
                    <Select
                      label="Recommendation Mode"
                      options={[
                        {
                          label: "Auto (AI-powered)",
                          value: "auto",
                        },
                        {
                          label: "Manual (Pick products yourself)",
                          value: "manual",
                        },
                      ]}
                      value={recommendationMode}
                      onChange={setRecommendationMode}
                      helpText={
                        recommendationMode === "auto"
                          ? "Shopify automatically suggests products based on purchase history and product relationships."
                          : "You choose exactly which products to show in the cart drawer."
                      }
                    />
                    {recommendationMode === "auto" && (
                      <TextField
                        label="Number of products"
                        type="number"
                        value={recommendationsCount}
                        onChange={setRecommendationsCount}
                        min={2}
                        max={8}
                        autoComplete="off"
                      />
                    )}
                    {recommendationMode === "manual" && (
                      <BlockStack gap="300">
                        <Text as="h3" variant="headingSm">
                          Selected Products ({manualProducts.length})
                        </Text>
                        {manualProducts.map((product, index) => (
                          <div
                            key={product.shopifyProductId}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "12px",
                              padding: "8px",
                              border: "1px solid #e0e0e0",
                              borderRadius: "8px",
                            }}
                          >
                            {product.imageUrl && (
                              <img
                                src={product.imageUrl}
                                alt={product.title}
                                style={{
                                  width: "48px",
                                  height: "48px",
                                  objectFit: "cover",
                                  borderRadius: "6px",
                                }}
                              />
                            )}
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <Text as="p" variant="bodyMd" fontWeight="semibold">
                                {product.title}
                              </Text>
                              <Text as="p" variant="bodySm" tone="subdued">
                                ₹{(product.price / 100).toFixed(0)}
                                {product.compareAtPrice
                                  ? ` (was ₹${(product.compareAtPrice / 100).toFixed(0)})`
                                  : ""}
                              </Text>
                            </div>
                            <Button
                              size="slim"
                              tone="critical"
                              onClick={() => removeManualProduct(index)}
                            >
                              Remove
                            </Button>
                          </div>
                        ))}
                        <Divider />
                        {addProductError && (
                          <Banner tone="critical" onDismiss={() => setAddProductError("")}>
                            {addProductError}
                          </Banner>
                        )}
                        <Button onClick={handleBrowseProducts}>
                          Browse products
                        </Button>
                      </BlockStack>
                    )}
                  </>
                )}
              </BlockStack>
            </Card>
          </Layout.AnnotatedSection>

          <Layout.AnnotatedSection
            title="Steal Deals"
            description="Show a single featured product with a special discount inside the cart drawer to boost AOV. Different from recommendations — this is a highlighted deal card."
          >
            <Card>
              <BlockStack gap="400">
                <Checkbox
                  label="Show Steal Deals section in cart drawer"
                  checked={showUpsell}
                  onChange={setShowUpsell}
                />
                {showUpsell && (
                  <>
                    <TextField
                      label="Steal Deals Headline"
                      value={upsellHeadline}
                      onChange={setUpsellHeadline}
                      placeholder="Steal Deals"
                      autoComplete="off"
                    />
                    <TextField
                      label="Discount Percentage (0–70%)"
                      type="number"
                      value={upsellDiscount}
                      onChange={setUpsellDiscount}
                      min={0}
                      max={70}
                      suffix="%"
                      autoComplete="off"
                    />
                    <Divider />
                    <Text as="h3" variant="headingSm">Upsell Product</Text>
                    {upsellProduct ? (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "12px",
                          padding: "8px",
                          border: "1px solid #e0e0e0",
                          borderRadius: "8px",
                        }}
                      >
                        {upsellProduct.imageUrl && (
                          <img
                            src={upsellProduct.imageUrl}
                            alt={upsellProduct.title}
                            style={{ width: "48px", height: "48px", objectFit: "cover", borderRadius: "6px" }}
                          />
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <Text as="p" variant="bodyMd" fontWeight="semibold">{upsellProduct.title}</Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            ₹{(upsellProduct.price / 100).toFixed(0)}
                            {" → "}₹{Math.round(upsellProduct.price / 100 * (1 - Number(upsellDiscount) / 100))}
                            {" "}({upsellDiscount}% off)
                          </Text>
                        </div>
                        <Button size="slim" tone="critical" onClick={() => setUpsellProduct(null)}>
                          Remove
                        </Button>
                      </div>
                    ) : (
                      <Text as="p" variant="bodySm" tone="subdued">No product selected.</Text>
                    )}
                    <Text as="p" variant="bodySm" tone="subdued">
                      Enter a product handle or URL to set the upsell product.
                    </Text>
                    {addUpsellProductError && (
                      <Banner tone="critical" onDismiss={() => setAddUpsellProductError("")}>
                        {addUpsellProductError}
                      </Banner>
                    )}
                    <InlineStack gap="200" blockAlign="end">
                      <div style={{ flex: 1 }}>
                        <TextField
                          label="Product Handle or URL"
                          value={upsellProductUrl}
                          onChange={(v) => { setUpsellProductUrl(v); setAddUpsellProductError(""); }}
                          placeholder="e.g., my-awesome-product"
                          autoComplete="off"
                          labelHidden
                        />
                      </div>
                      <Button onClick={handleAddUpsellProduct} loading={addingUpsellProduct}>
                        {upsellProduct ? "Replace Product" : "Add Product"}
                      </Button>
                    </InlineStack>
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
                <TextField
                  label="Payment methods line"
                  helpText="Small print under the checkout button. Leave blank to hide."
                  placeholder="UPI · Cards · Paytm · COD available"
                  value={paymentMethodsText}
                  onChange={setPaymentMethodsText}
                  maxLength={120}
                  autoComplete="off"
                />
                <Divider />
                <Text as="h3" variant="headingSm">Payment gateway checkout script</Text>
                <TextField
                  label="Script"
                  helpText={"Paste the embed snippet your payment/checkout provider gave you (e.g. ShipRocket Fastrr Boost) — only <script src=\"https://...\"> and <link href=\"https://...\"> tags are used, anything else is discarded. Loaded on every storefront page. Leave blank if you don't use one."}
                  placeholder={'<script src="https://fastrr-boost-ui.pickrr.com/assets/js/channels/shopify.js"></script>'}
                  value={checkoutScriptTags}
                  onChange={setCheckoutScriptTags}
                  multiline={4}
                  autoComplete="off"
                />
                <Divider />
                <Text as="h3" variant="headingSm">Announcement Bar</Text>
                <TextField
                  label="Messages"
                  helpText="One per line. With more than one, they slide/rotate automatically. Leave blank to hide the bar entirely."
                  placeholder={"Free shipping on all orders\n10% off your first order\nCOD available"}
                  value={announcementTexts}
                  onChange={setAnnouncementTexts}
                  multiline={3}
                  autoComplete="off"
                />
                <InlineGrid columns={3} gap="300">
                  <TextField
                    label="Slide delay (seconds)"
                    type="number"
                    value={announcementDelay}
                    onChange={setAnnouncementDelay}
                    placeholder="4"
                    min={1}
                    max={30}
                    autoComplete="off"
                  />
                  <TextField
                    label="Text color"
                    value={announcementTextColor}
                    onChange={setAnnouncementTextColor}
                    placeholder="#3f6b4a"
                    autoComplete="off"
                  />
                  <TextField
                    label="Background color"
                    value={announcementBgColor}
                    onChange={setAnnouncementBgColor}
                    placeholder="#e9f0e6"
                    autoComplete="off"
                  />
                </InlineGrid>
                <Divider />
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
                <Checkbox
                  label="Show coupon card"
                  helpText="Displays a promo code in the cart. Tapping Apply carries the code through to checkout, where Shopify validates it."
                  checked={couponEnabled}
                  onChange={setCouponEnabled}
                />
                {couponEnabled && (
                  <>
                    <TextField
                      label="Coupon code"
                      placeholder="FREECASH100"
                      value={couponCode}
                      onChange={setCouponCode}
                      maxLength={40}
                      autoComplete="off"
                      error={
                        couponEnabled && !couponCode.trim()
                          ? "Enter a code, or turn the coupon card off"
                          : undefined
                      }
                    />
                    <TextField
                      label="Coupon description"
                      placeholder="₹100 off first order"
                      value={couponDescription}
                      onChange={setCouponDescription}
                      maxLength={80}
                      autoComplete="off"
                    />
                    <TextField
                      label="View all offers link"
                      helpText="Optional. Must start with https://"
                      placeholder="https://your-store.com/pages/offers"
                      value={couponOffersUrl}
                      onChange={setCouponOffersUrl}
                      autoComplete="off"
                      error={
                        couponOffersUrl && !/^https?:\/\//i.test(couponOffersUrl)
                          ? "Enter a full URL starting with https://"
                          : undefined
                      }
                    />
                  </>
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

          <Layout.AnnotatedSection
            title="Appearance"
            description="Fonts and colors for the cart drawer — progress bar, offer banner, and checkout button. Leave a color blank to use the default."
          >
            <Card>
              <BlockStack gap="400">
                <InlineGrid columns={2} gap="300">
                  <TextField
                    label="Font family"
                    value={fontFamily}
                    onChange={setFontFamily}
                    placeholder="Karla, sans-serif"
                    helpText="Enter a Google Fonts name (e.g. 'Poppins') as the first name — it's loaded automatically. Leave blank for the default."
                    autoComplete="off"
                  />
                  <TextField
                    label="Font size (px)"
                    type="number"
                    value={fontSize}
                    onChange={setFontSize}
                    placeholder="14"
                    min={0}
                    max={24}
                    helpText="Base size for cart text. Leave blank for the default (14px)."
                    autoComplete="off"
                  />
                </InlineGrid>
                <InlineGrid columns={2} gap="300">
                  <TextField
                    label="Header count badge size (px)"
                    type="number"
                    value={headerCountSize}
                    onChange={setHeaderCountSize}
                    placeholder="20"
                    min={0}
                    max={60}
                    helpText="Diameter of the item-count circle next to “Your Cart”. Leave blank for the default (20px)."
                    autoComplete="off"
                  />
                  <TextField
                    label="Drawer width (px)"
                    type="number"
                    value={drawerWidth}
                    onChange={setDrawerWidth}
                    placeholder="420"
                    min={0}
                    max={640}
                    helpText="Panel width on desktop/tablet. Leave blank for the default (420px)."
                    autoComplete="off"
                  />
                </InlineGrid>
                <Divider />
                <Text as="h3" variant="headingSm">Progress bar</Text>
                <TextField
                  label="Progress bar accent color"
                  value={progressBarColor}
                  onChange={setProgressBarColor}
                  placeholder="#b3543f"
                  helpText="Color of the filled line, the current-position dot, and the highlighted word in the message (e.g. '1 item' away)."
                  autoComplete="off"
                />
                <InlineGrid columns={2} gap="300">
                  <TextField
                    label="Card background color"
                    value={offerLineBg}
                    onChange={setOfferLineBg}
                    placeholder="#fdfbf7"
                    helpText="Background of the whole progress-bar card, including the heading text."
                    autoComplete="off"
                  />
                  <TextField
                    label="Heading text color"
                    value={offerLineTextColor}
                    onChange={setOfferLineTextColor}
                    placeholder="#1c1a17"
                    autoComplete="off"
                  />
                </InlineGrid>
                <Text as="p" variant="bodySm" tone="subdued">
                  The milestone pill colors below don't apply to this layout — the
                  progress bar now shows plain dots instead of pill badges. The
                  milestone node colors (the dots) are still active.
                </Text>
                <InlineGrid columns={2} gap="300">
                  <TextField
                    label="Milestone pill background"
                    value={pillColor}
                    onChange={setPillColor}
                    placeholder="#ffffff"
                    helpText="Background of a reached tier's pill badge (e.g. 'FLAT 10% OFF')."
                    autoComplete="off"
                  />
                  <TextField
                    label="Milestone pill text color"
                    value={pillTextColor}
                    onChange={setPillTextColor}
                    placeholder="#454f2f"
                    autoComplete="off"
                  />
                </InlineGrid>
                <InlineGrid columns={2} gap="300">
                  <TextField
                    label="Milestone node background"
                    value={nodeColor}
                    onChange={setNodeColor}
                    placeholder="#ffffff"
                    helpText="Background of a reached tier's checkmark circle."
                    autoComplete="off"
                  />
                  <TextField
                    label="Milestone node text color"
                    value={nodeTextColor}
                    onChange={setNodeTextColor}
                    placeholder="#454f2f"
                    autoComplete="off"
                  />
                </InlineGrid>
                <Divider />
                <Text as="h3" variant="headingSm">Checkout button</Text>
                <InlineGrid columns={3} gap="300">
                  <TextField
                    label="Button color"
                    value={buttonColor}
                    onChange={setButtonColor}
                    placeholder="#1c1a17"
                    autoComplete="off"
                  />
                  <TextField
                    label="Hover color"
                    value={buttonHoverColor}
                    onChange={setButtonHoverColor}
                    placeholder="#000000"
                    autoComplete="off"
                  />
                  <TextField
                    label="Hover text color"
                    value={buttonHoverTextColor}
                    onChange={setButtonHoverTextColor}
                    placeholder="#ffffff"
                    autoComplete="off"
                  />
                </InlineGrid>
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
