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
  InlineStack,
  InlineGrid,
  Divider,
  Banner,
  Badge,
  EmptyState,
} from "@shopify/polaris";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import { connectDB } from "../db.server";
import {
  VolumeDiscountSettings,
  getOrCreateVolumeDiscountSettings,
  type IVolumeDiscountCampaign,
  type IVolumeTargetProduct,
  type IVolumeTier,
} from "../.server/models/volume-discount.model";
import {
  syncCampaign,
  deleteDiscount,
} from "../.server/services/volume-discount.service";

type CampaignDraft = IVolumeDiscountCampaign & { _id?: string };

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();
  const settings = await getOrCreateVolumeDiscountSettings(session.shop);
  return json({
    campaigns: JSON.parse(JSON.stringify(settings.campaigns || [])),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  await connectDB();

  const formData = await request.formData();
  const op = String(formData.get("op") || "save");

  try {
    const settings = await getOrCreateVolumeDiscountSettings(session.shop);

    if (op === "delete") {
      const campaignId = String(formData.get("campaignId") || "");
      const existing = settings.campaigns.find(
        (c) => String(c._id) === campaignId,
      );
      if (existing) {
        for (const tier of existing.tiers) {
          if (tier.shopifyDiscountId) {
            await deleteDiscount(admin as any, tier.shopifyDiscountId);
          }
        }
      }
      await VolumeDiscountSettings.updateOne(
        { shopId: session.shop },
        { $pull: { campaigns: { _id: campaignId } } },
      );
      return json({ success: true });
    }

    // save: upsert a campaign (create when campaignId is empty)
    const campaignId = String(formData.get("campaignId") || "");
    const payload = JSON.parse(String(formData.get("campaign") || "{}")) as
      | Partial<IVolumeDiscountCampaign>
      | null;
    if (!payload) {
      return json({ success: false, error: "Invalid payload" }, { status: 400 });
    }

    // Validate tiers
    const tiers = (payload.tiers || []).slice().sort(
      (a, b) => a.minQuantity - b.minQuantity,
    );
    for (let i = 1; i < tiers.length; i++) {
      if (tiers[i].minQuantity <= tiers[i - 1].minQuantity) {
        return json(
          {
            success: false,
            error: "Tier quantities must be strictly ascending",
          },
          { status: 400 },
        );
      }
    }

    const previous = campaignId
      ? settings.campaigns.find((c) => String(c._id) === campaignId)
      : null;

    const merged: IVolumeDiscountCampaign = {
      title: payload.title || "Volume Discount",
      enabled: !!payload.enabled,
      scope: (payload.scope as any) || "products",
      products: (payload.products as IVolumeTargetProduct[]) || [],
      tiers: tiers.map((t, i) => ({
        minQuantity: Number(t.minQuantity) || i + 1,
        valueType: (t.valueType as any) || "percentage",
        value: Number(t.value) || 0,
        label: t.label || "",
        shopifyDiscountId:
          previous?.tiers.find((p) => p.minQuantity === t.minQuantity)
            ?.shopifyDiscountId || t.shopifyDiscountId || "",
      })),
      startsAt: payload.startsAt ? new Date(payload.startsAt) : null,
      endsAt: payload.endsAt ? new Date(payload.endsAt) : null,
      combinesWithShipping: payload.combinesWithShipping ?? true,
      combinesWithOrder: !!payload.combinesWithOrder,
      combinesWithProduct: !!payload.combinesWithProduct,
      badgeText: payload.badgeText || "Volume Discount",
      showOnProductPage: payload.showOnProductPage ?? true,
      showInCart: payload.showInCart ?? true,
      primaryColor: payload.primaryColor || "#5C6AC4",
    };

    // Sync to Shopify
    const syncedTiers = await syncCampaign(
      admin as any,
      merged,
      previous?.tiers || [],
    );
    merged.tiers = syncedTiers;

    if (previous) {
      await VolumeDiscountSettings.updateOne(
        { shopId: session.shop, "campaigns._id": campaignId },
        { $set: { "campaigns.$": { ...merged, _id: previous._id } } },
      );
    } else {
      await VolumeDiscountSettings.updateOne(
        { shopId: session.shop },
        { $push: { campaigns: merged } },
        { upsert: true },
      );
    }

    return json({ success: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Save failed";
    return json({ success: false, error: message }, { status: 500 });
  }
};

const NEW_CAMPAIGN: CampaignDraft = {
  title: "Volume Discount",
  enabled: false,
  scope: "products",
  products: [],
  tiers: [
    { minQuantity: 2, valueType: "percentage", value: 5, label: "Buy 2, save 5%" },
    { minQuantity: 3, valueType: "percentage", value: 10, label: "Buy 3, save 10%" },
    { minQuantity: 5, valueType: "percentage", value: 15, label: "Buy 5, save 15%" },
  ],
  startsAt: null,
  endsAt: null,
  combinesWithShipping: true,
  combinesWithOrder: false,
  combinesWithProduct: false,
  badgeText: "Volume Discount",
  showOnProductPage: true,
  showInCart: true,
  primaryColor: "#5C6AC4",
};

export default function VolumeDiscountsPage() {
  const { campaigns } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isLoading = navigation.state === "submitting";

  const [draft, setDraft] = useState<CampaignDraft | null>(null);
  const [productInput, setProductInput] = useState("");
  const [addingProduct, setAddingProduct] = useState(false);
  const [formError, setFormError] = useState<string>("");

  const openNew = useCallback(() => {
    setDraft({ ...NEW_CAMPAIGN, products: [], tiers: [...NEW_CAMPAIGN.tiers] });
    setFormError("");
  }, []);

  const openEdit = useCallback((c: CampaignDraft) => {
    setDraft(JSON.parse(JSON.stringify(c)));
    setFormError("");
  }, []);

  const handleDelete = useCallback(
    (campaignId: string) => {
      if (!confirm("Delete this campaign? Linked Shopify discounts will be removed.")) return;
      const fd = new FormData();
      fd.set("op", "delete");
      fd.set("campaignId", campaignId);
      submit(fd, { method: "post" });
    },
    [submit],
  );

  const handleSave = useCallback(() => {
    if (!draft) return;
    setFormError("");
    const sorted = [...draft.tiers].sort((a, b) => a.minQuantity - b.minQuantity);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].minQuantity <= sorted[i - 1].minQuantity) {
        setFormError("Tier minimum quantities must be strictly ascending.");
        return;
      }
    }
    if (draft.scope === "products" && draft.products.length === 0) {
      setFormError("Add at least one product, or change scope to All products.");
      return;
    }
    const fd = new FormData();
    fd.set("op", "save");
    fd.set("campaignId", draft._id ? String(draft._id) : "");
    fd.set("campaign", JSON.stringify(draft));
    submit(fd, { method: "post" });
    setDraft(null);
  }, [draft, submit]);

  const handleAddProduct = useCallback(async () => {
    if (!draft || !productInput.trim()) return;
    setAddingProduct(true);
    try {
      let handle = productInput.trim();
      const match = handle.match(/\/products\/([a-zA-Z0-9\-_]+)/);
      if (match) handle = match[1];
      handle = handle.split("?")[0].split("#")[0];

      const res = await fetch(
        `/api/product-lookup?handle=${encodeURIComponent(handle)}`,
      );
      if (!res.ok) throw new Error("Not found");
      const p = await res.json();
      if (!p.id) throw new Error("Not found");

      if (draft.products.some((x) => x.shopifyProductId === p.id)) {
        setAddingProduct(false);
        return;
      }
      setDraft({
        ...draft,
        products: [
          ...draft.products,
          {
            shopifyProductId: p.id,
            title: p.title,
            handle: p.handle,
            imageUrl: p.imageUrl,
            price: p.price,
          },
        ],
      });
      setProductInput("");
    } catch {
      alert("Could not find product. Enter a valid handle or product URL.");
    }
    setAddingProduct(false);
  }, [draft, productInput]);

  const removeProduct = useCallback(
    (idx: number) => {
      if (!draft) return;
      setDraft({
        ...draft,
        products: draft.products.filter((_, i) => i !== idx),
      });
    },
    [draft],
  );

  const addTier = useCallback(() => {
    if (!draft) return;
    const last = draft.tiers[draft.tiers.length - 1];
    setDraft({
      ...draft,
      tiers: [
        ...draft.tiers,
        {
          minQuantity: (last?.minQuantity || 1) + 1,
          valueType: last?.valueType || "percentage",
          value: (last?.value || 5) + 5,
          label: "",
        },
      ],
    });
  }, [draft]);

  const removeTier = useCallback(
    (idx: number) => {
      if (!draft) return;
      setDraft({
        ...draft,
        tiers: draft.tiers.filter((_, i) => i !== idx),
      });
    },
    [draft],
  );

  const updateTier = useCallback(
    (idx: number, field: keyof IVolumeTier, value: string | number) => {
      if (!draft) return;
      setDraft({
        ...draft,
        tiers: draft.tiers.map((t, i) =>
          i === idx ? { ...t, [field]: value } : t,
        ),
      });
    },
    [draft],
  );

  if (draft) {
    return (
      <Page
        title={draft._id ? "Edit Campaign" : "New Campaign"}
        backAction={{ content: "Back", onAction: () => setDraft(null) }}
        primaryAction={{
          content: "Save Campaign",
          onAction: handleSave,
          loading: isLoading,
        }}
      >
        <BlockStack gap="500">
          {formError && <Banner tone="critical">{formError}</Banner>}
          <Layout>
            <Layout.AnnotatedSection
              title="Campaign Basics"
              description="Name and enable or disable the campaign. Disabled campaigns are removed from Shopify."
            >
              <Card>
                <BlockStack gap="400">
                  <TextField
                    label="Campaign Title"
                    value={draft.title}
                    onChange={(v) => setDraft({ ...draft, title: v })}
                    autoComplete="off"
                  />
                  <Checkbox
                    label="Enable campaign"
                    helpText="When enabled, one automatic discount is created per tier in Shopify."
                    checked={draft.enabled}
                    onChange={(v) => setDraft({ ...draft, enabled: v })}
                  />
                  <InlineGrid columns={2} gap="300">
                    <TextField
                      label="Start date (optional)"
                      type="datetime-local"
                      value={
                        draft.startsAt
                          ? new Date(draft.startsAt).toISOString().slice(0, 16)
                          : ""
                      }
                      onChange={(v) =>
                        setDraft({
                          ...draft,
                          startsAt: v ? new Date(v) : null,
                        })
                      }
                      autoComplete="off"
                    />
                    <TextField
                      label="End date (optional)"
                      type="datetime-local"
                      value={
                        draft.endsAt
                          ? new Date(draft.endsAt).toISOString().slice(0, 16)
                          : ""
                      }
                      onChange={(v) =>
                        setDraft({ ...draft, endsAt: v ? new Date(v) : null })
                      }
                      autoComplete="off"
                    />
                  </InlineGrid>
                </BlockStack>
              </Card>
            </Layout.AnnotatedSection>

            <Layout.AnnotatedSection
              title="Eligibility"
              description="Pick which products this campaign applies to. 'All products' applies to every item in the store."
            >
              <Card>
                <BlockStack gap="400">
                  <Select
                    label="Applies to"
                    options={[
                      { label: "Specific products", value: "products" },
                      { label: "All products", value: "all" },
                    ]}
                    value={draft.scope}
                    onChange={(v) => setDraft({ ...draft, scope: v as any })}
                  />
                  {draft.scope === "products" && (
                    <>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Selected products ({draft.products.length})
                      </Text>
                      {draft.products.map((p, i) => (
                        <div
                          key={p.shopifyProductId}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "12px",
                            padding: "8px",
                            border: "1px solid #e0e0e0",
                            borderRadius: "8px",
                          }}
                        >
                          {p.imageUrl && (
                            <img
                              src={p.imageUrl}
                              alt={p.title}
                              style={{
                                width: "40px",
                                height: "40px",
                                objectFit: "cover",
                                borderRadius: "6px",
                              }}
                            />
                          )}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <Text as="p" variant="bodyMd" fontWeight="semibold">
                              {p.title}
                            </Text>
                            <Text as="p" variant="bodySm" tone="subdued">
                              {p.handle}
                            </Text>
                          </div>
                          <Button
                            size="slim"
                            tone="critical"
                            onClick={() => removeProduct(i)}
                          >
                            Remove
                          </Button>
                        </div>
                      ))}
                      <InlineStack gap="200" blockAlign="end">
                        <div style={{ flex: 1 }}>
                          <TextField
                            label="Product handle or URL"
                            value={productInput}
                            onChange={setProductInput}
                            placeholder="my-product or https://shop.com/products/my-product"
                            autoComplete="off"
                          />
                        </div>
                        <Button
                          onClick={handleAddProduct}
                          loading={addingProduct}
                        >
                          Add
                        </Button>
                      </InlineStack>
                    </>
                  )}
                </BlockStack>
              </Card>
            </Layout.AnnotatedSection>

            <Layout.AnnotatedSection
              title="Tier Ladder"
              description="Each tier becomes one automatic discount in Shopify. The cart gets the highest tier it qualifies for."
            >
              <Card>
                <BlockStack gap="400">
                  {draft.tiers.map((tier, index) => (
                    <div key={index}>
                      {index > 0 && <Divider />}
                      <BlockStack gap="300">
                        <InlineStack align="space-between">
                          <Text as="h3" variant="headingSm">
                            Tier {index + 1}
                          </Text>
                          <Button
                            size="slim"
                            tone="critical"
                            onClick={() => removeTier(index)}
                            disabled={draft.tiers.length <= 1}
                          >
                            Remove
                          </Button>
                        </InlineStack>
                        <InlineGrid columns={3} gap="300">
                          <TextField
                            label="Min quantity"
                            type="number"
                            min={1}
                            value={String(tier.minQuantity)}
                            onChange={(v) =>
                              updateTier(index, "minQuantity", Number(v))
                            }
                            autoComplete="off"
                          />
                          <Select
                            label="Value type"
                            options={[
                              { label: "Percentage (%)", value: "percentage" },
                              {
                                label: "Fixed amount",
                                value: "fixed_amount",
                              },
                            ]}
                            value={tier.valueType}
                            onChange={(v) =>
                              updateTier(index, "valueType", v)
                            }
                          />
                          <TextField
                            label={
                              tier.valueType === "percentage"
                                ? "Percent off"
                                : "Amount off"
                            }
                            type="number"
                            min={0}
                            value={String(tier.value)}
                            onChange={(v) =>
                              updateTier(index, "value", Number(v))
                            }
                            autoComplete="off"
                          />
                        </InlineGrid>
                        <TextField
                          label="Storefront label"
                          value={tier.label}
                          onChange={(v) => updateTier(index, "label", v)}
                          helpText="Shown on the product page ladder"
                          autoComplete="off"
                          placeholder={`Buy ${tier.minQuantity}+, save ${tier.value}${tier.valueType === "percentage" ? "%" : ""}`}
                        />
                      </BlockStack>
                    </div>
                  ))}
                  <Button onClick={addTier}>+ Add Tier</Button>
                </BlockStack>
              </Card>
            </Layout.AnnotatedSection>

            <Layout.AnnotatedSection
              title="Combination Rules"
              description="Decide whether this discount can combine with other discount types at checkout."
            >
              <Card>
                <BlockStack gap="300">
                  <Checkbox
                    label="Combines with shipping discounts"
                    checked={draft.combinesWithShipping}
                    onChange={(v) =>
                      setDraft({ ...draft, combinesWithShipping: v })
                    }
                  />
                  <Checkbox
                    label="Combines with order discounts"
                    checked={draft.combinesWithOrder}
                    onChange={(v) =>
                      setDraft({ ...draft, combinesWithOrder: v })
                    }
                  />
                  <Checkbox
                    label="Combines with other product discounts"
                    helpText="Usually off so Shopify picks one best tier per cart."
                    checked={draft.combinesWithProduct}
                    onChange={(v) =>
                      setDraft({ ...draft, combinesWithProduct: v })
                    }
                  />
                </BlockStack>
              </Card>
            </Layout.AnnotatedSection>

            <Layout.AnnotatedSection
              title="Storefront Display"
              description="Messaging shown on the product page and cart. Actual discount is still enforced by Shopify at checkout."
            >
              <Card>
                <BlockStack gap="300">
                  <Checkbox
                    label="Show on product page"
                    checked={draft.showOnProductPage}
                    onChange={(v) =>
                      setDraft({ ...draft, showOnProductPage: v })
                    }
                  />
                  <Checkbox
                    label="Show in cart"
                    checked={draft.showInCart}
                    onChange={(v) => setDraft({ ...draft, showInCart: v })}
                  />
                  <TextField
                    label="Badge text"
                    value={draft.badgeText}
                    onChange={(v) => setDraft({ ...draft, badgeText: v })}
                    autoComplete="off"
                  />
                  <TextField
                    label="Primary color (hex)"
                    value={draft.primaryColor}
                    onChange={(v) => setDraft({ ...draft, primaryColor: v })}
                    autoComplete="off"
                  />
                </BlockStack>
              </Card>
            </Layout.AnnotatedSection>
          </Layout>
        </BlockStack>
      </Page>
    );
  }

  return (
    <Page
      title="Volume / Quantity Discounts"
      primaryAction={{ content: "New Campaign", onAction: openNew }}
      backAction={{ content: "Dashboard", url: "/app" }}
    >
      <BlockStack gap="500">
        <Banner tone="info">
          <p>
            Each tier becomes one automatic discount in Shopify. Shopify
            applies the highest tier a cart qualifies for. Storefront messaging
            is rendered by the "Volume Discounts" app embed — enable it in your
            theme editor.
          </p>
        </Banner>
        {campaigns.length === 0 ? (
          <Card>
            <EmptyState
              heading="No campaigns yet"
              action={{ content: "Create campaign", onAction: openNew }}
              image=""
            >
              <p>
                Create a campaign with 2–5 tiers. Example: Buy 2 → 5% off, Buy
                3 → 10% off, Buy 5 → 15% off.
              </p>
            </EmptyState>
          </Card>
        ) : (
          <BlockStack gap="400">
            {(campaigns as CampaignDraft[]).map((c) => (
              <Card key={String(c._id)}>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="300" blockAlign="center">
                      <Text as="h2" variant="headingMd">
                        {c.title}
                      </Text>
                      {c.enabled ? (
                        <Badge tone="success">Active</Badge>
                      ) : (
                        <Badge>Disabled</Badge>
                      )}
                    </InlineStack>
                    <InlineStack gap="200">
                      <Button onClick={() => openEdit(c)}>Edit</Button>
                      <Button
                        tone="critical"
                        onClick={() => handleDelete(String(c._id))}
                      >
                        Delete
                      </Button>
                    </InlineStack>
                  </InlineStack>
                  <Text as="p" tone="subdued">
                    {c.scope === "all"
                      ? "All products"
                      : `${c.products.length} product${c.products.length === 1 ? "" : "s"}`}{" "}
                    · {c.tiers.length} tier{c.tiers.length === 1 ? "" : "s"}
                  </Text>
                  <InlineStack gap="200" wrap>
                    {c.tiers.map((t, i) => (
                      <Badge key={i}>
                        {`Buy ${t.minQuantity}+ → ${t.value}${t.valueType === "percentage" ? "%" : ""} off`}
                      </Badge>
                    ))}
                  </InlineStack>
                </BlockStack>
              </Card>
            ))}
          </BlockStack>
        )}
      </BlockStack>
    </Page>
  );
}
