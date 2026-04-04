import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import {
  Page, Layout, Card, BlockStack, Text, TextField, Button,
  Checkbox, Select, InlineGrid, InlineStack, Divider, Banner,
  Badge, IndexTable, EmptyState,
} from "@shopify/polaris";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import { connectDB } from "../db.server";
import {
  getOrCreateVoiceAgentSettings,
  VoiceAgentSettings,
} from "../.server/models/voice-agent-settings.model";
import { AbandonedCart } from "../.server/models/abandoned-cart.model";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();

  const settings = await getOrCreateVoiceAgentSettings(session.shop);

  const [recentCalls, totalDetected, totalCalled, totalRecovered] =
    await Promise.all([
      AbandonedCart.find({ shopId: session.shop, status: { $nin: ["detected", "scheduled"] } })
        .sort({ callMadeAt: -1 })
        .limit(20)
        .lean(),
      AbandonedCart.countDocuments({ shopId: session.shop }),
      AbandonedCart.countDocuments({
        shopId: session.shop,
        status: { $in: ["called", "calling", "declined", "no_answer"] },
      }),
      AbandonedCart.countDocuments({ shopId: session.shop, status: "recovered" }),
    ]);

  return json({
    settings: JSON.parse(JSON.stringify(settings)),
    stats: { totalDetected, totalCalled, totalRecovered, revenueRecovered: settings.totalRevenueRecovered },
    calls: recentCalls.map((c) => ({
      id: c._id.toString(),
      name: c.customerName,
      phone: c.customerPhone?.replace(/(\d{2})(\d{5})(\d{3})/, "+$1 ●●●●● $3") || "N/A",
      cartTotal: c.cartTotal,
      status: c.status,
      outcome: c.callOutcome || "-",
      duration: c.callDuration || 0,
      date: c.callMadeAt?.toISOString() || c.detectedAt?.toISOString(),
    })),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();
  const data = Object.fromEntries(await request.formData());

  await VoiceAgentSettings.findOneAndUpdate(
    { shopId: session.shop },
    {
      $set: {
        enabled: data.enabled === "true",
        sarvamApiKey: data.sarvamApiKey || "",
        sarvamAgentId: data.sarvamAgentId || "",
        callDelayMinutes: Number(data.callDelayMinutes) || 15,
        minCartValue: Number(data.minCartValue) || 500,
        maxCallsPerDay: Number(data.maxCallsPerDay) || 100,
        callWindowStart: Number(data.callWindowStart) || 9,
        callWindowEnd: Number(data.callWindowEnd) || 21,
        language: data.language || "hinglish",
        greeting: data.greeting || "",
        offerDiscount: data.offerDiscount === "true",
        discountType: data.discountType || "percentage",
        discountValue: Number(data.discountValue) || 10,
        offerLoyaltyPoints: data.offerLoyaltyPoints === "true",
        bonusPoints: Number(data.bonusPoints) || 500,
        sendWhatsApp: data.sendWhatsApp === "true",
        whatsappNumber: data.whatsappNumber || "",
      },
    },
    { upsert: true },
  );

  return json({ success: true });
};

export default function VoiceAgentPage() {
  const { settings, stats, calls } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const nav = useNavigation();
  const isLoading = nav.state === "submitting";

  const [s, setS] = useState({ ...settings });
  const u = (f: string) => (v: string | boolean) => setS((p: any) => ({ ...p, [f]: v }));
  const uN = (f: string) => (v: string) => setS((p: any) => ({ ...p, [f]: Number(v) }));

  const save = useCallback(() => {
    const fd = new FormData();
    Object.entries(s).forEach(([k, v]) => {
      if (!["_id", "__v", "shopId", "createdAt", "updatedAt", "totalCallsMade", "totalRecovered", "totalRevenueRecovered"].includes(k)) {
        fd.set(k, String(v));
      }
    });
    submit(fd, { method: "post" });
  }, [s, submit]);

  const statusBadge = (status: string) => {
    const toneMap: Record<string, "success" | "critical" | "warning" | "info"> = {
      recovered: "success", called: "info", declined: "critical",
      no_answer: "warning", calling: "info", skipped: "warning",
    };
    return <Badge tone={toneMap[status] || "info"}>{status}</Badge>;
  };

  return (
    <Page
      title="Voice Agent"
      subtitle="AI-powered abandoned cart recovery calls"
      primaryAction={{ content: "Save", onAction: save, loading: isLoading }}
      backAction={{ content: "Dashboard", url: "/app" }}
    >
      <BlockStack gap="500">
        {/* Stats */}
        <InlineGrid columns={4} gap="400">
          <Card><BlockStack gap="200">
            <Text as="p" tone="subdued">Carts Detected</Text>
            <Text as="p" variant="headingXl">{stats.totalDetected}</Text>
          </BlockStack></Card>
          <Card><BlockStack gap="200">
            <Text as="p" tone="subdued">Calls Made</Text>
            <Text as="p" variant="headingXl">{stats.totalCalled}</Text>
          </BlockStack></Card>
          <Card><BlockStack gap="200">
            <Text as="p" tone="subdued">Recovered</Text>
            <Text as="p" variant="headingXl">{stats.totalRecovered}</Text>
          </BlockStack></Card>
          <Card><BlockStack gap="200">
            <Text as="p" tone="subdued">Revenue Recovered</Text>
            <Text as="p" variant="headingXl">₹{(stats.revenueRecovered / 100).toLocaleString("en-IN")}</Text>
          </BlockStack></Card>
        </InlineGrid>

        <Layout>
          {/* Enable + API Config */}
          <Layout.AnnotatedSection title="Voice Agent" description="Enable AI voice calls for abandoned cart recovery. Requires a Sarvam AI account.">
            <Card><BlockStack gap="400">
              <Checkbox label="Enable Voice Agent" checked={s.enabled} onChange={u("enabled")} />
              {s.enabled && (
                <>
                  <TextField label="Sarvam AI API Key" value={s.sarvamApiKey} onChange={u("sarvamApiKey")} type="password" autoComplete="off" helpText="Get your API key from sarvam.ai" />
                  <TextField label="Sarvam Agent ID" value={s.sarvamAgentId} onChange={u("sarvamAgentId")} autoComplete="off" helpText="Create an agent on Sarvam Samvaad and enter its ID" />
                </>
              )}
            </BlockStack></Card>
          </Layout.AnnotatedSection>

          {/* Call Configuration */}
          <Layout.AnnotatedSection title="Call Settings" description="Configure when and how calls are made.">
            <Card><BlockStack gap="400">
              <InlineGrid columns={2} gap="300">
                <TextField label="Call Delay (minutes)" type="number" value={String(s.callDelayMinutes)} onChange={uN("callDelayMinutes")} min={5} max={120} helpText="Wait this long after cart abandonment before calling" autoComplete="off" />
                <TextField label="Min Cart Value (₹)" type="number" value={String(s.minCartValue)} onChange={uN("minCartValue")} helpText="Only call for carts above this value" autoComplete="off" />
              </InlineGrid>
              <InlineGrid columns={3} gap="300">
                <TextField label="Max Calls/Day" type="number" value={String(s.maxCallsPerDay)} onChange={uN("maxCallsPerDay")} autoComplete="off" />
                <TextField label="Call Window Start (hour)" type="number" value={String(s.callWindowStart)} onChange={uN("callWindowStart")} min={0} max={23} helpText="24h format IST" autoComplete="off" />
                <TextField label="Call Window End (hour)" type="number" value={String(s.callWindowEnd)} onChange={uN("callWindowEnd")} min={0} max={23} autoComplete="off" />
              </InlineGrid>
              <Select label="Language" options={[
                { label: "Hindi-English (Hinglish)", value: "hinglish" },
                { label: "Hindi", value: "hi" },
                { label: "English", value: "en" },
              ]} value={s.language} onChange={u("language")} />
            </BlockStack></Card>
          </Layout.AnnotatedSection>

          {/* Call Script */}
          <Layout.AnnotatedSection title="Call Script" description="Customize what the AI agent says. Use {name}, {brand}, {product}, {amount}, {points} as placeholders.">
            <Card><BlockStack gap="400">
              <TextField label="Greeting Template" value={s.greeting} onChange={u("greeting")} multiline={3} autoComplete="off" helpText="Variables: {name}, {brand}, {product}, {amount}, {points}" />
            </BlockStack></Card>
          </Layout.AnnotatedSection>

          {/* Incentive */}
          <Layout.AnnotatedSection title="Incentive" description="Offer discount or loyalty points to encourage purchase completion.">
            <Card><BlockStack gap="400">
              <Checkbox label="Offer discount during call" checked={s.offerDiscount} onChange={u("offerDiscount")} />
              {s.offerDiscount && (
                <InlineGrid columns={2} gap="300">
                  <Select label="Discount Type" options={[
                    { label: "Percentage (%)", value: "percentage" },
                    { label: "Fixed Amount (₹)", value: "fixed_amount" },
                  ]} value={s.discountType} onChange={u("discountType")} />
                  <TextField label="Discount Value" type="number" value={String(s.discountValue)} onChange={uN("discountValue")} autoComplete="off" />
                </InlineGrid>
              )}
              <Divider />
              <Checkbox label="Offer bonus loyalty points" checked={s.offerLoyaltyPoints} onChange={u("offerLoyaltyPoints")} />
              {s.offerLoyaltyPoints && (
                <TextField label="Bonus Points" type="number" value={String(s.bonusPoints)} onChange={uN("bonusPoints")} helpText="Extra loyalty points if they complete the purchase" autoComplete="off" />
              )}
            </BlockStack></Card>
          </Layout.AnnotatedSection>

          {/* WhatsApp */}
          <Layout.AnnotatedSection title="WhatsApp Follow-up" description="Send checkout link via WhatsApp after the call.">
            <Card><BlockStack gap="400">
              <Checkbox label="Send WhatsApp follow-up" checked={s.sendWhatsApp} onChange={u("sendWhatsApp")} />
              {s.sendWhatsApp && (
                <TextField label="WhatsApp Business Number" value={s.whatsappNumber} onChange={u("whatsappNumber")} placeholder="+919876543210" autoComplete="off" />
              )}
            </BlockStack></Card>
          </Layout.AnnotatedSection>
        </Layout>

        {/* Recent Calls */}
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Recent Calls</Text>
            {calls.length > 0 ? (
              <IndexTable
                resourceName={{ singular: "call", plural: "calls" }}
                itemCount={calls.length}
                headings={[
                  { title: "Customer" },
                  { title: "Phone" },
                  { title: "Cart" },
                  { title: "Status" },
                  { title: "Outcome" },
                  { title: "Duration" },
                  { title: "Date" },
                ]}
                selectable={false}
              >
                {calls.map((c: any, i: number) => (
                  <IndexTable.Row id={c.id} key={c.id} position={i}>
                    <IndexTable.Cell>{c.name}</IndexTable.Cell>
                    <IndexTable.Cell><Text as="span" variant="bodySm">{c.phone}</Text></IndexTable.Cell>
                    <IndexTable.Cell>₹{(c.cartTotal / 100).toFixed(0)}</IndexTable.Cell>
                    <IndexTable.Cell>{statusBadge(c.status)}</IndexTable.Cell>
                    <IndexTable.Cell>{c.outcome}</IndexTable.Cell>
                    <IndexTable.Cell>{c.duration}s</IndexTable.Cell>
                    <IndexTable.Cell>{c.date ? new Date(c.date).toLocaleDateString("en-IN") : "-"}</IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
            ) : (
              <EmptyState heading="No calls yet" image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png">
                <p>Configure your Sarvam AI credentials and enable the voice agent. Calls will appear here as carts are abandoned.</p>
              </EmptyState>
            )}
          </BlockStack>
        </Card>

        <Banner tone="info">
          <p>
            <strong>How it works:</strong> When a customer abandons their cart, we wait {s.callDelayMinutes} minutes, then our AI agent calls them offering
            {s.offerDiscount ? ` ${s.discountValue}${s.discountType === "percentage" ? "%" : "₹"} off` : ""}
            {s.offerDiscount && s.offerLoyaltyPoints ? " + " : ""}
            {s.offerLoyaltyPoints ? ` ${s.bonusPoints} bonus loyalty points` : ""}.
            Calls are only made between {s.callWindowStart}:00 - {s.callWindowEnd}:00 IST for carts above ₹{s.minCartValue}.
          </p>
        </Banner>
      </BlockStack>
    </Page>
  );
}
