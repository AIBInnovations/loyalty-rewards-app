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
  Checkbox,
  Select,
  InlineGrid,
  Divider,
  Banner,
  InlineStack,
  Badge,
} from "@shopify/polaris";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import { connectDB } from "../db.server";
import {
  getOrCreateTimerSettings,
  TimerSettings,
} from "../.server/models/timer-settings.model";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();
  const settings = await getOrCreateTimerSettings(session.shop);
  return json({ settings: JSON.parse(JSON.stringify(settings)) });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();

  const formData = await request.formData();
  const data = Object.fromEntries(formData);

  try {
    const specificTags = String(data.specificTags || "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    await TimerSettings.findOneAndUpdate(
      { shopId: session.shop },
      {
        $set: {
          enabled: data.enabled === "true",
          timerType: data.timerType || "evergreen",
          endDate: data.endDate ? new Date(data.endDate as string) : undefined,
          durationHours: Number(data.durationHours) || 2,
          durationMinutes: Number(data.durationMinutes) || 0,
          displayMode: data.displayMode || "announcement",
          messageTemplate: data.messageTemplate || "🔥 Flash Sale ends in {timer}",
          expiredMessage: data.expiredMessage || "Sale has ended!",
          barBackgroundColor: data.barBackgroundColor || "#1a1a1a",
          barTextColor: data.barTextColor || "#ffffff",
          timerDigitColor: data.timerDigitColor || "#ff4444",
          showOnAllProducts: data.showOnAllProducts === "true",
          saleItemsOnly: data.saleItemsOnly === "true",
          specificTags,
          hideWhenExpired: data.hideWhenExpired === "true",
          showDismissButton: data.showDismissButton === "true",
        },
      },
      { upsert: true },
    );

    return json({ success: true });
  } catch (error) {
    return json({ success: false, error: "Failed to save" }, { status: 500 });
  }
};

export default function TimerSettingsPage() {
  const { settings } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isLoading = navigation.state === "submitting";

  const [enabled, setEnabled] = useState(settings.enabled);
  const [timerType, setTimerType] = useState(settings.timerType || "evergreen");
  const [endDate, setEndDate] = useState(
    settings.endDate ? new Date(settings.endDate).toISOString().slice(0, 16) : "",
  );
  const [durationHours, setDurationHours] = useState(String(settings.durationHours ?? 2));
  const [durationMinutes, setDurationMinutes] = useState(String(settings.durationMinutes ?? 0));
  const [displayMode, setDisplayMode] = useState(settings.displayMode || "announcement");
  const [messageTemplate, setMessageTemplate] = useState(settings.messageTemplate);
  const [expiredMessage, setExpiredMessage] = useState(settings.expiredMessage);
  const [barBgColor, setBarBgColor] = useState(settings.barBackgroundColor);
  const [barTextColor, setBarTextColor] = useState(settings.barTextColor);
  const [timerDigitColor, setTimerDigitColor] = useState(settings.timerDigitColor);
  const [showOnAll, setShowOnAll] = useState(settings.showOnAllProducts);
  const [saleOnly, setSaleOnly] = useState(settings.saleItemsOnly);
  const [specificTags, setSpecificTags] = useState(
    (settings.specificTags || []).join(", "),
  );
  const [hideWhenExpired, setHideWhenExpired] = useState(settings.hideWhenExpired);
  const [showDismiss, setShowDismiss] = useState(settings.showDismissButton);

  const handleSave = useCallback(() => {
    const formData = new FormData();
    formData.set("enabled", String(enabled));
    formData.set("timerType", timerType);
    formData.set("endDate", endDate);
    formData.set("durationHours", durationHours);
    formData.set("durationMinutes", durationMinutes);
    formData.set("displayMode", displayMode);
    formData.set("messageTemplate", messageTemplate);
    formData.set("expiredMessage", expiredMessage);
    formData.set("barBackgroundColor", barBgColor);
    formData.set("barTextColor", barTextColor);
    formData.set("timerDigitColor", timerDigitColor);
    formData.set("showOnAllProducts", String(showOnAll));
    formData.set("saleItemsOnly", String(saleOnly));
    formData.set("specificTags", specificTags);
    formData.set("hideWhenExpired", String(hideWhenExpired));
    formData.set("showDismissButton", String(showDismiss));
    submit(formData, { method: "post" });
  }, [
    enabled, timerType, endDate, durationHours, durationMinutes, displayMode,
    messageTemplate, expiredMessage, barBgColor, barTextColor, timerDigitColor,
    showOnAll, saleOnly, specificTags, hideWhenExpired, showDismiss, submit,
  ]);

  return (
    <Page
      title="Countdown Timer"
      primaryAction={{ content: "Save", onAction: handleSave, loading: isLoading }}
      backAction={{ content: "Dashboard", url: "/app" }}
    >
      <BlockStack gap="500">
        <Layout>
          <Layout.AnnotatedSection
            title="Timer Status"
            description="Enable or disable the countdown timer on your storefront."
          >
            <Card>
              <BlockStack gap="300">
                <Checkbox
                  label="Enable Countdown Timer"
                  checked={enabled}
                  onChange={setEnabled}
                />
                {enabled && (
                  <Badge tone="success">Active on storefront</Badge>
                )}
              </BlockStack>
            </Card>
          </Layout.AnnotatedSection>

          <Layout.AnnotatedSection
            title="Timer Type"
            description="Fixed deadline counts down to a specific date. Evergreen resets for each new visitor session to create personal urgency."
          >
            <Card>
              <BlockStack gap="400">
                <Select
                  label="Timer Type"
                  options={[
                    { label: "⏰ Fixed Deadline (real end date)", value: "fixed" },
                    { label: "🔄 Evergreen (resets per session)", value: "evergreen" },
                  ]}
                  value={timerType}
                  onChange={setTimerType}
                />
                {timerType === "fixed" && (
                  <TextField
                    label="Sale End Date & Time"
                    type="datetime-local"
                    value={endDate}
                    onChange={setEndDate}
                    helpText="The exact date and time the sale ends"
                    autoComplete="off"
                  />
                )}
                {timerType === "evergreen" && (
                  <InlineGrid columns={2} gap="300">
                    <TextField
                      label="Hours"
                      type="number"
                      value={durationHours}
                      onChange={setDurationHours}
                      min={0}
                      max={72}
                      autoComplete="off"
                    />
                    <TextField
                      label="Minutes"
                      type="number"
                      value={durationMinutes}
                      onChange={setDurationMinutes}
                      min={0}
                      max={59}
                      autoComplete="off"
                    />
                  </InlineGrid>
                )}
              </BlockStack>
            </Card>
          </Layout.AnnotatedSection>

          <Layout.AnnotatedSection
            title="Display"
            description="Choose where and how the timer appears."
          >
            <Card>
              <BlockStack gap="400">
                <Select
                  label="Display Mode"
                  options={[
                    { label: "Announcement Bar (top of page)", value: "announcement" },
                    { label: "Product Page (near Add to Cart)", value: "product-page" },
                    { label: "Both", value: "both" },
                  ]}
                  value={displayMode}
                  onChange={setDisplayMode}
                />
                <TextField
                  label="Timer Message"
                  value={messageTemplate}
                  onChange={setMessageTemplate}
                  helpText="Use {timer} for the countdown. Example: 🔥 Sale ends in {timer}"
                  autoComplete="off"
                />
                <TextField
                  label="Expired Message"
                  value={expiredMessage}
                  onChange={setExpiredMessage}
                  helpText="Shown when the timer reaches zero"
                  autoComplete="off"
                />
                <Divider />
                <InlineGrid columns={3} gap="300">
                  {[
                    { label: "Bar Background",  value: barBgColor,      set: setBarBgColor },
                    { label: "Text Color",       value: barTextColor,    set: setBarTextColor },
                    { label: "Timer Digit Color",value: timerDigitColor, set: setTimerDigitColor },
                  ].map(({ label, value, set }) => (
                    <div key={label}>
                      <Text variant="bodySm" as="p" tone="subdued">{label}</Text>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                        <input
                          type="color"
                          value={value || "#000000"}
                          onChange={(e) => set(e.target.value)}
                          style={{ width: 40, height: 36, border: "1px solid #ccc", borderRadius: 6, cursor: "pointer", padding: 2 }}
                        />
                        <span style={{ fontSize: 13, color: "#555", fontFamily: "monospace" }}>{value}</span>
                      </div>
                    </div>
                  ))}
                </InlineGrid>
              </BlockStack>
            </Card>
          </Layout.AnnotatedSection>

          <Layout.AnnotatedSection
            title="Targeting"
            description="Control which products show the timer."
          >
            <Card>
              <BlockStack gap="400">
                <Checkbox
                  label="Show on all products"
                  checked={showOnAll}
                  onChange={setShowOnAll}
                />
                {!showOnAll && (
                  <>
                    <Checkbox
                      label="Only show on sale items (products with compare-at price)"
                      checked={saleOnly}
                      onChange={setSaleOnly}
                    />
                    <TextField
                      label="Specific Product Tags (comma separated)"
                      value={specificTags}
                      onChange={setSpecificTags}
                      helpText="Only show timer on products with these tags. Leave empty for all."
                      placeholder="sale, flash-deal, limited"
                      autoComplete="off"
                    />
                  </>
                )}
              </BlockStack>
            </Card>
          </Layout.AnnotatedSection>

          <Layout.AnnotatedSection
            title="Behavior"
            description="What happens when the timer expires."
          >
            <Card>
              <BlockStack gap="300">
                <Checkbox
                  label="Hide timer when expired"
                  helpText="If unchecked, shows the expired message instead"
                  checked={hideWhenExpired}
                  onChange={setHideWhenExpired}
                />
                <Checkbox
                  label="Show dismiss (✕) button"
                  helpText="Allow visitors to close the announcement bar"
                  checked={showDismiss}
                  onChange={setShowDismiss}
                />
              </BlockStack>
            </Card>
          </Layout.AnnotatedSection>
        </Layout>

        <Banner tone="info">
          <p>
            After saving, enable "Countdown Timer" in your theme:
            Online Store → Themes → Customize → App embeds → Countdown Timer.
          </p>
        </Banner>
      </BlockStack>
    </Page>
  );
}
