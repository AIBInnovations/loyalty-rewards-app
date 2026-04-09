import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useNavigation, useSubmit } from "@remix-run/react";
import {
  Page, Layout, Card, BlockStack, Text, TextField, Button,
  InlineStack, Badge, Checkbox, DataTable, Banner, Icon,
} from "@shopify/polaris";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import { connectDB } from "../db.server";
import { UGCSettings, getOrCreateUGCSettings } from "../.server/models/ugc-settings.model";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();
  const s = await getOrCreateUGCSettings(session.shop);
  return json({ settings: JSON.parse(JSON.stringify(s)) });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();
  const fd = await request.formData();
  const photos = JSON.parse(String(fd.get("photos") || "[]"));
  await UGCSettings.findOneAndUpdate(
    { shopId: session.shop },
    { $set: { enabled: fd.get("enabled") === "true", title: fd.get("title"), photos } },
    { upsert: true },
  );
  return json({ success: true });
};

const emptyPhoto = { imageUrl: "", caption: "", productHandle: "", instagramUrl: "" };

export default function UGCSettingsPage() {
  const { settings: s } = useLoaderData<typeof loader>();
  const nav    = useNavigation();
  const submit = useSubmit();
  const saving = nav.state === "submitting";

  const [enabled, setEnabled] = useState(s.enabled);
  const [title, setTitle]     = useState(s.title || "As Seen On Instagram");
  const [photos, setPhotos]   = useState<typeof emptyPhoto[]>(s.photos || []);
  const [newPhoto, setNewPhoto] = useState({ ...emptyPhoto });

  const addPhoto = () => {
    if (!newPhoto.imageUrl) return;
    setPhotos([...photos, { ...newPhoto }]);
    setNewPhoto({ ...emptyPhoto });
  };

  const removePhoto = (idx: number) => {
    setPhotos(photos.filter((_, i) => i !== idx));
  };

  const save = useCallback(() => {
    const fd = new FormData();
    fd.set("enabled", String(enabled));
    fd.set("title", title);
    fd.set("photos", JSON.stringify(photos));
    submit(fd, { method: "POST" });
  }, [enabled, title, photos, submit]);

  return (
    <Page title="Instagram UGC Gallery" backAction={{ url: "/app" }}>
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <Text variant="headingMd" as="h2">UGC Gallery</Text>
                  <Badge tone={enabled ? "success" : "critical"}>{enabled ? "Enabled" : "Disabled"}</Badge>
                </InlineStack>
                <Checkbox label="Enable UGC Gallery" checked={enabled} onChange={setEnabled} />
                <TextField label="Section Title" value={title} onChange={setTitle} autoComplete="off" />
                <Banner tone="info">
                  Add the "Instagram UGC Gallery" block to your theme via the Theme Editor. Paste image URLs from Instagram or your CDN — no Instagram API needed.
                </Banner>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">Add Photo</Text>
                <TextField label="Image URL" value={newPhoto.imageUrl} onChange={(v) => setNewPhoto({ ...newPhoto, imageUrl: v })} autoComplete="off" placeholder="https://cdn.shopify.com/..." />
                <TextField label="Caption" value={newPhoto.caption} onChange={(v) => setNewPhoto({ ...newPhoto, caption: v })} autoComplete="off" placeholder="Loving this product! ❤️" />
                <TextField label="Product Handle (optional — makes photo shoppable)" value={newPhoto.productHandle} onChange={(v) => setNewPhoto({ ...newPhoto, productHandle: v })} autoComplete="off" placeholder="premium-face-serum" />
                <TextField label="Instagram Post URL (optional)" value={newPhoto.instagramUrl} onChange={(v) => setNewPhoto({ ...newPhoto, instagramUrl: v })} autoComplete="off" placeholder="https://www.instagram.com/p/..." />
                <Button onClick={addPhoto} disabled={!newPhoto.imageUrl}>Add Photo</Button>
              </BlockStack>
            </Card>

            {photos.length > 0 && (
              <Card>
                <BlockStack gap="300">
                  <Text variant="headingMd" as="h2">Gallery Photos ({photos.length})</Text>
                  {photos.map((p, idx) => (
                    <InlineStack key={idx} align="space-between" blockAlign="center" gap="300">
                      <img src={p.imageUrl} alt={p.caption} style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 8 }} />
                      <BlockStack gap="100">
                        <Text variant="bodySm" as="p" fontWeight="semibold">{p.caption || "(no caption)"}</Text>
                        {p.productHandle && <Text variant="bodySm" as="p" tone="subdued">→ {p.productHandle}</Text>}
                      </BlockStack>
                      <Button tone="critical" variant="plain" onClick={() => removePhoto(idx)}>Remove</Button>
                    </InlineStack>
                  ))}
                </BlockStack>
              </Card>
            )}

            <InlineStack align="end">
              <Button variant="primary" onClick={save} loading={saving}>Save Gallery</Button>
            </InlineStack>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
