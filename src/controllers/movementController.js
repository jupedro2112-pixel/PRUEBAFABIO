/**
 * Controlador de Movimientos y Balance en tiempo real
 */
const jugaygana = require('../../jugaygana');
const jugayganaMovements = require('../../jugaygana-movements');
const { User } = require('../models');
const { UserActivity } = require('../../config/database');
const { recordUserActivity } = require('../utils/activityHelpers');
const asyncHandler = require('../utils/asyncHandler');
const logger = require('../utils/logger');

/**
 * GET /api/balance/live
 * Balance en tiempo real desde JUGAYGANA
 */
const getBalanceLive = asyncHandler(async (req, res) => {
  const username = req.user.username;
  const result = await jugayganaMovements.getUserBalance(username);

  if (result.success) {
    await User.updateOne({ username }, { balance: result.balance });
    res.json({
      balance: result.balance,
      username: result.username,
      updatedAt: new Date().toISOString()
    });
  } else {
    res.status(400).json({ error: result.error });
  }
});

/**
 * GET /api/movements
 * Movimientos del usuario
 */
const getMovements = asyncHandler(async (req, res) => {
  const username = req.user.username;
  const { startDate, endDate, page = 1 } = req.query;

  const result = await jugayganaMovements.getUserMovements(username, {
    startDate,
    endDate,
    page: parseInt(page),
    pageSize: 50
  });

  if (result.success) {
    res.json(result);
  } else {
    res.status(400).json({ error: result.error });
  }
});

/**
 * GET /api/movements/balance
 */
const getMovementsBalance = asyncHandler(async (req, res) => {
  const username = req.user.username;
  const result = await jugayganaMovements.getUserBalance(username);

  if (result.success) {
    res.json({ balance: result.balance });
  } else {
    res.status(400).json({ error: result.error });
  }
});

/**
 * POST /api/movements/deposit
 * Depósito del usuario
 */
const deposit = asyncHandler(async (req, res) => {
  const { amount } = req.body;
  const username = req.user.username;

  if (!amount || amount < 100) {
    return res.status(400).json({ error: 'Monto mínimo $100' });
  }

  const result = await jugaygana.depositToUser(
    username,
    amount,
    `Depósito desde Sala de Juegos - ${new Date().toLocaleString('es-AR')}`
  );

  if (result.success) {
    await recordUserActivity(UserActivity, req.user.userId, 'deposit', amount);
    res.json({
      success: true,
      message: `Depósito de $${amount} realizado correctamente`,
      newBalance: result.data?.user_balance_after,
      transactionId: result.data?.transfer_id || result.data?.transferId
    });
  } else {
    res.status(400).json({ error: result.error || 'Error al realizar depósito' });
  }
});

/**
 * POST /api/movements/withdraw
 * Retiro del usuario
 */
const withdraw = asyncHandler(async (req, res) => {
  const { amount } = req.body;
  const username = req.user.username;

  if (!amount || amount < 100) {
    return res.status(400).json({ error: 'Monto mínimo $100' });
  }

  const result = await jugaygana.withdrawFromUser(
    username,
    amount,
    `Retiro desde Sala de Juegos - ${new Date().toLocaleString('es-AR')}`
  );

  if (result.success) {
    await recordUserActivity(UserActivity, req.user.userId, 'withdrawal', amount);
    res.json({
      success: true,
      message: `Retiro de $${amount} realizado correctamente`,
      newBalance: result.data?.user_balance_after,
      transactionId: result.data?.transfer_id || result.data?.transferId
    });
  } else {
    res.status(400).json({ error: result.error || 'Error al realizar retiro' });
  }
});

module.exports = { getBalanceLive, getMovements, getMovementsBalance, deposit, withdraw };
