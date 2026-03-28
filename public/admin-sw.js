
/**
 * Service Worker para Admin Panel - Sala de Juegos
 * Maneja notificaciones push y caché de la app
 */

const CACHE_NAME = 'admin-sala-v1';
const urlsToCache = [
    '/adminprivado2026/',
    '/adminprivado2026/admin.css',
    '/adminprivado2026/admin.js',
    '/adminprivado2026/manifest.json'
];

// Instalación del Service Worker
self.addEventListener('install', (event) => {
    console.log('[SW] Instalando Service Worker...');
    
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('[SW] Cache abierto');
                return cache.addAll(urlsToCache);
            })
            .catch((err) => {
                console.log('[SW] Error al cachear:', err);
            })
    );
    
    // Activar inmediatamente
    self.skipWaiting();
});

// Activación del Service Worker
self.addEventListener('activate', (event) => {
    console.log('[SW] Service Worker activado');
    
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('[SW] Eliminando cache antiguo:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    
    // Tomar control de todas las páginas
    self.clients.claim();
});

// Interceptar fetch requests
self.addEventListener('fetch', (event) => {
    // Solo cachear requests GET de la app admin
    if (event.request.method !== 'GET') {
        return;
    }
    
    // No cachear requests de API o socket.io
    if (event.request.url.includes('/api/') || 
        event.request.url.includes('/socket.io/')) {
        return;
    }
    
    event.respondWith(
        caches.match(event.request)
            .then((response) => {
                // Cache hit - retornar respuesta cacheada
                if (response) {
                    return response;
                }
                
                // Fetch desde la red
                return fetch(event.request)
                    .then((response) => {
                        // No cachear si no es válida
                        if (!response || response.status !== 200 || response.type !== 'basic') {
                            return response;
                        }
                        
                        // Clonar respuesta para cachear
                        const responseToCache = response.clone();
                        
                        caches.open(CACHE_NAME)
                            .then((cache) => {
                                cache.put(event.request, responseToCache);
                            });
                        
                        return response;
                    });
            })
            .catch(() => {
                // Fallback si está offline
                if (event.request.mode === 'navigate') {
                    return caches.match('/adminprivado2026/');
                }
            })
    );
});

// Manejar notificaciones push
self.addEventListener('push', (event) => {
    console.log('[SW] Push recibido:', event);
    
    let data = {};
    try {
        data = event.data.json();
    } catch (e) {
        data = {
            title: 'Nueva notificación',
            body: event.data.text(),
            icon: '/icons/icon-192x192.png'
        };
    }
    
    const options = {
        body: data.body || 'Tienes un nuevo mensaje',
        icon: data.icon || '/icons/icon-192x192.png',
        badge: data.badge || '/icons/icon-72x72.png',
        tag: data.tag || 'default',
        requireInteraction: data.requireInteraction || false,
        data: data.data || {},
        actions: data.actions || [
            {
                action: 'open',
                title: 'Abrir'
            },
            {
                action: 'close',
                title: 'Cerrar'
            }
        ]
    };
    
    event.waitUntil(
        self.registration.showNotification(data.title || 'Admin Sala', options)
    );
});

// Manejar click en notificación
self.addEventListener('notificationclick', (event) => {
    console.log('[SW] Click en notificación:', event);
    
    event.notification.close();
    
    const notificationData = event.notification.data;
    let url = '/adminprivado2026/';
    
    if (notificationData && notificationData.url) {
        url = notificationData.url;
    }
    
    if (event.action === 'close') {
        return;
    }
    
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then((clientList) => {
                // Si ya hay una ventana abierta, enfocarla
                for (const client of clientList) {
                    if (client.url.includes('/adminprivado2026/') && 'focus' in client) {
                        return client.focus();
                    }
                }
                // Si no, abrir nueva ventana
                if (clients.openWindow) {
                    return clients.openWindow(url);
                }
            })
    );
});

// Escuchar mensajes desde la app
self.addEventListener('message', (event) => {
    console.log('[SW] Mensaje recibido:', event.data);
    
    if (event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
    
    if (event.data.type === 'SHOW_NOTIFICATION') {
        self.registration.showNotification(event.data.title, {
            body: event.data.body,
            icon: event.data.icon || '/icons/icon-192x192.png',
            badge: event.data.badge || '/icons/icon-72x72.png',
            tag: event.data.tag || 'default',
            data: event.data.data || {}
        });
    }
});

// Sincronización en background (para mensajes pendientes)
self.addEventListener('sync', (event) => {
    if (event.tag === 'sync-messages') {
        console.log('[SW] Sincronización de mensajes');
        event.waitUntil(syncPendingMessages());
    }
});

// Función para sincronizar mensajes pendientes
async function syncPendingMessages() {
    // Esta función se conectaría con la API para enviar mensajes pendientes
    console.log('[SW] Sincronizando mensajes pendientes...');
}

console.log('[SW] Service Worker cargado');
