// ============================================
// RUTAS DE NOTIFICACIONES PUSH
// ============================================

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const {
  sendNotificationToUser,
  sendNotificationToMultiple,
  sendNotificationToAllUsers,
  sendNotificationToUsernames,
  sendNotificationToTopic,
  subscribeToTopic,
  unsubscribeFromTopic
} = require('../services/notificationService');

// Importar modelo de usuario
const { User } = require('../../config/database');

// JWT Secret (debe ser el mismo que en server.js)
const JWT_SECRET = process.env.JWT_SECRET || 'sala-de-juegos-secret-key-2024';

// ============================================
// MIDDLEWARE DE AUTENTICACIÓN (Admin)
// ============================================
async function requireAdmin(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({ error: 'Token no proporcionado' });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return res.status(401).json({ error: 'Token inválido' });
  }

  if (decoded.role !== 'admin' && decoded.role !== 'depositor' && decoded.role !== 'withdrawer') {
    return res.status(403).json({ error: 'No tienes permisos de administrador' });
  }

  // Verify the user is still active in DB
  try {
    const user = await User.findOne({ id: decoded.userId });
    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'Usuario desactivado o no encontrado' });
    }
  } catch (dbError) {
    return res.status(500).json({ error: 'Error verificando usuario' });
  }

  req.user = decoded;
  next();
}

// ============================================
// GUARDAR TOKEN FCM (Desde el frontend) - REQUIERE AUTENTICACIÓN
// ============================================
router.post('/register-token', async (req, res) => {
  try {
    const { fcmToken, fcmTokenContext, notifPermission } = req.body;
    const authHeader = req.headers.authorization;
    
    console.log('[FCM] Recibida petición de registro de token');
    
    if (!fcmToken) {
      console.log('[FCM] Error: FCM Token no proporcionado');
      return res.status(400).json({ error: 'FCM Token requerido' });
    }

    // Verificar token de autenticación
    if (!authHeader) {
      console.log('[FCM] Error: Auth header no proporcionado');
      return res.status(401).json({ error: 'Token de autenticación requerido' });
    }

    const token = authHeader.replace('Bearer ', '');
    const decoded = jwt.verify(token, JWT_SECRET);
    
    console.log('[FCM] JWT decodificado:', { userId: decoded.userId, username: decoded.username });
    
    // Buscar usuario por UUID (campo 'id') o por ObjectId (_id)
    let user = await User.findOne({ id: decoded.userId });
    
    if (!user) {
      console.log('[FCM] Usuario no encontrado por UUID, intentando por _id...');
      user = await User.findById(decoded.userId);
    }
    
    if (!user) {
      console.log('[FCM] Error: Usuario no encontrado en la base de datos');
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    
    console.log('[FCM] Usuario encontrado:', user.username);

    const normalizedCtx = fcmTokenContext || 'browser';
    const normalizedPerm = notifPermission || null;

    // Garantizar que el token se trate siempre como string para evitar inyección NoSQL
    const tokenStr = String(fcmToken);

    // Actualizar el array fcmTokens: upsert por token string.
    // Si el token ya existe, actualizamos contexto/fecha/permiso.
    // Si es nuevo, lo añadimos SIN borrar los tokens anteriores.
    // Esto permite que Chrome y la PWA coexistan con sus propios tokens.
    const tokenEntry = {
      token: tokenStr,
      context: normalizedCtx,
      updatedAt: new Date(),
      notifPermission: normalizedPerm || null
    };
    if (!user.fcmTokens) user.fcmTokens = [];
    const existingIdx = user.fcmTokens.findIndex(t => t.token === tokenStr);
    if (existingIdx >= 0) {
      user.fcmTokens[existingIdx] = tokenEntry;
    } else {
      user.fcmTokens.push(tokenEntry);
    }
    user.markModified('fcmTokens');

    // También mantener los campos individuales con el último token registrado
    // para compatibilidad con el panel admin y lógica heredada.
    user.fcmToken = tokenStr;
    user.fcmTokenContext = normalizedCtx;
    user.fcmTokenUpdatedAt = new Date();
    if (normalizedPerm) {
      user.notifPermission = normalizedPerm;
    }
    await user.save();
    
    console.log('[FCM] ✅ Token registrado exitosamente para usuario:', user.username, '(contexto:', normalizedCtx, ', permiso:', normalizedPerm + ')');
    
    // Notificar a admins en tiempo real sobre el nuevo estado
    if (_io) {
      _io.to('admins').emit('user_app_status', {
        userId: user.id,
        username: user.username,
        appInstalled: true,
        fcmTokenContext: normalizedCtx,
        notifPermission: normalizedPerm || user.notifPermission || 'unknown'
      });
    }
    
    res.json({ 
      success: true, 
      message: 'Token registrado correctamente',
      userId: user.id,
      username: user.username
    });
  } catch (error) {
    console.error('[FCM] ❌ Error al registrar token:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// GUARDAR TOKEN FCM MANUAL (PARA PRUEBAS - SIN AUTH)
// ============================================
router.post('/register-token-manual', async (req, res) => {
  try {
    const { fcmToken, username } = req.body;
    
    console.log('[FCM] Recibida petición MANUAL de registro de token');
    console.log('[FCM] Username:', username);
    console.log('[FCM] Token preview:', fcmToken ? fcmToken.substring(0, 30) + '...' : 'null');
    
    if (!username) {
      return res.status(400).json({ error: 'Username requerido' });
    }

    // Buscar usuario por username
    const user = await User.findOne({ username: username });
    
    if (!user) {
      console.log('[FCM] ❌ Usuario no encontrado:', username);
      return res.status(404).json({ error: 'Usuario no encontrado: ' + username });
    }
    
    console.log('[FCM] Usuario encontrado:', user.username, 'ID:', user.id);
    
    // Guardar o borrar el token
    if (fcmToken === null) {
      // Borrar el token
      user.fcmToken = null;
      user.fcmTokenUpdatedAt = null;
      await user.save();
      console.log('[FCM] ✅ Token borrado para:', user.username);
      res.json({ 
        success: true, 
        message: 'Token borrado correctamente',
        username: user.username
      });
    } else {
      // Guardar el token
      user.fcmToken = fcmToken;
      user.fcmTokenUpdatedAt = new Date();
      await user.save();
      console.log('[FCM] ✅ Token guardado manualmente para:', user.username);
      res.json({ 
        success: true, 
        message: 'Token guardado correctamente',
        username: user.username,
        userId: user.id
      });
    }
  } catch (error) {
    console.error('[FCM] ❌ Error al guardar token manual:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// ENVIAR NOTIFICACIÓN A UN USUARIO
// ============================================
router.post('/send', requireAdmin, async (req, res) => {
  try {
    const { fcmToken, title, body, data } = req.body;
    
    if (!fcmToken || !title || !body) {
      return res.status(400).json({ 
        error: 'FCM Token, título y cuerpo son requeridos' 
      });
    }

    const result = await sendNotificationToUser(fcmToken, title, body, data || {});
    
    if (result.success) {
      res.json({ 
        success: true, 
        message: 'Notificación enviada',
        messageId: result.messageId 
      });
    } else {
      // Si el token está permanentemente inválido, borrarlo de la BD
      if (result.invalidToken) {
        try {
          const invalidTokenStr = String(fcmToken);
          await User.updateOne(
            { fcmToken: invalidTokenStr },
            { $set: { fcmToken: null, fcmTokenUpdatedAt: null } }
          );
          await User.updateMany(
            { 'fcmTokens.token': invalidTokenStr },
            { $pull: { fcmTokens: { token: invalidTokenStr } } }
          );
          console.log('[FCM] 🗑️ Token inválido eliminado automáticamente de la BD');
        } catch (cleanErr) {
          console.error('[FCM] Error al borrar token inválido:', cleanErr.message);
        }
      }
      res.status(500).json({ 
        success: false, 
        error: result.error,
        tokenCleaned: result.invalidToken === true
      });
    }
  } catch (error) {
    console.error('[FCM] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// ENVIAR NOTIFICACIÓN A MÚLTIPLES USUARIOS
// ============================================
router.post('/send-multiple', requireAdmin, async (req, res) => {
  try {
    const { fcmTokens, title, body, data } = req.body;
    
    if (!fcmTokens || !Array.isArray(fcmTokens) || fcmTokens.length === 0) {
      return res.status(400).json({ 
        error: 'Array de FCM Tokens requerido' 
      });
    }

    if (!title || !body) {
      return res.status(400).json({ 
        error: 'Título y cuerpo son requeridos' 
      });
    }

    const result = await sendNotificationToMultiple(fcmTokens, title, body, data || {});
    
    if (result.success) {
      res.json({ 
        success: true, 
        message: 'Notificaciones enviadas',
        successCount: result.successCount,
        failureCount: result.failureCount
      });
    } else {
      res.status(500).json({ 
        success: false, 
        error: result.error 
      });
    }
  } catch (error) {
    console.error('[FCM] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// ENVIAR NOTIFICACIÓN A TÓPICO
// ============================================
router.post('/send-topic', requireAdmin, async (req, res) => {
  try {
    const { topic, title, body, data } = req.body;
    
    if (!topic || !title || !body) {
      return res.status(400).json({ 
        error: 'Tópico, título y cuerpo son requeridos' 
      });
    }

    const result = await sendNotificationToTopic(topic, title, body, data || {});
    
    if (result.success) {
      res.json({ 
        success: true, 
        message: 'Notificación enviada al tópico',
        messageId: result.messageId 
      });
    } else {
      res.status(500).json({ 
        success: false, 
        error: result.error 
      });
    }
  } catch (error) {
    console.error('[FCM] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// SUSCRIBIR USUARIO A TÓPICO
// ============================================
router.post('/subscribe-topic', async (req, res) => {
  try {
    const { fcmToken, topic } = req.body;
    
    if (!fcmToken || !topic) {
      return res.status(400).json({ 
        error: 'FCM Token y tópico son requeridos' 
      });
    }

    const result = await subscribeToTopic(fcmToken, topic);
    
    if (result.success) {
      res.json({ 
        success: true, 
        message: `Suscrito al tópico ${topic}` 
      });
    } else {
      res.status(500).json({ 
        success: false, 
        error: result.error 
      });
    }
  } catch (error) {
    console.error('[FCM] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// DESUSCRIBIR USUARIO DE TÓPICO
// ============================================
router.post('/unsubscribe-topic', async (req, res) => {
  try {
    const { fcmToken, topic } = req.body;
    
    if (!fcmToken || !topic) {
      return res.status(400).json({ 
        error: 'FCM Token y tópico son requeridos' 
      });
    }

    const result = await unsubscribeFromTopic(fcmToken, topic);
    
    if (result.success) {
      res.json({ 
        success: true, 
        message: `Desuscrito del tópico ${topic}` 
      });
    } else {
      res.status(500).json({ 
        success: false, 
        error: result.error 
      });
    }
  } catch (error) {
    console.error('[FCM] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// TEST - ENVIAR NOTIFICACIÓN DE PRUEBA
// ============================================
router.post('/test', async (req, res) => {
  try {
    const { fcmToken } = req.body;
    
    if (!fcmToken) {
      return res.status(400).json({ 
        error: 'FCM Token requerido' 
      });
    }

    const result = await sendNotificationToUser(
      fcmToken,
      '🧪 Test de Notificación',
      '¡Si ves esto, las notificaciones funcionan correctamente!',
      { type: 'test', timestamp: Date.now().toString() }
    );
    
    if (result.success) {
      res.json({ 
        success: true, 
        message: 'Notificación de prueba enviada',
        messageId: result.messageId 
      });
    } else {
      res.status(500).json({ 
        success: false, 
        error: result.error 
      });
    }
  } catch (error) {
    console.error('[FCM] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// ENVIAR NOTIFICACIÓN MASIVA A TODOS LOS USUARIOS (SIN AUTH - PARA PRUEBAS)
// ============================================
router.post('/send-all', async (req, res) => {
  try {
    const { title, body, data, filter } = req.body;
    
    if (!title || !body) {
      return res.status(400).json({ 
        error: 'Título y cuerpo son requeridos' 
      });
    }

    console.log('[FCM] Iniciando envío masivo...');
    
    const result = await sendNotificationToAllUsers(
      User, 
      title, 
      body, 
      data || {}, 
      filter || {}
    );
    
    if (result.success) {
      res.json({ 
        success: true, 
        message: 'Notificaciones enviadas',
        totalUsers: result.totalUsers,
        successCount: result.successCount,
        failureCount: result.failureCount,
        cleanedTokens: result.cleanedTokens || 0,
        failedTokens: result.failedTokens
      });
    } else {
      res.status(500).json({ 
        success: false, 
        error: result.error 
      });
    }
  } catch (error) {
    console.error('[FCM] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// ENVIAR NOTIFICACIÓN A USUARIOS ESPECÍFICOS POR USERNAME
// ============================================
router.post('/send-to-usernames', requireAdmin, async (req, res) => {
  try {
    const { usernames, title, body, data } = req.body;
    
    if (!usernames || !Array.isArray(usernames) || usernames.length === 0) {
      return res.status(400).json({ 
        error: 'Array de usernames requerido' 
      });
    }

    if (!title || !body) {
      return res.status(400).json({ 
        error: 'Título y cuerpo son requeridos' 
      });
    }

    const result = await sendNotificationToUsernames(
      User,
      usernames,
      title,
      body,
      data || {}
    );
    
    if (result.success) {
      res.json({ 
        success: true, 
        message: 'Notificaciones enviadas',
        targetUsers: result.targetUsers,
        successCount: result.successCount,
        failureCount: result.failureCount
      });
    } else {
      res.status(500).json({ 
        success: false, 
        error: result.error 
      });
    }
  } catch (error) {
    console.error('[FCM] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// OBTENER ESTADÍSTICAS DE TOKENS FCM (SIN AUTH - PARA PRUEBAS)
// ============================================
router.get('/stats', async (req, res) => {
  try {
    console.log('[FCM] Solicitando estadísticas...');
    
    const totalUsers = await User.countDocuments();
    const usersWithToken = await User.countDocuments({ 
      fcmToken: { $exists: true, $ne: null } 
    });
    const usersWithoutToken = totalUsers - usersWithToken;

    console.log(`[FCM] Estadísticas: ${totalUsers} total, ${usersWithToken} con token, ${usersWithoutToken} sin token`);

    // Obtener últimos 10 usuarios con token
    const recentUsers = await User.find({ 
      fcmToken: { $exists: true, $ne: null } 
    })
    .select('username fcmToken fcmTokenUpdatedAt')
    .sort({ fcmTokenUpdatedAt: -1 })
    .limit(10)
    .lean();

    res.json({
      success: true,
      stats: {
        totalUsers,
        usersWithToken,
        usersWithoutToken,
        percentage: totalUsers > 0 ? Math.round((usersWithToken / totalUsers) * 100) : 0
      },
      recentUsers: recentUsers.map(u => ({
        username: u.username,
        tokenPreview: u.fcmToken ? u.fcmToken.substring(0, 20) + '...' : null,
        updatedAt: u.fcmTokenUpdatedAt
      }))
    });
  } catch (error) {
    console.error('[FCM] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// DIAGNÓSTICO - VERIFICAR ESTADO DEL SISTEMA
// ============================================
router.get('/diagnostic', async (req, res) => {
  try {
    const admin = require('firebase-admin');
    
    // Verificar si Firebase Admin está inicializado
    const firebaseInitialized = admin.apps.length > 0;

    // Verificar env vars (sin exponer sus valores)
    const envVars = {
      FIREBASE_PROJECT_ID:   !!process.env.FIREBASE_PROJECT_ID,
      FIREBASE_CLIENT_EMAIL: !!process.env.FIREBASE_CLIENT_EMAIL,
      FIREBASE_PRIVATE_KEY:  !!process.env.FIREBASE_PRIVATE_KEY,
    };
    const allEnvVarsPresent = Object.values(envVars).every(Boolean);
    
    // Contar usuarios con token
    const usersWithToken = await User.countDocuments({ 
      fcmToken: { $exists: true, $ne: null } 
    });
    
    res.json({
      success: true,
      diagnostic: {
        firebaseInitialized,
        envVarsPresent: envVars,
        allEnvVarsPresent,
        usersWithToken,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('[FCM] Error en diagnóstico:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ============================================
// VERIFICAR Y LIMPIAR TOKENS INVÁLIDOS
// ============================================
router.post('/verify-tokens', requireAdmin, async (req, res) => {
  try {
    const { sendTest } = req.body;
    
    console.log('[FCM] Iniciando verificación de tokens...');
    
    // Obtener todos los usuarios con al menos un token (array o campo individual)
    const users = await User.find({
      $or: [
        { fcmToken: { $exists: true, $ne: null } },
        { 'fcmTokens.0': { $exists: true } }
      ]
    }).select('username fcmToken fcmTokens').lean();
    
    // Construir lista plana { token, username } para verificar
    const tokenList = [];
    for (const user of users) {
      const seen = new Set();
      if (user.fcmTokens && user.fcmTokens.length > 0) {
        for (const entry of user.fcmTokens) {
          if (entry.token && !seen.has(entry.token)) {
            seen.add(entry.token);
            tokenList.push({ token: entry.token, username: user.username, userId: user.id });
          }
        }
      }
      // Incluir campo individual solo si no está ya en el array
      if (user.fcmToken && !seen.has(user.fcmToken)) {
        tokenList.push({ token: user.fcmToken, username: user.username, userId: user.id });
      }
    }
    
    console.log(`[FCM] Verificando ${tokenList.length} tokens (${users.length} usuarios)...`);
    
    const results = {
      total: tokenList.length,
      valid: 0,
      invalid: 0,
      errors: [],
      cleaned: 0
    };
    
    for (const entry of tokenList) {
      try {
        // Intentar enviar una notificación de prueba silenciosa
        const testResult = await sendNotificationToUser(
          entry.token,
          'Test',
          'Verificación de token',
          { type: 'token_verify', silent: 'true' }
        );
        
        if (testResult.success) {
          results.valid++;
          console.log(`[FCM] ✅ Token válido: ${entry.username}`);
        } else {
          results.invalid++;
          results.errors.push({ username: entry.username, error: testResult.error });
          console.log(`[FCM] ❌ Token inválido: ${entry.username} - ${testResult.error}`);
          
          // Limpiar solo ese token específico, no todos los del usuario
          if (testResult.invalidToken) {
            await User.updateOne(
              { username: entry.username, fcmToken: entry.token },
              { $set: { fcmToken: null, fcmTokenUpdatedAt: null } }
            );
            await User.updateOne(
              { username: entry.username },
              { $pull: { fcmTokens: { token: entry.token } } }
            );
            results.cleaned++;
            console.log(`[FCM] 🧹 Token borrado automáticamente: ${entry.username} (${entry.token.substring(0, 20)}...)`);
            // Notificar a admins solo si el usuario no tiene más tokens
            const remaining = await User.findOne({
              username: entry.username,
              $or: [
                { fcmToken: { $exists: true, $ne: null } },
                { 'fcmTokens.0': { $exists: true } }
              ]
            }).select('id fcmToken fcmTokens').lean();
            if (!remaining && _io) {
              _io.to('admins').emit('user_app_status', {
                userId: entry.userId,
                username: entry.username,
                appInstalled: false
              });
            }
          }
        }
      } catch (e) {
        results.invalid++;
        results.errors.push({ username: entry.username, error: e.message });
      }
    }
    
    console.log(`[FCM] Verificación completada: ${results.valid} válidos, ${results.invalid} inválidos, ${results.cleaned} limpiados`);
    
    res.json({
      success: true,
      results
    });
  } catch (error) {
    console.error('[FCM] Error en verificación:', error);
    res.status(500).json({ error: error.message });
  }
});

// Referencia a io para emitir eventos de socket
let _io = null;
router.setIo = (ioInstance) => { _io = ioInstance; };

// ============================================
// LISTAR USUARIOS CON ESTADO DE TOKEN (Para panel de notificaciones)
// ============================================
router.get('/users-status', requireAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 50, filter = 'all' } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    let query = {};
    if (filter === 'with_token') {
      query = { fcmToken: { $exists: true, $ne: null } };
    } else if (filter === 'without_token') {
      query = { $or: [{ fcmToken: { $exists: false } }, { fcmToken: null }] };
    }

    const total = await User.countDocuments(query);
    const users = await User.find(query)
      .select('username fcmToken fcmTokenUpdatedAt lastLogin createdAt')
      .sort({ fcmTokenUpdatedAt: -1, lastLogin: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const totalUsers = await User.countDocuments();
    const usersWithToken = await User.countDocuments({ fcmToken: { $exists: true, $ne: null } });

    res.json({
      success: true,
      stats: {
        totalUsers,
        usersWithToken,
        usersWithoutToken: totalUsers - usersWithToken,
        coverage: totalUsers > 0 ? Math.round((usersWithToken / totalUsers) * 100) : 0
      },
      users: users.map(u => ({
        username: u.username,
        hasToken: !!(u.fcmToken),
        tokenUpdatedAt: u.fcmTokenUpdatedAt,
        lastLogin: u.lastLogin,
        tokenPreview: u.fcmToken ? u.fcmToken.substring(0, 20) + '...' : null
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('[FCM] Error en users-status:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// ENVIAR NOTIFICACIÓN POR LOTES CONFIGURABLES
// Permite enviar a segmentos, con seguimiento de offset para "siguiente lote"
// Limpia automáticamente tokens inválidos detectados en el envío
// ============================================
router.post('/send-batch', requireAdmin, async (req, res) => {
  try {
    const { title, body, data, batchSize = 100, usernames, segment = 'all', batchOffset = 0 } = req.body;

    if (!title || !body) {
      return res.status(400).json({ error: 'Título y cuerpo son requeridos' });
    }

    const validBatchSizes = [50, 100, 200];
    const chunkSize = validBatchSizes.includes(parseInt(batchSize)) ? parseInt(batchSize) : 100;
    const offset = Math.max(0, parseInt(batchOffset) || 0);

    // Build base query based on segment
    let query;
    if (usernames && usernames.length > 0) {
      query = { username: { $in: usernames }, fcmToken: { $exists: true, $ne: null } };
    } else if (segment === 'with_balance') {
      query = { fcmToken: { $exists: true, $ne: null }, balance: { $gt: 0 } };
    } else if (segment === 'active') {
      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      query = { fcmToken: { $exists: true, $ne: null }, lastLogin: { $gte: cutoff } };
    } else if (segment === 'inactive') {
      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      query = { fcmToken: { $exists: true, $ne: null }, $or: [{ lastLogin: { $lt: cutoff } }, { lastLogin: { $exists: false } }] };
    } else if (segment === 'inactive_7d') {
      // Inactivos en los últimos 7 días (sin login en 7 días)
      const cutoff7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      query = { fcmToken: { $exists: true, $ne: null }, $or: [{ lastLogin: { $lt: cutoff7d } }, { lastLogin: { $exists: false } }] };
    } else {
      // all: todos con token FCM
      query = { fcmToken: { $exists: true, $ne: null } };
    }

    const allUsers = await User.find(query).select('username fcmToken').sort({ _id: 1 }).lean();

    if (allUsers.length === 0) {
      return res.json({
        success: true,
        message: 'No hay usuarios con token FCM para enviar',
        totalUsers: 0, successCount: 0, failureCount: 0, cleanedTokens: 0,
        batches: 0, batchResults: [], nextOffset: 0, remaining: 0
      });
    }

    // Apply offset: send only the next chunk of chunkSize from offset
    const totalSegmentUsers = allUsers.length;
    const usersToSend = allUsers.slice(offset, offset + chunkSize);
    const nextOffset = offset + usersToSend.length;
    const remaining = Math.max(0, totalSegmentUsers - nextOffset);

    console.log(`[FCM Batch] Segmento=${segment} total=${totalSegmentUsers} offset=${offset} enviando=${usersToSend.length}`);

    let totalSuccess = 0;
    let totalFailure = 0;
    let totalCleaned = 0;
    const allFailedTokens = [];
    const sentUsernames = [];

    for (const user of usersToSend) {
      sentUsernames.push(user.username);
      let result;
      try {
        result = await sendNotificationToUser(user.fcmToken, title, body, data || {});
      } catch (userErr) {
        console.error(`[FCM Batch] ❌ Error inesperado para ${user.username}:`, userErr.message);
        result = {
          success: false,
          error: userErr.message || 'Error inesperado',
          code: userErr.code || '',
          invalidToken: false
        };
      }
      if (result.success) {
        totalSuccess++;
      } else {
        totalFailure++;
        const errorMsg = result.error || '';
        const errorCode = result.code || '';
        const isInvalid = result.invalidToken === true;

        allFailedTokens.push({ username: user.username, error: errorMsg, code: errorCode, cleaned: isInvalid });

        if (isInvalid) {
          await User.updateOne(
            { username: user.username },
            { $set: { fcmToken: null, fcmTokenUpdatedAt: null } }
          );
          totalCleaned++;
          console.log(`[FCM Batch] 🧹 Token inválido borrado: ${user.username}`);
          if (_io) {
            _io.to('admins').emit('user_app_status', {
              username: user.username,
              appInstalled: false
            });
          }
        }
      }
    }

    console.log(`[FCM Batch] ✅ Total: ${totalSuccess} exitosas, ${totalFailure} fallidas, ${totalCleaned} tokens limpiados`);

    res.json({
      success: true,
      totalUsers: usersToSend.length,
      totalSegmentUsers,
      successCount: totalSuccess,
      failureCount: totalFailure,
      cleanedTokens: totalCleaned,
      batches: 1,
      batchSize: chunkSize,
      batchOffset: offset,
      nextOffset,
      remaining,
      sentUsernames: sentUsernames.slice(0, 50),
      batchResults: [{ batch: 1, total: usersToSend.length, success: totalSuccess, failure: totalFailure }],
      failedTokens: allFailedTokens.slice(0, 20)
    });
  } catch (error) {
    console.error('[FCM Batch] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
