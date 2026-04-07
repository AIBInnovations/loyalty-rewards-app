import cron from "node-cron";
import { AbandonedCart } from "../models/abandoned-cart.model";
import { VoiceAgentSettings } from "../models/voice-agent-settings.model";
import { connectDB } from "../../db.server";
import { triggerElevenLabsCall } from "./elevenlabs.service";
import { pollAllShopsForAbandonedCarts } from "./abandoned-cart-poller.service";

/**
 * Initialize the voice agent background services.
 */
export function initVoiceAgentService(): void {
  console.log("Initializing Voice Agent service...");

  // Poll for abandoned carts every 2 minutes
  cron.schedule("*/2 * * * *", async () => {
    try {
      await connectDB();
      await pollAllShopsForAbandonedCarts();
    } catch (err) {
      console.error("Abandoned cart poll error:", err);
    }
  });

  // Process call queue every minute
  cron.schedule("* * * * *", async () => {
    try {
      await connectDB();
      await processCallQueue();
    } catch (err) {
      console.error("Call queue processing error:", err);
    }
  });

  // Expire old abandoned carts (hourly)
  cron.schedule("0 * * * *", async () => {
    try {
      await connectDB();
      await expireOldCarts();
    } catch (err) {
      console.error("Cart expiry error:", err);
    }
  });

  // Check recovery attribution (every 15 min)
  cron.schedule("*/15 * * * *", async () => {
    try {
      await connectDB();
      await checkRecoveryAttribution();
    } catch (err) {
      console.error("Recovery check error:", err);
    }
  });

  console.log("Voice Agent service initialized.");
}

/**
 * Process the call queue — find scheduled carts ready to call.
 */
async function processCallQueue(): Promise<void> {
  const now = new Date();

  // Find carts scheduled for calling that are past their delay
  const readyCarts = await AbandonedCart.find({
    status: "scheduled",
    callScheduledAt: { $lte: now },
    expiresAt: { $gt: now },
  }).limit(10); // Process 10 at a time

  for (const cart of readyCarts) {
    try {
      await attemptCall(cart);
    } catch (err) {
      console.error(`Call attempt failed for ${cart.shopifyCheckoutId}:`, err);
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
  const settings = await VoiceAgentSettings.findOne({
    shopId: cart.shopId,
    enabled: true,
  });

  if (!settings || !settings.elevenLabsApiKey) {
    cart.status = "skipped";
    cart.skipReason = "Voice agent not configured";
    await cart.save();
    return;
  }

  // Check daily call limit
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const callsToday = await AbandonedCart.countDocuments({
    shopId: cart.shopId,
    callMadeAt: { $gte: today },
    status: { $in: ["calling", "called", "recovered", "declined", "no_answer"] },
  });

  if (callsToday >= settings.maxCallsPerDay) {
    cart.status = "skipped";
    cart.skipReason = "Daily call limit reached";
    await cart.save();
    return;
  }

  // Check call window (9 AM - 9 PM IST)
  const istHour = new Date().toLocaleString("en-US", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    hour12: false,
  });
  const currentHour = parseInt(istHour);

  if (currentHour < settings.callWindowStart || currentHour >= settings.callWindowEnd) {
    // Reschedule to next valid window
    const nextWindow = new Date();
    if (currentHour >= settings.callWindowEnd) {
      nextWindow.setDate(nextWindow.getDate() + 1);
    }
    nextWindow.setHours(settings.callWindowStart, 0, 0, 0);
    cart.callScheduledAt = nextWindow;
    await cart.save();
    return;
  }

  // Check minimum cart value
  if (cart.cartTotal < settings.minCartValue * 100) {
    cart.status = "skipped";
    cart.skipReason = `Cart value ₹${(cart.cartTotal / 100).toFixed(0)} below minimum ₹${settings.minCartValue}`;
    await cart.save();
    return;
  }

  // Check phone number
  if (!cart.customerPhone) {
    cart.status = "skipped";
    cart.skipReason = "No phone number";
    await cart.save();
    return;
  }

  // Generate discount text
  const discountText = settings.offerDiscount
    ? settings.discountType === "percentage"
      ? `${settings.discountValue}% off`
      : `₹${settings.discountValue} off`
    : "";

  // Get the main product name
  const mainProduct = cart.cartItems[0]?.title || "your selected items";

  const brandName = cart.shopId.replace(".myshopify.com", "");
  const cartAmountStr = `₹${(cart.cartTotal / 100).toFixed(0)}`;

  // Trigger the call
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

    // Update analytics
    await VoiceAgentSettings.findOneAndUpdate(
      { shopId: cart.shopId },
      { $inc: { totalCallsMade: 1 } },
    );

    console.log(
      `Voice call made: ${cart.customerName} (${cart.customerPhone}) - Call ID: ${result.callId}`,
    );
  } catch (err) {
    cart.status = "skipped";
    cart.skipReason = `Call failed: ${(err as Error).message}`;
    await cart.save();
    console.error(`Voice call failed for ${cart.customerPhone}:`, err);
  }
}

/**
 * Expire abandoned carts older than 24 hours that haven't been processed.
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
    console.log(`Expired ${result.modifiedCount} old abandoned carts`);
  }
}

/**
 * Check if any called carts have been recovered (order placed).
 * This runs every 15 minutes and checks against Shopify orders.
 */
async function checkRecoveryAttribution(): Promise<void> {
  // Find carts that were called but not yet marked as recovered
  const calledCarts = await AbandonedCart.find({
    status: "called",
    callMadeAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
  }).limit(50);

  // For each, check if the customer placed an order
  // This is a simplified check — in production, cross-reference with orders/paid webhook
  for (const cart of calledCarts) {
    if (!cart.customerEmail && !cart.customerId) continue;

    // Check orders collection for matching customer + recent order
    // The webhook handler (handleOrderPaid) would have already created the order
    // We just need to check if there's a matching order after the call
    // For now, this is handled reactively via the orders/paid webhook
  }
}

/**
 * Handle call outcome from Sarvam webhook.
 */
export async function handleCallOutcome(
  callId: string,
  outcome: string,
  duration: number,
  transcript: string,
  recordingUrl: string,
): Promise<void> {
  const cart = await AbandonedCart.findOne({ callId });
  if (!cart) {
    console.warn(`No abandoned cart found for call ${callId}`);
    return;
  }

  cart.callOutcome = outcome;
  cart.callDuration = duration;
  cart.callTranscript = transcript;
  cart.callRecordingUrl = recordingUrl;

  switch (outcome) {
    case "interested":
    case "converted":
      cart.status = "called";
      // WhatsApp follow-up would be triggered here
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
  console.log(
    `Call outcome for ${cart.customerName}: ${outcome} (${duration}s)`,
  );
}
