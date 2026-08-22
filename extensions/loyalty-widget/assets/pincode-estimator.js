(function () {
  "use strict";

  var root = document.getElementById("pincode-estimator");
  if (!root) return;

  var shopDomain = root.dataset.shopDomain;
  var CACHE_KEY  = "pe_last_pincode";

  // Appearance settings from the app's own settings page (not the theme
  // editor) — fetched once before the widget first renders. Falls back to
  // these defaults if the fetch fails or nothing's configured.
  var appearance = {
    headingText: "📦 Check Delivery & COD",
    bgColor: "",
    buttonColor: "",
    buttonTextColor: "",
    buttonSize: "medium",
    sectionWidth: "",
    sectionHeight: "",
  };

  function fetchAppearance() {
    return fetch("/apps/loyalty/pincode-settings")
      .then(function (r) {
        var ct = r.headers.get("content-type") || "";
        if (!ct.includes("application/json")) throw new Error("not json");
        return r.json();
      })
      .then(function (data) {
        if (!data || data.accessDenied) return;
        appearance = {
          headingText: data.headingText || appearance.headingText,
          bgColor: data.bgColor || "",
          buttonColor: data.buttonColor || "",
          buttonTextColor: data.buttonTextColor || "",
          buttonSize: data.buttonSize || "medium",
          sectionWidth: data.sectionWidth || "",
          sectionHeight: data.sectionHeight || "",
        };
      })
      .catch(function () {});
  }

  function esc(str) {
    if (!str) return "";
    var d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }

  function render() {
    var widget = document.createElement("div");
    widget.id = "pincode-estimator-widget";
    var extraVars = "";
    if (appearance.bgColor) extraVars += "--pe-bg:" + appearance.bgColor + ";";
    if (appearance.buttonColor) extraVars += "--pe-btn-bg:" + appearance.buttonColor + ";";
    if (appearance.buttonTextColor) extraVars += "--pe-btn-text:" + appearance.buttonTextColor + ";";
    if (appearance.sectionWidth) extraVars += "--pe-width:" + appearance.sectionWidth + ";";
    if (appearance.sectionHeight) extraVars += "--pe-height:" + appearance.sectionHeight + ";";
    widget.style.cssText = root.style.cssText + extraVars;
    widget.innerHTML =
      '<p class="pe-label">' + esc(appearance.headingText) + '</p>' +
      '<div class="pe-row">' +
        '<input class="pe-input" id="pe-input" type="tel" maxlength="6" placeholder="Enter Pincode" inputmode="numeric">' +
        '<button class="pe-btn pe-btn--' + (appearance.buttonSize || "medium") + '" id="pe-check-btn">Check</button>' +
      '</div>' +
      '<div class="pe-result" id="pe-result"></div>';

    // This is now a positionable app block — the merchant places #pincode-
    // estimator exactly where they want it via the theme editor's block
    // picker, so render the widget in place rather than guessing a spot.
    root.appendChild(widget);

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
          if (data.accessDenied) {
            result.innerHTML =
              '<span class="pe-access-denied">Access needed for Pincode Delivery Estimator. Contact the store for access.</span>';
            result.classList.add("pe-show");
            return;
          }
          try { localStorage.setItem(CACHE_KEY, code); } catch (e) {}
          if (!data.deliverable) {
            result.innerHTML =
              '<span class="pe-unavailable">❌ Delivery not available to ' + code + '</span>';
          } else {
            var days = "";
            if (data.minDays != null && data.maxDays != null) {
              days = data.minDays === data.maxDays
                ? data.minDays + " day" + (data.minDays === 1 ? "" : "s")
                : data.minDays + "-" + data.maxDays + " days";
            }
            var stateLabel = data.state ? " (" + esc(String(data.state)) + ")" : "";
            result.innerHTML =
              '<span class="pe-delivery">Yes! We deliver to ' + code + stateLabel + '.</span><br>' +
              (days ? '<span class="pe-days">🚚 Estimated delivery: ' + days + '</span><br>' : "") +
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

  fetchAppearance().then(render);
})();
