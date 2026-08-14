import { json, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useNavigate, useSubmit, useNavigation } from "@remix-run/react";
import {
  Page, Card, BlockStack, Text, TextField, Button, Select, Banner,
  InlineStack, Divider, Badge, InlineGrid, Checkbox,
} from "@shopify/polaris";
import { ArrowUpIcon, ArrowDownIcon, DeleteIcon } from "@shopify/polaris-icons";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import { connectDB } from "../db.server";
import { Bundle, type IBundleProduct } from "../.server/models/bundle.model";
import { syncBundleVersionDiscount, deleteBundleDiscount } from "../.server/services/bundle-discount.service";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();
  const shopId = session.shop;

  const bundle = await Bundle.findOne({ _id: params.id, shopId }).lean();
  if (!bundle) throw new Response("Bundle not found", { status: 404 });

  return json({ bundle: JSON.parse(JSON.stringify(bundle)), shopDomain: shopId });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  await connectDB();
  const shopId = session.shop;

  const bundle = await Bundle.findOne({ _id: params.id, shopId });
  if (!bundle) return json({ success: false, error: "Bundle not found" }, { status: 404 });

  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");
  const latestVersion = bundle.versions[bundle.versions.length - 1];

  if (intent === "archive") {
    // Real cleanup, not just a status flip — an archived bundle's discount
    // must stop applying, not linger active in the merchant's Shopify
    // Discounts list.
    if (latestVersion?.shopifyDiscountId) {
      await deleteBundleDiscount(admin as any, latestVersion.shopifyDiscountId);
      latestVersion.shopifyDiscountId = "";
      bundle.markModified("versions");
    }
    bundle.status = "archived";
    await bundle.save();
    return redirect("/app/bundle-genie/bundles");
  }

  if (intent === "pause") {
    // Same reasoning as archive — a paused bundle must not keep discounting
    // orders. Re-created on resume from the same version snapshot.
    if (latestVersion?.shopifyDiscountId) {
      await deleteBundleDiscount(admin as any, latestVersion.shopifyDiscountId);
      latestVersion.shopifyDiscountId = "";
      bundle.markModified("versions");
    }
    bundle.status = "paused";
    await bundle.save();
    return json({ success: true });
  }

  if (intent === "resume") {
    if (latestVersion && !latestVersion.shopifyDiscountId) {
      latestVersion.shopifyDiscountId = await syncBundleVersionDiscount(
        admin as any, { title: bundle.title, style: bundle.style }, latestVersion,
      );
      bundle.markModified("versions");
    }
    bundle.status = bundle.currentVersion > 0 ? "active" : "draft";
    await bundle.save();
    return json({ success: true });
  }

  if (intent === "duplicate") {
    const copy = new Bundle({
      shopId,
      type: bundle.type,
      internalName: bundle.internalName + " (copy)",
      title: bundle.title + " (copy)",
      handle: bundle.handle + "-copy-" + Date.now().toString(36),
      description: bundle.description,
      status: "draft",
      featuredImageUrl: bundle.featuredImageUrl,
      draftProducts: bundle.draftProducts,
      draftDiscountType: bundle.draftDiscountType,
      draftDiscountValue: bundle.draftDiscountValue,
      style: bundle.style,
      currentVersion: 0,
      versions: [],
    });
    await copy.save();
    return redirect(`/app/bundle-genie/bundles/${copy._id}`);
  }

  // "draft" or "publish" — update the working copy, optionally cut a new
  // immutable version. Never mutate an already-published version in place.
  const internalName = String(formData.get("internalName") || "").trim();
  const title = String(formData.get("title") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const discountType = String(formData.get("discountType") || "percentage");
  const discountValue = Number(formData.get("discountValue")) || 0;
  const bgColor = String(formData.get("bgColor") || "").slice(0, 20);
  const textColor = String(formData.get("textColor") || "").slice(0, 20);
  const buttonColor = String(formData.get("buttonColor") || "").slice(0, 20);
  const buttonTextColor = String(formData.get("buttonTextColor") || "").slice(0, 20);
  const borderRadius = Math.min(40, Math.max(0, Number(formData.get("borderRadius")) || 12));
  const layout = formData.get("layout") === "list" ? "list" : "grid";
  const visibilityMode = formData.get("visibilityMode") === "primary" ? "primary" : "all";
  const primaryProductId = String(formData.get("primaryProductId") || "");
  const showCheckbox = formData.get("showCheckbox") === "true";
  const uncheckByDefault = formData.get("uncheckByDefault") === "true";
  const selectionMode = formData.get("selectionMode") === "single" ? "single" : "multi";
  const enableQuantitySelector = formData.get("enableQuantitySelector") === "true";
  const quantityMin = Math.max(0, Number(formData.get("quantityMin")) || 0);
  const quantityMax = Math.max(0, Number(formData.get("quantityMax")) || 0);

  let products: IBundleProduct[] = [];
  try {
    products = JSON.parse(String(formData.get("products") || "[]"));
  } catch {
    products = [];
  }

  if (!internalName || !title) {
    return json({ success: false, error: "Internal name and title are required." }, { status: 400 });
  }
  if (products.length < 2) {
    return json({ success: false, error: "A Fixed Product Bundle needs at least 2 products." }, { status: 400 });
  }

  bundle.internalName = internalName;
  bundle.title = title;
  bundle.description = description;
  bundle.draftProducts = products;
  bundle.draftDiscountType = discountType as any;
  bundle.draftDiscountValue = discountValue;
  // Merge, not replace — the Customize screen sets many more style fields
  // than this form exposes, and this save shouldn't wipe them out.
  bundle.style = {
    ...(bundle.style || {}),
    bgColor, textColor, buttonColor, buttonTextColor, borderRadius, layout,
    visibilityMode, primaryProductId, showCheckbox, uncheckByDefault, selectionMode,
    enableQuantitySelector, quantityMin, quantityMax,
  } as typeof bundle.style;
  bundle.markModified("style");

  if (intent === "publish") {
    const nextVersion = bundle.currentVersion + 1;
    const version = {
      version: nextVersion,
      products,
      discountType: discountType as any,
      discountValue,
      publishedAt: new Date(),
      shopifyDiscountId: "",
    };
    // Carrying the previous version's discount ID forward updates that same
    // Shopify discount in place (new product list/value) instead of leaving
    // an orphaned one active alongside a new one.
    version.shopifyDiscountId = await syncBundleVersionDiscount(
      admin as any, { title, style: bundle.style }, version, latestVersion?.shopifyDiscountId,
    );
    bundle.versions.push(version);
    bundle.currentVersion = nextVersion;
    bundle.status = "active";
  }

  await bundle.save();
  return json({ success: true });
};

function formatMoney(minorUnits: number): string {
  return "₹" + (minorUnits / 100).toFixed(0);
}

function BundlePreviewPanel({
  title, description, products, discountType, discountValue, bgColor, textColor, buttonColor, buttonTextColor, borderRadius, layout,
}: {
  title: string; description: string; products: IBundleProduct[];
  discountType: string; discountValue: number;
  bgColor: string; textColor: string; buttonColor: string; buttonTextColor: string; borderRadius: string; layout: string;
}) {
  const subtotal = products.reduce((sum, p) => sum + p.price * (p.defaultQuantity || 1), 0);
  let finalPrice = subtotal;
  if (discountType === "percentage") finalPrice = Math.round(subtotal * (1 - Math.min(discountValue, 100) / 100));
  else if (discountType === "fixed_amount") finalPrice = Math.max(0, subtotal - discountValue * 100);
  else if (discountType === "fixed_price") finalPrice = Math.min(subtotal, discountValue * 100);
  const hasDiscount = discountType !== "none" && discountValue > 0;

  return (
    <Card padding="0">
      <div style={{ background: "#eceef1", borderRadius: "8px 8px 0 0", padding: "10px 14px", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#ff5f57", display: "inline-block" }} />
        <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#febc2e", display: "inline-block" }} />
        <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#28c840", display: "inline-block" }} />
        <Text as="span" tone="subdued" variant="bodySm">Bundle Preview</Text>
      </div>
      <div style={{ padding: 20, background: "#fafafa" }}>
        <div
          style={{
            background: bgColor || "#ffffff",
            color: textColor || "#1a1a1a",
            borderRadius: `${borderRadius || 12}px`,
            padding: 18,
            boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
          }}
        >
          <Text as="h3" variant="headingMd">{title || "Campaign title"}</Text>
          {description && <Text as="p" tone="subdued">{description}</Text>}
          <div style={{ marginTop: 12, display: "flex", flexDirection: layout === "list" ? "column" : "row", flexWrap: "wrap", gap: 10 }}>
            {products.length === 0 && (
              <Text as="p" tone="subdued">Add products to see them here.</Text>
            )}
            {products.map((p) => (
              <div key={p.shopifyProductId} style={{ display: "flex", alignItems: "center", gap: 10, flex: layout === "grid" ? "1 1 160px" : undefined }}>
                {p.imageUrl && (
                  <img src={p.imageUrl} alt={p.title} style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 6 }} />
                )}
                <div style={{ minWidth: 0 }}>
                  <Text as="p" variant="bodySm" fontWeight="semibold" truncate>{p.title}</Text>
                  <Text as="p" variant="bodySm" tone="subdued">{formatMoney(p.price * (p.defaultQuantity || 1))}</Text>
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 14, display: "flex", alignItems: "baseline", gap: 10 }}>
            {hasDiscount && (
              <Text as="span" tone="subdued" textDecorationLine="line-through">{formatMoney(subtotal)}</Text>
            )}
            <Text as="span" variant="headingLg">{formatMoney(finalPrice)}</Text>
          </div>
          <button
            type="button"
            disabled
            style={{
              marginTop: 12, width: "100%", padding: 12, border: "none", cursor: "default",
              background: buttonColor || "#1a1a1a", color: buttonTextColor || "#ffffff",
              borderRadius: `${Math.min(Number(borderRadius) || 12, 20)}px`, fontWeight: 700,
            }}
          >
            Add Bundle to Cart
          </button>
        </div>
      </div>
    </Card>
  );
}

export default function BundleGenieEdit() {
  const { bundle, shopDomain } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const submit = useSubmit();
  const navigation = useNavigation();
  const shopify = useAppBridge();
  const isSaving = navigation.state === "submitting";

  const [internalName, setInternalName] = useState(bundle.internalName);
  const [title, setTitle] = useState(bundle.title);
  const [description, setDescription] = useState(bundle.description || "");
  const [discountType, setDiscountType] = useState(bundle.draftDiscountType || "percentage");
  const [discountValue, setDiscountValue] = useState(String(bundle.draftDiscountValue ?? 10));
  const [products, setProducts] = useState<IBundleProduct[]>(bundle.draftProducts || []);
  const [productSearch, setProductSearch] = useState("");
  const [bgColor, setBgColor] = useState(bundle.style?.bgColor || "");
  const [textColor, setTextColor] = useState(bundle.style?.textColor || "");
  const [buttonColor, setButtonColor] = useState(bundle.style?.buttonColor || "");
  const [buttonTextColor, setButtonTextColor] = useState(bundle.style?.buttonTextColor || "");
  const [borderRadius, setBorderRadius] = useState(String(bundle.style?.borderRadius ?? 12));
  const [layout, setLayout] = useState(bundle.style?.layout || "grid");
  const [visibilityMode, setVisibilityMode] = useState<"primary" | "all">(bundle.style?.visibilityMode || "all");
  const [primaryProductId, setPrimaryProductId] = useState(bundle.style?.primaryProductId || "");
  const [showCheckbox, setShowCheckbox] = useState(bundle.style?.showCheckbox ?? false);
  const [uncheckByDefault, setUncheckByDefault] = useState(bundle.style?.uncheckByDefault ?? false);
  const [selectionMode, setSelectionMode] = useState<"multi" | "single">(bundle.style?.selectionMode || "multi");
  const [enableQuantitySelector, setEnableQuantitySelector] = useState(bundle.style?.enableQuantitySelector ?? false);
  const [quantityMin, setQuantityMin] = useState(String(bundle.style?.quantityMin || ""));
  const [quantityMax, setQuantityMax] = useState(String(bundle.style?.quantityMax || ""));
  const [error, setError] = useState("");

  const handleBrowseProducts = useCallback(async () => {
    setError("");
    try {
      const selected = await shopify.resourcePicker({
        type: "product",
        multiple: true,
        action: "select",
      });
      if (!selected || selected.length === 0) return;

      const already = new Set(products.map((p) => p.shopifyProductId));
      const picked: IBundleProduct[] = [];
      let position = products.length;

      for (const product of selected as any[]) {
        if (already.has(product.id)) continue;
        const variant = product.variants?.[0];
        picked.push({
          shopifyProductId: product.id,
          shopifyVariantId: variant?.id || "",
          title: product.title,
          handle: product.handle,
          imageUrl: product.images?.[0]?.originalSrc || product.images?.[0]?.url || "",
          price: Math.round(parseFloat(variant?.price || "0") * 100),
          compareAtPrice: variant?.compareAtPrice
            ? Math.round(parseFloat(variant.compareAtPrice) * 100)
            : undefined,
          required: true,
          minQuantity: 1,
          maxQuantity: 10,
          defaultQuantity: 1,
          position: position++,
        });
      }
      setProducts((prev) => [...prev, ...picked]);
    } catch (err) {
      if (err instanceof Error && err.message) setError(err.message);
    }
  }, [shopify, products]);

  const removeProduct = useCallback((shopifyProductId: string) => {
    setProducts((prev) => prev.filter((p) => p.shopifyProductId !== shopifyProductId));
  }, []);

  const moveProduct = useCallback((index: number, direction: -1 | 1) => {
    setProducts((prev) => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next.map((p, i) => ({ ...p, position: i }));
    });
  }, []);

  const changeQuantity = useCallback((shopifyProductId: string, delta: number) => {
    setProducts((prev) =>
      prev.map((p) =>
        p.shopifyProductId === shopifyProductId
          ? { ...p, defaultQuantity: Math.max(p.minQuantity || 1, Math.min(p.maxQuantity || 10, (p.defaultQuantity || 1) + delta)) }
          : p,
      ),
    );
  }, []);

  const save = useCallback((intent: "draft" | "publish") => {
    if (!internalName.trim() || !title.trim()) {
      setError("Internal name and title are required.");
      return;
    }
    if (products.length < 2) {
      setError("Add at least 2 products.");
      return;
    }
    setError("");
    const fd = new FormData();
    fd.set("internalName", internalName);
    fd.set("title", title);
    fd.set("description", description);
    fd.set("discountType", discountType);
    fd.set("discountValue", discountValue);
    fd.set("products", JSON.stringify(products));
    fd.set("bgColor", bgColor);
    fd.set("textColor", textColor);
    fd.set("buttonColor", buttonColor);
    fd.set("buttonTextColor", buttonTextColor);
    fd.set("borderRadius", borderRadius);
    fd.set("layout", layout);
    fd.set("visibilityMode", visibilityMode);
    fd.set("primaryProductId", primaryProductId || products[0]?.shopifyProductId || "");
    fd.set("showCheckbox", String(showCheckbox));
    fd.set("uncheckByDefault", String(uncheckByDefault));
    fd.set("selectionMode", selectionMode);
    fd.set("enableQuantitySelector", String(enableQuantitySelector));
    fd.set("quantityMin", quantityMin || "0");
    fd.set("quantityMax", quantityMax || "0");
    fd.set("intent", intent);
    submit(fd, { method: "post" });
  }, [
    internalName, title, description, discountType, discountValue, products,
    bgColor, textColor, buttonColor, buttonTextColor, borderRadius, layout, submit,
    visibilityMode, primaryProductId, showCheckbox, uncheckByDefault, selectionMode,
    enableQuantitySelector, quantityMin, quantityMax,
  ]);

  const runIntent = useCallback((intent: string) => {
    const fd = new FormData();
    fd.set("intent", intent);
    submit(fd, { method: "post" });
  }, [submit]);

  const confirmAndArchive = useCallback(() => {
    if (window.confirm(`Delete "${bundle.title}"? This pauses its discount and hides it everywhere — it can still be found under the Archived filter.`)) {
      runIntent("archive");
    }
  }, [bundle.title, runIntent]);

  const visibleProducts = productSearch
    ? products.filter((p) => p.title.toLowerCase().includes(productSearch.toLowerCase()))
    : products;
  const storefrontUrl = products[0]?.handle ? `https://${shopDomain}/products/${products[0].handle}` : "";

  return (
    <Page
      title={bundle.title}
      subtitle="Fixed Product Bundle"
      titleMetadata={<Badge tone={bundle.status === "active" ? "success" : "info"}>{bundle.status}</Badge>}
      backAction={{ url: "/app/bundle-genie/bundles" }}
      secondaryActions={[
        ...(bundle.status !== "draft" && bundle.status !== "archived"
          ? [bundle.status === "active"
              ? { content: "Disable", onAction: () => runIntent("pause") }
              : { content: "Enable", onAction: () => runIntent("resume") }]
          : []),
        { content: "Duplicate", onAction: () => runIntent("duplicate") },
        ...(storefrontUrl ? [{ content: "View", onAction: () => window.open(storefrontUrl, "_blank") }] : []),
        { content: "Customize Bundle", url: `/app/bundle-genie/bundles/${bundle._id}/customize` },
        ...(bundle.status !== "archived"
          ? [{ content: "Delete", destructive: true, onAction: confirmAndArchive }]
          : []),
      ]}
    >
      <BlockStack gap="400">
        {error && <Banner tone="critical" onDismiss={() => setError("")}>{error}</Banner>}
        {bundle.currentVersion > 0 && (
          <Banner tone="info">
            Currently live as version {bundle.currentVersion}. Changes below are a draft until you click Publish.
          </Banner>
        )}

        <div style={{ display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ flex: "2 1 480px", minWidth: 0 }}>
            <BlockStack gap="400">
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">Basic information</Text>
                  <TextField
                    label="Internal name"
                    value={internalName}
                    onChange={setInternalName}
                    autoComplete="off"
                    maxLength={80}
                  />
                  <TextField
                    label="Campaign title"
                    value={title}
                    onChange={setTitle}
                    autoComplete="off"
                    maxLength={120}
                  />
                  <TextField
                    label="Description"
                    value={description}
                    onChange={setDescription}
                    multiline={3}
                    autoComplete="off"
                    maxLength={2000}
                  />
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h2" variant="headingMd">Products in Bundle ({products.length})</Text>
                  </InlineStack>
                  {products.length > 3 && (
                    <TextField
                      label="Search products in this bundle"
                      labelHidden
                      placeholder="Search"
                      value={productSearch}
                      onChange={setProductSearch}
                      autoComplete="off"
                      clearButton
                      onClearButtonClick={() => setProductSearch("")}
                    />
                  )}
                  {visibleProducts.map((p) => {
                    const index = products.findIndex((x) => x.shopifyProductId === p.shopifyProductId);
                    return (
                      <div
                        key={p.shopifyProductId}
                        style={{
                          display: "flex", alignItems: "center", gap: "10px",
                          padding: "10px", border: "1px solid #e0e0e0", borderRadius: "8px",
                        }}
                      >
                        <BlockStack gap="0">
                          <Button size="micro" variant="tertiary" icon={ArrowUpIcon} disabled={index === 0} accessibilityLabel="Move up" onClick={() => moveProduct(index, -1)} />
                          <Button size="micro" variant="tertiary" icon={ArrowDownIcon} disabled={index === products.length - 1} accessibilityLabel="Move down" onClick={() => moveProduct(index, 1)} />
                        </BlockStack>
                        {p.imageUrl && (
                          <img src={p.imageUrl} alt={p.title} style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 6 }} />
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <Text as="p" variant="bodyMd" fontWeight="semibold">{p.title}</Text>
                          <Text as="p" variant="bodySm" tone="subdued">{formatMoney(p.price)}</Text>
                          <InlineStack gap="300" blockAlign="center">
                            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 13 }}>
                              <input
                                type="radio"
                                name="primaryProduct"
                                checked={primaryProductId ? primaryProductId === p.shopifyProductId : index === 0}
                                onChange={() => setPrimaryProductId(p.shopifyProductId)}
                              />
                              <Text as="span" tone={((primaryProductId || products[0]?.shopifyProductId) === p.shopifyProductId) ? "magic" : "subdued"} variant="bodySm">Mark as Primary</Text>
                            </label>
                            <Text as="span" tone="subdued" variant="bodySm">1 variant selected</Text>
                          </InlineStack>
                        </div>
                        <InlineStack gap="0" blockAlign="center">
                          <Button size="slim" onClick={() => changeQuantity(p.shopifyProductId, -1)} disabled={(p.defaultQuantity || 1) <= (p.minQuantity || 1)}>−</Button>
                          <div style={{ width: 32, textAlign: "center" }}>
                            <Text as="span">{p.defaultQuantity || 1}</Text>
                          </div>
                          <Button size="slim" onClick={() => changeQuantity(p.shopifyProductId, 1)} disabled={(p.defaultQuantity || 1) >= (p.maxQuantity || 10)}>+</Button>
                        </InlineStack>
                        <Button size="slim" variant="tertiary" tone="critical" icon={DeleteIcon} accessibilityLabel="Remove" onClick={() => removeProduct(p.shopifyProductId)} />
                      </div>
                    );
                  })}
                  <Divider />
                  <Button onClick={handleBrowseProducts}>Browse products</Button>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">Bundle Visibility on</Text>
                  <InlineStack gap="400">
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                      <input type="radio" name="visibilityMode" checked={visibilityMode === "primary"} onChange={() => setVisibilityMode("primary")} />
                      <Text as="span">Primary product only</Text>
                    </label>
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                      <input type="radio" name="visibilityMode" checked={visibilityMode === "all"} onChange={() => setVisibilityMode("all")} />
                      <Text as="span">All selected products</Text>
                    </label>
                  </InlineStack>

                  <Divider />
                  <Text as="h3" variant="headingSm">Additional Settings</Text>
                  <Checkbox label="Show checkbox" checked={showCheckbox} onChange={setShowCheckbox} />
                  {showCheckbox && (
                    <div style={{ marginLeft: 24 }}>
                      <BlockStack gap="200">
                        <Select
                          label="Customer can select"
                          options={[
                            { label: "Any combination of products", value: "multi" },
                            { label: "Exactly one product, always paired with the primary product", value: "single" },
                          ]}
                          value={selectionMode}
                          onChange={(v) => setSelectionMode(v === "single" ? "single" : "multi")}
                        />
                        {selectionMode === "multi" && (
                          <Checkbox label="Uncheck related items by default" checked={uncheckByDefault} onChange={setUncheckByDefault} />
                        )}
                      </BlockStack>
                    </div>
                  )}
                  <Checkbox label="Enable quantity selector on products" checked={enableQuantitySelector} onChange={setEnableQuantitySelector} />
                  {enableQuantitySelector && (
                    <div style={{ marginLeft: 24 }}>
                      <InlineGrid columns={2} gap="300">
                        <TextField label="Minimum quantity (optional)" type="number" value={quantityMin} onChange={setQuantityMin} autoComplete="off" min={0} />
                        <TextField label="Maximum quantity (optional)" type="number" value={quantityMax} onChange={setQuantityMax} autoComplete="off" min={0} />
                      </InlineGrid>
                    </div>
                  )}
                  <Text as="p" tone="subdued" variant="bodySm">
                    Split Product Variants isn't built — every product uses its first variant
                    automatically. If "Show checkbox" lets a customer uncheck a product, note the
                    automatic discount's minimum-quantity requirement is based on the full bundle
                    as configured, so it may not apply to a smaller checked-out selection.
                  </Text>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">Discount on Bundle</Text>
                  <InlineStack gap="300">
                    <Select
                      label="Discount type"
                      options={[
                        { label: "Percentage off", value: "percentage" },
                        { label: "Fixed amount off", value: "fixed_amount" },
                        { label: "Fixed bundle price", value: "fixed_price" },
                        { label: "No discount", value: "none" },
                      ]}
                      value={discountType}
                      onChange={setDiscountType}
                    />
                    {discountType !== "none" && (
                      <TextField
                        label={discountType === "fixed_price" ? "Bundle price (₹)" : discountType === "fixed_amount" ? "Amount off (₹)" : "Percent off"}
                        type="number"
                        value={discountValue}
                        onChange={setDiscountValue}
                        autoComplete="off"
                        min={0}
                      />
                    )}
                  </InlineStack>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h2" variant="headingMd">Design</Text>
                    <Button url={`/app/bundle-genie/bundles/${bundle._id}/customize`}>More customization options</Button>
                  </InlineStack>
                  <Text as="p" tone="subdued">
                    How this bundle looks on the product page. Leave colors blank for the theme's defaults.
                  </Text>
                  <InlineGrid columns={2} gap="300">
                    <TextField label="Background color" value={bgColor} onChange={setBgColor} placeholder="#ffffff" autoComplete="off" />
                    <TextField label="Text color" value={textColor} onChange={setTextColor} placeholder="#1a1a1a" autoComplete="off" />
                    <TextField label="Button color" value={buttonColor} onChange={setButtonColor} placeholder="#1a1a1a" autoComplete="off" />
                    <TextField label="Button text color" value={buttonTextColor} onChange={setButtonTextColor} placeholder="#ffffff" autoComplete="off" />
                  </InlineGrid>
                  <InlineGrid columns={2} gap="300">
                    <TextField
                      label="Corner radius (px)"
                      type="number"
                      value={borderRadius}
                      onChange={setBorderRadius}
                      autoComplete="off"
                      min={0}
                      max={40}
                    />
                    <Select
                      label="Layout"
                      options={[
                        { label: "Grid", value: "grid" },
                        { label: "List", value: "list" },
                      ]}
                      value={layout}
                      onChange={setLayout}
                    />
                  </InlineGrid>
                </BlockStack>
              </Card>

              <InlineStack align="end" gap="200">
                <Button onClick={() => navigate("/app/bundle-genie/bundles")}>Cancel</Button>
                <Button loading={isSaving} onClick={() => save("draft")}>Save draft</Button>
                <Button variant="primary" loading={isSaving} onClick={() => save("publish")}>
                  Publish new version
                </Button>
              </InlineStack>
            </BlockStack>
          </div>

          <div style={{ flex: "1 1 320px", minWidth: 280, position: "sticky", top: 16 }}>
            <BundlePreviewPanel
              title={title}
              description={description}
              products={products}
              discountType={discountType}
              discountValue={Number(discountValue) || 0}
              bgColor={bgColor}
              textColor={textColor}
              buttonColor={buttonColor}
              buttonTextColor={buttonTextColor}
              borderRadius={borderRadius}
              layout={layout}
            />
          </div>
        </div>
      </BlockStack>
    </Page>
  );
}
