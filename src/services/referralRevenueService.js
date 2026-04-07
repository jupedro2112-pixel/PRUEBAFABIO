/**
 * Servicio de Ingresos de Referidos
 * Consulta el endpoint royalty-statistics de JUGAYGANA
 * para calcular el revenue mensual por usuario referido.
 *
 * Variables de entorno relevantes:
 *   JUGAYGANA_ADMIN_REPORTS_URL        - URL completa del endpoint (default: /api/v2/admin/reports/royalty-statistics)
 *   PLATFORM_USER / PLATFORM_PASS      - credenciales principales (mismo login que el resto de operaciones)
 *                                        La sesión clásica de jugayganaService se usa como fuente primaria de auth.
 *   JUGAYGANA_API_KEY                  - API key estática (override opcional; si se configura, se usa en lugar del login)
 *   JUGAYGANA_AUTH_SCHEME              - Esquema de autenticación: "Bearer" (default), "Token", "none"
 *   JUGAYGANA_REPORTS_LOGIN_URL        - (opcional/deprecated) URL de login REST JSON dedicado para reports.
 *                                        Solo se usa si jugayganaService no obtiene token. Si no se configura, se ignora.
 *   JUGAYGANA_REPORTS_USER             - (opcional) usuario para el login dedicado de reports (default: PLATFORM_USER)
 *   JUGAYGANA_REPORTS_PASS             - (opcional) contraseña para el login dedicado de reports (default: PLATFORM_PASS)
 *   JUGAYGANA_REPORTS_LOGIN_BODY_FIELD - (opcional) campo de usuario en el body del login dedicado (default: "login")
 *   JUGAYGANA_REVENUE_LOGIN_FIELD      - campo para el usuario en el body del revenue (default: "login")
 *   JUGAYGANA_REVENUE_DATE_FORMAT      - formato de fechas ("iso", "epoch_ms", "epoch_s" – default: "iso")
 *   JUGAYGANA_REVENUE_DATE_FROM_FIELD  - nombre del campo fecha inicio en el body (default: "date_from")
 *   JUGAYGANA_REVENUE_DATE_TO_FIELD    - nombre del campo fecha fin en el body (default: "date_to")
 *   JUGAYGANA_REPORTS_TOKEN_IN_BODY    - si "true", también envía el token como campo "token" en el body JSON
 */
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const logger = require('../utils/logger');
const { getPeriodRange } = require('../utils/periodKey');
const jugayganaService = require('./jugayganaService');

const ADMIN_API_URL = process.env.JUGAYGANA_ADMIN_REPORTS_URL ||
  'https://admin.agentesadmin.bet/api/v2/admin/reports/royalty-statistics';
const PROXY_URL = process.env.PROXY_URL || '';

// API key estática: override opcional. Si se configura, se usa directamente sin login.
const JUGAYGANA_API_KEY = process.env.JUGAYGANA_API_KEY || '';

// Login dedicado para reports (opcional/deprecated – solo se usa si jugayganaService no puede obtener token)
const REPORTS_LOGIN_URL = process.env.JUGAYGANA_REPORTS_LOGIN_URL || '';
const REPORTS_USER = process.env.JUGAYGANA_REPORTS_USER || process.env.PLATFORM_USER || '';
const REPORTS_PASS = process.env.JUGAYGANA_REPORTS_PASS || process.env.PLATFORM_PASS || '';

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

// Campo de usuario en el body del login dedicado (solo relevante si REPORTS_LOGIN_URL está configurado)
const ALLOWED_LOGIN_BODY_FIELDS = ['login', 'username', 'email'];
const REPORTS_LOGIN_BODY_FIELD_RAW = process.env.JUGAYGANA_REPORTS_LOGIN_BODY_FIELD || 'login';
const REPORTS_LOGIN_BODY_FIELD = ALLOWED_LOGIN_BODY_FIELDS.includes(REPORTS_LOGIN_BODY_FIELD_RAW)
  ? REPORTS_LOGIN_BODY_FIELD_RAW
  : (() => {
      logger.warn(
        `[ReferralRevenue] JUGAYGANA_REPORTS_LOGIN_BODY_FIELD="${REPORTS_LOGIN_BODY_FIELD_RAW}" no válido ` +
        `(permitidos: ${ALLOWED_LOGIN_BODY_FIELDS.join(', ')}). Usando "login".`
      );
      return 'login';
    })();

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

// Log de configuración de autenticación al cargar el módulo
(() => {
  if (JUGAYGANA_API_KEY) {
    logger.info(
      `[ReferralRevenue] Auth: JUGAYGANA_API_KEY configurada (override estático) | ` +
      `authScheme=${JUGAYGANA_AUTH_SCHEME} endpoint=${ADMIN_API_URL}`
    );
  } else {
    logger.info(
      `[ReferralRevenue] Auth: fuente primaria = jugayganaService (PLATFORM_USER/PLATFORM_PASS) | ` +
      `authScheme=${JUGAYGANA_AUTH_SCHEME} endpoint=${ADMIN_API_URL}` +
      (REPORTS_LOGIN_URL ? ` | fallback secundario: JUGAYGANA_REPORTS_LOGIN_URL=${REPORTS_LOGIN_URL}` : '')
    );
  }
})();

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
 *
 * Prioridad:
 *   1. JUGAYGANA_API_KEY (override estático; si está configurada, se usa directamente)
 *   2. Sesión clásica de jugayganaService via PLATFORM_USER / PLATFORM_PASS (fuente primaria)
 *   3. Login REST JSON a JUGAYGANA_REPORTS_LOGIN_URL (fallback opcional; solo si está configurado
 *      y jugayganaService no pudo obtener token)
 *
 * La sesión de jugayganaService ya maneja su propio caché y TTL; no se duplica aquí.
 *
 * @returns {{ token: string|null, source: string, cookie: string|null }}
 */
async function getActiveToken() {
  // 1. API key estática (override opcional)
  if (JUGAYGANA_API_KEY) {
    logger.debug('[ReferralRevenue] Usando JUGAYGANA_API_KEY como token estático (override)');
    return { token: JUGAYGANA_API_KEY, source: 'env:JUGAYGANA_API_KEY', cookie: null };
  }

  // 2. Sesión clásica de jugayganaService (PLATFORM_USER / PLATFORM_PASS) — fuente primaria
  logger.info(
    '[ReferralRevenue] Obteniendo sesión de jugayganaService (PLATFORM_USER/PLATFORM_PASS) para revenue...'
  );
  const sessionOk = await jugayganaService.ensureSession();
  if (sessionOk) {
    const token = jugayganaService.getSessionToken();
    const cookie = jugayganaService.getSessionCookie();
    logger.info(
      `[ReferralRevenue] jugayganaService.ensureSession() exitoso | ` +
      `tokenPresente=${!!token} cookiePresente=${!!cookie} tokenSource=jugayganaService`
    );
    if (token) {
      return { token, source: 'jugayganaService', cookie: cookie || null };
    }
    logger.warn(
      '[ReferralRevenue] jugayganaService.ensureSession() respondió ok pero no hay token en la sesión'
    );
  } else {
    logger.warn(
      '[ReferralRevenue] jugayganaService.ensureSession() falló — ' +
      'verificar PLATFORM_USER y PLATFORM_PASS'
    );
  }

  // 3. Fallback opcional: login REST JSON a JUGAYGANA_REPORTS_LOGIN_URL (si está configurado)
  if (REPORTS_LOGIN_URL && REPORTS_USER && REPORTS_PASS) {
    logger.info(
      `[ReferralRevenue] jugayganaService no pudo obtener token. ` +
      `Intentando login REST JSON en JUGAYGANA_REPORTS_LOGIN_URL (fallback) | ` +
      `url=${REPORTS_LOGIN_URL} user=${REPORTS_USER} loginBodyField=${REPORTS_LOGIN_BODY_FIELD}`
    );
    try {
      const loginBody = { [REPORTS_LOGIN_BODY_FIELD]: REPORTS_USER, password: REPORTS_PASS };
      if (REPORTS_LOGIN_BODY_FIELD !== 'username') loginBody.username = REPORTS_USER;

      const resp = await reportsClient.post(REPORTS_LOGIN_URL, loginBody, {
        validateStatus: s => s >= 200 && s < 500
      });
      let data = resp.data;
      if (typeof data === 'string') { try { data = JSON.parse(data); } catch { /* ignore */ } }

      if (resp.status === 200 && data && typeof data === 'object') {
        const token = data?.token || data?.access_token || data?.sessionToken ||
                      data?.data?.token || data?.data?.access_token ||
                      data?.result?.token || data?.jwt || data?.authToken;
        if (token) {
          logger.info(
            `[ReferralRevenue] Login REST JSON en JUGAYGANA_REPORTS_LOGIN_URL exitoso | ` +
            `tokenSource=reports:dedicated-login`
          );
          return { token, source: 'reports:dedicated-login', cookie: null };
        }
        logger.warn(
          `[ReferralRevenue] Login REST JSON respondió 200 pero sin token reconocido | ` +
          `url=${REPORTS_LOGIN_URL} camposRespuesta=${Object.keys(data || {}).join(', ') || '(vacío)'}`
        );
      } else {
        logger.warn(
          `[ReferralRevenue] Login REST JSON en JUGAYGANA_REPORTS_LOGIN_URL falló | ` +
          `status=${resp.status} respuesta=${JSON.stringify(data).substring(0, 200)}`
        );
      }
    } catch (err) {
      logger.warn(`[ReferralRevenue] Error en login REST JSON (${REPORTS_LOGIN_URL}): ${err.message}`);
    }
  }

  logger.error(
    '[ReferralRevenue] No se pudo obtener token para revenue. ' +
    'Verificar PLATFORM_USER y PLATFORM_PASS (fuente primaria). ' +
    (REPORTS_LOGIN_URL ? '' : 'JUGAYGANA_REPORTS_LOGIN_URL no configurado (fallback no disponible). ')
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
      error: 'No hay sesión válida en JUGAYGANA. Verificar PLATFORM_USER y PLATFORM_PASS.',
      authDetail: {
        tokenSource: authInfo.source,
        tokenPresente: false,
        authScheme: JUGAYGANA_AUTH_SCHEME,
        reportsEndpoint: ADMIN_API_URL
      }
    };
  }

  let reloginAttempted = false;

  try {
    let resp = await callRevenueEndpoint(username, fromFormatted, toFormatted, authInfo);

    // Si devuelve 401/403 y no estamos usando API key estática, invalidar sesión y reintentar una vez
    if ((resp.status === 401 || resp.status === 403) && authInfo.source !== 'env:JUGAYGANA_API_KEY') {
      reloginAttempted = true;
      const rawBodyFirst = resp.data == null
        ? '(empty)'
        : typeof resp.data === 'string'
          ? resp.data.substring(0, 300)
          : JSON.stringify(resp.data).substring(0, 300);

      logger.warn(
        `[ReferralRevenue] HTTP ${resp.status} para ${username} | ` +
        `tokenSource=${authInfo.source} | ` +
        `Invalidando sesión de jugayganaService para forzar re-login fresco... | ` +
        `respuesta inicial: ${rawBodyFirst}`
      );

      // Invalidar la sesión de jugayganaService para forzar re-login
      if (typeof jugayganaService.invalidateSession === 'function') {
        jugayganaService.invalidateSession();
      }

      // Forzar login fresco
      authInfo = await getActiveToken();

      if (authInfo.token) {
        resp = await callRevenueEndpoint(username, fromFormatted, toFormatted, authInfo);
        logger.info(
          `[ReferralRevenue] Reintento tras re-login | usuario=${username} ` +
          `nuevoStatus=${resp.status} tokenSource=${authInfo.source} ` +
          `reintentoCorrecto=${resp.status === 200}`
        );
      } else {
        logger.error(
          `[ReferralRevenue] Re-login falló para ${username}, no es posible reintentar. ` +
          `Verificar PLATFORM_USER y PLATFORM_PASS.`
        );
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
        const classicTokenRejected = authInfo.source === 'jugayganaService';
        logger.error(
          `[ReferralRevenue] Autenticación rechazada por el proveedor (${resp.status}) para ${username} | ` +
          `authScheme=${JUGAYGANA_AUTH_SCHEME} tokenSource=${authInfo.source} ` +
          `tokenPresente=${!!authInfo.token} reloginAttempted=${reloginAttempted} | ` +
          `Mensaje proveedor: "${providerMsg || 'Access denied'}" código=${providerCode || '(sin código)'} | ` +
          `endpoint=${ADMIN_API_URL} | ` +
          (classicTokenRejected
            ? `DIAGNÓSTICO: el token clásico de PLATFORM_USER/PLATFORM_PASS (jugayganaService) ` +
              `fue presentado al endpoint de revenue y fue rechazado con ${resp.status}. ` +
              `Esto confirma que el endpoint no acepta el token de sesión clásico. ` +
              `Solución: configurar JUGAYGANA_API_KEY con una API key REST del proveedor.`
            : ``) +
          (authInfo.source === 'env:JUGAYGANA_API_KEY'
            ? `DIAGNÓSTICO: la JUGAYGANA_API_KEY configurada fue rechazada. Verificar que sea válida.`
            : ``) +
          (authInfo.source === 'reports:dedicated-login'
            ? `DIAGNÓSTICO: el token del login dedicado (JUGAYGANA_REPORTS_LOGIN_URL) fue rechazado. ` +
              `Verificar credenciales y permisos.`
            : ``)
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
          cookiePresente: !!authInfo.cookie,
          reloginAttempted,
          classicTokenRejected: authInfo.source === 'jugayganaService' && (resp.status === 401 || resp.status === 403),
          reportsEndpoint: ADMIN_API_URL
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
