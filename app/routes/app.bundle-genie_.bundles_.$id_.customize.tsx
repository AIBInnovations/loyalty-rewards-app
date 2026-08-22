import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useParams } from "@remix-run/react";
import {
  Page, Card, BlockStack, Text, TextField, Button, Select, Banner,
  InlineStack, Collapsible, Icon, Checkbox, RangeSlider, ButtonGroup, Autocomplete,
} from "@shopify/polaris";
import { ChevronDownIcon, ChevronUpIcon } from "@shopify/polaris-icons";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import { connectDB } from "../db.server";
import { Bundle, type IBundleStyle, type IBundleProduct } from "../.server/models/bundle.model";

const DEFAULT_STYLE: IBundleStyle = {
  bgColor: "", textColor: "", buttonColor: "", buttonTextColor: "", borderRadius: 12, layout: "grid",
  primaryColor: "", primaryContrastColor: "", secondaryColor: "", secondaryContrastColor: "", sectionBgColor: "", infoAlignment: "left",
  titleFontSize: 22, subtitleFontSize: 18, titleBgColor: "", titleTextColor: "", fontFamily: "",
  imageAspectRatio: "square", cardLayoutStyle: "auto", cardBorderRadius: 12, cardBorderColor: "", cardBgColor: "", cardShadow: "soft", showPrice: true, showCompareAtPrice: true,
  ctaText: "Add Bundle to Cart", ctaBorderColor: "", ctaBorderRadius: 12, ctaWidth: "full", ctaPadding: 14, ctaShadow: "none", ctaHoverEnabled: false, ctaHoverBgColor: "", ctaHoverTextColor: "",
  customCss: "",
  clearCartOnAdd: false, postAddRedirect: "none",
  discountPrefix: "", discountSuffix: "",
  currencySymbol: "", showPaymentIcons: false,
  addOrderTags: false, addOrderNotes: false,
  visibilityMode: "all", primaryProductId: "",
  showCheckbox: false, uncheckByDefault: false, selectionMode: "multi",
  enableQuantitySelector: false, quantityMin: 0, quantityMax: 0,
  showTitleIcon: true, titleIconBgColor: "", titleIconColor: "",
  showSavingsBanner: true, savingsAccentBgColor: "", savingsAccentTextColor: "",
  showTrustBadges: true,
};

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();
  const bundle = await Bundle.findOne({ _id: params.id, shopId: session.shop }).lean();
  if (!bundle) throw new Response("Bundle not found", { status: 404 });
  return json({
    title: bundle.title,
    description: bundle.description || "",
    products: bundle.draftProducts || [],
    discountType: bundle.draftDiscountType || "none",
    discountValue: bundle.draftDiscountValue || 0,
    style: { ...DEFAULT_STYLE, ...(bundle.style || {}) },
  });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();
  const bundle = await Bundle.findOne({ _id: params.id, shopId: session.shop });
  if (!bundle) return json({ success: false, error: "Bundle not found" }, { status: 404 });

  const formData = await request.formData();
  const styleJson = String(formData.get("style") || "{}");
  let style: Partial<IBundleStyle> = {};
  try {
    style = JSON.parse(styleJson);
  } catch {
    return json({ success: false, error: "Invalid style payload" }, { status: 400 });
  }

  bundle.style = { ...DEFAULT_STYLE, ...(bundle.style || {}), ...style };
  bundle.markModified("style");
  await bundle.save();
  return json({ success: true });
};

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <InlineStack align="space-between" blockAlign="center">
      <Text as="span">{label}</Text>
      <InlineStack gap="150" blockAlign="center">
        <Text as="span" tone="subdued">{value || "default"}</Text>
        <input type="color" value={value || "#ffffff"} onChange={(e) => onChange(e.target.value)} style={{ width: 32, height: 32, border: "1px solid #d1d5db", borderRadius: 6, padding: 0, cursor: "pointer" }} />
      </InlineStack>
    </InlineStack>
  );
}

const FONT_FAMILY_OPTIONS = [
  { value: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", label: "System sans-serif" },
  { value: "Georgia, 'Times New Roman', serif", label: "Georgia (serif)" },
  { value: "'Helvetica Neue', Helvetica, Arial, sans-serif", label: "Helvetica" },
  { value: "Verdana, Geneva, sans-serif", label: "Verdana" },
  { value: "'Courier New', Courier, monospace", label: "Courier New (monospace)" },
  { value: "'Playfair Display', Georgia, serif", label: "Playfair Display (serif)" },
  { value: "'Poppins', sans-serif", label: "Poppins" },
];

function FontFamilyField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const filtered = value
    ? FONT_FAMILY_OPTIONS.filter((o) => o.label.toLowerCase().includes(value.toLowerCase()))
    : FONT_FAMILY_OPTIONS;

  const textField = (
    <Autocomplete.TextField
      label="Font family"
      value={value}
      onChange={onChange}
      placeholder="Theme default — pick a suggestion or type any CSS font-family"
      helpText="Applies to the whole bundle section, not just the title. Pick from the list or type your own (e.g. a font already loaded by your theme)."
      autoComplete="off"
      clearButton
      onClearButtonClick={() => onChange("")}
    />
  );

  return (
    <Autocomplete
      options={filtered}
      selected={[]}
      onSelect={(selected) => {
        const opt = FONT_FAMILY_OPTIONS.find((o) => o.value === selected[0]);
        if (opt) onChange(opt.value);
      }}
      textField={textField}
    />
  );
}

function Section({ title, subtitle, open, onToggle, children }: { title: string; subtitle: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <Card padding="0">
      <div style={{ padding: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }} onClick={onToggle}>
        <BlockStack gap="0">
          <Text as="h3" variant="headingSm">{title}</Text>
          <Text as="p" tone="subdued" variant="bodySm">{subtitle}</Text>
        </BlockStack>
        <Icon source={open ? ChevronUpIcon : ChevronDownIcon} tone="subdued" />
      </div>
      <Collapsible open={open} id={title}>
        <div style={{ padding: "0 16px 16px" }}>
          <BlockStack gap="300">{children}</BlockStack>
        </div>
      </Collapsible>
    </Card>
  );
}

function shadowCss(shadow: string): string {
  if (shadow === "soft") return "0 1px 4px rgba(0,0,0,0.10)";
  if (shadow === "spread") return "0 6px 20px rgba(0,0,0,0.16)";
  return "none";
}

function GiftIcon({ color }: { color: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="8" width="18" height="4" />
      <path d="M12 8v13" />
      <path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7" />
      <path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8" />
      <path d="M16.5 8a2.5 2.5 0 0 0 0-5C13 3 12 8 12 8" />
    </svg>
  );
}

function TagIcon({ color, size = 14 }: { color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </svg>
  );
}

function PreviewPanel({
  title, description, products, style, discountType, discountValue,
}: {
  title: string; description: string; products: IBundleProduct[]; style: IBundleStyle;
  discountType: string; discountValue: number;
}) {
  const money = (cents: number) => (style.currencySymbol || "₹") + (cents / 100).toFixed(0);
  const isVertical = style.cardLayoutStyle === "vertical" || (style.cardLayoutStyle === "auto" && style.layout === "list");

  const subtotal = products.reduce((sum, p) => sum + p.price, 0);
  let finalPrice = subtotal;
  let hasDiscount = discountType !== "none" && products.length > 0;
  if (hasDiscount) {
    if (discountType === "percentage") finalPrice = Math.round(subtotal * (1 - discountValue / 100));
    else if (discountType === "fixed_amount") finalPrice = Math.max(0, subtotal - discountValue);
    else if (discountType === "fixed_price") finalPrice = Math.min(subtotal, discountValue);
    else hasDiscount = false;
  }
  const savings = subtotal - finalPrice;
  const savingsPct = hasDiscount && subtotal > 0 ? Math.round((savings / subtotal) * 100) : 0;
  const savingsBg = style.savingsAccentBgColor || "#eef7ec";
  const savingsText = style.savingsAccentTextColor || "#2f7a3c";

  return (
    <Card padding="0">
      <div style={{ background: "#eceef1", borderRadius: "8px 8px 0 0", padding: "10px 14px", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#ff5f57", display: "inline-block" }} />
        <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#febc2e", display: "inline-block" }} />
        <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#28c840", display: "inline-block" }} />
        <Text as="span" tone="subdued" variant="bodySm">Bundle Preview</Text>
      </div>
      <div style={{ padding: 20, background: style.sectionBgColor || "#fafafa", textAlign: style.infoAlignment, fontFamily: style.fontFamily || undefined }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: style.infoAlignment === "center" ? "center" : style.infoAlignment === "right" ? "flex-end" : "flex-start" }}>
          <div
            style={{
              fontSize: style.titleFontSize, fontWeight: 700, fontFamily: "Georgia, 'Times New Roman', serif",
              color: style.titleTextColor || "#1a1a1a", background: style.titleBgColor || "transparent",
              padding: style.titleBgColor ? 8 : 0, borderRadius: 8,
            }}
          >
            {title || "Campaign title"}
          </div>
          {style.showTitleIcon && (
            <span style={{ flex: "none", width: 40, height: 40, borderRadius: "50%", background: style.titleIconBgColor || "#eef7ec", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <GiftIcon color={style.titleIconColor || "#1a1a1a"} />
            </span>
          )}
        </div>
        {description && (
          <div style={{ fontSize: style.subtitleFontSize, color: style.secondaryColor || "#6b7280", marginTop: 2 }}>
            {description}
          </div>
        )}
        {style.showSavingsBanner && hasDiscount && (
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, marginTop: 10, padding: "10px 16px", background: savingsBg, color: savingsText, border: "1px solid rgba(0,0,0,0.06)", borderRadius: 999, fontSize: 13, fontWeight: 600 }}>
            <TagIcon color={savingsText} />
            <span>Save {money(savings)} ({savingsPct}%) on this bundle</span>
          </div>
        )}
        <div style={{ marginTop: 14, display: "flex", flexDirection: isVertical ? "column" : "row", flexWrap: "wrap", gap: 12 }}>
          {products.map((p) => {
            const showCompare = style.showCompareAtPrice && !!p.compareAtPrice && p.compareAtPrice > p.price;
            const pctOff = showCompare ? Math.round((1 - p.price / (p.compareAtPrice as number)) * 100) : 0;
            return (
              <div
                key={p.shopifyProductId}
                style={{
                  display: "flex", gap: 10, alignItems: isVertical ? "flex-start" : "center", flexDirection: isVertical ? "column" : "row",
                  background: style.cardBgColor || "#ffffff",
                  border: `1px solid ${style.cardBorderColor || "#e5e7eb"}`,
                  borderRadius: style.cardBorderRadius, padding: 10,
                  boxShadow: shadowCss(style.cardShadow), flex: isVertical ? undefined : "1 1 200px",
                }}
              >
                {p.imageUrl && (
                  <img
                    src={p.imageUrl} alt={p.title}
                    style={{ width: isVertical ? "100%" : 48, height: style.imageAspectRatio === "portrait" ? 64 : 48, objectFit: "cover", borderRadius: 6 }}
                  />
                )}
                <div style={{ minWidth: 0 }}>
                  <Text as="p" variant="bodySm" fontWeight="semibold" truncate>{p.title}</Text>
                  {style.showPrice && (
                    <BlockStack gap="050">
                      {showCompare && (
                        <Text as="span" tone="subdued" textDecorationLine="line-through">{money(p.compareAtPrice as number)}</Text>
                      )}
                      {showCompare && (
                        <span style={{ display: "inline-block", width: "fit-content", background: savingsBg, color: savingsText, fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999 }}>
                          {pctOff}% OFF
                        </span>
                      )}
                      <Text as="span">{money(p.price)}</Text>
                    </BlockStack>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {products.length > 0 && (
          hasDiscount ? (
            <div style={{ marginTop: 14, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "14px 16px", border: "1px solid #ececec", borderRadius: 12 }}>
              <BlockStack gap="100">
                <Text as="span" tone="subdued" variant="bodySm">Total Price</Text>
                <Text as="span" variant="headingLg">{money(finalPrice)}</Text>
                <InlineStack gap="200" blockAlign="center">
                  <Text as="span" tone="subdued" textDecorationLine="line-through">{money(subtotal)}</Text>
                  <span style={{ fontSize: 12, fontWeight: 600, color: savingsText, background: savingsBg, padding: "2px 10px", borderRadius: 999 }}>You Save {money(savings)}</span>
                </InlineStack>
              </BlockStack>
              <div style={{ width: 1, alignSelf: "stretch", background: "#e5e7eb" }} />
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ flex: "none", width: 32, height: 32, borderRadius: "50%", background: savingsBg, color: savingsText, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <TagIcon color={savingsText} />
                </span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: savingsText }}>{savingsPct}% Total Savings</div>
                  <div style={{ fontSize: 12, color: "#6b7280" }}>Great choice!</div>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 14, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "14px 16px", border: "1px solid #ececec", borderRadius: 12 }}>
              <Text as="span" tone="subdued" variant="bodySm">Total Price</Text>
              <Text as="span" variant="headingLg">{money(subtotal)}</Text>
            </div>
          )
        )}

        <button
          type="button"
          disabled
          style={{
            marginTop: 14, cursor: "default", border: `1px solid ${style.ctaBorderColor || "transparent"}`,
            width: style.ctaWidth === "full" ? "100%" : "auto",
            padding: style.ctaPadding, borderRadius: style.ctaBorderRadius,
            background: style.buttonColor || style.primaryColor || "#1a1a1a",
            color: style.buttonTextColor || style.primaryContrastColor || "#ffffff",
            boxShadow: shadowCss(style.ctaShadow), fontWeight: 700,
          }}
        >
          {style.ctaText || "Add Bundle to Cart"}
        </button>
        {style.showPaymentIcons && (
          <div style={{ marginTop: 8, textAlign: "center" }}>
            <Text as="span" tone="subdued" variant="bodySm">Visa • Mastercard • UPI • RuPay</Text>
          </div>
        )}
        {style.showTrustBadges && (
          <div style={{ marginTop: 10, display: "flex", alignItems: "center", justifyContent: "center", gap: 12, fontSize: 12, color: "#6b7280" }}>
            <span>🛡️ Secure Checkout</span>
            <span style={{ width: 1, height: 12, background: "#d1d5db" }} />
            <span>↩️ Easy Returns</span>
          </div>
        )}
      </div>
    </Card>
  );
}

export default function BundleGenieCustomize() {
  const { title, description, products, discountType, discountValue, style: initialStyle } = useLoaderData<typeof loader>();
  const { id } = useParams();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isSaving = navigation.state === "submitting";

  const [style, setStyle] = useState<IBundleStyle>(initialStyle);
  const set = <K extends keyof IBundleStyle>(key: K, value: IBundleStyle[K]) =>
    setStyle((prev) => ({ ...prev, [key]: value }));

  const [openSection, setOpenSection] = useState("branding");
  const toggle = (key: string) => setOpenSection((prev) => (prev === key ? "" : key));

  const save = useCallback(() => {
    const fd = new FormData();
    fd.set("style", JSON.stringify(style));
    submit(fd, { method: "post" });
  }, [style, submit]);

  return (
    <Page
      title="Customize Bundle"
      subtitle={title}
      backAction={{ url: `/app/bundle-genie/bundles/${id}` }}
      primaryAction={{ content: "Save", loading: isSaving, onAction: save }}
    >
      <BlockStack gap="400">
        <Banner tone="info">
          <p>
            Still not built: Checkout Partner selection (only integrating providers after
            verifying their real trigger API, same rule applied everywhere else in this app),
            Variant Config and Product Ratings (different data models this app doesn't have),
            Freebies (no gift-item mechanism yet), and out-of-stock detection (needs a live
            inventory lookup this endpoint doesn't do yet). Everything else from the reference —
            branding, typography, product cards, CTA button, cart/redirect behavior, discount
            naming, and order tagging — is real and wired to the actual storefront widget below.
          </p>
        </Banner>

        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">Select theme</Text>
              <Button variant="plain" onClick={() => setStyle(DEFAULT_STYLE)}>Reset to Default</Button>
            </InlineStack>
            <Select
              label="Theme preset"
              labelHidden
              options={[{ label: "Default", value: "default" }]}
              value="default"
              onChange={() => {}}
              helpText="Only one preset exists right now — Reset to Default reapplies it."
            />
            <TextField label="CTA Button Text" value={style.ctaText} onChange={(v) => set("ctaText", v)} autoComplete="off" maxLength={60} />
          </BlockStack>
        </Card>

        <div style={{ display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 420px", minWidth: 0 }}>
            <BlockStack gap="300">
              <Section title="Branding" subtitle="Brand colors and section alignment" open={openSection === "branding"} onToggle={() => toggle("branding")}>
                <ColorField label="Primary color" value={style.primaryColor} onChange={(v) => set("primaryColor", v)} />
                <ColorField label="Primary contrast color" value={style.primaryContrastColor} onChange={(v) => set("primaryContrastColor", v)} />
                <ColorField label="Secondary color" value={style.secondaryColor} onChange={(v) => set("secondaryColor", v)} />
                <ColorField label="Secondary contrast color" value={style.secondaryContrastColor} onChange={(v) => set("secondaryContrastColor", v)} />
                <ColorField label="Section background color" value={style.sectionBgColor} onChange={(v) => set("sectionBgColor", v)} />
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="span">Info alignment</Text>
                  <ButtonGroup variant="segmented">
                    {(["left", "center", "right"] as const).map((v) => (
                      <Button key={v} pressed={style.infoAlignment === v} onClick={() => set("infoAlignment", v)}>
                        {v[0].toUpperCase() + v.slice(1)}
                      </Button>
                    ))}
                  </ButtonGroup>
                </InlineStack>
              </Section>

              <Section title="Title & header" subtitle="Bundle heading typography and background" open={openSection === "title"} onToggle={() => toggle("title")}>
                <FontFamilyField value={style.fontFamily} onChange={(v) => set("fontFamily", v)} />
                <RangeSlider label={`Title font size — ${style.titleFontSize}px`} min={14} max={40} value={style.titleFontSize} onChange={(v) => set("titleFontSize", v as number)} output />
                <RangeSlider label={`Subtitle font size — ${style.subtitleFontSize}px`} min={10} max={28} value={style.subtitleFontSize} onChange={(v) => set("subtitleFontSize", v as number)} output />
                <ColorField label="Title background color" value={style.titleBgColor} onChange={(v) => set("titleBgColor", v)} />
                <ColorField label="Title text color" value={style.titleTextColor} onChange={(v) => set("titleTextColor", v)} />
              </Section>

              <Section title="Product Section" subtitle="Product card styling and content visibility" open={openSection === "cards"} onToggle={() => toggle("cards")}>
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="span">Image aspect ratio</Text>
                  <ButtonGroup variant="segmented">
                    <Button pressed={style.imageAspectRatio === "square"} onClick={() => set("imageAspectRatio", "square")}>Square (1/1)</Button>
                    <Button pressed={style.imageAspectRatio === "portrait"} onClick={() => set("imageAspectRatio", "portrait")}>Portrait (4/5)</Button>
                  </ButtonGroup>
                </InlineStack>
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="span">Card layout style</Text>
                  <ButtonGroup variant="segmented">
                    {(["horizontal", "vertical", "auto"] as const).map((v) => (
                      <Button key={v} pressed={style.cardLayoutStyle === v} onClick={() => set("cardLayoutStyle", v)}>
                        {v[0].toUpperCase() + v.slice(1)}
                      </Button>
                    ))}
                  </ButtonGroup>
                </InlineStack>
                <RangeSlider label={`Card border radius — ${style.cardBorderRadius}px`} min={0} max={40} value={style.cardBorderRadius} onChange={(v) => set("cardBorderRadius", v as number)} output />
                <ColorField label="Card border color" value={style.cardBorderColor} onChange={(v) => set("cardBorderColor", v)} />
                <ColorField label="Card background color" value={style.cardBgColor} onChange={(v) => set("cardBgColor", v)} />
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="span">Shadow type</Text>
                  <ButtonGroup variant="segmented">
                    {(["none", "soft", "spread"] as const).map((v) => (
                      <Button key={v} pressed={style.cardShadow === v} onClick={() => set("cardShadow", v)}>
                        {v[0].toUpperCase() + v.slice(1)}
                      </Button>
                    ))}
                  </ButtonGroup>
                </InlineStack>
                <Checkbox label="Show product price" checked={style.showPrice} onChange={(v) => set("showPrice", v)} />
                <Checkbox label="Show compare-at price" checked={style.showCompareAtPrice} onChange={(v) => set("showCompareAtPrice", v)} />
              </Section>

              <Section title="CTA button" subtitle="Style and behavior of the call-to-action button" open={openSection === "cta"} onToggle={() => toggle("cta")}>
                <TextField label="Button text" value={style.ctaText} onChange={(v) => set("ctaText", v)} autoComplete="off" maxLength={60} />
                <ColorField label="Border color" value={style.ctaBorderColor} onChange={(v) => set("ctaBorderColor", v)} />
                <RangeSlider label={`Border radius — ${style.ctaBorderRadius}px`} min={0} max={40} value={style.ctaBorderRadius} onChange={(v) => set("ctaBorderRadius", v as number)} output />
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="span">Width</Text>
                  <ButtonGroup variant="segmented">
                    <Button pressed={style.ctaWidth === "fit"} onClick={() => set("ctaWidth", "fit")}>Fit content</Button>
                    <Button pressed={style.ctaWidth === "full"} onClick={() => set("ctaWidth", "full")}>Full width</Button>
                  </ButtonGroup>
                </InlineStack>
                <RangeSlider label={`Padding — ${style.ctaPadding}px`} min={4} max={28} value={style.ctaPadding} onChange={(v) => set("ctaPadding", v as number)} output />
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="span">Shadow type</Text>
                  <ButtonGroup variant="segmented">
                    {(["none", "soft", "spread"] as const).map((v) => (
                      <Button key={v} pressed={style.ctaShadow === v} onClick={() => set("ctaShadow", v)}>
                        {v[0].toUpperCase() + v.slice(1)}
                      </Button>
                    ))}
                  </ButtonGroup>
                </InlineStack>
                <Checkbox label="Customize hover state" checked={style.ctaHoverEnabled} onChange={(v) => set("ctaHoverEnabled", v)} />
                {style.ctaHoverEnabled && (
                  <>
                    <ColorField label="Hover background color" value={style.ctaHoverBgColor} onChange={(v) => set("ctaHoverBgColor", v)} />
                    <ColorField label="Hover text color" value={style.ctaHoverTextColor} onChange={(v) => set("ctaHoverTextColor", v)} />
                  </>
                )}
              </Section>

              <Section title="Savings & badges" subtitle="Title icon, savings banner, and trust badges" open={openSection === "savings"} onToggle={() => toggle("savings")}>
                <Checkbox label="Show gift icon next to the title" checked={style.showTitleIcon} onChange={(v) => set("showTitleIcon", v)} />
                {style.showTitleIcon && (
                  <>
                    <ColorField label="Title icon background color" value={style.titleIconBgColor} onChange={(v) => set("titleIconBgColor", v)} />
                    <ColorField label="Title icon color" value={style.titleIconColor} onChange={(v) => set("titleIconColor", v)} />
                  </>
                )}
                <Checkbox label="Show savings banner (only appears when the bundle has a discount)" checked={style.showSavingsBanner} onChange={(v) => set("showSavingsBanner", v)} />
                <Text as="p" tone="subdued">
                  Applies to the savings banner, each product's "% OFF" badge, the "You Save" pill,
                  and the total-savings panel — one accent color used everywhere.
                </Text>
                <ColorField label="Savings accent background color" value={style.savingsAccentBgColor} onChange={(v) => set("savingsAccentBgColor", v)} />
                <ColorField label="Savings accent text color" value={style.savingsAccentTextColor} onChange={(v) => set("savingsAccentTextColor", v)} />
                <Checkbox label="Show Secure Checkout / Easy Returns row under the button" checked={style.showTrustBadges} onChange={(v) => set("showTrustBadges", v)} />
              </Section>

              <Section title="Discounts" subtitle="Naming for the automatic discount this campaign creates" open={openSection === "discounts"} onToggle={() => toggle("discounts")}>
                <Text as="p" tone="subdued">
                  Changes how the discount shows up in your Shopify admin's Discounts list —
                  doesn't affect the discount amount, which is set on the campaign's Pricing
                  section.
                </Text>
                <TextField label="Discount title prefix" value={style.discountPrefix} onChange={(v) => set("discountPrefix", v)} autoComplete="off" maxLength={40} placeholder="e.g. Bundle Genie" />
                <TextField label="Discount title suffix" value={style.discountSuffix} onChange={(v) => set("discountSuffix", v)} autoComplete="off" maxLength={40} placeholder="e.g. (auto)" />
              </Section>

              <Section title="Advanced Settings" subtitle="Cart behavior, currency, and order handling" open={openSection === "advanced"} onToggle={() => toggle("advanced")}>
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="span">After adding to cart, redirect to</Text>
                  <ButtonGroup variant="segmented">
                    {(["none", "cart", "checkout"] as const).map((v) => (
                      <Button key={v} pressed={style.postAddRedirect === v} onClick={() => set("postAddRedirect", v)}>
                        {v === "none" ? "Stay on page" : v[0].toUpperCase() + v.slice(1)}
                      </Button>
                    ))}
                  </ButtonGroup>
                </InlineStack>
                <Checkbox label="Clear cart before adding this bundle" checked={style.clearCartOnAdd} onChange={(v) => set("clearCartOnAdd", v)} />
                <TextField label="Currency symbol override" value={style.currencySymbol} onChange={(v) => set("currencySymbol", v)} autoComplete="off" maxLength={6} placeholder="Leave blank to use your theme's money format" />
                <Checkbox label="Show payment method icons under the button" checked={style.showPaymentIcons} onChange={(v) => set("showPaymentIcons", v)} />
                <Checkbox label="Tag the order when it contains this bundle" checked={style.addOrderTags} onChange={(v) => set("addOrderTags", v)} />
                <Checkbox label="Add a note to the order when it contains this bundle" checked={style.addOrderNotes} onChange={(v) => set("addOrderNotes", v)} />
              </Section>

              <Section title="Custom CSS" subtitle="Write custom CSS to override bundle styling" open={openSection === "css"} onToggle={() => toggle("css")}>
                <Text as="p" tone="subdued">
                  Applied after every other style option, scoped under <code>.bg-genie-card</code>.
                </Text>
                <TextField
                  label="Custom CSS"
                  labelHidden
                  value={style.customCss}
                  onChange={(v) => set("customCss", v)}
                  multiline={10}
                  autoComplete="off"
                  monospaced
                />
              </Section>
            </BlockStack>
          </div>

          <div style={{ flex: "1 1 320px", minWidth: 280, position: "sticky", top: 16 }}>
            <PreviewPanel title={title} description={description} products={products} style={style} discountType={discountType} discountValue={discountValue} />
            {!description && (
              <div style={{ marginTop: 8 }}>
                <Text as="p" tone="subdued" variant="bodySm">
                  The subtitle line under the title (e.g. "Pair Up &amp; Save!") comes from the
                  campaign's Description field — it's empty right now, so nothing shows. Set it
                  on the <a href={`/app/bundle-genie/bundles/${id}`}>campaign's edit page</a>.
                </Text>
              </div>
            )}
          </div>
        </div>
      </BlockStack>
    </Page>
  );
}
