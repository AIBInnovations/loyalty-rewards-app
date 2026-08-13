import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { Link, useLoaderData, useSubmit, useNavigation, useSearchParams } from "@remix-run/react";
import {
  Page, Card, BlockStack, Text, IndexTable, Badge, InlineStack, Button,
  EmptyState, Tabs, TextField, Pagination, useIndexResourceState, Popover, OptionList,
} from "@shopify/polaris";
import { ViewIcon, DuplicateIcon, EditIcon, DeleteIcon, SortAscendingIcon, SortDescendingIcon, SearchIcon, FilterIcon } from "@shopify/polaris-icons";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import { connectDB } from "../db.server";
import { Bundle } from "../.server/models/bundle.model";
import { Subscription } from "../.server/models/subscription.model";
import { runBundleQuickAction, type BundleQuickActionIntent } from "../.server/services/bundle-quick-actions.service";
import { BundleGenieShell } from "../components/bundle-genie-nav";

const PAGE_SIZE = 10;

const VISIBLE_TABS = [
  { key: "", label: "All" },
  { key: "active", label: "Active" },
  { key: "draft", label: "Draft" },
];

const FILTER_ONLY_STATUSES = [
  { value: "paused", label: "Paused" },
  { value: "archived", label: "Archived" },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();
  const shopId = session.shop;
  const url = new URL(request.url);
  const statusFilter = url.searchParams.get("status") || "";
  const search = url.searchParams.get("q") || "";
  const sortDir = url.searchParams.get("sort") === "asc" ? 1 : -1;
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);

  const query: Record<string, unknown> = { shopId };
  if (statusFilter) query.status = statusFilter;
  if (search) query.title = { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };

  const [bundles, totalCount, subscription] = await Promise.all([
    Bundle.find(query).sort({ updatedAt: sortDir }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean(),
    Bundle.countDocuments(query),
    Subscription.findOne({ shopId }).lean(),
  ]);

  return json({
    statusFilter,
    search,
    sortDir: sortDir === 1 ? "asc" : "desc",
    page,
    totalPages: Math.max(1, Math.ceil(totalCount / PAGE_SIZE)),
    plan: subscription?.plan || "free",
    billingState: subscription?.billingState || "trial",
    shopDomain: shopId,
    bundles: bundles.map((b) => ({
      id: String(b._id),
      title: b.title,
      type: b.type,
      status: b.status,
      updatedAt: b.updatedAt ? new Date(b.updatedAt).toISOString() : "",
      productHandle: b.draftProducts?.[0]?.handle || "",
    })),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "") as BundleQuickActionIntent;
  const bundleIds = formData.getAll("bundleId").map(String).filter(Boolean);
  if (!bundleIds.length) return json({ success: false }, { status: 400 });

  const results = await Promise.all(
    bundleIds.map((id) => runBundleQuickAction(session.shop, id, intent)),
  );
  const failed = results.filter((r) => !r.success);
  if (failed.length) return json({ success: false, error: failed[0].error }, { status: failed[0].status || 400 });
  return json({ success: true });
};

const TYPE_LABEL: Record<string, string> = {
  fixed_product: "Fixed Bundle",
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

function StatusToggle({ bundleId, active, disabled, onToggle }: { bundleId: string; active: boolean; disabled: boolean; onToggle: (bundleId: string, next: boolean) => void }) {
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: disabled ? "default" : "pointer" }}>
      <span style={{ position: "relative", display: "inline-flex" }}>
        <input
          type="checkbox"
          checked={active}
          disabled={disabled}
          onChange={() => onToggle(bundleId, !active)}
          style={{ position: "absolute", opacity: 0, width: 1, height: 1 }}
        />
        <span
          style={{
            width: 36, height: 20, borderRadius: 999, boxSizing: "border-box", padding: 2,
            background: active ? "#16a34a" : "#d1d5db", transition: "background 0.15s ease",
            display: "inline-flex", alignItems: "center",
          }}
        >
          <span
            style={{
              width: 16, height: 16, borderRadius: 999, background: "#fff",
              boxShadow: "0 1px 2px rgba(15,23,42,0.25)", transition: "transform 0.15s ease",
              transform: active ? "translateX(16px)" : "translateX(0)",
            }}
          />
        </span>
      </span>
      <Text as="span" tone={active ? "success" : "subdued"}>{active ? "Active" : "Paused"}</Text>
    </label>
  );
}

export default function BundleGenieList() {
  const { statusFilter, search, sortDir, page, totalPages, plan, billingState, shopDomain, bundles } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const [, setSearchParams] = useSearchParams();
  const [searchValue, setSearchValue] = useState(search);
  const isBusy = navigation.state === "submitting";

  const updateParams = useCallback((updates: Record<string, string>) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [key, value] of Object.entries(updates)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      if (!("page" in updates)) next.delete("page");
      return next;
    });
  }, [setSearchParams]);

  const tabIndex = Math.max(0, VISIBLE_TABS.findIndex((t) => t.key === statusFilter));
  const [searchOpen, setSearchOpen] = useState(Boolean(search));
  const [filterOpen, setFilterOpen] = useState(false);

  const runAction = useCallback((bundleId: string, intent: BundleQuickActionIntent) => {
    const fd = new FormData();
    fd.set("bundleId", bundleId);
    fd.set("intent", intent);
    submit(fd, { method: "post" });
  }, [submit]);

  const { selectedResources, allResourcesSelected, handleSelectionChange, clearSelection } = useIndexResourceState(
    bundles.map((b) => ({ id: b.id })),
  );

  const runBulkAction = useCallback((intent: BundleQuickActionIntent) => {
    const fd = new FormData();
    for (const id of selectedResources) fd.append("bundleId", id);
    fd.set("intent", intent);
    submit(fd, { method: "post" });
    clearSelection();
  }, [selectedResources, submit, clearSelection]);

  return (
    <Page
      title="Campaigns"
      titleMetadata={<Badge tone={billingState === "active" ? "success" : "info"}>{plan === "free" ? "Free plan" : `${plan} — ${billingState}`}</Badge>}
      subtitle="Manage all bundles, offers, and deals from this page."
      primaryAction={{ content: "Create Campaign", url: "/app/bundle-genie/bundles/new" }}
      backAction={{ url: "/app/bundle-genie" }}
    >
      <BundleGenieShell active="campaigns">
      <BlockStack gap="400">
        <Card padding="0">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingRight: 16 }}>
            <Tabs
              tabs={VISIBLE_TABS.map((t) => ({ id: t.key || "all", content: t.label }))}
              selected={tabIndex}
              onSelect={(index) => updateParams({ status: VISIBLE_TABS[index].key })}
            />
            <InlineStack gap="150">
              <Button icon={SearchIcon} accessibilityLabel="Search campaigns" onClick={() => setSearchOpen((v) => !v)} pressed={searchOpen} />
              <Popover
                active={filterOpen}
                onClose={() => setFilterOpen(false)}
                activator={
                  <Button icon={FilterIcon} accessibilityLabel="Filter by status" onClick={() => setFilterOpen((v) => !v)} pressed={filterOpen || FILTER_ONLY_STATUSES.some((s) => s.value === statusFilter)} />
                }
              >
                <OptionList
                  title="Status"
                  onChange={(selected) => { updateParams({ status: selected[0] || "" }); setFilterOpen(false); }}
                  options={FILTER_ONLY_STATUSES}
                  selected={FILTER_ONLY_STATUSES.some((s) => s.value === statusFilter) ? [statusFilter] : []}
                />
              </Popover>
              <Button
                icon={sortDir === "asc" ? SortAscendingIcon : SortDescendingIcon}
                onClick={() => updateParams({ sort: sortDir === "asc" ? "desc" : "asc" })}
                accessibilityLabel="Toggle sort by last updated"
              />
            </InlineStack>
          </div>

          {searchOpen && (
            <div style={{ padding: "0 16px 16px" }}>
              <TextField
                label="Search campaigns"
                labelHidden
                placeholder="Search campaigns"
                value={searchValue}
                onChange={setSearchValue}
                onBlur={() => updateParams({ q: searchValue })}
                autoComplete="off"
                clearButton
                onClearButtonClick={() => { setSearchValue(""); updateParams({ q: "" }); }}
                autoFocus
              />
            </div>
          )}

          {bundles.length === 0 ? (
            <EmptyState
              heading="No campaigns yet"
              action={{ content: "Create Campaign", url: "/app/bundle-genie/bundles/new" }}
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>Campaigns you create will show up here.</p>
            </EmptyState>
          ) : (
            <>
              <IndexTable
                itemCount={bundles.length}
                selectedItemsCount={allResourcesSelected ? "All" : selectedResources.length}
                onSelectionChange={handleSelectionChange}
                headings={[
                  { title: "Date Last Updated" },
                  { title: "Campaign Title" },
                  { title: "Status" },
                  { title: "Actions" },
                ]}
                bulkActions={[
                  { content: "Duplicate", onAction: () => runBulkAction("duplicate") },
                  { content: "Archive", onAction: () => runBulkAction("archive") },
                ]}
              >
                {bundles.map((b, index) => (
                  <IndexTable.Row id={b.id} key={b.id} position={index} selected={selectedResources.includes(b.id)}>
                    <IndexTable.Cell>
                      {b.updatedAt ? new Date(b.updatedAt).toLocaleDateString("en-IN", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : ""}
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <InlineStack gap="150" blockAlign="center">
                        <Link to={`/app/bundle-genie/bundles/${b.id}`}>{b.title}</Link>
                        <Badge>{TYPE_LABEL[b.type] || b.type}</Badge>
                      </InlineStack>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      {b.status === "archived" ? (
                        <Badge tone="critical">Archived</Badge>
                      ) : (
                        <StatusToggle
                          bundleId={b.id}
                          active={b.status === "active"}
                          disabled={isBusy || b.status === "draft"}
                          onToggle={(id, next) => runAction(id, next ? "resume" : "pause")}
                        />
                      )}
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <InlineStack gap="200">
                        <Button size="slim" variant="tertiary" icon={ViewIcon} disabled={!b.productHandle} accessibilityLabel="Preview on storefront" url={b.productHandle ? `https://${shopDomain}/products/${b.productHandle}` : undefined} target={b.productHandle ? "_blank" : undefined} />
                        <Button size="slim" variant="tertiary" icon={DuplicateIcon} disabled={isBusy} accessibilityLabel="Duplicate" onClick={() => runAction(b.id, "duplicate")} />
                        <Button size="slim" variant="tertiary" icon={EditIcon} accessibilityLabel="Edit" url={`/app/bundle-genie/bundles/${b.id}`} />
                        {b.status !== "archived" && (
                          <Button size="slim" variant="tertiary" tone="critical" icon={DeleteIcon} disabled={isBusy} accessibilityLabel="Archive" onClick={() => runAction(b.id, "archive")} />
                        )}
                      </InlineStack>
                    </IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
              <div style={{ display: "flex", justifyContent: "center", padding: 16 }}>
                <Pagination
                  label={`Page ${page} of ${totalPages}`}
                  hasPrevious={page > 1}
                  onPrevious={() => updateParams({ page: String(page - 1) })}
                  hasNext={page < totalPages}
                  onNext={() => updateParams({ page: String(page + 1) })}
                />
              </div>
            </>
          )}
        </Card>
      </BlockStack>
      </BundleGenieShell>
    </Page>
  );
}
