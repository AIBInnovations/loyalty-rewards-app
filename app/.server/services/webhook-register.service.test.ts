import { describe, expect, it } from "vitest";

import { isStaleWebhookCallback } from "./webhook-register.service";

const APP = "https://loyalty-rewards-app.synquic.tech";

describe("isStaleWebhookCallback", () => {
  it("flags a dead cloudflare dev tunnel", () => {
    expect(
      isStaleWebhookCallback(
        "https://specially-attitudes-elimination-oral.trycloudflare.com/webhooks",
        APP,
      ),
    ).toBe(true);
  });

  it("flags ngrok and localtunnel hosts", () => {
    expect(isStaleWebhookCallback("https://a1b2.ngrok-free.app/webhooks", APP)).toBe(true);
    expect(isStaleWebhookCallback("https://foo.loca.lt/webhooks", APP)).toBe(true);
  });

  it("keeps a subscription that already points at this deployment", () => {
    expect(isStaleWebhookCallback(`${APP}/webhooks`, APP)).toBe(false);
  });

  it("keeps other real hosts unless they are listed explicitly", () => {
    const render = "https://vynexa-app-1.onrender.com/webhooks";
    expect(isStaleWebhookCallback(render, APP)).toBe(false);
    expect(isStaleWebhookCallback(render, APP, ["vynexa-app-1.onrender.com"])).toBe(true);
  });

  it("never matches a lookalike host or a malformed URL", () => {
    expect(
      isStaleWebhookCallback("https://trycloudflare.com.evil.example/webhooks", APP),
    ).toBe(false);
    expect(isStaleWebhookCallback("not a url", APP)).toBe(false);
  });

  it("never prunes when the app URL itself is a tunnel host", () => {
    const tunnel = "https://dev-session.trycloudflare.com";
    expect(isStaleWebhookCallback(`${tunnel}/webhooks`, tunnel)).toBe(false);
  });
});
