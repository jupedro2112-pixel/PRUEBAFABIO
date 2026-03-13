// ============================================
// MOVIMIENTOS JUGAYGANA - DEPÓSITOS Y RETIROS
// ============================================

const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const jugaygana = require('./jugaygana');

const PROXY_URL = process.env.PROXY_URL || '';
const API_URL = 'https://admin.agentesadmin.bet/api/admin/';

let httpsAgent = null;
if (PROXY_URL) {
  httpsAgent = new HttpsProxyAgent(PROXY_URL);
}

function toFormUrlEncoded(data) {
  return Object.keys(data)
    .filter(k => data[k] !== undefined && data[k] !== null)
    .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(data[k]))
    .join('&');
}

function parsePossiblyWrappedJson(data) {
  if (typeof data !== 'string') return data;
  try {
    return JSON.parse(data.substring(data.indexOf('{'), data.lastIndexOf('}') + 1));
  } catch {
    return data;
  }
}

function isHtmlBlocked(data) {
  return typeof data === 'string' && data.trim().startsWith('<');
}

// ============================================
// OBTENER MOVIMIENTOS DE UN USUARIO
// ============================================

async function getUserMovements(username, options = {}) {
  const { 
    startDate, 
    endDate, 
    operationType = 'all', // 'all', 'deposit', 'withdrawal'
    page = 1, 
    pageSize = 100 
  } = options;
  
  const sessionOk = await jugaygana.ensureSession();
  if (!sessionOk) {
    return { success: false, error: 'No hay sesión válida' };
  }
  
  try {
    const params = {
      action: 'ShowUserMovements',
      token: jugaygana.SESSION_TOKEN,
      username,
      page,
      pagesize: pageSize
    };
    
    if (startDate) params.startdate = startDate;
    if (endDate) params.enddate = endDate;
    if (operationType !== 'all') params.operationtype = operationType;
    
    const body = toFormUrlEncoded(params);
    
    const headers = {};
    if (jugaygana.SESSION_COOKIE) headers.Cookie = jugaygana.SESSION_COOKIE;
    
    const resp = await axios.post(API_URL, body, {
      httpsAgent,
      proxy: false,
      headers: {
        ...headers,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json, text/plain, */*'
      },
      timeout: 30000
    });
    
    let data = parsePossiblyWrappedJson(resp.data);
    if (isHtmlBlocked(data)) {
      return { success: false, error: 'IP bloqueada / respuesta HTML' };
    }
    
    const movements = data.movements || data.data || [];
    
    return {
      success: true,
      movements,
      total: data.total || movements.length,
      page,
      pageSize
    };
  } catch (error) {
    console.error('Error obteniendo movimientos:', error.message);
    return { success: false, error: error.message };
  }
}

// ============================================
// OBTENER DEPÓSITOS Y RETIROS DE UN DÍA ESPECÍFICO
// ============================================

async function getDailyMovements(username, date) {
  const dateStr = typeof date === 'string' ? date : date.toISOString().split('T')[0];
  
  const result = await getUserMovements(username, {
    startDate: dateStr,
    endDate: dateStr,
    pageSize: 500
  });
  
  if (!result.success) {
    return result;
  }
  
  // Separar depósitos y retiros
  const deposits = result.movements.filter(m => 
    m.type === 'deposit' || m.operation === 'deposit' || m.amount > 0
  );
  
  const withdrawals = result.movements.filter(m => 
    m.type === 'withdrawal' || m.operation === 'withdrawal' || m.amount < 0
  );
  
  const totalDeposits = deposits.reduce((sum, m) => sum + Math.abs(parseFloat(m.amount || 0)), 0);
  const totalWithdrawals = withdrawals.reduce((sum, m) => sum + Math.abs(parseFloat(m.amount || 0)), 0);
  
  return {
    success: true,
    date: dateStr,
    deposits: {
      count: deposits.length,
      total: totalDeposits,
      items: deposits
    },
    withdrawals: {
      count: withdrawals.length,
      total: totalWithdrawals,
      items: withdrawals
    },
    netAmount: totalDeposits - totalWithdrawals
  };
}

// ============================================
// OBTENER MOVIMIENTOS DE AYER (para reembolsos)
// ============================================

async function getYesterdayMovements(username) {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  
  return await getDailyMovements(username, yesterday);
}

// ============================================
// REALIZAR DEPÓSITO
// ============================================

async function makeDeposit(username, amount, description = '') {
  if (!amount || amount <= 0) {
    return { success: false, error: 'Monto inválido' };
  }
  
  const sessionOk = await jugaygana.ensureSession();
  if (!sessionOk) {
    return { success: false, error: 'No hay sesión válida' };
  }
  
  try {
    const body = toFormUrlEncoded({
      action: 'MakeDeposit',
      token: jugaygana.SESSION_TOKEN,
      username,
      amount: Math.round(amount), // API espera centavos
      description: description || 'Depósito desde Sala de Juegos'
    });
    
    const headers = {};
    if (jugaygana.SESSION_COOKIE) headers.Cookie = jugaygana.SESSION_COOKIE;
    
    const resp = await axios.post(API_URL, body, {
      httpsAgent,
      proxy: false,
      headers: {
        ...headers,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 30000
    });
    
    let data = parsePossiblyWrappedJson(resp.data);
    if (isHtmlBlocked(data)) {
      return { success: false, error: 'IP bloqueada / respuesta HTML' };
    }
    
    if (data.success || data.status === 'success') {
      return {
        success: true,
        message: 'Depósito realizado correctamente',
        newBalance: data.new_balance || data.balance,
        transactionId: data.transaction_id || data.id
      };
    } else {
      return {
        success: false,
        error: data.error || data.message || 'Error al realizar depósito'
      };
    }
  } catch (error) {
    console.error('Error en depósito:', error.message);
    return { success: false, error: error.message };
  }
}

// ============================================
// REALIZAR RETIRO
// ============================================

async function makeWithdrawal(username, amount, description = '') {
  if (!amount || amount <= 0) {
    return { success: false, error: 'Monto inválido' };
  }
  
  const sessionOk = await jugaygana.ensureSession();
  if (!sessionOk) {
    return { success: false, error: 'No hay sesión válida' };
  }
  
  try {
    const body = toFormUrlEncoded({
      action: 'MakeWithdrawal',
      token: jugaygana.SESSION_TOKEN,
      username,
      amount: Math.round(amount), // API espera centavos
      description: description || 'Retiro desde Sala de Juegos'
    });
    
    const headers = {};
    if (jugaygana.SESSION_COOKIE) headers.Cookie = jugaygana.SESSION_COOKIE;
    
    const resp = await axios.post(API_URL, body, {
      httpsAgent,
      proxy: false,
      headers: {
        ...headers,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 30000
    });
    
    let data = parsePossiblyWrappedJson(resp.data);
    if (isHtmlBlocked(data)) {
      return { success: false, error: 'IP bloqueada / respuesta HTML' };
    }
    
    if (data.success || data.status === 'success') {
      return {
        success: true,
        message: 'Retiro realizado correctamente',
        newBalance: data.new_balance || data.balance,
        transactionId: data.transaction_id || data.id
      };
    } else {
      return {
        success: false,
        error: data.error || data.message || 'Error al realizar retiro'
      };
    }
  } catch (error) {
    console.error('Error en retiro:', error.message);
    return { success: false, error: error.message };
  }
}

// ============================================
// OBTENER BALANCE DE USUARIO
// ============================================

async function getUserBalance(username) {
  const userInfo = await jugaygana.getUserInfoByName(username);
  
  if (!userInfo) {
    return { success: false, error: 'Usuario no encontrado' };
  }
  
  return {
    success: true,
    balance: userInfo.balance || 0,
    username: userInfo.username,
    userId: userInfo.id
  };
}

module.exports = {
  getUserMovements,
  getDailyMovements,
  getYesterdayMovements,
  makeDeposit,
  makeWithdrawal,
  getUserBalance
};
