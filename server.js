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
    // Para usuarios de JUGAYGANA, la contraseña por defecto es 'asd123'
    // Si el usuario cambió su contraseña localmente, se usa esa
    let isValidPassword = await bcrypt.compare(password, user.password);
    
    // Si la contraseña local falla y el usuario viene de JUGAYGANA, intentar con 'asd123'
    if (!isValidPassword && user.source === 'jugaygana') {
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
    
    // Si se actualiza la contraseña, hashearla
    if (updates.password) {
      updates.password = await bcrypt.hash(updates.password, 10);
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

// Obtener mensajes de un usuario
app.get('/api/messages/:userId', authMiddleware, (req, res) => {
  try {
    const { userId } = req.params;
    const messages = loadMessages();
    
    // Si es admin, puede ver todos los mensajes
    // Si es user, solo puede ver sus propios mensajes
    if (req.user.role !== 'admin' && req.user.userId !== userId) {
      return res.status(403).json({ error: 'Acceso denegado' });
    }
    
    const userMessages = messages
      .filter(m => m.senderId === userId || m.receiverId === userId)
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    
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

// Obtener estado de reembolsos del usuario
app.get('/api/refunds/status', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const username = req.user.username;
    
    // Obtener movimientos de ayer
    const yesterdayMovements = await jugayganaMovements.getYesterdayMovements(username);
    
    const dailyStatus = refunds.canClaimDailyRefund(userId);
    const weeklyStatus = refunds.canClaimWeeklyRefund(userId);
    const monthlyStatus = refunds.canClaimMonthlyRefund(userId);
    
    // Calcular montos potenciales
    const deposits = yesterdayMovements.success ? yesterdayMovements.deposits.total : 0;
    const withdrawals = yesterdayMovements.success ? yesterdayMovements.withdrawals.total : 0;
    
    const dailyCalc = refunds.calculateRefund(deposits, withdrawals, 20);
    const weeklyCalc = refunds.calculateRefund(deposits, withdrawals, 10);
    const monthlyCalc = refunds.calculateRefund(deposits, withdrawals, 5);
    
    res.json({
      daily: {
        ...dailyStatus,
        potentialAmount: dailyCalc.refundAmount,
        netAmount: dailyCalc.netAmount,
        percentage: 20
      },
      weekly: {
        ...weeklyStatus,
        potentialAmount: weeklyCalc.refundAmount,
        netAmount: weeklyCalc.netAmount,
        percentage: 10
      },
      monthly: {
        ...monthlyStatus,
        potentialAmount: monthlyCalc.refundAmount,
        netAmount: monthlyCalc.netAmount,
        percentage: 5
      },
      yesterday: {
        deposits,
        withdrawals,
        netAmount: deposits - withdrawals
      }
    });
  } catch (error) {
    console.error('Error obteniendo estado de reembolsos:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Reclamar reembolso diario
app.post('/api/refunds/claim/daily', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const username = req.user.username;
    
    // Verificar si puede reclamar
    const status = refunds.canClaimDailyRefund(userId);
    if (!status.canClaim) {
      return res.status(400).json({ 
        error: 'Ya reclamaste tu reembolso diario',
        nextClaim: status.nextClaim
      });
    }
    
    // Obtener movimientos de ayer
    const yesterdayMovements = await jugayganaMovements.getYesterdayMovements(username);
    
    if (!yesterdayMovements.success) {
      return res.status(400).json({ error: 'No se pudieron obtener tus movimientos' });
    }
    
    const deposits = yesterdayMovements.deposits.total;
    const withdrawals = yesterdayMovements.withdrawals.total;
    
    // Calcular reembolso (20%)
    const calc = refunds.calculateRefund(deposits, withdrawals, 20);
    
    if (calc.refundAmount <= 0) {
      return res.status(400).json({ 
        error: 'No tienes saldo neto positivo para reclamar reembolso',
        netAmount: calc.netAmount
      });
    }
    
    // Realizar depósito en JUGAYGANA
    const depositResult = await jugayganaMovements.makeDeposit(
      username,
      calc.refundAmount,
      `Reembolso diario ${new Date().toLocaleDateString('es-AR')} - ${calc.percentage}% de $${calc.netAmount}`
    );
    
    if (!depositResult.success) {
      return res.status(400).json({ 
        error: 'Error al acreditar el reembolso: ' + depositResult.error 
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
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Reclamar reembolso semanal
app.post('/api/refunds/claim/weekly', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const username = req.user.username;
    
    // Verificar si puede reclamar
    const status = refunds.canClaimWeeklyRefund(userId);
    if (!status.canClaim) {
      return res.status(400).json({ 
        error: 'No puedes reclamar el reembolso semanal en este momento',
        nextClaim: status.nextClaim,
        availableDays: status.availableDays
      });
    }
    
    // Obtener movimientos de ayer
    const yesterdayMovements = await jugayganaMovements.getYesterdayMovements(username);
    
    if (!yesterdayMovements.success) {
      return res.status(400).json({ error: 'No se pudieron obtener tus movimientos' });
    }
    
    const deposits = yesterdayMovements.deposits.total;
    const withdrawals = yesterdayMovements.withdrawals.total;
    
    // Calcular reembolso (10%)
    const calc = refunds.calculateRefund(deposits, withdrawals, 10);
    
    if (calc.refundAmount <= 0) {
      return res.status(400).json({ 
        error: 'No tienes saldo neto positivo para reclamar reembolso',
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
      return res.status(400).json({ 
        error: 'Error al acreditar el reembolso: ' + depositResult.error 
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
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Reclamar reembolso mensual
app.post('/api/refunds/claim/monthly', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const username = req.user.username;
    
    // Verificar si puede reclamar
    const status = refunds.canClaimMonthlyRefund(userId);
    if (!status.canClaim) {
      return res.status(400).json({ 
        error: 'No puedes reclamar el reembolso mensual en este momento',
        nextClaim: status.nextClaim,
        availableFrom: status.availableFrom
      });
    }
    
    // Obtener movimientos de ayer
    const yesterdayMovements = await jugayganaMovements.getYesterdayMovements(username);
    
    if (!yesterdayMovements.success) {
      return res.status(400).json({ error: 'No se pudieron obtener tus movimientos' });
    }
    
    const deposits = yesterdayMovements.deposits.total;
    const withdrawals = yesterdayMovements.withdrawals.total;
    
    // Calcular reembolso (5%)
    const calc = refunds.calculateRefund(deposits, withdrawals, 5);
    
    if (calc.refundAmount <= 0) {
      return res.status(400).json({ 
        error: 'No tienes saldo neto positivo para reclamar reembolso',
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
      return res.status(400).json({ 
        error: 'Error al acreditar el reembolso: ' + depositResult.error 
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
      res.json(result);
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (error) {
    console.error('Error realizando depósito:', error);
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
      res.json(result);
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (error) {
    console.error('Error realizando retiro:', error);
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

// Ruta admin - serve admin.html
app.get('/admin', (req, res) => {
  const adminPath = path.join(__dirname, 'public', 'admin', 'index.html');
  const content = readFileSafe(adminPath);
  if (content) {
    res.setHeader('Content-Type', 'text/html');
    res.send(content);
  } else {
    res.status(500).send('Error loading admin page');
  }
});

// Servir archivos CSS del admin
app.get('/admin/admin.css', (req, res) => {
  const cssPath = path.join(__dirname, 'public', 'admin', 'admin.css');
  const content = readFileSafe(cssPath);
  if (content) {
    res.setHeader('Content-Type', 'text/css');
    res.send(content);
  } else {
    res.status(404).send('CSS not found');
  }
});

// Servir archivos JS del admin
app.get('/admin/admin.js', (req, res) => {
  const jsPath = path.join(__dirname, 'public', 'admin', 'admin.js');
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
  
  // Crear admin si no existe
  const adminExists = users.find(u => u.role === 'admin');
  if (!adminExists) {
    const adminPassword = await bcrypt.hash('admin123', 10);
    const admin = {
      id: uuidv4(),
      username: 'admin',
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
    console.log('✅ Admin creado: admin / admin123');
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
🎮  • Usuario: admin
🎮  • Contraseña: admin123
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
