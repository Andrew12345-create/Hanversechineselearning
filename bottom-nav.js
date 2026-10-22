/* bottom-nav.js — injects the floating bottom tab bar used on learner pages.
   Styling lives in hanverse.css (.tabbar). Shows only on small screens
   (<= 820px); the desktop top nav stays the primary navigation there.

   Opt out per page with <body data-tabbar="off">.

   Items map to real HanVerse destinations:
     Home     -> index.html
     Learn    -> learn.html
     Roadmap  -> roadmap.html
     Progress -> profile.html   (XP, streaks, achievements, stats)
     Settings -> settings.html  (account + preferences)
*/
(function () {
  if (document.body && document.body.dataset.tabbar === 'off') return;
  if (document.getElementById('tabbar')) return;

  var here = (location.pathname.split('/').pop() || 'index.html').toLowerCase();

  function icon(name) {
    var paths = {
      home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
      learn: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
      roadmap: '<path d="M1 6v16l7-4 8 4 7-4V2l-7 4-8-4z"/><path d="M8 2v16"/><path d="M16 6v16"/>',
      progress: '<path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/>',
      settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.09a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'
    };
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
      paths[name] + '</svg>';
  }

  var items = [
    { href: 'index.html', label: 'Home', icon: 'home' },
    { href: 'learn.html', label: 'Learn', icon: 'learn' },
    { href: 'roadmap.html', label: 'Roadmap', icon: 'roadmap' },
    { href: 'profile.html', label: 'Progress', icon: 'progress' },
    { href: 'settings.html', label: 'Settings', icon: 'settings' }
  ];

  var nav = document.createElement('nav');
  nav.className = 'tabbar';
  nav.id = 'tabbar';
  nav.setAttribute('aria-label', 'Primary');

  nav.innerHTML = items.map(function (it) {
    var current = here === it.href.toLowerCase();
    return '<a href="' + it.href + '"' + (current ? ' aria-current="page"' : '') + '>' +
      icon(it.icon) + '<span>' + it.label + '</span></a>';
  }).join('');

  document.body.appendChild(nav);
  document.body.classList.add('has-tabbar');
})();
