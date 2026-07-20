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
    showRecommendations: container.dataset.showRecommendations === "true",
    recommendationsTitle: container.dataset.recommendationsTitle || "People Also Bought",
    showProgress: container.dataset.showProgress === "true",
    interceptAtc: container.dataset.interceptAtc === "true",
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
    recommendations: [],
    recsLoading: false,
    settingsLoaded: false,
    appliedCoupon: "",
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

  // ─── Fetch Settings from App Proxy ────────────────────────────
  function fetchSettings() {
    fetch("/apps/loyalty/cart-settings")
      .then(function (r) {
        if (!r.ok) throw new Error("Failed");
        var ct = r.headers.get("content-type") || "";
        if (!ct.includes("application/json")) throw new Error("Not JSON");
        return r.json();
      })
      .then(function (data) {
        state.settings = data;
        state.tiers = data.tiers || [];
        state.settingsLoaded = true;
        if (data.primaryColor) document.documentElement.style.setProperty("--cd-primary", data.primaryColor);
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
          };
        });

      state.recommendations = manualRecs;
      state.recsLoading = false;
      if (state.isOpen) render();
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

    drawer.innerHTML =
      renderHeader(itemCount) +
      '<div class="cd-body">' +
        renderShippingBanner() +
        (config.showProgress && state.tiers.length ? renderProgressBar(cart) : "") +
        (itemCount > 0 ? renderItems(cart) : renderEmpty()) +
        (itemCount > 0 ? renderCoupon() : "") +
        (shouldShowUpsell() ? renderUpsell() : "") +
        (config.showRecommendations && state.recommendations.length ? renderRecommendations() : "") +
      '</div>' +
      (itemCount > 0 ? renderFooter(cart) : "");

    attachEvents();
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
  function renderShippingBanner() {
    var text = state.settings && state.settings.shippingBannerText;
    if (!text) return "";
    return '<div class="cd-ship-banner">' + esc(text) + "</div>";
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

    // Calculate fill percentage
    var totalTiers = tiers.length;
    var fillPercent = 0;
    if (activeTierIndex >= 0) {
      fillPercent = ((activeTierIndex + 1) / totalTiers) * 100;
    }
    // Add partial progress to next tier
    if (nextTierIndex < totalTiers) {
      var nt = tiers[nextTierIndex];
      var cv = nt.type === "items" ? itemCount : cartTotal / 100;
      var prevThreshold = activeTierIndex >= 0 ? tiers[activeTierIndex].threshold : 0;
      var segmentProgress = (cv - prevThreshold) / (nt.threshold - prevThreshold);
      if (segmentProgress < 0) segmentProgress = 0;
      if (segmentProgress > 1) segmentProgress = 1;
      fillPercent += (segmentProgress / totalTiers) * 100;
    }
    if (fillPercent > 100) fillPercent = 100;

    // Milestone nodes sit on the track, evenly spaced by tier index. Each
    // shows a check once reached and the tier number until then.
    var nodesHtml = "";
    var legendHtml = "";
    for (var j = 0; j < tiers.length; j++) {
      var t = tiers[j];
      var isReached = j <= activeTierIndex;
      var nodeLeft = ((j + 1) / tiers.length) * 100;

      nodesHtml +=
        '<div class="cd-progress-node' + (isReached ? " reached" : "") + '"' +
          ' style="left:' + nodeLeft + '%">' +
          (isReached ? "✓" : String(j + 1)) +
        '</div>';

      var threshold = t.type === "items"
        ? t.threshold + " item" + (t.threshold > 1 ? "s" : "")
        : formatMoney(t.threshold * 100);

      legendHtml +=
        '<span class="' + (isReached ? "reached" : "") + '">' +
          esc(threshold) + " · " + esc(t.label) +
        '</span>';
    }

    var goalReachedClass = activeTierIndex === tiers.length - 1 ? " goal-reached" : "";

    return '<section class="cd-progress-section' + goalReachedClass + '"' +
      ' aria-label="Reward progress">' +
      (message ? '<p class="cd-progress-message">' + message + '</p>' : "") +
      '<div class="cd-progress-track" role="progressbar"' +
        ' aria-valuemin="0" aria-valuemax="100"' +
        ' aria-valuenow="' + Math.round(fillPercent) + '">' +
        '<div class="cd-progress-fill" style="width:' + fillPercent + '%"></div>' +
        '<div class="cd-progress-dot" style="left:' + fillPercent + '%"></div>' +
        nodesHtml +
      '</div>' +
      '<div class="cd-progress-legend">' + legendHtml + '</div>' +
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
            '<p class="cd-item-title">' + esc(title) + '</p>' +
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
              '<button type="button" class="cd-item-remove" data-action="remove"' +
                ' data-key="' + escAttr(item.key) + '">Remove</button>' +
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

    return '<div class="cd-prod">' +
      '<div class="cd-prod-img">' +
        (imgSrc
          ? '<img src="' + escAttr(imgSrc) + '" alt="' + escAttr(opts.title) + '" loading="lazy"/>'
          : '') +
      '</div>' +
      '<p class="cd-prod-name">' + esc(opts.title) + '</p>' +
      '<div class="cd-prod-foot">' +
        '<span class="cd-prod-prices">' +
          '<span class="cd-prod-price">' + formatMoney(opts.price) + '</span>' +
          (opts.comparePrice
            ? '<span class="cd-prod-compare">' + formatMoney(opts.comparePrice) + '</span>'
            : '') +
        '</span>' +
        '<button type="button" class="cd-prod-add" data-action="' + escAttr(opts.action) + '"' +
          ' data-variant-id="' + escAttr(opts.variantId) + '"' +
          ' aria-label="Add ' + escAttr(opts.title) + ' to cart">+ Add</button>' +
      '</div>' +
    '</div>';
  }

  function renderRecommendations() {
    if (!state.recommendations.length) return "";

    var title = (state.settings && state.settings.recommendationsTitle) || config.recommendationsTitle;

    var html = '<section class="cd-recs-section">' +
      '<h3 class="cd-recs-title">' + esc(title) + '</h3>' +
      '<div class="cd-recs-grid">';

    state.recommendations.slice(0, MAX_RECS).forEach(function (p) {
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
      });
    });

    html += '</div></section>';
    return html;
  }

  // ─── Upsell ───────────────────────────────────────────────────
  function shouldShowUpsell() {
    if (!state.settings || !state.settings.showUpsell) return false;
    if (!state.settings.upsellProduct) return false;
    if (!state.cart || !state.cart.items) return false;
    // Hide if product already in cart
    var cartIds = state.cart.items.map(function(i) { return String(i.product_id); });
    var upId = String(state.settings.upsellProduct.shopifyProductId || "")
      .replace("gid://shopify/Product/", "");
    return cartIds.indexOf(upId) === -1;
  }

  function renderUpsell() {
    var p = state.settings.upsellProduct;
    var discount = Number(state.settings.upsellDiscount) || 0;
    var headline = state.settings.upsellHeadline || "Special Offer Just For You!";
    var originalPrice = p.price || 0;
    var discountedPrice = Math.round(originalPrice * (1 - discount / 100));
    var variantId = String(p.variantId || "").replace("gid://shopify/ProductVariant/", "");
    var imgSrc = p.imageUrl || "";
    if (imgSrc) imgSrc = imgSrc.replace(/(\.\w+)(\?|$)/, "_160x160$1$2");

    return '<section class="cd-upsell-section">' +
      '<h3 class="cd-upsell-headline">' + esc(headline) + '</h3>' +
      '<div class="cd-recs-grid">' +
        renderProductCard({
          title: p.title,
          image: imgSrc,
          price: discountedPrice,
          comparePrice: discount > 0 ? originalPrice : 0,
          variantId: variantId,
          action: "add-upsell",
        }) +
      '</div>' +
    '</section>';
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

    var html = '<div class="cd-footer">';

    if (showPrepaid) {
      html += '<div class="cd-prepaid-banner">' + esc(state.settings.prepaidBannerText) + '</div>';
    }

    // Subtotal / discount / total breakdown, per the mockup.
    html += '<div class="cd-summary-row">' +
      '<span>Subtotal</span>' +
      '<span>' + formatMoney(originalTotal) + '</span>' +
    '</div>';

    if (hasSavings) {
      html += '<div class="cd-summary-row cd-summary-row--disc">' +
        '<span>Discounts</span>' +
        '<span>&minus;' + formatMoney(savings) + '</span>' +
      '</div>';
    }

    html += '<div class="cd-total-row">' +
      '<span>Total</span>' +
      '<span>' + formatMoney(totalPrice) + '</span>' +
    '</div>';

    html += '<button type="button" class="cd-checkout-btn" data-action="checkout">' +
      esc(checkoutText) + ' · ' + formatMoney(totalPrice) +
      '<span class="cd-checkout-arrow" aria-hidden="true">&rarr;</span>' +
    '</button>';

    if (payMethods) {
      html += '<div class="cd-pay-methods">' + esc(payMethods) + '</div>';
    }

    html += '</div>';
    return html;
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

      e.preventDefault();
      e.stopPropagation();

      var formData = new FormData(form);
      var items = [];
      var id = formData.get("id");
      var qty = formData.get("quantity") || 1;
      if (id) {
        items.push({ id: Number(id), quantity: Number(qty) });
      }

      if (items.length) {
        fetch("/cart/add.js", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: items }),
        })
          .then(function () { return fetchCart(); })
          .then(function () {
            fetchRecommendations();
            openDrawer();
          });
      }
    }, true);

    // Intercept fetch/XHR to /cart/add.js (for themes using AJAX)
    var origFetch = window.fetch;
    window.fetch = function () {
      var args = arguments;
      var url = typeof args[0] === "string" ? args[0] : (args[0] && args[0].url ? args[0].url : "");
      var result = origFetch.apply(this, args);

      if (/\/cart\/(add|update|change)/.test(url)) {
        result.then(function () {
          setTimeout(function () {
            fetchCart().then(function () {
              if (/\/cart\/add/.test(url)) {
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
          setTimeout(function () {
            fetchCart().then(function () {
              if (/\/cart\/add/.test(self._cdUrl)) {
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

  // Expose openDrawer globally for theme integration
  window.openCartDrawer = openDrawer;
  window.closeCartDrawer = closeDrawer;
})();
