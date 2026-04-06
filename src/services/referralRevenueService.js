/**
 * Servicio de Ingresos de Referidos
 * Consulta el endpoint royalty-statistics de JUGAYGANA
 * para calcular el revenue mensual por usuario referido.
 *
 * Variables de entorno relevantes:
 *   JUGAYGANA_ADMIN_REPORTS_URL      - URL completa del endpoint (default: /api/v2/admin/reports/royalty-statistics)
 *   JUGAYGANA_API_KEY                - API key estática para autenticación (alternativa a login con usuario/contraseña)
 *   JUGAYGANA_AUTH_SCHEME            - Esquema de autenticación: "Bearer" (default), "Token", "none"
 *   JUGAYGANA_REVENUE_LOGIN_FIELD    - campo para el usuario en el body ("login", "username", "player" – default: "login")
 *   JUGAYGANA_REVENUE_DATE_FORMAT    - formato de fechas ("iso", "epoch_ms", "epoch_s" – default: "iso")
 *   JUGAYGANA_REVENUE_DATE_FROM_FIELD - nombre del campo fecha inicio en el body (default: "date_from")
 *   JUGAYGANA_REVENUE_DATE_TO_FIELD   - nombre del campo fecha fin en el body (default: "date_to")
 *   JUGAYGANA_REPORTS_TOKEN_IN_BODY  - si "true", también envía el token como campo "token" en el body JSON
 */
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const logger = require('../utils/logger');
const { getPeriodRange } = require('../utils/periodKey');
const jugayganaService = require('./jugayganaService');

const ADMIN_API_URL = process.env.JUGAYGANA_ADMIN_REPORTS_URL ||
  'https://admin.agentesadmin.bet/api/v2/admin/reports/royalty-statistics';
const PROXY_URL = process.env.PROXY_URL || '';
const PLATFORM_USER = process.env.PLATFORM_USER;
const PLATFORM_PASS = process.env.PLATFORM_PASS;

// API key estática: si está configurada se usa directamente como token Bearer sin necesidad de login
const JUGAYGANA_API_KEY = process.env.JUGAYGANA_API_KEY || '';

// Esquema de auth: "Bearer" (default), "Token", "none"
const ALLOWED_AUTH_SCHEMES = ['Bearer', 'Token', 'none'];
const JUGAYGANA_AUTH_SCHEME_RAW = process.env.JUGAYGANA_AUTH_SCHEME || 'Bearer';
const JUGAYGANA_AUTH_SCHEME = ALLOWED_AUTH_SCHEMES.includes(JUGAYGANA_AUTH_SCHEME_RAW)
  ? JUGAYGANA_AUTH_SCHEME_RAW
  : (() => {
      logger.warn(
        `[ReferralRevenue] JUGAYGANA_AUTH_SCHEME="${JUGAYGANA_AUTH_SCHEME_RAW}" no válido ` +
        `(permitidos: ${ALLOWED_AUTH_SCHEMES.join(', ')}). Usando "Bearer".`
      );
      return 'Bearer';
    })();

// Si true, también agrega el token como campo "token" en el body JSON (compatibilidad con API legacy)
const REPORTS_TOKEN_IN_BODY = (process.env.JUGAYGANA_REPORTS_TOKEN_IN_BODY || '').toLowerCase() === 'true';

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

let httpsAgent = null;
if (PROXY_URL) {
  httpsAgent = new HttpsProxyAgent(PROXY_URL);
}

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
 * Obtener token activo para autenticar la llamada al endpoint de revenue.
 * Prioridad:
 *   1. JUGAYGANA_API_KEY (estática, más fiable)
 *   2. Sesión compartida de jugayganaService (reutiliza el login ya hecho por el servicio principal)
 *
 * @returns {{ token: string|null, source: string, cookie: string|null }}
 */
async function getActiveToken() {
  // 1. API key estática configurada por env var
  if (JUGAYGANA_API_KEY) {
    logger.debug('[ReferralRevenue] Usando JUGAYGANA_API_KEY como token estático');
    return { token: JUGAYGANA_API_KEY, source: 'env:JUGAYGANA_API_KEY', cookie: null };
  }

  // 2. Reutilizar sesión del servicio principal para evitar logins concurrentes con las mismas credenciales
  if (PLATFORM_USER && PLATFORM_PASS) {
    const ok = await jugayganaService.ensureSession();
    if (ok) {
      const token = jugayganaService.getSessionToken();
      const cookie = jugayganaService.getSessionCookie();
      if (token) {
        logger.debug('[ReferralRevenue] Usando sesión compartida de jugayganaService');
        return { token, source: 'jugayganaService:shared-session', cookie };
      }
    }
  }

  logger.error(
    '[ReferralRevenue] No se pudo obtener token activo. ' +
    'Configure JUGAYGANA_API_KEY o asegúrese de que PLATFORM_USER/PLATFORM_PASS estén definidos.'
  );
  return { token: null, source: 'none', cookie: null };
}

/**
 * Construir los headers de autenticación para la solicitud al endpoint externo.
 * Registra en log el esquema usado y si el token está presente.
 */
function buildAuthHeaders(token, cookie) {
  const headers = { 'Content-Type': 'application/json' };

  if (JUGAYGANA_AUTH_SCHEME !== 'none' && token) {
    headers.Authorization = `${JUGAYGANA_AUTH_SCHEME} ${token}`;
    logger.debug(
      `[ReferralRevenue] Auth header: ${JUGAYGANA_AUTH_SCHEME} <token presente>`
    );
  } else if (JUGAYGANA_AUTH_SCHEME === 'none') {
    logger.debug('[ReferralRevenue] Auth scheme=none: no se envía Authorization header');
  } else {
    logger.warn('[ReferralRevenue] Token no disponible: Authorization header no será enviado');
  }

  if (cookie) {
    headers.Cookie = cookie;
    logger.debug('[ReferralRevenue] Cookie de sesión incluida en la solicitud');
  }

  return headers;
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
 * Ejecutar la llamada POST al endpoint de revenue.
 * Retorna el objeto de respuesta de axios.
 */
async function callRevenueEndpoint(username, fromFormatted, toFormatted, authInfo) {
  const { token, cookie } = authInfo;
  const headers = buildAuthHeaders(token, cookie);

  const body = {
    [REVENUE_LOGIN_FIELD]: username,
    [REVENUE_DATE_FROM_FIELD]: fromFormatted,
    [REVENUE_DATE_TO_FIELD]: toFormatted
  };

  // Compatibilidad con APIs que aceptan el token en el body
  if (REPORTS_TOKEN_IN_BODY && token) {
    body.token = token;
  }

  logger.info(
    `[ReferralRevenue] POST royalty-statistics | loginField=${REVENUE_LOGIN_FIELD} ` +
    `usuario=${username} ${REVENUE_DATE_FROM_FIELD}=${fromFormatted} ${REVENUE_DATE_TO_FIELD}=${toFormatted} ` +
    `dateFormat=${REVENUE_DATE_FORMAT} authScheme=${JUGAYGANA_AUTH_SCHEME} ` +
    `tokenSource=${authInfo.source} tokenPresente=${!!token} ` +
    `tokenEnBody=${REPORTS_TOKEN_IN_BODY} cookiePresente=${!!cookie} ` +
    `endpoint=${ADMIN_API_URL}`
  );
  // Ocultar token en body antes de loguear para no exponer credenciales
  const { token: _tokenField, ...safeBody } = body;
  if (_tokenField) safeBody.token = '<redacted>';
  logger.debug(`[ReferralRevenue] Request body: ${JSON.stringify(safeBody)}`);

  return reportsClient.post(ADMIN_API_URL, body, {
    headers,
    validateStatus: () => true
  });
}

/**
 * Consultar royalty-statistics para un usuario y período.
 * Incluye lógica de reintentos: si se recibe 401/403, invalida la sesión y reintenta una vez.
 *
 * @param {string} username - username/login en JUGAYGANA
 * @param {string} periodKey - e.g. "2026-04"
 * @returns {Object} resultado de revenue calculado
 */
async function getUserRevenueForPeriod(username, periodKey) {
  const { fromEpoch, toEpoch, fromDate, toDate } = getPeriodRange(periodKey);
  const fromFormatted = formatRevenueDate(fromDate, fromEpoch);
  const toFormatted = formatRevenueDate(toDate, toEpoch);

  let authInfo = await getActiveToken();
  if (!authInfo.token && JUGAYGANA_AUTH_SCHEME !== 'none') {
    return {
      success: false,
      error: 'No hay sesión válida en JUGAYGANA',
      authDetail: { tokenSource: authInfo.source, tokenPresente: false, authScheme: JUGAYGANA_AUTH_SCHEME }
    };
  }

  try {
    let resp = await callRevenueEndpoint(username, fromFormatted, toFormatted, authInfo);

    // Si devuelve 401/403 y no estamos usando API key estática, intentar re-login y reintentar una vez
    if ((resp.status === 401 || resp.status === 403) && authInfo.source !== 'env:JUGAYGANA_API_KEY') {
      const rawBodyFirst = resp.data == null
        ? '(empty)'
        : typeof resp.data === 'string'
          ? resp.data.substring(0, 300)
          : JSON.stringify(resp.data).substring(0, 300);

      logger.warn(
        `[ReferralRevenue] HTTP ${resp.status} para ${username} | ` +
        `tokenSource=${authInfo.source} | Reintentando con nueva sesión... | ` +
        `respuesta inicial: ${rawBodyFirst}`
      );

      // Forzar re-login en jugayganaService
      const reloginOk = await jugayganaService.login();
      if (reloginOk) {
        authInfo = await getActiveToken();
        resp = await callRevenueEndpoint(username, fromFormatted, toFormatted, authInfo);
        logger.info(
          `[ReferralRevenue] Reintento tras re-login | usuario=${username} ` +
          `nuevoStatus=${resp.status} tokenSource=${authInfo.source}`
        );
      } else {
        logger.error('[ReferralRevenue] Re-login falló, no es posible reintentar');
      }
    }

    const rawBody = resp.data == null
      ? '(empty)'
      : typeof resp.data === 'string'
        ? resp.data.substring(0, 500)
        : JSON.stringify(resp.data).substring(0, 500);

    if (resp.status !== 200) {
      const parsedErr = parseJson(resp.data);
      const providerMsg = !isHtmlBlocked(parsedErr) && typeof parsedErr === 'object'
        ? (parsedErr?.error?.message || parsedErr?.message || parsedErr?.error || null)
        : null;
      const providerCode = !isHtmlBlocked(parsedErr) && typeof parsedErr === 'object'
        ? (parsedErr?.error?.code || parsedErr?.code || null)
        : null;

      logger.warn(
        `[ReferralRevenue] HTTP ${resp.status} para ${username} | ` +
        `authScheme=${JUGAYGANA_AUTH_SCHEME} tokenSource=${authInfo.source} ` +
        `tokenPresente=${!!authInfo.token} cookiePresente=${!!authInfo.cookie} | ` +
        `providerMsg="${providerMsg || '(sin mensaje)'}" ` +
        `providerCode=${providerCode || '(sin código)'} | ` +
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
        logger.error(
          `[ReferralRevenue] Autenticación rechazada (${resp.status}) para ${username}. ` +
          `authScheme=${JUGAYGANA_AUTH_SCHEME} tokenSource=${authInfo.source} ` +
          `tokenPresente=${!!authInfo.token}. ` +
          `Verifique JUGAYGANA_API_KEY o las credenciales PLATFORM_USER/PLATFORM_PASS. ` +
          `Mensaje proveedor: "${providerMsg || 'Access denied'}"`
        );
      }

      return {
        success: false,
        error: `HTTP ${resp.status}`,
        statusCode: resp.status,
        providerMessage: providerMsg,
        providerCode,
        authDetail: {
          authScheme: JUGAYGANA_AUTH_SCHEME,
          tokenSource: authInfo.source,
          tokenPresente: !!authInfo.token,
          cookiePresente: !!authInfo.cookie
        },
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
