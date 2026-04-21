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
    return "";
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
      '<ul class="vd-widget__list">' +
      items +
      "</ul>" +
      progress +
      '<div class="vd-widget__note">Discount is applied automatically at checkout.</div>' +
      "</div>"
    );
  }

  function mountProduct(root, campaigns) {
    var visible = campaigns.filter(function (c) {
      return c.showOnProductPage !== false;
    });
    if (!visible.length) return;

    var container = document.createElement("div");
    container.setAttribute("data-vd-ladder", "");
    root.appendChild(container);

    function paint() {
      var qty = getQuantityFromDOM();
      container.innerHTML = visible
        .map(function (c) {
          return renderLadder(c, qty);
        })
        .join("");
    }
    paint();

    // Re-render whenever quantity changes
    document.addEventListener(
      "change",
      function (e) {
        var t = e.target;
        if (
          t &&
          t.name === "quantity" ||
          (t && t.getAttribute && t.getAttribute("data-quantity-input"))
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
        if (t && t.name === "quantity") paint();
      },
      true,
    );
    document.addEventListener(
      "click",
      function (e) {
        var t = e.target;
        if (
          t &&
          t.closest &&
          (t.closest("[data-quantity-selector]") ||
            t.closest(".quantity__button") ||
            t.closest("[name=minus]") ||
            t.closest("[name=plus]"))
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
    var productId = root.dataset.productId || "";

    if (template.indexOf("product") === 0 && productId) {
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
