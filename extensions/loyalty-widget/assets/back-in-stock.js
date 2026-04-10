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

  // ── Variant change handling ──────────────────────────────────────
  // Listen for variant selector changes to update variantId/Title and
  // show/hide the form based on the selected variant's availability.

  function onVariantChange(variant) {
    if (!variant) return;

    // Update data attributes with the new variant
    container.dataset.variantId = variant.id;
    container.dataset.variantTitle = variant.title || "Default Title";

    if (variant.available) {
      container.style.display = "none";
    } else {
      container.style.display = "";
      // Reset form state when switching to a new out-of-stock variant
      formEl.style.display = "";
      successEl.style.display = "none";
      errorEl.style.display = "none";
      btn.disabled = false;
      btn.textContent = "Notify Me";
    }
  }

  // Shopify Dawn / most modern themes dispatch a custom "variant:changed" or
  // use the native "change" event on variant inputs/selects.
  // We cover both approaches.

  // Approach 1: listen for the native change event on variant selects/radios
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

      // Find the variant data from window.ShopifyAnalytics or theme globals
      var variants = getProductVariants();
      if (!variants) return;
      var variant = variants.find(function (v) { return String(v.id) === String(variantId); });
      if (variant) onVariantChange(variant);
    });
  });

  // Approach 2: listen for the custom variant:changed event fired by some themes
  document.addEventListener("variant:changed", function (e) {
    var variant = e.detail && (e.detail.variant || e.detail);
    if (variant && variant.id !== undefined) onVariantChange(variant);
  });

  // Approach 3: Shopify's productVariantChange (older themes / theme-kit)
  document.addEventListener("productVariantChange", function (e) {
    var variant = e.detail && e.detail.variant;
    if (variant && variant.id !== undefined) onVariantChange(variant);
  });

  function getProductVariants() {
    // Try ShopifyAnalytics meta
    if (
      window.ShopifyAnalytics &&
      window.ShopifyAnalytics.meta &&
      window.ShopifyAnalytics.meta.product &&
      window.ShopifyAnalytics.meta.product.variants
    ) {
      return window.ShopifyAnalytics.meta.product.variants;
    }
    // Try window.product (some themes expose this)
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
          btn.textContent = "Notify Me";
        }
      })
      .catch(function () {
        errorEl.textContent = "Something went wrong. Please try again.";
        errorEl.style.display = "block";
        btn.disabled = false;
        btn.textContent = "Notify Me";
      });
  });
})();
