(function () {
  "use strict";

  var root = document.getElementById("ugc-gallery-widget");
  if (!root) return;

  // Apply primary color CSS variable from data attribute
  var primaryColor = root.dataset.primaryColor || "#5C6AC4";
  document.documentElement.style.setProperty("--ugc-primary", primaryColor);

  fetch("/apps/loyalty/ugc-settings")
    .then(function (r) {
      if (!r.ok) throw new Error("Failed");
      var ct = r.headers.get("content-type") || "";
      if (!ct.includes("application/json")) throw new Error("Not JSON");
      return r.json();
    })
    .then(function (data) {
      if (!data.enabled || !data.photos || data.photos.length === 0) return;
      renderGallery(data);
    })
    .catch(function () {});

  function renderGallery(data) {
    var section = document.createElement("div");
    section.id = "ugc-gallery-section";

    var gridHtml = '<h2 class="ugc-title">' + (data.title || "As seen on Instagram") + '</h2><div class="ugc-grid">';
    data.photos.forEach(function (photo, idx) {
      gridHtml +=
        '<div class="ugc-item" data-idx="' + idx + '">' +
          '<img src="' + photo.imageUrl + '" alt="' + (photo.caption || "Customer photo") + '" loading="lazy">' +
          '<div class="ugc-overlay">' +
            (photo.productHandle
              ? '<button class="ugc-shop-btn">Shop Now</button>'
              : '') +
          '</div>' +
        '</div>';
    });
    gridHtml += "</div>";

    // Lightbox
    gridHtml +=
      '<div id="ugc-lightbox">' +
        '<button class="ugc-lb-close" id="ugc-lb-close">✕</button>' +
        '<div class="ugc-lb-inner">' +
          '<img class="ugc-lb-image" id="ugc-lb-image" src="" alt="">' +
          '<div class="ugc-lb-body">' +
            '<p class="ugc-lb-caption" id="ugc-lb-caption"></p>' +
            '<a class="ugc-lb-product-link" id="ugc-lb-link" href="#" style="display:none">Shop This Look</a>' +
          '</div>' +
        '</div>' +
      '</div>';

    section.innerHTML = gridHtml;

    // Inject before the footer so the gallery appears in the main content area,
    // not after the footer (app embed blocks are appended at end of <body>).
    var footer = document.querySelector("footer, #footer, .footer, .site-footer, [role='contentinfo']");
    if (footer && footer.parentNode) {
      footer.parentNode.insertBefore(section, footer);
    } else {
      var main = document.querySelector("main, #MainContent, [role='main'], .main-content");
      if (main) {
        main.appendChild(section);
      } else {
        document.body.appendChild(section);
      }
    }

    var lightbox = document.getElementById("ugc-lightbox");
    var lbImage  = document.getElementById("ugc-lb-image");
    var lbCaption= document.getElementById("ugc-lb-caption");
    var lbLink   = document.getElementById("ugc-lb-link");
    var lbClose  = document.getElementById("ugc-lb-close");

    section.querySelectorAll(".ugc-item").forEach(function (item) {
      item.addEventListener("click", function () {
        var idx   = parseInt(item.dataset.idx, 10);
        var photo = data.photos[idx];
        lbImage.src        = photo.imageUrl;
        lbImage.alt        = photo.caption || "";
        lbCaption.textContent = photo.caption || "";
        if (photo.productHandle) {
          lbLink.href        = "/products/" + photo.productHandle;
          lbLink.style.display = "block";
        } else {
          lbLink.style.display = "none";
        }
        lightbox.classList.add("ugc-open");
      });
    });

    lbClose.addEventListener("click", function () {
      lightbox.classList.remove("ugc-open");
    });
    lightbox.addEventListener("click", function (e) {
      if (e.target === lightbox) lightbox.classList.remove("ugc-open");
    });
  }
})();
