/**
 * Servicio de Cálculo Mensual de Referidos
 * Fase A: calcula comisiones por período sin pagar
 */
const { v4: uuidv4 } = require('uuid');
const { User, ReferralCommission } = require('../models');
const referralRevenueService = require('./referralRevenueService');
const { getReferralRateForUser } = require('../utils/referralRate');
const logger = require('../utils/logger');

/**
 * Calcular comisiones de referidos para un período
 * @param {string} periodKey - e.g. "2026-04"
 * @param {Object} [options]
 * @param {boolean} [options.dryRun=false] - si true no guarda en DB
 * @param {string} [options.referrerUserId] - calcular solo para un referidor
 * @returns {Object} resultado del cálculo
 */
async function calculateCommissionsForPeriod(periodKey, options = {}) {
  const { dryRun = false, referrerUserId = null } = options;

  logger.info(`[ReferralCalc] Iniciando cálculo para período ${periodKey}${dryRun ? ' (DRY RUN)' : ''}`);

  const results = {
    periodKey,
    dryRun,
    referrersProcessed: 0,
    referredsProcessed: 0,
    commissionsCreated: 0,
    commissionsSkipped: 0,
    commissionsExcluded: 0,
    errors: [],
    details: []
  };

  // Armar mapa de referidores -> referidos
  // Buscar usuarios que tienen referredByUserId establecido (son los referidos)
  const referredQuery = {
    role: 'user',
    isActive: true,
    referredByUserId: { $ne: null, $exists: true }
  };
  // Si se filtró por referidor, solo buscar referidos de ese referidor
  if (referrerUserId) {
    referredQuery.referredByUserId = referrerUserId;
  }

  const referredUsers = await User.find(referredQuery).lean();

  // Armar mapa de referidores -> sus referidos
  const referrers = new Map();
  for (const user of referredUsers) {
    const referrerId = user.referredByUserId;
    if (!referrers.has(referrerId)) {
      referrers.set(referrerId, []);
    }
    referrers.get(referrerId).push(user);
  }

  if (referrers.size === 0) {
    logger.info('[ReferralCalc] No hay referidores activos con referidos asignados');
    return results;
  }

  results.referrersProcessed = referrers.size;

  // Cargar datos de los referidores por sus IDs (sin restricción de rol/estado para que funcione incluso si el referidor fue desactivado)
  const referrerIds = Array.from(referrers.keys());
  const referrerDocs = await User.find({ id: { $in: referrerIds } }).lean();
  const referrerMap = new Map();
  for (const u of referrerDocs) {
    referrerMap.set(u.id, u);
  }

  for (const [referrerId, usersReferredByThisReferrer] of referrers) {
    const referrer = referrerMap.get(referrerId);
    if (!referrer) {
      logger.warn(`[ReferralCalc] Referidor ${referrerId} no encontrado en la base de datos`);
      continue;
    }

    const referralRate = getReferralRateForUser(referrer);

    for (const referredUser of usersReferredByThisReferrer) {
      results.referredsProcessed++;

      // Verificar exclusión
      if (referredUser.excludedFromReferral) {
        logger.info(`[ReferralCalc] Usuario ${referredUser.username} excluido de referidos`);
        results.commissionsExcluded++;

        results.details.push({
          referredUsername: referredUser.username,
          referrerUsername: referrer.username,
          totalOwnerRevenue: 0,
          commissionAmount: 0,
          status: 'excluded',
          reason: 'Usuario marcado como excluido del sistema de referidos'
        });

        if (!dryRun) {
          await ReferralCommission.findOneAndUpdate(
            { periodKey, referredUserId: referredUser.id },
            {
              $setOnInsert: {
                id: uuidv4(),
                periodKey,
                referrerUserId: referrerId,
                referrerUsername: referrer.username,
                referredUserId: referredUser.id,
                referredUsername: referredUser.username,
                currency: 'ARS',
                totalBets: 0,
                totalWins: 0,
                totalGgr: 0,
                totalOwnerRevenue: 0,
                referralRate,
                commissionAmount: 0,
                providersBreakdown: [],
                status: 'excluded',
                calculatedAt: new Date()
              }
            },
            { upsert: true, new: true }
          ).catch(err => {
            if (err.code !== 11000) {
              logger.error(`[ReferralCalc] Error guardando excluded para ${referredUser.username}:`, err.message);
            }
          });
        }
        continue;
      }

      // Verificar si ya existe comisión para este período y usuario referido
      const existing = await ReferralCommission.findOne({
        periodKey,
        referredUserId: referredUser.id
      }).lean();

      if (existing && !dryRun) {
        logger.info(`[ReferralCalc] Comisión ya existe para ${referredUser.username} período ${periodKey}`);
        results.commissionsSkipped++;
        results.details.push({
          referredUsername: referredUser.username,
          referrerUsername: referrer.username,
          totalOwnerRevenue: existing.totalOwnerRevenue,
          commissionAmount: existing.commissionAmount,
          status: existing.status,
          reason: 'Comisión ya calculada previamente'
        });
        continue;
      }

      // Consultar revenue real en JUGAYGANA
      // Usar jugayganaUsername si está disponible, sino caer en username
      const jugayganaUsername = referredUser.jugayganaUsername || referredUser.username;
      const revenueResult = await referralRevenueService.getUserRevenueForPeriod(
        jugayganaUsername,
        periodKey
      );

      if (!revenueResult.success) {
        logger.error(
          `[ReferralCalc] Error obteniendo revenue para ${referredUser.username} (JG: ${jugayganaUsername}): ${revenueResult.error}`
        );
        results.errors.push({
          referredUsername: referredUser.username,
          jugayganaUsername,
          error: revenueResult.error
        });
        results.details.push({
          referredUsername: referredUser.username,
          referrerUsername: referrer.username,
          jugayganaUsername,
          totalOwnerRevenue: 0,
          commissionAmount: 0,
          status: 'error',
          reason: `Error consultando revenue: ${revenueResult.error}`
        });
        continue;
      }

      const { totalOwnerRevenue, totalBets, totalWins, totalGgr, providers } = revenueResult;

      // Solo revenue positivo genera comisión
      const commissionAmount = totalOwnerRevenue > 0
        ? totalOwnerRevenue * referralRate
        : 0;

      const status = totalOwnerRevenue <= 0 ? 'skipped' : 'calculated';
      const reason = totalOwnerRevenue <= 0
        ? `Revenue del período es $0 (apuestas: $${totalBets?.toFixed(2) || 0}, ganancias: $${totalWins?.toFixed(2) || 0})`
        : null;

      const commissionData = {
        id: existing?.id || uuidv4(),
        periodKey,
        referrerUserId: referrerId,
        referrerUsername: referrer.username,
        referredUserId: referredUser.id,
        referredUsername: referredUser.username,
        currency: 'ARS',
        totalBets,
        totalWins,
        totalGgr,
        totalOwnerRevenue,
        referralRate,
        commissionAmount,
        providersBreakdown: providers || [],
        status,
        calculatedAt: new Date()
      };

      results.details.push({
        referredUsername: referredUser.username,
        referrerUsername: referrer.username,
        jugayganaUsername,
        totalBets,
        totalWins,
        totalGgr,
        totalOwnerRevenue,
        referralRate,
        commissionAmount,
        status,
        reason: reason || undefined
      });

      if (!dryRun) {
        if (existing) {
          // Never overwrite a paid commission
          if (existing.status === 'paid') {
            logger.info(`[ReferralCalc] Comisión ya pagada para ${referredUser.username} período ${periodKey} - omitiendo`);
            results.commissionsSkipped++;
            continue;
          }
          const { status: _omit, ...dataWithoutStatus } = commissionData;
          await ReferralCommission.updateOne(
            { _id: existing._id },
            { $set: { ...dataWithoutStatus, status } }
          );
        } else {
          await ReferralCommission.create(commissionData).catch(err => {
            if (err.code === 11000) {
              logger.warn(`[ReferralCalc] Conflicto de duplicado para ${referredUser.username} - ignorando`);
            } else {
              throw err;
            }
          });
        }
      }

      if (status === 'calculated') {
        results.commissionsCreated++;
      } else {
        results.commissionsSkipped++;
      }
    }
  }

  logger.info(
    `[ReferralCalc] Período ${periodKey}: ` +
    `${results.commissionsCreated} comisiones creadas, ` +
    `${results.commissionsSkipped} sin revenue, ` +
    `${results.commissionsExcluded} excluidas, ` +
    `${results.errors.length} errores`
  );

  return results;
}

/**
 * Obtener resumen de comisiones pendientes por referidor para un período
 * @param {string} periodKey
 * @returns {Array}
 */
async function getPendingCommissionsSummary(periodKey) {
  return ReferralCommission.aggregate([
    { $match: { periodKey, status: 'calculated' } },
    {
      $group: {
        _id: '$referrerUserId',
        referrerUsername: { $first: '$referrerUsername' },
        totalCommission: { $sum: '$commissionAmount' },
        referralCount: { $sum: 1 }
      }
    },
    { $sort: { totalCommission: -1 } }
  ]);
}

module.exports = {
  calculateCommissionsForPeriod,
  getPendingCommissionsSummary
};
