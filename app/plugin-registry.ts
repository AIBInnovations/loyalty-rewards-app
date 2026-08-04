export interface PluginDefinition {
  key: string;
  label: string;
}

// Every storefront plugin that has a shop-level enabled toggle. Keys match
// the pluginKey convention used by app/.server/models/plugin-config.model.ts.
export const PLUGIN_LIST: PluginDefinition[] = [
  { key: "loyalty", label: "Loyalty Points" },
  { key: "cartDrawer", label: "Cart Drawer" },
  { key: "wishlist", label: "Wishlist" },
  { key: "reviews", label: "Reviews" },
  { key: "volumeDiscounts", label: "Volume Discounts" },
  { key: "timer", label: "Countdown Timer" },
  { key: "exitPopup", label: "Exit Popup" },
  { key: "smartPopup", label: "Smart Email Popup" },
  { key: "spinWheel", label: "Spin the Wheel" },
  { key: "stockAlerts", label: "Back in Stock Alerts" },
  { key: "imageSearch", label: "Image Search" },
  { key: "pincode", label: "Pincode Delivery Estimator" },
  { key: "trustBadges", label: "Trust Badges" },
  { key: "postPurchaseUpsell", label: "Post-Purchase Upsell" },
  { key: "ugc", label: "UGC Gallery" },
  { key: "codWhatsapp", label: "COD / WhatsApp" },
  { key: "currency", label: "Currency Selector" },
  { key: "sizeGuide", label: "Size Guide" },
  { key: "salesPop", label: "Sales Pop" },
  { key: "faq", label: "FAQ Accordion" },
  { key: "voiceAgent", label: "Voice Agent" },
];
