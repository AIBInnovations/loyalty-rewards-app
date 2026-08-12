import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { Link, useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import {
  Page, Card, BlockStack, Text, IndexTable, Badge, Select, InlineStack, Button,
  EmptyState,
} from "@shopify/polaris";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import { connectDB } from "../db.server";
import { Bundle } from "../.server/models/bundle.model";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();
  const shopId = session.shop;
  const url = new URL(request.url);
  const statusFilter = url.searchParams.get("status") || "";

  const query: Record<string, unknown> = { shopId };
  if (statusFilter) query.status = statusFilter;

  const bundles = await Bundle.find(query).sort({ updatedAt: -1 }).limit(100).lean();

  return json({
    statusFilter,
    bundles: bundles.map((b) => ({
      id: String(b._id),
      title: b.title,
      internalName: b.internalName,
      type: b.type,
      status: b.status,
      productCount: (b.draftProducts || []).length,
      updatedAt: b.updatedAt ? new Date(b.updatedAt).toISOString() : "",
    })),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();
  const shopId = session.shop;

  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");
  const bundleId = String(formData.get("bundleId") || "");
  if (!bundleId) return json({ success: false }, { status: 400 });

  const bundle = await Bundle.findOne({ _id: bundleId, shopId });
  if (!bundle) return json({ success: false }, { status: 404 });

  if (intent === "pause") {
    bundle.status = "paused";
    await bundle.save();
  } else if (intent === "resume") {
    // Only a published bundle (has at least one version) can go back to active.
    bundle.status = bundle.currentVersion > 0 ? "active" : "draft";
    await bundle.save();
  } else if (intent === "archive") {
    // Soft delete — never hard-delete a bundle that might be referenced by
    // past order attribution once that's built (Phase 10).
    bundle.status = "archived";
    await bundle.save();
  } else if (intent === "duplicate") {
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
      currentVersion: 0,
      versions: [],
    });
    await copy.save();
  }

  return json({ success: true });
};

const STATUS_TONE: Record<string, "success" | "info" | "attention" | "warning" | "critical"> = {
  active: "success",
  draft: "info",
  scheduled: "info",
  paused: "attention",
  expired: "warning",
  archived: "critical",
};

const TYPE_LABEL: Record<string, string> = {
  fixed_product: "Fixed Product Bundle",
  offer_tiers: "Offer Tiers",
  fixed_price: "Fixed Price Bundle",
  byob: "Build Your Own Bundle",
  mix_match: "Mix and Match",
  variable: "Variable Bundle",
  step: "Step Bundle",
  routine: "Routine Bundle",
  buy_any_x: "Buy Any X for Fixed Price",
  category: "Category-Based Bundle",
  frequently_bought: "Frequently Bought Together",
  personalized: "Personalised Deal",
  custom: "Custom Merchant Deal",
  upsell: "Bundle Upsell/Cross-sell",
};

export default function BundleGenieList() {
  const { statusFilter, bundles } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const [status, setStatus] = useState(statusFilter);

  const applyStatus = useCallback((value: string) => {
    setStatus(value);
    window.location.href = value
      ? `/app/bundle-genie/bundles?status=${encodeURIComponent(value)}`
      : "/app/bundle-genie/bundles";
  }, []);

  const runAction = useCallback((bundleId: string, intent: string) => {
    const fd = new FormData();
    fd.set("bundleId", bundleId);
    fd.set("intent", intent);
    submit(fd, { method: "post" });
  }, [submit]);

  const isBusy = navigation.state === "submitting";

  return (
    <Page
      title="All Bundles"
      primaryAction={{ content: "Create bundle", url: "/app/bundle-genie/bundles/new" }}
      backAction={{ url: "/app/bundle-genie" }}
    >
      <BlockStack gap="400">
        <InlineStack gap="200">
          <Link to="/app/bundle-genie/bundles/new">Create bundle →</Link>
        </InlineStack>
        <Card>
          <div style={{ maxWidth: 240 }}>
            <Select
              label="Status"
              labelHidden
              options={[
                { label: "All statuses", value: "" },
                { label: "Draft", value: "draft" },
                { label: "Active", value: "active" },
                { label: "Paused", value: "paused" },
                { label: "Archived", value: "archived" },
              ]}
              value={status}
              onChange={applyStatus}
            />
          </div>
        </Card>

        <Card padding="0">
          {bundles.length === 0 ? (
            <EmptyState
              heading="No bundles yet"
              action={{ content: "Create bundle", url: "/app/bundle-genie/bundles/new" }}
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>Bundles you create will show up here.</p>
            </EmptyState>
          ) : (
            <IndexTable
              itemCount={bundles.length}
              headings={[
                { title: "Bundle" },
                { title: "Type" },
                { title: "Status" },
                { title: "Products" },
                { title: "Updated" },
                { title: "Actions" },
              ]}
              selectable={false}
            >
              {bundles.map((b, index) => (
                <IndexTable.Row id={b.id} key={b.id} position={index}>
                  <IndexTable.Cell>
                    <Link to={`/app/bundle-genie/bundles/${b.id}`}>{b.title}</Link>
                  </IndexTable.Cell>
                  <IndexTable.Cell>{TYPE_LABEL[b.type] || b.type}</IndexTable.Cell>
                  <IndexTable.Cell>
                    <Badge tone={STATUS_TONE[b.status] || "info"}>{b.status}</Badge>
                  </IndexTable.Cell>
                  <IndexTable.Cell>{b.productCount}</IndexTable.Cell>
                  <IndexTable.Cell>
                    {b.updatedAt ? new Date(b.updatedAt).toLocaleDateString("en-IN") : ""}
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <InlineStack gap="150">
                      {b.status === "active" && (
                        <Button size="slim" disabled={isBusy} onClick={() => runAction(b.id, "pause")}>
                          Pause
                        </Button>
                      )}
                      {b.status === "paused" && (
                        <Button size="slim" disabled={isBusy} onClick={() => runAction(b.id, "resume")}>
                          Resume
                        </Button>
                      )}
                      <Button size="slim" disabled={isBusy} onClick={() => runAction(b.id, "duplicate")}>
                        Duplicate
                      </Button>
                      {b.status !== "archived" && (
                        <Button size="slim" tone="critical" disabled={isBusy} onClick={() => runAction(b.id, "archive")}>
                          Archive
                        </Button>
                      )}
                    </InlineStack>
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          )}
        </Card>
      </BlockStack>
    </Page>
  );
}
