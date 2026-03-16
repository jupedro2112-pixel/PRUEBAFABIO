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
// SEGURIDAD - RATE LIMITING
// ============================================

// Almacenamiento en memoria para rate limiting
const requestCounts = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minuto
const RATE_LIMIT_MAX = 100; // 100 requests por minuto
const AUTH_RATE_LIMIT_MAX = 10; // 10 requests por minuto para auth

function rateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const isAuthEndpoint = req.path.includes('/auth/');
  const maxRequests = isAuthEndpoint ? AUTH_RATE_LIMIT_MAX : RATE_LIMIT_MAX;
  
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW;
  
  // Limpiar entradas antiguas
  for (const [key, data] of requestCounts) {
    if (data.timestamp < windowStart) {
      requestCounts.delete(key);
    }
  }
  
  // Verificar contador actual
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
  // Prevenir clickjacking
  res.setHeader('X-Frame-Options', 'DENY');
  // Prevenir MIME sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Habilitar protección XSS en navegadores antiguos
  res.setHeader('X-XSS-Protection', '1; mode=block');
  // Política de referencia
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Política de permisos
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  // Content Security Policy básica
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self';");
  next();
}

// ============================================
// SEGURIDAD - VALIDACIÓN DE INPUT
// ============================================

function sanitizeInput(input) {
  if (typeof input !== 'string') return input;
  return input
    .replace(/[<>]/g, '') // Remover < y >
    .trim()
    .substring(0, 1000); // Limitar longitud
}

function validateUsername(username) {
  if (!username || typeof username !== 'string') return false;
  const sanitized = username.trim();
  // Solo letras, números y algunos caracteres especiales
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
// BLOQUEO DE REEMBOLSOS - Prevenir reclamación múltiple
// ============================================
const refundLocks = new Map(); // Mapa para rastrear reembolsos en proceso

function acquireRefundLock(userId, type) {
  const key = `${userId}-${type}`;
  if (refundLocks.has(key)) {
    return false; // Ya hay un reembolso en proceso
  }
  refundLocks.set(key, Date.now());
  return true;
}

function releaseRefundLock(userId, type) {
  const key = `${userId}-${type}`;
  refundLocks.delete(key);
}

// Limpiar locks antiguos cada 5 minutos (por si acaso)
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamp] of refundLocks.entries()) {
    if (now - timestamp > 5 * 60 * 1000) { // 5 minutos
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

// Headers de seguridad
app.use(securityHeaders);

// Rate limiting
app.use(rateLimit);

// CORS configurado
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
  credentials: true
}));

// Body parser con límites
app.use(express.json({ 
  limit: '10mb',
  verify: (req, res, buf) => {
    // Prevenir ataques de deserialización
    const body = buf.toString();
    if (body.length > 10 * 1024 * 1024) {
      throw new Error('Payload too large');
    }
  }
}));

// Servir archivos estáticos con opciones seguras
app.use(express.static(path.join(__dirname, 'public'), {
  dotfiles: 'deny',
  index: false,
  maxAge: '1d'
}));

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

// ============================================
// BASE DE DATOS EXTERNA - USUARIOS QUE HABLARON
// ============================================
const EXTERNAL_DB_FILE = path.join(DATA_DIR, 'external-users.json');

function loadExternalUsers() {
  try {
    if (!fs.existsSync(EXTERNAL_DB_FILE)) {
      fs.writeFileSync(EXTERNAL_DB_FILE, JSON.stringify([], null, 2));
      return [];
    }
    return JSON.parse(fs.readFileSync(EXTERNAL_DB_FILE, 'utf8'));
  } catch (error) {
    return [];
  }
}

function saveExternalUsers(users) {
  fs.writeFileSync(EXTERNAL_DB_FILE, JSON.stringify(users, null, 2));
}

function addExternalUser(userData) {
  const users = loadExternalUsers();
  const existingIndex = users.findIndex(u => u.username === userData.username);
  
  const userRecord = {
    username: userData.username,
    phone: userData.phone || null,
    whatsapp: userData.whatsapp || null,
    firstSeen: existingIndex >= 0 ? users[existingIndex].firstSeen : new Date().toISOString(),
    lastSeen: new Date().toISOString(),
    messageCount: existingIndex >= 0 ? (users[existingIndex].messageCount || 0) + 1 : 1
  };
  
  if (existingIndex >= 0) {
    users[existingIndex] = { ...users[existingIndex], ...userRecord };
  } else {
    users.push(userRecord);
  }
  
  saveExternalUsers(users);
}

// Buscar usuario por teléfono
function findUserByPhone(phone) {
  const users = loadUsers();
  const externalUsers = loadExternalUsers();
  
  // Buscar en usuarios principales
  const mainUser = users.find(u => u.phone === phone || u.whatsapp === phone);
  if (mainUser) {
    return { username: mainUser.username, phone: mainUser.phone, source: 'main' };
  }
  
  // Buscar en base externa
  const externalUser = externalUsers.find(u => u.phone === phone || u.whatsapp === phone);
  if (externalUser) {
    return { username: externalUser.username, phone: externalUser.phone, source: 'external' };
  }
  
  return null;
}

// Cambiar contraseña por teléfono
async function changePasswordByPhone(phone, newPassword) {
  const users = loadUsers();
  const userIndex = users.findIndex(u => u.phone === phone || u.whatsapp === phone);
  
  if (userIndex === -1) {
    return { success: false, error: 'Usuario no encontrado con ese número de teléfono' };
  }
  
  users[userIndex].password = await bcrypt.hash(newPassword, 10);
  users[userIndex].passwordChangedAt = new Date().toISOString();
  saveUsers(users);
  
  return { success: true, username: users[userIndex].username };
}

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

// Mantener máximo 10 mensajes por chat
function limitMessagesPerChat(userId) {
  try {
    const messages = loadMessages();
    
    // Obtener mensajes del usuario (enviados y recibidos)
    const userMessages = messages.filter(m => 
      (m.senderId === userId && m.senderRole === 'user') || 
      (m.receiverId === userId && m.receiverRole === 'user')
    );
    
    // Si hay más de 10 mensajes, eliminar los más antiguos
    if (userMessages.length > 10) {
      const messagesToDelete = userMessages.length - 10;
      const sortedMessages = userMessages.sort((a, b) => 
        new Date(a.timestamp) - new Date(b.timestamp)
      );
      const idsToDelete = sortedMessages.slice(0, messagesToDelete).map(m => m.id);
      
      const filteredMessages = messages.filter(m => !idsToDelete.includes(m.id));
      saveMessages(filteredMessages);
      console.log(`🧹 Chat ${userId}: ${messagesToDelete} mensajes antiguos eliminados`);
    }
  } catch (error) {
    console.error('Error limitando mensajes por chat:', error);
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
    
    // Verificar si el tokenVersion coincide con el usuario actual
    const users = loadUsers();
    const user = users.find(u => u.id === decoded.userId);
    
    if (!user) {
      return res.status(401).json({ error: 'Usuario no encontrado' });
    }
    
    // Si el usuario tiene tokenVersion y el token no coincide, invalidar
    if (user.tokenVersion && decoded.tokenVersion !== user.tokenVersion) {
      return res.status(401).json({ error: 'Sesión expirada. Por favor, vuelve a iniciar sesión.' });
    }
    
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Token inválido' });
  }
};

// Middleware de admin
const adminMiddleware = (req, res, next) => {
  if (req.user.role !== 'admin' && req.user.role !== 'depositor' && req.user.role !== 'withdrawer') {
    return res.status(403).json({ error: 'Acceso denegado. Solo administradores.' });
  }
  next();
};

// Middleware para verificar permiso de depósito
const depositorMiddleware = (req, res, next) => {
  if (req.user.role !== 'admin' && req.user.role !== 'depositor') {
    return res.status(403).json({ error: 'Acceso denegado. Solo agentes de carga.' });
  }
  next();
};

// Middleware para verificar permiso de retiro
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
    
    // Verificar en base de datos local
    const users = loadUsers();
    const localExists = users.find(u => u.username.toLowerCase() === username.toLowerCase());
    
    if (localExists) {
      return res.json({ available: false, message: 'Usuario ya registrado' });
    }
    
    // Verificar en JUGAYGANA
    try {
      const jgUser = await jugaygana.getUserInfoByName(username);
      if (jgUser) {
        // El usuario YA EXISTE en JUGAYGANA - no permitir crear
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
    
    // El usuario no existe en ningún lado, está disponible
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
    const config = loadConfig();
    
    if (!config.cbu || !config.cbu.number) {
      return res.status(400).json({ error: 'CBU no configurado' });
    }
    
    const messages = loadMessages();
    const timestamp = new Date().toISOString();
    
    // 1. Mensaje completo con todos los datos
    const fullMessage = `💳 *Datos para transferir:*\n\n🏦 Banco: ${config.cbu.bank}\n👤 Titular: ${config.cbu.titular}\n🔢 CBU: ${config.cbu.number}\n📱 Alias: ${config.cbu.alias}\n\n✅ Una vez realizada la transferencia, envianos el comprobante por aquí.`;
    
    messages.push({
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
    
    // 2. CBU solo para copiar y pegar (mensaje separado)
    messages.push({
      id: uuidv4(),
      senderId: req.user.userId,
      senderUsername: req.user.username,
      senderRole: 'admin',
      receiverId: userId,
      receiverRole: 'user',
      content: config.cbu.number,
      type: 'text',
      timestamp: new Date(Date.now() + 100).toISOString(), // Ligeramente diferente timestamp
      read: false
    });
    
    saveMessages(messages);
    
    res.json({ success: true, message: 'CBU enviado' });
  } catch (error) {
    console.error('Error enviando CBU:', error);
    res.status(500).json({ error: 'Error enviando CBU' });
  }
});

// Registro de usuario - AHORA PRIMERO CREA EN JUGAYGANA
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password, email, phone } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
    }
    
    if (password.length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }
    
    // Teléfono obligatorio
    if (!phone || phone.trim().length < 8) {
      return res.status(400).json({ error: 'El número de teléfono es obligatorio (mínimo 8 dígitos)' });
    }
    
    const users = loadUsers();
    
    // Verificar si el usuario ya existe localmente
    if (users.find(u => u.username.toLowerCase() === username.toLowerCase())) {
      return res.status(400).json({ error: 'El usuario ya existe' });
    }
    
    // PASO 1: Crear usuario en JUGAYGANA PRIMERO
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
    
    // PASO 2: Crear usuario localmente con datos de JUGAYGANA
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = {
      id: uuidv4(),
      username,
      password: hashedPassword,
      email: email || null,
      phone: phone.trim(),
      role: 'user',
      accountNumber: generateAccountNumber(),
      balance: jgResult.user?.balance || jgResult.user?.user_balance || 0,
      createdAt: new Date().toISOString(),
      lastLogin: null,
      isActive: true,
      jugayganaUserId: jgResult.jugayganaUserId || jgResult.user?.user_id,
      jugayganaUsername: jgResult.jugayganaUsername || jgResult.user?.user_name,
      jugayganaSyncStatus: jgResult.alreadyExists ? 'linked' : 'synced'
    };
    
    users.push(newUser);
    saveUsers(users);
    
    // Enviar mensaje de bienvenida
    const messages = loadMessages();
    const welcomeMessage = {
      id: uuidv4(),
      senderId: 'system',
      senderUsername: 'Sistema',
      senderRole: 'admin',
      receiverId: newUser.id,
      receiverRole: 'user',
      content: `🎉 ¡Bienvenido a la Sala de Juegos, ${username}!\n\n🎁 Beneficios exclusivos:\n• Reembolso DIARIO del 20%\n• Reembolso SEMANAL del 10%\n• Reembolso MENSUAL del 5%\n• Fueguito diario con recompensas\n• Atención 24/7\n\n💬 Escribe aquí para hablar con un agente.`,
      type: 'text',
      timestamp: new Date().toISOString(),
      read: false
    };
    messages.push(welcomeMessage);
    saveMessages(messages);
    
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
    
    // 5. Generar token (incluir tokenVersion para invalidación de sesiones)
    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role, tokenVersion: user.tokenVersion || 0 },
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

// Obtener información del usuario actual
app.get('/api/users/me', authMiddleware, (req, res) => {
  try {
    const users = loadUsers();
    const user = users.find(u => u.id === req.user.userId);
    
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    
    // Devolver usuario sin contraseña
    const { password, ...userWithoutPassword } = user;
    res.json(userWithoutPassword);
  } catch (error) {
    console.error('Error obteniendo usuario:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Cambiar contraseña
app.post('/api/auth/change-password', authMiddleware, async (req, res) => {
  try {
    const { currentPassword, newPassword, whatsapp, closeAllSessions } = req.body;
    const users = loadUsers();
    const user = users.find(u => u.id === req.user.userId);
    
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    
    // Validar WhatsApp si se proporciona
    if (whatsapp && whatsapp.trim().length < 8) {
      return res.status(400).json({ error: 'El número de WhatsApp debe tener al menos 8 dígitos' });
    }
    
    const isValidPassword = await bcrypt.compare(currentPassword, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Contraseña actual incorrecta' });
    }
    
    user.password = await bcrypt.hash(newPassword, 10);
    user.passwordChangedAt = new Date().toISOString();
    
    // Guardar WhatsApp si se proporciona
    if (whatsapp && whatsapp.trim()) {
      user.whatsapp = whatsapp.trim();
    }
    
    // Si se solicita cerrar todas las sesiones, invalidar el token actual
    if (closeAllSessions) {
      user.tokenVersion = (user.tokenVersion || 0) + 1;
    }
    
    saveUsers(users);
    
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

// Buscar usuario por número de teléfono
app.post('/api/auth/find-user-by-phone', async (req, res) => {
  try {
    const { phone } = req.body;
    
    if (!phone || phone.trim().length < 8) {
      return res.status(400).json({ error: 'Número de teléfono inválido' });
    }
    
    const user = findUserByPhone(phone.trim());
    
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

// Cambiar contraseña por número de teléfono
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
// RUTAS DE CONFIGURACIÓN PÚBLICA
// ============================================

// Obtener CBU (para usuarios autenticados)
app.get('/api/config/cbu', authMiddleware, (req, res) => {
  try {
    const config = loadConfig();
    if (!config.cbu) {
      return res.status(404).json({ error: 'CBU no configurado' });
    }
    
    res.json({
      cbu: config.cbu.number,
      alias: config.cbu.alias,
      bank: config.cbu.bank,
      titular: config.cbu.titular
    });
  } catch (error) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Enviar mensaje de solicitud de CBU (para usuarios)
app.post('/api/cbu/request', authMiddleware, (req, res) => {
  try {
    const config = loadConfig();
    if (!config.cbu) {
      return res.status(404).json({ error: 'CBU no configurado' });
    }
    
    const messages = loadMessages();
    
    // 1. Mensaje de solicitud del usuario
    messages.push({
      id: uuidv4(),
      senderId: req.user.userId,
      senderUsername: req.user.username,
      senderRole: 'user',
      receiverId: 'admin',
      receiverRole: 'admin',
      content: '💳 Solicito los datos para transferir (CBU)',
      type: 'text',
      timestamp: new Date().toISOString(),
      read: false
    });
    
    // 2. Mensaje completo con todos los datos del CBU
    const fullMessage = `💳 *Datos para transferir:*\n\n🏦 Banco: ${config.cbu.bank}\n👤 Titular: ${config.cbu.titular}\n🔢 CBU: ${config.cbu.number}\n📱 Alias: ${config.cbu.alias}\n\n✅ Una vez realizada la transferencia, envianos el comprobante por aquí.`;
    
    messages.push({
      id: uuidv4(),
      senderId: 'system',
      senderUsername: 'Sistema',
      senderRole: 'admin',
      receiverId: req.user.userId,
      receiverRole: 'user',
      content: fullMessage,
      type: 'text',
      timestamp: new Date().toISOString(),
      read: false
    });
    
    // 3. CBU solo para copiar y pegar
    messages.push({
      id: uuidv4(),
      senderId: 'system',
      senderUsername: 'Sistema',
      senderRole: 'admin',
      receiverId: req.user.userId,
      receiverRole: 'user',
      content: config.cbu.number,
      type: 'text',
      timestamp: new Date().toISOString(),
      read: false
    });
    
    saveMessages(messages);
    
    res.json({ 
      success: true, 
      message: 'Solicitud enviada',
      cbu: {
        number: config.cbu.number,
        alias: config.cbu.alias,
        bank: config.cbu.bank,
        titular: config.cbu.titular
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
    
    // Validaciones
    if (!username || !password) {
      return res.status(400).json({ error: 'Usuario y contraseña son requeridos' });
    }
    
    if (password.length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }
    
    // Teléfono obligatorio
    if (!phone || phone.trim().length < 8) {
      return res.status(400).json({ error: 'El número de teléfono es obligatorio (mínimo 8 dígitos)' });
    }
    
    // Validar rol
    const validRoles = ['user', 'admin', 'depositor', 'withdrawer'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: 'Rol inválido' });
    }
    
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
    
    // Sincronizar con JUGAYGANA solo si es usuario normal (no admin, depositor o withdrawer)
    if (role === 'user') {
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
    } else {
      // Para admins, marcar como no aplicable
      const users = loadUsers();
      const userIndex = users.findIndex(u => u.id === newUser.id);
      if (userIndex !== -1) {
        users[userIndex].jugayganaSyncStatus = 'not_applicable';
        saveUsers(users);
      }
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
    
    const userToDelete = users.find(u => u.id === id);
    if (!userToDelete) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    
    // Solo los admins pueden eliminar otros admins/depositors/withdrawers
    const adminRoles = ['admin', 'depositor', 'withdrawer'];
    if (adminRoles.includes(userToDelete.role) && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Solo los administradores pueden eliminar otros administradores' });
    }
    
    users = users.filter(u => u.id !== id);
    saveUsers(users);
    
    res.json({ message: 'Usuario eliminado exitosamente' });
  } catch (error) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================
// DEBUG - Ver todos los mensajes
// ============================================

app.get('/api/debug/messages', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const messages = loadMessages();
    res.json({
      count: messages.length,
      messages: messages.slice(-20) // Últimos 20 mensajes
    });
  } catch (error) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================
// SISTEMA DE CHATS ABIERTOS/CERRADOS
// ============================================

const CHAT_STATUS_FILE = path.join(DATA_DIR, 'chat-status.json');

function loadChatStatus() {
  try {
    if (!fs.existsSync(CHAT_STATUS_FILE)) {
      fs.writeFileSync(CHAT_STATUS_FILE, JSON.stringify({}, null, 2));
      return {};
    }
    return JSON.parse(fs.readFileSync(CHAT_STATUS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveChatStatus(status) {
  fs.writeFileSync(CHAT_STATUS_FILE, JSON.stringify(status, null, 2));
}

function getChatStatus(userId) {
  const status = loadChatStatus();
  return status[userId] || { status: 'open', assignedTo: null, closedAt: null, closedBy: null };
}

function updateChatStatus(userId, updates) {
  const status = loadChatStatus();
  status[userId] = { ...getChatStatus(userId), ...updates };
  saveChatStatus(status);
}

// Obtener todos los estados de chats
app.get('/api/admin/chat-status/all', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const status = loadChatStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Endpoint para obtener chats por estado
app.get('/api/admin/chats/:status', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const { status } = req.params; // 'open' o 'closed'
    const messages = loadMessages();
    const users = loadUsers();
    const chatStatus = loadChatStatus();
    
    console.log(`📨 Cargando chats con estado: ${status}`);
    console.log(`📊 Total mensajes: ${messages.length}`);
    console.log(`👥 Total usuarios: ${users.length}`);
    
    // Agrupar mensajes por usuario (todos los mensajes donde el usuario participa)
    const userMessages = {};
    messages.forEach(msg => {
      // Mensajes enviados por el usuario
      if (msg.senderRole === 'user') {
        if (!userMessages[msg.senderId]) {
          userMessages[msg.senderId] = [];
        }
        userMessages[msg.senderId].push(msg);
      }
      // Mensajes recibidos por el usuario (del admin/sistema)
      if (msg.receiverRole === 'user' && msg.senderRole !== 'user') {
        if (!userMessages[msg.receiverId]) {
          userMessages[msg.receiverId] = [];
        }
        userMessages[msg.receiverId].push(msg);
      }
    });
    
    console.log(`💬 Usuarios con mensajes: ${Object.keys(userMessages).length}`);
    
    // Filtrar por estado y categoría (excluir 'pagos' de cargas)
    const filteredChats = [];
    
    Object.keys(userMessages).forEach(userId => {
      const user = users.find(u => u.id === userId);
      if (!user) {
        console.log(`⚠️ Usuario no encontrado: ${userId}`);
        return;
      }
      
      // Por defecto, los chats nuevos son 'open' y categoría 'cargas'
      const statusInfo = chatStatus[userId] || { status: 'open', category: 'cargas', assignedTo: null };
      
      console.log(`👤 ${user.username} - Estado: ${statusInfo.status}, Categoría: ${statusInfo.category} (buscando: ${status})`);
      
      // Solo mostrar chats de categoría 'cargas' (no 'pagos')
      if (statusInfo.status === status && statusInfo.category !== 'pagos') {
        const msgs = userMessages[userId].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        const lastMsg = msgs[msgs.length - 1];
        const unreadCount = msgs.filter(m => m.receiverRole === 'admin' && !m.read).length;
        
        filteredChats.push({
          userId,
          username: user.username,
          lastMessage: lastMsg,
          unreadCount,
          assignedTo: statusInfo.assignedTo,
          closedAt: statusInfo.closedAt,
          closedBy: statusInfo.closedBy
        });
      }
    });
    
    // Ordenar por fecha del último mensaje (más reciente primero)
    filteredChats.sort((a, b) => new Date(b.lastMessage.timestamp) - new Date(a.lastMessage.timestamp));
    
    console.log(`✅ Chats encontrados: ${filteredChats.length}`);
    
    res.json(filteredChats);
  } catch (error) {
    console.error('Error obteniendo chats:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Endpoint alternativo: obtener TODOS los chats (para debugging)
app.get('/api/admin/all-chats', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const messages = loadMessages();
    const users = loadUsers();
    const chatStatus = loadChatStatus();
    
    // Agrupar mensajes por usuario
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
      const statusInfo = chatStatus[userId] || { status: 'open', assignedTo: null };
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

// Cerrar chat
app.post('/api/admin/chats/:userId/close', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const { userId } = req.params;
    const chatStatus = loadChatStatus();
    const currentStatus = chatStatus[userId] || { status: 'open', category: 'cargas' };
    
    updateChatStatus(userId, {
      status: 'closed',
      closedAt: new Date().toISOString(),
      closedBy: req.user.username,
      assignedTo: null,
      // Al cerrar, siempre volver a categoría 'cargas' para que aparezca en chats cerrados del lado de cargas
      category: 'cargas'
    });
    
    // No enviar mensaje al usuario - simplemente mover a chats cerrados
    
    res.json({ success: true, message: 'Chat cerrado' });
  } catch (error) {
    res.status(500).json({ error: 'Error cerrando chat' });
  }
});

// Reabrir chat
app.post('/api/admin/chats/:userId/reopen', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const { userId } = req.params;
    updateChatStatus(userId, {
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

// Asignar chat a agente
app.post('/api/admin/chats/:userId/assign', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const { userId } = req.params;
    const { agent } = req.body;
    updateChatStatus(userId, { assignedTo: agent, status: 'open' });
    res.json({ success: true, message: 'Chat asignado a ' + agent });
  } catch (error) {
    res.status(500).json({ error: 'Error asignando chat' });
  }
});

// ============================================
// CATEGORÍAS DE CHAT (CARGAS/PAGOS)
// ============================================

// Cambiar categoría de chat (cargas/pagos)
app.post('/api/admin/chats/:userId/category', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const { userId } = req.params;
    const { category } = req.body; // 'cargas' o 'pagos'
    
    if (!category || !['cargas', 'pagos'].includes(category)) {
      return res.status(400).json({ error: 'Categoría inválida. Use "cargas" o "pagos"' });
    }
    
    const chatStatus = loadChatStatus();
    if (!chatStatus[userId]) {
      chatStatus[userId] = { status: 'open', assignedTo: null };
    }
    chatStatus[userId].category = category;
    saveChatStatus(chatStatus);
    
    res.json({ success: true, message: `Chat movido a ${category.toUpperCase()}` });
  } catch (error) {
    console.error('Error cambiando categoría:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Obtener chats por categoría
app.get('/api/admin/chats/category/:category', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const { category } = req.params; // 'cargas' o 'pagos'
    const messages = loadMessages();
    const users = loadUsers();
    const chatStatus = loadChatStatus();
    
    // Agrupar mensajes por usuario
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
    
    Object.keys(userMessages).forEach(userId => {
      const user = users.find(u => u.id === userId);
      if (!user) return;
      
      const statusInfo = chatStatus[userId] || { status: 'open', assignedTo: null, category: 'cargas' };
      
      // Filtrar por categoría (por defecto es 'cargas')
      if ((statusInfo.category || 'cargas') === category) {
        const msgs = userMessages[userId].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        const lastMsg = msgs[msgs.length - 1];
        const unreadCount = msgs.filter(m => m.receiverRole === 'admin' && !m.read).length;
        
        filteredChats.push({
          userId,
          username: user.username,
          lastMessage: lastMsg,
          unreadCount,
          assignedTo: statusInfo.assignedTo,
          status: statusInfo.status
        });
      }
    });
    
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

// Obtener mensajes de un usuario (limitado a 10 por defecto)
app.get('/api/messages/:userId', authMiddleware, (req, res) => {
  try {
    const { userId } = req.params;
    const limit = parseInt(req.query.limit) || 10; // Por defecto 10 mensajes
    const messages = loadMessages();
    
    // Si es admin, depositor o withdrawer, puede ver todos los mensajes
    // Si es user, solo puede ver sus propios mensajes
    const allowedRoles = ['admin', 'depositor', 'withdrawer'];
    if (!allowedRoles.includes(req.user.role) && req.user.userId !== userId) {
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
    
    console.log(`📨 Cargando conversaciones. Total mensajes: ${messages.length}`);
    
    // Agrupar mensajes por usuario
    const conversations = {};
    
    messages.forEach(msg => {
      // Determinar el userId basado en quién es el usuario (no el admin)
      let userId = null;
      
      if (msg.senderRole === 'user') {
        userId = msg.senderId;
      } else if (msg.receiverRole === 'user') {
        userId = msg.receiverId;
      }
      
      if (!userId) return; // Ignorar mensajes entre admins
      
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
        if (new Date(msg.timestamp) > new Date(conversations[userId].lastMessage.timestamp)) {
          conversations[userId].lastMessage = msg;
        }
        if (msg.receiverRole === 'admin' && !msg.read) {
          conversations[userId].unreadCount++;
        }
      }
    });
    
    console.log(`✅ Conversaciones encontradas: ${Object.keys(conversations).length}`);
    
    res.json(Object.values(conversations));
  } catch (error) {
    console.error('Error obteniendo conversaciones:', error);
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
    
    console.log('📨 Recibida solicitud de enviar mensaje');
    console.log('👤 Usuario:', req.user?.username, 'Rol:', req.user?.role);
    console.log('📝 Contenido:', content?.substring(0, 50));
    
    if (!content) {
      console.log('❌ Error: Contenido vacío');
      return res.status(400).json({ error: 'Contenido requerido' });
    }
    
    const messages = loadMessages();
    console.log('💬 Mensajes actuales:', messages.length);
    
    // Determinar si es un rol de administración (admin, depositor, withdrawer)
    const adminRoles = ['admin', 'depositor', 'withdrawer'];
    const isAdminRole = adminRoles.includes(req.user.role);
    
    const message = {
      id: uuidv4(),
      senderId: req.user.userId,
      senderUsername: req.user.username,
      senderRole: req.user.role,
      receiverId: isAdminRole ? (req.body.receiverId || 'admin') : 'admin',
      receiverRole: isAdminRole ? 'user' : 'admin',
      content,
      type,
      timestamp: new Date().toISOString(),
      read: false
    };
    
    console.log('📤 Guardando mensaje - senderRole:', message.senderRole, 'senderUsername:', message.senderUsername);
    console.log('📤 Mensaje completo:', JSON.stringify(message, null, 2));
    
    messages.push(message);
    saveMessages(messages);
    
    // Verificar que el mensaje se guardó correctamente
    const savedMessages = loadMessages();
    const savedMessage = savedMessages.find(m => m.id === message.id);
    console.log('✅ Mensaje guardado - senderRole:', savedMessage?.senderRole, 'senderUsername:', savedMessage?.senderUsername);
    
    console.log('✅ Mensaje guardado. Total mensajes:', messages.length);
    
    // Guardar usuario en base de datos externa
    if (req.user.role === 'user') {
      const users = loadUsers();
      const user = users.find(u => u.id === req.user.userId);
      if (user) {
        addExternalUser({
          username: user.username,
          phone: user.phone,
          whatsapp: user.whatsapp
        });
      }
    }
    
    // Limitar a máximo 10 mensajes por chat
    const targetUserId = req.user.role === 'admin' ? req.body.receiverId : req.user.userId;
    if (targetUserId) {
      limitMessagesPerChat(targetUserId);
    }
    
    // Si es un USUARIO (no admin) enviando mensaje, verificar si el chat estaba cerrado y reabrirlo
    // El admin puede enviar mensajes en chats cerrados sin reabrirlos
    if (req.user.role === 'user') {
      const chatStatus = loadChatStatus();
      const currentStatus = chatStatus[req.user.userId];
      
      if (currentStatus && currentStatus.status === 'closed') {
        console.log('🔄 Reabriendo chat cerrado para usuario:', req.user.username);
        chatStatus[req.user.userId] = {
          status: 'open',
          assignedTo: null,
          closedAt: null,
          closedBy: null
        };
        saveChatStatus(chatStatus);
      }
    }
    
    res.json(message);
  } catch (error) {
    console.error('❌ Error enviando mensaje:', error);
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
    
    // BLOQUEO: Prevenir reclamación múltiple
    if (!acquireRefundLock(userId, 'daily')) {
      return res.json({
        success: false,
        message: '⏳ Ya estás procesando un reembolso. Por favor espera...',
        canClaim: true,
        processing: true
      });
    }
    
    try {
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
    } finally {
      // Liberar el bloqueo después de 3 segundos (para evitar spam)
      setTimeout(() => releaseRefundLock(userId, 'daily'), 3000);
    }
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
    
    // BLOQUEO: Prevenir reclamación múltiple
    if (!acquireRefundLock(userId, 'weekly')) {
      return res.json({
        success: false,
        message: '⏳ Ya estás procesando un reembolso. Por favor espera...',
        canClaim: true,
        processing: true
      });
    }
    
    try {
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
    } finally {
      // Liberar el bloqueo después de 3 segundos
      setTimeout(() => releaseRefundLock(userId, 'weekly'), 3000);
    }
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
    
    // BLOQUEO: Prevenir reclamación múltiple
    if (!acquireRefundLock(userId, 'monthly')) {
      return res.json({
        success: false,
        message: '⏳ Ya estás procesando un reembolso. Por favor espera...',
        canClaim: true,
        processing: true
      });
    }
    
    try {
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
    } finally {
      // Liberar el bloqueo después de 3 segundos
      setTimeout(() => releaseRefundLock(userId, 'monthly'), 3000);
    }
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

// Obtener todos los reembolsos (solo admin)
app.get('/api/refunds/all', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const allRefunds = refunds.getAllRefunds();
    
    // Calcular resumen
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
      refunds: allRefunds.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)),
      summary
    });
  } catch (error) {
    console.error('Error obteniendo todos los reembolsos:', error);
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

// Obtener balance en tiempo real (para actualización automática)
app.get('/api/balance/live', authMiddleware, async (req, res) => {
  try {
    const username = req.user.username;
    const result = await jugayganaMovements.getUserBalance(username);
    
    if (result.success) {
      // Actualizar balance en el usuario local
      const users = loadUsers();
      const userIndex = users.findIndex(u => u.username === username);
      if (userIndex !== -1) {
        users[userIndex].balance = result.balance;
        saveUsers(users);
      }
      
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
    
    // Usar la misma función que reembolsos pero con deposit_type: deposit
    const result = await jugaygana.depositToUser(username, amount, description);
    
    if (result.success) {
      // Registrar actividad para el fueguito del usuario
      const users = loadUsers();
      const user = users.find(u => u.username === username);
      if (user) {
        recordUserActivity(user.id, 'deposit', amount);
      }
      
      // Registrar transacción en el dashboard
      saveTransaction({
        type: 'deposit',
        amount: parseFloat(amount),
        username: username,
        description: description || 'Depósito realizado',
        adminId: req.user?.userId,
        adminUsername: req.user?.username,
        adminRole: req.user?.role || 'admin'
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
    
    // Usar la función de retiro
    const result = await jugaygana.withdrawFromUser(username, amount, description);
    
    if (result.success) {
      // Registrar actividad para el fueguito del usuario
      const users = loadUsers();
      const user = users.find(u => u.username === username);
      if (user) {
        recordUserActivity(user.id, 'withdrawal', amount);
      }
      
      // Registrar transacción en el dashboard
      saveTransaction({
        type: 'withdrawal',
        amount: parseFloat(amount),
        username: username,
        description: description || 'Retiro realizado',
        adminId: req.user?.userId,
        adminUsername: req.user?.username,
        adminRole: req.user?.role || 'admin'
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

// Realizar bonificación (solo admin)
app.post('/api/admin/bonus', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { username, amount, description } = req.body;
    
    console.log('🎁 POST /api/admin/bonus - Body:', req.body);
    console.log('🎁 Usuario:', req.user?.username, 'Rol:', req.user?.role);
    
    if (!username || !amount) {
      console.log('❌ Error: Usuario y monto requeridos');
      return res.status(400).json({ error: 'Usuario y monto requeridos' });
    }
    
    const bonusAmount = parseFloat(amount);
    if (isNaN(bonusAmount) || bonusAmount <= 0) {
      console.log('❌ Error: Monto de bonificación inválido');
      return res.status(400).json({ error: 'Monto de bonificación inválido' });
    }
    
    console.log(`🎁 Aplicando bonus de $${bonusAmount} a ${username}`);
    
    // Usar makeBonus que hace deposit_type: individual_bonus (igual que reembolso)
    const result = await jugayganaMovements.makeBonus(
      username, 
      bonusAmount,
      description || 'Bonificación - Sala de Juegos'
    );
    
    if (result.success) {
      // Obtener el balance actualizado del usuario
      const balanceResult = await jugayganaMovements.getUserBalance(username);
      const newBalance = balanceResult.success ? balanceResult.balance : null;
      
      console.log(`✅ Bonus aplicado: $${bonusAmount} a ${username}. Nuevo balance: ${newBalance}`);
      
      // Registrar transacción en el dashboard
      saveTransaction({
        type: 'bonus',
        amount: bonusAmount,
        username: username,
        description: description || 'Bonificación otorgada',
        adminId: req.user?.userId,
        adminUsername: req.user?.username,
        adminRole: req.user?.role || 'admin'
      });
      
      res.json({
        success: true,
        message: `Bonificación de $${bonusAmount.toLocaleString()} realizada correctamente`,
        newBalance: newBalance,
        transactionId: result.data?.transfer_id || result.data?.transferId || result.transferId
      });
    } else {
      console.error('❌ Error aplicando bonus:', result.error);
      res.status(400).json({ error: result.error || 'Error al aplicar bonificación' });
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
        username: socket.username,
        isTyping: data.isTyping
      });
    } else {
      // Admin escribiendo - notificar al usuario específico
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
  
  // Dejar de escribir
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
    
    // Usar la misma función que reembolsos pero con deposit_type: deposit
    const result = await jugaygana.depositToUser(
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

// Retiro real en JUGAYGANA
app.post('/api/movements/withdraw', authMiddleware, async (req, res) => {
  try {
    const { amount } = req.body;
    const username = req.user.username;
    
    if (!amount || amount < 100) {
      return res.status(400).json({ error: 'Monto mínimo $100' });
    }
    
    // Usar la función de retiro
    const result = await jugaygana.withdrawFromUser(
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

// Función para obtener fecha en hora Argentina (GMT-3)
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

// Obtener estado del fueguito
app.get('/api/fire/status', authMiddleware, (req, res) => {
  try {
    const userId = req.user.userId;
    const rewards = loadFireRewards();
    const userRewards = rewards[userId] || { streak: 0, lastClaim: null, totalClaimed: 0 };
    
    const todayArgentina = getArgentinaDateString();
    const lastClaim = userRewards.lastClaim ? getArgentinaDateString(new Date(userRewards.lastClaim)) : null;
    
    // Verificar si puede reclamar hoy (sin requisitos de actividad)
    const canClaim = lastClaim !== todayArgentina;
    
    // Verificar si perdió la racha (no reclamó ayer en hora Argentina)
    const yesterdayArgentina = getArgentinaYesterday();
    
    // Si no reclamó ayer y tiene racha > 0, resetear
    if (lastClaim !== yesterdayArgentina && lastClaim !== todayArgentina && userRewards.streak > 0) {
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
    
    const todayArgentina = getArgentinaDateString();
    const lastClaim = userRewards.lastClaim ? getArgentinaDateString(new Date(userRewards.lastClaim)) : null;
    
    // Verificar si ya reclamó hoy (hora Argentina)
    if (lastClaim === todayArgentina) {
      return res.status(400).json({ error: 'Ya reclamaste tu fueguito hoy' });
    }
    
    // Verificar racha - si no reclamó ayer (hora Argentina), resetear
    const yesterdayArgentina = getArgentinaYesterday();
    
    if (lastClaim !== yesterdayArgentina && userRewards.streak > 0) {
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
// CONFIGURACIÓN DEL SISTEMA (CBU, COMANDOS, ETC)
// ============================================

const CONFIG_FILE = path.join(DATA_DIR, 'system-config.json');
const CUSTOM_COMMANDS_FILE = path.join(DATA_DIR, 'custom-commands.json');

// Configuración por defecto
const defaultConfig = {
  cbu: {
    number: '0000000000000000000000',
    alias: 'mi.alias.cbu',
    bank: 'Banco Ejemplo',
    titular: 'Sala de Juegos',
    message: '💳 *Datos para transferir:*\n\n🏦 Banco: {bank}\n👤 Titular: {titular}\n🔢 CBU: `{cbu}`\n📱 Alias: `{alias}`\n\n✅ Una vez realizada la transferencia, envíanos el comprobante por aquí.'
  },
  welcomeMessage: '🎉 ¡Bienvenido a la Sala de Juegos!',
  depositMessage: '💰 ¡Fichas cargadas! ${amount}. ¡Ya tenés tu carga en la plataforma! 🍀\n\n👤 Tu usuario: {username}\n🌐 Plataforma: www.jugaygana.bet\n\n¡Mucha suerte! 🎰✨'
};

function loadConfig() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) {
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(defaultConfig, null, 2));
      return defaultConfig;
    }
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (error) {
    console.error('Error cargando config:', error);
    return defaultConfig;
  }
}

function saveConfig(config) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (error) {
    console.error('Error guardando config:', error);
  }
}

function loadCustomCommands() {
  try {
    if (!fs.existsSync(CUSTOM_COMMANDS_FILE)) {
      fs.writeFileSync(CUSTOM_COMMANDS_FILE, JSON.stringify({}, null, 2));
      return {};
    }
    return JSON.parse(fs.readFileSync(CUSTOM_COMMANDS_FILE, 'utf8'));
  } catch (error) {
    console.error('Error cargando comandos:', error);
    return {};
  }
}

function saveCustomCommands(commands) {
  try {
    fs.writeFileSync(CUSTOM_COMMANDS_FILE, JSON.stringify(commands, null, 2));
  } catch (error) {
    console.error('Error guardando comandos:', error);
  }
}

// ============================================
// ENDPOINTS ADMIN - TRANSACCIONES
// ============================================

// Almacenar transacciones en memoria (en producción usar base de datos)
const TRANSACTIONS_FILE = path.join(DATA_DIR, 'transactions.json');

function loadTransactions() {
  try {
    if (!fs.existsSync(TRANSACTIONS_FILE)) return [];
    return JSON.parse(fs.readFileSync(TRANSACTIONS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveTransaction(transaction) {
  try {
    const transactions = loadTransactions();
    transactions.push({
      ...transaction,
      id: uuidv4(),
      timestamp: new Date().toISOString()
    });
    fs.writeFileSync(TRANSACTIONS_FILE, JSON.stringify(transactions, null, 2));
  } catch (error) {
    console.error('Error guardando transacción:', error);
  }
}

// Middleware para registrar transacciones
function recordTransaction(req, res, next) {
  const originalSend = res.send;
  
  res.send = function(data) {
    // Solo registrar si la respuesta fue exitosa
    if (res.statusCode >= 200 && res.statusCode < 300) {
      const path = req.path;
      let type = null;
      let amount = 0;
      
      if (path.includes('/deposit')) {
        type = 'deposit';
        amount = req.body?.amount || 0;
      } else if (path.includes('/withdrawal') || path.includes('/withdraw')) {
        type = 'withdrawal';
        amount = req.body?.amount || 0;
      } else if (path.includes('/bonus')) {
        type = 'bonus';
        amount = req.body?.amount || 0;
      } else if (path.includes('/refunds')) {
        type = 'refund';
        amount = req.body?.amount || 0;
      }
      
      if (type && amount > 0) {
        saveTransaction({
          type,
          amount,
          username: req.body?.username || req.user?.username,
          description: req.body?.description || '',
          adminId: req.user?.userId,
          adminUsername: req.user?.username,
          adminRole: req.user?.role || 'admin'
        });
      }
    }
    
    originalSend.call(this, data);
  };
  
  next();
}

// Aplicar middleware de registro a rutas de transacciones
app.use('/api/admin/deposit', authMiddleware, depositorMiddleware, recordTransaction);
app.use('/api/admin/withdrawal', authMiddleware, withdrawerMiddleware, recordTransaction);
// Bonus y reembolsos manejan su propio registro de transacciones dentro de los endpoints

// ============================================
// ENDPOINTS DE CONFIGURACIÓN
// ============================================

// Obtener configuración del sistema
app.get('/api/admin/config', authMiddleware, adminMiddleware, (req, res) => {
  const config = loadConfig();
  res.json(config);
});

// Actualizar configuración CBU
app.put('/api/admin/config/cbu', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const config = loadConfig();
    config.cbu = { ...config.cbu, ...req.body };
    saveConfig(config);
    res.json({ success: true, message: 'CBU actualizado', cbu: config.cbu });
  } catch (error) {
    res.status(500).json({ error: 'Error actualizando CBU' });
  }
});

// Obtener comandos personalizados
app.get('/api/admin/commands', authMiddleware, adminMiddleware, (req, res) => {
  const commands = loadCustomCommands();
  res.json(commands);
});

// Guardar comandos personalizados
app.post('/api/admin/commands', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const { name, description, type, bonusPercent, response } = req.body;
    
    if (!name || !name.startsWith('/')) {
      return res.status(400).json({ error: 'El comando debe empezar con /' });
    }
    
    const commands = loadCustomCommands();
    commands[name] = {
      description,
      type,
      bonusPercent: parseInt(bonusPercent) || 0,
      response,
      createdAt: new Date().toISOString()
    };
    
    saveCustomCommands(commands);
    res.json({ success: true, message: 'Comando guardado', commands });
  } catch (error) {
    res.status(500).json({ error: 'Error guardando comando' });
  }
});

// Eliminar comando personalizado
app.delete('/api/admin/commands/:name', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const commands = loadCustomCommands();
    delete commands[req.params.name];
    saveCustomCommands(commands);
    res.json({ success: true, message: 'Comando eliminado' });
  } catch (error) {
    res.status(500).json({ error: 'Error eliminando comando' });
  }
});

// Base de Datos - Solo admin principal
app.get('/api/admin/database', authMiddleware, adminMiddleware, (req, res) => {
  try {
    // Solo el admin principal puede acceder
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Acceso denegado. Solo el administrador principal puede acceder.' });
    }
    
    const users = loadUsers();
    const messages = loadMessages();
    
    // Contar admins
    const adminRoles = ['admin', 'depositor', 'withdrawer'];
    const totalAdmins = users.filter(u => adminRoles.includes(u.role)).length;
    
    res.json({
      users: users,
      totalUsers: users.length,
      totalAdmins: totalAdmins,
      totalMessages: messages.length
    });
  } catch (error) {
    console.error('Error obteniendo base de datos:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Obtener transacciones con filtros
app.get('/api/admin/transactions', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const { from, to, type } = req.query;
    let transactions = loadTransactions();
    
    // Filtrar por fecha
    if (from) {
      const fromDate = new Date(from);
      transactions = transactions.filter(t => new Date(t.timestamp) >= fromDate);
    }
    
    if (to) {
      const toDate = new Date(to);
      toDate.setHours(23, 59, 59, 999);
      transactions = transactions.filter(t => new Date(t.timestamp) <= toDate);
    }
    
    // Filtrar por tipo
    if (type && type !== 'all') {
      transactions = transactions.filter(t => t.type === type);
    }
    
    // Calcular resumen
    const summary = {
      deposits: 0,
      withdrawals: 0,
      bonuses: 0,
      refunds: 0
    };
    
    transactions.forEach(t => {
      if (summary.hasOwnProperty(t.type + 's') || summary.hasOwnProperty(t.type)) {
        const key = t.type + 's';
        summary[key] = (summary[key] || 0) + (t.amount || 0);
      }
    });
    
    // Ordenar por fecha descendente
    transactions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    res.json({
      transactions: transactions.slice(0, 100), // Limitar a 100
      summary,
      total: transactions.length
    });
  } catch (error) {
    console.error('Error obteniendo transacciones:', error);
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
