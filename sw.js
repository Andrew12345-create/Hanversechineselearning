// ============================================================
// HanVerse Service Worker — learn site (learn-hanverse)
// Offline support for Netlify: precached shell + pages,
// network-first navigations, stale-while-revalidate assets,
// JSON 503 for API calls while offline.
// Bump VERSION (and the ?v= query in pages) to atomically
// refresh every cache on next deploy.
// ============================================================
'use strict';

const VERSION = 'v1';
const CACHE = 'hanverse-' + VERSION;

const PRECACHE_URLS = [
  '/offline.html',
  '/learn.html', '/lesson.html', '/roadmap.html', '/practice.html',
  '/talk.html', '/explore.html', '/profile.html', '/notifications.html',
  '/settings.html', '/placement.html', '/dashboard.html', '/parents.html',
  '/payment.html', '/login.html', '/signup.html', '/forgot-password.html',
  '/reset-password.html', '/verify-email.html', '/banned.html', '/invite.html',
  '/child-profile.html', '/parent-dashboard.html',
  '/hanverse.css?v=1', '/hanverse.js?v=1', '/nav-user.js?v=1',
  '/bottom-nav.js?v=1', '/shared-nav.js?v=1', '/features-client.js?v=1',
  '/notifications-client.js?v=1', '/notifications.js?v=1',
  '/js/auth-fetch.js?v=1',
  '/manifest.json', '/Hanverse-logo.png', '/Hanverse-logo2.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Cache one-by-one: a single failed asset must not break install.
    await Promise.all(PRECACHE_URLS.map(async (url) => {
      try {
        const res = await fetch(new Request(url, { cache: 'reload' }));
        if (res && res.ok) await cache.put(url, res);
      } catch (e) { /* offline or missing asset — skip */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/.netlify/')) return;

  // API calls: pass through; report offline as JSON 503 (clients already
  // handle { success: false } shapes).
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(req).catch(() => new Response(
        JSON.stringify({ success: false, error: 'offline' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      ))
    );
    return;
  }

  // Page navigations: network-first (fresh pages win), cache fallback,
  // offline.html as the last resort.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res && res.ok) {
          const cache = await caches.open(CACHE);
          cache.put(req, res.clone());
        }
        return res;
      } catch (e) {
        const cached = await caches.match(req, { ignoreSearch: true });
        if (cached) return cached;
        const offline = await caches.match('/offline.html');
        if (offline) return offline;
        return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
      }
    })());
    return;
  }

  // Static assets: stale-while-revalidate.
  event.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: true });
    const network = fetch(req).then(res => {
      if (res && res.ok) {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(req, clone));
      }
      return res;
    }).catch(() => null);

    if (cached) {
      event.waitUntil(network);
      return cached;
    }
    const res = await network;
    if (res) return res;
    const offline = await caches.match('/offline.html');
    if (offline) return offline;
    return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  })());
});
