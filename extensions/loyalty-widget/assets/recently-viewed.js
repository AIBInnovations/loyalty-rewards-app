(function () {
  "use strict";

  var STORAGE_KEY = "rv_products";
  var MAX_STORE   = 20;

  var root = document.getElementById("recently-viewed-widget");
  if (!root) return;

  var currentId      = root.dataset.currentProductId;
  var currentHandle  = root.dataset.currentProductHandle;
  var currentTitle   = root.dataset.currentProductTitle;
  var currentImage   = root.dataset.currentProductImage;
  var currentUrl     = root.dataset.currentProductUrl;
  var currentPrice   = parseInt(root.dataset.currentProductPrice || "0", 10);
  var currentCompare = parseInt(root.dataset.currentProductCompare || "0", 10);
  var moneyFmt       = root.dataset.moneyFormat;
  var widgetTitle    = root.dataset.title || "Recently Viewed";
  var maxShow        = parseInt(root.dataset.maxProducts || "4", 10);
  var showPrice      = root.dataset.showPrice !== "false";
  var template       = root.dataset.template;

  function formatMoney(cents) {
    return moneyFmt.replace("{{amount}}", (cents / 100).toFixed(2))
                   .replace("{{amount_no_decimals}}", Math.floor(cents / 100));
  }

  function load() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); }
    catch (e) { return []; }
  }

  function save(list) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch (e) {}
  }

  // Record current product if on a product page
  if (template === "product" && currentId) {
    var list = load();
    list = list.filter(function (p) { return p.id !== currentId; });
    list.unshift({
      id: currentId,
      handle: currentHandle,
      title: currentTitle,
      image: currentImage,
      url: currentUrl,
      price: currentPrice,
      compare: currentCompare,
    });
    if (list.length > MAX_STORE) list = list.slice(0, MAX_STORE);
    save(list);
  }

  // Render widget — exclude the current product when on product page
  function render() {
    var list = load();
    if (template === "product") {
      list = list.filter(function (p) { return p.id !== currentId; });
    }
    list = list.slice(0, maxShow);

    if (list.length === 0) return; // nothing to show

    var section = document.createElement("div");
    section.id = "recently-viewed-section";

    var html = '<h2 class="rv-title">' + widgetTitle + '</h2><div class="rv-grid">';
    list.forEach(function (p) {
      html +=
        '<a class="rv-card" href="' + p.url + '">' +
          '<img src="' + p.image + '" alt="' + p.title + '" loading="lazy">' +
          '<div class="rv-card-body">' +
            '<p class="rv-card-title">' + p.title + '</p>' +
            (showPrice
              ? '<p class="rv-card-price">' + formatMoney(p.price) +
                (p.compare && p.compare > p.price
                  ? '<span class="rv-card-compare">' + formatMoney(p.compare) + '</span>'
                  : '') +
                '</p>'
              : '') +
          '</div>' +
        '</a>';
    });
    html += "</div>";
    section.innerHTML = html;

    // Insert before the root placeholder
    root.parentNode.insertBefore(section, root.nextSibling);
  }

  render();
})();
