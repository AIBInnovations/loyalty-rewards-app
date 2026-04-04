/**
 * Sarvam AI (Samvaad) API Integration
 * Handles voice agent creation and outbound call triggering.
 */

const SARVAM_BASE_URL = "https://api.sarvam.ai";

interface SarvamCallContext {
  customer_name: string;
  product_name: string;
  cart_total: string;
  bonus_points: number;
  discount_value: string;
  checkout_url: string;
  brand_name: string;
}

interface SarvamCallResult {
  callId: string;
  status: string;
}

/**
 * Trigger an outbound call via Sarvam AI.
 */
export async function triggerSarvamCall(
  apiKey: string,
  agentId: string,
  phoneNumber: string,
  context: SarvamCallContext,
): Promise<SarvamCallResult> {
  // Ensure phone has +91 prefix
  let phone = phoneNumber.replace(/\s|-/g, "");
  if (!phone.startsWith("+")) {
    phone = phone.startsWith("91") ? `+${phone}` : `+91${phone}`;
  }

  const response = await fetch(`${SARVAM_BASE_URL}/v1/calls/outbound`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      agent_id: agentId,
      phone_number: phone,
      context,
      max_duration: 120, // 2 minutes max
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Sarvam API error (${response.status}): ${error}`);
  }

  const result = await response.json();
  return {
    callId: result.call_id || result.id || "",
    status: result.status || "initiated",
  };
}

/**
 * Get call status from Sarvam AI.
 */
export async function getSarvamCallStatus(
  apiKey: string,
  callId: string,
): Promise<{
  status: string;
  duration: number;
  outcome: string;
  transcript: string;
  recordingUrl: string;
}> {
  const response = await fetch(`${SARVAM_BASE_URL}/v1/calls/${callId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!response.ok) {
    throw new Error(`Sarvam status check failed: ${response.status}`);
  }

  const data = await response.json();
  return {
    status: data.status || "unknown",
    duration: data.duration || 0,
    outcome: data.outcome || data.call_outcome || "unknown",
    transcript: data.transcript || "",
    recordingUrl: data.recording_url || "",
  };
}

/**
 * Create or update a Sarvam AI agent for cart recovery.
 */
export async function createSarvamAgent(
  apiKey: string,
  agentConfig: {
    name: string;
    language: string;
    prompt: string;
    webhookUrl: string;
  },
): Promise<string> {
  const languageMap: Record<string, string> = {
    en: "en-IN",
    hi: "hi-IN",
    hinglish: "hi-en",
  };

  const response = await fetch(`${SARVAM_BASE_URL}/v1/agents`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      name: agentConfig.name,
      language: languageMap[agentConfig.language] || "hi-en",
      prompt: agentConfig.prompt,
      voice: "meera", // Default female Hindi voice
      tools: [
        {
          type: "webhook",
          url: agentConfig.webhookUrl,
          events: ["call.completed", "call.failed"],
        },
      ],
      settings: {
        max_call_duration: 120,
        interruption_handling: true,
        end_call_phrases: ["no thanks", "not interested", "stop calling"],
      },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Sarvam agent creation failed: ${error}`);
  }

  const data = await response.json();
  return data.agent_id || data.id || "";
}

/**
 * Generate the call prompt with cart-specific context.
 */
export function generateCallPrompt(
  greeting: string,
  cart: {
    customerName: string;
    productName: string;
    cartTotal: number;
    currency: string;
  },
  incentive: {
    discountValue: string;
    bonusPoints: number;
    offerDiscount: boolean;
    offerLoyaltyPoints: boolean;
  },
  brandName: string,
): string {
  let prompt = greeting
    .replace("{name}", cart.customerName)
    .replace("{brand}", brandName)
    .replace("{product}", cart.productName)
    .replace("{amount}", `₹${(cart.cartTotal / 100).toFixed(0)}`)
    .replace("{points}", String(incentive.bonusPoints));

  // Build system prompt
  const systemPrompt = `You are a friendly shopping assistant for ${brandName}.
You're calling ${cart.customerName} about items left in their shopping cart.

Cart: ${cart.productName} worth ₹${(cart.cartTotal / 100).toFixed(0)}.

Your goals:
1. Greet warmly: "${prompt}"
2. Mention the specific product they were looking at
${incentive.offerDiscount ? `3. Offer ${incentive.discountValue} discount as incentive` : ""}
${incentive.offerLoyaltyPoints ? `${incentive.offerDiscount ? "4" : "3"}. Mention ${incentive.bonusPoints} bonus loyalty points they'll earn` : ""}
- If interested, offer to send checkout link via WhatsApp
- If not interested, thank them politely and end

Rules:
- Be conversational and warm, not scripted
- Keep the call under 2 minutes
- Never be pushy — one "no" means end politely
- If they say they already purchased, congratulate and end
- Do NOT share any payment or personal data on the call`;

  return systemPrompt;
}
