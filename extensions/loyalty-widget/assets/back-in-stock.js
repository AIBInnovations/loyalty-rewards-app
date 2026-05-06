/**
 * Back-in-Stock Alerts - Form submission + dynamic variant switching
 */
(function () {
  "use strict";

  var container = document.getElementById("bis-notify-form");
  if (!container) return;

  var btn = container.querySelector('[data-action="bis-submit"]');
  var emailInput = container.querySelector(".bis-email");
  var successEl = container.querySelector(".bis-success");
  var errorEl = container.querySelector(".bis-error");
  var formEl = container.querySelector(".bis-form");

  if (!btn || !emailInput) return;

  // ── Auto-position near Add to Cart button ───────────────────────
  function positionContainer() {
    var anchor =
      document.querySelector('form[action*="/cart/add"] [type="submit"]') ||
      document.querySelector('[name="add"]') ||
      document.querySelector('form[action*="/cart/add"]') ||
      document.querySelector('.product-form__submit') ||
      document.querySelector('.product-form');
    if (anchor && anchor.parentNode && !anchor.parentNode.contains(container)) {
      anchor.parentNode.insertBefore(container, anchor.nextSibling);
    }
  }

  // ── Initial visibility from server-rendered data-available ───────
  var initialAvailable = container.dataset.available;
  if (initialAvailable === "false") {
    container.style.display = "";
    positionContainer();
  }

  // ── Variant change handling ──────────────────────────────────────
  function onVariantChange(variant) {
    if (!variant) return;

    container.dataset.variantId = variant.id;
    container.dataset.variantTitle = variant.title || "Default Title";

    if (variant.available) {
      container.style.display = "none";
    } else {
      container.style.display = "";
      positionContainer();
      formEl.style.display = "";
      successEl.style.display = "none";
      errorEl.style.display = "none";
      btn.disabled = false;
      btn.textContent = btn.dataset.originalText || "Notify Me";
    }
  }

  // Approach 1: native change event on variant selects/radios
  document.querySelectorAll(
    'select[name="id"], input[name="id"], fieldset input[type="radio"]'
  ).forEach(function (el) {
    el.addEventListener("change", function () {
      var variantId = this.value || (this.checked ? this.value : null);
      if (!variantId && this.form) {
        var idInput = this.form.querySelector('[name="id"]');
        if (idInput) variantId = idInput.value;
      }
      if (!variantId) return;
      var variants = getProductVariants();
      if (!variants) return;
      var variant = variants.find(function (v) { return String(v.id) === String(variantId); });
      if (variant) onVariantChange(variant);
    });
  });

  // Approach 2: custom variant:changed event (Dawn and modern themes)
  document.addEventListener("variant:changed", function (e) {
    var variant = e.detail && (e.detail.variant || e.detail);
    if (variant && variant.id !== undefined) onVariantChange(variant);
  });

  // Approach 3: productVariantChange (older themes)
  document.addEventListener("productVariantChange", function (e) {
    var variant = e.detail && e.detail.variant;
    if (variant && variant.id !== undefined) onVariantChange(variant);
  });

  function getProductVariants() {
    if (
      window.ShopifyAnalytics &&
      window.ShopifyAnalytics.meta &&
      window.ShopifyAnalytics.meta.product &&
      window.ShopifyAnalytics.meta.product.variants
    ) {
      return window.ShopifyAnalytics.meta.product.variants;
    }
    if (window.product && Array.isArray(window.product.variants)) {
      return window.product.variants;
    }
    return null;
  }

  // ── Form submission ──────────────────────────────────────────────

  btn.addEventListener("click", function () {
    var email = emailInput.value.trim();
    if (!email || !email.includes("@")) {
      errorEl.textContent = "Please enter a valid email address.";
      errorEl.style.display = "block";
      return;
    }

    var productId = container.dataset.productId;
    var productTitle = container.dataset.productTitle;
    var variantId = container.dataset.variantId;
    var variantTitle = container.dataset.variantTitle;

    btn.disabled = true;
    btn.textContent = "Submitting...";
    errorEl.style.display = "none";

    var url = "/apps/loyalty/stock-subscribe" +
      "?email=" + encodeURIComponent(email) +
      "&productId=" + encodeURIComponent(productId) +
      "&variantId=" + encodeURIComponent(variantId) +
      "&productTitle=" + encodeURIComponent(productTitle) +
      "&variantTitle=" + encodeURIComponent(variantTitle) +
      "&action=stock-subscribe";

    fetch(url)
      .then(function (r) {
        var ct = r.headers.get("content-type") || "";
        if (!ct.includes("application/json")) throw new Error("Not JSON");
        return r.json();
      })
      .then(function (data) {
        if (data.success) {
          formEl.style.display = "none";
          successEl.style.display = "block";
        } else {
          errorEl.textContent = data.error || "Something went wrong.";
          errorEl.style.display = "block";
          btn.disabled = false;
          btn.textContent = btn.dataset.originalText || "Notify Me";
        }
      })
      .catch(function () {
        errorEl.textContent = "Something went wrong. Please try again.";
        errorEl.style.display = "block";
        btn.disabled = false;
        btn.textContent = btn.dataset.originalText || "Notify Me";
      });
  });
})();
