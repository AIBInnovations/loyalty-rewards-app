/**
 * ElevenLabs Conversational AI API Integration
 * Handles agent management and outbound call triggering.
 * Docs: https://elevenlabs.io/docs/conversational-ai
 */

const ELEVENLABS_BASE_URL = "https://api.elevenlabs.io/v1";

interface ElevenLabsCallContext {
  customer_name: string;
  product_name: string;
  cart_total: string;
  bonus_points: number;
  discount_value: string;
  checkout_url: string;
  brand_name: string;
}

interface ElevenLabsCallResult {
  callId: string;
  status: string;
}

/**
 * Fetch the first phone number ID linked to the ElevenLabs account.
 * Used as agent_phone_number_id for outbound Twilio calls.
 */
async function getAgentPhoneNumberId(apiKey: string): Promise<string> {
  const response = await fetch(
    `${ELEVENLABS_BASE_URL}/convai/phone-numbers`,
    { headers: { "xi-api-key": apiKey } },
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch ElevenLabs phone numbers: ${response.status}`);
  }

  const data = await response.json();
  // data may be { phone_numbers: [...] } or an array directly
  const numbers: any[] = Array.isArray(data) ? data : (data.phone_numbers || []);

  if (!numbers.length) {
    throw new Error("No phone numbers configured in ElevenLabs. Add a Twilio number under Deploy → Phone Numbers.");
  }

  return numbers[0].phone_number_id || numbers[0].id;
}

/**
 * Trigger an outbound call via ElevenLabs Conversational AI (Twilio).
 * Endpoint: POST /v1/convai/twilio/outbound-call
 */
export async function triggerElevenLabsCall(
  apiKey: string,
  agentId: string,
  phoneNumber: string,
  context: ElevenLabsCallContext,
): Promise<ElevenLabsCallResult> {
  // Ensure phone has +91 prefix
  let phone = phoneNumber.replace(/\s|-/g, "");
  if (!phone.startsWith("+")) {
    phone = phone.startsWith("91") ? `+${phone}` : `+91${phone}`;
  }

  // Get the phone number ID linked in ElevenLabs
  const agentPhoneNumberId = await getAgentPhoneNumberId(apiKey);

  const response = await fetch(
    `${ELEVENLABS_BASE_URL}/convai/twilio/outbound-call`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": apiKey,
      },
      body: JSON.stringify({
        agent_id: agentId,
        agent_phone_number_id: agentPhoneNumberId,
        to_number: phone,
        conversation_initiation_client_data: {
          dynamic_variables: {
            customer_name: context.customer_name,
            product_name: context.product_name,
            cart_total: context.cart_total,
            bonus_points: String(context.bonus_points),
            discount_value: context.discount_value,
            checkout_url: context.checkout_url,
            brand_name: context.brand_name,
          },
        },
      }),
    },
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`ElevenLabs API error (${response.status}): ${error}`);
  }

  const result = await response.json();
  return {
    callId: result.conversation_id || result.call_id || result.id || "",
    status: result.status || "initiated",
  };
}

/**
 * Get conversation/call status from ElevenLabs.
 */
export async function getElevenLabsCallStatus(
  apiKey: string,
  conversationId: string,
): Promise<{
  status: string;
  duration: number;
  outcome: string;
  transcript: string;
  recordingUrl: string;
}> {
  const response = await fetch(
    `${ELEVENLABS_BASE_URL}/convai/conversations/${conversationId}`,
    {
      headers: { "xi-api-key": apiKey },
    },
  );

  if (!response.ok) {
    throw new Error(`ElevenLabs status check failed: ${response.status}`);
  }

  const data = await response.json();

  // Extract transcript from conversation turns
  let transcript = "";
  if (data.transcript && Array.isArray(data.transcript)) {
    transcript = data.transcript
      .map((t: any) => `${t.role}: ${t.message}`)
      .join("\n");
  }

  return {
    status: data.status || "unknown",
    duration: data.metadata?.call_duration_secs || data.duration || 0,
    outcome: data.analysis?.call_successful ? "interested" : "declined",
    transcript,
    recordingUrl: data.recording_url || "",
  };
}

/**
 * Update an ElevenLabs agent's system prompt and first message.
 */
export async function updateElevenLabsAgent(
  apiKey: string,
  agentId: string,
  config: {
    systemPrompt: string;
    firstMessage: string;
    language?: string;
  },
): Promise<void> {
  const response = await fetch(
    `${ELEVENLABS_BASE_URL}/convai/agents/${agentId}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": apiKey,
      },
      body: JSON.stringify({
        conversation_config: {
          agent: {
            prompt: {
              prompt: config.systemPrompt,
            },
            first_message: config.firstMessage,
            language: config.language || "en",
          },
        },
      }),
    },
  );

  if (!response.ok) {
    const error = await response.text();
    console.error(`ElevenLabs agent update failed: ${error}`);
  }
}

/**
 * Generate the system prompt with cart-specific context.
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
  const prompt = greeting
    .replace(/\{name\}/g, cart.customerName)
    .replace(/\{brand\}/g, brandName)
    .replace(/\{product\}/g, cart.productName)
    .replace(/\{amount\}/g, `₹${(cart.cartTotal / 100).toFixed(0)}`)
    .replace(/\{points\}/g, String(incentive.bonusPoints));

  return `You are a friendly shopping assistant for ${brandName}.
You're calling ${cart.customerName} about items left in their shopping cart.

Cart: ${cart.productName} worth ₹${(cart.cartTotal / 100).toFixed(0)}.

Your opening line: "${prompt}"

Your goals:
1. Greet warmly and mention the specific product
${incentive.offerDiscount ? `2. Offer ${incentive.discountValue} discount as incentive` : ""}
${incentive.offerLoyaltyPoints ? `${incentive.offerDiscount ? "3" : "2"}. Mention ${incentive.bonusPoints} bonus loyalty points they'll earn` : ""}
- If interested, say you'll send the checkout link to their WhatsApp
- If not interested, thank them politely and end

Rules:
- Be conversational and warm, not scripted
- Keep the call under 2 minutes
- Never be pushy — one "no" means end politely
- If they say they already purchased, congratulate them and end
- Do NOT share any payment or personal data on the call`;
}
