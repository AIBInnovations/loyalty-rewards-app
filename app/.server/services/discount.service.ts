import { DISCOUNT_CODE_BASIC_CREATE, DISCOUNT_CODE_DELETE } from "../graphql/mutations";
import { generateDiscountCode } from "../utils/codes";
import type { DiscountType } from "../models/reward.model";

interface AdminAPI {
  graphql: (query: string, options?: { variables: Record<string, unknown> }) => Promise<{
    json: () => Promise<{ data: Record<string, unknown>; errors?: unknown[] }>;
  }>;
}

interface CreateDiscountResult {
  discountCode: string;
  shopifyDiscountId: string;
}

/**
 * Create a single-use Shopify discount code for loyalty point redemption.
 * The code expires in 24 hours and is locked to a specific customer.
 */
export async function createRedemptionDiscount(
  admin: AdminAPI,
  options: {
    shopifyCustomerId: string;
    discountType: DiscountType;
    discountValue: number;
    minimumOrderAmount: number;
    title: string;
  },
): Promise<CreateDiscountResult> {
  const code = generateDiscountCode();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours

  const customerId = options.shopifyCustomerId.startsWith("gid://")
    ? options.shopifyCustomerId
    : `gid://shopify/Customer/${options.shopifyCustomerId}`;

  // Build the discount value based on type
  let customerGets;
  if (options.discountType === "FIXED_AMOUNT") {
    customerGets = {
      value: {
        discountAmount: {
          amount: options.discountValue,
          appliesOnEachItem: false,
        },
      },
      items: {
        all: true,
      },
    };
  } else {
    // PERCENTAGE
    customerGets = {
      value: {
        percentage: options.discountValue / 100,
      },
      items: {
        all: true,
      },
    };
  }

  const variables = {
    basicCodeDiscount: {
      title: options.title,
      code,
      startsAt: now.toISOString(),
      endsAt: expiresAt.toISOString(),
      usageLimit: 1,
      appliesOncePerCustomer: true,
      customerSelection: {
        customers: {
          add: [customerId],
        },
      },
      customerGets,
      minimumRequirement:
        options.minimumOrderAmount > 0
          ? {
              subtotal: {
                greaterThanOrEqualToSubtotal: options.minimumOrderAmount,
              },
            }
          : { quantity: { greaterThanOrEqualToQuantity: 1 } },
      combinesWith: {
        orderDiscounts: false,
        productDiscounts: true,
        shippingDiscounts: true,
      },
    },
  };

  const response = await admin.graphql(DISCOUNT_CODE_BASIC_CREATE, {
    variables,
  });
  const result = await response.json();

  const data = result.data as {
    discountCodeBasicCreate?: {
      codeDiscountNode?: { id: string };
      userErrors?: Array<{ field: string; message: string }>;
    };
  };

  if (data.discountCodeBasicCreate?.userErrors?.length) {
    const errors = data.discountCodeBasicCreate.userErrors;
    throw new Error(
      `Failed to create discount: ${errors.map((e) => e.message).join(", ")}`,
    );
  }

  const shopifyDiscountId =
    data.discountCodeBasicCreate?.codeDiscountNode?.id;
  if (!shopifyDiscountId) {
    throw new Error("Discount created but no ID returned");
  }

  return { discountCode: code, shopifyDiscountId };
}

/**
 * Delete a discount code from Shopify.
 * Used when cleaning up expired/unused redemption codes.
 */
export async function deleteDiscountCode(
  admin: AdminAPI,
  shopifyDiscountId: string,
): Promise<void> {
  try {
    const response = await admin.graphql(DISCOUNT_CODE_DELETE, {
      variables: { id: shopifyDiscountId },
    });
    const result = await response.json();
    const data = result.data as {
      discountCodeDelete?: {
        userErrors?: Array<{ message: string }>;
      };
    };
    if (data.discountCodeDelete?.userErrors?.length) {
      console.error(
        "Failed to delete discount:",
        data.discountCodeDelete.userErrors,
      );
    }
  } catch (error) {
    console.error("Error deleting discount code:", error);
  }
}
