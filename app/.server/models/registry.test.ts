import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards the GDPR shop/redact path.
 *
 * handleShopRedact deletes every model listed in SHOP_SCOPED_MODELS. If a new
 * shop-scoped model is added and not registered, that shop's data survives
 * uninstall — which is exactly how the original implementation ended up
 * covering only 5 of 24 collections. This test reads the model directory
 * directly so it fails on the *addition of a file*, not on a stale list.
 */
describe("shop-scoped model registry", () => {
  const modelsDir = __dirname;

  const modelFiles = readdirSync(modelsDir).filter(
    (f) => f.endsWith(".model.ts") && !f.endsWith(".test.ts"),
  );

  it("finds model files to check", () => {
    expect(modelFiles.length).toBeGreaterThan(0);
  });

  it("registers every model that has a shopId field", () => {
    const registrySource = readFileSync(join(modelsDir, "registry.ts"), "utf8");

    const missing: string[] = [];

    for (const file of modelFiles) {
      const source = readFileSync(join(modelsDir, file), "utf8");

      // Only models that are actually shop-scoped need registering.
      if (!/\bshopId\b/.test(source)) continue;

      const exportedNames = [...source.matchAll(/^export const (\w+)/gm)].map(
        (m) => m[1],
      );

      for (const name of exportedNames) {
        // Match the identifier as it appears in the registry's array/imports.
        const referenced = new RegExp(`\\b${name}\\b`).test(registrySource);
        if (!referenced) missing.push(`${name} (${file})`);
      }
    }

    expect(
      missing,
      `These shop-scoped models are missing from SHOP_SCOPED_MODELS in registry.ts. ` +
        `Unregistered models are not deleted on GDPR shop/redact:\n  ${missing.join("\n  ")}`,
    ).toEqual([]);
  });
});
