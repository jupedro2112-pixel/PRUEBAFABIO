/**
 * Utilidad: generador de códigos de referido
 */
const { v4: uuidv4 } = require('uuid');

/**
 * Generar un código de referido único y legible
 * Formato: 6 caracteres alfanuméricos en mayúsculas
 * Ejemplo: "VIP3X7"
 * @param {string} [username] - username para personalizar el prefijo (opcional)
 * @returns {string}
 */
function generateReferralCode(username) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin O/0 e I/1 para evitar confusión
  const randomPart = Array.from({ length: 6 }, () =>
    chars[Math.floor(Math.random() * chars.length)]
  ).join('');
  return randomPart;
}

module.exports = { generateReferralCode };
