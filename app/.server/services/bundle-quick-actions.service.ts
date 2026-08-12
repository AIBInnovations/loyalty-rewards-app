import { Bundle } from "../models/bundle.model";

export type BundleQuickActionIntent = "pause" | "resume" | "archive" | "duplicate";

/**
 * Shared by the Campaigns dashboard and the full bundle list — both submit
 * the same pause/resume/duplicate/archive intents against a bundle, so the
 * mutation logic lives in one place instead of being copy-pasted per page.
 */
export async function runBundleQuickAction(
  shopId: string,
  bundleId: string,
  intent: BundleQuickActionIntent,
): Promise<{ success: boolean; error?: string; status?: number }> {
  const bundle = await Bundle.findOne({ _id: bundleId, shopId });
  if (!bundle) return { success: false, error: "Bundle not found", status: 404 };

  if (intent === "pause") {
    bundle.status = "paused";
    await bundle.save();
  } else if (intent === "resume") {
    // Only a published bundle (has at least one version) can go back to active.
    bundle.status = bundle.currentVersion > 0 ? "active" : "draft";
    await bundle.save();
  } else if (intent === "archive") {
    // Soft delete — never hard-delete a bundle that might be referenced by
    // past order attribution.
    bundle.status = "archived";
    await bundle.save();
  } else if (intent === "duplicate") {
    const copy = new Bundle({
      shopId,
      type: bundle.type,
      internalName: bundle.internalName + " (copy)",
      title: bundle.title + " (copy)",
      handle: bundle.handle + "-copy-" + Date.now().toString(36),
      description: bundle.description,
      status: "draft",
      featuredImageUrl: bundle.featuredImageUrl,
      draftProducts: bundle.draftProducts,
      draftDiscountType: bundle.draftDiscountType,
      draftDiscountValue: bundle.draftDiscountValue,
      currentVersion: 0,
      versions: [],
    });
    await copy.save();
  }

  return { success: true };
}
