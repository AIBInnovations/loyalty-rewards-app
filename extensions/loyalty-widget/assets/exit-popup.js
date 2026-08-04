/**
 * Exit-Intent Popup - Detects exit intent and shows discount popup
 */
(function () {
  "use strict";

  var container = document.getElementById("exit-popup-app");
  if (!container) return;
  if (sessionStorage.getItem("ep_shown") === "1") return;

  var settings = null;
  var overlayEl = null;
  var ready = false;
  var pageLoadTime = Date.now();

  // Fetch settings
  fetch("/apps/loyalty/popup-settings")
    .then(function (r) {
      if (!r.ok) throw new Error("fail");
      var ct = r.headers.get("content-type") || "";
      if (!ct.includes("application/json")) throw new Error("Not JSON");
      return r.json();
    })
    .then(function (data) {
      if (data.accessDenied) {
        container.innerHTML =
          '<div class="ep-access-denied">Access needed for Exit Popup. Contact the store for access.</div>';
        return;
      }
      if (!data.enabled) return;
      settings = data;
      ready = true;
      startListening();
    })
    .catch(function () {});

  function startListening() {
    var delay = (settings.delaySeconds || 5) * 1000;

    // Desktop: mouseleave on top of viewport
    document.addEventListener("mouseleave", function (e) {
      if (e.clientY > 0) return; // Only trigger when mouse goes to top (close/back)
      if (Date.now() - pageLoadTime < delay) return;
      showPopup();
    });

    // Mobile: detect back-button intent (rapid scroll up)
    if (settings.showOnMobile) {
      var lastScroll = 0;
      var scrollUpCount = 0;
      window.addEventListener("scroll", function () {
        var curr = window.scrollY;
        if (curr < lastScroll && lastScroll - curr > 50) {
          scrollUpCount++;
          if (scrollUpCount >= 3 && Date.now() - pageLoadTime > delay) {
            showPopup();
          }
        } else {
          scrollUpCount = 0;
        }
        lastScroll = curr;
      }, { passive: true });
    }
  }

  function showPopup() {
    if (!ready || !settings) return;
    if (sessionStorage.getItem("ep_shown") === "1") return;
    sessionStorage.setItem("ep_shown", "1");

    overlayEl = document.createElement("div");
    overlayEl.className = "ep-overlay";
    overlayEl.innerHTML = renderPopup();
    document.body.appendChild(overlayEl);

    // Force reflow then open
    void overlayEl.offsetHeight;
    overlayEl.classList.add("open");

    attachHandlers();
  }

  function renderPopup() {
    var discountText = settings.discountType === "percentage"
      ? settings.discountValue + "% OFF"
      : "₹" + settings.discountValue + " OFF";

    return '<div class="ep-modal" style="--ep-bg:' + esc(settings.bgColor) + ';--ep-accent:' + esc(settings.accentColor) + ';">' +
      '<button class="ep-close" data-action="ep-close">✕</button>' +
      '<h2 class="ep-headline">' + esc(settings.headline) + '</h2>' +
      '<p class="ep-subtext">' + esc(settings.subtext) + '</p>' +
      '<div class="ep-discount-badge">' + discountText + '</div>' +
      '<div class="ep-form-container">' +
        '<div class="ep-form">' +
          '<input type="email" class="ep-email" placeholder="Enter your email" />' +
          '<button class="ep-submit" data-action="ep-submit">' + esc(settings.buttonText) + '</button>' +
        '</div>' +
        '<p class="ep-error" style="display:none;"></p>' +
      '</div>' +
      '<div class="ep-success" style="display:none;"></div>' +
      '<button class="ep-skip" data-action="ep-close">No thanks, I\'ll pay full price</button>' +
    '</div>';
  }

  function attachHandlers() {
    // Close
    overlayEl.querySelectorAll('[data-action="ep-close"]').forEach(function (b) {
      b.addEventListener("click", closePopup);
    });
    overlayEl.addEventListener("click", function (e) {
      if (e.target === overlayEl) closePopup();
    });

    // Submit
    var submitBtn = overlayEl.querySelector('[data-action="ep-submit"]');
    var emailInput = overlayEl.querySelector(".ep-email");
    var errorEl = overlayEl.querySelector(".ep-error");

    if (submitBtn && emailInput) {
      submitBtn.addEventListener("click", function () {
        var email = emailInput.value.trim();
        if (!email || !email.includes("@")) {
          errorEl.textContent = "Please enter a valid email.";
          errorEl.style.display = "block";
          return;
        }
        submitBtn.disabled = true;
        submitBtn.textContent = "...";
        errorEl.style.display = "none";

        var url = "/apps/loyalty/popup-submit?email=" + encodeURIComponent(email) + "&action=popup-submit";
        fetch(url)
          .then(function (r) {
            var ct = r.headers.get("content-type") || "";
            if (!ct.includes("application/json")) throw new Error("Not JSON");
            return r.json();
          })
          .then(function (data) {
            if (data.success && data.discountCode) {
              var formContainer = overlayEl.querySelector(".ep-form-container");
              var successEl = overlayEl.querySelector(".ep-success");
              var skipBtn = overlayEl.querySelector(".ep-skip");
              if (formContainer) formContainer.style.display = "none";
              if (skipBtn) skipBtn.style.display = "none";
              if (successEl) {
                successEl.style.display = "block";
                successEl.innerHTML =
                  '<p class="ep-success-msg">' + esc(settings.successMessage) + '</p>' +
                  '<div class="ep-code">' + esc(data.discountCode) + '</div><br/>' +
                  '<a class="ep-apply-btn" href="/discount/' + encodeURIComponent(data.discountCode) + '?redirect=/">Apply & Shop →</a>';
              }
            } else {
              errorEl.textContent = data.error || "Something went wrong.";
              errorEl.style.display = "block";
              submitBtn.disabled = false;
              submitBtn.textContent = settings.buttonText;
            }
          })
          .catch(function () {
            errorEl.textContent = "Something went wrong. Try again.";
            errorEl.style.display = "block";
            submitBtn.disabled = false;
            submitBtn.textContent = settings.buttonText;
          });
      });
    }
  }

  function closePopup() {
    if (overlayEl) {
      overlayEl.classList.remove("open");
      setTimeout(function () {
        if (overlayEl && overlayEl.parentNode) overlayEl.parentNode.removeChild(overlayEl);
      }, 300);
    }
  }

  function esc(s) {
    if (!s) return "";
    var d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }
})();
