// ============================================
// FIREBASE CLOUD MESSAGING + CACHE SERVICE WORKER
// SW único para notificaciones push Y caché PWA.
// Versión: 2.0.0
// ============================================
// ROOT CAUSE FIX: antes existían dos SWs (firebase-messaging-sw.js y
// user-sw.js) compitiendo en el mismo scope (/). Eso provocaba que el
// token FCM apuntara a un SW pero las notificaciones llegaran al otro,
// invalidando todos los envíos. Ahora este es el único SW activo.
// ============================================

importScripts('https://www.gstatic.com/firebasejs/9.1.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.1.2/firebase-messaging-compat.js');

// ============================================
// CONFIGURACIÓN DE CACHÉ
// ============================================
const CACHE_VERSION = 'v5';
const CACHE_NAME = 'sala-juegos-fcm-' + CACHE_VERSION;

const PRECACHE_URLS = [
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png'
];

function isNetworkFirst(url) {
  return (
    url.endsWith('/') ||
    url.includes('/index.html') ||
    url.includes('/app.js') ||
    url.includes('/manifest.json')
  );
}

// ============================================
// CONFIGURACIÓN DE FIREBASE
// ============================================
const firebaseConfig = {
  apiKey: "AIzaSyAjZuVIxNY-SrnihkyNVupZ8AhXX6qxAxY",
  authDomain: "saladejuegos-673fa.firebaseapp.com",
  projectId: "saladejuegos-673fa",
  storageBucket: "saladejuegos-673fa.firebasestorage.app",
  messagingSenderId: "553123191180",
  appId: "1:553123191180:web:277eb460ef78dab8525ea9",
  measurementId: "G-3ZJRT0NCTE"
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

console.log('[FCM-SW] Firebase Messaging Service Worker v4 iniciado');

// ============================================
// NOTIFICACIONES EN BACKGROUND (FCM SDK)
// ============================================
messaging.onBackgroundMessage(function(payload) {
  console.log('[FCM-SW] Notificación en background:', payload);

  const notif = payload.notification || {};
  const webNotif = (payload.webpush && payload.webpush.notification) || {};

  const title = notif.title || webNotif.title || 'Sala de Juegos';
  const body  = notif.body  || webNotif.body  || 'Tienes un mensaje del soporte';
  const icon  = notif.icon  || webNotif.icon  || '/icons/icon-192x192.png';
  const badge = notif.badge || webNotif.badge || '/icons/icon-72x72.png';
  const tag   = (payload.data && payload.data.tag) || 'chat-message';

  const options = {
    body,
    icon,
    badge,
    tag,
    requireInteraction: false,
    data: payload.data || {},
    actions: [
      { action: 'open',  title: 'Abrir chat' },
      { action: 'close', title: 'Cerrar'     }
    ],
    vibrate: [200, 100, 200]
  };

  return self.registration.showNotification(title, options);
});

// ============================================
// CLICK EN NOTIFICACIÓN
// ============================================
self.addEventListener('notificationclick', function(event) {
  console.log('[FCM-SW] Click en notificación:', event.action);

  event.notification.close();

  if (event.action === 'close') return;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(function(clientList) {
        for (const client of clientList) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            return client.focus();
          }
        }
        if (clients.openWindow) {
          return clients.openWindow('/');
        }
      })
  );
});

// ============================================
// INSTALACIÓN
// ============================================
self.addEventListener('install', function(event) {
  console.log('[FCM-SW] Instalando', CACHE_VERSION);

  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(cache) {
        return cache.addAll(PRECACHE_URLS);
      })
      .catch(function(err) {
        console.log('[FCM-SW] Error al pre-cachear:', err);
      })
  );

  self.skipWaiting();
});

// ============================================
// ACTIVACIÓN
// ============================================
self.addEventListener('activate', function(event) {
  console.log('[FCM-SW] Activado', CACHE_VERSION);

  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames.map(function(name) {
          if (name !== CACHE_NAME) {
            console.log('[FCM-SW] Eliminando caché antiguo:', name);
            return caches.delete(name);
          }
        })
      );
    })
  );

  self.clients.claim();
});

// ============================================
// FETCH (ESTRATEGIA DE CACHÉ)
// ============================================
self.addEventListener('fetch', function(event) {
  if (event.request.method !== 'GET') return;

  const url = event.request.url;

  if (url.includes('/api/') || url.includes('/socket.io/')) return;

  if (isNetworkFirst(url)) {
    event.respondWith(
      fetch(event.request)
        .then(function(response) {
          if (response && response.status === 200 && response.type === 'basic') {
            var toCache = response.clone();
            caches.open(CACHE_NAME).then(function(cache) {
              cache.put(event.request, toCache);
            });
          }
          return response;
        })
        .catch(function() {
          return caches.match(event.request).then(function(cached) {
            if (cached) return cached;
            if (event.request.mode === 'navigate') return caches.match('/');
          });
        })
    );
  } else {
    event.respondWith(
      caches.match(event.request)
        .then(function(cached) {
          if (cached) return cached;
          return fetch(event.request).then(function(response) {
            if (response && response.status === 200 && response.type === 'basic') {
              var toCache = response.clone();
              caches.open(CACHE_NAME).then(function(cache) {
                cache.put(event.request, toCache);
              });
            }
            return response;
          });
        })
        .catch(function() {
          if (event.request.mode === 'navigate') return caches.match('/');
        })
    );
  }
});

// ============================================
// MENSAJES DESDE LA APP
// ============================================
self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
