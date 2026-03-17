// ============================================
// MODELO DE REEMBOLSOS - CON MONGODB
// ============================================

const { Refund, isConnected } = require('../database');
const fs = require('fs');
const path = require('path');

// Fallback a JSON si no hay MongoDB
const DATA_DIR = process.env.VERCEL ? '/tmp/data' : path.join(__dirname, '../data');
const REFUNDS_FILE = path.join(DATA_DIR, 'refunds.json');

// Asegurar que exista el archivo
if (!fs.existsSync(DATA_DIR)) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (error) {
    console.error('Error creando directorio de datos:', error);
  }
}
if (!fs.existsSync(REFUNDS_FILE)) {
  try {
    fs.writeFileSync(REFUNDS_FILE, JSON.stringify([], null, 2));
  } catch (error) {
    console.error('Error creando archivo de reembolsos:', error);
  }
}

async function loadRefunds() {
  if (isConnected()) {
    try {
      const refunds = await Refund.find().lean();
      return refunds.map(r => ({ ...r, _id: undefined, __v: undefined }));
    } catch (error) {
      console.error('Error cargando reembolsos de MongoDB:', error);
    }
  }
  
  try {
    const data = fs.readFileSync(REFUNDS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return [];
  }
}

async function saveRefunds(refunds) {
  if (isConnected()) {
    try {
      // Los reembolsos ya se guardan individualmente con recordRefund
      return;
    } catch (error) {
      console.error('Error guardando reembolsos en MongoDB:', error);
    }
  }
  
  try {
    fs.writeFileSync(REFUNDS_FILE, JSON.stringify(refunds, null, 2));
  } catch (error) {
    console.error('Error guardando reembolsos en JSON:', error);
  }
}

// Obtener reembolsos de un usuario
async function getUserRefunds(userId) {
  if (isConnected()) {
    try {
      return await Refund.find({ userId }).lean();
    } catch (error) {
      console.error('Error obteniendo reembolsos de usuario:', error);
    }
  }
  const refunds = await loadRefunds();
  return refunds.filter(r => r.userId === userId);
}

// Obtener todos los reembolsos (para admin)
async function getAllRefunds() {
  return await loadRefunds();
}

// Verificar si el usuario puede reclamar reembolso diario
async function canClaimDailyRefund(userId) {
  const refunds = await loadRefunds();
  const today = new Date().toDateString();
  
  const lastDaily = refunds
    .filter(r => r.userId === userId && r.type === 'daily')
    .sort((a, b) => new Date(b.date) - new Date(a.date))[0];
  
  if (!lastDaily) return { canClaim: true, nextClaim: null };
  
  const lastDate = new Date(lastDaily.date).toDateString();
  const canClaim = lastDate !== today;
  
  // Calcular próximo reclamo (mañana a las 00:00)
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  
  return {
    canClaim,
    nextClaim: canClaim ? null : tomorrow.toISOString(),
    lastClaim: lastDaily.date
  };
}

// Verificar si el usuario puede reclamar reembolso semanal
async function canClaimWeeklyRefund(userId) {
  const refunds = await loadRefunds();
  const now = new Date();
  const currentDay = now.getDay(); // 0 = Domingo, 1 = Lunes, 2 = Martes
  
  // Solo puede reclamar lunes (1) o martes (2)
  const canClaimByDay = currentDay === 1 || currentDay === 2;
  
  // Verificar si ya reclamó esta semana
  const currentWeekStart = new Date(now);
  currentWeekStart.setDate(now.getDate() - currentDay + 1); // Lunes de esta semana
  currentWeekStart.setHours(0, 0, 0, 0);
  
  const lastWeekly = refunds
    .filter(r => r.userId === userId && r.type === 'weekly')
    .sort((a, b) => new Date(b.date) - new Date(a.date))[0];
  
  let canClaim = canClaimByDay;
  
  if (lastWeekly) {
    const lastDate = new Date(lastWeekly.date);
    // Si ya reclamó esta semana, no puede reclamar de nuevo
    if (lastDate >= currentWeekStart) {
      canClaim = false;
    }
  }
  
  // Calcular próximo reclamo (próximo lunes)
  const nextMonday = new Date(now);
  const daysUntilMonday = currentDay === 0 ? 1 : 8 - currentDay;
  nextMonday.setDate(now.getDate() + daysUntilMonday);
  nextMonday.setHours(0, 0, 0, 0);
  
  return {
    canClaim,
    nextClaim: canClaim ? null : nextMonday.toISOString(),
    lastClaim: lastWeekly?.date || null,
    availableDays: 'Lunes y Martes'
  };
}

// Verificar si el usuario puede reclamar reembolso mensual
async function canClaimMonthlyRefund(userId) {
  const refunds = await loadRefunds();
  const now = new Date();
  const currentDay = now.getDate();
  
  // Solo puede reclamar del día 7 en adelante
  const canClaimByDay = currentDay >= 7;
  
  // Verificar si ya reclamó este mes
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  
  const lastMonthly = refunds
    .filter(r => r.userId === userId && r.type === 'monthly')
    .sort((a, b) => new Date(b.date) - new Date(a.date))[0];
  
  let canClaim = canClaimByDay;
  
  if (lastMonthly) {
    const lastDate = new Date(lastMonthly.date);
    // Si ya reclamó este mes, no puede reclamar de nuevo
    if (lastDate >= currentMonthStart) {
      canClaim = false;
    }
  }
  
  // Calcular próximo reclamo (día 7 del próximo mes)
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 7);
  nextMonth.setHours(0, 0, 0, 0);
  
  return {
    canClaim,
    nextClaim: canClaim ? null : nextMonth.toISOString(),
    lastClaim: lastMonthly?.date || null,
    availableFrom: 'Día 7 de cada mes'
  };
}

// Registrar un reembolso
async function recordRefund(userId, username, type, amount, netAmount, deposits, withdrawals) {
  const refund = {
    id: require('uuid').v4(),
    userId,
    username,
    type,
    amount,
    netAmount,
    deposits,
    withdrawals,
    date: new Date().toISOString(),
    status: 'claimed'
  };
  
  if (isConnected()) {
    try {
      await Refund.create(refund);
      return refund;
    } catch (error) {
      console.error('Error registrando reembolso en MongoDB:', error);
    }
  }
  
  const refunds = await loadRefunds();
  refunds.push(refund);
  await saveRefunds(refunds);
  return refund;
}

// Calcular reembolso
function calculateRefund(deposits, withdrawals, percentage) {
  const netAmount = Math.max(0, deposits - withdrawals);
  const refundAmount = netAmount * (percentage / 100);
  return {
    netAmount,
    refundAmount: Math.round(refundAmount),
    percentage
  };
}

module.exports = {
  loadRefunds,
  saveRefunds,
  getUserRefunds,
  getAllRefunds,
  canClaimDailyRefund,
  canClaimWeeklyRefund,
  canClaimMonthlyRefund,
  recordRefund,
  calculateRefund
};
