import { json } from "@remix-run/node";
import { configuredClientIds } from "../shopify.server";

/**
 * Unauthenticated deployment check: which Shopify app registrations this
 * running process has loaded. Client IDs are public (they appear in the
 * embedded app's HTML); secrets are never returned.
 */
export const loader = () =>
  json(
    { ok: true, apps: configuredClientIds },
    { headers: { "Cache-Control": "no-store" } },
  );
