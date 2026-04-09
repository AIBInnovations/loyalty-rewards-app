import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useNavigation, useSubmit } from "@remix-run/react";
import {
  Page, Layout, Card, BlockStack, Text, TextField, Button,
  InlineStack, Badge, Checkbox, Banner,
} from "@shopify/polaris";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import { connectDB } from "../db.server";
import { CodSettings, getOrCreateCodSettings } from "../.server/models/cod-settings.model";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();
  const s = await getOrCreateCodSettings(session.shop);
  return json({ settings: JSON.parse(JSON.stringify(s)) });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();
  const fd = await request.formData();
  await CodSettings.findOneAndUpdate(
    { shopId: session.shop },
    {
      $set: {
        enabled:         fd.get("enabled") === "true",
        whatsappToken:   String(fd.get("whatsappToken") || ""),
        whatsappPhoneId: String(fd.get("whatsappPhoneId") || ""),
        messageTemplate: String(fd.get("messageTemplate") || ""),
      },
    },
    { upsert: true },
  );
  return json({ success: true });
};

export default function CodSettingsPage() {
  const { settings: s } = useLoaderData<typeof loader>();
  const nav    = useNavigation();
  const submit = useSubmit();
  const saving = nav.state === "submitting";

  const [enabled, setEnabled]   = useState(s.enabled);
  const [token, setToken]       = useState(s.whatsappToken || "");
  const [phoneId, setPhoneId]   = useState(s.whatsappPhoneId || "");
  const [template, setTemplate] = useState(
    s.messageTemplate ||
    "Hi {name}! 🎉 Your order #{order_number} worth ₹{amount} has been confirmed. Expected delivery: {date}. Reply CANCEL to cancel.",
  );

  const save = useCallback(() => {
    const fd = new FormData();
    fd.set("enabled",         String(enabled));
    fd.set("whatsappToken",   token);
    fd.set("whatsappPhoneId", phoneId);
    fd.set("messageTemplate", template);
    submit(fd, { method: "POST" });
  }, [enabled, token, phoneId, template, submit]);

  return (
    <Page title="COD Confirmation via WhatsApp" backAction={{ url: "/app" }}>
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <Text variant="headingMd" as="h2">COD WhatsApp Confirmation</Text>
                  <Badge tone={enabled ? "success" : "critical"}>{enabled ? "Enabled" : "Disabled"}</Badge>
                </InlineStack>
                <Checkbox label="Enable COD WhatsApp Confirmation" checked={enabled} onChange={setEnabled} />
                <Banner tone="info">
                  Automatically sends a WhatsApp message to the customer when a Cash on Delivery order is placed. Reduces RTO by 30–50%. Requires Meta WhatsApp Business API credentials.
                </Banner>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">WhatsApp Business API</Text>
                <Banner tone="warning">
                  You need a Meta WhatsApp Business API account. Get your credentials from the Meta Business Manager → WhatsApp → API Setup.
                </Banner>
                <TextField
                  label="Permanent Access Token"
                  value={token}
                  onChange={setToken}
                  autoComplete="off"
                  type="password"
                  placeholder="EAAxxxxxx..."
                  helpText="Create a permanent token in Meta Business Manager → System Users."
                />
                <TextField
                  label="Phone Number ID"
                  value={phoneId}
                  onChange={setPhoneId}
                  autoComplete="off"
                  placeholder="1234567890"
                  helpText="Found in Meta Business Manager → WhatsApp → API Setup."
                />
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">Message Template</Text>
                <TextField
                  label="Message"
                  value={template}
                  onChange={setTemplate}
                  multiline={4}
                  autoComplete="off"
                  helpText="Variables: {name}, {order_number}, {amount}, {date}"
                />
                <Text variant="bodySm" as="p" tone="subdued">
                  Preview: {template
                    .replace("{name}", "Rahul")
                    .replace("{order_number}", "1234")
                    .replace("{amount}", "1299")
                    .replace("{date}", "Apr 15")}
                </Text>
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
