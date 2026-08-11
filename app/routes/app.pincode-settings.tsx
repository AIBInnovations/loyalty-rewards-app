import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useNavigation, useSubmit } from "@remix-run/react";
import {
  Page, Layout, Card, BlockStack, Text, TextField, Button,
  InlineStack, Badge, Divider, Banner, Select, Checkbox, InlineGrid,
} from "@shopify/polaris";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import { connectDB } from "../db.server";
import { PincodeSettings, getOrCreatePincodeSettings } from "../.server/models/pincode-settings.model";
import { PINCODE_ZONES } from "../pincode-zones";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();
  const s = await getOrCreatePincodeSettings(session.shop);
  return json({ settings: JSON.parse(JSON.stringify(s)) });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();
  const fd = await request.formData();
  await PincodeSettings.findOneAndUpdate(
    { shopId: session.shop },
    {
      $set: {
        enabled:                fd.get("enabled") === "true",
        defaultMinDays:         parseInt(String(fd.get("defaultMinDays") || "3"), 10),
        defaultMaxDays:         parseInt(String(fd.get("defaultMaxDays") || "7"), 10),
        codPincodes:            String(fd.get("codPincodes") || "").split("\n").map((p) => p.trim()).filter(Boolean),
        noCodPincodes:          String(fd.get("noCodPincodes") || "").split("\n").map((p) => p.trim()).filter(Boolean),
        nonServiceablePincodes: String(fd.get("nonServiceablePincodes") || "").split("\n").map((p) => p.trim()).filter(Boolean),
        stateDeliveryDays: (() => {
          let parsed: { zoneKey?: string; minDays: number; maxDays: number }[] = [];
          try { parsed = JSON.parse(String(fd.get("stateDeliveryDays") || "[]")); } catch { parsed = []; }
          const validKeys = new Set(PINCODE_ZONES.map((z) => z.key));
          return parsed.filter(
            (o) =>
              o.zoneKey && validKeys.has(o.zoneKey) &&
              Number.isFinite(o.minDays) && Number.isFinite(o.maxDays) &&
              o.minDays >= 0 && o.maxDays >= o.minDays,
          );
        })(),
        headingText:     String(fd.get("headingText") || "").slice(0, 60) || "📦 Check Delivery & COD",
        bgColor:         String(fd.get("bgColor") || "").slice(0, 20),
        buttonColor:     String(fd.get("buttonColor") || "").slice(0, 20),
        buttonTextColor: String(fd.get("buttonTextColor") || "").slice(0, 20),
        buttonSize:      ["small", "medium", "large"].includes(String(fd.get("buttonSize"))) ? String(fd.get("buttonSize")) : "medium",
        sectionWidth:    String(fd.get("sectionWidth") || "").slice(0, 20),
        sectionHeight:   String(fd.get("sectionHeight") || "").slice(0, 20),
      },
    },
    { upsert: true },
  );
  return json({ success: true });
};

export default function PincodeSettingsPage() {
  const { settings: s } = useLoaderData<typeof loader>();
  const nav    = useNavigation();
  const submit = useSubmit();
  const saving = nav.state === "submitting";

  const [enabled, setEnabled]   = useState(s.enabled);
  const [minDays, setMinDays]   = useState(String(s.defaultMinDays));
  const [maxDays, setMaxDays]   = useState(String(s.defaultMaxDays));
  const [cod, setCod]           = useState((s.codPincodes || []).join("\n"));
  const [noCod, setNoCod]       = useState((s.noCodPincodes || []).join("\n"));
  const [noService, setNoService] = useState((s.nonServiceablePincodes || []).join("\n"));
  const [headingText, setHeadingText] = useState(s.headingText || "📦 Check Delivery & COD");
  const [bgColor, setBgColor] = useState(s.bgColor || "");
  const [buttonColor, setButtonColor] = useState(s.buttonColor || "");
  const [buttonTextColor, setButtonTextColor] = useState(s.buttonTextColor || "");
  const [buttonSize, setButtonSize] = useState(s.buttonSize || "medium");
  const [sectionWidth, setSectionWidth] = useState(s.sectionWidth || "");
  const [sectionHeight, setSectionHeight] = useState(s.sectionHeight || "");

  // One row per fixed PIN-code zone (state group). The zone's pincode
  // range is fixed by India Post prefixes — merchant only sets the days.
  const initialZoneDays: Record<string, { min: string; max: string }> = {};
  for (const o of s.stateDeliveryDays || []) {
    initialZoneDays[o.zoneKey] = { min: String(o.minDays), max: String(o.maxDays) };
  }
  const [zoneDays, setZoneDays] = useState(initialZoneDays);

  const updateZoneDay = useCallback((zoneKey: string, field: "min" | "max", value: string) => {
    setZoneDays((prev) => ({ ...prev, [zoneKey]: { ...prev[zoneKey], [field]: value } }));
  }, []);

  const buildStateDeliveryDays = useCallback(
    (source = zoneDays) =>
      Object.entries(source)
        .map(([zoneKey, v]) => ({ zoneKey, minDays: parseInt(v.min, 10), maxDays: parseInt(v.max, 10) }))
        .filter((o) => Number.isFinite(o.minDays) && Number.isFinite(o.maxDays) && o.minDays >= 0 && o.maxDays >= o.minDays),
    [zoneDays],
  );

  const save = useCallback(() => {
    const fd = new FormData();
    fd.set("enabled",                String(enabled));
    fd.set("defaultMinDays",         minDays);
    fd.set("defaultMaxDays",         maxDays);
    fd.set("codPincodes",            cod);
    fd.set("noCodPincodes",          noCod);
    fd.set("nonServiceablePincodes", noService);
    fd.set("stateDeliveryDays", JSON.stringify(buildStateDeliveryDays()));
    fd.set("headingText", headingText);
    fd.set("bgColor", bgColor);
    fd.set("buttonColor", buttonColor);
    fd.set("buttonTextColor", buttonTextColor);
    fd.set("buttonSize", buttonSize);
    fd.set("sectionWidth", sectionWidth);
    fd.set("sectionHeight", sectionHeight);
    submit(fd, { method: "POST" });
  }, [
    enabled, minDays, maxDays, cod, noCod, noService, buildStateDeliveryDays, submit,
    headingText, bgColor, buttonColor, buttonTextColor, buttonSize, sectionWidth, sectionHeight,
  ]);

  return (
    <Page title="Pincode Delivery Estimator" backAction={{ url: "/app" }}>
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <Text variant="headingMd" as="h2">Pincode Estimator</Text>
                  <Badge tone={enabled ? "success" : "critical"}>{enabled ? "Enabled" : "Disabled"}</Badge>
                </InlineStack>
                <Checkbox label="Enable Pincode Delivery Estimator" checked={enabled} onChange={setEnabled} />
                <Banner tone="info">
                  Add this widget to your product pages via the Theme Editor. Customers enter their pincode to see estimated delivery dates and COD availability.
                </Banner>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">Appearance</Text>
                <TextField
                  label="Heading text"
                  value={headingText}
                  onChange={setHeadingText}
                  onBlur={save}
                  autoComplete="off"
                  maxLength={60}
                  helpText="Shown above the pincode input, e.g. '📦 Check Delivery & COD'."
                />
                <InlineGrid columns={3} gap="300">
                  <TextField
                    label="Background color"
                    value={bgColor}
                    onChange={setBgColor}
                    onBlur={save}
                    placeholder="#ffffff"
                    autoComplete="off"
                  />
                  <TextField
                    label="Button color"
                    value={buttonColor}
                    onChange={setButtonColor}
                    onBlur={save}
                    placeholder="#1a1a1a"
                    autoComplete="off"
                  />
                  <TextField
                    label="Button text color"
                    value={buttonTextColor}
                    onChange={setButtonTextColor}
                    onBlur={save}
                    placeholder="#ffffff"
                    autoComplete="off"
                  />
                </InlineGrid>
                <InlineGrid columns={3} gap="300">
                  <Select
                    label="Button size"
                    options={[
                      { label: "Small", value: "small" },
                      { label: "Medium", value: "medium" },
                      { label: "Large", value: "large" },
                    ]}
                    value={buttonSize}
                    onChange={(v) => { setButtonSize(v); save(); }}
                  />
                  <TextField
                    label="Section width"
                    value={sectionWidth}
                    onChange={setSectionWidth}
                    onBlur={save}
                    placeholder="100%"
                    helpText="e.g. 100%, 420px. Leave blank for default."
                    autoComplete="off"
                  />
                  <TextField
                    label="Section height"
                    value={sectionHeight}
                    onChange={setSectionHeight}
                    onBlur={save}
                    placeholder="auto"
                    helpText="e.g. auto, 160px. Leave blank for default."
                    autoComplete="off"
                  />
                </InlineGrid>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">Default Delivery Days</Text>
                <InlineStack gap="300">
                  <TextField label="Min Days" type="number" value={minDays} onChange={setMinDays} onBlur={save} autoComplete="off" min="1" />
                  <TextField label="Max Days" type="number" value={maxDays} onChange={setMaxDays} onBlur={save} autoComplete="off" min="1" />
                </InlineStack>
                <Text variant="bodySm" as="p" tone="subdued">
                  These apply to all pincodes not in the lists below.
                </Text>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">Pincode Rules</Text>
                <Text variant="bodySm" as="p" tone="subdued">
                  Enter one pincode per line. Leave empty to apply default rules to all pincodes.
                </Text>
                <TextField
                  label="COD Available Pincodes (override — these get COD even if not in default)"
                  value={cod}
                  onChange={setCod}
                  multiline={6}
                  autoComplete="off"
                  placeholder={"110001\n400001\n560001"}
                  helpText="Leave empty to allow COD everywhere by default."
                />
                <TextField
                  label="NO COD Pincodes (prepaid only)"
                  value={noCod}
                  onChange={setNoCod}
                  multiline={6}
                  autoComplete="off"
                  placeholder={"302001\n302002"}
                />
                <TextField
                  label="Non-Serviceable Pincodes (cannot deliver)"
                  value={noService}
                  onChange={setNoService}
                  multiline={6}
                  autoComplete="off"
                  placeholder={"799999\n799998"}
                />
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">Delivery Days by State</Text>
                <Text variant="bodySm" as="p" tone="subdued">
                  Each row is a fixed PIN code range covering the listed states. When a customer
                  enters a pincode, we match it to its range and show these days. Leave a row
                  blank to use the default Min/Max Days above for that range.
                </Text>

                <BlockStack gap="300">
                  {PINCODE_ZONES.map((zone, i) => (
                    <BlockStack key={zone.key} gap="150">
                      {i > 0 && <Divider />}
                      <Text as="span" variant="bodyMd" fontWeight="semibold">
                        {zone.key} — {zone.label}
                      </Text>
                      <InlineStack gap="300" blockAlign="end">
                        <TextField
                          label="Min Days"
                          type="number"
                          value={zoneDays[zone.key]?.min || ""}
                          onChange={(v) => updateZoneDay(zone.key, "min", v)}
                          onBlur={save}
                          autoComplete="off"
                          min="0"
                        />
                        <TextField
                          label="Max Days"
                          type="number"
                          value={zoneDays[zone.key]?.max || ""}
                          onChange={(v) => updateZoneDay(zone.key, "max", v)}
                          onBlur={save}
                          autoComplete="off"
                          min="0"
                        />
                      </InlineStack>
                    </BlockStack>
                  ))}
                </BlockStack>
              </BlockStack>
            </Card>

            <InlineStack align="end">
              <Button variant="primary" onClick={save} loading={saving}>Save Settings</Button>
            </InlineStack>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
