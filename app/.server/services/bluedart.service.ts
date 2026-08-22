// Bluedart Transit Time API client.
//
// ⚠️ Lower confidence than shiprocket.service.ts / delhivery.service.ts —
// Bluedart's API access is typically provisioned per-account through their
// own developer portal, and the exact current endpoint/response shape is
// less publicly standardized than Shiprocket's or Delhivery's. This targets
// their commonly documented Transit Time endpoint and LoginID+LicenseKey
// auth pattern, but MUST be verified with the admin "Test Connection"
// button against a real Bluedart account before relying on it — do not
// assume it works from code review alone.

const REQUEST_TIMEOUT_MS = 6000;
const BASE_URL = "https://apigateway.bluedart.com/in/transportation/transit/v1";

function withTimeout(ms: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

export class BluedartError extends Error {}

export interface BluedartServiceabilityResult {
  serviceable: boolean;
  etaDays: number | null;
}

/** Checks transit time between two pincodes. Parses defensively across a
    few plausible field-name variants since the exact response shape isn't
    fully certain — any shape mismatch or error resolves to "not
    serviceable" rather than throwing, which is safe (the ETA engine's
    fallback-to-manual net catches it either way) but means a genuinely
    working account could still show as unserviceable until this is
    verified against real Bluedart responses. */
export async function checkBluedartServiceability(
  loginId: string,
  licenseKey: string,
  params: { pickupPincode: string; deliveryPincode: string },
): Promise<BluedartServiceabilityResult> {
  const qs = new URLSearchParams({
    LoginID: loginId,
    LicenseKey: licenseKey,
    pinCodeFrom: params.pickupPincode,
    pinCodeTo: params.deliveryPincode,
    Product: "E", // Express — Bluedart's most common domestic product code
  });

  const { signal, cancel } = withTimeout(REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}/GetDomesticTransitTimeForPinCodeAndProduct?${qs.toString()}`, { signal });
    const body = await res.json().catch(() => null);

    if (res.status === 401 || res.status === 403) {
      throw new BluedartError("Bluedart rejected the stored LoginID/LicenseKey — reconnect the account.");
    }
    if (!res.ok || !body) {
      throw new BluedartError(`Bluedart transit time check failed (${res.status}).`);
    }

    // Field names are a best guess pending real-account verification —
    // check the few most plausible variants rather than committing to one.
    const raw = body?.TransitDays ?? body?.NumberOfDays ?? body?.ExpectedTransitDays ?? body?.transitTime;
    const etaDays = raw !== undefined && raw !== null ? Number(raw) : null;

    if (etaDays === null || !Number.isFinite(etaDays)) {
      return { serviceable: false, etaDays: null };
    }
    return { serviceable: true, etaDays };
  } catch (err) {
    if (err instanceof BluedartError) throw err;
    throw new BluedartError("Could not reach Bluedart. Please try again.");
  } finally {
    cancel();
  }
}

export async function testBluedartConnection(
  loginId: string,
  licenseKey: string,
  samplePickupPincode: string,
): Promise<void> {
  await checkBluedartServiceability(loginId, licenseKey, {
    pickupPincode: samplePickupPincode || "110001",
    deliveryPincode: "400001",
  });
}
