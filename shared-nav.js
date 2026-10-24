/* shared-nav.js — injects the canonical HanVerse nav + footer into a mount.
   Designed so every page shows the same header as index.html.

   Usage:
     <div id="app-nav"></div>
     <script src="shared-nav.js"></script>
     <script src="hanverse.js"></script>   (binds #navbar/#menu/#mobileMenu, must load AFTER this)
     <script src="nav-user.js"></script>   (signed-in vs signed-out chip in .nav-actions)

   Variants (chosen by a fragment on the script src):
     shared-nav.js            -> full nav (brand + links + Log in/Start Free + mobile menu) — index.html look
     shared-nav.js#auth       -> auth-brand nav (pill with brand + hamburger only) for login/signup/reset pages

   Optional <div id="app-footer"></div> injects the shared index.html footer.
   The page opts out of the nav by not including the #app-nav mount.
*/
(function () {
  var source = (document.currentScript && document.currentScript.src) || '';
  var variant = source.split('#')[1] || '';
  var auth = variant === 'auth';

  /* Auth state is read synchronously (same key as nav-user.js) so the nav
     renders the right variant immediately — no flash of the wrong version. */
  function signedIn() {
    try {
      var raw = localStorage.getItem('hanverse_user');
      if (!raw) return false;
      var u = JSON.parse(raw);
      return !!(u && u.user_id);
    } catch (e) { return false; }
  }

  var here = (location.pathname.split('/').pop() || 'index.html').toLowerCase();

  var navMount = document.getElementById('app-nav');
  var footMount = document.getElementById('app-footer');

  function brandMarkup() {
    return (
      '<a class="brand" href="index.html" aria-label="HanVerse home">' +
        '<img src="Hanverse-logo2.png" alt="HanVerse logo" width="38" height="38">' +
        '<span>HanVerse</span>' +
      '</a>'
    );
  }

  function actionsMarkup() {
    /* Signed in: render a skeleton chip immediately; nav-user.js upgrades it
       with the real name, avatar and account menu. Never flash Log in. */
    if (signedIn()) {
      return '<a class="nav-user nav-user-chip nav-user-skeleton" href="https://learn-hanverse.netlify.app/profile.html" aria-label="Your account">' +
        '<span class="avatar" aria-hidden="true">🐼</span></a>';
    }
    return '<div class="nav-actions">' +
      '<a class="nav-login" href="https://learn-hanverse.netlify.app/login.html">Log in</a>' +
      '<a class="nav-cta" href="https://learn-hanverse.netlify.app/signup.html">Start Free <span aria-hidden="true">→</span></a>' +
      '</div>';
  }

  function fullMarkup() {
    return (
      '<nav class="nav" id="navbar" role="navigation" aria-label="Main navigation">' +
        brandMarkup() +
        '<div class="nav-links">' +
          '<a href="about.html">About</a>' +
          '<a href="pricing.html">Pricing</a>' +
          '<a href="faq.html">FAQ</a>' +
          '<a href="contact.html">Contact</a>' +
        '</div>' +
        actionsMarkup() +
        '<button class="nav-burger" id="navBurger" aria-label="Open menu" aria-expanded="false" aria-controls="mobileMenu">' +
          '<span></span><span></span><span></span>' +
        '</button>' +
      '</nav>' +
      '<div class="mobile-menu" id="mobileMenu" hidden>' +
        '<a href="index.html">Home</a>' +
        '<a href="about.html">About</a>' +
        '<a href="pricing.html">Pricing</a>' +
        '<a href="faq.html">FAQ</a>' +
        '<a href="contact.html">Contact</a>' +
        '<a href="https://learn-hanverse.netlify.app/login.html">Log in</a>' +
        '<a class="mobile-cta" href="https://learn-hanverse.netlify.app/signup.html">Start Free →</a>' +
      '</div>'
    );
  }

  function authMarkup() {
    return (
      '<nav class="nav nav-auth" id="navbar" role="navigation" aria-label="Main navigation">' +
        brandMarkup() +
      '</nav>'
    );
  }

  if (navMount) {
    navMount.outerHTML = auth ? authMarkup() : fullMarkup();
  }

  if (footMount) {
    footMount.outerHTML =
      '<footer>' +
        '<div class="container footer-inner">' +
          '<div>' +
            '<div class="footer-brand">HanVerse</div>' +
            '<p>Learn Mandarin. Explore more.</p>' +
          '</div>' +
          '<div class="footer-links">' +
            '<a href="about.html">About</a>' +
            '<a href="pricing.html">Pricing</a>' +
            '<a href="faq.html">FAQ</a>' +
            '<a href="contact.html">Contact</a>' +
            '<a href="https://learn-hanverse.netlify.app/login.html">Open the app →</a>' +
            '<a href="terms.html">Terms</a>' +
            '<a href="privacy.html">Privacy</a>' +
            '<a href="refund-policy.html">Refunds</a>' +
            '<a href="cookie-policy.html">Cookies</a>' +
          '</div>' +
        '</div>' +
      '</footer>';
  }

  // --- Mobile burger menu ---
  var burger = document.getElementById('navBurger');
  var sheet = document.getElementById('mobileMenu');
  if (burger && sheet) {
    var setMenu = function (open) {
      sheet.hidden = !open;
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
      burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      burger.classList.toggle('is-open', open);
    };
    burger.addEventListener('click', function () {
      setMenu(sheet.hidden);
    });
    sheet.addEventListener('click', function (e) {
      if (e.target && e.target.tagName === 'A') setMenu(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !sheet.hidden) setMenu(false);
    });
    document.addEventListener('click', function (e) {
      if (!sheet.hidden && !sheet.contains(e.target) && !burger.contains(e.target)) setMenu(false);
    });
  }
})();
