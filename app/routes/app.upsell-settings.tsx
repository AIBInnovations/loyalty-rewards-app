import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useNavigation, useSubmit } from "@remix-run/react";
import {
  Page, Layout, Card, BlockStack, Text, TextField, Button,
  InlineStack, Badge, Checkbox, RangeSlider, ColorPicker, hsbToHex, hexToRgb,
} from "@shopify/polaris";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import { connectDB } from "../db.server";
import { UpsellSettings, getOrCreateUpsellSettings } from "../.server/models/upsell-settings.model";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();
  const s = await getOrCreateUpsellSettings(session.shop);
  return json({ settings: JSON.parse(JSON.stringify(s)) });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();
  const fd = await request.formData();
  await UpsellSettings.findOneAndUpdate(
    { shopId: session.shop },
    {
      $set: {
        enabled:         fd.get("enabled") === "true",
        productHandle:   String(fd.get("productHandle") || ""),
        discountPercent: parseInt(String(fd.get("discountPercent") || "10"), 10),
        headline:        String(fd.get("headline") || ""),
        buttonText:      String(fd.get("buttonText") || ""),
        primaryColor:    String(fd.get("primaryColor") || "#5C6AC4"),
      },
    },
    { upsert: true },
  );
  return json({ success: true });
};

export default function UpsellSettingsPage() {
  const { settings: s } = useLoaderData<typeof loader>();
  const nav    = useNavigation();
  const submit = useSubmit();
  const saving = nav.state === "submitting";

  const [enabled, setEnabled]         = useState(s.enabled);
  const [handle, setHandle]           = useState(s.productHandle || "");
  const [discount, setDiscount]       = useState(s.discountPercent || 10);
  const [headline, setHeadline]       = useState(s.headline || "Wait — grab this before you go! 🎁");
  const [btnText, setBtnText]         = useState(s.buttonText || "Yes! Add to my order");
  const [color, setColor]             = useState(s.primaryColor || "#5C6AC4");

  const save = useCallback(() => {
    const fd = new FormData();
    fd.set("enabled",         String(enabled));
    fd.set("productHandle",   handle);
    fd.set("discountPercent", String(discount));
    fd.set("headline",        headline);
    fd.set("buttonText",      btnText);
    fd.set("primaryColor",    color);
    submit(fd, { method: "POST" });
  }, [enabled, handle, discount, headline, btnText, color, submit]);

  return (
    <Page title="Post-Purchase Upsell" backAction={{ url: "/app" }}>
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <Text variant="headingMd" as="h2">Post-Purchase Upsell</Text>
                  <Badge tone={enabled ? "success" : "critical"}>{enabled ? "Enabled" : "Disabled"}</Badge>
                </InlineStack>
                <Checkbox label="Enable Post-Purchase Upsell" checked={enabled} onChange={setEnabled} />
                <Text variant="bodySm" as="p" tone="subdued">
                  Shows a one-click offer on the thank-you page after checkout.
                </Text>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">Upsell Product</Text>
                <TextField
                  label="Product Handle"
                  value={handle}
                  onChange={setHandle}
                  autoComplete="off"
                  placeholder="e.g. premium-face-serum"
                  helpText="Copy the product handle from the Shopify product URL."
                />
                <RangeSlider
                  label={`Discount: ${discount}% off`}
                  value={discount}
                  onChange={(v) => setDiscount(v as number)}
                  min={0} max={70} step={5}
                  output
                />
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">Copy & Design</Text>
                <TextField label="Headline" value={headline} onChange={setHeadline} autoComplete="off" />
                <TextField label="Button Text" value={btnText} onChange={setBtnText} autoComplete="off" />
                <TextField label="Button Color (hex)" value={color} onChange={setColor} autoComplete="off" placeholder="#5C6AC4" />
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
