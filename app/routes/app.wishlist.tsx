import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  Text,
  IndexTable,
  InlineGrid,
  EmptyState,
  Badge,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { connectDB } from "../db.server";
import { WishlistItem } from "../.server/models/wishlist.model";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();

  const shop = session.shop;

  const [
    totalWishlist,
    totalSaved,
    uniqueCustomersAgg,
    topProductsAgg,
    recent,
  ] = await Promise.all([
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

export default function WishlistAdminPage() {
  const { totalWishlist, totalSaved, uniqueCustomers, topProducts, recent } =
    useLoaderData<typeof loader>();

  return (
    <Page
      title="Wishlist & Save for Later"
      backAction={{ content: "Dashboard", url: "/app" }}
    >
      <BlockStack gap="500">
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
                  Customers will appear here when they tap the wishlist heart on a product
                  page or move a cart line to "Save for Later". Enable the
                  "Wishlist Button" and "Wishlist & Saved Items" blocks in your theme editor.
                </p>
              </EmptyState>
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
