import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { connectDB } from "../db.server";
import { handleCallOutcome } from "../.server/services/voice-agent.service";

/**
 * Webhook endpoint for Sarvam AI call outcome callbacks.
 * POST /api/voice-webhook
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  await connectDB();

  try {
    const payload = await request.json();

    const callId = payload.call_id || payload.id || "";
    const outcome = payload.outcome || payload.call_outcome || payload.status || "unknown";
    const duration = payload.duration || 0;
    const transcript = payload.transcript || "";
    const recordingUrl = payload.recording_url || "";

    if (!callId) {
      return json({ error: "call_id required" }, { status: 400 });
    }

    await handleCallOutcome(callId, outcome, duration, transcript, recordingUrl);

    return json({ success: true });
  } catch (error) {
    console.error("Voice webhook error:", error);
    return json({ error: "Internal error" }, { status: 500 });
  }
};

// Also handle GET for verification/health check
export const loader = async () => {
  return json({ status: "ok", service: "voice-webhook" });
};
