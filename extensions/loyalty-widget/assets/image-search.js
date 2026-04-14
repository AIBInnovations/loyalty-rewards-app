(function () {
  "use strict";

  // ── Bootstrap ───────────────────────────────────────────────────
  var root = document.getElementById("is-root");
  if (!root) return;

  var shopDomain = root.dataset.shopDomain || "";
  var customerId = root.dataset.customerId || "";
  var proxyBase = "/apps/loyalty";

  // Generate a session ID for analytics (anonymous, in-memory only)
  var sessionId = (
    Math.random().toString(36).slice(2) +
    Date.now().toString(36)
  ).slice(0, 16);

  // ── State ────────────────────────────────────────────────────────
  var state = {
    phase: "idle", // idle | searching | results | error
    config: null,
    previewUrl: null,
    previewFile: null,
    results: [],
    searchId: null,
    errorMessage: "",
    modalOpen: false,
  };

  // ── Load Config ──────────────────────────────────────────────────
  fetch(proxyBase + "/image-search/config")
    .then(function (r) { return r.json(); })
    .then(function (cfg) {
      if (!cfg || !cfg.enabled) return;
      state.config = cfg;
      renderFAB();
    })
    .catch(function () { /* silent — don't break other widgets */ });

  // ── FAB (Floating Action Button) ─────────────────────────────────
  function renderFAB() {
    var btn = document.createElement("button");
    btn.className = "is-fab";
    btn.setAttribute("aria-label", state.config.buttonText || "Find Similar Products");
    btn.title = state.config.buttonText || "Find Similar Products";
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
        '<path d="M9 3L7.17 5H4C2.9 5 2 5.9 2 7v13c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2h-3.17L15 3H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z" fill="white"/>' +
        '<circle cx="12" cy="13" r="3" fill="white"/>' +
      '</svg>';

    // Apply primary color from config
    if (state.config.primaryColor) {
      btn.style.background = state.config.primaryColor;
    }

    btn.addEventListener("click", openModal);
    document.body.appendChild(btn);
  }

  // ── Modal ────────────────────────────────────────────────────────
  var overlayEl = null;

  function openModal() {
    if (overlayEl) return;
    state.modalOpen = true;
    state.phase = "idle";
    state.previewUrl = null;
    state.previewFile = null;
    state.results = [];
    state.searchId = null;
    state.errorMessage = "";

    overlayEl = document.createElement("div");
    overlayEl.className = "is-overlay";
    overlayEl.addEventListener("click", function (e) {
      if (e.target === overlayEl) closeModal();
    });

    overlayEl.innerHTML = buildModalHTML();
    document.body.appendChild(overlayEl);
    document.body.style.overflow = "hidden";

    bindModalEvents();
  }

  function closeModal() {
    if (!overlayEl) return;
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    overlayEl.remove();
    overlayEl = null;
    state.modalOpen = false;
    document.body.style.overflow = "";
  }

  function buildModalHTML() {
    var title = (state.config && state.config.modalTitle) || "Visually Similar Products";
    return (
      '<div class="is-modal" role="dialog" aria-modal="true" aria-label="' + title + '">' +
        '<div class="is-modal-header">' +
          '<h2 class="is-modal-title">' + escHtml(title) + '</h2>' +
          '<button class="is-modal-close" aria-label="Close">&times;</button>' +
        '</div>' +
        '<div class="is-modal-body" id="is-modal-body">' +
          buildBodyHTML() +
        '</div>' +
      '</div>'
    );
  }

  function buildBodyHTML() {
    if (state.phase === "idle") return buildDropzoneHTML();
    if (state.phase === "searching") return buildSearchingHTML();
    if (state.phase === "results") return buildResultsHTML();
    if (state.phase === "error") return buildErrorHTML();
    return buildDropzoneHTML();
  }

  function buildDropzoneHTML() {
    return (
      '<div class="is-dropzone" id="is-dropzone">' +
        '<span class="is-dropzone-icon">📷</span>' +
        '<p class="is-dropzone-text">Drop an image here or</p>' +
        '<button class="is-upload-btn" id="is-upload-btn">Choose Photo</button>' +
        '<p class="is-dropzone-hint">JPEG, PNG or WebP &bull; Max 5 MB</p>' +
        '<input type="file" id="is-file-input" accept="image/jpeg,image/png,image/webp"' +
          ' style="display:none" aria-hidden="true">' +
      '</div>'
    );
  }

  function buildSearchingHTML() {
    var previewHtml = "";
    if (state.previewUrl) {
      previewHtml =
        '<div class="is-preview-wrap">' +
          '<img src="' + state.previewUrl + '" class="is-preview-img" alt="Your image">' +
          '<div class="is-preview-info">' +
            '<p style="margin:0;font-size:13px;color:#555;">Analyzing your image...</p>' +
          '</div>' +
        '</div>';
    }
    return (
      previewHtml +
      '<div class="is-searching">' +
        '<div class="is-spinner"></div>' +
        '<p class="is-searching-text">Finding similar products...</p>' +
      '</div>'
    );
  }

  function buildResultsHTML() {
    var showPrice = state.config && state.config.showPrice !== false;
    var showAtc = state.config && state.config.showAddToCart !== false;
    var previewHtml =
      '<div class="is-preview-wrap">' +
        '<img src="' + state.previewUrl + '" class="is-preview-img" alt="Your image">' +
        '<div class="is-preview-info">' +
          '<button class="is-preview-change" id="is-change-btn">Change image</button>' +
        '</div>' +
      '</div>';

    if (!state.results || state.results.length === 0) {
      return (
        previewHtml +
        '<div class="is-empty-state">' +
          '<span class="is-empty-icon">🔍</span>' +
          '<p class="is-empty-text">No similar products found.</p>' +
          '<p class="is-empty-hint">Try uploading a photo of a product you\'re looking for.</p>' +
          '<button class="is-retry-btn" id="is-retry-btn">Try Another Image</button>' +
        '</div>'
      );
    }

    var cards = state.results.map(function (r, i) {
      var price = showPrice && r.price
        ? '<p class="is-product-price">' + formatPrice(r.price) + '</p>'
        : "";
      var atcBtn = showAtc
        ? '<button class="is-atc-btn" data-handle="' + escAttr(r.handle) +
          '" data-pos="' + (i + 1) + '" data-pid="' + escAttr(r.productId) +
          '">Add to Cart</button>'
        : "";
      return (
        '<a class="is-product-card" href="/products/' + escAttr(r.handle) +
          '" data-pos="' + (i + 1) + '" data-pid="' + escAttr(r.productId) + '">' +
          '<img class="is-product-img" src="' + escAttr(r.imageUrl) +
            '" alt="' + escAttr(r.title) + '" loading="lazy">' +
          '<div class="is-product-info">' +
            '<p class="is-product-title">' + escHtml(r.title) + '</p>' +
            price +
            atcBtn +
          '</div>' +
        '</a>'
      );
    }).join("");

    return (
      previewHtml +
      '<p class="is-results-header">' + state.results.length + ' similar product' +
        (state.results.length !== 1 ? 's' : '') + ' found</p>' +
      '<div class="is-results-grid">' + cards + '</div>'
    );
  }

  function buildErrorHTML() {
    return (
      '<div class="is-error-state">' +
        '<span class="is-error-icon">⚠️</span>' +
        '<p class="is-error-text">' + escHtml(state.errorMessage || "Something went wrong.") + '</p>' +
        '<button class="is-retry-btn" id="is-retry-btn">Try Again</button>' +
      '</div>'
    );
  }

  function rerender() {
    var body = document.getElementById("is-modal-body");
    if (!body) return;
    body.innerHTML = buildBodyHTML();
    bindBodyEvents();
  }

  // ── Event Binding ────────────────────────────────────────────────
  function bindModalEvents() {
    var closeBtn = overlayEl.querySelector(".is-modal-close");
    if (closeBtn) closeBtn.addEventListener("click", closeModal);
    bindBodyEvents();

    // Keyboard: Escape closes modal
    document.addEventListener("keydown", onKeyDown);
  }

  function bindBodyEvents() {
    var fileInput = document.getElementById("is-file-input");
    var uploadBtn = document.getElementById("is-upload-btn");
    var dropzone  = document.getElementById("is-dropzone");
    var retryBtn  = document.getElementById("is-retry-btn");
    var changeBtn = document.getElementById("is-change-btn");

    if (uploadBtn && fileInput) {
      uploadBtn.addEventListener("click", function () { fileInput.click(); });
    }
    if (fileInput) {
      fileInput.addEventListener("change", function (e) {
        var file = e.target.files && e.target.files[0];
        if (file) handleFileSelected(file);
      });
    }
    if (dropzone) {
      dropzone.addEventListener("dragover", function (e) {
        e.preventDefault();
        dropzone.classList.add("is-drag-over");
      });
      dropzone.addEventListener("dragleave", function () {
        dropzone.classList.remove("is-drag-over");
      });
      dropzone.addEventListener("drop", function (e) {
        e.preventDefault();
        dropzone.classList.remove("is-drag-over");
        var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (file) handleFileSelected(file);
      });
    }
    if (retryBtn) {
      retryBtn.addEventListener("click", resetToIdle);
    }
    if (changeBtn) {
      changeBtn.addEventListener("click", resetToIdle);
    }

    // Product card clicks (event delegation)
    var grid = overlayEl && overlayEl.querySelector(".is-results-grid");
    if (grid) {
      grid.addEventListener("click", function (e) {
        var card = e.target.closest(".is-product-card");
        var atcBtn = e.target.closest(".is-atc-btn");

        if (atcBtn) {
          e.preventDefault();
          e.stopPropagation();
          var handle = atcBtn.dataset.handle;
          var pos = parseInt(atcBtn.dataset.pos, 10) || 1;
          var pid = atcBtn.dataset.pid;
          trackEvent("add_to_cart", pid, pos);
          addToCart(handle, pos, pid);
          return;
        }

        if (card) {
          var pos = parseInt(card.dataset.pos, 10) || 1;
          var pid = card.dataset.pid;
          trackEvent("click", pid, pos);
          // Navigation happens via the href
        }
      });
    }
  }

  function onKeyDown(e) {
    if (e.key === "Escape" && state.modalOpen) closeModal();
  }

  // ── Clipboard paste ──────────────────────────────────────────────
  document.addEventListener("paste", function (e) {
    if (!state.modalOpen || state.phase === "searching") return;
    var items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (var i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) {
        var file = items[i].getAsFile();
        if (file) handleFileSelected(file);
        break;
      }
    }
  });

  // ── File Handling ────────────────────────────────────────────────
  function handleFileSelected(file) {
    // Validate
    var allowed = ["image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(file.type)) {
      state.phase = "error";
      state.errorMessage = "Please upload a JPEG, PNG, or WebP image.";
      rerender();
      return;
    }
    var maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      state.phase = "error";
      state.errorMessage = "Image is too large. Please use a file under 5 MB.";
      rerender();
      return;
    }

    // Revoke old preview
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = URL.createObjectURL(file);
    state.previewFile = file;
    state.phase = "searching";
    rerender();

    performSearch(file);
  }

  function resetToIdle() {
    if (state.previewUrl) {
      URL.revokeObjectURL(state.previewUrl);
      state.previewUrl = null;
    }
    state.previewFile = null;
    state.phase = "idle";
    state.results = [];
    state.searchId = null;
    state.errorMessage = "";
    rerender();
  }

  // ── Search ───────────────────────────────────────────────────────
  function performSearch(file) {
    var formData = new FormData();
    formData.append("image", file);

    var url =
      proxyBase +
      "/image-search/search?session_id=" + encodeURIComponent(sessionId);

    fetch(url, {
      method: "POST",
      body: formData,
      // Let the browser set Content-Type (with boundary) automatically
    })
      .then(function (r) {
        if (!r.ok) return r.json().then(function (d) { throw new Error(d.error || "Search failed"); });
        return r.json();
      })
      .then(function (data) {
        if (data.error) {
          state.phase = "error";
          state.errorMessage = data.error;
        } else if (data.indexing) {
          // Catalog not yet indexed — admin needs to run sync first
          state.phase = "error";
          state.errorMessage =
            "Product catalog not indexed yet. " +
            "Please ask the store admin to go to Image Search settings and click \"Sync Products Now\".";
        } else {
          state.phase = "results";
          state.results = data.results || [];
          state.searchId = data.searchId || null;
        }
        rerender();
      })
      .catch(function (err) {
        state.phase = "error";
        state.errorMessage =
          err && err.message
            ? err.message
            : "Search failed. Please try again.";
        rerender();
      });
  }

  // ── Add to Cart ──────────────────────────────────────────────────
  function addToCart(handle, pos, productId) {
    // Fetch variant ID then POST to /cart/add.js
    fetch("/products/" + handle + ".js")
      .then(function (r) { return r.json(); })
      .then(function (product) {
        var variantId = product.variants && product.variants[0] && product.variants[0].id;
        if (!variantId) return;
        return fetch("/cart/add.js", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: variantId, quantity: 1 }),
        });
      })
      .then(function (r) {
        if (r && r.ok) {
          trackEvent("add_to_cart", productId, pos);
          // Notify theme cart update (dispatches event most themes listen to)
          document.dispatchEvent(new CustomEvent("cart:refresh"));
          document.dispatchEvent(new CustomEvent("cart:updated"));
        }
      })
      .catch(function (err) {
        console.error("[ImageSearch] Add to cart failed:", err);
      });
  }

  // ── Analytics Tracking ───────────────────────────────────────────
  function trackEvent(event, productId, position) {
    if (!state.searchId) return;
    fetch(proxyBase + "/image-search/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        searchId: state.searchId,
        event: event,
        productId: productId,
        position: position,
      }),
    }).catch(function () { /* fire-and-forget */ });
  }

  // ── Helpers ──────────────────────────────────────────────────────
  function escHtml(str) {
    var div = document.createElement("div");
    div.appendChild(document.createTextNode(String(str || "")));
    return div.innerHTML;
  }

  function escAttr(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function formatPrice(priceCents) {
    // price is stored in cents (integer)
    if (!priceCents) return "";
    var rupees = priceCents / 100;
    // Format with 2 decimal places, e.g. 629.95
    var formatted = rupees.toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    return "Rs. " + formatted;
  }
})();
