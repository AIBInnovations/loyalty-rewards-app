/**
 * Volume Discounts - storefront renderer.
 * Fetches active campaigns from the App Proxy and renders:
 *   - a tier ladder on product pages
 *   - a progress banner on the cart page
 * The actual discount is enforced by Shopify's automatic discounts;
 * this script is presentational only.
 */
(function () {
  "use strict";

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function getRoot() {
    return document.querySelector("[data-volume-discount-root]");
  }

  function currentTemplate(root) {
    var t = (root && root.dataset && root.dataset.templateName) || "";
    if (t) return t;
    var cls = document.body ? document.body.className || "" : "";
    if (/template-product|\bproduct\b/.test(cls)) return "product";
    if (/template-cart|\bcart\b/.test(cls)) return "cart";
    if (/\/products\//.test(location.pathname)) return "product";
    if (/\/cart/.test(location.pathname)) return "cart";
    return "";
  }

  function detectProductId(root) {
    if (root && root.dataset && root.dataset.productId) {
      return root.dataset.productId;
    }
    try {
      var id =
        (window.ShopifyAnalytics &&
          window.ShopifyAnalytics.meta &&
          window.ShopifyAnalytics.meta.product &&
          window.ShopifyAnalytics.meta.product.id) ||
        (window.meta &&
          window.meta.product &&
          window.meta.product.id);
      if (id) return "gid://shopify/Product/" + id;
    } catch (e) {}
    var form = document.querySelector('form[action*="/cart/add"]');
    if (form) {
      var pid = form.getAttribute("data-product-id");
      if (pid) {
        return pid.indexOf("gid://") === 0
          ? pid
          : "gid://shopify/Product/" + pid;
      }
    }
    return "";
  }

  function findProductMountTarget() {
    var selectors = [
      'form[action*="/cart/add"]',
      '[data-product-form]',
      '.product-form',
      '.product__info',
      'main .product',
    ];
    for (var i = 0; i < selectors.length; i++) {
      var el = document.querySelector(selectors[i]);
      if (el) return el;
    }
    return null;
  }

  function formatValue(tier) {
    if (tier.valueType === "percentage") {
      return tier.value + "% off";
    }
    return "₹" + Number(tier.value).toFixed(0) + " off";
  }

  function tierLabel(tier) {
    if (tier.label && tier.label.trim()) return tier.label;
    return "Buy " + tier.minQuantity + "+, save " + formatValue(tier);
  }

  function fetchCampaigns(proxyUrl, productId) {
    var url = proxyUrl + "/volume-discounts";
    if (productId) url += "?productId=" + encodeURIComponent(productId);
    return fetch(url, { credentials: "same-origin" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .catch(function () {
        return { campaigns: [] };
      });
  }

  function getQuantityFromDOM() {
    var input =
      document.querySelector('input[name="quantity"]') ||
      document.querySelector('input[data-quantity-input]') ||
      document.querySelector('[data-quantity] input');
    if (!input) return 1;
    var n = parseInt(input.value, 10);
    return isNaN(n) || n < 1 ? 1 : n;
  }

  function highestQualifyingTier(tiers, qty) {
    var active = null;
    for (var i = 0; i < tiers.length; i++) {
      if (qty >= tiers[i].minQuantity) {
        if (!active || tiers[i].minQuantity > active.minQuantity) {
          active = tiers[i];
        }
      }
    }
    return active;
  }

  function nextTier(tiers, qty) {
    for (var i = 0; i < tiers.length; i++) {
      if (qty < tiers[i].minQuantity) return tiers[i];
    }
    return null;
  }

  function renderLadder(campaign, qty) {
    var tiers = campaign.tiers || [];
    if (!tiers.length) return "";
    var active = highestQualifyingTier(tiers, qty);
    var next = nextTier(tiers, qty);
    var color = campaign.primaryColor || "#5C6AC4";

    var items = tiers
      .map(function (t) {
        var isActive = active && t.minQuantity === active.minQuantity;
        return (
          '<li class="vd-widget__tier' +
          (isActive ? " is-active" : "") +
          '">' +
          '<span class="vd-widget__tier-label">' +
          esc(tierLabel(t)) +
          "</span>" +
          '<span class="vd-widget__tier-value">' +
          esc(formatValue(t)) +
          "</span>" +
          "</li>"
        );
      })
      .join("");

    var progress = "";
    if (next) {
      var remaining = next.minQuantity - qty;
      progress =
        '<div class="vd-widget__progress">Add <strong>' +
        remaining +
        " more</strong> to unlock <strong>" +
        esc(formatValue(next)) +
        "</strong></div>";
    } else if (active) {
      progress =
        '<div class="vd-widget__progress">You\'ve unlocked <strong>' +
        esc(formatValue(active)) +
        "</strong>.</div>";
    }

    var qtyControl =
      '<div class="vd-qty" role="group" aria-label="Quantity">' +
      '<button type="button" class="vd-qty__btn" data-vd-qty-dec aria-label="Decrease quantity"' +
      (qty <= 1 ? " disabled" : "") +
      ">&minus;</button>" +
      '<input type="number" class="vd-qty__input" min="1" value="' +
      qty +
      '" data-vd-qty-input aria-label="Quantity" />' +
      '<button type="button" class="vd-qty__btn" data-vd-qty-inc aria-label="Increase quantity">+</button>' +
      "</div>";

    return (
      '<div class="vd-widget" style="--vd-color:' +
      esc(color) +
      '">' +
      '<div class="vd-widget__header">' +
      '<span class="vd-widget__badge">' +
      esc(campaign.badgeText || "Volume Discount") +
      "</span>" +
      '<span class="vd-widget__title">' +
      esc(campaign.title || "") +
      "</span>" +
      "</div>" +
      qtyControl +
      '<ul class="vd-widget__list">' +
      items +
      "</ul>" +
      progress +
      '<div class="vd-widget__note">Discount is applied automatically at checkout.</div>' +
      "</div>"
    );
  }

  function getThemeQuantityInput() {
    return (
      document.querySelector('form[action*="/cart/add"] input[name="quantity"]') ||
      document.querySelector('input[name="quantity"]') ||
      document.querySelector('input[data-quantity-input]') ||
      document.querySelector('[data-quantity] input')
    );
  }

  function setThemeQuantity(value) {
    var n = Math.max(1, parseInt(value, 10) || 1);
    var input = getThemeQuantityInput();
    if (input) {
      input.value = String(n);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return n;
  }

  function mountProduct(root, campaigns) {
    var visible = campaigns.filter(function (c) {
      return c.showOnProductPage !== false;
    });
    if (!visible.length) return;

    var container = document.createElement("div");
    container.setAttribute("data-vd-ladder", "");

    var target = findProductMountTarget();
    if (target && target.parentNode) {
      target.parentNode.insertBefore(container, target);
    } else {
      root.appendChild(container);
    }

    function paint() {
      var qty = getQuantityFromDOM();
      container.innerHTML = visible
        .map(function (c) {
          return renderLadder(c, qty);
        })
        .join("");
    }
    paint();

    // Widget-local +/- buttons drive the theme quantity input
    container.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.closest) return;

      var dec = t.closest("[data-vd-qty-dec]");
      var inc = t.closest("[data-vd-qty-inc]");
      if (!dec && !inc) return;

      e.preventDefault();
      var current = getQuantityFromDOM();
      var next = inc ? current + 1 : Math.max(1, current - 1);
      setThemeQuantity(next);
      paint();
    });

    container.addEventListener("change", function (e) {
      var t = e.target;
      if (t && t.hasAttribute && t.hasAttribute("data-vd-qty-input")) {
        setThemeQuantity(t.value);
        paint();
      }
    });

    // Re-render whenever the underlying theme quantity changes from elsewhere
    document.addEventListener(
      "change",
      function (e) {
        var t = e.target;
        if (!t) return;
        if (t.hasAttribute && t.hasAttribute("data-vd-qty-input")) return;
        if (
          t.name === "quantity" ||
          (t.getAttribute && t.getAttribute("data-quantity-input"))
        ) {
          paint();
        }
      },
      true,
    );
    document.addEventListener(
      "input",
      function (e) {
        var t = e.target;
        if (!t) return;
        if (t.hasAttribute && t.hasAttribute("data-vd-qty-input")) return;
        if (t.name === "quantity") paint();
      },
      true,
    );
    document.addEventListener(
      "click",
      function (e) {
        var t = e.target;
        if (!t || !t.closest) return;
        if (t.closest("[data-vd-ladder]")) return;
        if (
          t.closest("[data-quantity-selector]") ||
          t.closest(".quantity__button") ||
          t.closest("[name=minus]") ||
          t.closest("[name=plus]")
        ) {
          setTimeout(paint, 50);
        }
      },
      true,
    );
  }

  function fetchCart() {
    return fetch("/cart.js", { credentials: "same-origin" })
      .then(function (r) {
        return r.json();
      })
      .catch(function () {
        return null;
      });
  }

  function productGidFromCartItem(item) {
    return "gid://shopify/Product/" + item.product_id;
  }

  function renderCartBanner(campaign, qty) {
    var tiers = campaign.tiers || [];
    if (!tiers.length) return "";
    var active = highestQualifyingTier(tiers, qty);
    var next = nextTier(tiers, qty);
    var color = campaign.primaryColor || "#5C6AC4";
    var msg;
    if (next) {
      msg =
        "Add <strong>" +
        (next.minQuantity - qty) +
        " more</strong> of " +
        esc(campaign.title) +
        " to unlock <strong>" +
        esc(formatValue(next)) +
        "</strong>.";
    } else if (active) {
      msg =
        "<strong>" +
        esc(formatValue(active)) +
        "</strong> unlocked on " +
        esc(campaign.title) +
        ".";
    } else {
      return "";
    }
    return (
      '<div class="vd-cart" style="--vd-color:' +
      esc(color) +
      '">' +
      msg +
      "</div>"
    );
  }

  function mountCart(root, campaigns) {
    var visible = campaigns.filter(function (c) {
      return c.showInCart !== false;
    });
    if (!visible.length) return;

    fetchCart().then(function (cart) {
      if (!cart || !cart.items) return;

      // For each campaign, figure out qualifying quantity in cart
      var html = visible
        .map(function (c) {
          var qty = 0;
          if (c.scope === "all") {
            qty = cart.items.reduce(function (acc, it) {
              return acc + (it.quantity || 0);
            }, 0);
          } else {
            var ids = new Set(c.productIds || []);
            qty = cart.items.reduce(function (acc, it) {
              return ids.has(productGidFromCartItem(it))
                ? acc + (it.quantity || 0)
                : acc;
            }, 0);
          }
          return renderCartBanner(c, qty);
        })
        .filter(Boolean)
        .join("");

      if (!html) return;

      // Try common cart containers
      var target =
        document.querySelector("[data-vd-cart-slot]") ||
        document.querySelector("cart-drawer") ||
        document.querySelector(".cart__items") ||
        document.querySelector("#cart") ||
        document.querySelector("form[action*='/cart']");

      var banner = document.createElement("div");
      banner.setAttribute("data-vd-cart-banner", "");
      banner.innerHTML = html;

      if (target) {
        target.parentNode.insertBefore(banner, target);
      } else {
        root.appendChild(banner);
      }
    });
  }

  function init() {
    var root = getRoot();
    if (!root) return;
    var proxyUrl = root.dataset.appProxyUrl || "/apps/loyalty";
    var template = currentTemplate(root);
    var productId = detectProductId(root);

    if (template.indexOf("product") === 0) {
      if (!productId) return;
      fetchCampaigns(proxyUrl, productId).then(function (res) {
        if (!res.campaigns || !res.campaigns.length) return;
        mountProduct(root, res.campaigns);
      });
    } else if (template.indexOf("cart") === 0) {
      fetchCampaigns(proxyUrl, "").then(function (res) {
        if (!res.campaigns || !res.campaigns.length) return;
        mountCart(root, res.campaigns);
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
