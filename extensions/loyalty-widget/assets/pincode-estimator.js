(function () {
  "use strict";

  var root = document.getElementById("pincode-estimator");
  if (!root) return;

  var shopDomain = root.dataset.shopDomain;
  var CACHE_KEY  = "pe_last_pincode";

  function render() {
    var widget = document.createElement("div");
    widget.id = "pincode-estimator-widget";
    widget.style.cssText = root.style.cssText;
    widget.innerHTML =
      '<p class="pe-label">📦 Check Delivery &amp; COD</p>' +
      '<div class="pe-row">' +
        '<input class="pe-input" id="pe-input" type="tel" maxlength="6" placeholder="Enter Pincode" inputmode="numeric">' +
        '<button class="pe-btn" id="pe-check-btn">Check</button>' +
      '</div>' +
      '<div class="pe-result" id="pe-result"></div>';
    root.parentNode.insertBefore(widget, root.nextSibling);

    var input   = document.getElementById("pe-input");
    var btn     = document.getElementById("pe-check-btn");
    var result  = document.getElementById("pe-result");

    // Restore last searched pincode
    var saved = "";
    try { saved = localStorage.getItem(CACHE_KEY) || ""; } catch (e) {}
    if (saved) { input.value = saved; }

    function check() {
      var code = input.value.trim();
      if (!/^\d{6}$/.test(code)) {
        result.innerHTML = '<span class="pe-error">Please enter a valid 6-digit pincode.</span>';
        result.classList.add("pe-show");
        return;
      }
      btn.disabled = true;
      btn.textContent = "Checking…";
      result.classList.remove("pe-show");

      fetch("/apps/loyalty/pincode?code=" + code, {
        headers: { "Content-Type": "application/json" },
      })
        .then(function (r) {
          var ct = r.headers.get("content-type") || "";
          if (!ct.includes("application/json")) throw new Error("proxy");
          return r.json();
        })
        .then(function (data) {
          try { localStorage.setItem(CACHE_KEY, code); } catch (e) {}
          if (!data.deliverable) {
            result.innerHTML =
              '<span class="pe-unavailable">❌ Delivery not available to ' + code + '</span>';
          } else {
            var today    = new Date();
            var minDate  = new Date(today); minDate.setDate(today.getDate() + data.minDays);
            var maxDate  = new Date(today); maxDate.setDate(today.getDate() + data.maxDays);
            var opts     = { month: "short", day: "numeric" };
            var dateStr  = minDate.toLocaleDateString("en-IN", opts) + " – " + maxDate.toLocaleDateString("en-IN", opts);
            result.innerHTML =
              '<span class="pe-delivery">🚚 Delivery by ' + dateStr + '</span><br>' +
              (data.cod
                ? '<span class="pe-cod-yes">✓ COD Available</span>'
                : '<span class="pe-cod-no">✗ COD Not Available — Prepaid Only</span>');
          }
          result.classList.add("pe-show");
        })
        .catch(function () {
          result.innerHTML = '<span class="pe-error">Could not check pincode. Please try again.</span>';
          result.classList.add("pe-show");
        })
        .finally(function () {
          btn.disabled = false;
          btn.textContent = "Check";
        });
    }

    btn.addEventListener("click", check);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") check();
    });
  }

  render();
})();
