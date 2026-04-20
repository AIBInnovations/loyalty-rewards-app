import { WishlistItem, type WishlistKind } from "../models/wishlist.model";

export interface UpsertItemInput {
  shopId: string;
  shopifyCustomerId: string;
  kind: WishlistKind;
  productId: string;
  variantId?: string;
  productHandle?: string;
  productTitle?: string;
  variantTitle?: string;
  imageUrl?: string;
  price?: number;
  quantity?: number;
}

function normalizeProductId(raw: string): string {
  // Storefront sometimes sends bare numeric ids, sometimes GIDs. Store as-is
  // but strip whitespace to keep the unique index consistent.
  return String(raw).trim();
}

export async function listForCustomer(
  shopId: string,
  shopifyCustomerId: string,
) {
  const items = await WishlistItem.find({ shopId, shopifyCustomerId })
    .sort({ savedAt: -1 })
    .lean();

  return {
    wishlist: items
      .filter((i) => i.kind === "wishlist")
      .map((i) => ({
        productId: i.productId,
        productHandle: i.productHandle,
        productTitle: i.productTitle,
        imageUrl: i.imageUrl,
        price: i.price,
        savedAt: i.savedAt,
      })),
    saved: items
      .filter((i) => i.kind === "saved")
      .map((i) => ({
        productId: i.productId,
        variantId: i.variantId,
        productHandle: i.productHandle,
        productTitle: i.productTitle,
        variantTitle: i.variantTitle,
        imageUrl: i.imageUrl,
        price: i.price,
        quantity: i.quantity || 1,
        savedAt: i.savedAt,
      })),
  };
}

export async function addItem(input: UpsertItemInput) {
  if (!input.productId) throw new Error("productId required");
  if (input.kind === "saved" && !input.variantId) {
    throw new Error("variantId required for saved-for-later");
  }

  const productId = normalizeProductId(input.productId);
  const filter =
    input.kind === "wishlist"
      ? {
          shopId: input.shopId,
          shopifyCustomerId: input.shopifyCustomerId,
          kind: "wishlist" as const,
          productId,
        }
      : {
          shopId: input.shopId,
          shopifyCustomerId: input.shopifyCustomerId,
          kind: "saved" as const,
          variantId: String(input.variantId).trim(),
        };

  await WishlistItem.findOneAndUpdate(
    filter,
    {
      $set: {
        productId,
        variantId: input.variantId,
        productHandle: input.productHandle,
        productTitle: input.productTitle,
        variantTitle: input.variantTitle,
        imageUrl: input.imageUrl,
        price: input.price,
        quantity: input.quantity || 1,
      },
      $setOnInsert: { savedAt: new Date() },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}

export async function removeWishlistProduct(
  shopId: string,
  shopifyCustomerId: string,
  productId: string,
) {
  await WishlistItem.deleteOne({
    shopId,
    shopifyCustomerId,
    kind: "wishlist",
    productId: normalizeProductId(productId),
  });
}

export async function removeSavedVariant(
  shopId: string,
  shopifyCustomerId: string,
  variantId: string,
) {
  await WishlistItem.deleteOne({
    shopId,
    shopifyCustomerId,
    kind: "saved",
    variantId: String(variantId).trim(),
  });
}

export async function mergeGuestItems(
  shopId: string,
  shopifyCustomerId: string,
  guest: {
    wishlist?: UpsertItemInput[];
    saved?: UpsertItemInput[];
  },
) {
  const ops: Promise<unknown>[] = [];
  for (const w of guest.wishlist || []) {
    ops.push(
      addItem({ ...w, shopId, shopifyCustomerId, kind: "wishlist" }).catch(
        () => undefined,
      ),
    );
  }
  for (const s of guest.saved || []) {
    ops.push(
      addItem({ ...s, shopId, shopifyCustomerId, kind: "saved" }).catch(
        () => undefined,
      ),
    );
  }
  await Promise.all(ops);
  return listForCustomer(shopId, shopifyCustomerId);
}
