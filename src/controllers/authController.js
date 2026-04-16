
/**
 * Controlador de Autenticación
 * Maneja endpoints de login, registro y gestión de sesiones
 */
const authService = require('../services/authService');
const asyncHandler = require('../utils/asyncHandler');
const { AppError, ErrorCodes } = require('../utils/AppError');
const logger = require('../utils/logger');
const { generateAndSendOTP, verifyOTP } = require('../services/otpService');
const { normalizePhone, validateInternationalPhone } = require('../middlewares/security');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

/**
 * POST /api/auth/register
 * Registrar nuevo usuario (requiere otpCode verificado previamente)
 */
const register = asyncHandler(async (req, res) => {
  const result = await authService.register(req.body);
  
  res.status(201).json({
    status: 'success',
    data: result
  });
});

/**
 * POST /api/auth/login
 * Iniciar sesión
 */
const login = asyncHandler(async (req, res) => {
  const result = await authService.login(req.body);
  
  res.json({
    status: 'success',
    data: result
  });
});

/**
 * POST /api/auth/logout
 * Cerrar sesión
 */
const logout = asyncHandler(async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  await authService.logout(token);
  
  res.json({
    status: 'success',
    message: 'Sesión cerrada exitosamente'
  });
});

/**
 * GET /api/auth/verify
 * Verificar token y obtener información del usuario
 */
const verify = asyncHandler(async (req, res) => {
  const user = await authService.getCurrentUser(req.user.userId);
  
  res.json({
    status: 'success',
    data: { user }
  });
});

/**
 * POST /api/auth/change-password
 * Cambiar contraseña
 */
const changePassword = asyncHandler(async (req, res) => {
  const { newPassword, closeAllSessions } = req.body;
  
  const result = await authService.changePassword(
    req.user.userId,
    newPassword,
    { closeAllSessions }
  );
  
  res.json({
    status: 'success',
    data: result
  });
});

/**
 * POST /api/auth/refresh-token
 * Refrescar tokens
 */
const refreshToken = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  
  if (!refreshToken) {
    throw new AppError('Refresh token requerido', 400, ErrorCodes.AUTH_TOKEN_INVALID);
  }
  
  // Implementar lógica de refresh token
  // Por ahora, generamos nuevos tokens
  const { generateTokenPair } = require('../middlewares/auth');
  const { User } = require('../models');
  
  const user = await User.findOne({ id: req.user?.userId });
  if (!user) {
    throw new AppError('Usuario no encontrado', 404, ErrorCodes.USER_NOT_FOUND);
  }
  
  const tokens = generateTokenPair(user);
  
  res.json({
    status: 'success',
    data: tokens
  });
});

/**
 * GET /api/auth/check-username
 * Verificar disponibilidad de username
 */
const checkUsername = asyncHandler(async (req, res) => {
  const { username } = req.query;
  
  if (!username || username.length < 3) {
    return res.json({
      status: 'success',
      data: { available: false, message: 'Usuario muy corto' }
    });
  }
  
  const { User } = require('../models');
  const { jugayganaService } = require('../services');
  
  // Verificar localmente
  const localExists = await User.findByUsername(username);
  if (localExists) {
    return res.json({
      status: 'success',
      data: { available: false, message: 'Usuario ya registrado' }
    });
  }
  
  // Verificar en JUGAYGANA
  try {
    const jgUser = await jugayganaService.getUserInfo(username);
    if (jgUser) {
      return res.json({
        status: 'success',
        data: {
          available: false,
          message: 'Este nombre de usuario ya está en uso en JUGAYGANA',
          existsInJugaygana: true
        }
      });
    }
  } catch (error) {
    logger.warn('No se pudo verificar en JUGAYGANA:', error.message);
  }
  
  res.json({
    status: 'success',
    data: { available: true, message: 'Usuario disponible' }
  });
});

/**
 * POST /api/auth/platform-login
 * Obtener token de JUGAYGANA para auto-login en la plataforma.
 * Fallback para cuando el token del login inicial ya expiró.
 */
const platformLogin = asyncHandler(async (req, res) => {
  const { password } = req.body;
  if (!password) {
    throw new AppError('Contraseña requerida', 400, ErrorCodes.VALIDATION_ERROR);
  }

  const { User } = require('../models');
  const { jugayganaService } = require('../services');

  const user = await User.findOne({ id: req.user.userId });
  if (!user) {
    throw new AppError('Usuario no encontrado', 404, ErrorCodes.USER_NOT_FOUND);
  }

  const isValidPassword = await user.comparePassword(password);
  if (!isValidPassword) {
    throw new AppError('Contraseña incorrecta', 401, ErrorCodes.AUTH_INVALID_CREDENTIALS);
  }

  const jgLogin = await jugayganaService.loginAsUser(user.username, password);
  if (!jgLogin.success) {
    throw new AppError(
      `No se pudo iniciar sesión en la plataforma: ${jgLogin.error}`,
      502,
      'JUGAYGANA_LOGIN_FAILED'
    );
  }

  res.json({
    status: 'success',
    data: {
      jugayganaToken: jgLogin.token,
      platformUrl: 'https://www.jugaygana44.bet'
    }
  });
});

/**
 * POST /api/auth/send-register-otp
 * Envía OTP al teléfono para verificar el número antes del registro.
 * Valida que username y phone no estén tomados.
 */
const sendRegisterOtp = asyncHandler(async (req, res) => {
  const { phone, username } = req.body;

  if (!phone || typeof phone !== 'string') {
    throw new AppError('Número de teléfono requerido', 400, ErrorCodes.VALIDATION_ERROR);
  }

  const normalizedPhone = phone.trim();
  if (!validateInternationalPhone(normalizedPhone)) {
    throw new AppError(
      'Número de teléfono inválido. Usa formato internacional con código de país (ej: +5491155551234)',
      400,
      ErrorCodes.VALIDATION_ERROR
    );
  }

  // Validar username si fue proporcionado
  if (username) {
    const { User } = require('../models');
    const existing = await User.findOne({
      username: { $regex: new RegExp('^' + username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') }
    }).lean();
    if (existing) {
      throw new AppError('El nombre de usuario ya está en uso', 400, ErrorCodes.VALIDATION_ERROR);
    }
  }

  // Verificar que el teléfono no esté ya registrado y verificado
  const { User } = require('../models');
  const existingPhone = await User.findOne({ phone: normalizedPhone, phoneVerified: true }).lean();
  if (existingPhone) {
    throw new AppError('Este número de teléfono ya está registrado', 400, ErrorCodes.VALIDATION_ERROR);
  }

  const result = await generateAndSendOTP(normalizedPhone, 'register');

  if (!result.success) {
    throw new AppError(result.error, 429, 'OTP_RATE_LIMIT');
  }

  // Mostrar código de país + últimos 4 dígitos, ocultar el resto
  const maskedPhone = normalizedPhone.replace(/(\+\d{1,4})\d+(\d{4})$/, '$1****$2');

  res.json({
    success: true,
    pendingVerification: true,
    phone: maskedPhone,
    message: 'Te enviamos un código SMS al número indicado'
  });
});

/**
 * POST /api/auth/request-password-reset
 * Solicita reset de contraseña por SMS (anti-enumeration).
 * SIEMPRE responde igual, independientemente de si el número existe o no.
 */
const requestPasswordReset = asyncHandler(async (req, res) => {
  const ANTI_ENUM_MESSAGE = 'Si este número está vinculado a una cuenta, recibirás un código SMS en los próximos segundos. Si no recibís ningún código, significa que este número no está asociado a ninguna cuenta.';

  const { phone } = req.body;

  if (phone && typeof phone === 'string') {
    const normalizedPhone = phone.trim();
    if (validateInternationalPhone(normalizedPhone)) {
      const { User } = require('../models');
      const user = await User.findOne({ phone: normalizedPhone, phoneVerified: true }).lean();
      if (user) {
        // Usuario existe y tiene teléfono verificado: generar y enviar OTP
        try {
          await generateAndSendOTP(normalizedPhone, 'reset');
        } catch (err) {
          logger.warn(`[requestPasswordReset] Error generando OTP para ${normalizedPhone}: ${err.message}`);
        }
      }
    }
  }

  // SIEMPRE la misma respuesta (anti-enumeration)
  res.json({
    success: true,
    message: ANTI_ENUM_MESSAGE
  });
});

/**
 * POST /api/auth/verify-reset-otp
 * Verifica el código OTP para reset de contraseña.
 * Si es válido, retorna username completo y un JWT temporal de 5 minutos.
 */
const verifyResetOtp = asyncHandler(async (req, res) => {
  const { phone, code } = req.body;

  if (!phone || !code) {
    throw new AppError('Teléfono y código requeridos', 400, ErrorCodes.VALIDATION_ERROR);
  }

  const normalizedPhone = phone.trim();
  if (!validateInternationalPhone(normalizedPhone)) {
    throw new AppError('Número de teléfono inválido', 400, ErrorCodes.VALIDATION_ERROR);
  }

  const otpResult = await verifyOTP(normalizedPhone, code, 'reset');

  if (!otpResult.valid) {
    throw new AppError(otpResult.error || 'Código incorrecto o expirado', 400, 'OTP_INVALID');
  }

  // Buscar usuario con ese teléfono verificado
  const { User } = require('../models');
  const user = await User.findOne({ phone: normalizedPhone, phoneVerified: true }).lean();

  if (!user) {
    throw new AppError('Código incorrecto o expirado', 400, 'OTP_INVALID');
  }

  if (!JWT_SECRET) {
    throw new AppError('Error de configuración del servidor', 500, 'SERVER_ERROR');
  }

  // Generar JWT temporal de 5 minutos solo para reset
  const resetToken = jwt.sign(
    { userId: user.id, username: user.username, purpose: 'reset' },
    JWT_SECRET,
    { expiresIn: '5m' }
  );

  res.json({
    success: true,
    verified: true,
    username: user.username,
    resetToken
  });
});

/**
 * POST /api/auth/complete-password-reset
 * Completa el reset de contraseña usando el JWT temporal.
 */
const completePasswordReset = asyncHandler(async (req, res) => {
  const { resetToken, newPassword } = req.body;

  if (!resetToken || !newPassword) {
    throw new AppError('Token y nueva contraseña requeridos', 400, ErrorCodes.VALIDATION_ERROR);
  }

  if (newPassword.length < 6) {
    throw new AppError('La contraseña debe tener al menos 6 caracteres', 400, ErrorCodes.VALIDATION_ERROR);
  }

  if (!JWT_SECRET) {
    throw new AppError('Error de configuración del servidor', 500, 'SERVER_ERROR');
  }

  let decoded;
  try {
    decoded = jwt.verify(resetToken, JWT_SECRET);
  } catch (err) {
    throw new AppError('Token de reset inválido o expirado', 400, 'RESET_TOKEN_INVALID');
  }

  if (decoded.purpose !== 'reset') {
    throw new AppError('Token de reset inválido', 400, 'RESET_TOKEN_INVALID');
  }

  const { User } = require('../models');
  const user = await User.findOne({ id: decoded.userId });

  if (!user) {
    throw new AppError('Usuario no encontrado', 404, ErrorCodes.USER_NOT_FOUND);
  }

  // Cambiar contraseña
  user.password = newPassword;
  user.passwordChangedAt = new Date();
  await user.save();

  // Sincronizar con JUGAYGANA (best-effort)
  try {
    const jugayganaSync = require('../../jugaygana');
    const jgResult = await jugayganaSync.changeUserPassword(user.username, null, newPassword);
    if (jgResult.success) {
      logger.info(`[completePasswordReset] Contraseña sincronizada con JUGAYGANA para: ${user.username}`);
    } else {
      logger.warn(`[completePasswordReset] No se pudo sincronizar con JUGAYGANA para ${user.username}: ${jgResult.error}`);
    }
  } catch (jgError) {
    logger.error(`[completePasswordReset] Error sincronizando con JUGAYGANA: ${jgError.message}`);
  }

  res.json({
    success: true,
    message: 'Contraseña cambiada exitosamente'
  });
});

module.exports = {
  register,
  login,
  logout,
  verify,
  changePassword,
  refreshToken,
  checkUsername,
  platformLogin,
  sendRegisterOtp,
  requestPasswordReset,
  verifyResetOtp,
  completePasswordReset
};
