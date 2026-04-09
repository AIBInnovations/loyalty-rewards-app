import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useNavigation, useSubmit } from "@remix-run/react";
import {
  Page, Layout, Card, BlockStack, Text, Button,
  InlineStack, Badge, Checkbox, DataTable, Select, Banner,
} from "@shopify/polaris";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import { connectDB } from "../db.server";
import { ReviewSettings, getOrCreateReviewSettings } from "../.server/models/review-settings.model";
import { Review } from "../.server/models/review.model";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();
  const settings = await getOrCreateReviewSettings(session.shop);
  const pending  = await Review.find({ shopId: session.shop, status: "pending" }).sort({ createdAt: -1 }).limit(50).lean();
  const approved = await Review.find({ shopId: session.shop, status: "approved" }).sort({ createdAt: -1 }).limit(20).lean();
  return json({
    settings: JSON.parse(JSON.stringify(settings)),
    pending:  JSON.parse(JSON.stringify(pending)),
    approved: JSON.parse(JSON.stringify(approved)),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();
  const fd     = await request.formData();
  const action = fd.get("_action");

  if (action === "save_settings") {
    await ReviewSettings.findOneAndUpdate(
      { shopId: session.shop },
      {
        $set: {
          enabled:         fd.get("enabled") === "true",
          autoApprove:     fd.get("autoApprove") === "true",
          allowPhotos:     fd.get("allowPhotos") === "true",
          pointsForReview: parseInt(String(fd.get("pointsForReview") || "50"), 10),
        },
      },
      { upsert: true },
    );
  }

  if (action === "moderate") {
    const reviewId = String(fd.get("reviewId"));
    const status   = String(fd.get("status")) as "approved" | "rejected";
    await Review.findOneAndUpdate(
      { _id: reviewId, shopId: session.shop },
      { $set: { status } },
    );
  }

  return json({ success: true });
};

export default function ReviewsSettingsPage() {
  const { settings: s, pending, approved } = useLoaderData<typeof loader>();
  const nav    = useNavigation();
  const submit = useSubmit();
  const saving = nav.state === "submitting";

  const [enabled, setEnabled]       = useState(s.enabled);
  const [autoApprove, setAutoApprove] = useState(s.autoApprove);
  const [allowPhotos, setAllowPhotos] = useState(s.allowPhotos);
  const [points, setPoints]         = useState(String(s.pointsForReview));

  const saveSettings = useCallback(() => {
    const fd = new FormData();
    fd.set("_action",        "save_settings");
    fd.set("enabled",        String(enabled));
    fd.set("autoApprove",    String(autoApprove));
    fd.set("allowPhotos",    String(allowPhotos));
    fd.set("pointsForReview", points);
    submit(fd, { method: "POST" });
  }, [enabled, autoApprove, allowPhotos, points, submit]);

  const moderate = (reviewId: string, status: "approved" | "rejected") => {
    const fd = new FormData();
    fd.set("_action",  "moderate");
    fd.set("reviewId", reviewId);
    fd.set("status",   status);
    submit(fd, { method: "POST" });
  };

  const stars = (n: number) => "★".repeat(n) + "☆".repeat(5 - n);

  return (
    <Page title="Product Reviews & Q&A" backAction={{ url: "/app" }}>
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <Text variant="headingMd" as="h2">Review Settings</Text>
                  <Badge tone={enabled ? "success" : "critical"}>{enabled ? "Enabled" : "Disabled"}</Badge>
                </InlineStack>
                <Checkbox label="Enable Reviews & Q&A" checked={enabled} onChange={setEnabled} />
                <Checkbox label="Auto-approve reviews (no moderation)" checked={autoApprove} onChange={setAutoApprove} />
                <Checkbox label="Allow photo uploads with reviews" checked={allowPhotos} onChange={setAllowPhotos} />
                <InlineStack gap="300" blockAlign="center">
                  <Text variant="bodyMd" as="span">Loyalty points awarded per review:</Text>
                  <input
                    type="number"
                    value={points}
                    onChange={(e) => setPoints(e.target.value)}
                    style={{ width: 80, padding: "6px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14 }}
                    min="0"
                  />
                </InlineStack>
                <InlineStack align="end">
                  <Button variant="primary" onClick={saveSettings} loading={saving}>Save Settings</Button>
                </InlineStack>
              </BlockStack>
            </Card>

            {pending.length > 0 && (
              <Card>
                <BlockStack gap="300">
                  <InlineStack align="space-between">
                    <Text variant="headingMd" as="h2">Pending Reviews</Text>
                    <Badge tone="warning">{pending.length} pending</Badge>
                  </InlineStack>
                  {(pending as any[]).map((r) => (
                    <Card key={r._id}>
                      <BlockStack gap="200">
                        <InlineStack align="space-between">
                          <Text variant="bodyMd" as="span" fontWeight="semibold">{r.authorName} — {stars(r.rating)}</Text>
                          <Text variant="bodySm" as="span" tone="subdued">{new Date(r.createdAt).toLocaleDateString("en-IN")}</Text>
                        </InlineStack>
                        <Text variant="bodySm" as="p">{r.body}</Text>
                        {r.photoUrls?.length > 0 && (
                          <InlineStack gap="200">
                            {r.photoUrls.map((u: string, i: number) => (
                              <img key={i} src={u} alt="Review" style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 6 }} />
                            ))}
                          </InlineStack>
                        )}
                        <InlineStack gap="200">
                          <Button size="slim" tone="success" onClick={() => moderate(r._id, "approved")}>Approve</Button>
                          <Button size="slim" tone="critical" onClick={() => moderate(r._id, "rejected")}>Reject</Button>
                        </InlineStack>
                      </BlockStack>
                    </Card>
                  ))}
                </BlockStack>
              </Card>
            )}

            {approved.length > 0 && (
              <Card>
                <BlockStack gap="300">
                  <Text variant="headingMd" as="h2">Approved Reviews ({approved.length})</Text>
                  {(approved as any[]).map((r) => (
                    <InlineStack key={r._id} align="space-between" blockAlign="start" gap="300">
                      <BlockStack gap="100">
                        <Text variant="bodySm" as="p" fontWeight="semibold">{r.authorName} — {stars(r.rating)}</Text>
                        <Text variant="bodySm" as="p" tone="subdued">{r.body.slice(0, 80)}{r.body.length > 80 ? "…" : ""}</Text>
                      </BlockStack>
                      <Button size="slim" tone="critical" variant="plain" onClick={() => moderate(r._id, "rejected")}>Remove</Button>
                    </InlineStack>
                  ))}
                </BlockStack>
              </Card>
            )}

            {pending.length === 0 && approved.length === 0 && (
              <Banner tone="info">No reviews yet. Add the "Product Reviews & Q&A" block to your theme and customers will be able to submit reviews.</Banner>
            )}
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
