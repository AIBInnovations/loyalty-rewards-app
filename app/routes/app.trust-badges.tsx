import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useNavigation, useSubmit } from "@remix-run/react";
import {
  Page, Layout, Card, BlockStack, InlineStack, Text, TextField,
  Button, Checkbox, Select, Badge, Divider,
} from "@shopify/polaris";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import { connectDB } from "../db.server";
import {
  TrustBadgesSettings,
  getOrCreateTrustBadgesSettings,
  type ITrustBadge,
} from "../.server/models/trust-badges.model";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();
  const settings = await getOrCreateTrustBadgesSettings(session.shop);
  return json({ settings: JSON.parse(JSON.stringify(settings)) });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();
  const fd = await request.formData();
  const badges: ITrustBadge[] = JSON.parse(String(fd.get("badges") || "[]"));
  await TrustBadgesSettings.findOneAndUpdate(
    { shopId: session.shop },
    {
      $set: {
        enabled: fd.get("enabled") === "true",
        layout: String(fd.get("layout") || "inline"),
        badges,
      },
    },
    { upsert: true },
  );
  return json({ success: true });
};

const LAYOUT_OPTIONS = [
  { label: "Inline Row", value: "inline" },
  { label: "Grid (2 columns)", value: "grid" },
];

const ICON_OPTIONS = [
  { label: "— None —", value: "" },
  { label: "COD / Cash", value: "cod" },
  { label: "Lock / Secure", value: "lock" },
  { label: "Shield", value: "shield" },
  { label: "Credit Card / UPI", value: "card" },
  { label: "Delivery Truck", value: "truck" },
  { label: "Easy Returns", value: "returns" },
  { label: "Checkmark / Genuine", value: "check" },
  { label: "Star / Quality", value: "star" },
  { label: "Package / Box", value: "package" },
  { label: "Gift", value: "gift" },
  { label: "Clock / Fast", value: "clock" },
];

const DEFAULT_BADGES: ITrustBadge[] = [
  { icon: "cod", text: "COD Available" },
  { icon: "lock", text: "UPI/Razorpay Secure" },
  { icon: "returns", text: "Easy Returns" },
  { icon: "truck", text: "Free Shipping" },
  { icon: "check", text: "100% Genuine" },
  { icon: "", text: "" },
];

export default function TrustBadgesPage() {
  const { settings } = useLoaderData<typeof loader>();
  const nav = useNavigation();
  const submit = useSubmit();
  const saving = nav.state === "submitting";

  const [enabled, setEnabled] = useState<boolean>(settings.enabled);
  const [layout, setLayout] = useState<string>(settings.layout || "inline");
  const [badges, setBadges] = useState<ITrustBadge[]>(
    settings.badges && settings.badges.length > 0 ? settings.badges : DEFAULT_BADGES,
  );

  const updateBadge = useCallback(
    (index: number, field: keyof ITrustBadge, value: string) => {
      setBadges((prev) =>
        prev.map((b, i) => (i === index ? { ...b, [field]: value } : b)),
      );
    },
    [],
  );

  const handleSave = useCallback(() => {
    const fd = new FormData();
    fd.set("enabled", String(enabled));
    fd.set("layout", layout);
    fd.set("badges", JSON.stringify(badges));
    submit(fd, { method: "POST" });
  }, [enabled, layout, badges, submit]);

  return (
    <Page
      title="Trust Badges"
      primaryAction={{ content: "Save", onAction: handleSave, loading: saving }}
      backAction={{ content: "Dashboard", url: "/app" }}
    >
      <Layout>
        <Layout.AnnotatedSection
          title="Trust Badges"
          description="Display trust signals like COD, secure payments, and easy returns on product pages. Enable the Trust Badges block in your theme via App Embeds."
        >
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text variant="headingMd" as="h2">Trust Badges</Text>
                <Badge tone={enabled ? "success" : "critical"}>
                  {enabled ? "Enabled" : "Disabled"}
                </Badge>
              </InlineStack>
              <Checkbox
                label="Enable Trust Badges"
                checked={enabled}
                onChange={setEnabled}
              />
              <Select
                label="Layout"
                options={LAYOUT_OPTIONS}
                value={layout}
                onChange={setLayout}
              />
            </BlockStack>
          </Card>
        </Layout.AnnotatedSection>

        <Layout.AnnotatedSection
          title="Badge Configuration"
          description="Configure up to 6 trust badges. Choose an icon and enter the badge text. Leave text blank to hide a badge."
        >
          <Card>
            <BlockStack gap="400">
              {badges.map((badge, index) => (
                <BlockStack key={index} gap="200">
                  {index > 0 && <Divider />}
                  <Text variant="headingSm" as="h3">Badge {index + 1}</Text>
                  <InlineStack gap="300" align="start">
                    <div style={{ width: "180px" }}>
                      <Select
                        label="Icon"
                        options={ICON_OPTIONS}
                        value={badge.icon}
                        onChange={(v) => updateBadge(index, "icon", v)}
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <TextField
                        label="Badge Text"
                        value={badge.text}
                        onChange={(v) => updateBadge(index, "text", v)}
                        placeholder="e.g. COD Available"
                        autoComplete="off"
                      />
                    </div>
                  </InlineStack>
                </BlockStack>
              ))}
            </BlockStack>
          </Card>
        </Layout.AnnotatedSection>

        <Layout.Section>
          <InlineStack align="end">
            <Button variant="primary" onClick={handleSave} loading={saving}>
              Save
            </Button>
          </InlineStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
