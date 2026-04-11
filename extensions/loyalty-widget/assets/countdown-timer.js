/**
 * Countdown Timer - Vanilla JS
 * Supports fixed deadline and evergreen (per-session) timers.
 * Display modes: announcement bar, product page, or both.
 */

(function () {
  "use strict";

  var container = document.getElementById("countdown-timer-app");
  if (!container) return;

  // ─── Config from data attributes ──────────────────────────────
  var config = {
    shopDomain: container.dataset.shopDomain || "",
    template: container.dataset.template || "",
    productId: container.dataset.productId || "",
    productTags: (container.dataset.productTags || "").split(",").filter(Boolean),
    hasSale: container.dataset.hasSale === "true",
    productTitle: container.dataset.productTitle || "",
    barBg: container.dataset.barBg || "#1a1a1a",
    barText: container.dataset.barText || "#ffffff",
    digitColor: container.dataset.digitColor || "#ff4444",
  };

  // Apply CSS variables
  document.documentElement.style.setProperty("--ct-bg", config.barBg);
  document.documentElement.style.setProperty("--ct-text", config.barText);
  document.documentElement.style.setProperty("--ct-digit", config.digitColor);

  // ─── State ────────────────────────────────────────────────────
  var settings = null;
  var timerInterval = null;
  var barElement = null;
  var productElement = null;
  var dismissed = sessionStorage.getItem("ct_dismissed") === "1";

  // ─── Fetch Settings ───────────────────────────────────────────
  function fetchSettings() {
    fetch("/apps/loyalty/timer-settings")
      .then(function (r) {
        if (!r.ok) throw new Error("Failed");
        var ct = r.headers.get("content-type") || "";
        if (!ct.includes("application/json")) throw new Error("Not JSON");
        return r.json();
      })
      .then(function (data) {
        settings = data;
        init();
      })
      .catch(function () {
        // Silently fail
      });
  }

  // ─── Initialize ───────────────────────────────────────────────
  function init() {
    if (!settings || !settings.enabled) return;
    if (dismissed && settings.showDismissButton) return;

    // Apply colors from fetched settings (overrides data-attribute defaults)
    if (settings.barBackgroundColor) document.documentElement.style.setProperty("--ct-bg", settings.barBackgroundColor);
    if (settings.barTextColor) document.documentElement.style.setProperty("--ct-text", settings.barTextColor);
    if (settings.timerDigitColor) document.documentElement.style.setProperty("--ct-digit", settings.timerDigitColor);

    // Check targeting
    if (!shouldShowOnCurrentPage()) return;

    // Calculate end time
    var endTime = getEndTime();
    if (!endTime) return;

    // Start timer
    startTimer(endTime);
  }

  // ─── Targeting Logic ──────────────────────────────────────────
  function shouldShowOnCurrentPage() {
    // Announcement bar shows everywhere
    if (settings.displayMode === "announcement") return true;

    // Product page mode - only on product pages
    if (settings.displayMode === "product-page" && config.template !== "product") return false;
    if (settings.displayMode === "both" && config.template !== "product") {
      // "both" mode: show announcement bar on non-product pages
      // We'll handle this in the render logic
      return true;
    }

    // Check product targeting
    if (config.template === "product" && !settings.showOnAllProducts) {
      if (settings.saleItemsOnly && !config.hasSale) return false;
      if (settings.specificTags && settings.specificTags.length > 0) {
        var hasMatchingTag = settings.specificTags.some(function (tag) {
          return config.productTags.indexOf(tag) !== -1;
        });
        if (!hasMatchingTag) return false;
      }
    }

    return true;
  }

  // ─── Get End Time ─────────────────────────────────────────────
  function getEndTime() {
    if (settings.timerType === "fixed") {
      if (!settings.endDate) return null;
      return new Date(settings.endDate).getTime();
    }

    // Evergreen: check sessionStorage for start time
    var storageKey = "ct_start_" + config.shopDomain;
    var startTime = sessionStorage.getItem(storageKey);

    if (!startTime) {
      startTime = String(Date.now());
      sessionStorage.setItem(storageKey, startTime);
    }

    var durationMs =
      ((settings.durationHours || 0) * 3600 + (settings.durationMinutes || 0) * 60) * 1000;

    if (durationMs <= 0) return null;

    return parseInt(startTime) + durationMs;
  }

  // ─── Timer Logic ──────────────────────────────────────────────
  function startTimer(endTime) {
    function tick() {
      var now = Date.now();
      var remaining = endTime - now;

      if (remaining <= 0) {
        // Timer expired
        clearInterval(timerInterval);
        if (settings.hideWhenExpired) {
          removeElements();
        } else {
          renderExpired();
        }
        return;
      }

      var hours = Math.floor(remaining / 3600000);
      var minutes = Math.floor((remaining % 3600000) / 60000);
      var seconds = Math.floor((remaining % 60000) / 1000);

      var timerHtml = renderTimerDigits(hours, minutes, seconds);
      var message = settings.messageTemplate
        .replace("{timer}", timerHtml)
        .replace("{title}", escapeHtml(config.productTitle));

      // Render based on display mode
      var showBar = settings.displayMode === "announcement" || settings.displayMode === "both";
      var showProduct = (settings.displayMode === "product-page" || settings.displayMode === "both") && config.template === "product";

      if (showBar && !dismissed) renderBar(message);
      if (showProduct) renderProductTimer(message);
    }

    tick(); // Initial render
    timerInterval = setInterval(tick, 1000);
  }

  // ─── Render Timer Digits ──────────────────────────────────────
  function renderTimerDigits(h, m, s) {
    var dc = settings && settings.timerDigitColor ? settings.timerDigitColor : "#ff4444";
    var digitStyle = 'style="color:' + dc + '!important"';
    var sepStyle   = 'style="color:' + dc + '!important;opacity:0.7"';
    return '<span class="ct-timer">' +
      '<span class="ct-digit-group">' +
        '<span class="ct-digit-box" ' + digitStyle + '>' + pad(h) + '</span>' +
      '</span>' +
      '<span class="ct-separator" ' + sepStyle + '>:</span>' +
      '<span class="ct-digit-group">' +
        '<span class="ct-digit-box" ' + digitStyle + '>' + pad(m) + '</span>' +
      '</span>' +
      '<span class="ct-separator" ' + sepStyle + '>:</span>' +
      '<span class="ct-digit-group">' +
        '<span class="ct-digit-box" ' + digitStyle + '>' + pad(s) + '</span>' +
      '</span>' +
    '</span>';
  }

  // ─── Render Announcement Bar ──────────────────────────────────
  function renderBar(message) {
    var bg   = settings.barBackgroundColor || "#1a1a1a";
    var text = settings.barTextColor       || "#ffffff";

    if (!barElement) {
      barElement = document.createElement("div");
      barElement.className = "ct-bar";
      barElement.id = "ct-announcement-bar";
      document.body.insertBefore(barElement, document.body.firstChild);
    }

    var dismissBtn = settings.showDismissButton
      ? '<button class="ct-dismiss" data-action="ct-dismiss" aria-label="Dismiss" style="color:' + text + '!important">✕</button>'
      : '';

    // Inline styles on the wrapper AND the message div — belt and suspenders
    barElement.innerHTML =
      '<div class="ct-bar-message" style="color:' + text + '!important">' + message + '</div>' + dismissBtn;

    // Apply AFTER innerHTML so nothing can reset them
    barElement.setAttribute("style",
      "background:" + bg + "!important;" +
      "color:" + text + "!important;" +
      "position:sticky;top:0;z-index:9997;width:100%;padding:10px 20px;" +
      "display:flex;align-items:center;justify-content:center;gap:8px;" +
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;" +
      "font-size:14px;font-weight:600;box-shadow:0 2px 8px rgba(0,0,0,0.15);"
    );

    // Attach dismiss handler
    var btn = barElement.querySelector('[data-action="ct-dismiss"]');
    if (btn) {
      btn.addEventListener("click", function () {
        dismissed = true;
        sessionStorage.setItem("ct_dismissed", "1");
        if (barElement) {
          barElement.style.animation = "none";
          barElement.style.transform = "translateY(-100%)";
          barElement.style.transition = "transform 0.3s ease";
          setTimeout(function () {
            if (barElement && barElement.parentNode) {
              barElement.parentNode.removeChild(barElement);
              barElement = null;
            }
          }, 300);
        }
      });
    }
  }

  // ─── Render Product Page Timer ────────────────────────────────
  function renderProductTimer(message) {
    if (!productElement) {
      productElement = document.createElement("div");
      productElement.className = "ct-product";
      productElement.id = "ct-product-timer";

      // Find the best place to insert: before ATC button or after product title
      var insertTarget =
        document.querySelector('form[action*="/cart/add"] [type="submit"]') ||
        document.querySelector(".product-form__submit") ||
        document.querySelector('[name="add"]') ||
        document.querySelector(".product-form__buttons") ||
        document.querySelector(".product__info-wrapper .product__title");

      if (insertTarget) {
        var parent = insertTarget.closest(".product-form__buttons") || insertTarget.parentNode;
        if (parent) {
          parent.insertBefore(productElement, insertTarget);
        }
      } else {
        // Fallback: append to product info section
        var productInfo = document.querySelector(".product__info-wrapper") ||
          document.querySelector(".product-single__meta") ||
          document.querySelector('[class*="product"]');
        if (productInfo) {
          productInfo.appendChild(productElement);
        }
      }
    }

    var dc = settings && settings.timerDigitColor ? settings.timerDigitColor : "#ff4444";
    productElement.style.setProperty("border-left-color", dc, "important");
    productElement.innerHTML =
      '<span class="ct-pulse-dot" style="background:' + dc + '"></span>' +
      '<span class="ct-message-text">' + message + '</span>';
  }

  // ─── Render Expired ───────────────────────────────────────────
  function renderExpired() {
    var expiredMsg = escapeHtml(settings.expiredMessage);

    if (barElement) {
      barElement.classList.add("ct-expired");
      barElement.innerHTML = '<div class="ct-bar-message">' + expiredMsg + '</div>';
    }
    if (productElement) {
      productElement.classList.add("ct-expired");
      productElement.innerHTML = '<span class="ct-message-text">' + expiredMsg + '</span>';
    }
  }

  // ─── Remove Elements ──────────────────────────────────────────
  function removeElements() {
    if (barElement && barElement.parentNode) {
      barElement.parentNode.removeChild(barElement);
      barElement = null;
    }
    if (productElement && productElement.parentNode) {
      productElement.parentNode.removeChild(productElement);
      productElement = null;
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────
  function pad(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function escapeHtml(str) {
    if (!str) return "";
    var d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }

  // ─── Start ────────────────────────────────────────────────────
  fetchSettings();
})();
