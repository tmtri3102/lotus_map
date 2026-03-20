const CACHE_NAME = 'lotus-map-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/export_test.geojson',
  'https://unpkg.com/maplibre-gl@5.9.0/dist/maplibre-gl.css',
  'https://unpkg.com/maplibre-gl@5.9.0/dist/maplibre-gl.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      // Return cached response right away if found
      if (cachedResponse) return cachedResponse;
      
      // Otherwise fetch and update cache
      return fetch(event.request).then((response) => {
        return caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, response.clone());
          return response;
        });
      });
    })
  );
});
