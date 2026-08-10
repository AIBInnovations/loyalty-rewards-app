/**
 * Custom Cart Drawer - Vanilla JS
 * Features: Tiered progress bar, product recommendations, quantity controls.
 * Compatible with all checkouts (GoKwik, Shopflo, Razorpay, native Shopify).
 */

(function () {
  "use strict";

  var container = document.getElementById("custom-cart-drawer");
  if (!container) return;

  // ─── Config from data attributes ──────────────────────────────
  var config = {
    primaryColor: container.dataset.primaryColor || "#5C6AC4",
    // Same theme-block-defaults gap as showProgress/interceptAtc below.
    showRecommendations: container.dataset.showRecommendations !== "false",
    recommendationsTitle: container.dataset.recommendationsTitle || "People Also Bought",
    // Block schema default is true; a theme block installed before this
    // setting existed can have an empty (not "false") value in the theme's
    // settings_data.json, which read as "off" under a strict === "true"
    // check. Only an explicit "false" disables it now.
    showProgress: container.dataset.showProgress !== "false",
    // Same theme-block-defaults gap as showProgress above: block schema
    // default is true, but a per-shop settings_data.json missing this key
    // renders an empty string here. Only an explicit "false" disables it.
    interceptAtc: container.dataset.interceptAtc !== "false",
    shopDomain: container.dataset.shopDomain || "",
    currency: container.dataset.currency || "INR",
    moneyFormat: container.dataset.moneyFormat || "₹{{amount}}",
  };

  // Apply primary color
  document.documentElement.style.setProperty("--cd-primary", config.primaryColor);

  // ─── State ────────────────────────────────────────────────────
  var state = {
    isOpen: false,
    cart: null,
    tiers: [],
    settings: null,
    accessDenied: false,
    recommendations: [],
    recsLoading: false,
    settingsLoaded: false,
    appliedCoupon: "",
    // Which announcement-bar message is currently showing.
    announcementIndex: 0,
    // Last tier index the customer has actually seen filled in. null means
    // "not yet shown" (skip animation on the very first paint).
    lastActiveTierIndex: null,
    pendingActiveTierIndex: null,
    // Whether the completion burst has already played this session — so it
    // celebrates the moment all tiers are unlocked once, not on every
    // re-render or every time the drawer is reopened.
    confettiFired: false,
  };

  // Parse initial cart from Liquid
  try {
    state.cart = JSON.parse(container.dataset.cart || "null");
  } catch (e) {
    state.cart = null;
  }

  // ─── DOM Elements ─────────────────────────────────────────────
  var overlay = null;
  var drawer = null;
  var isRendered = false;

  // ─── Format Money ─────────────────────────────────────────────
  function formatMoney(cents) {
    var amount = cents / 100;
    var format = config.moneyFormat || "₹{{amount}}";
    var formatted;
    if (format.indexOf("{{amount_no_decimals_with_comma_separator}}") !== -1) {
      formatted = Math.round(amount).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
      return format.replace("{{amount_no_decimals_with_comma_separator}}", formatted);
    }
    if (format.indexOf("{{amount_with_comma_separator}}") !== -1) {
      formatted = amount.toFixed(2).replace(".", ",");
      var parts = formatted.split(",");
      parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
      formatted = parts.join(",");
      return format.replace("{{amount_with_comma_separator}}", formatted);
    }
    if (format.indexOf("{{amount_no_decimals}}") !== -1) {
      formatted = Math.round(amount).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
      return format.replace("{{amount_no_decimals}}", formatted);
    }
    formatted = amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    formatted = formatted.replace(/\.00$/, "");
    return format.replace("{{amount}}", formatted);
  }

  function formatMoneyNumber(cents) {
    return (cents / 100).toFixed(2).replace(/\.00$/, "");
  }

  // ─── Escape HTML ──────────────────────────────────────────────
  // Safe for text nodes only: the textContent/innerHTML round-trip escapes
  // & < > but NOT quotes, so it must never be used inside an attribute.
  function esc(str) {
    if (!str) return "";
    var d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }

  // Attribute-safe escaping. Product titles containing a quote previously
  // broke out of alt="…" and src="…".
  function escAttr(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // Only http(s) image URLs reach a src attribute.
  function safeImageUrl(url) {
    var s = String(url == null ? "" : url).trim();
    if (!s) return "";
    if (s.indexOf("//") === 0) return s; // protocol-relative Shopify CDN
    return /^https?:\/\//i.test(s) ? s : "";
  }

  // ─── Load a custom font family ─────────────────────────────────
  // Setting --cd-font alone does nothing if the font was never actually
  // loaded — it just silently falls through to the next name in the stack
  // (usually a system font that looks close enough to the default that the
  // change appears to have no effect at all). Fetch it from Google Fonts
  // so a merchant's choice is actually visible. Generic keywords (system-ui,
  // sans-serif, etc.) are skipped since there's nothing to fetch for those.
  var GENERIC_FONT_KEYWORDS = {
    "serif": 1, "sans-serif": 1, "monospace": 1, "cursive": 1, "fantasy": 1,
    "system-ui": 1, "-apple-system": 1, "blinkmacsystemfont": 1,
    "ui-sans-serif": 1, "ui-serif": 1, "ui-monospace": 1, "ui-rounded": 1,
  };

  function loadGoogleFont(fontFamily) {
    if (!fontFamily) return;
    var primary = fontFamily.split(",")[0].trim().replace(/^['"]|['"]$/g, "");
    if (!primary || GENERIC_FONT_KEYWORDS[primary.toLowerCase()]) return;

    var id = "cd-google-font-" + primary.replace(/\s+/g, "-").toLowerCase();
    if (document.getElementById(id)) return;

    var link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=" +
      encodeURIComponent(primary).replace(/%20/g, "+") +
      ":wght@400;500;600;700;800&display=swap";
    document.head.appendChild(link);
  }

  // ─── Apply Appearance Overrides ────────────────────────────────
  // Custom properties declared inside the .cd-drawer/.cd-overlay rule itself
  // (cart-drawer.css) always win over a :root-level override with the same
  // name, so these must be set as inline styles directly on the elements.
  function applyAppearance() {
    if (!drawer || !overlay) return;
    var s = state.settings || {};
    loadGoogleFont(s.fontFamily);

    var vars = {
      "--cd-progress-bg": s.progressBarColor,
      "--cd-offer-bg": s.offerLineBg,
      "--cd-offer-text": s.offerLineTextColor,
      "--cd-pill-bg": s.pillColor,
      "--cd-pill-text": s.pillTextColor,
      "--cd-node-bg": s.nodeColor,
      "--cd-node-text": s.nodeTextColor,
      "--cd-btn-bg": s.buttonColor,
      "--cd-btn-hover-bg": s.buttonHoverColor,
      "--cd-btn-hover-text": s.buttonHoverTextColor,
      "--cd-announcement-bg": s.announcementBgColor,
      "--cd-announcement-text": s.announcementTextColor,
      "--cd-rec-add-bg": s.recommendationsAddToCartBg,
      "--cd-rec-add-text": s.recommendationsAddToCartText,
      "--cd-rec-badge-bg": s.recommendationsBadgeBg,
      "--cd-rec-badge-text": s.recommendationsBadgeTextColor,
      "--cd-font-size": s.fontSize ? s.fontSize + "px" : "",
      "--cd-header-count-size": s.headerCountSize ? s.headerCountSize + "px" : "",
      "--cd-drawer-width": s.drawerWidth ? s.drawerWidth + "px" : "",
    };
    if (s.fontFamily) {
      vars["--cd-font"] = s.fontFamily + ", -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    }

    for (var key in vars) {
      var val = vars[key];
      if (val) {
        drawer.style.setProperty(key, val);
        overlay.style.setProperty(key, val);
      } else {
        drawer.style.removeProperty(key);
        overlay.style.removeProperty(key);
      }
    }
  }

  // ─── Fetch Settings from App Proxy ────────────────────────────
  function fetchSettings() {
    fetch("/apps/loyalty/cart-settings?t=" + Date.now())
      .then(function (r) {
        if (!r.ok) throw new Error("Failed");
        var ct = r.headers.get("content-type") || "";
        if (!ct.includes("application/json")) throw new Error("Not JSON");
        return r.json();
      })
      .then(function (data) {
        state.settings = data;
        state.accessDenied = !!data.accessDenied;
        // Node positions, activeTierIndex, and fill% all assume ascending
        // order by threshold; the API does not guarantee that order.
        state.tiers = (data.tiers || []).slice().sort(function (a, b) {
          return a.threshold - b.threshold;
        });
        state.settingsLoaded = true;
        if (data.primaryColor) document.documentElement.style.setProperty("--cd-primary", data.primaryColor);
        applyAppearance();
        startAnnouncementRotation();
        if (state.isOpen) render();
      })
      .catch(function (err) {
        console.warn("Cart drawer: settings fetch failed", err.message);
        state.settingsLoaded = true;
      });
  }

  // ─── Fetch Cart ───────────────────────────────────────────────
  function fetchCart() {
    return fetch("/cart.js")
      .then(function (r) { return r.json(); })
      .then(function (cart) {
        state.cart = cart;
        if (state.isOpen) render();
        return cart;
      });
  }

  // ─── Fetch Recommendations ────────────────────────────────────
  function fetchRecommendations() {
    if (!config.showRecommendations || !state.cart || !state.cart.items || !state.cart.items.length) {
      state.recommendations = [];
      return;
    }

    // If manual mode and we have manual products from settings, use those
    if (state.settings && state.settings.recommendationMode === "manual" && state.settings.manualProducts && state.settings.manualProducts.length > 0) {
      var cartProductIds = new Set();
      state.cart.items.forEach(function (item) { cartProductIds.add(String(item.product_id)); });

      var manualRecs = state.settings.manualProducts
        .filter(function (p) { return !cartProductIds.has(p.shopifyProductId.replace("gid://shopify/Product/", "")); })
        .map(function (p) {
          return {
            id: p.shopifyProductId,
            title: p.title,
            handle: p.handle,
            url: "/products/" + p.handle,
            price: p.price,
            compare_at_price: p.compareAtPrice || null,
            featured_image: p.imageUrl,
            variants: [{ id: p.variantId.replace("gid://shopify/ProductVariant/", ""), available: true }],
            badge_text: p.badgeText || "",
          };
        });

      state.recommendations = manualRecs;
      state.recsLoading = false;
      if (state.isOpen) render();
      return;
    }

    // Collection mode: every product in the chosen collection, all sharing
    // the same merchant-set badge — contrast manual mode's per-product badge
    // above. Uses Shopify's public per-collection products.json endpoint,
    // same client-only pattern as the rest of this function.
    if (state.settings && state.settings.recommendationMode === "collection" && state.settings.recommendationsCollectionHandle) {
      var collCartIds = new Set();
      state.cart.items.forEach(function (item) { collCartIds.add(item.product_id); });
      var collLimit = (state.settings.recommendationsCount || MAX_RECS) + collCartIds.size;

      fetch("/collections/" + state.settings.recommendationsCollectionHandle + "/products.json?limit=" + collLimit)
        .then(function (r) { return r.json(); })
        .then(function (d) {
          var badge = state.settings.recommendationsCollectionBadgeText || "";
          var recs = (d.products || [])
            .filter(function (p) { return !collCartIds.has(p.id); })
            // This endpoint returns a different shape than the recommendations
            // API (price in decimal, images[] instead of featured_image) —
            // same normalization fetchFallbackProducts does below.
            .map(function (p) {
              var variant = p.variants && p.variants[0];
              return {
                id: p.id,
                title: p.title,
                handle: p.handle,
                url: "/products/" + p.handle,
                price: variant ? Math.round(variant.price * 100) : 0,
                compare_at_price: variant && variant.compare_at_price
                  ? Math.round(variant.compare_at_price * 100) : null,
                featured_image: p.images && p.images[0] ? p.images[0].src : "",
                variants: p.variants || [],
                badge_text: badge,
              };
            });
          state.recommendations = recs;
          state.recsLoading = false;
          if (state.isOpen) render();
        })
        .catch(function () {
          state.recommendations = [];
          state.recsLoading = false;
          if (state.isOpen) render();
        });
      return;
    }

    state.recsLoading = true;
    var productIds = [];
    var cartProductIds = new Set();
    var cartHandles = new Set();
    state.cart.items.forEach(function (item) {
      cartProductIds.add(item.product_id);
      if (item.handle) cartHandles.add(item.handle);
      if (productIds.length < 2) productIds.push(item.product_id);
    });

    // Try Shopify's recommendation API first
    var promises = productIds.map(function (pid) {
      return fetch("/recommendations/products.json?product_id=" + pid + "&limit=6&intent=complementary")
        .then(function (r) { return r.json(); })
        .then(function (d) { return d.products || []; })
        .catch(function () { return []; });
    });

    Promise.all(promises).then(function (results) {
      var seen = new Set();
      var recs = [];
      results.forEach(function (products) {
        products.forEach(function (p) {
          if (!seen.has(p.id) && !cartProductIds.has(p.id)) {
            seen.add(p.id);
            recs.push(p);
          }
        });
      });

      if (recs.length > 0) {
        state.recommendations = recs.slice(0, 8);
        state.recsLoading = false;
        if (state.isOpen) render();
      } else {
        // Fallback: fetch products from the store's catalog
        fetchFallbackProducts(cartProductIds);
      }
    });
  }

  // ─── Fallback: Fetch random products when no recommendations ──
  function fetchFallbackProducts(cartProductIds) {
    // Try fetching from /collections/all which contains all products
    fetch("/collections/all/products.json?limit=12")
      .then(function (r) {
        if (!r.ok) throw new Error("Failed");
        return r.json();
      })
      .then(function (data) {
        var products = data.products || [];
        var recs = [];
        // Shuffle and filter out cart items
        products.sort(function () { return Math.random() - 0.5; });
        products.forEach(function (p) {
          if (!cartProductIds.has(p.id) && recs.length < 8) {
            // Normalize product format to match recommendations API format
            recs.push({
              id: p.id,
              title: p.title,
              handle: p.handle,
              url: "/products/" + p.handle,
              price: p.variants && p.variants[0] ? p.variants[0].price * 100 : 0,
              compare_at_price: p.variants && p.variants[0] && p.variants[0].compare_at_price
                ? p.variants[0].compare_at_price * 100 : null,
              featured_image: p.images && p.images[0] ? p.images[0].src : "",
              variants: p.variants || [],
            });
          }
        });
        state.recommendations = recs;
        state.recsLoading = false;
        if (state.isOpen) render();
      })
      .catch(function () {
        // Final fallback: try the search API
        fetch("/search/suggest.json?q=*&resources[type]=product&resources[limit]=8")
          .then(function (r) { return r.json(); })
          .then(function (data) {
            var products = (data.resources && data.resources.results && data.resources.results.products) || [];
            var recs = [];
            products.forEach(function (p) {
              if (!cartProductIds.has(p.id) && recs.length < 8) {
                recs.push({
                  id: p.id,
                  title: p.title,
                  handle: p.handle,
                  url: p.url,
                  price: p.price * 100,
                  compare_at_price: p.compare_at_price ? p.compare_at_price * 100 : null,
                  featured_image: p.featured_image ? p.featured_image.url : "",
                  variants: p.variants || [],
                });
              }
            });
            state.recommendations = recs;
            state.recsLoading = false;
            if (state.isOpen) render();
          })
          .catch(function () {
            state.recommendations = [];
            state.recsLoading = false;
            if (state.isOpen) render();
          });
      });
  }

  // ─── Cart Operations ─────────────────────────────────────────
  function addToCart(variantId, qty) {
    return fetch("/cart/add.js", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [{ id: Number(variantId), quantity: qty || 1 }] }),
    })
      .then(function () { return fetchCart(); })
      .then(function () { fetchRecommendations(); });
  }

  function updateQuantity(lineKey, qty) {
    return fetch("/cart/change.js", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: lineKey, quantity: qty }),
    })
      .then(function () { return fetchCart(); });
  }

  function removeItem(lineKey) {
    return updateQuantity(lineKey, 0);
  }

  // ─── Hide Native Cart Drawer ──────────────────────────────────
  function hideNativeCartDrawer() {
    // Common selectors for native Shopify cart drawers across themes
    var selectors = [
      "cart-drawer",            // Dawn theme custom element
      "#cart-drawer",
      ".cart-drawer",
      "#CartDrawer",
      ".cart-drawer-overlay",
      "[data-cart-drawer]",
      "details[id*='cart']",    // Dawn uses <details> element
      ".js-drawer.drawer--right",
      "#shopify-section-cart-drawer",
    ];

    selectors.forEach(function (sel) {
      var els = document.querySelectorAll(sel);
      els.forEach(function (el) {
        // Close the native drawer
        if (el.tagName === "DETAILS" && el.hasAttribute("open")) {
          el.removeAttribute("open");
        }
        // Also try clicking any close buttons inside
        var closeBtn = el.querySelector("[data-cart-close], .drawer__close, .cart-drawer__close");
        if (closeBtn) closeBtn.click();
      });
    });
  }

  // Inject CSS to hide native cart drawer permanently when our drawer is active
  function injectNativeCartHideCSS() {
    if (document.getElementById("cd-hide-native-cart")) return;
    var style = document.createElement("style");
    style.id = "cd-hide-native-cart";
    style.textContent =
      "cart-drawer, #cart-drawer, .cart-drawer, #CartDrawer, " +
      "#shopify-section-cart-drawer .drawer, " +
      "details#cart-drawer-details, " +
      ".js-drawer.drawer--right { " +
      "  display: none !important; " +
      "  visibility: hidden !important; " +
      "  pointer-events: none !important; " +
      "}" +
      "cart-drawer .drawer__close, " +
      ".cart-drawer-overlay { " +
      "  display: none !important; " +
      "}";
    document.head.appendChild(style);
  }

  // ─── Open / Close ─────────────────────────────────────────────
  // Element that had focus before opening, so it can be restored on close.
  var lastFocused = null;

  var FOCUSABLE =
    'button:not([disabled]), a[href], input:not([disabled]), ' +
    'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  /** Keep Tab inside the drawer while it is open. */
  function trapFocus(e) {
    if (e.key !== "Tab" || !state.isOpen || !drawer) return;

    var focusable = drawer.querySelectorAll(FOCUSABLE);
    if (!focusable.length) return;

    var first = focusable[0];
    var last = focusable[focusable.length - 1];

    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function onKeydown(e) {
    if (!state.isOpen) return;
    if (e.key === "Escape") {
      closeDrawer();
      return;
    }
    trapFocus(e);
  }

  function openDrawer() {
    if (state.isOpen) return;
    state.isOpen = true;
    lastFocused = document.activeElement;

    if (!isRendered) createDOM();
    applyAppearance();
    hideNativeCartDrawer();
    render();
    fetchCart().then(function () { fetchRecommendations(); });

    overlay.classList.add("open");
    drawer.classList.add("open");
    drawer.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";

    document.addEventListener("keydown", onKeydown);

    // Move focus into the drawer so screen readers and keyboard users land
    // inside it rather than behind the overlay.
    var closeBtn = drawer.querySelector(".cd-close");
    if (closeBtn) closeBtn.focus();
  }

  function closeDrawer() {
    if (!state.isOpen) return;
    state.isOpen = false;

    overlay.classList.remove("open");
    drawer.classList.remove("open");
    drawer.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";

    document.removeEventListener("keydown", onKeydown);
    hideNativeCartDrawer();

    // Return focus to whatever opened the drawer.
    if (lastFocused && typeof lastFocused.focus === "function") {
      lastFocused.focus();
    }
    lastFocused = null;
  }

  // ─── Create DOM Shell ─────────────────────────────────────────
  function createDOM() {
    overlay = document.createElement("div");
    overlay.className = "cd-overlay";
    overlay.addEventListener("click", closeDrawer);

    drawer = document.createElement("div");
    drawer.className = "cd-drawer";
    // Announce as a modal dialog — the drawer previously had no role at all.
    drawer.setAttribute("role", "dialog");
    drawer.setAttribute("aria-modal", "true");
    drawer.setAttribute("aria-label", "Shopping cart");
    drawer.setAttribute("aria-hidden", "true");

    document.body.appendChild(overlay);
    document.body.appendChild(drawer);
    isRendered = true;
  }

  // ─── Render ───────────────────────────────────────────────────
  // Layout: fixed header, scrollable body, pinned summary. The summary must
  // stay reachable without scrolling past the recommendations.
  function render() {
    if (!drawer) return;
    var cart = state.cart;
    var itemCount = cart ? cart.item_count : 0;

    // Nothing to show progress toward, or suggest alongside, an empty cart.
    var backendShowProgress = !state.settings || state.settings.showProgressBar !== false;
    var hasProgress = itemCount > 0 && config.showProgress && backendShowProgress && state.tiers.length > 0;
    var hasUpsell = shouldShowUpsell();
    var hasRecs = itemCount > 0 && config.showRecommendations && state.recommendations.length > 0;

    var shippingBannerHtml = renderShippingBanner();
    // Shipping banner and progress card share one sticky container — two
    // separate elements both pinned at top:0 would just overlap.
    var stickyTopHtml = shippingBannerHtml || hasProgress
      ? '<div class="cd-sticky-top">' + shippingBannerHtml + (hasProgress ? renderProgressBar(cart) : "") + '</div>'
      : "";

    drawer.innerHTML =
      renderHeader(itemCount) +
      '<div class="cd-body">' +
        stickyTopHtml +
        (state.accessDenied ? '<div class="cd-access-denied">Access needed for Cart Drawer rewards. Contact the store for access.</div>' : "") +
        (hasProgress && itemCount > 0 ? '<div class="cd-section-divider"></div>' : "") +
        (itemCount > 0 ? renderItems(cart) : renderEmpty()) +
        (itemCount > 0 ? renderCoupon() : "") +
        (itemCount > 0 && hasUpsell ? '<div class="cd-section-divider"></div>' : "") +
        (hasUpsell ? renderUpsell() : "") +
        (hasRecs ? renderRecommendations() : "") +
      '</div>' +
      (itemCount > 0 ? renderFooter(cart) : "") +
      (itemCount > 0 ? renderPriceSummary(cart) : "");

    attachEvents();
    revealNewMilestones();
  }

  // ─── Completion burst ──────────────────────────────────────────
  // A one-off sprinkle of pieces bursting outward from the progress track,
  // played the moment the customer unlocks the last tier.
  var CONFETTI_COLORS = ["#fff", "#e6c9c0", "#b3543f", "#f5e6a8", "#fff"];

  function fireConfetti(section) {
    if (!section) return;
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    var wrap = document.createElement("div");
    wrap.className = "cd-confetti";
    var count = 16;
    var streamerCount = 8;
    var total = count + streamerCount;
    for (var i = 0; i < total; i++) {
      var isStreamer = i >= count;
      var piece = document.createElement("span");
      piece.className = isStreamer ? "cd-confetti-piece cd-confetti-piece--streamer" : "cd-confetti-piece";
      var angle = (Math.PI * 2 * i) / total + (Math.random() * 0.5 - 0.25);
      // Streamers fly a little further and curl more so they read as ribbons
      // uncurling in flight, not just bigger confetti dots.
      var dist = isStreamer ? 30 + Math.random() * 36 : 20 + Math.random() * 28;
      var tx = Math.cos(angle) * dist;
      var ty = Math.sin(angle) * dist * 0.5; // flatten so it stays inside the strip
      piece.style.setProperty("--cd-tx", tx.toFixed(1) + "px");
      piece.style.setProperty("--cd-ty", ty.toFixed(1) + "px");
      piece.style.setProperty("--cd-rot", ((isStreamer ? 540 : 360) * (Math.random() > 0.5 ? 1 : -1) * Math.random()).toFixed(0) + "deg");
      piece.style.setProperty("--cd-delay", (Math.random() * 140).toFixed(0) + "ms");
      piece.style.setProperty("--cd-c", CONFETTI_COLORS[i % CONFETTI_COLORS.length]);
      wrap.appendChild(piece);
    }
    section.appendChild(wrap);
    setTimeout(function () {
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
    }, 1300);
  }

  // ─── Reveal newly-crossed milestones ───────────────────────────
  // Runs after each render. If the customer just crossed one or more new
  // tiers, those checkpoints were painted unfilled (see renderProgressBar's
  // displayIndex); toggle them to "filled" one at a time, on the
  // already-attached elements, so the CSS transition plays instead of the
  // state jumping straight to its end value.
  function revealNewMilestones() {
    var target = state.pendingActiveTierIndex;
    if (target === null || target === undefined) return;

    var lastTierIndex = state.tiers.length - 1;
    // Dropping back below full lets the burst celebrate again if the
    // customer empties and re-fills the cart later in the same session.
    if (target < lastTierIndex) state.confettiFired = false;

    if (state.lastActiveTierIndex === null || target <= state.lastActiveTierIndex) {
      // First paint already at full completion — don't burst on every open,
      // just mark it as already celebrated.
      if (state.lastActiveTierIndex === null && target === lastTierIndex) {
        state.confettiFired = true;
      }
      state.lastActiveTierIndex = target;
      return;
    }

    var from = state.lastActiveTierIndex;
    var section = drawer.querySelector(".cd-progress-section");
    if (!section) { state.lastActiveTierIndex = target; return; }
    var track = section.querySelector(".cd-progress-track");

    var checkpoints = section.querySelectorAll(".cd-progress-checkpoint");

    var queue = [];
    for (var i = from + 1; i <= target; i++) queue.push(i);

    var step = 0;
    function revealNext() {
      if (step >= queue.length) {
        state.lastActiveTierIndex = target;
        if (target === lastTierIndex && !state.confettiFired) {
          state.confettiFired = true;
          fireConfetti(track || section);
        }
        return;
      }
      var idx = queue[step];
      var cp = checkpoints[idx];
      if (cp) {
        var line = cp.querySelector(".cd-progress-checkpoint-line");
        if (line) { line.classList.remove("current"); line.classList.add("filled"); line.innerHTML = ""; }
        var dot = cp.querySelector(".cd-progress-dot");
        if (dot) { dot.classList.add("reached"); dot.textContent = "✓"; }
        var label = cp.querySelector(".cd-progress-tier-label");
        if (label) label.classList.add("reached");
        var thresh = cp.querySelector(".cd-progress-tier-threshold");
        if (thresh) thresh.classList.add("reached");
      }
      var nextCp = checkpoints[idx + 1];
      if (nextCp) {
        var nextLine = nextCp.querySelector(".cd-progress-checkpoint-line");
        if (nextLine) nextLine.classList.add("current");
      }
      step++;
      setTimeout(revealNext, 450);
    }
    revealNext();
  }

  // ─── Render Header ────────────────────────────────────────────
  function renderHeader(count) {
    var label = count === 1 ? "1 item" : count + " items";
    return '<div class="cd-header">' +
      '<h2 class="cd-header-title">' +
        '<b>Your Cart</b>' +
        '<span class="cd-header-count">' + esc(label) + '</span>' +
      '</h2>' +
      '<button class="cd-close" type="button" data-action="close" aria-label="Close cart">' +
        '<svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M14 4L4 14M4 4l10 10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>' +
      '</button>' +
    '</div>';
  }

  // ─── Render Shipping Banner ───────────────────────────────────
  // Merchant-configured; hidden entirely when no text is set, so it never
  // makes a shipping promise the store hasn't opted into.
  // Multiple messages (announcementTexts) take priority; a single legacy
  // shippingBannerText is used as a one-slide fallback for shops that set
  // it before the multi-message announcement bar existed.
  function getAnnouncementTexts() {
    var s = state.settings;
    if (s && s.announcementTexts && s.announcementTexts.length) return s.announcementTexts;
    if (s && s.shippingBannerText) return [s.shippingBannerText];
    return [];
  }

  function renderShippingBanner() {
    var texts = getAnnouncementTexts();
    if (!texts.length) return "";

    var itemsHtml = texts.map(function (t) {
      return '<div class="cd-announcement-item">' + esc(t) + '</div>';
    }).join("");

    var offset = state.announcementIndex % texts.length;
    return '<div class="cd-announcement-bar">' +
      '<div class="cd-announcement-track" style="transform:translateY(-' + (offset * 100) + '%)">' +
        itemsHtml +
      '</div>' +
    '</div>';
  }

  // ─── Announcement bar rotation ──────────────────────────────────
  // One persistent timer (not restarted on every render, so cart updates
  // don't reset the slide back to the first message) that re-locates the
  // live track element each tick — full innerHTML rebuilds replace that
  // element, so a cached reference would go stale.
  var announcementTimer = null;

  function startAnnouncementRotation() {
    if (announcementTimer) { clearInterval(announcementTimer); announcementTimer = null; }
    var texts = getAnnouncementTexts();
    if (texts.length <= 1) return;

    var delaySec = (state.settings && state.settings.announcementDelay) || 4;
    announcementTimer = setInterval(function () {
      var current = getAnnouncementTexts();
      if (current.length <= 1) return;
      state.announcementIndex = (state.announcementIndex + 1) % current.length;
      var track = drawer && drawer.querySelector(".cd-announcement-track");
      if (track) track.style.transform = "translateY(-" + (state.announcementIndex * 100) + "%)";
    }, Math.max(1, delaySec) * 1000);
  }

  // ─── Render Progress Bar ──────────────────────────────────────
  function renderProgressBar(cart) {
    var tiers = state.tiers;
    if (!tiers.length) return "";

    var itemCount = cart ? cart.item_count : 0;
    var cartTotal = cart ? cart.total_price : 0;

    // Determine active tier and message
    var activeTierIndex = -1;
    var message = "";

    for (var i = 0; i < tiers.length; i++) {
      var tier = tiers[i];
      var value = tier.type === "items" ? itemCount : cartTotal / 100;
      if (value >= tier.threshold) {
        activeTierIndex = i;
      }
    }

    // Find next unmet tier
    var nextTierIndex = activeTierIndex + 1;
    if (nextTierIndex < tiers.length) {
      var nextTier = tiers[nextTierIndex];
      var currentValue = nextTier.type === "items" ? itemCount : cartTotal / 100;
      var remaining = nextTier.threshold - currentValue;
      if (remaining < 0) remaining = 0;
      var remainingFormatted = nextTier.type === "amount"
        ? formatMoney(Math.ceil(remaining) * 100)
        : String(Math.ceil(remaining));
      // The merchant's template is escaped before interpolation; the two
      // placeholders are the only markup we introduce.
      message = esc(nextTier.belowMessage)
        .replace("{remaining}", "<em>" + esc(remainingFormatted) + "</em>")
        .replace("{label}", "<em>" + esc(nextTier.label) + "</em>");
    } else if (activeTierIndex >= 0) {
      message = esc(tiers[activeTierIndex].reachedMessage)
        .replace("{label}", "<em>" + esc(tiers[activeTierIndex].label) + "</em>");
    }

    // Stash the true target so the caller can reveal any newly-crossed
    // milestones a beat after paint, letting the fill transition actually
    // play (a full innerHTML rebuild has no "previous state" to animate
    // from, so painting straight to the target would just snap instantly).
    state.pendingActiveTierIndex = activeTierIndex;
    var displayIndex = state.lastActiveTierIndex === null
      ? activeTierIndex
      : Math.min(activeTierIndex, state.lastActiveTierIndex);

    // Each tier gets one equal-width flex column — reached/current/empty
    // line segment, offer label, checkpoint icon, and threshold text all
    // stacked and centered within that single column. Because every
    // column is exactly 1/N of the track regardless of how far apart the
    // actual threshold VALUES are, neighboring tiers can never collide —
    // positioning by index this way (not by value-proportional %) is what
    // fixes the overlap that occurred when thresholds bunched together
    // (e.g. 2/3/4 items within a 0-4 range).
    var checkpointsHtml = "";
    for (var j = 0; j < tiers.length; j++) {
      var t = tiers[j];
      var isReached = j <= displayIndex;
      var isCurrent = !isReached && j === displayIndex + 1;

      // How far into this specific segment the cart actually is (e.g. 5 of
      // 100 items = 5%) — so the "current" segment visibly fills as items
      // are added, instead of staying a single static color the whole time.
      var subFillPct = 0;
      if (isCurrent) {
        var segValue = t.type === "items" ? itemCount : cartTotal / 100;
        var segPrevThreshold = displayIndex >= 0 ? tiers[displayIndex].threshold : 0;
        subFillPct = ((segValue - segPrevThreshold) / (t.threshold - segPrevThreshold)) * 100;
        if (subFillPct < 0) subFillPct = 0;
        if (subFillPct > 100) subFillPct = 100;
        if (subFillPct > 0) subFillPct = Math.max(subFillPct, 10);
      }

      var lineClass = isReached ? " filled" : (isCurrent ? " current" : "");
      var lineInner = isCurrent
        ? '<div class="cd-progress-seg-fill" style="width:' + subFillPct + '%"></div>'
        : "";

      var threshold = t.type === "items"
        ? t.threshold + " item" + (t.threshold > 1 ? "s" : "")
        : formatMoney(t.threshold * 100);
      var reachedClass = isReached ? " reached" : "";

      checkpointsHtml +=
        '<div class="cd-progress-checkpoint">' +
          '<span class="cd-progress-tier-label' + reachedClass + '">' + esc(t.label) + '</span>' +
          '<div class="cd-progress-checkpoint-row">' +
            '<div class="cd-progress-checkpoint-line' + lineClass + '">' + lineInner + '</div>' +
            '<div class="cd-progress-dot' + reachedClass + '">' + (isReached ? "✓" : "%") + '</div>' +
          '</div>' +
          '<span class="cd-progress-tier-threshold' + reachedClass + '">' + esc(threshold) + '</span>' +
        '</div>';
    }

    // Two independent sibling divs — a disclaimer line and the reward
    // message — rather than one combined block, matching the reference
    // markup so each can be targeted/styled on its own.
    var bannerText = state.settings && state.settings.progressBannerText;
    var messageBlock =
      (bannerText ? '<div class="cd-progress-topbar">' + esc(bannerText) + '</div>' : "") +
      (message ? '<div class="cd-progress-reward-message">' + message + '</div>' : "");

    // No sticky wrapper here — render() wraps this together with the
    // shipping banner in one shared sticky container, since two separate
    // elements both pinned at top:0 would just overlap each other.
    return '<section class="cd-progress-section' + (bannerText ? " has-banner" : "") + '" aria-label="Reward progress">' +
        messageBlock +
        '<div class="cd-progress-body">' +
        '<div class="cd-progress-track" role="progressbar"' +
          ' aria-valuemin="0" aria-valuemax="' + tiers.length + '"' +
          ' aria-valuenow="' + (activeTierIndex + 1) + '">' +
          checkpointsHtml +
        '</div>' +
        '</div>' +
      '</section>';
  }

  // ─── Render Cart Items ────────────────────────────────────────
  function renderItems(cart) {
    if (!cart || !cart.items || !cart.items.length) return renderEmpty();

    var html = '<div class="cd-items">';
    cart.items.forEach(function (item) {
      var hasCompare = item.original_line_price > item.final_line_price;
      var savings = hasCompare ? item.original_line_price - item.final_line_price : 0;

      var imgSrc = safeImageUrl(
        item.featured_image
          ? item.featured_image.url || item.image
          : item.image || ""
      );
      // Request a CDN-resized variant rather than the full-size original.
      if (imgSrc) {
        imgSrc = imgSrc.replace(/(\.\w+)(\?|$)/, "_200x200$1$2");
      }

      var variantTitle = item.variant_title && item.variant_title !== "Default Title"
        ? item.variant_title : "";

      var title = item.product_title || item.title || "";

      html +=
        '<div class="cd-item">' +
          '<div class="cd-item-img">' +
            (imgSrc
              ? '<img src="' + escAttr(imgSrc) + '" alt="' + escAttr(title) + '" loading="lazy"/>'
              : '') +
          '</div>' +
          '<div class="cd-item-details">' +
            '<div class="cd-item-top-row">' +
              '<p class="cd-item-title">' + esc(title) + '</p>' +
              '<button type="button" class="cd-item-remove" data-action="remove"' +
                ' data-key="' + escAttr(item.key) + '" aria-label="Remove ' + escAttr(title) + '">' +
                '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">' +
                  '<path d="M17 6H22V8H20V21C20 21.5523 19.5523 22 19 22H5C4.44772 22 4 21.5523 4 21V8H2V6H7V3C7 2.44772 7.44772 2 8 2H16C16.5523 2 17 2.44772 17 3V6ZM18 8H6V20H18V8ZM9 11H11V17H9V11ZM13 11H15V17H13V11ZM9 4V6H15V4H9Z"></path>' +
                '</svg>' +
              '</button>' +
            '</div>' +
            (variantTitle ? '<p class="cd-item-variant">' + esc(variantTitle) + '</p>' : '') +
            '<div class="cd-item-price-row">' +
              '<span class="cd-item-price">' + formatMoney(item.final_line_price) + '</span>' +
              (hasCompare
                ? '<span class="cd-item-compare-price">' + formatMoney(item.original_line_price) + '</span>' +
                  '<span class="cd-item-save">Save ' + formatMoney(savings) + '</span>'
                : '') +
            '</div>' +
            '<div class="cd-item-actions">' +
              '<div class="cd-qty">' +
                '<button type="button" data-action="qty-minus" data-key="' + escAttr(item.key) + '"' +
                  ' data-qty="' + (item.quantity - 1) + '"' +
                  ' aria-label="Decrease quantity">&minus;</button>' +
                '<span aria-live="polite">' + item.quantity + '</span>' +
                '<button type="button" data-action="qty-plus" data-key="' + escAttr(item.key) + '"' +
                  ' data-qty="' + (item.quantity + 1) + '"' +
                  ' aria-label="Increase quantity">+</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>';
    });
    html += '</div>';
    return html;
  }

  // ─── Render Coupon ────────────────────────────────────────────
  // Shown only when the merchant has configured a code. "Apply" appends the
  // discount to the checkout URL (Shopify's supported mechanism) rather than
  // pretending to validate it here.
  function renderCoupon() {
    var s = state.settings;
    if (!s || !s.couponEnabled || !s.couponCode) return "";

    var desc = s.couponDescription ? " <small>· " + esc(s.couponDescription) + "</small>" : "";
    var offersUrl = s.couponOffersUrl || "";

    return '<section class="cd-coupon">' +
      '<div>' +
        '<div class="cd-coupon-code">' + esc(s.couponCode) + desc + '</div>' +
        (offersUrl
          ? '<a class="cd-coupon-link" href="' + escAttr(offersUrl) + '">View all offers &rarr;</a>'
          : '') +
      '</div>' +
      '<button type="button" class="cd-coupon-apply" data-action="apply-coupon"' +
        ' data-code="' + escAttr(s.couponCode) + '">APPLY</button>' +
    '</section>';
  }

  // ─── Render Empty Cart ────────────────────────────────────────
  function renderEmpty() {
    return '<div class="cd-empty">' +
      '<div class="cd-empty-icon">🛒</div>' +
      '<h3>Your cart is empty</h3>' +
      '<p>Add items to get started!</p>' +
    '</div>';
  }

  // ─── Render Recommendations ───────────────────────────────────
  // Two-up product grid ("Pairs well with" in the mockup). Capped at four so
  // the summary stays reachable without a long scroll.
  var MAX_RECS = 4;

  function renderProductCard(opts) {
    var imgSrc = safeImageUrl(opts.image);
    if (imgSrc) imgSrc = imgSrc.replace(/(\.\w+)(\?|$)/, "_300x300$1$2");

    var discountPct = opts.comparePrice
      ? Math.round(((opts.comparePrice - opts.price) / opts.comparePrice) * 100)
      : 0;

    var priceRow = '<div class="cd-prod-prices">' +
      '<span class="cd-prod-price">' + formatMoney(opts.price) + '</span>' +
      (opts.comparePrice
        ? '<span class="cd-prod-compare">' + formatMoney(opts.comparePrice) + '</span>'
        : '') +
    '</div>';

    var imgBlock = '<div class="cd-prod-img">' +
      (imgSrc
        ? '<img src="' + escAttr(imgSrc) + '" alt="' + escAttr(opts.title) + '" loading="lazy" onerror="this.style.display=\'none\'"/>'
        : '') +
      (discountPct > 0
        ? '<span class="cd-prod-discount-badge">-' + discountPct + '% OFF</span>'
        : '') +
      (opts.badgeText
        ? '<span class="cd-prod-custom-badge' +
            (state.settings && state.settings.recommendationsBadgeAlign === "left" ? " cd-prod-custom-badge--left" : "") +
            '">' + esc(opts.badgeText) + '</span>'
        : '') +
    '</div>';

    // Steal Deals keeps its existing circular "+" button beside the price.
    if (opts.roundAdd) {
      var roundBtn = '<button type="button" class="cd-prod-add-round" data-action="' + escAttr(opts.action) + '"' +
          ' data-variant-id="' + escAttr(opts.variantId) + '"' +
          ' aria-label="Add ' + escAttr(opts.title) + ' to cart">+</button>';
      return '<div class="cd-prod cd-prod--deal">' +
        imgBlock +
        '<div class="cd-prod-info">' +
          '<p class="cd-prod-name">' + esc(opts.title) + '</p>' +
          priceRow +
        '</div>' +
        roundBtn +
      '</div>';
    }

    // Recommendation cards: fixed 142x142 image, full-width "Add to Cart"
    // button pinned to the card bottom — matches the reference layout.
    return '<div class="cd-prod cd-prod--rec">' +
      imgBlock +
      '<div class="cd-prod-info">' +
        '<p class="cd-prod-name">' + esc(opts.title) + '</p>' +
        priceRow +
        '<button type="button" class="cd-prod-add-full" data-action="' + escAttr(opts.action) + '"' +
          ' data-variant-id="' + escAttr(opts.variantId) + '"' +
          ' aria-label="Add ' + escAttr(opts.title) + ' to cart">Add to Cart</button>' +
      '</div>' +
    '</div>';
  }

  function renderRecommendations() {
    if (!state.recommendations.length) return "";

    var title = (state.settings && state.settings.recommendationsTitle) || config.recommendationsTitle;
    // The grid caps at 4 to keep the summary reachable without a long
    // vertical scroll; the slider scrolls sideways instead, so it can show
    // as many as the merchant configured (recommendationsCount, up to 8).
    var isSlider = Boolean(state.settings && state.settings.recommendationsSlider);
    var limit = isSlider
      ? (state.settings && state.settings.recommendationsCount) || MAX_RECS
      : MAX_RECS;

    var html = '<section class="cd-recs-section">' +
      '<h3 class="cd-recs-title">' + esc(title) + '</h3>' +
      '<div class="' + (isSlider ? "cd-recs-slider" : "cd-recs-grid") + '">';

    state.recommendations.slice(0, limit).forEach(function (p) {
      var hasCompare = p.compare_at_price && p.compare_at_price > p.price;
      var image = "";
      if (p.featured_image) {
        image = typeof p.featured_image === "string"
          ? p.featured_image
          : (p.featured_image.url || "");
      }

      html += renderProductCard({
        title: p.title,
        image: image,
        price: p.price,
        comparePrice: hasCompare ? p.compare_at_price : 0,
        variantId: p.variants && p.variants.length ? p.variants[0].id : "",
        action: "add-rec",
        badgeText: p.badge_text || "",
      });
    });

    html += '</div></section>';
    return html;
  }

  // ─── Upsell ───────────────────────────────────────────────────
  function shouldShowUpsell() {
    if (!state.settings || !state.settings.showUpsell) return false;
    if (!state.settings.upsellProduct) return false;
    if (!state.cart || !state.cart.items || !state.cart.items.length) return false;
    // Hide if product already in cart
    var cartIds = state.cart.items.map(function(i) { return String(i.product_id); });
    var upId = String(state.settings.upsellProduct.shopifyProductId || "")
      .replace("gid://shopify/Product/", "");
    return cartIds.indexOf(upId) === -1;
  }

  function renderUpsell() {
    var p = state.settings.upsellProduct;
    var discount = Number(state.settings.upsellDiscount) || 0;
    var headline = state.settings.upsellHeadline || "Steal Deals";
    var originalPrice = p.price || 0;
    var discountedPrice = Math.round(originalPrice * (1 - discount / 100));
    var variantId = String(p.variantId || "").replace("gid://shopify/ProductVariant/", "");
    // renderProductCard() already resizes the image itself — resizing here
    // too stacked two suffixes into one filename (e.g. "..._160x160_300x300.jpg"),
    // which doesn't exist on Shopify's CDN and 404s.

    return '<section class="cd-upsell-section">' +
      '<div class="cd-upsell-heading-row">' +
        '<h3 class="cd-upsell-headline">' + esc(headline) + '</h3>' +
        '<span class="cd-upsell-unlocked">' +
          '<svg width="10" height="10" viewBox="0 0 20 20" fill="none" aria-hidden="true">' +
            '<path d="M5 9V6.5a5 5 0 0 1 9.6-1.9M5.5 9h9A1.5 1.5 0 0 1 16 10.5v6A1.5 1.5 0 0 1 14.5 18h-9A1.5 1.5 0 0 1 4 16.5v-6A1.5 1.5 0 0 1 5.5 9Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' +
          '</svg>' +
          'UNLOCKED' +
        '</span>' +
      '</div>' +
      '<div class="cd-upsell-grid">' +
        renderProductCard({
          title: p.title,
          image: p.imageUrl || "",
          price: discountedPrice,
          comparePrice: discount > 0 ? originalPrice : 0,
          variantId: variantId,
          action: "add-upsell",
          roundAdd: true,
        }) +
      '</div>' +
    '</section>';
  }

  // ─── Payment method badges ─────────────────────────────────────
  // Small generic initials badges inside the checkout button — not real
  // brand logos (no such assets/rights), just a lightweight visual cue
  // built from the merchant's own "Payment methods line" text.
  function renderPayBadges(payMethods) {
    if (!payMethods) return "";
    var names = payMethods.split(/[·,|]/).map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 4);
    if (!names.length) return "";

    var html = '<span class="cd-pay-badges" aria-hidden="true">';
    names.forEach(function (name) {
      html += '<span class="cd-pay-badge">' + esc(name.slice(0, 2).toUpperCase()) + '</span>';
    });
    html += '</span><span class="cd-sr-only">Accepted: ' + esc(payMethods) + '</span>';
    return html;
  }

  // ShipRocket's own UPI-options and "Powered by" badges — only shown when
  // their script is actually active on the page (same detection the
  // checkout click handler uses), so a store without ShipRocket, or one on
  // a different gateway, never shows ShipRocket branding on its button.
  function hasShiprocketCheckout() {
    return typeof window.shiprocketCheckoutBuyCartHandler === "function";
  }

  function renderShiprocketIcons() {
    if (!hasShiprocketCheckout()) return "";
    return '<img src="https://fastrr-boost-ui.pickrr.com/assets/images/boost_button/upi_options.svg" ' +
      'alt="Google Pay | Phone Pay | UPI" class="sr-pl-15 sr-checkout-visible sr-payment-icons cd-sr-icons">';
  }

  function renderShiprocketPoweredBy() {
    if (!hasShiprocketCheckout()) return "";
    // Deliberately not reusing ShipRocket's own "sr-powered-by" class here —
    // their sr-checkout.css positions it for their own button's markup
    // (absolute-positioned, landing outside ours), so only our own class
    // controls layout.
    return '<span class="cd-sr-powered-by">' +
      '<img src="https://fastrr-boost-ui.pickrr.com/assets/images/boost_button/powered_by.svg" alt="Powered by ShipRocket">' +
    '</span>';
  }

  // ─── Render Footer ────────────────────────────────────────────
  function renderFooter(cart) {
    if (!cart) return "";

    var totalPrice = cart.total_price;
    var originalTotal = cart.original_total_price || totalPrice;
    var hasSavings = originalTotal > totalPrice;
    var savings = originalTotal - totalPrice;

    var showPrepaid = state.settings && state.settings.showPrepaidBanner && state.settings.prepaidBannerText;
    var checkoutText = (state.settings && state.settings.checkoutButtonText) || "CHECKOUT";

    var payMethods = state.settings && state.settings.paymentMethodsText;

    var html = '<div class="cd-footer' + (showPrepaid ? " cd-footer--has-ribbon" : "") + '">';

    if (showPrepaid) {
      html +=
        '<div class="cd-prepaid-ribbon">' +
          '<svg class="cd-prepaid-ribbon-wing" width="14" height="19" viewBox="0 0 14 19" fill="none" aria-hidden="true">' +
            '<path d="M8.34334 4.75V9.5H0V4.75C0 2.12665 1.86772 0 4.17167 0C6.47562 0 8.34334 2.12665 8.34334 4.75Z" fill="#a00117"></path>' +
            '<path d="M12.1545 19H13.9056V0H4.17167C6.27666 0 7.98284 1.943 7.98284 4.33981V14.25C7.98284 16.8734 9.85056 19 12.1545 19Z" fill="#ce021e"></path>' +
          '</svg>' +
          '<div class="cd-prepaid-ribbon-center">' + esc(state.settings.prepaidBannerText) + '</div>' +
          '<svg class="cd-prepaid-ribbon-wing" width="14" height="19" viewBox="0 0 14 19" fill="none" aria-hidden="true">' +
            '<path d="M5.65666 4.75V9.5H14V4.75C14 2.12665 12.1323 0 9.82833 0C7.52438 0 5.65666 2.12665 5.65666 4.75Z" fill="#a00117"></path>' +
            '<path d="M1.84549 19H0.0944166V0H9.82833C7.72334 0 6.01716 1.943 6.01716 4.33981V14.25C6.01716 16.8734 4.14944 19 1.84549 19Z" fill="#ce021e"></path>' +
          '</svg>' +
        '</div>';
    }

    if (hasSavings) {
      html += '<div class="cd-footer-savings">Saving ' + formatMoney(savings) + '</div>';
    }

    // Price sits beside the checkout button instead of a separate
    // subtotal/total block; "See Details" opens the fuller Price Summary
    // panel and now sits under the price, not under the button.
    html += '<div class="cd-footer-price-row">' +
      '<div class="cd-footer-price">' +
        '<span class="cd-footer-price-current">' + formatMoney(totalPrice) + '</span>' +
        (hasSavings ? '<span class="cd-footer-price-compare">' + formatMoney(originalTotal) + '</span>' : '') +
      '</div>' +
      (hasShiprocketCheckout()
        ? '<button type="button" class="cd-checkout-btn cd-checkout-btn--sr" data-action="checkout">' +
            '<span class="cd-sr-row-main">' +
              '<span>' + esc(checkoutText) + '</span>' +
              renderShiprocketIcons() +
              '<span class="cd-checkout-arrow" aria-hidden="true">&rarr;</span>' +
            '</span>' +
            renderShiprocketPoweredBy() +
          '</button>'
        : '<button type="button" class="cd-checkout-btn" data-action="checkout">' +
            '<span>' + esc(checkoutText) + '</span>' +
            renderPayBadges(payMethods) +
            '<span class="cd-checkout-arrow" aria-hidden="true">&rarr;</span>' +
          '</button>') +
    '</div>';

    html += '<button type="button" class="cd-summary-details" data-action="open-summary">See Details</button>';

    html += '</div>';
    return html;
  }

  // ─── Render Price Summary panel ────────────────────────────────
  // Full-panel overlay (slides up over the whole drawer) opened by "See
  // Details" — a proper itemized breakdown rather than an inline strip.
  function renderPriceSummary(cart) {
    if (!cart) return "";

    var totalPrice = cart.total_price;
    var originalTotal = cart.original_total_price || totalPrice;
    var hasSavings = originalTotal > totalPrice;
    var savings = originalTotal - totalPrice;

    var checkoutText = (state.settings && state.settings.checkoutButtonText) || "CHECKOUT";
    var payMethods = state.settings && state.settings.paymentMethodsText;

    return '<div class="cd-price-summary" aria-hidden="true">' +
      '<div class="cd-price-summary-header">' +
        '<h2>Price Summary</h2>' +
        '<button type="button" class="cd-close" data-action="close-summary" aria-label="Close price summary">' +
          '<svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M14 4L4 14M4 4l10 10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>' +
        '</button>' +
      '</div>' +
      '<div class="cd-price-summary-body">' +
        '<div class="cd-breakdown-row"><span>Subtotal</span><span>' + formatMoney(originalTotal) + '</span></div>' +
        (hasSavings
          ? '<div class="cd-breakdown-row cd-breakdown-row--disc"><span>Discount</span><span>&minus;' + formatMoney(savings) + '</span></div>'
          : '') +
        '<div class="cd-breakdown-divider"></div>' +
        '<div class="cd-breakdown-row cd-breakdown-row--total">' +
          '<span>Grand Total' + (cart.taxes_included ? '<small>Inclusive of all taxes</small>' : '') + '</span>' +
          '<span>' + formatMoney(totalPrice) + '</span>' +
        '</div>' +
      '</div>' +
      (hasSavings
        ? '<div class="cd-price-summary-banner">You saved ' + formatMoney(savings) + ' on your order</div>'
        : '') +
      (hasShiprocketCheckout()
        ? '<button type="button" class="cd-checkout-btn cd-checkout-btn--sr" data-action="checkout">' +
            '<span class="cd-sr-row-main">' +
              '<span>' + esc(checkoutText) + '</span>' +
              renderShiprocketIcons() +
              '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
                '<polyline points="9 6 15 12 9 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
              '</svg>' +
            '</span>' +
            renderShiprocketPoweredBy() +
          '</button>'
        : '<button type="button" class="cd-checkout-btn" data-action="checkout">' +
            '<span>' + esc(checkoutText) + '</span>' +
            renderPayBadges(payMethods) +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
              '<polyline points="9 6 15 12 9 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
            '</svg>' +
          '</button>') +
    '</div>';
  }

  // ─── Attach Event Listeners ───────────────────────────────────
  function attachEvents() {
    if (!drawer) return;

    // Close
    drawer.querySelectorAll('[data-action="close"]').forEach(function (btn) {
      btn.addEventListener("click", closeDrawer);
    });

    // Apply coupon — stash the code and let the checkout handler append it to
    // the checkout URL, which is Shopify's supported way to pre-apply a
    // discount. We deliberately do not claim the code is valid here.
    drawer.querySelectorAll('[data-action="apply-coupon"]').forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.appliedCoupon = this.dataset.code || "";
        this.textContent = "APPLIED";
        this.disabled = true;
      });
    });

    // Toggle the subtotal/discount breakdown under the total.
    drawer.querySelectorAll('[data-action="open-summary"]').forEach(function (btn) {
      btn.addEventListener("click", function () {
        var panel = drawer.querySelector(".cd-price-summary");
        if (!panel) return;
        panel.classList.add("open");
        panel.setAttribute("aria-hidden", "false");
      });
    });

    drawer.querySelectorAll('[data-action="close-summary"]').forEach(function (btn) {
      btn.addEventListener("click", function () {
        var panel = drawer.querySelector(".cd-price-summary");
        if (!panel) return;
        panel.classList.remove("open");
        panel.setAttribute("aria-hidden", "true");
      });
    });

    // Quantity minus
    drawer.querySelectorAll('[data-action="qty-minus"]').forEach(function (btn) {
      btn.addEventListener("click", function () {
        var key = this.dataset.key;
        var qty = parseInt(this.dataset.qty);
        if (qty <= 0) {
          removeItem(key);
        } else {
          updateQuantity(key, qty);
        }
      });
    });

    // Quantity plus
    drawer.querySelectorAll('[data-action="qty-plus"]').forEach(function (btn) {
      btn.addEventListener("click", function () {
        var key = this.dataset.key;
        var qty = parseInt(this.dataset.qty);
        updateQuantity(key, qty);
      });
    });

    // Remove
    drawer.querySelectorAll('[data-action="remove"]').forEach(function (btn) {
      btn.addEventListener("click", function () {
        removeItem(this.dataset.key);
      });
    });

    // Add recommendation
    drawer.querySelectorAll('[data-action="add-rec"]').forEach(function (btn) {
      btn.addEventListener("click", function () {
        var variantId = this.dataset.variantId;
        this.disabled = true;
        this.textContent = "Adding...";
        addToCart(variantId, 1);
      });
    });

    // Add upsell
    drawer.querySelectorAll('[data-action="add-upsell"]').forEach(function (btn) {
      btn.addEventListener("click", function () {
        var variantId = this.dataset.variantId;
        this.disabled = true;
        this.textContent = "Adding...";
        addToCart(variantId, 1);
      });
    });

    // Checkout
    drawer.querySelectorAll('[data-action="checkout"]').forEach(function (btn) {
      btn.addEventListener("click", function () {
        closeDrawer();

        // ShipRocket (Fastrr Boost), when installed and active on the store,
        // exposes this on window — calling it opens their payment popup
        // directly instead of navigating to Shopify's native checkout.
        // Confirmed working via manual console test before wiring this in.
        if (typeof window.shiprocketCheckoutBuyCartHandler === "function") {
          try {
            window.shiprocketCheckoutBuyCartHandler();
            return;
          } catch (err) {
            // Fall through to native checkout rather than leaving the
            // customer stuck on a failed handler call.
          }
        }

        // Pre-apply the coupon via the discount query param — Shopify validates
        // it at checkout, so an invalid code degrades to a normal checkout
        // rather than silently claiming a discount the customer won't get.
        var url = "/checkout";
        if (state.appliedCoupon) {
          url += "?discount=" + encodeURIComponent(state.appliedCoupon);
        }
        window.location.href = url;
      });
    });
  }

  // ─── Intercept Add-to-Cart ────────────────────────────────────
  function interceptAddToCart() {
    if (!config.interceptAtc) return;

    // Intercept form submissions
    document.addEventListener("submit", function (e) {
      var form = e.target;
      if (form.tagName !== "FORM") return;
      var action = form.getAttribute("action");
      if (!action || !action.includes("/cart/add")) return;

      var formData = new FormData(form);
      var id = formData.get("id");
      // No variant id on this form (theme names the field differently, or
      // it's set dynamically outside FormData's reach) — don't swallow the
      // submit, let the theme's own handling add the item instead.
      // Previously this preventDefault()'d unconditionally, so a form we
      // couldn't read from silently dropped the add-to-cart entirely.
      if (!id) return;

      e.preventDefault();
      e.stopPropagation();

      var qty = formData.get("quantity") || 1;
      var items = [{ id: Number(id), quantity: Number(qty) }];

      fetch("/cart/add.js", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: items }),
      })
        .then(function (r) {
          if (!r.ok) return r.json().then(function (b) { throw new Error(b.description || "Add to cart failed"); });
          return fetchCart();
        })
        .then(function () {
          fetchRecommendations();
          openDrawer();
        })
        .catch(function (err) {
          console.warn("Cart drawer: add to cart failed", err.message);
        });
    }, true);

    // Intercept fetch/XHR to /cart/add.js (for themes using AJAX). Only the
    // theme's own /cart/add call tells us whether Shopify actually accepted
    // it (e.g. rejects out-of-stock variants with a non-2xx status) — react
    // to that instead of always assuming success, and log the rejection so
    // a silently-failing add is no longer invisible.
    var origFetch = window.fetch;
    window.fetch = function () {
      var args = arguments;
      var url = typeof args[0] === "string" ? args[0] : (args[0] && args[0].url ? args[0].url : "");
      var result = origFetch.apply(this, args);

      if (/\/cart\/(add|update|change)/.test(url)) {
        result.then(function (r) {
          var isAdd = /\/cart\/add/.test(url);
          if (isAdd && r && !r.ok) {
            r.clone().json().then(function (b) {
              console.warn("Cart drawer: theme's add-to-cart was rejected by Shopify", b.description || b.message || r.status);
            }).catch(function () {
              console.warn("Cart drawer: theme's add-to-cart was rejected by Shopify (status " + r.status + ")");
            });
            return;
          }
          setTimeout(function () {
            fetchCart().then(function () {
              if (isAdd) {
                fetchRecommendations();
                openDrawer();
              }
            });
          }, 300);
        });
      }

      return result;
    };

    // Also intercept XMLHttpRequest
    var origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
      this._cdUrl = url;
      return origOpen.apply(this, arguments);
    };
    var origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function () {
      var self = this;
      this.addEventListener("load", function () {
        if (self._cdUrl && /\/cart\/(add|update|change)/.test(self._cdUrl)) {
          var isAdd = /\/cart\/add/.test(self._cdUrl);
          if (isAdd && (self.status < 200 || self.status >= 300)) {
            var reason = self.status;
            try { reason = JSON.parse(self.responseText).description || reason; } catch (e) {}
            console.warn("Cart drawer: theme's add-to-cart was rejected by Shopify", reason);
            return;
          }
          setTimeout(function () {
            fetchCart().then(function () {
              if (isAdd) {
                fetchRecommendations();
                openDrawer();
              }
            });
          }, 300);
        }
      });
      return origSend.apply(this, arguments);
    };

    // Intercept cart icon clicks to open drawer instead
    document.addEventListener("click", function (e) {
      var link = e.target.closest('a[href="/cart"], a[href*="/cart"]');
      if (link && !link.closest(".cd-drawer")) {
        var href = link.getAttribute("href");
        if (href === "/cart" || href === "/cart/") {
          e.preventDefault();
          openDrawer();
        }
      }
    }, true);
  }

  // ─── Keyboard ─────────────────────────────────────────────────
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && state.isOpen) closeDrawer();
  });

  // ─── Initialize ───────────────────────────────────────────────
  injectNativeCartHideCSS(); // Hide native cart drawer permanently
  fetchSettings();
  interceptAddToCart();

  // ShipRocket's script tags are `defer`red, so shiprocketCheckoutBuyCartHandler
  // may not exist yet on the very first render() — poll briefly and re-render
  // once it appears, so the badges above don't just depend on load-order luck.
  (function watchForShiprocket() {
    var attempts = 0;
    var timer = setInterval(function () {
      attempts++;
      if (hasShiprocketCheckout()) {
        clearInterval(timer);
        if (state.isOpen) render();
      } else if (attempts >= 20) {
        clearInterval(timer); // ~10s — not installed/active on this page.
      }
    }, 500);
  })();

  // Expose openDrawer globally for theme integration
  window.openCartDrawer = openDrawer;
  window.closeCartDrawer = closeDrawer;
})();
