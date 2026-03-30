// ============================================
// SERVICIO DE NOTIFICACIONES PUSH - FCM
// ============================================

const admin = require('firebase-admin');
const path = require('path');

// Variable para tracking de inicialización
let isInitialized = false;

// ============================================
// HELPER: DETECTAR TOKEN INVÁLIDO/NO REGISTRADO
// Cubre todos los códigos de error que FCM devuelve para
// tokens que ya no son válidos y deben borrarse de la BD.
// ROOT CAUSE FIX (Issue #3): anteriormente solo se detectaban
// algunos errores. Ahora se cubren también 'unregistered',
// 'UNREGISTERED', 'invalid-argument', y variaciones de case.
// ============================================
function isInvalidTokenError(errorMsg, errorCode) {
  const msg  = (errorMsg  || '').toLowerCase();
  const code = (errorCode || '').toLowerCase();
  return (
    msg.includes('registration-token-not-registered') ||
    msg.includes('invalid-registration-token')        ||
    msg.includes('requested entity was not found')    ||
    msg.includes('notregistered')                     ||
    msg.includes('not_registered')                    ||
    msg.includes('unregistered')                      ||
    msg.includes('mismatched-credential')             ||
    code.includes('registration-token-not-registered') ||
    code.includes('invalid-registration-token')        ||
    code.includes('unregistered')                      ||
    code === 'messaging/invalid-argument'
  );
}

// ============================================
// INICIALIZAR FIREBASE ADMIN
// ============================================
function initializeFirebase() {
  if (isInitialized) {
    console.log('[FCM] Firebase Admin ya inicializado');
    return true;
  }

  try {
    // Buscar el archivo de credenciales
    const serviceAccountPath = path.join(__dirname, '../../firebase-service-account.json');
    
    // Verificar si existe el archivo
    const fs = require('fs');
    if (!fs.existsSync(serviceAccountPath)) {
      console.error('[FCM] ❌ No se encontró firebase-service-account.json');
      console.error('[FCM] Asegúrate de colocar el archivo en la raíz del proyecto');
      return false;
    }

    // Cargar credenciales
    const serviceAccount = require(serviceAccountPath);

    // Inicializar Firebase Admin
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: 'saladejuegos-673fa'
    });

    isInitialized = true;
    console.log('[FCM] ✅ Firebase Admin inicializado correctamente');
    return true;
  } catch (error) {
    console.error('[FCM] ❌ Error al inicializar Firebase Admin:', error.message);
    return false;
  }
}

// ============================================
// ENVIAR NOTIFICACIÓN A UN USUARIO
// ============================================
async function sendNotificationToUser(fcmToken, title, body, data = {}) {
  if (!isInitialized) {
    const initialized = initializeFirebase();
    if (!initialized) {
      return { success: false, error: 'Firebase Admin no inicializado' };
    }
  }

  try {
    console.log('[FCM] Enviando notificación...');
    console.log('[FCM] Token preview:', fcmToken ? fcmToken.substring(0, 30) + '...' : 'null');
    console.log('[FCM] Título:', title);
    console.log('[FCM] Cuerpo:', body);

    const message = {
      notification: {
        title: title,
        body: body
      },
      data: {
        ...data,
        click_action: 'FLUTTER_NOTIFICATION_CLICK',
        sound: 'default'
      },
      token: fcmToken,
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          channelId: 'default_channel',
          priority: 'high'
        }
      },
      apns: {
        payload: {
          aps: {
            alert: {
              title: title,
              body: body
            },
            sound: 'default',
            badge: 1
          }
        },
        headers: {
          'apns-priority': '10'
        }
      },
      webpush: {
        notification: {
          title: title,
          body: body,
          icon: '/icons/icon-192x192.png',
          badge: '/icons/icon-72x72.png',
          requireInteraction: true,
          vibrate: [200, 100, 200]
        },
        fcm_options: {
          link: '/'
        }
      }
    };

    const response = await admin.messaging().send(message);
    console.log('[FCM] ✅ Notificación enviada exitosamente:', response);
    return { success: true, messageId: response };
  } catch (error) {
    console.error('[FCM] ❌ Error al enviar notificación:', error.message);
    console.error('[FCM] Error code:', error.code);
    console.error('[FCM] Error details:', error);
    return { 
      success: false, 
      error: error.message, 
      code: error.code,
      // Indicar explícitamente si el token debe borrarse
      invalidToken: isInvalidTokenError(error.message, error.code)
    };
  }
}

// ============================================
// ENVIAR NOTIFICACIÓN A MÚLTIPLES USUARIOS
// ============================================
async function sendNotificationToMultiple(fcmTokens, title, body, data = {}) {
  if (!isInitialized) {
    const initialized = initializeFirebase();
    if (!initialized) {
      return { success: false, error: 'Firebase Admin no inicializado' };
    }
  }

  try {
    // Crear mensajes individuales para cada token
    const messages = fcmTokens.map(token => ({
      notification: {
        title: title,
        body: body
      },
      data: {
        ...data,
        click_action: 'FLUTTER_NOTIFICATION_CLICK',
        sound: 'default'
      },
      token: token,
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
    }));

    // Usar sendEach (método nuevo) o sendAll (método antiguo)
    let response;
    if (admin.messaging().sendEach) {
      // Firebase Admin SDK v11+
      response = await admin.messaging().sendEach(messages);
    } else if (admin.messaging().sendAll) {
      // Firebase Admin SDK v10
      response = await admin.messaging().sendAll(messages);
    } else {
      // Fallback: enviar uno por uno
      const results = [];
      for (const message of messages) {
        try {
          await admin.messaging().send(message);
          results.push({ success: true });
        } catch (e) {
          results.push({ success: false, error: e });
        }
      }
      response = {
        successCount: results.filter(r => r.success).length,
        failureCount: results.filter(r => !r.success).length,
        responses: results
      };
    }

    console.log(`[FCM] ✅ Notificaciones enviadas: ${response.successCount} exitosas, ${response.failureCount} fallidas`);

    // Identificar tokens inválidos para que el caller pueda limpiarlos.
    // Nota: Firebase Admin SDK garantiza que responses[i] corresponde a messages[i]
    // (ver documentación de sendEach/sendAll: la respuesta conserva el orden de entrada).
    const invalidTokens = [];
    if (response.responses) {
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          const errorMsg  = resp.error?.message || 'Error desconocido';
          const errorCode = resp.error?.code    || '';
          if (isInvalidTokenError(errorMsg, errorCode)) {
            invalidTokens.push(fcmTokens[idx]);
          }
        }
      });
    }

    return { 
      success: true, 
      successCount: response.successCount,
      failureCount: response.failureCount,
      responses: response.responses,
      invalidTokens  // lista de tokens que deben borrarse
    };
  } catch (error) {
    console.error('[FCM] ❌ Error al enviar notificaciones:', error.message);
    return { success: false, error: error.message };
  }
}

// ============================================
// ENVIAR NOTIFICACIÓN A TÓPICO
// ============================================
async function sendNotificationToTopic(topic, title, body, data = {}) {
  if (!isInitialized) {
    const initialized = initializeFirebase();
    if (!initialized) {
      return { success: false, error: 'Firebase Admin no inicializado' };
    }
  }

  try {
    const message = {
      notification: {
        title: title,
        body: body
      },
      data: {
        ...data,
        click_action: 'FLUTTER_NOTIFICATION_CLICK',
        sound: 'default'
      },
      topic: topic,
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

    const response = await admin.messaging().send(message);
    console.log('[FCM] ✅ Notificación enviada al tópico:', response);
    return { success: true, messageId: response };
  } catch (error) {
    console.error('[FCM] ❌ Error al enviar notificación al tópico:', error.message);
    return { success: false, error: error.message };
  }
}

// ============================================
// SUSCRIBIR USUARIO A TÓPICO
// ============================================
async function subscribeToTopic(fcmToken, topic) {
  if (!isInitialized) {
    const initialized = initializeFirebase();
    if (!initialized) {
      return { success: false, error: 'Firebase Admin no inicializado' };
    }
  }

  try {
    const response = await admin.messaging().subscribeToTopic([fcmToken], topic);
    console.log(`[FCM] ✅ Suscripción exitosa al tópico ${topic}:`, response);
    return { success: true, response };
  } catch (error) {
    console.error('[FCM] ❌ Error al suscribir al tópico:', error.message);
    return { success: false, error: error.message };
  }
}

// ============================================
// DESUSCRIBIR USUARIO DE TÓPICO
// ============================================
async function unsubscribeFromTopic(fcmToken, topic) {
  if (!isInitialized) {
    const initialized = initializeFirebase();
    if (!initialized) {
      return { success: false, error: 'Firebase Admin no inicializado' };
    }
  }

  try {
    const response = await admin.messaging().unsubscribeFromTopic([fcmToken], topic);
    console.log(`[FCM] ✅ Desuscripción exitosa del tópico ${topic}:`, response);
    return { success: true, response };
  } catch (error) {
    console.error('[FCM] ❌ Error al desuscribir del tópico:', error.message);
    return { success: false, error: error.message };
  }
}

// ============================================
// ENVIAR NOTIFICACIÓN MASIVA A TODOS LOS USUARIOS
// ============================================
async function sendNotificationToAllUsers(UserModel, title, body, data = {}, filter = {}) {
  if (!isInitialized) {
    const initialized = initializeFirebase();
    if (!initialized) {
      return { success: false, error: 'Firebase Admin no inicializado' };
    }
  }

  try {
    // Buscar todos los usuarios que tienen fcmToken
    const query = { 
      fcmToken: { $exists: true, $ne: null },
      ...filter
    };
    
    const users = await UserModel.find(query).select('fcmToken username').lean();
    
    if (users.length === 0) {
      return { success: false, error: 'No hay usuarios con tokens FCM registrados' };
    }

    console.log(`[FCM] Enviando notificación a ${users.length} usuarios...`);

    // Firebase permite enviar hasta 500 mensajes por solicitud con sendEach
    const BATCH_SIZE = 500;
    let totalSuccess = 0;
    let totalFailure = 0;
    const failedTokens = [];

    for (let i = 0; i < users.length; i += BATCH_SIZE) {
      const batch = users.slice(i, i + BATCH_SIZE);
      
      // Crear mensajes individuales para cada token
      const messages = batch.map(u => ({
        notification: {
          title: title,
          body: body
        },
        data: {
          ...data,
          click_action: 'FLUTTER_NOTIFICATION_CLICK',
          sound: 'default'
        },
        token: u.fcmToken,
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
      }));

      let response;
      
      // Usar el método disponible según la versión de Firebase Admin
      if (admin.messaging().sendEach) {
        // Firebase Admin SDK v11+
        response = await admin.messaging().sendEach(messages);
      } else if (admin.messaging().sendAll) {
        // Firebase Admin SDK v10
        response = await admin.messaging().sendAll(messages);
      } else {
        // Fallback: enviar uno por uno
        const results = [];
        for (const message of messages) {
          try {
            await admin.messaging().send(message);
            results.push({ success: true });
          } catch (e) {
            results.push({ success: false, error: e });
          }
        }
        response = {
          successCount: results.filter(r => r.success).length,
          failureCount: results.filter(r => !r.success).length,
          responses: results
        };
      }

      totalSuccess += response.successCount;
      totalFailure += response.failureCount;

      // Registrar tokens fallidos y borrar los inválidos automáticamente
      const tokensToDelete = [];
      if (response.responses) {
        response.responses.forEach((resp, idx) => {
          if (!resp.success) {
            const errorMsg  = resp.error?.message || 'Error desconocido';
            const errorCode = resp.error?.code    || '';
            
            failedTokens.push({
              token: batch[idx].fcmToken,
              username: batch[idx].username,
              error: errorMsg,
              code: errorCode
            });
            
            // Usar el helper compartido para detectar todos los tipos de token inválido
            if (isInvalidTokenError(errorMsg, errorCode)) {
              tokensToDelete.push({
                username: batch[idx].username,
                token: batch[idx].fcmToken
              });
            }
          }
        });
      }

      // Borrar tokens inválidos de la base de datos
      if (tokensToDelete.length > 0) {
        console.log(`[FCM] 🧹 Borrando ${tokensToDelete.length} tokens inválidos...`);
        for (const item of tokensToDelete) {
          try {
            await UserModel.updateOne(
              { username: item.username },
              { $set: { fcmToken: null, fcmTokenUpdatedAt: null } }
            );
            console.log(`[FCM] 🗑️ Token borrado para: ${item.username}`);
          } catch (e) {
            console.error(`[FCM] ❌ Error borrando token de ${item.username}:`, e.message);
          }
        }
      }

      console.log(`[FCM] Lote ${Math.floor(i / BATCH_SIZE) + 1}: ${response.successCount} exitosas, ${response.failureCount} fallidas`);
    }

    console.log(`[FCM] ✅ Total: ${totalSuccess} exitosas, ${totalFailure} fallidas de ${users.length} usuarios`);
    
    return { 
      success: true, 
      totalUsers: users.length,
      successCount: totalSuccess,
      failureCount: totalFailure,
      failedTokens: failedTokens.slice(0, 10), // Solo mostrar los primeros 10 errores
      cleanedTokens: failedTokens.filter(t => 
        t.error.includes('NotRegistered') || 
        t.error.includes('Requested entity was not found')
      ).length
    };
  } catch (error) {
    console.error('[FCM] ❌ Error al enviar notificaciones masivas:', error.message);
    return { success: false, error: error.message };
  }
}

// ============================================
// ENVIAR NOTIFICACIÓN A USUARIOS ESPECÍFICOS POR USERNAME
// ============================================
async function sendNotificationToUsernames(UserModel, usernames, title, body, data = {}) {
  if (!isInitialized) {
    const initialized = initializeFirebase();
    if (!initialized) {
      return { success: false, error: 'Firebase Admin no inicializado' };
    }
  }

  try {
    // Buscar usuarios por username
    const users = await UserModel.find({
      username: { $in: usernames },
      fcmToken: { $exists: true, $ne: null }
    }).select('fcmToken username').lean();

    if (users.length === 0) {
      return { success: false, error: 'Ninguno de los usuarios tiene token FCM' };
    }

    const tokens = users.map(u => u.fcmToken);
    
    console.log(`[FCM] Enviando notificación a ${users.length} usuarios específicos...`);

    const result = await sendNotificationToMultiple(tokens, title, body, data);
    result.targetUsers = users.map(u => u.username);

    // Limpiar tokens inválidos detectados por sendNotificationToMultiple
    if (result.invalidTokens && result.invalidTokens.length > 0) {
      console.log(`[FCM] 🧹 Borrando ${result.invalidTokens.length} tokens inválidos de usuarios específicos...`);
      for (const badToken of result.invalidTokens) {
        try {
          await UserModel.updateOne(
            { fcmToken: badToken },
            { $set: { fcmToken: null, fcmTokenUpdatedAt: null } }
          );
          console.log(`[FCM] 🗑️ Token inválido borrado: ${badToken.substring(0, 20)}...`);
        } catch (e) {
          console.error(`[FCM] ❌ Error borrando token inválido:`, e.message);
        }
      }
      result.cleanedTokens = result.invalidTokens.length;
    }
    
    return result;
  } catch (error) {
    console.error('[FCM] ❌ Error al enviar notificaciones:', error.message);
    return { success: false, error: error.message };
  }
}

// ============================================
// INICIALIZAR AL CARGAR
// ============================================
initializeFirebase();

module.exports = {
  sendNotificationToUser,
  sendNotificationToMultiple,
  sendNotificationToAllUsers,
  sendNotificationToUsernames,
  sendNotificationToTopic,
  subscribeToTopic,
  unsubscribeFromTopic,
  initializeFirebase
};
