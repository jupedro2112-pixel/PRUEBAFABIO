const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

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
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

if (!fs.existsSync(USERS_FILE)) {
  fs.writeFileSync(USERS_FILE, JSON.stringify([], null, 2));
}

if (!fs.existsSync(MESSAGES_FILE)) {
  fs.writeFileSync(MESSAGES_FILE, JSON.stringify([], null, 2));
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
      isActive: true
    };
    
    users.push(newUser);
    saveUsers(users);
    
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

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
    }
    
    const users = loadUsers();
    const user = users.find(u => u.username === username);
    
    if (!user) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }
    
    if (!user.isActive) {
      return res.status(401).json({ error: 'Usuario desactivado' });
    }
    
    const isValidPassword = await bcrypt.compare(password, user.password);
    
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }
    
    // Actualizar último login
    user.lastLogin = new Date().toISOString();
    saveUsers(users);
    
    // Generar token
    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    res.json({
      message: 'Login exitoso',
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        accountNumber: user.accountNumber,
        role: user.role,
        balance: user.balance
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
      isActive: true
    };
    
    users.push(newUser);
    saveUsers(users);
    
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

// Ruta principal - serve index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Ruta admin - serve admin.html
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html'));
});

// ============================================
// INICIALIZAR DATOS DE PRUEBA
// ============================================

async function initializeData() {
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
      isActive: true
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
      isActive: true
    };
    users.push(user);
    console.log('✅ Usuario de prueba creado: 672rosana1 / asd123');
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
