/**
 * Controlador de Diagnóstico
 * Endpoints de diagnóstico para verificar estado del sistema
 */
const mongoose = require('mongoose');
const { Message } = require('../models');
const { v4: uuidv4 } = require('uuid');
const asyncHandler = require('../utils/asyncHandler');

/**
 * GET /api/diagnostic/public
 * Diagnóstico público - verifica conexión y creación de mensajes
 */
const publicDiagnostic = asyncHandler(async (req, res) => {
  const mongoState = mongoose.connection.readyState;

  if (mongoState !== 1) {
    return res.status(500).json({
      success: false,
      error: 'MongoDB no está conectado',
      mongodbState: mongoState
    });
  }

  const testMessageData = {
    id: uuidv4(),
    senderId: 'diagnostic-test',
    senderUsername: 'diagnostic',
    senderRole: 'admin',
    receiverId: 'test-user',
    receiverRole: 'user',
    content: 'Test message - ' + new Date().toISOString(),
    type: 'text',
    timestamp: new Date(),
    read: false
  };

  let createdMessage;
  try {
    createdMessage = await Message.create(testMessageData);
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message,
      errorName: err.name,
      errorCode: err.code,
      mongodbState: mongoState
    });
  }

  const verifyMessage = await Message.findOne({ id: createdMessage.id }).lean();
  const totalMessages = await Message.countDocuments();

  res.json({
    success: true,
    message: 'Diagnóstico completado',
    mongodbState: mongoState,
    mongodbConnected: true,
    totalMessages,
    testMessageCreated: {
      id: createdMessage.id,
      content: createdMessage.content,
      timestamp: createdMessage.timestamp
    },
    verified: !!verifyMessage
  });
});

/**
 * POST /api/diagnostic/test-message
 * Crear mensaje de prueba (requiere auth admin)
 */
const testMessage = asyncHandler(async (req, res) => {
  const testMessageData = {
    id: uuidv4(),
    senderId: 'test-admin-id',
    senderUsername: 'test-admin',
    senderRole: 'admin',
    receiverId: 'test-user-id',
    receiverRole: 'user',
    content: 'Mensaje de prueba - ' + new Date().toISOString(),
    type: 'text',
    timestamp: new Date(),
    read: false
  };

  const createdMessage = await Message.create(testMessageData);
  const verifyMessage = await Message.findOne({ id: createdMessage.id }).lean();

  res.json({
    success: true,
    message: 'Mensaje de prueba creado',
    createdMessage: {
      id: createdMessage.id,
      content: createdMessage.content,
      timestamp: createdMessage.timestamp
    },
    verified: !!verifyMessage,
    mongodbState: mongoose.connection.readyState
  });
});

/**
 * GET /api/diagnostic/messages
 * Estadísticas de mensajes (requiere auth admin)
 */
const diagnosticMessages = asyncHandler(async (req, res) => {
  const totalMessages = await Message.countDocuments();
  const recentMessages = await Message.find().sort({ timestamp: -1 }).limit(5).lean();
  const messageStats = await Message.aggregate([
    { $group: { _id: '$senderRole', count: { $sum: 1 } } }
  ]);

  res.json({
    totalMessages,
    recentMessages: recentMessages.map(m => ({
      id: m.id,
      senderId: m.senderId,
      senderRole: m.senderRole,
      receiverId: m.receiverId,
      content: m.content.substring(0, 50),
      timestamp: m.timestamp
    })),
    statsByRole: messageStats,
    mongodbConnected: mongoose.connection.readyState === 1,
    timestamp: new Date().toISOString()
  });
});

module.exports = { publicDiagnostic, testMessage, diagnosticMessages };
