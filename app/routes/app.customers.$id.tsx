import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  Badge,
  DataTable,
  TextField,
  Select,
  InlineStack,
  Divider,
  Banner,
} from "@shopify/polaris";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import { connectDB } from "../db.server";
import { Customer } from "../.server/models/customer.model";
import { Transaction } from "../.server/models/transaction.model";
import { Redemption } from "../.server/models/redemption.model";
import { earnPoints, reversePoints } from "../.server/services/points.service";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  await connectDB();

  const customer = await Customer.findOne({
    _id: params.id,
    shopId: session.shop,
  });
  if (!customer) {
    throw new Response("Customer not found", { status: 404 });
  }

  const [transactions, redemptions] = await Promise.all([
    Transaction.find({ customerId: customer._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean(),
    Redemption.find({ customerId: customer._id })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean(),
  ]);

  return json({
    customer: {
      id: customer._id.toString(),
      shopifyId: customer.shopifyCustomerId,
      email: customer.email || "N/A",
      name:
        `${customer.firstName || ""} ${customer.lastName || ""}`.trim() ||
        "N/A",
      balance: customer.currentBalance,
      lifetimeEarned: customer.lifetimeEarned,
      lifetimeRedeemed: customer.lifetimeRedeemed,
      tier: customer.tier,
      referralCode: customer.referralCode,
      referredBy: customer.referredBy || "None",
      birthday: customer.birthday?.toISOString().split("T")[0] || "Not set",
      createdAt: customer.createdAt.toISOString(),
    },
    transactions: transactions.map((t) => ({
      type: t.type,
      points: t.points,
      balanceAfter: t.balanceAfter,
      source: t.source,
      description: t.description || "",
      date: t.createdAt?.toISOString(),
    })),
    redemptions: redemptions.map((r) => ({
      discountCode: r.discountCode,
      pointsSpent: r.pointsSpent,
      status: r.status,
      orderId: r.orderId || "—",
      date: r.createdAt?.toISOString(),
    })),
  });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  await connectDB();

  const formData = await request.formData();
  const intent = formData.get("intent");
  const points = Number(formData.get("points"));
  const reason = String(formData.get("reason") || "Manual adjustment");

  const customer = await Customer.findOne({
    _id: params.id,
    shopId: session.shop,
  });
  if (!customer) {
    return json({ error: "Customer not found" }, { status: 404 });
  }

  if (intent === "add" && points > 0) {
    await earnPoints({
      shopId: session.shop,
      shopifyCustomerId: customer.shopifyCustomerId,
      points,
      source: "MANUAL",
      referenceId: `manual_${Date.now()}`,
      idempotencyKey: `manual_add_${customer.shopifyCustomerId}_${Date.now()}`,
      description: reason,
      admin: admin as any,
    });
  } else if (intent === "deduct" && points > 0) {
    await reversePoints({
      shopId: session.shop,
      shopifyCustomerId: customer.shopifyCustomerId,
      points,
      source: "MANUAL",
      referenceId: `manual_${Date.now()}`,
      idempotencyKey: `manual_deduct_${customer.shopifyCustomerId}_${Date.now()}`,
      description: reason,
      admin: admin as any,
    });
  }

  return json({ success: true });
};

export default function CustomerDetail() {
  const { customer, transactions, redemptions } =
    useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isLoading = navigation.state === "submitting";

  const [adjustPoints, setAdjustPoints] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [adjustType, setAdjustType] = useState("add");

  const handleAdjust = useCallback(() => {
    if (!adjustPoints || Number(adjustPoints) <= 0) return;
    const formData = new FormData();
    formData.set("intent", adjustType);
    formData.set("points", adjustPoints);
    formData.set("reason", adjustReason);
    submit(formData, { method: "post" });
    setAdjustPoints("");
    setAdjustReason("");
  }, [adjustPoints, adjustReason, adjustType, submit]);

  const transactionRows = transactions.map((t) => [
    t.type,
    t.points > 0 ? `+${t.points}` : String(t.points),
    String(t.balanceAfter),
    t.source,
    t.description,
    new Date(t.date).toLocaleDateString("en-IN"),
  ]);

  const redemptionRows = redemptions.map((r) => [
    r.discountCode,
    String(r.pointsSpent),
    r.status,
    r.orderId,
    new Date(r.date).toLocaleDateString("en-IN"),
  ]);

  return (
    <Page
      title={customer.name}
      subtitle={customer.email}
      backAction={{ content: "Customers", url: "/app/customers" }}
    >
      <BlockStack gap="500">
        <Layout>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Points Balance
                </Text>
                <Text as="p" variant="heading2xl">
                  {customer.balance.toLocaleString("en-IN")}
                </Text>
                <Badge
                  tone={
                    customer.tier === "Platinum"
                      ? "success"
                      : customer.tier === "Gold"
                        ? "warning"
                        : "info"
                  }
                >
                  {customer.tier}
                </Badge>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200">
                <Text as="p" tone="subdued">Lifetime Earned</Text>
                <Text as="p" variant="headingLg">
                  {customer.lifetimeEarned.toLocaleString("en-IN")} pts
                </Text>
                <Text as="p" tone="subdued">Lifetime Redeemed</Text>
                <Text as="p" variant="headingLg">
                  {customer.lifetimeRedeemed.toLocaleString("en-IN")} pts
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200">
                <Text as="p" tone="subdued">Referral Code</Text>
                <Text as="p" variant="headingMd">{customer.referralCode}</Text>
                <Text as="p" tone="subdued">Referred By</Text>
                <Text as="p">{customer.referredBy}</Text>
                <Text as="p" tone="subdued">Birthday</Text>
                <Text as="p">{customer.birthday}</Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Manual Adjustment
            </Text>
            <InlineStack gap="300" blockAlign="end">
              <Select
                label="Action"
                options={[
                  { label: "Add Points", value: "add" },
                  { label: "Deduct Points", value: "deduct" },
                ]}
                value={adjustType}
                onChange={setAdjustType}
              />
              <TextField
                label="Points"
                type="number"
                value={adjustPoints}
                onChange={setAdjustPoints}
                autoComplete="off"
                min={1}
              />
              <TextField
                label="Reason"
                value={adjustReason}
                onChange={setAdjustReason}
                placeholder="Reason for adjustment"
                autoComplete="off"
              />
              <div style={{ paddingTop: "24px" }}>
                <button
                  onClick={handleAdjust}
                  disabled={isLoading}
                  style={{
                    padding: "8px 16px",
                    background: "#5C6AC4",
                    color: "white",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                  }}
                >
                  {isLoading ? "Saving..." : "Apply"}
                </button>
              </div>
            </InlineStack>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Transaction History
            </Text>
            {transactionRows.length > 0 ? (
              <DataTable
                columnContentTypes={[
                  "text",
                  "numeric",
                  "numeric",
                  "text",
                  "text",
                  "text",
                ]}
                headings={[
                  "Type",
                  "Points",
                  "Balance After",
                  "Source",
                  "Description",
                  "Date",
                ]}
                rows={transactionRows}
              />
            ) : (
              <Text as="p" tone="subdued">
                No transactions yet
              </Text>
            )}
          </BlockStack>
        </Card>

        {redemptionRows.length > 0 && (
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Redemptions
              </Text>
              <DataTable
                columnContentTypes={[
                  "text",
                  "numeric",
                  "text",
                  "text",
                  "text",
                ]}
                headings={[
                  "Discount Code",
                  "Points Spent",
                  "Status",
                  "Order",
                  "Date",
                ]}
                rows={redemptionRows}
              />
            </BlockStack>
          </Card>
        )}
      </BlockStack>
    </Page>
  );
}
