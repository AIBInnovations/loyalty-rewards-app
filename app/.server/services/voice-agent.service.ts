import cron from "node-cron";
import { AbandonedCart } from "../models/abandoned-cart.model";
import { VoiceAgentSettings } from "../models/voice-agent-settings.model";
import { connectDB } from "../../db.server";
import { triggerElevenLabsCall } from "./elevenlabs.service";
import { pollAllShopsForAbandonedCarts } from "./abandoned-cart-poller.service";

const LOG = {
  info: (msg: string) => console.log(`[VoiceAgent] ${msg}`),
  warn: (msg: string) => console.warn(`[VoiceAgent] ⚠️  ${msg}`),
  error: (msg: string, err?: unknown) => console.error(`[VoiceAgent] ❌ ${msg}`, err || ""),
  skip: (cart: any, reason: string) => console.log(`[VoiceAgent] ⏭️  SKIP | ${cart.customerName} (${cart.customerPhone}) | checkout: ${cart.shopifyCheckoutId} | reason: ${reason}`),
  call: (msg: string) => console.log(`[VoiceAgent] 📞 ${msg}`),
};

/**
 * Initialize the voice agent background services.
 */
export function initVoiceAgentService(): void {
  LOG.info("Initializing Voice Agent service...");

  // Poll for abandoned carts every 2 minutes
  cron.schedule("*/2 * * * *", async () => {
    try {
      await connectDB();
      await pollAllShopsForAbandonedCarts();
    } catch (err) {
      LOG.error("Abandoned cart poll error:", err);
    }
  });

  // Process call queue every minute
  cron.schedule("* * * * *", async () => {
    try {
      await connectDB();
      await processCallQueue();
    } catch (err) {
      LOG.error("Call queue processing error:", err);
    }
  });

  // Expire old abandoned carts (hourly)
  cron.schedule("0 * * * *", async () => {
    try {
      await connectDB();
      await expireOldCarts();
    } catch (err) {
      LOG.error("Cart expiry error:", err);
    }
  });

  // Check recovery attribution (every 15 min)
  cron.schedule("*/15 * * * *", async () => {
    try {
      await connectDB();
      await checkRecoveryAttribution();
    } catch (err) {
      LOG.error("Recovery check error:", err);
    }
  });

  LOG.info("Voice Agent service initialized.");
}

/**
 * Process the call queue — find scheduled carts ready to call.
 */
async function processCallQueue(): Promise<void> {
  const now = new Date();

  const readyCarts = await AbandonedCart.find({
    status: "scheduled",
    callScheduledAt: { $lte: now },
    expiresAt: { $gt: now },
  }).limit(10);

  if (readyCarts.length > 0) {
    LOG.info(`Call queue: ${readyCarts.length} cart(s) ready to process`);
  }

  for (const cart of readyCarts) {
    LOG.info(`Processing cart | ${cart.customerName} (${cart.customerPhone}) | shop: ${cart.shopId} | total: ₹${(cart.cartTotal / 100).toFixed(0)} | checkout: ${cart.shopifyCheckoutId}`);
    try {
      await attemptCall(cart);
    } catch (err) {
      LOG.error(`Call attempt threw exception for ${cart.shopifyCheckoutId}:`, err);
      cart.status = "skipped";
      cart.skipReason = (err as Error).message;
      await cart.save();
    }
  }
}

/**
 * Attempt to make a voice call for an abandoned cart.
 */
async function attemptCall(cart: any): Promise<void> {
  LOG.call(`Attempting call → ${cart.customerName} (${cart.customerPhone}) | shop: ${cart.shopId}`);

  // Load settings (required for API keys)
  const settings = await VoiceAgentSettings.findOne({ shopId: cart.shopId });

  if (!settings || !settings.elevenLabsApiKey || !settings.elevenLabsAgentId) {
    LOG.error(`Cannot call — ElevenLabs API key or Agent ID missing for shop: ${cart.shopId}`);
    cart.status = "skipped";
    cart.skipReason = "ElevenLabs not configured";
    await cart.save();
    return;
  }

  LOG.info(`Settings loaded | apiKey: ${settings.elevenLabsApiKey.slice(0, 10)}... | agentId: ${settings.elevenLabsAgentId}`);

  if (!cart.customerPhone) {
    LOG.warn(`No phone number on checkout ${cart.shopifyCheckoutId} — cannot call`);
    cart.status = "skipped";
    cart.skipReason = "No phone number on checkout";
    await cart.save();
    return;
  }

  // Build call context
  const discountText = settings.offerDiscount
    ? settings.discountType === "percentage"
      ? `${settings.discountValue}% off`
      : `₹${settings.discountValue} off`
    : "";

  const mainProduct = cart.cartItems[0]?.title || "your selected items";
  const brandName = cart.shopId.replace(".myshopify.com", "");
  const cartAmountStr = `₹${(cart.cartTotal / 100).toFixed(0)}`;

  LOG.call(`All checks passed — triggering call | customer: ${cart.customerName} | product: ${mainProduct} | amount: ${cartAmountStr} | discount: ${discountText || "none"} | points: ${settings.bonusPoints}`);

  // Trigger call
  cart.status = "calling";
  cart.callMadeAt = new Date();
  await cart.save();

  try {
    const result = await triggerElevenLabsCall(
      settings.elevenLabsApiKey,
      settings.elevenLabsAgentId,
      cart.customerPhone,
      {
        customer_name: cart.customerName,
        product_name: mainProduct,
        cart_total: cartAmountStr,
        bonus_points: settings.bonusPoints,
        discount_value: discountText,
        checkout_url: cart.abandonedCheckoutUrl,
        brand_name: brandName,
      },
    );

    cart.callId = result.callId;
    cart.status = "called";
    await cart.save();

    await VoiceAgentSettings.findOneAndUpdate(
      { shopId: cart.shopId },
      { $inc: { totalCallsMade: 1 } },
    );

    LOG.call(`✅ Call initiated | ${cart.customerName} (${cart.customerPhone}) | Call ID: ${result.callId} | status: ${result.status}`);
  } catch (err) {
    const reason = `ElevenLabs API call failed: ${(err as Error).message}`;
    LOG.error(`Call failed for ${cart.customerPhone}: ${(err as Error).message}`);
    cart.status = "skipped";
    cart.skipReason = reason;
    await cart.save();
  }
}

/**
 * Expire abandoned carts older than 24 hours.
 */
async function expireOldCarts(): Promise<void> {
  const result = await AbandonedCart.updateMany(
    {
      status: { $in: ["detected", "scheduled"] },
      expiresAt: { $lt: new Date() },
    },
    { $set: { status: "expired" } },
  );

  if (result.modifiedCount > 0) {
    LOG.info(`Expired ${result.modifiedCount} old abandoned cart(s)`);
  }
}

/**
 * Check recovery attribution every 15 minutes.
 * Actual recovery marking is done reactively via orders/paid webhook.
 */
async function checkRecoveryAttribution(): Promise<void> {
  const calledCarts = await AbandonedCart.find({
    status: "called",
    callMadeAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
  }).limit(50);

  if (calledCarts.length > 0) {
    LOG.info(`Recovery check: ${calledCarts.length} called cart(s) awaiting order attribution`);
  }
}

/**
 * Handle call outcome from ElevenLabs webhook.
 */
export async function handleCallOutcome(
  callId: string,
  outcome: string,
  duration: number,
  transcript: string,
  recordingUrl: string,
): Promise<void> {
  LOG.call(`Webhook received | callId: ${callId} | outcome: ${outcome} | duration: ${duration}s`);

  const cart = await AbandonedCart.findOne({ callId });
  if (!cart) {
    LOG.warn(`No abandoned cart found for callId: ${callId} — may have already been processed`);
    return;
  }

  LOG.call(`Matched cart | ${cart.customerName} (${cart.customerPhone}) | previous status: ${cart.status}`);

  cart.callOutcome = outcome;
  cart.callDuration = duration;
  cart.callTranscript = transcript;
  cart.callRecordingUrl = recordingUrl;

  switch (outcome) {
    case "interested":
    case "converted":
      cart.status = "called";
      LOG.call(`Customer interested — WhatsApp follow-up should be triggered`);
      break;
    case "declined":
    case "not_interested":
      cart.status = "declined";
      break;
    case "no_answer":
    case "voicemail":
    case "busy":
      cart.status = "no_answer";
      break;
    default:
      cart.status = "called";
  }

  await cart.save();
  LOG.call(`Outcome saved | ${cart.customerName} → ${cart.status} (${duration}s)`);
}
