(function () {
  'use strict';

  function initRoot(root) {
    if (!root || root.dataset.faqInit === '1') return;
    root.dataset.faqInit = '1';

    var allowMultiple = root.dataset.allowMultiple === 'true';
    var triggers = root.querySelectorAll('[data-faq-trigger]');

    triggers.forEach(function (trigger) {
      trigger.addEventListener('click', function (e) {
        e.preventDefault();
        toggle(trigger, root, allowMultiple);
      });

      trigger.addEventListener('keydown', function (e) {
        var key = e.key;
        if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Home' || key === 'End') {
          e.preventDefault();
          focusSibling(trigger, root, key);
        }
      });
    });
  }

  function toggle(trigger, root, allowMultiple) {
    var panelId = trigger.getAttribute('aria-controls');
    var panel = panelId ? document.getElementById(panelId) : null;
    var item = trigger.closest('[data-faq-item]');
    if (!panel || !item) return;

    var isOpen = trigger.getAttribute('aria-expanded') === 'true';

    if (!allowMultiple && !isOpen) {
      root.querySelectorAll('[data-faq-trigger][aria-expanded="true"]').forEach(function (other) {
        if (other !== trigger) closePanel(other, root);
      });
    }

    if (isOpen) {
      closePanel(trigger, root);
      dispatch(root, 'faq:close', trigger, panel);
    } else {
      openPanel(trigger, root);
      dispatch(root, 'faq:open', trigger, panel);
    }
  }

  function openPanel(trigger, root) {
    var panelId = trigger.getAttribute('aria-controls');
    var panel = panelId ? document.getElementById(panelId) : null;
    var item = trigger.closest('[data-faq-item]');
    if (!panel || !item) return;
    trigger.setAttribute('aria-expanded', 'true');
    panel.removeAttribute('hidden');
    item.classList.add('is-open');
  }

  function closePanel(trigger, root) {
    var panelId = trigger.getAttribute('aria-controls');
    var panel = panelId ? document.getElementById(panelId) : null;
    var item = trigger.closest('[data-faq-item]');
    if (!panel || !item) return;
    trigger.setAttribute('aria-expanded', 'false');
    panel.setAttribute('hidden', '');
    item.classList.remove('is-open');
  }

  function focusSibling(trigger, root, key) {
    var list = Array.prototype.slice.call(root.querySelectorAll('[data-faq-trigger]'));
    if (!list.length) return;
    var idx = list.indexOf(trigger);
    var next = idx;

    if (key === 'ArrowDown') next = (idx + 1) % list.length;
    else if (key === 'ArrowUp') next = (idx - 1 + list.length) % list.length;
    else if (key === 'Home') next = 0;
    else if (key === 'End') next = list.length - 1;

    if (list[next]) list[next].focus();
  }

  function dispatch(root, name, trigger, panel) {
    try {
      var detail = {
        question: (trigger.querySelector('.faq-q-text') || {}).textContent || '',
        rootId: root.id || '',
        panelId: panel.id || ''
      };
      root.dispatchEvent(new CustomEvent(name, { detail: detail, bubbles: true }));
    } catch (_) {}
  }

  function initAll() {
    document.querySelectorAll('[data-faq-root]').forEach(initRoot);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll);
  } else {
    initAll();
  }

  document.addEventListener('shopify:section:load', initAll);
  document.addEventListener('shopify:block:select', function (e) {
    if (e && e.target) initRoot(e.target.closest('[data-faq-root]'));
  });
})();
