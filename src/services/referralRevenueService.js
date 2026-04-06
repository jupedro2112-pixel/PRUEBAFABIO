/**
 * Servicio de Ingresos de Referidos
 * Consulta el endpoint royalty-statistics de JUGAYGANA
 * para calcular el revenue mensual por usuario referido.
 *
 * Variables de entorno relevantes:
 *   JUGAYGANA_ADMIN_REPORTS_URL        - URL completa del endpoint (default: /api/v2/admin/reports/royalty-statistics)
 *   JUGAYGANA_API_KEY                  - API key estática para autenticación (alternativa a login, recomendado)
 *   JUGAYGANA_AUTH_SCHEME              - Esquema de autenticación: "Bearer" (default), "Token", "none"
 *   JUGAYGANA_REPORTS_USER             - usuario dedicado para reports (default: PLATFORM_USER)
 *   JUGAYGANA_REPORTS_PASS             - contraseña dedicada para reports (default: PLATFORM_PASS)
 *   JUGAYGANA_REPORTS_LOGIN_URL        - URL de login dedicado para la API v2 de reports.
 *                                        Si no se configura, se auto-deriva del endpoint de reports
 *                                        (ej: .../api/v2/... → .../api/v2/auth/login).
 *                                        Si la auto-derivación también falla, se hace fallback al
 *                                        login v1 de jugayganaService (token v1 NO válido para v2 REST).
 *   JUGAYGANA_REVENUE_TOKEN_TTL_MINUTES - TTL del token de reports en minutos (default: 15)
 *   JUGAYGANA_REVENUE_LOGIN_FIELD      - campo para el usuario en el body ("login", "username", "player" – default: "login")
 *   JUGAYGANA_REVENUE_DATE_FORMAT      - formato de fechas ("iso", "epoch_ms", "epoch_s" – default: "iso")
 *   JUGAYGANA_REVENUE_DATE_FROM_FIELD  - nombre del campo fecha inicio en el body (default: "date_from")
 *   JUGAYGANA_REVENUE_DATE_TO_FIELD    - nombre del campo fecha fin en el body (default: "date_to")
 *   JUGAYGANA_REPORTS_TOKEN_IN_BODY    - si "true", también envía el token como campo "token" en el body JSON
 *
 * NOTA IMPORTANTE sobre autenticación v1 vs v2:
 *   El login v1 (jugayganaService) usa form-urlencoded POST con action=LOGIN y produce un token
 *   de sesión válido para la API v1 solamente. La API v2 REST (/api/v2/...) requiere un token
 *   diferente obtenido via REST JSON login (JUGAYGANA_REPORTS_LOGIN_URL).
 *   Si solo se configura PLATFORM_USER/PASS sin JUGAYGANA_REPORTS_LOGIN_URL, el fallback al
 *   token v1 probablemente causará 401 "Access denied" en el endpoint v2.
 *   Solución: configurar JUGAYGANA_API_KEY (preferido) o JUGAYGANA_REPORTS_LOGIN_URL.
 */
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const logger = require('../utils/logger');
const { getPeriodRange } = require('../utils/periodKey');
const jugayganaService = require('./jugayganaService');

const ADMIN_API_URL = process.env.JUGAYGANA_ADMIN_REPORTS_URL ||
  'https://admin.agentesadmin.bet/api/v2/admin/reports/royalty-statistics';
const PROXY_URL = process.env.PROXY_URL || '';

// API key estática: si está configurada se usa directamente como token Bearer sin necesidad de login
const JUGAYGANA_API_KEY = process.env.JUGAYGANA_API_KEY || '';

// Credenciales dedicadas para el endpoint de reports (pueden diferir del usuario principal de operaciones)
const REPORTS_USER = process.env.JUGAYGANA_REPORTS_USER || process.env.PLATFORM_USER || '';
const REPORTS_PASS = process.env.JUGAYGANA_REPORTS_PASS || process.env.PLATFORM_PASS || '';

// URL de login dedicado para el endpoint de reports v2.
// Si se configura explícitamente, se usa como endpoint de login REST JSON.
// Si no se configura, se auto-deriva del endpoint de reports (ver deriveReportsLoginUrl más abajo).
const REPORTS_LOGIN_URL = process.env.JUGAYGANA_REPORTS_LOGIN_URL || '';

/**
 * Derivar la URL de login v2 a partir del endpoint de reports.
 * Ejemplo: https://admin.agentesadmin.bet/api/v2/admin/reports/royalty-statistics
 *       → https://admin.agentesadmin.bet/api/v2/auth/login
 *
 * Esta derivación permite que el servicio intente login en el endpoint correcto de la API v2
 * incluso cuando JUGAYGANA_REPORTS_LOGIN_URL no está configurado explícitamente.
 *
 * @param {string} reportsUrl - URL del endpoint de reports
 * @returns {string|null} URL derivada o null si no se pudo derivar
 */
function deriveReportsLoginUrl(reportsUrl) {
  try {
    const url = new URL(reportsUrl);
    // Si la ruta contiene /api/vN/ (e.g., /api/v2/), usar ese prefijo + /auth/login
    const versionMatch = url.pathname.match(/^(\/api\/v\d+)\//);
    if (versionMatch) {
      return `${url.origin}${versionMatch[1]}/auth/login`;
    }
    // Si la ruta contiene /api/ sin versión explícita, intentar /api/auth/login
    const apiMatch = url.pathname.match(/^(\/api)\//);
    if (apiMatch) {
      return `${url.origin}${apiMatch[1]}/auth/login`;
    }
    return null;
  } catch {
    // URL may not be parseable (e.g., relative path or env var not set); return null silently
    return null;
  }
}

// URL de login v2 auto-derivada del endpoint de reports (usada si REPORTS_LOGIN_URL no está configurado)
const REPORTS_LOGIN_URL_DERIVED = !REPORTS_LOGIN_URL ? deriveReportsLoginUrl(ADMIN_API_URL) : null;

// TTL en minutos para el token de reports (independiente del TOKEN_TTL_MINUTES del servicio principal)
const REPORTS_TOKEN_TTL_MINUTES = parseInt(process.env.JUGAYGANA_REVENUE_TOKEN_TTL_MINUTES || '15', 10);

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

// Estado de sesión dedicado para el endpoint de reports
// (independiente de la sesión v1 compartida de jugayganaService)
let reportsSessionToken = null;
let reportsSessionCookie = null;
let reportsSessionLastLogin = 0;

// Log de configuración de autenticación al cargar el módulo
(() => {
  if (JUGAYGANA_API_KEY) {
    logger.info(
      `[ReferralRevenue] Auth configurada: JUGAYGANA_API_KEY (estática) | ` +
      `authScheme=${JUGAYGANA_AUTH_SCHEME} endpoint=${ADMIN_API_URL}`
    );
  } else if (REPORTS_LOGIN_URL) {
    logger.info(
      `[ReferralRevenue] Auth configurada: login v2 explícito | ` +
      `JUGAYGANA_REPORTS_LOGIN_URL=${REPORTS_LOGIN_URL} user=${REPORTS_USER || '(no configurado)'} ` +
      `authScheme=${JUGAYGANA_AUTH_SCHEME} endpoint=${ADMIN_API_URL}`
    );
  } else if (REPORTS_LOGIN_URL_DERIVED) {
    logger.warn(
      `[ReferralRevenue] Auth: JUGAYGANA_REPORTS_LOGIN_URL no configurado. ` +
      `Se usará URL auto-derivada: ${REPORTS_LOGIN_URL_DERIVED} user=${REPORTS_USER || '(no configurado)'} | ` +
      `Si falla, configurar JUGAYGANA_REPORTS_LOGIN_URL explícitamente o usar JUGAYGANA_API_KEY.`
    );
  } else if (REPORTS_USER) {
    logger.warn(
      `[ReferralRevenue] ADVERTENCIA DE CONFIGURACIÓN: Sin JUGAYGANA_API_KEY ni JUGAYGANA_REPORTS_LOGIN_URL. ` +
      `Se usará token v1 de jugayganaService como fallback, ` +
      `que probablemente NO es válido para la API v2 REST de reports → esperar 401. ` +
      `Configurar JUGAYGANA_API_KEY o JUGAYGANA_REPORTS_LOGIN_URL para corregir.`
    );
  } else {
    logger.warn(
      `[ReferralRevenue] ADVERTENCIA: No hay credenciales configuradas para reports. ` +
      `Configurar JUGAYGANA_API_KEY, o JUGAYGANA_REPORTS_USER+PASS+LOGIN_URL.`
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
 * Login dedicado para el endpoint de reports/revenue.
 * Flujo de prioridad:
 *   1. JSON POST a JUGAYGANA_REPORTS_LOGIN_URL (configurado explícitamente)
 *   2. JSON POST a URL auto-derivada del endpoint de reports (e.g. /api/v2/auth/login)
 *   3. Fallback: login v1 de jugayganaService (ADVERTENCIA: token v1 probablemente NO válido para API v2 REST)
 *
 * El token obtenido se cachea en reportsSessionToken para evitar logins repetidos.
 *
 * @returns {{ token: string|null, source: string, cookie: string|null }}
 */
async function loginForReports() {
  /**
   * Intentar un login REST JSON a una URL dada.
   * @param {string} loginUrl
   * @param {string} sourceLabel - etiqueta para logs
   * @returns {{ token: string|null, source: string, cookie: string|null }|null} null si falló
   */
  async function tryJsonLogin(loginUrl, sourceLabel) {
    try {
      logger.info(
        `[ReferralRevenue] Intentando login REST JSON para reports | ` +
        `url=${loginUrl} user=${REPORTS_USER} source=${sourceLabel}`
      );
      const resp = await reportsClient.post(loginUrl, {
        username: REPORTS_USER,
        password: REPORTS_PASS
      }, {
        validateStatus: s => s >= 200 && s < 500
      });

      const data = resp.data;
      if (resp.status === 200 && data && typeof data === 'object') {
        // Intentar token en múltiples campos por compatibilidad con distintas versiones de API:
        //   token         – JUGAYGANA v1 y v2 REST
        //   access_token  – OAuth2 estándar / JWT
        //   sessionToken  – alias usado en algunas versiones del panel
        //   data.token    – respuestas con wrapper { data: { token: ... } }
        const token = data?.token || data?.access_token || data?.sessionToken || data?.data?.token;
        if (token) {
          reportsSessionToken = token;
          reportsSessionCookie = null;
          reportsSessionLastLogin = Date.now();
          logger.info(
            `[ReferralRevenue] Login REST JSON para reports exitoso | ` +
            `url=${loginUrl} tokenSource=${sourceLabel}`
          );
          return { token, source: sourceLabel, cookie: null };
        }
        logger.warn(
          `[ReferralRevenue] Login REST JSON respondió 200 pero sin token | ` +
          `url=${loginUrl} source=${sourceLabel} ` +
          `camposRespuesta=${Object.keys(data || {}).join(', ') || '(vacío)'}`
        );
      } else {
        logger.warn(
          `[ReferralRevenue] Login REST JSON falló | ` +
          `url=${loginUrl} source=${sourceLabel} status=${resp.status} ` +
          `respuesta=${JSON.stringify(data).substring(0, 200)}`
        );
      }
    } catch (err) {
      logger.warn(
        `[ReferralRevenue] Error en login REST JSON (${loginUrl}): ${err.message}`
      );
    }
    return null;
  }

  // Opción A: login JSON a endpoint v2 configurado explícitamente (JUGAYGANA_REPORTS_LOGIN_URL)
  if (REPORTS_LOGIN_URL && REPORTS_USER && REPORTS_PASS) {
    const result = await tryJsonLogin(REPORTS_LOGIN_URL, 'reports:dedicated-login');
    if (result) return result;
  }

  // Opción B: login JSON a URL auto-derivada del endpoint de reports (e.g. /api/v2/auth/login)
  // Solo se intenta si JUGAYGANA_REPORTS_LOGIN_URL no estaba configurado explícitamente.
  if (REPORTS_LOGIN_URL_DERIVED && REPORTS_USER && REPORTS_PASS) {
    logger.info(
      `[ReferralRevenue] JUGAYGANA_REPORTS_LOGIN_URL no configurado. ` +
      `Intentando login en URL auto-derivada: ${REPORTS_LOGIN_URL_DERIVED}`
    );
    const result = await tryJsonLogin(REPORTS_LOGIN_URL_DERIVED, 'reports:auto-derived-login');
    if (result) return result;
    logger.warn(
      `[ReferralRevenue] Login en URL auto-derivada falló (${REPORTS_LOGIN_URL_DERIVED}). ` +
      `Configure JUGAYGANA_REPORTS_LOGIN_URL con la URL correcta del endpoint de login v2.`
    );
  }

  // Opción C: Fallback al login v1 de jugayganaService.
  // ADVERTENCIA: El token v1 (form-urlencoded, action=LOGIN) NO es válido para la API v2 REST.
  // Si el endpoint de reports es /api/v2/..., este fallback CAUSARÁ 401 "Access denied".
  // Solución definitiva: configurar JUGAYGANA_API_KEY o JUGAYGANA_REPORTS_LOGIN_URL.
  if (REPORTS_USER && REPORTS_PASS) {
    logger.warn(
      `[ReferralRevenue] ADVERTENCIA: Usando token v1 de jugayganaService como fallback para reports. ` +
      `El token v1 (form-urlencoded action=LOGIN) probablemente NO es válido para la API v2 REST. ` +
      `Esto causará 401 "Access denied" si el endpoint de reports es /api/v2/... ` +
      `URLs de login v2 intentadas: ${[REPORTS_LOGIN_URL || null, REPORTS_LOGIN_URL_DERIVED || null].filter(Boolean).join(', ') || '(ninguna)'} | ` +
      `Solución: configurar JUGAYGANA_API_KEY o JUGAYGANA_REPORTS_LOGIN_URL con la URL del login v2. ` +
      `user=${REPORTS_USER} reportsEndpoint=${ADMIN_API_URL}`
    );
    const ok = await jugayganaService.ensureSession();
    if (ok) {
      const token = jugayganaService.getSessionToken();
      const cookie = jugayganaService.getSessionCookie();
      if (token) {
        reportsSessionToken = token;
        reportsSessionCookie = cookie || null;
        reportsSessionLastLogin = Date.now();
        logger.warn(
          `[ReferralRevenue] Token v1 obtenido como fallback para reports | ` +
          `tokenSource=jugayganaService:fresh-login ` +
          `ADVERTENCIA: token v1 probablemente inválido para API v2 REST → esperar 401`
        );
        return { token, source: 'jugayganaService:fresh-login', cookie: cookie || null };
      }
    }
    logger.error(
      '[ReferralRevenue] Login v1 de jugayganaService también falló para reports. ' +
      'Verifique JUGAYGANA_REPORTS_USER/PASS o PLATFORM_USER/PASS.'
    );
  }

  logger.error(
    '[ReferralRevenue] No se pudo obtener token para reports. ' +
    'Soluciones posibles: ' +
    '(1) Configurar JUGAYGANA_API_KEY con una API key estática del proveedor. ' +
    '(2) Configurar JUGAYGANA_REPORTS_LOGIN_URL con la URL del endpoint de login v2 ' +
    '(ej: https://admin.agentesadmin.bet/api/v2/auth/login) junto con ' +
    'JUGAYGANA_REPORTS_USER y JUGAYGANA_REPORTS_PASS. ' +
    '(3) Verificar que PLATFORM_USER/PLATFORM_PASS son correctos.'
  );
  return { token: null, source: 'none', cookie: null };
}

/**
 * Obtener o refrescar el token para el endpoint de reports.
 * Reutiliza el token en caché si no ha expirado según JUGAYGANA_REVENUE_TOKEN_TTL_MINUTES.
 * Si expiró o no existe, invoca loginForReports() para obtener uno fresco.
 *
 * @returns {{ token: string|null, source: string, cookie: string|null }}
 */
async function ensureReportsSession() {
  const ttlMs = REPORTS_TOKEN_TTL_MINUTES * 60 * 1000;
  const expired = Date.now() - reportsSessionLastLogin > ttlMs;

  if (reportsSessionToken && !expired) {
    logger.debug(
      `[ReferralRevenue] Reutilizando token de reports en caché | ` +
      `ttlMin=${REPORTS_TOKEN_TTL_MINUTES} expiresInSecs=${Math.round((ttlMs - (Date.now() - reportsSessionLastLogin)) / 1000)}`
    );
    return { token: reportsSessionToken, source: 'reports:cached', cookie: reportsSessionCookie };
  }

  if (reportsSessionToken && expired) {
    logger.info(
      `[ReferralRevenue] Token de reports expirado (TTL ${REPORTS_TOKEN_TTL_MINUTES} min), ` +
      `obteniendo token fresco...`
    );
    reportsSessionToken = null;
    reportsSessionCookie = null;
    reportsSessionLastLogin = 0;
  } else {
    logger.info('[ReferralRevenue] No hay token de reports en caché, obteniendo uno fresco...');
  }

  return await loginForReports();
}

/**
 * Obtener token activo para autenticar la llamada al endpoint de revenue.
 * Prioridad:
 *   1. JUGAYGANA_API_KEY (estática, más fiable – sin caducidad ni login)
 *   2. Sesión dedicada de reports (ensureReportsSession → loginForReports)
 *      - Si JUGAYGANA_REPORTS_LOGIN_URL está configurada: JSON login v2
 *      - Si no: login v1 fresco de jugayganaService
 *
 * @returns {{ token: string|null, source: string, cookie: string|null }}
 */
async function getActiveToken() {
  // 1. API key estática configurada por env var (sin caducidad, más fiable)
  if (JUGAYGANA_API_KEY) {
    logger.debug('[ReferralRevenue] Usando JUGAYGANA_API_KEY como token estático');
    return { token: JUGAYGANA_API_KEY, source: 'env:JUGAYGANA_API_KEY', cookie: null };
  }

  // 2. Sesión dedicada para reports (manejo propio de TTL y refresh)
  return await ensureReportsSession();
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
      authDetail: {
        tokenSource: authInfo.source,
        tokenPresente: false,
        authScheme: JUGAYGANA_AUTH_SCHEME,
        derivedLoginUrl: REPORTS_LOGIN_URL_DERIVED || null,
        reportsLoginUrl: REPORTS_LOGIN_URL || null,
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
        `Invalidando sesión de reports y v1 para forzar login fresco... | ` +
        `respuesta inicial: ${rawBodyFirst}`
      );

      // Invalidar la sesión de reports en caché
      reportsSessionToken = null;
      reportsSessionCookie = null;
      reportsSessionLastLogin = 0;

      // Invalidar también la sesión v1 compartida (si el método existe)
      if (typeof jugayganaService.invalidateSession === 'function') {
        jugayganaService.invalidateSession();
      }

      // Forzar login fresco directamente (no usar caché)
      authInfo = await loginForReports();

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
          `Verifique JUGAYGANA_API_KEY, JUGAYGANA_REPORTS_LOGIN_URL o PLATFORM_USER/PASS.`
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
        // Detectar el escenario más probable según la fuente del token
        const isV1TokenForV2Api = authInfo.source === 'jugayganaService:fresh-login';
        const derivedLoginUrl = REPORTS_LOGIN_URL_DERIVED || '(no derivada)';
        const loginUrlHint = REPORTS_LOGIN_URL
          ? `JUGAYGANA_REPORTS_LOGIN_URL=${REPORTS_LOGIN_URL}`
          : `URL auto-derivada intentada: ${REPORTS_LOGIN_URL_DERIVED || '(no disponible)'}`;

        logger.error(
          `[ReferralRevenue] Autenticación rechazada (${resp.status}) para ${username} | ` +
          `authScheme=${JUGAYGANA_AUTH_SCHEME} tokenSource=${authInfo.source} ` +
          `tokenPresente=${!!authInfo.token} reloginAttempted=${reloginAttempted} | ` +
          `Mensaje proveedor: "${providerMsg || 'Access denied'}" código=${providerCode || '(sin código)'} | ` +
          `endpoint=${ADMIN_API_URL} | ` +
          (isV1TokenForV2Api
            ? `CAUSA PROBABLE: token de sesión v1 (form-urlencoded action=LOGIN) ` +
              `NO es válido para la API v2 REST de reports. ` +
              `El login v1 produce un token de sesión para la API v1 solamente. ` +
              `${loginUrlHint} | `
            : ``) +
          `SOLUCIONES: ` +
          `(1) Configurar JUGAYGANA_API_KEY con una API key estática del proveedor (preferido). ` +
          `(2) Configurar JUGAYGANA_REPORTS_LOGIN_URL=${derivedLoginUrl} ` +
          `(o la URL correcta del login v2) junto con JUGAYGANA_REPORTS_USER y JUGAYGANA_REPORTS_PASS. ` +
          `(3) Verificar que las credenciales tienen permisos de reports/royalty-statistics en el proveedor.`
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
          isV1TokenForV2Api: authInfo.source === 'jugayganaService:fresh-login',
          derivedLoginUrl: REPORTS_LOGIN_URL_DERIVED || null,
          reportsLoginUrl: REPORTS_LOGIN_URL || null,
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
