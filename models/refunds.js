// ============================================
// MODELO DE REEMBOLSOS - CON VERIFICACIÓN EN MONGODB
// ============================================

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

// Importar el modelo Refund desde database.js
const { Refund } = require('../database');

const DATA_DIR = process.env.VERCEL ? '/tmp/data' : path.join(__dirname, '../data');
const REFUNDS_FILE = path.join(DATA_DIR, 'refunds.json');

// Asegurar que exista el archivo
try {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(REFUNDS_FILE)) {
    fs.writeFileSync(REFUNDS_FILE, JSON.stringify([], null, 2));
  }
} catch (error) {
  console.error('Error creando archivo de reembolsos:', error);
}

// ============================================
// FUNCIONES AUXILIARES DE FECHAS - UTC
// ============================================

// Obtener inicio del día actual en UTC
function getStartOfTodayUTC() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
}

// Obtener fin del día actual en UTC
function getEndOfTodayUTC() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));
}

// Obtener inicio de la semana actual (lunes) en UTC
function getStartOfWeekUTC() {
  const now = new Date();
  const dayOfWeek = now.getUTCDay(); // 0 = domingo, 1 = lunes
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() - daysSinceMonday);
  return new Date(Date.UTC(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate(), 0, 0, 0, 0));
}

// Obtener inicio del mes actual en UTC
function getStartOfMonthUTC() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}

// Formatear fecha para logs
function formatDate(date) {
  return date.toISOString();
}

async function loadRefunds() {
  // Primero intentar cargar de MongoDB
  if (mongoose.connection.readyState === 1) {
    try {
      const refunds = await Refund.find().lean();
      if (refunds && refunds.length > 0) {
        fs.writeFileSync(REFUNDS_FILE, JSON.stringify(refunds, null, 2));
        return refunds;
      }
    } catch (err) {
      console.error('Error cargando reembolsos de MongoDB:', err.message);
    }
  }
  // Fallback a archivo
  try {
    const data = fs.readFileSync(REFUNDS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return [];
  }
}

async function saveRefunds(refunds) {
  fs.writeFileSync(REFUNDS_FILE, JSON.stringify(refunds, null, 2));
  
  // Guardar en MongoDB
  if (mongoose.connection.readyState === 1) {
    try {
      await Refund.deleteMany({});
      if (refunds.length > 0) {
        await Refund.insertMany(refunds);
      }
      console.log(`✅ ${refunds.length} reembolsos guardados en MongoDB`);
    } catch (err) {
      console.error('Error guardando reembolsos en MongoDB:', err.message);
    }
  }
}

// Obtener reembolsos de un usuario
async function getUserRefunds(userId) {
  // Primero intentar desde MongoDB
  if (mongoose.connection.readyState === 1) {
    try {
      return await Refund.find({ userId }).sort({ date: -1 }).lean();
    } catch (err) {
      console.error('Error obteniendo reembolsos de MongoDB:', err.message);
    }
  }
  // Fallback a archivo
  const refunds = await loadRefunds();
  return refunds.filter(r => r.userId === userId);
}

// Obtener todos los reembolsos (para admin)
async function getAllRefunds() {
  // Primero intentar desde MongoDB
  if (mongoose.connection.readyState === 1) {
    try {
      return await Refund.find().sort({ date: -1 }).lean();
    } catch (err) {
      console.error('Error obteniendo todos los reembolsos de MongoDB:', err.message);
    }
  }
  // Fallback a archivo
  return await loadRefunds();
}

// ============================================
// VERIFICACIÓN EN MONGODB - CLAVE PARA BLOQUEO
// ============================================

// Verificar si el usuario ya reclamó reembolso diario hoy (en MongoDB)
async function hasClaimedDailyToday(userId) {
  console.log(`🔍 Verificando reembolso diario para userId: ${userId}`);
  
  if (mongoose.connection.readyState !== 1) {
    console.log('⚠️ MongoDB no conectado, usando archivo local para verificación');
    // Fallback a archivo
    const refunds = await loadRefunds();
    const today = getStartOfTodayUTC();
    
    const lastDaily = refunds
      .filter(r => r.userId === userId && r.type === 'daily')
      .sort((a, b) => new Date(b.date) - new Date(a.date))[0];
    
    if (!lastDaily) {
      console.log('📭 No se encontró reembolso diario previo en archivo');
      return false;
    }
    
    const lastDate = new Date(lastDaily.date);
    const isToday = lastDate >= today && lastDate <= getEndOfTodayUTC();
    console.log(`📅 Último reembolso: ${formatDate(lastDate)}, ¿Es hoy? ${isToday}`);
    return isToday;
  }

  try {
    const startOfDay = getStartOfTodayUTC();
    const endOfDay = getEndOfTodayUTC();
    
    console.log(`🔍 Buscando en MongoDB - userId: ${userId}, type: daily`);
    console.log(`📅 Rango: ${formatDate(startOfDay)} hasta ${formatDate(endOfDay)}`);
    
    const existingRefund = await Refund.findOne({
      userId: userId,
      type: 'daily',
      date: {
        $gte: startOfDay,
        $lte: endOfDay
      }
    });
    
    if (existingRefund) {
      console.log(`🚫 Usuario ${userId} ya reclamó reembolso diario hoy (encontrado en MongoDB)`);
      console.log(`📄 Documento encontrado: ${JSON.stringify(existingRefund)}`);
      return true;
    }
    
    console.log(`✅ Usuario ${userId} NO ha reclamado reembolso diario hoy`);
    return false;
  } catch (err) {
    console.error('❌ Error verificando reembolso diario en MongoDB:', err.message);
    return false;
  }
}

// Verificar si el usuario ya reclamó reembolso semanal esta semana (en MongoDB)
async function hasClaimedWeeklyThisWeek(userId) {
  console.log(`🔍 Verificando reembolso semanal para userId: ${userId}`);
  
  if (mongoose.connection.readyState !== 1) {
    console.log('⚠️ MongoDB no conectado, usando archivo local para verificación');
    // Fallback a archivo
    const refunds = await loadRefunds();
    const weekStart = getStartOfWeekUTC();
    
    const lastWeekly = refunds
      .filter(r => r.userId === userId && r.type === 'weekly')
      .sort((a, b) => new Date(b.date) - new Date(a.date))[0];
    
    if (!lastWeekly) return false;
    const lastDate = new Date(lastWeekly.date);
    return lastDate >= weekStart;
  }

  try {
    const weekStart = getStartOfWeekUTC();
    
    console.log(`🔍 Buscando en MongoDB - userId: ${userId}, type: weekly, desde: ${formatDate(weekStart)}`);
    
    const existingRefund = await Refund.findOne({
      userId: userId,
      type: 'weekly',
      date: {
        $gte: weekStart
      }
    });
    
    if (existingRefund) {
      console.log(`🚫 Usuario ${userId} ya reclamó reembolso semanal esta semana (encontrado en MongoDB)`);
      return true;
    }
    return false;
  } catch (err) {
    console.error('❌ Error verificando reembolso semanal en MongoDB:', err.message);
    return false;
  }
}

// Verificar si el usuario ya reclamó reembolso mensual este mes (en MongoDB)
async function hasClaimedMonthlyThisMonth(userId) {
  console.log(`🔍 Verificando reembolso mensual para userId: ${userId}`);
  
  if (mongoose.connection.readyState !== 1) {
    console.log('⚠️ MongoDB no conectado, usando archivo local para verificación');
    // Fallback a archivo
    const refunds = await loadRefunds();
    const monthStart = getStartOfMonthUTC();
    
    const lastMonthly = refunds
      .filter(r => r.userId === userId && r.type === 'monthly')
      .sort((a, b) => new Date(b.date) - new Date(a.date))[0];
    
    if (!lastMonthly) return false;
    const lastDate = new Date(lastMonthly.date);
    return lastDate >= monthStart;
  }

  try {
    const monthStart = getStartOfMonthUTC();
    
    console.log(`🔍 Buscando en MongoDB - userId: ${userId}, type: monthly, desde: ${formatDate(monthStart)}`);
    
    const existingRefund = await Refund.findOne({
      userId: userId,
      type: 'monthly',
      date: {
        $gte: monthStart
      }
    });
    
    if (existingRefund) {
      console.log(`🚫 Usuario ${userId} ya reclamó reembolso mensual este mes (encontrado en MongoDB)`);
      return true;
    }
    return false;
  } catch (err) {
    console.error('❌ Error verificando reembolso mensual en MongoDB:', err.message);
    return false;
  }
}

// ============================================
// FUNCIONES PÚBLICAS DE VERIFICACIÓN
// ============================================

// Verificar si el usuario puede reclamar reembolso diario
async function canClaimDailyRefund(userId) {
  console.log(`🔍 canClaimDailyRefund llamado para userId: ${userId}`);
  
  // PRIMERO: Verificar en MongoDB si ya reclamó hoy
  const alreadyClaimed = await hasClaimedDailyToday(userId);
  
  if (alreadyClaimed) {
    // Calcular próximo reclamo (mañana a las 00:00 UTC)
    const tomorrow = getStartOfTodayUTC();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    
    console.log(`🚫 Bloqueando reclamo - Ya reclamó hoy. Próximo: ${formatDate(tomorrow)}`);
    
    return {
      canClaim: false,
      nextClaim: tomorrow.toISOString(),
      lastClaim: new Date().toISOString(),
      message: 'Ya reclamaste tu reembolso diario hoy. Vuelve mañana!'
    };
  }
  
  // Si no reclamó hoy, puede reclamar
  console.log(`✅ Permitido reclamar reembolso diario para userId: ${userId}`);
  return {
    canClaim: true,
    nextClaim: null,
    lastClaim: null
  };
}

// Verificar si el usuario puede reclamar reembolso semanal
async function canClaimWeeklyRefund(userId) {
  const now = new Date();
  const currentDay = now.getDay(); // 0 = Domingo, 1 = Lunes, 2 = Martes
  
  // Solo puede reclamar lunes (1) o martes (2)
  const canClaimByDay = currentDay === 1 || currentDay === 2;
  
  if (!canClaimByDay) {
    // Calcular próximo lunes
    const nextMonday = new Date(now);
    const daysUntilMonday = currentDay === 0 ? 1 : 8 - currentDay;
    nextMonday.setDate(now.getDate() + daysUntilMonday);
    nextMonday.setHours(0, 0, 0, 0);
    
    return {
      canClaim: false,
      nextClaim: nextMonday.toISOString(),
      lastClaim: null,
      availableDays: 'Lunes y Martes',
      message: 'El reembolso semanal solo está disponible los lunes y martes.'
    };
  }
  
  // PRIMERO: Verificar en MongoDB si ya reclamó esta semana
  const alreadyClaimed = await hasClaimedWeeklyThisWeek(userId);
  
  if (alreadyClaimed) {
    // Calcular próximo lunes
    const nextMonday = new Date(now);
    const daysUntilMonday = currentDay === 0 ? 1 : 8 - currentDay;
    nextMonday.setDate(now.getDate() + daysUntilMonday);
    nextMonday.setHours(0, 0, 0, 0);
    
    return {
      canClaim: false,
      nextClaim: nextMonday.toISOString(),
      lastClaim: new Date().toISOString(),
      availableDays: 'Lunes y Martes',
      message: 'Ya reclamaste tu reembolso semanal esta semana. Vuelve el próximo lunes!'
    };
  }
  
  return {
    canClaim: true,
    nextClaim: null,
    lastClaim: null,
    availableDays: 'Lunes y Martes'
  };
}

// Verificar si el usuario puede reclamar reembolso mensual
async function canClaimMonthlyRefund(userId) {
  const now = new Date();
  const currentDay = now.getDate();
  
  // Solo puede reclamar del día 7 en adelante
  const canClaimByDay = currentDay >= 7;
  
  if (!canClaimByDay) {
    // Calcular día 7 del mes actual
    const nextAvailable = new Date(now.getFullYear(), now.getMonth(), 7);
    nextAvailable.setHours(0, 0, 0, 0);
    
    return {
      canClaim: false,
      nextClaim: nextAvailable.toISOString(),
      lastClaim: null,
      availableFrom: 'Día 7 de cada mes',
      message: 'El reembolso mensual está disponible a partir del día 7 de cada mes.'
    };
  }
  
  // PRIMERO: Verificar en MongoDB si ya reclamó este mes
  const alreadyClaimed = await hasClaimedMonthlyThisMonth(userId);
  
  if (alreadyClaimed) {
    // Calcular día 7 del próximo mes
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 7);
    nextMonth.setHours(0, 0, 0, 0);
    
    return {
      canClaim: false,
      nextClaim: nextMonth.toISOString(),
      lastClaim: new Date().toISOString(),
      availableFrom: 'Día 7 de cada mes',
      message: 'Ya reclamaste tu reembolso mensual este mes. Vuelve el día 7 del próximo mes!'
    };
  }
  
  return {
    canClaim: true,
    nextClaim: null,
    lastClaim: null,
    availableFrom: 'Día 7 de cada mes'
  };
}

// Registrar un reembolso
async function recordRefund(userId, username, type, amount, netAmount, deposits, withdrawals) {
  const refundId = uuidv4();
  
  const refund = {
    id: refundId,
    userId: String(userId), // Asegurar que sea string
    username: String(username),
    type: type,
    amount: Number(amount),
    netAmount: Number(netAmount),
    deposits: Number(deposits) || 0,
    withdrawals: Number(withdrawals) || 0,
    date: new Date(), // UTC
    status: 'claimed'
  };
  
  console.log(`💾 Guardando reembolso: ${JSON.stringify(refund)}`);
  
  // Guardar en archivo local primero
  const refunds = await loadRefunds();
  refunds.push(refund);
  await saveRefunds(refunds);
  
  // Guardar en MongoDB si está conectado
  if (mongoose.connection.readyState === 1) {
    try {
      const saved = await Refund.create(refund);
      console.log(`✅ Reembolso ${type} guardado en MongoDB para usuario ${username}, ID: ${saved._id}`);
    } catch (err) {
      console.error('❌ Error guardando reembolso en MongoDB:', err.message);
    }
  }
  
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
  calculateRefund,
  // Exportar funciones internas para testing
  hasClaimedDailyToday,
  hasClaimedWeeklyThisWeek,
  hasClaimedMonthlyThisMonth,
  // Exportar funciones de fecha para debug
  getStartOfTodayUTC,
  getEndOfTodayUTC,
  getStartOfWeekUTC,
  getStartOfMonthUTC
};
