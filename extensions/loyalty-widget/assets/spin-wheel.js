/**
 * Spin the Wheel - 2-step flow:
 *   Step 1: User clicks SPIN → wheel animates → shows prize
 *   Step 2: User enters email → claims discount code
 */
(function () {
  "use strict";

  var container = document.getElementById("spin-wheel-app");
  if (!container) return;
  if (sessionStorage.getItem("sw_completed") === "1") return;

  var settings = null;
  var triggerBtn = null;
  var overlayEl = null;
  var spinToken = null;
  var wonPrize = null;

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
    var btnColor = esc(settings.triggerButtonColor || "#e91e63");
    return (
      '<div class="sw-modal">' +
        '<button class="sw-close" data-action="sw-close">✕</button>' +
        '<h2 class="sw-headline">' + esc(settings.headline) + '</h2>' +
        '<p class="sw-subtext">' + esc(settings.subtext) + '</p>' +
        '<div class="sw-wheel-wrap">' +
          '<div class="sw-pointer"></div>' +
          '<canvas class="sw-wheel-canvas" width="260" height="260"></canvas>' +
          '<div class="sw-center-dot"></div>' +
        '</div>' +
        // Step 1: Spin button (no email)
        '<div class="sw-step sw-step-spin">' +
          '<button class="sw-spin-btn" data-action="sw-spin" style="background:' + btnColor + '">' +
            '🎯 ' + esc(settings.buttonText || "Try My Luck") +
          '</button>' +
          '<p class="sw-error" style="display:none;"></p>' +
        '</div>' +
        // Step 2: Claim form (shown after spin)
        '<div class="sw-step sw-step-claim" style="display:none;">' +
          '<p class="sw-claim-label">Enter your email to claim your prize:</p>' +
          '<div class="sw-form">' +
            '<input type="email" class="sw-email" placeholder="Enter your email" />' +
            '<button class="sw-claim-btn" data-action="sw-claim" style="background:' + btnColor + '">Claim Prize 🎁</button>' +
          '</div>' +
          '<p class="sw-error-claim" style="display:none;"></p>' +
        '</div>' +
        // Result area (shown after claim)
        '<div class="sw-result" style="display:none;"></div>' +
      '</div>'
    );
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

      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, startAngle, endAngle);
      ctx.closePath();
      ctx.fillStyle = prizes[i].color || "#5C6AC4";
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.stroke();

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

    // Step 1: Spin
    var spinBtn = overlayEl.querySelector('[data-action="sw-spin"]');
    var errorEl = overlayEl.querySelector(".sw-error");

    spinBtn.addEventListener("click", function () {
      spinBtn.disabled = true;
      spinBtn.textContent = "Spinning...";
      errorEl.style.display = "none";

      fetch("/apps/loyalty/wheel-spin-preview?action=wheel-spin-preview")
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
            spinBtn.textContent = "🎯 " + esc(settings.buttonText || "Try My Luck");
            return;
          }
          spinToken = data.token;
          wonPrize = data.prize;
          animateWheel(data.prizeIndex);
        })
        .catch(function () {
          errorEl.textContent = "Something went wrong. Try again.";
          errorEl.style.display = "block";
          spinBtn.disabled = false;
          spinBtn.textContent = "🎯 " + esc(settings.buttonText || "Try My Luck");
        });
    });

    // Step 2: Claim
    var claimBtn = overlayEl.querySelector('[data-action="sw-claim"]');
    var emailInput = overlayEl.querySelector(".sw-email");
    var claimErrorEl = overlayEl.querySelector(".sw-error-claim");

    claimBtn.addEventListener("click", function () {
      var email = emailInput.value.trim();
      if (!email || !email.includes("@")) {
        claimErrorEl.textContent = "Please enter a valid email address.";
        claimErrorEl.style.display = "block";
        return;
      }
      claimBtn.disabled = true;
      claimBtn.textContent = "Claiming...";
      claimErrorEl.style.display = "none";

      var url = "/apps/loyalty/wheel-claim?action=wheel-claim" +
        "&email=" + encodeURIComponent(email) +
        "&token=" + encodeURIComponent(spinToken || "");

      fetch(url)
        .then(function (r) {
          var ct = r.headers.get("content-type") || "";
          if (!ct.includes("application/json")) throw new Error("Not JSON");
          return r.json();
        })
        .then(function (data) {
          if (data.error) {
            claimErrorEl.textContent = data.error;
            claimErrorEl.style.display = "block";
            claimBtn.disabled = false;
            claimBtn.textContent = "Claim Prize 🎁";
            return;
          }
          sessionStorage.setItem("sw_completed", "1");
          showFinalResult(data);
        })
        .catch(function () {
          claimErrorEl.textContent = "Something went wrong. Please try again.";
          claimErrorEl.style.display = "block";
          claimBtn.disabled = false;
          claimBtn.textContent = "Claim Prize 🎁";
        });
    });
  }

  function animateWheel(prizeIndex) {
    var canvas = overlayEl.querySelector(".sw-wheel-canvas");
    var numSlices = settings.prizes.length;
    var sliceAngle = 360 / numSlices;
    var targetSliceCenter = prizeIndex * sliceAngle + sliceAngle / 2;
    var spins = 5;
    var totalAngle = spins * 360 + (360 - targetSliceCenter);

    canvas.style.transform = "rotate(" + totalAngle + "deg)";

    setTimeout(function () {
      showClaimStep();
      if (triggerBtn) triggerBtn.style.display = "none";
    }, 4200);
  }

  function showClaimStep() {
    var stepSpin = overlayEl.querySelector(".sw-step-spin");
    var stepClaim = overlayEl.querySelector(".sw-step-claim");
    if (stepSpin) stepSpin.style.display = "none";

    if (wonPrize && wonPrize.discountType !== "no_prize") {
      // Show prize label above claim form
      var label = overlayEl.querySelector(".sw-claim-label");
      if (label) label.textContent = "🎉 You won " + esc(wonPrize.label) + "! Enter email to claim:";
      if (stepClaim) stepClaim.style.display = "block";
    } else {
      // "Try Again" — no email needed
      var resultArea = overlayEl.querySelector(".sw-result");
      resultArea.innerHTML = '<p class="sw-result-nope">😔 Better luck next time! Try again later.</p>';
      resultArea.style.display = "block";
    }
  }

  function showFinalResult(data) {
    var stepClaim = overlayEl.querySelector(".sw-step-claim");
    var resultArea = overlayEl.querySelector(".sw-result");
    if (stepClaim) stepClaim.style.display = "none";

    if (data.discountCode) {
      resultArea.innerHTML =
        '<p class="sw-result-text">🎉 ' + esc(data.prize ? data.prize.label : "Prize") + ' claimed!</p>' +
        '<p class="sw-result-label">Your discount code:</p>' +
        '<div class="sw-result-code">' + esc(data.discountCode) + '</div>' +
        '<a class="sw-result-apply" href="/discount/' + encodeURIComponent(data.discountCode) + '?redirect=/collections/all">Apply & Shop →</a>' +
        '<p class="sw-result-email-note">A copy has been sent to your email.</p>';
    } else {
      resultArea.innerHTML =
        '<p class="sw-result-text">🎉 ' + esc(data.prize ? data.prize.label : "Prize") + ' claimed!</p>' +
        '<p class="sw-result-label">Check your email — your prize is on its way!</p>';
    }
    resultArea.style.display = "block";
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
