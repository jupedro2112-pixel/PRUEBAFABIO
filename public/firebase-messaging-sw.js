// ============================================
// FIREBASE CLOUD MESSAGING - SERVICE WORKER
// Maneja notificaciones push en background
// ============================================
// Versión: 1.0.1 - Actualizado para evitar caché

importScripts('https://www.gstatic.com/firebasejs/9.1.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.1.2/firebase-messaging-compat.js');

// Configuración de Firebase
const firebaseConfig = {
  apiKey: "AIzaSyAjZuVIxNY-SrnihkyNVupZ8AhXX6qxAxY",
  authDomain: "saladejuegos-673fa.firebaseapp.com",
  projectId: "saladejuegos-673fa",
  storageBucket: "saladejuegos-673fa.firebasestorage.app",
  messagingSenderId: "553123191180",
  appId: "1:553123191180:web:277eb460ef78dab8525ea9",
  measurementId: "G-3ZJRT0NCTE"
};

// Inicializar Firebase
firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

console.log('[SW] Firebase Messaging Service Worker iniciado');

// ============================================
// MANEJAR NOTIFICACIONES EN BACKGROUND
// ============================================
messaging.onBackgroundMessage(function(payload) {
  console.log('[Firebase Messaging] Notificación recibida en background:', payload);
  
  const notificationTitle = payload.notification.title || 'Sala de Juegos';
  const notificationOptions = {
    body: payload.notification.body || 'Nueva notificación',
    icon: payload.notification.icon || '/icons/icon-192x192.png',
    badge: '/icons/icon-72x72.png',
    tag: payload.data?.tag || 'default',
    requireInteraction: false,
    data: payload.data || {}
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

// ============================================
// MANEJAR CLICK EN NOTIFICACIÓN
// ============================================
self.addEventListener('notificationclick', function(event) {
  console.log('[Firebase Messaging] Click en notificación:', event);
  
  event.notification.close();
  
  // Abrir o enfocar la aplicación
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(function(clientList) {
        // Si ya hay una ventana abierta, enfocarla
        for (let i = 0; i < clientList.length; i++) {
          const client = clientList[i];
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            return client.focus();
          }
        }
        // Si no hay ventana abierta, abrir una nueva
        if (clients.openWindow) {
          return clients.openWindow('/');
        }
      })
  );
});

// ============================================
// INSTALACIÓN DEL SERVICE WORKER
// ============================================
self.addEventListener('install', function(event) {
  console.log('[Firebase Messaging] Service Worker instalado');
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  console.log('[Firebase Messaging] Service Worker activado');
  event.waitUntil(clients.claim());
});
