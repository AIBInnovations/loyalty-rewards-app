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
    primaryColor: container.dataset.primaryColor || "#5C6AC4",
    position: container.dataset.position || "bottom-right",
    widgetTitle: container.dataset.widgetTitle || "Rewards",
  };

  // Apply custom color
  document.documentElement.style.setProperty("--loyalty-primary", config.primaryColor);

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
      state.isOpen = !state.isOpen;
      if (state.isOpen && state.loading) fetchBalance();
      render();
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
          ${state.loading ? '<div class="loyalty-loading">Loading...</div>' : renderTabContent()}
        </div>
      `;
    }

    container.appendChild(fab);
    container.appendChild(panel);

    // Attach event listeners
    attachEventListeners(panel);
  }

  function renderHeader() {
    return `
      <div class="loyalty-header">
        <p class="loyalty-header-title">${escapeHtml(config.widgetTitle)}</p>
        <div class="loyalty-header-balance">
          <span class="loyalty-header-points">${state.balance.toLocaleString("en-IN")}</span>
          <span class="loyalty-header-label">points</span>
        </div>
        <span class="loyalty-header-tier">${escapeHtml(state.tier)}</span>
        ${state.nextTier ? `<span class="loyalty-header-label" style="margin-left:8px;">${state.nextTier.pointsNeeded.toLocaleString("en-IN")} pts to ${escapeHtml(state.nextTier.name)}</span>` : ""}
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
      <div style="text-align:center; padding: 8px 0;">
        <p style="font-size:40px; font-weight:800; color:var(--loyalty-primary); margin:0;">
          ${state.balance.toLocaleString("en-IN")}
        </p>
        <p style="font-size:14px; color:var(--loyalty-text-light); margin:4px 0;">
          = ₹${state.balance.toLocaleString("en-IN")} in rewards
        </p>
      </div>

      ${state.nextTier ? `
        <div style="margin:16px 0;">
          <div style="display:flex; justify-content:space-between; font-size:12px; color:var(--loyalty-text-light); margin-bottom:4px;">
            <span>${escapeHtml(state.tier)}</span>
            <span>${escapeHtml(state.nextTier.name)}</span>
          </div>
          <div style="height:8px; background:#eee; border-radius:4px; overflow:hidden;">
            <div style="height:100%; width:${progress}%; background:var(--loyalty-primary); border-radius:4px; transition:width 0.5s;"></div>
          </div>
          <p style="font-size:11px; color:var(--loyalty-text-light); margin-top:4px; text-align:center;">
            ${state.nextTier.pointsNeeded.toLocaleString("en-IN")} more points to ${escapeHtml(state.nextTier.name)}
          </p>
        </div>
      ` : `
        <p style="text-align:center; font-size:13px; color:var(--loyalty-gold); margin-top:12px;">
          ⭐ You've reached the highest tier!
        </p>
      `}

      <div style="margin-top:16px;">
        <p style="font-size:12px; color:var(--loyalty-text-light);">
          Lifetime earned: <strong>${state.lifetimeEarned.toLocaleString("en-IN")}</strong> pts
        </p>
      </div>
    `;
  }

  // ─── Earn Tab ─────────────────────────────────────────────────

  function renderEarnTab() {
    const earningRate = state.settings?.earningRate || 10;
    return `
      <div class="loyalty-earn-item">
        <div class="loyalty-earn-icon">🛍️</div>
        <span class="loyalty-earn-desc">Make a purchase</span>
        <span class="loyalty-earn-pts">${earningRate}% back</span>
      </div>

      <div class="loyalty-earn-item">
        <div class="loyalty-earn-icon">👋</div>
        <span class="loyalty-earn-desc">Create an account</span>
        <span class="loyalty-earn-pts">Bonus pts</span>
      </div>

      <div class="loyalty-earn-item">
        <div class="loyalty-earn-icon">🎂</div>
        <span class="loyalty-earn-desc">Birthday reward</span>
        <span class="loyalty-earn-pts">Annual bonus</span>
      </div>

      <div class="loyalty-earn-item">
        <div class="loyalty-earn-icon">🔗</div>
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

    return state.rewards
      .map(
        (r) => `
        <div class="loyalty-reward-card">
          <div class="loyalty-reward-info">
            <p class="loyalty-reward-name">${escapeHtml(r.name)}</p>
            <p class="loyalty-reward-cost">
              ${r.pointsCost.toLocaleString("en-IN")} points
              ${r.discountType === "FIXED_AMOUNT" ? `• ₹${r.discountValue} off` : `• ${r.discountValue}% off`}
              ${r.minimumOrderAmount > 0 ? `• Min ₹${r.minimumOrderAmount}` : ""}
            </p>
          </div>
          <button
            class="loyalty-reward-btn ${r.canAfford ? "can-afford" : "cannot-afford"}"
            ${r.canAfford ? `data-action="redeem" data-reward-id="${r.id}"` : "disabled"}
          >
            ${r.canAfford ? "Redeem" : "Need more pts"}
          </button>
        </div>
      `,
      )
      .join("");
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
            <p class="loyalty-history-date">${new Date(t.date).toLocaleDateString("en-IN")}</p>
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
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
          <circle cx="24" cy="24" r="24" fill="#e8f5e9"/>
          <path d="M14 24L21 31L34 18" stroke="#28a745" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <h3>Reward Redeemed!</h3>
        <p style="font-size:13px; color:var(--loyalty-text-light);">Your discount code:</p>
        <div class="code">${escapeHtml(code)}</div>
        <div class="actions">
          <button class="primary" data-action="apply-code" data-code="${escapeHtml(code)}">
            Apply & Go to Cart
          </button>
          <button class="secondary" data-action="copy-code" data-code="${escapeHtml(code)}">
            Copy Code
          </button>
        </div>
        <button style="margin-top:12px; background:none; border:none; color:var(--loyalty-text-light); cursor:pointer; font-size:12px;" data-action="close-success">
          Continue browsing
        </button>
      </div>
    `;
  }

  // ─── Event Listeners ──────────────────────────────────────────

  function attachEventListeners(panel) {
    // Tab clicks
    panel.querySelectorAll("[data-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.activeTab = btn.dataset.tab;
        render();
      });
    });

    // Redeem clicks
    panel.querySelectorAll('[data-action="redeem"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        const rewardId = btn.dataset.rewardId;
        btn.disabled = true;
        btn.textContent = "...";
        redeemReward(rewardId);
      });
    });

    // Apply discount code -> navigate to /discount/CODE?redirect=/cart
    panel.querySelectorAll('[data-action="apply-code"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        const code = btn.dataset.code;
        window.location.href = `/discount/${encodeURIComponent(code)}?redirect=/cart`;
      });
    });

    // Copy discount code
    panel.querySelectorAll('[data-action="copy-code"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        const code = btn.dataset.code;
        navigator.clipboard.writeText(code).then(() => {
          btn.textContent = "Copied!";
          setTimeout(() => { btn.textContent = "Copy Code"; }, 2000);
        });
      });
    });

    // Close success overlay
    panel.querySelectorAll('[data-action="close-success"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        state.successOverlay = null;
        render();
      });
    });

    // Copy referral link
    panel.querySelectorAll('[data-action="copy-referral"]').forEach((btn) => {
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
    panel.querySelectorAll('[data-action="share"]').forEach((btn) => {
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
