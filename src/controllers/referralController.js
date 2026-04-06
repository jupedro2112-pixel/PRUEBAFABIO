/**
 * Controlador de Referidos
 * Endpoints de usuario y admin para el sistema de referidos
 */
const asyncHandler = require('../utils/asyncHandler');
const { AppError } = require('../utils/AppError');
const { User, ReferralCommission, ReferralPayout, ReferralEvent, Transaction } = require('../models');
const referralCalculationService = require('../services/referralCalculationService');
const referralPayoutService = require('../services/referralPayoutService');
const { getCurrentPeriodKey, getPreviousPeriodKey, getPeriodLabel, getPeriodRange } = require('../utils/periodKey');
const logger = require('../utils/logger');

// =============================================
// Endpoints de Usuario
// =============================================

/**
 * GET /api/referrals/me
 * Información del referido del usuario actual: código, link, stats
 */
const getMyReferralInfo = asyncHandler(async (req, res) => {
  const user = await User.findOne({ id: req.user.userId }).lean();
  if (!user) throw new AppError('Usuario no encontrado', 404);

  const frontendUrl = process.env.FRONTEND_URL || 'https://vipcargas.com';
  const referralLink = user.referralCode
    ? `${frontendUrl}/register?ref=${user.referralCode}`
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
      estimatedCreditDate: `Primer día hábil de ${getPeriodLabel(currentPeriod.replace(/-\d+$/, m => {
        const [y, mo] = currentPeriod.split('-').map(Number);
        const next = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
        return next.split('-')[1];
      }))}`
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
  const { period, page = 1, limit = 50 } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

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
        totalReferreds: { $size: '$referredUsers' }
      }
    },
    { $sort: { totalReferreds: -1 } },
    { $skip: skip },
    { $limit: parseInt(limit) }
  ]);

  // Estadísticas de pagos por período
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

  res.json({
    status: 'success',
    data: {
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
  const { period } = req.query;

  const user = await User.findOne({ id: userId }).lean();
  if (!user) throw new AppError('Usuario no encontrado', 404);

  // Usuarios referidos por este usuario
  const referredUsers = await User.find({ referredByUserId: userId })
    .select('id username referredAt referralStatus excludedFromReferral')
    .lean();

  // Comisiones del período (o todas)
  const commissionQuery = { referrerUserId: userId };
  if (period) commissionQuery.periodKey = period;

  const commissions = await ReferralCommission.find(commissionQuery)
    .sort({ calculatedAt: -1 })
    .lean();

  // Pagos
  const payoutQuery = { referrerUserId: userId };
  if (period) payoutQuery.periodKey = period;

  const payouts = await ReferralPayout.find(payoutQuery)
    .sort({ createdAt: -1 })
    .lean();

  const frontendUrl = process.env.FRONTEND_URL || 'https://vipcargas.com';

  res.json({
    status: 'success',
    data: {
      user: {
        id: user.id,
        username: user.username,
        referralCode: user.referralCode,
        referralLink: user.referralCode ? `${frontendUrl}/register?ref=${user.referralCode}` : null,
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
  const { period, status, username, page = 1, limit = 50 } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const query = {};
  if (period) query.periodKey = period;
  if (status) query.status = status;
  if (username) query.referrerUsername = { $regex: username, $options: 'i' };

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
  const { periodKey, referrerUserId, dryRun = false } = req.body;

  if (!periodKey || !/^\d{4}-\d{2}$/.test(periodKey)) {
    throw new AppError('periodKey inválido. Formato esperado: YYYY-MM', 400);
  }

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
  const { periodKey, referrerUserId } = req.body;

  if (!periodKey || !/^\d{4}-\d{2}$/.test(periodKey)) {
    throw new AppError('periodKey inválido. Formato esperado: YYYY-MM', 400);
  }

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
  const { periodKey, referrerUserId } = req.body;

  if (!periodKey || !/^\d{4}-\d{2}$/.test(periodKey)) {
    throw new AppError('periodKey inválido. Formato esperado: YYYY-MM', 400);
  }

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
  adminPayout
};
