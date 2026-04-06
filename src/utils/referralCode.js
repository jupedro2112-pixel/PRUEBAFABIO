/**
 * Utilidad: generador de códigos de referido
 */

const REFERRAL_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin O/0 e I/1 para evitar confusión

/**
 * Generar un código de referido único y legible
 * Formato: 6 caracteres alfanuméricos en mayúsculas
 * Ejemplo: "VIP3X7"
 * @returns {string}
 */
function generateReferralCode() {
  return Array.from({ length: 6 }, () =>
    REFERRAL_CODE_CHARS[Math.floor(Math.random() * REFERRAL_CODE_CHARS.length)]
  ).join('');
}

module.exports = { generateReferralCode, REFERRAL_CODE_CHARS };
