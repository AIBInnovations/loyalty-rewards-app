import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
  Form,
  useLoaderData,
  useNavigation,
} from "@remix-run/react";
import {
  AppProvider,
  Badge,
  BlockStack,
  Box,
  Button,
  Card,
  DataTable,
  EmptyState,
  InlineGrid,
  InlineStack,
  Layout,
  Page,
  ProgressBar,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import polarisTranslations from "@shopify/polaris/locales/en.json";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { useMemo, useState } from "react";
import { connectDB } from "../db.server";
import { requireAdmin } from "../.server/admin-auth.server";
import { Customer } from "../.server/models/customer.model";
import { Transaction } from "../.server/models/transaction.model";
import { Redemption } from "../.server/models/redemption.model";
import { Settings } from "../.server/models/settings.model";
import { CartDrawerSettings } from "../.server/models/cart-settings.model";
import { CodSettings } from "../.server/models/cod-settings.model";
import { FaqSettings } from "../.server/models/faq-settings.model";
import { ImageSearchSettings } from "../.server/models/image-search-settings.model";
import { PincodeSettings } from "../.server/models/pincode-settings.model";
import { PopupSettings } from "../.server/models/popup-settings.model";
import { ReviewSettings } from "../.server/models/review-settings.model";
import { SalesPopSettings } from "../.server/models/sales-pop-settings.model";
import { SizeGuideSettings } from "../.server/models/size-guide-settings.model";
import { SmartPopupSettings } from "../.server/models/smart-popup.model";
import { TimerSettings } from "../.server/models/timer-settings.model";
import { TrustBadgesSettings } from "../.server/models/trust-badges.model";
import { UGCSettings } from "../.server/models/ugc-settings.model";
import { UpsellSettings } from "../.server/models/upsell-settings.model";
import { VoiceAgentSettings } from "../.server/models/voice-agent-settings.model";
import { VolumeDiscountSettings } from "../.server/models/volume-discount.model";
import { WheelSettings } from "../.server/models/wheel-settings.model";
import { WishlistSettings } from "../.server/models/wishlist-settings.model";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

type PluginCategory =
  | "Loyalty"
  | "Conversion"
  | "Merchandising"
  | "Support"
  | "Content"
  | "Localization";

const pluginDefinitions = [
  ["loyalty", "Loyalty & Rewards", "Loyalty", "/app/settings", "Points, referrals, tiers, redemptions, and rewards widget."],
  ["cartDrawer", "Cart Drawer", "Conversion", "/app/cart-settings", "Slide-out cart with progress tiers, recommendations, and upsell."],
  ["wishlist", "Wishlist", "Merchandising", "/app/wishlist", "Wishlist and save-for-later tools for shoppers."],
  ["reviews", "Reviews & Q&A", "Content", "/app/reviews-settings", "Collect reviews, questions, photos, videos, and review rewards."],
  ["volumeDiscounts", "Volume Discounts", "Conversion", "/app/volume-discounts", "Quantity break campaigns for product and cart pages."],
  ["timer", "Countdown Timer", "Conversion", "/app/timer-settings", "Announcement and product timers for urgency campaigns."],
  ["exitPopup", "Exit Popup", "Conversion", "/app/popup-settings", "Exit intent popup with email discount capture."],
  ["smartPopup", "Smart Email Popup", "Conversion", "/app/smart-popup", "Targeted email capture campaigns with display rules."],
  ["spinWheel", "Spin Wheel", "Conversion", "/app/wheel-settings", "Gamified discount capture for email subscribers."],
  ["stockAlerts", "Back in Stock", "Merchandising", "/app/stock-alerts", "Capture restock demand and notify shoppers."],
  ["imageSearch", "Image Search", "Merchandising", "/app/image-search-settings", "Visual product discovery using uploaded images."],
  ["pincode", "Pincode Estimator", "Support", "/app/pincode-settings", "Delivery and COD availability by pincode."],
  ["trustBadges", "Trust Badges", "Content", "/app/trust-badges", "Payment, shipping, guarantee, and credibility badges."],
  ["postPurchaseUpsell", "Post-Purchase Upsell", "Conversion", "/app/upsell-settings", "Focused add-on offer after checkout."],
  ["ugc", "UGC Gallery", "Content", "/app/ugc-settings", "Shoppable customer content and social proof."],
  ["codWhatsapp", "COD WhatsApp", "Support", "/app/cod-settings", "WhatsApp confirmations for cash-on-delivery orders."],
  ["currency", "Currency Selector", "Localization", "/app/currency-settings", "Customer-facing currency display selector."],
  ["sizeGuide", "Size Guide", "Merchandising", "/app/size-guide-settings", "Size charts and fit guidance on product pages."],
  ["salesPop", "Sales Pop", "Conversion", "/app/sales-pop-settings", "Recent purchase notifications for social proof."],
  ["faq", "FAQ Accordion", "Support", "/app/faq-settings", "Compact FAQ sections for storefront pages."],
  ["voiceAgent", "Voice Agent", "Support", "/app/voice-agent", "Voice-based customer support and product assistance."],
].map(([key, name, category, route, description]) => ({
  key,
  name,
  category: category as PluginCategory,
  route,
  description,
}));

type PluginFieldType =
  | "text"
  | "textarea"
  | "number"
  | "color"
  | "checkbox"
  | "select";

type PluginField = {
  name: string;
  label: string;
  type: PluginFieldType;
  helpText?: string;
  options?: { label: string; value: string }[];
};

const editablePluginFields: Record<string, PluginField[]> = {
  loyalty: [
    { name: "earningRate", label: "Earning rate (%)", type: "number" },
    { name: "signupBonus", label: "Signup bonus", type: "number" },
    { name: "currencySymbol", label: "Currency symbol", type: "text" },
    { name: "widgetConfig.title", label: "Widget title", type: "text" },
    { name: "widgetConfig.primaryColor", label: "Widget color", type: "color" },
  ],
  wishlist: [
    { name: "buttonLabelAdd", label: "Add button label", type: "text" },
    { name: "buttonLabelSaved", label: "Saved button label", type: "text" },
    { name: "showWishlistButton", label: "Show wishlist button", type: "checkbox" },
    { name: "showSavedForLater", label: "Show saved-for-later", type: "checkbox" },
    { name: "iconColor", label: "Icon color", type: "color" },
    { name: "activeColor", label: "Active color", type: "color" },
  ],
  timer: [
    {
      name: "timerType",
      label: "Timer type",
      type: "select",
      options: [
        { label: "Evergreen", value: "evergreen" },
        { label: "Fixed", value: "fixed" },
      ],
    },
    { name: "durationHours", label: "Duration hours", type: "number" },
    { name: "durationMinutes", label: "Duration minutes", type: "number" },
    { name: "messageTemplate", label: "Message", type: "text" },
    { name: "expiredMessage", label: "Expired message", type: "text" },
    { name: "barBackgroundColor", label: "Bar background", type: "color" },
    { name: "barTextColor", label: "Bar text color", type: "color" },
    { name: "timerDigitColor", label: "Timer digit color", type: "color" },
  ],
  exitPopup: [
    { name: "headline", label: "Headline", type: "text" },
    { name: "subtext", label: "Subtext", type: "textarea" },
    {
      name: "discountType",
      label: "Discount type",
      type: "select",
      options: [
        { label: "Percentage", value: "percentage" },
        { label: "Fixed amount", value: "fixed_amount" },
      ],
    },
    { name: "discountValue", label: "Discount value", type: "number" },
    { name: "buttonText", label: "Button text", type: "text" },
    { name: "successMessage", label: "Success message", type: "text" },
    { name: "delaySeconds", label: "Delay seconds", type: "number" },
    { name: "showOnMobile", label: "Show on mobile", type: "checkbox" },
    { name: "bgColor", label: "Background color", type: "color" },
    { name: "accentColor", label: "Accent color", type: "color" },
  ],
  pincode: [
    { name: "defaultMinDays", label: "Minimum delivery days", type: "number" },
    { name: "defaultMaxDays", label: "Maximum delivery days", type: "number" },
    {
      name: "codPincodes",
      label: "COD pincodes",
      type: "textarea",
      helpText: "Comma-separated. Leave blank for all.",
    },
    {
      name: "noCodPincodes",
      label: "No-COD pincodes",
      type: "textarea",
      helpText: "Comma-separated.",
    },
    {
      name: "nonServiceablePincodes",
      label: "Non-serviceable pincodes",
      type: "textarea",
      helpText: "Comma-separated.",
    },
  ],
  reviews: [
    { name: "autoApprove", label: "Auto approve reviews", type: "checkbox" },
    { name: "allowPhotos", label: "Allow photos", type: "checkbox" },
    { name: "allowVideos", label: "Allow videos", type: "checkbox" },
    { name: "pointsForReview", label: "Points for review", type: "number" },
  ],
  salesPop: [
    { name: "messageTemplate", label: "Message template", type: "text" },
    { name: "ctaLabel", label: "CTA label", type: "text" },
    { name: "showCta", label: "Show CTA", type: "checkbox" },
    { name: "showThumbnail", label: "Show thumbnail", type: "checkbox" },
    {
      name: "position",
      label: "Position",
      type: "select",
      options: [
        { label: "Bottom left", value: "bottom-left" },
        { label: "Bottom right", value: "bottom-right" },
        { label: "Top left", value: "top-left" },
        { label: "Top right", value: "top-right" },
      ],
    },
    { name: "accentColor", label: "Accent color", type: "color" },
    { name: "bgColor", label: "Background color", type: "color" },
    { name: "textColor", label: "Text color", type: "color" },
  ],
  faq: [
    { name: "heading", label: "Heading", type: "text" },
    { name: "subheading", label: "Subheading", type: "text" },
    {
      name: "placement",
      label: "Placement",
      type: "select",
      options: [
        { label: "Before footer", value: "before-footer" },
        { label: "After main", value: "after-main" },
        { label: "End of body", value: "end-of-body" },
      ],
    },
    {
      name: "iconStyle",
      label: "Icon style",
      type: "select",
      options: [
        { label: "Chevron", value: "chevron" },
        { label: "Plus", value: "plus" },
      ],
    },
    { name: "allowMultiple", label: "Allow multiple open", type: "checkbox" },
    { name: "firstOpen", label: "First item open", type: "checkbox" },
    { name: "backgroundColor", label: "Background color", type: "color" },
    { name: "textColor", label: "Text color", type: "color" },
    { name: "accentColor", label: "Accent color", type: "color" },
  ],
  voiceAgent: [
    { name: "elevenLabsAgentId", label: "ElevenLabs agent ID", type: "text" },
    { name: "callDelayMinutes", label: "Call delay minutes", type: "number" },
    { name: "minCartValue", label: "Minimum cart value", type: "number" },
    { name: "maxCallsPerDay", label: "Max calls per day", type: "number" },
    {
      name: "language",
      label: "Language",
      type: "select",
      options: [
        { label: "English", value: "en" },
        { label: "Hindi", value: "hi" },
        { label: "Hinglish", value: "hinglish" },
      ],
    },
    { name: "greeting", label: "Greeting script", type: "textarea" },
    { name: "offerDiscount", label: "Offer discount", type: "checkbox" },
    { name: "discountValue", label: "Discount value", type: "number" },
    { name: "sendWhatsApp", label: "Send WhatsApp", type: "checkbox" },
    { name: "whatsappNumber", label: "WhatsApp number", type: "text" },
  ],
};

const editablePluginKeys = new Set(Object.keys(editablePluginFields));

function getValueByPath(source: Record<string, any> | null, path: string) {
  return path.split(".").reduce((value, key) => value?.[key], source);
}

function listToCsv(value: unknown) {
  return Array.isArray(value) ? value.join(", ") : String(value ?? "");
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireAdmin(request);
  await connectDB();

  const url = new URL(request.url);
  const shops = await Settings.distinct("shopId");
  const selectedShop = url.searchParams.get("shop") || shops[0] || "";
  const activeTab = url.searchParams.get("tab") || "overview";
  const requestedPluginKey = url.searchParams.get("plugin") || "";
  const selectedPluginKey = editablePluginKeys.has(requestedPluginKey)
    ? requestedPluginKey
    : "";

  if (shops.length > 0 && !selectedShop) {
    throw redirect(`/admin?shop=${encodeURIComponent(shops[0])}`);
  }

  const emptyStats = {
    totalCustomers: 0,
    totalPointsIssued: 0,
    totalRedemptions: 0,
    activeDiscountCodes: 0,
    enabledPlugins: 0,
    totalPlugins: pluginDefinitions.length,
    setupProgress: 0,
  };

  if (!selectedShop) {
    return json({
      polarisTranslations,
      shops,
      selectedShop,
      activeTab,
      selectedPluginKey,
      stats: emptyStats,
      program: null,
      setupTasks: [],
      plugins: pluginDefinitions.map((plugin) => ({
        ...plugin,
        enabled: false,
        editable: editablePluginKeys.has(plugin.key),
      })),
      pluginSettings: {},
      recentTransactions: [],
    });
  }

  const [
    settings,
    totalCustomers,
    totalPointsIssued,
    totalRedemptions,
    activeDiscountCodes,
    recentTransactions,
    wishlist,
    cartDrawer,
    volumeDiscounts,
    timer,
    exitPopup,
    smartPopup,
    spinWheel,
    imageSearch,
    pincode,
    trustBadges,
    postPurchaseUpsell,
    ugc,
    codWhatsapp,
    reviews,
    sizeGuide,
    salesPop,
    faq,
    voiceAgent,
  ] = await Promise.all([
    Settings.findOne({ shopId: selectedShop }).lean(),
    Customer.countDocuments({ shopId: selectedShop }),
    Transaction.aggregate([
      { $match: { shopId: selectedShop, type: "EARN" } },
      { $group: { _id: null, total: { $sum: "$points" } } },
    ]).then((r) => r[0]?.total || 0),
    Redemption.countDocuments({ shopId: selectedShop, status: "USED" }),
    Redemption.countDocuments({ shopId: selectedShop, status: "CREATED" }),
    Transaction.find({ shopId: selectedShop })
      .sort({ createdAt: -1 })
      .limit(8)
      .populate("customerId", "email firstName lastName")
      .lean(),
    WishlistSettings.findOne({ shopId: selectedShop }).lean(),
    CartDrawerSettings.findOne({ shopId: selectedShop }).lean(),
    VolumeDiscountSettings.findOne({ shopId: selectedShop }).lean(),
    TimerSettings.findOne({ shopId: selectedShop }).lean(),
    PopupSettings.findOne({ shopId: selectedShop }).lean(),
    SmartPopupSettings.findOne({ shopId: selectedShop }).lean(),
    WheelSettings.findOne({ shopId: selectedShop }).lean(),
    ImageSearchSettings.findOne({ shopId: selectedShop }).lean(),
    PincodeSettings.findOne({ shopId: selectedShop }).lean(),
    TrustBadgesSettings.findOne({ shopId: selectedShop }).lean(),
    UpsellSettings.findOne({ shopId: selectedShop }).lean(),
    UGCSettings.findOne({ shopId: selectedShop }).lean(),
    CodSettings.findOne({ shopId: selectedShop }).lean(),
    ReviewSettings.findOne({ shopId: selectedShop }).lean(),
    SizeGuideSettings.findOne({ shopId: selectedShop }).lean(),
    SalesPopSettings.findOne({ shopId: selectedShop }).lean(),
    FaqSettings.findOne({ shopId: selectedShop }).lean(),
    VoiceAgentSettings.findOne({ shopId: selectedShop }).lean(),
  ]);

  const statusMap: Record<string, boolean> = {
    loyalty: settings?.isActive ?? true,
    wishlist: wishlist?.enabled ?? false,
    cartDrawer: cartDrawer?.enabled ?? false,
    volumeDiscounts:
      volumeDiscounts?.campaigns?.some((campaign: any) => campaign.enabled) ??
      false,
    timer: timer?.enabled ?? false,
    exitPopup: exitPopup?.enabled ?? false,
    smartPopup: smartPopup?.enabled ?? false,
    spinWheel: spinWheel?.enabled ?? false,
    stockAlerts: false,
    imageSearch: imageSearch?.enabled ?? false,
    pincode: pincode?.enabled ?? true,
    trustBadges: trustBadges?.enabled ?? true,
    postPurchaseUpsell: postPurchaseUpsell?.enabled ?? false,
    ugc: ugc?.enabled ?? false,
    codWhatsapp: codWhatsapp?.enabled ?? false,
    reviews: reviews?.enabled ?? true,
    currency: settings?.currencySelectorEnabled ?? true,
    sizeGuide: sizeGuide?.enabled ?? false,
    salesPop: salesPop?.enabled ?? false,
    faq: faq?.enabled ?? false,
    voiceAgent: voiceAgent?.enabled ?? false,
  };

  const plugins = pluginDefinitions.map((plugin) => ({
    ...plugin,
    enabled: statusMap[plugin.key] ?? false,
    editable: editablePluginKeys.has(plugin.key),
  }));
  const enabledPlugins = plugins.filter((plugin) => plugin.enabled).length;
  const pluginSettings = {
    loyalty: {
      earningRate: settings?.earningRate ?? 10,
      signupBonus: settings?.signupBonus ?? 50,
      currencySymbol: settings?.currencySymbol ?? "₹",
      widgetConfig: {
        title: settings?.widgetConfig?.title ?? "Rewards",
        primaryColor: settings?.widgetConfig?.primaryColor ?? "#5C6AC4",
      },
    },
    wishlist: {
      buttonLabelAdd: wishlist?.buttonLabelAdd ?? "Add to Wishlist",
      buttonLabelSaved: wishlist?.buttonLabelSaved ?? "In Wishlist",
      showWishlistButton: wishlist?.showWishlistButton ?? true,
      showSavedForLater: wishlist?.showSavedForLater ?? true,
      iconColor: wishlist?.iconColor ?? "#222222",
      activeColor: wishlist?.activeColor ?? "#e63946",
    },
    timer: {
      timerType: timer?.timerType ?? "evergreen",
      durationHours: timer?.durationHours ?? 2,
      durationMinutes: timer?.durationMinutes ?? 0,
      messageTemplate: timer?.messageTemplate ?? "Flash Sale ends in {timer}",
      expiredMessage: timer?.expiredMessage ?? "Sale has ended!",
      barBackgroundColor: timer?.barBackgroundColor ?? "#1a1a1a",
      barTextColor: timer?.barTextColor ?? "#ffffff",
      timerDigitColor: timer?.timerDigitColor ?? "#ff4444",
    },
    exitPopup: {
      headline: exitPopup?.headline ?? "Wait! Don't leave empty-handed",
      subtext:
        exitPopup?.subtext ??
        "Enter your email and get an exclusive discount!",
      discountType: exitPopup?.discountType ?? "percentage",
      discountValue: exitPopup?.discountValue ?? 10,
      buttonText: exitPopup?.buttonText ?? "Get My Discount",
      successMessage: exitPopup?.successMessage ?? "Your discount code is:",
      bgColor: exitPopup?.bgColor ?? "#ffffff",
      accentColor: exitPopup?.accentColor ?? "#5C6AC4",
      showOnMobile: exitPopup?.showOnMobile ?? true,
      delaySeconds: exitPopup?.delaySeconds ?? 5,
    },
    pincode: {
      defaultMinDays: pincode?.defaultMinDays ?? 3,
      defaultMaxDays: pincode?.defaultMaxDays ?? 7,
      codPincodes: pincode?.codPincodes ?? [],
      noCodPincodes: pincode?.noCodPincodes ?? [],
      nonServiceablePincodes: pincode?.nonServiceablePincodes ?? [],
    },
    reviews: {
      autoApprove: reviews?.autoApprove ?? false,
      allowPhotos: reviews?.allowPhotos ?? true,
      allowVideos: reviews?.allowVideos ?? false,
      pointsForReview: reviews?.pointsForReview ?? 50,
    },
    salesPop: {
      messageTemplate:
        salesPop?.messageTemplate ?? "{name} from {location} just bought {product}",
      ctaLabel: salesPop?.ctaLabel ?? "View Product",
      showCta: salesPop?.showCta ?? true,
      showThumbnail: salesPop?.showThumbnail ?? true,
      position: salesPop?.position ?? "bottom-left",
      accentColor: salesPop?.accentColor ?? "#5C6AC4",
      bgColor: salesPop?.bgColor ?? "#ffffff",
      textColor: salesPop?.textColor ?? "#1a1a1a",
    },
    faq: {
      heading: faq?.heading ?? "Frequently Asked Questions",
      subheading: faq?.subheading ?? "",
      placement: faq?.placement ?? "before-footer",
      iconStyle: faq?.iconStyle ?? "chevron",
      allowMultiple: faq?.allowMultiple ?? false,
      firstOpen: faq?.firstOpen ?? true,
      backgroundColor: faq?.backgroundColor ?? "#ffffff",
      textColor: faq?.textColor ?? "#111827",
      accentColor: faq?.accentColor ?? "#5C6AC4",
    },
    voiceAgent: {
      elevenLabsAgentId: voiceAgent?.elevenLabsAgentId ?? "",
      callDelayMinutes: voiceAgent?.callDelayMinutes ?? 15,
      minCartValue: voiceAgent?.minCartValue ?? 500,
      maxCallsPerDay: voiceAgent?.maxCallsPerDay ?? 100,
      language: voiceAgent?.language ?? "hinglish",
      greeting: voiceAgent?.greeting ?? "",
      offerDiscount: voiceAgent?.offerDiscount ?? true,
      discountValue: voiceAgent?.discountValue ?? 10,
      sendWhatsApp: voiceAgent?.sendWhatsApp ?? true,
      whatsappNumber: voiceAgent?.whatsappNumber ?? "",
    },
  };
  const setupTasks = [
    {
      title: "Set loyalty earning rules",
      done: Boolean(settings?.isActive && settings.earningRate > 0),
      route: "/app/settings",
    },
    {
      title: "Enable at least 5 storefront plugins",
      done: enabledPlugins >= 5,
      route: "/admin",
    },
    {
      title: "Review customer activity",
      done: recentTransactions.length > 0,
      route: "/app/transactions",
    },
    {
      title: "Prepare rewards or discount codes",
      done: activeDiscountCodes > 0 || totalRedemptions > 0,
      route: "/app/rewards",
    },
  ];

  return json({
    polarisTranslations,
    shops,
    selectedShop,
    activeTab,
    selectedPluginKey,
    stats: {
      totalCustomers,
      totalPointsIssued,
      totalRedemptions,
      activeDiscountCodes,
      enabledPlugins,
      totalPlugins: plugins.length,
      setupProgress: Math.round(
        (setupTasks.filter((task) => task.done).length / setupTasks.length) * 100,
      ),
    },
    program: settings
      ? {
          isActive: settings.isActive,
          earningRate: settings.earningRate,
          signupBonus: settings.signupBonus,
          currencySymbol: settings.currencySymbol,
        }
      : null,
    setupTasks,
    plugins,
    pluginSettings,
    recentTransactions: recentTransactions.map((t) => ({
      id: t._id.toString(),
      customer:
        (t.customerId as any)?.email ||
        `${(t.customerId as any)?.firstName || ""} ${
          (t.customerId as any)?.lastName || ""
        }`.trim() ||
        "Unknown",
      type: t.type,
      points: t.points,
      source: t.source,
      date: t.createdAt?.toISOString(),
    })),
  });
};

async function setPluginStatus(
  shopId: string,
  pluginKey: string,
  enabled: boolean,
) {
  const updateEnabled = { $set: { enabled } };
  const options = { upsert: true, setDefaultsOnInsert: true };

  switch (pluginKey) {
    case "loyalty":
      await Settings.findOneAndUpdate(
        { shopId },
        { $set: { isActive: enabled } },
        options,
      );
      break;
    case "currency":
      await Settings.findOneAndUpdate(
        { shopId },
        { $set: { currencySelectorEnabled: enabled } },
        options,
      );
      break;
    case "wishlist":
      await WishlistSettings.findOneAndUpdate({ shopId }, updateEnabled, options);
      break;
    case "cartDrawer":
      await CartDrawerSettings.findOneAndUpdate({ shopId }, updateEnabled, options);
      break;
    case "timer":
      await TimerSettings.findOneAndUpdate({ shopId }, updateEnabled, options);
      break;
    case "exitPopup":
      await PopupSettings.findOneAndUpdate({ shopId }, updateEnabled, options);
      break;
    case "smartPopup":
      await SmartPopupSettings.findOneAndUpdate({ shopId }, updateEnabled, options);
      break;
    case "spinWheel":
      await WheelSettings.findOneAndUpdate({ shopId }, updateEnabled, options);
      break;
    case "imageSearch":
      await ImageSearchSettings.findOneAndUpdate({ shopId }, updateEnabled, options);
      break;
    case "pincode":
      await PincodeSettings.findOneAndUpdate({ shopId }, updateEnabled, options);
      break;
    case "trustBadges":
      await TrustBadgesSettings.findOneAndUpdate({ shopId }, updateEnabled, options);
      break;
    case "postPurchaseUpsell":
      await UpsellSettings.findOneAndUpdate({ shopId }, updateEnabled, options);
      break;
    case "ugc":
      await UGCSettings.findOneAndUpdate({ shopId }, updateEnabled, options);
      break;
    case "codWhatsapp":
      await CodSettings.findOneAndUpdate({ shopId }, updateEnabled, options);
      break;
    case "reviews":
      await ReviewSettings.findOneAndUpdate({ shopId }, updateEnabled, options);
      break;
    case "sizeGuide":
      await SizeGuideSettings.findOneAndUpdate({ shopId }, updateEnabled, options);
      break;
    case "salesPop":
      await SalesPopSettings.findOneAndUpdate({ shopId }, updateEnabled, options);
      break;
    case "faq":
      await FaqSettings.findOneAndUpdate({ shopId }, updateEnabled, options);
      break;
    case "voiceAgent":
      await VoiceAgentSettings.findOneAndUpdate({ shopId }, updateEnabled, options);
      break;
    case "volumeDiscounts": {
      const settings = await VolumeDiscountSettings.findOne({ shopId });
      if (!settings) {
        await VolumeDiscountSettings.create({
          shopId,
          campaigns: enabled
            ? [
                {
                  title: "Default volume discount",
                  enabled: true,
                  scope: "all",
                  products: [],
                  tiers: [
                    {
                      minQuantity: 2,
                      valueType: "percentage",
                      value: 5,
                      label: "Buy 2, save 5%",
                    },
                  ],
                  combinesWithShipping: true,
                  combinesWithOrder: false,
                  combinesWithProduct: false,
                  badgeText: "Volume Discount",
                  showOnProductPage: true,
                  showInCart: true,
                  primaryColor: "#5C6AC4",
                },
              ]
            : [],
        });
        break;
      }

      if (settings.campaigns.length === 0 && enabled) {
        settings.campaigns.push({
          title: "Default volume discount",
          enabled: true,
          scope: "all",
          products: [],
          tiers: [
            {
              minQuantity: 2,
              valueType: "percentage",
              value: 5,
              label: "Buy 2, save 5%",
            },
          ],
          combinesWithShipping: true,
          combinesWithOrder: false,
          combinesWithProduct: false,
          badgeText: "Volume Discount",
          showOnProductPage: true,
          showInCart: true,
          primaryColor: "#5C6AC4",
        });
      } else {
        settings.campaigns.forEach((campaign, index) => {
          campaign.enabled = enabled && index === 0;
        });
      }
      await settings.save();
      break;
    }
    default:
      break;
  }
}

function parsePluginFieldValue(field: PluginField, formData: FormData) {
  if (field.type === "checkbox") {
    return formData.get(field.name) === "true";
  }

  const value = String(formData.get(field.name) || "");

  if (field.type === "number") {
    return Number(value) || 0;
  }

  if (
    field.name === "codPincodes" ||
    field.name === "noCodPincodes" ||
    field.name === "nonServiceablePincodes"
  ) {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return value;
}

async function updatePluginSettings(
  shopId: string,
  pluginKey: string,
  formData: FormData,
) {
  const fields = editablePluginFields[pluginKey];
  if (!fields) return;

  const $set = fields.reduce<Record<string, unknown>>((updates, field) => {
    updates[field.name] = parsePluginFieldValue(field, formData);
    return updates;
  }, {});

  const options = { upsert: true, setDefaultsOnInsert: true };

  switch (pluginKey) {
    case "loyalty":
      await Settings.findOneAndUpdate({ shopId }, { $set }, options);
      break;
    case "wishlist":
      await WishlistSettings.findOneAndUpdate({ shopId }, { $set }, options);
      break;
    case "timer":
      await TimerSettings.findOneAndUpdate({ shopId }, { $set }, options);
      break;
    case "exitPopup":
      await PopupSettings.findOneAndUpdate({ shopId }, { $set }, options);
      break;
    case "pincode":
      await PincodeSettings.findOneAndUpdate({ shopId }, { $set }, options);
      break;
    case "reviews":
      await ReviewSettings.findOneAndUpdate({ shopId }, { $set }, options);
      break;
    case "salesPop":
      await SalesPopSettings.findOneAndUpdate({ shopId }, { $set }, options);
      break;
    case "faq":
      await FaqSettings.findOneAndUpdate({ shopId }, { $set }, options);
      break;
    case "voiceAgent":
      await VoiceAgentSettings.findOneAndUpdate({ shopId }, { $set }, options);
      break;
    default:
      break;
  }
}

export const action = async ({ request }: ActionFunctionArgs) => {
  await requireAdmin(request);
  await connectDB();

  const formData = await request.formData();
  const intent = String(formData.get("intent") || "toggle-plugin");
  const shopId = String(formData.get("shop") || "");
  const pluginKey = String(formData.get("pluginKey") || "");

  if (!shopId || !pluginDefinitions.some((plugin) => plugin.key === pluginKey)) {
    return json({ success: false }, { status: 400 });
  }

  if (intent === "update-plugin") {
    if (!editablePluginKeys.has(pluginKey)) {
      return json({ success: false }, { status: 400 });
    }

    await updatePluginSettings(shopId, pluginKey, formData);
    return redirect(
      `/admin?shop=${encodeURIComponent(shopId)}&tab=plugins&plugin=${encodeURIComponent(pluginKey)}`,
    );
  }

  const enabled = formData.get("enabled") === "true";
  await setPluginStatus(shopId, pluginKey, enabled);
  return redirect(
    `/admin?shop=${encodeURIComponent(shopId)}&tab=plugins&plugin=${encodeURIComponent(pluginKey)}`,
  );
};

function HealthPanel({
  program,
  stats,
}: {
  program: {
    isActive: boolean;
    earningRate: number;
    signupBonus: number;
    currencySymbol: string;
  } | null;
  stats: {
    setupProgress: number;
    totalRedemptions: number;
    enabledPlugins: number;
    totalPlugins: number;
  };
}) {
  const pluginCoverage = Math.round(
    (stats.enabledPlugins / stats.totalPlugins) * 100,
  );

  return (
    <div className="admin-health-panel">
      <div className="admin-health-hero">
        <InlineStack align="space-between" blockAlign="center" gap="400">
          <BlockStack gap="100">
            <Text as="h2" variant="headingLg">
              App health
            </Text>
            <Text as="p" tone="subdued">
              {program
                ? `Program gives ${program.earningRate}% back with a ${program.currencySymbol}${program.signupBonus} signup bonus.`
                : "No loyalty program settings found for this store."}
            </Text>
          </BlockStack>
          <span
            className="admin-health-status"
            data-active={String(Boolean(program?.isActive))}
          >
            <span className="admin-health-dot" />
            {program?.isActive ? "Active" : "Paused"}
          </span>
        </InlineStack>
      </div>
      <div className="admin-health-body">
        <BlockStack gap="400">
          <BlockStack gap="200">
            <InlineStack align="space-between">
              <Text as="p" fontWeight="semibold">
                Setup progress
              </Text>
              <Text as="p" tone="subdued">
                {stats.setupProgress}%
              </Text>
            </InlineStack>
            <div className="admin-health-progress">
              <div
                className="admin-health-progress-fill"
                style={{ width: `${stats.setupProgress}%` }}
              />
            </div>
          </BlockStack>

          <InlineGrid columns={{ xs: 1, sm: 3 }} gap="300">
            <div className="admin-health-metric">
              <p className="admin-health-metric-label">Setup progress</p>
              <p className="admin-health-metric-value">{stats.setupProgress}%</p>
            </div>
            <div className="admin-health-metric">
              <p className="admin-health-metric-label">Redemptions</p>
              <p className="admin-health-metric-value">
                {stats.totalRedemptions}
              </p>
            </div>
            <div className="admin-health-metric">
              <p className="admin-health-metric-label">Plugin coverage</p>
              <p className="admin-health-metric-value">{pluginCoverage}%</p>
            </div>
          </InlineGrid>
        </BlockStack>
      </div>
    </div>
  );
}

function PluginSettingsEditor({
  shop,
  plugin,
  values,
  isSaving,
}: {
  shop: string;
  plugin: {
    key: string;
    name: string;
    description: string;
  };
  values: Record<string, any>;
  isSaving: boolean;
}) {
  const fields = editablePluginFields[plugin.key] || [];

  return (
    <div className="admin-editor-card">
      <Form method="post">
        <input type="hidden" name="intent" value="update-plugin" />
        <input type="hidden" name="shop" value={shop} />
        <input type="hidden" name="pluginKey" value={plugin.key} />
        <BlockStack gap="400">
          <InlineStack align="space-between" blockAlign="start" gap="300">
            <BlockStack gap="100">
              <Text as="h2" variant="headingLg">
                Edit {plugin.name}
              </Text>
              <Text as="p" tone="subdued">
                Update storefront settings directly from the admin panel.
              </Text>
            </BlockStack>
            <Button url={`/admin?shop=${encodeURIComponent(shop)}&tab=plugins`}>
              Close
            </Button>
          </InlineStack>

          <div className="admin-editor-grid">
            {fields.map((field) => {
              const rawValue = getValueByPath(values, field.name);
              const fieldId = `plugin-${plugin.key}-${field.name}`;

              if (field.type === "checkbox") {
                return (
                  <label className="admin-edit-check" key={field.name}>
                    <input type="hidden" name={field.name} value="false" />
                    <input
                      defaultChecked={Boolean(rawValue)}
                      id={fieldId}
                      name={field.name}
                      type="checkbox"
                      value="true"
                    />
                    <span>{field.label}</span>
                  </label>
                );
              }

              if (field.type === "select") {
                return (
                  <label className="admin-edit-field" key={field.name}>
                    <span>{field.label}</span>
                    <select
                      defaultValue={String(rawValue ?? "")}
                      id={fieldId}
                      name={field.name}
                    >
                      {field.options?.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              }

              if (field.type === "textarea") {
                return (
                  <label className="admin-edit-field admin-edit-field-wide" key={field.name}>
                    <span>{field.label}</span>
                    <textarea
                      defaultValue={
                        Array.isArray(rawValue) ? listToCsv(rawValue) : String(rawValue ?? "")
                      }
                      id={fieldId}
                      name={field.name}
                      rows={4}
                    />
                    {field.helpText ? <small>{field.helpText}</small> : null}
                  </label>
                );
              }

              return (
                <label className="admin-edit-field" key={field.name}>
                  <span>{field.label}</span>
                  <input
                    defaultValue={String(rawValue ?? "")}
                    id={fieldId}
                    name={field.name}
                    step={field.type === "number" ? "any" : undefined}
                    type={field.type === "color" ? "color" : field.type}
                  />
                  {field.helpText ? <small>{field.helpText}</small> : null}
                </label>
              );
            })}
          </div>

          <InlineStack align="end" gap="200">
            <Button submit variant="primary" loading={isSaving}>
              Save changes
            </Button>
          </InlineStack>
        </BlockStack>
      </Form>
    </div>
  );
}

export default function AdminPanel() {
  const {
    polarisTranslations,
    shops,
    selectedShop,
    activeTab,
    selectedPluginKey,
    stats,
    program,
    setupTasks,
    plugins,
    pluginSettings,
    recentTransactions,
  } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState("all");
  const tabUrl = (tab: string) =>
    `/admin?${new URLSearchParams({
      ...(selectedShop ? { shop: selectedShop } : {}),
      tab,
    }).toString()}`;

  const filteredPlugins = useMemo(() => {
    return plugins.filter((plugin) => {
      const matchesQuery =
        plugin.name.toLowerCase().includes(query.toLowerCase()) ||
        plugin.description.toLowerCase().includes(query.toLowerCase());
      const matchesCategory = category === "all" || plugin.category === category;
      const matchesStatus =
        status === "all" ||
        (status === "enabled" && plugin.enabled) ||
        (status === "disabled" && !plugin.enabled);

      return matchesQuery && matchesCategory && matchesStatus;
    });
  }, [category, plugins, query, status]);
  const selectedPlugin = plugins.find(
    (plugin) => plugin.key === selectedPluginKey,
  );
  const isSavingPlugin =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "update-plugin";

  const rows = recentTransactions.map((transaction) => [
    transaction.customer,
    transaction.type,
    transaction.points > 0 ? `+${transaction.points}` : String(transaction.points),
    transaction.source,
    transaction.date
      ? new Date(transaction.date).toLocaleDateString("en-IN")
      : "",
  ]);

  return (
    <AppProvider i18n={polarisTranslations}>
      <style>
        {`
          .admin-shell {
            display: grid;
            grid-template-columns: 260px minmax(0, 1fr);
            gap: 18px;
            align-items: start;
          }

          .admin-sidebar {
            position: sticky;
            top: 16px;
          }

          .admin-sidebar-card {
            background: #ffffff;
            border: 1px solid #dde3ea;
            border-radius: 12px;
            box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
            padding: 14px;
          }

          .admin-brand {
            border-radius: 10px;
            background: #f6f8fb;
            border: 1px solid #e3e8ef;
            padding: 12px;
          }

          .admin-brand-mark {
            width: 34px;
            height: 34px;
            border-radius: 9px;
            background: #0f62fe;
            color: #ffffff;
            display: grid;
            place-items: center;
            font-weight: 700;
          }

          .admin-sidebar-link {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 10px 12px;
            border-radius: 8px;
            color: #202223;
            text-decoration: none;
            font-weight: 500;
            border: 1px solid transparent;
          }

          .admin-sidebar-link:hover {
            background: #f6f8fb;
            border-color: #e3e8ef;
            text-decoration: none;
          }

          .admin-sidebar-link[data-active="true"] {
            background: #eef5ff;
            border-color: #bfdbfe;
            color: #005bd3;
          }

          .admin-main {
            min-width: 0;
          }

          .admin-section {
            scroll-margin-top: 20px;
          }

          .admin-top-card {
            background: #ffffff;
            border: 1px solid #dde3ea;
            border-radius: 12px;
            box-shadow: 0 1px 2px rgba(15, 23, 42, 0.05);
            padding: 16px;
          }

          .admin-metric-card {
            min-height: 112px;
            border: 1px solid #dde3ea;
            border-radius: 12px;
            background: #ffffff;
            box-shadow: 0 1px 2px rgba(15, 23, 42, 0.05);
            padding: 16px;
          }

          .admin-metric-label {
            color: #616a75;
            font-size: 13px;
            font-weight: 600;
          }

          .admin-plugin-card {
            height: 100%;
            border: 1px solid #dde3ea;
            border-radius: 12px;
            background: #ffffff;
            box-shadow: 0 1px 2px rgba(15, 23, 42, 0.05);
            padding: 16px;
          }

          .admin-panel-title {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
          }

          .admin-filter-card {
            border: 1px solid #dde3ea;
            border-radius: 12px;
            background: #f8fafc;
            padding: 14px;
          }

          .admin-editor-card {
            border: 1px solid #c7d7fe;
            border-radius: 14px;
            background: #ffffff;
            box-shadow: 0 8px 24px rgba(15, 23, 42, 0.08);
            padding: 18px;
          }

          .admin-editor-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 14px;
          }

          .admin-edit-field,
          .admin-edit-check {
            display: grid;
            gap: 6px;
          }

          .admin-edit-field-wide {
            grid-column: 1 / -1;
          }

          .admin-edit-field span,
          .admin-edit-check span {
            color: #344054;
            font-size: 13px;
            font-weight: 650;
          }

          .admin-edit-field input,
          .admin-edit-field select,
          .admin-edit-field textarea {
            width: 100%;
            border: 1px solid #cfd7e2;
            border-radius: 8px;
            background: #ffffff;
            color: #111827;
            font: inherit;
            min-height: 40px;
            padding: 8px 10px;
          }

          .admin-edit-field input[type="color"] {
            padding: 4px;
          }

          .admin-edit-field textarea {
            resize: vertical;
            min-height: 96px;
          }

          .admin-edit-field small {
            color: #667085;
            font-size: 12px;
          }

          .admin-edit-check {
            align-items: center;
            grid-template-columns: 18px 1fr;
            border: 1px solid #e3e8ef;
            border-radius: 10px;
            padding: 11px 12px;
            background: #f8fafc;
          }

          .admin-edit-check input {
            width: 16px;
            height: 16px;
            margin: 0;
          }

          .admin-checklist-card {
            border: 1px solid #dde3ea;
            border-radius: 12px;
            background: #ffffff;
            box-shadow: 0 1px 2px rgba(15, 23, 42, 0.05);
            overflow: hidden;
          }

          .admin-checklist-header {
            padding: 16px 18px;
            border-bottom: 1px solid #edf0f3;
            background: #f8fafc;
          }

          .admin-checklist-row {
            display: grid;
            grid-template-columns: auto 1fr auto;
            gap: 12px;
            align-items: center;
            padding: 14px 18px;
            border-bottom: 1px solid #edf0f3;
          }

          .admin-checklist-row:last-child {
            border-bottom: 0;
          }

          .admin-check-icon {
            width: 28px;
            height: 28px;
            border-radius: 999px;
            display: grid;
            place-items: center;
            font-weight: 700;
            font-size: 13px;
            background: #dcfce7;
            color: #166534;
          }

          .admin-check-icon[data-done="false"] {
            background: #fff7ed;
            color: #9a3412;
          }

          .admin-check-action {
            min-width: 86px;
            text-align: right;
          }

          .admin-health-panel {
            border: 1px solid #d6e4f0;
            border-radius: 14px;
            background: #ffffff;
            box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
            overflow: hidden;
          }

          .admin-health-hero {
            padding: 18px;
            background: #f7fbff;
            border-bottom: 1px solid #e3edf7;
          }

          .admin-health-status {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 7px 10px;
            border-radius: 999px;
            background: #dcfce7;
            color: #166534;
            font-weight: 700;
            font-size: 13px;
          }

          .admin-health-status[data-active="false"] {
            background: #fee2e2;
            color: #991b1b;
          }

          .admin-health-dot {
            width: 8px;
            height: 8px;
            border-radius: 999px;
            background: currentColor;
          }

          .admin-health-body {
            padding: 18px;
          }

          .admin-health-progress {
            height: 10px;
            border-radius: 999px;
            background: #e8edf3;
            overflow: hidden;
          }

          .admin-health-progress-fill {
            height: 100%;
            border-radius: inherit;
            background: #0f62fe;
          }

          .admin-health-metric {
            border: 1px solid #e3e8ef;
            border-radius: 12px;
            background: #f8fafc;
            padding: 14px;
            min-height: 94px;
          }

          .admin-health-metric-label {
            color: #667085;
            font-size: 13px;
            font-weight: 600;
            margin: 0 0 6px;
          }

          .admin-health-metric-value {
            color: #111827;
            font-size: 28px;
            line-height: 1.1;
            font-weight: 750;
            margin: 0;
          }

          @media (max-width: 900px) {
            .admin-shell {
              grid-template-columns: 1fr;
            }

            .admin-sidebar {
              position: static;
            }

            .admin-editor-grid {
              grid-template-columns: 1fr;
            }
          }
        `}
      </style>
      <Page
        fullWidth
        title="Admin panel"
        subtitle="Separate control center for app health, plugins, and quick actions."
        primaryAction={{ content: "Logout", url: "/admin/logout" }}
      >
        <div className="admin-shell">
          <aside className="admin-sidebar">
            <div className="admin-sidebar-card">
              <BlockStack gap="400">
                <div className="admin-brand">
                  <InlineStack gap="300" blockAlign="center">
                    <div className="admin-brand-mark">LR</div>
                    <BlockStack gap="050">
                      <Text as="h2" variant="headingMd">
                        Admin
                      </Text>
                      <Text as="p" tone="subdued">
                        {selectedShop || "No store selected"}
                      </Text>
                    </BlockStack>
                  </InlineStack>
                </div>
                <BlockStack gap="100">
                  <a
                    className="admin-sidebar-link"
                    data-active={activeTab === "overview"}
                    href={tabUrl("overview")}
                  >
                    Overview
                  </a>
                  <a
                    className="admin-sidebar-link"
                    data-active={activeTab === "health"}
                    href={tabUrl("health")}
                  >
                    App health
                  </a>
                  <a
                    className="admin-sidebar-link"
                    data-active={activeTab === "checklist"}
                    href={tabUrl("checklist")}
                  >
                    Checklist
                  </a>
                  <a
                    className="admin-sidebar-link"
                    data-active={activeTab === "plugins"}
                    href={tabUrl("plugins")}
                  >
                    Plugins
                  </a>
                  <a
                    className="admin-sidebar-link"
                    data-active={activeTab === "activity"}
                    href={tabUrl("activity")}
                  >
                    Activity
                  </a>
                </BlockStack>
                <Button url="/admin/logout">Logout</Button>
              </BlockStack>
            </div>
          </aside>

          <main className="admin-main">
            <BlockStack gap="500">
              <section className="admin-section">
                <div className="admin-top-card">
                  <InlineStack align="space-between" blockAlign="end" gap="400">
                    <Box minWidth="320px">
                      <Select
                        label="Store"
                        value={selectedShop}
                        onChange={(shop) => {
                          window.location.href = `/admin?shop=${encodeURIComponent(shop)}`;
                        }}
                        options={
                          shops.length
                            ? shops.map((shop) => ({ label: shop, value: shop }))
                            : [{ label: "No store data found", value: "" }]
                        }
                      />
                    </Box>
                    <Text as="p" tone="subdued">
                      Login route: /admin/login
                    </Text>
                  </InlineStack>
                </div>
              </section>

              {!selectedShop ? (
                <Card>
                  <EmptyState
                    heading="No store data found"
                    image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                  >
                    <p>
                      Install or open the Shopify app once so settings are created,
                      then return to this admin panel.
                    </p>
                  </EmptyState>
                </Card>
              ) : (
                <>
                  {activeTab === "overview" && (
                    <InlineGrid columns={{ xs: 1, sm: 2, lg: 4 }} gap="400">
                      <div className="admin-metric-card">
                        <BlockStack gap="200">
                          <p className="admin-metric-label">Active plugins</p>
                          <Text as="p" variant="headingXl">
                            {stats.enabledPlugins}/{stats.totalPlugins}
                          </Text>
                        </BlockStack>
                      </div>
                      <div className="admin-metric-card">
                        <BlockStack gap="200">
                          <p className="admin-metric-label">Members</p>
                          <Text as="p" variant="headingXl">
                            {stats.totalCustomers.toLocaleString("en-IN")}
                          </Text>
                        </BlockStack>
                      </div>
                      <div className="admin-metric-card">
                        <BlockStack gap="200">
                          <p className="admin-metric-label">Points issued</p>
                          <Text as="p" variant="headingXl">
                            {stats.totalPointsIssued.toLocaleString("en-IN")}
                          </Text>
                        </BlockStack>
                      </div>
                      <div className="admin-metric-card">
                        <BlockStack gap="200">
                          <p className="admin-metric-label">Active codes</p>
                          <Text as="p" variant="headingXl">
                            {stats.activeDiscountCodes}
                          </Text>
                        </BlockStack>
                      </div>
                    </InlineGrid>
                  )}

                  {activeTab === "overview" && (
                  <Layout>
                    <Layout.Section>
                      <section className="admin-section">
                        <HealthPanel program={program} stats={stats} />
                      </section>
                    </Layout.Section>

                    <Layout.Section variant="oneThird">
                      {(activeTab === "overview" || activeTab === "checklist") && (
                      <section className="admin-section">
                  <Card>
                    <BlockStack gap="300">
                      <Text as="h2" variant="headingMd">
                        Checklist
                      </Text>
                      {setupTasks.map((task) => (
                        <InlineStack
                          key={task.title}
                          align="space-between"
                          blockAlign="center"
                          gap="300"
                        >
                          <InlineStack gap="200" blockAlign="center">
                            <Badge tone={task.done ? "success" : "attention"}>
                              {task.done ? "Done" : "Open"}
                            </Badge>
                            <Text as="p">{task.title}</Text>
                          </InlineStack>
                          <Button size="slim" url={task.route}>
                            View
                          </Button>
                        </InlineStack>
                      ))}
                    </BlockStack>
                  </Card>
                      </section>
                      )}
                    </Layout.Section>
                  </Layout>
                  )}

                  {activeTab === "health" && (
                    <section className="admin-section">
                      <HealthPanel program={program} stats={stats} />
                    </section>
                  )}

                  {activeTab === "checklist" && (
                    <section className="admin-section">
                      <div className="admin-checklist-card">
                        <div className="admin-checklist-header">
                          <BlockStack gap="100">
                            <Text as="h2" variant="headingLg">
                              Launch checklist
                            </Text>
                            <Text as="p" tone="subdued">
                              Track the setup items that make the storefront tools ready.
                            </Text>
                          </BlockStack>
                        </div>
                        {setupTasks.map((task) => (
                          <div className="admin-checklist-row" key={task.title}>
                            <div
                              className="admin-check-icon"
                              data-done={String(task.done)}
                            >
                              {task.done ? "✓" : "!"}
                            </div>
                            <BlockStack gap="050">
                              <Text as="p" fontWeight="semibold">
                                {task.title}
                              </Text>
                              <Text as="p" tone="subdued">
                                {task.done
                                  ? "Completed and ready."
                                  : "Needs attention before launch."}
                              </Text>
                            </BlockStack>
                            <div className="admin-check-action">
                              <Badge tone={task.done ? "success" : "attention"}>
                                {task.done ? "Done" : "Open"}
                              </Badge>
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {activeTab === "plugins" && (
                  <section className="admin-section">
                    <Card>
                      <BlockStack gap="400">
                        <div className="admin-panel-title">
                          <BlockStack gap="100">
                            <Text as="h2" variant="headingLg">
                              Plugin manager
                            </Text>
                            <Text as="p" tone="subdued">
                              Enable tools and edit storefront settings without leaving admin.
                            </Text>
                          </BlockStack>
                          <Badge tone="info">{filteredPlugins.length} shown</Badge>
                        </div>
                        {selectedPlugin && selectedPlugin.editable ? (
                          <PluginSettingsEditor
                            shop={selectedShop}
                            plugin={selectedPlugin}
                            values={(pluginSettings as Record<string, any>)[selectedPlugin.key] || {}}
                            isSaving={isSavingPlugin}
                          />
                        ) : null}
                        <div className="admin-filter-card">
                          <InlineGrid columns={{ xs: 1, md: 3 }} gap="300">
                            <TextField
                              label="Search plugins"
                              value={query}
                              onChange={setQuery}
                              autoComplete="off"
                              placeholder="Search by name or use case"
                            />
                            <Select
                              label="Category"
                              value={category}
                              onChange={setCategory}
                              options={[
                                { label: "All categories", value: "all" },
                                { label: "Loyalty", value: "Loyalty" },
                                { label: "Conversion", value: "Conversion" },
                                { label: "Merchandising", value: "Merchandising" },
                                { label: "Support", value: "Support" },
                                { label: "Content", value: "Content" },
                                { label: "Localization", value: "Localization" },
                              ]}
                            />
                            <Select
                              label="Status"
                              value={status}
                              onChange={setStatus}
                              options={[
                                { label: "All statuses", value: "all" },
                                { label: "Enabled", value: "enabled" },
                                { label: "Disabled", value: "disabled" },
                              ]}
                            />
                          </InlineGrid>
                        </div>
                        <InlineGrid columns={{ xs: 1, md: 2, lg: 3 }} gap="400">
                          {filteredPlugins.map((plugin) => (
                            <div className="admin-plugin-card" key={plugin.key}>
                              <BlockStack gap="400">
                                <InlineStack align="space-between" blockAlign="start" gap="300">
                                  <BlockStack gap="100">
                                    <Text as="h3" variant="headingMd">
                                      {plugin.name}
                                    </Text>
                                    <Text as="p" tone="subdued">
                                      {plugin.category}
                                    </Text>
                                  </BlockStack>
                                  <Badge tone={plugin.enabled ? "success" : "attention"}>
                                    {plugin.enabled ? "Enabled" : "Disabled"}
                                  </Badge>
                                </InlineStack>
                                <Text as="p">{plugin.description}</Text>
                                {plugin.key === "stockAlerts" ? (
                                  <Button disabled>Analytics only</Button>
                                ) : (
                                  <InlineStack gap="200">
                                    {plugin.editable ? (
                                      <Button
                                        url={`/admin?shop=${encodeURIComponent(
                                          selectedShop,
                                        )}&tab=plugins&plugin=${encodeURIComponent(plugin.key)}`}
                                      >
                                        Edit
                                      </Button>
                                    ) : (
                                      <Button disabled>Edit coming soon</Button>
                                    )}
                                    <Form method="post">
                                      <input type="hidden" name="intent" value="toggle-plugin" />
                                      <input type="hidden" name="shop" value={selectedShop} />
                                      <input
                                        type="hidden"
                                        name="pluginKey"
                                        value={plugin.key}
                                      />
                                      <input
                                        type="hidden"
                                        name="enabled"
                                        value={String(!plugin.enabled)}
                                      />
                                      <Button
                                        submit
                                        variant={plugin.enabled ? "secondary" : "primary"}
                                        tone={plugin.enabled ? "critical" : undefined}
                                        loading={
                                          navigation.state === "submitting" &&
                                          navigation.formData?.get("pluginKey") === plugin.key &&
                                          navigation.formData?.get("intent") === "toggle-plugin"
                                        }
                                      >
                                        {plugin.enabled ? "Disable" : "Enable"}
                                      </Button>
                                    </Form>
                                  </InlineStack>
                                )}
                              </BlockStack>
                            </div>
                          ))}
                        </InlineGrid>
                      </BlockStack>
                    </Card>
                  </section>
                  )}

                  {(activeTab === "overview" || activeTab === "activity") && (
                  <section className="admin-section">
                    <Card>
                      <BlockStack gap="300">
                        <Text as="h2" variant="headingMd">
                          Recent activity
                        </Text>
                        {rows.length > 0 ? (
                          <DataTable
                            columnContentTypes={["text", "text", "numeric", "text", "text"]}
                            headings={["Customer", "Type", "Points", "Source", "Date"]}
                            rows={rows}
                          />
                        ) : (
                          <EmptyState
                            heading="No activity yet"
                            image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                          >
                            <p>
                              Customer activity will appear here when shoppers earn or
                              redeem rewards.
                            </p>
                          </EmptyState>
                        )}
                      </BlockStack>
                    </Card>
                  </section>
                  )}
                </>
              )}
            </BlockStack>
          </main>
        </div>
      </Page>
    </AppProvider>
  );
}
