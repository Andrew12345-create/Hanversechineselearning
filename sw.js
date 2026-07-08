// sw.js - HanVerse Service Worker for Netlify
const CACHE_NAME = 'hanverse-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/offline.html',
  '/css/styles.css',
  '/js/app.js',
  '/js/auth.js',
  '/js/offline-manager.js',
  '/images/logo.png',
  '/images/panda-icon.png',
  'https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700;800&display=swap'
];

// Install - cache critical assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('📦 Caching HanVerse assets...');
        return cache.addAll(ASSETS).catch(err => {
          console.warn('Some assets failed to cache:', err);
        });
      })
      .then(() => self.skipWaiting())
  );
});

// Activate - clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME)
            .map(key => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch - serve from cache, fallback to network
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  
  // Skip API calls - they need network
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // Skip non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then(cached => {
        if (cached) {
          return cached;
        }
        return fetch(event.request)
          .then(response => {
            // Cache new assets dynamically (except API)
            if (response.status === 200) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then(cache => {
                cache.put(event.request, clone);
              });
            }
            return response;
          })
          .catch(() => {
            // Offline fallback
            if (url.pathname.endsWith('.html') || url.pathname === '/') {
              return caches.match('/offline.html');
            }
            return new Response('Offline - Please connect to the internet', {
              status: 503,
              statusText: 'Service Unavailable'
            });
          });
      })
  );
});