import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";

const GET_PRODUCT_BY_HANDLE = `#graphql
  query getProductByHandle($handle: String!) {
    productByHandle(handle: $handle) {
      id
      title
      handle
      featuredImage {
        url
      }
      variants(first: 1) {
        nodes {
          id
          price
          compareAtPrice
        }
      }
    }
  }
`;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const url = new URL(request.url);
  const handle = url.searchParams.get("handle");

  if (!handle) {
    return json({ error: "handle is required" }, { status: 400 });
  }

  const response = await admin.graphql(GET_PRODUCT_BY_HANDLE, {
    variables: { handle },
  });
  const result = await response.json();

  const product = (result.data as any)?.productByHandle;
  if (!product) {
    return json({ error: "Product not found" }, { status: 404 });
  }

  const variant = product.variants?.nodes?.[0];

  return json({
    id: product.id,
    title: product.title,
    handle: product.handle,
    imageUrl: product.featuredImage?.url || "",
    price: Math.round(parseFloat(variant?.price || "0") * 100),
    compareAtPrice: variant?.compareAtPrice
      ? Math.round(parseFloat(variant.compareAtPrice) * 100)
      : null,
    variantId: variant?.id || "",
  });
};
