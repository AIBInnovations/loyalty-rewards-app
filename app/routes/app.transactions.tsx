import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSearchParams } from "@remix-run/react";
import {
  Page,
  Card,
  IndexTable,
  Text,
  Badge,
  Select,
  InlineStack,
  EmptyState,
} from "@shopify/polaris";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import { connectDB } from "../db.server";
import { Transaction } from "../.server/models/transaction.model";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();

  const url = new URL(request.url);
  const typeFilter = url.searchParams.get("type") || "";
  const sourceFilter = url.searchParams.get("source") || "";
  const page = Number(url.searchParams.get("page")) || 1;
  const limit = 50;

  const query: Record<string, unknown> = { shopId: session.shop };
  if (typeFilter) query.type = typeFilter;
  if (sourceFilter) query.source = sourceFilter;

  const [transactions, total] = await Promise.all([
    Transaction.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("customerId", "email firstName lastName")
      .lean(),
    Transaction.countDocuments(query),
  ]);

  return json({
    transactions: transactions.map((t) => ({
      id: t._id.toString(),
      customer:
        (t.customerId as any)?.email ||
        `${(t.customerId as any)?.firstName || ""} ${(t.customerId as any)?.lastName || ""}`.trim() ||
        "Unknown",
      type: t.type,
      points: t.points,
      balanceAfter: t.balanceAfter,
      source: t.source,
      description: t.description || "",
      referenceId: t.referenceId || "",
      date: t.createdAt?.toISOString(),
    })),
    total,
    page,
    totalPages: Math.ceil(total / limit),
    typeFilter,
    sourceFilter,
  });
};

export default function TransactionsPage() {
  const { transactions, total, typeFilter, sourceFilter } =
    useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();

  const handleTypeFilter = useCallback(
    (value: string) => {
      const params = new URLSearchParams(searchParams);
      if (value) params.set("type", value);
      else params.delete("type");
      params.set("page", "1");
      setSearchParams(params);
    },
    [searchParams, setSearchParams],
  );

  const handleSourceFilter = useCallback(
    (value: string) => {
      const params = new URLSearchParams(searchParams);
      if (value) params.set("source", value);
      else params.delete("source");
      params.set("page", "1");
      setSearchParams(params);
    },
    [searchParams, setSearchParams],
  );

  const typeBadgeColor: Record<string, "success" | "critical" | "warning" | "info"> = {
    EARN: "success",
    REDEEM: "critical",
    ADJUST: "warning",
    EXPIRE: "info",
  };

  return (
    <Page title={`Transactions (${total})`}>
      <Card>
        <InlineStack gap="400">
          <Select
            label="Type"
            options={[
              { label: "All Types", value: "" },
              { label: "Earn", value: "EARN" },
              { label: "Redeem", value: "REDEEM" },
              { label: "Adjust", value: "ADJUST" },
              { label: "Expire", value: "EXPIRE" },
            ]}
            value={typeFilter}
            onChange={handleTypeFilter}
          />
          <Select
            label="Source"
            options={[
              { label: "All Sources", value: "" },
              { label: "Purchase", value: "PURCHASE" },
              { label: "Signup", value: "SIGNUP" },
              { label: "Referral", value: "REFERRAL" },
              { label: "Birthday", value: "BIRTHDAY" },
              { label: "Social Share", value: "SOCIAL_SHARE" },
              { label: "Redemption", value: "REDEMPTION" },
              { label: "Refund", value: "REFUND" },
              { label: "Manual", value: "MANUAL" },
              { label: "Cancellation", value: "CANCELLATION" },
            ]}
            value={sourceFilter}
            onChange={handleSourceFilter}
          />
        </InlineStack>
      </Card>

      <div style={{ marginTop: "16px" }}>
        <Card>
          {transactions.length > 0 ? (
            <IndexTable
              resourceName={{
                singular: "transaction",
                plural: "transactions",
              }}
              itemCount={transactions.length}
              headings={[
                { title: "Customer" },
                { title: "Type" },
                { title: "Points" },
                { title: "Balance After" },
                { title: "Source" },
                { title: "Description" },
                { title: "Date" },
              ]}
              selectable={false}
            >
              {transactions.map((t, index) => (
                <IndexTable.Row id={t.id} key={t.id} position={index}>
                  <IndexTable.Cell>{t.customer}</IndexTable.Cell>
                  <IndexTable.Cell>
                    <Badge tone={typeBadgeColor[t.type] || "info"}>
                      {t.type}
                    </Badge>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text
                      as="span"
                      fontWeight="bold"
                      tone={t.points > 0 ? "success" : "critical"}
                    >
                      {t.points > 0 ? `+${t.points}` : t.points}
                    </Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>{t.balanceAfter}</IndexTable.Cell>
                  <IndexTable.Cell>{t.source}</IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text as="span" variant="bodySm">
                      {t.description}
                    </Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    {new Date(t.date).toLocaleDateString("en-IN")}
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          ) : (
            <EmptyState
              heading="No transactions found"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>Transactions will appear here as customers earn and redeem points.</p>
            </EmptyState>
          )}
        </Card>
      </div>
    </Page>
  );
}
