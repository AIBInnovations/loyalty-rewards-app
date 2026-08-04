import { Customer } from "./models/customer.model";

/**
 * Whether a storefront visitor may use a given plugin. Guests (no logged-in
 * customer id) are always allowed — access control only applies to
 * customers an admin has explicitly restricted. A customer with no record,
 * or a record with no override for this plugin, defaults to allowed.
 */
export async function hasPluginAccess(
  shopId: string,
  shopifyCustomerId: string | null,
  pluginKey: string,
): Promise<boolean> {
  if (!shopifyCustomerId) return true;
  const customer = await Customer.findOne(
    { shopId, shopifyCustomerId },
    { pluginAccess: 1 },
  ).lean();
  if (!customer?.pluginAccess) return true;
  return customer.pluginAccess[pluginKey] !== false;
}
