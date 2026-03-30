
/**
 * Service Worker para Usuario - Sala de Juegos
 * Maneja notificaciones push cuando el admin envía mensajes
 *
 * IMPORTANTE: Incrementar CACHE_VERSION en cada deploy para forzar
 * la invalidación del caché en dispositivos con la app instalada.
 */

// Bump this version with every deploy so installed PWAs always pick up fresh
// code from the server instead of serving stale cached files.
const CACHE_VERSION = 'v3';
const CACHE_NAME = 'sala-juegos-user-' + CACHE_VERSION;

// Only pre-cache stable assets (icons rarely change).
// Main app files (app.js, index.html) are fetched network-first on every
// request so a redeploy is always visible immediately.
const PRECACHE_URLS = [
    '/icons/icon-192x192.png',
    '/icons/icon-512x512.png'
];

// Files that must always be served fresh from the network (network-first).
// This prevents the installed PWA from running stale app.js after a redeploy.
function isNetworkFirst(url) {
    return (
        url.endsWith('/') ||
        url.includes('/index.html') ||
        url.includes('/app.js') ||
        url.includes('/manifest.json')
    );
}

// Instalación del Service Worker
self.addEventListener('install', (event) => {
    console.log('[SW-User] Instalando Service Worker', CACHE_VERSION);
    
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('[SW-User] Pre-cacheando recursos estables');
                return cache.addAll(PRECACHE_URLS);
            })
            .catch((err) => {
                console.log('[SW-User] Error al pre-cachear:', err);
            })
    );
    
    // Activate immediately so new version takes effect without waiting for all
    // tabs to close.
    self.skipWaiting();
});

// Activación del Service Worker
self.addEventListener('activate', (event) => {
    console.log('[SW-User] Service Worker activado', CACHE_VERSION);
    
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    // Delete ALL old caches so stale app.js/index.html is cleared
                    // on every new version deployment.
                    if (cacheName !== CACHE_NAME) {
                        console.log('[SW-User] Eliminando cache antiguo:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    
    self.clients.claim();
});

// Interceptar fetch requests
self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') {
        return;
    }
    
    // Never intercept API or socket.io requests.
    if (event.request.url.includes('/api/') || 
        event.request.url.includes('/socket.io/')) {
        return;
    }

    const url = event.request.url;

    if (isNetworkFirst(url)) {
        // Network-first: always try the network so deploys are visible immediately.
        // Fall back to cache only when completely offline.
        event.respondWith(
            fetch(event.request)
                .then((response) => {
                    if (response && response.status === 200 && response.type === 'basic') {
                        // Only cache same-origin ('basic') responses.
                        // Opaque cross-origin responses are excluded intentionally
                        // to avoid caching errors or security issues.
                        const responseToCache = response.clone();
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(event.request, responseToCache);
                        });
                    }
                    return response;
                })
                .catch(() => {
                    return caches.match(event.request).then((cached) => {
                        if (cached) return cached;
                        if (event.request.mode === 'navigate') {
                            return caches.match('/');
                        }
                    });
                })
        );
    } else {
        // Cache-first for stable assets (icons, fonts).
        event.respondWith(
            caches.match(event.request)
                .then((response) => {
                    if (response) {
                        return response;
                    }
                    return fetch(event.request).then((networkResponse) => {
                        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
                            const toCache = networkResponse.clone();
                            caches.open(CACHE_NAME).then((cache) => {
                                cache.put(event.request, toCache);
                            });
                        }
                        return networkResponse;
                    });
                })
                .catch(() => {
                    if (event.request.mode === 'navigate') {
                        return caches.match('/');
                    }
                })
        );
    }
});

// Manejar notificaciones push
// Supports both legacy format (payload.title/body) and FCM format
// (payload.notification.title/body) so push notifications work correctly
// in Chrome for Android whether the FCM SDK is active or not.
self.addEventListener('push', (event) => {
    console.log('[SW-User] Push recibido:', event);
    
    let title = '💬 Sala de Juegos';
    let body = 'Tienes un nuevo mensaje del soporte';
    let icon = '/icons/icon-192x192.png';
    let badge = '/icons/icon-72x72.png';
    let tag = 'chat-message';
    let extraData = {};

    try {
        const payload = event.data.json();

        // FCM sends { notification: { title, body }, data: {...} }
        // Legacy sends { title, body, ... } directly
        const notif = payload.notification || {};
        const webpushNotif = (payload.webpush && payload.webpush.notification) || {};

        title = notif.title || webpushNotif.title || payload.title || title;
        body = notif.body || webpushNotif.body || payload.body || body;
        icon = notif.icon || webpushNotif.icon || payload.icon || icon;
        badge = notif.badge || webpushNotif.badge || payload.badge || badge;
        tag = (payload.data && payload.data.tag) || payload.tag || tag;
        extraData = payload.data || {};
    } catch (e) {
        try { body = event.data.text(); } catch (_) {}
    }
    
    const options = {
        body,
        icon,
        badge,
        tag,
        requireInteraction: false,
        data: extraData,
        actions: [
            { action: 'open', title: 'Abrir chat' },
            { action: 'close', title: 'Cerrar' }
        ],
        vibrate: [200, 100, 200]
    };
    
    event.waitUntil(
        self.registration.showNotification(title, options)
    );
});

// Manejar click en notificación
self.addEventListener('notificationclick', (event) => {
    console.log('[SW-User] Click en notificación:', event);
    
    event.notification.close();
    
    if (event.action === 'close') {
        return;
    }
    
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then((clientList) => {
                for (const client of clientList) {
                    if (client.url === '/' || client.url.includes('sala')) {
                        return client.focus();
                    }
                }
                if (clients.openWindow) {
                    return clients.openWindow('/');
                }
            })
    );
});

// Escuchar mensajes desde la app
self.addEventListener('message', (event) => {
    console.log('[SW-User] Mensaje recibido:', event.data);
    
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

console.log('[SW-User] Service Worker cargado', CACHE_VERSION);

