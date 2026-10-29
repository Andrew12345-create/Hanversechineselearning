/* bottom-nav.js — injects the floating bottom tab bar used on learner pages.
   Styling lives in hanverse.css (.tabbar, .sheet). The bar is ALWAYS visible
   on learner pages at every viewport (desktop keeps the top nav too — the
   bar is the persistent cross-page navigator for the logged-in app).

   Opt out per page with <body data-tabbar="off">.

   Tabs map to the five primary destinations:
     Home -> dashboard.html when signed in (marketing site when not)
     Learn -> learn.html · Practice -> practice.html
     Talk -> talk.html · Profile -> profile.html

   The More sheet (bottom sheet) holds every other destination — Roadmap,
   Explore, My Level (placement quiz), Parents, Premium, Notifications,
   Settings — plus an auth footer (Profile / Log out when signed in, Log in /
   Create account when not). Auth state is read from localStorage the same way
   nav-user.js reads it.
*/
(function () {
  if (document.body && document.body.dataset.tabbar === 'off') return;
  if (document.getElementById('tabbar')) return;

  var here = (location.pathname.split('/').pop() || 'index.html').toLowerCase();

  function signedIn() {
    try {
      var raw = localStorage.getItem('hanverse_user');
      if (!raw) return false;
      var u = JSON.parse(raw);
      return !!(u && u.user_id);
    } catch (e) { return false; }
  }

  function icon(name) {
    var paths = {
      home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
      learn: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
      roadmap: '<path d="M1 6v16l7-4 8 4 7-4V2l-7 4-8-4z"/><path d="M8 2v16"/><path d="M16 6v16"/>',
      progress: '<path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/>',
      practice: '<path d="M6.5 6.5 17.5 17.5"/><path d="M4 9 9 4l2 2-5 5z"/><path d="M20 15l-5 5-2-2 5-5z"/><path d="M3 21l3-3"/><path d="M18 3l3 3"/>',
      explore: '<circle cx="12" cy="12" r="10"/><path d="m16.24 7.76-2.12 6.36-6.36 2.12 2.12-6.36z"/>',
      talk: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
      parents: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
      premium: '<path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/>',
      notifications: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
      settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.09a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
      placement: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><path d="M12 2v4"/><path d="M12 18v4"/><path d="M2 12h4"/><path d="M18 12h4"/>',
      classroom: '<path d="M22 10 12 5 2 10l10 5 10-5z"/><path d="M6 12.5V17c0 1.2 2.7 3 6 3s6-1.8 6-3v-4.5"/><path d="M22 10v6"/>',
      more: '<path d="m18 15-6-6-6 6"/>',
      user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
      logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
      login: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="m10 17 5-5-5-5"/><path d="M15 12H3"/>',
      spark: '<path d="M12 3v3"/><path d="M12 18v3"/><path d="M3 12h3"/><path d="M18 12h3"/><path d="m5.6 5.6 2.2 2.2"/><path d="m16.2 16.2 2.2 2.2"/><path d="m5.6 18.4 2.2-2.2"/><path d="m16.2 7.8 2.2-2.2"/>'
    };
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
      (paths[name] || '') + '</svg>';
  }

  var loggedIn = false;
  try { loggedIn = !!localStorage.getItem('hanverse_user'); } catch (e) {}
  var tabs = [
    { href: loggedIn ? 'dashboard.html' : 'https://hanverse.netlify.app/', label: 'Home', icon: 'home' },
    { href: 'learn.html', label: 'Learn', icon: 'learn' },
    { href: 'practice.html', label: 'Practice', icon: 'practice' },
    { href: 'talk.html', label: 'Talk', icon: 'talk' },
    { href: 'profile.html', label: 'Profile', icon: 'user' }
  ];

  var sheetItems = [
    { href: 'roadmap.html', label: 'Roadmap', icon: 'roadmap' },
<<<<<<< HEAD
    { href: 'adventures.html', label: "HanPan's World", icon: 'spark' },
=======
>>>>>>> 76fb56eb8a87a2e552684fa6757744f0ea38a079
    { href: 'explore.html', label: 'Explore', icon: 'explore' },
    { href: 'class.html', label: 'Classroom', icon: 'classroom' },
    { href: 'placement.html', label: 'My Level', icon: 'placement' },
    { href: 'parents.html', label: 'Parents', icon: 'parents' },
    { href: 'payment.html', label: 'Premium', icon: 'premium' },
    { href: 'notifications.html', label: 'Alerts', icon: 'notifications' },
    { href: 'settings.html', label: 'Settings', icon: 'settings' }
  ];

  function link(it, cls) {
    var current = here === it.href.toLowerCase();
    return '<a class="' + cls + '"' +
      (current ? ' aria-current="page"' : '') +
      ' href="' + it.href + '">' + icon(it.icon) + '<span>' + it.label + '</span></a>';
  }

  function sheetAuthFooter() {
    if (signedIn()) {
      return link({ href: 'profile.html', label: 'Profile', icon: 'user' }, 'sheet-auth-item') +
        '<button type="button" class="sheet-auth-item" id="sheetLogout">' +
        icon('logout') + '<span>Log out</span></button>';
    }
    return link({ href: 'login.html', label: 'Log in', icon: 'login' }, 'sheet-auth-item') +
      '<a class="sheet-auth-item sheet-auth-cta" href="signup.html">' +
      icon('spark') + '<span>Create free account</span></a>';
  }

  var sheet = document.createElement('div');
  sheet.className = 'sheet-layer';
  sheet.id = 'moreSheetLayer';
  sheet.innerHTML =
    '<div class="sheet-backdrop" id="sheetBackdrop"></div>' +
    '<div class="sheet" id="moreSheet" role="dialog" aria-modal="true" aria-label="More navigation" hidden>' +
      '<div class="sheet-handle" aria-hidden="true"></div>' +
      '<div class="sheet-grid">' + sheetItems.map(function (it) { return link(it, 'sheet-item'); }).join('') + '</div>' +
      '<div class="sheet-auth">' + sheetAuthFooter() + '</div>' +
    '</div>';

  var moreActive = false;
  for (var i = 0; i < sheetItems.length; i++) {
    if (here === sheetItems[i].href.toLowerCase()) { moreActive = true; break; }
  }

  var nav = document.createElement('nav');
  nav.className = 'tabbar';
  nav.id = 'tabbar';
  nav.setAttribute('aria-label', 'Primary');

  nav.innerHTML = tabs.map(function (it) {
    return link(it, 'tabbar-link');
  }).join('') +
    '<button type="button" class="tabbar-more' + (moreActive ? ' is-current' : '') + '" id="tabbarMore" ' +
    'aria-expanded="false" aria-controls="moreSheet" aria-haspopup="dialog">' +
    icon('more') + '<span>More</span></button>';

  document.body.appendChild(nav);
  document.body.appendChild(sheet);
  document.body.classList.add('has-tabbar');

  /* ── Mobile HUD strip: fills the band the old top navbar left behind. ──
     Brand on the left, streak/XP/level from localStorage on the right,
     bell slot for notifications-client.js. Opt out: <body data-hud="off">. */
  if (!(document.body && document.body.dataset.hud === 'off') && !document.getElementById('hud')) {
    var u = null;
    try { u = JSON.parse(localStorage.getItem('hanverse_user') || 'null'); } catch (e) {}
    var isParent = u && String(u.role || '').toLowerCase() === 'parent';
    var streak = !isParent && u && Number(u.streak_days) > 0
      ? '<a class="hud-chip flame" href="profile.html" aria-label="Streak">🔥 ' + Number(u.streak_days) + '</a>'
      : '';
    var xp = !isParent && u
      ? '<a class="hud-chip" href="profile.html" aria-label="XP">⭐ ' + Number(u.xp || 0).toLocaleString() + '</a>'
      : '';
    var yct = u && String(u.current_yct || '').match(/\d+/);
    var lvl = u ? (yct ? 'YCT ' + yct[0] : 'Lv ' + (Number(u.level) || 1)) : '';
    var level = !isParent && u && lvl ? '<a class="hud-chip" href="profile.html">' + lvl + '</a>' : '';
    var hud = document.createElement('div');
    hud.className = 'hud';
    hud.id = 'hud';
    hud.innerHTML =
      '<a class="hud-brand" href="' + (localStorage.getItem('hanverse_user') ? 'dashboard.html' : 'https://hanverse.netlify.app/') + '" aria-label="HanVerse home">' +
        '<img src="Hanverse-logo2.png" alt="" width="30" height="30">HanVerse</a>' +
      '<div class="hud-stats">' + streak + xp + level +
        '<span class="hud-bell-slot" id="hud-bell-slot"></span></div>';
    document.body.appendChild(hud);
    document.dispatchEvent(new CustomEvent('hanverse:hud-ready'));
  }

  /* ── Sheet behaviour: tap, Esc, backdrop, swipe-down; focus is managed. ── */
  var moreBtn = document.getElementById('tabbarMore');
  var panel = document.getElementById('moreSheet');
  var backdrop = document.getElementById('sheetBackdrop');
  var lastFocus = null;

  function openSheet() {
    lastFocus = document.activeElement;
    sheet.classList.add('open');
    moreBtn.setAttribute('aria-expanded', 'true');
    panel.hidden = false;
    var first = panel.querySelector('a, button');
    if (first) first.focus();
    document.addEventListener('keydown', onKey, true);
  }

  function closeSheet() {
    if (!sheet.classList.contains('open')) return;
    sheet.classList.remove('open');
    moreBtn.setAttribute('aria-expanded', 'false');
    panel.hidden = true;
    document.removeEventListener('keydown', onKey, true);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function onKey(e) {
    if (e.key === 'Escape') { closeSheet(); return; }
    if (e.key !== 'Tab') return;
    var focusables = panel.querySelectorAll('a[href], button:not([disabled])');
    if (!focusables.length) return;
    var first = focusables[0];
    var last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  moreBtn.addEventListener('click', function () {
    sheet.classList.contains('open') ? closeSheet() : openSheet();
  });
  backdrop.addEventListener('click', closeSheet);

  var touchStartY = null;
  panel.addEventListener('touchstart', function (e) {
    touchStartY = e.touches[0].clientY;
  }, { passive: true });
  panel.addEventListener('touchmove', function (e) {
    if (touchStartY !== null && e.touches[0].clientY - touchStartY > 60) {
      touchStartY = null;
      closeSheet();
    }
  }, { passive: true });

  var logoutBtn = document.getElementById('sheetLogout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', function () {
      localStorage.removeItem('hanverse_user');
      window.location.href = 'login.html';
    });
  }
  /* Micro-delight: tiny haptic tap on primary actions (Android; silent no-op elsewhere). */
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (t && t.closest && t.closest('.tabbar a, .tabbar-more, .sheet-item, .sheet-auth-item, .cta, .btn-primary, .nav-cta, .hn-btn')) {
      if (navigator.vibrate) { try { navigator.vibrate(12); } catch (err) {} }
    }
  }, true);
})();
