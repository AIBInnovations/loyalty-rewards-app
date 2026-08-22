import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useNavigation, useSubmit, useFetcher } from "@remix-run/react";
import {
  Page, Layout, Card, BlockStack, Text, TextField, Button,
  InlineStack, Badge, Divider, Banner, Select, Checkbox, InlineGrid,
} from "@shopify/polaris";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import { connectDB } from "../db.server";
import { PincodeSettings, getOrCreatePincodeSettings } from "../.server/models/pincode-settings.model";
import { PINCODE_ZONES } from "../pincode-zones";
import { encryptShiprocketSecret } from "../.server/services/shiprocket.service";
import { testShiprocketConnection } from "../.server/services/eta-engine.service";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();
  const s = await getOrCreatePincodeSettings(session.shop);
  const json_ = JSON.parse(JSON.stringify(s));
  // Never send the encrypted password/token blobs to the client — the UI
  // only needs to know a password is already on file, not its value.
  delete json_.shiprocketPasswordEncrypted;
  delete json_.shiprocketTokenEncrypted;
  return json({ settings: json_, hasShiprocketPassword: Boolean(s.shiprocketPasswordEncrypted) });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  await connectDB();
  const fd = await request.formData();

  if (fd.get("intent") === "test-shiprocket-connection") {
    // Save whatever credentials/pickup pincode are currently in the form
    // first, so "Test Connection" always tests what the merchant is
    // actually looking at rather than whatever was last persisted.
    const email = String(fd.get("shiprocketEmail") || "").trim();
    const newPassword = String(fd.get("shiprocketPassword") || "");
    const pickupPincode = String(fd.get("pickupPincode") || "").trim().slice(0, 6);
    await PincodeSettings.findOneAndUpdate(
      { shopId: session.shop },
      {
        $set: {
          shiprocketEmail: email,
          pickupPincode,
          ...(newPassword ? { shiprocketPasswordEncrypted: encryptShiprocketSecret(newPassword) } : {}),
        },
      },
      { upsert: true },
    );
    const result = await testShiprocketConnection(session.shop, admin);
    return json(result);
  }

  // A blank password field means "leave the stored one alone" — the admin
  // UI never receives the real value back, so an empty submit is not
  // meaningfully different from "unchanged", not "clear it".
  const newPassword = String(fd.get("shiprocketPassword") || "");
  const passwordUpdate = newPassword
    ? { shiprocketPasswordEncrypted: encryptShiprocketSecret(newPassword) }
    : {};

  const workingDaysRaw = String(fd.get("workingDays") || "");
  const workingDays = workingDaysRaw
    ? workingDaysRaw.split(",").map((d) => parseInt(d, 10)).filter((d) => Number.isFinite(d) && d >= 0 && d <= 6)
    : [1, 2, 3, 4, 5, 6];

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
        etaMode:        fd.get("etaMode") === "shiprocket" ? "shiprocket" : "manual",
        pickupPincode:  String(fd.get("pickupPincode") || "").trim().slice(0, 6),
        handlingDays:   Math.min(14, Math.max(0, parseInt(String(fd.get("handlingDays") || "1"), 10) || 0)),
        cutoffHour:     Math.min(23, Math.max(0, parseInt(String(fd.get("cutoffHour") || "18"), 10) || 0)),
        workingDays,
        shiprocketEmail: String(fd.get("shiprocketEmail") || "").trim().slice(0, 120),
        ...passwordUpdate,
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
  const { settings: s, hasShiprocketPassword } = useLoaderData<typeof loader>();
  const nav    = useNavigation();
  const submit = useSubmit();
  const saving = nav.state === "submitting";
  const testFetcher = useFetcher<{ success: boolean; message: string }>();
  const testing = testFetcher.state !== "idle";

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

  const [etaMode, setEtaMode] = useState<"manual" | "shiprocket">(s.etaMode || "manual");
  const [pickupPincode, setPickupPincode] = useState(s.pickupPincode || "");
  const [handlingDays, setHandlingDays] = useState(String(s.handlingDays ?? 1));
  const [cutoffHour, setCutoffHour] = useState(String(s.cutoffHour ?? 18));
  const [workingDays, setWorkingDays] = useState<number[]>(s.workingDays?.length ? s.workingDays : [1, 2, 3, 4, 5, 6]);
  const [shiprocketEmail, setShiprocketEmail] = useState(s.shiprocketEmail || "");
  const [shiprocketPassword, setShiprocketPassword] = useState("");

  const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const toggleWorkingDay = useCallback((day: number) => {
    setWorkingDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()));
  }, []);

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
    fd.set("etaMode", etaMode);
    fd.set("pickupPincode", pickupPincode);
    fd.set("handlingDays", handlingDays);
    fd.set("cutoffHour", cutoffHour);
    fd.set("workingDays", workingDays.join(","));
    fd.set("shiprocketEmail", shiprocketEmail);
    fd.set("shiprocketPassword", shiprocketPassword);
    fd.set("headingText", headingText);
    fd.set("bgColor", bgColor);
    fd.set("buttonColor", buttonColor);
    fd.set("buttonTextColor", buttonTextColor);
    fd.set("buttonSize", buttonSize);
    fd.set("sectionWidth", sectionWidth);
    fd.set("sectionHeight", sectionHeight);
    submit(fd, { method: "POST" });
    // The password field is intentionally cleared after every save — it's
    // never sent back by the loader, so keeping stale text in the input
    // would misleadingly suggest it still needs saving.
    if (shiprocketPassword) setShiprocketPassword("");
  }, [
    enabled, minDays, maxDays, cod, noCod, noService, buildStateDeliveryDays, submit,
    etaMode, pickupPincode, handlingDays, cutoffHour, workingDays, shiprocketEmail, shiprocketPassword,
    headingText, bgColor, buttonColor, buttonTextColor, buttonSize, sectionWidth, sectionHeight,
  ]);

  const testConnection = useCallback(() => {
    const fd = new FormData();
    fd.set("intent", "test-shiprocket-connection");
    fd.set("shiprocketEmail", shiprocketEmail);
    fd.set("shiprocketPassword", shiprocketPassword);
    fd.set("pickupPincode", pickupPincode);
    // useFetcher (not raw fetch) so this also revalidates the route
    // loader — the Connected/Not Connected badge below reads s.shiprocketConnected,
    // which needs to reflect the just-updated DB state.
    testFetcher.submit(fd, { method: "POST" });
    if (shiprocketPassword) setShiprocketPassword("");
  }, [shiprocketEmail, shiprocketPassword, pickupPincode, testFetcher]);

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
                <Text variant="headingMd" as="h2">Estimated Delivery Mode</Text>
                <Select
                  label="Delivery estimate source"
                  options={[
                    { label: "Manual (rules below)", value: "manual" },
                    { label: "Shiprocket (automatic courier ETA)", value: "shiprocket" },
                  ]}
                  value={etaMode}
                  onChange={(v) => { setEtaMode(v === "shiprocket" ? "shiprocket" : "manual"); save(); }}
                  helpText="Shiprocket mode automatically falls back to the manual rules below if Shiprocket is unreachable or a pincode has no courier coverage — the widget always shows an answer."
                />
              </BlockStack>
            </Card>

            {etaMode === "shiprocket" && (
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between">
                    <Text variant="headingMd" as="h2">Shiprocket Integration</Text>
                    <Badge tone={s.shiprocketConnected ? "success" : "attention"}>
                      {s.shiprocketConnected ? "Connected" : "Not Connected"}
                    </Badge>
                  </InlineStack>

                  {s.shiprocketLastError && (
                    <Banner tone="critical">{s.shiprocketLastError}</Banner>
                  )}
                  {testFetcher.data && (
                    <Banner tone={testFetcher.data.success ? "success" : "critical"}>{testFetcher.data.message}</Banner>
                  )}

                  <InlineGrid columns={2} gap="300">
                    <TextField
                      label="Shiprocket Email"
                      value={shiprocketEmail}
                      onChange={setShiprocketEmail}
                      onBlur={save}
                      autoComplete="off"
                      type="email"
                    />
                    <TextField
                      label="Shiprocket Password"
                      value={shiprocketPassword}
                      onChange={setShiprocketPassword}
                      onBlur={save}
                      autoComplete="off"
                      type="password"
                      placeholder={hasShiprocketPassword ? "•••••••• (saved — leave blank to keep)" : ""}
                      helpText={hasShiprocketPassword ? "A password is already saved. Leave blank to keep it." : undefined}
                    />
                  </InlineGrid>

                  <TextField
                    label="Pickup Pincode"
                    value={pickupPincode}
                    onChange={setPickupPincode}
                    onBlur={save}
                    autoComplete="off"
                    maxLength={6}
                    helpText="Your warehouse/origin pincode, used to check courier serviceability to the customer's pincode."
                  />

                  <InlineStack align="start">
                    <Button onClick={testConnection} loading={testing}>Test Connection</Button>
                  </InlineStack>

                  <Divider />

                  <Text variant="headingSm" as="h3">Handling &amp; Cut-off</Text>
                  <InlineGrid columns={2} gap="300">
                    <TextField
                      label="Handling Time (days)"
                      type="number"
                      value={handlingDays}
                      onChange={setHandlingDays}
                      onBlur={save}
                      autoComplete="off"
                      min="0"
                      helpText="Processing days added before the courier's own transit time."
                    />
                    <TextField
                      label="Order Cut-off Hour (0–23)"
                      type="number"
                      value={cutoffHour}
                      onChange={setCutoffHour}
                      onBlur={save}
                      autoComplete="off"
                      min="0"
                      max="23"
                      helpText="Orders placed after this hour (in your store's timezone) count as next working day."
                    />
                  </InlineGrid>

                  <Text as="p" variant="bodyMd">Working Days</Text>
                  <InlineStack gap="300">
                    {WEEKDAY_LABELS.map((label, day) => (
                      <Checkbox
                        key={day}
                        label={label}
                        checked={workingDays.includes(day)}
                        onChange={() => { toggleWorkingDay(day); save(); }}
                      />
                    ))}
                  </InlineStack>
                </BlockStack>
              </Card>
            )}

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
