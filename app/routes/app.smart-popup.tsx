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
  Banner,
  Badge,
  EmptyState,
  Tag,
  Divider,
} from "@shopify/polaris";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import { connectDB } from "../db.server";
import {
  SmartPopupSettings,
  SmartPopupLead,
  getOrCreateSmartPopupSettings,
  type ISmartPopupCampaign,
  type SmartPopupPageType,
} from "../.server/models/smart-popup.model";

type CampaignDraft = ISmartPopupCampaign & { _id?: string };

const PAGE_OPTIONS: { label: string; value: SmartPopupPageType }[] = [
  { label: "Home", value: "home" },
  { label: "Product", value: "product" },
  { label: "Collection", value: "collection" },
  { label: "Blog", value: "blog" },
  { label: "Article", value: "article" },
  { label: "Page", value: "page" },
  { label: "Cart", value: "cart" },
  { label: "Search", value: "search" },
  { label: "Other", value: "other" },
];

const NEW_CAMPAIGN: CampaignDraft = {
  name: "Welcome Offer",
  status: "draft",
  priority: 10,
  startAt: null,
  endAt: null,
  trigger: {
    type: "timer",
    delaySeconds: 8,
    scrollPercent: 40,
    inactivitySeconds: 30,
  },
  targeting: {
    includePages: ["home", "product", "collection", "blog", "article", "page"],
    excludePages: ["cart"],
    devices: ["desktop", "mobile"],
    audience: "all",
    countries: [],
  },
  suppression: {
    afterCloseHours: 24,
    afterSubmitDays: 90,
    afterDismissHours: 6,
    maxPerSession: 1,
  },
  content: {
    headline: "Get 10% off your first order",
    subtext: "Join our newsletter and we'll send the code right away.",
    buttonText: "Send my code",
    successMessage: "Here's your code",
    consentText:
      "By subscribing you agree to receive marketing emails. You can unsubscribe at any time.",
    consentVersion: "v1",
    collectFirstName: false,
    bgColor: "#ffffff",
    accentColor: "#5C6AC4",
    textColor: "#111827",
    layout: "center",
    imageUrl: "",
  },
  offer: {
    type: "discount",
    discountType: "percentage",
    discountValue: 10,
    minimumOrderAmount: 0,
  },
  stats: { impressions: 0, opens: 0, closes: 0, submits: 0, converts: 0 },
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();
  const settings = await getOrCreateSmartPopupSettings(session.shop);
  const leadCount = await SmartPopupLead.countDocuments({
    shopId: session.shop,
  });
  return json({
    enabled: settings.enabled,
    campaigns: JSON.parse(JSON.stringify(settings.campaigns || [])),
    leadCount,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();

  const formData = await request.formData();
  const op = String(formData.get("op") || "save");

  if (op === "toggle-master") {
    const enabled = formData.get("enabled") === "true";
    await SmartPopupSettings.updateOne(
      { shopId: session.shop },
      { $set: { enabled } },
      { upsert: true },
    );
    return json({ success: true });
  }

  if (op === "delete") {
    const campaignId = String(formData.get("campaignId") || "");
    await SmartPopupSettings.updateOne(
      { shopId: session.shop },
      { $pull: { campaigns: { _id: campaignId } } },
    );
    return json({ success: true });
  }

  const campaignId = String(formData.get("campaignId") || "");
  const payload = JSON.parse(
    String(formData.get("campaign") || "{}"),
  ) as Partial<ISmartPopupCampaign> | null;
  if (!payload) {
    return json({ success: false, error: "Invalid payload" }, { status: 400 });
  }

  if (!payload.name || !payload.name.trim()) {
    return json({ success: false, error: "Name is required" }, { status: 400 });
  }

  const settings = await getOrCreateSmartPopupSettings(session.shop);
  const previous = campaignId
    ? settings.campaigns.find((c) => String(c._id) === campaignId)
    : null;

  const merged: Partial<ISmartPopupCampaign> = {
    name: payload.name,
    status: (payload.status as ISmartPopupCampaign["status"]) || "draft",
    priority: Number(payload.priority) || 10,
    startAt: payload.startAt ? new Date(payload.startAt) : null,
    endAt: payload.endAt ? new Date(payload.endAt) : null,
    trigger: payload.trigger as ISmartPopupCampaign["trigger"],
    targeting: payload.targeting as ISmartPopupCampaign["targeting"],
    suppression: payload.suppression as ISmartPopupCampaign["suppression"],
    content: payload.content as ISmartPopupCampaign["content"],
    offer: payload.offer as ISmartPopupCampaign["offer"],
    stats: previous?.stats || {
      impressions: 0,
      opens: 0,
      closes: 0,
      submits: 0,
      converts: 0,
    },
  };

  if (previous) {
    await SmartPopupSettings.updateOne(
      { shopId: session.shop, "campaigns._id": campaignId },
      { $set: { "campaigns.$": { ...merged, _id: previous._id } } },
    );
  } else {
    await SmartPopupSettings.updateOne(
      { shopId: session.shop },
      { $push: { campaigns: merged } },
      { upsert: true },
    );
  }

  return json({ success: true });
};

export default function SmartPopupPage() {
  const { enabled, campaigns, leadCount } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isLoading = navigation.state === "submitting";

  const [draft, setDraft] = useState<CampaignDraft | null>(null);
  const [formError, setFormError] = useState<string>("");
  const [countryInput, setCountryInput] = useState("");

  const openNew = useCallback(() => {
    setDraft(JSON.parse(JSON.stringify(NEW_CAMPAIGN)));
    setFormError("");
  }, []);

  const openEdit = useCallback((c: CampaignDraft) => {
    setDraft(JSON.parse(JSON.stringify(c)));
    setFormError("");
  }, []);

  const handleDelete = useCallback(
    (campaignId: string) => {
      if (!confirm("Delete this campaign?")) return;
      const fd = new FormData();
      fd.set("op", "delete");
      fd.set("campaignId", campaignId);
      submit(fd, { method: "post" });
    },
    [submit],
  );

  const toggleMaster = useCallback(
    (v: boolean) => {
      const fd = new FormData();
      fd.set("op", "toggle-master");
      fd.set("enabled", v ? "true" : "false");
      submit(fd, { method: "post" });
    },
    [submit],
  );

  const handleSave = useCallback(() => {
    if (!draft) return;
    if (!draft.name.trim()) {
      setFormError("Campaign name is required.");
      return;
    }
    if (draft.offer.type === "discount" && draft.offer.discountValue <= 0) {
      setFormError("Discount value must be greater than zero.");
      return;
    }
    const fd = new FormData();
    fd.set("op", "save");
    fd.set("campaignId", draft._id ? String(draft._id) : "");
    fd.set("campaign", JSON.stringify(draft));
    submit(fd, { method: "post" });
    setDraft(null);
  }, [draft, submit]);

  const togglePage = useCallback(
    (list: "includePages" | "excludePages", page: SmartPopupPageType) => {
      if (!draft) return;
      const current = draft.targeting[list];
      const next = current.includes(page)
        ? current.filter((p) => p !== page)
        : [...current, page];
      setDraft({
        ...draft,
        targeting: { ...draft.targeting, [list]: next },
      });
    },
    [draft],
  );

  const toggleDevice = useCallback(
    (device: "desktop" | "mobile") => {
      if (!draft) return;
      const current = draft.targeting.devices;
      const next = current.includes(device)
        ? current.filter((d) => d !== device)
        : [...current, device];
      setDraft({
        ...draft,
        targeting: { ...draft.targeting, devices: next },
      });
    },
    [draft],
  );

  const addCountry = useCallback(() => {
    if (!draft) return;
    const code = countryInput.trim().toUpperCase();
    if (!code || draft.targeting.countries.includes(code)) return;
    setDraft({
      ...draft,
      targeting: {
        ...draft.targeting,
        countries: [...draft.targeting.countries, code],
      },
    });
    setCountryInput("");
  }, [countryInput, draft]);

  const removeCountry = useCallback(
    (code: string) => {
      if (!draft) return;
      setDraft({
        ...draft,
        targeting: {
          ...draft.targeting,
          countries: draft.targeting.countries.filter((c) => c !== code),
        },
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
              title="Basics"
              description="Campaign name, status, and schedule."
            >
              <Card>
                <BlockStack gap="400">
                  <TextField
                    label="Campaign name"
                    value={draft.name}
                    onChange={(v) => setDraft({ ...draft, name: v })}
                    autoComplete="off"
                  />
                  <InlineGrid columns={2} gap="300">
                    <Select
                      label="Status"
                      options={[
                        { label: "Active", value: "active" },
                        { label: "Paused", value: "paused" },
                        { label: "Draft", value: "draft" },
                      ]}
                      value={draft.status}
                      onChange={(v) =>
                        setDraft({
                          ...draft,
                          status: v as CampaignDraft["status"],
                        })
                      }
                    />
                    <TextField
                      label="Priority"
                      type="number"
                      value={String(draft.priority)}
                      onChange={(v) =>
                        setDraft({ ...draft, priority: Number(v) || 0 })
                      }
                      helpText="Higher wins when multiple campaigns match."
                      autoComplete="off"
                    />
                  </InlineGrid>
                  <InlineGrid columns={2} gap="300">
                    <TextField
                      label="Start (optional)"
                      type="datetime-local"
                      value={
                        draft.startAt
                          ? new Date(draft.startAt)
                              .toISOString()
                              .slice(0, 16)
                          : ""
                      }
                      onChange={(v) =>
                        setDraft({
                          ...draft,
                          startAt: v ? new Date(v) : null,
                        })
                      }
                      autoComplete="off"
                    />
                    <TextField
                      label="End (optional)"
                      type="datetime-local"
                      value={
                        draft.endAt
                          ? new Date(draft.endAt).toISOString().slice(0, 16)
                          : ""
                      }
                      onChange={(v) =>
                        setDraft({ ...draft, endAt: v ? new Date(v) : null })
                      }
                      autoComplete="off"
                    />
                  </InlineGrid>
                </BlockStack>
              </Card>
            </Layout.AnnotatedSection>

            <Layout.AnnotatedSection
              title="Trigger"
              description="When should the popup appear?"
            >
              <Card>
                <BlockStack gap="400">
                  <Select
                    label="Trigger type"
                    options={[
                      { label: "Time on page", value: "timer" },
                      { label: "Scroll depth", value: "scroll" },
                      { label: "Exit intent", value: "exit_intent" },
                      { label: "Inactivity", value: "inactivity" },
                    ]}
                    value={draft.trigger.type}
                    onChange={(v) =>
                      setDraft({
                        ...draft,
                        trigger: {
                          ...draft.trigger,
                          type: v as CampaignDraft["trigger"]["type"],
                        },
                      })
                    }
                  />
                  {draft.trigger.type === "timer" && (
                    <TextField
                      label="Show after (seconds)"
                      type="number"
                      value={String(draft.trigger.delaySeconds)}
                      onChange={(v) =>
                        setDraft({
                          ...draft,
                          trigger: {
                            ...draft.trigger,
                            delaySeconds: Number(v) || 0,
                          },
                        })
                      }
                      autoComplete="off"
                    />
                  )}
                  {draft.trigger.type === "scroll" && (
                    <TextField
                      label="Scroll depth (%)"
                      type="number"
                      value={String(draft.trigger.scrollPercent)}
                      onChange={(v) =>
                        setDraft({
                          ...draft,
                          trigger: {
                            ...draft.trigger,
                            scrollPercent: Number(v) || 0,
                          },
                        })
                      }
                      autoComplete="off"
                    />
                  )}
                  {draft.trigger.type === "exit_intent" && (
                    <TextField
                      label="Minimum wait before firing (seconds)"
                      type="number"
                      value={String(draft.trigger.delaySeconds)}
                      onChange={(v) =>
                        setDraft({
                          ...draft,
                          trigger: {
                            ...draft.trigger,
                            delaySeconds: Number(v) || 0,
                          },
                        })
                      }
                      helpText="On mobile, falls back to inactivity + scroll-up heuristic."
                      autoComplete="off"
                    />
                  )}
                  {draft.trigger.type === "inactivity" && (
                    <TextField
                      label="Idle time (seconds)"
                      type="number"
                      value={String(draft.trigger.inactivitySeconds)}
                      onChange={(v) =>
                        setDraft({
                          ...draft,
                          trigger: {
                            ...draft.trigger,
                            inactivitySeconds: Number(v) || 0,
                          },
                        })
                      }
                      autoComplete="off"
                    />
                  )}
                </BlockStack>
              </Card>
            </Layout.AnnotatedSection>

            <Layout.AnnotatedSection
              title="Targeting"
              description="Where and to whom the popup should appear."
            >
              <Card>
                <BlockStack gap="400">
                  <Text as="h3" variant="headingSm">
                    Show on pages
                  </Text>
                  <InlineStack gap="200" wrap>
                    {PAGE_OPTIONS.map((p) => (
                      <Checkbox
                        key={`inc-${p.value}`}
                        label={p.label}
                        checked={draft.targeting.includePages.includes(p.value)}
                        onChange={() => togglePage("includePages", p.value)}
                      />
                    ))}
                  </InlineStack>
                  <Divider />
                  <Text as="h3" variant="headingSm">
                    Never show on
                  </Text>
                  <InlineStack gap="200" wrap>
                    {PAGE_OPTIONS.map((p) => (
                      <Checkbox
                        key={`exc-${p.value}`}
                        label={p.label}
                        checked={draft.targeting.excludePages.includes(p.value)}
                        onChange={() => togglePage("excludePages", p.value)}
                      />
                    ))}
                  </InlineStack>
                  <Divider />
                  <Text as="h3" variant="headingSm">
                    Devices
                  </Text>
                  <InlineStack gap="300">
                    <Checkbox
                      label="Desktop"
                      checked={draft.targeting.devices.includes("desktop")}
                      onChange={() => toggleDevice("desktop")}
                    />
                    <Checkbox
                      label="Mobile"
                      checked={draft.targeting.devices.includes("mobile")}
                      onChange={() => toggleDevice("mobile")}
                    />
                  </InlineStack>
                  <Select
                    label="Audience"
                    options={[
                      { label: "All visitors", value: "all" },
                      { label: "New visitors only", value: "new" },
                      { label: "Returning visitors only", value: "returning" },
                    ]}
                    value={draft.targeting.audience}
                    onChange={(v) =>
                      setDraft({
                        ...draft,
                        targeting: {
                          ...draft.targeting,
                          audience:
                            v as CampaignDraft["targeting"]["audience"],
                        },
                      })
                    }
                  />
                  <BlockStack gap="200">
                    <Text as="h3" variant="headingSm">
                      Countries (ISO-2, leave empty for worldwide)
                    </Text>
                    <InlineStack gap="200" wrap>
                      {draft.targeting.countries.map((c) => (
                        <Tag key={c} onRemove={() => removeCountry(c)}>
                          {c}
                        </Tag>
                      ))}
                    </InlineStack>
                    <InlineStack gap="200" blockAlign="end">
                      <div style={{ flex: 1 }}>
                        <TextField
                          label="Add country"
                          value={countryInput}
                          onChange={setCountryInput}
                          placeholder="IN, US, GB..."
                          autoComplete="off"
                        />
                      </div>
                      <Button onClick={addCountry}>Add</Button>
                    </InlineStack>
                  </BlockStack>
                </BlockStack>
              </Card>
            </Layout.AnnotatedSection>

            <Layout.AnnotatedSection
              title="Suppression"
              description="Prevent popup fatigue by limiting reappearance."
            >
              <Card>
                <BlockStack gap="400">
                  <InlineGrid columns={2} gap="300">
                    <TextField
                      label="After close (hours)"
                      type="number"
                      value={String(draft.suppression.afterCloseHours)}
                      onChange={(v) =>
                        setDraft({
                          ...draft,
                          suppression: {
                            ...draft.suppression,
                            afterCloseHours: Number(v) || 0,
                          },
                        })
                      }
                      autoComplete="off"
                    />
                    <TextField
                      label="After dismiss / skip (hours)"
                      type="number"
                      value={String(draft.suppression.afterDismissHours)}
                      onChange={(v) =>
                        setDraft({
                          ...draft,
                          suppression: {
                            ...draft.suppression,
                            afterDismissHours: Number(v) || 0,
                          },
                        })
                      }
                      autoComplete="off"
                    />
                  </InlineGrid>
                  <InlineGrid columns={2} gap="300">
                    <TextField
                      label="After submit (days)"
                      type="number"
                      value={String(draft.suppression.afterSubmitDays)}
                      onChange={(v) =>
                        setDraft({
                          ...draft,
                          suppression: {
                            ...draft.suppression,
                            afterSubmitDays: Number(v) || 0,
                          },
                        })
                      }
                      autoComplete="off"
                    />
                    <TextField
                      label="Max shows per session"
                      type="number"
                      value={String(draft.suppression.maxPerSession)}
                      onChange={(v) =>
                        setDraft({
                          ...draft,
                          suppression: {
                            ...draft.suppression,
                            maxPerSession: Number(v) || 1,
                          },
                        })
                      }
                      autoComplete="off"
                    />
                  </InlineGrid>
                </BlockStack>
              </Card>
            </Layout.AnnotatedSection>

            <Layout.AnnotatedSection
              title="Content"
              description="Popup copy and consent language."
            >
              <Card>
                <BlockStack gap="400">
                  <TextField
                    label="Headline"
                    value={draft.content.headline}
                    onChange={(v) =>
                      setDraft({
                        ...draft,
                        content: { ...draft.content, headline: v },
                      })
                    }
                    autoComplete="off"
                  />
                  <TextField
                    label="Subtext"
                    value={draft.content.subtext}
                    onChange={(v) =>
                      setDraft({
                        ...draft,
                        content: { ...draft.content, subtext: v },
                      })
                    }
                    multiline={2}
                    autoComplete="off"
                  />
                  <InlineGrid columns={2} gap="300">
                    <TextField
                      label="Button text"
                      value={draft.content.buttonText}
                      onChange={(v) =>
                        setDraft({
                          ...draft,
                          content: { ...draft.content, buttonText: v },
                        })
                      }
                      autoComplete="off"
                    />
                    <TextField
                      label="Success message"
                      value={draft.content.successMessage}
                      onChange={(v) =>
                        setDraft({
                          ...draft,
                          content: { ...draft.content, successMessage: v },
                        })
                      }
                      autoComplete="off"
                    />
                  </InlineGrid>
                  <Checkbox
                    label="Also collect first name"
                    checked={draft.content.collectFirstName}
                    onChange={(v) =>
                      setDraft({
                        ...draft,
                        content: { ...draft.content, collectFirstName: v },
                      })
                    }
                  />
                  <TextField
                    label="Consent / legal copy"
                    value={draft.content.consentText}
                    onChange={(v) =>
                      setDraft({
                        ...draft,
                        content: { ...draft.content, consentText: v },
                      })
                    }
                    multiline={2}
                    helpText="This exact text is stored with each lead for audit."
                    autoComplete="off"
                  />
                  <TextField
                    label="Consent version"
                    value={draft.content.consentVersion}
                    onChange={(v) =>
                      setDraft({
                        ...draft,
                        content: { ...draft.content, consentVersion: v },
                      })
                    }
                    helpText="Bump this when consent copy changes."
                    autoComplete="off"
                  />
                </BlockStack>
              </Card>
            </Layout.AnnotatedSection>

            <Layout.AnnotatedSection
              title="Appearance"
              description="Colors, layout, and optional image."
            >
              <Card>
                <BlockStack gap="400">
                  <Select
                    label="Layout"
                    options={[
                      { label: "Centered modal", value: "center" },
                      { label: "Bottom right", value: "bottom-right" },
                      { label: "Bottom left", value: "bottom-left" },
                    ]}
                    value={draft.content.layout}
                    onChange={(v) =>
                      setDraft({
                        ...draft,
                        content: {
                          ...draft.content,
                          layout: v as CampaignDraft["content"]["layout"],
                        },
                      })
                    }
                  />
                  <InlineGrid columns={3} gap="300">
                    <TextField
                      label="Background color"
                      value={draft.content.bgColor}
                      onChange={(v) =>
                        setDraft({
                          ...draft,
                          content: { ...draft.content, bgColor: v },
                        })
                      }
                      autoComplete="off"
                    />
                    <TextField
                      label="Accent color"
                      value={draft.content.accentColor}
                      onChange={(v) =>
                        setDraft({
                          ...draft,
                          content: { ...draft.content, accentColor: v },
                        })
                      }
                      autoComplete="off"
                    />
                    <TextField
                      label="Text color"
                      value={draft.content.textColor}
                      onChange={(v) =>
                        setDraft({
                          ...draft,
                          content: { ...draft.content, textColor: v },
                        })
                      }
                      autoComplete="off"
                    />
                  </InlineGrid>
                  <TextField
                    label="Image URL (optional)"
                    value={draft.content.imageUrl}
                    onChange={(v) =>
                      setDraft({
                        ...draft,
                        content: { ...draft.content, imageUrl: v },
                      })
                    }
                    placeholder="https://..."
                    autoComplete="off"
                  />
                </BlockStack>
              </Card>
            </Layout.AnnotatedSection>

            <Layout.AnnotatedSection
              title="Offer"
              description="What subscribers receive when they submit."
            >
              <Card>
                <BlockStack gap="400">
                  <Select
                    label="Offer type"
                    options={[
                      { label: "Discount code", value: "discount" },
                      { label: "No offer (newsletter only)", value: "none" },
                    ]}
                    value={draft.offer.type}
                    onChange={(v) =>
                      setDraft({
                        ...draft,
                        offer: {
                          ...draft.offer,
                          type: v as CampaignDraft["offer"]["type"],
                        },
                      })
                    }
                  />
                  {draft.offer.type === "discount" && (
                    <>
                      <InlineGrid columns={2} gap="300">
                        <Select
                          label="Discount type"
                          options={[
                            { label: "Percentage (%)", value: "percentage" },
                            {
                              label: "Fixed amount",
                              value: "fixed_amount",
                            },
                          ]}
                          value={draft.offer.discountType}
                          onChange={(v) =>
                            setDraft({
                              ...draft,
                              offer: {
                                ...draft.offer,
                                discountType:
                                  v as CampaignDraft["offer"]["discountType"],
                              },
                            })
                          }
                        />
                        <TextField
                          label="Value"
                          type="number"
                          value={String(draft.offer.discountValue)}
                          onChange={(v) =>
                            setDraft({
                              ...draft,
                              offer: {
                                ...draft.offer,
                                discountValue: Number(v) || 0,
                              },
                            })
                          }
                          autoComplete="off"
                        />
                      </InlineGrid>
                      <TextField
                        label="Minimum order amount"
                        type="number"
                        value={String(draft.offer.minimumOrderAmount)}
                        onChange={(v) =>
                          setDraft({
                            ...draft,
                            offer: {
                              ...draft.offer,
                              minimumOrderAmount: Number(v) || 0,
                            },
                          })
                        }
                        autoComplete="off"
                      />
                    </>
                  )}
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
      title="Smart Email Popup"
      primaryAction={{ content: "New Campaign", onAction: openNew }}
      backAction={{ content: "Dashboard", url: "/app" }}
    >
      <BlockStack gap="500">
        <Banner tone={enabled ? "success" : "info"}>
          <p>
            {enabled
              ? "Smart Email Popup is live on your storefront."
              : "Smart Email Popup is currently off. Toggle it on below, then enable the \"Smart Email Popup\" app embed in your theme editor."}
          </p>
        </Banner>

        <Card>
          <InlineStack align="space-between" blockAlign="center">
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd">
                Master switch
              </Text>
              <Text as="p" tone="subdued">
                Total leads captured: {leadCount}
              </Text>
            </BlockStack>
            <Checkbox
              label="Enabled"
              checked={enabled}
              onChange={toggleMaster}
            />
          </InlineStack>
        </Card>

        {campaigns.length === 0 ? (
          <Card>
            <EmptyState
              heading="No campaigns yet"
              action={{ content: "Create campaign", onAction: openNew }}
              image=""
            >
              <p>
                Create a campaign with the trigger, audience, and offer you
                want. Higher-priority campaigns win when multiple match.
              </p>
            </EmptyState>
          </Card>
        ) : (
          <BlockStack gap="400">
            {(campaigns as CampaignDraft[]).map((c) => {
              const impr = c.stats?.impressions || 0;
              const subs = c.stats?.submits || 0;
              const rate = impr > 0 ? ((subs / impr) * 100).toFixed(1) : "0.0";
              return (
                <Card key={String(c._id)}>
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="center">
                      <InlineStack gap="300" blockAlign="center">
                        <Text as="h2" variant="headingMd">
                          {c.name}
                        </Text>
                        {c.status === "active" ? (
                          <Badge tone="success">Active</Badge>
                        ) : c.status === "paused" ? (
                          <Badge tone="warning">Paused</Badge>
                        ) : (
                          <Badge>Draft</Badge>
                        )}
                        <Badge>{`Priority ${c.priority}`}</Badge>
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
                    <InlineStack gap="200" wrap>
                      <Badge>{`Trigger: ${c.trigger.type}`}</Badge>
                      <Badge>{`Audience: ${c.targeting.audience}`}</Badge>
                      <Badge>{`Devices: ${c.targeting.devices.join(", ") || "none"}`}</Badge>
                      {c.offer.type === "discount" && (
                        <Badge>{`${c.offer.discountValue}${c.offer.discountType === "percentage" ? "%" : ""} off`}</Badge>
                      )}
                    </InlineStack>
                    <Text as="p" tone="subdued">
                      {`Impressions ${impr} · Submits ${subs} · Rate ${rate}%`}
                    </Text>
                  </BlockStack>
                </Card>
              );
            })}
          </BlockStack>
        )}
      </BlockStack>
    </Page>
  );
}
