# Production Readiness Plan — Loyalty & Rewards App

Consolidated from a five-track audit (security/auth, data layer, admin routes, storefront extension, infra/ops) covering ~16.4k LOC: 24 models, 14 services, 29 routes, 17 theme extension blocks.

**Current verdict: not production-ready, and not App Store submittable.**

The app is genuinely feature-rich — loyalty points, referrals, reviews, UGC, spin wheel, exit popups, countdown timers, COD/WhatsApp, voice-agent cart recovery, and CLIP image search. The problem is not capability, it's that the feature surface grew far faster than the foundations under it. Concretely: **18 merchant-facing features, 0 tests, 0 CI, 1 error boundary, and no billing.**

Three distinct classes of problem, in priority order:

1. **Active security holes** — a leaked live credential, cross-tenant data access, and stored XSS reachable from any storefront visitor.
2. **Silent data corruption** — the points ledger has three independent bugs that are drifting customer balances *right now* in any shop with these features enabled.
3. **Structural gaps** — no billing, no tests, no CI, unregistered GDPR webhooks, single-instance-only job scheduling.

---

## Phase 0 — Emergency (today)

### 0.1 Revoke the leaked Gmail App Password
`.env.example:11-13` contains a real Google App Password (`SMTP_PASS=sniebkgrvlbejhjm`), committed and present across multiple points in git history.

1. Revoke it at myaccount.google.com/apppasswords **first** — history rewriting does not help if the repo was ever pushed, cloned, or shared.
2. Replace with placeholders; verify no real `MONGODB_URI` cluster credential was ever committed.
3. `git filter-repo --path .env.example` to purge, then force-push and have collaborators re-clone.

Note one prior commit is titled *"Fix .env.example - remove localhost and use proper placeholders"* — the cleanup happened but missed the SMTP block.

### 0.2 Close the cross-tenant reward IDOR
`app/routes/app.rewards.tsx:67,78,87` — the `update`, `toggle`, and `delete` branches pass a client-supplied `_id` to `findByIdAndUpdate` / `findById` / `findByIdAndDelete` with no `shopId` filter. **Any authenticated merchant can edit or delete another store's rewards** by posting an arbitrary ObjectId.

The loader (`:28`) and the `create` branch (`:55`) scope correctly, and `app.customers.$id.tsx:30,93` scopes correctly — so this is an oversight, not a convention. Fix: `Reward.findOneAndUpdate({ _id: id, shopId: session.shop }, ...)` and 404 on null.

### 0.3 Fail closed on the ElevenLabs webhook
`app/routes/api.voice-webhook.tsx:50` — signature verification is wrapped in `if (webhookSecret)`. `ELEVENLABS_WEBHOOK_SECRET` appears in neither `.env.example` nor `render.yaml`, so it is almost certainly unset in production and **the endpoint currently accepts anonymous POSTs**. The comparison at `:34` is also a plain `===`, not `timingSafeEqual`.

Downstream, `voice-agent.service.ts:218` does `AbandonedCart.findOne({ callId })` with no shop scoping and no index — so this is a cross-tenant write primitive reachable by guessing a conversation ID.

Fix: `if (!webhookSecret) return 401`, switch to `crypto.timingSafeEqual`, scope the lookup by shop, add the env var to `render.yaml` with `sync: false`.

---

## Phase 1 — Ledger correctness (this week)

These are actively corrupting data. Any shop with points expiry enabled is having balances silently zeroed.

### 1.1 Points expiry re-expires the same points every night — CRITICAL
`jobs.service.ts:130` checks `Transaction.exists({ idempotencyKey: \`expire_${tx._id}\` })` but `:162` writes `expire_batch_${custId}_${Date.now()}`. The key checked is **never** the key written, and the written key embeds `Date.now()` so it can never dedupe. The 02:00 job re-finds the same expired `EARN` rows every night and deducts again until the balance hits zero.

Fix: write one `EXPIRE` transaction per source transaction keyed `expire_${tx._id}`, or add an `expiredAt` field set in the same `updateMany` that selects the batch.

### 1.2 `earnPoints` idempotency is a TOCTOU race
`points.service.ts:73-125` — `findOne({idempotencyKey})` → `$inc` balance → `Transaction.create()`. Shopify retries `orders/paid` aggressively; two concurrent deliveries both pass the check, both increment, and the second `create` fails on the unique index. **Balance stays double-credited with one transaction record.** Same shape in `reversePoints` (`:283-315`).

Fix: invert — insert the Transaction first and let the unique index be the lock (catch E11000, return null), then `$inc` and backfill `balanceAfter`.

### 1.3 Redemption can silently drain points
`points.service.ts:176-219` — the `$gte`-guarded `$inc` at `:176` is correctly atomic, but `createRedemptionDiscount()` runs *after* the deduction. `discount.service.ts:108,116` throws on `userErrors` or a missing ID — which includes throttling, expired tokens, and Shopify 5xx. When it throws, points are gone, no discount exists, and the `Redemption`/`Transaction` rows at `:210-231` never run, so **there is no audit trail to reconcile from**. The customer sees "Failed" with a drained balance (`api.proxy.$.tsx:503`).

Fix: create the `Redemption` in `PENDING` before calling Shopify, and re-credit with a compensating `ADJUST` transaction on failure. Also add the missing `idempotencyKey` to the `REDEEM` transaction (`:222-231`).

### 1.4 `reversePoints` can drive balances negative
`points.service.ts:291-301` reads the balance, computes `Math.min(points, balance)`, then `$inc`s. Two concurrent refunds both read 100, both deduct 100 → −100. The schema's `min: 0` does **not** protect: Mongoose validators don't run on `findOneAndUpdate` without `runValidators`, and `min` never applies to `$inc` at all.

Fix: one atomic pipeline update using `$max: [0, {$subtract: [...]}]`, then derive the actual deduction from the returned doc.

### 1.5 Lost updates via full-document `.save()`
`points.service.ts:100-103` calls `customer.save()` after the `$inc` to update the tier — writing back the whole document including a now-stale `currentBalance`, silently discarding any concurrent increment. Same pattern at `api.proxy.$.tsx:540,757` and `voice-agent.service.ts:89,107,137,157,170,250`.

Fix: targeted `updateOne({_id}, {$set: {tier}})` everywhere.

### 1.6 `maxUsesPerCustomer` is declared but never enforced
`reward.model.ts:30` defines it; nothing reads it. Customers can redeem the same reward unlimited times.

---

## Phase 2 — Storefront security (this week)

### 2.1 Stored XSS in reviews — zero-click when auto-approve is on
`assets/reviews.js:84-92,110-111,127` interpolates `authorName`, `body`, `question`, `answer`, and `photoUrls` into `innerHTML` with **no escaping** — the file has no escape helper at all. `photoUrls` lands in `src="' + u + '"`, allowing `" onerror=` breakout. Submission (`api.proxy.$.tsx:902-934`) applies no sanitization, no length cap, no URL validation. With `autoApprove` on, an attacker's payload renders to every visitor of that product page immediately.

Fix: lift the `escAttr`/`escHtml` pair that already exists in `image-search.js:446-459`; validate `photoUrls` against `^https://` server-side; cap lengths.

### 2.2 Review identity is fully spoofable
`api.proxy.$.tsx:919,930` trusts `authorName`, `authorEmail`, and `customerId` from the JSON body. The loader **already computes** a trustworthy `getCustomerIdFromProxy(params)` at `:76` from Shopify's signed `logged_in_customer_id` — `handleSubmitReview` just ignores it. Any visitor can post a review attributed to any customer, including "verified buyer" status.

Fix: drop those three fields from the body and derive server-side.

### 2.3 The shared `esc()` helper doesn't escape quotes
`exit-popup.js:173`, `spin-wheel.js:199`, `cart-drawer.js:64`, `countdown-timer.js:342` all use a `textContent`→`innerHTML` round-trip, which escapes `& < >` but **not `"` or `'`**. Every use inside an attribute is therefore unsafe (`exit-popup.js:83`, `spin-wheel.js:63`). Separately, `countdown-timer.js:76-81` concatenates DB colors straight into `styleEl.textContent` (CSS injection → selector takeover) and `:173-174` injects `messageTemplate` raw.

Fix: separate `escAttr` for attribute contexts; validate colors against `/^#[0-9a-f]{3,8}$/i` — the pattern already exists at `loyalty-widget.js:30`.

Same raw-`innerHTML` treatment needed in `recently-viewed.js:67-73`, `sticky-atc.js:33-35`, `post-purchase-upsell.js:44-48`, `ugc-gallery.js:28,32`.

### 2.4 Unlimited discount minting via wheel spin and popup
`api.proxy.$.tsx:107-117` — `handlePopupSubmit` and `handleWheelSpin` have **no `checkRateLimit` call**, unlike their neighbors at `:86,93,144`. Both mint real Shopify discount codes.

The proxy signature does not help here: Shopify signs whatever the storefront JS sends, so a real visitor gets a valid signature for any email. The only dedup is `Subscriber.findOne({shopId, email, source})`, bypassed with `attacker+1@`, `attacker+2@`. `Subscriber.email` also lacks `lowercase: true`, so `Foo@x.com` bypasses the check for `foo@x.com`.

Fix: rate-limit by IP+shop, normalize emails (lowercase, strip `+` tags) before dedup, add a per-shop daily cap on code creation.

### 2.5 Upsell charges full price while displaying a discount
`post-purchase-upsell.js:36-53` computes and shows `finalPrice` with a `% OFF` badge, but `:69-76` adds the variant at full price with the discount recorded only as a line-item property. **Customers are charged the undiscounted amount.** This is a chargeback and consumer-protection issue, not just a bug.

### 2.6 State-changing operations over GET
`loyalty-widget.js:101` (`/redeem` — mints a code and debits points), `:137`, `:150`; also `back-in-stock.js:114`, `exit-popup.js:126`, `spin-wheel.js:128`. The code comment claiming the proxy can't forward POST bodies is incorrect — `image-search.js:367` and `reviews.js:163` both POST successfully. GET makes these prefetchable, replayable from an `<img src>`, and intermediary-cacheable.

---

## Phase 3 — App Store blockers

### 3.1 There is no billing implementation at all
No `billing` config in `shopifyApp()` (`shopify.server.ts:9-38`), no `billing.require()`, no managed pricing in either TOML, no plan gating on any of the 18 features. Every merchant currently gets ElevenLabs voice calls, WhatsApp sends, and HuggingFace CLIP inference **entirely at your cost**.

Simplest path: Shopify Managed Pricing (Partner Dashboard, no code). For per-feature gating, add `billing` to `shopifyApp()` and call `billing.require()` in `app/routes/app.tsx:14` so every child route inherits it.

### 3.2 GDPR webhooks are implemented but never subscribed
`webhooks.tsx:93-103` handles all three mandatory topics. Neither TOML declares them and `webhook-register.service.ts:40-52` omits them — so **Shopify never calls them** and the handlers are dead code. Automated review fails on this.

```toml
[webhooks.privacy_compliance]
customer_data_request_url = "https://…/webhooks"
customer_deletion_url     = "https://…/webhooks"
shop_deletion_url         = "https://…/webhooks"
```

### 3.3 The redact handlers delete 5 of 24 collections
`webhook.service.ts:357-372` deletes `Transaction`, `Redemption`, `Customer`, `Settings`, `Reward`. It leaves behind `AbandonedCart` (**phone numbers and call transcripts**), `Subscriber` (emails), `Review`/`Question` (names, emails), `ImageEmbedding`, `ImageSearchLog`, `ImageSyncJob`, and all 12 `*Settings` docs — including the plaintext API keys. Shop data must be gone 48h after uninstall.

Fix: enumerate every model, `deleteMany({shopId})` across all; add a test asserting the list matches the model registry so new models can't be forgotten.

`customers/data_request` (`:323-334`) is also a logging stub with a "in production: generate export" comment. It needs a real implementation.

### 3.4 Two divergent TOMLs; the active one drops the core webhooks
`shopify.app.toml` (active) subscribes only to `products/*` and `app/uninstalled`. **The entire points engine depends on `orders/paid`**, which exists only in the stale `shopify.app.loyalty-and-rewards-app.toml`.

This is currently masked by `webhook-register.service.ts` re-registering imperatively 5 seconds after boot via a Mongo session scan — which silently no-ops if `SHOPIFY_APP_URL` is unset (`:16-19`), races on slow Mongo, and misses any shop installing in that window.

Fix: merge into one TOML with all topics, delete the stale file, and delete `webhook-register.service.ts` — `shopify.server.ts:29-31` already calls `registerWebhooks` in `afterAuth`, which is the correct mechanism. Also note `read_checkouts` is missing despite `CHECKOUTS_CREATE/UPDATE` handling at `webhooks.tsx:64-67`.

### 3.5 Theme extension will likely be rejected
No block emits `{{ block.shopify_attributes }}`, so app blocks can't be selected in the theme editor. Nothing listens for `shopify:section:load` or `shopify:block:select`, so widgets die when a merchant edits a section. Most widgets are `target: "body"` embeds that guess at DOM insertion points — `countdown-timer.js:271-291` tries eight selectors and falls back to `[class*="product"]`. This guess-the-theme-DOM pattern is a common rejection reason.

---

## Phase 4 — Infrastructure

### 4.1 Render `free` plan structurally cannot run this app
`render.yaml:6` — free instances spin down after ~15 min idle. All 7 `node-cron` schedules die with the process. Birthday bonuses (08:00) and points expiry (02:00) will **essentially never fire**. Abandoned-cart polling and the call queue stop entirely. The 512 MB cap also can't hold `sharp` + CLIP embeddings.

There's also no `healthCheckPath` and no health route among the 29 routes.

Fix: `plan: starter` minimum, add `app/routes/healthz.tsx` with a DB ping, set `healthCheckPath: /healthz`.

### 4.2 In-process cron breaks the moment you scale past one instance
7 schedules started from module scope in `entry.server.tsx:18-25`. With N replicas you get N concurrent runs of everything — duplicate **paid** ElevenLabs phone calls, double refunds (`jobs.service.ts:65` `$inc`s before the guarded `Transaction.create`), double expiry.

Staged fix:
1. Stopgap: gate on `process.env.RUN_CRON === "true"`, set on one instance.
2. Required regardless: convert `find()`-then-loop into atomic `findOneAndUpdate` leases (`{status:"scheduled"} → {status:"calling"}`) so work is claimed, not read.
3. Structural: a separate worker service, or Mongo-backed distributed locks with lease TTLs.

Also: `voice-agent.service.ts:71-75` and `jobs.service.ts:53-56` select globally with a `.limit()`, so one high-volume shop **permanently starves every other tenant**. Partition or round-robin by `shopId`.

### 4.3 Connection management
`db.server.ts` (30 lines) needs a rewrite:
- **Connect race** — `isConnected` is set only *after* `await connect()`, so concurrent cold-start handlers all call `mongoose.connect()`. Cache the promise, not a boolean.
- **Zero tuning** — no `maxPoolSize`, `serverSelectionTimeoutMS`, `socketTimeoutMS`. Suggest `{maxPoolSize: 20, minPoolSize: 2, serverSelectionTimeoutMS: 5000, socketTimeoutMS: 45000}`.
- **`autoIndex` on in production** — all 24 models attempt index builds on every boot, and when a definition *changes* Mongo rejects the conflicting spec and Mongoose swallows it into the error handler at `:27`. **Your index changes will silently not apply.**
- **Dead reconnect handler** at `:21-24` — flips a flag, reconnects nothing, while the driver is already auto-reconnecting.
- **Two separate pools** to the same cluster — `shopify.server.ts:16` builds its own `MongoClient` for session storage.

### 4.4 No tests, no CI, and the quality scripts don't run
Zero `*.test.ts`/`*.spec.ts` anywhere and no `vitest.config.ts`, despite `vitest` being a dependency. No `.github/` directory at all.

Worse: **`eslint` itself is not a dependency** (only `@remix-run/eslint-config`) and there's no `.eslintrc*`, so `npm run lint` fails with `MODULE_NOT_FOUND`. There's **no `typecheck` script**, so `strict: true` is never enforced anywhere.

Fix: add `eslint` + config, add `"typecheck": "tsc --noEmit"`, add GitHub Actions running typecheck → lint → build on PR. Highest-value first tests: `points.service.ts` idempotency (Phase 1), proxy HMAC verification, the webhook topic router.

### 4.5 No env validation, no graceful shutdown
`shopify.server.ts:10-17` papers over every missing secret — `apiKey: process.env.SHOPIFY_API_KEY!`, `apiSecretKey: … || ""`, and `MONGODB_URI` silently defaulting to `mongodb://localhost:27017`. A misconfigured production deploy connects to a nonexistent local DB and fails at request time with a confusing error instead of at boot.

Nothing registers `SIGTERM`/`SIGINT`. Every Render deploy kills in-flight cron work mid-write — a `$inc` can land with its `Transaction.create` never running, causing permanent balance drift.

Related: `entry.server.tsx:18-26` chains all init off `connectDB()` ending in `.catch(console.error)` — if Mongo is down at boot the app **starts healthy and serves traffic** with no jobs, no webhooks, and no indexing, silently, forever.

### 4.6 Observability is 102 `console.*` calls
No structured logger, no Sentry, no metrics, no request tracing. Two specific problems beyond ergonomics:
- **PII in logs** — `abandoned-cart-poller.service.ts:147,163` and `voice-agent.service.ts:82,98` log full customer names and phone numbers on every poll, with no retention policy.
- **Secret in logs** — `voice-agent.service.ts:111` logs `elevenLabsApiKey.slice(0, 10)`.

Fix: `pino` with redaction paths for `phone`/`email`/`*ApiKey`, Sentry wired into `entry.server.tsx`'s `onError` and the route boundaries, request IDs on webhooks.

### 4.7 Dockerfile
Single-stage, runs as **root**, no `HEALTHCHECK`, and `COPY . .` with **no `.dockerignore`** — which would copy a local `.env` straight into the image. `libvips-dev` (~100 MB, dev package) is installed and never removed; `sharp` ships prebuilt binaries and doesn't need it.

### 4.8 Dependencies
`npm audit --omit=dev`: **14 high, 15 moderate, 1 low**. `ws` 7.x (memory-exhaustion DoS) clears with a non-breaking `npm audit fix`.

Also: Shopify API `2025-01` is hardcoded in six places and is at/near end of support — centralize on the exported `apiVersion`. Remix v2 → React Router v7 and `@shopify/shopify-app-remix` v3 → v4 are worth planning before they get more expensive. `nodemailer@^8.0.5` looks wrong and `npm ls` returns empty — verify with a clean `npm ci`.

---

## Phase 5 — Performance & scale

### 5.1 Missing indexes
Every model indexes `shopId`, but **no shop-scoped sort or filter compound index exists anywhere** — every admin list sorts in memory, and Mongo aborts in-memory sorts above 32 MB.

Highest priority:

| Query | Location | Needed index |
|---|---|---|
| Transactions list + dashboard | `app.transactions.tsx:34`, `app._index.tsx:50` | `{shopId:1, createdAt:-1}` |
| Dashboard EARN aggregate | `app._index.tsx:44` | `{shopId:1, type:1, points:1}` (covered) |
| **Reviews on every product page** | `api.proxy.$.tsx:882` | `{shopId:1, productId:1, status:1, createdAt:-1}` |
| Image search logs | `app.image-search-logs.tsx:25,51` | `{shopId:1, createdAt:-1}` |
| Customers list | `app.customers.tsx:38` | `{shopId:1, lifetimeEarned:-1}` |
| ElevenLabs webhook | `voice-agent.service.ts:218` | `{callId:1}` sparse — currently a **collscan per webhook** |

Two queries are **unindexable as written**: customer search uses three unanchored `$regex /i` (`app.customers.tsx:30-34`) — always a collscan; and the birthday job uses `$expr` with `$month`/`$dayOfMonth` (`jobs.service.ts:181-198`), collscanning every customer of every shop nightly. Store `emailLower` and `birthdayMonthDay: "MM-DD"` respectively.

### 5.2 No migration story — this blocks 5.1
No `migrations/` directory, no migration library, no `schemaVersion`, no `syncIndexes()` call anywhere. Combined with `autoIndex: true` (4.3), **you cannot currently ship any index change or backfill without manual `mongosh` work on the production cluster.**

Fix, in this order: `autoIndex: false` in prod → `migrations/` with numbered idempotent scripts and a `_migrations` collection → `npm run migrate` in the start command or a Render pre-deploy job → build the 5.1 indexes with `{background: true}`.

### 5.3 No TTL or retention anywhere
No TTL index on any collection. `ImageSearchLog` (one doc per storefront search), `ImageSyncJob` (see 5.6), and `AbandonedCart` (**phone numbers, call transcripts, recording URLs**) grow forever. The `AbandonedCart` case is a live GDPR exposure.

### 5.4 Zero GraphQL throttle handling
No `THROTTLED` check, no cost parsing, no backoff, no bulk operations anywhere:
- `discount.service.ts:94-107` checks `userErrors` but never `result.errors` or HTTP 429. A throttled response yields `undefined` and throws "Discount created but no ID returned" — **with the customer's points already deducted** (see 1.3).
- `image-index-jobs.service.ts:32` paginates at **`first: 10`**. A 10,000-product catalog is 1,000 sequential round trips with no backoff, and `:36-38` throws away the whole job on the first error — losing all progress.
- `app.settings.tsx:65` does `shopData.data.shop.id` with no null guard; a throttled response reports "Failed to save settings" even though the Mongo write at `:39` already succeeded.

Fix: a shared `graphqlWithRetry()` honoring `extensions.cost.throttleStatus`; `first: 250`; a Bulk Operation for the initial catalog index.

### 5.5 Storefront weight — ~217 KB shipped site-wide
13 of 17 blocks are `target: "body"` embeds, so their assets load on **every page** regardless of relevance — `cart-drawer.js` (46 KB) runs on your 404 page. Only 4 blocks gate by `template.name`.

Worst offender: `blocks/countdown-timer.liquid:22` loads a **render-blocking stylesheet from the app proxy** on every page view — putting your server's latency directly in the critical rendering path, for a cosmetic override `countdown-timer.js:69-82` already applies. Delete that line; it alone will hurt the Web Performance score.

Also: `cart-drawer.js:723-767` **monkey-patches global `fetch` and `XMLHttpRequest`** — the classic cause of "installing app X broke app Y". It also double-fires (the `submit` handler at `:709` calls the patched `fetch`, re-triggering the interceptor), and `injectNativeCartHideCSS()` runs unconditionally at `:788`, so if your fetch throws the merchant has **no cart UI at all**.

### 5.6 Product reindexing is silently broken
Two same-named `enqueueProductForIndexing` functions exist: `image-search.service.ts:236` (writes an `ImageSyncJob`, no-op) and `image-index-jobs.service.ts:269` (does the real work). **`webhooks.tsx:69-84` calls the wrong one** — so `ImageSyncJob` is a write-only collection nothing ever drains, and product changes never reindex.

Separately, `image-search.service.ts:111-114` loads **every** embedding for the shop into Node and scores cosine similarity in JS, per search request. At ~4 KB/doc, 10k products = 40 MB+ transferred per search. The file header at `:11-14` claims `$vectorSearch` with an HNSW prefilter — that comment is stale and contradicts the code.

### 5.7 N+1 patterns
`app.referrals.tsx:50-78` fires **~201 queries per page load** (a `Promise.all` over 100 customers, each doing a `findOne` plus an `exists`). Reducible to 3 with an `$in` lookup plus one aggregate. Also `jobs.service.ts:127-139,142-163,200-221` and `image-index-jobs.service.ts:189-203` (a full `countDocuments` on every 10-product batch — 500 scans for a 5k catalog).

---

## Phase 5.5 — UI/UX improvements & enhancements

A separate design review of the 20 admin routes and 15 widget stylesheets. The summary: **the app presents as an internal tool, not a paid product.** Flat nav, no onboarding, no save feedback, no design system in the storefront widgets.

### 5.5.1 Information architecture: 18 flat nav items
`app.tsx:23-42` renders 18 sibling links — no hierarchy, arbitrary order, and `app.image-search-logs` isn't in the nav at all (orphaned). App Bridge `NavMenu` can't nest, so the fix is structural: collapse to **6 top-level entries** with in-page `Tabs` / card-grid index pages.

| Nav item | Contains |
|---|---|
| Home | Dashboard |
| Loyalty | Rewards · Customers · Transactions · Referrals |
| Conversion | Timer · Exit Popup · Spin Wheel · Sticky ATC · Upsell · Cart Drawer |
| Merchandising | Image Search (+ Analytics tab) · UGC · Reviews & Q&A · Recently Viewed · Trust Badges |
| Logistics | Pincode · Stock Alerts · COD WhatsApp · Voice Agent |
| Settings | Program config · Billing · Theme status |

Each group page is a grid of tiles showing `Live` vs `Not set up` per feature — which doubles as the feature-adoption surface below. Keep existing routes; add group index routes.

Also standardize `backAction` (currently three different shapes across routes) and Save-button placement (5 routes use `Page primaryAction`, 4 bury a button at the page bottom).

### 5.5.2 Dashboard rebuild
Today: 4 vanity stat cards, a 2-line status card, and a 10-row `DataTable`. It reports on **1 of 18 features**.

- **Replace the KPIs** with metrics that justify a subscription: revenue from redeeming members vs non-members, repeat-purchase rate members vs non-members, **points liability** (outstanding balance × value — merchants ask for this by name), redemption rate, active members. Each with a period-over-period delta and a 7/30/90-day picker.
- **Add charts** (none exist anywhere): points issued vs redeemed over time (shows liability accruing), and members by tier. Use `@shopify/polaris-viz` — Polaris-native theming and accessible data tables built in.
- **Feature adoption grid** — the highest-leverage addition. A tile per *disabled* feature with a one-line benefit and a deep link to its setup page. This is what turns 18 orphaned nav items into a discoverable product.
- **Activity feed** replacing the `DataTable` — `ResourceList` with avatars and relative timestamps, covering all features (wheel spins, reviews, stock alerts), not just points.
- **Quick actions** and a real `SettingToggle` for program pause/resume (currently buried in Settings).

The same flat-stat-grid pattern is repeated in `app.referrals.tsx:107-141` and `app.image-search-logs.tsx:111-140` (which crams **9 stat cards into one wrapping row**).

### 5.5.3 Onboarding — currently zero
No onboarding route, no checklist, no first-run detection. A merchant installs, lands on a dashboard of zeros, and is never told that **every widget requires manually enabling an app embed in the theme editor**. That instruction appears only as a passive banner at the *bottom* of individual settings pages.

`app.image-search-settings.tsx:70-87` already builds a correct theme-editor deep link (`?context=apps&activateAppId={UUID}/{HANDLE}`) — **in exactly 1 of 16 features.** Extract to a shared helper and use everywhere.

Build: post-install redirect → checklist (earning rate inline, "Use recommended tiers" to seed rewards and remove the blank slate, theme activation deep link with a screenshot, program toggle) → `ProgressBar` → dismissible dashboard version until complete.

**Also detect whether the embed is actually active** by inspecting the published theme, and show a persistent warning banner if not. This is the single largest source of "the app doesn't work" tickets for embed-based apps.

### 5.5.4 Feedback: saves are silent — *(done, see status)*
No `Toast`, `Frame`, or `SaveBar` existed anywhere. Every settings route returned `{success: true}` and **no component read it**. Merchants clicked Save and got a spinner that stopped.

Still to do: an **unsaved-changes bar**. Every settings page holds local `useState` copies and never diffs them against the loaded values, so navigating away silently discards work. Use App Bridge `SaveBar` driven by an `isDirty` check (Polaris `ContextualSaveBar` is deprecated for embedded apps).

### 5.5.5 Settings page UX
- **11 raw hex text fields** for colors across 7 routes. Note `app.upsell-settings.tsx:5` **already imports `ColorPicker, hsbToHex, hexToRgb` and never uses them.** Build one `<ColorField>` (swatch + `Popover` + `ColorPicker` + brand presets) and add a contrast warning — `app.timer-settings.tsx:246-257` currently allows white-on-white.
- **No live preview on any of the 12 settings pages.** Merchants configure the timer, popup, wheel, and cart drawer completely blind. Add a sticky preview pane in a `oneThird` column, in order of impact: Timer → Exit Popup → Spin Wheel (with a "Test spin" button and probability-sums-to-100 validation) → Cart Drawer → Upsell.
- **`app.cart-settings.tsx` is 537 lines in one scroll** — split into Tabs (Appearance · Free shipping · Recommendations · Checkout · Advanced).
- **Replace free-text with pickers**: product handle (`app.upsell-settings.tsx:85-92`) → App Bridge `ResourcePicker`; product tags (`app.timer-settings.tsx:281-288`) → `Autocomplete` seeded from real tags; sale end date → `DatePicker` **with a timezone indicator** (currently absent, so deadlines are ambiguous).
- Standardize on `Layout.AnnotatedSection` — currently half the routes use it and half don't, making the app look like two products.

### 5.5.6 Data tables
No `IndexFilters`, no sorting UI, no bulk actions, no CSV export anywhere.
- **Customers**: `IndexFilters` with tier/balance/date filters, sortable columns, saved views ("Top 100 by value", "At risk", "Expiring soon"), and bulk actions — **bulk point grants are a top-requested loyalty feature**. Enable `selectable` (currently hardcoded `false`).
- **Transactions**: needs a **date range filter** (it's a ledger) and **CSV export** — merchants need this to reconcile points liability for accounting. Close to a hard requirement for a paid loyalty app.
- **Reviews moderation** (`app.reviews-settings.tsx:152-193`) is a stack of nested `Card`s with no pagination and no bulk approve — unusable at 50 pending. Convert to `IndexTable` with bulk approve/reject and status tabs.
- **Image search logs**: add a "Zero-result searches" saved view — those are catalog gaps and the actionable segment.
- Pick one table component: `IndexTable` for anything actionable, `DataTable` only for read-only summaries. Currently both are used interchangeably across 11 routes.

### 5.5.7 Storefront widget design system
The widgets don't look like one product, or like the merchant's store:
- **Zero theme tokens.** The same system font stack is copy-pasted into **13 files** instead of `var(--font-body-family)`. The widgets never inherit the merchant's typography.
- **No color system.** `#5C6AC4` hardcoded in 10 files; **4 different reds** for the same semantic, 2 greens, 8 greys. The spin wheel uses pink `#e91e63` — a different hue from every sibling widget.
- **No dark mode.** Zero `prefers-color-scheme` rules. Four stylesheets set dark text with **no background**, rendering as invisible text on dark themes.
- **No scale.** 13 border-radius values, 20+ box-shadows, `font-size: 8px` in two places, a fractional `12.5px`.
- **Z-index collisions** — three widgets tie at 9998, so the sticky ATC bar and loyalty FAB render *on top of* the exit popup's modal. The WhatsApp button and loyalty FAB occupy identical pixels.
- **`.rv-card` is defined by both `recently-viewed.css` and `reviews.css`** — whichever loads second wins.
- **Mobile**: one breakpoint per file, no tablet breakpoint, and **`env(safe-area-inset-*)` appears zero times** — the sticky ATC button sits under the iPhone home indicator.

**One change fixes most of this**: a `widget-base.css` defining font/color/spacing/radius/elevation/z-index scales. It resolves theming, dark mode, consistency, and collisions simultaneously.

### 5.5.8 Accessibility
Storefront is the more serious half, since it faces customers:
- **Focus trap: none.** `.focus(` returns **zero hits across every widget JS file** — no dialog takes focus, constrains Tab, or restores focus on close.
- **`role="dialog"`: 1 of 6 dialogs.** **Escape-to-close: 2 of 6** — a customer hit by the exit popup or spin wheel literally cannot dismiss it by keyboard.
- **`aria-live`: zero occurrences** — cart updates, pincode results, and discount codes are all silent to screen readers.
- **`ugc-gallery.js:31` uses a `div` with a click handler** — the entire UGC gallery is keyboard-inoperable. The star-rating input is `<span>`s with no `role="radiogroup"`.
- Close buttons render `<button>✕</button>` with no accessible name.
- `outline: none` with no replacement in 6 stylesheets; no `:focus-visible` anywhere.
- Touch targets below 44px in 6 places, including the cart quantity stepper (the highest-frequency tap in the drawer).

Admin: the search input has `label=""` (no accessible name), and `app.rewards.tsx` uses `window.confirm()` for delete — visually broken and a focus trap inside an embedded iframe.

### 5.5.9 Premium polish
No billing UI, no help/docs surface, no changelog, no app branding (the same stock Shopify illustration is reused 7 times), thin `Page` metadata, **hardcoded `₹` and `en-IN` across 8 routes** (the app is unusable outside India), and no optimistic UI — reward toggles round-trip and re-render the whole page.

---

## Phase 6 — Product & code quality

### 6.1 Secrets are plaintext and shipped to the browser
`voice-agent-settings.model.ts:38`, `cod-settings.model.ts:17`, `image-search-settings.model.ts:33` store API keys and a Meta permanent token in plaintext. Worse, `app.voice-agent.tsx:39-40` does `JSON.parse(JSON.stringify(settings))` — shipping the full doc **including the API key** into the page HTML. Same pattern in `app.cod-settings.tsx:15` and `app.image-search-settings.tsx`; the `type="password"` masking at `:90` is cosmetic only.

Fix: encrypt at rest (AES-GCM with a KMS/env key); `.select("-elevenLabsApiKey -whatsappToken -_accessToken")` in every loader; send `hasToken: boolean` and treat an empty submitted field as "unchanged".

### 6.2 No input validation anywhere
No `zod`/`yup`/`joi` in the project. Every action pipes `formData()` straight into Mongoose:
- `app.settings.tsx:43` — `earningRate` accepts `-500` or `1e9`, later multiplied against order totals.
- `app.ugc-settings.tsx:23` — **`JSON.parse()` with no try/catch**; malformed input is an unhandled 500.
- `app.upsell-settings.tsx:29` — the UI slider caps at 70 but the action accepts any integer, so a crafted POST sets a 100%+ discount.
- `app.pincode-settings.tsx:30-32` — unbounded newline-split arrays, no cap.
- `reward.model.ts:28` — `discountValue` has `min: 0.01` but **no max**, so a 500% off code is accepted.

Fix: `zod` plus a shared `parseForm(schema, formData)` returning typed data or Polaris field errors.

### 6.3 The settings-route duplication is the root cause
12 `*-settings.tsx` routes are near-identical: same 17-line loader/action shape, same `useState`-per-field, same hand-built FormData, same Page→Layout→Card→Checkbox skeleton. **This is the mechanism by which 6.1 and 6.2 replicated across a dozen files**, and it will keep replicating defects with every new feature.

Fix: one `createSettingsRoute({model, schema, fields})` factory plus a descriptor-driven `<SettingsForm>`. Collapses ~1,500 lines and makes validation a one-line change per route. **Do this after 6.2** so the fixed validation is what gets templated.

### 6.4 Error handling
`app.tsx:48-50` has the **only** `ErrorBoundary` in the codebase, and `root.tsx` has none. Every child loader calls `connectDB()` unguarded, so when Mongo is unreachable the merchant gets a raw error frame with a stack trace and no way back.

`webhooks.tsx:108-112` catches everything and returns **200 on failure**. The comment claims idempotency keys protect against this — but idempotency prevents double-*processing*, not dropped events. Returning 200 means **Shopify never retries**, so a transient Mongo blip during `orders/paid` permanently loses the customer's points. Return 500 for retryable failures; the idempotency keys already make retries safe.

### 6.5 Pagination is computed and then thrown away
Zero `Pagination` components exist. `app.customers.tsx:59,65-66` and `app.transactions.tsx:60` both compute `totalPages` **and never use it** — the title says "Customers (4,000)" while rendering 25 rows with no way to reach page 2 except editing the URL. The loader work is already done; only the component is missing.

### 6.6 Dashboard fires 3 GraphQL mutations per page load
`app._index.tsx:33` calls `createMetafieldDefinitions()` in the loader, which issues three `metafieldDefinitionCreate` mutations and swallows the expected "already exists" errors (`metafield.service.ts:66-79`). Move to the `afterAuth` hook.

### 6.7 Accessibility, i18n, and polish
- **No `prefers-reduced-motion` anywhere** across 16 CSS files, despite a 4.2 s wheel spin and count-up animations.
- **No focus trap** in any modal; focus is never restored on close; only 5 of 16 stylesheets define `:focus`.
- **No `Toast`/`Frame` anywhere** — every settings save returns `json({success:true})` and the merchant gets **no confirmation the save worked**; the button just stops spinning.
- `app.customers.tsx:167-183` hand-rolls a `<button>` with hardcoded `#5C6AC4`, shadowing the Polaris import.
- **Currency hardcoded to ₹/INR** in `cart-drawer.js:52-57`, `image-search.js:461-469`, `loyalty-widget.js:298,399` — ignoring the `data-money-format` the Liquid block passes. `sticky-atc.js:17` already does this correctly; lift that implementation.
- `locales/en.default.json` covers 4 of 17 blocks; every user-facing JS string is a hardcoded English literal.
- `blocks/loyalty-embed.liquid:14-16` hardcodes the metafield namespace `app--341573861377--loyalty` — an install-specific numeric ID that silently returns 0 points on any other installation.

### 6.8 Dead code
All four queries in `graphql/queries.ts` are unused (`GET_CUSTOMERS` even implements correct cursor pagination nothing calls) while `app.settings.tsx:62-64` inlines a duplicate. `image-index-jobs.service.ts:318` returns null with a "No longer used" comment. `blocks/image-search.liquid:31-62` defines four settings the JS never reads — merchants will change them and see nothing happen.

---

## Suggested sequencing

| Phase | Scope | Rough effort |
|---|---|---|
| **0** | Revoke credential, reward IDOR, webhook fail-closed | Hours |
| **1** | Points ledger correctness | 3–5 days |
| **2** | Storefront XSS, identity, rate limits, upsell pricing | 3–5 days |
| **3** | Billing, GDPR webhooks, TOML merge, extension compliance | 1–2 weeks |
| **4** | Plan upgrade, cron leases, CI, logging, Docker | 1–2 weeks |
| **5** | Migrations → indexes → TTL → throttling → asset gating | 2–3 weeks |
| **6** | Validation → settings factory → boundaries → a11y/i18n | 2–3 weeks |

Phases 0–2 are non-negotiable before further production traffic. Phase 3 is the gate for App Store submission. Phases 4–6 can overlap.

**Two highest-leverage structural changes**, both worth doing early because they stop new defects from being created:

1. **The settings-route factory (6.3)** — the copy-paste template is why the same validation and secret-leak bugs exist in a dozen files.
2. **The migration harness (5.2)** — until it exists, no index or schema change can ship safely, which blocks the entire performance phase.

---

*Generated from a six-track parallel audit (security, data, admin routes, storefront, infra, UI/UX). Findings marked CRITICAL were independently confirmed by multiple audit tracks. All file:line references were verified against the working tree at the time of audit.*

---

# Implementation status

## Landed

Verified: `npm run typecheck` passes with **0 errors (was 14)**, `npm test` passes **11 tests (was 0)**, `npm run build` succeeds.

**Security**
- Cross-tenant reward IDOR closed — update/toggle/delete now scoped by `shopId`, 404 on miss; toggle is a single atomic pipeline update. `app.rewards.tsx`
- ElevenLabs webhook now **fails closed** on a missing secret and uses `timingSafeEqual`. `api.voice-webhook.tsx`
- Stored XSS in reviews fixed — `escHtml`/`escAttr`/`safeImageUrl` helpers added and applied to review body, author, Q&A, and photo URLs. `reviews.js`
- Review identity spoofing closed — author name/email/customerId now derived from Shopify's signed `logged_in_customer_id`, never the request body. Rating clamped 1–5, body capped, photo URLs restricted to `http(s)` and capped at 5. `api.proxy.$.tsx`
- Rate limits added to wheel-spin, popup-submit, and stock-subscribe (previously unlimited discount-code minting); limiter map now evicts expired entries.
- Emails normalized (lowercase + strip `+` tags) before dedup, closing the plus-addressing bypass.
- Proxy HMAC now joins repeated params with commas per Shopify's spec (was failing closed on array params).
- Leaked SMTP credentials removed from `.env.example`; API-key fragment and customer PII removed from logs.

**Ledger correctness**
- Points expiry no longer re-expires nightly — added `Transaction.expiredAt`, deterministic `expire_${tx._id}` keys, per-transaction sweep, clamped at zero. `jobs.service.ts`
- `earnPoints` race closed — the idempotency key is now claimed *before* the balance moves, so the unique index acts as the lock.
- `redeemPoints` now rolls back with a compensating `ADJUST` transaction if the Shopify discount call or ledger write fails, and carries an idempotency key.
- `maxUsesPerCustomer` is now enforced (was declared but never read).
- `reversePoints` clamps at zero inside the update, so concurrent refunds can't drive balances negative.
- Replaced full-document `.save()` with targeted `$set` on the tier-update path to stop lost updates.

**Compliance**
- All webhook topics merged into `shopify.app.toml`; stale duplicate TOML deleted; `read_checkouts` scope added.
- Mandatory GDPR webhooks (`customer_data_request` / `customer_deletion` / `shop_deletion`) now declared — the handlers existed but Shopify was never calling them.
- `handleShopRedact` now deletes **all 23 shop-scoped collections** via a model registry (was 5), and fails loudly on partial deletion. `handleCustomerRedact` now covers reviews, questions, subscribers, and abandoned carts.
- A test reads the models directory and fails if a new shop-scoped model isn't registered, so this can't silently regress.
- Webhooks now return **500 on failure** so Shopify retries — previously a transient DB error permanently cost the customer their points.

**UI**
- Save feedback wired into all 13 settings/admin routes via a shared `useSaveToast` hook (App Bridge toasts; success and error paths).
- Pagination rendered on Customers and Transactions — `totalPages` was computed but never displayed, making everything past page 1 unreachable.
- Removed the hand-rolled `<button>` with hardcoded `#5C6AC4`; replaced with Polaris `Button` via `connectedRight`.
- Search input given a real accessible name (was `label=""`), a clear button, and Enter-key support.
- Split empty states into "no data" vs "no results", each with a relevant action.

**Infrastructure**
- `typecheck` script added; `eslint`, `@types/busboy`, `@types/node-cron` added (`npm run lint` previously crashed with `MODULE_NOT_FOUND`).
- GitHub Actions CI: typecheck → lint → test → build.
- `vitest.config.ts` + first 11 tests (proxy HMAC verification, model registry).
- `env.server.ts` validates all required env vars at boot instead of silently defaulting `MONGODB_URI` to localhost.
- Shopify API version centralized as `API_VERSION` (was hardcoded in six places).
- Indexes added: `Transaction {shopId,createdAt}`, `{shopId,type,source,createdAt}`, `{shopId,type,points}`, `{shopId,type,expiresAt,expiredAt}`; `AbandonedCart {callId}` sparse and `{shopId,status,callMadeAt}`.

## Environment blocker

**The project directory name contains `&`** (`Loyalty Programs & Rewards`). On Windows, `&` is a `cmd.exe` command separator, so **every npm postinstall script fails** and `npm ci` cannot complete at this path — this is why `node_modules` held only 4 packages. Installs currently require `--ignore-scripts`, which skips native builds including `sharp`.

**Fix: rename the parent directory** (e.g. `Loyalty Programs and Rewards`). Until then, CI on Linux will work but local Windows development is degraded.

## Not yet started

Everything else above, in the documented order. The largest remaining items are **billing** (Phase 3.1 — still the hard App Store blocker and a direct cost to you per shop), the **cron/multi-instance work** (Phase 4.2), the **migration harness** (Phase 5.2, which gates the remaining index work), **input validation + the settings factory** (Phase 6.2–6.3), and the **UI/UX track** (Phase 5.5) beyond the feedback and pagination fixes already landed.
