/**
 * Smart Email Popup — storefront client.
 * Handles trigger engine, suppression, render, a11y, and analytics.
 */
(function () {
  "use strict";

  var root = document.getElementById("smart-email-popup-app");
  if (!root) return;

  var STORAGE_PREFIX = "sep:";
  var SESSION_PREFIX = "sep-session:";
  var VISITOR_KEY_COOKIE = "sep_vk";

  var pageLoadTime = Date.now();
  var ls = safeStorage("local");
  var ss = safeStorage("session");

  var visitorKey = ensureVisitorKey();
  var audience = ls.get("sep:visited") ? "returning" : "new";
  ls.set("sep:visited", "1");

  var device = window.matchMedia("(max-width: 768px)").matches ? "mobile" : "desktop";
  var pageType = detectPageType();

  var state = {
    campaign: null,
    overlay: null,
    shown: false,
    focusables: [],
    prevActive: null,
  };

  fetchConfig().catch(function () {});

  // ─── Config ──────────────────────────────────────────────────────

  function fetchConfig() {
    var params = new URLSearchParams({
      action: "smart-popup-config",
      pageType: pageType,
      device: device,
      audience: audience,
      pageUrl: location.href,
      referrer: document.referrer || "",
      locale: root.dataset.locale || "",
      country: root.dataset.country || "",
      utm_source: qs("utm_source"),
      utm_medium: qs("utm_medium"),
      utm_campaign: qs("utm_campaign"),
    });
    return fetch("/apps/loyalty/smart-popup/config?" + params.toString())
      .then(function (r) {
        var ct = r.headers.get("content-type") || "";
        if (!ct.includes("application/json")) throw new Error("Not JSON");
        return r.json();
      })
      .then(function (data) {
        if (!data.enabled || !data.campaign) return;
        state.campaign = data.campaign;
        if (isSuppressed(state.campaign)) return;
        startTrigger(state.campaign);
      });
  }

  // ─── Suppression ─────────────────────────────────────────────────

  function suppressionKey(cid, kind) {
    return STORAGE_PREFIX + cid + ":" + kind;
  }

  function sessionKey(cid) {
    return SESSION_PREFIX + cid;
  }

  function isSuppressed(c) {
    var now = Date.now();
    var submittedAt = Number(ls.get(suppressionKey(c.id, "submitted")) || 0);
    if (submittedAt && (c.suppression.afterSubmitDays || 0) > 0) {
      var submitWindow = c.suppression.afterSubmitDays * 24 * 60 * 60 * 1000;
      if (now - submittedAt < submitWindow) return true;
    }
    var closedAt = Number(ls.get(suppressionKey(c.id, "closed")) || 0);
    if (closedAt && (c.suppression.afterCloseHours || 0) > 0) {
      var closeWindow = c.suppression.afterCloseHours * 60 * 60 * 1000;
      if (now - closedAt < closeWindow) return true;
    }
    var dismissedAt = Number(ls.get(suppressionKey(c.id, "dismissed")) || 0);
    if (dismissedAt && (c.suppression.afterDismissHours || 0) > 0) {
      var dismissWindow = c.suppression.afterDismissHours * 60 * 60 * 1000;
      if (now - dismissedAt < dismissWindow) return true;
    }
    var sessionShown = Number(ss.get(sessionKey(c.id)) || 0);
    if (sessionShown >= (c.suppression.maxPerSession || 1)) return true;
    return false;
  }

  // ─── Trigger engine ──────────────────────────────────────────────

  function startTrigger(c) {
    var trig = c.trigger || { type: "timer", delaySeconds: 8 };
    switch (trig.type) {
      case "timer":
        setTimeout(function () { show("timer"); }, (trig.delaySeconds || 8) * 1000);
        break;
      case "scroll":
        bindScroll(trig.scrollPercent || 40);
        break;
      case "exit_intent":
        bindExitIntent(trig.delaySeconds || 3);
        break;
      case "inactivity":
        bindInactivity(trig.inactivitySeconds || 30);
        break;
      default:
        setTimeout(function () { show("timer"); }, 8000);
    }
  }

  function bindScroll(percent) {
    var handler = function () {
      var doc = document.documentElement;
      var total = doc.scrollHeight - doc.clientHeight;
      if (total <= 0) return;
      var pct = (window.scrollY / total) * 100;
      if (pct >= percent) {
        window.removeEventListener("scroll", handler);
        show("scroll");
      }
    };
    window.addEventListener("scroll", handler, { passive: true });
  }

  function bindExitIntent(minDelay) {
    if (device === "desktop") {
      document.addEventListener("mouseout", function (e) {
        if (e.relatedTarget || e.toElement) return;
        if (e.clientY > 0) return;
        if (Date.now() - pageLoadTime < minDelay * 1000) return;
        show("exit_intent");
      });
    } else {
      var lastScroll = 0;
      var upCount = 0;
      window.addEventListener("scroll", function () {
        var cur = window.scrollY;
        if (cur < lastScroll && lastScroll - cur > 50) {
          upCount++;
          if (upCount >= 3 && Date.now() - pageLoadTime > minDelay * 1000) {
            show("exit_intent");
          }
        } else {
          upCount = 0;
        }
        lastScroll = cur;
      }, { passive: true });
    }
  }

  function bindInactivity(seconds) {
    var last = Date.now();
    var fire = function () {
      if (Date.now() - last >= seconds * 1000) {
        show("inactivity");
      }
    };
    var reset = function () { last = Date.now(); };
    ["mousemove", "keydown", "scroll", "touchstart"].forEach(function (evt) {
      window.addEventListener(evt, reset, { passive: true });
    });
    setInterval(fire, 1000);
  }

  // ─── Render ──────────────────────────────────────────────────────

  function show() {
    if (state.shown || !state.campaign) return;
    if (isSuppressed(state.campaign)) return;
    state.shown = true;

    ss.set(sessionKey(state.campaign.id), String(
      Number(ss.get(sessionKey(state.campaign.id)) || 0) + 1,
    ));

    var overlay = document.createElement("div");
    overlay.className = "sep-overlay sep-layout-" + (state.campaign.content.layout || "center");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", state.campaign.content.headline || "Newsletter offer");
    overlay.innerHTML = renderPopup(state.campaign);
    document.body.appendChild(overlay);
    state.overlay = overlay;

    void overlay.offsetHeight;
    overlay.classList.add("sep-open");

    attachHandlers();
    trapFocus();
    trackEvent("impression");
  }

  function renderPopup(c) {
    var offerBadge = "";
    if (c.offer && c.offer.label) {
      offerBadge = '<div class="sep-badge">' + esc(c.offer.label) + "</div>";
    }
    var imageHtml = c.content.imageUrl
      ? '<img class="sep-hero" src="' + esc(c.content.imageUrl) + '" alt="" />'
      : "";
    var firstNameHtml = c.content.collectFirstName
      ? '<input type="text" class="sep-first-name" placeholder="First name" aria-label="First name" />'
      : "";

    return [
      '<div class="sep-modal" style="--sep-bg:' + esc(c.content.bgColor) + ";--sep-accent:" + esc(c.content.accentColor) + ";--sep-text:" + esc(c.content.textColor) + ';">',
      '<button class="sep-close" data-action="sep-close" aria-label="Close popup">&times;</button>',
      imageHtml,
      '<h2 class="sep-headline">' + esc(c.content.headline) + "</h2>",
      '<p class="sep-subtext">' + esc(c.content.subtext) + "</p>",
      offerBadge,
      '<div class="sep-form-wrap">',
      '<form class="sep-form" novalidate>',
      firstNameHtml,
      '<input type="email" class="sep-email" placeholder="Enter your email" required aria-label="Email address" autocomplete="email" />',
      '<button type="submit" class="sep-submit">' + esc(c.content.buttonText) + "</button>",
      "</form>",
      '<p class="sep-error" role="alert" aria-live="polite" hidden></p>',
      '<p class="sep-consent">' + esc(c.content.consentText) + "</p>",
      "</div>",
      '<div class="sep-success" hidden></div>',
      '<button class="sep-skip" data-action="sep-dismiss">No thanks</button>',
      "</div>",
    ].join("");
  }

  function attachHandlers() {
    var overlay = state.overlay;
    overlay.querySelectorAll('[data-action="sep-close"]').forEach(function (b) {
      b.addEventListener("click", function () { close("close"); });
    });
    overlay.querySelectorAll('[data-action="sep-dismiss"]').forEach(function (b) {
      b.addEventListener("click", function () { close("dismiss"); });
    });
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) close("close");
    });
    document.addEventListener("keydown", keyHandler);

    var form = overlay.querySelector(".sep-form");
    if (form) form.addEventListener("submit", onSubmit);
  }

  function keyHandler(e) {
    if (!state.overlay) return;
    if (e.key === "Escape") {
      close("close");
    } else if (e.key === "Tab" && state.focusables.length) {
      var first = state.focusables[0];
      var last = state.focusables[state.focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  function trapFocus() {
    state.prevActive = document.activeElement;
    state.focusables = Array.prototype.slice.call(
      state.overlay.querySelectorAll(
        'button, input, [href], [tabindex]:not([tabindex="-1"])',
      ),
    );
    var emailInput = state.overlay.querySelector(".sep-email");
    if (emailInput) setTimeout(function () { emailInput.focus(); }, 50);
  }

  function onSubmit(e) {
    e.preventDefault();
    var overlay = state.overlay;
    var email = (overlay.querySelector(".sep-email") || {}).value || "";
    var firstNameEl = overlay.querySelector(".sep-first-name");
    var firstName = firstNameEl ? firstNameEl.value.trim() : "";
    var errorEl = overlay.querySelector(".sep-error");
    var submitBtn = overlay.querySelector(".sep-submit");

    email = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showError("Please enter a valid email address.");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.dataset.origText = submitBtn.textContent;
    submitBtn.textContent = "Sending...";
    if (errorEl) errorEl.hidden = true;

    var params = new URLSearchParams({
      action: "smart-popup-submit",
      campaignId: state.campaign.id,
      email: email,
      firstName: firstName,
      visitorKey: visitorKey,
      pageType: pageType,
      device: device,
      audience: audience,
      pageUrl: location.href,
      referrer: document.referrer || "",
      locale: root.dataset.locale || "",
      country: root.dataset.country || "",
      utm_source: qs("utm_source"),
      utm_medium: qs("utm_medium"),
      utm_campaign: qs("utm_campaign"),
    });

    fetch("/apps/loyalty/smart-popup/submit?" + params.toString())
      .then(function (r) {
        var ct = r.headers.get("content-type") || "";
        if (!ct.includes("application/json")) throw new Error("Not JSON");
        return r.json();
      })
      .then(function (data) {
        if (!data.success) {
          showError(data.error || "Something went wrong. Please try again.");
          submitBtn.disabled = false;
          submitBtn.textContent = submitBtn.dataset.origText || "Submit";
          return;
        }
        ls.set(suppressionKey(state.campaign.id, "submitted"), String(Date.now()));
        showSuccess(data.discountCode, data.successMessage || state.campaign.content.successMessage);
      })
      .catch(function () {
        showError("Network error. Please try again.");
        submitBtn.disabled = false;
        submitBtn.textContent = submitBtn.dataset.origText || "Submit";
      });

    function showError(msg) {
      if (!errorEl) return;
      errorEl.textContent = msg;
      errorEl.hidden = false;
    }
  }

  function showSuccess(code, message) {
    var overlay = state.overlay;
    var formWrap = overlay.querySelector(".sep-form-wrap");
    var successEl = overlay.querySelector(".sep-success");
    var skip = overlay.querySelector(".sep-skip");
    if (formWrap) formWrap.style.display = "none";
    if (skip) skip.style.display = "none";
    if (!successEl) return;
    successEl.hidden = false;
    var html = '<p class="sep-success-msg">' + esc(message) + "</p>";
    if (code) {
      html +=
        '<div class="sep-code" role="text">' + esc(code) + "</div>" +
        '<a class="sep-apply" href="/discount/' + encodeURIComponent(code) +
          '?redirect=/">Apply &amp; shop</a>';
    }
    successEl.innerHTML = html;
  }

  function close(kind) {
    if (!state.overlay) return;
    var overlay = state.overlay;
    state.overlay = null;
    overlay.classList.remove("sep-open");
    document.removeEventListener("keydown", keyHandler);
    setTimeout(function () {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }, 250);
    if (state.prevActive && typeof state.prevActive.focus === "function") {
      try { state.prevActive.focus(); } catch (e) {}
    }
    if (state.campaign) {
      var key = kind === "dismiss" ? "dismissed" : "closed";
      ls.set(suppressionKey(state.campaign.id, key), String(Date.now()));
      trackEvent(kind === "dismiss" ? "close" : "close");
    }
  }

  function trackEvent(event) {
    if (!state.campaign) return;
    var params = new URLSearchParams({
      action: "smart-popup-event",
      campaignId: state.campaign.id,
      event: event,
    });
    fetch("/apps/loyalty/smart-popup/event?" + params.toString(), {
      keepalive: true,
    }).catch(function () {});
  }

  // ─── Helpers ─────────────────────────────────────────────────────

  function detectPageType() {
    var t = (root.dataset.template || "").toLowerCase();
    if (t.indexOf("product") === 0) return "product";
    if (t.indexOf("collection") === 0) return "collection";
    if (t === "index") return "home";
    if (t === "cart") return "cart";
    if (t === "search") return "search";
    if (t === "blog") return "blog";
    if (t === "article") return "article";
    if (t === "page") return "page";
    return "other";
  }

  function ensureVisitorKey() {
    var existing = ls.get("sep:vk");
    if (existing) return existing;
    var rnd =
      Math.random().toString(36).slice(2) +
      Date.now().toString(36);
    ls.set("sep:vk", rnd);
    try {
      document.cookie =
        VISITOR_KEY_COOKIE + "=" + rnd + "; path=/; max-age=31536000; SameSite=Lax";
    } catch (e) {}
    return rnd;
  }

  function qs(k) {
    var m = location.search.match(new RegExp("[?&]" + k + "=([^&]*)"));
    return m ? decodeURIComponent(m[1].replace(/\+/g, " ")) : "";
  }

  function esc(s) {
    if (s == null) return "";
    var d = document.createElement("div");
    d.textContent = String(s);
    return d.innerHTML;
  }

  function safeStorage(kind) {
    var store = null;
    try {
      store = kind === "local" ? window.localStorage : window.sessionStorage;
      store.setItem("sep:probe", "1");
      store.removeItem("sep:probe");
    } catch (e) {
      store = null;
    }
    return {
      get: function (k) {
        try { return store ? store.getItem(k) : null; } catch (e) { return null; }
      },
      set: function (k, v) {
        try { if (store) store.setItem(k, v); } catch (e) {}
      },
    };
  }
})();
