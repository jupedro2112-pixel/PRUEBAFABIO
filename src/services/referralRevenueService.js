/**
 * Servicio de Ingresos de Referidos
 * Consulta el endpoint royalty-statistics de JUGAYGANA
 * para calcular el revenue mensual por usuario referido.
 */
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const logger = require('../utils/logger');
const { getPeriodRange } = require('../utils/periodKey');

const ADMIN_API_URL = process.env.JUGAYGANA_ADMIN_REPORTS_URL ||
  'https://admin.agentesadmin.bet/api/v2/admin/reports/royalty-statistics';
const PROXY_URL = process.env.PROXY_URL || '';
const PLATFORM_USER = process.env.PLATFORM_USER;
const PLATFORM_PASS = process.env.PLATFORM_PASS;
const API_URL = process.env.JUGAYGANA_API_URL || 'https://admin.agentesadmin.bet/api/admin/';
const TOKEN_TTL_MINUTES = parseInt(process.env.TOKEN_TTL_MINUTES || '20', 10);

let sessionToken = null;
let sessionCookie = null;
let lastLogin = 0;

let httpsAgent = null;
if (PROXY_URL) {
  httpsAgent = new HttpsProxyAgent(PROXY_URL);
}

const authClient = axios.create({
  baseURL: API_URL,
  timeout: 20000,
  httpsAgent,
  proxy: false,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Content-Type': 'application/x-www-form-urlencoded',
    'Origin': 'https://admin.agentesadmin.bet',
    'Referer': 'https://admin.agentesadmin.bet/users',
    'Accept-Language': 'es-419,es;q=0.9'
  }
});

const reportsClient = axios.create({
  timeout: 30000,
  httpsAgent,
  proxy: false,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'Origin': 'https://admin.agentesadmin.bet',
    'Referer': 'https://admin.agentesadmin.bet/',
    'Accept-Language': 'es-419,es;q=0.9'
  }
});

const toFormUrlEncoded = (data) => {
  return Object.keys(data)
    .filter(k => data[k] !== undefined && data[k] !== null)
    .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(data[k]))
    .join('&');
};

const parseJson = (data) => {
  if (typeof data !== 'string') return data;
  try {
    return JSON.parse(data.substring(data.indexOf('{'), data.lastIndexOf('}') + 1));
  } catch {
    return data;
  }
};

const isHtmlBlocked = (data) => {
  return typeof data === 'string' && data.trim().startsWith('<');
};

/**
 * Login para obtener token de sesión
 */
async function ensureSession() {
  if (!PLATFORM_USER || !PLATFORM_PASS) {
    logger.error('[ReferralRevenue] Faltan credenciales de JUGAYGANA');
    return false;
  }
  const expired = Date.now() - lastLogin > TOKEN_TTL_MINUTES * 60 * 1000;
  if (sessionToken && !expired) return true;

  try {
    const body = toFormUrlEncoded({
      action: 'LOGIN',
      username: PLATFORM_USER,
      password: PLATFORM_PASS
    });
    const resp = await authClient.post('', body, {
      validateStatus: s => s >= 200 && s < 500,
      maxRedirects: 0
    });

    if (resp.headers['set-cookie']) {
      sessionCookie = resp.headers['set-cookie'].map(c => c.split(';')[0]).join('; ');
    }

    const data = parseJson(resp.data);
    if (isHtmlBlocked(data)) {
      logger.error('[ReferralRevenue] Login bloqueado (HTML)');
      return false;
    }

    const token = data?.token || data?.access_token || data?.sessionToken || data?.data?.token;
    if (!token) {
      logger.error('[ReferralRevenue] Login falló: no se recibió token');
      return false;
    }

    sessionToken = token;
    lastLogin = Date.now();
    logger.info('[ReferralRevenue] Login exitoso');
    return true;
  } catch (err) {
    logger.error('[ReferralRevenue] Error en login:', err.message);
    return false;
  }
}

/**
 * Consultar royalty-statistics para un usuario y período
 * @param {string} username - username en JUGAYGANA
 * @param {string} periodKey - e.g. "2026-04"
 * @returns {Object} resultado de revenue calculado
 */
async function getUserRevenueForPeriod(username, periodKey) {
  const ok = await ensureSession();
  if (!ok) {
    return { success: false, error: 'No hay sesión válida en JUGAYGANA' };
  }

  const { fromEpoch, toEpoch, fromDate, toDate } = getPeriodRange(periodKey);

  try {
    const headers = {
      Authorization: `Bearer ${sessionToken}`
    };
    if (sessionCookie) headers.Cookie = sessionCookie;

    // El endpoint acepta filtros por username y rango de fechas
    const params = {
      username,
      from: fromEpoch,
      to: toEpoch,
      currency: 'ARS'
    };

    logger.info(`[ReferralRevenue] Consultando royalty-statistics para ${username} período ${periodKey}`);

    const resp = await reportsClient.get(ADMIN_API_URL, {
      headers,
      params,
      validateStatus: () => true
    });

    if (resp.status !== 200) {
      logger.warn(`[ReferralRevenue] Respuesta HTTP ${resp.status} para ${username}`);
      // Sesión puede haber expirado
      if (resp.status === 401 || resp.status === 403) {
        sessionToken = null;
        lastLogin = 0;
      }
      return { success: false, error: `HTTP ${resp.status}` };
    }

    const data = resp.data;

    if (!data || !data.success) {
      logger.warn(`[ReferralRevenue] Respuesta no exitosa para ${username}: ${JSON.stringify(data)?.substring(0, 200)}`);
      return { success: false, error: 'Respuesta no exitosa del endpoint' };
    }

    return parseRoyaltyResponse(data, username, periodKey);
  } catch (err) {
    logger.error(`[ReferralRevenue] Error consultando royalty-statistics para ${username}:`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Parsear la respuesta del endpoint royalty-statistics y calcular revenue
 * @param {Object} data - respuesta cruda del endpoint
 * @param {string} username
 * @param {string} periodKey
 * @returns {Object}
 */
function parseRoyaltyResponse(data, username, periodKey) {
  try {
    const currency = 'ARS';
    const totals = data?.data?.totals?.[currency] || {};
    const providers = data?.data?.providers || [];

    const totalBets = Number(totals.total_bets || 0) / 100;
    const totalWins = Number(totals.total_wins || 0) / 100;
    const totalGgr = Number(totals.total_ggr || 0) / 100;

    const providersBreakdown = [];
    let totalOwnerRevenue = 0;

    for (const provider of providers) {
      const stats = provider?.stats_by_currency?.[currency];
      if (!stats) continue;

      const ggr = Number(stats.ggr || 0) / 100;
      const ownerCommissionRate = Number(stats.owner_commission || 0);

      if (typeof ownerCommissionRate !== 'number' || isNaN(ownerCommissionRate)) {
        logger.warn(`[ReferralRevenue] owner_commission inválido para provider ${provider.name}, usuario ${username}`);
        continue;
      }

      // Solo revenue positivo genera comisión
      const providerOwnerRevenue = Math.max(0, ggr) * ownerCommissionRate;

      providersBreakdown.push({
        providerName: provider.name || 'unknown',
        ggr,
        ownerCommissionRate,
        ownerRevenue: providerOwnerRevenue
      });

      totalOwnerRevenue += providerOwnerRevenue;
    }

    logger.info(
      `[ReferralRevenue] ${username} período ${periodKey}: ` +
      `GGR=$${totalGgr.toFixed(2)}, ownerRevenue=$${totalOwnerRevenue.toFixed(2)}`
    );

    return {
      success: true,
      username,
      period: periodKey,
      currency,
      totalBets,
      totalWins,
      totalGgr,
      providers: providersBreakdown,
      totalOwnerRevenue
    };
  } catch (err) {
    logger.error(`[ReferralRevenue] Error parseando respuesta para ${username}:`, err.message);
    return { success: false, error: `Error parseando respuesta: ${err.message}` };
  }
}

module.exports = {
  getUserRevenueForPeriod
};
