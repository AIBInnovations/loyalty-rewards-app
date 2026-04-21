(function () {
  "use strict";

  var root = document.getElementById("product-reviews-widget");
  if (!root) return;

  var productId     = root.dataset.productId;
  var productHandle = root.dataset.productHandle;
  var shopDomain    = root.dataset.shopDomain;
  var customerId    = root.dataset.customerId || "";
  var customerName  = root.dataset.customerName || "";
  var customerEmail = root.dataset.customerEmail || "";

  var state = { reviews: [], questions: [], rating: 0, formOpen: false, qaFormOpen: false, photos: [] };

  var MAX_PHOTOS = 5;
  var MAX_DIMENSION = 1200;
  var JPEG_QUALITY = 0.8;

  function compressImage(file) {
    return new Promise(function (resolve, reject) {
      if (!file.type || file.type.indexOf("image/") !== 0) {
        return reject(new Error("Not an image"));
      }
      var reader = new FileReader();
      reader.onload = function (e) {
        var img = new Image();
        img.onload = function () {
          var w = img.width, h = img.height;
          if (w > MAX_DIMENSION || h > MAX_DIMENSION) {
            if (w >= h) { h = Math.round(h * (MAX_DIMENSION / w)); w = MAX_DIMENSION; }
            else        { w = Math.round(w * (MAX_DIMENSION / h)); h = MAX_DIMENSION; }
          }
          var canvas = document.createElement("canvas");
          canvas.width = w; canvas.height = h;
          canvas.getContext("2d").drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL("image/jpeg", JPEG_QUALITY));
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function stars(n, size) {
    var s = "";
    for (var i = 1; i <= 5; i++) s += i <= n ? "★" : "☆";
    return s;
  }

  function avgRating() {
    if (!state.reviews.length) return 0;
    var sum = state.reviews.reduce(function (a, r) { return a + r.rating; }, 0);
    return (sum / state.reviews.length).toFixed(1);
  }

  function render() {
    var section = document.getElementById("product-reviews-section");
    if (!section) {
      section = document.createElement("div");
      section.id = "product-reviews-section";
      root.parentNode.insertBefore(section, root.nextSibling);
    }

    var avg = avgRating();
    var count = state.reviews.length;

    var html =
      '<div class="rv-header">' +
        '<h2 class="rv-heading">Customer Reviews</h2>' +
        '<button class="rv-write-btn" id="rv-open-form">Write a Review</button>' +
      '</div>';

    if (count > 0) {
      html +=
        '<div class="rv-summary">' +
          '<span class="rv-avg">' + avg + '</span>' +
          '<div><div class="rv-stars-large">' + stars(Math.round(avg)) + '</div>' +
          '<div class="rv-count">' + count + ' review' + (count > 1 ? 's' : '') + '</div></div>' +
        '</div>';
    }

    // Review form
    html +=
      '<div class="rv-form' + (state.formOpen ? ' rv-form-open' : '') + '" id="rv-form">' +
        '<p class="rv-form-title">Write a Review</p>' +
        '<div class="rv-form-group">' +
          '<label class="rv-form-label">Rating</label>' +
          '<div class="rv-star-input" id="rv-star-input">' +
            '<span data-star="1">★</span><span data-star="2">★</span>' +
            '<span data-star="3">★</span><span data-star="4">★</span><span data-star="5">★</span>' +
          '</div>' +
        '</div>' +
        '<div class="rv-form-group">' +
          '<label class="rv-form-label">Your Review</label>' +
          '<textarea class="rv-textarea" id="rv-body" placeholder="Share your experience…" rows="4"></textarea>' +
        '</div>' +
        '<div class="rv-form-group">' +
          '<label class="rv-form-label">Add Photos (optional, up to ' + MAX_PHOTOS + ')</label>' +
          '<div class="rv-photo-picker">' +
            '<label class="rv-photo-pick-btn" for="rv-photos-input">' +
              '<span class="rv-photo-pick-icon">+</span>' +
              '<span>Choose photos</span>' +
            '</label>' +
            '<input type="file" id="rv-photos-input" accept="image/*" multiple style="display:none">' +
          '</div>' +
          '<div class="rv-photo-previews" id="rv-photo-previews">' +
            state.photos.map(function (dataUrl, i) {
              return '<div class="rv-photo-preview">' +
                       '<img src="' + dataUrl + '" alt="preview">' +
                       '<button type="button" class="rv-photo-remove" data-idx="' + i + '" aria-label="Remove">×</button>' +
                     '</div>';
            }).join("") +
          '</div>' +
        '</div>' +
        '<button class="rv-submit-btn" id="rv-submit">Submit Review</button>' +
        '<p class="rv-success-msg" id="rv-success" style="display:none">✅ Review submitted! It will appear after moderation.</p>' +
      '</div>';

    // Reviews list
    if (count > 0) {
      html += '<div class="rv-list">';
      state.reviews.forEach(function (r) {
        html +=
          '<div class="rv-card">' +
            '<div class="rv-card-header">' +
              '<span class="rv-author">' + (r.authorName || "Customer") + '</span>' +
              '<span class="rv-stars">' + stars(r.rating) + '</span>' +
              '<span class="rv-date">' + new Date(r.createdAt).toLocaleDateString("en-IN") + '</span>' +
            '</div>' +
            '<p class="rv-body">' + r.body + '</p>' +
            (r.photoUrls && r.photoUrls.length
              ? '<div class="rv-photos">' + r.photoUrls.map(function (u) {
                  return '<img class="rv-photo" src="' + u + '" alt="Review photo" loading="lazy">';
                }).join("") + '</div>'
              : '') +
          '</div>';
      });
      html += '</div>';
    } else {
      html += '<p class="rv-empty">No reviews yet. Be the first to write one!</p>';
    }

    // Q&A section
    html +=
      '<div class="rv-qa-section">' +
        '<h3 class="rv-qa-heading">Questions & Answers</h3>' +
        '<div class="rv-ask-wrap">' +
          '<button class="rv-ask-btn" id="rv-ask-btn">Ask a Question</button>' +
        '</div>' +
        '<div class="rv-form' + (state.qaFormOpen ? ' rv-form-open' : '') + '" id="rv-qa-form" style="margin-top:12px">' +
          '<textarea class="rv-textarea" id="rv-question-input" placeholder="Type your question…" rows="3"></textarea>' +
          '<button class="rv-submit-btn" id="rv-qa-submit" style="margin-top:10px">Submit Question</button>' +
          '<p class="rv-success-msg" id="rv-qa-success" style="display:none">✅ Question submitted!</p>' +
        '</div>';

    if (state.questions.length > 0) {
      state.questions.forEach(function (q) {
        html +=
          '<div class="rv-qa-item">' +
            '<p class="rv-question">Q: ' + q.question + '</p>' +
            (q.answer ? '<p class="rv-answer">A: ' + q.answer + '</p>' : '') +
          '</div>';
      });
    } else {
      html += '<p class="rv-empty" style="padding:16px 0">No questions yet.</p>';
    }

    html += '</div>';

    section.innerHTML = html;
    attachEvents(section);
  }

  function openLightbox(src) {
    closeLightbox();
    var overlay = document.createElement("div");
    overlay.className = "rv-lightbox";
    overlay.innerHTML =
      '<button type="button" class="rv-lightbox-close" aria-label="Close">×</button>' +
      '<img class="rv-lightbox-img" src="' + src + '" alt="Review photo">';
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay || e.target.classList.contains("rv-lightbox-close")) {
        closeLightbox();
      }
    });
    document.addEventListener("keydown", lightboxKeyHandler);
    document.body.appendChild(overlay);
    document.body.style.overflow = "hidden";
  }

  function closeLightbox() {
    var existing = document.querySelector(".rv-lightbox");
    if (existing) existing.remove();
    document.removeEventListener("keydown", lightboxKeyHandler);
    document.body.style.overflow = "";
  }

  function lightboxKeyHandler(e) {
    if (e.key === "Escape") closeLightbox();
  }

  function attachEvents(section) {
    // Open write review form
    section.querySelector("#rv-open-form").addEventListener("click", function () {
      state.formOpen = !state.formOpen;
      render();
    });

    // Click review photo → lightbox
    section.querySelectorAll(".rv-photo").forEach(function (img) {
      img.addEventListener("click", function () {
        openLightbox(this.getAttribute("src"));
      });
    });

    // Star rating
    var starInput = section.querySelector("#rv-star-input");
    if (starInput) {
      starInput.querySelectorAll("span").forEach(function (span) {
        span.classList.toggle("active", parseInt(span.dataset.star) <= state.rating);
        span.addEventListener("click", function () {
          state.rating = parseInt(this.dataset.star);
          starInput.querySelectorAll("span").forEach(function (s) {
            s.classList.toggle("active", parseInt(s.dataset.star) <= state.rating);
          });
        });
      });
    }

    // Photo picker
    var photosInput = section.querySelector("#rv-photos-input");
    if (photosInput) {
      photosInput.addEventListener("change", function (e) {
        var files = Array.from(e.target.files || []);
        var slotsLeft = MAX_PHOTOS - state.photos.length;
        if (slotsLeft <= 0) { e.target.value = ""; return; }
        var toAdd = files.slice(0, slotsLeft);
        Promise.all(toAdd.map(compressImage))
          .then(function (urls) {
            state.photos = state.photos.concat(urls);
            render();
          })
          .catch(function () { render(); });
      });
    }

    // Remove photo
    section.querySelectorAll(".rv-photo-remove").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var idx = parseInt(this.dataset.idx, 10);
        state.photos.splice(idx, 1);
        render();
      });
    });

    // Submit review
    var submitBtn = section.querySelector("#rv-submit");
    if (submitBtn) {
      submitBtn.addEventListener("click", function () {
        var body = section.querySelector("#rv-body").value.trim();
        if (!body || state.rating === 0) return;

        submitBtn.disabled = true;
        submitBtn.textContent = "Submitting…";

        fetch("/apps/loyalty/reviews/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            productId: productId,
            rating: state.rating,
            body: body,
            photoUrls: state.photos.slice(),
            authorName: customerName || "Customer",
            authorEmail: customerEmail,
            customerId: customerId,
          }),
        })
          .then(function (r) { return r.json(); })
          .then(function () {
            var msg = section.querySelector("#rv-success");
            if (msg) { msg.style.display = "block"; }
            submitBtn.disabled = false;
            submitBtn.textContent = "Submit Review";
            state.formOpen = false;
            state.rating = 0;
            state.photos = [];
          })
          .catch(function () {
            submitBtn.disabled = false;
            submitBtn.textContent = "Submit Review";
          });
      });
    }

    // Ask question toggle
    var askBtn = section.querySelector("#rv-ask-btn");
    if (askBtn) {
      askBtn.addEventListener("click", function () {
        state.qaFormOpen = !state.qaFormOpen;
        render();
      });
    }

    // Submit question
    var qaSubmit = section.querySelector("#rv-qa-submit");
    if (qaSubmit) {
      qaSubmit.addEventListener("click", function () {
        var question = section.querySelector("#rv-question-input").value.trim();
        if (!question) return;
        qaSubmit.disabled = true;
        qaSubmit.textContent = "Submitting…";
        fetch("/apps/loyalty/reviews/question", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productId: productId, question: question }),
        })
          .then(function (r) { return r.json(); })
          .then(function () {
            var msg = section.querySelector("#rv-qa-success");
            if (msg) msg.style.display = "block";
            qaSubmit.disabled = false;
            qaSubmit.textContent = "Submit Question";
          })
          .catch(function () {
            qaSubmit.disabled = false;
            qaSubmit.textContent = "Submit Question";
          });
      });
    }
  }

  // Fetch reviews and questions in parallel
  Promise.all([
    fetch("/apps/loyalty/reviews?productId=" + productId).then(function (r) { return r.json(); }).catch(function () { return { reviews: [] }; }),
    fetch("/apps/loyalty/reviews/questions?productId=" + productId).then(function (r) { return r.json(); }).catch(function () { return { questions: [] }; }),
  ]).then(function (results) {
    state.reviews   = results[0].reviews || [];
    state.questions = results[1].questions || [];
    render();
  });
})();
