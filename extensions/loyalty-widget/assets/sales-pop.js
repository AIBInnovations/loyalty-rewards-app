/**
 * Sales Pop - Real-time social proof notifications.
 * Fetches sanitized purchase events from the app proxy and rotates them.
 */
(function () {
  "use strict";

  var container = document.getElementById("sales-pop-app");
  if (!container) return;

  var template = (container.getAttribute("data-template") || "").toLowerCase();
  var productHandle = container.getAttribute("data-product-handle") || "";
  var collectionId = container.getAttribute("data-collection-id") || "";

  // Skip non-storefront pages where social proof is inappropriate
  if (
    template.indexOf("cart") === 0 ||
    template.indexOf("checkout") === 0 ||
    template.indexOf("customers") === 0 ||
    template.indexOf("account") === 0 ||
    template.indexOf("password") === 0
  ) {
    return;
  }

  // Session cap — track shown events across one browsing session
  var SESSION_SHOWN_KEY = "sp_shown_count";
  var SESSION_SEEN_KEY = "sp_seen_ids";

  var settings = null;
  var events = [];
  var currentToast = null;
  var shownThisSession = 0;
  var seenIds = loadSeenIds();
  var rotationTimer = null;

  function loadSeenIds() {
    try {
      var raw = sessionStorage.getItem(SESSION_SEEN_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }
  function saveSeenIds() {
    try {
      sessionStorage.setItem(SESSION_SEEN_KEY, JSON.stringify(seenIds.slice(-50)));
    } catch (e) {}
  }
  function loadShownCount() {
    var n = parseInt(sessionStorage.getItem(SESSION_SHOWN_KEY) || "0", 10);
    return isNaN(n) ? 0 : n;
  }
  function saveShownCount() {
    try {
      sessionStorage.setItem(SESSION_SHOWN_KEY, String(shownThisSession));
    } catch (e) {}
  }

  shownThisSession = loadShownCount();

  // Pull settings first
  fetch("/apps/loyalty/sales-pop-settings", { credentials: "same-origin" })
    .then(function (r) {
      var ct = r.headers.get("content-type") || "";
      if (!r.ok || ct.indexOf("application/json") !== 0) return null;
      return r.json();
    })
    .then(function (data) {
      if (!data || !data.enabled) return;

      if (!data.showOnMobile && isMobile()) return;

      if (!pageMatchesTargeting(data, template)) return;

      settings = data;
      if (shownThisSession >= (settings.maxPerSession || 3)) return;

      fetchEvents();
    })
    .catch(function () {});

  function isMobile() {
    return window.matchMedia && window.matchMedia("(max-width: 768px)").matches;
  }

  function pageMatchesTargeting(cfg, tpl) {
    if (tpl.indexOf("product") === 0) return !!cfg.showOnProduct;
    if (tpl.indexOf("collection") === 0) return !!cfg.showOnCollection;
    if (tpl === "index") return !!cfg.showOnHome;
    // By default don't spam every other page type
    return !!cfg.showOnHome;
  }

  function fetchEvents() {
    var context = "global";
    if (template.indexOf("product") === 0) context = "product";
    else if (template.indexOf("collection") === 0) context = "collection";
    else if (template === "index") context = "home";

    var q = [
      "context=" + encodeURIComponent(context),
      "limit=10",
    ];
    if (productHandle) q.push("productHandle=" + encodeURIComponent(productHandle));
    if (collectionId) q.push("collectionId=" + encodeURIComponent(collectionId));

    fetch("/apps/loyalty/sales-pop-events?" + q.join("&"), {
      credentials: "same-origin",
    })
      .then(function (r) {
        var ct = r.headers.get("content-type") || "";
        if (!r.ok || ct.indexOf("application/json") !== 0) return { events: [] };
        return r.json();
      })
      .then(function (data) {
        events = (data.events || []).filter(function (e) {
          return seenIds.indexOf(e.id) === -1;
        });
        if (!events.length) return;
        scheduleFirst();
      })
      .catch(function () {});
  }

  function scheduleFirst() {
    var delay = (settings.initialDelaySeconds || 8) * 1000;
    rotationTimer = window.setTimeout(showNext, delay);
  }

  function scheduleNext() {
    var min = settings.minIntervalSeconds || 20;
    var max = settings.maxIntervalSeconds || 35;
    if (max < min) max = min;
    var interval = (min + Math.random() * (max - min)) * 1000;
    rotationTimer = window.setTimeout(showNext, interval);
  }

  function showNext() {
    if (shownThisSession >= (settings.maxPerSession || 3)) return;
    if (!events.length) return;
    var ev = events.shift();
    if (!ev) return;
    if (seenIds.indexOf(ev.id) !== -1) {
      showNext();
      return;
    }
    renderToast(ev);
    seenIds.push(ev.id);
    saveSeenIds();
    shownThisSession++;
    saveShownCount();
  }

  function renderToast(ev) {
    dismissCurrent();

    var toast = document.createElement("div");
    toast.className = "sp-toast pos-" + (settings.position || "bottom-left");
    toast.style.setProperty("--sp-bg", settings.bgColor || "#ffffff");
    toast.style.setProperty("--sp-text", settings.textColor || "#1a1a1a");
    toast.style.setProperty("--sp-accent", settings.accentColor || "#5C6AC4");
    toast.style.setProperty(
      "--sp-radius",
      (Number(settings.borderRadius) || 12) + "px",
    );

    var thumbHtml = "";
    if (settings.showThumbnail && ev.productImage) {
      thumbHtml =
        '<div class="sp-thumb" style="background-image:url(\'' +
        escAttr(ev.productImage) +
        '\');"></div>';
    } else if (settings.showThumbnail) {
      thumbHtml = '<div class="sp-thumb"></div>';
    }

    var message = renderMessage(settings.messageTemplate, ev);

    var ctaHtml = "";
    if (settings.showCta && ev.productHandle) {
      ctaHtml =
        '<a class="sp-cta" href="/products/' +
        encodeURIComponent(ev.productHandle) +
        '">' +
        esc(settings.ctaLabel || "View Product") +
        " →</a>";
    }

    toast.innerHTML =
      thumbHtml +
      '<div class="sp-body">' +
      '<div class="sp-message">' + message + "</div>" +
      '<div class="sp-meta"><span class="sp-verified"></span><span>' +
      esc(ev.freshness || "recently") +
      "</span></div>" +
      ctaHtml +
      "</div>" +
      '<button class="sp-close" aria-label="Close">✕</button>';

    toast.style.position = "fixed";
    document.body.appendChild(toast);
    // Force reflow for the CSS transition
    void toast.offsetHeight;
    toast.classList.add("open");

    toast
      .querySelector(".sp-close")
      .addEventListener("click", function () {
        dismissCurrent();
        scheduleNext();
      });

    currentToast = toast;

    // Auto-dismiss + schedule next
    window.setTimeout(function () {
      if (currentToast === toast) {
        dismissCurrent();
        scheduleNext();
      }
    }, 6000);
  }

  function renderMessage(tpl, ev) {
    var t = tpl || "{name} from {location} just bought {product}";
    var name = esc(ev.displayName || "Someone");
    var location = esc(ev.displayLocation || "nearby");
    var product =
      '<strong>' + esc(ev.productTitle || "a product") + "</strong>";
    return t
      .replace(/\{name\}/g, "<strong>" + name + "</strong>")
      .replace(/\{location\}/g, location)
      .replace(/\{product\}/g, product);
  }

  function dismissCurrent() {
    if (!currentToast) return;
    var t = currentToast;
    t.classList.remove("open");
    currentToast = null;
    window.setTimeout(function () {
      if (t && t.parentNode) t.parentNode.removeChild(t);
    }, 400);
  }

  function esc(s) {
    if (s == null) return "";
    var d = document.createElement("div");
    d.textContent = String(s);
    return d.innerHTML;
  }
  function escAttr(s) {
    return String(s || "").replace(/'/g, "%27").replace(/"/g, "%22");
  }

  // Pause rotation if tab is hidden
  document.addEventListener("visibilitychange", function () {
    if (document.hidden && rotationTimer) {
      window.clearTimeout(rotationTimer);
      rotationTimer = null;
    }
  });
})();
