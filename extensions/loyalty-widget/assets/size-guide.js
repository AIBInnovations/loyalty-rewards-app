/**
 * Size Guide Widget — fetches settings from App Proxy and renders.
 * Config source: /apps/loyalty/size-guide-settings
 */
(function () {
  "use strict";

  function h(el, attrs, children) {
    var node = document.createElement(el);
    if (attrs) Object.keys(attrs).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    (children || []).forEach(function (c) {
      if (c == null) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }

  function applyColors(root, c) {
    root.style.setProperty("--sg-accent", c.accentColor || "#d97706");
    root.style.setProperty("--sg-text", c.textColor || "#1f2937");
    root.style.setProperty("--sg-row-alt", c.rowAltColor || "#fafafa");
    root.style.setProperty("--sg-border", c.borderColor || "#e5e7eb");
  }

  function renderTable(thead, tbody, headers, rows) {
    thead.innerHTML = "";
    tbody.innerHTML = "";

    var trh = document.createElement("tr");
    (headers || []).forEach(function (t) {
      trh.appendChild(h("th", null, [String(t || "")]));
    });
    thead.appendChild(trh);

    (rows || []).forEach(function (row) {
      if (!row || !row.length) return;
      var tr = document.createElement("tr");
      row.forEach(function (cell) {
        tr.appendChild(h("td", null, [String(cell == null ? "" : cell)]));
      });
      tbody.appendChild(tr);
    });
  }

  function init(container) {
    if (container.dataset.sgInit === "1") return;
    container.dataset.sgInit = "1";

    var proxyBase = container.dataset.appProxyUrl || "/apps/loyalty";
    var trigger = container.querySelector("[data-sg-open]");
    var overlay = container.querySelector("[data-sg-overlay]");
    var icon = container.querySelector("[data-sg-icon]");
    var labelEl = container.querySelector("[data-sg-label]");
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

    function applyConfig(cfg) {
      config = cfg;
      applyColors(container, cfg);
      if (labelEl) labelEl.textContent = cfg.triggerLabel || "Size Chart";
      if (icon) icon.hidden = !cfg.showIcon;
      if (modalTitleEl) modalTitleEl.textContent = cfg.modalTitle || "Size Charts";
      if (chartTitleEl) {
        chartTitleEl.textContent = cfg.chartTitle || "";
        chartTitleEl.hidden = !cfg.chartTitle;
      }
      if (noteEl) {
        noteEl.textContent = cfg.note || "";
        noteEl.hidden = !cfg.note;
      }
      container.hidden = false;
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

    trigger.addEventListener("click", open);
    if (closeBtn) closeBtn.addEventListener("click", close);
    overlay.addEventListener("click", function (e) { if (e.target === overlay) close(); });
    if (modal) modal.addEventListener("click", function (e) { e.stopPropagation(); });
    unitBtns.forEach(function (b) {
      b.addEventListener("click", function () { switchUnit(b.getAttribute("data-sg-unit")); });
    });

    fetch(proxyBase + "/size-guide-settings", {
      headers: { Accept: "application/json" },
      credentials: "same-origin",
    })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
      .then(function (cfg) {
        if (!cfg || cfg.enabled === false) {
          container.hidden = true;
          return;
        }
        applyConfig(cfg);
      })
      .catch(function () { container.hidden = true; });
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
