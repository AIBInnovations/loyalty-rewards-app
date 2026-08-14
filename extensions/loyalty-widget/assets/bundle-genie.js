(function () {
  "use strict";

  var root = document.getElementById("bundle-genie-widget");
  if (!root) return;

  var productId = root.dataset.productId;
  var moneyFormat = root.dataset.moneyFormat || "₹{{amount}}";
  if (!productId) return;

  function esc(str) {
    if (!str) return "";
    var d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }

  function track(bundleId, event) {
    // Fire-and-forget — analytics must never block or break the widget.
    try {
      fetch("/apps/loyalty/bundle-genie/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bundleId: bundleId, event: event }),
        keepalive: true,
      }).catch(function () {});
    } catch (e) {}
  }

  function formatMoney(cents, symbolOverride) {
    var amount = cents / 100;
    if (symbolOverride) return symbolOverride + amount.toFixed(0);
    var format = moneyFormat;
    if (format.indexOf("{{amount_no_decimals}}") !== -1) {
      return format.replace("{{amount_no_decimals}}", Math.round(amount).toString());
    }
    if (format.indexOf("{{amount}}") !== -1) {
      return format.replace("{{amount}}", amount.toFixed(2));
    }
    return "₹" + amount.toFixed(0);
  }

  function shadowValue(shadow) {
    if (shadow === "soft") return "0 1px 4px rgba(0,0,0,0.10)";
    if (shadow === "spread") return "0 6px 20px rgba(0,0,0,0.16)";
    return "none";
  }

  function injectCustomCss(css) {
    if (!css) return;
    var tag = document.getElementById("bg-genie-custom-css");
    if (!tag) {
      tag = document.createElement("style");
      tag.id = "bg-genie-custom-css";
      document.head.appendChild(tag);
    }
    // Scoped by the merchant writing selectors under .bg-genie-card themselves
    // (documented on the Customize screen) — not sandboxed further than that.
    tag.textContent = css;
  }

  function render(bundle) {
    var s = bundle.style || {};
    var vars = "";
    if (s.bgColor) vars += "--bg-genie-bg:" + s.bgColor + ";";
    if (s.textColor) vars += "--bg-genie-text:" + s.textColor + ";";
    if (s.buttonColor || s.primaryColor) vars += "--bg-genie-btn-bg:" + (s.buttonColor || s.primaryColor) + ";";
    if (s.buttonTextColor || s.primaryContrastColor) vars += "--bg-genie-btn-text:" + (s.buttonTextColor || s.primaryContrastColor) + ";";
    if (s.borderRadius != null) vars += "--bg-genie-radius:" + s.borderRadius + "px;";
    if (s.fontFamily) vars += "--bg-genie-font:" + s.fontFamily + ";";
    if (s.secondaryColor) vars += "--bg-genie-secondary:" + s.secondaryColor + ";";
    if (s.sectionBgColor) vars += "--bg-genie-section-bg:" + s.sectionBgColor + ";";
    vars += "--bg-genie-align:" + (s.infoAlignment || "left") + ";";
    vars += "--bg-genie-title-size:" + (s.titleFontSize || 22) + "px;";
    vars += "--bg-genie-subtitle-size:" + (s.subtitleFontSize || 18) + "px;";
    if (s.titleBgColor) vars += "--bg-genie-title-bg:" + s.titleBgColor + ";";
    if (s.titleTextColor) vars += "--bg-genie-title-text:" + s.titleTextColor + ";";
    vars += "--bg-genie-card-radius:" + (s.cardBorderRadius != null ? s.cardBorderRadius : 12) + "px;";
    if (s.cardBorderColor) vars += "--bg-genie-card-border:" + s.cardBorderColor + ";";
    if (s.cardBgColor) vars += "--bg-genie-card-bg:" + s.cardBgColor + ";";
    vars += "--bg-genie-card-shadow:" + shadowValue(s.cardShadow) + ";";
    vars += "--bg-genie-img-height:" + (s.imageAspectRatio === "portrait" ? "64px" : "44px") + ";";
    if (s.ctaBorderColor) vars += "--bg-genie-cta-border:" + s.ctaBorderColor + ";";
    vars += "--bg-genie-cta-radius:" + (s.ctaBorderRadius != null ? s.ctaBorderRadius : 10) + "px;";
    vars += "--bg-genie-cta-width:" + (s.ctaWidth === "fit" ? "auto" : "100%") + ";";
    vars += "--bg-genie-cta-padding:" + (s.ctaPadding != null ? s.ctaPadding : 12) + "px;";
    vars += "--bg-genie-cta-shadow:" + shadowValue(s.ctaShadow) + ";";
    if (s.ctaHoverEnabled && s.ctaHoverBgColor) vars += "--bg-genie-cta-hover-bg:" + s.ctaHoverBgColor + ";";
    if (s.ctaHoverEnabled && s.ctaHoverTextColor) vars += "--bg-genie-cta-hover-text:" + s.ctaHoverTextColor + ";";

    injectCustomCss(s.customCss);

    var isVertical = s.cardLayoutStyle === "vertical" || (s.cardLayoutStyle === "auto" && s.layout === "list");

    var widget = document.createElement("div");
    widget.id = "bundle-genie-card";
    widget.className =
      "bg-genie-card bg-genie-layout--" + (isVertical ? "list" : "grid") +
      (s.ctaHoverEnabled ? " bg-genie-cta-hover" : "");
    widget.style.cssText = vars;

    var showPrice = s.showPrice !== false;
    var showCompareAt = s.showCompareAtPrice !== false;
    var currencySymbol = s.currencySymbol || "";
    var showCheckbox = !!s.showCheckbox;
    var enableQty = !!s.enableQuantitySelector;
    var singleSelect = showCheckbox && s.selectionMode === "single";

    // "Single" mode: the primary product is always included, and exactly
    // one other product is selected alongside it (radio behaviour) instead
    // of every product toggling independently.
    var primaryIndex = 0;
    if (singleSelect && s.primaryProductId) {
      var foundPrimary = bundle.products.findIndex(function (p) {
        return s.primaryProductId.indexOf(String(p.shopifyProductId).replace(/^gid:\/\/shopify\/Product\//, "")) !== -1
          || String(p.shopifyProductId) === s.primaryProductId;
      });
      if (foundPrimary !== -1) primaryIndex = foundPrimary;
    }

    // Per-item runtime state — checked/quantity the customer can change
    // before adding, independent of the merchant-configured defaults.
    var itemState = bundle.products.map(function (p, i) {
      var min = s.quantityMin > 0 ? s.quantityMin : (p.minQuantity || 1);
      var max = s.quantityMax > 0 ? s.quantityMax : (p.maxQuantity || 10);
      var checked;
      if (singleSelect) {
        // Primary is always on; among the rest, only the first non-primary
        // item starts selected so there's always exactly one companion.
        checked = i === primaryIndex || (i === (primaryIndex === 0 ? 1 : 0));
      } else {
        checked = !(showCheckbox && s.uncheckByDefault);
      }
      return {
        checked: checked,
        qty: Math.min(max, Math.max(min, p.defaultQuantity || 1)),
        min: min,
        max: max,
      };
    });

    function computePrice() {
      var subtotal = 0;
      bundle.products.forEach(function (p, i) {
        if (itemState[i].checked) subtotal += p.price * itemState[i].qty;
      });
      var finalPrice = subtotal;
      var hasDiscount = bundle.priceEnforced && bundle.discountType !== "none";
      var allChecked = itemState.every(function (st) { return st.checked; });
      // Discount only applies to the exact configured line-up — a partial
      // selection isn't guaranteed to still meet Shopify's minimum-quantity
      // requirement on the automatic discount.
      if (hasDiscount && allChecked) {
        if (bundle.discountType === "percentage") {
          finalPrice = Math.round(subtotal * (1 - bundle.discountValue / 100));
        } else if (bundle.discountType === "fixed_amount") {
          finalPrice = Math.max(0, subtotal - bundle.discountValue);
        } else if (bundle.discountType === "fixed_price") {
          finalPrice = Math.min(subtotal, bundle.discountValue);
        }
      } else {
        hasDiscount = false;
      }
      return { subtotal: subtotal, finalPrice: finalPrice, hasDiscount: hasDiscount };
    }

    function renderPriceRow() {
      var priceEl = widget.querySelector("#bg-genie-price-row");
      if (!priceEl) return;
      var p = computePrice();
      var label = '<span class="bg-genie-price-label">Total Price:</span>';
      priceEl.innerHTML = label + (p.hasDiscount
        ? '<span class="bg-genie-price-compare">' + formatMoney(p.subtotal, currencySymbol) + "</span>" +
          '<span class="bg-genie-price-final">' + formatMoney(p.finalPrice, currencySymbol) + "</span>"
        : '<span class="bg-genie-price-final">' + formatMoney(p.subtotal, currencySymbol) + "</span>");
      var anyChecked = itemState.some(function (st) { return st.checked; });
      var addBtn = widget.querySelector("#bg-genie-add-btn");
      if (addBtn) addBtn.disabled = !anyChecked;
    }

    var itemsHtml = bundle.products.map(function (p, i) {
      var priceHtml = "";
      if (showPrice) {
        var compareHtml = showCompareAt && p.compareAtPrice > p.price
          ? '<span class="bg-genie-item-compare">' + formatMoney(p.compareAtPrice * itemState[i].qty, currencySymbol) + "</span>"
          : "";
        priceHtml = compareHtml + '<span class="bg-genie-item-price" id="bg-genie-item-price-' + i + '">' + formatMoney(p.price * itemState[i].qty, currencySymbol) + "</span>";
      }
      var checkboxHtml = showCheckbox
        ? '<input type="checkbox" class="bg-genie-item-check" data-index="' + i + '"' +
            (itemState[i].checked ? " checked" : "") +
            (singleSelect && i === primaryIndex ? " disabled" : "") + '>'
        : "";
      var qtyHtml = enableQty
        ? '<span class="bg-genie-qty">' +
            '<button type="button" class="bg-genie-qty-btn" data-index="' + i + '" data-delta="-1">−</button>' +
            '<span class="bg-genie-qty-val" id="bg-genie-qty-' + i + '">' + itemState[i].qty + "</span>" +
            '<button type="button" class="bg-genie-qty-btn" data-index="' + i + '" data-delta="1">+</button>' +
          "</span>"
        : "";
      return (
        '<div class="bg-genie-item">' +
          checkboxHtml +
          (p.imageUrl
            ? '<img class="bg-genie-item-img" src="' + esc(p.imageUrl) + '" alt="' + esc(p.title) + '" loading="lazy">'
            : "") +
          '<div class="bg-genie-item-body">' +
            '<span class="bg-genie-item-title" title="' + esc(p.title) + '">' + esc(p.title) + "</span>" +
            priceHtml +
          "</div>" +
          qtyHtml +
        "</div>"
      );
    }).reduce(function (html, item, i) {
      return html + (i > 0 ? '<div class="bg-genie-plus-sep">+</div>' : "") + item;
    }, "");

    var ctaLabel = esc(s.ctaText || "Add Bundle to Cart");

    widget.innerHTML =
      '<h3 class="bg-genie-title">' + esc(bundle.title) + "</h3>" +
      (bundle.description ? '<p class="bg-genie-desc">' + esc(bundle.description) + "</p>" : "") +
      '<div class="bg-genie-items">' + itemsHtml + "</div>" +
      '<div class="bg-genie-price-row" id="bg-genie-price-row"></div>' +
      '<button type="button" class="bg-genie-add-btn" id="bg-genie-add-btn">' + ctaLabel + "</button>" +
      (s.showPaymentIcons ? '<div class="bg-genie-payment-icons">Visa &bull; Mastercard &bull; UPI &bull; RuPay</div>' : "") +
      '<div class="bg-genie-error" id="bg-genie-error" style="display:none;"></div>';

    // Placed right after the product form's Add to Cart button, same
    // insertion strategy pincode-estimator.js already uses.
    var placed = false;
    var cartForm = document.querySelector('form[action*="/cart/add"]');
    if (cartForm) {
      var addBtn = cartForm.querySelector('[name="add"]') || cartForm.querySelector('button[type="submit"]');
      if (addBtn && addBtn.parentNode) {
        addBtn.parentNode.insertBefore(widget, addBtn.nextSibling);
        placed = true;
      } else {
        cartForm.appendChild(widget);
        placed = true;
      }
    }
    if (!placed) {
      root.parentNode.insertBefore(widget, root.nextSibling);
    }

    renderPriceRow();

    widget.querySelectorAll(".bg-genie-item-check").forEach(function (el) {
      el.addEventListener("change", function () {
        var i = Number(el.getAttribute("data-index"));
        if (singleSelect) {
          if (i === primaryIndex) {
            // Locked on — revert any attempt to uncheck it.
            el.checked = true;
            return;
          }
          // Radio behaviour: checking this one unchecks every other
          // non-primary companion.
          itemState.forEach(function (st, j) {
            if (j !== primaryIndex) st.checked = j === i;
          });
          widget.querySelectorAll(".bg-genie-item-check").forEach(function (otherEl) {
            var j = Number(otherEl.getAttribute("data-index"));
            if (j !== primaryIndex) otherEl.checked = itemState[j].checked;
          });
        } else {
          itemState[i].checked = el.checked;
        }
        renderPriceRow();
      });
    });

    widget.querySelectorAll(".bg-genie-qty-btn").forEach(function (el) {
      el.addEventListener("click", function () {
        var i = Number(el.getAttribute("data-index"));
        var delta = Number(el.getAttribute("data-delta"));
        var st = itemState[i];
        st.qty = Math.min(st.max, Math.max(st.min, st.qty + delta));
        var qtyEl = widget.querySelector("#bg-genie-qty-" + i);
        if (qtyEl) qtyEl.textContent = st.qty;
        var priceEl = widget.querySelector("#bg-genie-item-price-" + i);
        if (priceEl) priceEl.textContent = formatMoney(bundle.products[i].price * st.qty, currencySymbol);
        renderPriceRow();
      });
    });

    var btn = document.getElementById("bg-genie-add-btn");
    var errorEl = document.getElementById("bg-genie-error");

    btn.addEventListener("click", function () {
      track(bundle.bundleId, "interaction");
      btn.disabled = true;
      btn.textContent = "Adding...";
      errorEl.style.display = "none";

      var items = bundle.products.map(function (p, i) {
        if (!itemState[i].checked) return null;
        return {
          id: Number(String(p.shopifyVariantId || "").replace("gid://shopify/ProductVariant/", "")),
          quantity: itemState[i].qty,
          properties: {
            _bundle_id: bundle.bundleId,
            _bundle_title: bundle.title,
          },
        };
      }).filter(function (item) { return item && item.id; });

      var checkedCount = itemState.filter(function (st) { return st.checked; }).length;
      if (items.length !== checkedCount) {
        btn.disabled = false;
        btn.textContent = ctaLabel;
        errorEl.textContent = "One of the selected products is unavailable right now.";
        errorEl.style.display = "block";
        return;
      }
      if (!items.length) {
        btn.disabled = false;
        btn.textContent = ctaLabel;
        return;
      }

      // Plain /cart/add.js — cart-drawer.js already wraps window.fetch and
      // auto-detects any call here, refreshing and opening the drawer. No
      // extra integration call needed.
      var addToCart = function () {
        return fetch("/cart/add.js", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: items }),
        });
      };

      (s.clearCartOnAdd ? fetch("/cart/clear.js", { method: "POST" }).then(addToCart) : addToCart())
        .then(function (r) {
          if (!r.ok) {
            return r.json().then(function (b) {
              throw new Error(b.description || b.message || "Could not add bundle to cart.");
            });
          }
          track(bundle.bundleId, "addToCart");
          btn.textContent = "Added!";
          if (s.postAddRedirect === "checkout") {
            window.location.href = "/checkout";
            return;
          }
          if (s.postAddRedirect === "cart") {
            window.location.href = "/cart";
            return;
          }
          setTimeout(function () {
            btn.disabled = false;
            btn.textContent = ctaLabel;
          }, 1500);
        })
        .catch(function (err) {
          btn.disabled = false;
          btn.textContent = ctaLabel;
          errorEl.textContent = err.message || "Could not add bundle to cart.";
          errorEl.style.display = "block";
        });
    });
  }

  fetch("/apps/loyalty/bundle-for-product?productId=" + encodeURIComponent(productId))
    .then(function (r) {
      var ct = r.headers.get("content-type") || "";
      if (!ct.includes("application/json")) throw new Error("not json");
      return r.json();
    })
    .then(function (data) {
      if (data && data.found) {
        render(data);
        track(data.bundleId, "view");
      }
    })
    .catch(function () {
      // No bundle for this product, app proxy misconfigured, or network
      // error — stay silent rather than surface anything on the storefront.
    });
})();
