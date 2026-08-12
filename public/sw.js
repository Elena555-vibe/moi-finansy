const CACHE = 'moi-finansy-v6';
// Relative paths keep the offline shell inside the GitHub Pages project URL.
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon.png', './runtime-config.js'];
self.addEventListener('install', (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', (event) => event.waitUntil(
  caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('moi-finansy-') && key !== CACHE).map((key) => caches.delete(key))))
    .then(() => self.clients.claim()),
));
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  // The app shell must refresh after a deployment. Cached data remains a
  // fallback, so the PWA still opens offline without trapping an old bundle.
  if (event.request.mode === 'navigate' || event.request.url.endsWith('/index.html')) {
    event.respondWith(fetch(event.request).then((response) => {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(event.request, copy));
      return response;
    }).catch(() => caches.open(CACHE).then((cache) => cache.match(event.request).then((cached) => cached || cache.match('./index.html')))));
    return;
  }
  event.respondWith(caches.open(CACHE).then((cache) => cache.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
    const copy = response.clone();
    cache.put(event.request, copy);
    return response;
  }).catch(() => cache.match('./index.html')))));
});
