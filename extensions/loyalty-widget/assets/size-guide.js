/**
 * Size Guide — App Embed (product pages).
 * Fetches settings from the App Proxy, then auto-injects a
 * "Size Chart" trigger near the variant/size selector (or ATC,
 * depending on the theme editor placement setting).
 */
(function () {
  "use strict";

  function applyColors(c) {
    var r = document.documentElement;
    r.style.setProperty("--sg-accent", c.accentColor || "#d97706");
    r.style.setProperty("--sg-text", c.textColor || "#1f2937");
    r.style.setProperty("--sg-row-alt", c.rowAltColor || "#fafafa");
    r.style.setProperty("--sg-border", c.borderColor || "#e5e7eb");
  }

  function renderTable(thead, tbody, headers, rows) {
    thead.innerHTML = "";
    tbody.innerHTML = "";
    var trh = document.createElement("tr");
    (headers || []).forEach(function (t) {
      var th = document.createElement("th");
      th.textContent = String(t || "");
      trh.appendChild(th);
    });
    thead.appendChild(trh);
    (rows || []).forEach(function (row) {
      if (!row || !row.length) return;
      var tr = document.createElement("tr");
      row.forEach(function (cell) {
        var td = document.createElement("td");
        td.textContent = String(cell == null ? "" : cell);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
  }

  function findAnchorTarget(anchor) {
    // Try specific size/variant selector selectors first, then fall back
    // to add-to-cart button, then the product form as a last resort.
    var form = document.querySelector('form[action*="/cart/add"]');
    if (!form) return null;

    var variantSelectors = [
      'variant-selects',
      'variant-radios',
      'fieldset[name="Size"]',
      'fieldset:has(legend)',
      '[data-product-form] fieldset',
      '.product-form__input--pill',
      '.product-form__input',
    ];
    var atcSelectors = [
      'button[name="add"]',
      '[data-add-to-cart]',
      '.product-form__submit',
      'button[type="submit"]',
    ];

    function firstMatch(selectors, scope) {
      for (var i = 0; i < selectors.length; i++) {
        try {
          var el = (scope || form).querySelector(selectors[i]);
          if (el) return el;
        } catch (e) { /* :has() may throw in old browsers */ }
      }
      return null;
    }

    if (anchor === "above-atc" || anchor === "below-atc") {
      var atc = firstMatch(atcSelectors);
      if (atc) return { el: atc, position: anchor === "above-atc" ? "before" : "after" };
    }

    var sizeEl = firstMatch(variantSelectors);
    if (sizeEl) {
      return { el: sizeEl, position: anchor === "below-variants" ? "after" : "before" };
    }

    var atc2 = firstMatch(atcSelectors);
    if (atc2) return { el: atc2, position: "before" };

    return { el: form, position: "prepend" };
  }

  function injectTrigger(container, target) {
    if (!target || !target.el) return null;
    var tpl = container.querySelector("[data-sg-trigger-tpl]");
    if (!tpl || !tpl.content) return null;
    var wrapper = document.createElement("div");
    wrapper.className = "sg-trigger-wrap sg-container";
    wrapper.appendChild(tpl.content.firstElementChild.cloneNode(true));
    if (target.position === "before") {
      target.el.parentNode.insertBefore(wrapper, target.el);
    } else if (target.position === "after") {
      target.el.parentNode.insertBefore(wrapper, target.el.nextSibling);
    } else {
      target.el.insertBefore(wrapper, target.el.firstChild);
    }
    return wrapper;
  }

  function init(container) {
    if (container.dataset.sgInit === "1") return;
    container.dataset.sgInit = "1";

    var proxyBase = container.dataset.appProxyUrl || "/apps/loyalty";
    var anchor = container.dataset.anchor || "above-variants";

    var overlay = container.querySelector("[data-sg-overlay]");
    var modalTitleEl = container.querySelector("[data-sg-modal-title]");
    var chartTitleEl = container.querySelector("[data-sg-chart-title]");
    var noteEl = container.querySelector("[data-sg-note]");
    var thead = container.querySelector("[data-sg-thead]");
    var tbody = container.querySelector("[data-sg-tbody]");
    var closeBtn = overlay.querySelector("[data-sg-close]");
    var modal = overlay.querySelector(".sg-modal");
    var unitBtns = overlay.querySelectorAll("[data-sg-unit]");

    var config = null;
    var currentUnit = "cm";
    var lastFocused = null;
    var triggerWrap = null;

    function paintTable() {
      if (!config) return;
      var headers = currentUnit === "cm" ? config.headersCm : config.headersInches;
      var rows = currentUnit === "cm" ? config.rowsCm : config.rowsInches;
      renderTable(thead, tbody, headers, rows);
    }

    function switchUnit(unit) {
      currentUnit = unit;
      unitBtns.forEach(function (b) {
        var active = b.getAttribute("data-sg-unit") === unit;
        b.classList.toggle("sg-unit-active", active);
        b.setAttribute("aria-selected", active ? "true" : "false");
      });
      paintTable();
    }

    function open() {
      lastFocused = document.activeElement;
      overlay.hidden = false;
      void overlay.offsetWidth;
      overlay.classList.add("sg-open");
      document.body.classList.add("sg-lock");
      document.addEventListener("keydown", onKey);
      setTimeout(function () { if (closeBtn) closeBtn.focus(); }, 50);
    }

    function close() {
      overlay.classList.remove("sg-open");
      document.body.classList.remove("sg-lock");
      document.removeEventListener("keydown", onKey);
      setTimeout(function () {
        overlay.hidden = true;
        if (lastFocused && typeof lastFocused.focus === "function") lastFocused.focus();
      }, 180);
    }

    function onKey(e) {
      if (e.key === "Escape") { e.preventDefault(); close(); }
    }

    if (closeBtn) closeBtn.addEventListener("click", close);
    overlay.addEventListener("click", function (e) { if (e.target === overlay) close(); });
    if (modal) modal.addEventListener("click", function (e) { e.stopPropagation(); });
    unitBtns.forEach(function (b) {
      b.addEventListener("click", function () { switchUnit(b.getAttribute("data-sg-unit")); });
    });

    function wireTrigger() {
      var target = findAnchorTarget(anchor);
      triggerWrap = injectTrigger(container, target);
      if (!triggerWrap) return;
      var labelEl = triggerWrap.querySelector("[data-sg-label]");
      var iconEl = triggerWrap.querySelector("[data-sg-icon]");
      if (labelEl) labelEl.textContent = config.triggerLabel || "Size Chart";
      if (iconEl) iconEl.hidden = !config.showIcon;
      var btn = triggerWrap.querySelector("[data-sg-open]");
      if (btn) btn.addEventListener("click", open);
    }

    function applyConfig(cfg) {
      config = cfg;
      applyColors(cfg);
      if (modalTitleEl) modalTitleEl.textContent = cfg.modalTitle || "Size Charts";
      if (chartTitleEl) {
        chartTitleEl.textContent = cfg.chartTitle || "";
        chartTitleEl.hidden = !cfg.chartTitle;
      }
      if (noteEl) {
        noteEl.textContent = cfg.note || "";
        noteEl.hidden = !cfg.note;
      }
      paintTable();
      wireTrigger();
    }

    fetch(proxyBase + "/size-guide-settings", {
      headers: { Accept: "application/json" },
      credentials: "same-origin",
    })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
      .then(function (cfg) {
        if (!cfg || cfg.enabled === false) return;
        applyConfig(cfg);
      })
      .catch(function () { /* silently hide if unreachable */ });
  }

  function boot() {
    document.querySelectorAll("[data-sg-root]").forEach(init);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
  document.addEventListener("shopify:section:load", boot);
})();
