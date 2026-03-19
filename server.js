// ============================================
// SALA DE JUEGOS - BACKEND CON MONGODB
// ============================================

require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');

// Importar modelos y servicios
const { connectDB } = require('./models');
const db = require('./services/database');

// Importar integración JUGAYGANA
const jugaygana = require('./jugaygana');
const jugayganaMovements = require('./jugaygana-movements');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'sala-de-juegos-secret-key-2024';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Estado de conexión MongoDB
let useMongoDB = false;

// ============================================
// MIDDLEWARE DE AUTENTICACIÓN
// ============================================

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido' });
  }
}

function adminMiddleware(req, res, next) {
  const adminRoles = ['admin', 'depositor', 'withdrawer'];
  if (!adminRoles.includes(req.user.role)) {
    return res.status(403).json({ error: 'Acceso denegado' });
  }
  next();
}

function depositorMiddleware(req, res, next) {
  if (!['admin', 'depositor'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Solo depositores' });
  }
  next();
}

function withdrawerMiddleware(req, res, next) {
  if (!['admin', 'withdrawer'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Solo retiradores' });
  }
  next();
}

// ============================================
// BLOQUEO DE REEMBOLSOS
// ============================================

const refundLocks = new Map();

function acquireRefundLock(userId, type) {
  const key = `${userId}_${type}`;
  if (refundLocks.has(key)) return false;
  refundLocks.set(key, Date.now());
  return true;
}

function releaseRefundLock(userId, type) {
  refundLocks.delete(`${userId}_${type}`);
}

// ============================================
// FUNCIONES AUXILIARES
// ============================================

function getArgentinaDateString(date = new Date()) {
  const argentinaTime = new Date(date.toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }));
  return argentinaTime.toDateString();
}

function getArgentinaYesterday() {
  const now = new Date();
  const argentinaNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }));
  argentinaNow.setDate(argentinaNow.getDate() - 1);
  return argentinaNow.toDateString();
}

// ============================================
// RUTAS DE AUTENTICACIÓN
// ============================================

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await db.getUserByUsername(username);
    
    if (!user || !await bcrypt.compare(password, user.password)) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }
    
    if (!user.isActive) return res.status(403).json({ error: 'Cuenta desactivada' });
    
    await db.updateUser(user.id, { lastLogin: useMongoDB ? new Date() : new Date().toISOString() });
    
    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        phone: user.phone,
        role: user.role,
        accountNumber: user.accountNumber,
        balance: user.balance
      }
    });
  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, phone, password } = req.body;
    
    const existingUser = await db.getUserByUsername(username);
    if (existingUser) return res.status(400).json({ error: 'El usuario ya existe' });
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = await db.createUser({
      username,
      password: hashedPassword,
      email,
      phone,
      role: 'user',
      balance: 0,
      isActive: true,
      jugayganaSyncStatus: 'pending'
    });
    
    // Sincronizar con JUGAYGANA en background
    jugaygana.syncUserToPlatform({ username, password }).then(async (result) => {
      if (result.success) {
        await db.updateUser(newUser.id, {
          jugayganaUserId: result.jugayganaUserId || result.user?.user_id,
          jugayganaUsername: result.jugayganaUsername || result.user?.user_name,
          jugayganaSyncStatus: result.alreadyExists ? 'linked' : 'synced'
        });
      }
    });
    
    const token = jwt.sign(
      { userId: newUser.id, username: newUser.username, role: newUser.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    res.status(201).json({
      token,
      user: {
        id: newUser.id,
        username: newUser.username,
        email: newUser.email,
        role: newUser.role,
        accountNumber: newUser.accountNumber,
        balance: newUser.balance
      }
    });
  } catch (error) {
    console.error('Error en registro:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.get('/api/auth/verify', authMiddleware, (req, res) => {
  res.json({ valid: true, user: req.user });
});

// ============================================
// RUTAS DE USUARIOS
// ============================================

app.get('/api/users', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const users = await db.getAllUsers();
    res.json(users.map(u => ({ ...u, password: undefined })));
  } catch (error) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.post('/api/users', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { username, email, phone, password, role = 'user', balance = 0 } = req.body;
    
    const existing = await db.getUserByUsername(username);
    if (existing) return res.status(400).json({ error: 'El usuario ya existe' });
    
    const hashedPassword = await bcrypt.hash(password || 'asd123', 10);
    const newUser = await db.createUser({
      username,
      password: hashedPassword,
      email,
      phone,
      role,
      balance,
      isActive: true,
      jugayganaSyncStatus: role === 'user' ? 'pending' : 'not_applicable'
    });
    
    if (role === 'user') {
      jugaygana.syncUserToPlatform({ username, password: password || 'asd123' }).then(async (result) => {
        if (result.success) {
          await db.updateUser(newUser.id, {
            jugayganaUserId: result.jugayganaUserId || result.user?.user_id,
            jugayganaUsername: result.jugayganaUsername || result.user?.user_name,
            jugayganaSyncStatus: result.alreadyExists ? 'linked' : 'synced'
          });
        }
      });
    }
    
    res.status(201).json({ message: 'Usuario creado', user: { ...newUser, password: undefined } });
  } catch (error) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.put('/api/users/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const updates = req.body;
    if (updates.password) {
      updates.password = await bcrypt.hash(updates.password, 10);
      updates.passwordChangedAt = useMongoDB ? new Date() : new Date().toISOString();
    }
    
    const user = await db.updateUser(req.params.id, updates);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    
    res.json({ message: 'Usuario actualizado', user: { ...user, password: undefined } });
  } catch (error) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.delete('/api/users/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const user = await db.getUserById(req.params.id);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    
    const adminRoles = ['admin', 'depositor', 'withdrawer'];
    if (adminRoles.includes(user.role) && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Solo administradores pueden eliminar otros administradores' });
    }
    
    await db.deleteUser(req.params.id);
    res.json({ message: 'Usuario eliminado' });
  } catch (error) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================
// RUTAS DE MENSAJES
// ============================================

app.get('/api/messages/:userId', authMiddleware, async (req, res) => {
  try {
    const { userId } = req.params;
    const limit = parseInt(req.query.limit) || 100;
    
    const adminRoles = ['admin', 'depositor', 'withdrawer'];
    if (!adminRoles.includes(req.user.role) && req.user.userId !== userId) {
      return res.status(403).json({ error: 'Acceso denegado' });
    }
    
    const messages = await db.getMessagesByUser(userId, limit);
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.get('/api/conversations', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const conversations = await db.getConversations();
    res.json(conversations);
  } catch (error) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.post('/api/messages/read/:userId', authMiddleware, async (req, res) => {
  try {
    await db.markMessagesAsRead(req.params.userId);
    res.json({ message: 'Mensajes marcados como leídos' });
  } catch (error) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.post('/api/messages/send', authMiddleware, async (req, res) => {
  try {
    const { content, type = 'text', receiverId } = req.body;
    if (!content) return res.status(400).json({ error: 'Contenido requerido' });
    
    const adminRoles = ['admin', 'depositor', 'withdrawer'];
    const isAdminRole = adminRoles.includes(req.user.role);
    
    const message = await db.saveMessage({
      senderId: req.user.userId,
      senderUsername: req.user.username,
      senderRole: req.user.role,
      receiverId: isAdminRole ? (receiverId || 'admin') : 'admin',
      receiverRole: isAdminRole ? 'user' : 'admin',
      content,
      type
    });
    
    // Agregar a usuarios externos si es usuario
    if (req.user.role === 'user') {
      const user = await db.getUserById(req.user.userId);
      if (user) await db.addExternalUser({ username: user.username, phone: user.phone });
    }
    
    // Reabrir chat si estaba cerrado
    if (req.user.role === 'user') {
      const chatStatus = await db.getChatStatus(req.user.userId);
      if (chatStatus.status === 'closed') {
        await db.updateChatStatus(req.user.userId, { status: 'open', closedAt: null, closedBy: null });
      }
    }
    
    res.json(message);
  } catch (error) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================
// RUTAS DE CHATS (ADMIN)
// ============================================

app.get('/api/admin/chat-status/all', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const chats = await db.getAllUsers();
    const chatStatuses = await Promise.all(
      chats.filter(u => u.role === 'user').map(u => db.getChatStatus(u.id))
    );
    res.json(chatStatuses);
  } catch (error) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.get('/api/admin/chats/:status', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const chats = await db.getChatsByStatus(req.params.status);
    res.json(chats);
  } catch (error) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.post('/api/admin/chats/:userId/close', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    await db.updateChatStatus(req.params.userId, {
      status: 'closed',
      closedAt: useMongoDB ? new Date() : new Date().toISOString(),
      closedBy: req.user.username,
      assignedTo: null,
      category: 'cargas'
    });
    res.json({ success: true, message: 'Chat cerrado' });
  } catch (error) {
    res.status(500).json({ error: 'Error cerrando chat' });
  }
});

app.post('/api/admin/chats/:userId/reopen', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    await db.updateChatStatus(req.params.userId, {
      status: 'open',
      closedAt: null,
      closedBy: null,
      assignedTo: req.user.username
    });
    res.json({ success: true, message: 'Chat reabierto' });
  } catch (error) {
    res.status(500).json({ error: 'Error reabriendo chat' });
  }
});

app.post('/api/admin/chats/:userId/assign', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { agent } = req.body;
    await db.updateChatStatus(req.params.userId, { assignedTo: agent, status: 'open' });
    res.json({ success: true, message: 'Chat asignado a ' + agent });
  } catch (error) {
    res.status(500).json({ error: 'Error asignando chat' });
  }
});

// ============================================
// RUTAS DE REEMBOLSOS
// ============================================

app.get('/api/refunds/status', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const username = req.user.username;
    
    const userInfo = await jugaygana.getUserInfoByName(username);
    const currentBalance = userInfo ? userInfo.balance : 0;
    
    const [yesterdayMovements, lastWeekMovements, lastMonthMovements] = await Promise.all([
      jugaygana.getUserNetYesterday(username),
      jugaygana.getUserNetLastWeek(username),
      jugaygana.getUserNetLastMonth(username)
    ]);
    
    const claimedToday = await jugaygana.checkClaimedToday(username);
    
    // Calcular reembolsos potenciales
    const calculateRefund = (deposits, withdrawals, percentage) => {
      const net = deposits - withdrawals;
      return net > 0 ? Math.floor(net * (percentage / 100)) : 0;
    };
    
    const lastDaily = await db.getLastRefund(userId, 'daily');
    const lastWeekly = await db.getLastRefund(userId, 'weekly');
    const lastMonthly = await db.getLastRefund(userId, 'monthly');
    
    const today = new Date().toDateString();
    const canClaimDaily = !lastDaily || new Date(lastDaily.claimedAt).toDateString() !== today;
    
    res.json({
      user: { username, currentBalance, jugayganaLinked: !!userInfo },
      daily: {
        canClaim: canClaimDaily,
        potentialAmount: calculateRefund(
          yesterdayMovements.success ? yesterdayMovements.totalDeposits : 0,
          yesterdayMovements.success ? yesterdayMovements.totalWithdraws : 0,
          20
        ),
        percentage: 20
      },
      weekly: {
        canClaim: !lastWeekly || (new Date() - new Date(lastWeekly.claimedAt)) >= 7 * 24 * 60 * 60 * 1000,
        potentialAmount: calculateRefund(
          lastWeekMovements.success ? lastWeekMovements.totalDeposits : 0,
          lastWeekMovements.success ? lastWeekMovements.totalWithdraws : 0,
          10
        ),
        percentage: 10
      },
      monthly: {
        canClaim: !lastMonthly || (new Date() - new Date(lastMonthly.claimedAt)) >= 30 * 24 * 60 * 60 * 1000,
        potentialAmount: calculateRefund(
          lastMonthMovements.success ? lastMonthMovements.totalDeposits : 0,
          lastMonthMovements.success ? lastMonthMovements.totalWithdraws : 0,
          5
        ),
        percentage: 5
      },
      claimedToday: claimedToday.success ? claimedToday.claimed : false
    });
  } catch (error) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.post('/api/refunds/claim/:type', authMiddleware, async (req, res) => {
  try {
    const { type } = req.params;
    const userId = req.user.userId;
    const username = req.user.username;
    
    if (!['daily', 'weekly', 'monthly'].includes(type)) {
      return res.status(400).json({ error: 'Tipo inválido' });
    }
    
    if (!acquireRefundLock(userId, type)) {
      return res.json({ success: false, message: '⏳ Procesando...', canClaim: true, processing: true });
    }
    
    try {
      const lastRefund = await db.getLastRefund(userId, type);
      const now = new Date();
      
      // Verificar si puede reclamar
      let canClaim = false;
      if (!lastRefund) {
        canClaim = true;
      } else {
        const lastClaim = new Date(lastRefund.claimedAt);
        if (type === 'daily') canClaim = lastClaim.toDateString() !== now.toDateString();
        else if (type === 'weekly') canClaim = (now - lastClaim) >= 7 * 24 * 60 * 60 * 1000;
        else if (type === 'monthly') canClaim = (now - lastClaim) >= 30 * 24 * 60 * 60 * 1000;
      }
      
      if (!canClaim) {
        return res.json({ success: false, message: 'No disponible aún', canClaim: false });
      }
      
      // Obtener movimientos
      let movements;
      if (type === 'daily') movements = await jugaygana.getUserNetYesterday(username);
      else if (type === 'weekly') movements = await jugaygana.getUserNetLastWeek(username);
      else movements = await jugaygana.getUserNetLastMonth(username);
      
      if (!movements.success) {
        return res.json({ success: false, message: 'Error obteniendo movimientos', canClaim: true });
      }
      
      const net = movements.totalDeposits - movements.totalWithdraws;
      const percentage = type === 'daily' ? 20 : type === 'weekly' ? 10 : 5;
      const refundAmount = net > 0 ? Math.floor(net * (percentage / 100)) : 0;
      
      if (refundAmount <= 0) {
        return res.json({ success: false, message: 'No tienes saldo neto positivo', canClaim: true });
      }
      
      const depositResult = await jugaygana.creditUserBalance(username, refundAmount);
      
      if (!depositResult.success) {
        return res.json({ success: false, message: 'Error al acreditar: ' + depositResult.error, canClaim: true });
      }
      
      const refund = await db.createRefund({
        userId,
        username,
        type,
        amount: refundAmount,
        percentage,
        netAmount: net,
        deposits: movements.totalDeposits,
        withdrawals: movements.totalWithdraws,
        transactionId: depositResult.data?.transfer_id || depositResult.data?.transferId
      });
      
      res.json({
        success: true,
        message: `¡Reembolso ${type} de $${refundAmount} acreditado!`,
        amount: refundAmount,
        refund
      });
    } finally {
      setTimeout(() => releaseRefundLock(userId, type), 3000);
    }
  } catch (error) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.get('/api/refunds/history', authMiddleware, async (req, res) => {
  try {
    const refunds = await db.getUserRefunds(req.user.userId);
    res.json({ refunds });
  } catch (error) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================
// RUTAS DE BALANCE
// ============================================

app.get('/api/balance', authMiddleware, async (req, res) => {
  try {
    const result = await jugayganaMovements.getUserBalance(req.user.username);
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
// RUTAS ADMIN - DEPÓSITOS/RETIROS/BONUS
// ============================================

app.post('/api/admin/deposit', authMiddleware, depositorMiddleware, async (req, res) => {
  try {
    const { username, amount, description } = req.body;
    if (!username || !amount) return res.status(400).json({ error: 'Usuario y monto requeridos' });
    
    const result = await jugaygana.depositToUser(username, amount, description);
    
    if (result.success) {
      const user = await db.getUserByUsername(username);
      if (user) await db.recordActivity(user.id, 'deposit', amount);
      
      await db.createTransaction({
        type: 'deposit',
        amount: parseFloat(amount),
        username,
        description: description || 'Depósito realizado',
        adminId: req.user?.userId,
        adminUsername: req.user?.username,
        externalId: result.data?.transfer_id || result.data?.transferId
      });
      
      res.json({ success: true, message: 'Depósito realizado', transactionId: result.data?.transfer_id });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (error) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.post('/api/admin/withdrawal', authMiddleware, withdrawerMiddleware, async (req, res) => {
  try {
    const { username, amount, description } = req.body;
    if (!username || !amount) return res.status(400).json({ error: 'Usuario y monto requeridos' });
    
    const result = await jugaygana.withdrawFromUser(username, amount, description);
    
    if (result.success) {
      const user = await db.getUserByUsername(username);
      if (user) await db.recordActivity(user.id, 'withdrawal', amount);
      
      await db.createTransaction({
        type: 'withdrawal',
        amount: parseFloat(amount),
        username,
        description: description || 'Retiro realizado',
        adminId: req.user?.userId,
        adminUsername: req.user?.username,
        externalId: result.data?.transfer_id || result.data?.transferId
      });
      
      res.json({ success: true, message: 'Retiro realizado', transactionId: result.data?.transfer_id });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (error) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.post('/api/admin/bonus', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { username, amount } = req.body;
    if (!username || !amount) return res.status(400).json({ error: 'Usuario y monto requeridos' });
    
    const bonusAmount = parseFloat(amount);
    if (isNaN(bonusAmount) || bonusAmount <= 0) return res.status(400).json({ error: 'Monto inválido' });
    
    const result = await jugaygana.creditUserBalance(username, bonusAmount);
    
    if (result.success) {
      await db.createTransaction({
        type: 'bonus',
        amount: bonusAmount,
        username,
        description: 'Bonificación otorgada',
        adminId: req.user?.userId,
        adminUsername: req.user?.username,
        externalId: result.data?.transfer_id || result.data?.transferId
      });
      
      res.json({ success: true, message: `Bonificación de $${bonusAmount.toLocaleString()} realizada` });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (error) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================
// RUTAS ADMIN - ESTADÍSTICAS
// ============================================

app.get('/api/admin/stats', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const totalUsers = await db.countUsers();
    const unreadMessages = await db.getUnreadMessageCount();
    const users = await db.getAllUsers();
    const totalBalance = users.reduce((sum, u) => sum + (u.balance || 0), 0);
    
    res.json({
      totalUsers,
      onlineUsers: users.filter(u => u.lastLogin && new Date(u.lastLogin) > new Date(Date.now() - 5 * 60 * 1000)).length,
      unreadMessages,
      totalBalance
    });
  } catch (error) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================
// RUTAS ADMIN - CONFIGURACIÓN (CBU)
// ============================================

app.get('/api/admin/config', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const cbu = await db.getCBUConfig();
    const welcomeMessage = await db.getWelcomeMessage();
    const depositMessage = await db.getDepositMessage();
    res.json({ cbu, welcomeMessage, depositMessage });
  } catch (error) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.put('/api/admin/config/cbu', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    await db.setCBUConfig(req.body, req.user.username);
    res.json({ success: true, message: 'CBU actualizado' });
  } catch (error) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================
// RUTAS ADMIN - COMANDOS PERSONALIZADOS
// ============================================

app.get('/api/admin/commands', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const commands = await db.getAllCommands();
    res.json(commands);
  } catch (error) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.post('/api/admin/commands', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { name, description, type, bonusPercent, response } = req.body;
    if (!name || !name.startsWith('/')) return res.status(400).json({ error: 'El comando debe empezar con /' });
    
    const command = await db.createCommand({
      name,
      description,
      type,
      bonusPercent: parseInt(bonusPercent) || 0,
      response,
      createdBy: req.user.username
    });
    
    res.json({ success: true, command });
  } catch (error) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.delete('/api/admin/commands/:name', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    await db.deleteCommand(req.params.name);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================
// RUTAS ADMIN - TRANSACCIONES
// ============================================

app.get('/api/admin/transactions', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { from, to, type } = req.query;
    const transactions = await db.getTransactions({ from, to, type, limit: 100 });
    const stats = await db.getTransactionStats();
    res.json({ transactions, summary: stats, total: transactions.length });
  } catch (error) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================
// SISTEMA DE FUEGUITOS (RACHA DIARIA)
// ============================================

app.get('/api/fire/status', authMiddleware, async (req, res) => {
  try {
    const reward = await db.getFireReward(req.user.userId);
    
    const todayArgentina = getArgentinaDateString();
    const lastClaim = reward.lastClaim ? getArgentinaDateString(new Date(reward.lastClaim)) : null;
    const canClaim = lastClaim !== todayArgentina;
    
    const yesterdayArgentina = getArgentinaYesterday();
    
    // Resetear racha si no reclamó ayer
    if (lastClaim !== yesterdayArgentina && lastClaim !== todayArgentina && reward.streak > 0) {
      await db.updateFireReward(req.user.userId, { streak: 0 });
      reward.streak = 0;
    }
    
    res.json({
      streak: reward.streak || 0,
      lastClaim: reward.lastClaim,
      totalClaimed: reward.totalClaimed || 0,
      canClaim,
      nextReward: reward.streak >= 9 ? 10000 : 0
    });
  } catch (error) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.post('/api/fire/claim', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const username = req.user.username;
    
    const reward = await db.getFireReward(userId);
    
    const todayArgentina = getArgentinaDateString();
    const lastClaim = reward.lastClaim ? getArgentinaDateString(new Date(reward.lastClaim)) : null;
    
    if (lastClaim === todayArgentina) {
      return res.status(400).json({ error: 'Ya reclamaste hoy' });
    }
    
    const yesterdayArgentina = getArgentinaYesterday();
    
    if (lastClaim !== yesterdayArgentina && reward.streak > 0) {
      reward.streak = 0;
    }
    
    const newStreak = reward.streak + 1;
    let bonusAmount = 0;
    let message = `Día ${newStreak} de racha!`;
    let transactionId = null;
    
    if (newStreak === 10) {
      bonusAmount = 10000;
      const bonusResult = await jugayganaMovements.makeBonus(username, bonusAmount, 'Recompensa racha 10 días');
      
      if (!bonusResult.success) {
        return res.status(400).json({ error: 'Error al acreditar: ' + bonusResult.error });
      }
      
      transactionId = bonusResult.data?.transfer_id || bonusResult.data?.transferId;
      message = `¡Felicidades! 10 días de racha! Recompensa: $${bonusAmount.toLocaleString()}`;
    }
    
    await db.updateFireReward(userId, {
      streak: newStreak,
      lastClaim: new Date(),
      totalClaimed: (reward.totalClaimed || 0) + bonusAmount
    });
    
    if (newStreak === 10) {
      await db.addFireRewardHistory(userId, {
        date: new Date(),
        streak: newStreak,
        reward: bonusAmount,
        transactionId
      });
    }
    
    res.json({ success: true, streak: newStreak, reward: bonusAmount, message, totalClaimed: (reward.totalClaimed || 0) + bonusAmount });
  } catch (error) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================
// SOCKET.IO - CHAT EN TIEMPO REAL
// ============================================

const connectedUsers = new Map();
const connectedAdmins = new Map();

io.on('connection', (socket) => {
  socket.on('authenticate', (token) => {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      socket.userId = decoded.userId;
      socket.username = decoded.username;
      socket.role = decoded.role;
      
      if (decoded.role === 'admin') {
        connectedAdmins.set(decoded.userId, socket);
        notifyAdmins('stats', getStats());
      } else {
        connectedUsers.set(decoded.userId, socket);
        socket.join(`user_${decoded.userId}`);
        notifyAdmins('user_connected', { userId: decoded.userId, username: decoded.username });
      }
      
      socket.emit('authenticated', { success: true, role: decoded.role });
    } catch {
      socket.emit('authenticated', { success: false, error: 'Token inválido' });
    }
  });
  
  socket.on('send_message', async (data) => {
    try {
      const { content, receiverId } = data;
      if (!socket.userId) return socket.emit('error', { message: 'No autenticado' });
      
      const isAdmin = socket.role === 'admin';
      const message = await db.saveMessage({
        senderId: socket.userId,
        senderUsername: socket.username,
        senderRole: socket.role,
        receiverId: isAdmin ? receiverId : 'admin',
        receiverRole: isAdmin ? 'user' : 'admin',
        content,
        type: 'text'
      });
      
      if (isAdmin) {
        const userSocket = connectedUsers.get(receiverId);
        if (userSocket) userSocket.emit('new_message', message);
      } else {
        notifyAdmins('new_message', { message, userId: socket.userId, username: socket.username });
      }
      
      socket.emit('message_sent', message);
      notifyAdmins('stats', getStats());
    } catch (error) {
      socket.emit('error', { message: 'Error enviando mensaje' });
    }
  });
  
  socket.on('disconnect', () => {
    if (socket.role === 'admin') {
      connectedAdmins.delete(socket.userId);
      notifyAdmins('stats', getStats());
    } else {
      connectedUsers.delete(socket.userId);
      notifyAdmins('user_disconnected', { userId: socket.userId, username: socket.username });
    }
  });
});

function notifyAdmins(event, data) {
  connectedAdmins.forEach(socket => socket.emit(event, data));
}

function getStats() {
  return {
    connectedUsers: connectedUsers.size,
    connectedAdmins: connectedAdmins.size
  };
}

// ============================================
// RUTAS ESTÁTICAS
// ============================================

function readFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    console.error(`Error leyendo archivo ${filePath}:`, error.message);
    return null;
  }
}

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
// INICIALIZAR DATOS
// ============================================

async function initializeData() {
  // Verificar IP pública
  if (process.env.PROXY_URL) {
    console.log('🔍 Verificando IP pública...');
    await jugaygana.logProxyIP();
  }
  
  // Conectar a MongoDB
  console.log('🔌 Conectando a base de datos...');
  useMongoDB = await connectDB();
  db.setUseMongoDB(useMongoDB);
  
  // Probar conexión JUGAYGANA
  console.log('🔑 Probando conexión con JUGAYGANA...');
  const sessionOk = await jugaygana.ensureSession();
  if (sessionOk) {
    console.log('✅ Conexión con JUGAYGANA establecida');
  } else {
    console.log('⚠️ No se pudo conectar con JUGAYGANA');
  }
  
  // Crear usuarios por defecto si no existen
  const adminExists = await db.getUserByUsername('ignite100');
  if (!adminExists) {
    await db.createUser({
      username: 'ignite100',
      password: await bcrypt.hash('pepsi100', 10),
      email: 'admin@saladejuegos.com',
      role: 'admin',
      balance: 0,
      isActive: true,
      jugayganaSyncStatus: 'not_applicable'
    });
    console.log('✅ Admin creado: ignite100 / pepsi100');
  }
  
  const oldAdmin = await db.getUserByUsername('admin');
  if (!oldAdmin) {
    await db.createUser({
      username: 'admin',
      password: await bcrypt.hash('admin123', 10),
      email: 'admin@saladejuegos.com',
      role: 'admin',
      balance: 0,
      isActive: true,
      jugayganaSyncStatus: 'not_applicable'
    });
    console.log('✅ Admin respaldo creado: admin / admin123');
  }
  
  const testUser = await db.getUserByUsername('672rosana1');
  if (!testUser) {
    await db.createUser({
      username: '672rosana1',
      password: await bcrypt.hash('asd123', 10),
      email: 'rosana@email.com',
      role: 'user',
      balance: 1500,
      isActive: true,
      jugayganaSyncStatus: 'pending'
    });
    console.log('✅ Usuario de prueba creado: 672rosana1 / asd123');
  }
}

// ============================================
// INICIAR SERVIDOR
// ============================================

if (process.env.VERCEL) {
  initializeData().then(() => {
    console.log('✅ Datos inicializados para Vercel');
  });
  module.exports = app;
} else {
  initializeData().then(() => {
    server.listen(PORT, () => {
      console.log(`
🎮 ============================================
🎮  SALA DE JUEGOS - BACKEND CON MONGODB
🎮 ============================================
🎮  
🎮  🌐 URL: http://localhost:${PORT}
🎮  💾 Base de datos: ${useMongoDB ? 'MongoDB ✅' : 'JSON (fallback)'}
🎮  
🎮  🔑 Credenciales Admin:
🎮  • ignite100 / pepsi100
🎮  • admin / admin123
🎮  
🎮  👤 Usuario de Prueba:
🎮  • 672rosana1 / asd123
🎮  
🎮 ============================================
      `);
    });
  });
}
