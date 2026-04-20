/**
 * Wishlist & Save for Later
 * - Guest persistence: localStorage
 * - Logged-in persistence: app proxy at /apps/loyalty/{wishlist,saved}/*
 * - On login, merges guest local lists into the customer record (union).
 *
 * Exposes window.LoyaltyWishlist with:
 *   listWishlist(), listSaved(), isInWishlist(productId)
 *   addToWishlist(item), removeFromWishlist(productId)
 *   addToSaved(item),    removeFromSaved(variantId)
 *   moveToCart(variantId, quantity?)
 *   on(event, handler)  — events: change, ready
 */
(function () {
  "use strict";

  if (window.LoyaltyWishlist) return; // single instance per page

  var LS_KEY = "loyalty_wishlist_v1";
  var MERGE_FLAG = "loyalty_wishlist_merged_v1";
  var PROXY_BASE = "/apps/loyalty";

  // ── State ────────────────────────────────────────────────────────
  var state = { wishlist: [], saved: [] };
  var settings = { enabled: false };
  var listeners = { change: [], ready: [], settings: [] };
  var customerId = readCustomerId();
  var ready = false;

  function readCustomerId() {
    var el =
      document.querySelector("[data-wl-button][data-customer-id]") ||
      document.querySelector("[data-wl-page][data-customer-id]") ||
      document.querySelector("#loyalty-wishlist-embed");
    var raw = el ? el.dataset.customerId : "";
    return raw && raw !== "0" ? raw : "";
  }

  function readEmbed() {
    return document.getElementById("loyalty-wishlist-embed");
  }

  // ── Storage ──────────────────────────────────────────────────────
  function readLocal() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return { wishlist: [], saved: [] };
      var parsed = JSON.parse(raw);
      return {
        wishlist: Array.isArray(parsed.wishlist) ? parsed.wishlist : [],
        saved: Array.isArray(parsed.saved) ? parsed.saved : [],
      };
    } catch (e) {
      return { wishlist: [], saved: [] };
    }
  }

  function writeLocal() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(state));
    } catch (e) {
      /* quota / private mode — ignore */
    }
  }

  function emit(event, payload) {
    (listeners[event] || []).forEach(function (fn) {
      try {
        fn(payload);
      } catch (e) {
        /* ignore handler errors */
      }
    });
  }

  function setState(next) {
    state = {
      wishlist: next.wishlist || [],
      saved: next.saved || [],
    };
    if (!customerId) writeLocal();
    emit("change", state);
  }

  // ── Proxy calls (logged-in only) ─────────────────────────────────
  function buildQuery(params) {
    return Object.keys(params)
      .filter(function (k) {
        return params[k] !== undefined && params[k] !== null && params[k] !== "";
      })
      .map(function (k) {
        return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]);
      })
      .join("&");
  }

  function proxyGet(path, params) {
    return fetch(PROXY_BASE + path + (params ? "?" + buildQuery(params) : ""), {
      credentials: "same-origin",
    }).then(function (r) {
      return r.json().catch(function () { return {}; });
    });
  }

  function proxyPost(path, body) {
    return fetch(PROXY_BASE + path, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(function (r) {
      return r.json().catch(function () { return {}; });
    });
  }

  // ── Initial load + guest→customer merge ──────────────────────────
  function loadSettings() {
    return proxyGet("/wishlist-settings")
      .then(function (data) {
        settings = data || { enabled: false };
        emit("settings", settings);
        return settings;
      })
      .catch(function () {
        settings = { enabled: false };
        emit("settings", settings);
        return settings;
      });
  }

  function applyDisabledUI() {
    // Hide all wishlist UI when the merchant has turned the feature off.
    document.querySelectorAll("[data-wl-button]").forEach(function (b) {
      b.style.display = "none";
    });
    document.querySelectorAll("[data-wl-page]").forEach(function (p) {
      p.style.display = "none";
    });
  }

  function init() {
    var local = readLocal();

    if (!settings.enabled) {
      applyDisabledUI();
      ready = true;
      emit("ready", state);
      return;
    }

    if (!customerId) {
      setState(local);
      ready = true;
      emit("ready", state);
      return;
    }

    // Logged-in: if we have local items and haven't merged yet, push them up.
    var hasLocal =
      local.wishlist.length > 0 || local.saved.length > 0;
    var alreadyMerged = false;
    try {
      alreadyMerged = localStorage.getItem(MERGE_FLAG) === customerId;
    } catch (e) {
      /* ignore */
    }

    var loadPromise;
    if (hasLocal && !alreadyMerged) {
      loadPromise = proxyPost("/wishlist/merge", local).then(function (merged) {
        try {
          localStorage.setItem(MERGE_FLAG, customerId);
          // Clear guest copy — server is source of truth from here.
          localStorage.removeItem(LS_KEY);
        } catch (e) { /* ignore */ }
        return merged;
      });
    } else {
      loadPromise = proxyGet("/wishlist");
    }

    loadPromise
      .then(function (data) {
        setState({
          wishlist: data.wishlist || [],
          saved: data.saved || [],
        });
      })
      .catch(function () {
        // Fall back to local view so the UI still renders.
        setState(local);
      })
      .then(function () {
        ready = true;
        emit("ready", state);
      });
  }

  // ── Mutations ────────────────────────────────────────────────────
  function indexOfBy(arr, key, value) {
    for (var i = 0; i < arr.length; i++) {
      if (String(arr[i][key]) === String(value)) return i;
    }
    return -1;
  }

  function addToWishlist(item) {
    if (!item || !item.productId) return Promise.reject(new Error("productId required"));
    var existing = indexOfBy(state.wishlist, "productId", item.productId);
    if (existing === -1) {
      state.wishlist = [
        {
          productId: String(item.productId),
          productHandle: item.productHandle,
          productTitle: item.productTitle,
          imageUrl: item.imageUrl,
          price: item.price,
          savedAt: new Date().toISOString(),
        },
      ].concat(state.wishlist);
      setState(state);
    }
    if (!customerId) return Promise.resolve({ success: true });
    return proxyGet("/wishlist/add", {
      productId: item.productId,
      productHandle: item.productHandle,
      productTitle: item.productTitle,
      imageUrl: item.imageUrl,
      price: item.price,
    });
  }

  function removeFromWishlist(productId) {
    var i = indexOfBy(state.wishlist, "productId", productId);
    if (i !== -1) {
      state.wishlist.splice(i, 1);
      setState(state);
    }
    if (!customerId) return Promise.resolve({ success: true });
    return proxyGet("/wishlist/remove", { productId: productId });
  }

  function addToSaved(item) {
    if (!item || !item.productId || !item.variantId) {
      return Promise.reject(new Error("productId + variantId required"));
    }
    var existing = indexOfBy(state.saved, "variantId", item.variantId);
    if (existing === -1) {
      state.saved = [
        {
          productId: String(item.productId),
          variantId: String(item.variantId),
          productHandle: item.productHandle,
          productTitle: item.productTitle,
          variantTitle: item.variantTitle,
          imageUrl: item.imageUrl,
          price: item.price,
          quantity: item.quantity || 1,
          savedAt: new Date().toISOString(),
        },
      ].concat(state.saved);
      setState(state);
    }
    if (!customerId) return Promise.resolve({ success: true });
    return proxyGet("/saved/add", {
      productId: item.productId,
      variantId: item.variantId,
      productHandle: item.productHandle,
      productTitle: item.productTitle,
      variantTitle: item.variantTitle,
      imageUrl: item.imageUrl,
      price: item.price,
      quantity: item.quantity || 1,
    });
  }

  function removeFromSaved(variantId) {
    var i = indexOfBy(state.saved, "variantId", variantId);
    if (i !== -1) {
      state.saved.splice(i, 1);
      setState(state);
    }
    if (!customerId) return Promise.resolve({ success: true });
    return proxyGet("/saved/remove", { variantId: variantId });
  }

  function moveToCart(variantId, quantity) {
    var qty = quantity || 1;
    return fetch("/cart/add.js", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ id: Number(variantId), quantity: qty }),
    })
      .then(function (r) {
        if (!r.ok) throw new Error("Add to cart failed");
        return r.json();
      })
      .then(function (line) {
        return removeFromSaved(variantId).then(function () {
          // Best-effort: notify themes/drawers that listen for cart updates.
          try {
            document.dispatchEvent(new CustomEvent("cart:updated"));
          } catch (e) { /* IE shim not needed in modern themes */ }
          return line;
        });
      });
  }

  function isInWishlist(productId) {
    return indexOfBy(state.wishlist, "productId", productId) !== -1;
  }

  function isInSaved(variantId) {
    return indexOfBy(state.saved, "variantId", variantId) !== -1;
  }

  // ── Public API ───────────────────────────────────────────────────
  window.LoyaltyWishlist = {
    listWishlist: function () { return state.wishlist.slice(); },
    listSaved: function () { return state.saved.slice(); },
    isInWishlist: isInWishlist,
    isInSaved: isInSaved,
    addToWishlist: addToWishlist,
    removeFromWishlist: removeFromWishlist,
    addToSaved: addToSaved,
    removeFromSaved: removeFromSaved,
    moveToCart: moveToCart,
    isReady: function () { return ready; },
    on: function (event, handler) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(handler);
      if (event === "ready" && ready) handler(state);
    },
  };

  // ── Wishlist button (PDP) wiring ─────────────────────────────────
  function renderButton(btn) {
    var pid = btn.dataset.productId;
    var saved = isInWishlist(pid);
    btn.setAttribute("aria-pressed", saved ? "true" : "false");
    btn.classList.toggle("is-active", saved);
    var add = btn.querySelector("[data-wl-label-add]");
    var on = btn.querySelector("[data-wl-label-saved]");
    if (add) add.style.display = saved ? "none" : "";
    if (on) on.style.display = saved ? "" : "none";
  }

  function bindButton(btn) {
    var pid = btn.dataset.productId;
    if (!pid) return;
    renderButton(btn);
    btn.addEventListener("click", function () {
      btn.disabled = true;
      var op = isInWishlist(pid)
        ? removeFromWishlist(pid)
        : addToWishlist({
            productId: pid,
            productHandle: btn.dataset.productHandle,
            productTitle: btn.dataset.productTitle,
            imageUrl: btn.dataset.imageUrl,
            price: btn.dataset.price ? Number(btn.dataset.price) : undefined,
          });
      Promise.resolve(op)
        .catch(function () { /* state already updated optimistically */ })
        .then(function () { btn.disabled = false; renderButton(btn); });
    });
  }

  function bindAllButtons() {
    document.querySelectorAll("[data-wl-button]").forEach(bindButton);
  }

  window.LoyaltyWishlist.on("change", function () {
    document.querySelectorAll("[data-wl-button]").forEach(renderButton);
    renderPages();
  });

  // ── Wishlist / Saved page rendering ──────────────────────────────
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function formatPrice(value) {
    if (value == null || isNaN(Number(value))) return "";
    return Number(value).toFixed(2);
  }

  function renderItemCard(item, kind) {
    var url = item.productHandle ? "/products/" + item.productHandle : "#";
    var img = item.imageUrl
      ? '<img class="wl-card-img" src="' + escapeHtml(item.imageUrl) + '" alt="' + escapeHtml(item.productTitle || "") + '" loading="lazy" />'
      : '<div class="wl-card-img wl-card-img-empty"></div>';
    var variant = item.variantTitle && item.variantTitle !== "Default Title"
      ? '<p class="wl-card-variant">' + escapeHtml(item.variantTitle) + "</p>"
      : "";
    var price = item.price != null
      ? '<p class="wl-card-price">' + escapeHtml(formatPrice(item.price)) + "</p>"
      : "";

    var actions =
      kind === "wishlist"
        ? '<div class="wl-card-actions">' +
            '<button type="button" class="wl-cta" data-wl-action="wishlist-add-to-cart" data-product-handle="' +
              escapeHtml(item.productHandle || "") +
            '">View product</button>' +
            '<button type="button" class="wl-link" data-wl-action="wishlist-remove" data-product-id="' +
              escapeHtml(item.productId) +
            '">Remove</button>' +
          "</div>"
        : '<div class="wl-card-actions">' +
            '<button type="button" class="wl-cta" data-wl-action="saved-move-to-cart" data-variant-id="' +
              escapeHtml(item.variantId) +
            '" data-quantity="' + (item.quantity || 1) + '">Move to cart</button>' +
            '<button type="button" class="wl-link" data-wl-action="saved-remove" data-variant-id="' +
              escapeHtml(item.variantId) +
            '">Remove</button>' +
          "</div>";

    return (
      '<article class="wl-card">' +
        '<a class="wl-card-media" href="' + escapeHtml(url) + '">' + img + "</a>" +
        '<div class="wl-card-body">' +
          '<a class="wl-card-title" href="' + escapeHtml(url) + '">' +
            escapeHtml(item.productTitle || "Product") +
          "</a>" +
          variant +
          price +
          actions +
        "</div>" +
      "</article>"
    );
  }

  function renderPages() {
    document.querySelectorAll("[data-wl-page]").forEach(function (page) {
      var wlList = page.querySelector('[data-wl-list="wishlist"]');
      var wlEmpty = page.querySelector('[data-wl-empty="wishlist"]');
      var svList = page.querySelector('[data-wl-list="saved"]');
      var svEmpty = page.querySelector('[data-wl-empty="saved"]');

      if (wlList) {
        if (state.wishlist.length === 0) {
          wlList.innerHTML = "";
          if (wlEmpty) wlEmpty.style.display = "";
        } else {
          if (wlEmpty) wlEmpty.style.display = "none";
          wlList.innerHTML = state.wishlist
            .map(function (i) { return renderItemCard(i, "wishlist"); })
            .join("");
        }
      }

      if (svList) {
        if (state.saved.length === 0) {
          svList.innerHTML = "";
          if (svEmpty) svEmpty.style.display = "";
        } else {
          if (svEmpty) svEmpty.style.display = "none";
          svList.innerHTML = state.saved
            .map(function (i) { return renderItemCard(i, "saved"); })
            .join("");
        }
      }
    });
  }

  function bindPageActions() {
    document.addEventListener("click", function (e) {
      var t = e.target.closest && e.target.closest("[data-wl-action]");
      if (!t) return;
      var action = t.dataset.wlAction;

      if (action === "wishlist-remove") {
        e.preventDefault();
        removeFromWishlist(t.dataset.productId);
        return;
      }
      if (action === "saved-remove") {
        e.preventDefault();
        removeFromSaved(t.dataset.variantId);
        return;
      }
      if (action === "wishlist-add-to-cart") {
        // Send to PDP; theme's normal add-to-cart will handle variant pickers.
        if (t.dataset.productHandle) {
          window.location.href = "/products/" + t.dataset.productHandle;
        }
        return;
      }
      if (action === "saved-move-to-cart") {
        e.preventDefault();
        var variantId = t.dataset.variantId;
        var qty = Number(t.dataset.quantity) || 1;
        var orig = t.textContent;
        t.disabled = true;
        t.textContent = "Moving…";
        moveToCart(variantId, qty)
          .catch(function () {
            t.disabled = false;
            t.textContent = "Couldn't add — try again";
            setTimeout(function () { t.textContent = orig; }, 2500);
          });
      }
    });
  }

  // ── Floating wishlist button (optional, from app embed) ─────────
  function renderFloatingButton() {
    var embed = readEmbed();
    if (!embed) return;
    if (embed.dataset.floatingButton !== "true") return;

    var existing = document.getElementById("wl-floating");
    if (existing) existing.remove();

    var pos = embed.dataset.floatingPosition || "bottom-right";
    var label = embed.dataset.floatingLabel || "Wishlist";
    var btn = document.createElement("button");
    btn.id = "wl-floating";
    btn.type = "button";
    btn.className = "wl-floating wl-floating-" + pos;
    btn.setAttribute("aria-label", label);
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">' +
        '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>' +
      '</svg>' +
      '<span class="wl-floating-count" data-wl-floating-count>0</span>';
    btn.addEventListener("click", function () {
      window.location.href = "/pages/wishlist";
    });
    document.body.appendChild(btn);
    updateFloatingCount();
  }

  function updateFloatingCount() {
    var count = state.wishlist.length + state.saved.length;
    var el = document.querySelector("[data-wl-floating-count]");
    if (el) {
      el.textContent = String(count);
      el.style.display = count > 0 ? "" : "none";
    }
  }

  // Keep floating count in sync.
  listeners.change.push(updateFloatingCount);

  // ── Boot ─────────────────────────────────────────────────────────
  function boot() {
    bindPageActions();
    loadSettings().then(function () {
      if (!settings.enabled) {
        applyDisabledUI();
        ready = true;
        emit("ready", state);
        return;
      }
      bindAllButtons();
      renderFloatingButton();
      init();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
