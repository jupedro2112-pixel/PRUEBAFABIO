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
    
    // Debug: mostrar la respuesta completa
    console.log(`📊 Respuesta de movimientos para ${username}:`, JSON.stringify(data).substring(0, 500));
    
    // Intentar diferentes formatos de respuesta
    let movements = null;
    
    // Buscar en diferentes propiedades posibles
    if (data.movements && Array.isArray(data.movements)) {
      movements = data.movements;
    } else if (data.data && Array.isArray(data.data)) {
      movements = data.data;
    } else if (data.Movements && Array.isArray(data.Movements)) {
      movements = data.Movements;
    } else if (data.Data && Array.isArray(data.Data)) {
      movements = data.Data;
    } else if (data.items && Array.isArray(data.items)) {
      movements = data.items;
    } else if (data.records && Array.isArray(data.records)) {
      movements = data.records;
    } else if (data.result && Array.isArray(data.result)) {
      movements = data.result;
    }
    
    // Si no se encontró array, buscar en el objeto raíz
    if (!movements) {
      for (const key of Object.keys(data)) {
        if (Array.isArray(data[key]) && data[key].length > 0) {
          movements = data[key];
          console.log(`📊 Encontrados movimientos en propiedad: ${key}`);
          break;
        }
      }
    }
    
    // Si no hay movimientos, devolver array vacío
    movements = movements || [];
    
    console.log(`📊 Movimientos obtenidos para ${username}: ${movements.length} items`);
    if (movements.length > 0) {
      console.log(`📊 Primer movimiento:`, JSON.stringify(movements[0]).substring(0, 200));
    }
    
    return {
      success: true,
      movements,
      total: data.total || data.Total || data.count || data.Count || movements.length,
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
  
  // Separar depósitos y retiros - manejar diferentes formatos
  const movements = result.movements || [];
  
  console.log(`📊 Procesando ${movements.length} movimientos para ${username}`);
  
  const deposits = [];
  const withdrawals = [];
  
  for (const m of movements) {
    // Intentar obtener el tipo de operación de diferentes propiedades
    const type = (m.type || m.operation || m.OperationType || m.Type || m.Operation || '').toString().toLowerCase();
    
    // Intentar obtener el monto de diferentes propiedades
    let amount = 0;
    if (m.amount !== undefined) amount = parseFloat(m.amount);
    else if (m.Amount !== undefined) amount = parseFloat(m.Amount);
    else if (m.value !== undefined) amount = parseFloat(m.value);
    else if (m.Value !== undefined) amount = parseFloat(m.Value);
    else if (m.monto !== undefined) amount = parseFloat(m.monto);
    else if (m.Monto !== undefined) amount = parseFloat(m.Monto);
    
    // Determinar si es depósito o retiro
    const isDeposit = type.includes('deposit') || type.includes('credit') || type.includes('carga') || type.includes('recarga') || amount > 0;
    const isWithdrawal = type.includes('withdraw') || type.includes('debit') || type.includes('retiro') || type.includes('extraccion') || amount < 0;
    
    if (isDeposit) {
      deposits.push({...m, parsedAmount: Math.abs(amount)});
    } else if (isWithdrawal) {
      withdrawals.push({...m, parsedAmount: Math.abs(amount)});
    }
  }
  
  const totalDeposits = deposits.reduce((sum, m) => sum + (m.parsedAmount || 0), 0);
  const totalWithdrawals = withdrawals.reduce((sum, m) => sum + (m.parsedAmount || 0), 0);
  
  console.log(`📊 ${username} - ${dateStr}: Depósitos $${totalDeposits} (${deposits.length} items), Retiros $${totalWithdrawals} (${withdrawals.length} items)`);
  
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
      amount: Math.round(amount * 100), // API espera centavos
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
      amount: Math.round(amount * 100), // API espera centavos
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
