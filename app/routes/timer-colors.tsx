import type { LoaderFunctionArgs } from "@remix-run/node";
import { connectDB } from "../db.server";
import { TimerSettings } from "../.server/models/timer-settings.model";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop") || "";

  const fallback = ":root{}";

  if (!shop) {
    return new Response(fallback, {
      headers: { "Content-Type": "text/css", "Access-Control-Allow-Origin": "*" },
    });
  }

  try {
    await connectDB();
    const settings = await TimerSettings.findOne({ shopId: shop }).lean();

    const safe = (c: unknown) =>
      typeof c === "string" && /^#[0-9a-fA-F]{3,8}$/.test(c) ? c : null;

    const bg    = safe(settings?.barBackgroundColor) ?? "#1a1a1a";
    const text  = safe(settings?.barTextColor)       ?? "#ffffff";
    const digit = safe(settings?.timerDigitColor)    ?? "#ff4444";

    const css = `:root{--ct-bg:${bg};--ct-text:${text};--ct-digit:${digit}}`;

    return new Response(css, {
      status: 200,
      headers: {
        "Content-Type": "text/css; charset=utf-8",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch {
    return new Response(fallback, {
      headers: { "Content-Type": "text/css", "Access-Control-Allow-Origin": "*" },
    });
  }
};
