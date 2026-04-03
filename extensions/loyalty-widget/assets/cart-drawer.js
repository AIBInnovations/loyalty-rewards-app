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
    var amount = (cents / 100).toFixed(2);
    // Remove trailing zeros
    amount = amount.replace(/\.00$/, "");
    return "₹" + Number(amount).toLocaleString("en-IN");
  }

  function formatMoneyNumber(cents) {
    return (cents / 100).toFixed(2).replace(/\.00$/, "");
  }

  // ─── Escape HTML ──────────────────────────────────────────────
  function esc(str) {
    if (!str) return "";
    var d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }

  // ─── Fetch Settings from App Proxy ────────────────────────────
  function fetchSettings() {
    // Check sessionStorage cache
    var cached = sessionStorage.getItem("cd_settings");
    if (cached) {
      try {
        var parsed = JSON.parse(cached);
        if (parsed._ts && Date.now() - parsed._ts < 300000) { // 5 min TTL
          state.settings = parsed;
          state.tiers = parsed.tiers || [];
          state.settingsLoaded = true;
          return;
        }
      } catch (e) {}
    }

    fetch("/apps/loyalty/cart-settings")
      .then(function (r) {
        if (!r.ok) throw new Error("Failed");
        var ct = r.headers.get("content-type") || "";
        if (!ct.includes("application/json")) throw new Error("Not JSON");
        return r.json();
      })
      .then(function (data) {
        data._ts = Date.now();
        sessionStorage.setItem("cd_settings", JSON.stringify(data));
        state.settings = data;
        state.tiers = data.tiers || [];
        state.settingsLoaded = true;
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

  // ─── Open / Close ─────────────────────────────────────────────
  function openDrawer() {
    state.isOpen = true;
    if (!isRendered) createDOM();
    render();
    fetchCart().then(function () { fetchRecommendations(); });
    overlay.classList.add("open");
    drawer.classList.add("open");
    document.body.style.overflow = "hidden";
  }

  function closeDrawer() {
    state.isOpen = false;
    overlay.classList.remove("open");
    drawer.classList.remove("open");
    document.body.style.overflow = "";
  }

  // ─── Create DOM Shell ─────────────────────────────────────────
  function createDOM() {
    overlay = document.createElement("div");
    overlay.className = "cd-overlay";
    overlay.addEventListener("click", closeDrawer);

    drawer = document.createElement("div");
    drawer.className = "cd-drawer";

    document.body.appendChild(overlay);
    document.body.appendChild(drawer);
    isRendered = true;
  }

  // ─── Render ───────────────────────────────────────────────────
  function render() {
    if (!drawer) return;
    var cart = state.cart;
    var itemCount = cart ? cart.item_count : 0;

    drawer.innerHTML =
      renderHeader(itemCount) +
      (config.showProgress && state.tiers.length ? renderProgressBar(cart) : "") +
      (itemCount > 0 ? renderItems(cart) : renderEmpty()) +
      (config.showRecommendations && state.recommendations.length ? renderRecommendations() : "") +
      (itemCount > 0 ? renderFooter(cart) : "");

    attachEvents();
  }

  // ─── Render Header ────────────────────────────────────────────
  function renderHeader(count) {
    return '<div class="cd-header">' +
      '<h2 class="cd-header-title">Your Cart<span class="cd-header-count">(' + count + ')</span></h2>' +
      '<button class="cd-close" data-action="close" aria-label="Close">' +
        '<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M14 4L4 14M4 4l10 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' +
      '</button>' +
    '</div>';
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
      message = nextTier.belowMessage
        .replace("{remaining}", String(Math.ceil(remaining)))
        .replace("{label}", "<strong>" + esc(nextTier.label) + "</strong>");
    } else if (activeTierIndex >= 0) {
      message = tiers[activeTierIndex].reachedMessage
        .replace("{label}", "<strong>" + esc(tiers[activeTierIndex].label) + "</strong>");
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

    // Render milestones
    var milestonesHtml = "";
    for (var j = 0; j < tiers.length; j++) {
      var t = tiers[j];
      var isReached = j <= activeTierIndex;
      var isActive = j === nextTierIndex;
      var dotClass = "cd-tier-dot" + (isReached ? " reached" : "") + (isActive ? " active" : "");
      var labelClass = "cd-tier-label" + (isReached ? " reached" : "");

      milestonesHtml +=
        '<div class="cd-tier-milestone">' +
          '<div class="' + dotClass + '">' +
            (isReached ? "✓" : (j + 1)) +
          '</div>' +
          '<span class="' + labelClass + '">' + esc(t.label) + '</span>' +
          '<span class="cd-tier-sublabel">' +
            (t.type === "items" ? t.threshold + " item" + (t.threshold > 1 ? "s" : "") : "₹" + t.threshold) +
          '</span>' +
        '</div>';
    }

    var goalReachedClass = activeTierIndex === tiers.length - 1 ? " goal-reached" : "";

    return '<div class="cd-progress-section' + goalReachedClass + '">' +
      (message ? '<p class="cd-progress-message">' + message + '</p>' : "") +
      '<div class="cd-progress-tiers">' +
        '<div class="cd-progress-track"></div>' +
        '<div class="cd-progress-fill" style="width:' + fillPercent + '%"></div>' +
        milestonesHtml +
      '</div>' +
    '</div>';
  }

  // ─── Render Cart Items ────────────────────────────────────────
  function renderItems(cart) {
    if (!cart || !cart.items || !cart.items.length) return renderEmpty();

    var html = '<div class="cd-items">';
    cart.items.forEach(function (item) {
      var hasCompare = item.original_line_price > item.final_line_price;
      var discountPercent = hasCompare
        ? Math.round((1 - item.final_line_price / item.original_line_price) * 100)
        : 0;
      var imgSrc = item.featured_image
        ? item.featured_image.url || item.image
        : item.image || "";
      // Resize image
      if (imgSrc) {
        imgSrc = imgSrc.replace(/(\.\w+)(\?|$)/, "_200x200$1$2");
      }

      var variantTitle = item.variant_title && item.variant_title !== "Default Title"
        ? item.variant_title : "";

      html +=
        '<div class="cd-item">' +
          '<div class="cd-item-img">' +
            (imgSrc ? '<img src="' + esc(imgSrc) + '" alt="' + esc(item.title) + '" loading="lazy"/>' : '') +
          '</div>' +
          '<div class="cd-item-details">' +
            '<p class="cd-item-title">' + esc(item.product_title) + '</p>' +
            (variantTitle ? '<p class="cd-item-variant">' + esc(variantTitle) + '</p>' : '') +
            '<div class="cd-item-price-row">' +
              '<span class="cd-item-price">' + formatMoney(item.final_line_price) + '</span>' +
              (hasCompare ? '<span class="cd-item-compare-price">' + formatMoney(item.original_line_price) + '</span>' : '') +
              (discountPercent > 0 ? '<span class="cd-item-discount-badge">' + discountPercent + '% OFF</span>' : '') +
            '</div>' +
            '<div class="cd-item-actions">' +
              '<div class="cd-qty">' +
                '<button data-action="qty-minus" data-key="' + item.key + '" data-qty="' + (item.quantity - 1) + '">-</button>' +
                '<span>' + item.quantity + '</span>' +
                '<button data-action="qty-plus" data-key="' + item.key + '" data-qty="' + (item.quantity + 1) + '">+</button>' +
              '</div>' +
              '<button class="cd-item-remove" data-action="remove" data-key="' + item.key + '" aria-label="Remove">' +
                '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>' +
              '</button>' +
            '</div>' +
          '</div>' +
        '</div>';
    });
    html += '</div>';
    return html;
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
  function renderRecommendations() {
    if (!state.recommendations.length) return "";

    var title = (state.settings && state.settings.recommendationsTitle) || config.recommendationsTitle;

    var html = '<div class="cd-recs-section">' +
      '<h3 class="cd-recs-title">' + esc(title) + '</h3>' +
      '<div class="cd-recs-carousel">';

    state.recommendations.forEach(function (p) {
      var hasCompare = p.compare_at_price && p.compare_at_price > p.price;
      var discountPercent = hasCompare
        ? Math.round((1 - p.price / p.compare_at_price) * 100)
        : 0;
      var imgSrc = "";
      if (p.featured_image) {
        imgSrc = typeof p.featured_image === "string" ? p.featured_image : (p.featured_image.url || "");
      }
      if (imgSrc) {
        imgSrc = imgSrc.replace(/(\.\w+)(\?|$)/, "_300x300$1$2");
      }

      var variantId = p.variants && p.variants.length ? p.variants[0].id : "";

      html +=
        '<div class="cd-rec-card">' +
          (discountPercent > 0 ? '<span class="cd-rec-badge">' + discountPercent + '% OFF</span>' : '') +
          (imgSrc ? '<img class="cd-rec-img" src="' + esc(imgSrc) + '" alt="' + esc(p.title) + '" loading="lazy"/>' : '<div class="cd-rec-img" style="background:#f0f0f0"></div>') +
          '<div class="cd-rec-info">' +
            '<p class="cd-rec-name">' + esc(p.title) + '</p>' +
            '<div class="cd-rec-prices">' +
              '<span class="cd-rec-price">' + formatMoney(p.price) + '</span>' +
              (hasCompare ? '<span class="cd-rec-compare">' + formatMoney(p.compare_at_price) + '</span>' : '') +
            '</div>' +
          '</div>' +
          '<button class="cd-rec-add" data-action="add-rec" data-variant-id="' + variantId + '">Add to Cart</button>' +
        '</div>';
    });

    html += '</div></div>';
    return html;
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

    var html = '<div class="cd-footer">';

    if (showPrepaid) {
      html += '<div class="cd-prepaid-banner">🏷 ' + esc(state.settings.prepaidBannerText) + '</div>';
    }

    if (hasSavings) {
      html += '<div class="cd-savings">' +
        '<span class="cd-savings-badge">Saving ' + formatMoney(savings) + '</span>' +
      '</div>';
    }

    html += '<div class="cd-total-row">' +
      '<div>' +
        '<span class="cd-total-price">' + formatMoney(totalPrice) + '</span>' +
        (hasSavings ? '<span class="cd-total-compare">' + formatMoney(originalTotal) + '</span>' : '') +
      '</div>' +
      '<span class="cd-total-label">See Details</span>' +
    '</div>';

    html += '<button class="cd-checkout-btn" data-action="checkout">' +
      esc(checkoutText) +
      '<span class="cd-checkout-icons">💳</span>' +
    '</button>';

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

    // Checkout
    drawer.querySelectorAll('[data-action="checkout"]').forEach(function (btn) {
      btn.addEventListener("click", function () {
        closeDrawer();
        window.location.href = "/checkout";
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
  fetchSettings();
  interceptAddToCart();

  // Expose openDrawer globally for theme integration
  window.openCartDrawer = openDrawer;
  window.closeCartDrawer = closeDrawer;
})();
