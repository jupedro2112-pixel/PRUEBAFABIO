
/**
 * Controlador de Administración
 * Maneja usuarios, configuraciones y operaciones de admin
 */
const { User, Config, Command, Transaction, Message, ChatStatus } = require('../models');
const { transactionService } = require('../services');
const asyncHandler = require('../utils/asyncHandler');
const { AppError, ErrorCodes } = require('../utils/AppError');
const logger = require('../utils/logger');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
// CORREGIDO: Importar conexiones de sockets para contador online real
const { connectedUsers } = require('../socket');

/**
 * GET /api/admin/users
 * Obtener todos los usuarios
 */
const getUsers = asyncHandler(async (req, res) => {
  const userRole = req.user.role;
  
  // Construir query según rol
  let query = {};
  if (userRole !== 'admin') {
    // Depositor y withdrawer solo ven usuarios (no admins)
    query.role = 'user';
  }
  
  const users = await User.find(query)
    .select('-password')
    .sort({ role: 1, username: 1 })
    .lean();
  
  res.json({
    status: 'success',
    data: { users }
  });
});

/**
 * GET /api/users/:userId
 * Obtener usuario específico
 */
const getUser = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  
  const user = await User.findOne({ id: userId }).select('-password').lean();
  
  if (!user) {
    throw new AppError('Usuario no encontrado', 404, ErrorCodes.USER_NOT_FOUND);
  }
  
  res.json({
    status: 'success',
    data: { user }
  });
});

/**
 * POST /api/admin/users
 * Crear nuevo usuario o admin
 */
const createUser = asyncHandler(async (req, res) => {
  const { username, password, email, phone, role = 'user' } = req.body;
  const adminRole = req.user.role;
  
  // Validar rol
  const validRoles = ['user', 'admin', 'depositor', 'withdrawer'];
  if (!validRoles.includes(role)) {
    throw new AppError('Rol inválido', 400, ErrorCodes.VALIDATION_ERROR);
  }
  
  // Restricciones de rol para crear usuarios
  if (adminRole !== 'admin' && role !== 'user') {
    throw new AppError(
      'Solo el administrador general puede crear otros administradores',
      403,
      ErrorCodes.AUTH_FORBIDDEN
    );
  }
  
  // Verificar si existe
  const existingUser = await User.findByUsername(username);
  if (existingUser) {
    throw new AppError('El usuario ya existe', 400, ErrorCodes.USER_ALREADY_EXISTS);
  }
  
  // Crear usuario
  const userId = uuidv4();
  const newUser = await User.create({
    id: userId,
    username: username.toLowerCase().trim(),
    password, // Se hashea automáticamente
    email: email || null,
    phone: phone || null,
    role,
    balance: 0,
    isActive: true,
    jugayganaSyncStatus: role === 'user' ? 'pending' : 'not_applicable'
  });
  
  logger.info(`Usuario creado por admin ${req.user.username}: ${username} (${role})`);
  
  res.status(201).json({
    status: 'success',
    data: {
      user: {
        id: newUser.id,
        username: newUser.username,
        email: newUser.email,
        role: newUser.role
      }
    }
  });
});

/**
 * PUT /api/users/:id
 * Actualizar usuario
 */
const updateUser = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  
  // No permitir actualizar password directamente
  delete updates.password;
  delete updates.id;
  
  const user = await User.findOneAndUpdate(
    { id },
    updates,
    { new: true }
  ).select('-password');
  
  if (!user) {
    throw new AppError('Usuario no encontrado', 404, ErrorCodes.USER_NOT_FOUND);
  }
  
  res.json({
    status: 'success',
    data: { user }
  });
});

/**
 * POST /api/admin/users/:id/reset-password
 * Resetear contraseña de usuario
 */
const resetPassword = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { newPassword } = req.body;
  
  if (!newPassword || newPassword.length < 6) {
    throw new AppError('La contraseña debe tener al menos 6 caracteres', 400, ErrorCodes.VALIDATION_ERROR);
  }
  
  const user = await User.findOne({ id });
  if (!user) {
    throw new AppError('Usuario no encontrado', 404, ErrorCodes.USER_NOT_FOUND);
  }
  
  await user.changePassword(newPassword);
  
  logger.info(`Contraseña reseteada por admin ${req.user.username} para ${user.username}`);
  
  res.json({
    status: 'success',
    message: `Contraseña de ${user.username} reseteada exitosamente`
  });
});

/**
 * DELETE /api/users/:id
 * Eliminar usuario
 */
const deleteUser = asyncHandler(async (req, res) => {
  const { id } = req.params;
  
  const userToDelete = await User.findOne({ id });
  if (!userToDelete) {
    throw new AppError('Usuario no encontrado', 404, ErrorCodes.USER_NOT_FOUND);
  }
  
  // Solo admin puede eliminar otros admins
  const adminRoles = ['admin', 'depositor', 'withdrawer'];
  if (adminRoles.includes(userToDelete.role) && req.user.role !== 'admin') {
    throw new AppError(
      'Solo los administradores pueden eliminar otros administradores',
      403,
      ErrorCodes.AUTH_FORBIDDEN
    );
  }
  
  await User.deleteOne({ id });
  
  logger.info(`Usuario eliminado por admin ${req.user.username}: ${userToDelete.username}`);
  
  res.json({
    status: 'success',
    message: 'Usuario eliminado exitosamente'
  });
});

/**
 * GET /api/admin/config
 * Obtener configuración del sistema
 */
const getConfig = asyncHandler(async (req, res) => {
  const cbu = await Config.get('cbu', {});
  const welcomeMessage = await Config.get('welcomeMessage', '🎉 ¡Bienvenido a la Sala de Juegos!');
  const depositMessage = await Config.get('depositMessage', '💰 ¡Fichas cargadas!');
  const canalInformativoUrl = await Config.get('canalInformativoUrl', '');
  
  res.json({
    status: 'success',
    data: {
      cbu,
      welcomeMessage,
      depositMessage,
      canalInformativoUrl
    }
  });
});

/**
 * POST /api/admin/canal-url
 * Actualizar URL del Canal Informativo
 */
const updateCanalUrl = asyncHandler(async (req, res) => {
  const { url } = req.body;
  
  // Permitir vaciar la URL
  const safeUrl = (url || '').trim();
  if (safeUrl) {
    try {
      const parsed = new URL(safeUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new AppError('URL inválida. Debe comenzar con http:// o https://', 400, ErrorCodes.VALIDATION_ERROR);
      }
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError('URL inválida. Verificá que sea una URL completa y válida.', 400, ErrorCodes.VALIDATION_ERROR);
    }
  }
  
  await Config.set('canalInformativoUrl', safeUrl, req.user.username);
  
  res.json({
    status: 'success',
    message: 'URL del Canal Informativo actualizada correctamente'
  });
});

/**
 * POST /api/admin/cbu
 * Actualizar CBU
 */
const updateCbu = asyncHandler(async (req, res) => {
  const { bank, titular, number, alias } = req.body;
  
  if (!number || number.length < 10) {
    throw new AppError('CBU inválido', 400, ErrorCodes.VALIDATION_ERROR);
  }
  
  await Config.set('cbu', { bank, titular, number, alias }, req.user.username);
  
  res.json({
    status: 'success',
    message: 'CBU actualizado correctamente'
  });
});

/**
 * GET /api/admin/commands
 * Obtener comandos
 */
const getCommands = asyncHandler(async (req, res) => {
  const commands = await Command.find().sort({ name: 1 }).lean();
  
  res.json({
    status: 'success',
    data: { commands }
  });
});

/**
 * POST /api/admin/commands
 * Crear/actualizar comando
 */
const createCommand = asyncHandler(async (req, res) => {
  const { name, description, response, type = 'message' } = req.body;
  
  if (!name || !name.startsWith('/')) {
    throw new AppError('El comando debe empezar con /', 400, ErrorCodes.VALIDATION_ERROR);
  }
  
  await Command.findOneAndUpdate(
    { name: name.toLowerCase() },
    {
      name: name.toLowerCase(),
      description: description || '',
      response: response || '',
      type,
      isActive: true,
      updatedAt: new Date()
    },
    { upsert: true, new: true }
  );
  
  res.json({
    status: 'success',
    message: 'Comando guardado correctamente'
  });
});

/**
 * DELETE /api/admin/commands/:name
 * Eliminar comando
 */
const deleteCommand = asyncHandler(async (req, res) => {
  const { name } = req.params;
  
  await Command.deleteOne({ name: name.toLowerCase() });
  
  res.json({
    status: 'success',
    message: 'Comando eliminado correctamente'
  });
});

/**
 * GET /api/admin/stats
 * Obtener estadísticas
 */
const getStats = asyncHandler(async (req, res) => {
  const [totalUsers, totalTransactions, todayTotals] = await Promise.all([
    User.countDocuments(),
    Transaction.countDocuments(),
    transactionService.getTodayTotals()
  ]);
  
  // CORREGIDO: usar contador real de sockets en lugar de lastLogin
  const onlineUsers = connectedUsers.size;
  
  res.json({
    status: 'success',
    data: {
      totalUsers,
      onlineUsers,
      connectedUsers: onlineUsers, // alias para compatibilidad
      totalTransactions,
      todayDeposits: todayTotals.deposits,
      todayWithdrawals: todayTotals.withdrawals
    }
  });
});

/**
 * GET /api/admin/transactions
 * Obtener transacciones
 */
const getTransactions = asyncHandler(async (req, res) => {
  const { from, to, type, username } = req.query;
  
  const result = await transactionService.getTransactions({ from, to, type, username });
  
  res.json({
    status: 'success',
    data: result
  });
});

/**
 * POST /api/admin/chats/:userId/category
 * Cambiar categoría de chat
 */
const changeChatCategory = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { category } = req.body;
  
  const { ChatStatus } = require('../models');
  
  await ChatStatus.findOneAndUpdate(
    { userId },
    { category },
    { upsert: true }
  );
  
  res.json({
    status: 'success',
    message: `Chat cambiado a ${category}`
  });
});

/**
 * POST /api/admin/send-to-payments
 * Enviar chat a pagos
 */
const sendToPayments = asyncHandler(async (req, res) => {
  const { userId } = req.body;
  
  const { ChatStatus } = require('../models');
  
  await ChatStatus.findOneAndUpdate(
    { userId },
    { category: 'pagos' },
    { upsert: true }
  );
  
  res.json({
    status: 'success',
    message: 'Chat enviado a pagos'
  });
});

/**
 * POST /api/admin/send-to-open
 * Enviar chat a abiertos
 */
const sendToOpen = asyncHandler(async (req, res) => {
  const { userId } = req.body;
  
  const { ChatStatus } = require('../models');
  
  await ChatStatus.findOneAndUpdate(
    { userId },
    { category: 'cargas' },
    { upsert: true }
  );
  
  res.json({
    status: 'success',
    message: 'Chat enviado a abiertos'
  });
});

/**
 * GET /api/admin/users/export/csv
 * Exportar todos los usuarios a CSV (solo admin)
 */
const exportUsersCSV = asyncHandler(async (req, res) => {
  // Audit log
  logger.info(`CSV export de usuarios solicitado por admin: ${req.user.username} (${req.user.userId})`);
  
  const userRole = req.user.role;
  // Depositor y withdrawer solo exportan usuarios regulares (no admins)
  const query = userRole !== 'admin' ? { role: 'user' } : {};
  const users = await User.find(query).select('-password').lean();
  
  const headers = ['id', 'username', 'email', 'phone', 'role', 'balance', 'accountNumber', 'status', 'createdAt', 'lastLogin'];
  const rows = users.map(u => [
    u.id || '',
    u.username || '',
    u.email || '',
    u.phone || '',
    u.role || '',
    u.balance || 0,
    u.accountNumber || '',
    u.status || '',
    u.createdAt ? new Date(u.createdAt).toISOString() : '',
    u.lastLogin ? new Date(u.lastLogin).toISOString() : ''
  ]);
  
  const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n');
  
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=usuarios_${new Date().toISOString().split('T')[0]}.csv`);
  res.send(csv);
});

// Variable para almacenar contraseña de base de datos (en producción usar variables de entorno)
const DB_PASSWORD = process.env.DB_PASSWORD || 'admin123';

/**
 * GET /api/admin/datos
 * Métricas de adquisición, actividad y recurrencia por período
 * Query params:
 *   period = today | yesterday | last7 | last30  (default: today)
 *   date   = YYYY-MM-DD  (día exacto en ART, tiene prioridad sobre period)
 */
const getDatos = asyncHandler(async (req, res) => {
  // Argentina es UTC-3 todo el año
  const ART_OFFSET_MS = 3 * 60 * 60 * 1000;

  let startUTC, endUTC, periodLabel, isSingleDay = true;

  if (req.query.date) {
    const [year, month, day] = req.query.date.split('-').map(Number);
    if (!year || !month || !day) {
      return res.status(400).json({ error: 'Formato de fecha inválido. Use YYYY-MM-DD.' });
    }
    startUTC    = new Date(Date.UTC(year, month - 1, day, 3, 0, 0, 0));
    endUTC      = new Date(startUTC.getTime() + 24 * 60 * 60 * 1000 - 1);
    periodLabel = req.query.date;
  } else {
    const period = req.query.period || 'today';
    const nowUTC = Date.now();
    const todayART = new Date(nowUTC - ART_OFFSET_MS);
    todayART.setUTCHours(0, 0, 0, 0);
    const todayStartUTC = new Date(todayART.getTime() + ART_OFFSET_MS);

    if (period === 'yesterday') {
      startUTC    = new Date(todayStartUTC.getTime() - 24 * 60 * 60 * 1000);
      endUTC      = new Date(todayStartUTC.getTime() - 1);
      periodLabel = 'Ayer';
    } else if (period === 'last7') {
      startUTC    = new Date(todayStartUTC.getTime() - 6 * 24 * 60 * 60 * 1000);
      endUTC      = new Date(todayStartUTC.getTime() + 24 * 60 * 60 * 1000 - 1);
      periodLabel = 'Últimos 7 días';
      isSingleDay = false;
    } else if (period === 'last30') {
      startUTC    = new Date(todayStartUTC.getTime() - 29 * 24 * 60 * 60 * 1000);
      endUTC      = new Date(todayStartUTC.getTime() + 24 * 60 * 60 * 1000 - 1);
      periodLabel = 'Últimos 30 días';
      isSingleDay = false;
    } else {
      startUTC    = todayStartUTC;
      endUTC      = new Date(todayStartUTC.getTime() + 24 * 60 * 60 * 1000 - 1);
      periodLabel = 'Hoy';
    }
  }

  const [registeredCount, depositStats, neverDepositedResult] = await Promise.all([
    // Bloque A: usuarios role:'user' creados en el período
    User.countDocuments({ createdAt: { $gte: startUTC, $lte: endUTC }, role: 'user' }),

    // Bloques B + C + D: análisis completo de depósitos
    Transaction.aggregate([
      { $match: { type: 'deposit', timestamp: { $gte: startUTC, $lte: endUTC } } },
      { $group: {
        _id: '$username',
        periodDepositCount:  { $sum: 1 },
        periodDepositAmount: { $sum: '$amount' }
      }},
      { $lookup: {
        from: 'transactions',
        let: { uname: '$_id' },
        pipeline: [
          { $match: { $expr: { $and: [
            { $eq: ['$type', 'deposit'] },
            { $eq: ['$username', '$$uname'] },
            { $lt: ['$timestamp', startUTC] }
          ]}}}
        ],
        as: 'priorDeposits'
      }},
      { $addFields: {
        isFirstTime: { $eq: [{ $size: '$priorDeposits' }, 0] },
        hasMultiple: { $gte: ['$periodDepositCount', 2] }
      }},
      { $group: {
        _id:                  null,
        totalDeposits:        { $sum: '$periodDepositCount' },
        totalAmount:          { $sum: '$periodDepositAmount' },
        uniqueDepositors:     { $sum: 1 },
        firstTimeDeposits:    { $sum: { $cond: ['$isFirstTime', '$periodDepositCount', 0] } },
        firstTimeAmount:      { $sum: { $cond: ['$isFirstTime', '$periodDepositAmount', 0] } },
        firstTimeUsers:       { $sum: { $cond: ['$isFirstTime', 1, 0] } },
        returningDeposits:    { $sum: { $cond: ['$isFirstTime', 0, '$periodDepositCount'] } },
        returningAmount:      { $sum: { $cond: ['$isFirstTime', 0, '$periodDepositAmount'] } },
        returningUsers:       { $sum: { $cond: ['$isFirstTime', 0, 1] } },
        multipleDepositUsers: { $sum: { $cond: ['$hasMultiple', 1, 0] } }
      }}
    ]),

    // Bloque A: usuarios registrados en el período que NUNCA han depositado
    User.aggregate([
      { $match: { createdAt: { $gte: startUTC, $lte: endUTC }, role: 'user' } },
      { $lookup: {
        from: 'transactions',
        let: { uname: '$username' },
        pipeline: [
          { $match: { $expr: { $and: [
            { $eq: ['$type', 'deposit'] },
            { $eq: ['$username', '$$uname'] }
          ]}}}
        ],
        as: 'allDeposits'
      }},
      { $match: { allDeposits: { $size: 0 } } },
      { $count: 'total' }
    ])
  ]);

  const ds = depositStats[0] || {
    totalDeposits: 0, totalAmount: 0, uniqueDepositors: 0,
    firstTimeDeposits: 0, firstTimeAmount: 0, firstTimeUsers: 0,
    returningDeposits: 0, returningAmount: 0, returningUsers: 0,
    multipleDepositUsers: 0
  };
  const neverDeposited = neverDepositedResult[0] ? neverDepositedResult[0].total : 0;

  const conversionRate   = registeredCount > 0     ? Math.round((ds.firstTimeUsers        / registeredCount)     * 1000) / 10 : null;
  const depositFrequency = ds.uniqueDepositors > 0 ? Math.round((ds.totalDeposits          / ds.uniqueDepositors) * 100)  / 100 : null;
  const avgTicket        = ds.totalDeposits > 0    ? Math.round( ds.totalAmount             / ds.totalDeposits)              : null;
  const avgPerDepositor  = ds.uniqueDepositors > 0 ? Math.round( ds.totalAmount             / ds.uniqueDepositors)           : null;
  const returningPct     = ds.uniqueDepositors > 0 ? Math.round((ds.returningUsers          / ds.uniqueDepositors) * 1000) / 10 : null;
  const repeatRate       = ds.uniqueDepositors > 0 ? Math.round((ds.multipleDepositUsers    / ds.uniqueDepositors) * 1000) / 10 : null;

  res.json({
    status: 'success',
    data: {
      period: { label: periodLabel, startUTC, endUTC, isSingleDay },

      acquisition: {
        registeredUsers:          registeredCount,
        firstDepositUsers:        ds.firstTimeUsers,
        conversionRate,
        registeredNeverDeposited: neverDeposited
      },

      depositActivity: {
        totalDeposits:          ds.totalDeposits,
        uniqueDepositors:       ds.uniqueDepositors,
        firstTimeDeposits:      ds.firstTimeDeposits,
        firstTimeDepositUsers:  ds.firstTimeUsers,
        returningDeposits:      ds.returningDeposits,
        returningDepositUsers:  ds.returningUsers,
        depositFrequency
      },

      economicQuality: {
        totalAmount:     ds.totalAmount,
        avgTicket,
        avgPerDepositor,
        firstTimeAmount: ds.firstTimeAmount,
        returningAmount: ds.returningAmount
      },

      recurrence: {
        activeReturningUsers: ds.returningUsers,
        returningPct,
        multipleDepositUsers: ds.multipleDepositUsers,
        repeatRate
      }
    }
  });
});

/**
 * POST /api/admin/database/verify
 * Verificar acceso a base de datos
 */
const verifyDatabaseAccess = asyncHandler(async (req, res) => {
  const { dbPassword } = req.body;
  
  if (dbPassword !== DB_PASSWORD) {
    throw new AppError('Contraseña incorrecta', 401, ErrorCodes.AUTH_INVALID_CREDENTIALS);
  }
  
  res.json({
    status: 'success',
    message: 'Acceso concedido'
  });
});

/**
 * GET /api/admin/database/export/csv
 * Exportar base de datos a CSV
 */
const exportDatabaseCSV = asyncHandler(async (req, res) => {
  const password = req.query.dbPassword;
  
  if (password !== DB_PASSWORD) {
    throw new AppError('Contraseña incorrecta', 401, ErrorCodes.AUTH_INVALID_CREDENTIALS);
  }
  
  const users = await User.find().select('-password').lean();
  
  // Crear CSV
  const headers = ['ID', 'Username', 'Email', 'Phone', 'Role', 'Balance', 'AccountNumber', 'CreatedAt', 'LastLogin'];
  const rows = users.map(u => [
    u.id,
    u.username,
    u.email || '',
    u.phone || '',
    u.role,
    u.balance || 0,
    u.accountNumber || '',
    u.createdAt ? new Date(u.createdAt).toISOString() : '',
    u.lastLogin ? new Date(u.lastLogin).toISOString() : ''
  ]);
  
  const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n');
  
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=usuarios.csv');
  res.send(csv);
});

/**
 * GET /api/admin/balance/:username
 * Obtener balance de usuario desde JUGAYGANA (solo admin)
 */
const getAdminBalance = asyncHandler(async (req, res) => {
  const { username } = req.params;
  const { jugayganaService } = require('../services');
  const result = await jugayganaService.getBalance(username);

  if (result.success) {
    res.json({ balance: result.balance });
  } else {
    res.status(400).json({ error: result.error });
  }
});

/**
 * POST /api/admin/change-password
 * Cambiar contraseña de un usuario (admin)
 */
const changePassword = asyncHandler(async (req, res) => {
  const { userId, newPassword } = req.body;
  const adminRole = req.user.role;

  if (!userId || !newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'Datos inválidos. La contraseña debe tener al menos 6 caracteres.' });
  }

  const user = await User.findOne({ id: userId });
  if (!user) {
    throw new AppError('Usuario no encontrado', 404, ErrorCodes.USER_NOT_FOUND);
  }

  if (adminRole === 'withdrawer') {
    return res.status(403).json({ error: 'No tienes permiso para cambiar contraseñas' });
  }

  if (adminRole === 'depositor' && user.role !== 'user') {
    return res.status(403).json({ error: 'Solo puedes cambiar contraseñas de usuarios, no de administradores' });
  }

  user.password = await bcrypt.hash(newPassword, 10);
  user.passwordChangedAt = new Date();
  await user.save();

  await Message.create({
    id: require('uuid').v4(),
    senderId: req.user.userId,
    senderUsername: req.user.username,
    senderRole: 'admin',
    receiverId: userId,
    receiverRole: 'user',
    content: `🔑 Tu contraseña ha sido cambiada por un administrador.\n\nTu nueva contraseña es: ${newPassword}\n\nPor seguridad, te recomendamos cambiarla después de iniciar sesión.`,
    type: 'text',
    timestamp: new Date(),
    read: false
  });

  const userSocket = connectedUsers.get(userId);
  if (userSocket) {
    userSocket.emit('new_message', {
      senderId: req.user.userId,
      senderUsername: req.user.username,
      content: 'Tu contraseña ha sido cambiada por un administrador.',
      timestamp: new Date()
    });
  }

  res.json({ success: true, message: 'Contraseña cambiada correctamente' });
});

/**
 * POST /api/admin/close-chat
 * Cerrar chat de un usuario (admin)
 */
const closeChat = asyncHandler(async (req, res) => {
  const { userId, isPaymentsTab = false } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'Usuario no especificado' });
  }

  await ChatStatus.findOneAndUpdate(
    { userId },
    {
      status: 'closed',
      assignedTo: null,
      closedAt: new Date(),
      closedBy: req.user.userId,
      updatedAt: new Date()
    },
    { upsert: true }
  );

  await Message.create({
    id: require('uuid').v4(),
    senderId: req.user.userId,
    senderUsername: req.user.username,
    senderRole: req.user.role || 'admin',
    receiverId: userId,
    receiverRole: 'user',
    content: `Chat cerrado por: ${req.user.username}. Puedes seguir respondiendo si el usuario escribe. El chat se reabrirá automáticamente si el cliente envía un mensaje.`,
    type: 'system',
    adminOnly: true,
    read: true,
    timestamp: new Date()
  });

  // Notify admins
  const { getIo } = require('../utils/ioSingleton');
  const io = getIo();
  if (io) {
    io.to('admins').emit('chat_closed', { userId, by: req.user.username, adminId: req.user.userId, isPaymentsTab });
  }

  res.json({ success: true, message: 'Chat cerrado correctamente', closedBy: req.user.username });
});

/**
 * GET /api/admin/database/users
 * Obtener todos los usuarios de la base de datos (requiere db password)
 */
const getDatabaseUsers = asyncHandler(async (req, res) => {
  const userRole = req.user.role;
  const query = userRole !== 'admin' ? { role: 'user' } : {};
  const users = await User.find(query).select('-password').sort({ role: 1, username: 1 }).lean();
  res.json({ users, total: users.length });
});

/**
 * POST /api/admin/send-notification
 * Enviar notificación push a un usuario vía socket
 */
const sendNotification = asyncHandler(async (req, res) => {
  const { userId, title, body, icon, badge, tag, requireInteraction, data } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'userId requerido' });
  }

  const notificationPayload = {
    title: title || 'Nueva notificación',
    body: body || '',
    icon: icon || '/icons/icon-192x192.png',
    badge: badge || '/icons/icon-72x72.png',
    tag: tag || 'default',
    requireInteraction: requireInteraction || false,
    data: data || {}
  };

  const userSocket = connectedUsers.get(userId);
  if (userSocket) {
    userSocket.emit('push_notification', notificationPayload);
  }

  // Also emit to user room via io
  const { getIo } = require('../utils/ioSingleton');
  const io = getIo();
  if (io) {
    io.to(`user_${userId}`).emit('push_notification', notificationPayload);
  }

  logger.info(`Notificación enviada a usuario ${userId}: ${title}`);
  res.json({ success: true, message: 'Notificación enviada' });
});

module.exports = {
  getUsers,
  getUser,
  createUser,
  updateUser,
  resetPassword,
  deleteUser,
  getConfig,
  updateCbu,
  updateCanalUrl,
  getCommands,
  createCommand,
  deleteCommand,
  getStats,
  getTransactions,
  changeChatCategory,
  sendToPayments,
  sendToOpen,
  exportUsersCSV,
  verifyDatabaseAccess,
  exportDatabaseCSV,
  getDatos,
  getAdminBalance,
  changePassword,
  closeChat,
  getDatabaseUsers,
  sendNotification
};