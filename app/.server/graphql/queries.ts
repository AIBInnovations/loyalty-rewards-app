/**
 * GraphQL queries for Shopify Admin API.
 */

export const GET_CUSTOMER = `#graphql
  query getCustomer($id: ID!) {
    customer(id: $id) {
      id
      email
      firstName
      lastName
      numberOfOrders
      amountSpent {
        amount
        currencyCode
      }
      metafield(namespace: "$app:loyalty", key: "points") {
        id
        value
      }
      tags
      createdAt
    }
  }
`;

export const GET_CUSTOMERS = `#graphql
  query getCustomers($first: Int!, $after: String, $query: String) {
    customers(first: $first, after: $after, query: $query) {
      nodes {
        id
        email
        firstName
        lastName
        numberOfOrders
        amountSpent {
          amount
          currencyCode
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const GET_DISCOUNT_CODE = `#graphql
  query getDiscountCode($id: ID!) {
    codeDiscountNode(id: $id) {
      id
      codeDiscount {
        ... on DiscountCodeBasic {
          title
          status
          usageLimit
          asyncUsageCount
          codes(first: 1) {
            nodes {
              code
              usageCount
            }
          }
        }
      }
    }
  }
`;

export const GET_SHOP = `#graphql
  query getShop {
    shop {
      id
      name
      currencyCode
      myshopifyDomain
      primaryDomain {
        url
      }
    }
  }
`;
