/**
 * Controlador de Referidos
 * Endpoints de usuario y admin para el sistema de referidos
 */
const asyncHandler = require('../utils/asyncHandler');
const { AppError } = require('../utils/AppError');
const { User, ReferralCommission, ReferralPayout, ReferralEvent, Transaction } = require('../models');
const referralCalculationService = require('../services/referralCalculationService');
const referralPayoutService = require('../services/referralPayoutService');
const { getCurrentPeriodKey, getPreviousPeriodKey, getPeriodLabel, getPeriodRange, getNextPeriodLabel } = require('../utils/periodKey');
const { generateReferralCode } = require('../utils/referralCode');
const logger = require('../utils/logger');

// Validate period key format (YYYY-MM)
const PERIOD_KEY_REGEX = /^\d{4}-\d{2}$/;
// Allowed status values for payout queries
const VALID_PAYOUT_STATUSES = ['pending', 'paid', 'failed', 'cancelled'];

/**
 * Sanitize a string for use as a plain-string query filter (no operators)
 * Strips MongoDB operator prefixes to prevent NoSQL injection via query objects.
 */
function sanitizeString(value) {
  if (typeof value !== 'string') return null;
  // Remove any $ prefixes that could inject Mongo operators
  return value.replace(/^\$/, '').trim();
}

/**
 * Sanitize a period key — only allow YYYY-MM format
 */
function sanitizePeriodKey(value) {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  return PERIOD_KEY_REGEX.test(s) ? s : null;
}

// =============================================
// Endpoints de Usuario
// =============================================

/**
 * GET /api/referrals/me
 * Información del referido del usuario actual: código, link, stats
 */
const getMyReferralInfo = asyncHandler(async (req, res) => {
  logger.info(`[Referrals] GET /me solicitado por ${req.user.username} (${req.user.userId})`);
  let user = await User.findOne({ id: req.user.userId }).lean();
  if (!user) throw new AppError('Usuario no encontrado', 404);

  // Auto-generate referralCode for legacy users who don't have one
  if (!user.referralCode) {
    logger.info(`[Referrals] Usuario ${req.user.username} sin referralCode — generando automáticamente`);
    let newCode = null;
    for (let attempts = 0; attempts < 10; attempts++) {
      const candidate = generateReferralCode();
      const collision = await User.findOne({ referralCode: candidate }).lean();
      if (!collision) { newCode = candidate; break; }
    }
    if (!newCode) throw new AppError('No se pudo generar un código de referido único. Reintentá.', 500);

    const updated = await User.findOneAndUpdate(
      { id: user.id, referralCode: null },
      { $set: { referralCode: newCode } },
      { new: true }
    ).lean();

    if (!updated) {
      // Race condition: another concurrent request already set the code — re-fetch
      const refetched = await User.findOne({ id: user.id }).lean();
      if (!refetched || !refetched.referralCode) {
        throw new AppError('No se pudo guardar el código de referido. Reintentá.', 500);
      }
      user = refetched;
      logger.info(`[Referrals] Código ya generado concurrentemente para ${user.username}: ${user.referralCode}`);
    } else if (!updated.referralCode) {
      throw new AppError('No se pudo guardar el código de referido. Reintentá.', 500);
    } else {
      user = updated;
      logger.info(`[Referrals] Código generado automáticamente para ${user.username}: ${user.referralCode}`);
    }
  }

  const frontendUrl = process.env.FRONTEND_URL ||
    `${req.get('x-forwarded-proto') || req.protocol}://${req.get('x-forwarded-host') || req.get('host')}`;
  const referralLink = user.referralCode
    ? `${frontendUrl}/?ref=${user.referralCode}`
    : null;

  // Contar referidos
  const totalReferred = await User.countDocuments({ referredByUserId: user.id });
  const activeReferred = await User.countDocuments({
    referredByUserId: user.id,
    referralStatus: 'active'
  });

  // Período actual
  const currentPeriod = getCurrentPeriodKey();

  // Total históricamente acreditado
  const totalCredited = await Transaction.aggregate([
    { $match: { userId: user.id, type: 'referral_commission', status: 'completed' } },
    { $group: { _id: null, total: { $sum: '$amount' } } }
  ]);

  const historicalTotal = totalCredited[0]?.total || 0;

  res.json({
    status: 'success',
    data: {
      referralCode: user.referralCode,
      referralLink,
      totalReferred,
      activeReferred,
      currentPeriod,
      currentPeriodLabel: getPeriodLabel(currentPeriod),
      historicalTotalCredited: historicalTotal,
      note: 'Las ganancias por referidos se acreditan mensualmente en fichas'
    }
  });
});

/**
 * GET /api/referrals/summary
 * Resumen de comisiones: pendiente del mes actual y acumulado
 */
const getMyReferralSummary = asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const currentPeriod = getCurrentPeriodKey();
  const previousPeriod = getPreviousPeriodKey();

  // Comisiones del período actual
  const currentCommissions = await ReferralCommission.find({
    periodKey: currentPeriod,
    referrerUserId: userId
  }).lean();

  const pendingAmount = currentCommissions
    .filter(c => c.status === 'calculated')
    .reduce((sum, c) => sum + c.commissionAmount, 0);

  // Payout del período anterior (si existe)
  const lastPayout = await ReferralPayout.findOne({
    referrerUserId: userId,
    status: 'paid'
  }).sort({ createdAt: -1 }).lean();

  res.json({
    status: 'success',
    data: {
      currentPeriod,
      currentPeriodLabel: getPeriodLabel(currentPeriod),
      pendingCommissions: currentCommissions.filter(c => c.status === 'calculated').length,
      pendingEstimatedAmount: pendingAmount,
      lastPayout: lastPayout ? {
        periodKey: lastPayout.periodKey,
        periodLabel: getPeriodLabel(lastPayout.periodKey),
        amount: lastPayout.totalCommissionAmount,
        creditedAt: lastPayout.creditedAt
      } : null,
      estimatedCreditDate: `Primer día hábil de ${getNextPeriodLabel(currentPeriod)}`
    }
  });
});

/**
 * GET /api/referrals/history
 * Historial de pagos del usuario
 */
const getMyReferralHistory = asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const { page = 1, limit = 20 } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const payouts = await ReferralPayout.find({ referrerUserId: userId })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit))
    .lean();

  const total = await ReferralPayout.countDocuments({ referrerUserId: userId });

  const payoutsWithLabels = payouts.map(p => ({
    ...p,
    periodLabel: getPeriodLabel(p.periodKey)
  }));

  res.json({
    status: 'success',
    data: {
      payouts: payoutsWithLabels,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / parseInt(limit))
      }
    }
  });
});

/**
 * GET /api/referrals/pending
 * Comisiones pendientes del período actual
 */
const getMyPendingCommissions = asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const currentPeriod = getCurrentPeriodKey();

  const commissions = await ReferralCommission.find({
    referrerUserId: userId,
    periodKey: currentPeriod,
    status: 'calculated'
  }).lean();

  res.json({
    status: 'success',
    data: {
      periodKey: currentPeriod,
      periodLabel: getPeriodLabel(currentPeriod),
      commissions,
      totalPending: commissions.reduce((sum, c) => sum + c.commissionAmount, 0)
    }
  });
});

// =============================================
// Endpoints de Admin
// =============================================

/**
 * GET /api/admin/referrals
 * Resumen de todos los referidores
 */
const adminGetReferralsSummary = asyncHandler(async (req, res) => {
  logger.info(`[Referrals] Admin summary solicitado por ${req.user.username}`);
  const { page = 1, limit = 50 } = req.query;
  const rawPeriod = req.query.period;
  const period = sanitizePeriodKey(rawPeriod);

  if (rawPeriod && !period) {
    throw new AppError('Formato de período inválido. Usar YYYY-MM', 400);
  }

  const skip = (parseInt(page) - 1) * parseInt(limit);

  // Contar totales globales
  const referrerIdsAll = await User.distinct('referredByUserId', { referredByUserId: { $ne: null, $exists: true } });
  const totalReferrers = referrerIdsAll.length;
  const totalReferred = await User.countDocuments({ referredByUserId: { $ne: null, $exists: true } });

  // Top referidores por todos los tiempos
  const topReferrers = await User.aggregate([
    {
      $lookup: {
        from: 'users',
        localField: 'id',
        foreignField: 'referredByUserId',
        as: 'referredUsers'
      }
    },
    { $match: { 'referredUsers.0': { $exists: true } } },
    {
      $project: {
        id: 1,
        username: 1,
        referralCode: 1,
        referralTier: 1,
        referralRateOverride: 1,
        excludedFromReferral: 1,
        totalReferreds: { $size: '$referredUsers' },
        referredUsernames: {
          $map: { input: '$referredUsers', as: 'u', in: '$$u.username' }
        },
        referredUserIds: {
          $map: { input: '$referredUsers', as: 'u', in: '$$u.id' }
        }
      }
    },
    { $sort: { totalReferreds: -1 } },
    { $skip: skip },
    { $limit: parseInt(limit) }
  ]);

  // Agregar estadísticas de comisiones por período para cada referidor
  const periodFilter = period ? { periodKey: period } : {};
  const payoutStats = await ReferralPayout.aggregate([
    { $match: periodFilter },
    {
      $group: {
        _id: '$status',
        total: { $sum: '$totalCommissionAmount' },
        count: { $sum: 1 }
      }
    }
  ]);

  // Comisiones calculadas del período para enriquecer los datos de referidores
  if (topReferrers.length > 0 && period) {
    const referrerIds = topReferrers.map(r => r.id);
    const periodCommissions = await ReferralCommission.aggregate([
      { $match: { periodKey: period, referrerUserId: { $in: referrerIds } } },
      {
        $group: {
          _id: '$referrerUserId',
          totalOwnerRevenue: { $sum: '$totalOwnerRevenue' },
          totalCommission: { $sum: '$commissionAmount' },
          activeReferreds: { $sum: { $cond: [{ $gt: ['$totalOwnerRevenue', 0] }, 1, 0] } }
        }
      }
    ]);
    const commissionsByReferrer = new Map(periodCommissions.map(c => [c._id, c]));
    for (const r of topReferrers) {
      const stats = commissionsByReferrer.get(r.id);
      r.periodStats = stats ? {
        totalOwnerRevenue: stats.totalOwnerRevenue,
        estimatedCommission: stats.totalCommission,
        activeReferreds: stats.activeReferreds
      } : null;
    }
  }

  res.json({
    status: 'success',
    data: {
      summary: {
        totalReferrers,
        totalReferred,
        period: period || null
      },
      topReferrers,
      payoutStats,
      pagination: { page: parseInt(page), limit: parseInt(limit) }
    }
  });
});

/**
 * GET /api/admin/referrals/:userId
 * Detalle de referidos y comisiones para un usuario específico
 */
const adminGetUserReferrals = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const rawPeriod = req.query.period;
  const period = sanitizePeriodKey(rawPeriod);

  if (rawPeriod && !period) {
    throw new AppError('Formato de período inválido. Usar YYYY-MM', 400);
  }

  // Sanitize userId - must be a non-empty string without Mongo operators
  const safeUserId = sanitizeString(userId);
  if (!safeUserId) throw new AppError('userId inválido', 400);

  const user = await User.findOne({ id: safeUserId }).lean();
  if (!user) throw new AppError('Usuario no encontrado', 404);

  // Usuarios referidos por este usuario
  const referredUsers = await User.find({ referredByUserId: safeUserId })
    .select('id username referredAt referralStatus excludedFromReferral')
    .lean();

  // Comisiones del período (o todas)
  const commissionQuery = { referrerUserId: safeUserId };
  if (period) commissionQuery.periodKey = period;

  const commissions = await ReferralCommission.find(commissionQuery)
    .sort({ calculatedAt: -1 })
    .lean();

  // Pagos
  const payoutQuery = { referrerUserId: safeUserId };
  if (period) payoutQuery.periodKey = period;

  const payouts = await ReferralPayout.find(payoutQuery)
    .sort({ createdAt: -1 })
    .lean();

  const frontendUrl = process.env.FRONTEND_URL ||
    `${req.get('x-forwarded-proto') || req.protocol}://${req.get('x-forwarded-host') || req.get('host')}`;

  res.json({
    status: 'success',
    data: {
      user: {
        id: user.id,
        username: user.username,
        referralCode: user.referralCode,
        referralLink: user.referralCode ? `${frontendUrl}/?ref=${user.referralCode}` : null,
        referralTier: user.referralTier,
        referralRateOverride: user.referralRateOverride,
        excludedFromReferral: user.excludedFromReferral
      },
      referredUsers,
      commissions: commissions.map(c => ({ ...c, periodLabel: getPeriodLabel(c.periodKey) })),
      payouts: payouts.map(p => ({ ...p, periodLabel: getPeriodLabel(p.periodKey) })),
      totalReferred: referredUsers.length,
      totalCommissionHistorical: commissions
        .filter(c => c.status === 'paid')
        .reduce((sum, c) => sum + c.commissionAmount, 0)
    }
  });
});

/**
 * GET /api/admin/referrals/payouts
 * Historial de todos los pagos con filtros
 */
const adminGetPayouts = asyncHandler(async (req, res) => {
  logger.info(`[Referrals] Admin payouts solicitado por ${req.user.username}`);
  const { page = 1, limit = 50 } = req.query;
  const rawPeriod = req.query.period;
  const rawStatus = req.query.status;
  const rawUsername = req.query.username;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const period = sanitizePeriodKey(rawPeriod);
  if (rawPeriod && !period) throw new AppError('Formato de período inválido. Usar YYYY-MM', 400);

  const status = rawStatus && VALID_PAYOUT_STATUSES.includes(rawStatus) ? rawStatus : null;
  if (rawStatus && !status) throw new AppError('Estado inválido', 400);

  // For username search, sanitize and escape for regex
  const safeUsername = rawUsername ? sanitizeString(rawUsername) : null;

  const query = {};
  if (period) query.periodKey = period;
  if (status) query.status = status;
  if (safeUsername) {
    // Escape special regex chars to prevent ReDoS
    const escaped = safeUsername.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    query.referrerUsername = { $regex: escaped, $options: 'i' };
  }

  const [payouts, total] = await Promise.all([
    ReferralPayout.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean(),
    ReferralPayout.countDocuments(query)
  ]);

  res.json({
    status: 'success',
    data: {
      payouts: payouts.map(p => ({ ...p, periodLabel: getPeriodLabel(p.periodKey) })),
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / parseInt(limit))
      }
    }
  });
});

/**
 * POST /api/admin/referrals/calculate
 * Ejecutar cálculo mensual (Fase A)
 */
const adminCalculate = asyncHandler(async (req, res) => {
  const { periodKey, dryRun = false } = req.body;
  const rawReferrerUserId = req.body.referrerUserId;

  if (!periodKey || !PERIOD_KEY_REGEX.test(periodKey)) {
    throw new AppError('periodKey inválido. Formato esperado: YYYY-MM', 400);
  }

  const referrerUserId = rawReferrerUserId ? sanitizeString(rawReferrerUserId) : null;

  logger.info(`[Admin] Cálculo de referidos iniciado por ${req.user.username} para ${periodKey}`);

  const result = await referralCalculationService.calculateCommissionsForPeriod(
    periodKey,
    { dryRun: Boolean(dryRun), referrerUserId }
  );

  res.json({
    status: 'success',
    data: result
  });
});

/**
 * POST /api/admin/referrals/preview
 * Preview del cálculo sin guardar (dry run)
 */
const adminPreview = asyncHandler(async (req, res) => {
  const { periodKey } = req.body;
  const rawReferrerUserId = req.body.referrerUserId;

  if (!periodKey || !PERIOD_KEY_REGEX.test(periodKey)) {
    throw new AppError('periodKey inválido. Formato esperado: YYYY-MM', 400);
  }

  const referrerUserId = rawReferrerUserId ? sanitizeString(rawReferrerUserId) : null;

  logger.info(`[Admin] Preview de referidos por ${req.user.username} para ${periodKey}`);

  const result = await referralCalculationService.calculateCommissionsForPeriod(
    periodKey,
    { dryRun: true, referrerUserId }
  );

  res.json({
    status: 'success',
    data: result
  });
});

/**
 * POST /api/admin/referrals/payout
 * Ejecutar pago mensual (Fase B)
 */
const adminPayout = asyncHandler(async (req, res) => {
  const { periodKey } = req.body;
  const rawReferrerUserId = req.body.referrerUserId;

  if (!periodKey || !PERIOD_KEY_REGEX.test(periodKey)) {
    throw new AppError('periodKey inválido. Formato esperado: YYYY-MM', 400);
  }

  const referrerUserId = rawReferrerUserId ? sanitizeString(rawReferrerUserId) : null;

  logger.info(`[Admin] Pago de referidos iniciado por ${req.user.username} para ${periodKey}`);

  const result = await referralPayoutService.executePayoutsForPeriod(periodKey, {
    referrerUserId,
    adminId: req.user.userId,
    adminUsername: req.user.username
  });

  res.json({
    status: 'success',
    data: result
  });
});

/**
 * GET /api/referrals/admin/relationships
 * Lista de todas las relaciones referidor → referido para auditoría
 */
const adminGetReferralRelationships = asyncHandler(async (req, res) => {
  logger.info(`[Referrals] Admin relationships solicitado por ${req.user.username}`);
  const { page = 1, limit = 100 } = req.query;
  const rawReferrerUsername = req.query.referrerUsername;
  const rawReferredUsername = req.query.referredUsername;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const safeReferrerUsername = rawReferrerUsername ? sanitizeString(rawReferrerUsername) : null;
  const safeReferredUsername = rawReferredUsername ? sanitizeString(rawReferredUsername) : null;

  // Buscar todos los usuarios referidos (tienen referredByUserId)
  const referredQuery = {
    referredByUserId: { $ne: null, $exists: true }
  };
  if (safeReferredUsername) {
    const escaped = safeReferredUsername.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    referredQuery.username = { $regex: escaped, $options: 'i' };
  }

  const [referredUsers, total] = await Promise.all([
    User.find(referredQuery)
      .select('id username referredByUserId referredByCode referredAt referralStatus excludedFromReferral jugayganaUsername')
      .sort({ referredAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean(),
    User.countDocuments(referredQuery)
  ]);

  if (referredUsers.length === 0) {
    return res.json({
      status: 'success',
      data: {
        relationships: [],
        pagination: { total: 0, page: parseInt(page), pages: 0 },
        message: 'No se encontraron relaciones de referido en la base de datos. Esto indica que ningún usuario se registró usando un código de referido.'
      }
    });
  }

  // Cargar datos de referidores
  const referrerIds = [...new Set(referredUsers.map(u => u.referredByUserId))];
  const referrerDocs = await User.find({ id: { $in: referrerIds } })
    .select('id username referralCode referralTier excludedFromReferral')
    .lean();
  const referrerMap = new Map(referrerDocs.map(r => [r.id, r]));

  // Filtrar por referrerUsername si se especificó
  let relationships = referredUsers.map(referred => {
    const referrer = referrerMap.get(referred.referredByUserId);
    return {
      referredUserId: referred.id,
      referredUsername: referred.username,
      referredAt: referred.referredAt,
      referralStatus: referred.referralStatus,
      excludedFromReferral: referred.excludedFromReferral,
      jugayganaUsername: referred.jugayganaUsername || referred.username,
      codeUsed: referred.referredByCode,
      referrer: referrer ? {
        id: referrer.id,
        username: referrer.username,
        referralCode: referrer.referralCode,
        excludedFromReferral: referrer.excludedFromReferral
      } : {
        id: referred.referredByUserId,
        username: '(no encontrado)',
        referralCode: referred.referredByCode
      }
    };
  });

  if (safeReferrerUsername) {
    const escaped = safeReferrerUsername.toLowerCase();
    relationships = relationships.filter(r =>
      r.referrer.username.toLowerCase().includes(escaped)
    );
  }

  res.json({
    status: 'success',
    data: {
      relationships,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / parseInt(limit))
      }
    }
  });
});

module.exports = {
  getMyReferralInfo,
  getMyReferralSummary,
  getMyReferralHistory,
  getMyPendingCommissions,
  adminGetReferralsSummary,
  adminGetUserReferrals,
  adminGetPayouts,
  adminCalculate,
  adminPreview,
  adminPayout,
  adminGetReferralRelationships
};
