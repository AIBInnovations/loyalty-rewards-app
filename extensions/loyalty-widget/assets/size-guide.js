/**
 * Size Guide Widget - modal open/close, unit tabs, focus management.
 * Multiple blocks per page are supported (each container is self-contained).
 */
(function () {
  "use strict";

  function init(container) {
    if (container.dataset.sgInit === "1") return;
    container.dataset.sgInit = "1";

    var trigger = container.querySelector("[data-sg-open]");
    var overlay = container.querySelector("[data-sg-overlay]");
    if (!trigger || !overlay) return;

    var modal = overlay.querySelector(".sg-modal");
    var closeBtn = overlay.querySelector("[data-sg-close]");
    var unitBtns = overlay.querySelectorAll("[data-sg-unit]");
    var panels = overlay.querySelectorAll("[data-sg-panel]");
    var lastFocused = null;

    function open() {
      lastFocused = document.activeElement;
      overlay.hidden = false;
      // Force reflow so the transition runs.
      void overlay.offsetWidth;
      overlay.classList.add("sg-open");
      document.body.classList.add("sg-lock");
      document.addEventListener("keydown", onKey);
      setTimeout(function () {
        if (closeBtn) closeBtn.focus();
      }, 50);
    }

    function close() {
      overlay.classList.remove("sg-open");
      document.body.classList.remove("sg-lock");
      document.removeEventListener("keydown", onKey);
      setTimeout(function () {
        overlay.hidden = true;
        if (lastFocused && typeof lastFocused.focus === "function") {
          lastFocused.focus();
        }
      }, 180);
    }

    function onKey(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    }

    function switchUnit(unit) {
      unitBtns.forEach(function (b) {
        var active = b.getAttribute("data-sg-unit") === unit;
        b.classList.toggle("sg-unit-active", active);
        b.setAttribute("aria-selected", active ? "true" : "false");
      });
      panels.forEach(function (p) {
        p.hidden = p.getAttribute("data-sg-panel") !== unit;
      });
    }

    trigger.addEventListener("click", open);
    if (closeBtn) closeBtn.addEventListener("click", close);

    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) close();
    });

    // Prevent modal clicks from bubbling to overlay.
    if (modal) {
      modal.addEventListener("click", function (e) {
        e.stopPropagation();
      });
    }

    unitBtns.forEach(function (b) {
      b.addEventListener("click", function () {
        switchUnit(b.getAttribute("data-sg-unit"));
      });
    });
  }

  function boot() {
    document.querySelectorAll(".sg-container").forEach(init);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  // Re-init on Shopify section reload (theme editor).
  document.addEventListener("shopify:section:load", boot);
})();
