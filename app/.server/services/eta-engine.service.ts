// Centralized Estimated Delivery calculation — the single source of truth
// for both today's product-page consumer and any future one (cart,
// checkout extension, GoKwik, headless). Everything here is server-only;
// the storefront only ever receives the normalized result below.

import { PincodeSettings, type IPincodeSettings } from "../models/pincode-settings.model";
import { getZoneForPincode } from "../../pincode-zones";
import {
  getShiprocketToken,
  checkServiceability,
  encryptShiprocketSecret,
  decryptShiprocketSecret,
  shiprocketLogin,
  TOKEN_LIFETIME_MS,
} from "./shiprocket.service";

export interface ETAResult {
  deliverable: boolean;
  cod: boolean;
  minDays: number;
  maxDays: number;
  state: string;
  /** "manual" | "shiprocket" — which engine actually produced this result,
      so the admin can tell at a glance whether Shiprocket mode is really
      taking effect or silently falling back. Not shown to the customer. */
  source: "manual" | "shiprocket";
}

// In-memory serviceability cache — same Map+sweep shape as the app-proxy
// rate limiter (api.proxy.$.tsx), which is itself flagged there as a
// stand-in for a real TTL store. Shiprocket serviceability rarely changes
// within an hour, so this alone removes the vast majority of repeat calls
// for the same shop+pincode pair without needing new infrastructure.
const CACHE_TTL_MS = 60 * 60 * 1000;
const serviceabilityCache = new Map<string, { result: ETAResult; expiresAt: number }>();

function sweepCache() {
  const now = Date.now();
  for (const [key, entry] of serviceabilityCache) {
    if (entry.expiresAt <= now) serviceabilityCache.delete(key);
  }
}

function cacheKey(shop: string, pincode: string, mode: string) {
  return `${shop}:${pincode}:${mode}`;
}

/** Manual calculation — the app's original logic, unchanged, now the
    shared fallback for both etaMode:"manual" and any Shiprocket failure. */
function calculateManualETA(settings: IPincodeSettings, pincode: string): ETAResult {
  if (settings.nonServiceablePincodes.includes(pincode)) {
    return { deliverable: false, cod: false, minDays: 0, maxDays: 0, state: "", source: "manual" };
  }

  const cod = settings.noCodPincodes.includes(pincode)
    ? false
    : settings.codPincodes.length === 0 || settings.codPincodes.includes(pincode);

  const zone = getZoneForPincode(pincode);
  const zoneOverride = zone
    ? (settings.stateDeliveryDays || []).find((o) => o.zoneKey === zone.key)
    : undefined;

  return {
    deliverable: true,
    cod,
    minDays: zoneOverride ? zoneOverride.minDays : settings.defaultMinDays,
    maxDays: zoneOverride ? zoneOverride.maxDays : settings.defaultMaxDays,
    state: zone?.label || "",
    source: "manual",
  };
}

/** Adds handling-time days on top of a courier's own transit estimate,
    accounting for the cutoff hour and which weekdays count as working
    days — all evaluated in the shop's own timezone, never the server's. */
function addHandlingDays(settings: IPincodeSettings, transitDays: number): { minDays: number; maxDays: number } {
  const tz = settings.shopTimezone || "UTC";
  const now = new Date();
  const shopNowStr = now.toLocaleString("en-US", { timeZone: tz, hour12: false });
  const shopNow = new Date(shopNowStr);

  const workingDays = settings.workingDays?.length ? settings.workingDays : [1, 2, 3, 4, 5, 6];
  const pastCutoff = shopNow.getHours() >= (settings.cutoffHour ?? 18);

  // Walk forward day-by-day, counting only working days, starting the next
  // day immediately if today is already past cutoff.
  let daysToAdd = settings.handlingDays ?? 1;
  if (pastCutoff) daysToAdd += 1;

  let cursor = new Date(shopNow);
  let workingDaysCounted = 0;
  // Cap the walk so a misconfigured (all-days-off) workingDays list can't loop forever.
  for (let guard = 0; guard < 60 && workingDaysCounted < daysToAdd; guard++) {
    cursor.setDate(cursor.getDate() + 1);
    if (workingDays.includes(cursor.getDay())) workingDaysCounted++;
  }
  const handlingOffsetDays = Math.max(
    0,
    Math.round((cursor.getTime() - shopNow.getTime()) / (24 * 60 * 60 * 1000)),
  );

  return {
    minDays: handlingOffsetDays + transitDays,
    maxDays: handlingOffsetDays + transitDays + 1,
  };
}

/** Shiprocket-backed calculation. Never throws — any failure resolves to
    null so the caller falls back to the manual engine, per the storefront-
    must-never-break requirement. */
async function calculateShiprocketETA(
  settings: IPincodeSettings,
  pincode: string,
): Promise<ETAResult | null> {
  if (!settings.pickupPincode) return null;

  try {
    const { token, refreshed } = await getShiprocketToken(settings);
    if (refreshed) {
      // Persist the refreshed token so the next request in the ~9-day
      // window reuses it instead of re-authenticating every time.
      await PincodeSettings.updateOne(
        { _id: settings._id },
        {
          $set: {
            shiprocketTokenEncrypted: encryptShiprocketSecret(token),
            shiprocketTokenExpiresAt: new Date(Date.now() + TOKEN_LIFETIME_MS),
            shiprocketConnected: true,
            shiprocketLastError: "",
          },
        },
      );
    }

    const result = await checkServiceability(token, {
      pickupPincode: settings.pickupPincode,
      deliveryPincode: pincode,
      cod: true,
    });

    if (!result.serviceable) {
      return { deliverable: false, cod: false, minDays: 0, maxDays: 0, state: "", source: "shiprocket" };
    }

    const transitDays = result.etaDays ?? Math.max(settings.defaultMinDays, 1);
    const { minDays, maxDays } = addHandlingDays(settings, transitDays);
    const zone = getZoneForPincode(pincode);

    return {
      deliverable: true,
      cod: result.codAvailable,
      minDays,
      maxDays,
      state: zone?.label || "",
      source: "shiprocket",
    };
  } catch (err) {
    // Record the failure for the admin's connection-status card, but never
    // propagate it — the manual engine below is the safety net.
    await PincodeSettings.updateOne(
      { _id: settings._id },
      { $set: { shiprocketLastError: err instanceof Error ? err.message : "Shiprocket request failed" } },
    ).catch(() => {});
    return null;
  }
}

/** The one entry point every consumer (today: the product-page widget;
    future: cart, checkout extension, GoKwik) should call. */
export async function calculateETA(shop: string, pincode: string): Promise<ETAResult> {
  const settings = await PincodeSettings.findOne({ shopId: shop });
  if (!settings || !settings.enabled) {
    return { deliverable: true, cod: true, minDays: 3, maxDays: 7, state: "", source: "manual" };
  }

  const mode = settings.etaMode === "shiprocket" ? "shiprocket" : "manual";
  const key = cacheKey(shop, pincode, mode);
  const cached = serviceabilityCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.result;

  let result: ETAResult;
  if (mode === "shiprocket") {
    result = (await calculateShiprocketETA(settings, pincode)) || calculateManualETA(settings, pincode);
  } else {
    result = calculateManualETA(settings, pincode);
  }

  if (Math.random() < 0.02) sweepCache(); // opportunistic, matches the rate-limiter's own sweep style
  serviceabilityCache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS });
  return result;
}

interface MinimalAdminAPI {
  graphql: (query: string) => Promise<{ json: () => Promise<{ data?: Record<string, unknown> }> }>;
}

/** Fetches the shop's own configured IANA timezone via the Admin API —
    never the server's or a browser's — and persists it once. Cheap enough
    (one field on the Shop object) to just call every time rather than
    caching separately; callers only invoke this from the admin "Test
    Connection" action, not per storefront request. */
async function syncShopTimezone(shop: string, admin: MinimalAdminAPI): Promise<void> {
  try {
    const response = await admin.graphql(`#graphql
      query { shop { ianaTimezone } }`);
    const result = await response.json();
    const tz = (result.data?.shop as any)?.ianaTimezone;
    if (tz) {
      await PincodeSettings.updateOne({ shopId: shop }, { $set: { shopTimezone: tz } });
    }
  } catch {
    // Non-fatal — handling-day math falls back to UTC if this never succeeds.
  }
}

/** Used by the admin "Test Connection" button — attempts a fresh Shiprocket
    login with whatever credentials are currently saved for this shop,
    updates the connection status fields, and (on success) syncs the shop's
    timezone for handling-day math. Never throws. */
export async function testShiprocketConnection(
  shop: string,
  admin: MinimalAdminAPI,
): Promise<{ success: boolean; message: string }> {
  const settings = await PincodeSettings.findOne({ shopId: shop });
  if (!settings) return { success: false, message: "Settings not found." };
  if (!settings.shiprocketEmail || !settings.shiprocketPasswordEncrypted) {
    return { success: false, message: "Enter a Shiprocket email and password first." };
  }

  try {
    // Force a fresh login rather than reusing any cached token, so "Test
    // Connection" always reflects the credentials on file right now.
    const password = decryptShiprocketSecret(settings.shiprocketPasswordEncrypted);
    const token = await shiprocketLogin(settings.shiprocketEmail, password);

    await PincodeSettings.updateOne(
      { shopId: shop },
      {
        $set: {
          shiprocketConnected: true,
          shiprocketTokenEncrypted: encryptShiprocketSecret(token),
          shiprocketTokenExpiresAt: new Date(Date.now() + TOKEN_LIFETIME_MS),
          shiprocketLastError: "",
        },
      },
    );
    await syncShopTimezone(shop, admin);
    return { success: true, message: "Connected to Shiprocket." };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not connect to Shiprocket.";
    await PincodeSettings.updateOne(
      { shopId: shop },
      { $set: { shiprocketConnected: false, shiprocketLastError: message } },
    );
    return { success: false, message };
  }
}
