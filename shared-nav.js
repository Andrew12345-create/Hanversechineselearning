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

  /* The marketing site and the learning app are separate hosts, so every
     cross-host link has to be absolute. A relative "learn.html" on the
     marketing host would 404 once the split is live. */
  var APP = 'https://learn-hanverse.netlify.app';
  var MARKETING = 'https://hanverse.netlify.app';
  var appLink = function (page) { return APP + '/' + page; };
  var siteLink = function (page) { return MARKETING + '/' + page; };

  var navMount = document.getElementById('app-nav');
  var footMount = document.getElementById('app-footer');

  function brandMarkup() {
    return (
      '<a class="brand" href="' + MARKETING + '/" aria-label="HanVerse home">' +
        '<img src="Hanverse-logo2.png" alt="HanVerse logo" width="38" height="38">' +
        '<span>HanVerse</span>' +
      '</a>'
    );
  }

  function actionsMarkup() {
    /* Signed in: render a skeleton chip immediately; nav-user.js upgrades it
       with the real name, avatar and account menu. Never flash Log in. */
    if (signedIn()) {
      return '<a class="nav-user nav-user-chip nav-user-skeleton" href="' + appLink('profile.html') + '" aria-label="Your account">' +
        '<span class="avatar" aria-hidden="true">🐼</span></a>';
    }
    return '<div class="nav-actions">' +
      '<a class="nav-login" href="' + appLink('login.html') + '">Log in</a>' +
      '<a class="nav-cta" href="' + appLink('signup.html') + '">Start Free <span aria-hidden="true">→</span></a>' +
      '</div>';
  }

  function fullMarkup() {
    return (
      '<nav class="nav" id="navbar" role="navigation" aria-label="Main navigation">' +
        brandMarkup() +
        '<div class="nav-links">' +
          '<a href="' + appLink('learn.html') + '">Learn</a>' +
          '<a href="' + appLink('explore.html') + '">Explore</a>' +
          '<a href="' + appLink('practice.html') + '">Practice</a>' +
          '<a href="' + appLink('roadmap.html') + '">Roadmap</a>' +
          '<a href="' + appLink('dictionary.html') + '">Dictionary</a>' +
          '<a href="' + appLink('parents.html') + '">Parents</a>' +
        '</div>' +
        actionsMarkup() +
      '</nav>'
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
            '<a href="' + appLink('learn.html') + '">Learn</a>' +
            '<a href="' + appLink('explore.html') + '">Explore</a>' +
            '<a href="' + appLink('roadmap.html') + '">Roadmap</a>' +
            '<a href="' + appLink('dictionary.html') + '">Dictionary</a>' +
            '<a href="' + appLink('parents.html') + '">Parents</a>' +
            '<a href="' + appLink('login.html') + '">Log in</a>' +
            '<a href="' + siteLink('terms.html') + '">Terms</a>' +
            '<a href="' + siteLink('privacy.html') + '">Privacy</a>' +
            '<a href="' + siteLink('refund-policy.html') + '">Refunds</a>' +
            '<a href="' + siteLink('cookie-policy.html') + '">Cookies</a>' +
            '<a href="' + siteLink('compliance.html') + '">Child Safety</a>' +
          '</div>' +
        '</div>' +
      '</footer>';
  }
})();
