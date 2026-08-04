import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import {
  Page, Layout, Card, BlockStack, Text, TextField, Button,
  Checkbox, Select, InlineGrid, InlineStack, Divider, Banner,
} from "@shopify/polaris";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import { connectDB } from "../db.server";
import { getOrCreateWheelSettings, WheelSettings, type IWheelPrize } from "../.server/models/wheel-settings.model";
import { Subscriber } from "../.server/models/subscriber.model";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();
  const settings = await getOrCreateWheelSettings(session.shop);
  const totalSpins = await Subscriber.countDocuments({ shopId: session.shop, source: "spin_wheel" });
  return json({ settings: JSON.parse(JSON.stringify(settings)), totalSpins });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();
  const data = Object.fromEntries(await request.formData());
  const prizes = JSON.parse(String(data.prizes) || "[]");

  await WheelSettings.findOneAndUpdate(
    { shopId: session.shop },
    {
      $set: {
        enabled: data.enabled === "true",
        headline: data.headline || "",
        subtext: data.subtext || "",
        buttonText: data.buttonText || "Try My Luck",
        triggerButtonText: data.triggerButtonText || "🎰 Spin & Win",
        triggerButtonColor: data.triggerButtonColor || "#e91e63",
        prizes,
        bgColor: data.bgColor || "#ffffff",
        centerPointerColor: data.centerPointerColor || "#5C6AC4",
        outerBorderColor: data.outerBorderColor || "#000000",
      },
    },
    { upsert: true },
  );
  return json({ success: true });
};

const DEFAULT_PRIZE: IWheelPrize = {
  label: "5% OFF", discountType: "percentage", discountValue: 5, probability: 20, color: "#5C6AC4",
};

export default function WheelSettingsPage() {
  const { settings, totalSpins } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const nav = useNavigation();

  const [enabled, setEnabled] = useState(settings.enabled);
  const [headline, setHeadline] = useState(settings.headline);
  const [subtext, setSubtext] = useState(settings.subtext);
  const [buttonText, setButtonText] = useState(settings.buttonText);
  const [triggerText, setTriggerText] = useState(settings.triggerButtonText);
  const [triggerColor, setTriggerColor] = useState(settings.triggerButtonColor);
  const [bgColor, setBgColor] = useState(settings.bgColor);
  const [centerPointerColor, setCenterPointerColor] = useState(settings.centerPointerColor);
  const [outerBorderColor, setOuterBorderColor] = useState(settings.outerBorderColor);
  const [prizes, setPrizes] = useState<IWheelPrize[]>(settings.prizes || []);

  const addPrize = useCallback(() => setPrizes((p) => [...p, { ...DEFAULT_PRIZE }]), []);
  const removePrize = useCallback((i: number) => setPrizes((p) => p.filter((_, idx) => idx !== i)), []);
  const updatePrize = useCallback((i: number, f: keyof IWheelPrize, v: any) => {
    setPrizes((p) => p.map((pr, idx) => idx === i ? { ...pr, [f]: v } : pr));
  }, []);

  const save = useCallback(() => {
    const fd = new FormData();
    fd.set("enabled", String(enabled));
    fd.set("headline", headline);
    fd.set("subtext", subtext);
    fd.set("buttonText", buttonText);
    fd.set("triggerButtonText", triggerText);
    fd.set("triggerButtonColor", triggerColor);
    fd.set("bgColor", bgColor);
    fd.set("centerPointerColor", centerPointerColor);
    fd.set("outerBorderColor", outerBorderColor);
    fd.set("prizes", JSON.stringify(prizes));
    submit(fd, { method: "post" });
  }, [enabled, headline, subtext, buttonText, triggerText, triggerColor, bgColor, centerPointerColor, outerBorderColor, prizes, submit]);

  return (
    <Page title="Spin the Wheel" primaryAction={{ content: "Save", onAction: save, loading: nav.state === "submitting" }} backAction={{ content: "Dashboard", url: "/app" }}>
      <BlockStack gap="500">
        <Layout>
          <Layout.AnnotatedSection title="Wheel Status" description={`Total spins: ${totalSpins}`}>
            <Card><Checkbox label="Enable Spin the Wheel" checked={enabled} onChange={setEnabled} /></Card>
          </Layout.AnnotatedSection>

          <Layout.AnnotatedSection title="Content" description="Customize the popup text and trigger button.">
            <Card>
              <BlockStack gap="400">
                <TextField label="Headline" value={headline} onChange={setHeadline} autoComplete="off" />
                <TextField label="Sub Text" value={subtext} onChange={setSubtext} autoComplete="off" />
                <TextField label="Spin Button Text" value={buttonText} onChange={setButtonText} autoComplete="off" />
                <Divider />
                <InlineGrid columns={2} gap="300">
                  <TextField label="Trigger Button Text" value={triggerText} onChange={setTriggerText} autoComplete="off" />
                  <TextField label="Trigger Color" value={triggerColor} onChange={setTriggerColor} autoComplete="off" />
                </InlineGrid>
                <TextField label="Background Color" value={bgColor} onChange={setBgColor} autoComplete="off" />
                <InlineGrid columns={2} gap="300">
                  <TextField label="Center Pointer Color" value={centerPointerColor} onChange={setCenterPointerColor} autoComplete="off" helpText="Center hub and pointer arrow" />
                  <TextField label="Outer Border Color" value={outerBorderColor} onChange={setOuterBorderColor} autoComplete="off" helpText="Thick ring around the wheel" />
                </InlineGrid>
              </BlockStack>
            </Card>
          </Layout.AnnotatedSection>

          <Layout.AnnotatedSection title="Prizes" description="Configure wheel slices. Probability is relative weight (higher = more likely).">
            <Card>
              <BlockStack gap="400">
                {prizes.map((prize, i) => (
                  <div key={i}>
                    {i > 0 && <Divider />}
                    <BlockStack gap="200">
                      <InlineStack align="space-between">
                        <Text as="h3" variant="headingSm">Slice {i + 1}: {prize.label}</Text>
                        <Button size="slim" tone="critical" onClick={() => removePrize(i)}>Remove</Button>
                      </InlineStack>
                      <InlineGrid columns={3} gap="200">
                        <TextField label="Label" value={prize.label} onChange={(v) => updatePrize(i, "label", v)} autoComplete="off" />
                        <Select label="Type" options={[
                          { label: "%", value: "percentage" },
                          { label: "₹", value: "fixed_amount" },
                          { label: "Free Ship", value: "free_shipping" },
                          { label: "No Prize", value: "no_prize" },
                        ]} value={prize.discountType} onChange={(v) => updatePrize(i, "discountType", v)} />
                        <TextField label="Value" type="number" value={String(prize.discountValue)} onChange={(v) => updatePrize(i, "discountValue", Number(v))} autoComplete="off" />
                      </InlineGrid>
                      <InlineGrid columns={2} gap="200">
                        <TextField label="Probability Weight" type="number" value={String(prize.probability)} onChange={(v) => updatePrize(i, "probability", Number(v))} autoComplete="off" />
                        <TextField label="Slice Color" value={prize.color} onChange={(v) => updatePrize(i, "color", v)} autoComplete="off" />
                      </InlineGrid>
                    </BlockStack>
                  </div>
                ))}
                <Button onClick={addPrize}>+ Add Prize Slice</Button>
              </BlockStack>
            </Card>
          </Layout.AnnotatedSection>
        </Layout>
        <Banner tone="info"><p>Enable "Spin Wheel" in Theme Editor → App embeds after saving.</p></Banner>
      </BlockStack>
    </Page>
  );
}
