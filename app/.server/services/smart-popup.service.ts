import {
  SmartPopupSettings,
  SmartPopupLead,
  type ISmartPopupCampaign,
  type ISmartPopupSettings,
  type SmartPopupPageType,
} from "../models/smart-popup.model";
import { Subscriber } from "../models/subscriber.model";
import { createRedemptionDiscount } from "./discount.service";

export interface VisitorContext {
  pageType: SmartPopupPageType;
  device: "desktop" | "mobile";
  audience: "new" | "returning";
  country: string;
  pageUrl: string;
  referrer: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  locale: string;
}

export interface PublicCampaign {
  id: string;
  name: string;
  trigger: ISmartPopupCampaign["trigger"];
  suppression: ISmartPopupCampaign["suppression"];
  content: ISmartPopupCampaign["content"];
  offer: {
    type: ISmartPopupCampaign["offer"]["type"];
    discountType: ISmartPopupCampaign["offer"]["discountType"];
    discountValue: number;
    label: string;
  };
}

function isCampaignEligible(
  c: ISmartPopupCampaign,
  ctx: VisitorContext,
  now: number,
): boolean {
  if (c.status !== "active") return false;
  if (c.startAt && new Date(c.startAt).getTime() > now) return false;
  if (c.endAt && new Date(c.endAt).getTime() < now) return false;

  const t = c.targeting;
  if (t.devices.length && !t.devices.includes(ctx.device)) return false;
  if (t.audience !== "all" && t.audience !== ctx.audience) return false;
  if (t.countries.length && ctx.country && !t.countries.includes(ctx.country)) {
    return false;
  }

  if (t.excludePages.includes(ctx.pageType)) return false;
  if (t.includePages.length && !t.includePages.includes(ctx.pageType)) {
    return false;
  }

  return true;
}

function offerLabel(c: ISmartPopupCampaign): string {
  if (c.offer.type !== "discount") return "";
  return c.offer.discountType === "percentage"
    ? `${c.offer.discountValue}% OFF`
    : `${c.offer.discountValue} OFF`;
}

function toPublic(c: ISmartPopupCampaign): PublicCampaign {
  return {
    id: String(c._id),
    name: c.name,
    trigger: c.trigger,
    suppression: c.suppression,
    content: c.content,
    offer: {
      type: c.offer.type,
      discountType: c.offer.discountType,
      discountValue: c.offer.discountValue,
      label: offerLabel(c),
    },
  };
}

export async function resolveCampaign(
  shopId: string,
  ctx: VisitorContext,
): Promise<PublicCampaign | null> {
  const settings = await SmartPopupSettings.findOne({ shopId }).lean<
    ISmartPopupSettings | null
  >();
  if (!settings || !settings.enabled) return null;

  const now = Date.now();
  const eligible = (settings.campaigns || [])
    .filter((c) => isCampaignEligible(c, ctx, now))
    .sort((a, b) => (b.priority || 0) - (a.priority || 0));

  if (!eligible.length) return null;
  return toPublic(eligible[0]);
}

export async function findCampaign(
  shopId: string,
  campaignId: string,
): Promise<ISmartPopupCampaign | null> {
  const settings = await SmartPopupSettings.findOne({ shopId }).lean<
    ISmartPopupSettings | null
  >();
  if (!settings) return null;
  return (
    (settings.campaigns || []).find((c) => String(c._id) === campaignId) || null
  );
}

export interface SubmitInput {
  shopId: string;
  campaignId: string;
  email: string;
  firstName?: string;
  visitorKey?: string;
  ctx: Partial<VisitorContext>;
}

export interface SubmitResult {
  success: boolean;
  discountCode?: string;
  error?: string;
}

export async function recordLead(
  input: SubmitInput,
  campaign: ISmartPopupCampaign,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
): Promise<SubmitResult> {
  const email = input.email.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { success: false, error: "Valid email required" };
  }

  const existing = await SmartPopupLead.findOne({
    shopId: input.shopId,
    email,
    campaignId: input.campaignId,
  });
  if (existing) {
    return { success: true, discountCode: existing.discountCode || "" };
  }

  let discountCode = "";
  if (campaign.offer.type === "discount" && campaign.offer.discountValue > 0) {
    try {
      const result = await createRedemptionDiscount(admin, {
        shopifyCustomerId: "gid://shopify/Customer/0",
        discountType:
          campaign.offer.discountType === "percentage"
            ? "PERCENTAGE"
            : "FIXED_AMOUNT",
        discountValue: campaign.offer.discountValue,
        minimumOrderAmount: campaign.offer.minimumOrderAmount || 0,
        title: `Smart Popup: ${campaign.name}`,
      });
      discountCode = result.discountCode;
    } catch {
      return { success: false, error: "Failed to create discount" };
    }
  }

  try {
    await SmartPopupLead.create({
      shopId: input.shopId,
      campaignId: input.campaignId,
      email,
      firstName: input.firstName || "",
      discountCode,
      consentText: campaign.content.consentText,
      consentVersion: campaign.content.consentVersion,
      pageUrl: input.ctx.pageUrl,
      pageType: input.ctx.pageType,
      referrer: input.ctx.referrer,
      utmSource: input.ctx.utmSource,
      utmMedium: input.ctx.utmMedium,
      utmCampaign: input.ctx.utmCampaign,
      locale: input.ctx.locale,
      country: input.ctx.country,
      device: input.ctx.device,
      visitorKey: input.visitorKey,
      syncStatus: "pending",
    });
  } catch (err: unknown) {
    if ((err as { code?: number }).code === 11000) {
      const dup = await SmartPopupLead.findOne({
        shopId: input.shopId,
        email,
        campaignId: input.campaignId,
      });
      return { success: true, discountCode: dup?.discountCode || "" };
    }
    return { success: false, error: "Failed to save subscriber" };
  }

  await Subscriber.findOneAndUpdate(
    { shopId: input.shopId, email, source: "exit_popup" },
    {
      $setOnInsert: {
        shopId: input.shopId,
        email,
        source: "exit_popup",
        discountCode,
        status: "active",
        subscribedAt: new Date(),
      },
    },
    { upsert: true },
  ).catch(() => {});

  return { success: true, discountCode };
}

export async function trackEvent(
  shopId: string,
  campaignId: string,
  event: "impression" | "open" | "close" | "submit" | "convert",
): Promise<void> {
  const field = `campaigns.$.stats.${
    event === "impression"
      ? "impressions"
      : event === "open"
        ? "opens"
        : event === "close"
          ? "closes"
          : event === "submit"
            ? "submits"
            : "converts"
  }`;
  await SmartPopupSettings.updateOne(
    { shopId, "campaigns._id": campaignId },
    { $inc: { [field]: 1 } },
  ).catch(() => {});
}
