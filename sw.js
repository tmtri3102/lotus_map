const CACHE_NAME = 'lotus-map-v2';
const ASSETS = [
  '/',
  '/index.html',
  '/demo.geojson',
  '/style.css',
  '/main.js',
  'https://api.mapbox.com/mapbox-gl-js/v3.20.0/mapbox-gl.css',
  'https://api.mapbox.com/mapbox-gl-js/v3.20.0/mapbox-gl.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

self.addEventListener('fetch', (event) => {
  if (!event.request.url.startsWith('http')) return;
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;
      return fetch(event.request).then((response) => {
        // Only cache Mapbox Tiles / Assets or our own api to save requests. 
        // We will omit eleven labs from SW cache initially to prevent heavy bloat or TTS cache issues since using S3
        if (event.request.url.includes("mapbox.com") || event.request.url.includes("lotus-map")) {
           const cloned = response.clone();
           caches.open(CACHE_NAME).then((cache) => cache.put(event.request, cloned));
        }
        return response;
      });
    })
  );
});
