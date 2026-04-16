/**
 * Loyalty Rewards Widget - Vanilla JS
 * Renders a floating button + expandable panel on the storefront.
 * Communicates with the app via Shopify App Proxy (/apps/loyalty/*).
 */

(function () {
  "use strict";

  // ─── Read config from data attributes ─────────────────────────
  const container = document.getElementById("loyalty-rewards-app");
  if (!container) return;

  const config = {
    customerId: container.dataset.customerId,
    customerName: container.dataset.customerName,
    initialBalance: parseInt(container.dataset.pointsBalance) || 0,
    initialTier: container.dataset.tier || "Bronze",
    referralCode: container.dataset.referralCode || "",
    shopDomain: container.dataset.shopDomain,
    currency: container.dataset.currency || "INR",
    moneyFormat: container.dataset.moneyFormat || "₹{{amount}}",
    primaryColor: container.dataset.primaryColor || "#5C6AC4",
    position: container.dataset.position || "bottom-right",
    widgetTitle: container.dataset.widgetTitle || "Rewards",
  };

  // Apply primary color — CSS derives all tints via color-mix().
  // JS also sets explicit tints as fallback for older browsers without color-mix().
  function applyPrimaryColor(hex) {
    hex = hex && /^#[0-9A-Fa-f]{6}$/i.test(hex) ? hex : "#5C6AC4";
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const tint = (c, mix) => Math.round(c + (255 - c) * mix);
    const css = document.documentElement.style;
    css.setProperty("--loyalty-primary", hex);
    // Explicit fallbacks for browsers without color-mix() support
    css.setProperty("--loyalty-primary-light",  `rgb(${tint(r,.88)},${tint(g,.88)},${tint(b,.88)})`);
    css.setProperty("--loyalty-primary-medium", `rgb(${tint(r,.70)},${tint(g,.70)},${tint(b,.70)})`);
    css.setProperty("--loyalty-primary-track",  `rgb(${tint(r,.55)},${tint(g,.55)},${tint(b,.55)})`);
    css.setProperty("--loyalty-primary-shadow", `rgba(${r},${g},${b},0.4)`);
  }
  applyPrimaryColor(config.primaryColor);

  // ─── Money Formatter ──────────────────────────────────────────
  function formatMoney(value, formatOverride) {
    var format = formatOverride || config.moneyFormat || "₹{{amount}}";
    var amount = parseFloat(value) || 0;
    var formatted;
    if (format.indexOf("{{amount_no_decimals_with_comma_separator}}") !== -1) {
      formatted = Math.round(amount).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
      return format.replace("{{amount_no_decimals_with_comma_separator}}", formatted);
    }
    if (format.indexOf("{{amount_with_comma_separator}}") !== -1) {
      formatted = amount.toFixed(2).replace(".", ",");
      var parts = formatted.split(",");
      parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
      formatted = parts.join(",");
      return format.replace("{{amount_with_comma_separator}}", formatted);
    }
    if (format.indexOf("{{amount_no_decimals}}") !== -1) {
      formatted = Math.round(amount).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
      return format.replace("{{amount_no_decimals}}", formatted);
    }
    formatted = amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return format.replace("{{amount}}", formatted);
  }

  function formatPointsAsMoney(points, fallbackSymbol) {
    if (config.moneyFormat && config.moneyFormat !== "₹{{amount}}") {
      return formatMoney(points);
    }
    return (fallbackSymbol || "₹") + points.toLocaleString();
  }

  // ─── State ────────────────────────────────────────────────────
  let state = {
    isOpen: false,
    activeTab: "points",
    balance: config.initialBalance,
    tier: config.initialTier,
    lifetimeEarned: 0,
    referralCode: config.referralCode,
    nextTier: null,
    rewards: [],
    transactions: [],
    settings: null,
    loading: true,
    successOverlay: null, // { code: "LYL-xxx" } when redemption succeeds
  };

  // ─── API Calls (via App Proxy) ────────────────────────────────

  const proxyBase = "/apps/loyalty";

  async function fetchBalance() {
    try {
      const res = await fetch(`${proxyBase}/balance`);
      if (!res.ok) throw new Error("Failed to fetch balance");
      // App proxy returns HTML redirect page, check if it's JSON
      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        throw new Error("App proxy not configured - using initial data");
      }
      const data = await res.json();

      state.balance = data.balance;
      state.tier = data.tier;
      state.lifetimeEarned = data.lifetimeEarned;
      state.referralCode = data.referralCode || config.referralCode;
      state.nextTier = data.nextTier;
      state.rewards = data.rewards || [];
      state.transactions = data.transactions || [];
      state.settings = data.settings;
      state.loading = false;
      render();
    } catch (err) {
      console.warn("Loyalty widget: using cached data from metafields.", err.message);
      // Fallback: use the initial data from metafields (data-* attributes)
      state.balance = config.initialBalance;
      state.tier = config.initialTier;
      state.referralCode = config.referralCode;
      state.loading = false;
      render();
    }
  }

  async function redeemReward(rewardId) {
    try {
      // Use GET with query params instead of POST — Shopify App Proxy
      // doesn't reliably forward POST JSON bodies
      const res = await fetch(`${proxyBase}/redeem?rewardId=${encodeURIComponent(rewardId)}&action=redeem`);

      const text = await res.text();
      console.log("Redeem response:", text);

      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        // App proxy might wrap response - try to extract JSON from it
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          data = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error("Invalid response from server");
        }
      }

      if (data.success) {
        state.balance = data.newBalance;
        state.successOverlay = { code: data.discountCode };
        state.isOpen = true; // Keep panel open to show success overlay
        render();
        // Refresh full data after a delay
        setTimeout(fetchBalance, 3000);
      } else {
        alert(data.error || "Redemption failed");
      }
    } catch (err) {
      console.error("Redeem error:", err);
      alert("Something went wrong. Please try again.");
    }
  }

  async function recordSocialShare(platform) {
    try {
      const res = await fetch(`${proxyBase}/social-share?platform=${encodeURIComponent(platform)}&action=social-share`);
      const data = await res.json();
      if (data.success && data.pointsEarned) {
        state.balance = data.newBalance;
        render();
      }
    } catch (err) {
      // Silent fail for social share
    }
  }

  async function recordReferral(code) {
    try {
      const res = await fetch(`${proxyBase}/referral?referralCode=${encodeURIComponent(code)}&action=referral`);
      return await res.json();
    } catch (err) {
      return { error: "Failed to record referral" };
    }
  }

  // ─── Check for referral code in URL ───────────────────────────
  const urlParams = new URLSearchParams(window.location.search);
  const refCode = urlParams.get("ref");
  if (refCode) {
    localStorage.setItem("loyalty_referral", refCode);
  }
  const storedRef = localStorage.getItem("loyalty_referral");
  if (storedRef && config.customerId) {
    recordReferral(storedRef).then((result) => {
      if (result.success) {
        localStorage.removeItem("loyalty_referral");
      }
    });
  }

  // ─── Icons ────────────────────────────────────────────────────

  const icons = {
    trophy: `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 15c-3.314 0-6-2.686-6-6V3h12v6c0 3.314-2.686 6-6 6z" fill="#FFB800" fill-opacity="0.25" stroke="#FFB800" stroke-width="1.8" stroke-linejoin="round"/><path d="M6 5H3.5a1.5 1.5 0 0 0 0 3H6M18 5h2.5a1.5 1.5 0 0 1 0 3H18" stroke="#FFB800" stroke-width="1.8" stroke-linecap="round"/><path d="M12 15v4M9 19h6" stroke="#FFB800" stroke-width="1.8" stroke-linecap="round"/><path d="M8 21h8" stroke="#FFB800" stroke-width="2" stroke-linecap="round"/><path d="M10 8l1.5 1.5L14 6.5" stroke="#FFB800" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    trophySmall: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 15c-3.314 0-6-2.686-6-6V3h12v6c0 3.314-2.686 6-6 6z" fill="currentColor" fill-opacity="0.2" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M6 5H3.5a1.5 1.5 0 0 0 0 3H6M18 5h2.5a1.5 1.5 0 0 1 0 3H18M12 15v4M9 19h6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
    medal: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="6"/><path d="M8.21 13.89L7 23l5-3 5 3-1.21-9.12"/></svg>`,
    star: `<svg width="15" height="15" viewBox="0 0 24 24" fill="#FFB800" stroke="#FFB800" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
    bag: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>`,
    user: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
    gift: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg>`,
    share: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>`,
    check: `<svg width="48" height="48" viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="24" fill="#e8f5e9"/><path d="M14 24L21 31L34 18" stroke="#28a745" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  };

  // ─── Render ───────────────────────────────────────────────────

  function render() {
    container.innerHTML = "";
    container.style.display = "block";

    // FAB button
    const fab = document.createElement("button");
    fab.className = `loyalty-fab ${config.position}`;
    fab.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/>
      </svg>
      <span class="loyalty-fab-badge">${state.balance}</span>
    `;
    fab.addEventListener("click", () => {
      if (state.isOpen) {
        panel.classList.add("closing");
        setTimeout(() => { state.isOpen = false; render(); }, 220);
      } else {
        state.isOpen = true;
        if (state.loading) fetchBalance();
        render();
      }
    });

    // Panel
    const panel = document.createElement("div");
    panel.className = `loyalty-panel ${config.position} ${state.isOpen ? "open" : ""}`;

    if (state.successOverlay) {
      panel.innerHTML = renderSuccessOverlay(state.successOverlay.code);
    } else {
      panel.innerHTML = `
        ${renderHeader()}
        ${renderTabs()}
        <div class="loyalty-content">
          ${state.loading ? '<div class="loyalty-loading">Loading...</div>' : `<div class="loyalty-tab-anim">${renderTabContent()}</div>`}
        </div>
      `;
    }

    container.appendChild(fab);
    container.appendChild(panel);

    // Attach event listeners
    attachEventListeners(panel);

    // Trigger entrance animations
    initAnimations();
  }

  function renderHeader() {
    const tierIcon = icons.medal;
    return `
      <div class="loyalty-header">
        <p class="loyalty-header-section-label">Your Rewards Balance</p>
        <div class="loyalty-header-card">
          <div class="loyalty-header-points-row">
            <span class="loyalty-header-trophy">${icons.trophy}</span>
            <span class="loyalty-header-points" data-count-up="${state.balance}">0</span>
            <span class="loyalty-header-pts-label">pts</span>
          </div>
          <a class="loyalty-header-link" href="#">How do points work? →</a>
          <hr class="loyalty-header-divider">
          <div class="loyalty-header-info">
            <span class="loyalty-tier-badge">${tierIcon} ${escapeHtml(state.tier)}</span>
            <span>${state.nextTier ? `${state.nextTier.pointsNeeded.toLocaleString()} pts to ${escapeHtml(state.nextTier.name)}` : "Top tier reached!"}</span>
          </div>
        </div>
      </div>
    `;
  }

  function renderTabs() {
    const tabs = [
      { id: "points", label: "My Points" },
      { id: "earn", label: "Earn" },
      { id: "redeem", label: "Redeem" },
      { id: "history", label: "History" },
    ];
    return `
      <div class="loyalty-tabs">
        ${tabs.map((t) => `<button class="loyalty-tab ${state.activeTab === t.id ? "active" : ""}" data-tab="${t.id}">${t.label}</button>`).join("")}
      </div>
    `;
  }

  function renderTabContent() {
    switch (state.activeTab) {
      case "points": return renderPointsTab();
      case "earn": return renderEarnTab();
      case "redeem": return renderRedeemTab();
      case "history": return renderHistoryTab();
      default: return "";
    }
  }

  // ─── Points Tab ───────────────────────────────────────────────

  function renderPointsTab() {
    const progress = state.nextTier
      ? Math.min(100, ((state.lifetimeEarned / (state.lifetimeEarned + state.nextTier.pointsNeeded)) * 100))
      : 100;

    return `
      <div class="loyalty-points-hero">
        <p class="loyalty-points-hero-label">Available Balance</p>
        <div>
          <span class="loyalty-points-hero-number" data-count-up="${state.balance}">0</span>
          <span class="loyalty-points-hero-unit">pts</span>
        </div>
        <p class="loyalty-points-hero-value">≈ ${formatPointsAsMoney(state.balance, state.settings?.currencySymbol)} in rewards</p>
      </div>

      ${state.nextTier ? `
        <div class="loyalty-progress-wrap">
          <div class="loyalty-progress-labels">
            <span>${escapeHtml(state.tier)}</span>
            <span>${escapeHtml(state.nextTier.name)}</span>
          </div>
          <div class="loyalty-progress-track">
            <div class="loyalty-progress-fill" style="width:0%" data-progress="${progress}"></div>
          </div>
          <p class="loyalty-progress-hint">${state.nextTier.pointsNeeded.toLocaleString()} more pts to unlock <strong>${escapeHtml(state.nextTier.name)}</strong></p>
        </div>
      ` : `
        <div class="loyalty-progress-wrap" style="text-align:center;">
          <span style="font-size:13px; font-weight:700; color:var(--loyalty-gold); display:inline-flex; align-items:center; gap:6px;">${icons.star} You've reached the highest tier!</span>
        </div>
      `}

      <div class="loyalty-lifetime-stat">
        <span>Lifetime earned</span>
        <span>${state.lifetimeEarned.toLocaleString()} pts</span>
      </div>
    `;
  }

  // ─── Earn Tab ─────────────────────────────────────────────────

  function renderEarnTab() {
    const earningRate = state.settings?.earningRate || 10;
    return `
      <div class="loyalty-earn-item">
        <div class="loyalty-earn-icon">${icons.bag}</div>
        <span class="loyalty-earn-desc">Make a purchase</span>
        <span class="loyalty-earn-pts">${earningRate}% back</span>
      </div>

      <div class="loyalty-earn-item">
        <div class="loyalty-earn-icon">${icons.user}</div>
        <span class="loyalty-earn-desc">Create an account</span>
        <span class="loyalty-earn-pts">Bonus pts</span>
      </div>

      <div class="loyalty-earn-item">
        <div class="loyalty-earn-icon">${icons.gift}</div>
        <span class="loyalty-earn-desc">Birthday reward</span>
        <span class="loyalty-earn-pts">Annual bonus</span>
      </div>

      <div class="loyalty-earn-item">
        <div class="loyalty-earn-icon">${icons.share}</div>
        <span class="loyalty-earn-desc">Refer a friend</span>
        <span class="loyalty-earn-pts">Both earn!</span>
      </div>

      ${state.referralCode ? `
        <div class="loyalty-referral-box">
          <p>Share your referral link:</p>
          <div class="loyalty-referral-link">
            <input type="text" readonly value="https://${escapeHtml(config.shopDomain)}?ref=${escapeHtml(state.referralCode)}" id="loyalty-ref-input" />
            <button data-action="copy-referral">Copy</button>
          </div>
        </div>
      ` : ""}

      <div style="margin-top:16px;">
        <p style="font-size:13px; font-weight:600; margin-bottom:8px;">Share & Earn</p>
        <div class="loyalty-share-btns">
          <button class="loyalty-share-btn" data-action="share" data-platform="whatsapp">WhatsApp</button>
          <button class="loyalty-share-btn" data-action="share" data-platform="facebook">Facebook</button>
          <button class="loyalty-share-btn" data-action="share" data-platform="twitter">Twitter</button>
          <button class="loyalty-share-btn" data-action="share" data-platform="copy">Copy</button>
        </div>
      </div>
    `;
  }

  // ─── Redeem Tab ───────────────────────────────────────────────

  function renderRedeemTab() {
    if (!state.rewards.length) {
      return '<p style="text-align:center; color:var(--loyalty-text-light); padding:20px;">No rewards available yet.</p>';
    }

    const available = state.rewards.filter((r) => r.canAfford);
    const upcoming = state.rewards.filter((r) => !r.canAfford);

    let html = "";
    if (available.length) {
      html += '<p class="loyalty-section-label">AVAILABLE</p>';
      html += available.map((r, i) => renderRewardCard(r, i)).join("");
    }
    if (upcoming.length) {
      html += `<p class="loyalty-section-label"${available.length ? ' style="margin-top:16px;"' : ""}>UPCOMING</p>`;
      html += upcoming.map((r, i) => renderRewardCard(r, available.length + i)).join("");
    }
    return html;
  }

  function renderRewardCard(r, index = 0) {
    const discountDisplay = r.discountType === "FIXED_AMOUNT"
      ? formatPointsAsMoney(r.discountValue, state.settings?.currencySymbol)
      : `${r.discountValue}% off`;
    const dotColors = ["#4DA6E8", "#FF6B35", "#A855F7", "#10B981", "#F59E0B", "#EC4899"];
    const dotColor = dotColors[(r.pointsCost || 0) % dotColors.length];
    const pointsNeeded = Math.max(0, r.pointsCost - state.balance);
    const desc = r.canAfford
      ? `Redeem this reward for ${r.pointsCost.toLocaleString()} points`
      : `Earn ${pointsNeeded.toLocaleString()} more points to redeem this reward.`;

    return `
      <div class="loyalty-reward-card" style="animation-delay:${index * 0.07}s">
        <div class="loyalty-reward-card-top">
          <span class="loyalty-reward-points-badge">${icons.trophySmall} ${r.pointsCost.toLocaleString()} points</span>
          ${r.pointsCost !== 200 ? `<span class="loyalty-reward-dot" style="background:${dotColor};"></span>` : ""}
        </div>
        <p class="loyalty-reward-amount">${escapeHtml(discountDisplay)}</p>
        <p class="loyalty-reward-desc">${escapeHtml(desc)}${r.minimumOrderAmount > 0 ? ` • Min ${formatPointsAsMoney(r.minimumOrderAmount, state.settings?.currencySymbol)}` : ""}</p>
        <button
          class="loyalty-reward-btn ${r.canAfford ? "can-afford" : "cannot-afford"}"
          ${r.canAfford ? `data-action="redeem" data-reward-id="${r.id}"` : "disabled"}
        >
          See reward
        </button>
      </div>
    `;
  }

  // ─── History Tab ──────────────────────────────────────────────

  function renderHistoryTab() {
    if (!state.transactions.length) {
      return '<p style="text-align:center; color:var(--loyalty-text-light); padding:20px;">No activity yet.</p>';
    }

    return state.transactions
      .map(
        (t) => `
        <div class="loyalty-history-item">
          <div>
            <p class="loyalty-history-desc">${escapeHtml(t.description || t.source)}</p>
            <p class="loyalty-history-date">${new Date(t.date).toLocaleDateString()}</p>
          </div>
          <span class="loyalty-history-pts ${t.points > 0 ? "positive" : "negative"}">
            ${t.points > 0 ? "+" : ""}${t.points}
          </span>
        </div>
      `,
      )
      .join("");
  }

  // ─── Success Overlay ──────────────────────────────────────────

  function renderSuccessOverlay(code) {
    return `
      <div class="loyalty-success-overlay">
        <svg width="60" height="60" viewBox="0 0 60 60" fill="none">
          <circle cx="30" cy="30" r="30" fill="rgba(212,168,67,0.12)"/>
          <circle cx="30" cy="30" r="22" fill="rgba(212,168,67,0.18)" stroke="rgba(212,168,67,0.4)" stroke-width="1"/>
          <path d="M20 30L27 37L40 24" stroke="#FFB800" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <h3>Reward Redeemed!</h3>
        <p class="sub">Your discount code:</p>
        <div class="code">${escapeHtml(code)}</div>
        <div class="actions">
          <button class="primary" data-action="apply-code" data-code="${escapeHtml(code)}">
            Apply &amp; Go to Cart
          </button>
          <button class="secondary" data-action="copy-code" data-code="${escapeHtml(code)}">
            Copy Code
          </button>
        </div>
        <button style="margin-top:14px;background:none;border:none;color:rgba(255,255,255,0.35);cursor:pointer;font-size:12px;font-weight:500;" data-action="close-success">
          Continue browsing
        </button>
      </div>
    `;
  }

  // ─── Event Listeners ──────────────────────────────────────────

  function attachEventListeners(panel) {
    // Tab clicks — only swap content, keep panel fixed
    panel.querySelectorAll("[data-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (state.activeTab === btn.dataset.tab) return;
        state.activeTab = btn.dataset.tab;

        // Update active class on tabs only
        panel.querySelectorAll("[data-tab]").forEach((b) => {
          b.classList.toggle("active", b.dataset.tab === state.activeTab);
        });

        // Swap only the content area
        const content = panel.querySelector(".loyalty-content");
        if (content) {
          content.innerHTML = `<div class="loyalty-tab-anim">${renderTabContent()}</div>`;
          initAnimations(content);
          attachContentListeners(content, panel);
        }
      });
    });

    attachContentListeners(panel, panel);
  }

  function attachContentListeners(root, panel) {
    // Redeem clicks
    root.querySelectorAll('[data-action="redeem"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        const rewardId = btn.dataset.rewardId;
        btn.disabled = true;
        btn.textContent = "...";
        redeemReward(rewardId);
      });
    });

    // Apply discount code -> navigate to /discount/CODE?redirect=/cart
    root.querySelectorAll('[data-action="apply-code"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        const code = btn.dataset.code;
        window.location.href = `/discount/${encodeURIComponent(code)}?redirect=/cart`;
      });
    });

    // Copy discount code
    root.querySelectorAll('[data-action="copy-code"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        const code = btn.dataset.code;
        navigator.clipboard.writeText(code).then(() => {
          btn.textContent = "Copied!";
          setTimeout(() => { btn.textContent = "Copy Code"; }, 2000);
        });
      });
    });

    // Close success overlay
    root.querySelectorAll('[data-action="close-success"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        state.successOverlay = null;
        render();
      });
    });

    // Copy referral link
    root.querySelectorAll('[data-action="copy-referral"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        const input = document.getElementById("loyalty-ref-input");
        if (input) {
          navigator.clipboard.writeText(input.value).then(() => {
            btn.textContent = "Copied!";
            setTimeout(() => { btn.textContent = "Copy"; }, 2000);
          });
        }
      });
    });

    // Social share
    root.querySelectorAll('[data-action="share"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        const platform = btn.dataset.platform;
        const shareUrl = `https://${config.shopDomain}?ref=${state.referralCode}`;
        const shareText = `Check out this store! Use my referral code: ${state.referralCode}`;

        switch (platform) {
          case "whatsapp":
            window.open(`https://wa.me/?text=${encodeURIComponent(shareText + " " + shareUrl)}`);
            break;
          case "facebook":
            window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`);
            break;
          case "twitter":
            window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`);
            break;
          case "copy":
            navigator.clipboard.writeText(shareUrl);
            btn.textContent = "Copied!";
            setTimeout(() => { btn.textContent = "Copy"; }, 2000);
            break;
        }

        // Record the share for bonus points
        recordSocialShare(platform);
      });
    });
  }

  // ─── Animation Helpers ────────────────────────────────────────

  function animateCount(el, target, duration) {
    duration = duration || 900;
    const start = performance.now();
    (function tick(now) {
      const p = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(2, -10 * p);
      el.textContent = Math.round(eased * target).toLocaleString();
      if (p < 1) requestAnimationFrame(tick);
    })(start);
  }

  function initAnimations(root) {
    root = root || container;
    // Count-up for all [data-count-up] elements
    root.querySelectorAll("[data-count-up]").forEach(function(el) {
      animateCount(el, parseInt(el.dataset.countUp, 10) || 0);
    });
    // Animate progress bar fill
    root.querySelectorAll("[data-progress]").forEach(function(el) {
      requestAnimationFrame(function() {
        el.style.width = el.dataset.progress + "%";
      });
    });
  }

  // ─── Helpers ──────────────────────────────────────────────────

  function escapeHtml(str) {
    if (!str) return "";
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // ─── Initialize ───────────────────────────────────────────────
  render();

  // Pre-fetch balance when page loads (not just on widget open)
  // This keeps the fab badge up to date
  fetchBalance();
})();
