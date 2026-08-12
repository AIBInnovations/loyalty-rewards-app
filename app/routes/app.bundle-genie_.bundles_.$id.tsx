import { json, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useNavigate, useSubmit, useNavigation } from "@remix-run/react";
import {
  Page, Card, BlockStack, Text, TextField, Button, Select, Banner,
  InlineStack, Divider, Badge, InlineGrid,
} from "@shopify/polaris";
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

  return json({ bundle: JSON.parse(JSON.stringify(bundle)) });
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
        admin as any, { title: bundle.title }, latestVersion,
      );
      bundle.markModified("versions");
    }
    bundle.status = bundle.currentVersion > 0 ? "active" : "draft";
    await bundle.save();
    return json({ success: true });
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
  bundle.style = { bgColor, textColor, buttonColor, buttonTextColor, borderRadius, layout };

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
      admin as any, { title }, version, latestVersion?.shopifyDiscountId,
    );
    bundle.versions.push(version);
    bundle.currentVersion = nextVersion;
    bundle.status = "active";
  }

  await bundle.save();
  return json({ success: true });
};

export default function BundleGenieEdit() {
  const { bundle } = useLoaderData<typeof loader>();
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
  const [bgColor, setBgColor] = useState(bundle.style?.bgColor || "");
  const [textColor, setTextColor] = useState(bundle.style?.textColor || "");
  const [buttonColor, setButtonColor] = useState(bundle.style?.buttonColor || "");
  const [buttonTextColor, setButtonTextColor] = useState(bundle.style?.buttonTextColor || "");
  const [borderRadius, setBorderRadius] = useState(String(bundle.style?.borderRadius ?? 12));
  const [layout, setLayout] = useState(bundle.style?.layout || "grid");
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
          maxQuantity: 1,
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
    fd.set("intent", intent);
    submit(fd, { method: "post" });
  }, [
    internalName, title, description, discountType, discountValue, products,
    bgColor, textColor, buttonColor, buttonTextColor, borderRadius, layout, submit,
  ]);

  const runIntent = useCallback((intent: string) => {
    const fd = new FormData();
    fd.set("intent", intent);
    submit(fd, { method: "post" });
  }, [submit]);

  return (
    <Page
      title={bundle.title}
      subtitle="Fixed Product Bundle"
      titleMetadata={<Badge tone={bundle.status === "active" ? "success" : "info"}>{bundle.status}</Badge>}
      backAction={{ url: "/app/bundle-genie/bundles" }}
      secondaryActions={[
        bundle.status === "active"
          ? { content: "Pause", onAction: () => runIntent("pause") }
          : { content: "Resume", onAction: () => runIntent("resume") },
        { content: "Archive", destructive: true, onAction: () => runIntent("archive") },
      ]}
    >
      <BlockStack gap="400">
        {error && <Banner tone="critical" onDismiss={() => setError("")}>{error}</Banner>}
        {bundle.currentVersion > 0 && (
          <Banner tone="info">
            Currently live as version {bundle.currentVersion}. Changes below are a draft until you click Publish.
          </Banner>
        )}

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
              label="Customer-facing title"
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
            <Text as="h2" variant="headingMd">Products ({products.length})</Text>
            {products.map((p) => (
              <div
                key={p.shopifyProductId}
                style={{
                  display: "flex", alignItems: "center", gap: "12px",
                  padding: "8px", border: "1px solid #e0e0e0", borderRadius: "8px",
                }}
              >
                {p.imageUrl && (
                  <img src={p.imageUrl} alt={p.title} style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 6 }} />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Text as="p" variant="bodyMd" fontWeight="semibold">{p.title}</Text>
                  <Text as="p" variant="bodySm" tone="subdued">₹{(p.price / 100).toFixed(0)}</Text>
                </div>
                <Button size="slim" tone="critical" onClick={() => removeProduct(p.shopifyProductId)}>
                  Remove
                </Button>
              </div>
            ))}
            <Divider />
            <Button onClick={handleBrowseProducts}>Browse products</Button>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Pricing</Text>
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
            <Text as="h2" variant="headingMd">Design</Text>
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
    </Page>
  );
}
