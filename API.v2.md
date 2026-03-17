# Documentación Técnica Completa — Integración JugayGana (admin.agentesadmin.bet)

## 1) Objetivo

Este documento explica **toda la integración API** para JugayGana, incluyendo:

- Endpoints/acciones oficiales utilizadas.
- Flujo de autenticación por token fresco.
- Alta de usuarios (`CREATEUSER`).
- Consulta de usuarios/movimientos y depósito de reintegro.
- Requisitos de red/proxy (crítico en Render).
- Flujos de sincronización A/B listos para implementar.
- Ejemplos listos para otra IA o para desarrollo directo.

---

## 2) Contexto operativo importante

La API se consume en:

- **Base URL:** `https://admin.agentesadmin.bet/api/admin/`
- **Método:** `POST` para todo.
- **Formato body:** `form-data` o `application/x-www-form-urlencoded` (en la práctica, tu integración usa urlencoded correctamente).
- **Auth:** `token` (obtenido en LOGIN) + cookie de sesión cuando esté disponible.

### Restricción crítica de infraestructura

En servicios como Render, la API puede bloquear por geolocalización/IP.  
Cuando bloquea, responde **HTML** en lugar de JSON.

✅ Recomendado/obligatorio en producción:

- Proxy saliente con **IP de Argentina**.
- Validar IP al inicio de la app.
- Detectar respuesta HTML y tratarla como bloqueo.

---

## 3) Variables de entorno necesarias

```env
# Servidor
PORT=3000

# JugayGana/API admin
PLATFORM_USER=...
PLATFORM_PASS=...
FIXED_API_TOKEN=...             # opcional (fallback)
PLATFORM_CURRENCY=ARS
TOKEN_TTL_MINUTES=20

# Proxy (CRÍTICO en Render)
PROXY_URL=http://user:pass@host:port  # IP de salida AR

# (Opcionales según tu app)
OPENAI_API_KEY=...
CHATWOOT_ACCESS_TOKEN=...
CHATWOOT_BASE_URL=https://app.chatwoot.com
GOOGLE_CREDENTIALS_JSON={...}
```

---

## 4) Dependencias mínimas

```bash
npm i axios dotenv https-proxy-agent
```

---

## 5) Cliente HTTP base (con proxy AR)

```js
require('dotenv').config();
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

const API_URL = 'https://admin.agentesadmin.bet/api/admin/';
const PROXY_URL = process.env.PROXY_URL;

function toFormUrlEncoded(data) {
  return Object.keys(data)
    .filter(k => data[k] !== undefined && data[k] !== null)
    .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(data[k]))
    .join('&');
}

let httpsAgent = null;
if (PROXY_URL) httpsAgent = new HttpsProxyAgent(PROXY_URL);

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

async function logProxyIP() {
  const res = await axios.get('https://api.ipify.org?format=json', {
    httpsAgent,
    proxy: false,
    timeout: 10000
  });
  console.log('IP pública saliente:', res.data);
}
```

---

## 6) Sesión (token fresco + cookie + parent/admin id)

```js
let SESSION_TOKEN = null;
let SESSION_COOKIE = null;
let SESSION_PARENT_ID = null;
let SESSION_LAST_LOGIN = 0;

const PLATFORM_USER = process.env.PLATFORM_USER;
const PLATFORM_PASS = process.env.PLATFORM_PASS;
const FIXED_API_TOKEN = process.env.FIXED_API_TOKEN;
const TOKEN_TTL_MINUTES = parseInt(process.env.TOKEN_TTL_MINUTES || '20', 10);

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

async function loginAndGetToken() {
  if (!PLATFORM_USER || !PLATFORM_PASS) return false;

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

  let data = parsePossiblyWrappedJson(resp.data);
  if (isHtmlBlocked(data)) return false;

  if (!data?.token) return false;

  SESSION_TOKEN = data.token;
  SESSION_PARENT_ID = data?.user?.user_id ?? null;
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

## 7) Sección oficial de acciones/endpoints

Todas las acciones se envían a:

- `POST https://admin.agentesadmin.bet/api/admin/`

## 7.1 LOGIN (autenticación)

### Request
- `action=LOGIN`
- `username=<admin_user>`
- `password=<admin_pass>`

### Response esperada (ejemplo)
```json
{
  "success": true,
  "token": "....",
  "user": {
    "user_id": 123,
    "user_balance": 0,
    "user_name": "adminX",
    "user_email": "",
    "user_phone": "",
    "user_currency": "ARS",
    "user_role": "agent",
    "registration_time_unix": 1710000000
  }
}
```

---

## 7.2 CREATEUSER (alta de usuario) ✅ NUEVO

### Request
- `action=CREATEUSER`
- `token=<token_login>`
- `username=<nuevo_username>`
- `password=<nueva_password>`
- `userrole=<agent|player>`
- `currency=<ARS|...>` *(puede ignorarse según permisos; suele aplicar a owner)*

### Response esperada (ejemplo)
```json
{
  "success": true,
  "user": {
    "user_currency": "ARS",
    "commission": 0,
    "user_role": "player",
    "parent_id": 123,
    "user_id": 456,
    "user_balance": 0,
    "user_name": "nuevoUser",
    "user_email": "",
    "user_phone": "",
    "registration_time_unix": 1710000100,
    "banned": false,
    "status": "active"
  }
}
```

### Función recomendada

```js
async function createPlatformUser({ username, password, userrole = 'player', currency = 'ARS' }) {
  const ok = await ensureSession();
  if (!ok) return { success: false, error: 'No hay sesión válida' };

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

  const resp = await client.post('', body, { headers, validateStatus: () => true, maxRedirects: 0 });

  let data = parsePossiblyWrappedJson(resp.data);
  if (isHtmlBlocked(data)) return { success: false, error: 'IP bloqueada / HTML' };

  if (data?.success) return { success: true, user: data.user };
  return { success: false, error: data?.error || 'CREATEUSER falló' };
}
```

---

## 7.3 ShowUsers (buscar usuario existente)

### Request
- `action=ShowUsers`
- `token=<token>`
- `page=1`
- `pagesize=50`
- `viewtype=tree`
- `username=<username>`
- `showhidden=false`
- `parentid=<SESSION_PARENT_ID>` (si aplica)

### Uso
- Verificar existencia.
- Obtener `user_id`.
- Obtener saldo (`user_balance`/otros campos posibles).

---

## 7.4 ShowUserTransfersByAgent (movimientos)

### Request
- `action=ShowUserTransfersByAgent`
- `token=<token>`
- `page=1`
- `pagesize=30`
- `fromtime=<epoch>`
- `totime=<epoch>`
- `username=<username>`
- `userrole=player`
- `direct=False`
- `childid=<SESSION_PARENT_ID>`

### Uso
- Calcular neto de ayer: `total_deposits - total_withdraws`.
- Ver si reclamó hoy: `total_bonus > 0`.

---

## 7.5 DepositMoney (acreditar reintegro/bonus)

### Request
- `action=DepositMoney`
- `token=<token>`
- `childid=<user_id jugador>`
- `amount=<monto en centavos>`
- `currency=ARS`
- `deposit_type=individual_bonus`

### Uso
- Acreditar reintegro del 8% cuando corresponda.

---

## 8) Funciones núcleo recomendadas (SDK)

- `ensureSession()`
- `loginAndGetToken()`
- `createPlatformUser()`
- `getUserInfoByName()`
- `getUserNetYesterday()`
- `checkClaimedToday()`
- `creditUserBalance()`

---

## 9) Reglas de negocio reintegro (actual)

1. Ventana de cálculo: **ayer** (00:00–23:59, `America/Argentina/Buenos_Aires`).
2. `neto = depósitos - retiros`.
3. Si `neto > 1`, reintegro = `8%`.
4. Si saldo actual `>= 1000`, no acreditar.
5. Si ya reclamó hoy, no duplicar.
6. Si neto <= 1 / sin movimientos válidos, no corresponde.

---

## 10) Flujo A/B de sincronización de usuarios (armado)

## Opción A — Sincronización unidireccional (recomendada)

Tu sistema es “source of truth”.

### Flujo
1. Usuario se crea en tu sistema.
2. Intentás `CREATEUSER` en JugayGana.
3. Si éxito:
   - guardás `jugaygana_user_id`, `jugaygana_username`, `status=linked`.
4. Si falla:
   - guardás `status=pending_manual` + error.
   - cola de reintento o creación manual desde panel.

### Ventajas
- Más simple.
- Menos acoplamiento.
- Menos puntos de falla.

### Desventajas
- Puede requerir intervención manual en errores.

---

## Opción B — Sincronización bidireccional

Ambos sistemas pueden originar usuarios.

### Flujo recomendado
1. **Outbound:** tu sistema crea usuario y llama `CREATEUSER`.
2. **Inbound:** proceso periódico (“polling”) en JugayGana con `ShowUsers` para detectar usuarios nuevos creados fuera de tu sistema.
3. Resolver conflicto por regla:
   - clave única por `username_normalized`.
   - idempotencia por `external_ref` (si existe en tu lado).
4. Si detectás usuario nuevo en JugayGana y no existe local:
   - crearlo local con `source=jugaygana`.
5. Si existe en ambos:
   - reconciliar campos permitidos (rol/estado según política).

### Ventajas
- Refleja cambios de ambos lados.

### Desventajas
- Mucho más complejo (conflictos, duplicados, latencia).

---

## 11) Recomendación práctica

Para empezar en producción: **Opción A**.  
Después, si el negocio lo exige, escalar a B con jobs de reconciliación.

---

## 12) Ejemplos de implementación de sincronización

### A) Crear usuario local + JugayGana

```js
async function createUserWithPlatformSync(localUser) {
  // 1) crear local (DB)
  const createdLocal = await db.users.create(localUser);

  // 2) intentar crear en JugayGana
  const r = await createPlatformUser({
    username: localUser.username,
    password: localUser.passwordPlainForProvisioning,
    userrole: 'player',
    currency: 'ARS'
  });

  if (r.success) {
    await db.users.update(createdLocal.id, {
      jugayganaUserId: r.user.user_id,
      jugayganaUsername: r.user.user_name,
      jugayganaSyncStatus: 'linked'
    });
  } else {
    await db.users.update(createdLocal.id, {
      jugayganaSyncStatus: 'pending_manual',
      jugayganaSyncError: r.error
    });
  }

  return createdLocal.id;
}
```

### B) Job de reconciliación (base conceptual)

```js
async function reconcileFromJugayGana(usernameListToCheck) {
  for (const username of usernameListToCheck) {
    const remote = await getUserInfoByName(username);
    if (!remote) continue;

    const local = await db.users.findByUsername(username);
    if (!local) {
      await db.users.create({
        username,
        jugayganaUserId: remote.id,
        jugayganaSyncStatus: 'imported_from_platform'
      });
      continue;
    }

    if (!local.jugayganaUserId) {
      await db.users.update(local.id, {
        jugayganaUserId: remote.id,
        jugayganaSyncStatus: 'linked'
      });
    }
  }
}
```

---

## 13) Proxy argentino en Render (obligatorio en tu escenario)

## Configuración

1. Comprar/proveer proxy HTTP(s) con salida AR.
2. Configurar:
   - `PROXY_URL=http://user:pass@host:port`
3. Iniciar app y validar IP:
   - `logProxyIP()` debe devolver IP de Argentina.

## Señal de problema
- La API responde HTML o falla parsing JSON.

## Mitigación
- Reintentos cortos.
- Alertas por HTML bloqueado.
- Fallback operativo/manual.

---

## 14) Manejo de errores común

- `LOGIN` sin token → credenciales inválidas o bloqueo IP.
- `CREATEUSER` falla → username duplicado/permisos/reglas internas.
- HTML en respuesta → bloqueo por geolocalización/IP.
- `ShowUsers` sin usuario → username mal o no visible por jerarquía.
- `DepositMoney` error → permisos/límites/datos inconsistentes.

---

## 15) Checklist final para otra IA/dev

- [ ] Base URL y método POST correctos.
- [ ] Body en form-urlencoded.
- [ ] Login implementado con cache/TTL de token.
- [ ] `CREATEUSER` implementado y probado.
- [ ] `ShowUsers`, `ShowUserTransfersByAgent`, `DepositMoney` operativos.
- [ ] Parser robusto string/JSON + detección HTML.
- [ ] Proxy AR activo y verificado al inicio.
- [ ] Estrategia A/B de sincronización definida.
- [ ] Registro de errores y estados de sync en DB.
- [ ] Reintentos y fallback manual documentados.

---

## 16) Resumen ultra corto de acciones API oficiales usadas/confirmadas

1. `LOGIN`
2. `CREATEUSER` ✅
3. `ShowUsers`
4. `ShowUserTransfersByAgent`
5. `DepositMoney`

Todo contra:
`POST https://admin.agentesadmin.bet/api/admin/`