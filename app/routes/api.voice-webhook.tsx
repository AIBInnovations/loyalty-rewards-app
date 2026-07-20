import type { ActionFunctionArgs } from "@remix-run/node";
import { createHmac, timingSafeEqual } from "crypto";
import { connectDB } from "../db.server";
import { handleCallOutcome } from "../.server/services/voice-agent.service";

/**
 * Verify ElevenLabs webhook HMAC signature.
 * Header format: "ElevenLabs-Signature: t=<timestamp>,v0=<hex_signature>"
 * Signed string: "<timestamp>.<raw_body>"
 */
function verifyElevenLabsSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!signatureHeader) return false;

  const parts = Object.fromEntries(
    signatureHeader.split(",").map((p) => p.split("=")),
  );
  const timestamp = parts["t"];
  const signature = parts["v0"];

  if (!timestamp || !signature) return false;

  // Reject stale webhooks (older than 5 minutes)
  const age = Date.now() - Number(timestamp) * 1000;
  if (age > 5 * 60 * 1000) return false;

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

  // Constant-time compare. timingSafeEqual throws on length mismatch, so
  // check lengths first rather than letting a malformed header 500.
  const expectedBuf = Buffer.from(expected, "utf8");
  const actualBuf = Buffer.from(signature, "utf8");
  if (expectedBuf.length !== actualBuf.length) return false;

  return timingSafeEqual(expectedBuf, actualBuf);
}

/**
 * Webhook endpoint for ElevenLabs Conversational AI call outcome callbacks.
 * POST /api/voice-webhook
 *
 * ElevenLabs sends: { type, conversation_id, agent_id, status, transcript, analysis, metadata }
 * analysis.call_successful: "success" | "failure" | "unknown"
 * metadata.call_duration_secs: number
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const rawBody = await request.text();
  const webhookSecret = process.env.ELEVENLABS_WEBHOOK_SECRET || "";

  // Fail closed. A missing secret must never mean "skip verification" — that
  // turns this into an unauthenticated write endpoint against abandoned carts.
  if (!webhookSecret) {
    console.error(
      "ELEVENLABS_WEBHOOK_SECRET is not configured; rejecting voice webhook.",
    );
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const signatureHeader = request.headers.get("ElevenLabs-Signature");
  if (!verifyElevenLabsSignature(rawBody, signatureHeader, webhookSecret)) {
    return new Response(JSON.stringify({ error: "Invalid signature" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  await connectDB();

  try {
    const payload = JSON.parse(rawBody);

    // ElevenLabs uses conversation_id
    const callId =
      payload.conversation_id ||
      payload.call_id ||
      payload.id ||
      "";

    if (!callId) {
      return new Response(JSON.stringify({ error: "conversation_id required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Only process post-call events
    const eventType = payload.type || "";
    if (eventType && !["post_call_transcription", "conversation.ended", "completed"].includes(eventType)) {
      return new Response(JSON.stringify({ received: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Derive outcome from ElevenLabs analysis
    const callSuccessful = payload.analysis?.call_successful;
    let outcome: string;
    if (callSuccessful === "success" || callSuccessful === true) {
      outcome = "interested";
    } else if (callSuccessful === "failure" || callSuccessful === false) {
      outcome = "declined";
    } else {
      const rawOutcome = payload.outcome || payload.call_outcome || payload.status || "unknown";
      outcome = rawOutcome === "done" || rawOutcome === "completed" ? "called" : rawOutcome;
    }

    const duration =
      payload.metadata?.call_duration_secs ||
      payload.duration ||
      0;

    let transcript = "";
    if (Array.isArray(payload.transcript)) {
      transcript = payload.transcript
        .map((t: any) => `${t.role}: ${t.message}`)
        .join("\n");
    } else if (typeof payload.transcript === "string") {
      transcript = payload.transcript;
    }

    const recordingUrl = payload.recording_url || payload.audio_url || "";

    await handleCallOutcome(callId, outcome, duration, transcript, recordingUrl);

    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Voice webhook error:", error);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const loader = async () => {
  return new Response(JSON.stringify({ status: "ok", service: "voice-webhook" }), {
    headers: { "Content-Type": "application/json" },
  });
};
