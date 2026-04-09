/**
 * Spin the Wheel - Gamified email capture with CSS wheel animation
 */
(function () {
  "use strict";

  var container = document.getElementById("spin-wheel-app");
  if (!container) return;
  if (sessionStorage.getItem("sw_completed") === "1") return;

  var settings = null;
  var triggerBtn = null;
  var overlayEl = null;

  // Fetch settings
  fetch("/apps/loyalty/wheel-settings?t=" + Date.now())
    .then(function (r) {
      if (!r.ok) throw new Error("fail");
      var ct = r.headers.get("content-type") || "";
      if (!ct.includes("application/json")) throw new Error("Not JSON");
      return r.json();
    })
    .then(function (data) {
      if (!data.enabled || !data.prizes || !data.prizes.length) return;
      settings = data;
      createTrigger();
    })
    .catch(function () {});

  function createTrigger() {
    triggerBtn = document.createElement("button");
    triggerBtn.className = "sw-trigger";
    triggerBtn.textContent = settings.triggerButtonText || "🎰 Spin & Win";
    triggerBtn.style.background = settings.triggerButtonColor || "#e91e63";
    triggerBtn.addEventListener("click", openWheel);
    document.body.appendChild(triggerBtn);
  }

  function openWheel() {
    overlayEl = document.createElement("div");
    overlayEl.className = "sw-overlay";
    overlayEl.innerHTML = renderModal();
    document.body.appendChild(overlayEl);
    void overlayEl.offsetHeight;
    overlayEl.classList.add("open");
    drawWheel();
    attachHandlers();
  }

  function renderModal() {
    return '<div class="sw-modal">' +
      '<button class="sw-close" data-action="sw-close">✕</button>' +
      '<h2 class="sw-headline">' + esc(settings.headline) + '</h2>' +
      '<p class="sw-subtext">' + esc(settings.subtext) + '</p>' +
      '<div class="sw-wheel-wrap">' +
        '<div class="sw-pointer"></div>' +
        '<canvas class="sw-wheel-canvas" width="260" height="260"></canvas>' +
        '<div class="sw-center-dot"></div>' +
      '</div>' +
      '<div class="sw-form-area">' +
        '<div class="sw-form">' +
          '<input type="email" class="sw-email" placeholder="Enter your email" />' +
          '<button class="sw-spin-btn" data-action="sw-spin" style="background:' + esc(settings.triggerButtonColor) + '">' + esc(settings.buttonText) + '</button>' +
        '</div>' +
        '<p class="sw-error" style="display:none;"></p>' +
      '</div>' +
      '<div class="sw-result" style="display:none;"></div>' +
    '</div>';
  }

  function drawWheel() {
    var canvas = overlayEl.querySelector(".sw-wheel-canvas");
    if (!canvas) return;
    var ctx = canvas.getContext("2d");
    var prizes = settings.prizes;
    var numSlices = prizes.length;
    var sliceAngle = (2 * Math.PI) / numSlices;
    var cx = 130, cy = 130, radius = 125;

    for (var i = 0; i < numSlices; i++) {
      var startAngle = i * sliceAngle - Math.PI / 2;
      var endAngle = startAngle + sliceAngle;

      // Draw slice using color set in admin
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, startAngle, endAngle);
      ctx.closePath();
      ctx.fillStyle = prizes[i].color || "#5C6AC4";
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.stroke();

      // Draw text
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(startAngle + sliceAngle / 2);
      ctx.textAlign = "right";
      ctx.fillStyle = "#fff";
      ctx.font = "bold 11px sans-serif";
      ctx.shadowColor = "rgba(0,0,0,0.3)";
      ctx.shadowBlur = 2;
      ctx.fillText(prizes[i].label, radius - 10, 4);
      ctx.restore();
    }
  }

  function attachHandlers() {
    overlayEl.querySelector('[data-action="sw-close"]').addEventListener("click", closeWheel);
    overlayEl.addEventListener("click", function (e) { if (e.target === overlayEl) closeWheel(); });

    var spinBtn = overlayEl.querySelector('[data-action="sw-spin"]');
    var emailInput = overlayEl.querySelector(".sw-email");
    var errorEl = overlayEl.querySelector(".sw-error");

    spinBtn.addEventListener("click", function () {
      var email = emailInput.value.trim();
      if (!email || !email.includes("@")) {
        errorEl.textContent = "Please enter a valid email.";
        errorEl.style.display = "block";
        return;
      }
      spinBtn.disabled = true;
      errorEl.style.display = "none";

      // Server-side spin
      var url = "/apps/loyalty/wheel-spin?email=" + encodeURIComponent(email) + "&action=wheel-spin";
      fetch(url)
        .then(function (r) {
          var ct = r.headers.get("content-type") || "";
          if (!ct.includes("application/json")) throw new Error("Not JSON");
          return r.json();
        })
        .then(function (data) {
          if (data.error) {
            errorEl.textContent = data.error;
            errorEl.style.display = "block";
            spinBtn.disabled = false;
            return;
          }
          // Animate wheel to land on the winning slice
          animateWheel(data.prizeIndex, data);
        })
        .catch(function () {
          errorEl.textContent = "Something went wrong. Try again.";
          errorEl.style.display = "block";
          spinBtn.disabled = false;
        });
    });
  }

  function animateWheel(prizeIndex, data) {
    var canvas = overlayEl.querySelector(".sw-wheel-canvas");
    var numSlices = settings.prizes.length;
    var sliceAngle = 360 / numSlices;

    // Calculate the angle to land on the winning slice
    // The pointer is at top (0°). We need to rotate so the winning slice aligns with top.
    var targetSliceCenter = prizeIndex * sliceAngle + sliceAngle / 2;
    var spins = 5; // Full rotations for dramatic effect
    var totalAngle = spins * 360 + (360 - targetSliceCenter);

    canvas.style.transform = "rotate(" + totalAngle + "deg)";

    // Show result after animation
    setTimeout(function () {
      sessionStorage.setItem("sw_completed", "1");
      var formArea = overlayEl.querySelector(".sw-form-area");
      var resultArea = overlayEl.querySelector(".sw-result");
      if (formArea) formArea.style.display = "none";

      if (data.prize && data.prize.discountType !== "no_prize") {
        resultArea.innerHTML =
          '<p class="sw-result-text">🎉 You won ' + esc(data.prize.label) + '!</p>' +
          '<div class="sw-result-code">' + esc(data.discountCode) + '</div><br/>' +
          '<a class="sw-result-apply" href="/discount/' + encodeURIComponent(data.discountCode) + '?redirect=/">Apply & Shop →</a>';
      } else {
        resultArea.innerHTML =
          '<p class="sw-result-nope">😔 Better luck next time! Try again later.</p>';
      }
      resultArea.style.display = "block";

      // Hide trigger
      if (triggerBtn) triggerBtn.style.display = "none";
    }, 4200); // Match CSS transition duration
  }

  function closeWheel() {
    if (overlayEl) {
      overlayEl.classList.remove("open");
      setTimeout(function () {
        if (overlayEl && overlayEl.parentNode) overlayEl.parentNode.removeChild(overlayEl);
        overlayEl = null;
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
