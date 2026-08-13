import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, Card, BlockStack, Text, Badge, Banner } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { connectDB } from "../db.server";
import { Subscription } from "../.server/models/subscription.model";
import { BundleGenieShell } from "../components/bundle-genie-nav";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();
  const subscription = await Subscription.findOne({ shopId: session.shop }).lean();
  return json({
    plan: subscription?.plan || "free",
    billingState: subscription?.billingState || "trial",
  });
};

export default function BundleGenieBilling() {
  const { plan, billingState } = useLoaderData<typeof loader>();

  return (
    <Page title="Bundle Genie" subtitle="Billing" backAction={{ url: "/app/bundle-genie" }}>
      <BundleGenieShell active="billing">
      <BlockStack gap="400">
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Current plan</Text>
            <Badge tone={billingState === "active" ? "success" : "info"}>
              {plan === "free" ? "Free plan" : `${plan} — ${billingState}`}
            </Badge>
            <Text as="p" tone="subdued">
              This reflects your account-wide plan, shared across all features in this app —
              Bundle Genie doesn't have its own separate subscription.
            </Text>
          </BlockStack>
        </Card>

        <Banner tone="info" title="Paid Bundle Genie plans aren't set up yet">
          <p>
            There's no metered or tiered pricing specific to Bundle Genie right now — every
            feature shown in this app (campaigns, storefront widget, analytics) is available on
            the free plan while it's in active development. If usage-based billing gets added
            later, it'll show up here with real numbers, not a placeholder.
          </p>
        </Banner>
      </BlockStack>
      </BundleGenieShell>
    </Page>
  );
}
