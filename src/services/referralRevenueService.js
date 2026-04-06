/**
 * Servicio de Ingresos de Referidos
 * Consulta el endpoint royalty-statistics de JUGAYGANA
 * para calcular el revenue mensual por usuario referido.
 *
 * Variables de entorno relevantes:
 *   JUGAYGANA_ADMIN_REPORTS_URL      - URL completa del endpoint (default: /api/v2/admin/reports/royalty-statistics)
 *   JUGAYGANA_REVENUE_LOGIN_FIELD    - campo para el usuario en el body ("login", "username", "player" – default: "login")
 *   JUGAYGANA_REVENUE_DATE_FORMAT    - formato de fechas ("iso", "epoch_ms", "epoch_s" – default: "iso")
 *   JUGAYGANA_REVENUE_DATE_FROM_FIELD - nombre del campo fecha inicio en el body (default: "date_from")
 *   JUGAYGANA_REVENUE_DATE_TO_FIELD   - nombre del campo fecha fin en el body (default: "date_to")
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

// Campo que identifica al jugador en el body de revenue ("login" es el estándar en v2 REST)
const ALLOWED_LOGIN_FIELDS = ['login', 'username', 'player'];
const REVENUE_LOGIN_FIELD_RAW = process.env.JUGAYGANA_REVENUE_LOGIN_FIELD || 'login';
const REVENUE_LOGIN_FIELD = ALLOWED_LOGIN_FIELDS.includes(REVENUE_LOGIN_FIELD_RAW)
  ? REVENUE_LOGIN_FIELD_RAW
  : (() => {
      logger.warn(
        `[ReferralRevenue] JUGAYGANA_REVENUE_LOGIN_FIELD="${REVENUE_LOGIN_FIELD_RAW}" no es un valor válido ` +
        `(permitidos: ${ALLOWED_LOGIN_FIELDS.join(', ')}). Usando "login".`
      );
      return 'login';
    })();

// Formato de fechas para el body ("iso" = "YYYY-MM-DD", "epoch_ms" = milisegundos, "epoch_s" = segundos)
const ALLOWED_DATE_FORMATS = ['iso', 'epoch_ms', 'epoch_s'];
const REVENUE_DATE_FORMAT_RAW = process.env.JUGAYGANA_REVENUE_DATE_FORMAT || 'iso';
const REVENUE_DATE_FORMAT = ALLOWED_DATE_FORMATS.includes(REVENUE_DATE_FORMAT_RAW)
  ? REVENUE_DATE_FORMAT_RAW
  : (() => {
      logger.warn(
        `[ReferralRevenue] JUGAYGANA_REVENUE_DATE_FORMAT="${REVENUE_DATE_FORMAT_RAW}" no es un valor válido ` +
        `(permitidos: ${ALLOWED_DATE_FORMATS.join(', ')}). Usando "iso".`
      );
      return 'iso';
    })();

// Nombres de los campos de fecha inicio/fin en el body del endpoint de revenue
// El proveedor externo (JUGAYGANA v2) espera "date_from" y "date_to" (no "from"/"to")
const REVENUE_DATE_FROM_FIELD = process.env.JUGAYGANA_REVENUE_DATE_FROM_FIELD || 'date_from';
const REVENUE_DATE_TO_FIELD = process.env.JUGAYGANA_REVENUE_DATE_TO_FIELD || 'date_to';

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
 * Formatear fechas para el body según REVENUE_DATE_FORMAT
 */
function formatRevenueDate(date, epochSecs) {
  if (REVENUE_DATE_FORMAT === 'epoch_s') {
    return epochSecs;
  }
  if (REVENUE_DATE_FORMAT === 'epoch_ms') {
    return date.getTime();
  }
  // default: "iso" → "YYYY-MM-DD"
  return date.toISOString().split('T')[0];
}

/**
 * Consultar royalty-statistics para un usuario y período
 * @param {string} username - username/login en JUGAYGANA
 * @param {string} periodKey - e.g. "2026-04"
 * @returns {Object} resultado de revenue calculado
 */
async function getUserRevenueForPeriod(username, periodKey) {
  const ok = await ensureSession();
  if (!ok) {
    return { success: false, error: 'No hay sesión válida en JUGAYGANA' };
  }

  const { fromEpoch, toEpoch, fromDate, toDate } = getPeriodRange(periodKey);
  const fromFormatted = formatRevenueDate(fromDate, fromEpoch);
  const toFormatted = formatRevenueDate(toDate, toEpoch);

  try {
    const headers = {
      Authorization: `Bearer ${sessionToken}`,
      'Content-Type': 'application/json'
    };
    if (sessionCookie) headers.Cookie = sessionCookie;

    // Construir el body con el campo de login configurable y fechas en los campos correctos
    // JUGAYGANA v2 REST espera "login" (no "username") y fechas como date_from/date_to en formato "YYYY-MM-DD"
    const body = {
      [REVENUE_LOGIN_FIELD]: username,
      [REVENUE_DATE_FROM_FIELD]: fromFormatted,
      [REVENUE_DATE_TO_FIELD]: toFormatted
    };

    logger.info(
      `[ReferralRevenue] POST royalty-statistics | loginField=${REVENUE_LOGIN_FIELD} ` +
      `usuario=${username} período=${periodKey} ${REVENUE_DATE_FROM_FIELD}=${fromFormatted} ${REVENUE_DATE_TO_FIELD}=${toFormatted} ` +
      `dateFormat=${REVENUE_DATE_FORMAT} endpoint=${ADMIN_API_URL}`
    );
    logger.debug(`[ReferralRevenue] Request body: ${JSON.stringify(body)}`);

    const resp = await reportsClient.post(ADMIN_API_URL, body, {
      headers,
      validateStatus: () => true
    });

    const rawBody = resp.data == null
      ? '(empty)'
      : typeof resp.data === 'string'
        ? resp.data.substring(0, 500)
        : JSON.stringify(resp.data).substring(0, 500);

    if (resp.status !== 200) {
      // Loguear el cuerpo completo de error para facilitar diagnóstico
      logger.warn(
        `[ReferralRevenue] HTTP ${resp.status} para ${username} | ` +
        `loginField=${REVENUE_LOGIN_FIELD} dateFormat=${REVENUE_DATE_FORMAT} | ` +
        `endpoint=${ADMIN_API_URL} | respuesta=${rawBody}`
      );
      if (resp.status === 422) {
        logger.warn(
          `[ReferralRevenue] HTTP 422 - Validation error del proveedor para ${username} | ` +
          `loginField=${REVENUE_LOGIN_FIELD} (valor="${username}"), ` +
          `dateFromField=${REVENUE_DATE_FROM_FIELD} (valor="${fromFormatted}"), ` +
          `dateToField=${REVENUE_DATE_TO_FIELD} (valor="${toFormatted}"), ` +
          `dateFormat=${REVENUE_DATE_FORMAT} | Respuesta proveedor: ${rawBody}`
        );
      }
      if (resp.status === 401 || resp.status === 403) {
        sessionToken = null;
        lastLogin = 0;
      }
      return {
        success: false,
        error: `HTTP ${resp.status}`,
        statusCode: resp.status,
        rawProviderBody: rawBody
      };
    }

    const data = resp.data;

    // La API v2 puede devolver datos directamente (sin wrapper "success") o con él
    // Verificar que haya un objeto con datos, no importa el wrapper exacto
    const hasData = data && typeof data === 'object' && !Array.isArray(data);
    const isExplicitFailure = hasData && 'success' in data && !data.success;

    if (!hasData || isExplicitFailure) {
      logger.warn(
        `[ReferralRevenue] Respuesta no exitosa para ${username}: ${rawBody}`
      );
      return { success: false, error: 'Respuesta no exitosa del endpoint', rawBody };
    }

    logger.info(
      `[ReferralRevenue] Revenue recibido para ${username} período ${periodKey} | ` +
      `parseando respuesta...`
    );

    return parseRoyaltyResponse(resp.data, username, periodKey);
  } catch (err) {
    logger.error(`[ReferralRevenue] Error consultando royalty-statistics para ${username}: ${err.message}`);
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
    // La API v2 puede devolver { data: { totals, providers } } o { totals, providers } directamente
    const inner = data?.data || data;
    const totals = inner?.totals?.[currency] || {};
    const providers = inner?.providers || [];

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
