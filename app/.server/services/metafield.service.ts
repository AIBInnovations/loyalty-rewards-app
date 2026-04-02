import { METAFIELDS_SET, METAFIELD_DEFINITION_CREATE } from "../graphql/mutations";

interface AdminAPI {
  graphql: (query: string, options?: { variables: Record<string, unknown> }) => Promise<{
    json: () => Promise<{ data: Record<string, unknown>; errors?: unknown[] }>;
  }>;
}

/**
 * Sync a customer's loyalty data to Shopify metafields.
 * These metafields are readable on the storefront via Liquid.
 */
export async function syncCustomerMetafields(
  admin: AdminAPI,
  shopifyCustomerId: string,
  data: {
    points: number;
    tier: string;
    referralCode?: string;
  },
): Promise<void> {
  const ownerId = shopifyCustomerId.startsWith("gid://")
    ? shopifyCustomerId
    : `gid://shopify/Customer/${shopifyCustomerId}`;

  const metafields = [
    {
      ownerId,
      namespace: "$app:loyalty",
      key: "points",
      value: String(data.points),
      type: "number_integer",
    },
    {
      ownerId,
      namespace: "$app:loyalty",
      key: "tier",
      value: data.tier,
      type: "single_line_text_field",
    },
  ];

  if (data.referralCode) {
    metafields.push({
      ownerId,
      namespace: "$app:loyalty",
      key: "referral_code",
      value: data.referralCode,
      type: "single_line_text_field",
    });
  }

  try {
    const response = await admin.graphql(METAFIELDS_SET, {
      variables: { metafields },
    });
    const result = await response.json();

    if (result.data?.metafieldsSet?.userErrors?.length) {
      console.error(
        "Metafield sync errors:",
        result.data.metafieldsSet.userErrors,
      );
    }
  } catch (error) {
    console.error("Failed to sync metafields for customer", ownerId, error);
    throw error;
  }
}

/**
 * Create metafield definitions on first app install.
 * This enables storefront access (PUBLIC_READ) so Liquid can read them.
 */
export async function createMetafieldDefinitions(
  admin: AdminAPI,
): Promise<void> {
  const definitions = [
    {
      name: "Loyalty Points",
      namespace: "$app:loyalty",
      key: "points",
      type: "number_integer",
      ownerType: "CUSTOMER",
      access: { storefront: "PUBLIC_READ" },
    },
    {
      name: "Loyalty Tier",
      namespace: "$app:loyalty",
      key: "tier",
      type: "single_line_text_field",
      ownerType: "CUSTOMER",
      access: { storefront: "PUBLIC_READ" },
    },
    {
      name: "Referral Code",
      namespace: "$app:loyalty",
      key: "referral_code",
      type: "single_line_text_field",
      ownerType: "CUSTOMER",
      access: { storefront: "PUBLIC_READ" },
    },
  ];

  for (const definition of definitions) {
    try {
      const response = await admin.graphql(METAFIELD_DEFINITION_CREATE, {
        variables: { definition },
      });
      const result = await response.json();
      if (result.data?.metafieldDefinitionCreate?.userErrors?.length) {
        // "already exists" errors are expected on repeated calls -- safe to ignore
        const errors = result.data.metafieldDefinitionCreate.userErrors as Array<{ message: string }>;
        const isAlreadyExists = errors.every((e) =>
          e.message?.includes("already exists"),
        );
        if (!isAlreadyExists) {
          console.error("Metafield definition error:", errors);
        }
      }
    } catch (error) {
      console.error(
        `Failed to create metafield definition ${definition.key}:`,
        error,
      );
    }
  }
}
