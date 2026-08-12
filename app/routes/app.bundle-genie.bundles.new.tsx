import { json, redirect, type ActionFunctionArgs } from "@remix-run/node";
import { useNavigate, useSubmit, useNavigation } from "@remix-run/react";
import {
  Page, Card, BlockStack, Text, TextField, Button, Select, Banner,
  InlineStack, Divider,
} from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import { connectDB } from "../db.server";
import { Bundle, type IBundleProduct } from "../.server/models/bundle.model";

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90) || "bundle";
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();
  const shopId = session.shop;

  const formData = await request.formData();
  const internalName = String(formData.get("internalName") || "").trim();
  const title = String(formData.get("title") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const discountType = String(formData.get("discountType") || "percentage");
  const discountValue = Number(formData.get("discountValue")) || 0;
  const intent = String(formData.get("intent") || "draft"); // "draft" | "publish"

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

  const handle = slugify(title);

  const bundle = new Bundle({
    shopId,
    type: "fixed_product",
    internalName,
    title,
    description,
    handle,
    status: intent === "publish" ? "active" : "draft",
    draftProducts: products,
    draftDiscountType: discountType,
    draftDiscountValue: discountValue,
    currentVersion: intent === "publish" ? 1 : 0,
    versions: intent === "publish"
      ? [{
          version: 1,
          products,
          discountType,
          discountValue,
          publishedAt: new Date(),
        }]
      : [],
  });

  try {
    await bundle.save();
  } catch (err: any) {
    if (err?.code === 11000) {
      return json({ success: false, error: "A bundle with that name/handle already exists." }, { status: 400 });
    }
    return json({ success: false, error: "Could not save bundle." }, { status: 500 });
  }

  return redirect(`/app/bundle-genie/bundles/${bundle._id}`);
};

export default function BundleGenieNew() {
  const navigate = useNavigate();
  const submit = useSubmit();
  const navigation = useNavigation();
  const shopify = useAppBridge();
  const isSaving = navigation.state === "submitting";

  const [internalName, setInternalName] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [discountType, setDiscountType] = useState("percentage");
  const [discountValue, setDiscountValue] = useState("10");
  const [products, setProducts] = useState<IBundleProduct[]>([]);
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
    fd.set("intent", intent);
    submit(fd, { method: "post" });
  }, [internalName, title, description, discountType, discountValue, products, submit]);

  return (
    <Page
      title="Create Bundle"
      subtitle="Fixed Product Bundle — preselected products at a discount."
      backAction={{ url: "/app/bundle-genie/bundles" }}
    >
      <BlockStack gap="400">
        {error && <Banner tone="critical" onDismiss={() => setError("")}>{error}</Banner>}

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Basic information</Text>
            <TextField
              label="Internal name"
              value={internalName}
              onChange={setInternalName}
              helpText="For your reference only — not shown to customers."
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

        <InlineStack align="end" gap="200">
          <Button onClick={() => navigate("/app/bundle-genie/bundles")}>Cancel</Button>
          <Button loading={isSaving} onClick={() => save("draft")}>Save as draft</Button>
          <Button variant="primary" loading={isSaving} onClick={() => save("publish")}>Publish</Button>
        </InlineStack>
      </BlockStack>
    </Page>
  );
}
