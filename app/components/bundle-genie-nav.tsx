import { Link } from "@remix-run/react";
import { InlineStack } from "@shopify/polaris";

const TABS: Array<{ key: string; label: string; url: string }> = [
  { key: "campaigns", label: "Campaigns", url: "/app/bundle-genie" },
  { key: "analytics", label: "Analytics", url: "/app/bundle-genie/analytics" },
  { key: "settings", label: "Settings", url: "/app/bundle-genie/settings" },
];

export function BundleGenieNav({ active }: { active: string }) {
  return (
    <InlineStack gap="400">
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          to={tab.url}
          style={{
            fontWeight: tab.key === active ? 700 : 400,
            textDecoration: tab.key === active ? "underline" : "none",
          }}
        >
          {tab.label}
        </Link>
      ))}
    </InlineStack>
  );
}
