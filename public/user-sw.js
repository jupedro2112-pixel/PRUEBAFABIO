
/**
 * Service Worker para Usuario - Sala de Juegos
 * Maneja notificaciones push cuando el admin envía mensajes
 */

const CACHE_NAME = 'sala-juegos-user-v1';
const urlsToCache = [
    '/',
    '/index.html',
    '/app.js',
    '/icons/icon-192x192.png',
    '/icons/icon-512x512.png'
];

// Instalación del Service Worker
self.addEventListener('install', (event) => {
    console.log('[SW-User] Instalando Service Worker...');
    
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('[SW-User] Cache abierto');
                return cache.addAll(urlsToCache);
            })
            .catch((err) => {
                console.log('[SW-User] Error al cachear:', err);
            })
    );
    
    self.skipWaiting();
});

// Activación del Service Worker
self.addEventListener('activate', (event) => {
    console.log('[SW-User] Service Worker activado');
    
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
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
    
    if (event.request.url.includes('/api/') || 
        event.request.url.includes('/socket.io/')) {
        return;
    }
    
    event.respondWith(
        caches.match(event.request)
            .then((response) => {
                if (response) {
                    return response;
                }
                return fetch(event.request);
            })
            .catch(() => {
                if (event.request.mode === 'navigate') {
                    return caches.match('/');
                }
            })
    );
});

// Manejar notificaciones push
self.addEventListener('push', (event) => {
    console.log('[SW-User] Push recibido:', event);
    
    let data = {};
    try {
        data = event.data.json();
    } catch (e) {
        data = {
            title: 'Nuevo mensaje',
            body: event.data.text(),
            icon: '/icons/icon-192x192.png'
        };
    }
    
    const options = {
        body: data.body || 'Tienes un nuevo mensaje del soporte',
        icon: data.icon || '/icons/icon-192x192.png',
        badge: data.badge || '/icons/icon-72x72.png',
        tag: data.tag || 'chat-message',
        requireInteraction: false,
        data: data.data || {},
        actions: [
            {
                action: 'open',
                title: 'Abrir chat'
            },
            {
                action: 'close',
                title: 'Cerrar'
            }
        ],
        vibrate: [200, 100, 200]
    };
    
    event.waitUntil(
        self.registration.showNotification(data.title || '💬 Sala de Juegos', options)
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
    
    if (event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

console.log('[SW-User] Service Worker cargado');
