(function () {
  "use strict";

  var root = document.getElementById("sticky-atc-bar");
  if (!root) return;

  var handle     = root.dataset.productHandle;
  var title      = root.dataset.productTitle;
  var image      = root.dataset.productImage;
  var variantId  = root.dataset.variantId;
  var moneyFmt   = root.dataset.moneyFormat;
  var position   = root.dataset.position || "bottom";
  var showMobile = root.dataset.showOnMobile !== "false";

  if (!showMobile && window.innerWidth <= 768) return;

  function formatMoney(cents) {
    return moneyFmt.replace("{{amount}}", (cents / 100).toFixed(2))
                   .replace("{{amount_no_decimals}}", Math.floor(cents / 100));
  }

  var bar = null;
  var addToCartBtn = null;
  var atcObserver  = null;
  var isAdding     = false;

  function render(price) {
    bar = document.createElement("div");
    bar.id = "sticky-atc-bar-rendered";
    bar.className = "satc-" + position;
    bar.style.cssText = root.style.cssText;
    bar.innerHTML =
      '<img class="satc-image" src="' + image + '" alt="' + title + '">' +
      '<div class="satc-info">' +
        '<p class="satc-title">' + title + '</p>' +
        '<p class="satc-price">' + formatMoney(price) + '</p>' +
      '</div>' +
      '<button class="satc-btn">Add to Cart</button>';
    document.body.appendChild(bar);

    bar.querySelector(".satc-btn").addEventListener("click", function () {
      if (isAdding) return;
      isAdding = true;
      this.textContent = "Adding…";
      this.disabled = true;
      var self = this;
      fetch("/cart/add.js", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: variantId, quantity: 1 }),
      })
        .then(function (r) { return r.json(); })
        .then(function () {
          self.textContent = "✓ Added!";
          setTimeout(function () {
            self.textContent = "Add to Cart";
            self.disabled = false;
            isAdding = false;
          }, 2000);
          document.dispatchEvent(new CustomEvent("cart:updated"));
        })
        .catch(function () {
          self.textContent = "Add to Cart";
          self.disabled = false;
          isAdding = false;
        });
    });
  }

  function observeNativeATC() {
    var atcForm = document.querySelector('form[action="/cart/add"]');
    if (!atcForm) return;

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!bar) return;
        if (entry.isIntersecting) {
          bar.classList.remove("satc-visible");
        } else {
          bar.classList.add("satc-visible");
        }
      });
    }, { threshold: 0.1 });

    io.observe(atcForm);
    atcObserver = io;

    var nativeBtn = atcForm.querySelector('[type="submit"]');
    if (nativeBtn) addToCartBtn = nativeBtn;
  }

  // Fetch product JSON for current price
  fetch("/products/" + handle + ".js")
    .then(function (r) { return r.json(); })
    .then(function (product) {
      var variant = product.variants.find(function (v) {
        return String(v.id) === String(variantId);
      }) || product.variants[0];
      render(variant.price);
      observeNativeATC();
    })
    .catch(function () {
      render(parseInt(root.dataset.productPrice || "0", 10));
      observeNativeATC();
    });
})();
