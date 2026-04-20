import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

import { authenticate } from "../shopify.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return json({ apiKey: process.env.SHOPIFY_API_KEY || "" });
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <NavMenu>
        <Link to="/app" rel="home">Dashboard</Link>
        <Link to="/app/rewards">Rewards</Link>
        <Link to="/app/customers">Customers</Link>
        <Link to="/app/transactions">Transactions</Link>
        <Link to="/app/referrals">Referrals</Link>
        <Link to="/app/image-search-settings">Image Search</Link>
        <Link to="/app/cart-settings">Cart Drawer</Link>
        <Link to="/app/timer-settings">Timer</Link>
        <Link to="/app/popup-settings">Exit Popup</Link>
        <Link to="/app/wheel-settings">Spin Wheel</Link>
        <Link to="/app/stock-alerts">Stock Alerts</Link>
        <Link to="/app/wishlist">Wishlist</Link>
        <Link to="/app/voice-agent">Voice Agent</Link>
        <Link to="/app/pincode-settings">Pincode Estimator</Link>
        <Link to="/app/upsell-settings">Post-Purchase Upsell</Link>
        <Link to="/app/ugc-settings">UGC Gallery</Link>
        <Link to="/app/cod-settings">COD WhatsApp</Link>
        <Link to="/app/reviews-settings">Reviews & Q&A</Link>
        <Link to="/app/currency-settings">Currency Selector</Link>
        <Link to="/app/size-guide-settings">Size Guide</Link>
        <Link to="/app/sales-pop-settings">Sales Pop</Link>
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
