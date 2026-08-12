import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

import { authenticate } from "../shopify.server";
import { connectDB } from "../db.server";
import { CartDrawerSettings } from "../.server/models/cart-settings.model";
import { BundleSettings } from "../.server/models/bundle.model";
import { WishlistSettings } from "../.server/models/wishlist-settings.model";
import { VolumeDiscountSettings } from "../.server/models/volume-discount.model";
import { TimerSettings } from "../.server/models/timer-settings.model";
import { PopupSettings } from "../.server/models/popup-settings.model";
import { SmartPopupSettings } from "../.server/models/smart-popup.model";
import { WheelSettings } from "../.server/models/wheel-settings.model";
import { ImageSearchSettings } from "../.server/models/image-search-settings.model";
import { PincodeSettings } from "../.server/models/pincode-settings.model";
import { TrustBadgesSettings } from "../.server/models/trust-badges.model";
import { UpsellSettings } from "../.server/models/upsell-settings.model";
import { UGCSettings } from "../.server/models/ugc-settings.model";
import { CodSettings } from "../.server/models/cod-settings.model";
import { ReviewSettings } from "../.server/models/review-settings.model";
import { SizeGuideSettings } from "../.server/models/size-guide-settings.model";
import { SalesPopSettings } from "../.server/models/sales-pop-settings.model";
import { FaqSettings } from "../.server/models/faq-settings.model";
import { VoiceAgentSettings } from "../.server/models/voice-agent-settings.model";
import { Settings } from "../.server/models/settings.model";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();

  const shopId = session.shop;

  // Same enabled flags the super-admin panel (/admin) writes per shop, so
  // toggling a plugin off there also removes its settings link from the
  // merchant's own Shopify Admin nav here — not just the storefront widget.
  const [
    cartDrawer,
    bundleGenie,
    wishlist,
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
    settings,
  ] = await Promise.all([
    CartDrawerSettings.findOne({ shopId }).lean(),
    BundleSettings.findOne({ shopId }).lean(),
    WishlistSettings.findOne({ shopId }).lean(),
    VolumeDiscountSettings.findOne({ shopId }).lean(),
    TimerSettings.findOne({ shopId }).lean(),
    PopupSettings.findOne({ shopId }).lean(),
    SmartPopupSettings.findOne({ shopId }).lean(),
    WheelSettings.findOne({ shopId }).lean(),
    ImageSearchSettings.findOne({ shopId }).lean(),
    PincodeSettings.findOne({ shopId }).lean(),
    TrustBadgesSettings.findOne({ shopId }).lean(),
    UpsellSettings.findOne({ shopId }).lean(),
    UGCSettings.findOne({ shopId }).lean(),
    CodSettings.findOne({ shopId }).lean(),
    ReviewSettings.findOne({ shopId }).lean(),
    SizeGuideSettings.findOne({ shopId }).lean(),
    SalesPopSettings.findOne({ shopId }).lean(),
    FaqSettings.findOne({ shopId }).lean(),
    VoiceAgentSettings.findOne({ shopId }).lean(),
    Settings.findOne({ shopId }).lean(),
  ]);

  const enabled = {
    loyalty: settings?.isActive ?? true,
    cartDrawer: cartDrawer?.enabled ?? false,
    bundleGenie: bundleGenie?.enabled ?? false,
    wishlist: wishlist?.enabled ?? false,
    volumeDiscounts:
      volumeDiscounts?.campaigns?.some((campaign: any) => campaign.enabled) ??
      false,
    timer: timer?.enabled ?? false,
    exitPopup: exitPopup?.enabled ?? false,
    smartPopup: smartPopup?.enabled ?? false,
    spinWheel: spinWheel?.enabled ?? false,
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
    customers: settings?.customersPageEnabled ?? true,
  };

  return json(
    { apiKey: process.env.SHOPIFY_API_KEY || "", enabled },
    { headers: { "Cache-Control": "no-store" } },
  );
};

export default function App() {
  const { apiKey, enabled } = useLoaderData<typeof loader>();

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <NavMenu>
        <Link to="/app" rel="home">Dashboard</Link>
        {enabled.loyalty && <Link to="/app/rewards">Rewards</Link>}
        {enabled.customers && <Link to="/app/customers">Customers</Link>}
        <Link to="/app/transactions">Transactions</Link>
        <Link to="/app/referrals">Referrals</Link>
        {enabled.imageSearch && <Link to="/app/image-search-settings">Image Search</Link>}
        {enabled.cartDrawer && <Link to="/app/cart-settings">Cart Drawer</Link>}
        {enabled.bundleGenie && <Link to="/app/bundle-genie">Bundle Genie</Link>}
        {enabled.volumeDiscounts && <Link to="/app/volume-discounts">Volume Discounts</Link>}
        {enabled.timer && <Link to="/app/timer-settings">Timer</Link>}
        {enabled.exitPopup && <Link to="/app/popup-settings">Exit Popup</Link>}
        {enabled.smartPopup && <Link to="/app/smart-popup">Smart Email Popup</Link>}
        {enabled.spinWheel && <Link to="/app/wheel-settings">Spin Wheel</Link>}
        <Link to="/app/stock-alerts">Stock Alerts</Link>
        {enabled.wishlist && <Link to="/app/wishlist">Wishlist</Link>}
        {enabled.voiceAgent && <Link to="/app/voice-agent">Voice Agent</Link>}
        {enabled.pincode && <Link to="/app/pincode-settings">Pincode Estimator</Link>}
        {enabled.trustBadges && <Link to="/app/trust-badges">Trust Badges</Link>}
        {enabled.postPurchaseUpsell && <Link to="/app/upsell-settings">Post-Purchase Upsell</Link>}
        {enabled.ugc && <Link to="/app/ugc-settings">UGC Gallery</Link>}
        {enabled.codWhatsapp && <Link to="/app/cod-settings">COD WhatsApp</Link>}
        {enabled.reviews && <Link to="/app/reviews-settings">Reviews & Q&A</Link>}
        {enabled.currency && <Link to="/app/currency-settings">Currency Selector</Link>}
        {enabled.sizeGuide && <Link to="/app/size-guide-settings">Size Guide</Link>}
        {enabled.salesPop && <Link to="/app/sales-pop-settings">Sales Pop</Link>}
        {enabled.faq && <Link to="/app/faq-settings">FAQ Accordion</Link>}
        <Link to="/app/settings">Settings</Link>
      </NavMenu>
      <Outlet />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
