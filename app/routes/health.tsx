import { json } from "@remix-run/node";
import { configuredApps } from "../shopify.server";

/**
 * Unauthenticated deployment check: which Shopify app registrations this
 * running process has loaded, and the URL it believes it is served from.
 * Client IDs and the app URL are public; secrets are never returned.
 */
export const loader = () =>
  json(
    {
      ok: true,
      appUrl: process.env.SHOPIFY_APP_URL || null,
      apps: configuredApps,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
