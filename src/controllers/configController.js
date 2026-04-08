/**
 * Controlador de Configuración
 * Maneja CBU, canal URL y solicitudes de CBU de usuarios
 */
const { getConfig } = require('../../config/database');
const { Message } = require('../models');
const { v4: uuidv4 } = require('uuid');
const asyncHandler = require('../utils/asyncHandler');
const logger = require('../utils/logger');
const { checkCbuRateLimit } = require('../utils/locks');
const { connectedUsers } = require('../socket');

/**
 * GET /api/config/cbu
 */
const getCbu = asyncHandler(async (req, res) => {
  const cbuConfig = await getConfig('cbu');
  if (!cbuConfig) {
    return res.status(404).json({ error: 'CBU no configurado' });
  }
  res.json({
    number: cbuConfig.number,
    alias: cbuConfig.alias,
    bank: cbuConfig.bank,
    titular: cbuConfig.titular
  });
});

/**
 * GET /api/config/canal-url
 */
const getCanalUrl = asyncHandler(async (req, res) => {
  const url = await getConfig('canalInformativoUrl', '');
  res.json({ url: url || '' });
});

/**
 * POST /api/cbu/request
 * Usuario solicita datos de CBU para transferir
 */
const cbuRequest = asyncHandler(async (req, res) => {
  const userId = req.user.userId;

  if (!checkCbuRateLimit(userId)) {
    return res.status(429).json({
      success: false,
      error: 'Solicitaste CBU muy recientemente. Espera unos segundos antes de volver a intentar.'
    });
  }

  const cbuConfig = await getConfig('cbu');
  if (!cbuConfig) {
    return res.status(404).json({ error: 'CBU no configurado' });
  }

  // 1. Mensaje de solicitud del usuario
  await Message.create({
    id: uuidv4(),
    senderId: userId,
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
    receiverId: userId,
    receiverRole: 'user',
    content: fullMessage,
    type: 'text',
    timestamp: new Date(),
    read: false
  });

  // 3. CBU solo para copiar
  await Message.create({
    id: uuidv4(),
    senderId: 'system',
    senderUsername: 'Sistema',
    senderRole: 'admin',
    receiverId: userId,
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
});

/**
 * POST /api/admin/send-cbu
 * Admin envía CBU a un usuario
 */
const adminSendCbu = asyncHandler(async (req, res) => {
  const { userId } = req.body;
  const cbuConfig = await getConfig('cbu');

  if (!cbuConfig || !cbuConfig.number) {
    return res.status(400).json({ error: 'CBU no configurado' });
  }

  const timestamp = new Date();
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
    timestamp,
    read: false
  });

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

  // Notificar al usuario por socket si está conectado
  const userSocket = connectedUsers.get(userId);
  if (userSocket) {
    userSocket.emit('new_message', {
      senderId: req.user.userId,
      senderUsername: req.user.username,
      content: fullMessage,
      timestamp,
      type: 'text'
    });
    setTimeout(() => {
      userSocket.emit('new_message', {
        senderId: req.user.userId,
        senderUsername: req.user.username,
        content: cbuConfig.number,
        timestamp: new Date(),
        type: 'text'
      });
    }, 100);
  }

  logger.info(`Admin ${req.user.username} envió CBU a usuario ${userId}`);
  res.json({ success: true, message: 'CBU enviado' });
});

module.exports = { getCbu, getCanalUrl, cbuRequest, adminSendCbu };
