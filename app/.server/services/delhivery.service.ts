// Delhivery One API client — https://track.delhivery.com
//
// Auth is a single static API token (Authorization: Token <token>), unlike
// Shiprocket's email/password login — no session/expiry to manage.

const REQUEST_TIMEOUT_MS = 6000;

function withTimeout(ms: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

export class DelhiveryError extends Error {}

export interface DelhiveryServiceabilityResult {
  serviceable: boolean;
  codAvailable: boolean;
}

/** Delhivery's public pincode-serviceability endpoint confirms whether a
    pincode is served and whether COD/prepaid are available there — it does
    NOT return an estimated transit-day count (that needs Delhivery's
    shipment/invoice flow, not a simple lookup), so the ETA engine uses this
    for deliverable/cod only and falls back to the manual day-estimate
    fields for the actual day count in Delhivery mode. */
export async function checkDelhiveryServiceability(
  apiToken: string,
  pincode: string,
): Promise<DelhiveryServiceabilityResult> {
  const { signal, cancel } = withTimeout(REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://track.delhivery.com/c/api/pin-codes/json/?filter_codes=${encodeURIComponent(pincode)}`,
      { headers: { Authorization: `Token ${apiToken}` }, signal },
    );
    const body = await res.json().catch(() => null);

    if (res.status === 401 || res.status === 403) {
      throw new DelhiveryError("Delhivery rejected the stored API token — reconnect the account.");
    }
    if (!res.ok || !body) {
      throw new DelhiveryError(`Delhivery serviceability check failed (${res.status}).`);
    }

    const codes: any[] = body?.delivery_codes || [];
    if (!codes.length) {
      return { serviceable: false, codAvailable: false };
    }

    const pc = codes[0]?.postal_code;
    const codAvailable = String(pc?.cod || "").toUpperCase() === "Y";
    return { serviceable: true, codAvailable };
  } catch (err) {
    if (err instanceof DelhiveryError) throw err;
    throw new DelhiveryError("Could not reach Delhivery. Please try again.");
  } finally {
    cancel();
  }
}

/** "Test Connection" for Delhivery — the pincode-serviceability endpoint
    doubles as a lightweight auth check: an invalid token gets a 401/403
    (see above) rather than a 200 with results. */
export async function testDelhiveryToken(apiToken: string, sampleServiceablePincode = "110001"): Promise<void> {
  await checkDelhiveryServiceability(apiToken, sampleServiceablePincode);
}
