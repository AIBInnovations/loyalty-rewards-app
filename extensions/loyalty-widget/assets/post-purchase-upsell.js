(function () {
  "use strict";

  var root = document.getElementById("post-purchase-upsell");
  if (!root) return;

  var shopDomain = root.dataset.shopDomain;
  var moneyFmt   = root.dataset.moneyFormat;

  function formatMoney(cents) {
    return moneyFmt.replace("{{amount}}", (cents / 100).toFixed(2))
                   .replace("{{amount_no_decimals}}", Math.floor(cents / 100));
  }

  fetch("/apps/loyalty/upsell-settings", {
    headers: { "Content-Type": "application/json" },
  })
    .then(function (r) {
      var ct = r.headers.get("content-type") || "";
      if (!ct.includes("application/json")) throw new Error("proxy");
      return r.json();
    })
    .then(function (settings) {
      if (!settings.enabled || !settings.productHandle) return;
      return fetch("/products/" + settings.productHandle + ".js")
        .then(function (r) { return r.json(); })
        .then(function (product) { renderUpsell(settings, product); });
    })
    .catch(function () {});

  function renderUpsell(settings, product) {
    var variant = product.variants[0];
    if (!variant || !variant.available) return;

    var originalPrice  = variant.price;
    var discountAmount = Math.floor(originalPrice * (settings.discountPercent / 100));
    var finalPrice     = originalPrice - discountAmount;
    var variantId      = variant.id;

    var container = document.createElement("div");
    container.id = "ppu-container";
    container.innerHTML =
      '<div class="ppu-badge">Special Offer</div>' +
      '<p class="ppu-headline">' + (settings.headline || "Wait — grab this before you go!") + '</p>' +
      '<div class="ppu-product-row">' +
        '<img class="ppu-product-image" src="' + (product.featured_image || "") + '" alt="' + product.title + '">' +
        '<div class="ppu-product-info">' +
          '<p class="ppu-product-title">' + product.title + '</p>' +
          '<div class="ppu-price-row">' +
            '<span class="ppu-price">' + formatMoney(finalPrice) + '</span>' +
            (discountAmount > 0
              ? '<span class="ppu-compare">' + formatMoney(originalPrice) + '</span>' +
                '<span class="ppu-discount-badge">' + settings.discountPercent + '% OFF</span>'
              : '') +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="ppu-actions">' +
        '<button class="ppu-btn-yes" id="ppu-add-btn">' + (settings.buttonText || "Yes! Add to my order") + '</button>' +
        '<button class="ppu-btn-no" id="ppu-no-btn">No thanks</button>' +
      '</div>';

    root.parentNode.insertBefore(container, root.nextSibling);

    document.getElementById("ppu-add-btn").addEventListener("click", function () {
      var btn = this;
      btn.disabled = true;
      btn.textContent = "Adding…";
      fetch("/cart/add.js", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: variantId,
          quantity: 1,
          properties: { _upsell_discount: settings.discountPercent + "%" },
        }),
      })
        .then(function () {
          container.innerHTML = '<p class="ppu-success">✅ Added to your order! Check your email for confirmation.</p>';
        })
        .catch(function () {
          btn.disabled = false;
          btn.textContent = settings.buttonText || "Yes! Add to my order";
        });
    });

    document.getElementById("ppu-no-btn").addEventListener("click", function () {
      container.style.display = "none";
    });
  }
})();
