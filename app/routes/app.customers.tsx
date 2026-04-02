import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, Link, useSearchParams } from "@remix-run/react";
import {
  Page,
  Card,
  IndexTable,
  Text,
  Badge,
  TextField,
  InlineStack,
  EmptyState,
} from "@shopify/polaris";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import { connectDB } from "../db.server";
import { Customer } from "../.server/models/customer.model";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();

  const url = new URL(request.url);
  const search = url.searchParams.get("q") || "";
  const page = Number(url.searchParams.get("page")) || 1;
  const limit = 25;

  const query: Record<string, unknown> = { shopId: session.shop };
  if (search) {
    query.$or = [
      { email: { $regex: search, $options: "i" } },
      { firstName: { $regex: search, $options: "i" } },
      { lastName: { $regex: search, $options: "i" } },
    ];
  }

  const [customers, total] = await Promise.all([
    Customer.find(query)
      .sort({ lifetimeEarned: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Customer.countDocuments(query),
  ]);

  return json({
    customers: customers.map((c) => ({
      id: c._id.toString(),
      shopifyId: c.shopifyCustomerId,
      email: c.email || "N/A",
      name: `${c.firstName || ""} ${c.lastName || ""}`.trim() || "N/A",
      balance: c.currentBalance,
      lifetimeEarned: c.lifetimeEarned,
      tier: c.tier,
      referralCode: c.referralCode,
    })),
    total,
    page,
    totalPages: Math.ceil(total / limit),
    search,
  });
};

export default function CustomersPage() {
  const { customers, total, page, totalPages, search } =
    useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchValue, setSearchValue] = useState(search);

  const handleSearch = useCallback(() => {
    setSearchParams({ q: searchValue, page: "1" });
  }, [searchValue, setSearchParams]);

  const tierColors: Record<string, "info" | "success" | "warning" | "critical"> = {
    Bronze: "info",
    Silver: "info",
    Gold: "warning",
    Platinum: "success",
  };

  return (
    <Page title={`Customers (${total})`}>
      <Card>
        <InlineStack gap="300" blockAlign="end">
          <div style={{ flexGrow: 1 }}>
            <TextField
              label=""
              labelHidden
              value={searchValue}
              onChange={setSearchValue}
              placeholder="Search by name or email..."
              autoComplete="off"
              onBlur={handleSearch}
            />
          </div>
          <Button onClick={handleSearch}>Search</Button>
        </InlineStack>
      </Card>

      <div style={{ marginTop: "16px" }}>
        <Card>
          {customers.length > 0 ? (
            <IndexTable
              resourceName={{ singular: "customer", plural: "customers" }}
              itemCount={customers.length}
              headings={[
                { title: "Customer" },
                { title: "Email" },
                { title: "Balance" },
                { title: "Lifetime Earned" },
                { title: "Tier" },
                { title: "Referral Code" },
              ]}
              selectable={false}
            >
              {customers.map((customer, index) => (
                <IndexTable.Row
                  id={customer.id}
                  key={customer.id}
                  position={index}
                >
                  <IndexTable.Cell>
                    <Link to={`/app/customers/${customer.id}`}>
                      <Text as="span" fontWeight="bold">
                        {customer.name}
                      </Text>
                    </Link>
                  </IndexTable.Cell>
                  <IndexTable.Cell>{customer.email}</IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text as="span" fontWeight="bold">
                      {customer.balance.toLocaleString("en-IN")} pts
                    </Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    {customer.lifetimeEarned.toLocaleString("en-IN")} pts
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Badge tone={tierColors[customer.tier] || "info"}>
                      {customer.tier}
                    </Badge>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text as="span" variant="bodySm" tone="subdued">
                      {customer.referralCode}
                    </Text>
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          ) : (
            <EmptyState
              heading="No customers found"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>
                Customers will appear here once they earn their first points.
              </p>
            </EmptyState>
          )}
        </Card>
      </div>
    </Page>
  );
}

function Button({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "8px 16px",
        background: "#5C6AC4",
        color: "white",
        border: "none",
        borderRadius: "4px",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}
