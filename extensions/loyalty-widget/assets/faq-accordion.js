/**
 * FAQ Accordion - App Embed (storefront renderer).
 * Fetches config from the App Proxy, then renders a server-visible
 * accordion (HTML) + FAQPage JSON-LD into the page.
 */
(function () {
  "use strict";

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function nl2br(s) {
    return esc(s).replace(/\n/g, "<br>");
  }

  function getBootstrap() {
    return document.querySelector("[data-faq-root]#faq-embed, [data-faq-root]");
  }

  function currentTemplate(root) {
    var t = (root && root.dataset && root.dataset.templateName) || "";
    if (t) return t;
    var bodyClass = document.body ? document.body.className || "" : "";
    if (/template-product|\bproduct\b/.test(bodyClass)) return "product";
    if (/template-collection|\bcollection\b/.test(bodyClass)) return "collection";
    if (/template-page|\bpage\b/.test(bodyClass)) return "page";
    if (/template-index|\bindex\b/.test(bodyClass)) return "index";
    return "";
  }

  function buildSection(cfg) {
    var uid = "faq-" + Math.random().toString(36).slice(2, 9);
    var section = document.createElement("section");
    section.className = "faq-accordion faq-style-" + (cfg.iconStyle || "chevron");
    section.id = uid;
    section.setAttribute("data-faq-widget", "");
    section.setAttribute("data-allow-multiple", String(!!cfg.allowMultiple));
    section.setAttribute("aria-labelledby", uid + "-h");
    section.setAttribute(
      "style",
      [
        "--faq-bg:" + (cfg.backgroundColor || "#ffffff"),
        "--faq-text:" + (cfg.textColor || "#111827"),
        "--faq-accent:" + (cfg.accentColor || "#5C6AC4"),
        "--faq-border:" + (cfg.borderColor || "#e5e7eb"),
        "--faq-radius:" + (cfg.borderRadius != null ? cfg.borderRadius : 8) + "px",
        "--faq-gap:" + (cfg.itemGap != null ? cfg.itemGap : 8) + "px",
        "--faq-max-width:" + (cfg.maxWidth != null ? cfg.maxWidth : 880) + "px",
      ].join(";"),
    );

    var parts = [];
    parts.push('<div class="faq-inner">');
    if (cfg.heading) {
      parts.push(
        '<h2 class="faq-heading" id="' + uid + '-h">' + esc(cfg.heading) + "</h2>",
      );
    }
    if (cfg.subheading) {
      parts.push('<p class="faq-subheading">' + esc(cfg.subheading) + "</p>");
    }
    parts.push('<ul class="faq-list" role="list">');

    (cfg.items || []).forEach(function (it, idx) {
      var panelId = uid + "-p-" + (idx + 1);
      var trigId = uid + "-t-" + (idx + 1);
      var isOpen = !!cfg.firstOpen && idx === 0;
      parts.push(
        '<li class="faq-item' + (isOpen ? " is-open" : "") + '" data-faq-item>' +
          '<h3 class="faq-question-wrap">' +
          '<button type="button" class="faq-question" id="' + trigId +
          '" aria-expanded="' + (isOpen ? "true" : "false") +
          '" aria-controls="' + panelId + '" data-faq-trigger>' +
          '<span class="faq-q-text">' + esc(it.question) + "</span>" +
          '<span class="faq-icon" aria-hidden="true">' +
          '<svg viewBox="0 0 24 24" width="18" height="18" fill="none">' +
          '<path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
          "</svg></span>" +
          "</button></h3>" +
          '<div class="faq-panel" id="' + panelId +
          '" role="region" aria-labelledby="' + trigId + '"' +
          (isOpen ? "" : " hidden") + ">" +
          '<div class="faq-answer">' + nl2br(it.answer) + "</div>" +
          "</div>" +
          "</li>",
      );
    });

    parts.push("</ul></div>");
    section.innerHTML = parts.join("");
    return section;
  }

  function injectSchema(cfg) {
    if (!cfg.enableSchema) return;
    var items = cfg.items || [];
    if (!items.length) return;

    var payload = {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: items.map(function (it) {
        return {
          "@type": "Question",
          name: String(it.question || ""),
          acceptedAnswer: {
            "@type": "Answer",
            text: String(it.answer || "").slice(0, 1000),
          },
        };
      }),
    };

    var tag = document.createElement("script");
    tag.type = "application/ld+json";
    tag.setAttribute("data-faq-schema", "");
    tag.textContent = JSON.stringify(payload);
    document.head.appendChild(tag);
  }

  function place(section, anchor) {
    var target = null;
    var mode = "before";
    if (anchor === "before-footer") {
      target = document.querySelector(
        'footer[role="contentinfo"], footer.site-footer, .site-footer, #shopify-section-footer, footer',
      );
    } else if (anchor === "after-main") {
      target = document.querySelector('main, #MainContent, [role="main"]');
      mode = "after";
    }

    if (target && target.parentNode) {
      if (mode === "before") target.parentNode.insertBefore(section, target);
      else if (target.nextSibling) target.parentNode.insertBefore(section, target.nextSibling);
      else target.parentNode.appendChild(section);
    } else {
      document.body.appendChild(section);
    }
  }

  function wire(section) {
    var allowMultiple = section.getAttribute("data-allow-multiple") === "true";
    var triggers = section.querySelectorAll("[data-faq-trigger]");

    triggers.forEach(function (trigger) {
      trigger.addEventListener("click", function (e) {
        e.preventDefault();
        toggle(trigger, section, allowMultiple);
      });
      trigger.addEventListener("keydown", function (e) {
        var key = e.key;
        if (key === "ArrowDown" || key === "ArrowUp" || key === "Home" || key === "End") {
          e.preventDefault();
          focusSibling(trigger, section, key);
        }
      });
    });
  }

  function toggle(trigger, root, allowMultiple) {
    var panel = document.getElementById(trigger.getAttribute("aria-controls"));
    var item = trigger.closest("[data-faq-item]");
    if (!panel || !item) return;
    var isOpen = trigger.getAttribute("aria-expanded") === "true";

    if (!allowMultiple && !isOpen) {
      root.querySelectorAll('[data-faq-trigger][aria-expanded="true"]').forEach(function (o) {
        if (o !== trigger) close(o);
      });
    }
    isOpen ? close(trigger) : open(trigger);

    try {
      var detail = {
        question: (trigger.querySelector(".faq-q-text") || {}).textContent || "",
        rootId: root.id || "",
      };
      root.dispatchEvent(
        new CustomEvent(isOpen ? "faq:close" : "faq:open", {
          detail: detail,
          bubbles: true,
        }),
      );
    } catch (_) {}
  }

  function open(trigger) {
    var panel = document.getElementById(trigger.getAttribute("aria-controls"));
    var item = trigger.closest("[data-faq-item]");
    if (!panel || !item) return;
    trigger.setAttribute("aria-expanded", "true");
    panel.removeAttribute("hidden");
    item.classList.add("is-open");
  }

  function close(trigger) {
    var panel = document.getElementById(trigger.getAttribute("aria-controls"));
    var item = trigger.closest("[data-faq-item]");
    if (!panel || !item) return;
    trigger.setAttribute("aria-expanded", "false");
    panel.setAttribute("hidden", "");
    item.classList.remove("is-open");
  }

  function focusSibling(trigger, root, key) {
    var list = Array.prototype.slice.call(root.querySelectorAll("[data-faq-trigger]"));
    if (!list.length) return;
    var idx = list.indexOf(trigger);
    var next = idx;
    if (key === "ArrowDown") next = (idx + 1) % list.length;
    else if (key === "ArrowUp") next = (idx - 1 + list.length) % list.length;
    else if (key === "Home") next = 0;
    else if (key === "End") next = list.length - 1;
    if (list[next]) list[next].focus();
  }

  function fetchConfig(root) {
    var base = (root && root.dataset && root.dataset.appProxyUrl) || "/apps/loyalty";
    return fetch(base + "/faq-settings", { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  function init() {
    var root = getBootstrap();
    if (!root || root.dataset.faqInit === "1") return;
    root.dataset.faqInit = "1";

    fetchConfig(root).then(function (cfg) {
      if (!cfg || !cfg.enabled) return;
      if (cfg.restrictToProduct && currentTemplate(root) !== "product") return;
      if (!cfg.items || !cfg.items.length) return;

      var section = buildSection(cfg);
      place(section, cfg.placement || "before-footer");
      wire(section);
      injectSchema(cfg);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
