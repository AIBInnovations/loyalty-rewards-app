import type { Model } from "mongoose";

import { AbandonedCart } from "./abandoned-cart.model";
import { AuditLog } from "./audit-log.model";
import { Bundle, BundleSettings, BundleAnalyticsDaily } from "./bundle.model";
import { CartDrawerSettings } from "./cart-settings.model";
import { CodSettings } from "./cod-settings.model";
import { Customer } from "./customer.model";
import { FaqSettings } from "./faq-settings.model";
import { FeatureFlag } from "./feature-flag.model";
import { ImageEmbedding } from "./image-embedding.model";
import { ImageSearchLog } from "./image-search-log.model";
import { ImageSearchSettings } from "./image-search-settings.model";
import { ImageSyncJob } from "./image-sync-job.model";
import { OrderCache } from "./order-cache.model";
import { PincodeSettings } from "./pincode-settings.model";
import { PlatformShop } from "./platform-shop.model";
import { PluginConfig } from "./plugin-config.model";
import { PopupSettings } from "./popup-settings.model";
import { ProductCache } from "./product-cache.model";
import { Question, Review } from "./review.model";
import { Redemption } from "./redemption.model";
import { ReviewSettings } from "./review-settings.model";
import { Reward } from "./reward.model";
import { SalesPopEvent } from "./sales-pop-event.model";
import { SalesPopSettings } from "./sales-pop-settings.model";
import { Settings } from "./settings.model";
import { ShopToken } from "./shop-token.model";
import { SizeGuideSettings } from "./size-guide-settings.model";
import { SmartPopupLead, SmartPopupSettings } from "./smart-popup.model";
import { StorefrontConfig } from "./storefront-config.model";
import { StorefrontDomain } from "./storefront-domain.model";
import { Subscriber } from "./subscriber.model";
import { Subscription } from "./subscription.model";
import { SyncJob } from "./sync-job.model";
import { TimerSettings } from "./timer-settings.model";
import { Transaction } from "./transaction.model";
import { TrustBadgesSettings } from "./trust-badges.model";
import { UGCSettings } from "./ugc-settings.model";
import { UpsellSettings } from "./upsell-settings.model";
import { VoiceAgentSettings } from "./voice-agent-settings.model";
import { VolumeDiscountSettings } from "./volume-discount.model";
import { WebhookEvent } from "./webhook-event.model";
import { WheelSettings } from "./wheel-settings.model";
import { WheelSpinToken } from "./wheel-spin-token.model";
import { WishlistItem } from "./wishlist.model";
import { WishlistSettings } from "./wishlist-settings.model";

/**
 * Every model holding shop-scoped data.
 *
 * This exists so GDPR shop/redact cannot silently miss collections as new
 * features are added. The original implementation deleted 5 of what is now 46,
 * leaving behind customer phone numbers and call transcripts (AbandonedCart),
 * buyer names and cities (SalesPopEvent), emails (Subscriber, SmartPopupLead),
 * and encrypted-but-recoverable access tokens (ShopToken) after uninstall.
 *
 * When you add a model with a `shopId`, add it here. The test in
 * registry.test.ts reads this directory and fails if you forget.
 */
export const SHOP_SCOPED_MODELS: Model<any>[] = [
  AbandonedCart,
  AuditLog,
  Bundle,
  BundleAnalyticsDaily,
  BundleSettings,
  CartDrawerSettings,
  CodSettings,
  Customer,
  FaqSettings,
  FeatureFlag,
  ImageEmbedding,
  ImageSearchLog,
  ImageSearchSettings,
  ImageSyncJob,
  OrderCache,
  PincodeSettings,
  PlatformShop,
  PluginConfig,
  PopupSettings,
  ProductCache,
  Question,
  Redemption,
  Review,
  ReviewSettings,
  Reward,
  SalesPopEvent,
  SalesPopSettings,
  Settings,
  ShopToken,
  SizeGuideSettings,
  SmartPopupLead,
  SmartPopupSettings,
  StorefrontConfig,
  StorefrontDomain,
  Subscriber,
  Subscription,
  SyncJob,
  TimerSettings,
  Transaction,
  TrustBadgesSettings,
  UGCSettings,
  UpsellSettings,
  VoiceAgentSettings,
  VolumeDiscountSettings,
  WebhookEvent,
  WheelSettings,
  WheelSpinToken,
  WishlistItem,
  WishlistSettings,
];

/**
 * Models holding data attributable to an individual customer, used by
 * customers/redact. Keyed variously by internal customerId, Shopify customer
 * id, or email — see handleCustomerRedact for how each is matched.
 */
export const CUSTOMER_SCOPED_MODELS: Model<any>[] = [
  AbandonedCart,
  Customer,
  Redemption,
  Review,
  Question,
  SalesPopEvent,
  SmartPopupLead,
  Subscriber,
  Transaction,
  WishlistItem,
];
