import {
  json,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "@remix-run/node";
import { useLoaderData, useNavigation, useSubmit } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  Button,
  InlineStack,
  Badge,
  Checkbox,
  Banner,
  TextField,
  RangeSlider,
  Divider,
} from "@shopify/polaris";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import { connectDB } from "../db.server";
import {
  getOrCreateImageSearchSettings,
  ImageSearchSettings,
} from "../.server/models/image-search-settings.model";
import { ImageEmbedding } from "../.server/models/image-embedding.model";
import { ImageSyncJob } from "../.server/models/image-sync-job.model";
import { triggerFullCatalogSyncForShop } from "../.server/services/image-index-jobs.service";
import { clearShopIndex } from "../.server/services/image-search.service";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();

  const settings = await getOrCreateImageSearchSettings(session.shop);
  const totalIndexed = await ImageEmbedding.countDocuments({
    shopId: session.shop,
    isActive: true,
  });
  const pendingJobs = await ImageSyncJob.countDocuments({
    shopId: session.shop,
    status: { $in: ["pending", "processing"] },
  });
  const failedJobs = await ImageSyncJob.countDocuments({
    shopId: session.shop,
    status: "failed",
  });

  return json({
    settings: JSON.parse(JSON.stringify(settings)),
    totalIndexed,
    pendingJobs,
    failedJobs,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();

  const fd = await request.formData();
  const actionType = fd.get("_action");

  if (actionType === "save_settings") {
    await ImageSearchSettings.findOneAndUpdate(
      { shopId: session.shop },
      {
        $set: {
          enabled: fd.get("enabled") === "true",
          maxResults: parseInt(String(fd.get("maxResults") || "8"), 10),
          minScore:
            parseFloat(String(fd.get("minScore") || "0.65")) / 100,
          showPrice: fd.get("showPrice") === "true",
          showAddToCart: fd.get("showAddToCart") === "true",
          primaryColor: String(fd.get("primaryColor") || "#5C6AC4"),
          buttonText: String(fd.get("buttonText") || "Find Similar Products"),
          modalTitle: String(
            fd.get("modalTitle") || "Visually Similar Products",
          ),
        },
      },
      { upsert: true },
    );
  }

  if (actionType === "trigger_sync") {
    // Fire-and-forget — don't await in action (would timeout)
    triggerFullCatalogSyncForShop(session.shop).catch((err) =>
      console.error("[ImageSearch] Manual sync failed:", err),
    );
  }

  if (actionType === "clear_index") {
    await clearShopIndex(session.shop);
  }

  return json({ success: true });
};

export default function ImageSearchSettingsPage() {
  const { settings: s, totalIndexed, pendingJobs, failedJobs } =
    useLoaderData<typeof loader>();
  const nav = useNavigation();
  const submit = useSubmit();
  const saving = nav.state === "submitting";

  const [enabled, setEnabled] = useState(s.enabled);
  const [maxResults, setMaxResults] = useState(String(s.maxResults));
  const [minScorePct, setMinScorePct] = useState(
    String(Math.round(s.minScore * 100)),
  );
  const [showPrice, setShowPrice] = useState(s.showPrice);
  const [showAddToCart, setShowAddToCart] = useState(s.showAddToCart);
  const [primaryColor, setPrimaryColor] = useState(s.primaryColor);
  const [buttonText, setButtonText] = useState(s.buttonText);
  const [modalTitle, setModalTitle] = useState(s.modalTitle);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const handleSave = useCallback(() => {
    const fd = new FormData();
    fd.append("_action", "save_settings");
    fd.append("enabled", String(enabled));
    fd.append("maxResults", maxResults);
    fd.append("minScore", minScorePct);
    fd.append("showPrice", String(showPrice));
    fd.append("showAddToCart", String(showAddToCart));
    fd.append("primaryColor", primaryColor);
    fd.append("buttonText", buttonText);
    fd.append("modalTitle", modalTitle);
    submit(fd, { method: "post" });
  }, [
    enabled,
    maxResults,
    minScorePct,
    showPrice,
    showAddToCart,
    primaryColor,
    buttonText,
    modalTitle,
    submit,
  ]);

  const handleTriggerSync = useCallback(() => {
    const fd = new FormData();
    fd.append("_action", "trigger_sync");
    submit(fd, { method: "post" });
  }, [submit]);

  const handleClearIndex = useCallback(() => {
    if (!showClearConfirm) {
      setShowClearConfirm(true);
      return;
    }
    const fd = new FormData();
    fd.append("_action", "clear_index");
    submit(fd, { method: "post" });
    setShowClearConfirm(false);
  }, [showClearConfirm, submit]);

  const lastSynced = s.lastSyncedAt
    ? new Date(s.lastSyncedAt).toLocaleString()
    : "Never";

  return (
    <Page
      title="Image Search"
      subtitle="Let shoppers find visually similar products by uploading a photo"
      primaryAction={{
        content: "Save",
        onAction: handleSave,
        loading: saving,
      }}
    >
      <Layout>
        {/* ── Status ─────────────────────────────────────────── */}
        <Layout.AnnotatedSection
          title="Status"
          description="Enable or disable image search on your storefront. Products are indexed automatically after enabling."
        >
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text variant="headingMd" as="h3">
                  Image Search
                </Text>
                <Badge tone={enabled ? "success" : "enabled"}>
                  {enabled ? "Enabled" : "Disabled"}
                </Badge>
              </InlineStack>

              <Checkbox
                label="Enable Image Search"
                checked={enabled}
                onChange={setEnabled}
              />

              <Divider />

              <BlockStack gap="200">
                <InlineStack gap="400">
                  <Text as="p" variant="bodyMd">
                    <strong>{totalIndexed}</strong> products indexed
                  </Text>
                  {pendingJobs > 0 && (
                    <Badge tone="attention">{`${pendingJobs} jobs pending`}</Badge>
                  )}
                  {failedJobs > 0 && (
                    <Badge tone="critical">{`${failedJobs} jobs failed`}</Badge>
                  )}
                </InlineStack>
                <Text as="p" tone="subdued" variant="bodySm">
                  Last synced: {lastSynced}
                </Text>
              </BlockStack>

              <Button
                onClick={handleTriggerSync}
                loading={saving && nav.formData?.get("_action") === "trigger_sync"}
              >
                Trigger Full Catalog Sync
              </Button>
            </BlockStack>
          </Card>
        </Layout.AnnotatedSection>

        {/* ── Search Behavior ────────────────────────────────── */}
        <Layout.AnnotatedSection
          title="Search Behavior"
          description="Control how many results are returned and the minimum similarity threshold."
        >
          <Card>
            <BlockStack gap="400">
              <TextField
                label="Max Results"
                type="number"
                value={maxResults}
                onChange={setMaxResults}
                min={1}
                max={20}
                helpText="Maximum number of similar products to show (1–20)"
                autoComplete="off"
              />

              <BlockStack gap="200">
                <Text as="p" variant="bodyMd">
                  Minimum Similarity: <strong>{minScorePct}%</strong>
                </Text>
                <RangeSlider
                  label="Minimum Similarity Score"
                  labelHidden
                  value={parseInt(minScorePct, 10) as any}
                  onChange={(v: number) => setMinScorePct(String(v))}
                  min={10}
                  max={99}
                  step={5}
                  output
                />
                <Text as="p" tone="subdued" variant="bodySm">
                  Products below this visual similarity threshold are filtered out.
                  Lower = more results, higher = more precise.
                </Text>
              </BlockStack>

              <Checkbox
                label="Show product price in results"
                checked={showPrice}
                onChange={setShowPrice}
              />

              <Checkbox
                label="Show Add to Cart button in results"
                checked={showAddToCart}
                onChange={setShowAddToCart}
              />
            </BlockStack>
          </Card>
        </Layout.AnnotatedSection>

        {/* ── Widget Appearance ───────────────────────────────── */}
        <Layout.AnnotatedSection
          title="Widget Appearance"
          description="Customize the text and color of the image search widget on your storefront."
        >
          <Card>
            <BlockStack gap="400">
              <TextField
                label="Search Button Text"
                value={buttonText}
                onChange={setButtonText}
                placeholder="Find Similar Products"
                helpText="Text shown on the camera icon button"
                autoComplete="off"
              />

              <TextField
                label="Modal Title"
                value={modalTitle}
                onChange={setModalTitle}
                placeholder="Visually Similar Products"
                helpText="Heading shown at the top of the search results modal"
                autoComplete="off"
              />

              <TextField
                label="Primary Color"
                value={primaryColor}
                onChange={setPrimaryColor}
                placeholder="#5C6AC4"
                helpText="Hex color code for the widget button and accents"
                autoComplete="off"
                prefix="#"
                connectedRight={
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      background: primaryColor.startsWith("#")
                        ? primaryColor
                        : `#${primaryColor}`,
                      border: "1px solid #ccc",
                      borderRadius: 4,
                    }}
                  />
                }
              />
            </BlockStack>
          </Card>
        </Layout.AnnotatedSection>

        {/* ── Danger Zone ─────────────────────────────────────── */}
        <Layout.AnnotatedSection
          title="Danger Zone"
          description="Permanently remove all indexed image embeddings for your store. You will need to re-sync to use image search again."
        >
          <Card>
            <BlockStack gap="400">
              {showClearConfirm && (
                <Banner tone="warning">
                  <p>
                    This will delete all <strong>{totalIndexed}</strong> indexed
                    product embeddings. Image search will return no results until
                    you trigger a full catalog sync. Are you sure?
                  </p>
                </Banner>
              )}
              <Button
                tone="critical"
                onClick={handleClearIndex}
                loading={saving && nav.formData?.get("_action") === "clear_index"}
              >
                {showClearConfirm ? "Yes, Clear Index" : "Clear Index"}
              </Button>
              {showClearConfirm && (
                <Button onClick={() => setShowClearConfirm(false)}>
                  Cancel
                </Button>
              )}
            </BlockStack>
          </Card>
        </Layout.AnnotatedSection>
      </Layout>
    </Page>
  );
}
