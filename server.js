const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

// ============================================
// IMPORTAR MODELOS DE MONGODB
// ============================================
const {
  connectDB,
  User,
  Message,
  Command,
  Config,
  RefundClaim,
  FireStreak,
  ChatStatus,
  Transaction,
  ExternalUser,
  UserActivity,
  getConfig,
  setConfig,
  getAllCommands,
  saveCommand,
  deleteCommand,
  incrementCommandUsage
} = require('./config/database');

// ============================================
// SEGURIDAD - RATE LIMITING
// ============================================
const requestCounts = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000;
const RATE_LIMIT_MAX = 100;
const AUTH_RATE_LIMIT_MAX = 10;

function rateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const isAuthEndpoint = req.path.includes('/auth/');
  const maxRequests = isAuthEndpoint ? AUTH_RATE_LIMIT_MAX : RATE_LIMIT_MAX;
  
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW;
  
  for (const [key, data] of requestCounts) {
    if (data.timestamp < windowStart) {
      requestCounts.delete(key);
    }
  }
  
  const key = `${ip}:${req.path}`;
  const current = requestCounts.get(key);
  
  if (current && current.timestamp > windowStart) {
    if (current.count >= maxRequests) {
      return res.status(429).json({ 
        error: 'Demasiadas solicitudes. Intenta más tarde.',
        retryAfter: Math.ceil((current.timestamp + RATE_LIMIT_WINDOW - now) / 1000)
      });
    }
    current.count++;
  } else {
    requestCounts.set(key, { count: 1, timestamp: now });
  }
  
  next();
}

// ============================================
// SEGURIDAD - HEADERS DE SEGURIDAD
// ============================================
function securityHeaders(req, res, next) {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self';");
  next();
}

// ============================================
// SEGURIDAD - VALIDACIÓN DE INPUT
// ============================================
function sanitizeInput(input) {
  if (typeof input !== 'string') return input;
  return input
    .replace(/[<>]/g, '')
    .trim()
    .substring(0, 1000);
}

function validateUsername(username) {
  if (!username || typeof username !== 'string') return false;
  const sanitized = username.trim();
  return /^[a-zA-Z0-9_.-]{3,30}$/.test(sanitized);
}

function validatePassword(password) {
  if (!password || typeof password !== 'string') return false;
  return password.length >= 6 && password.length <= 100;
}

// Integración JUGAYGANA
const jugaygana = require('./jugaygana');
const jugayganaMovements = require('./jugaygana-movements');
const refunds = require('./models/refunds');

// ============================================
// BLOQUEO DE REEMBOLSOS
// ============================================
const refundLocks = new Map();

function acquireRefundLock(userId, type) {
  const key = `${userId}-${type}`;
  if (refundLocks.has(key)) {
    return false;
  }
  refundLocks.set(key, Date.now());
  return true;
}

function releaseRefundLock(userId, type) {
  const key = `${userId}-${type}`;
  refundLocks.delete(key);
}

setInterval(() => {
  const now = Date.now();
  for (const [key, timestamp] of refundLocks.entries()) {
    if (now - timestamp > 5 * 60 * 1000) {
      refundLocks.delete(key);
    }
  }
}, 60 * 1000);

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'sala-de-juegos-secret-key-2024';

// ============================================
// MIDDLEWARE DE SEGURIDAD
// ============================================
app.use(securityHeaders);
app.use(rateLimit);
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
  credentials: true
}));
app.use(express.json({ 
  limit: '10mb',
  verify: (req, res, buf) => {
    const body = buf.toString();
    if (body.length > 10 * 1024 * 1024) {
      throw new Error('Payload too large');
    }
  }
}));

app.use(express.static(path.join(__dirname, 'public'), {
  dotfiles: 'deny',
  index: false,
  maxAge: '1d'
}));

// ============================================
// FUNCIONES HELPER PARA MONGODB
// ============================================

// Generar número de cuenta
const generateAccountNumber = () => {
  return 'ACC' + Date.now().toString().slice(-8) + Math.random().toString(36).substr(2, 4).toUpperCase();
};

// Buscar usuario por teléfono
async function findUserByPhone(phone) {
  const user = await User.findOne({ $or: [{ phone }, { whatsapp: phone }] }).lean();
  if (user) {
    return { username: user.username, phone: user.phone, source: 'main' };
  }
  
  const externalUser = await ExternalUser.findOne({ $or: [{ phone }, { whatsapp: phone }] }).lean();
  if (externalUser) {
    return { username: externalUser.username, phone: externalUser.phone, source: 'external' };
  }
  
  return null;
}

// Cambiar contraseña por teléfono
async function changePasswordByPhone(phone, newPassword) {
  const user = await User.findOne({ $or: [{ phone }, { whatsapp: phone }] });
  
  if (!user) {
    return { success: false, error: 'Usuario no encontrado con ese número de teléfono' };
  }
  
  user.password = await bcrypt.hash(newPassword, 10);
  user.passwordChangedAt = new Date();
  await user.save();
  
  return { success: true, username: user.username };
}

// Agregar usuario externo
async function addExternalUser(userData) {
  try {
    await ExternalUser.findOneAndUpdate(
      { username: userData.username },
      {
        username: userData.username,
        phone: userData.phone || null,
        whatsapp: userData.whatsapp || null,
        lastSeen: new Date(),
        $inc: { messageCount: 1 },
        $setOnInsert: { firstSeen: new Date() }
      },
      { upsert: true, new: true }
    );
  } catch (error) {
    console.error('Error agregando usuario externo:', error);
  }
}

// Registrar actividad de usuario (para fueguito)
async function recordUserActivity(userId, type, amount) {
  try {
    const today = new Date().toDateString();
    
    await UserActivity.findOneAndUpdate(
      { userId, date: today },
      {
        $inc: { [type === 'deposit' ? 'deposits' : 'withdrawals']: amount },
        lastActivity: new Date()
      },
      { upsert: true, new: true }
    );
  } catch (error) {
    console.error('Error registrando actividad:', error);
  }
}

// Verificar si tiene actividad hoy
async function hasActivityToday(userId) {
  try {
    const today = new Date().toDateString();
    const activity = await UserActivity.findOne({ userId, date: today });
    
    if (!activity) return false;
    return (activity.deposits > 0 || activity.withdrawals > 0);
  } catch (error) {
    console.error('Error verificando actividad:', error);
    return false;
  }
}

// Funciones para fecha Argentina
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
// MIDDLEWARE DE AUTENTICACIÓN
// ============================================
const authMiddleware = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Token no proporcionado' });
  }
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Buscar usuario por 'id' primero, luego por '_id' como fallback
    let user = await User.findOne({ id: decoded.userId });
    
    if (!user) {
      // Intentar buscar por _id (para usuarios migrados)
      try {
        user = await User.findById(decoded.userId);
      } catch (e) {
        // _id inválido, ignorar
      }
    }
    
    if (!user) {
      return res.status(401).json({ error: 'Usuario no encontrado' });
    }
    
    if (user.tokenVersion && decoded.tokenVersion !== user.tokenVersion) {
      return res.status(401).json({ error: 'Sesión expirada. Por favor, vuelve a iniciar sesión.' });
    }
    
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Token inválido' });
  }
};

const adminMiddleware = (req, res, next) => {
  if (req.user.role !== 'admin' && req.user.role !== 'depositor' && req.user.role !== 'withdrawer') {
    return res.status(403).json({ error: 'Acceso denegado. Solo administradores.' });
  }
  next();
};

const depositorMiddleware = (req, res, next) => {
  if (req.user.role !== 'admin' && req.user.role !== 'depositor') {
    return res.status(403).json({ error: 'Acceso denegado. Solo agentes de carga.' });
  }
  next();
};

const withdrawerMiddleware = (req, res, next) => {
  if (req.user.role !== 'admin' && req.user.role !== 'withdrawer') {
    return res.status(403).json({ error: 'Acceso denegado. Solo agentes de retiro.' });
  }
  next();
};

// ============================================
// RUTAS DE AUTENTICACIÓN
// ============================================

// Verificar disponibilidad de username
app.get('/api/auth/check-username', async (req, res) => {
  try {
    const { username } = req.query;
    
    if (!username || username.length < 3) {
      return res.json({ available: false, message: 'Usuario muy corto' });
    }
    
    // Buscar case-insensitive
    const localExists = await User.findOne({ 
      username: { $regex: new RegExp('^' + username + '$', 'i') } 
    });
    
    if (localExists) {
      return res.json({ available: false, message: 'Usuario ya registrado' });
    }
    
    try {
      const jgUser = await jugaygana.getUserInfoByName(username);
      if (jgUser) {
        return res.json({ 
          available: false, 
          message: 'Este nombre de usuario ya está en uso en JUGAYGANA. Intenta con otro nombre.',
          existsInJugaygana: true,
          alreadyExists: true
        });
      }
    } catch (jgError) {
      console.log('⚠️ No se pudo verificar en JUGAYGANA:', jgError.message);
    }
    
    res.json({ 
      available: true, 
      message: 'Usuario disponible',
      existsInJugaygana: false
    });
  } catch (error) {
    console.error('Error verificando username:', error);
    res.status(500).json({ available: false, message: 'Error del servidor' });
  }
});

// Endpoint para enviar CBU al chat
app.post('/api/admin/send-cbu', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { userId } = req.body;
    const cbuConfig = await getConfig('cbu');
    
    if (!cbuConfig || !cbuConfig.number) {
      return res.status(400).json({ error: 'CBU no configurado' });
    }
    
    const timestamp = new Date();
    
    // 1. Mensaje completo con todos los datos
    const fullMessage = `💳 *Datos para transferir:*\n\n🏦 Banco: ${cbuConfig.bank}\n👤 Titular: ${cbuConfig.titular}\n🔢 CBU: ${cbuConfig.number}\n📱 Alias: ${cbuConfig.alias}\n\n✅ Una vez realizada la transferencia, envianos el comprobante por aquí.`;
    
    await Message.create({
      id: uuidv4(),
      senderId: req.user.userId,
      senderUsername: req.user.username,
      senderRole: 'admin',
      receiverId: userId,
      receiverRole: 'user',
      content: fullMessage,
      type: 'text',
      timestamp: timestamp,
      read: false
    });
    
    // 2. CBU solo para copiar y pegar
    await Message.create({
      id: uuidv4(),
      senderId: req.user.userId,
      senderUsername: req.user.username,
      senderRole: 'admin',
      receiverId: userId,
      receiverRole: 'user',
      content: cbuConfig.number,
      type: 'text',
      timestamp: new Date(Date.now() + 100),
      read: false
    });
    
    res.json({ success: true, message: 'CBU enviado' });
  } catch (error) {
    console.error('Error enviando CBU:', error);
    res.status(500).json({ error: 'Error enviando CBU' });
  }
});

// Registro de usuario
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password, email, phone } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
    }
    
    if (password.length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }
    
    if (!phone || phone.trim().length < 8) {
      return res.status(400).json({ error: 'El número de teléfono es obligatorio (mínimo 8 dígitos)' });
    }
    
    // Buscar case-insensitive
    const existingUser = await User.findOne({ 
      username: { $regex: new RegExp('^' + username + '$', 'i') } 
    });
    
    if (existingUser) {
      return res.status(400).json({ error: 'El usuario ya existe' });
    }
    
    // Crear usuario en JUGAYGANA PRIMERO
    let jgResult = null;
    try {
      jgResult = await jugaygana.syncUserToPlatform({
        username: username,
        password: password
      });
      
      if (!jgResult.success && !jgResult.alreadyExists) {
        return res.status(400).json({ error: 'No se pudo crear el usuario en JUGAYGANA: ' + (jgResult.error || 'Error desconocido') });
      }
      
      console.log('✅ Usuario creado/vinculado en JUGAYGANA:', username);
    } catch (jgError) {
      console.error('❌ Error creando en JUGAYGANA:', jgError);
      return res.status(400).json({ error: 'Error al crear usuario en la plataforma. Intenta con otro nombre de usuario.' });
    }
    
    // Crear usuario localmente
    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = uuidv4();
    
    const newUser = await User.create({
      id: userId,
      username,
      password: hashedPassword,
      email: email || null,
      phone: phone.trim(),
      role: 'user',
      accountNumber: generateAccountNumber(),
      balance: jgResult.user?.balance || jgResult.user?.user_balance || 0,
      createdAt: new Date(),
      lastLogin: null,
      isActive: true,
      jugayganaUserId: jgResult.jugayganaUserId || jgResult.user?.user_id,
      jugayganaUsername: jgResult.jugayganaUsername || jgResult.user?.user_name,
      jugayganaSyncStatus: jgResult.alreadyExists ? 'linked' : 'synced'
    });
    
    // Enviar mensaje de bienvenida
    await Message.create({
      id: uuidv4(),
      senderId: 'system',
      senderUsername: 'Sistema',
      senderRole: 'admin',
      receiverId: userId,
      receiverRole: 'user',
      content: `🎉 ¡Bienvenido a la Sala de Juegos, ${username}!\n\n🎁 Beneficios exclusivos:\n• Reembolso DIARIO del 20%\n• Reembolso SEMANAL del 10%\n• Reembolso MENSUAL del 5%\n• Fueguito diario con recompensas\n• Atención 24/7\n\n💬 Escribe aquí para hablar con un agente.`,
      type: 'text',
      timestamp: new Date(),
      read: false
    });
    
    // Crear chat status
    await ChatStatus.create({
      userId: userId,
      username: username,
      status: 'open',
      category: 'cargas',
      lastMessageAt: new Date()
    });
    
    // Generar token sin expiración
    const token = jwt.sign(
      { userId: newUser.id, username: newUser.username, role: newUser.role },
      JWT_SECRET
      // Sin expiresIn - el token no expira nunca
    );
    
    res.status(201).json({
      message: 'Usuario creado exitosamente',
      token,
      user: {
        id: newUser.id,
        username: newUser.username,
        email: newUser.email,
        phone: newUser.phone,
        accountNumber: newUser.accountNumber,
        role: newUser.role,
        balance: newUser.balance,
        jugayganaLinked: true,
        needsPasswordChange: false
      }
    });
  } catch (error) {
    console.error('Error en registro:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
    }
    
    console.log(`🔐 Intentando login para: ${username}`);
    
    // Buscar usuario case-insensitive (para soportar usernames con mayúsculas/minúsculas)
    let user = await User.findOne({ 
      username: { $regex: new RegExp('^' + username + '$', 'i') } 
    });
    
    // Si no existe localmente, verificar en JUGAYGANA
    if (!user) {
      console.log(`🔍 Usuario ${username} no encontrado localmente, verificando en JUGAYGANA...`);
      
      const jgUser = await jugaygana.getUserInfoByName(username);
      
      if (jgUser) {
        console.log(`✅ Usuario encontrado en JUGAYGANA, creando localmente...`);
        
        const hashedPassword = await bcrypt.hash('asd123', 10);
        const userId = uuidv4();
        
        user = await User.create({
          id: userId,
          username: jgUser.username,
          password: hashedPassword,
          email: jgUser.email || null,
          phone: jgUser.phone || null,
          role: 'user',
          accountNumber: generateAccountNumber(),
          balance: jgUser.balance || 0,
          createdAt: new Date(),
          lastLogin: null,
          isActive: true,
          jugayganaUserId: jgUser.id,
          jugayganaUsername: jgUser.username,
          jugayganaSyncStatus: 'linked',
          source: 'jugaygana'
        });
        
        // Crear chat status
        await ChatStatus.create({
          userId: userId,
          username: jgUser.username,
          status: 'open',
          category: 'cargas'
        });
        
        console.log(`✅ Usuario ${username} creado automáticamente desde JUGAYGANA`);
      } else {
        return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
      }
    }
    
    // Convertir a objeto plano para acceder a los campos correctamente
    const userObj = user.toObject ? user.toObject() : user;
    
    // Usar 'id' si existe, sino usar '_id' como fallback
    const userId = userObj.id || userObj._id?.toString();
    
    console.log(`👤 Usuario encontrado: ${userObj.username}, ID: ${userId}`);
    
    if (!userId) {
      console.error(`❌ Usuario ${username} no tiene ID válido`);
      return res.status(500).json({ error: 'Error de configuración de usuario. Contacta al administrador.' });
    }
    
    if (!userObj.isActive) {
      return res.status(401).json({ error: 'Usuario desactivado' });
    }
    
    // Verificar que el usuario tenga una contraseña válida
    if (!userObj.password) {
      console.error(`❌ Usuario ${username} no tiene contraseña configurada`);
      return res.status(500).json({ error: 'Error de configuración de usuario. Contacta al administrador.' });
    }
    
    // Verificar si la contraseña almacenada es un hash bcrypt válido
    const isValidBcryptHash = userObj.password.startsWith('$2') || userObj.password.startsWith('$2a$') || userObj.password.startsWith('$2b$');
    if (!isValidBcryptHash) {
      console.error(`❌ Usuario ${username} tiene contraseña en formato inválido. Resetear contraseña requerido.`);
      return res.status(500).json({ error: 'Error de configuración de usuario. Contacta al administrador.' });
    }
    
    // Verificar si el usuario necesita cambiar la contraseña
    // TRUE si: nunca cambió la contraseña (passwordChangedAt es null) Y viene de JUGAYGANA
    const needsPasswordChange = !userObj.passwordChangedAt && userObj.source === 'jugaygana';
    
    let isValidPassword = false;
    
    try {
      isValidPassword = await bcrypt.compare(password, userObj.password);
    } catch (bcryptError) {
      console.error(`❌ Error comparando contraseña para ${username}:`, bcryptError.message);
    }
    
    // Si la contraseña no coincide y el usuario nunca cambió su contraseña, intentar con 'asd123'
    if (!isValidPassword && !userObj.passwordChangedAt) {
      console.log(`🔑 Probando contraseña por defecto para ${username}...`);
      const defaultHash = await bcrypt.hash('asd123', 10);
      try {
        isValidPassword = await bcrypt.compare(password, defaultHash);
      } catch (bcryptError) {
        console.error(`❌ Error comparando contraseña por defecto:`, bcryptError.message);
      }
    }
    
    if (!isValidPassword) {
      console.log(`❌ Contraseña incorrecta para ${username}`);
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }
    
    console.log(`✅ Login exitoso para ${username}`);
    
    // Actualizar lastLogin usando el modelo de Mongoose
    user.lastLogin = new Date();
    await user.save();
    
    // Token sin expiración para persistencia de sesión
    const token = jwt.sign(
      { userId: userId, username: userObj.username, role: userObj.role, tokenVersion: userObj.tokenVersion || 0 },
      JWT_SECRET
      // Sin expiresIn - el token no expira nunca
    );
    
    res.json({
      message: 'Login exitoso',
      token,
      user: {
        id: userId,
        username: userObj.username,
        email: userObj.email,
        accountNumber: userObj.accountNumber,
        role: userObj.role,
        balance: userObj.balance,
        jugayganaLinked: !!userObj.jugayganaUserId,
        needsPasswordChange: needsPasswordChange
      }
    });
  } catch (error) {
    console.error('❌ Error en login:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Verificar token
app.get('/api/auth/verify', authMiddleware, (req, res) => {
  res.json({ valid: true, user: req.user });
});

// Obtener información del usuario actual
app.get('/api/users/me', authMiddleware, async (req, res) => {
  try {
    // Buscar por 'id' primero, luego por '_id' como fallback
    let user = await User.findOne({ id: req.user.userId }).select('-password');
    
    if (!user) {
      try {
        user = await User.findById(req.user.userId).select('-password');
      } catch (e) {
        // _id inválido, ignorar
      }
    }
    
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    
    res.json(user);
  } catch (error) {
    console.error('Error obteniendo usuario:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Cambiar contraseña
app.post('/api/auth/change-password', authMiddleware, async (req, res) => {
  try {
    const { currentPassword, newPassword, whatsapp, closeAllSessions } = req.body;
    
    // Buscar por 'id' primero, luego por '_id' como fallback
    let user = await User.findOne({ id: req.user.userId });
    
    if (!user) {
      try {
        user = await User.findById(req.user.userId);
      } catch (e) {
        // _id inválido, ignorar
      }
    }
    
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    
    if (whatsapp && whatsapp.trim().length < 8) {
      return res.status(400).json({ error: 'El número de WhatsApp debe tener al menos 8 dígitos' });
    }
    
    const isValidPassword = await bcrypt.compare(currentPassword, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Contraseña actual incorrecta' });
    }
    
    user.password = await bcrypt.hash(newPassword, 10);
    user.passwordChangedAt = new Date();
    
    if (whatsapp && whatsapp.trim()) {
      user.whatsapp = whatsapp.trim();
    }
    
    if (closeAllSessions) {
      user.tokenVersion = (user.tokenVersion || 0) + 1;
    }
    
    await user.save();
    
    res.json({ 
      message: 'Contraseña cambiada exitosamente',
      sessionsClosed: closeAllSessions || false
    });
  } catch (error) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================
// RUTAS PÚBLICAS - RECUPERACIÓN DE CUENTA
// ============================================

app.post('/api/auth/find-user-by-phone', async (req, res) => {
  try {
    const { phone } = req.body;
    
    if (!phone || phone.trim().length < 8) {
      return res.status(400).json({ error: 'Número de teléfono inválido' });
    }
    
    const user = await findUserByPhone(phone.trim());
    
    if (user) {
      res.json({ 
        found: true, 
        username: user.username,
        phone: user.phone,
        message: 'Usuario encontrado'
      });
    } else {
      res.json({ 
        found: false, 
        message: 'No se encontró ningún usuario con ese número de teléfono' 
      });
    }
  } catch (error) {
    console.error('Error buscando usuario por teléfono:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.post('/api/auth/reset-password-by-phone', async (req, res) => {
  try {
    const { phone, newPassword } = req.body;
    
    if (!phone || phone.trim().length < 8) {
      return res.status(400).json({ error: 'Número de teléfono inválido' });
    }
    
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }
    
    const result = await changePasswordByPhone(phone.trim(), newPassword);
    
    if (result.success) {
      res.json({ 
        success: true, 
        username: result.username,
        message: 'Contraseña cambiada exitosamente' 
      });
    } else {
      res.status(404).json({ error: result.error });
    }
  } catch (error) {
    console.error('Error cambiando contraseña por teléfono:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================
// ADMIN - Resetear contraseña de usuario
// ============================================

app.post('/api/admin/users/:id/reset-password', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { newPassword } = req.body;
    
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }
    
    const user = await User.findOne({ id });
    
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    
    user.password = await bcrypt.hash(newPassword, 10);
    user.passwordChangedAt = new Date();
    await user.save();
    
    console.log(`🔑 Admin ${req.user.username} reseteó contraseña de ${user.username}`);
    
    res.json({ 
      success: true, 
      message: `Contraseña de ${user.username} reseteada exitosamente` 
    });
  } catch (error) {
    console.error('Error reseteando contraseña:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================
// RUTAS DE CONFIGURACIÓN PÚBLICA
// ============================================

app.get('/api/config/cbu', authMiddleware, async (req, res) => {
  try {
    const cbuConfig = await getConfig('cbu');
    if (!cbuConfig) {
      return res.status(404).json({ error: 'CBU no configurado' });
    }
    
    res.json({
      cbu: cbuConfig.number,
      alias: cbuConfig.alias,
      bank: cbuConfig.bank,
      titular: cbuConfig.titular
    });
  } catch (error) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.post('/api/cbu/request', authMiddleware, async (req, res) => {
  try {
    const cbuConfig = await getConfig('cbu');
    if (!cbuConfig) {
      return res.status(404).json({ error: 'CBU no configurado' });
    }
    
    // 1. Mensaje de solicitud del usuario
    await Message.create({
      id: uuidv4(),
      senderId: req.user.userId,
      senderUsername: req.user.username,
      senderRole: 'user',
      receiverId: 'admin',
      receiverRole: 'admin',
      content: '💳 Solicito los datos para transferir (CBU)',
      type: 'text',
      timestamp: new Date(),
      read: false
    });
    
    // 2. Mensaje completo con CBU
    const fullMessage = `💳 *Datos para transferir:*\n\n🏦 Banco: ${cbuConfig.bank}\n👤 Titular: ${cbuConfig.titular}\n🔢 CBU: ${cbuConfig.number}\n📱 Alias: ${cbuConfig.alias}\n\n✅ Una vez realizada la transferencia, envianos el comprobante por aquí.`;
    
    await Message.create({
      id: uuidv4(),
      senderId: 'system',
      senderUsername: 'Sistema',
      senderRole: 'admin',
      receiverId: req.user.userId,
      receiverRole: 'user',
      content: fullMessage,
      type: 'text',
      timestamp: new Date(),
      read: false
    });
    
    // 3. CBU solo
    await Message.create({
      id: uuidv4(),
      senderId: 'system',
      senderUsername: 'Sistema',
      senderRole: 'admin',
      receiverId: req.user.userId,
      receiverRole: 'user',
      content: cbuConfig.number,
      type: 'text',
      timestamp: new Date(),
      read: false
    });
    
    res.json({ 
      success: true, 
      message: 'Solicitud enviada',
      cbu: {
        number: cbuConfig.number,
        alias: cbuConfig.alias,
        bank: cbuConfig.bank,
        titular: cbuConfig.titular
      }
    });
  } catch (error) {
    console.error('Error enviando solicitud CBU:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================
// RUTAS DE USUARIOS (ADMIN)
// ============================================

app.get('/api/users', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const users = await User.find().select('-password').lean();
    res.json(users);
  } catch (error) {
    console.error('Error obteniendo usuarios:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.post('/api/users', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { username, password, email, phone, role = 'user', balance = 0 } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Usuario y contraseña son requeridos' });
    }
    
    if (password.length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }
    
    if (!phone || phone.trim().length < 8) {
      return res.status(400).json({ error: 'El número de teléfono es obligatorio (mínimo 8 dígitos)' });
    }
    
    const validRoles = ['user', 'admin', 'depositor', 'withdrawer'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: 'Rol inválido' });
    }
    
    // Buscar case-insensitive
    const existingUser = await User.findOne({ 
      username: { $regex: new RegExp('^' + username + '$', 'i') } 
    });
    if (existingUser) {
      return res.status(400).json({ error: 'El usuario ya existe' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = uuidv4();
    
    const newUser = await User.create({
      id: userId,
      username,
      password: hashedPassword,
      email,
      phone,
      role,
      accountNumber: generateAccountNumber(),
      balance,
      createdAt: new Date(),
      lastLogin: null,
      isActive: true,
      jugayganaUserId: null,
      jugayganaUsername: null,
      jugayganaSyncStatus: role === 'user' ? 'pending' : 'not_applicable'
    });
    
    // Crear chat status
    await ChatStatus.create({
      userId: userId,
      username: username,
      status: 'open',
      category: 'cargas'
    });
    
    // Sincronizar con JUGAYGANA solo si es usuario normal
    if (role === 'user') {
      jugaygana.syncUserToPlatform({
        username: newUser.username,
        password: password
      }).then(async (result) => {
        if (result.success) {
          await User.updateOne(
            { id: userId },
            {
              jugayganaUserId: result.jugayganaUserId || result.user?.user_id,
              jugayganaUsername: result.jugayganaUsername || result.user?.user_name,
              jugayganaSyncStatus: result.alreadyExists ? 'linked' : 'synced'
            }
          );
        }
      });
    }
    
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
    console.error('Error creando usuario:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.put('/api/users/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    
    if (updates.password) {
      updates.password = await bcrypt.hash(updates.password, 10);
      updates.passwordChangedAt = new Date();
    }
    
    const user = await User.findOneAndUpdate(
      { id },
      updates,
      { new: true }
    ).select('-password');
    
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    
    res.json({
      message: 'Usuario actualizado',
      user
    });
  } catch (error) {
    console.error('Error actualizando usuario:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Importar módulo de sincronización
const jugayganaSync = require('./jugaygana-sync');

app.post('/api/users/:id/sync-jugaygana', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findOne({ id });
    
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    
    const result = await jugaygana.syncUserToPlatform({
      username: user.username,
      password: 'asd123'
    });
    
    if (result.success) {
      user.jugayganaUserId = result.jugayganaUserId || result.user?.user_id;
      user.jugayganaUsername = result.jugayganaUsername || result.user?.user_name;
      user.jugayganaSyncStatus = result.alreadyExists ? 'linked' : 'synced';
      await user.save();
      
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

// Sincronización masiva
app.post('/api/admin/sync-all-jugaygana', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    // Nota: Esta función necesitaría ser actualizada para usar MongoDB
    // Por ahora, devolvemos un mensaje informativo
    res.json({
      message: 'Sincronización masiva - Función en desarrollo para MongoDB',
      note: 'Esta función se está migrando a MongoDB'
    });
  } catch (error) {
    console.error('Error iniciando sincronización:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.get('/api/admin/sync-status', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const jugayganaUsers = await User.countDocuments({ jugayganaUserId: { $ne: null } });
    const pendingUsers = await User.countDocuments({ jugayganaUserId: null, role: 'user' });
    
    res.json({
      inProgress: false,
      startedAt: null,
      lastSync: null,
      totalSynced: jugayganaUsers,
      lastResult: null,
      localUsers: totalUsers,
      jugayganaUsers,
      pendingUsers
    });
  } catch (error) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.delete('/api/users/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    
    const userToDelete = await User.findOne({ id });
    if (!userToDelete) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    
    const adminRoles = ['admin', 'depositor', 'withdrawer'];
    if (adminRoles.includes(userToDelete.role) && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Solo los administradores pueden eliminar otros administradores' });
    }
    
    await User.deleteOne({ id });
    await ChatStatus.deleteOne({ userId: id });
    
    res.json({ message: 'Usuario eliminado exitosamente' });
  } catch (error) {
    console.error('Error eliminando usuario:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================
// DEBUG - Ver todos los mensajes
// ============================================

app.get('/api/debug/messages', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const messages = await Message.find().sort({ timestamp: -1 }).limit(20).lean();
    const count = await Message.countDocuments();
    
    res.json({
      count,
      messages
    });
  } catch (error) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================
// SISTEMA DE CHATS ABIERTOS/CERRADOS
// ============================================

app.get('/api/admin/chat-status/all', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const chatStatuses = await ChatStatus.find().lean();
    const result = {};
    chatStatuses.forEach(cs => {
      result[cs.userId] = cs;
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.get('/api/admin/chats/:status', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { status } = req.params;
    
    const chatStatuses = await ChatStatus.find({ 
      status,
      category: { $ne: 'pagos' }
    }).lean();
    
    const userIds = chatStatuses.map(cs => cs.userId);
    
    const messages = await Message.find({
      $or: [
        { senderId: { $in: userIds } },
        { receiverId: { $in: userIds } }
      ]
    }).sort({ timestamp: 1 }).lean();
    
    const users = await User.find({ id: { $in: userIds } }).lean();
    
    const userMessages = {};
    messages.forEach(msg => {
      if (msg.senderRole === 'user') {
        if (!userMessages[msg.senderId]) userMessages[msg.senderId] = [];
        userMessages[msg.senderId].push(msg);
      }
      if (msg.receiverRole === 'user' && msg.senderRole !== 'user') {
        if (!userMessages[msg.receiverId]) userMessages[msg.receiverId] = [];
        userMessages[msg.receiverId].push(msg);
      }
    });
    
    const filteredChats = [];
    
    for (const chatStatus of chatStatuses) {
      const user = users.find(u => u.id === chatStatus.userId);
      if (!user) continue;
      
      const msgs = userMessages[chatStatus.userId] || [];
      if (msgs.length === 0) continue;
      
      const lastMsg = msgs[msgs.length - 1];
      const unreadCount = msgs.filter(m => m.receiverRole === 'admin' && !m.read).length;
      
      filteredChats.push({
        userId: chatStatus.userId,
        username: user.username,
        lastMessage: lastMsg,
        unreadCount,
        assignedTo: chatStatus.assignedTo,
        closedAt: chatStatus.closedAt,
        closedBy: chatStatus.closedBy
      });
    }
    
    filteredChats.sort((a, b) => new Date(b.lastMessage.timestamp) - new Date(a.lastMessage.timestamp));
    
    res.json(filteredChats);
  } catch (error) {
    console.error('Error obteniendo chats:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.get('/api/admin/all-chats', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const messages = await Message.find().lean();
    const users = await User.find().lean();
    const chatStatuses = await ChatStatus.find().lean();
    
    const userMessages = {};
    messages.forEach(msg => {
      if (msg.senderRole === 'user') {
        if (!userMessages[msg.senderId]) userMessages[msg.senderId] = [];
        userMessages[msg.senderId].push(msg);
      }
      if (msg.receiverRole === 'user') {
        if (!userMessages[msg.receiverId]) userMessages[msg.receiverId] = [];
        userMessages[msg.receiverId].push(msg);
      }
    });
    
    const allChats = Object.keys(userMessages).map(userId => {
      const user = users.find(u => u.id === userId);
      const statusInfo = chatStatuses.find(cs => cs.userId === userId) || { status: 'open', assignedTo: null };
      const msgs = userMessages[userId].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      
      return {
        userId,
        username: user?.username || 'Desconocido',
        status: statusInfo.status,
        messageCount: msgs.length,
        lastMessage: msgs[msgs.length - 1]
      };
    });
    
    res.json(allChats);
  } catch (error) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.post('/api/admin/chats/:userId/close', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { userId } = req.params;
    
    await ChatStatus.findOneAndUpdate(
      { userId },
      {
        status: 'closed',
        closedAt: new Date(),
        closedBy: req.user.username,
        assignedTo: null,
        category: 'cargas'
      },
      { upsert: true }
    );
    
    res.json({ success: true, message: 'Chat cerrado' });
  } catch (error) {
    res.status(500).json({ error: 'Error cerrando chat' });
  }
});

app.post('/api/admin/chats/:userId/reopen', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { userId } = req.params;
    
    await ChatStatus.findOneAndUpdate(
      { userId },
      {
        status: 'open',
        closedAt: null,
        closedBy: null,
        assignedTo: req.user.username
      },
      { upsert: true }
    );
    
    res.json({ success: true, message: 'Chat reabierto' });
  } catch (error) {
    res.status(500).json({ error: 'Error reabriendo chat' });
  }
});

app.post('/api/admin/chats/:userId/assign', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { userId } = req.params;
    const { agent } = req.body;
    
    await ChatStatus.findOneAndUpdate(
      { userId },
      { assignedTo: agent, status: 'open' },
      { upsert: true }
    );
    
    res.json({ success: true, message: 'Chat asignado a ' + agent });
  } catch (error) {
    res.status(500).json({ error: 'Error asignando chat' });
  }
});

app.post('/api/admin/chats/:userId/category', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { userId } = req.params;
    const { category } = req.body;
    
    if (!category || !['cargas', 'pagos'].includes(category)) {
      return res.status(400).json({ error: 'Categoría inválida. Use "cargas" o "pagos"' });
    }
    
    await ChatStatus.findOneAndUpdate(
      { userId },
      { category },
      { upsert: true }
    );
    
    res.json({ success: true, message: `Chat movido a ${category.toUpperCase()}` });
  } catch (error) {
    console.error('Error cambiando categoría:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.get('/api/admin/chats/category/:category', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { category } = req.params;
    
    const chatStatuses = await ChatStatus.find({ category }).lean();
    const userIds = chatStatuses.map(cs => cs.userId);
    
    const messages = await Message.find({
      $or: [
        { senderId: { $in: userIds } },
        { receiverId: { $in: userIds } }
      ]
    }).sort({ timestamp: 1 }).lean();
    
    const users = await User.find({ id: { $in: userIds } }).lean();
    
    const userMessages = {};
    messages.forEach(msg => {
      if (msg.senderRole === 'user') {
        if (!userMessages[msg.senderId]) userMessages[msg.senderId] = [];
        userMessages[msg.senderId].push(msg);
      }
      if (msg.receiverRole === 'user' && msg.senderRole !== 'user') {
        if (!userMessages[msg.receiverId]) userMessages[msg.receiverId] = [];
        userMessages[msg.receiverId].push(msg);
      }
    });
    
    const filteredChats = [];
    
    for (const chatStatus of chatStatuses) {
      const user = users.find(u => u.id === chatStatus.userId);
      if (!user) continue;
      
      const msgs = userMessages[chatStatus.userId] || [];
      if (msgs.length === 0) continue;
      
      const lastMsg = msgs[msgs.length - 1];
      const unreadCount = msgs.filter(m => m.receiverRole === 'admin' && !m.read).length;
      
      filteredChats.push({
        userId: chatStatus.userId,
        username: user.username,
        lastMessage: lastMsg,
        unreadCount,
        assignedTo: chatStatus.assignedTo,
        status: chatStatus.status
      });
    }
    
    filteredChats.sort((a, b) => new Date(b.lastMessage.timestamp) - new Date(a.lastMessage.timestamp));
    res.json(filteredChats);
  } catch (error) {
    console.error('Error obteniendo chats por categoría:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================
// RUTAS DE MENSAJES
// ============================================

app.get('/api/messages/:userId', authMiddleware, async (req, res) => {
  try {
    const { userId } = req.params;
    const limit = parseInt(req.query.limit) || 10;
    
    const allowedRoles = ['admin', 'depositor', 'withdrawer'];
    if (!allowedRoles.includes(req.user.role) && req.user.userId !== userId) {
      return res.status(403).json({ error: 'Acceso denegado' });
    }
    
    console.log(`📥 Cargando mensajes para userId: ${userId}`);
    
    let userMessages = await Message.find({
      $or: [
        { senderId: userId },
        { receiverId: userId }
      ]
    })
    .sort({ timestamp: 1 })
    .limit(limit)
    .lean();
    
    console.log(`📤 Encontrados ${userMessages.length} mensajes`);
    if (userMessages.length > 0) {
      console.log(`   Último mensaje - senderId: ${userMessages[userMessages.length-1].senderId}, content: ${userMessages[userMessages.length-1].content.substring(0, 30)}...`);
    }
    
    res.json(userMessages);
  } catch (error) {
    console.error('Error obteniendo mensajes:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.get('/api/conversations', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const messages = await Message.find().sort({ timestamp: -1 }).lean();
    const users = await User.find().lean();
    
    const conversations = {};
    
    messages.forEach(msg => {
      let userId = null;
      
      if (msg.senderRole === 'user') {
        userId = msg.senderId;
      } else if (msg.receiverRole === 'user') {
        userId = msg.receiverId;
      }
      
      if (!userId) return;
      
      if (!conversations[userId]) {
        const user = users.find(u => u.id === userId);
        conversations[userId] = {
          userId,
          username: user?.username || 'Desconocido',
          accountNumber: user?.accountNumber || '',
          lastMessage: msg,
          unreadCount: (msg.receiverRole === 'admin' && !msg.read) ? 1 : 0
        };
      } else {
        if (msg.receiverRole === 'admin' && !msg.read) {
          conversations[userId].unreadCount++;
        }
      }
    });
    
    res.json(Object.values(conversations));
  } catch (error) {
    console.error('Error obteniendo conversaciones:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.post('/api/messages/read/:userId', authMiddleware, async (req, res) => {
  try {
    const { userId } = req.params;
    
    await Message.updateMany(
      { senderId: userId, receiverRole: 'admin' },
      { read: true }
    );
    
    res.json({ message: 'Mensajes marcados como leídos' });
  } catch (error) {
    console.error('Error marcando mensajes como leídos:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.post('/api/messages/send', authMiddleware, async (req, res) => {
  try {
    const { content, type = 'text' } = req.body;
    
    if (!content) {
      return res.status(400).json({ error: 'Contenido requerido' });
    }
    
    console.log(`📨 Enviando mensaje - UserID: ${req.user.userId}, Username: ${req.user.username}, Role: ${req.user.role}`);
    
    const adminRoles = ['admin', 'depositor', 'withdrawer'];
    const isAdminRole = adminRoles.includes(req.user.role);
    
    const message = await Message.create({
      id: uuidv4(),
      senderId: req.user.userId,
      senderUsername: req.user.username,
      senderRole: req.user.role,
      receiverId: isAdminRole ? (req.body.receiverId || 'admin') : 'admin',
      receiverRole: isAdminRole ? 'user' : 'admin',
      content,
      type,
      timestamp: new Date(),
      read: false
    });
    
    console.log(`✅ Mensaje guardado - ID: ${message.id}, senderId: ${message.senderId}`);
    
    // Guardar usuario en base de datos externa
    if (req.user.role === 'user') {
      let user = await User.findOne({ id: req.user.userId });
      
      if (!user) {
        try {
          user = await User.findById(req.user.userId);
        } catch (e) {
          // _id inválido, ignorar
        }
      }
      
      if (user) {
        await addExternalUser({
          username: user.username,
          phone: user.phone,
          whatsapp: user.whatsapp
        });
      }
    }
    
    // Actualizar lastMessageAt en chat status
    const targetUserId = req.user.role === 'admin' ? req.body.receiverId : req.user.userId;
    if (targetUserId) {
      await ChatStatus.findOneAndUpdate(
        { userId: targetUserId },
        { lastMessageAt: new Date() },
        { upsert: true }
      );
    }
    
    // Si es usuario enviando mensaje, reabrir chat si estaba cerrado
    if (req.user.role === 'user') {
      await ChatStatus.findOneAndUpdate(
        { userId: req.user.userId, status: 'closed' },
        { status: 'open', assignedTo: null, closedAt: null, closedBy: null }
      );
    }
    
    res.json(message);
  } catch (error) {
    console.error('Error enviando mensaje:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================
// REEMBOLSOS (DIARIO, SEMANAL, MENSUAL)
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
    
    const dailyStatus = await refunds.canClaimDailyRefund(userId);
    const weeklyStatus = await refunds.canClaimWeeklyRefund(userId);
    const monthlyStatus = await refunds.canClaimMonthlyRefund(userId);
    
    const dailyDeposits = yesterdayMovements.success ? yesterdayMovements.totalDeposits : 0;
    const dailyWithdrawals = yesterdayMovements.success ? yesterdayMovements.totalWithdraws : 0;
    
    const weeklyDeposits = lastWeekMovements.success ? lastWeekMovements.totalDeposits : 0;
    const weeklyWithdrawals = lastWeekMovements.success ? lastWeekMovements.totalWithdraws : 0;
    
    const monthlyDeposits = lastMonthMovements.success ? lastMonthMovements.totalDeposits : 0;
    const monthlyWithdrawals = lastMonthMovements.success ? lastMonthMovements.totalWithdraws : 0;
    
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
      }
    });
  } catch (error) {
    console.error('Error obteniendo estado de reembolsos:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.post('/api/refunds/claim/daily', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const username = req.user.username;
    
    if (!acquireRefundLock(userId, 'daily')) {
      return res.json({
        success: false,
        message: '⏳ Ya estás procesando un reembolso. Por favor espera...',
        canClaim: true,
        processing: true
      });
    }
    
    try {
      const status = await refunds.canClaimDailyRefund(userId);
      
      if (!status.canClaim) {
        return res.json({
          success: false,
          message: 'Ya reclamaste tu reembolso diario. Vuelve mañana!',
          canClaim: false,
          nextClaim: status.nextClaim
        });
      }
      
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
      
      const calc = refunds.calculateRefund(deposits, withdrawals, 20);
      
      if (calc.refundAmount <= 0) {
        return res.json({
          success: false,
          message: `No tienes saldo neto positivo para reclamar reembolso. Depósitos: $${deposits}, Retiros: $${withdrawals}`,
          canClaim: true,
          netAmount: calc.netAmount
        });
      }
      
      const depositResult = await jugaygana.creditUserBalance(username, calc.refundAmount);
      
      if (!depositResult.success) {
        return res.json({
          success: false,
          message: 'Error al acreditar el reembolso: ' + depositResult.error,
          canClaim: true
        });
      }
      
      // Guardar reclamo en MongoDB
      await RefundClaim.create({
        id: uuidv4(),
        userId,
        username,
        type: 'daily',
        amount: calc.refundAmount,
        netAmount: calc.netAmount,
        percentage: 20,
        deposits,
        withdrawals,
        period: yesterdayMovements.dateStr,
        transactionId: depositResult.data?.transfer_id || depositResult.data?.transferId,
        claimedAt: new Date()
      });
      
      // Guardar transacción para el dashboard
      await Transaction.create({
        id: uuidv4(),
        type: 'refund',
        amount: calc.refundAmount,
        username,
        description: `Reembolso diario (${yesterdayMovements.dateStr})`,
        transactionId: depositResult.data?.transfer_id || depositResult.data?.transferId,
        timestamp: new Date()
      });
      
      res.json({
        success: true,
        message: `¡Reembolso diario de $${calc.refundAmount} acreditado!`,
        amount: calc.refundAmount,
        percentage: 20,
        netAmount: calc.netAmount,
        nextClaim: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      });
    } finally {
      setTimeout(() => releaseRefundLock(userId, 'daily'), 3000);
    }
  } catch (error) {
    console.error('Error reclamando reembolso diario:', error);
    res.json({ success: false, message: 'Error del servidor', canClaim: true });
  }
});

app.post('/api/refunds/claim/weekly', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const username = req.user.username;
    
    if (!acquireRefundLock(userId, 'weekly')) {
      return res.json({
        success: false,
        message: '⏳ Ya estás procesando un reembolso. Por favor espera...',
        canClaim: true,
        processing: true
      });
    }
    
    try {
      const status = await refunds.canClaimWeeklyRefund(userId);
      
      if (!status.canClaim) {
        return res.json({
          success: false,
          message: `No puedes reclamar el reembolso semanal. Disponible: ${status.availableDays}`,
          canClaim: false,
          nextClaim: status.nextClaim,
          availableDays: status.availableDays
        });
      }
      
      const lastWeekMovements = await jugaygana.getUserNetLastWeek(username);
      
      if (!lastWeekMovements.success) {
        return res.json({
          success: false,
          message: 'No se pudieron obtener tus movimientos. Intenta más tarde.',
          canClaim: true
        });
      }
      
      const deposits = lastWeekMovements.totalDeposits;
      const withdrawals = lastWeekMovements.totalWithdraws;
      
      const calc = refunds.calculateRefund(deposits, withdrawals, 10);
      
      if (calc.refundAmount <= 0) {
        return res.json({
          success: false,
          message: `No tienes saldo neto positivo. Depósitos: $${deposits}, Retiros: $${withdrawals}`,
          canClaim: true,
          netAmount: calc.netAmount
        });
      }
      
      const depositResult = await jugaygana.creditUserBalance(username, calc.refundAmount);
      
      if (!depositResult.success) {
        return res.json({
          success: false,
          message: 'Error al acreditar el reembolso: ' + depositResult.error,
          canClaim: true
        });
      }
      
      // Guardar reclamo en MongoDB
      await RefundClaim.create({
        id: uuidv4(),
        userId,
        username,
        type: 'weekly',
        amount: calc.refundAmount,
        netAmount: calc.netAmount,
        percentage: 10,
        deposits,
        withdrawals,
        period: `${lastWeekMovements.fromDateStr} a ${lastWeekMovements.toDateStr}`,
        transactionId: depositResult.data?.transfer_id || depositResult.data?.transferId,
        claimedAt: new Date()
      });
      
      // Guardar transacción para el dashboard
      await Transaction.create({
        id: uuidv4(),
        type: 'refund',
        amount: calc.refundAmount,
        username,
        description: `Reembolso semanal (${lastWeekMovements.fromDateStr} a ${lastWeekMovements.toDateStr})`,
        transactionId: depositResult.data?.transfer_id || depositResult.data?.transferId,
        timestamp: new Date()
      });
      
      res.json({
        success: true,
        message: `¡Reembolso semanal de $${calc.refundAmount} acreditado!`,
        amount: calc.refundAmount,
        percentage: 10,
        netAmount: calc.netAmount,
        nextClaim: status.nextClaim
      });
    } finally {
      setTimeout(() => releaseRefundLock(userId, 'weekly'), 3000);
    }
  } catch (error) {
    console.error('Error reclamando reembolso semanal:', error);
    res.json({ success: false, message: 'Error del servidor', canClaim: true });
  }
});

app.post('/api/refunds/claim/monthly', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const username = req.user.username;
    
    if (!acquireRefundLock(userId, 'monthly')) {
      return res.json({
        success: false,
        message: '⏳ Ya estás procesando un reembolso. Por favor espera...',
        canClaim: true,
        processing: true
      });
    }
    
    try {
      const status = await refunds.canClaimMonthlyRefund(userId);
      
      if (!status.canClaim) {
        return res.json({
          success: false,
          message: `No puedes reclamar el reembolso mensual. Disponible: ${status.availableFrom}`,
          canClaim: false,
          nextClaim: status.nextClaim,
          availableFrom: status.availableFrom
        });
      }
      
      const lastMonthMovements = await jugaygana.getUserNetLastMonth(username);
      
      if (!lastMonthMovements.success) {
        return res.json({
          success: false,
          message: 'No se pudieron obtener tus movimientos. Intenta más tarde.',
          canClaim: true
        });
      }
      
      const deposits = lastMonthMovements.totalDeposits;
      const withdrawals = lastMonthMovements.totalWithdraws;
      
      const calc = refunds.calculateRefund(deposits, withdrawals, 5);
      
      if (calc.refundAmount <= 0) {
        return res.json({
          success: false,
          message: `No tienes saldo neto positivo. Depósitos: $${deposits}, Retiros: $${withdrawals}`,
          canClaim: true,
          netAmount: calc.netAmount
        });
      }
      
      const depositResult = await jugaygana.creditUserBalance(username, calc.refundAmount);
      
      if (!depositResult.success) {
        return res.json({
          success: false,
          message: 'Error al acreditar el reembolso: ' + depositResult.error,
          canClaim: true
        });
      }
      
      // Guardar reclamo en MongoDB
      await RefundClaim.create({
        id: uuidv4(),
        userId,
        username,
        type: 'monthly',
        amount: calc.refundAmount,
        netAmount: calc.netAmount,
        percentage: 5,
        deposits,
        withdrawals,
        period: `${lastMonthMovements.fromDateStr} a ${lastMonthMovements.toDateStr}`,
        transactionId: depositResult.data?.transfer_id || depositResult.data?.transferId,
        claimedAt: new Date()
      });
      
      // Guardar transacción para el dashboard
      await Transaction.create({
        id: uuidv4(),
        type: 'refund',
        amount: calc.refundAmount,
        username,
        description: `Reembolso mensual (${lastMonthMovements.fromDateStr} a ${lastMonthMovements.toDateStr})`,
        transactionId: depositResult.data?.transfer_id || depositResult.data?.transferId,
        timestamp: new Date()
      });
      
      res.json({
        success: true,
        message: `¡Reembolso mensual de $${calc.refundAmount} acreditado!`,
        amount: calc.refundAmount,
        percentage: 5,
        netAmount: calc.netAmount,
        nextClaim: status.nextClaim
      });
    } finally {
      setTimeout(() => releaseRefundLock(userId, 'monthly'), 3000);
    }
  } catch (error) {
    console.error('Error reclamando reembolso mensual:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.get('/api/refunds/history', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userRefunds = await RefundClaim.find({ userId }).sort({ claimedAt: -1 }).lean();
    
    res.json({ refunds: userRefunds });
  } catch (error) {
    console.error('Error obteniendo historial de reembolsos:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.get('/api/refunds/all', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const allRefunds = await RefundClaim.find().sort({ claimedAt: -1 }).lean();
    
    const summary = {
      dailyCount: 0,
      weeklyCount: 0,
      monthlyCount: 0,
      totalAmount: 0
    };
    
    allRefunds.forEach(r => {
      summary.totalAmount += r.amount || 0;
      if (r.type === 'daily') summary.dailyCount++;
      else if (r.type === 'weekly') summary.weeklyCount++;
      else if (r.type === 'monthly') summary.monthlyCount++;
    });
    
    res.json({
      refunds: allRefunds,
      summary
    });
  } catch (error) {
    console.error('Error obteniendo todos los reembolsos:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================
// MOVIMIENTOS DE SALDO
// ============================================

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

app.get('/api/balance/live', authMiddleware, async (req, res) => {
  try {
    const username = req.user.username;
    const result = await jugayganaMovements.getUserBalance(username);
    
    if (result.success) {
      await User.updateOne(
        { username },
        { balance: result.balance }
      );
      
      res.json({
        balance: result.balance,
        username: result.username,
        updatedAt: new Date().toISOString()
      });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (error) {
    console.error('Error obteniendo balance en tiempo real:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

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

app.post('/api/admin/deposit', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { username, amount, description } = req.body;
    
    if (!username || !amount) {
      return res.status(400).json({ error: 'Usuario y monto requeridos' });
    }
    
    const result = await jugaygana.depositToUser(username, amount, description);
    
    if (result.success) {
      const user = await User.findOne({ username });
      if (user) {
        await recordUserActivity(user.id, 'deposit', amount);
      }
      
      await Transaction.create({
        id: uuidv4(),
        type: 'deposit',
        amount: parseFloat(amount),
        username,
        description: description || 'Depósito realizado',
        adminId: req.user?.userId,
        adminUsername: req.user?.username,
        adminRole: req.user?.role || 'admin',
        transactionId: result.data?.transfer_id || result.data?.transferId,
        timestamp: new Date()
      });
      
      res.json({
        success: true,
        message: 'Depósito realizado correctamente',
        newBalance: result.data?.user_balance_after,
        transactionId: result.data?.transfer_id || result.data?.transferId
      });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (error) {
    console.error('Error realizando depósito:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

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

app.post('/api/admin/withdrawal', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { username, amount, description } = req.body;
    
    if (!username || !amount) {
      return res.status(400).json({ error: 'Usuario y monto requeridos' });
    }
    
    const result = await jugaygana.withdrawFromUser(username, amount, description);
    
    if (result.success) {
      const user = await User.findOne({ username });
      if (user) {
        await recordUserActivity(user.id, 'withdrawal', amount);
      }
      
      await Transaction.create({
        id: uuidv4(),
        type: 'withdrawal',
        amount: parseFloat(amount),
        username,
        description: description || 'Retiro realizado',
        adminId: req.user?.userId,
        adminUsername: req.user?.username,
        adminRole: req.user?.role || 'admin',
        transactionId: result.data?.transfer_id || result.data?.transferId,
        timestamp: new Date()
      });
      
      res.json({
        success: true,
        message: 'Retiro realizado correctamente',
        newBalance: result.data?.user_balance_after,
        transactionId: result.data?.transfer_id || result.data?.transferId
      });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (error) {
    console.error('Error realizando retiro:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.post('/api/admin/bonus', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { username, amount } = req.body;
    
    if (!username || !amount) {
      return res.status(400).json({ error: 'Usuario y monto requeridos' });
    }
    
    const bonusAmount = parseFloat(amount);
    if (isNaN(bonusAmount) || bonusAmount <= 0) {
      return res.status(400).json({ error: 'Monto de bonificación inválido' });
    }
    
    const depositResult = await jugaygana.creditUserBalance(username, bonusAmount);
    
    if (depositResult.success) {
      await Transaction.create({
        id: uuidv4(),
        type: 'bonus',
        amount: bonusAmount,
        username,
        description: 'Bonificación otorgada',
        adminId: req.user?.userId,
        adminUsername: req.user?.username,
        adminRole: req.user?.role || 'admin',
        transactionId: depositResult.data?.transfer_id || depositResult.data?.transferId,
        timestamp: new Date()
      });
      
      res.json({
        success: true,
        message: `Bonificación de $${bonusAmount.toLocaleString()} realizada correctamente`,
        newBalance: depositResult.data?.user_balance_after,
        transactionId: depositResult.data?.transfer_id || depositResult.data?.transferId
      });
    } else {
      res.status(400).json({ error: depositResult.error || 'Error al aplicar bonificación' });
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
  
  socket.on('authenticate', (token) => {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      socket.userId = decoded.userId;
      socket.username = decoded.username;
      socket.role = decoded.role;
      
      if (decoded.role === 'admin') {
        connectedAdmins.set(decoded.userId, socket);
        console.log(`Admin conectado: ${decoded.username}`);
        broadcastStats();
      } else {
        connectedUsers.set(decoded.userId, socket);
        console.log(`Usuario conectado: ${decoded.username}`);
        socket.join(`user_${decoded.userId}`);
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
  
  socket.on('send_message', async (data) => {
    try {
      const { content, type = 'text' } = data;
      
      if (!socket.userId) {
        return socket.emit('error', { message: 'No autenticado' });
      }
      
      const message = await Message.create({
        id: uuidv4(),
        senderId: socket.userId,
        senderUsername: socket.username,
        senderRole: socket.role,
        receiverId: socket.role === 'admin' ? data.receiverId : 'admin',
        receiverRole: socket.role === 'admin' ? 'user' : 'admin',
        content,
        type,
        timestamp: new Date(),
        read: false
      });
      
      if (socket.role === 'user') {
        notifyAdmins('new_message', {
          message,
          userId: socket.userId,
          username: socket.username
        });
        socket.emit('message_sent', message);
      } else {
        const userSocket = connectedUsers.get(data.receiverId);
        if (userSocket) {
          userSocket.emit('new_message', message);
        }
        socket.emit('message_sent', message);
      }
      
      broadcastStats();
    } catch (error) {
      console.error('Error enviando mensaje:', error);
      socket.emit('error', { message: 'Error enviando mensaje' });
    }
  });
  
  socket.on('typing', (data) => {
    if (socket.role === 'user') {
      notifyAdmins('user_typing', {
        userId: socket.userId,
        username: socket.username,
        isTyping: data.isTyping
      });
    } else {
      const userSocket = connectedUsers.get(data.receiverId);
      if (userSocket) {
        userSocket.emit('admin_typing', {
          adminId: socket.userId,
          adminName: socket.username,
          isTyping: data.isTyping
        });
      }
    }
  });
  
  socket.on('stop_typing', (data) => {
    if (socket.role === 'user') {
      notifyAdmins('user_stop_typing', {
        userId: socket.userId,
        username: socket.username
      });
    } else {
      const userSocket = connectedUsers.get(data.receiverId);
      if (userSocket) {
        userSocket.emit('admin_stop_typing', {
          adminId: socket.userId,
          adminName: socket.username
        });
      }
    }
  });
  
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

function notifyAdmins(event, data) {
  connectedAdmins.forEach((socket) => {
    socket.emit(event, data);
  });
}

async function broadcastStats() {
  const totalUsers = await User.countDocuments({ role: 'user' });
  
  const stats = {
    connectedUsers: connectedUsers.size,
    connectedAdmins: connectedAdmins.size,
    totalUsers
  };
  
  connectedAdmins.forEach((socket) => {
    socket.emit('stats', stats);
  });
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
// INICIALIZAR DATOS DE PRUEBA
// ============================================

async function initializeData() {
  // Conectar a MongoDB
  const dbConnected = await connectDB();
  if (!dbConnected) {
    console.error('❌ No se pudo conectar a MongoDB');
    return;
  }
  
  if (process.env.PROXY_URL) {
    console.log('🔍 Verificando IP pública...');
    await jugaygana.logProxyIP();
  }
  
  console.log('🔑 Probando conexión con JUGAYGANA...');
  const sessionOk = await jugaygana.ensureSession();
  if (sessionOk) {
    console.log('✅ Conexión con JUGAYGANA establecida');
  } else {
    console.log('⚠️ No se pudo conectar con JUGAYGANA');
  }
  
  // Verificar/crear admin ignite100
  let adminExists = await User.findOne({ username: 'ignite100' });
  if (!adminExists) {
    const adminPassword = await bcrypt.hash('pepsi100', 10);
    await User.create({
      id: uuidv4(),
      username: 'ignite100',
      password: adminPassword,
      email: 'admin@saladejuegos.com',
      phone: null,
      role: 'admin',
      accountNumber: 'ADMIN001',
      balance: 0,
      createdAt: new Date(),
      lastLogin: null,
      isActive: true,
      jugayganaUserId: null,
      jugayganaUsername: null,
      jugayganaSyncStatus: 'not_applicable'
    });
    console.log('✅ Admin creado: ignite100 / pepsi100');
  } else {
    adminExists.password = await bcrypt.hash('pepsi100', 10);
    adminExists.role = 'admin';
    adminExists.isActive = true;
    await adminExists.save();
    console.log('✅ Admin actualizado: ignite100 / pepsi100');
  }
  
  // Verificar/crear admin respaldo
  let oldAdmin = await User.findOne({ username: 'admin' });
  if (!oldAdmin) {
    const adminPassword = await bcrypt.hash('admin123', 10);
    await User.create({
      id: uuidv4(),
      username: 'admin',
      password: adminPassword,
      email: 'admin@saladejuegos.com',
      phone: null,
      role: 'admin',
      accountNumber: 'ADMIN002',
      balance: 0,
      createdAt: new Date(),
      lastLogin: null,
      isActive: true,
      jugayganaUserId: null,
      jugayganaUsername: null,
      jugayganaSyncStatus: 'not_applicable'
    });
    console.log('✅ Admin respaldo creado: admin / admin123');
  } else {
    oldAdmin.password = await bcrypt.hash('admin123', 10);
    oldAdmin.role = 'admin';
    oldAdmin.isActive = true;
    await oldAdmin.save();
    console.log('✅ Admin respaldo actualizado: admin / admin123');
  }
  
  // Verificar/crear configuración CBU por defecto
  const cbuConfig = await getConfig('cbu');
  if (!cbuConfig) {
    await setConfig('cbu', {
      number: '0000000000000000000000',
      alias: 'mi.alias.cbu',
      bank: 'Banco Ejemplo',
      titular: 'Sala de Juegos'
    });
    console.log('✅ Configuración CBU por defecto creada');
  }
  
  console.log('✅ Datos inicializados correctamente');
}

// ============================================
// ENDPOINTS DE MOVIMIENTOS (DEPÓSITOS/RETIROS)
// ============================================

app.post('/api/movements/deposit', authMiddleware, async (req, res) => {
  try {
    const { amount } = req.body;
    const username = req.user.username;
    
    if (!amount || amount < 100) {
      return res.status(400).json({ error: 'Monto mínimo $100' });
    }
    
    const result = await jugaygana.depositToUser(
      username, 
      amount, 
      `Depósito desde Sala de Juegos - ${new Date().toLocaleString('es-AR')}`
    );
    
    if (result.success) {
      await recordUserActivity(req.user.userId, 'deposit', amount);
      
      res.json({
        success: true,
        message: `Depósito de $${amount} realizado correctamente`,
        newBalance: result.data?.user_balance_after,
        transactionId: result.data?.transfer_id || result.data?.transferId
      });
    } else {
      res.status(400).json({ error: result.error || 'Error al realizar depósito' });
    }
  } catch (error) {
    console.error('Error en depósito:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.post('/api/movements/withdraw', authMiddleware, async (req, res) => {
  try {
    const { amount } = req.body;
    const username = req.user.username;
    
    if (!amount || amount < 100) {
      return res.status(400).json({ error: 'Monto mínimo $100' });
    }
    
    const result = await jugaygana.withdrawFromUser(
      username, 
      amount, 
      `Retiro desde Sala de Juegos - ${new Date().toLocaleString('es-AR')}`
    );
    
    if (result.success) {
      await recordUserActivity(req.user.userId, 'withdrawal', amount);
      
      res.json({
        success: true,
        message: `Retiro de $${amount} realizado correctamente`,
        newBalance: result.data?.user_balance_after,
        transactionId: result.data?.transfer_id || result.data?.transferId
      });
    } else {
      res.status(400).json({ error: result.error || 'Error al realizar retiro' });
    }
  } catch (error) {
    console.error('Error en retiro:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

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

app.get('/api/fire/status', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    let fireStreak = await FireStreak.findOne({ userId }).lean();
    
    if (!fireStreak) {
      fireStreak = { streak: 0, lastClaim: null, totalClaimed: 0 };
    }
    
    const todayArgentina = getArgentinaDateString();
    const lastClaim = fireStreak.lastClaim ? getArgentinaDateString(new Date(fireStreak.lastClaim)) : null;
    
    const canClaim = lastClaim !== todayArgentina;
    
    const yesterdayArgentina = getArgentinaYesterday();
    
    if (lastClaim !== yesterdayArgentina && lastClaim !== todayArgentina && fireStreak.streak > 0) {
      await FireStreak.updateOne(
        { userId },
        { streak: 0, lastReset: new Date() },
        { upsert: true }
      );
      fireStreak.streak = 0;
    }
    
    res.json({
      streak: fireStreak.streak || 0,
      lastClaim: fireStreak.lastClaim,
      totalClaimed: fireStreak.totalClaimed || 0,
      canClaim: canClaim,
      hasActivityToday: true,
      nextReward: fireStreak.streak >= 9 ? 10000 : 0
    });
  } catch (error) {
    console.error('Error obteniendo estado del fueguito:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.post('/api/fire/claim', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const username = req.user.username;
    
    let fireStreak = await FireStreak.findOne({ userId });
    
    if (!fireStreak) {
      fireStreak = new FireStreak({ userId, username, streak: 0, totalClaimed: 0 });
    }
    
    const todayArgentina = getArgentinaDateString();
    const lastClaim = fireStreak.lastClaim ? getArgentinaDateString(new Date(fireStreak.lastClaim)) : null;
    
    if (lastClaim === todayArgentina) {
      return res.status(400).json({ error: 'Ya reclamaste tu fueguito hoy' });
    }
    
    const yesterdayArgentina = getArgentinaYesterday();
    
    if (lastClaim !== yesterdayArgentina && fireStreak.streak > 0) {
      fireStreak.streak = 0;
      fireStreak.lastReset = new Date();
    }
    
    fireStreak.streak += 1;
    fireStreak.lastClaim = new Date();
    
    let reward = 0;
    let message = `Día ${fireStreak.streak} de racha!`;
    
    if (fireStreak.streak === 10) {
      reward = 10000;
      fireStreak.totalClaimed += reward;
      
      const bonusResult = await jugayganaMovements.makeBonus(
        username,
        reward,
        `Recompensa racha 10 días - Sala de Juegos`
      );
      
      if (!bonusResult.success) {
        return res.status(400).json({ 
          error: 'Error al acreditar recompensa: ' + bonusResult.error 
        });
      }
      
      message = `¡Felicidades! 10 días de racha! Recompensa: $${reward.toLocaleString()}`;
    }
    
    fireStreak.history = fireStreak.history || [];
    fireStreak.history.push({
      date: new Date(),
      reward,
      streakDay: fireStreak.streak
    });
    
    await fireStreak.save();
    
    res.json({
      success: true,
      streak: fireStreak.streak,
      reward,
      message,
      totalClaimed: fireStreak.totalClaimed
    });
  } catch (error) {
    console.error('Error reclamando fueguito:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================
// CONFIGURACIÓN DEL SISTEMA (CBU, COMANDOS)
// ============================================

app.get('/api/admin/config', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const cbuConfig = await getConfig('cbu');
    const welcomeMessage = await getConfig('welcomeMessage');
    const depositMessage = await getConfig('depositMessage');
    
    res.json({
      cbu: cbuConfig || {},
      welcomeMessage: welcomeMessage || '🎉 ¡Bienvenido a la Sala de Juegos!',
      depositMessage: depositMessage || '💰 ¡Fichas cargadas!'
    });
  } catch (error) {
    console.error('Error obteniendo configuración:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.put('/api/admin/config/cbu', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const currentCbu = await getConfig('cbu') || {};
    const newCbu = { ...currentCbu, ...req.body };
    
    await setConfig('cbu', newCbu);
    
    res.json({ success: true, message: 'CBU actualizado', cbu: newCbu });
  } catch (error) {
    console.error('Error actualizando CBU:', error);
    res.status(500).json({ error: 'Error actualizando CBU' });
  }
});

app.get('/api/admin/commands', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const commands = await getAllCommands();
    res.json(commands);
  } catch (error) {
    console.error('Error obteniendo comandos:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.post('/api/admin/commands', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { name, description, type, bonusPercent, response } = req.body;
    
    if (!name || !name.startsWith('/')) {
      return res.status(400).json({ error: 'El comando debe empezar con /' });
    }
    
    await saveCommand(name, {
      description,
      type,
      bonusPercent: parseInt(bonusPercent) || 0,
      response,
      isActive: true
    });
    
    const commands = await getAllCommands();
    res.json({ success: true, message: 'Comando guardado', commands });
  } catch (error) {
    console.error('Error guardando comando:', error);
    res.status(500).json({ error: 'Error guardando comando' });
  }
});

app.delete('/api/admin/commands/:name', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    await deleteCommand(req.params.name);
    res.json({ success: true, message: 'Comando eliminado' });
  } catch (error) {
    console.error('Error eliminando comando:', error);
    res.status(500).json({ error: 'Error eliminando comando' });
  }
});

// ============================================
// BASE DE DATOS - SOLO ADMIN PRINCIPAL
// ============================================

app.get('/api/admin/database', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Acceso denegado. Solo el administrador principal puede acceder.' });
    }
    
    const users = await User.find().select('-password').lean();
    const messages = await Message.find().lean();
    
    const adminRoles = ['admin', 'depositor', 'withdrawer'];
    const totalAdmins = users.filter(u => adminRoles.includes(u.role)).length;
    
    res.json({
      users,
      totalUsers: users.length,
      totalAdmins,
      totalMessages: messages.length
    });
  } catch (error) {
    console.error('Error obteniendo base de datos:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================
// TRANSACCIONES
// ============================================

app.get('/api/admin/transactions', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { from, to, type } = req.query;
    
    let query = {};
    
    if (from || to) {
      query.timestamp = {};
      if (from) {
        query.timestamp.$gte = new Date(from);
      }
      if (to) {
        const toDate = new Date(to);
        toDate.setHours(23, 59, 59, 999);
        query.timestamp.$lte = toDate;
      }
    }
    
    if (type && type !== 'all') {
      query.type = type;
    }
    
    const transactions = await Transaction.find(query)
      .sort({ timestamp: -1 })
      .limit(100)
      .lean();
    
    const summary = {
      deposits: 0,
      withdrawals: 0,
      bonuses: 0,
      refunds: 0
    };
    
    transactions.forEach(t => {
      if (summary.hasOwnProperty(t.type + 's')) {
        summary[t.type + 's'] += (t.amount || 0);
      }
    });
    
    res.json({
      transactions,
      summary,
      total: await Transaction.countDocuments(query)
    });
  } catch (error) {
    console.error('Error obteniendo transacciones:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================
// ESTADÍSTICAS
// ============================================

app.get('/api/admin/stats', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const onlineUsers = await User.countDocuments({ lastLogin: { $gte: new Date(Date.now() - 5 * 60 * 1000) } });
    const totalMessages = await Message.countDocuments();
    const totalTransactions = await Transaction.countDocuments();
    
    // Transacciones de hoy
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayTransactions = await Transaction.find({ timestamp: { $gte: today } }).lean();
    
    let todayDeposits = 0;
    let todayWithdrawals = 0;
    todayTransactions.forEach(t => {
      if (t.type === 'deposit') todayDeposits += t.amount;
      if (t.type === 'withdrawal') todayWithdrawals += t.amount;
    });
    
    res.json({
      totalUsers,
      onlineUsers,
      totalMessages,
      totalTransactions,
      todayDeposits,
      todayWithdrawals
    });
  } catch (error) {
    console.error('Error obteniendo estadísticas:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

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
🎮  SALA DE JUEGOS - BACKEND INICIADO (MongoDB)
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
🎮  🗄️  Base de datos: MongoDB
🎮  
🎮 ============================================
      `);
    });
  });
}
