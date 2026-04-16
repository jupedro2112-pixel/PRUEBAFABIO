
/**
 * Servicio OTP - One-Time Password
 * Gestiona generación, envío y verificación de códigos OTP para:
 * - Verificación de teléfono en el registro ('register')
 * - Reset de contraseña por SMS ('reset')
 */

const bcrypt = require('bcryptjs');
const OtpCode = require('../models/OtpCode');
const { sendSMS } = require('./smsService');

const OTP_LENGTH = 6;
const MAX_ATTEMPTS = 3;
const RATE_LIMIT_SECONDS = 60;    // No reenviar si hay OTP válido creado hace menos de 60 segundos
const MAX_OTPS_PER_HOUR = 3;      // Máximo 3 OTPs por número por hora

/**
 * Genera un código OTP numérico de 6 dígitos.
 * @returns {string} código de 6 dígitos como string
 */
function generateCode() {
  const num = Math.floor(Math.random() * 1000000);
  return String(num).padStart(OTP_LENGTH, '0');
}

/**
 * Genera un OTP, lo hashea, lo guarda en DB y lo envía por SMS.
 * Rate limit: no envía si ya hay un OTP válido para ese phone+purpose creado hace menos de 60s.
 * Máximo 3 OTPs por número por hora.
 *
 * @param {string} phone - Teléfono normalizado (ej: +5491155551234)
 * @param {string} purpose - 'register' o 'reset'
 * @returns {Promise<{success: boolean, error?: string, smsSent?: boolean}>}
 */
async function generateAndSendOTP(phone, purpose) {
  const now = new Date();

  // Rate limit: no reenviar si hay un OTP válido reciente (menos de 60 segundos)
  const recentOtp = await OtpCode.findOne({
    phone,
    purpose,
    createdAt: { $gte: new Date(now.getTime() - RATE_LIMIT_SECONDS * 1000) }
  });

  if (recentOtp) {
    return {
      success: false,
      error: `Espera ${RATE_LIMIT_SECONDS} segundos antes de solicitar un nuevo código`
    };
  }

  // Rate limit: máximo 3 OTPs por número por hora
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const recentCount = await OtpCode.countDocuments({
    phone,
    purpose,
    createdAt: { $gte: oneHourAgo }
  });

  if (recentCount >= MAX_OTPS_PER_HOUR) {
    return {
      success: false,
      error: 'Demasiados intentos. Espera una hora antes de solicitar un nuevo código.'
    };
  }

  // Generar código y hashear
  const code = generateCode();
  const codeHash = await bcrypt.hash(code, 10);

  // Eliminar OTPs anteriores del mismo phone+purpose para evitar acumulación
  await OtpCode.deleteMany({ phone, purpose });

  // Guardar en DB
  await OtpCode.create({ phone, codeHash, purpose });

  // Enviar SMS
  const message = purpose === 'register'
    ? `Tu código de verificación para registrarte es: ${code}. Válido por 5 minutos.`
    : `Tu código para restablecer contraseña es: ${code}. Válido por 5 minutos.`;

  const smsResult = await sendSMS(phone, message);

  if (!smsResult.success) {
    // En modo desarrollo (sin SMS configurado), igual retornamos success para que el flujo continue
    // pero indicamos que el SMS no fue enviado
    if (smsResult.error === 'SMS service not configured') {
      console.log(`[otpService] MODO DESARROLLO - Código OTP para ${phone} (${purpose}): ${code}`);
      return { success: true, smsSent: false, devCode: code };
    }
    // Error real de SMS
    console.error(`[otpService] Error enviando SMS OTP a ${phone}: ${smsResult.error}`);
    return { success: false, error: 'No se pudo enviar el SMS. Intenta nuevamente.' };
  }

  return { success: true, smsSent: true };
}

/**
 * Verifica un código OTP contra el hash almacenado en DB.
 * Si attempts >= MAX_ATTEMPTS, invalida el código.
 *
 * @param {string} phone - Teléfono normalizado
 * @param {string} code - Código de 6 dígitos ingresado por el usuario
 * @param {string} purpose - 'register' o 'reset'
 * @returns {Promise<{valid: boolean, error?: string}>}
 */
async function verifyOTP(phone, code, purpose) {
  const otp = await OtpCode.findOne({ phone, purpose });

  if (!otp) {
    return { valid: false, error: 'Código incorrecto o expirado' };
  }

  // Si ya se agotaron los intentos, invalidar
  if (otp.attempts >= MAX_ATTEMPTS) {
    await OtpCode.deleteOne({ _id: otp._id });
    return { valid: false, error: 'Código bloqueado por demasiados intentos incorrectos. Solicita uno nuevo.' };
  }

  const isValid = await bcrypt.compare(String(code).trim(), otp.codeHash);

  if (!isValid) {
    // Incrementar intentos
    await OtpCode.updateOne({ _id: otp._id }, { $inc: { attempts: 1 } });
    const remaining = MAX_ATTEMPTS - (otp.attempts + 1);
    return {
      valid: false,
      error: remaining > 0
        ? `Código incorrecto. Te quedan ${remaining} intento(s).`
        : 'Código bloqueado por demasiados intentos incorrectos. Solicita uno nuevo.'
    };
  }

  // Código correcto: eliminar para que no pueda reutilizarse
  await OtpCode.deleteOne({ _id: otp._id });

  return { valid: true };
}

module.exports = { generateAndSendOTP, verifyOTP };
