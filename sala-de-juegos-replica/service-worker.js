const CACHE_NAME = 'sala-juegos-chat-v1.7';
const urlsToCache = [
  '/',
  'manifest.json',
  'icons/icon-192x192.png',
  'icons/icon-512x512.png'
];

// Instalación del Service Worker
self.addEventListener('install', (event) => {
  console.log('🔧 Service Worker: Instalando...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('📦 Service Worker: Cache abierto');
        return cache.addAll(urlsToCache);
      })
      .catch((error) => {
        console.error('❌ Error cacheando recursos:', error);
      })
  );
  self.skipWaiting();
});

// Activación del Service Worker
self.addEventListener('activate', (event) => {
  console.log('🚀 Service Worker: Activando...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('🗑️ Service Worker: Eliminando cache antigua:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Estrategia de fetch
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // No interceptar socket.io ni APIs
  if (url.pathname.includes('socket.io') || 
      url.pathname.includes('/api/') ||
      url.pathname.includes('/webhook') ||
      url.pathname.includes('/proxy/')) {
    return;
  }
  
  // Para recursos estáticos: Cache First
  if (url.pathname.includes('icons/') || 
      url.pathname === 'manifest.json') {
    event.respondWith(
      caches.match(event.request)
        .then((response) => {
          return response || fetch(event.request);
        })
    );
    return;
  }
  
  // Para la página principal: Network First
  if (url.pathname === '/' || url.pathname === '/index.html') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME)
              .then((cache) => {
                cache.put(event.request, responseClone);
              });
          }
          return response;
        })
        .catch(() => {
          return caches.match(event.request)
            .then((cachedResponse) => {
              if (cachedResponse) {
                return cachedResponse;
              }
              return new Response(`
                <!DOCTYPE html>
                <html>
                <head>
                  <title>Sin Conexión - Sala de Juegos</title>
                  <meta name="viewport" content="width=device-width, initial-scale=1.0">
                  <style>
                    body { 
                      font-family: Arial, sans-serif; 
                      text-align: center; 
                      padding: 50px; 
                      background: #0f0f0f; 
                      color: white; 
                    }
                    .offline-icon { font-size: 4em; margin-bottom: 20px; }
                    .retry-btn { 
                      background: #00ff88; 
                      color: black; 
                      padding: 15px 30px; 
                      border: none; 
                      border-radius: 25px; 
                      font-size: 16px; 
                      cursor: pointer; 
                      margin-top: 20px;
                    }
                  </style>
                </head>
                <body>
                  <div class="offline-icon">📱</div>
                  <h1>🎮 Sala de Juegos</h1>
                  <h2>Sin conexión a internet</h2>
                  <p>Por favor verifica tu conexión e intenta nuevamente.</p>
                  <button class="retry-btn" onclick="window.location.reload()">
                    🔄 Intentar de nuevo
                  </button>
                </body>
                </html>
              `, {
                headers: { 'Content-Type': 'text/html' }
              });
            });
        })
    );
  }
});

console.log('🎮 Service Worker de Sala de Juegos cargado correctamente');
