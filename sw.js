// ============================================================
// HanVerse Service Worker
// Designed for Netlify + Offline Support
// ============================================================

const CACHE_NAME = 'hanverse-v11';
// Lesson content cache survives version bumps so previously studied
// lessons stay available offline.
const LESSON_CACHE = 'hanverse-lessons-v1';

// Real files only — every entry must exist at the site root.
// (The previous list referenced /css/styles.css, /js/app.js and /images/*,
// which never existed, so cache.addAll() rejected and the SW never installed.)
const STATIC_ASSETS = [
    '/offline.html',
    '/hanverse.css',
    '/hanverse.js',
    '/nav-user.js',
    '/Hanverse-logo2.png',
    '/assets/mascot/states/hanpan-waving.png',
    '/assets/mascot/states/hanpan-happy.png',
    '/assets/mascot/states/hanpan-idle.png',
    '/assets/mascot/states/hanpan-thinking.png',
    '/assets/mascot/states/hanpan-listening.png'
];


// ============================================================
// INSTALL
// ============================================================

self.addEventListener('install', event => {
    console.log('[HanVerse SW] Installing...');

    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('[HanVerse SW] Caching static assets...');

                // Cache each file individually so one bad asset
                // can never break the whole installation.
                return Promise.all(
                    STATIC_ASSETS.map(asset =>
                        cache.add(asset).catch(err =>
                            console.warn('[HanVerse SW] Skipped:', asset, err)
                        )
                    )
                );
            })
            .then(() => {
                console.log('[HanVerse SW] Installation complete.');

                // Activate the new service worker immediately
                return self.skipWaiting();
            })
            .catch(error => {
                console.error(
                    '[HanVerse SW] Installation failed:',
                    error
                );
            })
    );
});


// ============================================================
// ACTIVATE
// ============================================================

self.addEventListener('activate', event => {
    console.log('[HanVerse SW] Activating...');

    event.waitUntil(
        caches.keys()
            .then(cacheNames => {

                return Promise.all(
                    cacheNames
                        .filter(cacheName => {
                            return cacheName !== CACHE_NAME && cacheName !== LESSON_CACHE;
                        })
                        .map(cacheName => {
                            console.log(
                                '[HanVerse SW] Removing old cache:',
                                cacheName
                            );

                            return caches.delete(cacheName);
                        })
                );
            })
            .then(() => {

                console.log(
                    '[HanVerse SW] Old caches removed.'
                );

                // Take control of open pages immediately
                return self.clients.claim();
            })
    );
});


// ============================================================
// FETCH
// ============================================================

self.addEventListener('fetch', event => {

    const request = event.request;
    const url = new URL(request.url);


    // --------------------------------------------------------
    // Only handle GET requests
    // --------------------------------------------------------

    if (request.method !== 'GET') {
        return;
    }


    // --------------------------------------------------------
    // Lesson content API — NETWORK FIRST, cached for offline study
    // --------------------------------------------------------

    //
    // GET reads of lesson content are cached in a dedicated cache so a
    // child can keep studying a visited lesson without a connection.
    // Everything else in the API stays network-only.
    //

    if (
        request.method === 'GET' &&
        /^\/(api|\.netlify\/functions\/server)\/(lessons|user|progress)(\/|$)/.test(url.pathname)
    ) {

        event.respondWith(
            fetch(request)
                .then(response => {

                    if (response && response.status === 200) {

                        const responseClone = response.clone();

                        caches.open(LESSON_CACHE)
                            .then(cache => {
                                cache.put(request, responseClone);
                            });
                    }

                    return response;
                })
                .catch(() => {

                    console.log(
                        '[HanVerse SW] Offline. ' +
                        'Using cached lesson content.'
                    );

                    return caches.match(request)
                        .then(cachedResponse => {

                            if (cachedResponse) {
                                return cachedResponse;
                            }

                            return new Response(
                                JSON.stringify({
                                    success: false,
                                    error: 'You are offline and this lesson has not been downloaded yet. Open it once while connected.'
                                }),
                                {
                                    status: 503,
                                    headers: { 'Content-Type': 'application/json' }
                                }
                            );
                        });
                })
        );

        return;
    }


    // --------------------------------------------------------
    // Never cache API requests
    // --------------------------------------------------------

    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/.netlify/')) {
        return;
    }


    // --------------------------------------------------------
    // External resources
    // --------------------------------------------------------

    // Let external resources such as Google Fonts
    // be handled normally by the browser.
    if (url.origin !== self.location.origin) {
        return;
    }


    // --------------------------------------------------------
    // HTML / Navigation
    // NETWORK FIRST
    // --------------------------------------------------------

    //
    // This is the important part.
    //
    // Always try to get the newest HTML from Netlify first.
    //
    // Only use the cached page when the user is offline.
    //

    if (
        request.mode === 'navigate' ||
        url.pathname === '/' ||
        url.pathname.endsWith('.html')
    ) {

        event.respondWith(
            fetch(request)
                .then(response => {

                    if (
                        response &&
                        response.status === 200 &&
                        response.type === 'basic'
                    ) {

                        const responseClone =
                            response.clone();

                        caches.open(CACHE_NAME)
                            .then(cache => {
                                cache.put(
                                    request,
                                    responseClone
                                );
                            });
                    }

                    return response;
                })
                .catch(() => {

                    console.log(
                        '[HanVerse SW] Network unavailable. ' +
                        'Using cached HTML.'
                    );

                    return caches.match(request)
                        .then(cachedResponse => {

                            if (cachedResponse) {
                                return cachedResponse;
                            }

                            return caches.match(
                                '/offline.html'
                            );
                        });
                })
        );

        return;
    }


    // --------------------------------------------------------
    // STATIC ASSETS
    // CACHE FIRST
    // --------------------------------------------------------

    //
    // CSS, JS and images can safely use the cache-first
    // strategy because they are not the main HTML document.
    //

    event.respondWith(

        caches.match(request)
            .then(cachedResponse => {

                if (cachedResponse) {

                    // Return cached asset immediately
                    // while checking for an updated version.
                    fetch(request)
                        .then(networkResponse => {

                            if (
                                networkResponse &&
                                networkResponse.status === 200 &&
                                networkResponse.type === 'basic'
                            ) {

                                const responseClone =
                                    networkResponse.clone();

                                caches.open(CACHE_NAME)
                                    .then(cache => {

                                        cache.put(
                                            request,
                                            responseClone
                                        );
                                    });
                            }
                        })
                        .catch(() => {
                            // Network unavailable.
                            // Cached version is already available.
                        });

                    return cachedResponse;
                }


                // ------------------------------------------------
                // Asset isn't cached yet
                // ------------------------------------------------

                return fetch(request)
                    .then(networkResponse => {

                        if (
                            networkResponse &&
                            networkResponse.status === 200 &&
                            networkResponse.type === 'basic'
                        ) {

                            const responseClone =
                                networkResponse.clone();

                            caches.open(CACHE_NAME)
                                .then(cache => {

                                    cache.put(
                                        request,
                                        responseClone
                                    );
                                });
                        }

                        return networkResponse;
                    })
                    .catch(() => {

                        return new Response(
                            'HanVerse is currently offline.',
                            {
                                status: 503,
                                statusText: 'Offline'
                            }
                        );
                    });
            })
    );
});


// ============================================================
// MESSAGE HANDLER
// ============================================================

self.addEventListener('message', event => {

    if (!event.data) {
        return;
    }

    // Allow the website to force an immediate update
    if (event.data.type === 'SKIP_WAITING') {

        console.log(
            '[HanVerse SW] Skip waiting requested.'
        );

        self.skipWaiting();
    }
});


// ============================================================
// DEBUG
// ============================================================

console.log(
    '[HanVerse SW] Loaded:',
    CACHE_NAME
);