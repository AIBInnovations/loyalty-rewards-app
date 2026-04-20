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
  Checkbox,
  Select,
  InlineGrid,
  Banner,
  Box,
  Button,
  InlineStack,
} from "@shopify/polaris";
import { useState, useCallback } from "react";
import { useActionData } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { connectDB } from "../db.server";
import {
  getOrCreateSalesPopSettings,
  SalesPopSettings,
} from "../.server/models/sales-pop-settings.model";
import { SalesPopEvent } from "../.server/models/sales-pop-event.model";
import { seedRecentOrders } from "../.server/services/sales-pop.service";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();
  const settings = await getOrCreateSalesPopSettings(session.shop);
  const eventCount = await SalesPopEvent.countDocuments({
    shopId: session.shop,
    isActive: true,
  });
  const latest = await SalesPopEvent.findOne({ shopId: session.shop })
    .sort({ purchasedAt: -1 })
    .select("purchasedAt")
    .lean();
  return json({
    settings: JSON.parse(JSON.stringify(settings)),
    eventCount,
    latestEventAt: latest?.purchasedAt
      ? new Date(latest.purchasedAt).toISOString()
      : null,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  await connectDB();
  const data = Object.fromEntries(await request.formData());

  if (data._intent === "seed") {
    const result = await seedRecentOrders(
      session.shop,
      admin as any,
      Number(data.daysBack) || 7,
      Number(data.maxOrders) || 50,
    );
    return json({ success: true, seed: result });
  }

  await SalesPopSettings.findOneAndUpdate(
    { shopId: session.shop },
    {
      $set: {
        enabled: data.enabled === "true",
        messageTemplate:
          (data.messageTemplate as string) ||
          "{name} from {location} just bought {product}",
        ctaLabel: (data.ctaLabel as string) || "View Product",
        showCta: data.showCta === "true",
        showThumbnail: data.showThumbnail === "true",
        nameStyle: (data.nameStyle as string) || "masked",
        locationStyle: (data.locationStyle as string) || "city",
        genericFallback: (data.genericFallback as string) || "Someone",
        showOnProduct: data.showOnProduct === "true",
        showOnCollection: data.showOnCollection === "true",
        showOnHome: data.showOnHome === "true",
        matchMode: (data.matchMode as string) || "collection",
        excludedTags: String(data.excludedTags || "")
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        initialDelaySeconds: Number(data.initialDelaySeconds) || 8,
        minIntervalSeconds: Number(data.minIntervalSeconds) || 20,
        maxIntervalSeconds: Number(data.maxIntervalSeconds) || 35,
        maxPerSession: Number(data.maxPerSession) || 3,
        minOrderAgeMinutes: Number(data.minOrderAgeMinutes) || 5,
        freshnessHours: Number(data.freshnessHours) || 72,
        position: (data.position as string) || "bottom-left",
        accentColor: (data.accentColor as string) || "#5C6AC4",
        bgColor: (data.bgColor as string) || "#ffffff",
        textColor: (data.textColor as string) || "#1a1a1a",
        borderRadius: Number(data.borderRadius) || 12,
        showOnMobile: data.showOnMobile === "true",
      },
    },
    { upsert: true },
  );
  return json({ success: true });
};

export default function SalesPopSettingsPage() {
  const { settings, eventCount, latestEventAt } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const nav = useNavigation();

  const [s, setS] = useState({
    ...settings,
    excludedTags: Array.isArray(settings.excludedTags)
      ? settings.excludedTags.join(", ")
      : "",
  });
  const u =
    (f: string) =>
    (v: string | boolean) =>
      setS((p: any) => ({ ...p, [f]: v }));

  const save = useCallback(() => {
    const fd = new FormData();
    Object.entries(s).forEach(([k, v]) => {
      if (k !== "_id" && k !== "__v" && k !== "shopId") fd.set(k, String(v));
    });
    submit(fd, { method: "post" });
  }, [s, submit]);

  const seed = useCallback(() => {
    const fd = new FormData();
    fd.set("_intent", "seed");
    fd.set("daysBack", "7");
    fd.set("maxOrders", "50");
    submit(fd, { method: "post" });
  }, [submit]);

  const seedResult = actionData && (actionData as any).seed;

  const preview = buildPreview(s);

  return (
    <Page
      title="Sales Pop"
      primaryAction={{
        content: "Save",
        onAction: save,
        loading: nav.state === "submitting",
      }}
      backAction={{ content: "Dashboard", url: "/app" }}
    >
      <BlockStack gap="500">
        <Layout>
          <Layout.AnnotatedSection
            title="Status"
            description="Enable, then backfill recent orders so the widget has a feed to rotate through."
          >
            <Card>
              <BlockStack gap="400">
                <Checkbox
                  label="Enable Sales Pop"
                  checked={s.enabled}
                  onChange={u("enabled")}
                />
                <InlineStack gap="200" align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <Text as="p" variant="bodyMd">
                      Events in feed: <b>{eventCount}</b>
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {latestEventAt
                        ? `Most recent: ${new Date(latestEventAt).toLocaleString()}`
                        : "No events yet — orders placed after enabling will appear here."}
                    </Text>
                  </BlockStack>
                  <Button
                    onClick={seed}
                    loading={
                      nav.state === "submitting" &&
                      nav.formData?.get("_intent") === "seed"
                    }
                  >
                    Seed from last 7 days
                  </Button>
                </InlineStack>
                {seedResult && (
                  <Banner tone="success">
                    <p>
                      Scanned {seedResult.scanned} orders, added{" "}
                      {seedResult.ingested} new events.
                    </p>
                  </Banner>
                )}
                {eventCount === 0 && (
                  <Banner tone="warning">
                    <p>
                      The widget stays hidden when no eligible events exist.
                      Seed recent orders above, or wait for new paid orders to
                      flow in via the webhook.
                    </p>
                  </Banner>
                )}
              </BlockStack>
            </Card>
          </Layout.AnnotatedSection>

          <Layout.AnnotatedSection
            title="Preview"
            description="Live preview of the notification using your current settings."
          >
            <Card>
              <Box
                padding="400"
                background="bg-surface-secondary"
                borderRadius="300"
              >
                <div
                  style={{
                    display: "flex",
                    gap: 12,
                    alignItems: "center",
                    background: s.bgColor,
                    color: s.textColor,
                    padding: 12,
                    borderRadius: Number(s.borderRadius) || 12,
                    boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
                    border: `1px solid ${s.accentColor}22`,
                    maxWidth: 360,
                  }}
                >
                  {s.showThumbnail && (
                    <div
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 8,
                        background: s.accentColor + "22",
                        flexShrink: 0,
                      }}
                    />
                  )}
                  <div style={{ fontSize: 13, lineHeight: 1.4 }}>
                    <div>{preview.message}</div>
                    <div style={{ opacity: 0.6, fontSize: 11, marginTop: 2 }}>
                      a few minutes ago
                    </div>
                  </div>
                </div>
              </Box>
            </Card>
          </Layout.AnnotatedSection>

          <Layout.AnnotatedSection
            title="Message"
            description="Use {name}, {location}, {product} as placeholders."
          >
            <Card>
              <BlockStack gap="400">
                <TextField
                  label="Message Template"
                  value={s.messageTemplate}
                  onChange={u("messageTemplate")}
                  autoComplete="off"
                  helpText="Example: {name} from {location} just bought {product}"
                />
                <InlineGrid columns={2} gap="300">
                  <Checkbox
                    label="Show product thumbnail"
                    checked={s.showThumbnail}
                    onChange={u("showThumbnail")}
                  />
                  <Checkbox
                    label="Show CTA button"
                    checked={s.showCta}
                    onChange={u("showCta")}
                  />
                </InlineGrid>
                <TextField
                  label="CTA Label"
                  value={s.ctaLabel}
                  onChange={u("ctaLabel")}
                  autoComplete="off"
                />
              </BlockStack>
            </Card>
          </Layout.AnnotatedSection>

          <Layout.AnnotatedSection
            title="Privacy"
            description="Control how much customer identity is exposed."
          >
            <Card>
              <BlockStack gap="400">
                <InlineGrid columns={2} gap="300">
                  <Select
                    label="Name style"
                    options={[
                      { label: "Masked (R****)", value: "masked" },
                      { label: "Generic (Someone)", value: "generic" },
                      { label: "First name", value: "first_name" },
                    ]}
                    value={s.nameStyle}
                    onChange={u("nameStyle")}
                  />
                  <Select
                    label="Location style"
                    options={[
                      { label: "City", value: "city" },
                      { label: "State / Province", value: "state" },
                      { label: "Country", value: "country" },
                      { label: "Hidden", value: "hidden" },
                    ]}
                    value={s.locationStyle}
                    onChange={u("locationStyle")}
                  />
                </InlineGrid>
                <TextField
                  label="Generic fallback"
                  value={s.genericFallback}
                  onChange={u("genericFallback")}
                  autoComplete="off"
                  helpText="Shown when no first name is available."
                />
                <TextField
                  label="Excluded customer tags"
                  value={s.excludedTags}
                  onChange={u("excludedTags")}
                  autoComplete="off"
                  helpText="Comma-separated, e.g. staff, wholesale"
                />
              </BlockStack>
            </Card>
          </Layout.AnnotatedSection>

          <Layout.AnnotatedSection
            title="Targeting"
            description="Where and how to match purchase events to pages."
          >
            <Card>
              <BlockStack gap="400">
                <InlineGrid columns={3} gap="300">
                  <Checkbox
                    label="Product pages"
                    checked={s.showOnProduct}
                    onChange={u("showOnProduct")}
                  />
                  <Checkbox
                    label="Collection pages"
                    checked={s.showOnCollection}
                    onChange={u("showOnCollection")}
                  />
                  <Checkbox
                    label="Home page"
                    checked={s.showOnHome}
                    onChange={u("showOnHome")}
                  />
                </InlineGrid>
                <Select
                  label="Match mode"
                  options={[
                    { label: "Current product first", value: "product" },
                    {
                      label: "Current collection, then global",
                      value: "collection",
                    },
                    { label: "Global store feed", value: "global" },
                  ]}
                  value={s.matchMode}
                  onChange={u("matchMode")}
                />
              </BlockStack>
            </Card>
          </Layout.AnnotatedSection>

          <Layout.AnnotatedSection
            title="Timing"
            description="Control how often notifications appear."
          >
            <Card>
              <BlockStack gap="400">
                <InlineGrid columns={2} gap="300">
                  <TextField
                    label="Initial delay (sec)"
                    type="number"
                    value={String(s.initialDelaySeconds)}
                    onChange={(v) =>
                      setS((p: any) => ({
                        ...p,
                        initialDelaySeconds: Number(v),
                      }))
                    }
                    autoComplete="off"
                  />
                  <TextField
                    label="Max per session"
                    type="number"
                    value={String(s.maxPerSession)}
                    onChange={(v) =>
                      setS((p: any) => ({ ...p, maxPerSession: Number(v) }))
                    }
                    autoComplete="off"
                  />
                  <TextField
                    label="Min interval (sec)"
                    type="number"
                    value={String(s.minIntervalSeconds)}
                    onChange={(v) =>
                      setS((p: any) => ({
                        ...p,
                        minIntervalSeconds: Number(v),
                      }))
                    }
                    autoComplete="off"
                  />
                  <TextField
                    label="Max interval (sec)"
                    type="number"
                    value={String(s.maxIntervalSeconds)}
                    onChange={(v) =>
                      setS((p: any) => ({
                        ...p,
                        maxIntervalSeconds: Number(v),
                      }))
                    }
                    autoComplete="off"
                  />
                  <TextField
                    label="Min order age (min)"
                    type="number"
                    value={String(s.minOrderAgeMinutes)}
                    onChange={(v) =>
                      setS((p: any) => ({
                        ...p,
                        minOrderAgeMinutes: Number(v),
                      }))
                    }
                    helpText="Hide orders newer than this"
                    autoComplete="off"
                  />
                  <TextField
                    label="Freshness window (hours)"
                    type="number"
                    value={String(s.freshnessHours)}
                    onChange={(v) =>
                      setS((p: any) => ({ ...p, freshnessHours: Number(v) }))
                    }
                    helpText="Hide orders older than this"
                    autoComplete="off"
                  />
                </InlineGrid>
              </BlockStack>
            </Card>
          </Layout.AnnotatedSection>

          <Layout.AnnotatedSection
            title="Appearance"
            description="Position, colors, and look."
          >
            <Card>
              <BlockStack gap="400">
                <InlineGrid columns={2} gap="300">
                  <Select
                    label="Position"
                    options={[
                      { label: "Bottom left", value: "bottom-left" },
                      { label: "Bottom right", value: "bottom-right" },
                      { label: "Top left", value: "top-left" },
                      { label: "Top right", value: "top-right" },
                    ]}
                    value={s.position}
                    onChange={u("position")}
                  />
                  <TextField
                    label="Border radius (px)"
                    type="number"
                    value={String(s.borderRadius)}
                    onChange={(v) =>
                      setS((p: any) => ({ ...p, borderRadius: Number(v) }))
                    }
                    autoComplete="off"
                  />
                  <TextField
                    label="Background color"
                    value={s.bgColor}
                    onChange={u("bgColor")}
                    autoComplete="off"
                  />
                  <TextField
                    label="Text color"
                    value={s.textColor}
                    onChange={u("textColor")}
                    autoComplete="off"
                  />
                  <TextField
                    label="Accent color"
                    value={s.accentColor}
                    onChange={u("accentColor")}
                    autoComplete="off"
                  />
                </InlineGrid>
                <Checkbox
                  label="Show on mobile devices"
                  checked={s.showOnMobile}
                  onChange={u("showOnMobile")}
                />
              </BlockStack>
            </Card>
          </Layout.AnnotatedSection>
        </Layout>
        <Banner tone="info">
          <p>
            Enable "Sales Pop" in Theme Editor → App embeds after saving.
            Events are created automatically from paid orders.
          </p>
        </Banner>
      </BlockStack>
    </Page>
  );
}

function buildPreview(s: any): { message: string } {
  const sampleName =
    s.nameStyle === "first_name"
      ? "Rahul"
      : s.nameStyle === "generic"
        ? s.genericFallback || "Someone"
        : "R****";
  const sampleLocation =
    s.locationStyle === "hidden"
      ? ""
      : s.locationStyle === "country"
        ? "India"
        : s.locationStyle === "state"
          ? "Maharashtra"
          : "Mumbai";
  const message = String(s.messageTemplate || "")
    .replace(/\{name\}/g, sampleName)
    .replace(/\{location\}/g, sampleLocation || "nearby")
    .replace(/\{product\}/g, "Classic Tee");
  return { message };
}
