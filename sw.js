const CACHE_NAME = 'smartinventory-app-v5.0';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './style.css',
    './script.js',
    './manifest.json',
    './assets/scanner-beep.wav',
    'https://cdn.tailwindcss.com',
    'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
    'https://cdn.jsdelivr.net/npm/chart.js',
    'https://unpkg.com/@zxing/library@0.21.3/umd/index.min.js',
    'https://cdn.sheetjs.com/xlsx-latest/package/dist/xlsx.full.min.js',
    'https://cdn.jsdelivr.net/npm/sweetalert2@11'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                // Hacemos fetch a cada recurso y lo ponemos en caché.
                // Usamos allSettled para no fallar todo el caché si un CDN externo falla.
                return Promise.allSettled(
                    ASSETS_TO_CACHE.map(url => {
                        return fetch(url).then(response => {
                            if (!response.ok) throw new Error(`Request failed for ${url}`);
                            return cache.put(url, response);
                        });
                    })
                );
            })
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    const cacheWhitelist = [CACHE_NAME];
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheWhitelist.indexOf(cacheName) === -1) {
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    // Solo cacheamos GET requests
    if (event.request.method !== 'GET') return;

    event.respondWith(
        caches.match(event.request)
            .then(cachedResponse => {
                // Estrategia: Cache First para assets, pero siempre intenta red si no está
                if (cachedResponse) {
                    return cachedResponse;
                }

                return fetch(event.request).catch(() => {
                    // Fallback para navegación offline si se intenta cargar una ruta de la SPA
                    if (event.request.mode === 'navigate' ||
                        (event.request.method === 'GET' && event.request.headers.get('accept').includes('text/html'))) {
                        return caches.match('./index.html');
                    }
                });
            })
    );
});
