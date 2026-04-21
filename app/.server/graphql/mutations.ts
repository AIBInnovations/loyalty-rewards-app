/**
 * GraphQL mutations for Shopify Admin API.
 * All mutations use the GraphQL Admin API (REST is not allowed for new apps).
 */

export const DISCOUNT_CODE_BASIC_CREATE = `#graphql
  mutation discountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
    discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
      codeDiscountNode {
        id
        codeDiscount {
          ... on DiscountCodeBasic {
            title
            codes(first: 1) {
              nodes {
                code
              }
            }
            startsAt
            endsAt
            usageLimit
            status
          }
        }
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

export const DISCOUNT_CODE_DELETE = `#graphql
  mutation discountCodeDelete($id: ID!) {
    discountCodeDelete(id: $id) {
      deletedCodeDiscountId
      userErrors {
        field
        message
        code
      }
    }
  }
`;

export const METAFIELDS_SET = `#graphql
  mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        id
        namespace
        key
        value
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

export const DISCOUNT_AUTOMATIC_BASIC_CREATE = `#graphql
  mutation discountAutomaticBasicCreate($automaticBasicDiscount: DiscountAutomaticBasicInput!) {
    discountAutomaticBasicCreate(automaticBasicDiscount: $automaticBasicDiscount) {
      automaticDiscountNode {
        id
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

export const DISCOUNT_AUTOMATIC_BASIC_UPDATE = `#graphql
  mutation discountAutomaticBasicUpdate($id: ID!, $automaticBasicDiscount: DiscountAutomaticBasicInput!) {
    discountAutomaticBasicUpdate(id: $id, automaticBasicDiscount: $automaticBasicDiscount) {
      automaticDiscountNode {
        id
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

export const DISCOUNT_AUTOMATIC_DELETE = `#graphql
  mutation discountAutomaticDelete($id: ID!) {
    discountAutomaticDelete(id: $id) {
      deletedAutomaticDiscountId
      userErrors {
        field
        message
        code
      }
    }
  }
`;

export const METAFIELD_DEFINITION_CREATE = `#graphql
  mutation metafieldDefinitionCreate($definition: MetafieldDefinitionInput!) {
    metafieldDefinitionCreate(definition: $definition) {
      createdDefinition {
        id
        name
        namespace
        key
        type {
          name
        }
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;
