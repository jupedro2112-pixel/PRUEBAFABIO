// ============================================
// INTEGRACIÓN JUGAYGANA API
// ============================================

const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

const API_URL = 'https://admin.agentesadmin.bet/api/admin/';
const PROXY_URL = process.env.PROXY_URL || '';

// Variables de sesión
let SESSION_TOKEN = null;
let SESSION_COOKIE = null;
let SESSION_PARENT_ID = null;
let SESSION_LAST_LOGIN = 0;

const PLATFORM_USER = process.env.PLATFORM_USER;
const PLATFORM_PASS = process.env.PLATFORM_PASS;
const TOKEN_TTL_MINUTES = parseInt(process.env.TOKEN_TTL_MINUTES || '20', 10);

// Configurar agente proxy si existe
let httpsAgent = null;
if (PROXY_URL) {
  httpsAgent = new HttpsProxyAgent(PROXY_URL);
  console.log('✅ Proxy configurado:', PROXY_URL.replace(/:.*@/, ':****@'));
}

// Cliente HTTP
const client = axios.create({
  baseURL: API_URL,
  timeout: 20000,
  httpsAgent,
  proxy: false,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Content-Type': 'application/x-www-form-urlencoded',
    'Origin': 'https://admin.agentesadmin.bet',
    'Referer': 'https://admin.agentesadmin.bet/users',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Accept-Language': 'es-419,es;q=0.9'
  }
});

// Helper para formatear datos
function toFormUrlEncoded(data) {
  return Object.keys(data)
    .filter(k => data[k] !== undefined && data[k] !== null)
    .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(data[k]))
    .join('&');
}

// Parsear JSON que puede venir envuelto
function parsePossiblyWrappedJson(data) {
  if (typeof data !== 'string') return data;
  try {
    return JSON.parse(data.substring(data.indexOf('{'), data.lastIndexOf('}') + 1));
  } catch {
    return data;
  }
}

// Detectar bloqueo por HTML
function isHtmlBlocked(data) {
  return typeof data === 'string' && data.trim().startsWith('<');
}

// Verificar IP pública
async function logProxyIP() {
  try {
    const res = await axios.get('https://api.ipify.org?format=json', {
      httpsAgent,
      proxy: false,
      timeout: 10000
    });
    console.log('🌐 IP pública saliente:', res.data.ip);
    return res.data.ip;
  } catch (e) {
    console.error('❌ No se pudo verificar IP pública:', e.message);
    return null;
  }
}

// Login y obtener token
async function loginAndGetToken() {
  if (!PLATFORM_USER || !PLATFORM_PASS) {
    console.error('❌ Faltan PLATFORM_USER o PLATFORM_PASS');
    return false;
  }

  console.log('🔑 Intentando login en JUGAYGANA...');

  const body = toFormUrlEncoded({
    action: 'LOGIN',
    username: PLATFORM_USER,
    password: PLATFORM_PASS
  });

  try {
    const resp = await client.post('', body, {
      validateStatus: s => s >= 200 && s < 500,
      maxRedirects: 0
    });

    if (resp.headers['set-cookie']) {
      SESSION_COOKIE = resp.headers['set-cookie'].map(c => c.split(';')[0]).join('; ');
    }

    let data = parsePossiblyWrappedJson(resp.data);
    if (isHtmlBlocked(data)) {
      console.error('❌ Login bloqueado: respuesta HTML (posible bloqueo de IP)');
      return false;
    }

    if (!data?.token) {
      console.error('❌ Login falló: no se recibió token');
      return false;
    }

    SESSION_TOKEN = data.token;
    SESSION_PARENT_ID = data?.user?.user_id ?? null;
    SESSION_LAST_LOGIN = Date.now();
    
    console.log('✅ Login exitoso. Parent ID:', SESSION_PARENT_ID);
    return true;
  } catch (error) {
    console.error('❌ Error en login:', error.message);
    return false;
  }
}

// Asegurar sesión válida
async function ensureSession() {
  if (PLATFORM_USER && PLATFORM_PASS) {
    const expired = Date.now() - SESSION_LAST_LOGIN > TOKEN_TTL_MINUTES * 60 * 1000;
    if (!SESSION_TOKEN || expired) {
      SESSION_TOKEN = null;
      SESSION_COOKIE = null;
      SESSION_PARENT_ID = null;
      return await loginAndGetToken();
    }
    return true;
  }
  return false;
}

// ============================================
// CREATEUSER - Crear usuario en JUGAYGANA
// ============================================

async function createPlatformUser({ username, password, userrole = 'player', currency = 'ARS' }) {
  const ok = await ensureSession();
  if (!ok) return { success: false, error: 'No hay sesión válida' };

  console.log('👤 Creando usuario en JUGAYGANA:', username);

  const body = toFormUrlEncoded({
    action: 'CREATEUSER',
    token: SESSION_TOKEN,
    username,
    password,
    userrole,
    currency
  });

  const headers = {};
  if (SESSION_COOKIE) headers.Cookie = SESSION_COOKIE;

  try {
    const resp = await client.post('', body, { 
      headers, 
      validateStatus: () => true, 
      maxRedirects: 0 
    });

    let data = parsePossiblyWrappedJson(resp.data);
    if (isHtmlBlocked(data)) {
      console.error('❌ CREATEUSER bloqueado: respuesta HTML');
      return { success: false, error: 'IP bloqueada / HTML' };
    }

    if (data?.success) {
      console.log('✅ Usuario creado en JUGAYGANA:', data.user?.user_name);
      return { 
        success: true, 
        user: data.user,
        jugayganaUserId: data.user?.user_id,
        jugayganaUsername: data.user?.user_name
      };
    }
    
    console.error('❌ CREATEUSER falló:', data?.error || 'Error desconocido');
    return { success: false, error: data?.error || 'CREATEUSER falló' };
  } catch (error) {
    console.error('❌ Error en CREATEUSER:', error.message);
    return { success: false, error: error.message };
  }
}

// ============================================
// ShowUsers - Buscar usuario
// ============================================

async function getUserInfoByName(username) {
  const ok = await ensureSession();
  if (!ok) return null;

  const body = toFormUrlEncoded({
    action: 'ShowUsers',
    token: SESSION_TOKEN,
    page: 1,
    pagesize: 50,
    viewtype: 'tree',
    username,
    showhidden: 'false',
    parentid: SESSION_PARENT_ID || undefined
  });

  const headers = {};
  if (SESSION_COOKIE) headers.Cookie = SESSION_COOKIE;

  try {
    const resp = await client.post('', body, { 
      headers, 
      validateStatus: () => true, 
      maxRedirects: 0 
    });

    let data = parsePossiblyWrappedJson(resp.data);
    if (isHtmlBlocked(data)) return null;

    const list = data.users || data.data || (Array.isArray(data) ? data : []);
    const found = list.find(u => 
      String(u.user_name).toLowerCase().trim() === String(username).toLowerCase().trim()
    );
    
    if (!found?.user_id) return null;

    let balanceRaw = Number(found.user_balance ?? found.balance ?? found.balance_amount ?? found.available_balance ?? 0);
    let balance = Number.isInteger(balanceRaw) ? balanceRaw / 100 : balanceRaw;

    return { 
      id: found.user_id, 
      balance,
      username: found.user_name,
      email: found.user_email,
      phone: found.user_phone
    };
  } catch (error) {
    console.error('❌ Error en ShowUsers:', error.message);
    return null;
  }
}

// ============================================
// Verificar si usuario existe en JUGAYGANA
// ============================================

async function checkUserExists(username) {
  const user = await getUserInfoByName(username);
  return user !== null;
}

// ============================================
// Sincronización completa: crear usuario local + JUGAYGANA
// ============================================

async function syncUserToPlatform(localUser) {
  console.log('🔄 Sincronizando usuario con JUGAYGANA:', localUser.username);

  // 1. Verificar si ya existe en JUGAYGANA
  const existingUser = await getUserInfoByName(localUser.username);
  if (existingUser) {
    console.log('✅ Usuario ya existe en JUGAYGANA:', existingUser.id);
    return {
      success: true,
      alreadyExists: true,
      jugayganaUserId: existingUser.id,
      jugayganaUsername: localUser.username
    };
  }

  // 2. Crear en JUGAYGANA
  const result = await createPlatformUser({
    username: localUser.username,
    password: localUser.password || 'asd123',
    userrole: 'player',
    currency: 'ARS'
  });

  return result;
}

// ============================================
// Exportar funciones
// ============================================

module.exports = {
  logProxyIP,
  ensureSession,
  loginAndGetToken,
  createPlatformUser,
  getUserInfoByName,
  checkUserExists,
  syncUserToPlatform
};
