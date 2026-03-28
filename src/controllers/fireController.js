
/**
 * Controlador de Fueguito (Racha Diaria)
 * Maneja el sistema de rachas diarias
 */
const { FireStreak } = require('../models');
const { jugayganaService } = require('../services');
const asyncHandler = require('../utils/asyncHandler');
const { AppError, ErrorCodes } = require('../utils/AppError');
const logger = require('../utils/logger');

// Funciones helper para fechas Argentina
const getArgentinaDateString = (date = new Date()) => {
  const argentinaTime = new Date(date.toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }));
  return argentinaTime.toDateString();
};

const getArgentinaYesterday = () => {
  const now = new Date();
  const argentinaNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }));
  argentinaNow.setDate(argentinaNow.getDate() - 1);
  return argentinaNow.toDateString();
};

/**
 * GET /api/fire/status
 * Obtener estado del fueguito
 */
const getStatus = asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  
  let fireStreak = await FireStreak.findOne({ userId }).lean();
  
  if (!fireStreak) {
    fireStreak = { streak: 0, lastClaim: null, totalClaimed: 0 };
  }
  
  const todayArgentina = getArgentinaDateString();
  const lastClaim = fireStreak.lastClaim ? getArgentinaDateString(new Date(fireStreak.lastClaim)) : null;
  
  const canClaim = lastClaim !== todayArgentina;
  
  // Verificar si la racha está activa
  const yesterdayArgentina = getArgentinaYesterday();
  const isStreakActive = lastClaim === yesterdayArgentina || lastClaim === todayArgentina;
  
  // Resetear racha si se perdió
  if (!isStreakActive && fireStreak.streak > 0 && lastClaim !== todayArgentina) {
    await FireStreak.updateOne(
      { userId },
      { streak: 0, lastReset: new Date() },
      { upsert: true }
    );
    fireStreak.streak = 0;
  }
  
  res.json({
    status: 'success',
    data: {
      streak: fireStreak.streak || 0,
      lastClaim: fireStreak.lastClaim,
      totalClaimed: fireStreak.totalClaimed || 0,
      canClaim,
      nextReward: fireStreak.streak >= 9 ? 10000 : 0
    }
  });
});

/**
 * POST /api/fire/claim
 * Reclamar fueguito del día
 */
const claim = asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const username = req.user.username;
  
  let fireStreak = await FireStreak.findOne({ userId });
  
  if (!fireStreak) {
    fireStreak = new FireStreak({ userId, username, streak: 0, totalClaimed: 0 });
  }
  
  const todayArgentina = getArgentinaDateString();
  const lastClaim = fireStreak.lastClaim ? getArgentinaDateString(new Date(fireStreak.lastClaim)) : null;
  
  // Verificar si ya reclamó hoy
  if (lastClaim === todayArgentina) {
    throw new AppError('Ya reclamaste tu fueguito hoy', 400, ErrorCodes.VALIDATION_ERROR);
  }
  
  // Verificar si la racha continúa o se reinicia
  const yesterdayArgentina = getArgentinaYesterday();
  if (lastClaim !== yesterdayArgentina && fireStreak.streak > 0) {
    fireStreak.streak = 0;
    fireStreak.lastReset = new Date();
  }
  
  // Incrementar racha
  fireStreak.streak += 1;
  fireStreak.lastClaim = new Date();
  
  // Calcular recompensa
  let reward = 0;
  let message = `Día ${fireStreak.streak} de racha!`;
  
  // Día 10 = recompensa grande
  if (fireStreak.streak === 10) {
    reward = 10000;
    fireStreak.totalClaimed += reward;
    
    // Acreditar en JUGAYGANA
    const bonusResult = await jugayganaService.creditBalance(
      username,
      reward,
      'Recompensa racha 10 días - Sala de Juegos'
    );
    
    if (!bonusResult.success) {
      throw new AppError('Error al acreditar recompensa: ' + bonusResult.error, 400, ErrorCodes.TX_FAILED);
    }
    
    message = `¡Felicidades! 10 días de racha! Recompensa: $${reward.toLocaleString()}`;
  }
  
  // Agregar al historial
  fireStreak.history = fireStreak.history || [];
  fireStreak.history.push({
    date: new Date(),
    reward,
    streakDay: fireStreak.streak
  });
  
  await fireStreak.save();
  
  logger.info(`Fueguito reclamado: ${username} - Día ${fireStreak.streak}`);
  
  res.json({
    status: 'success',
    data: {
      streak: fireStreak.streak,
      reward,
      message,
      totalClaimed: fireStreak.totalClaimed
    }
  });
});

module.exports = {
  getStatus,
  claim
};