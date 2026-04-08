/**
 * Socket.IO Handler
 * Maneja la comunicación en tiempo real usando el patrón 'authenticate' event
 * que espera el frontend.
 */
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { Message, User, Command, ChatStatus } = require('../models');
const logger = require('../utils/logger');

const connectedUsers = new Map();
const connectedAdmins = new Map();

function notifyAdmins(io, event, data) {
  io.to('admins').emit(event, data);
}

async function broadcastStats(io) {
  try {
    const totalUsers = await User.countDocuments({ role: 'user' });
    const stats = {
      connectedUsers: connectedUsers.size,
      connectedAdmins: connectedAdmins.size,
      totalUsers
    };
    connectedAdmins.forEach((socket) => {
      socket.emit('stats', stats);
    });
  } catch (err) {
    logger.error('Error broadcasting stats: ' + err.message);
  }
}

const ADMIN_ROLES = ['admin', 'depositor', 'withdrawer'];

function setupSocket(io, JWT_SECRET) {
  io.on('connection', (socket) => {
    logger.debug(`New socket connection: ${socket.id}`);

    socket.on('authenticate', (token) => {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        socket.userId = decoded.userId;
        socket.username = decoded.username;
        socket.role = decoded.role;

        if (ADMIN_ROLES.includes(decoded.role)) {
          connectedAdmins.set(decoded.userId, socket);
          socket.join('admins');
          logger.info(`Admin connected: ${decoded.username} (${decoded.role}) socket=${socket.id}`);
          broadcastStats(io);
        } else {
          connectedUsers.set(decoded.userId, socket);
          socket.join(`user_${decoded.userId}`);
          logger.info(`User connected: ${decoded.username} id=${decoded.userId} socket=${socket.id}`);
          notifyAdmins(io, 'user_connected', { userId: decoded.userId, username: decoded.username });
        }

        socket.emit('authenticated', { success: true, role: decoded.role });
      } catch (error) {
        logger.error(`Socket auth error: ${error.message}`);
        socket.emit('authenticated', { success: false, error: 'Token inválido' });
      }
    });

    socket.on('join_admin_room', () => {
      if (ADMIN_ROLES.includes(socket.role)) {
        socket.join('admins');
        logger.debug(`Admin ${socket.username} (${socket.role}) joined admin room`);
      }
    });

    socket.on('join_user_room', (data) => {
      if (socket.role === 'user' && data && data.userId) {
        socket.join(`user_${data.userId}`);
        logger.debug(`User ${socket.username} joined personal room: user_${data.userId}`);
      }
    });

    socket.on('join_chat_room', (data) => {
      if (ADMIN_ROLES.includes(socket.role) && data && data.userId) {
        socket.join(`chat_${data.userId}`);
        logger.debug(`Admin ${socket.username} joined chat room: chat_${data.userId}`);
      }
    });

    socket.on('leave_chat_room', (data) => {
      if (data && data.userId) {
        socket.leave(`chat_${data.userId}`);
        logger.debug(`${socket.username} left chat room: chat_${data.userId}`);
      }
    });

    socket.on('send_message', async (data) => {
      try {
        const { content, type = 'text', receiverId } = data;

        if (!socket.userId) {
          return socket.emit('error', { message: 'No autenticado' });
        }

        const isAdminRole = ADMIN_ROLES.includes(socket.role);
        const targetReceiverId = isAdminRole ? receiverId : 'admin';
        const targetReceiverRole = isAdminRole ? 'user' : 'admin';

        if (!isAdminRole && content && content.trim().startsWith('/')) {
          return socket.emit('error', { message: 'Los usuarios no pueden enviar comandos' });
        }

        if (isAdminRole && content && content.trim().startsWith('/')) {
          try {
            const command = await Command.findOne({ name: commandName, isActive: true });
            const commandReceiverId = isAdminRole ? receiverId : socket.userId;

            if (command) {
              await Command.updateOne({ name: commandName }, { $inc: { usageCount: 1 }, updatedAt: new Date() });

              const responseMessage = await Message.create({
                id: uuidv4(),
                senderId: 'system',
                senderUsername: 'Sistema',
                senderRole: 'system',
                receiverId: commandReceiverId,
                receiverRole: 'user',
                content: command.response,
                type: 'system',
                timestamp: new Date(),
                read: false
              });

              io.to(`user_${commandReceiverId}`).emit('new_message', responseMessage);
              io.to(`chat_${commandReceiverId}`).emit('new_message', responseMessage);
              notifyAdmins(io, 'new_message', { message: responseMessage, userId: commandReceiverId, username: socket.username });
              notifyAdmins(io, 'command_used', { userId: socket.userId, username: socket.username, command: commandName });
              return;
            } else {
              const notFoundMessage = await Message.create({
                id: uuidv4(),
                senderId: 'system',
                senderUsername: 'Sistema',
                senderRole: 'system',
                receiverId: commandReceiverId,
                receiverRole: 'user',
                content: `❓ Comando "${commandName}" no encontrado.`,
                type: 'system',
                timestamp: new Date(),
                read: false
              });
              io.to(`user_${commandReceiverId}`).emit('new_message', notFoundMessage);
              io.to(`chat_${commandReceiverId}`).emit('new_message', notFoundMessage);
              return;
            }
          } catch (cmdError) {
            logger.error(`[COMMAND] Error processing command: ${cmdError.message}`);
            return;
          }
        }

        const messageData = {
          id: uuidv4(),
          senderId: socket.userId,
          senderUsername: socket.username,
          senderRole: socket.role,
          receiverId: targetReceiverId,
          receiverRole: targetReceiverRole,
          content,
          type,
          timestamp: new Date(),
          read: false
        };

        const message = await Message.create(messageData);

        const targetUserId = isAdminRole ? receiverId : socket.userId;
        if (targetUserId) {
          const user = await User.findOne({ id: targetUserId });
          const updateData = {
            userId: targetUserId,
            username: user ? user.username : socket.username,
            lastMessageAt: new Date()
          };
          await ChatStatus.findOneAndUpdate({ userId: targetUserId }, updateData, { upsert: true });

          if (!isAdminRole) {
            await ChatStatus.findOneAndUpdate(
              { userId: targetUserId, status: 'closed' },
              { status: 'open', closedAt: null, closedBy: null }
            );
          }
        }

        if (!isAdminRole) {
          io.to('admins').emit('new_message', { message, userId: socket.userId, username: socket.username });
          io.to(`chat_${socket.userId}`).emit('new_message', message);
          socket.emit('message_sent', message);
          io.to(`user_${socket.userId}`).emit('new_message', message);
        } else {
          const userSocket = connectedUsers.get(receiverId);
          if (userSocket) {
            userSocket.emit('new_message', message);
          }
          io.to(`user_${receiverId}`).emit('new_message', message);
          io.to(`chat_${receiverId}`).emit('new_message', message);
          notifyAdmins(io, 'new_message', { message, userId: receiverId, username: socket.username });
          socket.emit('message_sent', message);
        }

        broadcastStats(io);
      } catch (error) {
        logger.error(`Error sending message via socket: ${error.message}`);
        if (error.name === 'ValidationError') {
          socket.emit('error', { message: 'Error de validación: ' + Object.values(error.errors).map(e => e.message).join(', ') });
        } else {
          socket.emit('error', { message: 'Error enviando mensaje: ' + error.message });
        }
      }
    });

    socket.on('typing', (data) => {
      if (socket.role === 'user') {
        notifyAdmins(io, 'user_typing', { userId: socket.userId, username: socket.username, isTyping: data.isTyping });
      } else {
        const userSocket = connectedUsers.get(data.receiverId);
        if (userSocket) {
          userSocket.emit('admin_typing', { adminId: socket.userId, adminName: socket.username, isTyping: data.isTyping });
        }
      }
    });

    socket.on('stop_typing', (data) => {
      if (socket.role === 'user') {
        notifyAdmins(io, 'user_stop_typing', { userId: socket.userId, username: socket.username });
      } else {
        const userSocket = connectedUsers.get(data ? data.receiverId : undefined);
        if (userSocket) {
          userSocket.emit('admin_stop_typing', { adminId: socket.userId, adminName: socket.username });
        }
      }
    });

    socket.on('disconnect', () => {
      if (['admin', 'depositor', 'withdrawer'].includes(socket.role)) {
        connectedAdmins.delete(socket.userId);
        broadcastStats(io);
      } else {
        connectedUsers.delete(socket.userId);
        notifyAdmins(io, 'user_disconnected', { userId: socket.userId, username: socket.username });
      }
    });
  });
}

module.exports = { setupSocket, connectedUsers, connectedAdmins, notifyAdmins, broadcastStats };
