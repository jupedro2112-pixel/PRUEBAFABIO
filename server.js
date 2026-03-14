const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

// Integración JUGAYGANA
const jugaygana = require('./jugaygana');
const jugayganaMovements = require('./jugaygana-movements');
const refunds = require('./models/refunds');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'sala-de-juegos-secret-key-2024';

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Asegurar que existan los archivos de datos
// En Vercel usamos /tmp porque el sistema de archivos es de solo lectura
const DATA_DIR = process.env.VERCEL ? '/tmp/data' : path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');

// Crear directorio de datos si no existe
try {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
} catch (error) {
  console.error('Error creando directorio de datos:', error);
}

// Crear archivos JSON si no existen
try {
  if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify([], null, 2));
  }
  if (!fs.existsSync(MESSAGES_FILE)) {
    fs.writeFileSync(MESSAGES_FILE, JSON.stringify([], null, 2));
  }
} catch (error) {
  console.error('Error creando archivos de datos:', error);
}

// Funciones helpers
const loadUsers = () => {
  try {
    const data = fs.readFileSync(USERS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return [];
  }
};

const saveUsers = (users) => {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
};

const loadMessages = () => {
  try {
    const data = fs.readFileSync(MESSAGES_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return [];
  }
};

const saveMessages = (messages) => {
  fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2));
};

// Limpiar mensajes antiguos (más de 25 horas)
function cleanupOldMessages() {
  try {
    const messages = loadMessages();
    const now = new Date();
    const maxAge = 25 * 60 * 60 * 1000; // 25 horas en milisegundos
    
    const filteredMessages = messages.filter(msg => {
      const msgTime = new Date(msg.timestamp).getTime();
      return (now.getTime() - msgTime) < maxAge;
    });
    
    if (filteredMessages.length < messages.length) {
      saveMessages(filteredMessages);
      console.log(`🧹 Limpieza de mensajes: ${messages.length - filteredMessages.length} mensajes eliminados`);
    }
  } catch (error) {
    console.error('Error limpiando mensajes antiguos:', error);
  }
}

// Ejecutar limpieza cada hora
setInterval(cleanupOldMessages, 60 * 60 * 1000);

const generateAccountNumber = () => {
  return 'ACC' + Date.now().toString().slice(-8) + Math.random().toString(36).substr(2, 4).toUpperCase();
};

// Middleware de autenticación
const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Token no proporcionado' });
  }
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Token inválido' });
  }
};

// Middleware de admin
const adminMiddleware = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Acceso denegado. Solo administradores.' });
  }
  next();
};

// ============================================
// RUTAS DE AUTENTICACIÓN
// ============================================

// Registro de usuario
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password, email, phone } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
    }
    
    const users = loadUsers();
    
    // Verificar si el usuario ya existe
    if (users.find(u => u.username === username)) {
      return res.status(400).json({ error: 'El usuario ya existe' });
    }
    
    // Crear nuevo usuario
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = {
      id: uuidv4(),
      username,
      password: hashedPassword,
      email: email || null,
      phone: phone || null,
      role: 'user', // 'user' o 'admin'
      accountNumber: generateAccountNumber(),
      balance: 0,
      createdAt: new Date().toISOString(),
      lastLogin: null,
      isActive: true,
      // Campos JUGAYGANA
      jugayganaUserId: null,
      jugayganaUsername: null,
      jugayganaSyncStatus: 'pending'
    };
    
    users.push(newUser);
    saveUsers(users);
    
    // Sincronizar con JUGAYGANA (async, no bloquea la respuesta)
    jugaygana.syncUserToPlatform({
      username: newUser.username,
      password: password
    }).then(result => {
      if (result.success) {
        const users = loadUsers();
        const userIndex = users.findIndex(u => u.id === newUser.id);
        if (userIndex !== -1) {
          users[userIndex].jugayganaUserId = result.jugayganaUserId || result.user?.user_id;
          users[userIndex].jugayganaUsername = result.jugayganaUsername || result.user?.user_name;
          users[userIndex].jugayganaSyncStatus = result.alreadyExists ? 'linked' : 'synced';
          saveUsers(users);
          console.log('✅ Usuario sincronizado con JUGAYGANA:', username);
        }
      } else {
        console.error('❌ Error sincronizando con JUGAYGANA:', result.error);
      }
    }).catch(err => {
      console.error('❌ Error en sincronización JUGAYGANA:', err.message);
    });
    
    // Generar token
    const token = jwt.sign(
      { userId: newUser.id, username: newUser.username, role: newUser.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    res.status(201).json({
      message: 'Usuario creado exitosamente',
      token,
      user: {
        id: newUser.id,
        username: newUser.username,
        email: newUser.email,
        accountNumber: newUser.accountNumber,
        role: newUser.role
      }
    });
  } catch (error) {
    console.error('Error en registro:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Login con verificación automática en JUGAYGANA
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
    }
    
    // 1. Buscar en base de datos local
    let users = loadUsers();
    let user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
    
    // 2. Si no existe localmente, verificar en JUGAYGANA
    if (!user) {
      console.log(`🔍 Usuario ${username} no encontrado localmente, verificando en JUGAYGANA...`);
      
      const jgUser = await jugaygana.getUserInfoByName(username);
      
      if (jgUser) {
        console.log(`✅ Usuario encontrado en JUGAYGANA, creando localmente...`);
        
        // Crear usuario localmente con contraseña asd123
        const hashedPassword = await bcrypt.hash('asd123', 10);
        const newUser = {
          id: uuidv4(),
          username: jgUser.username,
          password: hashedPassword,
          email: jgUser.email || null,
          phone: jgUser.phone || null,
          role: 'user',
          accountNumber: generateAccountNumber(),
          balance: jgUser.balance || 0,
          createdAt: new Date().toISOString(),
          lastLogin: null,
          isActive: true,
          jugayganaUserId: jgUser.id,
          jugayganaUsername: jgUser.username,
          jugayganaSyncStatus: 'linked',
          source: 'jugaygana'
        };
        
        users.push(newUser);
        saveUsers(users);
        user = newUser;
        
        console.log(`✅ Usuario ${username} creado automáticamente desde JUGAYGANA`);
      } else {
        return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
      }
    }
    
    if (!user.isActive) {
      return res.status(401).json({ error: 'Usuario desactivado' });
    }
    
    // 3. Verificar contraseña
    // Solo permite contraseña por defecto 'asd123' si el usuario NUNCA cambió su contraseña
    let isValidPassword = await bcrypt.compare(password, user.password);
    
    // Si la contraseña local falla y el usuario nunca cambió su contraseña, intentar con 'asd123'
    if (!isValidPassword && !user.passwordChangedAt) {
      const defaultHash = await bcrypt.hash('asd123', 10);
      isValidPassword = await bcrypt.compare(password, defaultHash);
    }
    
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }
    
    // 4. Actualizar último login
    user.lastLogin = new Date().toISOString();
    saveUsers(users);
    
    // 5. Generar token
    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    // Verificar si el usuario está usando contraseña por defecto
    const isDefaultPassword = await bcrypt.compare('asd123', user.password);
    
    res.json({
      message: 'Login exitoso',
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        accountNumber: user.accountNumber,
        role: user.role,
        balance: user.balance,
        jugayganaLinked: !!user.jugayganaUserId,
        needsPasswordChange: isDefaultPassword
      }
    });
  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Verificar token
app.get('/api/auth/verify', authMiddleware, (req, res) => {
  res.json({ valid: true, user: req.user });
});

// Cambiar contraseña
app.post('/api/auth/change-password', authMiddleware, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const users = loadUsers();
    const user = users.find(u => u.id === req.user.userId);
    
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    
    const isValidPassword = await bcrypt.compare(currentPassword, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Contraseña actual incorrecta' });
    }
    
    user.password = await bcrypt.hash(newPassword, 10);
    user.passwordChangedAt = new Date().toISOString();
    saveUsers(users);
    
    res.json({ message: 'Contraseña cambiada exitosamente' });
  } catch (error) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================
// RUTAS DE USUARIOS (ADMIN)
// ============================================

// Obtener todos los usuarios (solo admin)
app.get('/api/users', authMiddleware, adminMiddleware, (req, res) => {
  const users = loadUsers();
  const usersWithoutPassword = users.map(u => ({
    ...u,
    password: undefined
  }));
  res.json(usersWithoutPassword);
});

// Crear usuario desde admin
app.post('/api/users', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { username, password, email, phone, role = 'user', balance = 0 } = req.body;
    
    const users = loadUsers();
    
    if (users.find(u => u.username === username)) {
      return res.status(400).json({ error: 'El usuario ya existe' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = {
      id: uuidv4(),
      username,
      password: hashedPassword,
      email,
      phone,
      role,
      accountNumber: generateAccountNumber(),
      balance,
      createdAt: new Date().toISOString(),
      lastLogin: null,
      isActive: true,
      jugayganaUserId: null,
      jugayganaUsername: null,
      jugayganaSyncStatus: 'pending'
    };
    
    users.push(newUser);
    saveUsers(users);
    
    // Sincronizar con JUGAYGANA (async)
    jugaygana.syncUserToPlatform({
      username: newUser.username,
      password: password
    }).then(result => {
      if (result.success) {
        const users = loadUsers();
        const userIndex = users.findIndex(u => u.id === newUser.id);
        if (userIndex !== -1) {
          users[userIndex].jugayganaUserId = result.jugayganaUserId || result.user?.user_id;
          users[userIndex].jugayganaUsername = result.jugayganaUsername || result.user?.user_name;
          users[userIndex].jugayganaSyncStatus = result.alreadyExists ? 'linked' : 'synced';
          saveUsers(users);
        }
      }
    });
    
    res.status(201).json({
      message: 'Usuario creado exitosamente',
      user: {
        id: newUser.id,
        username: newUser.username,
        email: newUser.email,
        accountNumber: newUser.accountNumber,
        role: newUser.role,
        balance: newUser.balance
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Actualizar usuario
app.put('/api/users/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    const users = loadUsers();
    const userIndex = users.findIndex(u => u.id === id);
    
    if (userIndex === -1) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    
    // Si se actualiza la contraseña, hashearla y marcar como cambiada
    if (updates.password) {
      updates.password = await bcrypt.hash(updates.password, 10);
      updates.passwordChangedAt = new Date().toISOString();
    }
    
    users[userIndex] = { ...users[userIndex], ...updates };
    saveUsers(users);
    
    res.json({
      message: 'Usuario actualizado',
      user: { ...users[userIndex], password: undefined }
    });
  } catch (error) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Importar módulo de sincronización masiva
const jugayganaSync = require('./jugaygana-sync');

// Sincronizar usuario con JUGAYGANA
app.post('/api/users/:id/sync-jugaygana', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const users = loadUsers();
    const user = users.find(u => u.id === id);
    
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    
    const result = await jugaygana.syncUserToPlatform({
      username: user.username,
      password: 'asd123' // Contraseña por defecto para sincronización
    });
    
    if (result.success) {
      user.jugayganaUserId = result.jugayganaUserId || result.user?.user_id;
      user.jugayganaUsername = result.jugayganaUsername || result.user?.user_name;
      user.jugayganaSyncStatus = result.alreadyExists ? 'linked' : 'synced';
      saveUsers(users);
      
      res.json({
        message: result.alreadyExists ? 'Usuario vinculado con JUGAYGANA' : 'Usuario sincronizado con JUGAYGANA',
        jugayganaUserId: user.jugayganaUserId,
        jugayganaUsername: user.jugayganaUsername
      });
    } else {
      res.status(400).json({ error: result.error || 'Error sincronizando con JUGAYGANA' });
    }
  } catch (error) {
    console.error('Error sincronizando:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================
// SINCRONIZACIÓN MASIVA - IMPORTAR TODOS LOS USUARIOS DE JUGAYGANA
// ============================================

// Iniciar sincronización masiva (async, devuelve job ID)
app.post('/api/admin/sync-all-jugaygana', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    // Verificar que no haya una sincronización en curso
    const syncLog = jugayganaSync.loadSyncLog();
    if (syncLog.inProgress) {
      return res.status(409).json({ 
        error: 'Ya hay una sincronización en curso',
        startedAt: syncLog.inProgressStartedAt
      });
    }
    
    // Marcar como en progreso
    syncLog.inProgress = true;
    syncLog.inProgressStartedAt = new Date().toISOString();
    require('fs').writeFileSync(
      path.join(DATA_DIR, 'sync-log.json'), 
      JSON.stringify(syncLog, null, 2)
    );
    
    // Iniciar sincronización en background
    jugayganaSync.syncAllUsers((progress) => {
      console.log(`📊 Progreso: ${progress.percent}% | Creados: ${progress.created} | Saltados: ${progress.skipped}`);
    }).then(result => {
      // Marcar como completado
      const finalLog = jugayganaSync.loadSyncLog();
      finalLog.inProgress = false;
      finalLog.inProgressStartedAt = null;
      require('fs').writeFileSync(
        path.join(DATA_DIR, 'sync-log.json'), 
        JSON.stringify(finalLog, null, 2)
      );
      console.log('✅ Sincronización masiva completada:', result);
    }).catch(error => {
      console.error('❌ Error en sincronización masiva:', error);
      const errorLog = jugayganaSync.loadSyncLog();
      errorLog.inProgress = false;
      errorLog.inProgressStartedAt = null;
      errorLog.lastError = error.message;
      require('fs').writeFileSync(
        path.join(DATA_DIR, 'sync-log.json'), 
        JSON.stringify(errorLog, null, 2)
      );
    });
    
    res.json({
      message: 'Sincronización masiva iniciada',
      note: 'Este proceso puede tardar 30-60 minutos para 100K usuarios',
      checkStatus: 'GET /api/admin/sync-status'
    });
  } catch (error) {
    console.error('Error iniciando sincronización:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Ver estado de sincronización
app.get('/api/admin/sync-status', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const syncLog = jugayganaSync.loadSyncLog();
    const users = loadUsers();
    
    res.json({
      inProgress: syncLog.inProgress || false,
      startedAt: syncLog.inProgressStartedAt || null,
      lastSync: syncLog.lastSync,
      totalSynced: syncLog.totalSynced || 0,
      lastResult: syncLog.lastResult || null,
      localUsers: users.length,
      jugayganaUsers: users.filter(u => u.jugayganaUserId).length,
      pendingUsers: users.filter(u => !u.jugayganaUserId && u.role === 'user').length
    });
  } catch (error) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Sincronizar usuarios recientes (últimos 100)
app.post('/api/admin/sync-recent-jugaygana', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const result = await jugayganaSync.syncRecentUsers(100);
    res.json(result);
  } catch (error) {
    console.error('Error sincronizando recientes:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Eliminar usuario
app.delete('/api/users/:id', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const { id } = req.params;
    let users = loadUsers();
    
    if (!users.find(u => u.id === id)) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    
    users = users.filter(u => u.id !== id);
    saveUsers(users);
    
    res.json({ message: 'Usuario eliminado exitosamente' });
  } catch (error) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================
// RUTAS DE MENSAJES
// ============================================

// Obtener mensajes de un usuario (limitado a 10 por defecto)
app.get('/api/messages/:userId', authMiddleware, (req, res) => {
  try {
    const { userId } = req.params;
    const limit = parseInt(req.query.limit) || 10; // Por defecto 10 mensajes
    const messages = loadMessages();
    
    // Si es admin, puede ver todos los mensajes
    // Si es user, solo puede ver sus propios mensajes
    if (req.user.role !== 'admin' && req.user.userId !== userId) {
      return res.status(403).json({ error: 'Acceso denegado' });
    }
    
    let userMessages = messages
      .filter(m => m.senderId === userId || m.receiverId === userId)
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    
    // Mantener solo los últimos N mensajes
    if (userMessages.length > limit) {
      userMessages = userMessages.slice(-limit);
    }
    
    res.json(userMessages);
  } catch (error) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Obtener todas las conversaciones (solo admin)
app.get('/api/conversations', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const messages = loadMessages();
    const users = loadUsers();
    
    // Agrupar mensajes por usuario
    const conversations = {};
    
    messages.forEach(msg => {
      const userId = msg.senderRole === 'user' ? msg.senderId : msg.receiverId;
      
      if (!conversations[userId]) {
        const user = users.find(u => u.id === userId);
        conversations[userId] = {
          userId,
          username: user?.username || 'Desconocido',
          accountNumber: user?.accountNumber || '',
          lastMessage: msg,
          unreadCount: msg.receiverRole === 'admin' && !msg.read ? 1 : 0
        };
      } else {
        if (new Date(msg.timestamp) > new Date(conversations[userId].lastMessage.timestamp)) {
          conversations[userId].lastMessage = msg;
        }
        if (msg.receiverRole === 'admin' && !msg.read) {
          conversations[userId].unreadCount++;
        }
      }
    });
    
    res.json(Object.values(conversations));
  } catch (error) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Marcar mensajes como leídos
app.post('/api/messages/read/:userId', authMiddleware, (req, res) => {
  try {
    const { userId } = req.params;
    const messages = loadMessages();
    
    messages.forEach(msg => {
      if (msg.senderId === userId && msg.receiverRole === 'admin') {
        msg.read = true;
      }
    });
    
    saveMessages(messages);
    res.json({ message: 'Mensajes marcados como leídos' });
  } catch (error) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================
// RUTA HTTP PARA ENVIAR MENSAJES (compatible con Vercel)
// ============================================

app.post('/api/messages/send', authMiddleware, async (req, res) => {
  try {
    const { content, type = 'text' } = req.body;
    
    if (!content) {
      return res.status(400).json({ error: 'Contenido requerido' });
    }
    
    const messages = loadMessages();
    
    const message = {
      id: uuidv4(),
      senderId: req.user.userId,
      senderUsername: req.user.username,
      senderRole: req.user.role,
      receiverId: req.user.role === 'admin' ? (req.body.receiverId || 'admin') : 'admin',
      receiverRole: req.user.role === 'admin' ? 'user' : 'admin',
      content,
      type,
      timestamp: new Date().toISOString(),
      read: false
    };
    
    messages.push(message);
    saveMessages(messages);
    
    res.json(message);
  } catch (error) {
    console.error('Error enviando mensaje:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================
// REEMBOLSOS (DIARIO, SEMANAL, MENSUAL)
// ============================================

// Obtener estado de reembolsos del usuario con datos reales de JUGAYGANA
app.get('/api/refunds/status', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const username = req.user.username;
    
    // Obtener información real del usuario desde JUGAYGANA
    const userInfo = await jugaygana.getUserInfoByName(username);
    const currentBalance = userInfo ? userInfo.balance : 0;
    
    // Obtener movimientos de cada período
    const [yesterdayMovements, lastWeekMovements, lastMonthMovements] = await Promise.all([
      jugaygana.getUserNetYesterday(username),
      jugaygana.getUserNetLastWeek(username),
      jugaygana.getUserNetLastMonth(username)
    ]);
    
    // Verificar si ya reclamó hoy
    const claimedToday = await jugaygana.checkClaimedToday(username);
    
    const dailyStatus = refunds.canClaimDailyRefund(userId);
    const weeklyStatus = refunds.canClaimWeeklyRefund(userId);
    const monthlyStatus = refunds.canClaimMonthlyRefund(userId);
    
    // Calcular montos potenciales para cada período
    const dailyDeposits = yesterdayMovements.success ? yesterdayMovements.totalDeposits : 0;
    const dailyWithdrawals = yesterdayMovements.success ? yesterdayMovements.totalWithdraws : 0;
    const dailyNet = yesterdayMovements.success ? yesterdayMovements.net : 0;
    
    const weeklyDeposits = lastWeekMovements.success ? lastWeekMovements.totalDeposits : 0;
    const weeklyWithdrawals = lastWeekMovements.success ? lastWeekMovements.totalWithdraws : 0;
    const weeklyNet = lastWeekMovements.success ? lastWeekMovements.net : 0;
    
    const monthlyDeposits = lastMonthMovements.success ? lastMonthMovements.totalDeposits : 0;
    const monthlyWithdrawals = lastMonthMovements.success ? lastMonthMovements.totalWithdraws : 0;
    const monthlyNet = lastMonthMovements.success ? lastMonthMovements.net : 0;
    
    const dailyCalc = refunds.calculateRefund(dailyDeposits, dailyWithdrawals, 20);
    const weeklyCalc = refunds.calculateRefund(weeklyDeposits, weeklyWithdrawals, 10);
    const monthlyCalc = refunds.calculateRefund(monthlyDeposits, monthlyWithdrawals, 5);
    
    res.json({
      user: {
        username,
        currentBalance,
        jugayganaLinked: !!userInfo
      },
      daily: {
        ...dailyStatus,
        potentialAmount: dailyCalc.refundAmount,
        netAmount: dailyCalc.netAmount,
        percentage: 20,
        period: yesterdayMovements.success ? yesterdayMovements.dateStr : 'ayer',
        deposits: dailyDeposits,
        withdrawals: dailyWithdrawals
      },
      weekly: {
        ...weeklyStatus,
        potentialAmount: weeklyCalc.refundAmount,
        netAmount: weeklyCalc.netAmount,
        percentage: 10,
        period: lastWeekMovements.success ? `${lastWeekMovements.fromDateStr} a ${lastWeekMovements.toDateStr}` : 'semana pasada',
        deposits: weeklyDeposits,
        withdrawals: weeklyWithdrawals
      },
      monthly: {
        ...monthlyStatus,
        potentialAmount: monthlyCalc.refundAmount,
        netAmount: monthlyCalc.netAmount,
        percentage: 5,
        period: lastMonthMovements.success ? `${lastMonthMovements.fromDateStr} a ${lastMonthMovements.toDateStr}` : 'mes pasado',
        deposits: monthlyDeposits,
        withdrawals: monthlyWithdrawals
      },
      claimedToday: claimedToday.success ? claimedToday.claimed : false
    });
  } catch (error) {
    console.error('Error obteniendo estado de reembolsos:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Reclamar reembolso diario - Siempre clickeable
app.post('/api/refunds/claim/daily', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const username = req.user.username;
    
    // Verificar si puede reclamar
    const status = refunds.canClaimDailyRefund(userId);
    
    // Si no puede reclamar, devolver mensaje informativo (no error)
    if (!status.canClaim) {
      return res.json({
        success: false,
        message: 'Ya reclamaste tu reembolso diario. Vuelve mañana!',
        canClaim: false,
        nextClaim: status.nextClaim
      });
    }
    
    // Obtener movimientos de ayer usando el endpoint correcto
    const yesterdayMovements = await jugaygana.getUserNetYesterday(username);
    
    if (!yesterdayMovements.success) {
      return res.json({
        success: false,
        message: 'No se pudieron obtener tus movimientos. Intenta más tarde.',
        canClaim: true
      });
    }
    
    const deposits = yesterdayMovements.totalDeposits;
    const withdrawals = yesterdayMovements.totalWithdraws;
    
    // Calcular reembolso (20%)
    const calc = refunds.calculateRefund(deposits, withdrawals, 20);
    
    if (calc.refundAmount <= 0) {
      return res.json({
        success: false,
        message: `No tienes saldo neto positivo para reclamar reembolso. Depósitos: $${deposits}, Retiros: $${withdrawals}`,
        canClaim: true,
        netAmount: calc.netAmount
      });
    }
    
    // Realizar depósito en JUGAYGANA usando DepositMoney
    const depositResult = await jugaygana.creditUserBalance(
      username,
      calc.refundAmount
    );
    
    if (!depositResult.success) {
      return res.json({
        success: false,
        message: 'Error al acreditar el reembolso: ' + depositResult.error,
        canClaim: true
      });
    }
    
    // Registrar reembolso
    const refund = refunds.recordRefund(
      userId,
      username,
      'daily',
      calc.refundAmount,
      calc.netAmount,
      deposits,
      withdrawals
    );
    
    res.json({
      success: true,
      message: `¡Reembolso diario de $${calc.refundAmount} acreditado!`,
      amount: calc.refundAmount,
      percentage: 20,
      netAmount: calc.netAmount,
      refund,
      nextClaim: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    });
  } catch (error) {
    console.error('Error reclamando reembolso diario:', error);
    res.json({ success: false, message: 'Error del servidor', canClaim: true });
  }
});

// Reclamar reembolso semanal - Siempre clickeable
app.post('/api/refunds/claim/weekly', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const username = req.user.username;
    
    // Verificar si puede reclamar
    const status = refunds.canClaimWeeklyRefund(userId);
    
    // Si no puede reclamar, devolver mensaje informativo
    if (!status.canClaim) {
      return res.json({
        success: false,
        message: `No puedes reclamar el reembolso semanal. Disponible: ${status.availableDays}`,
        canClaim: false,
        nextClaim: status.nextClaim,
        availableDays: status.availableDays
      });
    }
    
    // Obtener movimientos de ayer
    const yesterdayMovements = await jugayganaMovements.getYesterdayMovements(username);
    
    if (!yesterdayMovements.success) {
      return res.json({
        success: false,
        message: 'No se pudieron obtener tus movimientos. Intenta más tarde.',
        canClaim: true
      });
    }
    
    const deposits = yesterdayMovements.deposits.total;
    const withdrawals = yesterdayMovements.withdrawals.total;
    
    // Calcular reembolso (10%)
    const calc = refunds.calculateRefund(deposits, withdrawals, 10);
    
    if (calc.refundAmount <= 0) {
      return res.json({
        success: false,
        message: `No tienes saldo neto positivo. Depósitos: $${deposits}, Retiros: $${withdrawals}`,
        canClaim: true,
        netAmount: calc.netAmount
      });
    }
    
    // Realizar depósito en JUGAYGANA
    const depositResult = await jugayganaMovements.makeDeposit(
      username,
      calc.refundAmount,
      `Reembolso semanal ${new Date().toLocaleDateString('es-AR')} - ${calc.percentage}% de $${calc.netAmount}`
    );
    
    if (!depositResult.success) {
      return res.json({
        success: false,
        message: 'Error al acreditar el reembolso: ' + depositResult.error,
        canClaim: true
      });
    }
    
    // Registrar reembolso
    const refund = refunds.recordRefund(
      userId,
      username,
      'weekly',
      calc.refundAmount,
      calc.netAmount,
      deposits,
      withdrawals
    );
    
    res.json({
      success: true,
      message: `¡Reembolso semanal de $${calc.refundAmount} acreditado!`,
      amount: calc.refundAmount,
      percentage: 10,
      netAmount: calc.netAmount,
      refund,
      nextClaim: status.nextClaim
    });
  } catch (error) {
    console.error('Error reclamando reembolso semanal:', error);
    res.json({ success: false, message: 'Error del servidor', canClaim: true });
  }
});

// Reclamar reembolso mensual - Siempre clickeable
app.post('/api/refunds/claim/monthly', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const username = req.user.username;
    
    // Verificar si puede reclamar
    const status = refunds.canClaimMonthlyRefund(userId);
    
    // Si no puede reclamar, devolver mensaje informativo
    if (!status.canClaim) {
      return res.json({
        success: false,
        message: `No puedes reclamar el reembolso mensual. Disponible: ${status.availableFrom}`,
        canClaim: false,
        nextClaim: status.nextClaim,
        availableFrom: status.availableFrom
      });
    }
    
    // Obtener movimientos de ayer
    const yesterdayMovements = await jugayganaMovements.getYesterdayMovements(username);
    
    if (!yesterdayMovements.success) {
      return res.json({
        success: false,
        message: 'No se pudieron obtener tus movimientos. Intenta más tarde.',
        canClaim: true
      });
    }
    
    const deposits = yesterdayMovements.deposits.total;
    const withdrawals = yesterdayMovements.withdrawals.total;
    
    // Calcular reembolso (5%)
    const calc = refunds.calculateRefund(deposits, withdrawals, 5);
    
    if (calc.refundAmount <= 0) {
      return res.json({
        success: false,
        message: `No tienes saldo neto positivo. Depósitos: $${deposits}, Retiros: $${withdrawals}`,
        canClaim: true,
        netAmount: calc.netAmount
      });
    }
    
    // Realizar depósito en JUGAYGANA
    const depositResult = await jugayganaMovements.makeDeposit(
      username,
      calc.refundAmount,
      `Reembolso mensual ${new Date().toLocaleDateString('es-AR')} - ${calc.percentage}% de $${calc.netAmount}`
    );
    
    if (!depositResult.success) {
      return res.json({
        success: false,
        message: 'Error al acreditar el reembolso: ' + depositResult.error,
        canClaim: true
      });
    }
    
    // Registrar reembolso
    const refund = refunds.recordRefund(
      userId,
      username,
      'monthly',
      calc.refundAmount,
      calc.netAmount,
      deposits,
      withdrawals
    );
    
    res.json({
      success: true,
      message: `¡Reembolso mensual de $${calc.refundAmount} acreditado!`,
      amount: calc.refundAmount,
      percentage: 5,
      netAmount: calc.netAmount,
      refund,
      nextClaim: status.nextClaim
    });
  } catch (error) {
    console.error('Error reclamando reembolso mensual:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Obtener historial de reembolsos del usuario
app.get('/api/refunds/history', authMiddleware, (req, res) => {
  try {
    const userId = req.user.userId;
    const userRefunds = refunds.getUserRefunds(userId);
    
    res.json({
      refunds: userRefunds.sort((a, b) => new Date(b.date) - new Date(a.date))
    });
  } catch (error) {
    console.error('Error obteniendo historial de reembolsos:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================
// MOVIMIENTOS DE SALDO (DEPÓSITOS/RETIROS)
// ============================================

// Obtener balance del usuario
app.get('/api/balance', authMiddleware, async (req, res) => {
  try {
    const username = req.user.username;
    const result = await jugayganaMovements.getUserBalance(username);
    
    if (result.success) {
      res.json({
        balance: result.balance,
        username: result.username
      });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (error) {
    console.error('Error obteniendo balance:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Obtener movimientos del usuario
app.get('/api/movements', authMiddleware, async (req, res) => {
  try {
    const username = req.user.username;
    const { startDate, endDate, page = 1 } = req.query;
    
    const result = await jugayganaMovements.getUserMovements(username, {
      startDate,
      endDate,
      page: parseInt(page),
      pageSize: 50
    });
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (error) {
    console.error('Error obteniendo movimientos:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Realizar depósito (solo admin)
app.post('/api/admin/deposit', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { username, amount, description } = req.body;
    
    if (!username || !amount) {
      return res.status(400).json({ error: 'Usuario y monto requeridos' });
    }
    
    const result = await jugayganaMovements.makeDeposit(username, amount, description);
    
    if (result.success) {
      // Registrar actividad para el fueguito del usuario
      const users = loadUsers();
      const user = users.find(u => u.username === username);
      if (user) {
        recordUserActivity(user.id, 'deposit', amount);
      }
      
      res.json(result);
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (error) {
    console.error('Error realizando depósito:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Obtener balance en tiempo real de JUGAYGANA
app.get('/api/admin/balance/:username', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { username } = req.params;
    const result = await jugayganaMovements.getUserBalance(username);
    
    if (result.success) {
      res.json({ balance: result.balance });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (error) {
    console.error('Error obteniendo balance:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Realizar retiro (solo admin)
app.post('/api/admin/withdrawal', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { username, amount, description } = req.body;
    
    if (!username || !amount) {
      return res.status(400).json({ error: 'Usuario y monto requeridos' });
    }
    
    const result = await jugayganaMovements.makeWithdrawal(username, amount, description);
    
    if (result.success) {
      // Registrar actividad para el fueguito del usuario
      const users = loadUsers();
      const user = users.find(u => u.username === username);
      if (user) {
        recordUserActivity(user.id, 'withdrawal', amount);
      }
      
      res.json(result);
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (error) {
    console.error('Error realizando retiro:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Realizar bonificación (solo admin)
app.post('/api/admin/bonus', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { username, amount, description } = req.body;
    
    if (!username || !amount) {
      return res.status(400).json({ error: 'Usuario y monto requeridos' });
    }
    
    const result = await jugayganaMovements.makeBonus(username, amount, description);
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (error) {
    console.error('Error realizando bonificación:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================
// SOCKET.IO - CHAT EN TIEMPO REAL
// ============================================

const connectedUsers = new Map();
const connectedAdmins = new Map();

io.on('connection', (socket) => {
  console.log('Nueva conexión:', socket.id);
  
  // Autenticar socket
  socket.on('authenticate', (token) => {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      socket.userId = decoded.userId;
      socket.username = decoded.username;
      socket.role = decoded.role;
      
      if (decoded.role === 'admin') {
        connectedAdmins.set(decoded.userId, socket);
        console.log(`Admin conectado: ${decoded.username}`);
        
        // Notificar a todos los admins las estadísticas
        broadcastStats();
      } else {
        connectedUsers.set(decoded.userId, socket);
        console.log(`Usuario conectado: ${decoded.username}`);
        
        // Unir al usuario a su sala personal
        socket.join(`user_${decoded.userId}`);
        
        // Notificar a los admins que un usuario se conectó
        notifyAdmins('user_connected', {
          userId: decoded.userId,
          username: decoded.username
        });
      }
      
      socket.emit('authenticated', { success: true, role: decoded.role });
    } catch (error) {
      socket.emit('authenticated', { success: false, error: 'Token inválido' });
    }
  });
  
  // Enviar mensaje
  socket.on('send_message', async (data) => {
    try {
      const { content, type = 'text' } = data;
      
      if (!socket.userId) {
        return socket.emit('error', { message: 'No autenticado' });
      }
      
      const messages = loadMessages();
      const users = loadUsers();
      
      const message = {
        id: uuidv4(),
        senderId: socket.userId,
        senderUsername: socket.username,
        senderRole: socket.role,
        receiverId: socket.role === 'admin' ? data.receiverId : 'admin',
        receiverRole: socket.role === 'admin' ? 'user' : 'admin',
        content,
        type,
        timestamp: new Date().toISOString(),
        read: false
      };
      
      messages.push(message);
      saveMessages(messages);
      
      // Enviar al receptor
      if (socket.role === 'user') {
        // Usuario envía a admin
        // Notificar a todos los admins
        notifyAdmins('new_message', {
          message,
          userId: socket.userId,
          username: socket.username
        });
        
        // Confirmar al usuario
        socket.emit('message_sent', message);
      } else {
        // Admin envía a usuario
        const userSocket = connectedUsers.get(data.receiverId);
        if (userSocket) {
          userSocket.emit('new_message', message);
        }
        
        // Confirmar al admin
        socket.emit('message_sent', message);
      }
      
      broadcastStats();
    } catch (error) {
      console.error('Error enviando mensaje:', error);
      socket.emit('error', { message: 'Error enviando mensaje' });
    }
  });
  
  // Escribiendo...
  socket.on('typing', (data) => {
    if (socket.role === 'user') {
      // Usuario escribiendo - notificar a admins
      notifyAdmins('user_typing', {
        userId: socket.userId,
        username: socket.username
      });
    } else {
      // Admin escribiendo - notificar al usuario específico
      const userSocket = connectedUsers.get(data.receiverId);
      if (userSocket) {
        userSocket.emit('admin_typing', {
          adminId: socket.userId,
          adminName: socket.username
        });
      }
    }
  });
  
  // Desconexión
  socket.on('disconnect', () => {
    console.log('Desconexión:', socket.id);
    
    if (socket.role === 'admin') {
      connectedAdmins.delete(socket.userId);
      broadcastStats();
    } else {
      connectedUsers.delete(socket.userId);
      notifyAdmins('user_disconnected', {
        userId: socket.userId,
        username: socket.username
      });
    }
  });
});

// Helper functions
function notifyAdmins(event, data) {
  connectedAdmins.forEach((socket) => {
    socket.emit(event, data);
  });
}

function broadcastStats() {
  const stats = {
    connectedUsers: connectedUsers.size,
    connectedAdmins: connectedAdmins.size,
    totalUsers: loadUsers().filter(u => u.role === 'user').length
  };
  
  connectedAdmins.forEach((socket) => {
    socket.emit('stats', stats);
  });
}

// ============================================
// RUTAS ESTÁTICAS
// ============================================

// Función para leer archivo de forma segura
function readFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    console.error(`Error leyendo archivo ${filePath}:`, error.message);
    return null;
  }
}

// Ruta principal - serve index.html
app.get('/', (req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  const content = readFileSafe(indexPath);
  if (content) {
    res.setHeader('Content-Type', 'text/html');
    res.send(content);
  } else {
    res.status(500).send('Error loading page');
  }
});

// Ruta admin privada - serve admin.html
app.get('/adminprivado2026', (req, res) => {
  const adminPath = path.join(__dirname, 'public', 'adminprivado2026', 'index.html');
  const content = readFileSafe(adminPath);
  if (content) {
    res.setHeader('Content-Type', 'text/html');
    res.send(content);
  } else {
    res.status(500).send('Error loading admin page');
  }
});

// Servir archivos CSS del admin
app.get('/adminprivado2026/admin.css', (req, res) => {
  const cssPath = path.join(__dirname, 'public', 'adminprivado2026', 'admin.css');
  const content = readFileSafe(cssPath);
  if (content) {
    res.setHeader('Content-Type', 'text/css');
    res.send(content);
  } else {
    res.status(404).send('CSS not found');
  }
});

// Servir archivos JS del admin
app.get('/adminprivado2026/admin.js', (req, res) => {
  const jsPath = path.join(__dirname, 'public', 'adminprivado2026', 'admin.js');
  const content = readFileSafe(jsPath);
  if (content) {
    res.setHeader('Content-Type', 'application/javascript');
    res.send(content);
  } else {
    res.status(404).send('JS not found');
  }
});

// ============================================
// INICIALIZAR DATOS DE PRUEBA
// ============================================

async function initializeData() {
  // Verificar IP pública (si hay proxy configurado)
  if (process.env.PROXY_URL) {
    console.log('🔍 Verificando IP pública...');
    await jugaygana.logProxyIP();
  }
  
  // Probar conexión con JUGAYGANA
  console.log('🔑 Probando conexión con JUGAYGANA...');
  const sessionOk = await jugaygana.ensureSession();
  if (sessionOk) {
    console.log('✅ Conexión con JUGAYGANA establecida');
  } else {
    console.log('⚠️ No se pudo conectar con JUGAYGANA (verificar credenciales/proxy)');
  }
  
  const users = loadUsers();
  
  // Crear admin ignite100 si no existe (o actualizar el existente)
  let adminExists = users.find(u => u.username === 'ignite100');
  if (!adminExists) {
    const adminPassword = await bcrypt.hash('pepsi100', 10);
    const admin = {
      id: uuidv4(),
      username: 'ignite100',
      password: adminPassword,
      email: 'admin@saladejuegos.com',
      phone: null,
      role: 'admin',
      accountNumber: 'ADMIN001',
      balance: 0,
      createdAt: new Date().toISOString(),
      lastLogin: null,
      isActive: true,
      jugayganaUserId: null,
      jugayganaUsername: null,
      jugayganaSyncStatus: 'na'
    };
    users.push(admin);
    console.log('✅ Admin creado: ignite100 / pepsi100');
  } else {
    // Actualizar contraseña y rol del admin existente
    adminExists.password = await bcrypt.hash('pepsi100', 10);
    adminExists.role = 'admin';
    adminExists.isActive = true;
    console.log('✅ Admin actualizado: ignite100 / pepsi100');
  }
  
  // También asegurar que el usuario 'admin' exista como respaldo
  let oldAdmin = users.find(u => u.username === 'admin');
  if (!oldAdmin) {
    const adminPassword = await bcrypt.hash('admin123', 10);
    const admin = {
      id: uuidv4(),
      username: 'admin',
      password: adminPassword,
      email: 'admin@saladejuegos.com',
      phone: null,
      role: 'admin',
      accountNumber: 'ADMIN002',
      balance: 0,
      createdAt: new Date().toISOString(),
      lastLogin: null,
      isActive: true,
      jugayganaUserId: null,
      jugayganaUsername: null,
      jugayganaSyncStatus: 'na'
    };
    users.push(admin);
    console.log('✅ Admin respaldo creado: admin / admin123');
  } else {
    oldAdmin.password = await bcrypt.hash('admin123', 10);
    oldAdmin.role = 'admin';
    oldAdmin.isActive = true;
    console.log('✅ Admin respaldo actualizado: admin / admin123');
  }
  
  // Crear usuario de prueba si no existe
  const testUser = users.find(u => u.username === '672rosana1');
  if (!testUser) {
    const userPassword = await bcrypt.hash('asd123', 10);
    const user = {
      id: uuidv4(),
      username: '672rosana1',
      password: userPassword,
      email: 'rosana@email.com',
      phone: null,
      role: 'user',
      accountNumber: generateAccountNumber(),
      balance: 1500.00,
      createdAt: new Date().toISOString(),
      lastLogin: null,
      isActive: true,
      jugayganaUserId: null,
      jugayganaUsername: null,
      jugayganaSyncStatus: 'pending'
    };
    users.push(user);
    console.log('✅ Usuario de prueba creado: 672rosana1 / asd123');
    
    // Sincronizar usuario de prueba con JUGAYGANA
    if (sessionOk) {
      console.log('🔄 Sincronizando usuario de prueba con JUGAYGANA...');
      const result = await jugaygana.syncUserToPlatform({
        username: '672rosana1',
        password: 'asd123'
      });
      if (result.success) {
        user.jugayganaUserId = result.jugayganaUserId || result.user?.user_id;
        user.jugayganaUsername = result.jugayganaUsername || result.user?.user_name;
        user.jugayganaSyncStatus = result.alreadyExists ? 'linked' : 'synced';
        console.log('✅ Usuario de prueba sincronizado con JUGAYGANA');
      } else {
        console.log('⚠️ No se pudo sincronizar usuario de prueba:', result.error);
      }
    }
  }
  
  saveUsers(users);
}

// ============================================
// ENDPOINTS DE MOVIMIENTOS (DEPÓSITOS/RETIROS)
// ============================================

// Depósito real en JUGAYGANA
app.post('/api/movements/deposit', authMiddleware, async (req, res) => {
  try {
    const { amount } = req.body;
    const username = req.user.username;
    
    if (!amount || amount < 100) {
      return res.status(400).json({ error: 'Monto mínimo $100' });
    }
    
    const result = await jugayganaMovements.makeDeposit(
      username, 
      amount, 
      `Depósito desde Sala de Juegos - ${new Date().toLocaleString('es-AR')}`
    );
    
    if (result.success) {
      // Registrar actividad para fueguito
      recordUserActivity(req.user.userId, 'deposit', amount);
      
      res.json({
        success: true,
        message: `Depósito de $${amount} realizado correctamente`,
        newBalance: result.newBalance,
        transactionId: result.transactionId
      });
    } else {
      res.status(400).json({ error: result.error || 'Error al realizar depósito' });
    }
  } catch (error) {
    console.error('Error en depósito:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Retiro real en JUGAYGANA
app.post('/api/movements/withdraw', authMiddleware, async (req, res) => {
  try {
    const { amount } = req.body;
    const username = req.user.username;
    
    if (!amount || amount < 100) {
      return res.status(400).json({ error: 'Monto mínimo $100' });
    }
    
    const result = await jugayganaMovements.makeWithdrawal(
      username, 
      amount, 
      `Retiro desde Sala de Juegos - ${new Date().toLocaleString('es-AR')}`
    );
    
    if (result.success) {
      // Registrar actividad para fueguito
      recordUserActivity(req.user.userId, 'withdrawal', amount);
      
      res.json({
        success: true,
        message: `Retiro de $${amount} realizado correctamente`,
        newBalance: result.newBalance,
        transactionId: result.transactionId
      });
    } else {
      res.status(400).json({ error: result.error || 'Error al realizar retiro' });
    }
  } catch (error) {
    console.error('Error en retiro:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Obtener balance
app.get('/api/movements/balance', authMiddleware, async (req, res) => {
  try {
    const username = req.user.username;
    const result = await jugayganaMovements.getUserBalance(username);
    
    if (result.success) {
      res.json({ balance: result.balance });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (error) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================
// SISTEMA DE FUEGUITO (RACHA DIARIA)
// ============================================

const ACTIVITY_FILE = path.join(DATA_DIR, 'user-activity.json');
const FIRE_REWARDS_FILE = path.join(DATA_DIR, 'fire-rewards.json');

function loadUserActivity() {
  try {
    if (!fs.existsSync(ACTIVITY_FILE)) return {};
    return JSON.parse(fs.readFileSync(ACTIVITY_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveUserActivity(activity) {
  fs.writeFileSync(ACTIVITY_FILE, JSON.stringify(activity, null, 2));
}

function loadFireRewards() {
  try {
    if (!fs.existsSync(FIRE_REWARDS_FILE)) return {};
    return JSON.parse(fs.readFileSync(FIRE_REWARDS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveFireRewards(rewards) {
  fs.writeFileSync(FIRE_REWARDS_FILE, JSON.stringify(rewards, null, 2));
}

function recordUserActivity(userId, type, amount) {
  const activity = loadUserActivity();
  const today = new Date().toDateString();
  
  if (!activity[userId]) {
    activity[userId] = { days: {} };
  }
  
  if (!activity[userId].days[today]) {
    activity[userId].days[today] = { deposits: 0, withdrawals: 0 };
  }
  
  activity[userId].days[today][type === 'deposit' ? 'deposits' : 'withdrawals'] += amount;
  saveUserActivity(activity);
}

function hasActivityToday(userId) {
  const activity = loadUserActivity();
  const today = new Date().toDateString();
  
  if (!activity[userId] || !activity[userId].days[today]) {
    return false;
  }
  
  const todayActivity = activity[userId].days[today];
  return (todayActivity.deposits > 0 || todayActivity.withdrawals > 0);
}

// Obtener estado del fueguito
app.get('/api/fire/status', authMiddleware, (req, res) => {
  try {
    const userId = req.user.userId;
    const rewards = loadFireRewards();
    const userRewards = rewards[userId] || { streak: 0, lastClaim: null, totalClaimed: 0 };
    
    const today = new Date().toDateString();
    const lastClaim = userRewards.lastClaim ? new Date(userRewards.lastClaim).toDateString() : null;
    
    // Verificar si puede reclamar hoy (sin requisitos de actividad)
    const canClaim = lastClaim !== today;
    
    // Verificar si perdió la racha (no reclamó ayer)
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toDateString();
    
    // Si no reclamó ayer y tiene racha > 0, resetear
    if (lastClaim !== yesterdayStr && lastClaim !== today && userRewards.streak > 0) {
      userRewards.streak = 0;
      rewards[userId] = userRewards;
      saveFireRewards(rewards);
    }
    
    res.json({
      streak: userRewards.streak || 0,
      lastClaim: userRewards.lastClaim,
      totalClaimed: userRewards.totalClaimed || 0,
      canClaim: canClaim,
      hasActivityToday: true, // Siempre true, no requiere actividad
      nextReward: userRewards.streak >= 9 ? 10000 : 0
    });
  } catch (error) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Reclamar fueguito
app.post('/api/fire/claim', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const username = req.user.username;
    
    const rewards = loadFireRewards();
    const userRewards = rewards[userId] || { streak: 0, lastClaim: null, totalClaimed: 0 };
    
    const today = new Date().toDateString();
    const lastClaim = userRewards.lastClaim ? new Date(userRewards.lastClaim).toDateString() : null;
    
    // Verificar si ya reclamó hoy
    if (lastClaim === today) {
      return res.status(400).json({ error: 'Ya reclamaste tu fueguito hoy' });
    }
    
    // Verificar racha - si no reclamó ayer, resetear
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toDateString();
    
    if (lastClaim !== yesterdayStr && userRewards.streak > 0) {
      userRewards.streak = 0;
    }
    
    userRewards.streak += 1;
    userRewards.lastClaim = new Date().toISOString();
    
    // Verificar recompensa de 10 días
    let reward = 0;
    let message = `Día ${userRewards.streak} de racha!`;
    
    if (userRewards.streak === 10) {
      reward = 10000;
      userRewards.totalClaimed += reward;
      
      // Acreditar recompensa en JUGAYGANA como BONIFICACIÓN (individual_bonus)
      const bonusResult = await jugayganaMovements.makeBonus(
        username,
        reward,
        `Recompensa racha 10 días - Sala de Juegos`
      );
      
      if (!bonusResult.success) {
        // Si falla la bonificación, no marcar como reclamado
        return res.status(400).json({ 
          error: 'Error al acreditar recompensa: ' + bonusResult.error 
        });
      }
      
      message = `¡Felicidades! 10 días de racha! Recompensa: $${reward.toLocaleString()}`;
    }
    
    rewards[userId] = userRewards;
    saveFireRewards(rewards);
    
    res.json({
      success: true,
      streak: userRewards.streak,
      reward,
      message,
      totalClaimed: userRewards.totalClaimed
    });
  } catch (error) {
    console.error('Error reclamando fueguito:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================
// INICIAR SERVIDOR
// ============================================

// Para Vercel (serverless)
if (process.env.VERCEL) {
  // Inicializar datos
  initializeData().then(() => {
    console.log('✅ Datos inicializados para Vercel');
  });
  
  // Exportar para Vercel
  module.exports = app;
} else {
  // Para desarrollo local
  initializeData().then(() => {
    server.listen(PORT, () => {
      console.log(`
🎮 ============================================
🎮  SALA DE JUEGOS - BACKEND INICIADO
🎮 ============================================
🎮  
🎮  🌐 URL: http://localhost:${PORT}
🎮  
🎮  📊 Endpoints:
🎮  • POST /api/auth/login        - Login
🎮  • POST /api/auth/register     - Registro
🎮  • GET  /api/users             - Lista usuarios (admin)
🎮  • GET  /api/messages/:userId  - Mensajes de usuario
🎮  • GET  /api/conversations     - Conversaciones (admin)
🎮  
🎮  🔑 Credenciales Admin:
🎮  • Usuario: ignite100
🎮  • Contraseña: pepsi100
🎮  
🎮  👤 Usuario de Prueba:
🎮  • Usuario: 672rosana1
🎮  • Contraseña: asd123
🎮  
🎮 ============================================
      `);
    });
  });
}
