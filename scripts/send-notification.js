#!/usr/bin/env node

// ============================================
// SCRIPT PARA ENVIAR NOTIFICACIONES PUSH
// Uso: node send-notification.js <fcm-token> "Título" "Mensaje"
// ============================================

const admin = require('firebase-admin');
const path = require('path');

// Cargar credenciales
const serviceAccount = require(path.join(__dirname, '../firebase-service-account.json'));

// Inicializar Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'saladejuegos-673fa'
});

// Obtener argumentos
const args = process.argv.slice(2);

if (args.length < 3) {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║         ENVIAR NOTIFICACIÓN PUSH - SALA DE JUEGOS          ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('Uso:');
  console.log('  node send-notification.js <fcm-token> "Título" "Mensaje"');
  console.log('');
  console.log('Ejemplo:');
  console.log('  node send-notification.js "fcm-token-aqui" "¡Hola!" "Tienes un nuevo mensaje"');
  console.log('');
  console.log('Para obtener el FCM Token:');
  console.log('  1. Abre la app en tu celular');
  console.log('  2. Abre la consola del navegador (chrome://inspect)');
  console.log('  3. Busca: "[FCM] Token obtenido:"');
  console.log('');
  process.exit(1);
}

const [fcmToken, title, body] = args;

console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║         ENVIANDO NOTIFICACIÓN PUSH...                      ║');
console.log('╚════════════════════════════════════════════════════════════╝');
console.log('');
console.log('📱 Token:', fcmToken.substring(0, 30) + '...');
console.log('📝 Título:', title);
console.log('💬 Mensaje:', body);
console.log('');

// Enviar notificación
const message = {
  notification: {
    title: title,
    body: body
  },
  data: {
    type: 'notification',
    timestamp: Date.now().toString(),
    click_action: 'FLUTTER_NOTIFICATION_CLICK'
  },
  token: fcmToken,
  android: {
    priority: 'high',
    notification: {
      sound: 'default',
      channelId: 'default_channel'
    }
  },
  apns: {
    payload: {
      aps: {
        sound: 'default',
        badge: 1
      }
    }
  }
};

admin.messaging().send(message)
  .then((response) => {
    console.log('✅ Notificación enviada exitosamente!');
    console.log('🆔 Message ID:', response);
    console.log('');
    console.log('📲 La notificación debería aparecer en tu celular en segundos.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Error al enviar notificación:');
    console.error(error.message);
    console.log('');
    console.log('💡 Posibles causas:');
    console.log('   - El FCM Token es inválido o ha expirado');
    console.log('   - El dispositivo no tiene conexión a internet');
    console.log('   - Las notificaciones están deshabilitadas en el dispositivo');
    process.exit(1);
  });
