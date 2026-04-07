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
  const mode = dryRun ? 'preview' : 'calculate';

  logger.info(`[ReferralCalc] Iniciando cálculo | period=${periodKey} mode=${mode}`);

  const results = {
    periodKey,
    dryRun,
    mode,
    referrersProcessed: 0,
    referredsProcessed: 0,
    commissionsCreated: 0,
    commissionsSkipped: 0,
    commissionsExcluded: 0,
    errors: [],
    details: []
  };

  let providerCallsCount = 0;

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
          // Find existing record first so we can preserve its id on update.
          const excludedExisting = await ReferralCommission.findOne({
            periodKey, referredUserId: referredUser.id
          }).lean();
          const excludedId = excludedExisting?.id || uuidv4();
          // Use $set so stale excluded records are corrected (data is always refreshed).
          // The id is included in $set to ensure it is always present, whether inserting or updating.
          await ReferralCommission.findOneAndUpdate(
            { periodKey, referredUserId: referredUser.id },
            {
              $set: {
                id: excludedId,
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

      // Verificar si ya existe comisión para este período y usuario referido.
      // Se consulta siempre (tanto en preview como en calculate) para poder hacer upsert correcto.
      // En modo calculate, si existe un registro previo NO pagado, se recalcula y reemplaza.
      const existing = await ReferralCommission.findOne({
        periodKey,
        referredUserId: referredUser.id
      }).lean();

      const existingCalculationFound = !!existing;
      // Will replace when: not dryRun, record exists, and it is not already paid.
      // Guard with !!existing for extra safety even though existingCalculationFound already implies it.
      const existingCalculationWillBeReplaced = existingCalculationFound && !dryRun && !!existing && existing.status !== 'paid';

      logger.info(
        `[ReferralCalc] mode=${mode} period=${periodKey} referrer=${referrer.username} ` +
        `referredUser=${referredUser.username} ` +
        `existingCalculationFound=${existingCalculationFound} ` +
        `existingCalculationWillBeReplaced=${existingCalculationWillBeReplaced} ` +
        `calculationSource=fresh`
      );

      // Consultar revenue real en JUGAYGANA usando child_user_id (ID numérico del proveedor).
      // El panel oficial envía { child_user_id: <numeric_id>, date_from, date_to }.
      // Usar solo username/login en el body devuelve el agregado global del agente — ese era el bug
      // que causaba que todos los referidos mostraran los mismos valores enormes.
      // Si jugayganaUserId es null, el servicio retorna error explícito (revenue=0) en lugar de
      // copiar el agregado global.
      const jugayganaUsername = referredUser.jugayganaUsername || referredUser.username;
      const jugayganaUserId = referredUser.jugayganaUserId || null;

      providerCallsCount++;
      logger.info(
        `[ReferralCalc] Consultando revenue | mode=${mode} referido=${referredUser.username} referredUserId=${jugayganaUserId} ` +
        `jugayganaUsername=${jugayganaUsername} período=${periodKey} providerCallsCount=${providerCallsCount} ` +
        `revenueScope=perUser commissionCalculationMode=individual_revenue`
      );

      const revenueResult = await referralRevenueService.getUserRevenueForPeriod(
        jugayganaUsername,
        periodKey,
        jugayganaUserId
      );

      if (!revenueResult.success) {
        const authDetail = revenueResult.authDetail || null;
        const providerMessage = revenueResult.providerMessage || null;
        const providerCode = revenueResult.providerCode || null;
        logger.error(
          `[ReferralCalc] Error revenue | referido=${referredUser.username} ` +
          `jugayganaUsername=${jugayganaUsername} período=${periodKey} error=${revenueResult.error}` +
          (providerMessage ? ` providerMsg="${providerMessage}"` : '') +
          (providerCode ? ` providerCode=${providerCode}` : '') +
          (authDetail
            ? ` authScheme=${authDetail.authScheme} tokenSource=${authDetail.tokenSource}` +
              ` tokenPresente=${authDetail.tokenPresente} reloginAttempted=${authDetail.reloginAttempted}` +
              (authDetail.isV1TokenForV2Api ? ' isV1TokenForV2Api=true' : '') +
              (authDetail.derivedLoginUrl ? ` derivedLoginUrl=${authDetail.derivedLoginUrl}` : '')
            : '')
        );

        // Armar razón descriptiva para el detalle del admin
        let reason = `Error consultando revenue: ${revenueResult.error}`;
        if (revenueResult.statusCode === 401 || revenueResult.statusCode === 403) {
          reason = `Autenticación rechazada por el proveedor (${revenueResult.statusCode})`;
          if (providerMessage) reason += `: ${providerMessage}`;
          if (authDetail) {
            reason += ` | diagnosisCategory=${revenueResult.diagnosisCategory || authDetail.diagnosisCategory || 'provider_response_inconclusive'}`;
            reason += ` | providerStatus=${revenueResult.statusCode}`;
            reason += ` | tokenSource=${authDetail.tokenSource}`;
            reason += ` | cookiePresent=${authDetail.cookiePresente}`;
            reason += ` | authModeTested=${authDetail.authModeTested || authDetail.authScheme || 'Bearer'}`;
            if (authDetail.variantsTested && authDetail.variantsTested.length > 0) {
              const varA = authDetail.variantsTested.find(v => v.variant === 'Bearer');
              const varB = authDetail.variantsTested.find(v => v.variant === 'Bearer+Cookie');
              if (varA) reason += ` | variantAStatus=${varA.status}`;
              if (varB) reason += ` | variantBStatus=${varB.status}`;
              else if (!authDetail.cookiePresente) reason += ` | variantBStatus=not_applicable_no_provider_cookie`;
              else reason += ` | variantBStatus=skipped`;
            }
            if (authDetail.sessionState) reason += ` | sessionState=${authDetail.sessionState}`;
            if (revenueResult.conclusion || authDetail.conclusion) {
              reason += ` | conclusion=${revenueResult.conclusion || authDetail.conclusion}`;
            }
          }
        } else if (revenueResult.statusCode === 422) {
          reason = `Validación rechazada por el proveedor (422)`;
          if (providerMessage) reason += `: ${providerMessage}`;
        } else if (providerMessage) {
          reason += ` | ${providerMessage}`;
        }

        results.errors.push({
          referredUsername: referredUser.username,
          jugayganaUsername,
          periodKey,
          error: revenueResult.error,
          statusCode: revenueResult.statusCode || null,
          providerMessage,
          providerCode,
          authDetail,
          providerResponse: revenueResult.rawProviderBody || null
        });
        results.details.push({
          referredUsername: referredUser.username,
          referrerUsername: referrer.username,
          jugayganaUsername,
          periodKey,
          revenueOk: false,
          totalBets: 0,
          totalWins: 0,
          totalGgr: 0,
          totalOwnerRevenue: 0,
          commissionAmount: 0,
          status: 'error',
          reason,
          providerMessage,
          providerCode,
          authDetail,
          providerResponse: revenueResult.rawProviderBody || null
        });
        continue;
      }

      const { totalOwnerRevenue, totalBets, totalWins, totalGgr, providers } = revenueResult;

      logger.info(
        `[ReferralCalc] Revenue obtenido | referido=${referredUser.username} referredUserId=${jugayganaUserId} ` +
        `GGR=${totalGgr?.toFixed(2)} ownerRevenue=${totalOwnerRevenue?.toFixed(2)} ` +
        `individualRevenueFound=${revenueResult.individualRevenueFound ?? true} ` +
        `usedGlobalAggregate=${revenueResult.usedGlobalAggregate ?? false} ` +
        `revenueScope=${revenueResult.revenueScope || 'perUser'} ` +
        `revenueSourceField=${revenueResult.revenueSourceField || 'child_user_id'} ` +
        `commissionCalculationMode=${revenueResult.commissionCalculationMode || 'individual_revenue'}`
      );

      // Solo revenue positivo genera comisión
      const commissionAmount = totalOwnerRevenue > 0
        ? totalOwnerRevenue * referralRate
        : 0;

      const status = totalOwnerRevenue <= 0 ? 'skipped' : 'calculated';
      const reason = totalOwnerRevenue <= 0
        ? `Revenue del período es $0 (GGR: $${(totalGgr ?? 0).toFixed(2)}, apuestas: $${(totalBets ?? 0).toFixed(2)}, ganancias: $${(totalWins ?? 0).toFixed(2)})`
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
        periodKey,
        revenueOk: true,
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
            logger.info(
              `[ReferralCalc] Comisión ya pagada para ${referredUser.username} período ${periodKey} - omitiendo | ` +
              `mode=${mode} upsertPerformed=false calculationSource=persisted`
            );
            results.commissionsSkipped++;
            continue;
          }
          const { status: _omit, ...dataWithoutStatus } = commissionData;
          await ReferralCommission.updateOne(
            { _id: existing._id },
            { $set: { ...dataWithoutStatus, status } }
          );
          logger.info(
            `[ReferralCalc] Reemplazando cálculo previo | mode=${mode} period=${periodKey} ` +
            `referrer=${referrer.username} referredUser=${referredUser.username} ` +
            `upsertPerformed=true calculationSource=fresh existingCalculationFound=true ` +
            `existingCalculationWillBeReplaced=true finalCommission=${commissionAmount.toFixed(2)}`
          );
        } else {
          await ReferralCommission.create(commissionData).catch(err => {
            if (err.code === 11000) {
              logger.warn(`[ReferralCalc] Conflicto de duplicado para ${referredUser.username} - ignorando`);
            } else {
              throw err;
            }
          });
          logger.info(
            `[ReferralCalc] Nuevo registro guardado | mode=${mode} period=${periodKey} ` +
            `referrer=${referrer.username} referredUser=${referredUser.username} ` +
            `upsertPerformed=true calculationSource=fresh existingCalculationFound=false ` +
            `finalCommission=${commissionAmount.toFixed(2)}`
          );
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
    `[ReferralCalc] Período ${periodKey} | mode=${mode} providerCallsCount=${providerCallsCount} ` +
    `commissionsCreated=${results.commissionsCreated} commissionsSkipped=${results.commissionsSkipped} ` +
    `commissionsExcluded=${results.commissionsExcluded} errors=${results.errors.length}`
  );

  if (!dryRun) {
    logger.info(`[ReferralCalc] calculate aligned with preview for period ${periodKey}`);
  }

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
