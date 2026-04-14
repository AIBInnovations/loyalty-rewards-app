import {
  json,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "@remix-run/node";
import { useLoaderData, useNavigation, useSubmit, useActionData, useFetcher } from "@remix-run/react";
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
  Link,
  Box,
} from "@shopify/polaris";
import { useState, useCallback, useEffect } from "react";
import { authenticate } from "../shopify.server";
import { connectDB } from "../db.server";
import {
  getOrCreateImageSearchSettings,
  ImageSearchSettings,
} from "../.server/models/image-search-settings.model";
import { ImageEmbedding } from "../.server/models/image-embedding.model";
import { ImageSyncJob } from "../.server/models/image-sync-job.model";

// Extension UUID from shopify.extension.toml  →  uid field
const EXTENSION_UUID = "63dc22e1-27da-358d-1f2a-1e6d9b60e4b66a03a917";
const BLOCK_HANDLE = "image-search";

// ─── Loader ──────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  await connectDB();

  const settings = await getOrCreateImageSearchSettings(session.shop);

  // Cache the access token so background sync can use it without needing the
  // offline session (avoids unauthenticated.admin issues).
  // Also migrate legacy high minScore.
  const needsMigration = settings.minScore > 0.3;
  await ImageSearchSettings.findOneAndUpdate(
    { shopId: session.shop },
    {
      $set: {
        ...(needsMigration ? { minScore: 0.25 } : {}),
        _accessToken: session.accessToken,
      },
    },
  );
  if (needsMigration) settings.minScore = 0.25;

  const totalIndexed = await ImageEmbedding.countDocuments({
    shopId: session.shop,
    isActive: true,
  });

  // Clear stale ImageSyncJob records left over from old cron-based implementation
  // (we no longer use the job queue — all indexing is inline)
  await ImageSyncJob.deleteMany({
    shopId: session.shop,
    status: { $in: ["pending", "processing"] },
  }).catch(() => {});

  const pendingJobs = 0;
  const failedJobs = 0;

  // Nothing to auto-trigger from loader — sync is now driven by the action
  // (either save_settings when enabling, or trigger_sync button).

  // Fetch active (main) theme ID to build the theme editor deeplink
  let themeEditorUrl = `https://${session.shop}/admin/themes`;
  try {
    const themesRes = await admin.graphql(`#graphql
      query {
        themes(first: 5, roles: [MAIN]) {
          nodes {
            id
            role
          }
        }
      }
    `);
    const themesData = await themesRes.json();
    const mainTheme = themesData?.data?.themes?.nodes?.[0];
    if (mainTheme?.id) {
      const themeNumericId = String(mainTheme.id).split("/").pop();
      themeEditorUrl = `https://${session.shop}/admin/themes/${themeNumericId}/editor?context=apps&activateAppId=${EXTENSION_UUID}/${BLOCK_HANDLE}`;
    }
  } catch {
    // Non-fatal — fall back to generic themes link
  }

  return json({
    settings: JSON.parse(JSON.stringify(settings)),
    totalIndexed,
    pendingJobs,
    failedJobs,
    themeEditorUrl,
    shop: session.shop,
  });
};

// ─── Action ──────────────────────────────────────────────────────

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  await connectDB();

  const fd = await request.formData();
  const actionType = fd.get("_action");

  if (actionType === "save_settings") {
    const nowEnabled = fd.get("enabled") === "true";

    // Check previous enabled state before updating
    const prev = await ImageSearchSettings.findOne({ shopId: session.shop }).select("enabled totalIndexed").lean();

    await ImageSearchSettings.findOneAndUpdate(
      { shopId: session.shop },
      {
        $set: {
          enabled: nowEnabled,
          maxResults: parseInt(String(fd.get("maxResults") || "8"), 10),
          minScore: parseFloat(String(fd.get("minScore") || "50")) / 100,
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

    const wasEnabled = prev?.enabled ?? false;
    const nothingIndexed = (prev?.totalIndexed ?? 0) === 0;
    if (nowEnabled && (!wasEnabled || nothingIndexed)) {
      // Kick off background sync — fire and forget so save_settings returns fast
      const shop = session.shop;
      const boundGraphql = admin.graphql.bind(admin) as unknown as import("../.server/services/image-index-jobs.service").AdminGraphQL;
      import("../.server/services/image-index-jobs.service")
        .then(({ triggerFullCatalogSyncForShop }) =>
          triggerFullCatalogSyncForShop(shop, boundGraphql),
        )
        .catch((e) => console.error("[ImageSearch] bg sync failed:", e));
    }
  }

  // sync_batch: index ONE page of products, return cursor for next page
  // The UI calls this repeatedly until done=true — each call is fast (< 20s)
  if (actionType === "sync_batch") {
    const { syncBatch } = await import(
      "../.server/services/image-index-jobs.service"
    );
    const cursor = String(fd.get("cursor") || "") || undefined;
    const syncStartedAtRaw = fd.get("syncStartedAt");
    const syncStartedAt = syncStartedAtRaw ? new Date(String(syncStartedAtRaw)) : undefined;

    try {
      const result = await syncBatch(
        admin.graphql.bind(admin) as unknown as import("../.server/services/image-index-jobs.service").AdminGraphQL,
        session.shop,
        cursor,
        syncStartedAt,
      );
      const totalIndexed = await (await import("../.server/models/image-embedding.model"))
        .ImageEmbedding.countDocuments({ shopId: session.shop, isActive: true });
      return json({ success: true, ...result, totalIndexed });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[ImageSearch] sync_batch failed:", msg);
      return json({ error: msg }, { status: 500 });
    }
  }

  if (actionType === "trigger_sync") {
    // Just trigger background sync and return immediately
    const shop = session.shop;
    const boundGraphql = admin.graphql.bind(admin) as unknown as import("../.server/services/image-index-jobs.service").AdminGraphQL;
    import("../.server/services/image-index-jobs.service")
      .then(({ triggerFullCatalogSyncForShop }) =>
        triggerFullCatalogSyncForShop(shop, boundGraphql),
      )
      .catch((e) => console.error("[ImageSearch] bg sync failed:", e));
    return json({ success: true, syncing: true });
  }

  if (actionType === "clear_index") {
    const { clearShopIndex } = await import(
      "../.server/services/image-search.service"
    );
    await clearShopIndex(session.shop);
  }

  return json({ success: true });
};

// ─── Page ─────────────────────────────────────────────────────────

export default function ImageSearchSettingsPage() {
  const { settings: s, totalIndexed, pendingJobs, failedJobs, themeEditorUrl } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const submit = useSubmit();
  const saving = nav.state === "submitting";
  const syncingNow =
    saving &&
    (nav.formData?.get("_action") === "trigger_sync" ||
      nav.formData?.get("_action") === "save_settings");

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
  // Track if enabled was just toggled on this session (to show the setup guide)
  const [justEnabled, setJustEnabled] = useState(false);

  const handleEnableChange = useCallback(
    (val: boolean) => {
      setEnabled(val);
      if (val && !s.enabled) setJustEnabled(true);
      if (!val) setJustEnabled(false);
    },
    [s.enabled],
  );

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
    enabled, maxResults, minScorePct, showPrice, showAddToCart,
    primaryColor, buttonText, modalTitle, submit,
  ]);

  // ── Batched sync — uses useFetcher so Remix handles auth correctly ──
  const batchFetcher = useFetcher<{
    success?: boolean;
    indexed?: number;
    totalIndexed?: number;
    nextCursor?: string;
    done?: boolean;
    error?: string;
    syncing?: boolean;
    syncStartedAt?: string;
  }>();

  const [syncState, setSyncState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [syncIndexed, setSyncIndexed] = useState(0);
  const [syncError, setSyncError] = useState("");

  // Chain batches: whenever a batch finishes, submit the next one
  useEffect(() => {
    if (batchFetcher.state !== "idle") return;
    const data = batchFetcher.data;
    if (!data) return;

    if (data.error) {
      setSyncError(data.error);
      setSyncState("error");
      return;
    }

    if (data.totalIndexed !== undefined) {
      setSyncIndexed(data.totalIndexed);
    }

    if (data.done || !data.nextCursor) {
      setSyncState("done");
    } else {
      // Submit next batch with cursor, carrying syncStartedAt through the chain
      batchFetcher.submit(
        {
          _action: "sync_batch",
          cursor: data.nextCursor,
          ...(data.syncStartedAt ? { syncStartedAt: data.syncStartedAt } : {}),
        },
        { method: "post" },
      );
    }
  }, [batchFetcher.state, batchFetcher.data]);

  const handleTriggerSync = useCallback(() => {
    setSyncIndexed(0);
    setSyncError("");
    setSyncState("running");
    batchFetcher.submit({ _action: "sync_batch" }, { method: "post" });
  }, [batchFetcher]);

  const handleClearIndex = useCallback(() => {
    if (!showClearConfirm) { setShowClearConfirm(true); return; }
    const fd = new FormData();
    fd.append("_action", "clear_index");
    submit(fd, { method: "post" });
    setShowClearConfirm(false);
  }, [showClearConfirm, submit]);

  const lastSynced = s.lastSyncedAt
    ? new Date(s.lastSyncedAt).toLocaleString()
    : "Never";

  // Show the theme setup guide when:
  // 1. Feature is currently enabled AND we just toggled it on, OR
  // 2. Feature is already enabled in DB (so merchant may not have activated in theme yet)
  const showThemeGuide = enabled && (justEnabled || s.enabled);

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

        {/* ── Sync result banner ──────────────────────────────── */}
        {actionData && "indexed" in actionData && (
          <Layout.Section>
            <Banner
              tone={(actionData as any).indexed > 0 ? "success" : "warning"}
              title={
                (actionData as any).indexed > 0
                  ? `Sync complete — ${(actionData as any).indexed} products indexed`
                  : "Sync complete — no products were indexed. Make sure your store has active products with images."
              }
            />
          </Layout.Section>
        )}

        {/* ── Syncing in progress ─────────────────────────────── */}
        {syncingNow && (
          <Layout.Section>
            <Banner tone="info" title="Syncing your product catalog…">
              <Text as="p" variant="bodyMd">
                This may take a minute depending on the size of your catalog.
                Please wait.
              </Text>
            </Banner>
          </Layout.Section>
        )}

        {/* ── Theme Activation Guide (shown when enabled) ─────── */}
        {showThemeGuide && (
          <Layout.Section>
            <Banner
              title="One more step: activate the widget in your theme"
              tone="info"
              action={{
                content: "Open Theme Editor",
                url: themeEditorUrl,
                target: "_blank",
              }}
            >
              <BlockStack gap="200">
                <Text as="p" variant="bodyMd">
                  Image Search is <strong>enabled</strong> in settings. To make
                  the camera button appear on your storefront, you need to
                  activate the widget in your theme once:
                </Text>
                <ol style={{ paddingLeft: 20, margin: 0 }}>
                  <li>Click <strong>Open Theme Editor</strong> below</li>
                  <li>
                    In the left panel, find{" "}
                    <strong>App Embeds</strong> → look for{" "}
                    <strong>Image Search</strong>
                  </li>
                  <li>Toggle it <strong>ON</strong> and click Save</li>
                </ol>
                <Text as="p" tone="subdued" variant="bodySm">
                  You only need to do this once. After that, enabling/disabling
                  here controls whether the widget is visible — no theme changes
                  needed.
                </Text>
              </BlockStack>
            </Banner>
          </Layout.Section>
        )}

        {/* ── Status ─────────────────────────────────────────── */}
        <Layout.AnnotatedSection
          title="Status"
          description="Enable or disable image search. Products are indexed automatically in the background after enabling."
        >
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text variant="headingMd" as="h3">
                  Image Search
                </Text>
                <Badge tone={enabled ? "success" : "critical"}>
                  {enabled ? "Enabled" : "Disabled"}
                </Badge>
              </InlineStack>

              <Checkbox
                label="Enable Image Search on storefront"
                helpText="When disabled, the widget hides itself automatically — no theme changes needed."
                checked={enabled}
                onChange={handleEnableChange}
              />

              <Divider />

              {/* Index Stats */}
              <BlockStack gap="200">
                <InlineStack gap="400" wrap>
                  <Text as="p" variant="bodyMd">
                    <strong>
                      {syncState === "running" || syncState === "done"
                        ? syncIndexed
                        : totalIndexed}
                    </strong>{" "}
                    products indexed
                    {syncState === "running" && (
                      <Badge tone="attention"> Syncing…</Badge>
                    )}
                    {syncState === "done" && (
                      <Badge tone="success"> Done!</Badge>
                    )}
                  </Text>
                </InlineStack>
                {syncState === "error" && (
                  <Text as="p" tone="critical" variant="bodySm">
                    Sync error: {syncError}
                  </Text>
                )}
                <Text as="p" tone="subdued" variant="bodySm">
                  Last synced: {lastSynced}
                </Text>
              </BlockStack>

              <InlineStack gap="300">
                <Button
                  onClick={handleTriggerSync}
                  loading={syncState === "running" || batchFetcher.state !== "idle"}
                  disabled={syncState === "running" || batchFetcher.state !== "idle"}
                >
                  {syncState === "running" || batchFetcher.state !== "idle"
                    ? `Syncing… (${syncIndexed} indexed)`
                    : "Sync Products Now"}
                </Button>
                <Button url={themeEditorUrl} target="_blank" variant="plain">
                  Open Theme Editor →
                </Button>
              </InlineStack>
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
                helpText="Number of similar products to show per search (1–20)"
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
                  Lower = more results (less strict). Higher = more precise matches.
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
                helpText="Tooltip on the camera button"
                autoComplete="off"
              />

              <TextField
                label="Modal Title"
                value={modalTitle}
                onChange={setModalTitle}
                placeholder="Visually Similar Products"
                helpText="Heading shown inside the search results modal"
                autoComplete="off"
              />

              <BlockStack gap="200">
                <TextField
                  label="Primary Color (hex)"
                  value={primaryColor}
                  onChange={setPrimaryColor}
                  placeholder="5C6AC4"
                  helpText="Accent color for the button and result cards"
                  autoComplete="off"
                  prefix="#"
                />
                <Box>
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      background: primaryColor.startsWith("#")
                        ? primaryColor
                        : `#${primaryColor}`,
                      borderRadius: 6,
                      border: "1px solid #e0e0e0",
                      display: "inline-block",
                    }}
                  />
                </Box>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.AnnotatedSection>

        {/* ── How It Works ────────────────────────────────────── */}
        <Layout.AnnotatedSection
          title="How It Works"
          description="Overview of the full setup flow."
        >
          <Card>
            <BlockStack gap="300">
              {[
                { step: "1", text: "Enable Image Search here and save." },
                {
                  step: "2",
                  text: 'Click "Open Theme Editor" \u2192 App Embeds \u2192 toggle Image Search ON \u2192 Save. (One-time only.)',
                },
                {
                  step: "3",
                  text: "Trigger a catalog sync so product images are indexed. This runs automatically every night.",
                },
                {
                  step: "4",
                  text: "Customers will see a 📷 camera button on the storefront. They upload a photo and get visually similar products.",
                },
                {
                  step: "5",
                  text: 'To hide the widget temporarily, uncheck "Enable" here and save \u2014 no theme changes needed.',
                },
              ].map(({ step, text }) => (
                <InlineStack key={step} gap="300" align="start">
                  <Box>
                    <div
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: "50%",
                        background: "#5C6AC4",
                        color: "#fff",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontWeight: 700,
                        fontSize: 13,
                        flexShrink: 0,
                      }}
                    >
                      {step}
                    </div>
                  </Box>
                  <Text as="p" variant="bodyMd">
                    {text}
                  </Text>
                </InlineStack>
              ))}
            </BlockStack>
          </Card>
        </Layout.AnnotatedSection>

        {/* ── Danger Zone ─────────────────────────────────────── */}
        <Layout.AnnotatedSection
          title="Danger Zone"
          description="Remove all indexed embeddings. Image search returns no results until you re-sync."
        >
          <Card>
            <BlockStack gap="400">
              {showClearConfirm && (
                <Banner tone="warning">
                  <p>
                    This deletes all <strong>{totalIndexed}</strong> indexed
                    product embeddings. Are you sure?
                  </p>
                </Banner>
              )}
              <InlineStack gap="300">
                <Button
                  tone="critical"
                  onClick={handleClearIndex}
                  loading={saving && nav.formData?.get("_action") === "clear_index"}
                >
                  {showClearConfirm ? "Yes, Clear Index" : "Clear Index"}
                </Button>
                {showClearConfirm && (
                  <Button onClick={() => setShowClearConfirm(false)}>Cancel</Button>
                )}
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.AnnotatedSection>

      </Layout>
    </Page>
  );
}
