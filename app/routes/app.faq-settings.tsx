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
  InlineGrid,
  Divider,
  Banner,
  InlineStack,
  Badge,
  Select,
} from "@shopify/polaris";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import { connectDB } from "../db.server";
import {
  getOrCreateFaqSettings,
  FaqSettings,
} from "../.server/models/faq-settings.model";

type FaqItem = { question: string; answer: string; active: boolean };

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();
  const settings = await getOrCreateFaqSettings(session.shop);
  return json({ settings: JSON.parse(JSON.stringify(settings)) });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();

  const formData = await request.formData();
  const data = Object.fromEntries(formData);

  try {
    const parsedItems = JSON.parse(String(data.items || "[]")).map(
      (it: any) => ({
        question: String(it?.question ?? "").slice(0, 300),
        answer: String(it?.answer ?? "").slice(0, 4000),
        active: it?.active !== false,
      }),
    );

    const toInt = (v: unknown, fallback: number) => {
      const n = parseInt(String(v ?? ""), 10);
      return Number.isFinite(n) ? n : fallback;
    };

    await FaqSettings.findOneAndUpdate(
      { shopId: session.shop },
      {
        $set: {
          enabled: data.enabled === "true",
          heading: String(data.heading || "Frequently Asked Questions"),
          subheading: String(data.subheading || ""),
          restrictToProduct: data.restrictToProduct === "true",
          placement: ["before-footer", "after-main", "end-of-body"].includes(
            String(data.placement),
          )
            ? String(data.placement)
            : "before-footer",
          iconStyle: data.iconStyle === "plus" ? "plus" : "chevron",
          allowMultiple: data.allowMultiple === "true",
          firstOpen: data.firstOpen === "true",
          maxItems: toInt(data.maxItems, 0),
          enableSchema: data.enableSchema === "true",
          backgroundColor: String(data.backgroundColor || "#ffffff"),
          textColor: String(data.textColor || "#111827"),
          accentColor: String(data.accentColor || "#5C6AC4"),
          borderColor: String(data.borderColor || "#e5e7eb"),
          borderRadius: toInt(data.borderRadius, 8),
          itemGap: toInt(data.itemGap, 8),
          maxWidth: toInt(data.maxWidth, 880),
          items: parsedItems,
        },
      },
      { upsert: true },
    );

    return json({ success: true });
  } catch (error) {
    return json({ success: false, error: "Failed to save" }, { status: 500 });
  }
};

export default function FaqSettingsPage() {
  const { settings } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isLoading = navigation.state === "submitting";

  const [enabled, setEnabled] = useState<boolean>(settings.enabled);
  const [heading, setHeading] = useState<string>(settings.heading);
  const [subheading, setSubheading] = useState<string>(settings.subheading || "");
  const [restrictToProduct, setRestrictToProduct] = useState<boolean>(
    settings.restrictToProduct,
  );
  const [placement, setPlacement] = useState<string>(settings.placement);
  const [iconStyle, setIconStyle] = useState<string>(settings.iconStyle);
  const [allowMultiple, setAllowMultiple] = useState<boolean>(settings.allowMultiple);
  const [firstOpen, setFirstOpen] = useState<boolean>(settings.firstOpen);
  const [maxItems, setMaxItems] = useState<string>(String(settings.maxItems ?? 0));
  const [enableSchema, setEnableSchema] = useState<boolean>(settings.enableSchema);

  const [backgroundColor, setBackgroundColor] = useState<string>(settings.backgroundColor);
  const [textColor, setTextColor] = useState<string>(settings.textColor);
  const [accentColor, setAccentColor] = useState<string>(settings.accentColor);
  const [borderColor, setBorderColor] = useState<string>(settings.borderColor);
  const [borderRadius, setBorderRadius] = useState<string>(
    String(settings.borderRadius ?? 8),
  );
  const [itemGap, setItemGap] = useState<string>(String(settings.itemGap ?? 8));
  const [maxWidth, setMaxWidth] = useState<string>(String(settings.maxWidth ?? 880));

  const [items, setItems] = useState<FaqItem[]>(settings.items || []);

  const updateItem = (idx: number, patch: Partial<FaqItem>) => {
    setItems((cur) => cur.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  const addItem = () => {
    setItems((cur) => [...cur, { question: "", answer: "", active: true }]);
  };

  const removeItem = (idx: number) => {
    setItems((cur) => cur.filter((_, i) => i !== idx));
  };

  const moveItem = (idx: number, dir: -1 | 1) => {
    setItems((cur) => {
      const next = [...cur];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return cur;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  };

  const handleSave = useCallback(() => {
    const fd = new FormData();
    fd.set("enabled", String(enabled));
    fd.set("heading", heading);
    fd.set("subheading", subheading);
    fd.set("restrictToProduct", String(restrictToProduct));
    fd.set("placement", placement);
    fd.set("iconStyle", iconStyle);
    fd.set("allowMultiple", String(allowMultiple));
    fd.set("firstOpen", String(firstOpen));
    fd.set("maxItems", maxItems);
    fd.set("enableSchema", String(enableSchema));
    fd.set("backgroundColor", backgroundColor);
    fd.set("textColor", textColor);
    fd.set("accentColor", accentColor);
    fd.set("borderColor", borderColor);
    fd.set("borderRadius", borderRadius);
    fd.set("itemGap", itemGap);
    fd.set("maxWidth", maxWidth);
    fd.set("items", JSON.stringify(items));
    submit(fd, { method: "post" });
  }, [
    enabled, heading, subheading, restrictToProduct, placement, iconStyle,
    allowMultiple, firstOpen, maxItems, enableSchema,
    backgroundColor, textColor, accentColor, borderColor,
    borderRadius, itemGap, maxWidth, items, submit,
  ]);

  const activeCount = items.filter((i) => i.active && i.question.trim() && i.answer.trim()).length;

  return (
    <Page
      title="FAQ Accordion"
      primaryAction={{ content: "Save", onAction: handleSave, loading: isLoading }}
      backAction={{ content: "Dashboard", url: "/app" }}
    >
      <BlockStack gap="500">
        <Layout>
          <Layout.AnnotatedSection
            title="Status"
            description="Enable or disable the FAQ accordion on the storefront."
          >
            <Card>
              <BlockStack gap="300">
                <Checkbox
                  label="Enable FAQ Accordion"
                  checked={enabled}
                  onChange={setEnabled}
                />
                {enabled && (
                  <InlineStack gap="200">
                    <Badge tone="success">Active on storefront</Badge>
                    <Badge tone="info">{`${activeCount} visible item${activeCount === 1 ? "" : "s"}`}</Badge>
                  </InlineStack>
                )}
                <Banner tone="info">
                  <p>
                    After enabling here, turn on the{" "}
                    <strong>FAQ Accordion</strong> app embed in the Theme
                    Editor (Online Store → Themes → Customize → Theme settings
                    → App embeds).
                  </p>
                </Banner>
              </BlockStack>
            </Card>
          </Layout.AnnotatedSection>

          <Layout.AnnotatedSection
            title="Content"
            description="Heading and subheading shown above the accordion."
          >
            <Card>
              <BlockStack gap="400">
                <TextField
                  label="Heading"
                  value={heading}
                  onChange={setHeading}
                  autoComplete="off"
                />
                <TextField
                  label="Subheading"
                  value={subheading}
                  onChange={setSubheading}
                  autoComplete="off"
                  helpText="Optional short intro text."
                />
              </BlockStack>
            </Card>
          </Layout.AnnotatedSection>

          <Layout.AnnotatedSection
            title="Placement & Behavior"
            description="Where the FAQ appears on the storefront and how it behaves."
          >
            <Card>
              <BlockStack gap="400">
                <Checkbox
                  label="Only show on product pages"
                  checked={restrictToProduct}
                  onChange={setRestrictToProduct}
                />
                <Select
                  label="Position"
                  options={[
                    { label: "Above footer", value: "before-footer" },
                    { label: "Below main content", value: "after-main" },
                    { label: "End of page", value: "end-of-body" },
                  ]}
                  value={placement}
                  onChange={setPlacement}
                />
                <Select
                  label="Icon style"
                  options={[
                    { label: "Chevron", value: "chevron" },
                    { label: "Plus / Minus", value: "plus" },
                  ]}
                  value={iconStyle}
                  onChange={setIconStyle}
                />
                <Checkbox
                  label="Allow multiple items open at once"
                  checked={allowMultiple}
                  onChange={setAllowMultiple}
                />
                <Checkbox
                  label="Open first item by default"
                  checked={firstOpen}
                  onChange={setFirstOpen}
                />
                <TextField
                  label="Max items to display"
                  type="number"
                  value={maxItems}
                  onChange={setMaxItems}
                  autoComplete="off"
                  helpText="0 = no limit"
                  min={0}
                  max={50}
                />
              </BlockStack>
            </Card>
          </Layout.AnnotatedSection>

          <Layout.AnnotatedSection
            title="FAQ Items"
            description="Add, edit, reorder, or disable individual questions. Inactive items do not render and are excluded from JSON-LD."
          >
            <Card>
              <BlockStack gap="400">
                {items.length === 0 && (
                  <Text as="p" tone="subdued">
                    No FAQ items yet. Click "Add FAQ" to create one.
                  </Text>
                )}

                {items.map((item, idx) => (
                  <BlockStack key={`faq-${idx}`} gap="200">
                    <InlineStack gap="200" align="space-between" blockAlign="center">
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="h3" variant="headingSm">
                          {`Item ${idx + 1}`}
                        </Text>
                        {!item.active && <Badge tone="warning">Hidden</Badge>}
                      </InlineStack>
                      <InlineStack gap="100">
                        <Button
                          variant="tertiary"
                          onClick={() => moveItem(idx, -1)}
                          disabled={idx === 0}
                          accessibilityLabel={`Move item ${idx + 1} up`}
                        >
                          ↑
                        </Button>
                        <Button
                          variant="tertiary"
                          onClick={() => moveItem(idx, 1)}
                          disabled={idx === items.length - 1}
                          accessibilityLabel={`Move item ${idx + 1} down`}
                        >
                          ↓
                        </Button>
                        <Button
                          tone="critical"
                          variant="tertiary"
                          onClick={() => removeItem(idx)}
                          accessibilityLabel={`Delete item ${idx + 1}`}
                        >
                          ✕
                        </Button>
                      </InlineStack>
                    </InlineStack>

                    <TextField
                      label="Question"
                      value={item.question}
                      onChange={(v) => updateItem(idx, { question: v })}
                      autoComplete="off"
                    />
                    <TextField
                      label="Answer"
                      value={item.answer}
                      onChange={(v) => updateItem(idx, { answer: v })}
                      multiline={4}
                      autoComplete="off"
                    />
                    <Checkbox
                      label="Active (show on storefront)"
                      checked={item.active}
                      onChange={(v) => updateItem(idx, { active: v })}
                    />
                    {idx < items.length - 1 && <Divider />}
                  </BlockStack>
                ))}

                <InlineStack>
                  <Button onClick={addItem}>+ Add FAQ</Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.AnnotatedSection>

          <Layout.AnnotatedSection
            title="Appearance"
            description="Colors and spacing for the accordion on the storefront."
          >
            <Card>
              <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
                <TextField
                  label="Background"
                  value={backgroundColor}
                  onChange={setBackgroundColor}
                  autoComplete="off"
                />
                <TextField
                  label="Text"
                  value={textColor}
                  onChange={setTextColor}
                  autoComplete="off"
                />
                <TextField
                  label="Accent"
                  value={accentColor}
                  onChange={setAccentColor}
                  autoComplete="off"
                />
                <TextField
                  label="Border"
                  value={borderColor}
                  onChange={setBorderColor}
                  autoComplete="off"
                />
                <TextField
                  label="Border radius (px)"
                  type="number"
                  value={borderRadius}
                  onChange={setBorderRadius}
                  autoComplete="off"
                  min={0}
                  max={32}
                />
                <TextField
                  label="Space between items (px)"
                  type="number"
                  value={itemGap}
                  onChange={setItemGap}
                  autoComplete="off"
                  min={0}
                  max={32}
                />
                <TextField
                  label="Max width (px)"
                  type="number"
                  value={maxWidth}
                  onChange={setMaxWidth}
                  autoComplete="off"
                  min={480}
                  max={1400}
                />
              </InlineGrid>
            </Card>
          </Layout.AnnotatedSection>

          <Layout.AnnotatedSection
            title="SEO / Structured Data"
            description="Emit FAQPage JSON-LD so search engines understand the Q&A content. Only enable on pages where the FAQ is specific to that page."
          >
            <Card>
              <Checkbox
                label="Emit FAQPage JSON-LD"
                checked={enableSchema}
                onChange={setEnableSchema}
              />
            </Card>
          </Layout.AnnotatedSection>
        </Layout>
      </BlockStack>
    </Page>
  );
}
