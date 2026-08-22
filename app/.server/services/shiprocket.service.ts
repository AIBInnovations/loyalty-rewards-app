// Shiprocket External API v1 client — https://apiv2.shiprocket.in/v1/external
//
// Credentials/tokens are per-shop (see IPincodeSettings.shiprocket*), never
// shared across merchants. This module never touches the storefront
// directly — it's only ever called from server-side code (eta-engine, the
// admin "Test Connection" action).

import { encryptSecret, decryptSecret } from "../crypto.server";
import type { IPincodeSettings } from "../models/pincode-settings.model";

const BASE_URL = "https://apiv2.shiprocket.in/v1/external";

// Shiprocket tokens are valid ~10 days; refresh a little early so a request
// never races an expiry mid-flight.
const TOKEN_LIFETIME_MS = 9 * 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 6000;

function withTimeout(ms: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

export class ShiprocketError extends Error {}

/** Logs in with the merchant's own Shiprocket credentials and returns a
    fresh bearer token. Throws ShiprocketError with a message safe to show
    in the admin UI (no credential values ever included). */
export async function shiprocketLogin(email: string, password: string): Promise<string> {
  const { signal, cancel } = withTimeout(REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      signal,
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.token) {
      throw new ShiprocketError(
        body?.message || `Shiprocket login failed (${res.status}). Check the email and password.`,
      );
    }
    return body.token as string;
  } catch (err) {
    if (err instanceof ShiprocketError) throw err;
    throw new ShiprocketError("Could not reach Shiprocket. Please try again.");
  } finally {
    cancel();
  }
}

/** Returns a valid bearer token for this shop's Shiprocket account,
    re-authenticating only when the cached one is missing/expired. Persists
    the refreshed token back onto the settings doc (caller is responsible
    for settings.save() after, matching the rest of this app's convention
    of one findOneAndUpdate per request rather than a save-inside-a-helper). */
export async function getShiprocketToken(
  settings: Pick<IPincodeSettings, "shiprocketEmail" | "shiprocketPasswordEncrypted" | "shiprocketTokenEncrypted" | "shiprocketTokenExpiresAt">,
): Promise<{ token: string; refreshed: boolean }> {
  const now = Date.now();
  if (
    settings.shiprocketTokenEncrypted &&
    settings.shiprocketTokenExpiresAt &&
    new Date(settings.shiprocketTokenExpiresAt).getTime() > now
  ) {
    return { token: decryptSecret(settings.shiprocketTokenEncrypted), refreshed: false };
  }

  if (!settings.shiprocketEmail || !settings.shiprocketPasswordEncrypted) {
    throw new ShiprocketError("Shiprocket is not connected for this store.");
  }
  const password = decryptSecret(settings.shiprocketPasswordEncrypted);
  const token = await shiprocketLogin(settings.shiprocketEmail, password);
  return { token, refreshed: true };
}

export interface ServiceabilityResult {
  serviceable: boolean;
  codAvailable: boolean;
  /** Estimated transit days from the fastest available courier, if Shiprocket returned one. */
  etaDays: number | null;
}

/** Checks courier serviceability/ETA for one pickup->delivery pincode pair.
    Returns a normalized result; never throws for "not serviceable" (that's
    a valid, expected response) — only for real connection/auth failures. */
export async function checkServiceability(
  token: string,
  params: { pickupPincode: string; deliveryPincode: string; cod: boolean; weightKg?: number },
): Promise<ServiceabilityResult> {
  const qs = new URLSearchParams({
    pickup_postcode: params.pickupPincode,
    delivery_postcode: params.deliveryPincode,
    weight: String(params.weightKg && params.weightKg > 0 ? params.weightKg : 0.5),
    cod: params.cod ? "1" : "0",
  });

  const { signal, cancel } = withTimeout(REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}/courier/serviceability/?${qs.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal,
    });
    const body = await res.json().catch(() => null);

    if (res.status === 401 || res.status === 403) {
      throw new ShiprocketError("Shiprocket rejected the stored session — reconnect the account.");
    }
    if (!res.ok || !body) {
      throw new ShiprocketError(`Shiprocket serviceability check failed (${res.status}).`);
    }

    const couriers: any[] = body?.data?.available_courier_companies || [];
    if (!couriers.length) {
      return { serviceable: false, codAvailable: false, etaDays: null };
    }

    const codAvailable = couriers.some((c) => Number(c?.cod) === 1 || c?.cod === true);
    // etd comes back as a free-text field, typically "N days" or a date —
    // pull the leading integer if present rather than trusting a specific format.
    let etaDays: number | null = null;
    for (const c of couriers) {
      const match = String(c?.etd || c?.estimated_delivery_days || "").match(/(\d+)/);
      if (match) {
        const days = Number(match[1]);
        if (etaDays === null || days < etaDays) etaDays = days;
      }
    }

    return { serviceable: true, codAvailable, etaDays };
  } catch (err) {
    if (err instanceof ShiprocketError) throw err;
    throw new ShiprocketError("Could not reach Shiprocket for serviceability. Please try again.");
  } finally {
    cancel();
  }
}

export { encryptSecret as encryptShiprocketSecret, decryptSecret as decryptShiprocketSecret, TOKEN_LIFETIME_MS };
