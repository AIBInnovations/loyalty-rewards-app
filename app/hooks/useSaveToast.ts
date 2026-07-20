import { useActionData, useNavigation } from "@remix-run/react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useEffect, useRef } from "react";

type SaveActionData = {
  success?: boolean;
  error?: string;
} | undefined;

/**
 * Surfaces the result of a settings save to the merchant.
 *
 * Every settings route already returns `{ success: true }` or
 * `{ error: "..." }`, but nothing rendered it — the merchant clicked Save,
 * the spinner stopped, and nothing else happened. On the error path that was
 * worse than silence: a failed save looked identical to a successful one.
 *
 * Uses App Bridge toasts rather than Polaris `<Toast>` so the message renders
 * in the admin chrome and survives navigation within the embedded app.
 */
export function useSaveToast(options?: {
  successMessage?: string;
  errorMessage?: string;
}) {
  const actionData = useActionData<SaveActionData>();
  const navigation = useNavigation();
  const shopify = useAppBridge();

  // Only react to results that arrive after a submission settles, so a toast
  // doesn't re-fire on unrelated re-renders.
  const lastShown = useRef<SaveActionData>(undefined);

  useEffect(() => {
    if (!actionData || navigation.state !== "idle") return;
    if (actionData === lastShown.current) return;
    lastShown.current = actionData;

    if (actionData.error) {
      shopify.toast.show(actionData.error || options?.errorMessage || "Couldn't save changes", {
        isError: true,
      });
    } else if (actionData.success) {
      shopify.toast.show(options?.successMessage || "Changes saved");
    }
  }, [actionData, navigation.state, shopify, options?.successMessage, options?.errorMessage]);
}
