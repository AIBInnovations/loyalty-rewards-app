import { CodSettings } from "../models/cod-settings.model";

const LOG = {
  info:  (msg: string) => console.log(`[COD-WhatsApp] ${msg}`),
  error: (msg: string, err?: unknown) => console.error(`[COD-WhatsApp] ❌ ${msg}`, err || ""),
};

/**
 * Send a WhatsApp confirmation message for a COD order via Meta Cloud API.
 */
export async function sendCodConfirmation(
  shop: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const settings = await CodSettings.findOne({ shopId: shop, enabled: true });
  if (!settings) return;
  if (!settings.whatsappToken || !settings.whatsappPhoneId) {
    LOG.info(`COD WhatsApp not configured for ${shop} — skipping`);
    return;
  }

  // Only handle COD orders
  const gateway = String((payload.payment_gateway as string) || "").toLowerCase();
  if (!gateway.includes("cod") && !gateway.includes("cash")) {
    LOG.info(`Order ${payload.order_number} is not COD (gateway: ${gateway}) — skipping`);
    return;
  }

  const customer   = payload.customer as Record<string, unknown> | undefined;
  const name       = String(customer?.first_name || "Customer");
  const phone      = String(
    (payload.phone as string) ||
    (customer?.phone as string) ||
    ((payload.shipping_address as Record<string, unknown>)?.phone as string) ||
    "",
  );

  if (!phone) {
    LOG.info(`No phone number on COD order ${payload.order_number} — skipping`);
    return;
  }

  const orderNumber = String(payload.order_number || payload.id);
  const amount      = parseFloat(String(payload.total_price || "0")).toFixed(0);
  const deliveryDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toLocaleDateString("en-IN", {
    month: "short", day: "numeric",
  });

  const message = settings.messageTemplate
    .replace(/{name}/g, name)
    .replace(/{order_number}/g, orderNumber)
    .replace(/{amount}/g, amount)
    .replace(/{date}/g, deliveryDate);

  // Normalise phone: ensure starts with country code
  const normalised = phone.startsWith("+") ? phone.slice(1) : phone.startsWith("0") ? "91" + phone.slice(1) : "91" + phone;

  LOG.info(`Sending COD confirmation to ${normalised} for order #${orderNumber}`);

  try {
    const res = await fetch(
      `https://graph.facebook.com/v18.0/${settings.whatsappPhoneId}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.whatsappToken}`,
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: normalised,
          type: "text",
          text: { body: message },
        }),
      },
    );

    const result = await res.json() as Record<string, unknown>;
    if ((result as any).error) {
      LOG.error(`WhatsApp API error: ${JSON.stringify((result as any).error)}`);
    } else {
      LOG.info(`✅ COD confirmation sent to ${normalised} | order #${orderNumber}`);
    }
  } catch (err) {
    LOG.error(`Failed to send COD WhatsApp for order #${orderNumber}:`, err);
  }
}
