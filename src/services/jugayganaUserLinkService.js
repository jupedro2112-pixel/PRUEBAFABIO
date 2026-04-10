
/**
 * Servicio de vinculación automática de jugayganaUserId
 *
 * Resuelve el jugayganaUserId de un usuario local cuando falta (usuarios viejos).
 * Busca al usuario en la plataforma JUGAYGANA por username exacto y, si el match
 * es único y confiable, persiste el ID en la base local.
 *
 * Reglas de seguridad:
 * - Solo completa si el campo está vacío/null.
 * - Solo persiste si el match es exacto (username case-insensitive).
 * - Nunca sobrescribe un ID válido existente.
 * - Si no hay match confiable, devuelve null sin escribir nada.
 */

const { User } = require('../models');
const jugayganaService = require('./jugayganaService');
const logger = require('../utils/logger');

/**
 * Obtener jugayganaUserId para un usuario, intentando completarlo automáticamente
 * si aún no está cargado (backfill al vuelo).
 *
 * @param {string} userId  - ID interno del usuario en la base local
 * @param {string} username - Username del usuario
 * @returns {Promise<number|null>} jugayganaUserId resuelto, o null si no se pudo determinar
 */
async function resolveJugayganaUserId(userId, username) {
  // 1. Leer el campo actual de la base
  const userDoc = await User.findOne({ id: userId }).select('jugayganaUserId').lean();
  const existing = userDoc?.jugayganaUserId ?? null;

  if (existing) {
    return existing;
  }

  // 2. Campo vacío: intentar backfill al vuelo buscando en JUGAYGANA por username exacto
  logger.info(
    `[UserLink] jugayganaUserId faltante para user=${username} (id=${userId}). Intentando backfill al vuelo…`
  );

  let jgUser = null;
  try {
    jgUser = await jugayganaService.getUserInfo(username);
  } catch (err) {
    logger.error(
      `[UserLink] Error buscando usuario en JUGAYGANA | user=${username}: ${err.message}`
    );
    return null;
  }

  if (!jgUser || !jgUser.id) {
    logger.warn(
      `[UserLink] Usuario no encontrado en JUGAYGANA | user=${username}. No se puede completar jugayganaUserId.`
    );
    return null;
  }

  // 3. Verificar que el match sea exacto (getUserInfo ya filtra por username exacto case-insensitive,
  //    pero hacemos la validación explícita para mayor seguridad)
  const remoteUsername = String(jgUser.username || '').toLowerCase().trim();
  const localUsername = String(username || '').toLowerCase().trim();

  if (remoteUsername !== localUsername) {
    logger.warn(
      `[UserLink] Match no confiable: local="${localUsername}" vs JUGAYGANA="${remoteUsername}". ` +
      `No se persiste jugayganaUserId para user=${username}.`
    );
    return null;
  }

  const resolvedId = jgUser.id;

  // 4. Persistir solo si el campo sigue vacío (evitar race condition / sobrescritura)
  try {
    const updateResult = await User.updateOne(
      { id: userId, $or: [{ jugayganaUserId: null }, { jugayganaUserId: { $exists: false } }] },
      {
        $set: {
          jugayganaUserId: resolvedId,
          jugayganaUsername: jgUser.username,
          jugayganaSyncStatus: 'linked'
        }
      }
    );

    if (updateResult.modifiedCount > 0) {
      logger.info(
        `[UserLink] jugayganaUserId completado automáticamente | user=${username} jugayganaUserId=${resolvedId}`
      );
    } else {
      logger.info(
        `[UserLink] jugayganaUserId ya estaba cargado (sin cambios) | user=${username}`
      );
    }
  } catch (saveErr) {
    logger.error(
      `[UserLink] Error al persistir jugayganaUserId | user=${username}: ${saveErr.message}`
    );
    // Devolvemos el ID resuelto de todas formas para no bloquear el flujo actual
  }

  return resolvedId;
}

module.exports = { resolveJugayganaUserId };
