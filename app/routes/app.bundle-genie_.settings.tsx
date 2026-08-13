import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import { Page, Card, BlockStack, Text, Banner } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { connectDB } from "../db.server";
import { getOrCreateBundleSettings, BundleSettings } from "../.server/models/bundle.model";
import { BundleGenieShell } from "../components/bundle-genie-nav";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();
  const settings = await getOrCreateBundleSettings(session.shop);
  return json({ enabled: settings.enabled });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();
  const formData = await request.formData();
  const enabled = formData.get("enabled") === "true";
  await BundleSettings.findOneAndUpdate(
    { shopId: session.shop },
    { $set: { enabled } },
    { upsert: true, setDefaultsOnInsert: true },
  );
  return json({ success: true, enabled });
};

export default function BundleGenieSettings() {
  const { enabled } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isBusy = navigation.state === "submitting";

  const toggle = (next: boolean) => {
    const fd = new FormData();
    fd.set("enabled", String(next));
    submit(fd, { method: "post" });
  };

  return (
    <Page title="Bundle Genie" subtitle="Settings" backAction={{ url: "/app/bundle-genie" }}>
      <BundleGenieShell active="settings">
      <BlockStack gap="400">
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Storefront widget</Text>
            <Text as="p" tone="subdued">
              Controls whether the Bundle Genie product-page widget can appear on your
              storefront. The "Bundle Genie" app embed still needs to be turned on in your
              theme editor separately — this is the app-level switch.
            </Text>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={enabled}
                disabled={isBusy}
                onChange={(e) => toggle(e.target.checked)}
                style={{ width: 18, height: 18 }}
              />
              <Text as="span">{enabled ? "Enabled" : "Disabled"}</Text>
            </label>
          </BlockStack>
        </Card>

        <Banner tone="info">
          <p>
            Per-bundle design (colors, layout) and pricing are configured on each campaign
            individually — open a campaign from the Campaigns tab to edit those.
          </p>
        </Banner>
      </BlockStack>
      </BundleGenieShell>
    </Page>
  );
}
