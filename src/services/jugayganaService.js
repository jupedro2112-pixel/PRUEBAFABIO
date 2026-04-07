
/**
 * Servicio de Integración JUGAYGANA
 * Gestiona la comunicación con la API de JUGAYGANA
 */
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const logger = require('../utils/logger');

// Configuración
const API_URL = process.env.JUGAYGANA_API_URL || 'https://admin.agentesadmin.bet/api/admin/';
const PROXY_URL = process.env.PROXY_URL || '';
const PLATFORM_USER = process.env.PLATFORM_USER;
const PLATFORM_PASS = process.env.PLATFORM_PASS;
const TOKEN_TTL_MINUTES = parseInt(process.env.TOKEN_TTL_MINUTES || '20', 10);

// Estado de sesión
let sessionToken = null;
let sessionCookie = null;
let sessionParentId = null;
let lastLogin = 0;

// Configurar agente proxy
let httpsAgent = null;
if (PROXY_URL) {
  httpsAgent = new HttpsProxyAgent(PROXY_URL);
  logger.info('Proxy configurado para JUGAYGANA');
}

// Cliente HTTP
const client = axios.create({
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

// Helpers
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

// Safe fingerprint helper — shows first 8 chars only, never exposes full value
const safeCookieFingerprint = (value) => {
  if (!value) return '(none)';
  return value.substring(0, 8) + '...';
};

/**
 * Login en JUGAYGANA
 */
const login = async () => {
  if (!PLATFORM_USER || !PLATFORM_PASS) {
    logger.error('Faltan credenciales de JUGAYGANA');
    return false;
  }

  try {
    const body = toFormUrlEncoded({
      action: 'LOGIN',
      username: PLATFORM_USER,
      password: PLATFORM_PASS
    });

    const resp = await client.post('', body, {
      validateStatus: s => s >= 200 && s < 500,
      maxRedirects: 0
    });

    // ── Diagnóstico OBLIGATORIO de set-cookie (visible en Render con console.warn) ─────────
    const rawSetCookie = resp.headers['set-cookie'];
    const scPresent = !!rawSetCookie;
    const scType = typeof rawSetCookie;
    const scCount = Array.isArray(rawSetCookie) ? rawSetCookie.length : (rawSetCookie ? 1 : 0);

    console.warn(`[JG_LOGIN_COOKIE] set-cookie header present: ${scPresent ? 'yes' : 'no'}`);
    console.warn(`[JG_LOGIN_COOKIE] set-cookie type: ${scType}`);
    console.warn(`[JG_LOGIN_COOKIE] set-cookie count: ${scCount}`);

    if (rawSetCookie && Array.isArray(rawSetCookie) && rawSetCookie.length > 0) {
      const parsed = rawSetCookie.map(c => c.split(';')[0]);
      let discardedCount = 0;
      const discardReasons = [];
      const kept = parsed.filter(p => {
        if (!p || !p.includes('=')) {
          discardedCount++;
          discardReasons.push(`entry-without-equals`);
          return false;
        }
        return true;
      });
      // Extract names only from valid (kept) entries
      const cookieNames = kept.map(p => p.split('=')[0].trim());
      console.warn(`[JG_LOGIN_COOKIE] cookie names detected: ${cookieNames.length ? cookieNames.join(', ') : '(none valid)'}`);

      sessionCookie = kept.join('; ');

      const storedOk = !!sessionCookie;

      console.warn(`[JG_LOGIN_COOKIE] parsed successfully: ${storedOk ? 'yes' : 'no'}`);
      console.warn(`[JG_LOGIN_COOKIE] discarded cookies: ${discardedCount}`);
      if (discardReasons.length > 0) {
        console.warn(`[JG_LOGIN_COOKIE] discard reasons: ${discardReasons.join(', ')}`);
      }
      console.warn(`[JG_LOGIN_COOKIE] stored in session memory: ${storedOk ? 'yes' : 'no'}`);
      console.warn(`[JG_LOGIN_COOKIE] stored cookie fingerprint: ${safeCookieFingerprint(sessionCookie)}`);
      console.warn(`[JG_LOGIN_COOKIE] stored cookie length: ${sessionCookie ? sessionCookie.length : 0}`);
      console.warn(`[JG_LOGIN_COOKIE] conclusion: provider returned cookie and it was stored successfully`);
    } else if (rawSetCookie) {
      // Exists but not an array; unexpected format
      const rawStr = String(rawSetCookie);
      const firstPart = rawStr.split(';')[0];
      const cookieName = firstPart.includes('=') ? firstPart.split('=')[0].trim() : '(malformed)';
      console.warn(`[JG_LOGIN_COOKIE] cookie names detected: ${cookieName}`);

      sessionCookie = firstPart;

      console.warn(`[JG_LOGIN_COOKIE] parsed successfully: yes`);
      console.warn(`[JG_LOGIN_COOKIE] discarded cookies: 0`);
      console.warn(`[JG_LOGIN_COOKIE] stored in session memory: yes`);
      console.warn(`[JG_LOGIN_COOKIE] stored cookie fingerprint: ${safeCookieFingerprint(sessionCookie)}`);
      console.warn(`[JG_LOGIN_COOKIE] stored cookie length: ${sessionCookie.length}`);
      console.warn(`[JG_LOGIN_COOKIE] conclusion: provider returned cookie in unexpected non-array format but it was stored successfully as fallback`);
      logger.warn(
        `[JG_LOGIN_COOKIE] set-cookie presente pero en formato inesperado (no-array) | ` +
        `tipo=${scType} cookieAlmacenada=true longitudCookie=${sessionCookie.length}`
      );
    } else {
      // El proveedor no devolvió set-cookie en esta respuesta de login
      sessionCookie = null;
      console.warn(`[JG_LOGIN_COOKIE] cookie names detected: (none)`);
      console.warn(`[JG_LOGIN_COOKIE] parsed successfully: no`);
      console.warn(`[JG_LOGIN_COOKIE] discarded cookies: 0`);
      console.warn(`[JG_LOGIN_COOKIE] stored in session memory: no`);
      console.warn(`[JG_LOGIN_COOKIE] stored cookie fingerprint: (none)`);
      console.warn(`[JG_LOGIN_COOKIE] stored cookie length: 0`);
      console.warn(`[JG_LOGIN_COOKIE] conclusion: provider did not return reusable set-cookie`);
    }

    const data = parseJson(resp.data);
    
    if (isHtmlBlocked(data)) {
      logger.error('Login bloqueado por HTML');
      logger.error(`HTTP status: ${resp.status}, URL: ${API_URL}`);
      return false;
    }

    // Intentar token en múltiples campos por compatibilidad con cambios de API
    const token = data?.token || data?.access_token || data?.sessionToken || data?.data?.token;

    if (!token) {
      logger.error('Login falló: no se recibió token');
      logger.error(`HTTP status: ${resp.status}`);
      logger.error(`Content-Type: ${resp.headers['content-type'] || 'sin content-type'}`);
      logger.error(`URL usada: ${API_URL}`);
      if (typeof data === 'object' && data !== null) {
        const keys = Object.keys(data);
        logger.error(`Campos en respuesta: ${keys.length ? keys.join(', ') : '(objeto vacío)'}`);
        const errMsg = data.error || data.message || data.msg || data.detail;
        if (errMsg) logger.error(`Mensaje de error de API: ${errMsg}`);
      } else if (typeof data === 'string') {
        logger.error(`Respuesta (primeros 200 chars): ${data.substring(0, 200)}`);
      }
      return false;
    }

    sessionToken = token;
    sessionParentId = data?.user?.user_id ?? null;
    lastLogin = Date.now();
    
    logger.info(
      `[JugayganaService] Login exitoso en JUGAYGANA | ` +
      `tokenObtenido=true cookieObtenida=${!!sessionCookie}`
    );
    return true;
  } catch (error) {
    logger.error('Error en login JUGAYGANA:', error.message);
    return false;
  }
};

/**
 * Asegurar sesión válida
 */
const ensureSession = async () => {
  if (!PLATFORM_USER || !PLATFORM_PASS) return false;
  
  const expired = Date.now() - lastLogin > TOKEN_TTL_MINUTES * 60 * 1000;
  if (!sessionToken || expired) {
    sessionToken = null;
    sessionCookie = null;
    return await login();
  }
  return true;
};

/**
 * Invalidar la sesión actual.
 * Útil cuando un endpoint externo rechaza el token con 401/403 para forzar
 * un login fresco en la próxima llamada a ensureSession().
 */
const invalidateSession = () => {
  sessionToken = null;
  sessionCookie = null;
  lastLogin = 0;
  logger.info('[JugayganaService] Sesión invalidada manualmente (forzará re-login en próxima llamada)');
};

/**
 * Obtener información de usuario
 */
const getUserInfo = async (username) => {
  const ok = await ensureSession();
  if (!ok) return null;

  try {
    const body = toFormUrlEncoded({
      action: 'ShowUsers',
      token: sessionToken,
      page: 1,
      pagesize: 50,
      viewtype: 'tree',
      username,
      showhidden: 'false',
      parentid: sessionParentId || undefined
    });

    const headers = {};
    if (sessionCookie) headers.Cookie = sessionCookie;

    const resp = await client.post('', body, { 
      headers, 
      validateStatus: () => true, 
      maxRedirects: 0 
    });

    const data = parseJson(resp.data);
    if (isHtmlBlocked(data)) return null;

    const list = data.users || data.data || (Array.isArray(data) ? data : []);
    const found = list.find(u => 
      String(u.user_name).toLowerCase().trim() === String(username).toLowerCase().trim()
    );
    
    if (!found?.user_id) return null;

    let balanceRaw = Number(found.user_balance ?? found.balance ?? 0);
    let balance = Number.isInteger(balanceRaw) ? balanceRaw / 100 : balanceRaw;

    return { 
      id: found.user_id, 
      balance,
      username: found.user_name,
      email: found.user_email,
      phone: found.user_phone
    };
  } catch (error) {
    logger.error('Error obteniendo info de usuario JUGAYGANA:', error.message);
    return null;
  }
};

/**
 * Crear usuario en JUGAYGANA
 */
const createUser = async ({ username, password, userrole = 'player', currency = 'ARS' }) => {
  const ok = await ensureSession();
  if (!ok) return { success: false, error: 'No hay sesión válida' };

  try {
    const body = toFormUrlEncoded({
      action: 'CREATEUSER',
      token: sessionToken,
      username,
      password,
      userrole,
      currency
    });

    const headers = {};
    if (sessionCookie) headers.Cookie = sessionCookie;

    const resp = await client.post('', body, { 
      headers, 
      validateStatus: () => true, 
      maxRedirects: 0 
    });

    const data = parseJson(resp.data);
    if (isHtmlBlocked(data)) {
      return { success: false, error: 'IP bloqueada / HTML' };
    }

    if (data?.success) {
      return { 
        success: true, 
        user: data.user,
        jugayganaUserId: data.user?.user_id,
        jugayganaUsername: data.user?.user_name
      };
    }
    
    return { success: false, error: data?.error || 'CREATEUSER falló' };
  } catch (error) {
    logger.error('Error creando usuario JUGAYGANA:', error.message);
    return { success: false, error: error.message };
  }
};

/**
 * Sincronizar usuario con JUGAYGANA
 */
const syncUser = async (localUser) => {
  // Verificar si ya existe
  const existingUser = await getUserInfo(localUser.username);
  if (existingUser) {
    return {
      success: true,
      alreadyExists: true,
      jugayganaUserId: existingUser.id,
      jugayganaUsername: localUser.username
    };
  }

  // Crear nuevo usuario
  return await createUser({
    username: localUser.username,
    password: localUser.password || 'asd123',
    userrole: 'player',
    currency: 'ARS'
  });
};

/**
 * Obtener balance de usuario
 */
const getBalance = async (username) => {
  const user = await getUserInfo(username);
  if (!user) return { success: false, error: 'Usuario no encontrado' };
  
  return { 
    success: true, 
    balance: user.balance,
    username: user.username
  };
};

/**
 * Realizar depósito
 */
const deposit = async (username, amount, description = '') => {
  const ok = await ensureSession();
  if (!ok) return { success: false, error: 'No hay sesión válida' };

  try {
    const body = toFormUrlEncoded({
      action: 'CREDITBALANCE',
      token: sessionToken,
      username,
      amount: Math.round(amount * 100),
      description: description || `Depósito - ${new Date().toLocaleString('es-AR')}`
    });

    const headers = {};
    if (sessionCookie) headers.Cookie = sessionCookie;

    const resp = await client.post('', body, { 
      headers, 
      validateStatus: () => true 
    });

    const data = parseJson(resp.data);
    if (isHtmlBlocked(data)) {
      return { success: false, error: 'IP bloqueada / HTML' };
    }

    if (data?.success) {
      return { 
        success: true, 
        data: data.data,
        newBalance: data.data?.user_balance_after
      };
    }
    
    return { success: false, error: data?.error || 'Depósito falló' };
  } catch (error) {
    logger.error('Error en depósito JUGAYGANA:', error.message);
    return { success: false, error: error.message };
  }
};

/**
 * Realizar retiro
 */
const withdraw = async (username, amount, description = '') => {
  const ok = await ensureSession();
  if (!ok) return { success: false, error: 'No hay sesión válida' };

  try {
    const body = toFormUrlEncoded({
      action: 'DEBITBALANCE',
      token: sessionToken,
      username,
      amount: Math.round(amount * 100),
      description: description || `Retiro - ${new Date().toLocaleString('es-AR')}`
    });

    const headers = {};
    if (sessionCookie) headers.Cookie = sessionCookie;

    const resp = await client.post('', body, { 
      headers, 
      validateStatus: () => true 
    });

    const data = parseJson(resp.data);
    if (isHtmlBlocked(data)) {
      return { success: false, error: 'IP bloqueada / HTML' };
    }

    if (data?.success) {
      return { 
        success: true, 
        data: data.data,
        newBalance: data.data?.user_balance_after
      };
    }
    
    return { success: false, error: data?.error || 'Retiro falló' };
  } catch (error) {
    logger.error('Error en retiro JUGAYGANA:', error.message);
    return { success: false, error: error.message };
  }
};

/**
 * Acreditar bonificación (individual_bonus)
 * Usa action=DepositMoney con childid (user_id numérico) — CREDITBALANCE no existe en esta API.
 */
const bonus = async (username, amount, description = '') => {
  const ok = await ensureSession();
  if (!ok) return { success: false, error: 'No hay sesión válida' };

  // Obtener el childid numérico requerido por DepositMoney
  const userInfo = await getUserInfo(username);
  if (!userInfo || !userInfo.id) {
    logger.error(`[JugayganaService] bonus: usuario ${username} no encontrado en JUGAYGANA`);
    return { success: false, error: `Usuario ${username} no encontrado en JUGAYGANA` };
  }

  logger.info(
    `[JugayganaService] bonus: attemptedAction=DepositMoney username=${username} ` +
    `childid=${userInfo.id} deposit_type=individual_bonus amount=${amount}`
  );

  try {
    const body = toFormUrlEncoded({
      action: 'DepositMoney',
      token: sessionToken,
      childid: userInfo.id,
      amount: Math.round(amount * 100),
      currency: 'ARS',
      deposit_type: 'individual_bonus',
      description: description || `Bonificación - ${new Date().toLocaleString('es-AR')}`
    });

    const headers = {};
    if (sessionCookie) headers.Cookie = sessionCookie;

    const resp = await client.post('', body, { 
      headers, 
      validateStatus: () => true 
    });

    const data = parseJson(resp.data);
    if (isHtmlBlocked(data)) {
      return { success: false, error: 'IP bloqueada / HTML' };
    }

    // Accept both snake_case and camelCase transfer id variants for API compatibility
    if (data?.success || data?.transfer_id || data?.transferId) {
      return { 
        success: true, 
        data: data.data || data,
        newBalance: data.user_balance_after || data.data?.user_balance_after
      };
    }
    
    const errMsg = data?.error || data?.message || 'Bonificación falló';
    logger.error(
      `[JugayganaService] bonus: DepositMoney falló username=${username} error=${errMsg}`
    );
    return { success: false, error: errMsg };
  } catch (error) {
    logger.error('Error en bonificación JUGAYGANA:', error.message);
    return { success: false, error: error.message };
  }
};

/**
 * Acreditar bonificación (alias - usa individual_bonus)
 */
const creditBalance = async (username, amount, description = '') => {
  return await bonus(username, amount, description);
};

/**
 * Obtener token y cookie de la sesión actual (para compartir con otros servicios)
 */
const getSessionToken = () => sessionToken;
const getSessionCookie = () => {
  const available = !!sessionCookie;
  const length = sessionCookie ? sessionCookie.length : 0;
  console.warn(`[JG_SESSION_COOKIE] requested: yes`);
  console.warn(`[JG_SESSION_COOKIE] available: ${available ? 'yes' : 'no'}`);
  console.warn(`[JG_SESSION_COOKIE] fingerprint: ${safeCookieFingerprint(sessionCookie)}`);
  console.warn(`[JG_SESSION_COOKIE] length: ${length}`);
  return sessionCookie;
};

module.exports = {
  login,
  ensureSession,
  invalidateSession,
  getSessionToken,
  getSessionCookie,
  getUserInfo,
  createUser,
  syncUser,
  getBalance,
  deposit,
  withdraw,
  bonus,
  creditBalance
};