import { Link } from "@remix-run/react";
import { BlockStack } from "@shopify/polaris";
import type { ReactNode } from "react";

const NAV_ITEMS: Array<{ key: string; label: string; url: string }> = [
  { key: "dashboard", label: "Bundle Dashboard", url: "/app/bundle-genie" },
  { key: "campaigns", label: "Campaigns", url: "/app/bundle-genie/bundles" },
  { key: "analytics", label: "Analytics", url: "/app/bundle-genie/analytics" },
  { key: "billing", label: "Billing", url: "/app/bundle-genie/billing" },
  { key: "settings", label: "Settings", url: "/app/bundle-genie/settings" },
  { key: "docs", label: "Docs", url: "/app/bundle-genie/docs" },
];

/**
 * The reference app renders its own vertical sidebar inside its content area
 * (Shopify's own NavMenu is flat and can't nest sub-items), so Bundle Genie
 * replicates that with a plain two-column flex layout rather than a Polaris
 * component built for it.
 */
export function BundleGenieShell({ active, children }: { active: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 32, alignItems: "flex-start" }}>
      <div style={{ width: 168, flexShrink: 0 }}>
        <BlockStack gap="050">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.key}
              to={item.url}
              style={{
                display: "block",
                padding: "8px 12px",
                borderRadius: 8,
                textDecoration: "none",
                color: item.key === active ? "#1a1a1a" : "#616161",
                fontWeight: item.key === active ? 600 : 400,
                background: item.key === active ? "#f1f1f1" : "transparent",
              }}
            >
              {item.label}
            </Link>
          ))}
        </BlockStack>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  );
}
