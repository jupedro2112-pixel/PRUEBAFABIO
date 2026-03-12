/**
 * Replica Chat Server
 * Backend para aplicación de chat con autenticación y WebSockets
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

// ============================================
// CONFIGURACIÓN
// ============================================
const PORT = process.env.PORT || 3000;
const MESSAGES_FILE = path.join(__dirname, 'messages.json');
const USERS_FILE = path.join(__dirname, 'users.json');

// ============================================
// BASE DE DATOS EN MEMORIA
// ============================================

// Usuarios registrados (con persistencia en archivo)
let users = [];

// Mensajes almacenados (con persistencia en archivo)
let messages = [];

// Usuarios conectados actualmente (solo en memoria)
const connectedUsers = new Map(); // socketId -> { username, room }

// ============================================
// FUNCIONES DE PERSISTENCIA
// ============================================

function loadUsers() {
    try {
        if (fs.existsSync(USERS_FILE)) {
            const data = fs.readFileSync(USERS_FILE, 'utf8');
            users = JSON.parse(data);
            console.log(`✅ ${users.length} usuarios cargados`);
        } else {
            // Crear usuario de prueba por defecto
            createDefaultUsers();
        }
    } catch (error) {
        console.error('Error cargando usuarios:', error);
        createDefaultUsers();
    }
}

function saveUsers() {
    try {
        fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
    } catch (error) {
        console.error('Error guardando usuarios:', error);
    }
}

function loadMessages() {
    try {
        if (fs.existsSync(MESSAGES_FILE)) {
            const data = fs.readFileSync(MESSAGES_FILE, 'utf8');
            messages = JSON.parse(data);
            console.log(`✅ ${messages.length} mensajes cargados`);
        }
    } catch (error) {
        console.error('Error cargando mensajes:', error);
        messages = [];
    }
}

function saveMessages() {
    try {
        // Mantener solo los últimos 1000 mensajes
        const messagesToSave = messages.slice(-1000);
        fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messagesToSave, null, 2));
    } catch (error) {
        console.error('Error guardando mensajes:', error);
    }
}

function createDefaultUsers() {
    const defaultUsers = [
        {
            id: uuidv4(),
            username: '672rosana1',
            password: bcrypt.hashSync('asd123', 10),
            createdAt: new Date().toISOString()
        }
    ];
    users = defaultUsers;
    saveUsers();
    console.log('✅ Usuario de prueba creado: 672rosana1 / asd123');
}

// ============================================
// INICIALIZACIÓN DE EXPRESS Y SOCKET.IO
// ============================================

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir archivos estáticos del frontend
app.use(express.static(path.join(__dirname, '../replica')));

// ============================================
// MIDDLEWARE DE AUTENTICACIÓN
// ============================================

function authMiddleware(req, res, next) {
    const token = req.headers.authorization;
    
    if (!token) {
        return res.status(401).json({ error: 'Token no proporcionado' });
    }

    // Buscar usuario por token (en producción usar JWT)
    const user = users.find(u => u.id === token);
    
    if (!user) {
        return res.status(401).json({ error: 'Token inválido' });
    }

    req.user = user;
    next();
}

// ============================================
// API REST - AUTENTICACIÓN
// ============================================

// Login de usuario
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ 
                error: 'Usuario y contraseña son requeridos' 
            });
        }

        const user = users.find(u => u.username === username);

        if (!user) {
            return res.status(401).json({ 
                error: 'Usuario o contraseña incorrectos' 
            });
        }

        const isValidPassword = await bcrypt.compare(password, user.password);

        if (!isValidPassword) {
            return res.status(401).json({ 
                error: 'Usuario o contraseña incorrectos' 
            });
        }

        // En producción, generar JWT
        res.json({
            success: true,
            token: user.id,
            user: {
                id: user.id,
                username: user.username
            }
        });
    } catch (error) {
        console.error('Error en login:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Registro de usuario (opcional)
app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ 
                error: 'Usuario y contraseña son requeridos' 
            });
        }

        if (username.length < 3) {
            return res.status(400).json({ 
                error: 'El usuario debe tener al menos 3 caracteres' 
            });
        }

        if (password.length < 6) {
            return res.status(400).json({ 
                error: 'La contraseña debe tener al menos 6 caracteres' 
            });
        }

        const existingUser = users.find(u => u.username === username);
        if (existingUser) {
            return res.status(409).json({ 
                error: 'El usuario ya existe' 
            });
        }

        const newUser = {
            id: uuidv4(),
            username,
            password: await bcrypt.hash(password, 10),
            createdAt: new Date().toISOString()
        };

        users.push(newUser);
        saveUsers();

        res.status(201).json({
            success: true,
            message: 'Usuario registrado exitosamente',
            user: {
                id: newUser.id,
                username: newUser.username
            }
        });
    } catch (error) {
        console.error('Error en registro:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Verificar token
app.get('/api/auth/verify', authMiddleware, (req, res) => {
    res.json({
        success: true,
        user: {
            id: req.user.id,
            username: req.user.username
        }
    });
});

// ============================================
// API REST - MENSAJES
// ============================================

// Obtener historial de mensajes de una sala
app.get('/api/messages/:room', authMiddleware, (req, res) => {
    try {
        const { room } = req.params;
        const { limit = 50, before } = req.query;

        let roomMessages = messages.filter(m => m.room === room);

        // Filtrar mensajes antes de una fecha específica (para paginación)
        if (before) {
            roomMessages = roomMessages.filter(m => m.timestamp < before);
        }

        // Ordenar por fecha descendente y limitar
        roomMessages = roomMessages
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
            .slice(0, parseInt(limit))
            .reverse();

        res.json({
            success: true,
            room,
            messages: roomMessages,
            total: roomMessages.length
        });
    } catch (error) {
        console.error('Error obteniendo mensajes:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Obtener todas las salas disponibles
app.get('/api/rooms', authMiddleware, (req, res) => {
    try {
        const rooms = [...new Set(messages.map(m => m.room))];
        // Incluir salas predefinidas
        const defaultRooms = ['general', 'random', 'ayuda'];
        const allRooms = [...new Set([...defaultRooms, ...rooms])];

        res.json({
            success: true,
            rooms: allRooms
        });
    } catch (error) {
        console.error('Error obteniendo salas:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// ============================================
// WEBSOCKETS - CHAT EN TIEMPO REAL
// ============================================

// Middleware de autenticación para Socket.IO
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    
    if (!token) {
        return next(new Error('Autenticación requerida'));
    }

    const user = users.find(u => u.id === token);
    
    if (!user) {
        return next(new Error('Token inválido'));
    }

    socket.userId = user.id;
    socket.username = user.username;
    next();
});

io.on('connection', (socket) => {
    console.log(`🔌 Usuario conectado: ${socket.username} (${socket.id})`);

    // ========================================
    // EVENTOS DE SALA
    // ========================================

    // Unirse a una sala
    socket.on('join-room', (room) => {
        if (!room || typeof room !== 'string') {
            socket.emit('error', { message: 'Nombre de sala inválido' });
            return;
        }

        // Salir de la sala anterior si existe
        const currentRoom = connectedUsers.get(socket.id)?.room;
        if (currentRoom) {
            socket.leave(currentRoom);
            socket.to(currentRoom).emit('user-left', {
                username: socket.username,
                room: currentRoom,
                timestamp: new Date().toISOString()
            });
        }

        // Unirse a la nueva sala
        socket.join(room);
        connectedUsers.set(socket.id, {
            username: socket.username,
            room: room,
            connectedAt: new Date().toISOString()
        });

        console.log(`📍 ${socket.username} se unió a la sala: ${room}`);

        // Notificar al usuario que se unió
        socket.emit('joined-room', {
            room: room,
            username: socket.username,
            timestamp: new Date().toISOString()
        });

        // Notificar a otros usuarios en la sala
        socket.to(room).emit('user-joined', {
            username: socket.username,
            room: room,
            timestamp: new Date().toISOString()
        });

        // Enviar lista de usuarios en la sala
        const usersInRoom = getUsersInRoom(room);
        io.to(room).emit('users-in-room', {
            room: room,
            users: usersInRoom
        });

        // Enviar historial de mensajes al usuario
        const roomMessages = messages
            .filter(m => m.room === room)
            .slice(-50);
        socket.emit('message-history', {
            room: room,
            messages: roomMessages
        });
    });

    // Salir de una sala
    socket.on('leave-room', (room) => {
        socket.leave(room);
        
        const userData = connectedUsers.get(socket.id);
        if (userData) {
            userData.room = null;
            connectedUsers.set(socket.id, userData);
        }

        socket.to(room).emit('user-left', {
            username: socket.username,
            room: room,
            timestamp: new Date().toISOString()
        });

        // Actualizar lista de usuarios
        const usersInRoom = getUsersInRoom(room);
        io.to(room).emit('users-in-room', {
            room: room,
            users: usersInRoom
        });

        console.log(`📍 ${socket.username} salió de la sala: ${room}`);
    });

    // ========================================
    // EVENTOS DE MENSAJES
    // ========================================

    // Enviar mensaje
    socket.on('send-message', (data) => {
        try {
            const { room, content, type = 'text' } = data;

            if (!room || !content) {
                socket.emit('error', { message: 'Sala y contenido son requeridos' });
                return;
            }

            if (content.trim().length === 0) {
                socket.emit('error', { message: 'El mensaje no puede estar vacío' });
                return;
            }

            if (content.length > 2000) {
                socket.emit('error', { message: 'El mensaje es demasiado largo (máx 2000 caracteres)' });
                return;
            }

            // Verificar que el usuario está en la sala
            const userData = connectedUsers.get(socket.id);
            if (!userData || userData.room !== room) {
                socket.emit('error', { message: 'No estás en esta sala' });
                return;
            }

            const message = {
                id: uuidv4(),
                room: room,
                username: socket.username,
                userId: socket.userId,
                content: content.trim(),
                type: type,
                timestamp: new Date().toISOString()
            };

            // Guardar mensaje
            messages.push(message);
            saveMessages();

            // Enviar a todos en la sala (incluyendo al emisor)
            io.to(room).emit('new-message', message);

            console.log(`💬 [${room}] ${socket.username}: ${content.substring(0, 50)}...`);
        } catch (error) {
            console.error('Error enviando mensaje:', error);
            socket.emit('error', { message: 'Error al enviar el mensaje' });
        }
    });

    // Escribiendo...
    socket.on('typing', (data) => {
        const { room, isTyping } = data;
        socket.to(room).emit('user-typing', {
            username: socket.username,
            room: room,
            isTyping: isTyping
        });
    });

    // ========================================
    // EVENTOS PRIVADOS
    // ========================================

    // Enviar mensaje privado
    socket.on('private-message', (data) => {
        try {
            const { toUsername, content } = data;

            if (!toUsername || !content) {
                socket.emit('error', { message: 'Destinatario y contenido son requeridos' });
                return;
            }

            // Buscar socket del destinatario
            let targetSocket = null;
            for (const [socketId, userData] of connectedUsers.entries()) {
                if (userData.username === toUsername) {
                    targetSocket = io.sockets.sockets.get(socketId);
                    break;
                }
            }

            if (!targetSocket) {
                socket.emit('error', { message: 'Usuario no conectado' });
                return;
            }

            const message = {
                id: uuidv4(),
                type: 'private',
                from: socket.username,
                to: toUsername,
                content: content.trim(),
                timestamp: new Date().toISOString()
            };

            // Enviar al destinatario
            targetSocket.emit('private-message', message);
            
            // Confirmar al emisor
            socket.emit('private-message-sent', message);

        } catch (error) {
            console.error('Error en mensaje privado:', error);
            socket.emit('error', { message: 'Error al enviar mensaje privado' });
        }
    });

    // ========================================
    // DESCONEXIÓN
    // ========================================

    socket.on('disconnect', (reason) => {
        console.log(`🔌 Usuario desconectado: ${socket.username} (${reason})`);

        const userData = connectedUsers.get(socket.id);
        
        if (userData && userData.room) {
            // Notificar a la sala que el usuario se fue
            socket.to(userData.room).emit('user-left', {
                username: socket.username,
                room: userData.room,
                timestamp: new Date().toISOString()
            });

            // Actualizar lista de usuarios
            const usersInRoom = getUsersInRoom(userData.room);
            io.to(userData.room).emit('users-in-room', {
                room: userData.room,
                users: usersInRoom
            });
        }

        connectedUsers.delete(socket.id);
    });
});

// ============================================
// FUNCIONES AUXILIARES
// ============================================

function getUsersInRoom(room) {
    const usersInRoom = [];
    for (const [socketId, userData] of connectedUsers.entries()) {
        if (userData.room === room) {
            usersInRoom.push({
                username: userData.username,
                connectedAt: userData.connectedAt
            });
        }
    }
    return usersInRoom;
}

// ============================================
// INICIAR SERVIDOR
// ============================================

// Cargar datos al iniciar
loadUsers();
loadMessages();

server.listen(PORT, () => {
    console.log('='.repeat(50));
    console.log('🚀 Replica Chat Server iniciado');
    console.log('='.repeat(50));
    console.log(`📡 Puerto: ${PORT}`);
    console.log(`🌐 URL: http://localhost:${PORT}`);
    console.log('='.repeat(50));
    console.log('📋 Endpoints disponibles:');
    console.log(`   POST /api/auth/login    - Login de usuario`);
    console.log(`   POST /api/auth/register - Registro de usuario`);
    console.log(`   GET  /api/auth/verify   - Verificar token`);
    console.log(`   GET  /api/rooms         - Lista de salas`);
    console.log(`   GET  /api/messages/:room - Mensajes de una sala`);
    console.log('='.repeat(50));
});

// Manejo de errores no capturados
process.on('uncaughtException', (error) => {
    console.error('Error no capturado:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Promesa rechazada no manejada:', reason);
});

// Guardar datos al cerrar
process.on('SIGINT', () => {
    console.log('\n💾 Guardando datos...');
    saveUsers();
    saveMessages();
    console.log('👋 Servidor cerrado');
    process.exit(0);
});

module.exports = { app, server, io };
