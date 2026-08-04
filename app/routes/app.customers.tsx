import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useActionData, useNavigation, Link, useSearchParams, useSubmit } from "@remix-run/react";
import {
  Page,
  Card,
  IndexTable,
  Text,
  Badge,
  TextField,
  InlineStack,
  EmptyState,
  Modal,
  Button,
} from "@shopify/polaris";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import { connectDB } from "../db.server";
import { Customer } from "../.server/models/customer.model";

const FIND_CUSTOMER_BY_EMAIL = `#graphql
  query findCustomerByEmail($query: String!) {
    customers(first: 1, query: $query) {
      nodes {
        id
        email
        firstName
        lastName
      }
    }
  }
`;

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  await connectDB();
  const fd = await request.formData();
  const email = String(fd.get("email") || "").trim();
  if (!email) return json({ error: "Enter a customer email." }, { status: 400 });

  const response = await admin.graphql(FIND_CUSTOMER_BY_EMAIL, {
    variables: { query: `email:${email}` },
  });
  const result = await response.json();
  const found = (result.data as any)?.customers?.nodes?.[0];
  if (!found) {
    return json({ error: `No Shopify customer found with email "${email}".` }, { status: 404 });
  }

  const shopifyCustomerId = String(found.id).replace("gid://shopify/Customer/", "");
  const customer = await Customer.findOneAndUpdate(
    { shopId: session.shop, shopifyCustomerId },
    {
      $setOnInsert: { shopId: session.shop, shopifyCustomerId },
      $set: {
        email: found.email || email,
        firstName: found.firstName || "",
        lastName: found.lastName || "",
      },
    },
    { upsert: true, new: true },
  );

  return redirect(`/app/customers/${customer._id.toString()}`);
};

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
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const submit = useSubmit();
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchValue, setSearchValue] = useState(search);

  const [addOpen, setAddOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const adding = nav.state === "submitting" && nav.formData?.get("email") != null;

  const handleSearch = useCallback(() => {
    setSearchParams({ q: searchValue, page: "1" });
  }, [searchValue, setSearchParams]);

  const handleAddCustomer = useCallback(() => {
    const fd = new FormData();
    fd.set("email", newEmail);
    submit(fd, { method: "POST" });
  }, [newEmail, submit]);

  const tierColors: Record<string, "info" | "success" | "warning" | "critical"> = {
    Bronze: "info",
    Silver: "info",
    Gold: "warning",
    Platinum: "success",
  };

  return (
    <Page
      title={`Customers (${total})`}
      primaryAction={{ content: "Add Customer", onAction: () => setAddOpen(true) }}
    >
      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add Customer"
        primaryAction={{ content: "Add", onAction: handleAddCustomer, loading: adding }}
        secondaryActions={[{ content: "Cancel", onAction: () => setAddOpen(false) }]}
      >
        <Modal.Section>
          <TextField
            label="Customer email"
            type="email"
            value={newEmail}
            onChange={setNewEmail}
            autoComplete="off"
            placeholder="customer@example.com"
            helpText="Must match an existing Shopify customer's email."
            error={actionData && "error" in actionData ? actionData.error : undefined}
          />
        </Modal.Section>
      </Modal>

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
