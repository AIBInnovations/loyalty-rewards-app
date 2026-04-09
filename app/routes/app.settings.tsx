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
  Button,
  Banner,
  Divider,
  InlineGrid,
  Select,
  Checkbox,
} from "@shopify/polaris";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import { connectDB } from "../db.server";
import { getOrCreateSettings, Settings } from "../.server/models/settings.model";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();
  const settings = await getOrCreateSettings(session.shop);
  return json({ settings: JSON.parse(JSON.stringify(settings)) });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  await connectDB();

  const formData = await request.formData();
  const data = Object.fromEntries(formData);
  const widgetColor = String(data.widgetColor || "#5C6AC4");

  try {
    await Settings.findOneAndUpdate(
      { shopId: session.shop },
      {
        $set: {
          earningRate: Number(data.earningRate) || 10,
          signupBonus: Number(data.signupBonus) || 0,
          referralBonusReferrer: Number(data.referralBonusReferrer) || 0,
          referralBonusReferred: Number(data.referralBonusReferred) || 0,
          birthdayBonus: Number(data.birthdayBonus) || 0,
          socialShareBonus: Number(data.socialShareBonus) || 0,
          "pointsExpiry.enabled": data.pointsExpiryEnabled === "true",
          "pointsExpiry.daysToExpire": Number(data.pointsExpiryDays) || 365,
          "widgetConfig.primaryColor": widgetColor,
          "widgetConfig.position": data.widgetPosition || "bottom-right",
          "widgetConfig.title": data.widgetTitle || "Rewards",
          currencySymbol: data.currencySymbol || "₹",
          isActive: data.isActive === "true",
        },
      },
      { upsert: true },
    );

    // Sync primary color to shop metafield so Liquid template can read it
    const shopRes = await admin.graphql(`#graphql
      query { shop { id } }
    `);
    const shopData = await shopRes.json();
    const shopGid = shopData.data.shop.id;

    await admin.graphql(
      `#graphql
      mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          userErrors { field message }
        }
      }`,
      {
        variables: {
          metafields: [
            {
              ownerId: shopGid,
              namespace: "loyalty_widget",
              key: "primary_color",
              value: widgetColor,
              type: "single_line_text_field",
            },
          ],
        },
      }
    );

    return json({ success: true });
  } catch (error) {
    return json(
      { success: false, error: "Failed to save settings" },
      { status: 500 },
    );
  }
};

export default function SettingsPage() {
  const { settings } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isLoading = navigation.state === "submitting";

  const [formState, setFormState] = useState({
    earningRate: String(settings.earningRate),
    signupBonus: String(settings.signupBonus),
    referralBonusReferrer: String(settings.referralBonusReferrer),
    referralBonusReferred: String(settings.referralBonusReferred),
    birthdayBonus: String(settings.birthdayBonus),
    socialShareBonus: String(settings.socialShareBonus),
    pointsExpiryEnabled: settings.pointsExpiry?.enabled || false,
    pointsExpiryDays: String(settings.pointsExpiry?.daysToExpire || 365),
    widgetColor: settings.widgetConfig?.primaryColor || "#5C6AC4",
    widgetPosition: settings.widgetConfig?.position || "bottom-right",
    widgetTitle: settings.widgetConfig?.title || "Rewards",
    currencySymbol: settings.currencySymbol || "₹",
    isActive: settings.isActive,
  });

  const handleChange = useCallback(
    (field: string) => (value: string | boolean) => {
      setFormState((prev) => ({ ...prev, [field]: value }));
    },
    [],
  );

  const handleSave = useCallback(() => {
    const formData = new FormData();
    Object.entries(formState).forEach(([key, value]) => {
      formData.set(key, String(value));
    });
    submit(formData, { method: "post" });
  }, [formState, submit]);

  return (
    <Page
      title="Settings"
      primaryAction={{
        content: "Save",
        onAction: handleSave,
        loading: isLoading,
      }}
    >
      <BlockStack gap="500">
        <Layout>
          <Layout.AnnotatedSection
            title="Program Status"
            description="Enable or disable the loyalty program"
          >
            <Card>
              <Checkbox
                label="Loyalty program active"
                checked={formState.isActive}
                onChange={handleChange("isActive")}
              />
            </Card>
          </Layout.AnnotatedSection>

          <Layout.AnnotatedSection
            title="Earning Configuration"
            description="Configure how customers earn points. 1 point = ₹1 in reward value."
          >
            <Card>
              <BlockStack gap="400">
                <TextField
                  label="Earning Rate (%)"
                  type="number"
                  value={formState.earningRate}
                  onChange={handleChange("earningRate")}
                  helpText="Percentage of order subtotal awarded as points. E.g., 10% means ₹1000 order = 100 points."
                  autoComplete="off"
                  min={0}
                  max={100}
                />
                <Divider />
                <Text as="h3" variant="headingSm">
                  Bonus Points
                </Text>
                <InlineGrid columns={2} gap="400">
                  <TextField
                    label="Signup Bonus"
                    type="number"
                    value={formState.signupBonus}
                    onChange={handleChange("signupBonus")}
                    helpText="Points awarded on account creation"
                    autoComplete="off"
                    min={0}
                  />
                  <TextField
                    label="Birthday Bonus"
                    type="number"
                    value={formState.birthdayBonus}
                    onChange={handleChange("birthdayBonus")}
                    helpText="Points awarded on customer's birthday (once/year)"
                    autoComplete="off"
                    min={0}
                  />
                </InlineGrid>
                <InlineGrid columns={2} gap="400">
                  <TextField
                    label="Referral Bonus (Referrer)"
                    type="number"
                    value={formState.referralBonusReferrer}
                    onChange={handleChange("referralBonusReferrer")}
                    helpText="Points for the person who refers"
                    autoComplete="off"
                    min={0}
                  />
                  <TextField
                    label="Referral Bonus (Referred)"
                    type="number"
                    value={formState.referralBonusReferred}
                    onChange={handleChange("referralBonusReferred")}
                    helpText="Points for the new customer"
                    autoComplete="off"
                    min={0}
                  />
                </InlineGrid>
                <TextField
                  label="Social Share Bonus"
                  type="number"
                  value={formState.socialShareBonus}
                  onChange={handleChange("socialShareBonus")}
                  helpText="Points per social share (max 1 per platform per day)"
                  autoComplete="off"
                  min={0}
                />
              </BlockStack>
            </Card>
          </Layout.AnnotatedSection>

          <Layout.AnnotatedSection
            title="Points Expiry"
            description="Optionally expire unused points after a set period"
          >
            <Card>
              <BlockStack gap="400">
                <Checkbox
                  label="Enable points expiry"
                  checked={formState.pointsExpiryEnabled}
                  onChange={handleChange("pointsExpiryEnabled")}
                />
                {formState.pointsExpiryEnabled && (
                  <TextField
                    label="Days to expire"
                    type="number"
                    value={formState.pointsExpiryDays}
                    onChange={handleChange("pointsExpiryDays")}
                    helpText="Points expire this many days after being earned"
                    autoComplete="off"
                    min={30}
                  />
                )}
              </BlockStack>
            </Card>
          </Layout.AnnotatedSection>

          <Layout.AnnotatedSection
            title="Widget Appearance"
            description="Customize the loyalty widget shown on your storefront"
          >
            <Card>
              <BlockStack gap="400">
                <TextField
                  label="Widget Title"
                  value={formState.widgetTitle}
                  onChange={handleChange("widgetTitle")}
                  autoComplete="off"
                />
                <TextField
                  label="Primary Color"
                  value={formState.widgetColor}
                  onChange={handleChange("widgetColor")}
                  helpText="Hex color code (e.g., #5C6AC4)"
                  autoComplete="off"
                />
                <Select
                  label="Widget Position"
                  options={[
                    { label: "Bottom Right", value: "bottom-right" },
                    { label: "Bottom Left", value: "bottom-left" },
                  ]}
                  value={formState.widgetPosition}
                  onChange={handleChange("widgetPosition")}
                />
                <TextField
                  label="Currency Symbol"
                  value={formState.currencySymbol}
                  onChange={handleChange("currencySymbol")}
                  autoComplete="off"
                />
              </BlockStack>
            </Card>
          </Layout.AnnotatedSection>
        </Layout>

        <Banner tone="info">
          <p>
            Remember: 1 point = {formState.currencySymbol}1. A {formState.earningRate}% earning rate means customers earn {formState.earningRate} points per {formState.currencySymbol}100 spent.
          </p>
        </Banner>
      </BlockStack>
    </Page>
  );
}
