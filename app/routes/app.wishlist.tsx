import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import { useState, useCallback } from "react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  TextField,
  Checkbox,
  IndexTable,
  InlineGrid,
  EmptyState,
  Badge,
  Banner,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { connectDB } from "../db.server";
import { WishlistItem } from "../.server/models/wishlist.model";
import {
  WishlistSettings,
  getOrCreateWishlistSettings,
} from "../.server/models/wishlist-settings.model";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();

  const shop = session.shop;

  const [
    settings,
    totalWishlist,
    totalSaved,
    uniqueCustomersAgg,
    topProductsAgg,
    recent,
  ] = await Promise.all([
    getOrCreateWishlistSettings(shop),
    WishlistItem.countDocuments({ shopId: shop, kind: "wishlist" }),
    WishlistItem.countDocuments({ shopId: shop, kind: "saved" }),
    WishlistItem.distinct("shopifyCustomerId", { shopId: shop }),
    WishlistItem.aggregate([
      { $match: { shopId: shop, kind: "wishlist" } },
      {
        $group: {
          _id: "$productId",
          productTitle: { $last: "$productTitle" },
          productHandle: { $last: "$productHandle" },
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]),
    WishlistItem.find({ shopId: shop })
      .sort({ savedAt: -1 })
      .limit(50)
      .lean(),
  ]);

  return json({
    settings: JSON.parse(JSON.stringify(settings)),
    totalWishlist,
    totalSaved,
    uniqueCustomers: uniqueCustomersAgg.length,
    topProducts: topProductsAgg.map((t) => ({
      productId: String(t._id),
      productTitle: t.productTitle || "Untitled",
      productHandle: t.productHandle || "",
      count: t.count,
    })),
    recent: recent.map((r) => ({
      id: r._id.toString(),
      kind: r.kind,
      productTitle: r.productTitle || "Untitled",
      variantTitle: r.variantTitle || "",
      shopifyCustomerId: r.shopifyCustomerId,
      savedAt: r.savedAt?.toISOString() || r.createdAt.toISOString(),
    })),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();

  const data = Object.fromEntries(await request.formData());

  await WishlistSettings.findOneAndUpdate(
    { shopId: session.shop },
    {
      $set: {
        enabled: data.enabled === "true",
        showWishlistButton: data.showWishlistButton === "true",
        showSavedForLater: data.showSavedForLater === "true",
        buttonLabelAdd: (data.buttonLabelAdd as string) || "Add to Wishlist",
        buttonLabelSaved: (data.buttonLabelSaved as string) || "In Wishlist",
        iconColor: (data.iconColor as string) || "#222222",
        activeColor: (data.activeColor as string) || "#e63946",
      },
    },
    { upsert: true },
  );

  return json({ success: true });
};

export default function WishlistAdminPage() {
  const {
    settings,
    totalWishlist,
    totalSaved,
    uniqueCustomers,
    topProducts,
    recent,
  } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const nav = useNavigation();

  const [s, setS] = useState({ ...settings });
  const u = (f: string) => (v: string | boolean) =>
    setS((p: any) => ({ ...p, [f]: v }));

  const save = useCallback(() => {
    const fd = new FormData();
    Object.entries(s).forEach(([k, v]) => {
      if (
        k !== "_id" &&
        k !== "__v" &&
        k !== "shopId" &&
        k !== "createdAt" &&
        k !== "updatedAt"
      ) {
        fd.set(k, String(v));
      }
    });
    submit(fd, { method: "post" });
  }, [s, submit]);

  return (
    <Page
      title="Wishlist & Save for Later"
      backAction={{ content: "Dashboard", url: "/app" }}
      primaryAction={{
        content: "Save",
        onAction: save,
        loading: nav.state === "submitting",
      }}
    >
      <BlockStack gap="500">
        <Layout>
          <Layout.AnnotatedSection
            title="Status"
            description={
              s.enabled
                ? "Wishlist is live on your storefront."
                : "Wishlist is currently OFF. Storefront blocks will not render."
            }
          >
            <Card>
              <BlockStack gap="300">
                <Checkbox
                  label="Enable Wishlist & Save for Later"
                  checked={s.enabled}
                  onChange={u("enabled")}
                  helpText="When off, the heart button and saved-items page hide on the storefront."
                />
                <Checkbox
                  label="Show wishlist button on product pages"
                  checked={s.showWishlistButton}
                  onChange={u("showWishlistButton")}
                  disabled={!s.enabled}
                />
                <Checkbox
                  label="Show 'Save for Later' on cart"
                  checked={s.showSavedForLater}
                  onChange={u("showSavedForLater")}
                  disabled={!s.enabled}
                />
              </BlockStack>
            </Card>
          </Layout.AnnotatedSection>

          <Layout.AnnotatedSection
            title="Appearance"
            description="Customize the wishlist heart button labels and colors."
          >
            <Card>
              <BlockStack gap="400">
                <TextField
                  label="Button label - Not saved"
                  value={s.buttonLabelAdd}
                  onChange={u("buttonLabelAdd")}
                  autoComplete="off"
                  disabled={!s.enabled}
                />
                <TextField
                  label="Button label - Saved"
                  value={s.buttonLabelSaved}
                  onChange={u("buttonLabelSaved")}
                  autoComplete="off"
                  disabled={!s.enabled}
                />
                <InlineGrid columns={2} gap="300">
                  <TextField
                    label="Icon color"
                    value={s.iconColor}
                    onChange={u("iconColor")}
                    autoComplete="off"
                    disabled={!s.enabled}
                  />
                  <TextField
                    label="Active (saved) color"
                    value={s.activeColor}
                    onChange={u("activeColor")}
                    autoComplete="off"
                    disabled={!s.enabled}
                  />
                </InlineGrid>
              </BlockStack>
            </Card>
          </Layout.AnnotatedSection>
        </Layout>

        <Banner tone="info">
          <p>
            After saving, open Theme Editor → <b>App embeds</b> and enable
            "Wishlist &amp; Save for Later". Then add the "Wishlist Button"
            block to your product template and the "Wishlist &amp; Saved
            Items" block to a page (e.g. <code>/pages/wishlist</code>) or
            the cart page.
          </p>
        </Banner>

        <InlineGrid columns={3} gap="400">
          <Card>
            <BlockStack gap="200">
              <Text as="p" tone="subdued">Wishlist items</Text>
              <Text as="p" variant="headingXl">{totalWishlist}</Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="200">
              <Text as="p" tone="subdued">Saved for later</Text>
              <Text as="p" variant="headingXl">{totalSaved}</Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="200">
              <Text as="p" tone="subdued">Unique customers</Text>
              <Text as="p" variant="headingXl">{uniqueCustomers}</Text>
            </BlockStack>
          </Card>
        </InlineGrid>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Most-wishlisted products</Text>
            {topProducts.length > 0 ? (
              <IndexTable
                resourceName={{ singular: "product", plural: "products" }}
                itemCount={topProducts.length}
                headings={[{ title: "Product" }, { title: "Saves" }]}
                selectable={false}
              >
                {topProducts.map((p, i) => (
                  <IndexTable.Row id={p.productId} key={p.productId} position={i}>
                    <IndexTable.Cell>{p.productTitle}</IndexTable.Cell>
                    <IndexTable.Cell>{p.count}</IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
            ) : (
              <Text as="p" tone="subdued">No wishlist activity yet.</Text>
            )}
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Recent activity</Text>
            {recent.length > 0 ? (
              <IndexTable
                resourceName={{ singular: "item", plural: "items" }}
                itemCount={recent.length}
                headings={[
                  { title: "Type" },
                  { title: "Product" },
                  { title: "Variant" },
                  { title: "Customer" },
                  { title: "Saved" },
                ]}
                selectable={false}
              >
                {recent.map((r, i) => (
                  <IndexTable.Row id={r.id} key={r.id} position={i}>
                    <IndexTable.Cell>
                      <Badge tone={r.kind === "wishlist" ? "info" : "attention"}>
                        {r.kind === "wishlist" ? "Wishlist" : "Saved"}
                      </Badge>
                    </IndexTable.Cell>
                    <IndexTable.Cell>{r.productTitle}</IndexTable.Cell>
                    <IndexTable.Cell>{r.variantTitle || "—"}</IndexTable.Cell>
                    <IndexTable.Cell>{r.shopifyCustomerId}</IndexTable.Cell>
                    <IndexTable.Cell>
                      {new Date(r.savedAt).toLocaleString("en-IN")}
                    </IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
            ) : (
              <EmptyState
                heading="No saved items yet"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>
                  Customers will appear here when they tap the wishlist heart
                  on a product page or move a cart line to "Save for Later".
                </p>
              </EmptyState>
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
