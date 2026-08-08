const CACHE_NAME = 'nutrisageai-cache-v12';

// Paths relative to the service worker scope (docs/), so they don't break if the
// GitHub Pages project path changes.
const urlsToCache = [
    './',
    './index.html',
    './styles.css',
    './macros.js',
    './script.js',
    './manifest.json',
    './images/favicon_io/android-chrome-192x192.png',
    './images/favicon_io/android-chrome-512x512.png',
    './images/favicon_io/apple-touch-icon.png',
    './images/favicon_io/favicon.ico'
];

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) =>
            cache.addAll(urlsToCache).catch((error) =>
                console.error('Failed to add URLs to cache', error)
            )
        )
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((names) => Promise.all(
                names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
            ))
            .then(() => self.clients.claim())
    );
});

// Network-first for same-origin GETs: returning users get fresh assets on deploy,
// and fall back to cache only when offline. Cross-origin (the macro API) is left alone.
self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) {
        return;
    }
    event.respondWith(
        fetch(request)
            .then((response) => {
                const copy = response.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
                return response;
            })
            .catch(() => caches.match(request))
    );
});
