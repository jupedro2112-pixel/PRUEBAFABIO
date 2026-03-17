# Documentación Técnica Completa — Integración JugayGana (admin.agentesadmin.bet)

## 1) Objetivo

Este documento explica **toda la integración API** usada por el bot para la plataforma JugayGana, incluyendo:

- Endpoints/acciones reales usadas.
- Flujo de autenticación por token fresco.
- Requisitos de red/proxy (clave en Render).
- Estructura de requests y responses.
- Reglas de negocio del reintegro.
- Ejemplos listos para implementar.
- Checklist de deploy en Render.

---

## 2) Contexto operativo importante

La API se consume en:

- **Base URL:** `https://admin.agentesadmin.bet/api/admin/`
- **Método:** `POST` para todo.
- **Formato:** `application/x-www-form-urlencoded`.
- **Auth:** token + cookie de sesión (cuando está disponible).

### Restricción crítica de infraestructura

En hosting tipo Render, la API puede bloquear por geolocalización/IP.  
**Sin IP de Argentina, puede devolver HTML de bloqueo en vez de JSON.**

Por eso:

- Se requiere **proxy saliente con IP argentina**.
- Si no hay proxy AR, la integración puede fallar aunque el código esté bien.

---

## 3) Variables de entorno necesarias

```env
# Servidor
PORT=3000

# OpenAI (si usás la parte conversacional)
OPENAI_API_KEY=...

# Chatwoot (si usás webhook/respuestas)
CHATWOOT_ACCESS_TOKEN=...
CHATWOOT_BASE_URL=https://app.chatwoot.com

# Plataforma JugayGana/admin
PLATFORM_USER=...
PLATFORM_PASS=...
FIXED_API_TOKEN=... # opcional, fallback si no hay user/pass
PLATFORM_CURRENCY=ARS
TOKEN_TTL_MINUTES=20

# Proxy (CRÍTICO en Render)
PROXY_URL=http://user:pass@host:port
# Debe ser IP Argentina de salida

# Google Sheets (si registrás bonus)
GOOGLE_CREDENTIALS_JSON={...}
```

---

## 4) Dependencias Node.js

```bash
npm i axios express dotenv https-proxy-agent
```

(Además, si usás tu implementación completa: `googleapis`, `google-auth-library`, `openai`)

---

## 5) Cliente HTTP base (con proxy AR)

```js
require('dotenv').config();
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

const API_URL = "https://admin.agentesadmin.bet/api/admin/";
const PROXY_URL = process.env.PROXY_URL;

function toFormUrlEncoded(data) {
  return Object.keys(data)
    .filter(k => data[k] !== undefined && data[k] !== null)
    .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(data[k]))
    .join('&');
}

let httpsAgent = null;
if (PROXY_URL) {
  httpsAgent = new HttpsProxyAgent(PROXY_URL);
}

const client = axios.create({
  baseURL: API_URL,
  timeout: 20000,
  httpsAgent,
  proxy: false, // IMPORTANTE cuando se usa agent
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Content-Type': 'application/x-www-form-urlencoded',
    'Origin': 'https://admin.agentesadmin.bet',
    'Referer': 'https://admin.agentesadmin.bet/users',
    'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Accept-Language': 'es-419,es;q=0.9'
  }
});

async function logProxyIP() {
  try {
    const res = await axios.get('https://api.ipify.org?format=json', {
      httpsAgent,
      timeout: 10000,
      proxy: false
    });
    console.log('IP pública saliente:', res.data);
  } catch (e) {
    console.error('No se pudo verificar IP pública:', e.message);
  }
}
```

---

## 6) Gestión de sesión (token fresco + cookie + admin id)

La API usa login por acción `LOGIN` y responde token.  
Se guarda además cookie y `user.user_id` (admin/parent id).

```js
let SESSION_TOKEN = null;
let SESSION_COOKIE = null;
let SESSION_PARENT_ID = null;
let SESSION_LAST_LOGIN = 0;

const PLATFORM_USER = process.env.PLATFORM_USER;
const PLATFORM_PASS = process.env.PLATFORM_PASS;
const FIXED_API_TOKEN = process.env.FIXED_API_TOKEN;
const TOKEN_TTL_MINUTES = parseInt(process.env.TOKEN_TTL_MINUTES || '20', 10);

async function loginAndGetToken() {
  if (!PLATFORM_USER || !PLATFORM_PASS) {
    console.error('Falta PLATFORM_USER/PLATFORM_PASS');
    return false;
  }

  const body = toFormUrlEncoded({
    action: 'LOGIN',
    username: PLATFORM_USER,
    password: PLATFORM_PASS
  });

  const resp = await client.post('', body, {
    validateStatus: s => s >= 200 && s < 500,
    maxRedirects: 0
  });

  if (resp.headers['set-cookie']) {
    SESSION_COOKIE = resp.headers['set-cookie'].map(c => c.split(';')[0]).join('; ');
  }

  let data = resp.data;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data.substring(data.indexOf('{'), data.lastIndexOf('}') + 1));
    } catch (_) {}
  }

  if (!data?.token) return false;

  SESSION_TOKEN = data.token;
  SESSION_PARENT_ID = data.user ? data.user.user_id : null;
  SESSION_LAST_LOGIN = Date.now();
  return true;
}

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

  if (FIXED_API_TOKEN) {
    SESSION_TOKEN = FIXED_API_TOKEN;
    return true;
  }

  return false;
}
```

---

## 7) Detección de bloqueo por IP (respuesta HTML)

Si la API devuelve HTML, se interpreta como bloqueo/ruta no válida para esa IP.

```js
function isHtmlBlocked(data) {
  return typeof data === 'string' && data.trim().startsWith('<');
}
```

---

## 8) Endpoints/acciones reales usadas

## 8.1 LOGIN

- **POST** `https://admin.agentesadmin.bet/api/admin/`
- body:
  - `action=LOGIN`
  - `username`
  - `password`
- uso: obtener `token`, `cookie`, `user.user_id`.

---

## 8.2 ShowUsers (buscar usuario)

- **POST** `https://admin.agentesadmin.bet/api/admin/`
- body:
  - `action=ShowUsers`
  - `token`
  - `page=1`
  - `pagesize=50`
  - `viewtype=tree`
  - `username=<target>`
  - `showhidden=false`
  - `parentid=<SESSION_PARENT_ID>` (si existe)
- uso: obtener `user_id`, saldo, validar que exista.

### Ejemplo función

```js
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

  const resp = await client.post('', body, { headers, validateStatus: () => true, maxRedirects: 0 });

  let data = resp.data;
  if (typeof data === 'string') {
    try { data = JSON.parse(data.substring(data.indexOf('{'), data.lastIndexOf('}') + 1)); } catch (_) {}
  }
  if (isHtmlBlocked(data)) return null;

  const list = data.users || data.data || (Array.isArray(data) ? data : []);
  const found = list.find(u => String(u.user_name).toLowerCase().trim() === String(username).toLowerCase().trim());
  if (!found?.user_id) return null;

  let balanceRaw = Number(found.user_balance ?? found.balance ?? found.balance_amount ?? found.available_balance ?? 0);
  let balance = Number.isInteger(balanceRaw) ? balanceRaw / 100 : balanceRaw; // corrección centavos

  return { id: found.user_id, balance };
}
```

---

## 8.3 ShowUserTransfersByAgent (movimientos del usuario)

- **POST** `https://admin.agentesadmin.bet/api/admin/`
- body:
  - `action=ShowUserTransfersByAgent`
  - `token`
  - `page=1`
  - `pagesize=30`
  - `fromtime=<epoch>`
  - `totime=<epoch>`
  - `username=<user>`
  - `userrole=player`
  - `direct=False`
  - `childid=<SESSION_PARENT_ID>`
- uso:
  - neto de ayer (`total_deposits - total_withdraws`)
  - verificar si ya cobró hoy (`total_bonus > 0`)

### Ejemplo función (neto de ayer)

```js
function getYesterdayRangeArgentinaEpoch() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric', month: '2-digit', day: '2-digit'
  });

  const now = new Date();
  const p = fmt.formatToParts(now);
  const yyyy = p.find(x => x.type === 'year').value;
  const mm = p.find(x => x.type === 'month').value;
  const dd = p.find(x => x.type === 'day').value;

  const todayLocal = new Date(`${yyyy}-${mm}-${dd}T00:00:00-03:00`);
  const y = new Date(todayLocal.getTime() - 24 * 60 * 60 * 1000);

  const yp = fmt.formatToParts(y);
  const yy = yp.find(x => x.type === 'year').value;
  const ym = yp.find(x => x.type === 'month').value;
  const yd = yp.find(x => x.type === 'day').value;

  const from = new Date(`${yy}-${ym}-${yd}T00:00:00-03:00`);
  const to = new Date(`${yy}-${ym}-${yd}T23:59:59-03:00`);

  return { fromEpoch: Math.floor(from.getTime() / 1000), toEpoch: Math.floor(to.getTime() / 1000) };
}

async function getUserNetYesterday(username) {
  const ok = await ensureSession();
  if (!ok || !SESSION_PARENT_ID) return { success: false, error: 'No sesión/admin id' };

  const { fromEpoch, toEpoch } = getYesterdayRangeArgentinaEpoch();

  const body = toFormUrlEncoded({
    action: 'ShowUserTransfersByAgent',
    token: SESSION_TOKEN,
    page: 1,
    pagesize: 30,
    fromtime: fromEpoch,
    totime: toEpoch,
    username,
    userrole: 'player',
    direct: 'False',
    childid: SESSION_PARENT_ID
  });

  const headers = {};
  if (SESSION_COOKIE) headers.Cookie = SESSION_COOKIE;

  const resp = await client.post('', body, { headers });
  let data = resp.data;
  if (typeof data === 'string') {
    try { data = JSON.parse(data.substring(data.indexOf('{'), data.lastIndexOf('}') + 1)); } catch (_) {}
  }
  if (isHtmlBlocked(data)) return { success: false, error: 'IP bloqueada/html' };

  const depositsCents = Number(data?.total_deposits || 0);
  const withdrawsCents = Number(data?.total_withdraws || 0);
  const netCents = depositsCents - withdrawsCents;

  return {
    success: true,
    totalDeposits: depositsCents / 100,
    totalWithdraws: withdrawsCents / 100,
    net: Number((netCents / 100).toFixed(2)),
    fromEpoch,
    toEpoch
  };
}
```

---

## 8.4 DepositMoney (acreditar bono/reintegro)

- **POST** `https://admin.agentesadmin.bet/api/admin/`
- body:
  - `action=DepositMoney`
  - `token`
  - `childid=<id del jugador>`
  - `amount=<centavos>`
  - `currency=ARS`
  - `deposit_type=individual_bonus`
- uso: cargar 8% del neto cuando corresponde.

### Ejemplo función

```js
async function creditUserBalance(username, amountPesos) {
  const ok = await ensureSession();
  if (!ok) return { success: false, error: 'No sesión' };

  const user = await getUserInfoByName(username);
  if (!user) return { success: false, error: 'Usuario no encontrado' };

  const amountCents = Math.round(Number(amountPesos) * 100);

  const body = toFormUrlEncoded({
    action: 'DepositMoney',
    token: SESSION_TOKEN,
    childid: user.id,
    amount: amountCents,
    currency: process.env.PLATFORM_CURRENCY || 'ARS',
    deposit_type: 'individual_bonus'
  });

  const headers = {};
  if (SESSION_COOKIE) headers.Cookie = SESSION_COOKIE;

  const resp = await client.post('', body, { headers });

  let data = resp.data;
  if (typeof data === 'string') {
    try { data = JSON.parse(data.substring(data.indexOf('{'), data.lastIndexOf('}') + 1)); } catch (_) {}
  }
  if (isHtmlBlocked(data)) return { success: false, error: 'IP bloqueada/html' };

  if (data?.success) return { success: true };
  return { success: false, error: data?.error || 'API error' };
}
```

---

## 9) Reglas de negocio de reintegro (como está implementado)

1. Se calcula sobre **ayer** (00:00:00 a 23:59:59, hora Argentina).
2. `neto = depósitos - retiros`.
3. Si `neto > 1`, reintegro = `8% del neto`.
4. Si saldo actual del usuario `>= 1000`, no acreditar.
5. Si ya reclamó hoy (`total_bonus > 0` y cubre bonus esperado), no duplicar.
6. Si no hubo depósitos/retiros, o neto <= 1, no corresponde.
7. Operativa diaria: reembolso diario, no semanal.

---

## 10) Flujo completo recomendado

1. `ensureSession()`
2. `getUserInfoByName(username)`  
   - si no existe -> cortar.
3. validar saldo `< 1000`  
   - si no -> cortar.
4. `checkClaimedToday(username)` usando `ShowUserTransfersByAgent` con rango de hoy.
5. `getUserNetYesterday(username)`
6. si `net > 1`:
   - `bonus = round(net * 0.08, 2)`
   - `creditUserBalance(username, bonus)`

---

## 11) Ejemplo end-to-end minimal

```js
async function processRefund(username) {
  const user = await getUserInfoByName(username);
  if (!user) return { ok: false, reason: 'user_not_found' };

  if (user.balance >= 1000) return { ok: false, reason: 'balance_limit' };

  const claimed = await checkClaimedToday(username); // implementar análogo a getUserNetYesterday con rango hoy
  const netResult = await getUserNetYesterday(username);
  if (!netResult.success) return { ok: false, reason: 'api_error', error: netResult.error };

  if (claimed.success && claimed.claimed && netResult.net > 1) {
    return { ok: false, reason: 'claimed' };
  }

  if (netResult.net <= 1) return { ok: false, reason: 'no_balance' };

  const bonus = Number((netResult.net * 0.08).toFixed(2));
  const credit = await creditUserBalance(username, bonus);
  if (!credit.success) return { ok: false, reason: 'credit_error', error: credit.error };

  return { ok: true, bonus, net: netResult.net };
}
```

---

## 12) Proxy argentino en Render (guía práctica)

## Problema
Render usa salida IP compartida/no AR.  
La plataforma puede bloquear o responder HTML.

## Solución
Contratar proxy HTTP/HTTPS con salida en Argentina e inyectarlo en `PROXY_URL`.

Formato habitual:

- `http://USER:PASS@HOST:PORT`
- o `http://HOST:PORT` (si no requiere auth)

## Validación obligatoria al iniciar app

```js
await logProxyIP();
// Debe mostrar IP AR. Si no, la integración puede fallar.
```

## Recomendaciones de estabilidad

- Usar proveedor de proxy con uptime alto.
- Si podés, usar IP estática/dedicada AR.
- Timeout de 20s (ya aplicado).
- Retry en endpoints críticos (ShowUsers / ShowUserTransfersByAgent).
- Alertar cuando respuesta sea HTML.

---

## 13) Señales de error comunes

- `No token in login`: credenciales inválidas o bloqueo.
- `HTML en vez de JSON`: IP bloqueada/no autorizada/geolocación.
- `Usuario no encontrado`: username mal o visibilidad por jerarquía.
- `No SESSION_PARENT_ID`: login incompleto, no se podrá filtrar por childid.
- `DepositMoney error`: límites internos, permisos o datos inconsistentes.

---

## 14) Checklist para pasar a otra IA / otro dev

- [ ] Base URL exacta configurada.
- [ ] Requests en `x-www-form-urlencoded`.
- [ ] Login implementado con `action=LOGIN`.
- [ ] Guardado de `token`, `set-cookie`, `user.user_id`.
- [ ] Renovación de token por TTL.
- [ ] Proxy AR activo y validado al boot.
- [ ] Parser robusto para respuesta string/JSON.
- [ ] Detección explícita de HTML bloqueado.
- [ ] Conversión de centavos <-> pesos consistente.
- [ ] Reglas de negocio de reintegro respetadas.
- [ ] Logs con contexto de acción (LOGIN/ShowUsers/etc).

---

## 15) Resumen ultra corto de acciones API usadas

1. `LOGIN`
2. `ShowUsers`
3. `ShowUserTransfersByAgent`
4. `DepositMoney`

Todo contra: `POST https://admin.agentesadmin.bet/api/admin/`

---

## 16) Nota final

Esta integración depende fuertemente de red/IP de salida.  
Si en local funciona y en Render no, **primero revisar proxy argentino** antes de tocar lógica de negocio.