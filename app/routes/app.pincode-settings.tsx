import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useNavigation, useSubmit } from "@remix-run/react";
import {
  Page, Layout, Card, BlockStack, Text, TextField, Button,
  InlineStack, Badge, Divider, Banner, Select, Checkbox,
} from "@shopify/polaris";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import { connectDB } from "../db.server";
import { PincodeSettings, getOrCreatePincodeSettings } from "../.server/models/pincode-settings.model";

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

  const save = useCallback(() => {
    const fd = new FormData();
    fd.set("enabled",                String(enabled));
    fd.set("defaultMinDays",         minDays);
    fd.set("defaultMaxDays",         maxDays);
    fd.set("codPincodes",            cod);
    fd.set("noCodPincodes",          noCod);
    fd.set("nonServiceablePincodes", noService);
    submit(fd, { method: "POST" });
  }, [enabled, minDays, maxDays, cod, noCod, noService, submit]);

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
                <Text variant="headingMd" as="h2">Default Delivery Days</Text>
                <InlineStack gap="300">
                  <TextField label="Min Days" type="number" value={minDays} onChange={setMinDays} autoComplete="off" min="1" />
                  <TextField label="Max Days" type="number" value={maxDays} onChange={setMaxDays} autoComplete="off" min="1" />
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

            <InlineStack align="end">
              <Button variant="primary" onClick={save} loading={saving}>Save Settings</Button>
            </InlineStack>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
