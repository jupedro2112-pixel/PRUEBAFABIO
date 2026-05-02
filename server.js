// ⚠️ ARCHIVO EN PROCESO DE MIGRACIÓN
// La arquitectura modular refactorizada está en server-new.js + /src/
// Este archivo se mantiene como entry point principal hasta completar la migración.
// NO agregar funcionalidad nueva aquí — usar /src/controllers/ y /src/routes/

// Cargar .env primero (Render / dev local). En AWS EB con SSM_PATH, las vars
// sensibles se cargarán desde Parameter Store en el bootstrap async de abajo.
require('dotenv').config();

const { loadSecretsFromSSM } = require('./src/config/loadSecrets');

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const { createClient } = require('redis');
const { createAdapter } = require('@socket.io/redis-adapter');
const winston = require('winston');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');

// ============================================
// LOGGER (Winston)
// ============================================
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message }) => `${timestamp} [${level.toUpperCase()}] ${message}`)
  ),
  transports: [new winston.transports.Console()]
});

// ============================================
// IMPORTAR MODELOS DE MONGODB
// ============================================
const {
  connectDB,
  User,
  Message,
  Command,
  Config,
  RefundClaim,
  FireStreak,
  ChatStatus,
  Transaction,
  ExternalUser,
  UserActivity,
  NotificationHistory,
  MoneyGiveaway,
  MoneyGiveawayClaim,
  ScheduledNotification,
  WaClickLog,
  PlayerStats,
  RecoveryPush,
  JugayganaImport,
  DailyPlayerStats,
  ensureMongoReady,
  getConfig,
  setConfig,
  getAllCommands,
  saveCommand,
  deleteCommand,
  incrementCommandUsage
} = require('./config/database');

// Importar modelos de referidos (usados por el handler de registro inline)
const ReferralEvent = require('./src/models/ReferralEvent');
const { generateReferralCode } = require('./src/utils/referralCode');
const { setRedisClient, getRedisClient } = require('./src/utils/redisClient');
const { generateAndSendOTP, verifyOTP } = require('./src/services/otpService');
const { sendSMS } = require('./src/services/smsService');
const { validateInternationalPhone } = require('./src/middlewares/security');

// ============================================
// SEGURIDAD - RATE LIMITING
// NOTE: Uses in-memory store per instance. In multi-instance deployments each
// instance counts independently. For consistent distributed rate limiting,
// configure a Redis store (e.g. rate-limit-redis) via REDIS_URL.
// ============================================
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes. Intenta más tarde.' }
});

const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de autenticación. Intenta más tarde.' }
});

// Rate limiter for sensitive unauthenticated endpoints (phone lookup, password reset)
const sensitiveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Intenta más tarde.' }
});

// ============================================
// IP-BASED SMS RATE LIMITING (in-memory Map)
// ============================================

// Tracks SMS requests per IP: { ip -> [timestamp, ...] }
const smsIpStore = new Map();
// Tracks bulk SMS requests per IP: { ip -> [timestamp, ...] }
const bulkSmsIpStore = new Map();

// Periodically clean up expired entries to prevent memory leaks (every 30 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [ip, timestamps] of smsIpStore) {
    const valid = timestamps.filter(ts => ts > now - 15 * 60 * 1000);
    if (valid.length === 0) smsIpStore.delete(ip);
    else smsIpStore.set(ip, valid);
  }
  for (const [ip, timestamps] of bulkSmsIpStore) {
    const valid = timestamps.filter(ts => ts > now - 60 * 60 * 1000);
    if (valid.length === 0) bulkSmsIpStore.delete(ip);
    else bulkSmsIpStore.set(ip, valid);
  }
}, 30 * 60 * 1000).unref();

/**
 * Creates an IP-based rate limiting middleware using an in-memory Map.
 * @param {Map} store - The Map used to track IP -> timestamps
 * @param {number} windowMs - Time window in milliseconds
 * @param {number} max - Maximum number of requests per window
 * @param {string} message - Error message to return when limit is exceeded
 */
function createIpSmsLimiter(store, windowMs, max, message) {
  return (req, res, next) => {
    const ip = req.ip || req.socket?.remoteAddress;
    if (!ip) {
      return res.status(429).json({ error: message });
    }
    const now = Date.now();
    const windowStart = now - windowMs;

    // Get existing timestamps for this IP, filter out expired ones
    const timestamps = (store.get(ip) || []).filter(ts => ts > windowStart);

    if (timestamps.length >= max) {
      return res.status(429).json({ error: message });
    }

    // Record this request
    timestamps.push(now);
    store.set(ip, timestamps);

    next();
  };
}

// 5 SMS requests per IP per 15 minutes (for OTP endpoints)
const smsIpLimiter = createIpSmsLimiter(
  smsIpStore,
  15 * 60 * 1000,
  5,
  'Demasiadas solicitudes de SMS. Por favor, intenta nuevamente más tarde.'
);

// 1 bulk SMS request per IP per hour
const bulkSmsIpLimiter = createIpSmsLimiter(
  bulkSmsIpStore,
  60 * 60 * 1000,
  1,
  'Demasiadas solicitudes de SMS masivo. Por favor, intenta nuevamente en una hora.'
);

// ============================================
// SEGURIDAD - HEADERS DE SEGURIDAD
// ============================================
function securityHeaders(req, res, next) {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=()');
  // HSTS: only set in production (HTTPS). In development the server may run
  // on plain HTTP where HSTS would cause the browser to block future HTTP requests.
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }
  // CSP compatible con Firebase Auth, FCM, Socket.IO WebSocket y PWA service workers.
  // 'unsafe-inline' en script-src/style-src es necesario por el stack actual de frontend.
  // worker-src incluye blob: para Workbox/sw.js generados en runtime.
  // connect-src incluye wss: para Socket.IO WebSocket y dominios Firebase necesarios.
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://www.gstatic.com https://www.google.com https://apis.google.com https://cdn.jsdelivr.net https://unpkg.com",
    "script-src-elem 'self' 'unsafe-inline' https://www.gstatic.com https://www.google.com https://apis.google.com https://cdn.jsdelivr.net https://unpkg.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self'",
    "connect-src 'self' https://*.googleapis.com https://*.firebaseio.com https://*.google.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://fcm.googleapis.com https://firebaseinstallations.googleapis.com",
    "frame-src 'self' https://*.firebaseapp.com https://*.google.com",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "media-src 'self' data: blob:"
  ].join('; '));
  next();
}

// ============================================
// SEGURIDAD - VALIDACIÓN DE INPUT
// ============================================

// Helper para comparación segura de strings (previene timing attacks).
// Usa HMAC con clave aleatoria por llamada: ambos HMACs son siempre de 32 bytes,
// por lo que timingSafeEqual nunca revela diferencias de longitud ni de contenido.
function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  // A random per-call key ensures the attacker cannot predict the HMAC output
  // and prevents multi-call timing oracle attacks.
  const key = crypto.randomBytes(32);
  const hmacA = crypto.createHmac('sha256', key).update(a).digest();
  const hmacB = crypto.createHmac('sha256', key).update(b).digest();
  return crypto.timingSafeEqual(hmacA, hmacB);
}

function sanitizeInput(input) {
  if (typeof input !== 'string') return input;
  return input
    .replace(/[<>]/g, '')
    .trim()
    .substring(0, 1000);
}

// Escapar caracteres especiales de regex para evitar ReDoS/inyección
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function validateUsername(username) {
  if (!username || typeof username !== 'string') return false;
  const sanitized = username.trim();
  return /^[a-zA-Z0-9_.-]{3,30}$/.test(sanitized);
}

function validatePassword(password) {
  if (!password || typeof password !== 'string') return false;
  return password.length >= 6 && password.length <= 100;
}

// Integración JUGAYGANA
const jugaygana = require('./jugaygana');
const jugayganaMovements = require('./jugaygana-movements');
const jugayganaService = require('./src/services/jugayganaService');
const refunds = require('./models/refunds');
const referralRevenueService = require('./src/services/referralRevenueService');
const { resolveJugayganaUserId } = require('./src/services/jugayganaUserLinkService');

// ============================================
// BLOQUEO DE REEMBOLSOS
// ============================================
// Maps de fallback (se mantienen para cuando Redis no está disponible)
const refundLocksMemory = new Map();
const cbuRequestTimestampsMemory = new Map();

// Mantener referencias de compatibilidad (usadas por el cleanup interval)
const refundLocks = refundLocksMemory;
const cbuRequestTimestamps = cbuRequestTimestampsMemory;

// Calcula la clave de periodo (TZ Argentina) que identifica univocamente
// el reembolso reclamable en este momento. Combinada con el indice unique
// { userId, type, periodKey } del modelo RefundClaim, garantiza que MongoDB
// rechace cualquier insert duplicado, incluso si el lock de Redis falla
// (por ejemplo, multiples instancias EB sin Redis configurado).
//
// IMPORTANTE: usa Intl.DateTimeFormat para que la conversion a TZ Argentina
// sea coherente con _argDateString() de models/refunds.js (que tambien usa
// Intl). Si Argentina cambia su offset alguna vez, ambos seguiran la tzdata
// del SO sin divergencias entre el check canClaim y el periodKey.
function _getArgentinaParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = fmt.formatToParts(date);
  const get = (t) => parts.find(p => p.type === t).value;
  return {
    year: parseInt(get('year'), 10),
    month: parseInt(get('month'), 10),
    day: parseInt(get('day'), 10)
  };
}

function computePeriodKey(type) {
  const { year, month, day } = _getArgentinaParts();
  const yyyy = String(year);
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  if (type === 'daily') {
    return `${yyyy}-${mm}-${dd}`;
  }
  if (type === 'welcome_install') {
    // Bono de bienvenida one-time por usuario. periodKey constante para que
    // el indice unique { userId/username, type, periodKey } solo permita uno
    // por cuenta, sin importar cuanto tiempo pase.
    return 'one-time';
  }
  if (type === 'weekly') {
    // ISO week number en TZ Argentina, calculado a partir de y/m/d en ART.
    const target = new Date(Date.UTC(year, month - 1, day));
    const dayNum = (target.getUTCDay() + 6) % 7; // lunes=0
    target.setUTCDate(target.getUTCDate() - dayNum + 3);
    const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
    const week = 1 + Math.round(((target.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
    return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
  }
  if (type === 'monthly') {
    return `${yyyy}-${mm}`;
  }
  return null;
}

// Backfill de periodKey en RefundClaims viejos creados antes de que el campo
// fuera obligatorio. Solo se ejecuta una vez por arranque y solo procesa los
// rows que tienen periodKey null o ausente. Es necesario para que el indice
// unique partial (que indexa SOLO rows con periodKey string) tenga cobertura
// completa hacia atras y prevenga retro-claims duplicados de periodos pasados.
async function backfillRefundClaimPeriodKeys() {
  try {
    const RefundClaim = require('./src/models/RefundClaim');
    const cursor = RefundClaim.find({ periodKey: { $in: [null, undefined] } }).cursor();
    let scanned = 0, updated = 0;
    for (let doc = await cursor.next(); doc != null; doc = await cursor.next()) {
      scanned++;
      if (!doc.claimedAt || !doc.type) continue;
      const parts = _getArgentinaParts(new Date(doc.claimedAt));
      const yyyy = String(parts.year);
      const mm = String(parts.month).padStart(2, '0');
      const dd = String(parts.day).padStart(2, '0');
      let pk = null;
      if (doc.type === 'daily') pk = `${yyyy}-${mm}-${dd}`;
      else if (doc.type === 'monthly') pk = `${yyyy}-${mm}`;
      else if (doc.type === 'weekly') {
        const t = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
        const dayNum = (t.getUTCDay() + 6) % 7;
        t.setUTCDate(t.getUTCDate() - dayNum + 3);
        const ft = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
        const w = 1 + Math.round(((t.getTime() - ft.getTime()) / 86400000 - 3 + ((ft.getUTCDay() + 6) % 7)) / 7);
        pk = `${t.getUTCFullYear()}-W${String(w).padStart(2, '0')}`;
      }
      if (!pk) continue;
      try {
        await RefundClaim.updateOne({ _id: doc._id }, { $set: { periodKey: pk } });
        updated++;
      } catch (e) {
        if (e && e.code === 11000) {
          // El backfill encontro un duplicado historico real: dos claims del
          // mismo {user, type} en el mismo periodo (datos sucios pre-fix).
          // No podemos darles ambos el mismo periodKey porque rompe el indice.
          // Marcamos el mas viejo con un sufijo para que no colisione, asi el
          // indice queda consistente y el admin puede revisar manualmente.
          try {
            await RefundClaim.updateOne(
              { _id: doc._id },
              { $set: { periodKey: `${pk}-LEGACY-${doc._id.toString().slice(-6)}` } }
            );
            logger.warn(`[backfillRefundClaimPeriodKeys] duplicado historico marcado LEGACY para review: claim ${doc._id} (${doc.username} ${doc.type} ${pk})`);
          } catch (e2) { /* best-effort */ }
        }
      }
    }
    if (scanned > 0) {
      logger.info(`[backfillRefundClaimPeriodKeys] scaneados=${scanned} actualizados=${updated}`);
    }
  } catch (err) {
    logger.error(`[backfillRefundClaimPeriodKeys] error: ${err.message}`);
  }
}

async function acquireRefundLock(userId, type) {
  const key = `refund-lock:${userId}:${type}`;
  const redis = getRedisClient();
  if (redis) {
    try {
      const result = await redis.set(key, '1', { NX: true, EX: 300 });
      return result === 'OK';
    } catch (err) {
      logger.warn(`Redis lock error, usando fallback en memoria: ${err.message}`);
    }
  }
  // Fallback en memoria
  if (refundLocksMemory.has(key)) return false;
  refundLocksMemory.set(key, Date.now());
  return true;
}

async function releaseRefundLock(userId, type) {
  const key = `refund-lock:${userId}:${type}`;
  const redis = getRedisClient();
  if (redis) {
    try { await redis.del(key); } catch (err) { /* fallback */ }
  }
  refundLocksMemory.delete(key);
}

setInterval(() => {
  const now = Date.now();
  for (const [key, timestamp] of refundLocksMemory.entries()) {
    if (now - timestamp > 5 * 60 * 1000) {
      refundLocksMemory.delete(key);
    }
  }
}, 60 * 1000);

// ============================================
// RATE LIMITING POR USUARIO (CBU requests)
// Máximo 1 solicitud de CBU cada 10 segundos por usuario
// ============================================
const CBU_RATE_WINDOW_MS = 10000;

function checkCbuRateLimit(userId) {
  // TODO: Convertir a async en una futura refactorización para usar Redis
  const redis = getRedisClient();
  if (redis) {
    // Async no se puede usar aquí directamente, usar fallback en memoria
  }
  // Fallback en memoria
  const last = cbuRequestTimestampsMemory.get(userId);
  const now = Date.now();
  if (last && now - last < CBU_RATE_WINDOW_MS) {
    return false; // Bloqueado
  }
  cbuRequestTimestampsMemory.set(userId, now);
  return true;
}

setInterval(() => {
  const cutoff = Date.now() - CBU_RATE_WINDOW_MS * 2;
  for (const [userId, ts] of cbuRequestTimestampsMemory.entries()) {
    if (ts < cutoff) cbuRequestTimestampsMemory.delete(userId);
  }
}, 60000);

const app = express();
// Trust the first proxy hop (AWS ALB / Elastic Beanstalk / Cloudflare) so that
// Express sees the real client IP and HTTPS status from X-Forwarded-* headers.
// Without this, req.ip returns the internal LB address and Socket.IO/CORS may
// behave incorrectly when accessed through a custom domain like vipcargas.com.
app.set('trust proxy', 1);

// ============================================
// CORS ORIGIN RESOLVER (centralizado)
// ============================================
// En producción: usa la allowlist de ALLOWED_ORIGINS (obligatorio).
// Si no se configura, restringe a mismo origen (no wildcard).
// En desarrollo: acepta localhost como fallback seguro.
const DEV_ORIGINS = ['http://localhost:3000', 'http://localhost:5173', 'http://localhost:10000'];
function resolveAllowedOrigins() {
  if (process.env.ALLOWED_ORIGINS) {
    return process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean);
  }
  if (process.env.NODE_ENV === 'production') {
    // En producción sin ALLOWED_ORIGINS, no permitir orígenes cruzados.
    // Las peticiones same-origin (sin cabecera Origin) siempre pasan.
    return [];
  }
  return DEV_ORIGINS;
}

function corsOriginFn(origin, callback) {
  const allowed = resolveAllowedOrigins();
  // Requests sin cabecera Origin (curl, mobile native, same-origin GET) siempre se permiten.
  if (!origin) return callback(null, true);
  if (allowed.includes(origin)) return callback(null, true);
  // En producción sin ALLOWED_ORIGINS configurado, igual aceptamos el propio origin.
  // Sin esto, el browser bloquea sus propias requests (mismo dominio) porque
  // siempre manda Origin en POST y la allowlist vacía rechaza todo.
  // No tiramos un Error (pasa al error handler global → 500): devolvemos
  // false para que cors no agregue headers, pero la request se procesa normal
  // (las requests same-origin no necesitan headers CORS).
  logger.warn(`CORS sin allowlist match para origen: ${origin} (la request continúa sin headers CORS)`);
  return callback(null, false);
}

// Middleware que permite el propio origen en producción aunque ALLOWED_ORIGINS
// esté vacío. El browser siempre manda Origin para POST/PUT/DELETE incluso
// same-origin, y CORS sin allowlist los bloquea. Detectamos same-origin
// comparando Origin con Host (incluyendo X-Forwarded-Host del proxy de Render).
function sameOriginAllowMiddleware(req, res, next) {
  const origin = req.headers.origin;
  if (!origin) return next();
  try {
    const originHost = new URL(origin).host.toLowerCase();
    const reqHost = (req.headers['x-forwarded-host'] || req.headers.host || '').toLowerCase();
    if (originHost && reqHost && originHost === reqHost) {
      // Misma URL → permitir y proveer headers CORS para que el browser acepte.
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,PATCH,OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Requested-With,Accept,Origin');
        return res.status(204).end();
      }
    }
  } catch (_) { /* ignore malformed Origin */ }
  next();
}

const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: corsOriginFn,
    methods: ["GET", "POST"],
    credentials: true
  },
  // Force WebSocket transport for lower latency and better behavior behind ALB/NLB.
  // Clients in public/js/socket.js already request ['websocket'] so this is consistent.
  transports: ['websocket', 'polling'],
  pingInterval: 25000,
  pingTimeout: 60000,
  maxHttpBufferSize: 5 * 1024 * 1024 // 5MB — suficiente para imágenes base64 razonables
});

// ============================================
// REDIS ADAPTER FOR SOCKET.IO (horizontal scaling)
// Provide REDIS_URL (e.g. redis://user:pass@host:6379) or individual
// REDIS_HOST / REDIS_PORT / REDIS_USERNAME / REDIS_PASSWORD env vars.
// When none are set the app runs in single-instance (in-memory) mode.
// ============================================
async function setupRedisAdapter() {
  const redisUrl = process.env.REDIS_URL;
  const redisHost = process.env.REDIS_HOST;

  if (!redisUrl && !redisHost) {
    logger.warn('Redis not configured (REDIS_URL / REDIS_HOST missing). Socket.IO running in single-instance mode.');
    return;
  }

  try {
    const connectionOptions = redisUrl
      ? { url: redisUrl }
      : {
          socket: {
            host: redisHost,
            port: parseInt(process.env.REDIS_PORT || '6379', 10)
          },
          username: process.env.REDIS_USERNAME || undefined,
          password: process.env.REDIS_PASSWORD || undefined
        };

    const pubClient = createClient(connectionOptions);
    const subClient = pubClient.duplicate();

    pubClient.on('error', (err) => logger.error(`Redis pub client error: ${err.message}`));
    subClient.on('error', (err) => logger.error(`Redis sub client error: ${err.message}`));

    await Promise.all([pubClient.connect(), subClient.connect()]);

    io.adapter(createAdapter(pubClient, subClient));
    setRedisClient(pubClient);
    logger.info('Socket.IO Redis adapter initialized — multi-instance mode active');
  } catch (err) {
    logger.error(`Failed to initialize Redis adapter: ${err.message}. Falling back to single-instance mode.`);
  }
}

const PORT = process.env.PORT || 3000;
// JWT_SECRET se valida dentro del bootstrap async (después de cargar SSM).
let JWT_SECRET;

// ============================================
// MIDDLEWARE DE SEGURIDAD
// ============================================
const compression = require('compression');
app.use(compression({
  threshold: 1024,
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  }
}));
app.use(securityHeaders);
if (!process.env.ALLOWED_ORIGINS && process.env.NODE_ENV === 'production') {
  logger.warn('⚠️ SEGURIDAD: ALLOWED_ORIGINS no configurado en producción. CORS rechazará orígenes cruzados.');
}
app.use(sameOriginAllowMiddleware);
app.use(cors({
  origin: corsOriginFn,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  exposedHeaders: ['X-Total-Count', 'X-RateLimit-Remaining']
}));
app.use('/api/', generalLimiter);
app.use(express.json({ limit: '10mb' }));
app.use(mongoSanitize());
app.use(xss());

// Fields exposed to the authenticated user about their own profile.
// Keep this list minimal – internal fields (jugaygana IDs, FCM tokens, etc.)
// are excluded intentionally to reduce accidental data exposure.
const USER_PUBLIC_FIELDS = 'id username email phone phoneVerified whatsapp accountNumber role balance isActive referralCode referredByUserId referralStatus createdAt lastLogin mustChangePassword';

// Admin roles are internal VIPCARGAS accounts that have NO counterpart in
// JUGAYGANA. They must never be routed through any JUGAYGANA sync, default-
// password detection, or mustChangePassword flow.
const ADMIN_ROLES = ['admin', 'depositor', 'withdrawer'];
const isAdminRole = (role) => ADMIN_ROLES.includes(role);

// Maximum character length for a block reason stored on a user account.
// Must match the maxlength attribute in the admin panel block modal HTML.
const MAX_BLOCK_REASON_LENGTH = 500;

// Paths that are reachable while a user has `mustChangePassword: true`.
// Everything else returns 403 with `code: 'MUST_CHANGE_PASSWORD'` (enforced
// inside `authMiddleware`) so the client can re-open the mandatory change
// modal even after a page reload or a manual API call.
const MUST_CHANGE_PASSWORD_ALLOWED_PATHS = [
  '/api/auth/change-password',
  '/api/auth/change-password/send-otp',
  '/api/users/me',
  '/api/auth/logout',
  '/api/auth/admin-logout',
  '/api/auth/verify',
  '/api/health'
];

// Regex used by the SPA fallback to detect static asset paths that should
// never be served as HTML (would trigger X-Content-Type-Options: nosniff).
const STATIC_ASSET_EXT_RE = /\.(css|js|map|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot|json|webp|mp3|mp4|wav|ogg)$/i;

// Cache-Control: no-store para rutas sensibles de autenticación y administración.
// Evita que proxies, CDNs o el browser cacheen respuestas con datos personales o tokens.
app.use(['/api/auth', '/api/admin', '/api/users/me'], (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// ============================================
// ADMIN PAGE SECURITY
// ============================================

// ADMIN_HOST: if set, admin pages are ONLY served when the request Host matches.
// Configuring this env var is the primary server-side control to prevent the
// public domain from ever serving the admin panel.
const ADMIN_HOST = process.env.ADMIN_HOST || null;

// Legacy / debug HTML files that must never be served publicly.
// Use a Set for O(1) look-ups on every request.
const BLOCKED_LEGACY_ADMIN_PATHS = new Set([
  '/admin-masivo.html',
  '/admin-masivo-simple.html',
  '/admin-notificaciones-v2.html',
  '/admin-notifications.html',
  '/admin-panel.html',
  '/diagnostico-fcm.html',
  '/test-firebase.html',
  '/test-pwa.html',
]);

// Helper: parse the admin_session httpOnly cookie value.
function getAdminSessionCookie(req) {
  const cookieHeader = req.headers.cookie || '';
  for (const part of cookieHeader.split(';')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;
    const key = part.slice(0, eqIdx).trim();
    const val = part.slice(eqIdx + 1).trim();
    if (key === 'admin_session') return val;
  }
  return null;
}

// Helper: parse the admin_api_session httpOnly cookie value (Path=/api).
function getAdminApiSessionCookie(req) {
  const cookieHeader = req.headers.cookie || '';
  for (const part of cookieHeader.split(';')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;
    const key = part.slice(0, eqIdx).trim();
    const val = part.slice(eqIdx + 1).trim();
    if (key === 'admin_api_session') return val;
  }
  return null;
}

// Helper: extract the bare hostname (without port) from a request.
function parseRequestHost(req) {
  const rawHost = req.hostname || (req.headers.host || '');
  return rawHost.split(':')[0].toLowerCase();
}

// Helper: build the Set-Cookie header values for the admin session cookies.
// Returns an array: [page-scoped cookie, api-scoped cookie].
function buildAdminSessionCookieHeaders(token) {
  const maxAge = 8 * 60 * 60; // 8 hours in seconds
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return [
    `admin_session=${token}; HttpOnly; SameSite=Strict; Max-Age=${maxAge}; Path=/adminprivado2026${secure}`,
    `admin_api_session=${token}; HttpOnly; SameSite=Strict; Max-Age=${maxAge}; Path=/api${secure}`
  ];
}

// Middleware: check ADMIN_HOST restriction.
// Returns 404 (not 403) to avoid revealing that an admin endpoint exists.
function adminHostCheck(req, res, next) {
  if (!ADMIN_HOST) return next();
  if (parseRequestHost(req) !== ADMIN_HOST.toLowerCase()) {
    return res.status(404).send('Not found');
  }
  next();
}

// Middleware: verify admin_session cookie for asset requests.
// Returns 403 if cookie is absent or JWT is not an admin role.
// NOTE: Currently not applied to admin.css/admin.js because those assets are
// needed to render the login form (catch-22: can't require auth to load the
// login page). Kept here for future use when the admin login form is split
// into a separate lightweight page.
function requireAdminCookie(req, res, next) {
  const cookieVal = getAdminSessionCookie(req);
  if (!cookieVal) {
    return res.status(403).send('Forbidden');
  }
  try {
    const decoded = jwt.verify(cookieVal, JWT_SECRET);
    const adminRoles = ['admin', 'depositor', 'withdrawer'];
    if (!adminRoles.includes(decoded.role)) {
      return res.status(403).send('Forbidden');
    }
    next();
  } catch {
    return res.status(403).send('Forbidden');
  }
}

// Block legacy admin HTML files before express.static can serve them.
app.use((req, res, next) => {
  if (BLOCKED_LEGACY_ADMIN_PATHS.has(req.path.toLowerCase())) {
    return res.status(404).send('Not found');
  }
  next();
});

// ── Admin page routes ──────────────────────────────────────────────────────
// These are registered BEFORE express.static so that:
//  1. Host-based checks run before the file system is touched.
//  2. Sub-paths like /adminprivado2026/index.html return 404 (must use the
//     canonical /adminprivado2026 URL).
//  3. admin.css and admin.js are served through guarded handlers only.

// Helper: read a file or return null (defined early for these handlers).
function readFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    console.error(`Error leyendo archivo ${filePath}:`, err.message);
    return null;
  }
}

// Admin panel HTML (serves the login form + app shell; cookie NOT required
// here so first-time visitors can authenticate via the login form).
app.get(['/adminprivado2026', '/adminprivado2026/'], adminHostCheck, (req, res) => {
  const adminPath = path.join(__dirname, 'public', 'adminprivado2026', 'index.html');
  const content = readFileSafe(adminPath);
  if (!content) return res.status(500).send('Error loading admin page');
  res.setHeader('Content-Type', 'text/html');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.send(content);
});

// Admin CSS asset — host check only (cookie check intentionally omitted; see
// requireAdminCookie comment above for the rationale).
app.get('/adminprivado2026/admin.css', adminHostCheck, (req, res) => {
  const cssPath = path.join(__dirname, 'public', 'adminprivado2026', 'admin.css');
  const content = readFileSafe(cssPath);
  if (!content) return res.status(404).send('Not found');
  res.setHeader('Content-Type', 'text/css');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.send(content);
});

// Admin JS asset — host check only (same rationale as admin.css above).
app.get('/adminprivado2026/admin.js', adminHostCheck, (req, res) => {
  const jsPath = path.join(__dirname, 'public', 'adminprivado2026', 'admin.js');
  const content = readFileSafe(jsPath);
  if (!content) return res.status(404).send('Not found');
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.send(content);
});

// Catch-all: block every other path under /adminprivado2026/ (e.g. direct
// access to /adminprivado2026/index.html, /adminprivado2026/manifest.json).
// This runs BEFORE express.static so static never serves these files.
app.use('/adminprivado2026/', adminHostCheck, (req, res) => {
  res.status(404).send('Not found');
});

app.use(express.static(path.join(__dirname, 'public'), {
  dotfiles: 'deny',
  index: false,
  // Default: cache static assets for 1 day. HTML, JS, CSS and service-worker
  // files override this below so that a redeploy is picked up immediately by
  // installed PWAs and browsers without waiting 24 hours.
  maxAge: '1d',
  setHeaders: (res, filePath) => {
    // Never cache files that change with every deploy so installed PWAs always
    // get fresh code after a redeploy on AWS Elastic Beanstalk.
    const noCache =
      filePath.endsWith('.html') ||
      filePath.endsWith('.js') ||
      filePath.endsWith('.css') ||
      filePath.includes('firebase-messaging-sw') ||
      filePath.includes('user-sw') ||
      filePath.includes('admin-sw') ||
      filePath.includes('manifest.json');
    if (noCache) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
    // Serve manifest.json with the correct Content-Type for PWA installability.
    // Chrome requires application/manifest+json (or application/json) to recognise
    // the file as a Web App Manifest. Express static defaults to application/json
    // which Chrome accepts, but setting the canonical type is best practice.
    if (path.basename(filePath) === 'manifest.json') {
      res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
    }
  }
}));

// ============================================
// RUTAS DE NOTIFICACIONES PUSH (FCM)
// ============================================
const notificationRoutes = require('./src/routes/notificationRoutes');
app.use('/api/notifications', notificationRoutes);
notificationRoutes.setIo(io);

const { sendNotificationToUser: _sendPushToUser, pruneInvalidFcmTokens, sendNotificationToAllUsers } = require('./src/services/notificationService');

// ============================================
// CRON DIARIO: LIMPIEZA DE TOKENS FCM MUERTOS
// Valida cada token vía dry-run de FCM (no envía push real al dispositivo) y
// borra de la BD los que devuelven error de token inválido. Esto mantiene
// limpio el array fcmTokens y reduce la tasa de fallidos en envíos masivos.
//
// Guarda anti-overlap: si la corrida anterior aún no terminó (ej: 100K users),
// se omite la siguiente para no superponer escrituras a la misma colección.
// ============================================
const FCM_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h
let _fcmPruneRunning = false;
async function _runFcmPrune(reason) {
  if (_fcmPruneRunning) {
    logger.warn(`[FCM-prune] (${reason}) saltado: corrida anterior aún en curso`);
    return;
  }
  _fcmPruneRunning = true;
  const startedAt = Date.now();
  try {
    const result = await pruneInvalidFcmTokens(User);
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    if (result && result.success) {
      logger.info(`[FCM-prune] (${reason}) total=${result.total} valid=${result.valid} cleaned=${result.cleaned} errors=${result.errors} (${elapsed}s)`);
    } else {
      logger.warn(`[FCM-prune] (${reason}) sin resultado: ${result && result.error}`);
    }
  } catch (e) {
    logger.error(`[FCM-prune] (${reason}) excepción: ${e.message}`);
  } finally {
    _fcmPruneRunning = false;
  }
}
// Primera corrida 5 min después del arranque para no impactar el inicio del proceso
setTimeout(() => { _runFcmPrune('startup-delayed'); }, 5 * 60 * 1000);
setInterval(() => { _runFcmPrune('cron-24h'); }, FCM_PRUNE_INTERVAL_MS);

// Helper: dado un receiverId y un mensaje de chat, dispara push FCM si el user
// tiene tokens registrados. Usado por: (a) usuarios offline (canal directo
// fallido) y (b) usuarios "online" cuyo socket directo no acusó recibo en 3s
// (socket fantasma — pestaña suspendida por el SO, conexión TCP sin proceso).
// La doble entrega (sala + push) se mitiga con tag:'chat-message' que reemplaza
// notificaciones del mismo chat en el dispositivo.
function _maybeSendPushFallback(receiverId, message) {
  if (!receiverId) return;
  User.findOne({ id: receiverId })
    .then(function (targetUser) {
      const hasTokens = targetUser && (targetUser.fcmToken || (targetUser.fcmTokens && targetUser.fcmTokens.length > 0));
      if (!hasTokens) return;
      const pushTitle = 'Nuevo mensaje';
      const pushBody = message && message.type === 'image' ? '📸 Imagen'
                     : message && message.type === 'video' ? '🎥 Video'
                     : (message && message.content || '').substring(0, 100);
      sendPushIfOffline(targetUser, pushTitle, pushBody, { tag: 'chat-message' }).catch(function (e) {
        logger.warn(`[FCM] sendPushIfOffline (chat) falló para ${targetUser.username}: ${e.message}`);
      });
    })
    .catch(function (dbErr) {
      logger.warn(`[FCM] Error buscando usuario para push (chat): ${dbErr.message}`);
    });
}

// Helper: enviar push FCM a un usuario solo si no tiene socket activo.
// Evita duplicado: si el usuario ya recibió el mensaje por Socket.IO (online),
// no enviamos además un push. Solo enviamos push a usuarios offline.
//
// NOTA DE INICIALIZACIÓN: connectedUsers (const Map) se declara en la sección
// de Socket.IO más abajo (~línea 3205). Esta función nunca se invoca antes de
// esa declaración (solo se llama desde route handlers y socket handlers), por lo
// que la referencia es segura en runtime.
async function sendPushIfOffline(user, title, body, data = {}) {
  // Recopilar todos los tokens activos del usuario (array multi-token + fallback al campo individual)
  const allTokens = new Set();
  if (user.fcmTokens && user.fcmTokens.length > 0) {
    for (const entry of user.fcmTokens) {
      if (entry.token) allTokens.add(entry.token);
    }
  }
  if (user.fcmToken) allTokens.add(user.fcmToken);

  if (allTokens.size === 0) return;

  // Si el usuario tiene un socket activo, ya recibió el mensaje en tiempo real;
  // no enviamos push para evitar notificación duplicada. En su lugar emitimos
  // un evento socket 'admin_notification' para que el frontend muestre un
  // cartel in-app cuando la PWA está abierta en foreground.
  if (connectedUsers && connectedUsers.has(user.id)) {
    logger.debug(`[FCM] Usuario ${user.username} online (socket activo), omitiendo push duplicado`);
    try {
      const userSocket = connectedUsers.get(user.id);
      if (userSocket && typeof userSocket.emit === 'function') {
        userSocket.emit('admin_notification', {
          title: title,
          body: body,
          icon: (data && data.icon) || '/icons/icon-192x192.png',
          timestamp: Date.now(),
          data: data || {}
        });
        logger.info(`[NOTIF] Emitido por socket a usuario online: ${user.username}`);
      }
    } catch (emitErr) {
      logger.warn(`[NOTIF] Error emitiendo admin_notification por socket a ${user.username}: ${emitErr.message}`);
    }
    return;
  }

  for (const token of allTokens) {
    try {
      const result = await _sendPushToUser(token, title, body, data);
      if (result.success) {
        logger.info(`[FCM] Push enviado a ${user.username} (offline) token ...${token.slice(-8)}`);
      } else if (result.invalidToken) {
        // Limpiar solo ese token específico, no todos los del usuario
        try {
          await User.updateOne(
            { _id: user._id, fcmToken: token },
            { $set: { fcmToken: null, fcmTokenUpdatedAt: null } }
          );
          await User.updateOne(
            { _id: user._id },
            { $pull: { fcmTokens: { token: token } } }
          );
          logger.warn(`[FCM] Token inválido eliminado para ${user.username} (${token.slice(-8)})`);
        } catch (cleanErr) {
          logger.warn(`[FCM] Error limpiando token inválido de ${user.username}: ${cleanErr.message}`);
        }
      } else {
        logger.warn(`[FCM] Error enviando push a ${user.username}: ${result.error}`);
      }
    } catch (err) {
      logger.warn(`[FCM] Excepción enviando push a ${user.username}: ${err.message}`);
    }
  }
}

// ============================================
// FUNCIONES HELPER PARA MONGODB
// ============================================

// Generar número de cuenta
const generateAccountNumber = () => {
  return 'ACC' + Date.now().toString().slice(-8) + Math.random().toString(36).substr(2, 4).toUpperCase();
};

// Buscar usuario por teléfono
async function findUserByPhone(phone) {
  const user = await User.findOne({ $or: [{ phone }, { whatsapp: phone }] }).lean();
  if (user) {
    return { username: user.username, phone: user.phone, source: 'main' };
  }
  
  const externalUser = await ExternalUser.findOne({ $or: [{ phone }, { whatsapp: phone }] }).lean();
  if (externalUser) {
    return { username: externalUser.username, phone: externalUser.phone, source: 'external' };
  }
  
  return null;
}

// Cambiar contraseña por teléfono
async function changePasswordByPhone(phone, newPassword) {
  const user = await User.findOne({ $or: [{ phone }, { whatsapp: phone }] });
  
  if (!user) {
    return { success: false, error: 'Usuario no encontrado con ese número de teléfono' };
  }
  
  user.password = newPassword;
  user.passwordChangedAt = new Date();
  await user.save();
  
  return { success: true, username: user.username };
}

// Agregar usuario externo
async function addExternalUser(userData) {
  try {
    const { v4: uuidv4 } = require('uuid');
    await ExternalUser.findOneAndUpdate(
      { username: userData.username },
      {
        username: userData.username,
        phone: userData.phone || null,
        whatsapp: userData.whatsapp || null,
        lastSeen: new Date(),
        $inc: { messageCount: 1 },
        $setOnInsert: { 
          id: uuidv4(),
          firstSeen: new Date() 
        }
      },
      { upsert: true, new: true }
    );
  } catch (error) {
    console.error('Error agregando usuario externo:', error);
  }
}

// Registrar actividad de usuario (para fueguito)
async function recordUserActivity(userId, type, amount) {
  try {
    const today = new Date().toDateString();
    
    await UserActivity.findOneAndUpdate(
      { userId, date: today },
      {
        $inc: { [type === 'deposit' ? 'deposits' : 'withdrawals']: amount },
        lastActivity: new Date()
      },
      { upsert: true, new: true }
    );
  } catch (error) {
    console.error('Error registrando actividad:', error);
  }
}

// Verificar si tiene actividad hoy
async function hasActivityToday(userId) {
  try {
    const today = new Date().toDateString();
    const activity = await UserActivity.findOne({ userId, date: today });
    
    if (!activity) return false;
    return (activity.deposits > 0 || activity.withdrawals > 0);
  } catch (error) {
    console.error('Error verificando actividad:', error);
    return false;
  }
}

// Funciones para fecha Argentina
function getArgentinaDateString(date = new Date()) {
  const argentinaTime = new Date(date.toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }));
  return argentinaTime.toDateString();
}

function getArgentinaYesterday() {
  const now = new Date();
  const argentinaNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }));
  argentinaNow.setDate(argentinaNow.getDate() - 1);
  return argentinaNow.toDateString();
}

// ============================================
// MIDDLEWARE DE AUTENTICACIÓN
// ============================================
const authMiddleware = async (req, res, next) => {
  // Accept token from Authorization header first; fall back to admin_api_session
  // httpOnly cookie (sent automatically by the browser for same-origin requests
  // to /api/*).  This allows the admin panel to work purely via cookie without
  // storing the JWT in localStorage.
  let token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    token = getAdminApiSessionCookie(req) || null;
  }
  
  if (!token) {
    return res.status(401).json({ error: 'Token no proporcionado' });
  }
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Buscar usuario por 'id' primero, luego por '_id' como fallback
    let user = await User.findOne({ id: decoded.userId });
    
    if (!user) {
      // Intentar buscar por _id (para usuarios migrados)
      try {
        user = await User.findById(decoded.userId);
      } catch (e) {
        // _id inválido, ignorar
      }
    }
    
    if (!user) {
      return res.status(401).json({ error: 'Usuario no encontrado' });
    }

    if (!user.isActive) {
      return res.status(401).json({ error: 'Usuario desactivado' });
    }

    if (user.isBlocked === true) {
      return res.status(403).json({
        error: 'Tu cuenta está bloqueada. Contactá a soporte.',
        code: 'USER_BLOCKED',
        reason: user.blockReason || null
      });
    }
    
    if (user.tokenVersion && decoded.tokenVersion !== user.tokenVersion) {
      return res.status(401).json({ error: 'Sesión expirada. Por favor, vuelve a iniciar sesión.' });
    }
    
    req.user = decoded;

    // Touch lastSeenApp en PlayerStats (fire-and-forget, no bloquea request).
    // Solo para roles de jugador — los admins entrando al panel NO cuentan como
    // actividad de usuario. Throttled a 1 update por minuto por user para no
    // martillar Mongo en una sesion activa con muchas requests.
    const isPlayerRole = !['admin', 'depositor', 'withdrawer'].includes(user.role || 'player');
    if (isPlayerRole && user.username) {
      const now = Date.now();
      const lastTouchKey = '_lastSeenTouch_' + user.username.toLowerCase();
      if (!global[lastTouchKey] || (now - global[lastTouchKey]) > 60_000) {
        global[lastTouchKey] = now;
        // No await — fire and forget.
        PlayerStats.updateOne(
          { username: user.username.toLowerCase() },
          {
            $set: { lastSeenApp: new Date() },
            $setOnInsert: { username: user.username.toLowerCase(), userId: user.id || null }
          },
          { upsert: true }
        ).catch((e) => logger.warn(`[lastSeenApp] failed for ${user.username}: ${e.message}`));
      }
    }

    // Mandatory password change: deshabilitado por requerimiento del cliente.
    // Si el flag está seteado, lo limpiamos en caliente (self-heal universal)
    // así nunca se vuelve a disparar el bloqueo. Antes solo los admins se
    // auto-curaban; ahora aplica a cualquier rol.
    if (user.mustChangePassword === true) {
      try {
        user.mustChangePassword = false;
        await user.save();
        logger.info(`[authMiddleware] Auto-cleared mustChangePassword for ${user.username} (role=${user.role})`);
      } catch (e) {
        logger.warn(`[authMiddleware] Failed to auto-clear mustChangePassword for ${user.username}: ${e.message}`);
      }
    }

    next();
  } catch (error) {
    return res.status(401).json({ error: 'Token inválido' });
  }
};

const adminMiddleware = (req, res, next) => {
  if (req.user.role !== 'admin' && req.user.role !== 'depositor' && req.user.role !== 'withdrawer') {
    return res.status(403).json({ error: 'Acceso denegado. Solo administradores.' });
  }
  next();
};

const depositorMiddleware = (req, res, next) => {
  if (req.user.role !== 'admin' && req.user.role !== 'depositor') {
    return res.status(403).json({ error: 'Acceso denegado. Solo agentes de carga.' });
  }
  next();
};

const withdrawerMiddleware = (req, res, next) => {
  if (req.user.role !== 'admin' && req.user.role !== 'withdrawer') {
    return res.status(403).json({ error: 'Acceso denegado. Solo agentes de retiro.' });
  }
  next();
};

// ============================================
// RUTAS DE AUTENTICACIÓN
// ============================================

// Verificar disponibilidad de username
app.get('/api/auth/check-username', authLimiter, async (req, res) => {
  try {
    const { username } = req.query;
    
    if (!username || username.length < 3) {
      return res.json({ available: false, message: 'Usuario muy corto' });
    }
    
    // Buscar case-insensitive
    const localExists = await User.findOne({ 
      username: { $regex: new RegExp('^' + escapeRegex(username) + '$', 'i') } 
    });
    
    if (localExists) {
      return res.json({ available: false, message: 'Usuario ya registrado' });
    }
    
    try {
      const jgUser = await jugaygana.getUserInfoByName(username);
      if (jgUser) {
        return res.json({ 
          available: false, 
          message: 'Este nombre de usuario no está disponible. Intenta con otro nombre.'
        });
      }
    } catch (jgError) {
      logger.warn(`JUGAYGANA check failed: ${jgError.message}`);
    }
    
    res.json({ 
      available: true, 
      message: 'Usuario disponible'
    });
  } catch (error) {
    console.error('Error verificando username:', error);
    res.status(500).json({ available: false, message: 'Error del servidor' });
  }
});

// Endpoint para enviar CBU al chat
app.post('/api/admin/send-cbu', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { userId } = req.body;
    const cbuConfig = await getConfig('cbu');
    
    if (!cbuConfig || !cbuConfig.number) {
      return res.status(400).json({ error: 'CBU no configurado' });
    }
    
    const timestamp = new Date();
    
    // 1. Mensaje completo con todos los datos
    const fullMessage = `💳 *Datos para transferir:*\n\n🏦 Banco: ${cbuConfig.bank}\n👤 Titular: ${cbuConfig.titular}\n🔢 CBU: ${cbuConfig.number}\n📱 Alias: ${cbuConfig.alias}\n\n✅ Una vez realizada la transferencia, envianos el comprobante por aquí.`;
    
    await Message.create({
      id: uuidv4(),
      senderId: req.user.userId,
      senderUsername: req.user.username,
      senderRole: 'admin',
      receiverId: userId,
      receiverRole: 'user',
      content: fullMessage,
      type: 'text',
      timestamp: timestamp,
      read: false
    });
    
    // 2. CBU solo para copiar y pegar
    await Message.create({
      id: uuidv4(),
      senderId: req.user.userId,
      senderUsername: req.user.username,
      senderRole: 'admin',
      receiverId: userId,
      receiverRole: 'user',
      content: cbuConfig.number,
      type: 'text',
      timestamp: new Date(Date.now() + 100),
      read: false
    });
    
    // Notificar al usuario por socket si está conectado
    const userSocket = connectedUsers.get(userId);
    if (userSocket) {
      userSocket.emit('new_message', {
        senderId: req.user.userId,
        senderUsername: req.user.username,
        content: fullMessage,
        timestamp: timestamp,
        type: 'text'
      });
      setTimeout(() => {
        userSocket.emit('new_message', {
          senderId: req.user.userId,
          senderUsername: req.user.username,
          content: cbuConfig.number,
          timestamp: new Date(),
          type: 'text'
        });
      }, 100);
    }
    
    res.json({ success: true, message: 'CBU enviado' });
  } catch (error) {
    console.error('Error enviando CBU:', error);
    res.status(500).json({ error: 'Error enviando CBU' });
  }
});

// Health check endpoint
app.get('/api/health', async (req, res) => {
  const mongoOk = mongoose.connection.readyState === 1;
  res.json({
    status: mongoOk ? 'ok' : 'degraded'
  });
});

// Endpoint opcional para subir imágenes a S3 (requiere configuración de AWS)
app.post('/api/upload/presigned-url', authMiddleware, async (req, res) => {
  try {
    if (!process.env.S3_BUCKET) {
      return res.status(501).json({ error: 'Upload a S3 no configurado. Usar envío por base64.' });
    }
    const { filename, contentType } = req.body;
    if (!filename || !contentType) {
      return res.status(400).json({ error: 'filename y contentType requeridos' });
    }
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(contentType)) {
      return res.status(400).json({ error: 'Tipo de archivo no permitido' });
    }
    const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
    const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
    const key = `chat-images/${req.user.userId}/${Date.now()}-${filename}`;
    const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
    const command = new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: key,
      ContentType: contentType
    });
    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });
    const publicUrl = `https://${process.env.S3_BUCKET}.s3.amazonaws.com/${key}`;
    res.json({ uploadUrl, publicUrl });
  } catch (error) {
    logger.error('Error generando presigned URL:', error.message);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Registro de usuario
app.post('/api/auth/register', authLimiter, async (req, res) => {
  try {
    const { username, password, email, phone, referralCode, otpCode } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
    }
    
    if (password.length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }
    
    if (!phone || phone.trim().length < 8) {
      return res.status(400).json({ error: 'El número de teléfono es obligatorio (mínimo 8 dígitos)' });
    }

    const normalizedPhone = phone.trim();

    // Validar y verificar OTP antes de crear la cuenta
    if (!otpCode) {
      return res.status(400).json({ error: 'Se requiere el código de verificación SMS' });
    }

    if (!validateInternationalPhone(normalizedPhone)) {
      return res.status(400).json({ error: 'Número de teléfono inválido. Usa formato internacional con código de país (ej: +5491155551234)' });
    }

    const otpResult = await verifyOTP(normalizedPhone, otpCode, 'register');
    if (!otpResult.valid) {
      return res.status(400).json({ error: otpResult.error || 'Código de verificación incorrecto o expirado' });
    }

    // Check if phone is already registered and verified (second line of defense)
    const existingPhoneUser = await User.findOne({ phone: normalizedPhone, phoneVerified: true }).lean();
    if (existingPhoneUser) {
      return res.status(400).json({ error: 'Este número de teléfono ya está registrado' });
    }
    
    // Buscar case-insensitive
    const existingUser = await User.findOne({ 
      username: { $regex: new RegExp('^' + escapeRegex(username) + '$', 'i') } 
    });
    
    if (existingUser) {
      return res.status(400).json({ error: 'El usuario ya existe' });
    }

    // Resolver código de referido si fue proporcionado
    const normalizedReferralCode = referralCode ? String(referralCode).toUpperCase().trim() : null;
    let referrer = null;
    if (normalizedReferralCode) {
      referrer = await User.findOne({ referralCode: normalizedReferralCode }).lean();
      if (!referrer) {
        logger.warn(`[Register] Código de referido inválido: ${normalizedReferralCode}`);
      }
    }
    
    // Crear usuario en JUGAYGANA PRIMERO
    let jgResult = null;
    try {
      jgResult = await jugaygana.syncUserToPlatform({
        username: username,
        password: password
      });
      
      if (!jgResult.success && !jgResult.alreadyExists) {
        return res.status(400).json({ error: 'No se pudo crear el usuario en JUGAYGANA: ' + (jgResult.error || 'Error desconocido') });
      }
      
      logger.info(`User created/linked in JUGAYGANA: ${username}`);
    } catch (jgError) {
      logger.error(`Error creating user in JUGAYGANA: ${jgError.message}`);
      return res.status(400).json({ error: 'Error al crear usuario en la plataforma. Intenta con otro nombre de usuario.' });
    }
    
    // Crear usuario localmente
    const userId = uuidv4();

    // Validar referido (evitar auto-referido)
    const isValidReferral = referrer && referrer.id !== userId;

    // Generar referralCode único para el nuevo usuario (con control de colisiones)
    let newReferralCode = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = generateReferralCode();
      const collision = await User.findOne({ referralCode: candidate }).lean();
      if (!collision) { newReferralCode = candidate; break; }
    }
    if (!newReferralCode) {
      logger.warn(`[Register] No se pudo generar un referralCode único para ${username} después de 10 intentos. El usuario se creará sin código.`);
    }
    
    const newUser = await User.create({
      id: userId,
      username,
      password: password,
      email: email || null,
      phone: normalizedPhone,
      phoneVerified: true,
      role: 'user',
      accountNumber: generateAccountNumber(),
      balance: jgResult.user?.balance || jgResult.user?.user_balance || 0,
      createdAt: new Date(),
      lastLogin: null,
      isActive: true,
      jugayganaUserId: jgResult.jugayganaUserId || jgResult.user?.user_id,
      jugayganaUsername: jgResult.jugayganaUsername || jgResult.user?.user_name,
      jugayganaSyncStatus: jgResult.alreadyExists ? 'linked' : 'synced',
      // Campos de referido
      referralCode: newReferralCode,
      referredByUserId: isValidReferral ? referrer.id : null,
      referredByCode: isValidReferral ? normalizedReferralCode : null,
      referredAt: isValidReferral ? new Date() : null,
      referralStatus: isValidReferral ? 'referred' : 'none'
    });

    // Registrar evento de referido para trazabilidad
    if (isValidReferral) {
      try {
        await ReferralEvent.create({
          id: uuidv4(),
          referrerUserId: referrer.id,
          referrerUsername: referrer.username,
          referredUserId: userId,
          referredUsername: newUser.username,
          codeUsed: normalizedReferralCode,
          meta: { ip: req.ip || null, registeredAt: new Date() }
        });
        logger.info(`[Register] Referido registrado: ${newUser.username} referido por ${referrer.username} (código: ${normalizedReferralCode})`);
      } catch (refErr) {
        logger.error(`[Register] Error registrando evento de referido: ${refErr.message}`);
        // No interrumpir el flujo de registro
      }
    }
    
    // CORREGIDO: El mensaje de bienvenida se envía desde el cliente (app.js) con el formato actualizado incluyendo CBU
    // No enviamos mensaje de bienvenida desde el servidor para evitar duplicados y usar el formato correcto
    
    // Crear chat status
    await ChatStatus.create({
      userId: userId,
      username: username,
      status: 'open',
      category: 'cargas',
      lastMessageAt: new Date()
    });
    
    // Generar token con expiración de 90 días
    const token = jwt.sign(
      { userId: newUser.id, username: newUser.username, role: newUser.role },
      JWT_SECRET,
      { expiresIn: '90d' }
    );
    
    res.status(201).json({
      message: 'Usuario creado exitosamente',
      token,
      user: {
        id: newUser.id,
        username: newUser.username,
        email: newUser.email,
        phone: newUser.phone,
        accountNumber: newUser.accountNumber,
        role: newUser.role,
        balance: newUser.balance,
        jugayganaLinked: true,
        needsPasswordChange: false,
        referralCode: newUser.referralCode,
        referredBy: isValidReferral ? referrer.username : null
      }
    });
  } catch (error) {
    logger.error(`Registration error: ${error.message}`);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Login
app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const { username, phone, password } = req.body;
    
    if ((!username && !phone) || !password) {
      return res.status(400).json({ error: 'Usuario o teléfono, y contraseña requeridos' });
    }
    
    logger.debug(`Login attempt for: ${username || phone}`);
    
    // Buscar usuario case-insensitive (para soportar usernames con mayúsculas/minúsculas)
    let user;
    let dbReadFailed = false;

    if (phone && !username) {
      // Phone-based login
      const normalizedPhone = phone.trim();
      try {
        user = await User.findOne({ phone: normalizedPhone, phoneVerified: true });
      } catch (dbErr) {
        logger.error(`[Login] MongoDB read failed for phone ${normalizedPhone}: ${dbErr.message}`);
        dbReadFailed = true;
      }
    } else {
      // Username-based login
      try {
        user = await User.findOne({ 
          username: { $regex: new RegExp('^' + escapeRegex(username) + '$', 'i') } 
        });
      } catch (dbErr) {
        logger.error(`[Login] MongoDB read failed for ${username}: ${dbErr.message}`);
        dbReadFailed = true;
      }
    }

    // Fallback controlado si MongoDB no está disponible: solo con credenciales de env vars
    if (dbReadFailed) {
      const fallbackAdminUsername = process.env.ADMIN_USERNAME;
      const fallbackAdminPassword = process.env.ADMIN_PASSWORD;
      const isAdminFallback = fallbackAdminUsername && fallbackAdminPassword &&
        username === fallbackAdminUsername &&
        safeCompare(password, fallbackAdminPassword);
      if (!isAdminFallback) {
        return res.status(503).json({ error: 'Servicio temporalmente no disponible. Intenta más tarde.' });
      }
      const fallbackToken = jwt.sign(
        { userId: 'fallback-admin', username: fallbackAdminUsername, role: 'admin', tokenVersion: 0 },
        JWT_SECRET,
        { expiresIn: '4h' }
      );
      logger.warn(`[Login] Fallback admin login used (${fallbackAdminUsername}) - MongoDB was unavailable`);
      return res.json({
        token: fallbackToken,
        user: { id: 'fallback-admin', username: fallbackAdminUsername, role: 'admin', balance: 0, needsPasswordChange: false }
      });
    }
    
    // Si no existe localmente, verificar en JUGAYGANA (solo para login por username)
    if (!user && username) {
      logger.debug(`User ${username} not found locally, checking JUGAYGANA...`);
      
      const jgUser = await jugaygana.getUserInfoByName(username);
      
      if (jgUser) {
        logger.debug(`User found in JUGAYGANA, creating locally...`);
        
        const userId = uuidv4();
        
        user = await User.create({
          id: userId,
          username: jgUser.username,
          password: 'asd123',
          email: jgUser.email || null,
          phone: jgUser.phone || null,
          role: 'user',
          accountNumber: generateAccountNumber(),
          balance: jgUser.balance || 0,
          createdAt: new Date(),
          lastLogin: null,
          isActive: true,
          jugayganaUserId: jgUser.id,
          jugayganaUsername: jgUser.username,
          jugayganaSyncStatus: 'linked',
          source: 'jugaygana',
          tokenVersion: 0,
          // Auto-imported JUGAYGANA users start with the default password
          // "asd123"; force them to change it before they can use the app.
          mustChangePassword: true
        });
        
        // Crear chat status
        await ChatStatus.create({
          userId: userId,
          username: jgUser.username,
          status: 'open',
          category: 'cargas'
        });
        
        logger.info(`User ${username} auto-created from JUGAYGANA`);
      } else {
        return res.status(401).json({ error: 'Credenciales inválidas' });
      }
    } else if (!user) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    
    // Convertir a objeto plano para acceder a los campos correctamente
    const userObj = user.toObject ? user.toObject() : user;
    
    // Usar 'id' si existe, sino usar '_id' como fallback
    const userId = userObj.id || userObj._id?.toString();
    
    logger.debug(`User found: ${userObj.username}, ID: ${userId}`);
    
    const loginIdentifier = username || phone;
    
    if (!userId) {
      logger.error(`User ${loginIdentifier} has no valid ID`);
      return res.status(500).json({ error: 'Error de configuración de usuario. Contacta al administrador.' });
    }
    
    if (!userObj.isActive) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    // Reject login for blocked users before doing any further work.
    if (userObj.isBlocked === true) {
      return res.status(403).json({
        error: `Tu cuenta está bloqueada: ${userObj.blockReason || 'Contactá a soporte.'}`,
        code: 'USER_BLOCKED'
      });
    }
    
    // Verificar que el usuario tenga una contraseña válida
    if (!userObj.password) {
      logger.error(`User ${loginIdentifier} has no password configured`);
      return res.status(500).json({ error: 'Error de configuración de usuario. Contacta al administrador.' });
    }
    
    // Verificar si la contraseña almacenada es un hash bcrypt válido
    const isValidBcryptHash = userObj.password.startsWith('$2') || userObj.password.startsWith('$2a$') || userObj.password.startsWith('$2b$');
    if (!isValidBcryptHash) {
      logger.error(`User ${loginIdentifier} has password in invalid format`);
      return res.status(500).json({ error: 'Error de configuración de usuario. Contacta al administrador.' });
    }
    
    // Verificar si el usuario necesita cambiar la contraseña.
    // Admin roles (admin/depositor/withdrawer) are internal VIPCARGAS accounts and
    // must NEVER enter the mustChangePassword flow — even if their password is
    // "asd123". Only role=user is subject to this check.
    const isDefaultPassword = password === 'asd123';
    const needsPasswordChange = isAdminRole(userObj.role)
      ? false
      : ((!userObj.passwordChangedAt && userObj.source === 'jugaygana') || isDefaultPassword);
    
    let isValidPassword = false;
    
    try {
      isValidPassword = await bcrypt.compare(password, userObj.password);
    } catch (bcryptError) {
      logger.error(`Error comparing password for ${loginIdentifier}: ${bcryptError.message}`);
    }
    
    // Fallback SOLO para usuarios auto-importados desde JUGAYGANA que aún no cambiaron
    // su contraseña real (la inicial real es "asd123"). Para evitar backdoor:
    //  - Sólo aplica si source === 'jugaygana' Y nunca cambió contraseña.
    //  - Sólo aplica para role=user (admins nunca tienen contraparte en JUGAYGANA).
    //  - Valida que el hash almacenado realmente corresponda a "asd123";
    //    si la DB guarda otro hash, NO se acepta "asd123" como atajo.
    if (!isValidPassword && password === 'asd123' && !userObj.passwordChangedAt && userObj.source === 'jugaygana' && !isAdminRole(userObj.role)) {
      try {
        isValidPassword = await bcrypt.compare('asd123', userObj.password);
      } catch (bcryptError) {
        logger.error(`Error verifying JUGAYGANA default password: ${bcryptError.message}`);
      }
    }
    
    if (!isValidPassword) {
      logger.debug(`Wrong password for ${loginIdentifier}`);
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    
    logger.info(`Login successful for ${loginIdentifier}`);
    
    // Actualizar lastLogin usando el modelo de Mongoose
    user.lastLogin = new Date();
    // Persist mustChangePassword only for non-admin roles. Admins are internal
    // VIPCARGAS accounts and are never blocked by the JUGAYGANA default-password
    // flow — even if their password happens to be "asd123".
    if (needsPasswordChange && !isAdminRole(user.role) && user.mustChangePassword !== true) {
      user.mustChangePassword = true;
    }
    // Self-heal: admins must NEVER carry mustChangePassword. If a stale flag
    // from before the role-isolation fix is still in DB, clear it on next login.
    if (isAdminRole(user.role) && user.mustChangePassword === true) {
      user.mustChangePassword = false;
      logger.info(`[login] Cleared stale mustChangePassword for admin ${user.username}`);
    }
    await user.save();
    
    // Token con expiración de 30 días para persistencia de sesión
    const token = jwt.sign(
      { userId: userId, username: userObj.username, role: userObj.role, tokenVersion: userObj.tokenVersion ?? 0 },
      JWT_SECRET,
      { expiresIn: '30d' }
    );
    
    // Intentar login en JUGAYGANA para obtener token de sesión (best-effort).
    // Admin roles have no counterpart in JUGAYGANA, so skip entirely.
    let jugayganaToken = null;
    if (!isAdminRole(userObj.role)) {
      try {
        const jgLogin = await jugayganaService.loginAsUser(userObj.username, password);
        if (jgLogin.success) {
          jugayganaToken = jgLogin.token;
          logger.info(`Token JUGAYGANA obtenido para: ${loginIdentifier}`);
        } else {
          logger.warn(`No se pudo obtener token JUGAYGANA para ${loginIdentifier}: ${jgLogin.error}`);
        }
      } catch (jgErr) {
        logger.warn(`Error obteniendo token JUGAYGANA para ${loginIdentifier}: ${jgErr.message}`);
      }
    }
    
    // Set an httpOnly admin session cookie for admin roles so that the server
    // can verify, on subsequent page requests, that the browser was genuinely
    // authenticated — not just checking localStorage (client-side only).
    // An httpOnly, SameSite=Strict, path-scoped cookie is the recommended
    // alternative to localStorage for session tokens: it is inaccessible to
    // JavaScript (XSS-safe) and is scoped to the admin path only.
    const adminRoles = ['admin', 'depositor', 'withdrawer'];
    if (adminRoles.includes(userObj.role)) {
      // Set two httpOnly cookies: one for page access, one for API calls.
      // Neither can be read by client-side scripts (XSS-safe).
      const adminCookieToken = jwt.sign(
        { userId: userId, username: userObj.username, role: userObj.role },
        JWT_SECRET,
        { expiresIn: '8h' }
      );
      res.setHeader('Set-Cookie', buildAdminSessionCookieHeaders(adminCookieToken));
    }

    res.json({
      message: 'Login exitoso',
      token,
      jugayganaToken,
      user: {
        id: userId,
        username: userObj.username,
        email: userObj.email,
        phone: userObj.phone || null,
        phoneVerified: userObj.phoneVerified || false,
        whatsapp: userObj.whatsapp || null,
        accountNumber: userObj.accountNumber,
        role: userObj.role,
        balance: userObj.balance,
        jugayganaLinked: !!userObj.jugayganaUserId,
        needsPasswordChange: needsPasswordChange,
        // Cambio de contraseña obligatorio deshabilitado por requerimiento.
        mustChangePassword: false
      }
    });
  } catch (error) {
    logger.error(`Login error: ${error.message}`);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================
// LOGIN SOLO-USUARIO (acceso simplificado a reembolsos)
// El usuario solo ingresa su username; si existe, se le devuelve un token
// con permisos limitados que sirve para consultar/reclamar reembolsos.
// Para entrar a la plataforma de juego sigue necesitando su contraseña real.
// ============================================
function pickLinePhoneForUsername(linesConfig, username) {
  if (!linesConfig || typeof linesConfig !== 'object') return null;
  const slots = Array.isArray(linesConfig.slots) ? linesConfig.slots : [];
  const defaultPhone = linesConfig.defaultPhone || null;
  const lower = String(username || '').toLowerCase();
  let bestMatch = null;
  for (const slot of slots) {
    if (!slot || !slot.prefix || !slot.phone) continue;
    const prefix = String(slot.prefix).toLowerCase().trim();
    if (!prefix) continue;
    if (lower.startsWith(prefix)) {
      if (!bestMatch || prefix.length > bestMatch.prefix.length) {
        bestMatch = { prefix, phone: String(slot.phone).trim() };
      }
    }
  }
  return bestMatch ? bestMatch.phone : defaultPhone;
}

// Mismo criterio que pickLinePhoneForUsername pero para el nombre del equipo.
// Lee el campo `teamName` del MISMO config 'userLinesByPrefix' (no creamos
// otra config porque conceptualmente es el mismo equipo: prefijo "ato" =
// numero "+54..." = nombre "Atomic"). Devuelve el teamName del prefijo mas
// largo que matchee, o '' si no matchea ninguno y no hay default.
function pickTeamNameForUsername(linesConfig, username) {
  if (!linesConfig || typeof linesConfig !== 'object') return '';
  const slots = Array.isArray(linesConfig.slots) ? linesConfig.slots : [];
  const defaultName = linesConfig.defaultTeamName || '';
  const lower = String(username || '').toLowerCase();
  let bestMatch = null;
  for (const slot of slots) {
    if (!slot || !slot.prefix) continue;
    const prefix = String(slot.prefix).toLowerCase().trim();
    if (!prefix) continue;
    const teamName = (slot.teamName ? String(slot.teamName) : '').trim();
    if (!teamName) continue;
    if (lower.startsWith(prefix)) {
      if (!bestMatch || prefix.length > bestMatch.prefix.length) {
        bestMatch = { prefix, teamName };
      }
    }
  }
  return bestMatch ? bestMatch.teamName : defaultName;
}

// Mismo criterio que pickLinePhoneForUsername pero para los links de comunidad.
// Usa la config 'userCommunitiesByPrefix' con shape { slots: [{prefix, link}], defaultLink }.
function pickCommunityLinkForUsername(communitiesConfig, username) {
  if (!communitiesConfig || typeof communitiesConfig !== 'object') return null;
  const slots = Array.isArray(communitiesConfig.slots) ? communitiesConfig.slots : [];
  const defaultLink = communitiesConfig.defaultLink || null;
  const lower = String(username || '').toLowerCase();
  let bestMatch = null;
  for (const slot of slots) {
    if (!slot || !slot.prefix || !slot.link) continue;
    const prefix = String(slot.prefix).toLowerCase().trim();
    if (!prefix) continue;
    if (lower.startsWith(prefix)) {
      if (!bestMatch || prefix.length > bestMatch.prefix.length) {
        bestMatch = { prefix, link: String(slot.link).trim() };
      }
    }
  }
  return bestMatch ? bestMatch.link : defaultLink;
}

// Probe endpoint para verificar versión deployada (no requiere auth)
app.get('/api/auth/_probe', (req, res) => {
  res.json({ version: 'refunds-only-v3', endpoint: 'login-username-only', timestamp: new Date().toISOString() });
});

app.post('/api/auth/login-username-only', authLimiter, async (req, res, next) => {
  console.log('[LoginUsernameOnly] HIT', { body: req.body, ip: req.ip });
  try {
    const { username } = req.body || {};
    if (!username || typeof username !== 'string' || !username.trim()) {
      return res.status(400).json({ error: 'Usuario requerido' });
    }
    const cleanUsername = username.trim();

    // Lookup rápido (max 3s). Antes del query, ensureMongoReady fuerza una
    // reconexión si el driver se quedó stuck en disconnected (pasa con blips
    // de Atlas que el auto-reconnect a veces no rescata).
    let user;
    try {
      await ensureMongoReady(4000);
      user = await User.findOne({
        username: { $regex: new RegExp('^' + escapeRegex(cleanUsername) + '$', 'i') }
      }).maxTimeMS(3000);
    } catch (dbErr) {
      logger.error(`[LoginUsernameOnly] DB read FAIL for ${cleanUsername}: ${dbErr.name}: ${dbErr.message}`);
      return res.status(503).json({ error: `Servicio temporalmente no disponible (${dbErr.name || 'DB'}). Intentá en 30s.` });
    }

    // Si no existe localmente, probar JUGAYGANA (mismo flujo que el login normal).
    // Hard timeout de 8s: si JUGAYGANA está lento o caído, no dejamos colgar
    // la request completa (Cloudflare/Render mata a los ~30-100s y devuelve 502).
    if (!user) {
      try {
        const jgUser = await Promise.race([
          jugaygana.getUserInfoByName(cleanUsername),
          new Promise((_, reject) => setTimeout(() => reject(new Error('JUGAYGANA lookup timeout 8s')), 8000))
        ]);
        if (jgUser) {
          const userId = uuidv4();
          user = await User.create({
            id: userId,
            username: jgUser.username,
            password: 'asd123',
            email: jgUser.email || null,
            phone: jgUser.phone || null,
            role: 'user',
            accountNumber: generateAccountNumber(),
            balance: jgUser.balance || 0,
            createdAt: new Date(),
            lastLogin: null,
            isActive: true,
            jugayganaUserId: jgUser.id,
            jugayganaUsername: jgUser.username,
            jugayganaSyncStatus: 'linked',
            source: 'jugaygana',
            tokenVersion: 0,
            mustChangePassword: true
          });
          await ChatStatus.create({
            userId,
            username: jgUser.username,
            status: 'open',
            category: 'cargas'
          });
          logger.info(`User ${cleanUsername} auto-created from JUGAYGANA via username-only login`);
        }
      } catch (jgErr) {
        logger.warn(`[LoginUsernameOnly] JUGAYGANA lookup failed: ${jgErr.message}`);
      }
    }

    if (!user) {
      return res.status(404).json({ error: 'Usuario no disponible' });
    }

    const userObj = user.toObject ? user.toObject() : user;
    const userId = userObj.id || userObj._id?.toString();

    if (!userId) {
      logger.error(`[LoginUsernameOnly] User found but has no id (username=${userObj.username})`);
      return res.status(500).json({ error: 'Error de configuración de usuario' });
    }

    if (userObj.isActive === false) {
      return res.status(404).json({ error: 'Usuario no disponible' });
    }
    if (userObj.isBlocked === true) {
      return res.status(403).json({
        error: `Tu cuenta está bloqueada: ${userObj.blockReason || 'Contactá a soporte.'}`,
        code: 'USER_BLOCKED'
      });
    }
    if (isAdminRole(userObj.role)) {
      return res.status(403).json({ error: 'Usuario no disponible' });
    }

    // Best-effort: actualizar lastLogin sin romper si el doc viejo falla validación.
    try {
      await User.updateOne({ id: userId }, { $set: { lastLogin: new Date() } });
    } catch (saveErr) {
      logger.warn(`[LoginUsernameOnly] No se pudo actualizar lastLogin para ${userObj.username}: ${saveErr.message}`);
    }

    let token;
    try {
      token = jwt.sign(
        { userId, username: userObj.username, role: userObj.role, tokenVersion: userObj.tokenVersion ?? 0 },
        JWT_SECRET,
        { expiresIn: '30d' }
      );
    } catch (jwtErr) {
      logger.error(`[LoginUsernameOnly] jwt.sign falló: ${jwtErr.message}`);
      return res.status(500).json({ error: 'Error generando token' });
    }

    let linePhone = null;
    try {
      // Prioridad 1: asignación explícita por Drive import (User.linePhone).
      // Si el admin importó este username desde un .xlsx, ese teléfono manda
      // por encima del matcher por prefijo. Permite que dos usuarios con el
      // mismo prefijo caigan en líneas distintas.
      if (userObj.linePhone) {
        linePhone = userObj.linePhone;
      } else {
        // Fallback: matcher por prefijo (comportamiento legacy).
        const linesConfig = await getConfig('userLinesByPrefix');
        linePhone = pickLinePhoneForUsername(linesConfig, userObj.username);
      }
    } catch (cfgErr) {
      logger.warn(`[LoginUsernameOnly] No se pudo cargar userLinesByPrefix: ${cfgErr.message}`);
    }

    res.json({
      message: 'Login exitoso',
      token,
      user: {
        id: userId,
        username: userObj.username,
        role: userObj.role
      },
      linePhone
    });
  } catch (error) {
    console.error('[LoginUsernameOnly] OUTER CATCH:', error.name, error.message, error.stack);
    logger.error(`Login username-only error (${error.name}): ${error.message}\n${error.stack}`);
    if (!res.headersSent) {
      return res.status(500).json({ error: `Error del servidor: ${error.name}: ${error.message}` });
    }
  }
});

// Devuelve la línea vigente del usuario autenticado (para refrescar sin re-login).
app.get('/api/user-lines/me', authMiddleware, async (req, res) => {
  try {
    // Refetch del User para leer linePhone/lineTeamName (no están en el JWT).
    // Query indexada por `id` — costo despreciable.
    let userDoc = null;
    try {
      userDoc = await User.findOne({ id: req.user.userId })
        .select('username linePhone lineTeamName')
        .lean();
    } catch (lookupErr) {
      logger.warn(`[user-lines/me] User lookup falló: ${lookupErr.message}`);
    }

    let phone = null;
    let teamName = null;

    // Prioridad 1: asignación explícita por Drive import.
    if (userDoc && userDoc.linePhone) phone = userDoc.linePhone;
    if (userDoc && userDoc.lineTeamName) teamName = userDoc.lineTeamName;

    // Fallback: matcher por prefijo legacy. Solo se usa si el campo correspondiente
    // está vacío — permite tener phone explícito y teamName por prefijo (o viceversa).
    if (!phone || !teamName) {
      const linesConfig = await getConfig('userLinesByPrefix');
      if (!phone) phone = pickLinePhoneForUsername(linesConfig, req.user.username);
      if (!teamName) teamName = pickTeamNameForUsername(linesConfig, req.user.username);
    }

    // En el mismo response devolvemos el link de comunidad correspondiente
    // para evitar un round-trip adicional desde el cliente.
    const communitiesConfig = await getConfig('userCommunitiesByPrefix');
    const communityLink = pickCommunityLinkForUsername(communitiesConfig, req.user.username);
    res.json({
      phone: phone || null,
      teamName: teamName || null,
      communityLink: communityLink || null
    });
  } catch (error) {
    logger.error(`user-lines/me error: ${error.message}`);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// User logout — limpia el token FCM actual del backend para que las
// notificaciones no sigan llegando a este dispositivo después de cerrar
// sesión. Acepta el fcmToken por body o por query; si no viene, intenta
// inferirlo del header Authorization (último token registrado del user).
// Nunca devuelve 401: cerrar sesión siempre es válido aunque el token JWT
// esté expirado.
app.post('/api/auth/logout', async (req, res) => {
  try {
    const fcmToken = (req.body && req.body.fcmToken) || (req.query && req.query.fcmToken) || null;

    // Intentar identificar al usuario por el JWT. Si está expirado o ausente,
    // hacemos best-effort: borramos el fcmToken provisto donde sea que esté.
    let userId = null;
    const authHeader = req.headers.authorization || '';
    const authToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (authToken) {
      try {
        const decoded = jwt.verify(authToken, JWT_SECRET);
        userId = decoded.userId;
      } catch (_) {
        // JWT expirado/inválido: igual seguimos para limpiar por token si vino
      }
    }

    if (fcmToken) {
      const tokenStr = String(fcmToken);
      // Borrar del array fcmTokens y del campo individual donde coincida
      if (userId) {
        await User.updateOne(
          { id: userId },
          { $pull: { fcmTokens: { token: tokenStr } } }
        );
        await User.updateOne(
          { id: userId, fcmToken: tokenStr },
          { $set: { fcmToken: null, fcmTokenUpdatedAt: null } }
        );
      } else {
        // Sin userId verificado: borrar el token donde sea que esté.
        await User.updateMany(
          { 'fcmTokens.token': tokenStr },
          { $pull: { fcmTokens: { token: tokenStr } } }
        );
        await User.updateMany(
          { fcmToken: tokenStr },
          { $set: { fcmToken: null, fcmTokenUpdatedAt: null } }
        );
      }
      logger.info(`[AUTH] logout: token FCM eliminado (user=${userId || 'unknown'}, token=...${tokenStr.slice(-8)})`);
    }

    res.json({ success: true });
  } catch (error) {
    // Logout siempre debe responder OK al cliente; loggeamos para diagnóstico.
    logger.warn(`[AUTH] logout: error limpiando token FCM: ${error.message}`);
    res.json({ success: true });
  }
});

// Admin logout — clears both admin httpOnly cookies.
// No authentication required: clearing a cookie is harmless.
app.post('/api/auth/admin-logout', (req, res) => {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', [
    `admin_session=; HttpOnly; SameSite=Strict; Max-Age=0; Path=/adminprivado2026${secure}`,
    `admin_api_session=; HttpOnly; SameSite=Strict; Max-Age=0; Path=/api${secure}`
  ]);
  res.json({ success: true });
});

// Verify token
app.get('/api/auth/verify', authMiddleware, async (req, res) => {
  try {
    // Buscar usuario completo
    const user = await User.findOne({ id: req.user.userId }).select('-password').lean();
    
    if (!user) {
      return res.status(401).json({ error: 'Usuario no encontrado' });
    }
    
    res.json({ 
      valid: true,
      user: {
        userId: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        balance: user.balance,
        mustChangePassword: false
      }
    });
  } catch (error) {
    console.error('Error verificando token:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// GET /api/admin/me — verify admin session via httpOnly cookie and return admin info.
// The frontend uses this on page load instead of reading from localStorage.
// Also returns a short-lived token for in-memory Socket.IO authentication.
app.get('/api/admin/me', async (req, res) => {
  const cookieToken = getAdminApiSessionCookie(req);
  if (!cookieToken) {
    return res.status(401).json({ error: 'No autenticado' });
  }
  try {
    const decoded = jwt.verify(cookieToken, JWT_SECRET);
    const adminRoles = ['admin', 'depositor', 'withdrawer'];
    if (!adminRoles.includes(decoded.role)) {
      return res.status(403).json({ error: 'Acceso denegado' });
    }
    // Fetch fresh user info from DB
    let user = await User.findOne({ id: decoded.userId }).select('-password').lean();
    if (!user) {
      return res.status(401).json({ error: 'Usuario no encontrado' });
    }
    if (!user.isActive) {
      return res.status(401).json({ error: 'Usuario desactivado' });
    }
    // Issue a fresh short-lived in-memory token for Socket.IO auth.
    // This is NOT stored in localStorage — only held in JavaScript memory.
    const freshToken = jwt.sign(
      { userId: user.id, username: user.username, role: user.role, tokenVersion: user.tokenVersion ?? 0 },
      JWT_SECRET,
      { expiresIn: '8h' }
    );
    res.json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        phone: user.phone || null,
        phoneVerified: user.phoneVerified || false,
        role: user.role,
        balance: user.balance,
        needsPasswordChange: !user.passwordChangedAt
      },
      token: freshToken
    });
  } catch (error) {
    return res.status(401).json({ error: 'Sesión inválida o expirada' });
  }
});

// Obtener información del usuario actual
app.get('/api/users/me', authMiddleware, async (req, res) => {
  try {
    // Buscar por 'id' primero, luego por '_id' como fallback
    let user = await User.findOne({ id: req.user.userId })
      .select(USER_PUBLIC_FIELDS)
      .lean();
    
    if (!user) {
      try {
        user = await User.findById(req.user.userId)
          .select(USER_PUBLIC_FIELDS)
          .lean();
      } catch (e) {
        // _id inválido, ignorar
      }
    }
    
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    
    res.json(user);
  } catch (error) {
    console.error('Error obteniendo usuario:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Sincroniza la contraseña con JUGAYGANA reintentando hasta 3 veces.
// Si tras los 3 intentos no se puede sincronizar, crea un mensaje interno
// (adminOnly) en el chat del usuario para que los admins sepan que la
// contraseña quedó desincronizada y puedan corregirla manualmente.
async function syncPasswordToJugaygana(user, newPassword, context) {
  if (isAdminRole(user.role)) {
    return { success: true, skipped: true };
  }

  const MAX_ATTEMPTS = 3;
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const jgResult = await jugayganaService.changeUserPasswordAsAdmin(user.username, newPassword);
      if (jgResult.success) {
        logger.info(`[pwd-sync] Sincronizada con JUGAYGANA (${context}) para ${user.username} en intento ${attempt}/${MAX_ATTEMPTS}`);
        return { success: true, attempts: attempt };
      }
      lastError = jgResult.error || 'Error desconocido';
      logger.warn(`[pwd-sync] Intento ${attempt}/${MAX_ATTEMPTS} falló para ${user.username}: ${lastError}`);
    } catch (err) {
      lastError = err.message;
      logger.error(`[pwd-sync] Intento ${attempt}/${MAX_ATTEMPTS} con excepción para ${user.username}: ${lastError}`);
    }

    if (attempt < MAX_ATTEMPTS) {
      await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt - 1)));
    }
  }

  logger.error(`[pwd-sync] Falló sync con JUGAYGANA para ${user.username} tras ${MAX_ATTEMPTS} intentos. Último error: ${lastError}`);

  try {
    await Message.create({
      id: uuidv4(),
      senderId: 'system',
      senderUsername: 'SYSTEM',
      senderRole: 'system',
      receiverId: user.id,
      receiverRole: 'user',
      content: `⚠️ SYNC FALLIDO: el usuario cambió su contraseña en VIPCARGAS pero no se pudo sincronizar con jugaygana44.bet tras ${MAX_ATTEMPTS} intentos. Último error: "${lastError}". Revisar y actualizar la contraseña manualmente en la plataforma. Contexto: ${context}.`,
      type: 'system',
      adminOnly: true,
      read: true,
      timestamp: new Date()
    });
    logger.info(`[pwd-sync] Mensaje interno creado para admins en chat de ${user.username}`);
  } catch (msgErr) {
    logger.error(`[pwd-sync] No se pudo crear mensaje interno para ${user.username}: ${msgErr.message}`);
  }

  return { success: false, attempts: MAX_ATTEMPTS, error: lastError };
}

// Cambiar contraseña
app.post('/api/auth/change-password', authMiddleware, authLimiter, async (req, res) => {
  try {
    const { currentPassword, newPassword, whatsapp, phone, otpCode, closeAllSessions } = req.body;

    // Buscar por 'id' primero, luego por '_id' como fallback
    let user = await User.findOne({ id: req.user.userId });

    if (!user) {
      try {
        user = await User.findById(req.user.userId);
      } catch (e) {
        // _id inválido, ignorar
      }
    }

    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }

    // Verificar contrasena actual antes de permitir el cambio. Esto evita que un atacante
    // que haya capturado un JWT (XSS, malware, sesion abierta en dispositivo prestado) tome
    // el control permanente de la cuenta. Excepciones legitimas:
    //  - mustChangePassword === true: el usuario fue importado/reseteado y debe rotar.
    //  - cambio/alta de telefono: la prueba de posesion es el OTP que se valida mas abajo.
    const requestedPhonePeek = (typeof phone === 'string' && phone.trim())
      || (typeof whatsapp === 'string' && whatsapp.trim())
      || null;
    const willVerifyOtp = !!(requestedPhonePeek && (!user.phone || !user.phoneVerified || requestedPhonePeek.trim() !== user.phone));
    if (!user.mustChangePassword && !willVerifyOtp) {
      if (!currentPassword || typeof currentPassword !== 'string') {
        return res.status(400).json({ error: 'Debes ingresar tu contraseña actual' });
      }
      const ok = await bcrypt.compare(currentPassword, user.password || '');
      if (!ok) {
        logger.warn(`change-password: contrasena actual incorrecta para ${user.username}`);
        return res.status(401).json({ error: 'Contraseña actual incorrecta' });
      }
    }

    // Determinar si el usuario YA tiene un teléfono verificado vía OTP.
    // Solo en ese caso se permite cambiar la contraseña sin volver a verificar nada.
    const hasVerifiedPhone = !!(user.phone && user.phoneVerified === true);

    // Resolver el "nuevo teléfono" propuesto: priorizar `phone` (formato internacional),
    // y como fallback aceptar `whatsapp` por compatibilidad con el cliente actual.
    const requestedPhoneRaw = (typeof phone === 'string' && phone.trim())
      || (typeof whatsapp === 'string' && whatsapp.trim())
      || null;
    const requestedPhone = requestedPhoneRaw ? requestedPhoneRaw.trim() : null;

    // ¿Se está intentando agregar/cambiar el teléfono?
    // - Si el usuario NO tiene teléfono verificado y se envió un teléfono → exigir OTP.
    // - Si el usuario YA tiene teléfono verificado y se envió un teléfono distinto → exigir OTP.
    // - Si el usuario YA tiene teléfono verificado y NO se envió teléfono (o coincide) → no se exige OTP,
    //   solo se valida la contraseña actual del usuario (esto cubre el caso "cambio de contraseña sin tocar teléfono").
    let isPhoneChange = false;
    if (requestedPhone) {
      if (!hasVerifiedPhone) {
        isPhoneChange = true;
      } else if (requestedPhone !== user.phone) {
        isPhoneChange = true;
      }
    } else if (!hasVerifiedPhone) {
      // No tiene teléfono verificado y no envió uno → no podemos guardar phoneVerified=true,
      // pero permitimos cambiar la contraseña. (No debería ocurrir desde el flujo forzado,
      // ya que el front exige el teléfono cuando no hay uno verificado.)
      isPhoneChange = false;
    }

    if (isPhoneChange) {
      // Validar formato del teléfono propuesto.
      if (!validateInternationalPhone(requestedPhone)) {
        return res.status(400).json({
          error: 'Número de teléfono inválido. Usá formato internacional con código de país (ej: +5491155551234)'
        });
      }
      // Exigir código OTP previamente enviado vía /api/auth/change-password/send-otp.
      if (!otpCode || String(otpCode).trim().length < 6) {
        return res.status(400).json({ error: 'Se requiere el código de verificación SMS' });
      }
      // Verificar que el teléfono no esté ya registrado y verificado por otro usuario.
      const otherUser = await User.findOne({
        phone: requestedPhone,
        phoneVerified: true,
        id: { $ne: user.id }
      }).lean();
      if (otherUser) {
        return res.status(400).json({ error: 'Este número de teléfono ya está registrado por otra cuenta' });
      }
      const otpResult = await verifyOTP(requestedPhone, String(otpCode).trim(), 'change-password');
      if (!otpResult.valid) {
        return res.status(400).json({ error: otpResult.error || 'Código de verificación incorrecto o expirado' });
      }
      // OTP válido: persistir teléfono verificado.
      user.phone = requestedPhone;
      user.phoneVerified = true;
      user.smsConsent = true;
      // Mantener `whatsapp` sincronizado para compatibilidad con vistas que lo siguen leyendo.
      user.whatsapp = requestedPhone;
    }

    // Asignar contraseña en texto plano; el middleware pre-save del modelo la hasheará
    user.password = newPassword;
    user.passwordChangedAt = new Date();
    // The user just changed their password (and verified the OTP for any new
    // phone, if applicable). Lift the mandatory-change flag so the rest of the
    // API stops returning 403 MUST_CHANGE_PASSWORD on subsequent requests.
    user.mustChangePassword = false;
    
    if (closeAllSessions) {
      user.tokenVersion = (user.tokenVersion || 0) + 1;
    }
    
    await user.save();

    await syncPasswordToJugaygana(user, newPassword, 'change-password');

    res.json({
      message: 'Contraseña cambiada exitosamente',
      sessionsClosed: closeAllSessions || false,
      phoneVerified: !!user.phoneVerified,
      phone: user.phone || null
    });
  } catch (error) {
    logger.error(`Error en change-password: ${error.message}`);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Enviar OTP para verificar el teléfono nuevo durante un cambio de contraseña
// (aplica tanto al cambio obligatorio del primer login como al cambio desde el perfil).
// Reutiliza generateAndSendOTP/verifyOTP del PR #260 con un nuevo `purpose`.
app.post('/api/auth/change-password/send-otp', authMiddleware, sensitiveLimiter, smsIpLimiter, async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone || typeof phone !== 'string') {
      return res.status(400).json({ error: 'Número de teléfono requerido' });
    }

    const normalizedPhone = phone.trim();
    if (!validateInternationalPhone(normalizedPhone)) {
      return res.status(400).json({
        error: 'Número de teléfono inválido. Usá formato internacional con código de país (ej: +5491155551234)'
      });
    }

    // Buscar el usuario autenticado.
    let user = await User.findOne({ id: req.user.userId }).lean();
    if (!user) {
      try {
        user = await User.findById(req.user.userId).lean();
      } catch (e) { /* ignorar id inválido */ }
    }
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    // Si otro usuario distinto ya tiene este teléfono verificado, rechazar.
    const otherUser = await User.findOne({
      phone: normalizedPhone,
      phoneVerified: true,
      id: { $ne: user.id }
    }).lean();
    if (otherUser) {
      return res.status(400).json({ error: 'Este número de teléfono ya está registrado por otra cuenta' });
    }

    const result = await generateAndSendOTP(normalizedPhone, 'change-password');
    if (!result.success) {
      return res.status(429).json({ error: result.error });
    }

    const maskedPhone = normalizedPhone.replace(/(\+\d{1,4})\d+(\d{4})$/, '$1****$2');
    res.json({
      success: true,
      pendingVerification: true,
      phone: maskedPhone,
      message: 'Te enviamos un código SMS al número indicado'
    });
  } catch (error) {
    logger.error(`Error en change-password/send-otp: ${error.message}`);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Platform login: obtener token de JUGAYGANA para auto-login
app.post('/api/auth/platform-login', authMiddleware, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ error: 'Contraseña requerida' });
    }

    const user = await User.findOne({ id: req.user.userId });
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Contraseña incorrecta' });
    }

    const jgLogin = await jugayganaService.loginAsUser(user.username, password);
    if (!jgLogin.success) {
      return res.status(502).json({ error: `No se pudo iniciar sesión en la plataforma: ${jgLogin.error}` });
    }

    res.json({
      success: true,
      jugayganaToken: jgLogin.token,
      platformUrl: 'https://www.jugaygana44.bet'
    });
  } catch (error) {
    logger.error(`Error en platform-login: ${error.message}`);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================
// RUTAS PÚBLICAS - OTP / VERIFICACIÓN SMS
// ============================================

// Enviar OTP para verificación de teléfono en el registro
app.post('/api/auth/send-register-otp', sensitiveLimiter, smsIpLimiter, async (req, res) => {
  try {
    const { phone, username } = req.body;

    if (!phone || typeof phone !== 'string') {
      return res.status(400).json({ error: 'Número de teléfono requerido' });
    }

    const normalizedPhone = phone.trim();
    if (!validateInternationalPhone(normalizedPhone)) {
      return res.status(400).json({ error: 'Número de teléfono inválido. Usa formato internacional con código de país (ej: +5491155551234)' });
    }

    // Validar username si fue proporcionado
    if (username) {
      const existing = await User.findOne({
        username: { $regex: new RegExp('^' + escapeRegex(String(username).trim()) + '$', 'i') }
      }).lean();
      if (existing) {
        return res.status(400).json({ error: 'El nombre de usuario ya está en uso' });
      }
    }

    // Verificar que el teléfono no esté ya registrado y verificado
    const existingPhone = await User.findOne({ phone: normalizedPhone, phoneVerified: true }).lean();
    if (existingPhone) {
      return res.status(400).json({ error: 'Este número de teléfono ya está registrado' });
    }

    const result = await generateAndSendOTP(normalizedPhone, 'register');

    if (!result.success) {
      return res.status(429).json({ error: result.error });
    }

    const maskedPhone = normalizedPhone.replace(/(\+\d{1,4})\d+(\d{4})$/, '$1****$2');

    res.json({
      success: true,
      pendingVerification: true,
      phone: maskedPhone,
      message: 'Te enviamos un código SMS al número indicado'
    });
  } catch (error) {
    logger.error(`Error en send-register-otp: ${error.message}`);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Solicitar OTP para login por teléfono (anti-enumeration: siempre responde igual)
app.post('/api/auth/login-otp-request', authLimiter, smsIpLimiter, async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone || typeof phone !== 'string') {
      return res.status(400).json({ error: 'Número de teléfono requerido' });
    }
    const normalizedPhone = phone.trim();
    if (!validateInternationalPhone(normalizedPhone)) {
      return res.status(400).json({ error: 'Número de teléfono inválido' });
    }

    // Check if user exists with this phone (verified)
    const user = await User.findOne({ phone: normalizedPhone, phoneVerified: true }).lean();

    // ANTI-ENUMERATION: Always respond the same way
    if (user) {
      try {
        await generateAndSendOTP(normalizedPhone, 'login');
      } catch (err) {
        logger.warn(`[LoginOTP] Error generando OTP: ${err.message}`);
      }
    }

    // Always return success to prevent phone enumeration
    const maskedPhone = normalizedPhone.replace(/(\+\d{1,4})\d+(\d{4})$/, '$1****$2');
    res.json({
      success: true,
      message: 'Si el número está registrado, recibirás un código SMS',
      phone: maskedPhone
    });
  } catch (error) {
    logger.error(`[LoginOTP] Error: ${error.message}`);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Verificar OTP para login por teléfono
app.post('/api/auth/login-otp-verify', authLimiter, async (req, res) => {
  try {
    const { phone, code } = req.body;
    if (!phone || !code) {
      return res.status(400).json({ error: 'Teléfono y código requeridos' });
    }
    const normalizedPhone = phone.trim();

    const otpResult = await verifyOTP(normalizedPhone, code, 'login');
    if (!otpResult.valid) {
      return res.status(400).json({ error: otpResult.error || 'Código incorrecto o expirado' });
    }

    const user = await User.findOne({ phone: normalizedPhone, phoneVerified: true });
    if (!user) {
      return res.status(400).json({ error: 'Código incorrecto o expirado' });
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    const userObj = user.toObject ? user.toObject() : user;
    const userId = userObj.id || userObj._id?.toString();

    // Generate token (same as regular login)
    const token = jwt.sign(
      { userId: userId, username: userObj.username, role: userObj.role, tokenVersion: userObj.tokenVersion || 0 },
      JWT_SECRET,
      { expiresIn: '90d' }
    );

    // Set admin cookies if applicable
    const adminRoles = ['admin', 'depositor', 'withdrawer'];
    if (adminRoles.includes(userObj.role)) {
      const adminCookieToken = jwt.sign(
        { userId: userId, username: userObj.username, role: userObj.role },
        JWT_SECRET,
        { expiresIn: '8h' }
      );
      res.setHeader('Set-Cookie', buildAdminSessionCookieHeaders(adminCookieToken));
    }

    logger.info(`Login successful for ${userObj.username} via OTP`);

    res.json({
      message: 'Login exitoso',
      token,
      user: {
        id: userId,
        userId: userId,
        username: userObj.username,
        email: userObj.email,
        phone: userObj.phone,
        phoneVerified: userObj.phoneVerified || false,
        whatsapp: userObj.whatsapp || null,
        accountNumber: userObj.accountNumber,
        role: userObj.role,
        balance: userObj.balance,
        jugayganaLinked: !!userObj.jugayganaUserId,
        needsPasswordChange: false,
        // Cambio de contraseña obligatorio deshabilitado por requerimiento.
        mustChangePassword: false,
        referralCode: userObj.referralCode
      }
    });
  } catch (error) {
    logger.error(`[LoginOTP] Verify error: ${error.message}`);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Solicitar reset de contraseña por SMS (anti-enumeration: siempre responde igual)
app.post('/api/auth/request-password-reset', sensitiveLimiter, smsIpLimiter, async (req, res) => {
  const ANTI_ENUM_MESSAGE = 'Si este número está vinculado a una cuenta, recibirás un código SMS en los próximos segundos. Si no recibís ningún código, significa que este número no está asociado a ninguna cuenta.';

  try {
    const { phone } = req.body;

    if (phone && typeof phone === 'string') {
      const normalizedPhone = phone.trim();
      if (validateInternationalPhone(normalizedPhone)) {
        const user = await User.findOne({ phone: normalizedPhone, phoneVerified: true }).lean();
        if (user) {
          try {
            await generateAndSendOTP(normalizedPhone, 'reset');
          } catch (err) {
            logger.warn(`[request-password-reset] Error generando OTP: ${err.message}`);
          }
        }
      }
    }
  } catch (error) {
    logger.error(`Error en request-password-reset: ${error.message}`);
  }

  // SIEMPRE la misma respuesta (anti-enumeration)
  res.json({ success: true, message: ANTI_ENUM_MESSAGE });
});

// Verificar código OTP para reset de contraseña
app.post('/api/auth/verify-reset-otp', sensitiveLimiter, async (req, res) => {
  try {
    const { phone, code } = req.body;

    if (!phone || !code) {
      return res.status(400).json({ error: 'Teléfono y código requeridos' });
    }

    const normalizedPhone = phone.trim();
    if (!validateInternationalPhone(normalizedPhone)) {
      return res.status(400).json({ error: 'Número de teléfono inválido' });
    }

    const otpResult = await verifyOTP(normalizedPhone, String(code).trim(), 'reset');

    if (!otpResult.valid) {
      return res.status(400).json({ error: otpResult.error || 'Código incorrecto o expirado' });
    }

    // Buscar usuario con ese teléfono verificado
    const user = await User.findOne({ phone: normalizedPhone, phoneVerified: true }).lean();

    if (!user) {
      return res.status(400).json({ error: 'Código incorrecto o expirado' });
    }

    // Generar JWT temporal de 5 minutos solo para reset
    const resetToken = jwt.sign(
      { userId: user.id, username: user.username, purpose: 'reset' },
      JWT_SECRET,
      { expiresIn: '5m' }
    );

    res.json({
      success: true,
      verified: true,
      username: user.username,
      resetToken
    });
  } catch (error) {
    logger.error(`Error en verify-reset-otp: ${error.message}`);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Completar reset de contraseña usando el JWT temporal
app.post('/api/auth/complete-password-reset', sensitiveLimiter, async (req, res) => {
  try {
    const { resetToken, newPassword } = req.body;

    if (!resetToken || !newPassword) {
      return res.status(400).json({ error: 'Token y nueva contraseña requeridos' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }

    let decoded;
    try {
      decoded = jwt.verify(resetToken, JWT_SECRET);
    } catch (err) {
      return res.status(400).json({ error: 'Token de reset inválido o expirado' });
    }

    if (decoded.purpose !== 'reset') {
      return res.status(400).json({ error: 'Token de reset inválido' });
    }

    const user = await User.findOne({ id: decoded.userId });

    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    // Cambiar contraseña
    user.password = newPassword;
    user.passwordChangedAt = new Date();
    // Recovering the password via SMS counts as completing a password change,
    // so lift any pending `mustChangePassword` enforcement.
    user.mustChangePassword = false;
    await user.save();

    await syncPasswordToJugaygana(user, newPassword, 'complete-password-reset');

    res.json({ success: true, message: 'Contraseña cambiada exitosamente' });
  } catch (error) {
    logger.error(`Error en complete-password-reset: ${error.message}`);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================
// ADMIN - Envío masivo de SMS (solo ADMIN GENERAL)
// ============================================

// Códigos de país válidos para LATAM (mismo listado que security.js)
const BULK_SMS_VALID_COUNTRY_CODES = [
  '+54', '+591', '+55', '+56', '+57', '+506', '+53', '+593',
  '+503', '+502', '+504', '+52', '+505', '+507', '+595', '+51', '+1', '+598', '+58'
];

// Patrones de números claramente falsos (todos iguales, secuencias simples)
const FAKE_NUMBER_PATTERNS = /^(\d)\1+$|^1234567890$|^0987654321$|^12345678$|^01234567$/;

/**
 * Valida un número de teléfono para envío masivo y devuelve la razón si es inválido.
 * @param {string} phone
 * @returns {{ valid: boolean, reason?: string }}
 */
function validateBulkSmsPhone(phone) {
  if (!phone || typeof phone !== 'string') {
    return { valid: false, reason: 'Número ausente o inválido' };
  }
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 8) {
    return { valid: false, reason: 'Menos de 8 dígitos' };
  }
  if (digits.length > 15) {
    return { valid: false, reason: 'Más de 15 dígitos' };
  }
  if (FAKE_NUMBER_PATTERNS.test(digits)) {
    return { valid: false, reason: 'Patrón falso o de prueba' };
  }
  const hasValidPrefix = BULK_SMS_VALID_COUNTRY_CODES.some(code => phone.startsWith(code));
  if (!hasValidPrefix) {
    return { valid: false, reason: 'Prefijo de país no reconocido' };
  }
  return { valid: true };
}

/**
 * Construye el query de Mongoose para los filtros de bulk SMS.
 * Solo se permiten claves específicas con valores primitivos para evitar inyección NoSQL.
 *
 * Por defecto incluye TODOS los usuarios con teléfono cargado (verificados o no).
 * Si `onlyVerified === true`, restringe a usuarios con `phoneVerified: true` y `smsConsent: true`
 * (modo estricto, equivalente al comportamiento histórico).
 */
function buildBulkSmsQuery(filters, onlyVerified = false) {
  const query = {
    phone: { $exists: true, $nin: [null, ''] }
  };
  if (filters && typeof filters === 'object') {
    const allowedFilters = ['smsConsent', 'isActive'];
    for (const key of allowedFilters) {
      if (Object.prototype.hasOwnProperty.call(filters, key)) {
        const val = filters[key];
        if (typeof val === 'boolean' || typeof val === 'string' || typeof val === 'number') {
          query[key] = val;
        }
      }
    }
  }
  // Aplicar overrides de modo estricto al final para que no puedan ser debilitados
  // por filtros del cliente (p.ej. filters.smsConsent = false).
  if (onlyVerified === true) {
    query.phoneVerified = true;
    query.smsConsent = true;
  }
  return query;
}

// Preview: devuelve la lista de destinatarios con validación de números SIN enviar SMS
app.post('/api/admin/bulk-sms/preview', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Acceso denegado. Solo el administrador general puede usar esta función.' });
    }

    const { filters, onlyVerified } = req.body;
    const query = buildBulkSmsQuery(filters, onlyVerified === true);
    const users = await User.find(query).select('phone username').lean();

    const recipients = users.map(u => {
      const validation = validateBulkSmsPhone(u.phone);
      return {
        username: u.username,
        phone: u.phone,
        valid: validation.valid,
        reason: validation.reason || null
      };
    });

    const valid = recipients.filter(r => r.valid).length;
    const invalid = recipients.length - valid;

    res.json({ total: recipients.length, valid, invalid, recipients });
  } catch (error) {
    logger.error(`Error en bulk-sms/preview: ${error.message}`);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.post('/api/admin/bulk-sms', authMiddleware, bulkSmsIpLimiter, async (req, res) => {
  try {
    // Solo el administrador general puede enviar SMS masivos
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Acceso denegado. Solo el administrador general puede enviar SMS masivos.' });
    }

    const { message, filters, onlyVerified } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'El mensaje es requerido' });
    }

    const trimmedMessage = message.trim();

    if (trimmedMessage.length === 0) {
      return res.status(400).json({ error: 'El mensaje es requerido' });
    }

    if (trimmedMessage.length > 160) {
      return res.status(400).json({ error: 'El mensaje no puede superar los 160 caracteres' });
    }
    const query = buildBulkSmsQuery(filters, onlyVerified === true);
    const users = await User.find(query).select('_id phone username').lean();

    let sent = 0;
    let failed = 0;
    let discarded = 0;
    const results = [];

    logger.info(`[bulk-sms] Admin ${req.user.username} iniciando envío masivo a ${users.length} usuarios (onlyVerified=${onlyVerified === true})`);

    for (const user of users) {
      const validation = validateBulkSmsPhone(user.phone);
      if (!validation.valid) {
        discarded++;
        logger.info(`[bulk-sms] Skipped invalid phone: ${user._id} (${validation.reason})`);
        results.push({ username: user.username, phone: user.phone, status: 'discarded', reason: validation.reason });
        continue;
      }

      try {
        const result = await sendSMS(user.phone, trimmedMessage);
        if (result.success) {
          sent++;
          results.push({ username: user.username, phone: user.phone, status: 'sent' });
        } else {
          failed++;
          results.push({ username: user.username, phone: user.phone, status: 'failed', error: result.error || 'Error desconocido' });
          logger.warn(`[bulk-sms] Fallo al enviar a usuario ${user.username}: ${result.error}`);
        }
      } catch (err) {
        failed++;
        results.push({ username: user.username, phone: user.phone, status: 'failed', error: err.message });
        logger.warn(`[bulk-sms] Error al enviar a usuario ${user.username}: ${err.message}`);
      }

      // Esperar 50ms entre envíos para evitar saturar SNS
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    logger.info(`[bulk-sms] Envío masivo completado por ${req.user.username}: enviados=${sent}, fallidos=${failed}, descartados=${discarded}, total=${users.length}`);

    res.json({ sent, failed, discarded, total: users.length, results });
  } catch (error) {
    logger.error(`Error en bulk-sms: ${error.message}`);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================
// ADMIN - Verificar contraseña del panel SMS MASIVO
// ============================================

app.post('/api/admin/verify-sms-password', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Acceso denegado.' });
    }

    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ success: false, error: 'Contraseña requerida.' });
    }

    const SMS_MASIVO_PASSWORD = process.env.SMS_MASIVO_PASSWORD;
    if (!SMS_MASIVO_PASSWORD) {
      logger.error('⛔ SMS_MASIVO_PASSWORD no configurado en el entorno.');
      return res.status(500).json({ success: false, error: 'Configuración del servidor incompleta.' });
    }

    if (!safeCompare(password, SMS_MASIVO_PASSWORD)) {
      return res.status(401).json({ success: false });
    }

    res.json({ success: true });
  } catch (error) {
    logger.error(`Error en verify-sms-password: ${error.message}`);
    res.status(500).json({ success: false, error: 'Error del servidor.' });
  }
});

// ============================================
// ADMIN - Resetear contraseña de usuario
// ============================================

app.post('/api/admin/users/:id/reset-password', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { newPassword } = req.body;
    
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }
    
    const user = await User.findOne({ id });

    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    // Solo el admin principal puede resetear contrasenas de cuentas con rol admin/depositor/withdrawer.
    // Sin esta verificacion un depositor/withdrawer podria tomar control del admin principal.
    if (isAdminRole(user.role) && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Solo el administrador principal puede resetear contraseñas de otros administradores' });
    }
    // Withdrawers no pueden resetear contrasenas de nadie (mismo criterio que /api/admin/change-password).
    if (req.user.role === 'withdrawer') {
      return res.status(403).json({ error: 'No tienes permiso para resetear contraseñas' });
    }

    user.password = newPassword;
    user.passwordChangedAt = new Date();
    // After an admin resets a regular user's password, force them to change it on
    // next login. Admin accounts do not go through the mustChangePassword flow.
    if (!isAdminRole(user.role)) {
      user.mustChangePassword = true;
    }
    await user.save();

    logger.info(`Admin ${req.user.username} reset password for ${user.username}`);

    await syncPasswordToJugaygana(user, newPassword, `admin-reset-password by ${req.user.username}`);

    res.json({
      success: true,
      message: `Contraseña de ${user.username} reseteada exitosamente`
    });
  } catch (error) {
    console.error('Error reseteando contraseña:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================
// RUTAS DE CONFIGURACIÓN PÚBLICA
// ============================================

// Ruta GET para obtener CBU activo (para mensaje de bienvenida y panel usuario)
app.get('/api/config/cbu', authMiddleware, async (req, res) => {
  try {
    const cbuConfig = await getConfig('cbu');
    if (!cbuConfig) {
      return res.status(404).json({ error: 'CBU no configurado' });
    }
    
    res.json({
      number: cbuConfig.number,
      alias: cbuConfig.alias,
      bank: cbuConfig.bank,
      titular: cbuConfig.titular
    });
  } catch (error) {
    console.error('Error obteniendo CBU:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Ruta GET para obtener URL del Canal Informativo (panel usuario)
app.get('/api/config/canal-url', authMiddleware, async (req, res) => {
  try {
    const url = await getConfig('canalInformativoUrl', '');
    res.json({ url: url || '' });
  } catch (error) {
    console.error('Error obteniendo canal URL:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.post('/api/cbu/request', authMiddleware, async (req, res) => {
  try {
    // Rate limiting por usuario: máximo 1 solicitud de CBU cada 10 segundos
    if (!checkCbuRateLimit(req.user.userId)) {
      return res.status(429).json({
        success: false,
        error: 'Solicitaste CBU muy recientemente. Espera unos segundos antes de volver a intentar.'
      });
    }

    const cbuConfig = await getConfig('cbu');
    if (!cbuConfig) {
      return res.status(404).json({ error: 'CBU no configurado' });
    }
    
    // 1. Mensaje de solicitud del usuario
    await Message.create({
      id: uuidv4(),
      senderId: req.user.userId,
      senderUsername: req.user.username,
      senderRole: 'user',
      receiverId: 'admin',
      receiverRole: 'admin',
      content: '💳 Solicito los datos para transferir (CBU)',
      type: 'text',
      timestamp: new Date(),
      read: false
    });
    
    // 2. Mensaje completo con CBU
    const fullMessage = `💳 *Datos para transferir:*\n\n🏦 Banco: ${cbuConfig.bank}\n👤 Titular: ${cbuConfig.titular}\n🔢 CBU: ${cbuConfig.number}\n📱 Alias: ${cbuConfig.alias}\n\n✅ Una vez realizada la transferencia, envianos el comprobante por aquí.`;
    
    await Message.create({
      id: uuidv4(),
      senderId: 'system',
      senderUsername: 'Sistema',
      senderRole: 'admin',
      receiverId: req.user.userId,
      receiverRole: 'user',
      content: fullMessage,
      type: 'text',
      timestamp: new Date(),
      read: false
    });
    
    // 3. CBU solo
    await Message.create({
      id: uuidv4(),
      senderId: 'system',
      senderUsername: 'Sistema',
      senderRole: 'admin',
      receiverId: req.user.userId,
      receiverRole: 'user',
      content: cbuConfig.number,
      type: 'text',
      timestamp: new Date(),
      read: false
    });
    
    res.json({ 
      success: true, 
      message: 'Solicitud enviada',
      cbu: {
        number: cbuConfig.number,
        alias: cbuConfig.alias,
        bank: cbuConfig.bank,
        titular: cbuConfig.titular
      }
    });
  } catch (error) {
    console.error('Error enviando solicitud CBU:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================
// RUTAS DE USUARIOS (ADMIN)
// ============================================

app.get('/api/users', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const users = await User.find().select('-password').lean();
    res.json(users);
  } catch (error) {
    console.error('Error obteniendo usuarios:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.post('/api/users', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { username, password, email, phone, role = 'user', balance = 0 } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Usuario y contraseña son requeridos' });
    }
    
    if (password.length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }
    
    if (!phone || phone.trim().length < 8) {
      return res.status(400).json({ error: 'El número de teléfono es obligatorio (mínimo 8 dígitos)' });
    }
    
    const validRoles = ['user', 'admin', 'depositor', 'withdrawer'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: 'Rol inválido' });
    }
    
    // Buscar case-insensitive
    const existingUser = await User.findOne({ 
      username: { $regex: new RegExp('^' + escapeRegex(username) + '$', 'i') } 
    });
    if (existingUser) {
      return res.status(400).json({ error: 'El usuario ya existe' });
    }
    
    const userId = uuidv4();
    
    const newUser = await User.create({
      id: userId,
      username,
      password: password,
      email,
      phone,
      role,
      accountNumber: generateAccountNumber(),
      balance,
      createdAt: new Date(),
      lastLogin: null,
      isActive: true,
      jugayganaUserId: null,
      jugayganaUsername: null,
      jugayganaSyncStatus: role === 'user' ? 'pending' : 'not_applicable'
    });
    
    // Crear chat status
    await ChatStatus.create({
      userId: userId,
      username: username,
      status: 'open',
      category: 'cargas'
    });
    
    // Sincronizar con JUGAYGANA solo si es usuario normal
    if (role === 'user') {
      jugaygana.syncUserToPlatform({
        username: newUser.username,
        password: password
      }).then(async (result) => {
        if (result.success) {
          await User.updateOne(
            { id: userId },
            {
              jugayganaUserId: result.jugayganaUserId || result.user?.user_id,
              jugayganaUsername: result.jugayganaUsername || result.user?.user_name,
              jugayganaSyncStatus: result.alreadyExists ? 'linked' : 'synced'
            }
          );
        }
      });
    }
    
    res.status(201).json({
      message: 'Usuario creado exitosamente',
      user: {
        id: newUser.id,
        username: newUser.username,
        email: newUser.email,
        accountNumber: newUser.accountNumber,
        role: newUser.role,
        balance: newUser.balance
      }
    });
  } catch (error) {
    console.error('Error creando usuario:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.put('/api/users/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    // Whitelist of fields any admin role can update
    const ALLOWED_FIELDS = ['email', 'phone', 'whatsapp', 'isActive', 'balance'];

    const updates = {};

    for (const field of ALLOWED_FIELDS) {
      if (req.body[field] !== undefined) {
        // Coerce to safe primitives to prevent NoSQL operator injection
        if (field === 'isActive') {
          updates[field] = Boolean(req.body[field]);
        } else if (field === 'balance') {
          const n = parseFloat(req.body[field]);
          if (isNaN(n)) return res.status(400).json({ error: 'balance debe ser un número' });
          updates[field] = n;
        } else {
          updates[field] = String(req.body[field]);
        }
      }
    }

    // Only strict admin can change the role
    if (req.body.role !== undefined) {
      if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Solo el administrador principal puede cambiar roles' });
      }
      const validRoles = ['user', 'admin', 'depositor', 'withdrawer'];
      if (!validRoles.includes(req.body.role)) {
        return res.status(400).json({ error: 'Rol inválido' });
      }
      updates.role = req.body.role;
    }

    // Handle password separately (hash it)
    if (req.body.password) {
      updates.password = await bcrypt.hash(String(req.body.password), 10);
      updates.passwordChangedAt = new Date();
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No se proporcionaron campos válidos para actualizar' });
    }
    
    const user = await User.findOneAndUpdate(
      { id },
      { $set: updates },
      { new: true }
    ).select('-password');
    
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    
    res.json({
      message: 'Usuario actualizado',
      user
    });
  } catch (error) {
    console.error('Error actualizando usuario:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.post('/api/users/:id/sync-jugaygana', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findOne({ id });
    
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    
    const result = await jugaygana.syncUserToPlatform({
      username: user.username,
      password: 'asd123'
    });
    
    if (result.success) {
      user.jugayganaUserId = result.jugayganaUserId || result.user?.user_id;
      user.jugayganaUsername = result.jugayganaUsername || result.user?.user_name;
      user.jugayganaSyncStatus = result.alreadyExists ? 'linked' : 'synced';
      await user.save();
      
      res.json({
        message: result.alreadyExists ? 'Usuario vinculado con JUGAYGANA' : 'Usuario sincronizado con JUGAYGANA',
        jugayganaUserId: user.jugayganaUserId,
        jugayganaUsername: user.jugayganaUsername
      });
    } else {
      res.status(400).json({ error: result.error || 'Error sincronizando con JUGAYGANA' });
    }
  } catch (error) {
    console.error('Error sincronizando:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Sincronización masiva
app.post('/api/admin/sync-all-jugaygana', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    // Nota: Esta función necesitaría ser actualizada para usar MongoDB
    // Por ahora, devolvemos un mensaje informativo
    res.json({
      message: 'Sincronización masiva - Función en desarrollo para MongoDB',
      note: 'Esta función se está migrando a MongoDB'
    });
  } catch (error) {
    console.error('Error iniciando sincronización:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.get('/api/admin/sync-status', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const jugayganaUsers = await User.countDocuments({ jugayganaUserId: { $ne: null } });
    const pendingUsers = await User.countDocuments({ jugayganaUserId: null, role: 'user' });
    
    res.json({
      inProgress: false,
      startedAt: null,
      lastSync: null,
      totalSynced: jugayganaUsers,
      lastResult: null,
      localUsers: totalUsers,
      jugayganaUsers,
      pendingUsers
    });
  } catch (error) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.delete('/api/users/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    // Withdrawer no puede eliminar usuarios. Mismo criterio que /api/admin/users/:id/block:
    // borrar es mas destructivo que bloquear, asi que la autorizacion no puede ser mas laxa.
    if (req.user.role === 'withdrawer') {
      return res.status(403).json({ error: 'No tienes permiso para eliminar usuarios' });
    }

    const userToDelete = await User.findOne({ id });
    if (!userToDelete) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const adminRoles = ['admin', 'depositor', 'withdrawer'];
    if (adminRoles.includes(userToDelete.role) && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Solo los administradores pueden eliminar otros administradores' });
    }

    await User.deleteOne({ id });
    await ChatStatus.deleteOne({ userId: id });
    
    res.json({ message: 'Usuario eliminado exitosamente' });
  } catch (error) {
    console.error('Error eliminando usuario:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================
// SISTEMA DE CHATS ABIERTOS/CERRADOS
// ============================================

app.get('/api/admin/chat-status/all', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const chatStatuses = await ChatStatus.find().lean();
    const result = {};
    chatStatuses.forEach(cs => {
      result[cs.userId] = cs;
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.get('/api/admin/chats/:status', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { status } = req.params;
    
    const chatStatuses = await ChatStatus.find({ 
      status,
      category: { $ne: 'pagos' }
    }).lean();
    
    const userIds = chatStatuses.map(cs => cs.userId);
    
    const messages = await Message.find({
      $or: [
        { senderId: { $in: userIds } },
        { receiverId: { $in: userIds } }
      ]
    }).sort({ timestamp: 1 }).lean();
    
    const users = await User.find({ id: { $in: userIds } }).lean();
    
    const userMessages = {};
    messages.forEach(msg => {
      if (msg.senderRole === 'user') {
        if (!userMessages[msg.senderId]) userMessages[msg.senderId] = [];
        userMessages[msg.senderId].push(msg);
      }
      if (msg.receiverRole === 'user' && msg.senderRole !== 'user') {
        if (!userMessages[msg.receiverId]) userMessages[msg.receiverId] = [];
        userMessages[msg.receiverId].push(msg);
      }
    });
    
    const filteredChats = [];
    
    for (const chatStatus of chatStatuses) {
      const user = users.find(u => u.id === chatStatus.userId);
      if (!user) continue;
      
      const msgs = userMessages[chatStatus.userId] || [];
      if (msgs.length === 0) continue;
      
      const lastMsg = msgs[msgs.length - 1];
      const unreadCount = msgs.filter(m => m.receiverRole === 'admin' && !m.read).length;
      
      filteredChats.push({
        userId: chatStatus.userId,
        username: user.username,
        lastMessage: lastMsg,
        unreadCount,
        assignedTo: chatStatus.assignedTo,
        closedAt: chatStatus.closedAt,
        closedBy: chatStatus.closedBy
      });
    }
    
    filteredChats.sort((a, b) => new Date(b.lastMessage.timestamp) - new Date(a.lastMessage.timestamp));
    
    res.json(filteredChats);
  } catch (error) {
    console.error('Error obteniendo chats:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.get('/api/admin/all-chats', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const messages = await Message.find().lean();
    const users = await User.find().lean();
    const chatStatuses = await ChatStatus.find().lean();
    
    const userMessages = {};
    messages.forEach(msg => {
      if (msg.senderRole === 'user') {
        if (!userMessages[msg.senderId]) userMessages[msg.senderId] = [];
        userMessages[msg.senderId].push(msg);
      }
      if (msg.receiverRole === 'user') {
        if (!userMessages[msg.receiverId]) userMessages[msg.receiverId] = [];
        userMessages[msg.receiverId].push(msg);
      }
    });
    
    const allChats = Object.keys(userMessages).map(userId => {
      const user = users.find(u => u.id === userId);
      const statusInfo = chatStatuses.find(cs => cs.userId === userId) || { status: 'open', assignedTo: null };
      const msgs = userMessages[userId].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      
      return {
        userId,
        username: user?.username || 'Desconocido',
        status: statusInfo.status,
        messageCount: msgs.length,
        lastMessage: msgs[msgs.length - 1]
      };
    });
    
    res.json(allChats);
  } catch (error) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.post('/api/admin/chats/:userId/close', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { userId } = req.params;
    
    await ChatStatus.findOneAndUpdate(
      { userId },
      {
        status: 'closed',
        closedAt: new Date(),
        closedBy: req.user.username,
        assignedTo: null,
        category: 'cargas'
      },
      { upsert: true }
    );
    
    res.json({ success: true, message: 'Chat cerrado' });
  } catch (error) {
    res.status(500).json({ error: 'Error cerrando chat' });
  }
});

app.post('/api/admin/chats/:userId/reopen', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { userId } = req.params;
    
    await ChatStatus.findOneAndUpdate(
      { userId },
      {
        status: 'open',
        closedAt: null,
        closedBy: null,
        assignedTo: req.user.username
      },
      { upsert: true }
    );
    
    res.json({ success: true, message: 'Chat reabierto' });
  } catch (error) {
    res.status(500).json({ error: 'Error reabriendo chat' });
  }
});

app.post('/api/admin/chats/:userId/assign', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { userId } = req.params;
    const { agent } = req.body;
    
    await ChatStatus.findOneAndUpdate(
      { userId },
      { assignedTo: agent, status: 'open' },
      { upsert: true }
    );
    
    res.json({ success: true, message: 'Chat asignado a ' + agent });
  } catch (error) {
    res.status(500).json({ error: 'Error asignando chat' });
  }
});

app.post('/api/admin/chats/:userId/category', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { userId } = req.params;
    const { category } = req.body;
    
    if (!category || !['cargas', 'pagos'].includes(category)) {
      return res.status(400).json({ error: 'Categoría inválida. Use "cargas" o "pagos"' });
    }
    
    await ChatStatus.findOneAndUpdate(
      { userId },
      { category },
      { upsert: true }
    );
    
    res.json({ success: true, message: `Chat movido a ${category.toUpperCase()}` });
  } catch (error) {
    console.error('Error cambiando categoría:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.get('/api/admin/chats/category/:category', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { category } = req.params;
    
    const chatStatuses = await ChatStatus.find({ category }).lean();
    const userIds = chatStatuses.map(cs => cs.userId);
    
    const messages = await Message.find({
      $or: [
        { senderId: { $in: userIds } },
        { receiverId: { $in: userIds } }
      ]
    }).sort({ timestamp: 1 }).lean();
    
    const users = await User.find({ id: { $in: userIds } }).lean();
    
    const userMessages = {};
    messages.forEach(msg => {
      if (msg.senderRole === 'user') {
        if (!userMessages[msg.senderId]) userMessages[msg.senderId] = [];
        userMessages[msg.senderId].push(msg);
      }
      if (msg.receiverRole === 'user' && msg.senderRole !== 'user') {
        if (!userMessages[msg.receiverId]) userMessages[msg.receiverId] = [];
        userMessages[msg.receiverId].push(msg);
      }
    });
    
    const filteredChats = [];
    
    for (const chatStatus of chatStatuses) {
      const user = users.find(u => u.id === chatStatus.userId);
      if (!user) continue;
      
      const msgs = userMessages[chatStatus.userId] || [];
      if (msgs.length === 0) continue;
      
      const lastMsg = msgs[msgs.length - 1];
      const unreadCount = msgs.filter(m => m.receiverRole === 'admin' && !m.read).length;
      
      filteredChats.push({
        userId: chatStatus.userId,
        username: user.username,
        lastMessage: lastMsg,
        unreadCount,
        assignedTo: chatStatus.assignedTo,
        status: chatStatus.status
      });
    }
    
    filteredChats.sort((a, b) => new Date(b.lastMessage.timestamp) - new Date(a.lastMessage.timestamp));
    res.json(filteredChats);
  } catch (error) {
    console.error('Error obteniendo chats por categoría:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================
// RUTAS DE MENSAJES
// ============================================

// OPTIMIZADO: Sin logs, con proyección mínima
app.get('/api/messages/:userId', authMiddleware, async (req, res) => {
  try {
    const { userId } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const before = req.query.before ? new Date(req.query.before) : null;

    const allowedRoles = ['admin', 'depositor', 'withdrawer'];
    const isAdminRole = allowedRoles.includes(req.user.role);
    if (!isAdminRole && req.user.userId !== userId) {
      return res.status(403).json({ error: 'Acceso denegado' });
    }

    const matchStage = {
      $or: [
        { senderId: userId },
        { receiverId: userId }
      ]
    };
    if (!isAdminRole) {
      matchStage.adminOnly = { $ne: true };
    }
    if (before) {
      matchStage.timestamp = { $lt: before };
    }

    const messages = await Message.aggregate([
      { $match: matchStage },
      { $sort: { timestamp: -1 } },
      { $limit: limit },
      { $sort: { timestamp: 1 } },
      {
        $project: {
          _id: 0, id: 1, senderId: 1, senderUsername: 1, senderRole: 1,
          receiverId: 1, receiverRole: 1, content: 1, type: 1, read: 1,
          adminOnly: 1, timestamp: 1
        }
      }
    ]);

    const hasMore = messages.length === limit;
    const oldestTimestamp = messages.length > 0 ? messages[0].timestamp : null;

    res.json({ messages, hasMore, oldestTimestamp });
  } catch (error) {
    logger.error(`Error obteniendo mensajes: ${error.message}`);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.get('/api/conversations', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const messages = await Message.find().sort({ timestamp: -1 }).lean();
    const users = await User.find().lean();
    
    const conversations = {};
    
    messages.forEach(msg => {
      let userId = null;
      
      if (msg.senderRole === 'user') {
        userId = msg.senderId;
      } else if (msg.receiverRole === 'user') {
        userId = msg.receiverId;
      }
      
      if (!userId) return;
      
      if (!conversations[userId]) {
        const user = users.find(u => u.id === userId);
        conversations[userId] = {
          userId,
          username: user?.username || 'Desconocido',
          accountNumber: user?.accountNumber || '',
          lastMessage: msg,
          unreadCount: (msg.receiverRole === 'admin' && !msg.read) ? 1 : 0
        };
      } else {
        if (msg.receiverRole === 'admin' && !msg.read) {
          conversations[userId].unreadCount++;
        }
      }
    });
    
    res.json(Object.values(conversations));
  } catch (error) {
    console.error('Error obteniendo conversaciones:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.post('/api/messages/read/:userId', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { userId } = req.params;
    
    await Message.updateMany(
      { senderId: userId, receiverRole: 'admin' },
      { read: true }
    );
    
    // Notificar a todos los admins que los mensajes de este usuario fueron leídos
    notifyAdmins('messages_read', { userId, by: req.user.userId });
    
    res.json({ message: 'Mensajes marcados como leídos' });
  } catch (error) {
    console.error('Error marcando mensajes como leídos:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.post('/api/messages/send', authMiddleware, async (req, res) => {
  try {
    const { content, type = 'text', receiverId } = req.body;
    
    logger.debug(`[API_MESSAGES_SEND] user=${req.user.username} role=${req.user.role} receiverId=${receiverId} type=${type}`);
    
    if (!content) {
      logger.debug('[API_MESSAGES_SEND] ERROR: content required');
      return res.status(400).json({ error: 'Contenido requerido' });
    }

    // SECURITY: Validate message type to prevent type confusion
    const allowedTypes = ['text', 'image', 'video'];
    if (!allowedTypes.includes(type)) {
      return res.status(400).json({ error: 'Tipo de mensaje no válido' });
    }

    // SECURITY: For image/video, validate that content is a well-formed https:// URL or an allowed data: URL
    if (type === 'image' || type === 'video') {
      const MAX_BASE64_SIZE = 5 * 1024 * 1024; // 5MB
      const ALLOWED_DATA_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/webm'];
      if (content.startsWith('data:')) {
        const mimeMatch = content.match(/^data:([\w\/+.-]+);base64,/);
        if (!mimeMatch || !ALLOWED_DATA_MIMES.includes(mimeMatch[1])) {
          return res.status(400).json({ error: 'Tipo de imagen o video no permitido' });
        }
        if (content.length > MAX_BASE64_SIZE) {
          return res.status(400).json({ error: 'La imagen o video es demasiado grande (máximo 5MB)' });
        }
      } else {
        let parsedUrl;
        try { parsedUrl = new URL(content); } catch (_) { parsedUrl = null; }
        if (!parsedUrl || parsedUrl.protocol !== 'https:') {
          return res.status(400).json({ error: 'Las imágenes y videos deben ser URLs seguras (https)' });
        }
      }
    }
    
    const adminRoles = ['admin', 'depositor', 'withdrawer'];
    const isAdminRole = adminRoles.includes(req.user.role);
    
    // Issue #3: Bloquear comandos enviados por usuarios comunes (solo admins pueden procesar comandos)
    if (!isAdminRole && content.trim().startsWith('/')) {
      return res.status(403).json({ error: 'Los usuarios no pueden enviar comandos' });
    }
    
    logger.debug(`[API_MESSAGES_SEND] isAdminRole: ${isAdminRole}`);
    
    const messageData = {
      id: uuidv4(),
      senderId: req.user.userId,
      senderUsername: req.user.username,
      senderRole: req.user.role,
      receiverId: isAdminRole ? (receiverId || 'admin') : 'admin',
      receiverRole: isAdminRole ? 'user' : 'admin',
      content,
      type,
      timestamp: new Date(),
      read: false
    };
    
    logger.debug(`[API_MESSAGES_SEND] Creating message for receiver: ${messageData.receiverId}`);
    
    
    let message;
    try {
      message = await Message.create(messageData);
      logger.debug(`[API_MESSAGES_SEND] Message created: ${message.id}`);
      
      
    } catch (createError) {
      logger.error(`[API_MESSAGES_SEND] Error creating message: ${createError.message}`);
      if (createError.errors) {
        logger.error(`[API_MESSAGES_SEND] Validation errors: ${JSON.stringify(createError.errors)}`);
      }
      throw createError;
    }
    
    // Guardar usuario en base de datos externa
    if (req.user.role === 'user') {
      let user = await User.findOne({ id: req.user.userId });
      
      if (!user) {
        try {
          user = await User.findById(req.user.userId);
        } catch (e) {
          // _id inválido, ignorar
        }
      }
      
      if (user) {
        await addExternalUser({
          username: user.username,
          phone: user.phone,
          whatsapp: user.whatsapp
        });
      }
    }
    
    // Asegurar que el ChatStatus existe y está actualizado
    const targetUserId = req.user.role === 'admin' ? req.body.receiverId : req.user.userId;
    if (targetUserId) {
      const user = await User.findOne({ id: targetUserId });
      await ChatStatus.findOneAndUpdate(
        { userId: targetUserId },
        { 
          userId: targetUserId,
          username: user ? user.username : req.user.username,
          lastMessageAt: new Date()
        },
        { upsert: true }
      );
    }
    
    // Si es usuario enviando mensaje, reabrir chat solo si estaba cerrado (no si está en pagos)
    if (req.user.role === 'user') {
      await ChatStatus.findOneAndUpdate(
        { userId: req.user.userId, status: 'closed' },
        { status: 'open', assignedTo: null, closedAt: null, closedBy: null }
      );
    }
    
    // CORREGIDO: Procesar comandos si el mensaje empieza con /
    if (content.trim().startsWith('/')) {
      const commandName = content.trim().split(' ')[0];
      logger.debug(`[API_COMMAND] Command detected: ${commandName}`);
      
      try {
        const command = await Command.findOne({ name: commandName, isActive: true });
        const commandReceiverId = isAdminRole ? (receiverId || req.body.receiverId) : req.user.userId;
        
        if (command) {
          logger.debug(`[API_COMMAND] Command found: ${command.name}`);
          
          // Incrementar contador de uso
          await Command.updateOne(
            { name: commandName },
            { $inc: { usageCount: 1 }, updatedAt: new Date() }
          );
          
          // Crear mensaje de respuesta del sistema
          const responseMessage = await Message.create({
            id: uuidv4(),
            senderId: 'system',
            senderUsername: 'Sistema',
            senderRole: 'system',
            receiverId: commandReceiverId,
            receiverRole: 'user',
            content: command.response,
            type: 'system',
            timestamp: new Date(),
            read: false
          });
          
          // Emitir respuesta al usuario receptor
          io.to(`user_${commandReceiverId}`).emit('new_message', responseMessage);
          
          // Notificar a admins
          notifyAdmins('new_message', {
            message: responseMessage,
            userId: commandReceiverId,
            username: req.user.username
          });
          
          // Notificar sobre el uso del comando
          notifyAdmins('command_used', {
            userId: req.user.userId,
            username: req.user.username,
            command: commandName
          });
          
          logger.debug(`[API_COMMAND] Response sent for command: ${commandName}`);
          
          // NO emitir el mensaje original del comando, solo la respuesta
          return res.json(responseMessage);
        } else {
          logger.debug(`[API_COMMAND] Command not found: ${commandName}`);
          
          const notFoundMessage = await Message.create({
            id: uuidv4(),
            senderId: 'system',
            senderUsername: 'Sistema',
            senderRole: 'system',
            receiverId: commandReceiverId,
            receiverRole: 'user',
            content: `❓ Comando "${commandName}" no encontrado. Escribe /ayuda para ver los comandos disponibles.`,
            type: 'system',
            timestamp: new Date(),
            read: false
          });
          
          io.to(`user_${commandReceiverId}`).emit('new_message', notFoundMessage);
          return res.json(notFoundMessage);
        }
      } catch (cmdError) {
        logger.error(`[API_COMMAND] Error processing command: ${cmdError.message}`);
      }
    }
    
    // Emitir evento de socket para notificar en tiempo real
    if (req.user.role === 'user') {
      // Notificar a todos los admins sobre el nuevo mensaje
      notifyAdmins('new_message', {
        message,
        userId: req.user.userId,
        username: req.user.username
      });
      // CORREGIDO: También emitir al usuario (para que vea su propio mensaje en tiempo real)
      io.to(`user_${req.user.userId}`).emit('new_message', message);
      io.to(`user_${req.user.userId}`).emit('message_sent', message);
    } else {
      // Admin enviando mensaje - notificar al usuario
      const userSocket = connectedUsers.get(req.body.receiverId);
      const deliveredViaSocket = !!userSocket;
      if (userSocket) {
        userSocket.emit('new_message', message);
      }
      // También emitir a la sala del usuario
      io.to(`user_${req.body.receiverId}`).emit('new_message', message);
      // CORREGIDO: Emitir a la sala del chat (para admins que están viendo)
      io.to(`chat_${req.body.receiverId}`).emit('new_message', message);
      // Notificar a otros admins
      notifyAdmins('new_message', {
        message,
        userId: req.body.receiverId,
        username: req.user.username
      });

      // Push FCM para usuario offline: misma lógica que la rama socket de chat
      // (server.js socket.on('send_message')). Sin esto, los clientes que caen
      // a fallback REST nunca disparan push y los users offline pierden el msg.
      if (!deliveredViaSocket && req.body.receiverId) {
        User.findOne({ id: req.body.receiverId })
          .then(function(targetUser) {
            const hasTokens = targetUser && (targetUser.fcmToken || (targetUser.fcmTokens && targetUser.fcmTokens.length > 0));
            if (!hasTokens) return;
            const pushTitle = 'Nuevo mensaje';
            const pushBody = type === 'image' ? '📸 Imagen'
                          : type === 'video' ? '🎥 Video'
                          : (content || '').substring(0, 100);
            sendPushIfOffline(targetUser, pushTitle, pushBody, { tag: 'chat-message' }).catch(function(e) {
              logger.warn(`[FCM] sendPushIfOffline (REST chat) falló para ${targetUser.username}: ${e.message}`);
            });
          })
          .catch(function(dbErr) {
            logger.warn(`[FCM] Error buscando usuario para push (REST chat): ${dbErr.message}`);
          });
      }
    }
    
    res.json(message);
  } catch (error) {
    logger.error(`Error sending message: ${error.message}`);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: 'Error de validación: ' + Object.values(error.errors).map(e => e.message).join(', ') });
    }
    res.status(500).json({ error: 'Error del servidor: ' + error.message });
  }
});

// ============================================
// REEMBOLSOS (DIARIO, SEMANAL, MENSUAL)
// ============================================

/**
 * Obtener total de créditos no-depósito (bonus, reembolsos previos, comisiones, fire rewards)
 * para un usuario en un período. Se restan del NETWIN antes de calcular reembolsos.
 */
async function getRefundNonDepositCredits(username, fromDate, toDate) {
  const result = await Transaction.aggregate([
    { $match: {
      username: username,
      type: { $in: ['bonus', 'refund', 'referral_commission', 'fire_reward'] },
      createdAt: { $gte: fromDate, $lte: toDate }
    }},
    { $group: { _id: null, total: { $sum: '$amount' } }}
  ]);
  return result[0]?.total || 0;
}

// Trae los totales REALES de depósitos y retiros del usuario para uno de
// los tres períodos de reembolso (daily/weekly/monthly), consultando
// JUGAYGANA via ShowUserTransfersByAgent (la misma acción que usa el panel
// admin). Antes esto llamaba a ShowUserMovements con startdate/enddate en
// formato YYYY-MM-DD, pero esa acción ignora los filtros y/o devuelve un
// shape distinto, lo que hacía que TODOS los usuarios vieran $0 y nunca
// les apareciera el botón de reclamar. Los helpers getUserNet* de
// jugaygana.js usan fromtime/totime en epoch seconds y leen los totales
// preprocesados (en centavos) que devuelve la API.
// Devuelve {deposits, withdrawals, source, period} para uno de los 3 períodos.
// 1) Primero intenta jugaygana.getUserNet* (ShowUserTransfersByAgent — totales
//    pre-agregados en cents que devuelve la API admin).
// 2) Si esa acción devuelve 0/0, hace fallback a jugayganaMovements.getUserMovements
//    (ShowUserMovements — lista cruda de movimientos que parseamos a mano).
//    Esto cubre el caso en que el usuario no aparece bajo SESSION_PARENT_ID
//    como hijo directo, o la otra acción ignora el filtro y devuelve totales
//    vacíos. Con dos caminos minimizamos los falsos $0.
async function getRealMovementsTotals(username, period) {
  const periodToRange = {
    daily: () => {
      const r = jugaygana.getYesterdayRangeArgentinaEpoch();
      return { fromStr: r.dateStr, toStr: r.dateStr };
    },
    weekly: () => {
      const r = jugaygana.getLastWeekRangeArgentinaEpoch();
      return { fromStr: r.fromDateStr, toStr: r.toDateStr };
    },
    monthly: () => {
      const r = jugaygana.getLastMonthRangeArgentinaEpoch();
      return { fromStr: r.fromDateStr, toStr: r.toDateStr };
    }
  };
  if (!periodToRange[period]) {
    logger.warn(`[REFUND] getRealMovementsTotals período inválido: ${period}`);
    return { deposits: 0, withdrawals: 0, source: 'invalid', period };
  }
  const { fromStr, toStr } = periodToRange[period]();

  // 1) Intento principal: ShowUserTransfersByAgent
  try {
    let primary;
    if (period === 'daily') primary = await jugaygana.getUserNetYesterday(username);
    else if (period === 'weekly') primary = await jugaygana.getUserNetLastWeek(username);
    else if (period === 'monthly') primary = await jugaygana.getUserNetLastMonth(username);

    if (primary && primary.success) {
      const dep = Number(primary.totalDeposits) || 0;
      const wit = Number(primary.totalWithdraws) || 0;
      if (dep > 0 || wit > 0) {
        logger.info(`[REFUND] OK source=AgentTransfers user=${username} period=${period} dep=${dep} wit=${wit} range=${fromStr}..${toStr}`);
        return { deposits: dep, withdrawals: wit, source: 'AgentTransfers', period: `${fromStr}..${toStr}` };
      }
      logger.warn(`[REFUND] AgentTransfers vacío user=${username} period=${period} → probando ShowUserMovements`);
    } else {
      logger.warn(`[REFUND] AgentTransfers ERROR user=${username} period=${period} err=${primary && primary.error} → probando ShowUserMovements`);
    }
  } catch (err) {
    logger.error(`[REFUND] AgentTransfers EXCEPTION user=${username} period=${period} err=${err.message}`);
  }

  // 2) Fallback: ShowUserMovements (lista cruda)
  try {
    const fb = await jugayganaMovements.getUserMovements(username, {
      startDate: fromStr,
      endDate: toStr,
      pageSize: 500
    });
    if (!fb || !fb.success) {
      logger.warn(`[REFUND] ShowUserMovements FAIL user=${username} period=${period} err=${fb && fb.error}`);
      return { deposits: 0, withdrawals: 0, source: 'none', period: `${fromStr}..${toStr}` };
    }
    let dep = 0, wit = 0;
    for (const m of (fb.movements || [])) {
      const type = (m.type || m.operation || m.OperationType || m.Type || m.Operation || '').toString().toLowerCase();
      let amount = 0;
      if (m.amount !== undefined) amount = parseFloat(m.amount);
      else if (m.Amount !== undefined) amount = parseFloat(m.Amount);
      else if (m.value !== undefined) amount = parseFloat(m.value);
      else if (m.Value !== undefined) amount = parseFloat(m.Value);
      else if (m.monto !== undefined) amount = parseFloat(m.monto);
      else if (m.Monto !== undefined) amount = parseFloat(m.Monto);
      const isDep = type.includes('deposit') || type.includes('credit') ||
                    type.includes('carga') || type.includes('recarga') || amount > 0;
      const isWit = type.includes('withdraw') || type.includes('debit') ||
                    type.includes('retiro') || type.includes('extraccion') || amount < 0;
      if (isDep) dep += Math.abs(amount);
      else if (isWit) wit += Math.abs(amount);
    }
    logger.info(`[REFUND] OK source=ShowUserMovements user=${username} period=${period} dep=${dep} wit=${wit} items=${(fb.movements || []).length} range=${fromStr}..${toStr}`);
    return { deposits: dep, withdrawals: wit, source: 'ShowUserMovements', period: `${fromStr}..${toStr}` };
  } catch (err) {
    logger.error(`[REFUND] ShowUserMovements EXCEPTION user=${username} period=${period} err=${err.message}`);
    return { deposits: 0, withdrawals: 0, source: 'error', period: `${fromStr}..${toStr}` };
  }
}

app.get('/api/refunds/status', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const username = req.user.username;

    const userInfo = await jugaygana.getUserInfoByName(username);
    const currentBalance = userInfo ? userInfo.balance : 0;

    // Rangos de fechas (zona horaria Argentina)
    const yesterdayRange = jugaygana.getYesterdayRangeArgentinaEpoch();
    const lastWeekRange = jugaygana.getLastWeekRangeArgentinaEpoch();
    const lastMonthRange = jugaygana.getLastMonthRangeArgentinaEpoch();

    const [dailyStatus, weeklyStatus, monthlyStatus] = await Promise.all([
      refunds.canClaimDailyRefund(userId),
      refunds.canClaimWeeklyRefund(userId),
      refunds.canClaimMonthlyRefund(userId)
    ]);

    // Movimientos REALES desde JUGAYGANA (deposits/withdrawals).
    // Antes consultábamos Transaction (Mongo local) pero ahí solo se
    // guardan los movimientos que pasan por nuestro panel admin; las
    // cargas/retiros directos del usuario en JUGAYGANA no quedaban
    // registrados → todos los reembolsos daban $0.
    const [dailyMov, weeklyMov, monthlyMov] = await Promise.all([
      getRealMovementsTotals(username, 'daily'),
      getRealMovementsTotals(username, 'weekly'),
      getRealMovementsTotals(username, 'monthly')
    ]);

    const dailyDeposits = dailyMov.deposits;
    const dailyWithdrawals = dailyMov.withdrawals;
    const weeklyDeposits = weeklyMov.deposits;
    const weeklyWithdrawals = weeklyMov.withdrawals;
    const monthlyDeposits = monthlyMov.deposits;
    const monthlyWithdrawals = monthlyMov.withdrawals;

    const dailyNetLoss = Math.max(0, dailyDeposits - dailyWithdrawals);
    const weeklyNetLoss = Math.max(0, weeklyDeposits - weeklyWithdrawals);
    const monthlyNetLoss = Math.max(0, monthlyDeposits - monthlyWithdrawals);

    logger.info(`[REFUND] status — usuario: ${username} daily depositos:${dailyDeposits} retiros:${dailyWithdrawals} netLoss:${dailyNetLoss}`);
    logger.info(`[REFUND] status — usuario: ${username} weekly depositos:${weeklyDeposits} retiros:${weeklyWithdrawals} netLoss:${weeklyNetLoss}`);
    logger.info(`[REFUND] status — usuario: ${username} monthly depositos:${monthlyDeposits} retiros:${monthlyWithdrawals} netLoss:${monthlyNetLoss}`);

    const dailyPotential = Math.round(dailyNetLoss * 0.08);
    const weeklyPotential = Math.round(weeklyNetLoss * 0.05);
    const monthlyPotential = Math.round(monthlyNetLoss * 0.03);

    res.json({
      user: {
        username,
        currentBalance,
        jugayganaLinked: !!userInfo
      },
      daily: {
        ...dailyStatus,
        potentialAmount: dailyPotential,
        netAmount: dailyNetLoss,
        deposits: dailyDeposits,
        withdrawals: dailyWithdrawals,
        source: dailyMov.source,
        percentage: 8,
        period: yesterdayRange.dateStr
      },
      weekly: {
        ...weeklyStatus,
        potentialAmount: weeklyPotential,
        netAmount: weeklyNetLoss,
        deposits: weeklyDeposits,
        withdrawals: weeklyWithdrawals,
        source: weeklyMov.source,
        percentage: 5,
        period: `${lastWeekRange.fromDateStr} a ${lastWeekRange.toDateStr}`
      },
      monthly: {
        ...monthlyStatus,
        potentialAmount: monthlyPotential,
        netAmount: monthlyNetLoss,
        deposits: monthlyDeposits,
        withdrawals: monthlyWithdrawals,
        source: monthlyMov.source,
        percentage: 3,
        period: `${lastMonthRange.fromDateStr} a ${lastMonthRange.toDateStr}`
      }
    });
  } catch (error) {
    console.error('Error obteniendo estado de reembolsos:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.post('/api/refunds/claim/daily', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const username = req.user.username;
    
    if (!await acquireRefundLock(userId, 'daily')) {
      return res.json({
        success: false,
        message: '⏳ Ya estás procesando un reembolso. Por favor espera...',
        canClaim: true,
        processing: true
      });
    }
    
    try {
      const status = await refunds.canClaimDailyRefund(userId);
      
      if (!status.canClaim) {
        return res.json({
          success: false,
          message: 'Ya reclamaste tu reembolso diario. Vuelve mañana!',
          canClaim: false,
          nextClaim: status.nextClaim
        });
      }
      
      // Obtener jugayganaUserId para consultar NETWIN (misma fuente que referidos).
      // Si falta, se intenta completar automáticamente (backfill al vuelo).
      const jugayganaUserId = await resolveJugayganaUserId(userId, username);
      
      if (!jugayganaUserId) {
        return res.json({
          success: false,
          message: 'Tu cuenta no está vinculada a la plataforma. Contacta al soporte.',
          canClaim: true
        });
      }
      
      const { dateStr } = jugaygana.getYesterdayRangeArgentinaEpoch();

      // Obtener movimientos REALES del período desde JUGAYGANA
      const mov = await getRealMovementsTotals(username, 'daily');
      const totalDeposits = mov.deposits;
      const totalWithdrawals = mov.withdrawals;

      logger.info('[REFUND] daily — usuario:', username, 'depositos:', totalDeposits, 'retiros:', totalWithdrawals);

      // Calcular pérdida real (lo que depositó y NO retiró)
      const netLoss = Math.max(0, totalDeposits - totalWithdrawals);

      if (netLoss === 0) {
        logger.info('[REFUND] daily — sin pérdida neta para:', username);
        return res.json({
          success: false,
          message: 'No tenés pérdida neta en el período. El reembolso aplica solo sobre depósitos no recuperados vía retiros.',
          canClaim: true,
          netAmount: 0
        });
      }

      // Calcular monto del reembolso (8% para daily)
      const refundAmount = Math.round(netLoss * 0.08);

      logger.info('[REFUND] daily — calculado para', username, 'netLoss:', netLoss, 'refund:', refundAmount);

      // Pre-insertar RefundClaim con periodKey ANTES del credit. Los indices
      // unique { userId, type, periodKey } y { username, type, periodKey }
      // actuan como gatekeeper atomico: si dos requests llegan al mismo
      // tiempo, solo uno persiste y los demas reciben E11000. Asi prevenimos
      // doble credito incluso sin Redis y aunque el userId varie.
      const periodKey = computePeriodKey('daily');
      // Pre-chequeo amigable por userId O username (cualquiera de los dos
      // alcanza para detectar duplicado y evitar el ida/vuelta a Mongo).
      const existing = await RefundClaim.findOne({
        type: 'daily',
        periodKey,
        $or: [{ userId }, { username }]
      }).lean();
      if (existing) {
        logger.warn(`[REFUND] daily — pre-check rechazo por claim existente para ${username} en ${periodKey}`);
        return res.json({
          success: false,
          message: 'Ya reclamaste tu reembolso diario. Vuelve mañana!',
          canClaim: false
        });
      }
      let claim;
      try {
        claim = await RefundClaim.create({
          id: uuidv4(),
          userId,
          username,
          type: 'daily',
          amount: refundAmount,
          netAmount: netLoss,
          percentage: 8,
          period: dateStr,
          periodKey,
          claimedAt: new Date()
        });
      } catch (e) {
        if (e && e.code === 11000) {
          logger.warn(`[REFUND] daily — duplicado bloqueado por indice unique para ${username} en ${periodKey} (key: ${JSON.stringify(e.keyValue || e.keyPattern || {})})`);
          return res.json({
            success: false,
            message: 'Ya reclamaste tu reembolso diario. Vuelve mañana!',
            canClaim: false
          });
        }
        throw e;
      }

      const depositResult = await jugaygana.creditUserBalance(username, refundAmount);

      if (!depositResult.success) {
        // CRITICO: NO eliminamos el RefundClaim. Si el credit retorna
        // success:false por timeout/red, JUGAYGANA pudo haber aplicado el
        // deposito y la respuesta haberse perdido en el cable. Borrar el
        // record permitiria al usuario reclamar de nuevo y disparar un
        // segundo credit. En su lugar marcamos status='pending_credit_failed'
        // para que el indice unique siga bloqueando re-reclamos y un admin
        // pueda reconciliar contra JUGAYGANA: si el credito no aplico, borra
        // el row a mano (admin); si aplico, marca como completed.
        try {
          claim.status = 'pending_credit_failed';
          claim.creditError = String(depositResult.error || 'Error desconocido').slice(0, 500);
          await claim.save();
        } catch (e) {
          logger.error(`[REFUND] no se pudo persistir pending_credit_failed para claim ${claim._id}: ${e.message}`);
        }
        logger.error(`[REFUND] credit fallo para ${username} (${claim.type} ${claim.periodKey}): ${depositResult.error} - claim ${claim._id} marcado pending_credit_failed`);
        return res.json({
          success: false,
          message: 'Hubo un problema al acreditar tu reembolso. El administrador lo está revisando — no reintentes, podés contactarte por WhatsApp.',
          canClaim: false,
          pendingReview: true
        });
      }

      // Persistir el transactionId real del credit.
      try {
        claim.transactionId = depositResult.data?.transfer_id || depositResult.data?.transferId || null;
        await claim.save();
      } catch (_) { /* best-effort */ }

      // Guardar transacción para el dashboard
      await Transaction.create({
        id: uuidv4(),
        type: 'refund',
        amount: refundAmount,
        username,
        description: `Reembolso diario (${dateStr})`,
        transactionId: depositResult.data?.transfer_id || depositResult.data?.transferId,
        timestamp: new Date()
      });

      res.json({
        success: true,
        message: `¡Reembolso diario de $${refundAmount} acreditado!`,
        amount: refundAmount,
        percentage: 8,
        netAmount: netLoss,
        nextClaim: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      });
    } finally {
      setTimeout(() => releaseRefundLock(userId, 'daily'), 3000);
    }
  } catch (error) {
    console.error('Error reclamando reembolso diario:', error);
    res.json({ success: false, message: 'Error del servidor', canClaim: true });
  }
});

app.post('/api/refunds/claim/weekly', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const username = req.user.username;
    
    if (!await acquireRefundLock(userId, 'weekly')) {
      return res.json({
        success: false,
        message: '⏳ Ya estás procesando un reembolso. Por favor espera...',
        canClaim: true,
        processing: true
      });
    }
    
    try {
      const status = await refunds.canClaimWeeklyRefund(userId);
      
      if (!status.canClaim) {
        return res.json({
          success: false,
          message: `No puedes reclamar el reembolso semanal. Disponible: ${status.availableDays}`,
          canClaim: false,
          nextClaim: status.nextClaim,
          availableDays: status.availableDays
        });
      }
      
      // Obtener jugayganaUserId para consultar NETWIN (misma fuente que referidos).
      // Si falta, se intenta completar automáticamente (backfill al vuelo).
      const jugayganaUserId = await resolveJugayganaUserId(userId, username);
      
      if (!jugayganaUserId) {
        return res.json({
          success: false,
          message: 'Tu cuenta no está vinculada a la plataforma. Contacta al soporte.',
          canClaim: true
        });
      }
      
      const { fromDateStr, toDateStr } = jugaygana.getLastWeekRangeArgentinaEpoch();

      // Obtener movimientos REALES del período desde JUGAYGANA
      const mov = await getRealMovementsTotals(username, 'weekly');
      const totalDeposits = mov.deposits;
      const totalWithdrawals = mov.withdrawals;

      logger.info('[REFUND] weekly — usuario:', username, 'depositos:', totalDeposits, 'retiros:', totalWithdrawals);

      // Calcular pérdida real (lo que depositó y NO retiró)
      const netLoss = Math.max(0, totalDeposits - totalWithdrawals);

      if (netLoss === 0) {
        logger.info('[REFUND] weekly — sin pérdida neta para:', username);
        return res.json({
          success: false,
          message: 'No tenés pérdida neta en el período. El reembolso aplica solo sobre depósitos no recuperados vía retiros.',
          canClaim: true,
          netAmount: 0
        });
      }

      // Calcular monto del reembolso (5% para weekly)
      const refundAmount = Math.round(netLoss * 0.05);

      logger.info('[REFUND] weekly — calculado para', username, 'netLoss:', netLoss, 'refund:', refundAmount);

      // Pre-insertar RefundClaim con periodKey ANTES del credit (ver comentario
      // en daily para el racional). Pre-check por userId O username + insert
      // protegido por dos indices unique (userId+ y username+).
      const periodKey = computePeriodKey('weekly');
      const existing = await RefundClaim.findOne({
        type: 'weekly',
        periodKey,
        $or: [{ userId }, { username }]
      }).lean();
      if (existing) {
        logger.warn(`[REFUND] weekly — pre-check rechazo por claim existente para ${username} en ${periodKey}`);
        return res.json({
          success: false,
          message: 'Ya reclamaste tu reembolso semanal en este período.',
          canClaim: false
        });
      }
      let claim;
      try {
        claim = await RefundClaim.create({
          id: uuidv4(),
          userId,
          username,
          type: 'weekly',
          amount: refundAmount,
          netAmount: netLoss,
          percentage: 5,
          period: `${fromDateStr} a ${toDateStr}`,
          periodKey,
          claimedAt: new Date()
        });
      } catch (e) {
        if (e && e.code === 11000) {
          logger.warn(`[REFUND] weekly — duplicado bloqueado por indice unique para ${username} en ${periodKey} (key: ${JSON.stringify(e.keyValue || e.keyPattern || {})})`);
          return res.json({
            success: false,
            message: 'Ya reclamaste tu reembolso semanal en este período.',
            canClaim: false
          });
        }
        throw e;
      }

      const depositResult = await jugaygana.creditUserBalance(username, refundAmount);

      if (!depositResult.success) {
        // CRITICO: NO eliminamos el RefundClaim. Si el credit retorna
        // success:false por timeout/red, JUGAYGANA pudo haber aplicado el
        // deposito y la respuesta haberse perdido en el cable. Borrar el
        // record permitiria al usuario reclamar de nuevo y disparar un
        // segundo credit. En su lugar marcamos status='pending_credit_failed'
        // para que el indice unique siga bloqueando re-reclamos y un admin
        // pueda reconciliar contra JUGAYGANA: si el credito no aplico, borra
        // el row a mano (admin); si aplico, marca como completed.
        try {
          claim.status = 'pending_credit_failed';
          claim.creditError = String(depositResult.error || 'Error desconocido').slice(0, 500);
          await claim.save();
        } catch (e) {
          logger.error(`[REFUND] no se pudo persistir pending_credit_failed para claim ${claim._id}: ${e.message}`);
        }
        logger.error(`[REFUND] credit fallo para ${username} (${claim.type} ${claim.periodKey}): ${depositResult.error} - claim ${claim._id} marcado pending_credit_failed`);
        return res.json({
          success: false,
          message: 'Hubo un problema al acreditar tu reembolso. El administrador lo está revisando — no reintentes, podés contactarte por WhatsApp.',
          canClaim: false,
          pendingReview: true
        });
      }

      try {
        claim.transactionId = depositResult.data?.transfer_id || depositResult.data?.transferId || null;
        await claim.save();
      } catch (_) { /* best-effort */ }

      // Guardar transacción para el dashboard
      await Transaction.create({
        id: uuidv4(),
        type: 'refund',
        amount: refundAmount,
        username,
        description: `Reembolso semanal (${fromDateStr} a ${toDateStr})`,
        transactionId: depositResult.data?.transfer_id || depositResult.data?.transferId,
        timestamp: new Date()
      });

      res.json({
        success: true,
        message: `¡Reembolso semanal de $${refundAmount} acreditado!`,
        amount: refundAmount,
        percentage: 5,
        netAmount: netLoss,
        nextClaim: status.nextClaim
      });
    } finally {
      setTimeout(() => releaseRefundLock(userId, 'weekly'), 3000);
    }
  } catch (error) {
    console.error('Error reclamando reembolso semanal:', error);
    res.json({ success: false, message: 'Error del servidor', canClaim: true });
  }
});

app.post('/api/refunds/claim/monthly', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const username = req.user.username;
    
    if (!await acquireRefundLock(userId, 'monthly')) {
      return res.json({
        success: false,
        message: '⏳ Ya estás procesando un reembolso. Por favor espera...',
        canClaim: true,
        processing: true
      });
    }
    
    try {
      const status = await refunds.canClaimMonthlyRefund(userId);
      
      if (!status.canClaim) {
        return res.json({
          success: false,
          message: `No puedes reclamar el reembolso mensual. Disponible: ${status.availableFrom}`,
          canClaim: false,
          nextClaim: status.nextClaim,
          availableFrom: status.availableFrom
        });
      }
      
      // Obtener jugayganaUserId para consultar NETWIN (misma fuente que referidos).
      // Si falta, se intenta completar automáticamente (backfill al vuelo).
      const jugayganaUserId = await resolveJugayganaUserId(userId, username);
      
      if (!jugayganaUserId) {
        return res.json({
          success: false,
          message: 'Tu cuenta no está vinculada a la plataforma. Contacta al soporte.',
          canClaim: true
        });
      }
      
      const { fromDateStr, toDateStr } = jugaygana.getLastMonthRangeArgentinaEpoch();

      // Obtener movimientos REALES del período desde JUGAYGANA
      const mov = await getRealMovementsTotals(username, 'monthly');
      const totalDeposits = mov.deposits;
      const totalWithdrawals = mov.withdrawals;

      logger.info('[REFUND] monthly — usuario:', username, 'depositos:', totalDeposits, 'retiros:', totalWithdrawals);

      // Calcular pérdida real (lo que depositó y NO retiró)
      const netLoss = Math.max(0, totalDeposits - totalWithdrawals);

      if (netLoss === 0) {
        logger.info('[REFUND] monthly — sin pérdida neta para:', username);
        return res.json({
          success: false,
          message: 'No tenés pérdida neta en el período. El reembolso aplica solo sobre depósitos no recuperados vía retiros.',
          canClaim: true,
          netAmount: 0
        });
      }

      // Calcular monto del reembolso (3% para monthly)
      const refundAmount = Math.round(netLoss * 0.03);

      logger.info('[REFUND] monthly — calculado para', username, 'netLoss:', netLoss, 'refund:', refundAmount);

      // Pre-insertar RefundClaim con periodKey ANTES del credit (ver comentario
      // en daily para el racional). Pre-check por userId O username + insert
      // protegido por dos indices unique (userId+ y username+).
      const periodKey = computePeriodKey('monthly');
      const existing = await RefundClaim.findOne({
        type: 'monthly',
        periodKey,
        $or: [{ userId }, { username }]
      }).lean();
      if (existing) {
        logger.warn(`[REFUND] monthly — pre-check rechazo por claim existente para ${username} en ${periodKey}`);
        return res.json({
          success: false,
          message: 'Ya reclamaste tu reembolso mensual en este período.',
          canClaim: false
        });
      }
      let claim;
      try {
        claim = await RefundClaim.create({
          id: uuidv4(),
          userId,
          username,
          type: 'monthly',
          amount: refundAmount,
          netAmount: netLoss,
          percentage: 3,
          period: `${fromDateStr} a ${toDateStr}`,
          periodKey,
          claimedAt: new Date()
        });
      } catch (e) {
        if (e && e.code === 11000) {
          logger.warn(`[REFUND] monthly — duplicado bloqueado por indice unique para ${username} en ${periodKey} (key: ${JSON.stringify(e.keyValue || e.keyPattern || {})})`);
          return res.json({
            success: false,
            message: 'Ya reclamaste tu reembolso mensual en este período.',
            canClaim: false
          });
        }
        throw e;
      }

      const depositResult = await jugaygana.creditUserBalance(username, refundAmount);

      if (!depositResult.success) {
        // CRITICO: NO eliminamos el RefundClaim. Si el credit retorna
        // success:false por timeout/red, JUGAYGANA pudo haber aplicado el
        // deposito y la respuesta haberse perdido en el cable. Borrar el
        // record permitiria al usuario reclamar de nuevo y disparar un
        // segundo credit. En su lugar marcamos status='pending_credit_failed'
        // para que el indice unique siga bloqueando re-reclamos y un admin
        // pueda reconciliar contra JUGAYGANA: si el credito no aplico, borra
        // el row a mano (admin); si aplico, marca como completed.
        try {
          claim.status = 'pending_credit_failed';
          claim.creditError = String(depositResult.error || 'Error desconocido').slice(0, 500);
          await claim.save();
        } catch (e) {
          logger.error(`[REFUND] no se pudo persistir pending_credit_failed para claim ${claim._id}: ${e.message}`);
        }
        logger.error(`[REFUND] credit fallo para ${username} (${claim.type} ${claim.periodKey}): ${depositResult.error} - claim ${claim._id} marcado pending_credit_failed`);
        return res.json({
          success: false,
          message: 'Hubo un problema al acreditar tu reembolso. El administrador lo está revisando — no reintentes, podés contactarte por WhatsApp.',
          canClaim: false,
          pendingReview: true
        });
      }

      try {
        claim.transactionId = depositResult.data?.transfer_id || depositResult.data?.transferId || null;
        await claim.save();
      } catch (_) { /* best-effort */ }

      // Guardar transacción para el dashboard
      await Transaction.create({
        id: uuidv4(),
        type: 'refund',
        amount: refundAmount,
        username,
        description: `Reembolso mensual (${fromDateStr} a ${toDateStr})`,
        transactionId: depositResult.data?.transfer_id || depositResult.data?.transferId,
        timestamp: new Date()
      });

      res.json({
        success: true,
        message: `¡Reembolso mensual de $${refundAmount} acreditado!`,
        amount: refundAmount,
        percentage: 3,
        netAmount: netLoss,
        nextClaim: status.nextClaim
      });
    } finally {
      setTimeout(() => releaseRefundLock(userId, 'monthly'), 3000);
    }
  } catch (error) {
    console.error('Error reclamando reembolso mensual:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.get('/api/refunds/history', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userRefunds = await RefundClaim.find({ userId }).sort({ claimedAt: -1 }).lean();
    
    res.json({ refunds: userRefunds });
  } catch (error) {
    console.error('Error obteniendo historial de reembolsos:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.get('/api/refunds/all', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const allRefunds = await RefundClaim.find().sort({ claimedAt: -1 }).lean();
    
    const summary = {
      dailyCount: 0,
      weeklyCount: 0,
      monthlyCount: 0,
      totalAmount: 0
    };
    
    allRefunds.forEach(r => {
      summary.totalAmount += r.amount || 0;
      if (r.type === 'daily') summary.dailyCount++;
      else if (r.type === 'weekly') summary.weeklyCount++;
      else if (r.type === 'monthly') summary.monthlyCount++;
    });
    
    res.json({
      refunds: allRefunds,
      summary
    });
  } catch (error) {
    console.error('Error obteniendo todos los reembolsos:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================
// MOVIMIENTOS DE SALDO
// ============================================

app.get('/api/balance', authMiddleware, async (req, res) => {
  try {
    const username = req.user.username;
    const result = await jugayganaMovements.getUserBalance(username);
    
    if (result.success) {
      res.json({
        balance: result.balance,
        username: result.username
      });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (error) {
    console.error('Error obteniendo balance:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.get('/api/balance/live', authMiddleware, async (req, res) => {
  try {
    const username = req.user.username;
    const result = await jugayganaMovements.getUserBalance(username);
    
    if (result.success) {
      await User.updateOne(
        { username },
        { balance: result.balance }
      );
      
      res.json({
        balance: result.balance,
        username: result.username,
        updatedAt: new Date().toISOString()
      });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (error) {
    console.error('Error obteniendo balance en tiempo real:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.get('/api/movements', authMiddleware, async (req, res) => {
  try {
    const username = req.user.username;
    const { startDate, endDate, page = 1 } = req.query;
    
    const result = await jugayganaMovements.getUserMovements(username, {
      startDate,
      endDate,
      page: parseInt(page),
      pageSize: 50
    });
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (error) {
    console.error('Error obteniendo movimientos:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.post('/api/admin/deposit', authMiddleware, depositorMiddleware, async (req, res) => {
  try {
    const { userId, username, amount, bonus = 0, description } = req.body;
    
    // Buscar usuario por ID o username
    let user;
    if (userId) {
      user = await User.findOne({ id: userId });
    } else if (username) {
      user = await User.findOne({ username });
    }
    
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Monto inválido' });
    }
    
    const result = await jugaygana.depositToUser(user.username, parseFloat(amount), description);
    
    if (result.success) {
      // Si hay bonus, acreditarlo en JUGAYGANA como individual_bonus en operación separada
      let bonusJgResult = null;
      if (parseFloat(bonus) > 0) {
        bonusJgResult = await jugaygana.creditUserBalance(user.username, parseFloat(bonus));
        if (!bonusJgResult.success) {
          console.error('Error al acreditar bonus en JUGAYGANA:', bonusJgResult.error);
        }
      }

      await recordUserActivity(user.id, 'deposit', parseFloat(amount));
      
      // Obtener saldo actualizado del usuario
      const balanceResult = await jugayganaMovements.getUserBalance(user.username);
      const newBalance = balanceResult.success ? balanceResult.balance : (result.data?.user_balance_after || 0);
      
      // Crear mensaje de sistema para el usuario
      const depositCmdName = parseFloat(bonus) > 0 ? '/sys_deposit_bonus' : '/sys_deposit';
      const depositCmd = await Command.findOne({ name: depositCmdName, isActive: true });
      let messageContent;
      if (depositCmd && depositCmd.response) {
        messageContent = depositCmd.response
          .replace(/\{amount\}/g, amount)
          .replace(/\{bonus\}/g, bonus)
          .replace(/\{balance\}/g, newBalance);
      } else if (bonus > 0) {
        messageContent = `🔒💰 Depósito de $${amount} (incluye $${bonus} de bonificación) acreditado con éxito. ✅ \n💸 Tu nuevo saldo es $${newBalance} 💸\n\nPuedes verificarlo en: https://jugaygana.bet\n\n🔥 Mañana podes revisar si tenes reembolso para reclamar de forma automatica 🔥`;
      } else {
        messageContent = `🔒💰 Depósito de $${amount} acreditado con éxito. ✅ \n💸 Tu nuevo saldo es $${newBalance} 💸\n\nPuedes verificarlo en: https://jugaygana.bet\n\n🔥 Mañana podes revisar si tenes reembolso para reclamar de forma automatica 🔥`;
      }
      
      const systemMessage = await Message.create({
        id: uuidv4(),
        senderId: 'admin',
        senderUsername: req.user.username,
        senderRole: 'admin',
        receiverId: user.id,
        receiverRole: 'user',
        content: messageContent,
        type: 'system',
        timestamp: new Date(),
        read: false
      });
      
      // CORREGIDO: Emitir a todos los que están viendo este chat (usuario y admins)
      const messageData = {
        id: systemMessage.id,
        senderId: 'admin',
        senderUsername: req.user.username,
        senderRole: 'admin',
        receiverId: user.id,
        receiverRole: 'user',
        content: messageContent,
        timestamp: new Date(),
        type: 'system'
      };
      
      // Emitir a la sala del usuario
      io.to(`user_${user.id}`).emit('new_message', messageData);
      
      // Emitir a la sala del chat (para admins que están viendo)
      io.to(`chat_${user.id}`).emit('new_message', messageData);
      
      // Notificar a todos los admins
      notifyAdmins('new_message', {
        message: messageData,
        userId: user.id,
        username: user.username
      });

      // Segundo mensaje recordatorio
      const reminderCmd = await Command.findOne({ name: '/sys_reminder', isActive: true });
      const reminderContent = (reminderCmd && reminderCmd.response)
        ? reminderCmd.response
            .replace(/\{amount\}/g, amount)
            .replace(/\{balance\}/g, newBalance)
        : `🎮 ¡Recuerda!\nPara cargar o cobrar, ingresa a 🌐 www.vipcargas.com.\n🔥 ¡Ya tienes el acceso guardado, así que te queda más fácil y rápido cada vez que entres!  \n🕹️ ¡No olvides guardarla y mantenerla a mano!\n\nwww.vipcargas.com`;
      const reminderMessage = await Message.create({
        id: uuidv4(),
        senderId: 'admin',
        senderUsername: req.user.username,
        senderRole: 'admin',
        receiverId: user.id,
        receiverRole: 'user',
        content: reminderContent,
        type: 'system',
        timestamp: new Date(),
        read: false
      });
      const reminderData = {
        id: reminderMessage.id,
        senderId: 'admin',
        senderUsername: req.user.username,
        senderRole: 'admin',
        receiverId: user.id,
        receiverRole: 'user',
        content: reminderContent,
        timestamp: new Date(),
        type: 'system'
      };
      io.to(`user_${user.id}`).emit('new_message', reminderData);
      io.to(`chat_${user.id}`).emit('new_message', reminderData);
      notifyAdmins('new_message', { message: reminderData, userId: user.id, username: user.username });
      
      // Notificar al usuario específico si está conectado
      const userSocket = connectedUsers.get(user.id);
      if (userSocket) {
        userSocket.emit('balance_updated', { balance: newBalance });
      }

      // Push FCM para usuarios offline: enviar si tiene token registrado.
      // El mensaje ya se entregó por Socket.IO a usuarios online; FCM cubre offline/background.
      {
        const depositBonus = parseFloat(bonus) || 0;
        const depositPushTitle = depositBonus > 0
          ? `💰 Depósito + bonus acreditado`
          : `💰 Depósito acreditado`;
        const depositPushBody = `$${amount} acreditados en tu cuenta. Nuevo saldo: $${newBalance}.`;
        sendPushIfOffline(user, depositPushTitle, depositPushBody, { tag: 'deposit' }).catch((e) => {
          logger.warn(`[FCM] sendPushIfOffline (deposit) falló para ${user.username}: ${e.message}`);
        });
      }
      
      await Transaction.create({
        id: uuidv4(),
        type: 'deposit',
        amount: parseFloat(amount),
        bonus: parseFloat(bonus),
        username: user.username,
        userId: user.id,
        description: description || 'Depósito realizado',
        adminId: req.user?.userId,
        adminUsername: req.user?.username,
        adminRole: req.user?.role || 'admin',
        transactionId: result.data?.transfer_id || result.data?.transferId,
        timestamp: new Date()
      });

      // Registrar bonificación como transacción separada solo si fue acreditada correctamente en JUGAYGANA
      if (parseFloat(bonus) > 0 && bonusJgResult?.success) {
        await Transaction.create({
          id: uuidv4(),
          type: 'bonus',
          amount: parseFloat(bonus),
          username: user.username,
          userId: user.id,
          description: `Bonificación incluida en depósito de $${amount}`,
          adminId: req.user?.userId,
          adminUsername: req.user?.username,
          adminRole: req.user?.role || 'admin',
          transactionId: bonusJgResult.data?.transfer_id,
          timestamp: new Date()
        });
      }
      
      res.json({
        success: true,
        message: 'Depósito realizado correctamente',
        newBalance: newBalance,
        transactionId: result.data?.transfer_id || result.data?.transferId
      });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (error) {
    console.error('Error realizando depósito:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.get('/api/admin/balance/:username', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { username } = req.params;
    const result = await jugayganaMovements.getUserBalance(username);
    
    if (result.success) {
      res.json({ balance: result.balance });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (error) {
    console.error('Error obteniendo balance:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.post('/api/admin/withdrawal', authMiddleware, withdrawerMiddleware, async (req, res) => {
  try {
    const { userId, username, amount, description } = req.body;
    
    // Buscar usuario por ID o username
    let user;
    if (userId) {
      user = await User.findOne({ id: userId });
    } else if (username) {
      user = await User.findOne({ username });
    }
    
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Monto inválido' });
    }
    
    const result = await jugaygana.withdrawFromUser(user.username, amount, description);
    
    if (result.success) {
      await recordUserActivity(user.id, 'withdrawal', amount);
      
      // Obtener saldo actualizado del usuario
      const balanceResult = await jugayganaMovements.getUserBalance(user.username);
      const newBalance = balanceResult.success ? balanceResult.balance : (result.data?.user_balance_after || 0);
      
      // Crear mensaje de sistema para el usuario
      const withdrawalCmd = await Command.findOne({ name: '/sys_withdrawal', isActive: true });
      const messageContent = (withdrawalCmd && withdrawalCmd.response)
        ? withdrawalCmd.response
            .replace(/\{amount\}/g, amount)
            .replace(/\{balance\}/g, newBalance)
        : `🔒💸 Retiro de $${amount} realizado correctamente. \n💸 Tu nuevo saldo es $${newBalance} 💸\nSu pago se está procesando. Por favor, aguarde un momento.`;
      
      const systemMessage = await Message.create({
        id: uuidv4(),
        senderId: 'admin',
        senderUsername: req.user.username,
        senderRole: 'admin',
        receiverId: user.id,
        receiverRole: 'user',
        content: messageContent,
        type: 'system',
        timestamp: new Date(),
        read: false
      });
      
      // CORREGIDO: Emitir a todos los que están viendo este chat (usuario y admins)
      const messageData = {
        id: systemMessage.id,
        senderId: 'admin',
        senderUsername: req.user.username,
        senderRole: 'admin',
        receiverId: user.id,
        receiverRole: 'user',
        content: messageContent,
        timestamp: new Date(),
        type: 'system'
      };
      
      // Emitir a la sala del usuario
      io.to(`user_${user.id}`).emit('new_message', messageData);
      
      // Emitir a la sala del chat (para admins que están viendo)
      io.to(`chat_${user.id}`).emit('new_message', messageData);
      
      // Notificar a todos los admins
      notifyAdmins('new_message', {
        message: messageData,
        userId: user.id,
        username: user.username
      });
      
      // Notificar al usuario específico si está conectado
      const userSocket = connectedUsers.get(user.id);
      if (userSocket) {
        userSocket.emit('balance_updated', { balance: newBalance });
      }

      // Push FCM para usuarios offline.
      sendPushIfOffline(user, '💸 Retiro procesado', `$${amount} enviados. Nuevo saldo: $${newBalance}.`, { tag: 'withdrawal' }).catch((e) => {
        logger.warn(`[FCM] sendPushIfOffline (withdrawal) falló para ${user.username}: ${e.message}`);
      });
      
      await Transaction.create({
        id: uuidv4(),
        type: 'withdrawal',
        amount: parseFloat(amount),
        username: user.username,
        userId: user.id,
        description: description || 'Retiro realizado',
        adminId: req.user?.userId,
        adminUsername: req.user?.username,
        adminRole: req.user?.role || 'admin',
        transactionId: result.data?.transfer_id || result.data?.transferId,
        timestamp: new Date()
      });
      
      res.json({
        success: true,
        message: 'Retiro realizado correctamente',
        newBalance: newBalance,
        transactionId: result.data?.transfer_id || result.data?.transferId
      });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (error) {
    console.error('Error realizando retiro:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.post('/api/admin/bonus', authMiddleware, depositorMiddleware, async (req, res) => {
  try {
    const { username: rawUsername, userId: rawUserId, amount } = req.body;

    // Resolver username: puede venir como username directo o como userId
    // Rechazar cualquier userId que no sea string primitivo (previene inyección NoSQL)
    let resolvedUsername = rawUsername && typeof rawUsername === 'string' ? rawUsername.trim() : null;
    if (!resolvedUsername && rawUserId) {
      if (typeof rawUserId !== 'string') {
        return res.status(400).json({ error: 'userId inválido' });
      }
      const safeUserId = rawUserId.trim();
      const user = await User.findOne({ id: safeUserId });
      if (!user) {
        return res.status(404).json({ error: 'Usuario no encontrado' });
      }
      resolvedUsername = user.username;
    }

    if (!resolvedUsername || !amount) {
      return res.status(400).json({ error: 'Usuario y monto requeridos' });
    }
    
    const bonusAmount = parseFloat(amount);
    if (isNaN(bonusAmount) || bonusAmount <= 0) {
      return res.status(400).json({ error: 'Monto de bonificación inválido' });
    }
    
    const depositResult = await jugaygana.creditUserBalance(resolvedUsername, bonusAmount);
    
    if (depositResult.success) {
      // Buscar usuario para obtener su id (necesario para el mensaje)
      const bonusUser = await User.findOne({ username: resolvedUsername });

      await Transaction.create({
        id: uuidv4(),
        type: 'bonus',
        amount: bonusAmount,
        username: resolvedUsername,
        description: 'Bonificación otorgada',
        adminId: req.user?.userId,
        adminUsername: req.user?.username,
        adminRole: req.user?.role || 'admin',
        transactionId: depositResult.data?.transfer_id || depositResult.data?.transferId,
        timestamp: new Date()
      });

      // Obtener saldo actualizado para incluirlo en el mensaje
      const balanceResult = await jugayganaMovements.getUserBalance(resolvedUsername);
      const newBalance = balanceResult.success ? balanceResult.balance : null;

      // Enviar mensaje automático al usuario con el monto acreditado y el saldo actual
      if (bonusUser) {
        try {
          const bonusCmd = await Command.findOne({ name: '/sys_bonus', isActive: true });
          let bonusMsg;
          if (bonusCmd && bonusCmd.response) {
            bonusMsg = bonusCmd.response
              .replace(/\$\{amount\}/g, bonusAmount)
              .replace(/\$\{balance\}/g, newBalance !== null ? newBalance : '—');
          } else {
            bonusMsg = `🎁 ¡Bonificación de $${bonusAmount} acreditada en tu cuenta! ✅\n💸 Tu saldo actual es $${newBalance !== null ? newBalance : '—'} 💸\n\nPuedes verificarlo en: https://www.jugaygana44.bet`;
          }
          await Message.create({
            id: uuidv4(),
            senderId: 'system',
            senderUsername: req.user?.username,
            senderRole: 'admin',
            receiverId: bonusUser.id,
            receiverRole: 'user',
            content: bonusMsg,
            type: 'system',
            timestamp: new Date(),
            read: false
          });
        } catch (msgErr) {
          console.error('No se pudo enviar mensaje de bonus al usuario:', msgErr);
        }

        // Push FCM para usuarios offline (bonus).
        const bonusBalance = newBalance !== null ? newBalance : '—';
        sendPushIfOffline(bonusUser, '🎁 Bonificación acreditada', `$${bonusAmount} de bonus en tu cuenta. Saldo: $${bonusBalance}.`, { tag: 'bonus' }).catch((e) => {
          logger.warn(`[FCM] sendPushIfOffline (bonus) falló para ${bonusUser.username}: ${e.message}`);
        });
      }

      res.json({
        success: true,
        message: `Bonificación de $${bonusAmount.toLocaleString()} realizada correctamente`,
        newBalance: newBalance !== null ? newBalance : depositResult.data?.user_balance_after,
        transactionId: depositResult.data?.transfer_id || depositResult.data?.transferId
      });
    } else {
      res.status(400).json({ error: depositResult.error || 'Error al aplicar bonificación' });
    }
  } catch (error) {
    console.error('Error realizando bonificación:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================
// SOCKET.IO - CHAT EN TIEMPO REAL
// ============================================

const connectedUsers = new Map();
const connectedAdmins = new Map();

io.on('connection', (socket) => {
  logger.debug(`New socket connection: ${socket.id}`);
  
  socket.on('authenticate', (token) => {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      socket.userId = decoded.userId;
      socket.username = decoded.username;
      socket.role = decoded.role;
      
      if (['admin', 'depositor', 'withdrawer'].includes(decoded.role)) {
        connectedAdmins.set(decoded.userId, socket);
        socket.join('admins'); // Unir a sala de admins
        logger.info(`Admin connected: ${decoded.username} (${decoded.role}) socket=${socket.id}`);
        broadcastStats();
      } else {
        connectedUsers.set(decoded.userId, socket);
        socket.join(`user_${decoded.userId}`); // Unir a sala personal del usuario
        logger.info(`User connected: ${decoded.username} id=${decoded.userId} socket=${socket.id}`);
        notifyAdmins('user_connected', {
          userId: decoded.userId,
          username: decoded.username
        });
      }
      
      socket.emit('authenticated', { success: true, role: decoded.role });
    } catch (error) {
      logger.error(`Socket auth error: ${error.message}`);
      socket.emit('authenticated', { success: false, error: 'Token inválido' });
    }
  });
  
  // Unirse a sala de admins (admin, depositor, withdrawer)
  socket.on('join_admin_room', () => {
    if (['admin', 'depositor', 'withdrawer'].includes(socket.role)) {
      socket.join('admins');
      logger.debug(`Admin ${socket.username} (${socket.role}) joined admin room`);
    }
  });
  
  // Unirse a sala personal del usuario
  socket.on('join_user_room', (data) => {
    // SECURITY: Only allow a user to join their OWN room (prevent room spoofing)
    if (socket.role === 'user' && data && data.userId && data.userId === socket.userId) {
      socket.join(`user_${data.userId}`);
      logger.debug(`User ${socket.username} joined personal room: user_${data.userId}`);
    } else if (socket.role === 'user' && data && data.userId && data.userId !== socket.userId) {
      logger.warn(`[SECURITY] User ${socket.username} (${socket.userId}) attempted to join room of user ${data.userId}`);
    }
  });
  
  // CORREGIDO: Unirse a sala de chat específica (para admins)
  socket.on('join_chat_room', (data) => {
    if (['admin', 'depositor', 'withdrawer'].includes(socket.role) && data && data.userId) {
      socket.join(`chat_${data.userId}`);
      logger.debug(`Admin ${socket.username} joined chat room: chat_${data.userId}`);
    }
  });
  
  // CORREGIDO: Salir de sala de chat
  socket.on('leave_chat_room', (data) => {
    if (data && data.userId) {
      socket.leave(`chat_${data.userId}`);
      logger.debug(`${socket.username} left chat room: chat_${data.userId}`);
    }
  });
  
  socket.on('send_message', async (data) => {
    try {
      const { content, type = 'text', receiverId } = data;
      
      logger.debug(`[SEND_MESSAGE] user=${socket.userId} role=${socket.role} receiverId=${receiverId}`);
      
      if (!socket.userId) {
        logger.debug('[SEND_MESSAGE] ERROR: not authenticated');
        return socket.emit('error', { message: 'No autenticado' });
      }

      // SECURITY: Validate message type to prevent type confusion
      const allowedMsgTypes = ['text', 'image', 'video'];
      if (!allowedMsgTypes.includes(type)) {
        return socket.emit('error', { message: 'Tipo de mensaje no válido' });
      }

      // SECURITY: For image/video, validate that content is a well-formed https:// URL or an allowed data: URL
      if ((type === 'image' || type === 'video') && content) {
        const MAX_BASE64_SIZE = 5 * 1024 * 1024; // 5MB
        const ALLOWED_DATA_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/webm'];
        if (content.startsWith('data:')) {
          const mimeMatch = content.match(/^data:([\w\/+.-]+);base64,/);
          if (!mimeMatch || !ALLOWED_DATA_MIMES.includes(mimeMatch[1])) {
            return socket.emit('error', { message: 'Tipo de imagen o video no permitido' });
          }
          if (content.length > MAX_BASE64_SIZE) {
            return socket.emit('error', { message: 'La imagen o video es demasiado grande (máximo 5MB)' });
          }
        } else {
          let parsedMsgUrl;
          try { parsedMsgUrl = new URL(content); } catch (_) { parsedMsgUrl = null; }
          if (!parsedMsgUrl || parsedMsgUrl.protocol !== 'https:') {
            return socket.emit('error', { message: 'Las imágenes y videos deben ser URLs seguras (https)' });
          }
        }
      }
      
      // Determinar el receptor correcto
      const isAdminRole = ['admin', 'depositor', 'withdrawer'].includes(socket.role);
      const targetReceiverId = isAdminRole ? receiverId : 'admin';
      const targetReceiverRole = isAdminRole ? 'user' : 'admin';
      
      logger.debug(`[SEND_MESSAGE] isAdminRole=${isAdminRole} targetReceiverId=${targetReceiverId}`);

      // Issue #3: Bloquear comandos enviados por usuarios comunes
      if (!isAdminRole && content && content.trim().startsWith('/')) {
        return socket.emit('error', { message: 'Los usuarios no pueden enviar comandos' });
      }
      
      // CORREGIDO: PROCESAR COMANDOS ANTES de guardar el mensaje
      // Si el mensaje empieza con /, es un comando - NO guardar el mensaje del comando
      if (content.trim().startsWith('/')) {
        const commandName = content.trim().split(' ')[0];
        logger.debug(`[COMMAND] Command detected: ${commandName}`);
        
        try {
          const command = await Command.findOne({ name: commandName, isActive: true });
          
          // Determinar el receptor del comando
          const commandReceiverId = isAdminRole ? receiverId : socket.userId;
          
          if (command) {
            logger.debug(`[COMMAND] Command found: ${command.name}`);
            
            // Incrementar contador de uso
            await Command.updateOne(
              { name: commandName },
              { $inc: { usageCount: 1 }, updatedAt: new Date() }
            );
            
            // Crear mensaje de respuesta del sistema (SOLO la respuesta, NO el comando)
            const responseMessage = await Message.create({
              id: uuidv4(),
              senderId: 'system',
              senderUsername: 'Sistema',
              senderRole: 'system',
              receiverId: commandReceiverId,
              receiverRole: 'user',
              content: command.response,
              type: 'system',
              timestamp: new Date(),
              read: false
            });
            
            // Enviar respuesta al usuario receptor
            io.to(`user_${commandReceiverId}`).emit('new_message', responseMessage);
            io.to(`chat_${commandReceiverId}`).emit('new_message', responseMessage);
            
            // Notificar a admins
            notifyAdmins('new_message', {
              message: responseMessage,
              userId: commandReceiverId,
              username: socket.username
            });
            
            // Notificar sobre el uso del comando
            notifyAdmins('command_used', {
              userId: socket.userId,
              username: socket.username,
              command: commandName
            });
            
            logger.debug(`[COMMAND] Response sent for command: ${commandName}`);
            
            // IMPORTANTE: NO guardar el mensaje del comando (/cbu), solo la respuesta
            // Salir aquí - el mensaje del comando NO se guarda ni se emite
            return;
          } else {
            logger.debug(`[COMMAND] Command not found: ${commandName}`);
            
            const notFoundMessage = await Message.create({
              id: uuidv4(),
              senderId: 'system',
              senderUsername: 'Sistema',
              senderRole: 'system',
              receiverId: commandReceiverId,
              receiverRole: 'user',
              content: `❓ Comando "${commandName}" no encontrado.`,
              type: 'system',
              timestamp: new Date(),
              read: false
            });
            
            io.to(`user_${commandReceiverId}`).emit('new_message', notFoundMessage);
            io.to(`chat_${commandReceiverId}`).emit('new_message', notFoundMessage);
            
            // NO guardar el mensaje del comando
            return;
          }
        } catch (cmdError) {
          logger.error(`[COMMAND] Error processing command: ${cmdError.message}`);
          return;
        }
      }
      
      // Si llegamos aquí, NO es un comando - guardar el mensaje normalmente
      const messageData = {
        id: uuidv4(),
        senderId: socket.userId,
        senderUsername: socket.username,
        senderRole: socket.role,
        receiverId: targetReceiverId,
        receiverRole: targetReceiverRole,
        content,
        type,
        timestamp: new Date(),
        read: false
      };
      
      // Crear el mensaje
      let message;
      try {
        message = await Message.create(messageData);
        logger.debug(`[SEND_MESSAGE] Message saved: ${message.id}`);
      } catch (createError) {
        logger.error(`[SEND_MESSAGE] Error saving message: ${createError.message}`);
        throw createError;
      }
      
      // Asegurar que el ChatStatus existe
      const targetUserId = isAdminRole ? receiverId : socket.userId;
      if (targetUserId) {
        const user = await User.findOne({ id: targetUserId });
        
        const updateData = {
          userId: targetUserId,
          username: user ? user.username : socket.username,
          lastMessageAt: new Date()
        };
        
        await ChatStatus.findOneAndUpdate(
          { userId: targetUserId },
          updateData,
          { upsert: true }
        );
        
        // Solo los mensajes del usuario reabren el chat si estaba cerrado (no si está en pagos)
        if (!isAdminRole) {
          await ChatStatus.findOneAndUpdate(
            { userId: targetUserId, status: 'closed' },
            { status: 'open', closedAt: null, closedBy: null }
          );
        }
      }
      
      if (!isAdminRole) {
        // Usuario enviando mensaje - notificar a todos los admins
        logger.debug(`[SOCKET] User ${socket.username} sent message`);
        
        // Emitir a todos los admins conectados (envuelto para facilitar extracción)
        io.to('admins').emit('new_message', {
          message,
          userId: socket.userId,
          username: socket.username
        });
        
        // Emitir a la sala del chat específico (para admins que están viendo este chat)
        io.to(`chat_${socket.userId}`).emit('new_message', message);
        
        // Confirmar al usuario y entregar el mensaje via sala (evitar duplicado)
        socket.emit('message_sent', message);
        io.to(`user_${socket.userId}`).emit('new_message', message);
      } else {
        // Admin/depositor/withdrawer enviando mensaje - notificar al usuario específico
        logger.debug(`[SEND_MESSAGE] Looking up socket for user ${receiverId}`);

        // CORREGIDO: Múltiples canales de entrega para asegurar que llegue
        let delivered = false;

        // Canal 1: Socket directo, CON ack-timeout 3s. Si el cliente está vivo
        // confirma con ack({ ok: true }) (ver public/js/socket.js handler
        // 'new_message'). Si no responde en 3s consideramos el socket "fantasma"
        // (TCP conectado, pero el browser suspendió la pestaña o el SO mató el
        // proceso) y disparamos push FCM como respaldo.
        const userSocket = connectedUsers.get(receiverId);
        let ackReceived = false;
        if (userSocket) {
          delivered = true;
          try {
            userSocket.timeout(3000).emit('new_message', message, function (err /*, ack */) {
              if (err) {
                // Timeout o error de ack: el directo no contestó.
                logger.debug(`[SEND_MESSAGE] ack-timeout para user ${receiverId} (msg ${message.id}); fallback FCM`);
                _maybeSendPushFallback(receiverId, message);
              } else {
                ackReceived = true;
                logger.debug(`[SEND_MESSAGE] ack OK del user ${receiverId} (msg ${message.id})`);
              }
            });
          } catch (emitErr) {
            // Cliente Socket.IO sin soporte de ack: fallback inmediato a emit normal
            logger.warn(`[SEND_MESSAGE] timeout().emit no disponible (${emitErr.message}); usando emit plano`);
            try { userSocket.emit('new_message', message); } catch (_) {}
          }
        }

        // Canal 2: Sala del usuario (por si está conectado en otra pestaña/dispositivo)
        io.to(`user_${receiverId}`).emit('new_message', message);

        // Canal 3: Sala del chat (por si hay admins viendo)
        io.to(`chat_${receiverId}`).emit('new_message', message);

        // CORREGIDO: También notificar a otros admins que están viendo este chat
        notifyAdmins('new_message', {
          message,
          userId: receiverId,
          username: socket.username
        });

        // Confirmar al admin
        socket.emit('message_sent', message);

        logger.debug(`Message ${message.id} delivered: ${delivered ? 'YES (direct)' : 'NO (user offline, used rooms)'}`);

        // Push FCM para usuario offline: si no está conectado por socket, enviar push
        // de inmediato (no hay ack que esperar).
        if (!delivered) {
          _maybeSendPushFallback(receiverId, message);
        }
      }
      
      broadcastStats();
    } catch (error) {
      logger.error(`Error sending message via socket: ${error.message}`);
      if (error.name === 'ValidationError') {
        socket.emit('error', { message: 'Error de validación: ' + Object.values(error.errors).map(e => e.message).join(', ') });
      } else {
        socket.emit('error', { message: 'Error enviando mensaje: ' + error.message });
      }
    }
  });
  
  socket.on('typing', (data) => {
    if (!socket.userId) return; // SECURITY: Ignore events from unauthenticated sockets
    if (socket.role === 'user') {
      notifyAdmins('user_typing', {
        userId: socket.userId,
        username: socket.username,
        isTyping: data.isTyping
      });
    } else {
      const userSocket = connectedUsers.get(data.receiverId);
      if (userSocket) {
        userSocket.emit('admin_typing', {
          adminId: socket.userId,
          adminName: socket.username,
          isTyping: data.isTyping
        });
      }
    }
  });
  
  socket.on('stop_typing', (data) => {
    if (!socket.userId) return; // SECURITY: Ignore events from unauthenticated sockets
    if (socket.role === 'user') {
      notifyAdmins('user_stop_typing', {
        userId: socket.userId,
        username: socket.username
      });
    } else {
      const userSocket = connectedUsers.get(data.receiverId);
      if (userSocket) {
        userSocket.emit('admin_stop_typing', {
          adminId: socket.userId,
          adminName: socket.username
        });
      }
    }
  });
  
  socket.on('disconnect', () => {
    logger.debug(`Socket disconnected: ${socket.id}`);
    
    if (socket.role === 'admin') {
      connectedAdmins.delete(socket.userId);
      broadcastStats();
    } else {
      connectedUsers.delete(socket.userId);
      notifyAdmins('user_disconnected', {
        userId: socket.userId,
        username: socket.username
      });
    }
  });
});

function notifyAdmins(event, data) {
  // Usar la sala de admins para notificaciones más eficientes
  io.to('admins').emit(event, data);
}

let _cachedStatsData = { totalUsers: 0, lastUpdate: 0 };

async function broadcastStats() {
  const now = Date.now();
  if (now - _cachedStatsData.lastUpdate > 60000) {
    try {
      _cachedStatsData.totalUsers = await User.countDocuments({ role: 'user' });
      _cachedStatsData.lastUpdate = now;
    } catch (err) {
      logger.error('Error actualizando stats cache:', err.message);
    }
  }
  const stats = {
    connectedUsers: connectedUsers.size,
    connectedAdmins: connectedAdmins.size,
    totalUsers: _cachedStatsData.totalUsers
  };
  connectedAdmins.forEach((socket) => {
    socket.emit('stats', stats);
  });
}

// Endpoint para enviar notificación (usado por admin)
app.post('/api/admin/send-notification', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { userId, title, body, icon, badge, tag, requireInteraction, data } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'userId requerido' });
    }

    // Localizar al usuario con sus tokens FCM (UUID 'id' o ObjectId '_id').
    let user = await User.findOne({ id: userId }).select('_id id username fcmToken fcmTokens');
    if (!user) {
      try {
        user = await User.findById(userId).select('_id id username fcmToken fcmTokens');
      } catch (_) {
        // userId con formato no válido para ObjectId — caer al 404
      }
    }
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const payloadTitle = title || 'Nueva notificación';
    const payloadBody  = body  || '';
    const payloadData = {
      ...(data || {}),
      icon: icon || '/icons/icon-192x192.png',
      badge: badge || '/icons/icon-72x72.png',
      tag: tag || 'default',
      requireInteraction: requireInteraction ? 'true' : 'false'
    };

    const isOnline = !!(connectedUsers && connectedUsers.has(user.id));

    // sendPushIfOffline emite 'admin_notification' por socket si el user está
    // online (que es el evento que el cliente escucha en index.html para mostrar
    // el banner in-app); si está offline envía push FCM real a todos sus tokens
    // y limpia automáticamente los inválidos.
    await sendPushIfOffline(user, payloadTitle, payloadBody, payloadData);

    console.log(`📱 Notificación enviada a ${user.username} (${isOnline ? 'socket' : 'FCM'}): ${payloadTitle}`);
    res.json({
      success: true,
      message: 'Notificación enviada',
      delivery: isOnline ? 'socket' : 'fcm'
    });
  } catch (error) {
    console.error('Error enviando notificación:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================
// RUTAS ESTÁTICAS
// ============================================
// NOTE: readFileSafe() is defined above, in the ADMIN PAGE SECURITY section.

app.get('/', (req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  const content = readFileSafe(indexPath);
  if (content) {
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.send(content);
  } else {
    res.status(500).send('Error loading page');
  }
});

// NOTE: /adminprivado2026 routes are now registered early, BEFORE the
// express.static middleware, so they can enforce ADMIN_HOST and cookie
// checks before the file system is touched.  The old (unguarded) copies
// that lived here have been removed.

// ============================================
// INICIALIZAR DATOS DE PRUEBA
// ============================================

async function initializeData() {
  // Conectar a MongoDB
  const dbConnected = await connectDB();
  if (!dbConnected) {
    console.error('❌ No se pudo conectar a MongoDB');
    return;
  }

  // One-shot migration: clear stale mustChangePassword flag from admin accounts.
  // This fixes admins that were marked before the role-isolation fix (PR #286)
  // and would otherwise be permanently blocked by authMiddleware.
  try {
    const result = await User.updateMany(
      { role: { $in: ADMIN_ROLES }, mustChangePassword: true },
      { $set: { mustChangePassword: false } }
    );
    if (result.modifiedCount > 0) {
      logger.info(`[startup-migration] Cleared mustChangePassword flag from ${result.modifiedCount} admin accounts`);
    }
  } catch (e) {
    logger.error(`[startup-migration] Failed to clear admin mustChangePassword: ${e.message}`);
  }
  
  if (process.env.PROXY_URL) {
    console.log('🔍 Verificando IP pública...');
    await jugaygana.logProxyIP();
  }
  
  console.log('🔑 Probando conexión con JUGAYGANA...');
  const sessionOk = await jugaygana.ensureSession();
  if (sessionOk) {
    console.log('✅ Conexión con JUGAYGANA establecida');
  } else {
    console.log('⚠️ No se pudo conectar con JUGAYGANA');
  }
  
  // Verificar/crear admin principal
  // Usar variables de entorno para credenciales del admin.
  // ADMIN_USERNAME y ADMIN_PASSWORD deben configurarse en producción.
  const adminUsername = process.env.ADMIN_USERNAME;
  if (!adminUsername) {
    logger.warn('⚠️ ADMIN_USERNAME no configurado. El admin inicial no será creado/verificado automáticamente.');
  }
  const adminInitialPassword = process.env.ADMIN_PASSWORD;

  if (!adminInitialPassword) {
    logger.error('⛔ SEGURIDAD: ADMIN_PASSWORD no configurado en variables de entorno. El admin inicial NO será creado/actualizado automáticamente en producción. Configúralo antes de desplegar.');
  }

  if (adminUsername) {
  let adminExists = await User.findOne({ username: adminUsername });
  if (!adminExists) {
    if (!adminInitialPassword) {
      logger.warn('⚠️ No se creó el admin inicial porque ADMIN_PASSWORD no está configurado. Crealo manualmente vía API o configura la variable de entorno.');
    } else {
      const adminPassword = await bcrypt.hash(adminInitialPassword, 12);
      await User.create({
        id: uuidv4(),
        username: adminUsername,
        password: adminPassword,
        email: 'admin@saladejuegos.com',
        phone: null,
        role: 'admin',
        accountNumber: 'ADMIN001',
        balance: 0,
        createdAt: new Date(),
        lastLogin: null,
        isActive: true,
        jugayganaUserId: null,
        jugayganaUsername: null,
        jugayganaSyncStatus: 'not_applicable'
      });
      console.log(`✅ Admin creado: ${adminUsername}`);
    }
  } else {
    // Admin ya existe: solo asegurar que sigue activo y con el rol correcto.
    // NO se sobrescribe la contraseña para preservar cambios realizados en producción.
    let changed = false;
    if (adminExists.role !== 'admin') { adminExists.role = 'admin'; changed = true; }
    if (!adminExists.isActive) { adminExists.isActive = true; changed = true; }
    if (changed) await adminExists.save();
    console.log(`✅ Admin verificado: ${adminUsername}`);
  }
  } // end if (adminUsername)
  
  // Backfill de periodKey en RefundClaim viejos: necesario para que el indice
  // unique partial cubra retroactivamente los reembolsos anteriores al fix.
  // Idempotente y barato si no hay rows con periodKey null.
  await backfillRefundClaimPeriodKeys();

  // Verificar/crear configuración CBU por defecto
  const cbuConfig = await getConfig('cbu');
  if (!cbuConfig) {
    await setConfig('cbu', {
      number: '0000000000000000000000',
      alias: 'mi.alias.cbu',
      bank: 'Banco Ejemplo',
      titular: 'Sala de Juegos'
    });
    console.log('✅ Configuración CBU por defecto creada');
  }

  // Verificar/crear comandos de sistema (mensajes automáticos editables desde COMANDOS)
  const systemCmds = [
    {
      name: '/sys_deposit',
      description: 'Mensaje automático al realizar un depósito sin bonus. Variables disponibles: ${amount}, ${balance}',
      type: 'message',
      response: '🔒💰 Depósito de ${amount} acreditado con éxito. ✅ \n💸 Tu nuevo saldo es ${balance} 💸\n\nPuedes verificarlo en: https://jugaygana.bet\n\n🔥 Mañana podes revisar si tenes reembolso para reclamar de forma automatica 🔥'
    },
    {
      name: '/sys_deposit_bonus',
      description: 'Mensaje automático al realizar un depósito con bonus. Variables disponibles: ${amount}, ${bonus}, ${balance}',
      type: 'message',
      response: '🔒💰 Depósito de ${amount} (incluye ${bonus} de bonificación) acreditado con éxito. ✅ \n💸 Tu nuevo saldo es ${balance} 💸\n\nPuedes verificarlo en: https://jugaygana.bet\n\n🔥 Mañana podes revisar si tenes reembolso para reclamar de forma automatica 🔥'
    },
    {
      name: '/sys_bonus',
      description: 'Mensaje automático al aplicar una bonificación. Variables disponibles: ${amount}, ${balance}',
      type: 'message',
      response: '🎁 ¡Bonificación de ${amount} acreditada en tu cuenta! ✅\n💸 Tu saldo actual es ${balance} 💸\n\nPuedes verificarlo en: https://www.jugaygana44.bet'
    },
    {
      name: '/sys_withdrawal',
      description: 'Mensaje automático al realizar un retiro. Variables disponibles: ${amount}, ${balance}',
      type: 'message',
      response: '🔒💸 Retiro de ${amount} realizado correctamente. \n💸 Tu nuevo saldo es ${balance} 💸\nSu pago se está procesando. Por favor, aguarde un momento.'
    },
    {
      name: '/sys_reminder',
      description: 'Mensaje recordatorio enviado después de cada depósito (sin variables de monto por defecto).',
      type: 'message',
      response: '🎮 ¡Recuerda!\nPara cargar o cobrar, ingresa a 🌐 www.vipcargas.com.\n🔥 ¡Ya tienes el acceso guardado, así que te queda más fácil y rápido cada vez que entres!  \n🕹️ ¡No olvides guardarla y mantenerla a mano!\n\nwww.vipcargas.com'
    }
  ];
  for (const cmd of systemCmds) {
    await Command.findOneAndUpdate(
      { name: cmd.name },
      {
        $set: { isSystem: true },
        $setOnInsert: {
          name: cmd.name,
          description: cmd.description,
          type: cmd.type,
          response: cmd.response,
          isActive: true,
          usageCount: 0
        }
      },
      { upsert: true }
    );
  }
  console.log('✅ Comandos de sistema verificados');

  console.log('✅ Datos inicializados correctamente');
}

// ============================================
// ENDPOINTS DE MOVIMIENTOS (DEPÓSITOS/RETIROS)
// ============================================

app.post('/api/movements/deposit', authMiddleware, async (req, res) => {
  try {
    const { amount } = req.body;
    const username = req.user.username;
    
    if (!amount || amount < 100) {
      return res.status(400).json({ error: 'Monto mínimo $100' });
    }
    
    const result = await jugaygana.depositToUser(
      username, 
      amount, 
      `Depósito desde Sala de Juegos - ${new Date().toLocaleString('es-AR')}`
    );
    
    if (result.success) {
      await recordUserActivity(req.user.userId, 'deposit', amount);
      
      res.json({
        success: true,
        message: `Depósito de $${amount} realizado correctamente`,
        newBalance: result.data?.user_balance_after,
        transactionId: result.data?.transfer_id || result.data?.transferId
      });
    } else {
      res.status(400).json({ error: result.error || 'Error al realizar depósito' });
    }
  } catch (error) {
    console.error('Error en depósito:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.post('/api/movements/withdraw', authMiddleware, async (req, res) => {
  try {
    const { amount } = req.body;
    const username = req.user.username;
    
    if (!amount || amount < 100) {
      return res.status(400).json({ error: 'Monto mínimo $100' });
    }
    
    const result = await jugaygana.withdrawFromUser(
      username, 
      amount, 
      `Retiro desde Sala de Juegos - ${new Date().toLocaleString('es-AR')}`
    );
    
    if (result.success) {
      await recordUserActivity(req.user.userId, 'withdrawal', amount);
      
      res.json({
        success: true,
        message: `Retiro de $${amount} realizado correctamente`,
        newBalance: result.data?.user_balance_after,
        transactionId: result.data?.transfer_id || result.data?.transferId
      });
    } else {
      res.status(400).json({ error: result.error || 'Error al realizar retiro' });
    }
  } catch (error) {
    console.error('Error en retiro:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.get('/api/movements/balance', authMiddleware, async (req, res) => {
  try {
    const username = req.user.username;
    const result = await jugayganaMovements.getUserBalance(username);
    
    if (result.success) {
      res.json({ balance: result.balance });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (error) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================
// SISTEMA DE FUEGUITO (RACHA DIARIA)
// ============================================

// Helper: obtener total de depósitos del usuario en los últimos N días
const getDepositsInPeriod = async (username, daysBack) => {
  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
  try {
    const result = await Transaction.aggregate([
      { $match: { username, type: 'deposit', createdAt: { $gte: since } } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    return result[0]?.total || 0;
  } catch (err) {
    logger.error(`Error calculando depósitos de ${username}: ${err.message}`);
    return 0;
  }
};

// Mínimo de depósitos mensuales para acceder al Fueguito diario
// Hitos/milestones del Fueguito
// requireDeposits > 0 marca que la RECOMPENSA (no el reclamo diario) requiere actividad del mes
const FIRE_MILESTONES = [
  { day: 10, reward: 10000,  type: 'cash',           requireDeposits: 20000,  depositDays: 30, desc: 'Recompensa Fueguito 10 días' },
  { day: 15, reward: 0,      type: 'next_load_bonus', requireDeposits: 20000,  depositDays: 30, desc: '100% en próxima carga' },
  { day: 20, reward: 50000,  type: 'cash',           requireDeposits: 100000, depositDays: 30, desc: 'Recompensa Fueguito 20 días' },
  { day: 30, reward: 200000, type: 'cash',           requireDeposits: 300000, depositDays: 45, desc: 'Recompensa Fueguito 30 días' }
];

app.get('/api/fire/status', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    let fireStreak = await FireStreak.findOne({ userId }).lean();
    
    if (!fireStreak) {
      fireStreak = { streak: 0, lastClaim: null, totalClaimed: 0 };
    }
    
    const todayArgentina = getArgentinaDateString();
    const lastClaim = fireStreak.lastClaim ? getArgentinaDateString(new Date(fireStreak.lastClaim)) : null;
    
    const canClaim = lastClaim !== todayArgentina;
    
    const yesterdayArgentina = getArgentinaYesterday();
    
    if (lastClaim !== yesterdayArgentina && lastClaim !== todayArgentina && fireStreak.streak > 0) {
      await FireStreak.updateOne(
        { userId },
        { streak: 0, lastReset: new Date() },
        { upsert: true }
      );
      fireStreak.streak = 0;
    }

    const currentStreak = fireStreak.streak || 0;

    // Auto-expirar recompensa pendiente si no fue reclamada el mismo día (req 1)
    let pendingCashReward = fireStreak.pendingCashReward || 0;
    let pendingCashRewardDay = fireStreak.pendingCashRewardDay || 0;
    let pendingCashRewardDesc = fireStreak.pendingCashRewardDesc || '';
    if (pendingCashReward > 0) {
      const rewardDate = fireStreak.pendingCashRewardDate || '';
      if (rewardDate !== todayArgentina) {
        // La recompensa expiró — limpiarla silenciosamente
        await FireStreak.updateOne(
          { userId },
          { pendingCashReward: 0, pendingCashRewardDay: 0, pendingCashRewardDesc: '', pendingCashRewardDate: '' }
        );
        pendingCashReward = 0;
        pendingCashRewardDay = 0;
        pendingCashRewardDesc = '';
      }
    }

    // Construir lista de milestones con estado para la UI
    const milestones = FIRE_MILESTONES.map(m => {
      let status;
      if (currentStreak >= m.day) {
        status = 'completed';
      } else if (currentStreak === m.day - 1) {
        status = 'next';
      } else {
        status = 'locked';
      }
      return {
        day: m.day,
        type: m.type,
        reward: m.type === 'cash' ? m.reward : null,
        hasDepositRequirement: m.requireDeposits > 0,
        status
      };
    });
    
    res.json({
      streak: currentStreak,
      lastClaim: fireStreak.lastClaim,
      totalClaimed: fireStreak.totalClaimed || 0,
      canClaim,
      pendingNextLoadBonus: fireStreak.pendingNextLoadBonus || false,
      pendingCashReward,
      pendingCashRewardDay,
      pendingCashRewardDesc,
      milestones,
      nextReward: currentStreak >= 9 ? 10000 : 0
    });
  } catch (error) {
    console.error('Error obteniendo estado del fueguito:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.post('/api/fire/claim', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const username = req.user.username;
    
    let fireStreak = await FireStreak.findOne({ userId });
    
    if (!fireStreak) {
      fireStreak = new FireStreak({ userId, username, streak: 0, totalClaimed: 0 });
    }
    
    const todayArgentina = getArgentinaDateString();
    const lastClaim = fireStreak.lastClaim ? getArgentinaDateString(new Date(fireStreak.lastClaim)) : null;
    
    if (lastClaim === todayArgentina) {
      return res.status(400).json({ error: 'Ya reclamaste tu fueguito hoy' });
    }

    // Req 5: El reclamo diario del Fueguito no requiere actividad del mes.
    // Solo las recompensas de hitos verifican requisitos (en /api/fire/claim-reward).
    
    const yesterdayArgentina = getArgentinaYesterday();
    
    if (lastClaim !== yesterdayArgentina && fireStreak.streak > 0) {
      fireStreak.streak = 0;
      fireStreak.lastReset = new Date();
    }
    
    fireStreak.streak += 1;
    fireStreak.lastClaim = new Date();
    
    let reward = 0;
    let rewardType = 'none';
    let message = `¡Día ${fireStreak.streak} de racha! Seguí así 🔥`;

    // Determinar si se alcanza un hito
    const milestone = FIRE_MILESTONES.find(m => m.day === fireStreak.streak);
    if (milestone) {
      if (milestone.type === 'next_load_bonus') {
        // Día 15: 100% en próxima carga (se marca como pendiente para operador)
        rewardType = 'next_load_bonus';
        fireStreak.pendingNextLoadBonus = true;
        message = '🎉 ¡15 días de racha! Tenés 100% en tu próxima carga. Un operador te lo aplicará cuando quieras reclamar.';
      } else if (milestone.type === 'cash') {
        // Req 6: Siempre setear la recompensa como pendiente, sin verificar depósitos aquí.
        // La verificación de actividad ocurre al reclamar la recompensa (/api/fire/claim-reward).
        // Solo setear si no hay ya una recompensa pendiente vigente del mismo día para no sobreescribir.
        const existingDate = fireStreak.pendingCashRewardDate || '';
        if (!fireStreak.pendingCashReward || existingDate !== todayArgentina) {
          rewardType = 'cash_pending';
          reward = milestone.reward;
          fireStreak.pendingCashReward = milestone.reward;
          fireStreak.pendingCashRewardDay = fireStreak.streak;
          fireStreak.pendingCashRewardDesc = milestone.desc;
          // Req 1: Guardar la fecha Argentina en que se desbloqueó para auto-expirar al día siguiente
          fireStreak.pendingCashRewardDate = todayArgentina;
          message = `🔥 ¡${fireStreak.streak} días de racha! Tenés una recompensa de $${milestone.reward.toLocaleString()} para reclamar en el recuadro de Fueguito.`;
        } else {
          // Ya hay una recompensa pendiente del mismo día: no sobreescribir
          rewardType = 'cash_pending';
          reward = fireStreak.pendingCashReward;
          message = `🔥 ¡${fireStreak.streak} días de racha! Tenés una recompensa de $${fireStreak.pendingCashReward.toLocaleString()} para reclamar en el recuadro de Fueguito.`;
        }
      }
    }
    
    fireStreak.history = fireStreak.history || [];
    fireStreak.history.push({
      date: new Date(),
      reward: rewardType === 'cash_pending' ? reward : 0,
      streakDay: fireStreak.streak
    });
    
    await fireStreak.save();
    
    res.json({
      success: true,
      streak: fireStreak.streak,
      reward: rewardType === 'cash_pending' ? reward : 0,
      rewardType,
      message,
      totalClaimed: fireStreak.totalClaimed,
      pendingNextLoadBonus: fireStreak.pendingNextLoadBonus || false,
      pendingCashReward: fireStreak.pendingCashReward || 0,
      pendingCashRewardDay: fireStreak.pendingCashRewardDay || 0
    });
  } catch (error) {
    console.error('Error reclamando fueguito:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Reclamar recompensa pendiente de Fueguito (efectivo)
app.post('/api/fire/claim-reward', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const username = req.user.username;

    const fireStreak = await FireStreak.findOne({ userId });
    if (!fireStreak || !fireStreak.pendingCashReward || fireStreak.pendingCashReward <= 0) {
      return res.status(400).json({ error: 'No hay recompensa pendiente para reclamar.' });
    }

    // Req 1: Verificar que la recompensa no expiró (solo reclamable el mismo día)
    const todayArg = getArgentinaDateString();
    const rewardDateStr = fireStreak.pendingCashRewardDate || '';
    if (rewardDateStr && rewardDateStr !== todayArg) {
      // Limpiar recompensa expirada
      fireStreak.pendingCashReward = 0;
      fireStreak.pendingCashRewardDay = 0;
      fireStreak.pendingCashRewardDesc = '';
      fireStreak.pendingCashRewardDate = '';
      await fireStreak.save();
      return res.status(400).json({ error: 'La recompensa expiró. Solo podés reclamarla el mismo día que llegaste al hito.' });
    }

    // Req 6: Verificar requisitos de actividad para este hito específico
    const rewardDay = fireStreak.pendingCashRewardDay || 0;
    const milestone = FIRE_MILESTONES.find(m => m.day === rewardDay);
    if (milestone && milestone.requireDeposits > 0) {
      const daysBack = milestone.depositDays || 30;
      const deposits = await getDepositsInPeriod(username, daysBack);
      if (deposits < milestone.requireDeposits) {
        return res.status(400).json({
          error: `No cumplís los requisitos para esta recompensa. Se requiere actividad de cargas del mes (mínimo $${milestone.requireDeposits.toLocaleString('es-AR')}).`,
          requirementNotMet: true
        });
      }
    }

    const rewardAmount = fireStreak.pendingCashReward;
    const rewardDesc = fireStreak.pendingCashRewardDesc || `Recompensa Fueguito día ${fireStreak.pendingCashRewardDay}`;

    const serializeErrorPart = (value) => {
      if (typeof value === 'string') return value;
      if (value instanceof Error) {
        return JSON.stringify({ name: value.name, message: value.message, stack: value.stack });
      }
      try { return JSON.stringify(value); } catch { return String(value); }
    };

    const bonusResult = await jugayganaMovements.makeBonus(username, rewardAmount, rewardDesc + ' - Sala de Juegos');
    
    if (!bonusResult.success) {
      const creditError = typeof bonusResult.error === 'string'
        ? bonusResult.error
        : (bonusResult.error?.message || bonusResult.error?.error || bonusResult.error?.details || JSON.stringify(bonusResult.error) || 'Error al acreditar recompensa');
      logger.error(
        `[FIRE_REWARD] claim-reward failed userId=${userId} username=${username} ` +
        `bonusResult=${serializeErrorPart(bonusResult)} bonusError=${serializeErrorPart(bonusResult?.error)}`
      );
      return res.status(400).json({ error: 'Error al acreditar recompensa: ' + creditError });
    }

    // Limpiar pending reward y sumar al total
    fireStreak.totalClaimed = (fireStreak.totalClaimed || 0) + rewardAmount;
    fireStreak.pendingCashReward = 0;
    fireStreak.pendingCashRewardDay = 0;
    fireStreak.pendingCashRewardDesc = '';
    fireStreak.pendingCashRewardDate = '';
    await fireStreak.save();

    try {
      await Transaction.create({
        id: uuidv4(),
        type: 'fire_reward',
        userId,
        username,
        amount: rewardAmount,
        description: `Fueguito - ${rewardDesc}`,
        timestamp: new Date()
      });
    } catch (txErr) {
      logger.error(`[FIRE_REWARD] Error al guardar transacción userId=${userId} username=${username}: ${txErr.message}`);
    }

    logger.info(`[FIRE_REWARD] claim-reward OK userId=${userId} username=${username} amount=${rewardAmount}`);

    res.json({
      success: true,
      reward: rewardAmount,
      message: `🎉 ¡$${rewardAmount.toLocaleString()} acreditados en tu cuenta!`
    });
  } catch (error) {
    console.error('Error reclamando recompensa Fueguito:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================
// CONFIGURACIÓN DEL SISTEMA (CBU, COMANDOS)
// ============================================

app.get('/api/admin/config', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const cbuConfig = await getConfig('cbu');
    const welcomeMessage = await getConfig('welcomeMessage');
    const depositMessage = await getConfig('depositMessage');
    const canalInformativoUrl = await getConfig('canalInformativoUrl', '');
    
    res.json({
      cbu: cbuConfig || {},
      welcomeMessage: welcomeMessage || '🎉 ¡Bienvenido a la Sala de Juegos!',
      depositMessage: depositMessage || '💰 ¡Fichas cargadas!',
      canalInformativoUrl: canalInformativoUrl || ''
    });
  } catch (error) {
    console.error('Error obteniendo configuración:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.post('/api/admin/canal-url', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { url } = req.body;
    const safeUrl = (url || '').trim();
    if (safeUrl) {
      try {
        const parsed = new URL(safeUrl);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          return res.status(400).json({ error: 'URL inválida. Debe comenzar con http:// o https://' });
        }
      } catch {
        return res.status(400).json({ error: 'URL inválida. Verificá que sea una URL completa y válida.' });
      }
    }
    await setConfig('canalInformativoUrl', safeUrl);
    res.json({ success: true, message: 'URL del Canal Informativo actualizada correctamente' });
  } catch (error) {
    console.error('Error guardando canal URL:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.put('/api/admin/config/cbu', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    // Solo el admin principal puede cambiar el CBU. Un depositor/withdrawer comprometido
    // podria redirigir los depositos de los usuarios a su propia cuenta bancaria.
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Solo el administrador principal puede modificar el CBU' });
    }

    const currentCbu = await getConfig('cbu') || {};
    // Whitelist de campos permitidos para evitar inyeccion de propiedades inesperadas.
    const allowed = {};
    if (typeof req.body.bank === 'string') allowed.bank = req.body.bank.trim();
    if (typeof req.body.titular === 'string') allowed.titular = req.body.titular.trim();
    if (typeof req.body.number === 'string') allowed.number = req.body.number.trim();
    if (typeof req.body.alias === 'string') allowed.alias = req.body.alias.trim();

    if (allowed.number !== undefined && allowed.number.length > 0 && allowed.number.length < 10) {
      return res.status(400).json({ error: 'CBU invalido (minimo 10 caracteres)' });
    }

    const newCbu = { ...currentCbu, ...allowed };
    await setConfig('cbu', newCbu);

    logger.info(`Admin ${req.user.username} updated CBU config`);
    res.json({ success: true, message: 'CBU actualizado', cbu: newCbu });
  } catch (error) {
    console.error('Error actualizando CBU:', error);
    res.status(500).json({ error: 'Error actualizando CBU' });
  }
});

// ============================================
// LÍNEAS POR USUARIO (mapeo prefijo → teléfono)
// Se muestran al usuario en la pantalla de reembolsos.
// 10 slots configurables + un teléfono default si ninguno matchea.
// ============================================
const USER_LINES_MAX_SLOTS = 30;

app.get('/api/admin/user-lines', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const config = (await getConfig('userLinesByPrefix')) || {};
    const slots = Array.isArray(config.slots) ? config.slots : [];
    // Devolvemos solo los slots con datos (no padding); el frontend agrega
    // un botón "+ Agregar línea" para sumar más, hasta USER_LINES_MAX_SLOTS.
    // teamName es opcional — se muestra arriba a la izquierda en el header
    // del usuario cuando el prefijo matchea (ej: 'ato' -> 'Atomic').
    const cleaned = slots
      .filter(s => s && (s.prefix || s.phone || s.teamName))
      .map(s => ({
        prefix: s.prefix || '',
        phone: s.phone || '',
        teamName: s.teamName || ''
      }));
    res.json({
      slots: cleaned,
      defaultPhone: config.defaultPhone || '',
      defaultTeamName: config.defaultTeamName || '',
      maxSlots: USER_LINES_MAX_SLOTS
    });
  } catch (error) {
    console.error('Error obteniendo user-lines:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.put('/api/admin/user-lines', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { slots, defaultPhone, defaultTeamName } = req.body || {};
    if (!Array.isArray(slots)) {
      return res.status(400).json({ error: 'slots debe ser un array' });
    }
    if (slots.length > USER_LINES_MAX_SLOTS) {
      return res.status(400).json({ error: `Máximo ${USER_LINES_MAX_SLOTS} slots` });
    }
    const cleaned = [];
    for (const s of slots) {
      const prefix = (s && s.prefix ? String(s.prefix) : '').trim();
      const phone = (s && s.phone ? String(s.phone) : '').trim();
      const teamName = (s && s.teamName ? String(s.teamName) : '').trim();
      if (!prefix && !phone && !teamName) continue;
      if (prefix && !phone) {
        return res.status(400).json({ error: `El prefijo "${prefix}" no tiene número` });
      }
      // teamName es opcional (no es obligatorio aunque haya prefijo).
      // Cap visual razonable para que no rompa el layout del header del user.
      if (teamName.length > 24) {
        return res.status(400).json({ error: `El nombre de equipo "${teamName.slice(0,30)}…" es demasiado largo (máx 24)` });
      }
      cleaned.push({ prefix, phone, teamName });
    }
    const newDefaultPhone = (defaultPhone ? String(defaultPhone) : '').trim();
    const newDefaultTeamName = (defaultTeamName ? String(defaultTeamName) : '').trim();
    if (newDefaultTeamName.length > 24) {
      return res.status(400).json({ error: 'El nombre de equipo por defecto es demasiado largo (máx 24)' });
    }

    const value = {
      slots: cleaned,
      defaultPhone: newDefaultPhone,
      defaultTeamName: newDefaultTeamName
    };
    await setConfig('userLinesByPrefix', value);
    res.json({ success: true, message: 'Líneas actualizadas', value });
    // Auto-notificación al cambiar línea desactivada por requerimiento del cliente.
    // El usuario igualmente verá el banner rojo de "cambio de línea" cuando entre
    // a la app (la detección es del lado del frontend comparando el último número
    // visto en localStorage contra el actual).
  } catch (error) {
    console.error('Error actualizando user-lines:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================
// IMPORT DE LÍNEAS DESDE DRIVE / .XLSX
// Permite asignar masivamente usuarios a líneas específicas subiendo un .xlsx
// exportado desde Google Sheets. Cada hoja del archivo representa una línea:
//   - Nombre de la hoja = teléfono de esa línea (ej: "+5491111...")
//   - Primera fila (header "name") se ignora
//   - Filas restantes = usernames que pertenecen a esa línea
// El parámetro `teamName` (query string) se aplica a todas las hojas del archivo.
// `dryRun=true` (default) no escribe nada — solo devuelve un reporte para preview.
// ============================================
const USER_LINES_IMPORT_LIMIT = '15mb'; // ~15 hojas × 3000 filas, holgado.

app.post(
  '/api/admin/user-lines/import',
  authMiddleware,
  adminMiddleware,
  express.raw({ limit: USER_LINES_IMPORT_LIMIT, type: '*/*' }),
  async (req, res) => {
    // Lazy require — si xlsx no está instalado, devolvemos error claro
    // (admin debe correr `npm install` después del deploy con este feature).
    let XLSX;
    try {
      XLSX = require('xlsx');
    } catch (e) {
      return res.status(503).json({
        error: 'Falta instalar la dependencia "xlsx" en el servidor. Ejecutá: npm install xlsx'
      });
    }

    try {
      const teamName = (req.query.teamName ? String(req.query.teamName) : '').trim();
      if (!teamName) {
        return res.status(400).json({ error: 'Falta el parámetro teamName (nombre del equipo)' });
      }
      if (teamName.length > 24) {
        return res.status(400).json({ error: 'El nombre del equipo es demasiado largo (máx 24)' });
      }

      // Prefijo de username del equipo (ej: "ato", "argen", "tiger"). El sistema
      // concatena prefix + valor de celda para reconstruir el username completo
      // antes de matchear contra la DB. Si la celda ya empieza con el prefix,
      // se usa la celda tal cual (modo tolerante).
      const prefix = (req.query.prefix ? String(req.query.prefix) : '').trim().toLowerCase();
      if (!prefix) {
        return res.status(400).json({ error: 'Falta el parámetro prefix (las "iniciales" del equipo, ej: ato, argen, tiger)' });
      }
      if (prefix.length > 20) {
        return res.status(400).json({ error: 'El prefijo es demasiado largo (máx 20)' });
      }

      // Línea explícita (modo "import per-slot"). Si viene, TODAS las hojas
      // del archivo se asignan a este teléfono — los nombres de las hojas se
      // ignoran. Esto permite que el admin suba un .xlsx desde el slot del
      // panel "Números vigentes" y la línea sea la del slot, no parseada de
      // la hoja. Si no viene, se usa el comportamiento legacy (parsear cada
      // sheet name como teléfono).
      const overrideLinePhone = (req.query.linePhone ? String(req.query.linePhone) : '').trim();

      // dryRun por default true. Solo `dryRun=false` ejecuta escrituras.
      const dryRun = String(req.query.dryRun || 'true').toLowerCase() !== 'false';

      const buf = req.body;
      if (!buf || !Buffer.isBuffer(buf) || buf.length < 100) {
        return res.status(400).json({ error: 'Archivo vacío o muy chico' });
      }

      let workbook;
      try {
        workbook = XLSX.read(buf, { type: 'buffer', cellDates: false });
      } catch (parseErr) {
        return res.status(400).json({ error: `No se pudo leer el .xlsx: ${parseErr.message}` });
      }

      if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
        return res.status(400).json({ error: 'El archivo no tiene hojas' });
      }

      // Extrae el teléfono del nombre de la hoja. El nombre puede venir como
      // un teléfono puro (ej: "+5491111...") o como "ETIQUETA + número" (ej:
      // "TIGER 1 39095913748", "Atomic 2 +5493853..."). Devolvemos siempre
      // un string que arranque con '+' y tenga solo dígitos (formato canónico
      // para WhatsApp links). Si no se puede extraer, devuelve el sheetName
      // sin cambios como fallback (legacy).
      const _extractPhoneFromSheetName = (raw) => {
        const trimmed = String(raw || '').trim();
        if (!trimmed) return '';
        // Buscar la última secuencia de 7+ dígitos (con + opcional al inicio)
        // al final del string. \d{7,} cubre cualquier teléfono internacional.
        const m = trimmed.match(/(\+?\d[\d\s\-]{6,})\s*$/);
        if (m) {
          // Limpiar todo lo que no sea dígito y reagregar el +
          const digits = m[1].replace(/[^\d]/g, '');
          if (digits.length >= 7) return '+' + digits;
        }
        return trimmed;
      };

      // -------- Pase 1: extraer (sheetName -> [usernames]) y detectar conflictos
      // dentro del mismo archivo (mismo username en dos hojas distintas).
      const sheetData = []; // [{ sheetName, linePhone, usernamesLower: [] }]
      const seenLowerToSheet = new Map(); // lower -> first sheetName que lo trajo
      const conflictsInFile = []; // [{ username, sheets: [a, b] }]
      const allUsernamesLower = new Set();

      for (const sheetName of workbook.SheetNames) {
        const sheetTrimmed = String(sheetName || '').trim();
        if (!sheetTrimmed) continue;
        // Si vino linePhone explícito (modo per-slot), todas las hojas usan ese.
        // Si no, parseamos el nombre de la hoja (modo legacy multi-line file).
        const linePhone = overrideLinePhone || _extractPhoneFromSheetName(sheetTrimmed);
        if (!linePhone) continue;

        const ws = workbook.Sheets[sheetName];
        if (!ws) continue;

        // header:1 → array de arrays. blankrows:false → omite filas vacías.
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' });

        // Saltar la primera fila (header "name"). Si el sheet está vacío o solo
        // tiene header, queda como hoja sin matches (no error — se reporta).
        const dataRows = rows.length > 1 ? rows.slice(1) : [];

        const usernamesLower = [];
        for (const row of dataRows) {
          if (!row) continue;
          const raw = row[0];
          if (raw === null || raw === undefined) continue;
          const cleaned = String(raw).trim();
          if (!cleaned) continue;
          const cellLower = cleaned.toLowerCase();

          // Reconstruir el username completo:
          //   - Si la celda ya empieza con el prefijo, se usa tal cual.
          //   - Si no, le concatenamos el prefijo (la celda es solo el sufijo).
          // Ejemplo: prefix='ato', celda='joaquin398' → 'atojoaquin398'.
          //          prefix='ato', celda='atojoaquin398' → 'atojoaquin398'.
          const lower = cellLower.startsWith(prefix) ? cellLower : (prefix + cellLower);

          // Detectar conflicto entre hojas del mismo upload.
          // En modo per-slot (overrideLinePhone), todas las hojas asignan al mismo
          // teléfono — los duplicados no son conflictos, simplemente se deduplican.
          if (seenLowerToSheet.has(lower) && seenLowerToSheet.get(lower) !== sheetName) {
            if (!overrideLinePhone) {
              conflictsInFile.push({
                username: lower,
                sheets: [seenLowerToSheet.get(lower), sheetName]
              });
              // El conflicto invalida ambas asignaciones (modo legacy multi-line).
              continue;
            }
            // En modo per-slot, simplemente saltear el duplicado (ya está asignado).
            continue;
          }
          seenLowerToSheet.set(lower, sheetName);
          usernamesLower.push(lower);
          allUsernamesLower.add(lower);
        }

        sheetData.push({ sheetName, linePhone, usernamesLower });
      }

      // -------- Pase 2: lookup masivo en la DB (un solo query con $in + collation
      // para case-insensitive). Para 3000 usernames es un IXSCAN/COLLSCAN rápido.
      const allUsernamesArr = [...allUsernamesLower];
      let docs = [];
      if (allUsernamesArr.length > 0) {
        docs = await User.find({ username: { $in: allUsernamesArr } })
          .collation({ locale: 'en', strength: 2 })
          .select('id username linePhone lineTeamName')
          .lean();
      }

      const docByLower = new Map();
      for (const d of docs) {
        if (d && d.username) docByLower.set(d.username.toLowerCase(), d);
      }

      // -------- Pase 3: armar bulkOps y reporte por hoja.
      const bulkOps = [];
      const sheetReports = [];
      let totalMatched = 0;
      let totalNotFound = 0;
      const notFoundSample = []; // sólo guardamos los primeros 100 para no inflar la respuesta

      const now = new Date();
      const adminUsername = (req.user && req.user.username) || null;

      for (const sd of sheetData) {
        let sheetMatched = 0;
        let sheetNotFound = 0;
        let sheetReassigned = 0; // ya tenían linePhone distinto → se sobreescribe

        for (const lower of sd.usernamesLower) {
          const doc = docByLower.get(lower);
          if (!doc) {
            sheetNotFound++;
            totalNotFound++;
            if (notFoundSample.length < 100) {
              notFoundSample.push({ username: lower, sheet: sd.sheetName });
            }
            continue;
          }

          sheetMatched++;
          totalMatched++;
          if (doc.linePhone && doc.linePhone !== sd.linePhone) {
            sheetReassigned++;
          }

          if (!dryRun) {
            bulkOps.push({
              updateOne: {
                filter: { id: doc.id },
                update: {
                  $set: {
                    linePhone: sd.linePhone,
                    lineTeamName: teamName,
                    lineAssignedAt: now,
                    lineAssignedBy: adminUsername
                  }
                }
              }
            });
          }
        }

        sheetReports.push({
          sheetName: sd.sheetName,
          linePhone: sd.linePhone,
          totalRows: sd.usernamesLower.length,
          matched: sheetMatched,
          notFound: sheetNotFound,
          reassigned: sheetReassigned
        });
      }

      // -------- Escritura (solo si dryRun=false)
      let writeResult = null;
      if (!dryRun && bulkOps.length > 0) {
        try {
          const r = await User.bulkWrite(bulkOps, { ordered: false });
          writeResult = {
            modifiedCount: r.modifiedCount || 0,
            matchedCount: r.matchedCount || 0
          };
        } catch (bulkErr) {
          logger.error(`[user-lines/import] bulkWrite error: ${bulkErr.message}`);
          return res.status(500).json({ error: `Error escribiendo en la DB: ${bulkErr.message}` });
        }
      }

      logger.info(`[user-lines/import] team=${teamName} prefix=${prefix} dryRun=${dryRun} sheets=${sheetReports.length} matched=${totalMatched} notFound=${totalNotFound} conflicts=${conflictsInFile.length} by=${adminUsername}`);

      res.json({
        success: true,
        dryRun,
        teamName,
        prefix,
        summary: {
          totalSheets: sheetReports.length,
          totalRows: totalMatched + totalNotFound,
          matched: totalMatched,
          notFound: totalNotFound,
          conflicts: conflictsInFile.length
        },
        sheets: sheetReports,
        conflicts: conflictsInFile.slice(0, 100),
        notFoundSample,
        writeResult
      });
    } catch (error) {
      logger.error(`[user-lines/import] error: ${error.message}\n${error.stack}`);
      res.status(500).json({ error: `Error del servidor: ${error.message}` });
    }
  }
);

// Endpoint para limpiar la asignación de línea de TODOS los usuarios de un team
// (vuelve a usar el matcher por prefijo). Útil si se cargó un Drive equivocado.
app.post('/api/admin/user-lines/clear-team', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { teamName } = req.body || {};
    if (!teamName || typeof teamName !== 'string' || !teamName.trim()) {
      return res.status(400).json({ error: 'Falta teamName' });
    }
    const cleanTeam = teamName.trim();
    const r = await User.updateMany(
      { lineTeamName: cleanTeam },
      { $set: { linePhone: null, lineTeamName: null, lineAssignedAt: null, lineAssignedBy: null } }
    );
    res.json({
      success: true,
      teamName: cleanTeam,
      cleared: r.modifiedCount || 0
    });
  } catch (error) {
    logger.error(`[user-lines/clear-team] error: ${error.message}`);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Stats de asignaciones de línea (para mostrar resumen en el panel admin).
app.get('/api/admin/user-lines/stats', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const pipeline = [
      { $match: { linePhone: { $ne: null, $exists: true } } },
      {
        $group: {
          _id: { teamName: '$lineTeamName', linePhone: '$linePhone' },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.teamName': 1, '_id.linePhone': 1 } }
    ];
    const groups = await User.aggregate(pipeline);
    const totalAssigned = groups.reduce((acc, g) => acc + (g.count || 0), 0);
    const totalUsers = await User.countDocuments({});
    res.json({
      totalUsers,
      totalAssigned,
      totalUnassigned: totalUsers - totalAssigned,
      lines: groups.map(g => ({
        teamName: g._id.teamName || '(sin team)',
        linePhone: g._id.linePhone,
        count: g.count
      }))
    });
  } catch (error) {
    logger.error(`[user-lines/stats] error: ${error.message}`);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================
// LINKS DE COMUNIDAD POR USUARIO (mapeo prefijo -> link)
// Mismo patron que user-lines pero para links de WhatsApp/comunidades.
// ============================================
const USER_COMMUNITIES_MAX_SLOTS = 30;

app.get('/api/admin/user-communities', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const config = (await getConfig('userCommunitiesByPrefix')) || {};
    const slots = Array.isArray(config.slots) ? config.slots : [];
    const cleaned = slots
      .filter(s => s && (s.prefix || s.link))
      .map(s => ({ prefix: s.prefix || '', link: s.link || '' }));
    res.json({
      slots: cleaned,
      defaultLink: config.defaultLink || '',
      maxSlots: USER_COMMUNITIES_MAX_SLOTS
    });
  } catch (error) {
    console.error('Error obteniendo user-communities:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.put('/api/admin/user-communities', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { slots, defaultLink } = req.body || {};
    if (!Array.isArray(slots)) {
      return res.status(400).json({ error: 'slots debe ser un array' });
    }
    if (slots.length > USER_COMMUNITIES_MAX_SLOTS) {
      return res.status(400).json({ error: `Máximo ${USER_COMMUNITIES_MAX_SLOTS} slots` });
    }
    const cleaned = [];
    for (const s of slots) {
      const prefix = (s && s.prefix ? String(s.prefix) : '').trim();
      const link = (s && s.link ? String(s.link) : '').trim();
      if (!prefix && !link) continue;
      if (prefix && !link) {
        return res.status(400).json({ error: `El prefijo "${prefix}" no tiene link` });
      }
      // Validacion minima: que sea http(s) o wa.me/chat link
      if (link && !/^https?:\/\//i.test(link)) {
        return res.status(400).json({ error: `El link "${link}" debe empezar con http:// o https://` });
      }
      cleaned.push({ prefix, link });
    }
    const newDefaultLink = (defaultLink ? String(defaultLink) : '').trim();
    if (newDefaultLink && !/^https?:\/\//i.test(newDefaultLink)) {
      return res.status(400).json({ error: 'El link por defecto debe empezar con http:// o https://' });
    }

    const value = {
      slots: cleaned,
      defaultLink: newDefaultLink
    };
    await setConfig('userCommunitiesByPrefix', value);
    res.json({ success: true, message: 'Links de comunidad actualizados', value });
  } catch (error) {
    console.error('Error actualizando user-communities:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================
// BONO DE BIENVENIDA — $10.000 one-time por usuario
// Requisitos client-side: PWA instalada + notificaciones activas. El backend
// NO los puede verificar (son flags del navegador), confia en que el flujo
// del cliente solo dispara la request cuando ambos estan OK. La proteccion
// real contra doble cobro es el indice unique de RefundClaim.
// ============================================
const WELCOME_BONUS_AMOUNT = 10000;

// Caps de seguridad para el money giveaway. Si el admin (o un atacante con
// la cookie) crea un giveaway con cifras absurdas (typo de un 0 de mas, o
// drain malicioso) estos topes lo frenan en el endpoint POST. Si el negocio
// realmente necesita superar estos limites hay que tocar el codigo a
// proposito — un click accidental no puede vaciar JUGAYGANA.
const GIVEAWAY_MAX_AMOUNT_PER_USER = 50000;     // 5x el welcome bonus
const GIVEAWAY_MAX_TOTAL_BUDGET    = 5000000;   // $5M por giveaway
const GIVEAWAY_MAX_CLAIMS          = 1000;      // 1000 personas por giveaway

app.get('/api/refunds/welcome/status', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const username = req.user.username;
    const claim = await RefundClaim.findOne({
      type: 'welcome_install',
      $or: [{ userId }, { username }]
    }).lean();
    res.json({
      amount: WELCOME_BONUS_AMOUNT,
      claimed: !!claim,
      claimedAt: claim?.claimedAt || null,
      status: claim?.status || null
    });
  } catch (error) {
    logger.error(`/api/refunds/welcome/status error: ${error.message}`);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.post('/api/refunds/claim/welcome', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const username = req.user.username;

    if (!await acquireRefundLock(userId, 'welcome_install')) {
      return res.json({
        success: false,
        message: '⏳ Ya estás procesando el bono. Por favor espera...',
        processing: true
      });
    }

    try {
      const periodKey = computePeriodKey('welcome_install');

      // Pre-check rapido por userId O username. Sin filtrar por periodKey:
      // el bono es one-time absoluto, cualquier claim previo del tipo
      // 'welcome_install' bloquea para siempre, sin importar que en algun
      // momento se haya cambiado la convencion de periodKey.
      const existing = await RefundClaim.findOne({
        type: 'welcome_install',
        $or: [{ userId }, { username }]
      }).lean();
      if (existing) {
        logger.warn(`[BONUS] welcome — pre-check rechazo por claim existente para ${username}`);
        return res.json({
          success: false,
          message: 'Ya reclamaste tu bono de bienvenida.',
          canClaim: false,
          claimed: true
        });
      }

      let claim;
      try {
        claim = await RefundClaim.create({
          id: uuidv4(),
          userId,
          username,
          type: 'welcome_install',
          amount: WELCOME_BONUS_AMOUNT,
          netAmount: 0,
          percentage: 0,
          period: 'Bono de bienvenida',
          periodKey,
          claimedAt: new Date()
        });
      } catch (e) {
        if (e && e.code === 11000) {
          logger.warn(`[BONUS] welcome — duplicado bloqueado por indice unique para ${username} (key: ${JSON.stringify(e.keyValue || e.keyPattern || {})})`);
          return res.json({
            success: false,
            message: 'Ya reclamaste tu bono de bienvenida.',
            canClaim: false,
            claimed: true
          });
        }
        throw e;
      }

      const depositResult = await jugaygana.creditUserBalance(username, WELCOME_BONUS_AMOUNT);

      if (!depositResult.success) {
        // Mismo criterio que reembolsos: NO eliminar, marcar pending.
        try {
          claim.status = 'pending_credit_failed';
          claim.creditError = String(depositResult.error || 'Error desconocido').slice(0, 500);
          await claim.save();
        } catch (e) {
          logger.error(`[BONUS] no se pudo persistir pending_credit_failed para claim ${claim._id}: ${e.message}`);
        }
        logger.error(`[BONUS] welcome credit fallo para ${username}: ${depositResult.error} - claim ${claim._id} marcado pending_credit_failed`);
        return res.json({
          success: false,
          message: 'Hubo un problema al acreditar tu bono. El administrador lo está revisando — no reintentes, podés contactarte por WhatsApp.',
          canClaim: false,
          pendingReview: true
        });
      }

      try {
        claim.transactionId = depositResult.data?.transfer_id || depositResult.data?.transferId || null;
        await claim.save();
      } catch (_) { /* best-effort */ }

      await Transaction.create({
        id: uuidv4(),
        type: 'refund',
        amount: WELCOME_BONUS_AMOUNT,
        username,
        description: 'Bono de bienvenida (PWA + notificaciones)',
        transactionId: depositResult.data?.transfer_id || depositResult.data?.transferId,
        timestamp: new Date()
      });

      res.json({
        success: true,
        message: `¡Reclamaste tu bono de bienvenida de $${WELCOME_BONUS_AMOUNT.toLocaleString('es-AR')}!`,
        amount: WELCOME_BONUS_AMOUNT
      });
    } finally {
      setTimeout(() => releaseRefundLock(userId, 'welcome_install'), 3000);
    }
  } catch (error) {
    console.error('Error reclamando bono de bienvenida:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================
// REPORTES - REEMBOLSOS RECLAMADOS POR TIPO + FECHA
// GET /api/admin/reports/refunds?type=daily|weekly|monthly&from=YYYY-MM-DD&to=YYYY-MM-DD
// Devuelve: lista de reclamos en el rango, totales y serie por día.
// ============================================
app.get('/api/admin/reports/refunds', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { type, from, to } = req.query;
    const validTypes = ['daily', 'weekly', 'monthly'];
    if (type && !validTypes.includes(type)) {
      return res.status(400).json({ error: `type debe ser uno de: ${validTypes.join(', ')}` });
    }

    // Parse fechas. Si no vienen, default = últimos 30 días en ART.
    // ART = UTC-3, día empieza a las 03:00 UTC.
    const ART_DAY_START_OFFSET_MS = 3 * 60 * 60 * 1000;
    const DAY_MS = 24 * 60 * 60 * 1000;

    let startUTC, endUTC;
    if (from && to) {
      const [fy, fm, fd] = String(from).split('-').map(Number);
      const [ty, tm, td] = String(to).split('-').map(Number);
      if (!fy || !fm || !fd || !ty || !tm || !td) {
        return res.status(400).json({ error: 'Formato de fecha inválido. Use YYYY-MM-DD.' });
      }
      startUTC = new Date(Date.UTC(fy, fm - 1, fd, 3, 0, 0, 0));
      endUTC = new Date(Date.UTC(ty, tm - 1, td, 3, 0, 0, 0) + DAY_MS - 1);
    } else {
      endUTC = new Date();
      startUTC = new Date(endUTC.getTime() - 30 * DAY_MS);
    }

    const filter = { claimedAt: { $gte: startUTC, $lte: endUTC } };
    if (type) filter.type = type;

    const refunds = await RefundClaim.find(filter).sort({ claimedAt: -1 }).lean();

    // Agregaciones
    const summary = {
      totalCount: refunds.length,
      totalAmount: 0,
      uniqueUsers: 0,
      byType: { daily: 0, weekly: 0, monthly: 0 },
      amountByType: { daily: 0, weekly: 0, monthly: 0 }
    };
    const usernamesSet = new Set();
    const perDay = {}; // { 'YYYY-MM-DD': { count, amount } }

    for (const r of refunds) {
      const amt = Number(r.amount) || 0;
      summary.totalAmount += amt;
      if (r.username) usernamesSet.add(r.username);
      if (r.type && summary.byType[r.type] != null) {
        summary.byType[r.type]++;
        summary.amountByType[r.type] += amt;
      }
      // Día en ART (restar 3h y tomar YYYY-MM-DD)
      const localMs = new Date(r.claimedAt).getTime() - ART_DAY_START_OFFSET_MS;
      const dayKey = new Date(localMs).toISOString().slice(0, 10);
      if (!perDay[dayKey]) perDay[dayKey] = { count: 0, amount: 0 };
      perDay[dayKey].count++;
      perDay[dayKey].amount += amt;
    }
    summary.uniqueUsers = usernamesSet.size;

    const series = Object.keys(perDay)
      .sort()
      .map((day) => ({ day, count: perDay[day].count, amount: perDay[day].amount }));

    res.json({
      type: type || 'all',
      from: startUTC.toISOString(),
      to: endUTC.toISOString(),
      summary,
      series,
      refunds: refunds.map((r) => ({
        id: r.id,
        username: r.username,
        type: r.type,
        amount: r.amount,
        netAmount: r.netAmount,
        period: r.period,
        periodKey: r.periodKey || null,
        status: r.status || 'completed',
        creditError: r.creditError || null,
        claimedAt: r.claimedAt
      }))
    });
  } catch (error) {
    logger.error(`/api/admin/reports/refunds error: ${error.message}`);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================
// REPORTES - INGRESOS DE USUARIOS POR DÍA
// GET /api/admin/reports/logins?days=30
// Devuelve: usuarios nuevos por día (createdAt), activos en últimas 24h y total.
// ============================================
app.get('/api/admin/reports/logins', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const ART_DAY_START_OFFSET_MS = 3 * 60 * 60 * 1000;
    const DAY_MS = 24 * 60 * 60 * 1000;
    const days = Math.max(1, Math.min(180, parseInt(req.query.days, 10) || 30));

    const endUTC = new Date();
    const startUTC = new Date(endUTC.getTime() - days * DAY_MS);

    // Usuarios creados en el rango
    const newUsers = await User.find(
      { createdAt: { $gte: startUTC, $lte: endUTC } },
      { username: 1, createdAt: 1, lastLogin: 1, _id: 0 }
    ).lean();

    // Agrupar por día (ART)
    const perDayNew = {};
    const perDayActive = {};
    for (const u of newUsers) {
      const localMs = new Date(u.createdAt).getTime() - ART_DAY_START_OFFSET_MS;
      const dayKey = new Date(localMs).toISOString().slice(0, 10);
      perDayNew[dayKey] = (perDayNew[dayKey] || 0) + 1;
    }

    // Usuarios con lastLogin reciente, agrupados por día (último ingreso de cada uno)
    const recentlyActive = await User.find(
      { lastLogin: { $gte: startUTC, $lte: endUTC } },
      { username: 1, lastLogin: 1, _id: 0 }
    ).lean();
    for (const u of recentlyActive) {
      const localMs = new Date(u.lastLogin).getTime() - ART_DAY_START_OFFSET_MS;
      const dayKey = new Date(localMs).toISOString().slice(0, 10);
      perDayActive[dayKey] = (perDayActive[dayKey] || 0) + 1;
    }

    // Construir serie con todos los días del rango (relleno cero)
    const series = [];
    for (let i = 0; i < days; i++) {
      const dt = new Date(endUTC.getTime() - (days - 1 - i) * DAY_MS);
      const localMs = dt.getTime() - ART_DAY_START_OFFSET_MS;
      const dayKey = new Date(localMs).toISOString().slice(0, 10);
      series.push({
        day: dayKey,
        newUsers: perDayNew[dayKey] || 0,
        activeUsers: perDayActive[dayKey] || 0
      });
    }

    // Totales
    const totalUsers = await User.countDocuments();
    const last24hWindow = new Date(Date.now() - DAY_MS);
    const activeLast24h = await User.countDocuments({ lastLogin: { $gte: last24hWindow } });
    const newLast24h = await User.countDocuments({ createdAt: { $gte: last24hWindow } });

    res.json({
      from: startUTC.toISOString(),
      to: endUTC.toISOString(),
      totals: {
        totalUsers,
        activeLast24h,
        newLast24h,
        newInRange: newUsers.length
      },
      series
    });
  } catch (error) {
    logger.error(`/api/admin/reports/logins error: ${error.message}`);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================
// REPORTES - EQUIPAMIENTO POR USUARIO
// GET /api/admin/reports/equipment
// Devuelve quien tiene la PWA instalada y quien tiene notificaciones activas,
// derivado de fcmTokens[].context === 'standalone' y notifPermission === 'granted'.
// ============================================
app.get('/api/admin/reports/equipment', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const users = await User.find(
      { role: 'user' },
      { username: 1, lastLogin: 1, createdAt: 1, fcmToken: 1, fcmTokenContext: 1, notifPermission: 1, fcmTokens: 1, _id: 0 }
    ).lean();

    let withApp = 0;
    let withNotifs = 0;
    let withBoth = 0;
    const list = [];

    for (const u of users) {
      const tokens = Array.isArray(u.fcmTokens) ? u.fcmTokens : [];
      // Solo tokens con context='standalone' (PWA real instalada).
      const standaloneTokens = tokens.filter(t => t && t.context === 'standalone');
      // ultima vez que el cliente refresco el token desde la PWA. Cuando el
      // user desinstala, no puede abrir la PWA, asi que updatedAt nunca mas
      // se actualiza. Es la mejor senal de "app realmente activa".
      const appLastSeen = standaloneTokens
        .map(t => t.updatedAt ? new Date(t.updatedAt).getTime() : 0)
        .reduce((a, b) => Math.max(a, b), 0);

      // Plataforma: tomamos la del token standalone mas reciente. Si no hay
      // standalone token, caemos al token mas reciente de cualquier tipo
      // (browser) para al menos saber con que dispositivo se loguea.
      let platform = null;
      const sourceTokens = standaloneTokens.length > 0 ? standaloneTokens : tokens;
      const sortedByUpdated = sourceTokens.slice().sort((a, b) => {
        const ta = a && a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const tb = b && b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        return tb - ta;
      });
      const newest = sortedByUpdated.find(t => t && t.platform);
      if (newest) platform = newest.platform;

      const hasApp = (
        u.fcmTokenContext === 'standalone' ||
        standaloneTokens.length > 0
      );
      const hasNotifs = (
        u.notifPermission === 'granted' ||
        tokens.some(t => t && t.notifPermission === 'granted')
      );
      if (hasApp) withApp++;
      if (hasNotifs) withNotifs++;
      if (hasApp && hasNotifs) withBoth++;
      list.push({
        username: u.username || '',
        lastLogin: u.lastLogin || null,
        createdAt: u.createdAt || null,
        hasApp,
        hasNotifs,
        appLastSeen: appLastSeen > 0 ? new Date(appLastSeen).toISOString() : null,
        platform: platform
      });
    }

    // Orden: ultimos en loguearse primero, luego por username.
    list.sort((a, b) => {
      const ta = a.lastLogin ? new Date(a.lastLogin).getTime() : 0;
      const tb = b.lastLogin ? new Date(b.lastLogin).getTime() : 0;
      if (tb !== ta) return tb - ta;
      return (a.username || '').localeCompare(b.username || '');
    });

    res.json({
      totals: {
        totalUsers: list.length,
        withApp,
        withNotifs,
        withBoth
      },
      users: list
    });
  } catch (error) {
    logger.error(`/api/admin/reports/equipment error: ${error.message}`);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================
// GET /api/admin/reports/welcome-bonus
// Lista de users que reclamaron el bono de $10.000 + su estado actual
// de app instalada y notificaciones. Permite ver quien todavia tiene la
// app + notifs y quien las desactivo o desinstalo despues de cobrar.
// ============================================
app.get('/api/admin/reports/welcome-bonus', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    // 1) Todos los claims del bono.
    const claims = await RefundClaim.find(
      { type: 'welcome_install' },
      { username: 1, userId: 1, claimedAt: 1, status: 1, transactionId: 1, _id: 0 }
    ).sort({ claimedAt: -1 }).lean();

    if (claims.length === 0) {
      return res.json({
        totals: { totalClaimed: 0, stillHasApp: 0, stillHasNotifs: 0, stillBoth: 0, lostApp: 0, lostNotifs: 0 },
        claims: []
      });
    }

    // 2) Pull de los users involucrados, una sola query.
    const usernames = [...new Set(claims.map(c => c.username).filter(Boolean))];
    const users = await User.find(
      { username: { $in: usernames } },
      { username: 1, fcmTokenContext: 1, notifPermission: 1, fcmTokens: 1, lastLogin: 1, _id: 0 }
    ).lean();
    const byUsername = new Map(users.map(u => [(u.username || '').toLowerCase(), u]));

    let stillHasApp = 0, stillHasNotifs = 0, stillBoth = 0, lostApp = 0, lostNotifs = 0;
    const enriched = claims.map(c => {
      const u = byUsername.get((c.username || '').toLowerCase()) || {};
      const tokens = Array.isArray(u.fcmTokens) ? u.fcmTokens : [];
      const standaloneTokens = tokens.filter(t => t && t.context === 'standalone');
      const appLastSeen = standaloneTokens
        .map(t => t.updatedAt ? new Date(t.updatedAt).getTime() : 0)
        .reduce((a, b) => Math.max(a, b), 0);

      let platform = null;
      const sourceTokens = standaloneTokens.length > 0 ? standaloneTokens : tokens;
      const sortedByUpdated = sourceTokens.slice().sort((a, b) => {
        const ta = a && a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const tb = b && b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        return tb - ta;
      });
      const newest = sortedByUpdated.find(t => t && t.platform);
      if (newest) platform = newest.platform;

      const hasApp = (
        u.fcmTokenContext === 'standalone' ||
        standaloneTokens.length > 0
      );
      const hasNotifs = (
        u.notifPermission === 'granted' ||
        tokens.some(t => t && t.notifPermission === 'granted')
      );
      if (hasApp) stillHasApp++; else lostApp++;
      if (hasNotifs) stillHasNotifs++; else lostNotifs++;
      if (hasApp && hasNotifs) stillBoth++;
      return {
        username: c.username || '',
        claimedAt: c.claimedAt || null,
        status: c.status || 'completed',
        transactionId: c.transactionId || null,
        hasApp,
        hasNotifs,
        lastLogin: u.lastLogin || null,
        appLastSeen: appLastSeen > 0 ? new Date(appLastSeen).toISOString() : null,
        platform: platform
      };
    });

    res.json({
      totals: {
        totalClaimed: claims.length,
        stillHasApp,
        stillHasNotifs,
        stillBoth,
        lostApp,
        lostNotifs
      },
      claims: enriched
    });
  } catch (error) {
    logger.error(`/api/admin/reports/welcome-bonus error: ${error.message}`);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================
// POST /api/admin/reports/revalidate-tokens
// Dispara la validacion on-demand de todos los tokens FCM via dry-run.
// FCM responde "not-found"/"unregistered" para tokens cuya app fue
// desinstalada → los borramos del array fcmTokens. Resultado: el
// reporte siguiente refleja el estado real (no el cacheado de hace 24h).
//
// Anti-overlap: si el cron ya esta corriendo, devolvemos 409 para que
// el admin sepa que esperar y no se dispare doble.
// ============================================
let _adminRevalidateRunning = false;
app.post('/api/admin/reports/revalidate-tokens', authMiddleware, adminMiddleware, async (req, res) => {
  if (_adminRevalidateRunning) {
    return res.status(409).json({
      success: false,
      error: 'Ya hay una revalidación en curso. Esperá unos minutos y volvé a intentar.'
    });
  }
  _adminRevalidateRunning = true;
  const startedAt = Date.now();
  try {
    const result = await pruneInvalidFcmTokens(User);
    const elapsedMs = Date.now() - startedAt;
    if (!result || !result.success) {
      logger.warn(`[admin/revalidate] sin resultado: ${result && result.error}`);
      return res.json({ success: false, error: (result && result.error) || 'Error desconocido' });
    }
    logger.info(`[admin/revalidate] manual: total=${result.total} valid=${result.valid} cleaned=${result.cleaned} errors=${result.errors} (${Math.round(elapsedMs/1000)}s)`);
    res.json({
      success: true,
      total: result.total,
      valid: result.valid,
      invalid: result.invalid,
      cleaned: result.cleaned,
      errors: result.errors,
      elapsedMs
    });
  } catch (e) {
    logger.error(`[admin/revalidate] excepción: ${e.message}`);
    res.status(500).json({ success: false, error: e.message });
  } finally {
    _adminRevalidateRunning = false;
  }
});

// ============================================
// PROMO ALERT TEMPORAL en boton "QUIERO CARGAR" del home.
// El admin lo configura junto con la notificacion masiva: titulo,
// codigo y duracion. Mientras este vigente, el card de WhatsApp del
// home muestra "🎁 RECLAMÁ <mensaje> · Código: <CODE>" en vez del
// "QUIERO CARGAR" normal.
//
// Storage: usamos getConfig/setConfig (key='activePromoAlert') para
// no agregar otra coleccion Mongoose. El formato es:
//   { id, message, code, expiresAt (ISO), createdAt (ISO),
//     createdBy, prefix (opcional para targetear por prefijo) }
// Si expiresAt < ahora, el endpoint GET responde null (no esta activo).
// ============================================
const PROMO_ALERT_KEY = 'activePromoAlert';

function _normalizePromoCode(raw) {
  return String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 20);
}

// GET publico (autenticado): devuelve la promo activa para este user.
// Si la promo tiene prefix, solo se muestra a usernames que matchean.
app.get('/api/promo-alert/active', authMiddleware, async (req, res) => {
  try {
    const promo = await getConfig(PROMO_ALERT_KEY, null);
    if (!promo || !promo.expiresAt) return res.json({ active: false });
    const expiresAtMs = new Date(promo.expiresAt).getTime();
    if (!isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
      return res.json({ active: false });
    }
    // Filtro por prefijo si esta seteado.
    const username = (req.user && req.user.username) || '';
    if (promo.prefix && typeof promo.prefix === 'string') {
      if (!username.toLowerCase().startsWith(promo.prefix.toLowerCase())) {
        return res.json({ active: false });
      }
    }
    res.json({
      active: true,
      id: promo.id,
      message: promo.message,
      code: promo.code,
      expiresAt: promo.expiresAt,
      createdAt: promo.createdAt,
      notificationHistoryId: promo.notificationHistoryId || null
    });
  } catch (error) {
    logger.error(`/api/promo-alert/active error: ${error.message}`);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// POST /api/promo-alert/track-click — incrementa contador waClicks del
// row de historial asociado a la promo activa Y registra un WaClickLog
// por-usuario para los reportes de top engagement. Best-effort: errores
// no bloquean la apertura de WhatsApp en el cliente.
app.post('/api/promo-alert/track-click', authMiddleware, async (req, res) => {
  try {
    const promo = await getConfig(PROMO_ALERT_KEY, null);
    if (!promo) return res.json({ ok: true, tracked: false });

    // 1) Log por-usuario.
    try {
      await WaClickLog.create({
        id: uuidv4(),
        userId: req.user.userId,
        username: req.user.username,
        promoId: promo.id || null,
        notificationHistoryId: promo.notificationHistoryId || null,
        clickedAt: new Date()
      });
    } catch (e) {
      logger.warn(`/track-click WaClickLog falló: ${e.message}`);
    }

    // 2) Contador agregado en NotificationHistory.
    if (promo.notificationHistoryId) {
      await NotificationHistory.updateOne(
        { id: promo.notificationHistoryId },
        { $inc: { waClicks: 1 } }
      );
    }
    res.json({ ok: true, tracked: true });
  } catch (error) {
    logger.warn(`/api/promo-alert/track-click error: ${error.message}`);
    res.json({ ok: true, tracked: false });
  }
});

// ============================================
// MONEY GIVEAWAY (regalo de plata por difusion).
// El admin crea un regalo con monto-por-persona, tope de plata total,
// tope de cantidad de personas, y duracion en minutos. Mientras este
// abierto, los users pueden tocar un boton en la home y se les acredita
// la plata directo en JUGAYGANA.
//
// Cierres automaticos (status):
//   - closed_expired: paso la duracion
//   - closed_budget:  totalGiven >= totalBudget
//   - closed_max:     claimedCount >= maxClaims
//   - cancelled:      el admin lo cancelo manualmente
// ============================================

// Helper: dado un giveaway "in memory", chequea si deberia cerrarse y lo
// updateOnece a la BD si corresponde. Devuelve el doc actualizado o el
// mismo input si sigue activo.
async function _maybeCloseGiveaway(g) {
  if (!g || g.status !== 'active') return g;
  let newStatus = null;
  if (new Date(g.expiresAt).getTime() <= Date.now()) newStatus = 'closed_expired';
  else if ((g.totalGiven || 0) >= g.totalBudget) newStatus = 'closed_budget';
  else if ((g.claimedCount || 0) >= g.maxClaims) newStatus = 'closed_max';
  if (!newStatus) return g;
  try {
    await MoneyGiveaway.updateOne({ id: g.id, status: 'active' }, { $set: { status: newStatus } });
    g.status = newStatus;
  } catch (_) { /* ignore */ }
  return g;
}

// GET publico (auth): regalo activo para este user.
app.get('/api/money-giveaway/active', authMiddleware, async (req, res) => {
  try {
    const username = req.user.username || '';
    const userId = req.user.userId;

    const g = await MoneyGiveaway.findOne({ status: 'active' })
      .sort({ createdAt: -1 })
      .lean();
    if (!g) return res.json({ active: false });

    // Filtro por prefix.
    if (g.prefix && !username.toLowerCase().startsWith(g.prefix.toLowerCase())) {
      return res.json({ active: false });
    }

    // Auto-cierre lazy si vencio o se agoto.
    const fresh = await _maybeCloseGiveaway({ ...g });
    if (fresh.status !== 'active') return res.json({ active: false });

    // Chequear si este user ya reclamo.
    const existing = await MoneyGiveawayClaim.findOne({
      giveawayId: g.id,
      $or: [{ username }, { userId }]
    }).lean();

    res.json({
      active: true,
      id: g.id,
      amount: g.amount,
      totalBudget: g.totalBudget,
      maxClaims: g.maxClaims,
      claimedCount: g.claimedCount || 0,
      totalGiven: g.totalGiven || 0,
      expiresAt: g.expiresAt,
      alreadyClaimed: !!existing,
      notificationHistoryId: g.notificationHistoryId || null
    });
  } catch (error) {
    logger.error(`/api/money-giveaway/active error: ${error.message}`);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// POST claim: el user reclama el regalo activo.
app.post('/api/money-giveaway/claim', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const username = req.user.username;

    const g = await MoneyGiveaway.findOne({ status: 'active' })
      .sort({ createdAt: -1 });
    if (!g) {
      return res.json({ success: false, message: 'No hay regalo activo en este momento.', closed: true });
    }

    // Filtro por prefix.
    if (g.prefix && !username.toLowerCase().startsWith(g.prefix.toLowerCase())) {
      return res.status(403).json({ success: false, message: 'Este regalo no es para tu cuenta.' });
    }

    // Auto-cierre lazy.
    if (new Date(g.expiresAt).getTime() <= Date.now()) {
      g.status = 'closed_expired';
      await g.save().catch(() => {});
      return res.json({ success: false, message: 'El tiempo del regalo terminó.', closed: true });
    }
    if ((g.totalGiven || 0) >= g.totalBudget) {
      g.status = 'closed_budget';
      await g.save().catch(() => {});
      return res.json({ success: false, message: 'Se acabó la plata del regalo.', closed: true });
    }
    if ((g.claimedCount || 0) >= g.maxClaims) {
      g.status = 'closed_max';
      await g.save().catch(() => {});
      return res.json({ success: false, message: 'Se llegó al máximo de personas.', closed: true });
    }

    // Lock distribuido por user para serializar reintentos.
    if (!await acquireRefundLock(userId, 'money_giveaway_' + g.id)) {
      return res.json({ success: false, message: '⏳ Ya estás procesando el reclamo. Esperá unos segundos…', processing: true });
    }

    try {
      // Pre-check: ya reclamo? (busca por userId O username, mismo patron
      // que welcome bonus).
      const existing = await MoneyGiveawayClaim.findOne({
        giveawayId: g.id,
        $or: [{ userId }, { username }]
      }).lean();
      if (existing) {
        return res.json({ success: false, message: 'Ya reclamaste este regalo.', alreadyClaimed: true });
      }

      // 1) RESERVA ATOMICA del slot ANTES de cualquier escritura. Si el
      //    cap (claimedCount/totalBudget) ya esta agotado, el update
      //    condicional no matchea y devuelve null → no creditamos ni
      //    insertamos, asi nunca podemos pasarnos. Esto cubre el caso
      //    de N usuarios tocando simultaneamente cuando quedan M<N slots.
      const reserved = await MoneyGiveaway.findOneAndUpdate(
        {
          id: g.id,
          status: 'active',
          $expr: {
            $and: [
              { $lt: ['$claimedCount', '$maxClaims'] },
              { $lte: [{ $add: ['$totalGiven', g.amount] }, '$totalBudget'] }
            ]
          }
        },
        { $inc: { claimedCount: 1, totalGiven: g.amount } },
        { new: true }
      ).lean();
      if (!reserved) {
        // Algun cap se cumplio en el momento. Disparar cierre lazy y
        // avisar al user con mensaje correcto.
        const fresh = await MoneyGiveaway.findOne({ id: g.id }).lean();
        if (fresh) await _maybeCloseGiveaway({ ...fresh });
        return res.json({ success: false, message: 'Se acabaron los cupos del regalo.', closed: true });
      }

      // 2) INSERT del claim. Si choca con el unique index → este user ya
      //    reclamo en otra request paralela; tenemos que devolver el slot
      //    reservado (decrement) y avisar.
      let claim;
      try {
        claim = await MoneyGiveawayClaim.create({
          id: uuidv4(),
          giveawayId: g.id,
          userId,
          username,
          amount: g.amount,
          claimedAt: new Date()
        });
      } catch (e) {
        if (e && e.code === 11000) {
          // Devolver el slot que reservamos.
          await MoneyGiveaway.updateOne(
            { id: g.id },
            { $inc: { claimedCount: -1, totalGiven: -g.amount } }
          ).catch(() => {});
          return res.json({ success: false, message: 'Ya reclamaste este regalo.', alreadyClaimed: true });
        }
        // Otro error: tambien revertir slot.
        await MoneyGiveaway.updateOne(
          { id: g.id },
          { $inc: { claimedCount: -1, totalGiven: -g.amount } }
        ).catch(() => {});
        throw e;
      }

      // 3) Acreditar en JUGAYGANA.
      const depositResult = await jugaygana.creditUserBalance(username, g.amount);
      if (!depositResult.success) {
        try {
          claim.status = 'pending_credit_failed';
          claim.creditError = String(depositResult.error || 'Error desconocido').slice(0, 500);
          await claim.save();
        } catch (_) {}
        // El row de claim queda 'pending_credit_failed' (bloquea reclamo
        // duplicado de este user). Pero el slot del giveaway SI se devuelve
        // — sino los caps se contaminan con plata no acreditada y el
        // giveaway cierra antes de tiempo. _totalGiveawayCache se basa
        // en MoneyGiveawayClaim status='completed' asi que estos rows ya
        // estan excluidos del agregado.
        await MoneyGiveaway.updateOne(
          { id: g.id },
          { $inc: { claimedCount: -1, totalGiven: -g.amount } }
        ).catch(() => {});
        logger.error(`[GIVEAWAY] credit fallo para ${username} (giveaway ${g.id}): ${depositResult.error} - claim ${claim._id} marcado pending_credit_failed, slot devuelto`);
        return res.json({
          success: false,
          message: 'Hubo un problema al acreditar. El admin lo está revisando — no reintentes.',
          pendingReview: true
        });
      }

      // 4) Persistir transactionId.
      try {
        claim.transactionId = depositResult.data?.transfer_id || depositResult.data?.transferId || null;
        await claim.save();
      } catch (_) {}

      // 5) Chequear si tras este claim se cerro el giveaway por cap.
      await _maybeCloseGiveaway({ ...reserved });

      // Invalidar el cache del total (lo lee /api/giveaway-stats/total)
      // para que el home muestre el numero actualizado sin esperar 5min.
      _totalGiveawayCache.ts = 0;

      // Tambien sumar al contador del row de NotificationHistory si la
      // giveaway esta vinculada.
      if (g.notificationHistoryId) {
        try {
          await NotificationHistory.updateOne(
            { id: g.notificationHistoryId },
            { $inc: { giveawayClaims: 1 } }
          );
        } catch (_) {}
      }

      // Tambien crear un Transaction para que aparezca en reportes.
      try {
        await Transaction.create({
          id: uuidv4(),
          type: 'refund',
          amount: g.amount,
          username,
          description: 'Regalo de difusión',
          transactionId: depositResult.data?.transfer_id || depositResult.data?.transferId,
          timestamp: new Date()
        });
      } catch (_) {}

      res.json({
        success: true,
        message: `¡Reclamaste $${Number(g.amount).toLocaleString('es-AR')}!`,
        amount: g.amount
      });
    } finally {
      setTimeout(() => releaseRefundLock(userId, 'money_giveaway_' + g.id), 3000);
    }
  } catch (error) {
    console.error('Error reclamando giveaway:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// POST admin: crear/reemplazar el giveaway. Marca cualquier activo como
// 'cancelled' y crea uno nuevo. Body: { amount, totalBudget, maxClaims,
// durationMinutes, prefix?, notificationHistoryId? }.
app.post('/api/admin/money-giveaway', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { amount, totalBudget, maxClaims, durationMinutes, prefix, notificationHistoryId } = req.body || {};
    const a = Number(amount), b = Number(totalBudget), m = Number(maxClaims), d = Number(durationMinutes);
    if (!isFinite(a) || a <= 0) return res.status(400).json({ error: 'Monto por persona inválido' });
    if (!isFinite(b) || b < a) return res.status(400).json({ error: 'Presupuesto total inválido (debe ser >= monto por persona)' });
    if (!isFinite(m) || m < 1) return res.status(400).json({ error: 'Cantidad máxima inválida' });
    if (!isFinite(d) || d < 10 || d > 60 || d % 10 !== 0) {
      return res.status(400).json({ error: 'Duración inválida (10-60 minutos en bloques de 10)' });
    }
    // Caps anti-fat-finger / anti-cookie-robada. Si el admin necesita superarlos
    // hay que tocar el server a proposito — un typo o un atacante con la cookie
    // no puede drenar JUGAYGANA con un giveaway de $999.999.999 sin pasar por aca.
    if (a > GIVEAWAY_MAX_AMOUNT_PER_USER) {
      return res.status(400).json({ error: `Monto por persona excede el tope de seguridad ($${GIVEAWAY_MAX_AMOUNT_PER_USER.toLocaleString('es-AR')})` });
    }
    if (b > GIVEAWAY_MAX_TOTAL_BUDGET) {
      return res.status(400).json({ error: `Presupuesto total excede el tope de seguridad ($${GIVEAWAY_MAX_TOTAL_BUDGET.toLocaleString('es-AR')})` });
    }
    if (m > GIVEAWAY_MAX_CLAIMS) {
      return res.status(400).json({ error: `Cantidad máxima excede el tope de seguridad (${GIVEAWAY_MAX_CLAIMS})` });
    }

    // Cerrar cualquier giveaway activo previo.
    await MoneyGiveaway.updateMany({ status: 'active' }, { $set: { status: 'cancelled' } });

    const g = await MoneyGiveaway.create({
      id: uuidv4(),
      amount: a,
      totalBudget: b,
      maxClaims: m,
      expiresAt: new Date(Date.now() + d * 60 * 1000),
      createdBy: req.user.username || null,
      prefix: prefix && typeof prefix === 'string' && prefix.trim() ? prefix.trim() : null,
      notificationHistoryId: notificationHistoryId || null,
      status: 'active'
    });
    res.json({ success: true, giveaway: g.toObject() });
  } catch (error) {
    logger.error(`POST /api/admin/money-giveaway error: ${error.message}`);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// GET admin: ver el giveaway activo + sus claims.
app.get('/api/admin/money-giveaway', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const g = await MoneyGiveaway.findOne({ status: 'active' }).sort({ createdAt: -1 }).lean();
    if (!g) return res.json({ giveaway: null, claims: [] });
    const claims = await MoneyGiveawayClaim.find({ giveawayId: g.id })
      .sort({ claimedAt: -1 }).lean();
    res.json({ giveaway: g, claims });
  } catch (error) {
    logger.error(`GET /api/admin/money-giveaway error: ${error.message}`);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// GET publico (auth): suma TOTAL de plata regalada via money giveaways
// (todo el historico, sin filtro de fecha). Lo usa el home para
// mostrar "Total plata regalada a usuarios con app + notifs: $X".
// Cache simple in-memory de 5 min para no recalcular en cada hit.
let _totalGiveawayCache = { ts: 0, amount: 0, count: 0 };
app.get('/api/giveaway-stats/total', authMiddleware, async (req, res) => {
  try {
    const NOW = Date.now();
    // 60s TTL: balance entre carga (no recalcular en cada hit) y frescura
    // (que el numero del home se vea actualizado pronto despues de que
    // alguien reclame). Cada claim exitoso ademas invalida el cache.
    const TTL = 60 * 1000;
    if (NOW - _totalGiveawayCache.ts < TTL) {
      return res.json({
        amount: _totalGiveawayCache.amount,
        count: _totalGiveawayCache.count,
        cached: true
      });
    }

    const agg = await MoneyGiveawayClaim.aggregate([
      { $match: { status: 'completed' } },
      {
        $group: {
          _id: null,
          total: { $sum: '$amount' },
          count: { $sum: 1 }
        }
      }
    ]);

    const amount = agg.length > 0 ? Number(agg[0].total || 0) : 0;
    const count = agg.length > 0 ? Number(agg[0].count || 0) : 0;
    _totalGiveawayCache = { ts: NOW, amount, count };
    res.json({ amount, count, cached: false });
  } catch (error) {
    logger.error(`/api/giveaway-stats/total error: ${error.message}`);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// DELETE admin: cancelar el giveaway activo.
app.delete('/api/admin/money-giveaway', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    await MoneyGiveaway.updateMany({ status: 'active' }, { $set: { status: 'cancelled' } });
    res.json({ success: true });
  } catch (error) {
    logger.error(`DELETE /api/admin/money-giveaway error: ${error.message}`);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================
// NOTIFICACIONES PROGRAMADAS (hasta 1 semana adelante)
// El admin crea una scheduledNotification con todo el payload (titulo,
// body, audiencia, promo, giveaway). Un worker en background corre
// cada 60s, busca rows pending vencidas, y dispara el envio replicando
// exactamente el flujo de "enviar ahora".
// ============================================

// POST: crea notificacion programada.
// Body: { scheduledFor (ISO), title, body, prefix?, extraType ('none'|
//   'promo'|'giveaway'), promo*..., giveaway*... }
app.post('/api/admin/notifications/schedule', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const b = req.body || {};
    const title = String(b.title || '').trim();
    const body  = String(b.body || '').trim();
    if (!title || !body) return res.status(400).json({ error: 'Título y mensaje requeridos' });

    const scheduledFor = new Date(b.scheduledFor);
    if (!isFinite(scheduledFor.getTime())) {
      return res.status(400).json({ error: 'Fecha programada inválida' });
    }
    const now = Date.now();
    const oneWeekMs = 7 * 24 * 3600 * 1000;
    if (scheduledFor.getTime() <= now + 60_000) {
      return res.status(400).json({ error: 'La fecha programada debe ser al menos 1 minuto en el futuro' });
    }
    if (scheduledFor.getTime() > now + oneWeekMs) {
      return res.status(400).json({ error: 'No se puede programar más de 1 semana adelante' });
    }

    const extraType = ['none', 'promo', 'giveaway'].includes(b.extraType) ? b.extraType : 'none';
    const doc = {
      id: uuidv4(),
      scheduledFor,
      status: 'pending',
      title,
      body,
      audiencePrefix: b.prefix && typeof b.prefix === 'string' ? b.prefix.trim() : null,
      extraType,
      createdBy: req.user.username || null
    };

    if (extraType === 'promo') {
      const msg = String(b.promoMessage || '').trim();
      const code = _normalizePromoCode(b.promoCode);
      const hours = Number(b.promoDurationHours);
      if (!msg) return res.status(400).json({ error: 'Falta el mensaje de la promo' });
      if (!code) return res.status(400).json({ error: 'Falta el código de la promo' });
      if (!isFinite(hours) || hours <= 0 || hours > 168) {
        return res.status(400).json({ error: 'Duración de promo inválida (1-168 horas)' });
      }
      doc.promoMessage = msg;
      doc.promoCode = code;
      doc.promoDurationHours = hours;
    } else if (extraType === 'giveaway') {
      const a = Number(b.giveawayAmount), bg = Number(b.giveawayBudget),
            mc = Number(b.giveawayMaxClaims), d = Number(b.giveawayDurationMinutes);
      if (!isFinite(a) || a <= 0) return res.status(400).json({ error: 'Monto del regalo inválido' });
      if (!isFinite(bg) || bg < a) return res.status(400).json({ error: 'Tope de plata inválido' });
      if (!isFinite(mc) || mc < 1) return res.status(400).json({ error: 'Cantidad máxima inválida' });
      if (!isFinite(d) || d < 10 || d > 60 || d % 10 !== 0) {
        return res.status(400).json({ error: 'Duración de regalo inválida (10-60 min en bloques de 10)' });
      }
      // Mismos caps anti-fat-finger que el POST inmediato — ver comentario alla.
      if (a > GIVEAWAY_MAX_AMOUNT_PER_USER) {
        return res.status(400).json({ error: `Monto del regalo excede el tope de seguridad ($${GIVEAWAY_MAX_AMOUNT_PER_USER.toLocaleString('es-AR')})` });
      }
      if (bg > GIVEAWAY_MAX_TOTAL_BUDGET) {
        return res.status(400).json({ error: `Tope de plata excede el limite de seguridad ($${GIVEAWAY_MAX_TOTAL_BUDGET.toLocaleString('es-AR')})` });
      }
      if (mc > GIVEAWAY_MAX_CLAIMS) {
        return res.status(400).json({ error: `Cantidad máxima excede el tope de seguridad (${GIVEAWAY_MAX_CLAIMS})` });
      }
      doc.giveawayAmount = a;
      doc.giveawayBudget = bg;
      doc.giveawayMaxClaims = mc;
      doc.giveawayDurationMinutes = d;
    }

    const created = await ScheduledNotification.create(doc);
    res.json({ success: true, scheduled: created.toObject() });
  } catch (error) {
    logger.error(`POST /api/admin/notifications/schedule error: ${error.message}`);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// GET admin: lista de notificaciones programadas (pending + recientes).
app.get('/api/admin/notifications/scheduled', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const list = await ScheduledNotification.find({})
      .sort({ scheduledFor: -1 })
      .limit(100)
      .lean();
    res.json({ count: list.length, items: list });
  } catch (error) {
    logger.error(`GET /api/admin/notifications/scheduled error: ${error.message}`);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// DELETE admin: cancelar una notif programada (solo si esta pending).
app.delete('/api/admin/notifications/scheduled/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const r = await ScheduledNotification.updateOne(
      { id: req.params.id, status: 'pending' },
      { $set: { status: 'cancelled' } }
    );
    if (r.modifiedCount === 0) {
      return res.status(404).json({ error: 'No se encontró o ya fue ejecutada/cancelada' });
    }
    res.json({ success: true });
  } catch (error) {
    logger.error(`DELETE /api/admin/notifications/scheduled error: ${error.message}`);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ===== Worker que dispara las notificaciones programadas =====
// Cada 60s busca pending vencidas y las ejecuta. Marca status='sent' o
// 'failed' segun resultado. Anti-overlap con flag in-memory para no
// disparar 2 veces si la corrida anterior aun no termino.
let _schedulerRunning = false;
async function _runScheduledNotifications() {
  if (_schedulerRunning) return;
  _schedulerRunning = true;
  try {
    // Recuperar rows que quedaron 'processing' por mas de 5 min — significa
    // que el server crasheo a mitad de ejecutar. Las volvemos a 'pending'
    // para que un proximo ciclo las reintente.
    const stuck = new Date(Date.now() - 5 * 60 * 1000);
    const recovered = await ScheduledNotification.updateMany(
      { status: 'processing', processingStartedAt: { $lt: stuck } },
      { $set: { status: 'pending' }, $unset: { processingStartedAt: 1 } }
    );
    if (recovered.modifiedCount > 0) {
      logger.warn(`[scheduler] ${recovered.modifiedCount} notif(s) atascadas en 'processing' devueltas a 'pending' para reintento`);
    }

    const due = await ScheduledNotification.find({
      status: 'pending',
      scheduledFor: { $lte: new Date() }
    }).limit(20).lean();
    for (const sched of due) {
      // Atomic claim: marcamos 'processing' (no 'sent'). Solo flipeamos a
      // 'sent' DESPUES de que _executeScheduledNotification retorne con
      // exito. Si crasheamos antes, queda 'processing' con timestamp y el
      // recovery del proximo ciclo lo vuelve a tomar.
      const now = new Date();
      const claimed = await ScheduledNotification.findOneAndUpdate(
        { id: sched.id, status: 'pending' },
        { $set: { status: 'processing', processingStartedAt: now } },
        { new: true }
      );
      if (!claimed) continue;

      try {
        await _executeScheduledNotification(sched);
        await ScheduledNotification.updateOne(
          { id: sched.id },
          { $set: { status: 'sent', executedAt: new Date() }, $unset: { processingStartedAt: 1 } }
        ).catch(() => {});
        logger.info(`[scheduler] notif ${sched.id} ejecutada (${sched.title.slice(0, 40)})`);
      } catch (e) {
        logger.error(`[scheduler] error ejecutando ${sched.id}: ${e.message}`);
        await ScheduledNotification.updateOne(
          { id: sched.id },
          { $set: { status: 'failed', errorMsg: e.message.slice(0, 500) }, $unset: { processingStartedAt: 1 } }
        ).catch(() => {});
      }
    }
  } catch (e) {
    logger.error(`[scheduler] error global: ${e.message}`);
  } finally {
    _schedulerRunning = false;
  }
}
// Helper que replica el flujo del admin: send-all + crear promo o giveaway.
async function _executeScheduledNotification(sched) {
  const { sendNotificationToAllUsers } = require('./src/services/notificationService');

  // 1) Construir filter por prefix.
  const filter = {};
  if (sched.audiencePrefix) {
    const safe = sched.audiencePrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.username = { $regex: '^' + safe, $options: 'i' };
  }

  // 2) Construir body: si es giveaway, append automatico del monto.
  let body = sched.body;
  if (sched.extraType === 'giveaway' && sched.giveawayAmount) {
    body = body + ` · 🎁 Te regalamos $${Number(sched.giveawayAmount).toLocaleString('es-AR')} — abrí la app y reclamalo`;
  }

  // 3) Enviar push.
  const data = { source: 'admin-scheduled', tag: 'admin-broadcast' };
  if (sched.extraType === 'promo') {
    data.promoCode = sched.promoCode;
    data.promoMessage = sched.promoMessage;
    data.promoExpiresIn = String(sched.promoDurationHours);
  } else if (sched.extraType === 'giveaway') {
    data.giveawayAmount = String(sched.giveawayAmount);
    data.giveawayDurationMinutes = String(sched.giveawayDurationMinutes);
  }
  const sendResult = await sendNotificationToAllUsers(User, sched.title, body, data, filter);

  // 4) Crear row en NotificationHistory.
  let historyId = null;
  try {
    const histType = sched.extraType === 'promo' ? 'whatsapp_promo'
                   : sched.extraType === 'giveaway' ? 'money_giveaway'
                   : 'plain';
    const promoExpiresAt = sched.extraType === 'promo'
      ? new Date(Date.now() + sched.promoDurationHours * 3600 * 1000)
      : null;
    const giveawayExpiresAt = sched.extraType === 'giveaway'
      ? new Date(Date.now() + sched.giveawayDurationMinutes * 60 * 1000)
      : null;
    const hist = await NotificationHistory.create({
      id: uuidv4(),
      sentAt: new Date(),
      scheduledFor: sched.scheduledFor,
      audienceType: sched.audiencePrefix ? 'prefix' : 'all',
      audiencePrefix: sched.audiencePrefix,
      title: sched.title,
      body,
      type: histType,
      promoMessage: sched.promoMessage,
      promoCode: sched.promoCode,
      promoExpiresAt,
      giveawayAmount: sched.giveawayAmount,
      giveawayDurationMins: sched.giveawayDurationMinutes,
      giveawayExpiresAt,
      totalUsers: sendResult?.totalUsers || 0,
      successCount: sendResult?.successCount || 0,
      failureCount: sendResult?.failureCount || 0,
      cleanedTokens: sendResult?.cleanedTokens || 0,
      sentBy: sched.createdBy || null
    });
    historyId = hist.id;
    await ScheduledNotification.updateOne({ id: sched.id }, { $set: { notificationHistoryId: historyId } });
  } catch (e) {
    logger.warn(`[scheduler] no se pudo crear historial para ${sched.id}: ${e.message}`);
  }

  // 5) Crear promo o giveaway si aplica, vinculados al historyId.
  if (sched.extraType === 'promo') {
    const promo = {
      id: uuidv4(),
      message: sched.promoMessage,
      code: sched.promoCode,
      expiresAt: new Date(Date.now() + sched.promoDurationHours * 3600 * 1000).toISOString(),
      createdAt: new Date().toISOString(),
      createdBy: sched.createdBy || null,
      prefix: sched.audiencePrefix,
      notificationHistoryId: historyId
    };
    await setConfig(PROMO_ALERT_KEY, promo);
  } else if (sched.extraType === 'giveaway') {
    await MoneyGiveaway.updateMany({ status: 'active' }, { $set: { status: 'cancelled' } });
    await MoneyGiveaway.create({
      id: uuidv4(),
      amount: sched.giveawayAmount,
      totalBudget: sched.giveawayBudget,
      maxClaims: sched.giveawayMaxClaims,
      expiresAt: new Date(Date.now() + sched.giveawayDurationMinutes * 60 * 1000),
      createdBy: sched.createdBy || null,
      prefix: sched.audiencePrefix,
      notificationHistoryId: historyId,
      status: 'active'
    });
  }
}
// Arrancar el scheduler 30s despues del boot y correr cada 60s.
setTimeout(() => { _runScheduledNotifications(); }, 30 * 1000);
setInterval(() => { _runScheduledNotifications(); }, 60 * 1000);

// ============================================
// ESTADISTICAS ESTRATEGICAS — segmentacion + recuperacion + ROI
// ============================================
//
// Modelo de datos: PlayerStats (cache por user) + RecoveryPush (audit log).
//
// Flujo:
//   1. Admin toca "Refrescar" -> POST /api/admin/stats/refresh
//      Recorre todos los users locales, pega JUGAYGANA por uno (con
//      throttle), suma RefundClaim + MoneyGiveawayClaim del mes,
//      calcula tier + activityStatus + isOpportunist, persiste a Mongo.
//   2. Admin lee la tabla -> GET /api/admin/stats/players?segment=...
//   3. Admin toca "Recuperar todos los X" -> POST /api/admin/stats/recovery-push
//      Crea filas en RecoveryPush (con cooldown 7d por user) y dispara
//      la notif (reusa sendBulkNotification logic).
//
// Reglas de tier (sobre cargas REALES de JUGAYGANA en ult. 30d, descontando
// los credits nuestros):
//   VIP    : >= 10 cargas reales Y >= $200.000
//   ORO    : >= 5 cargas reales Y  >= $100.000
//   PLATA  : >= 5 cargas reales O  >= $30.000  (lo primero que se cumpla)
//   BRONCE : >= 2 cargas reales (fiel pero chico)
//   NUEVO  : creado hace < 14 dias, sin patron aun
//   SIN_DATOS: no se pudo resolver JUGAYGANA o no tiene historial
//
// Reglas de activityStatus (dias desde ULTIMA carga REAL):
//   ACTIVO    : 0-7 dias
//   EN_RIESGO : 8-15 dias
//   PERDIDO   : 16-30 dias
//   INACTIVO  : 31+ dias
//   NUEVO     : creado hace < 14d sin cargas todavia
//
// Oportunista: reclamo bonos N veces en ult 30d sin hacer carga real
// despues. Default N=3 — flag visible en panel para que admin lo dropee
// del listado de bonos masivos.
// ============================================
const STATS_TIER_RULES = {
  vipMinCharges: 10,
  vipMinAmount: 200000,
  oroMinCharges: 5,
  oroMinAmount: 100000,
  plataMinCharges: 5,
  plataMinAmount: 30000,
  bronceMinCharges: 2
};
const STATS_ACTIVITY_DAYS = {
  activo: 7,
  enRiesgo: 15,
  perdido: 30
};
const RECOVERY_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias entre pushes al mismo user
const OPPORTUNIST_THRESHOLD = 3;

function _computeTier(realChargesCount, realDepositsAmount, accountAgeDays) {
  if (accountAgeDays != null && accountAgeDays < 14) return 'NUEVO';
  if (realChargesCount >= STATS_TIER_RULES.vipMinCharges &&
      realDepositsAmount >= STATS_TIER_RULES.vipMinAmount) return 'VIP';
  if (realChargesCount >= STATS_TIER_RULES.oroMinCharges &&
      realDepositsAmount >= STATS_TIER_RULES.oroMinAmount) return 'ORO';
  if (realChargesCount >= STATS_TIER_RULES.plataMinCharges ||
      realDepositsAmount >= STATS_TIER_RULES.plataMinAmount) return 'PLATA';
  if (realChargesCount >= STATS_TIER_RULES.bronceMinCharges) return 'BRONCE';
  return 'SIN_DATOS';
}

function _computeActivityStatus(daysSinceLastCharge, accountAgeDays, hasAnyCharge) {
  // NUEVO: cuenta jovencita sin cargas (todavia onboarding).
  if (!hasAnyCharge && accountAgeDays != null && accountAgeDays < 14) return 'NUEVO';
  if (daysSinceLastCharge == null) return 'INACTIVO'; // nunca cargo y no es nuevo
  if (daysSinceLastCharge <= STATS_ACTIVITY_DAYS.activo) return 'ACTIVO';
  if (daysSinceLastCharge <= STATS_ACTIVITY_DAYS.enRiesgo) return 'EN_RIESGO';
  if (daysSinceLastCharge <= STATS_ACTIVITY_DAYS.perdido) return 'PERDIDO';
  return 'INACTIVO';
}

// Para JUGAYGANA: dado una respuesta de getUserNetLastMonth + lista de
// transferencias, contamos cuantas son "deposits del user" (sus cargas reales)
// vs creditos admin (los bonos nuestros). Por ahora aproximamos: pedimos
// total_deposits y restamos lo que sabemos que dimos en RefundClaim+MoneyGiveawayClaim
// del mismo periodo. La fecha de "ultima carga real" la dejamos como
// lastDepositDate de JUGAYGANA si hay deposits>0; si no podemos saberlo
// granular aca, usamos (refreshedAt - 30d) como floor conservador.
async function _refreshPlayerStatsFor(username, opts = {}) {
  const u = String(username || '').toLowerCase().trim();
  if (!u) return { ok: false, error: 'no_username' };

  // Datos desde JUGAYGANA (depositos + retiros del ult. mes).
  const periodMs = 30 * 24 * 60 * 60 * 1000;
  const fromDate = new Date(Date.now() - periodMs);

  let jPayload = null;
  try {
    jPayload = await jugaygana.getUserNetLastMonth(u);
  } catch (e) {
    logger.warn(`[stats] getUserNetLastMonth fallo para ${u}: ${e.message}`);
  }

  // Sumas de bonos NUESTROS dados en los ult. 30d (RefundClaim + MoneyGiveawayClaim).
  const [refundAgg, giveawayAgg, userDoc] = await Promise.all([
    RefundClaim.aggregate([
      { $match: {
          username: u,
          status: { $in: ['completed', null] },
          claimedAt: { $gte: fromDate }
      }},
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }
    ]).catch(() => []),
    MoneyGiveawayClaim.aggregate([
      { $match: {
          username: u,
          status: 'completed',
          claimedAt: { $gte: fromDate }
      }},
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }
    ]).catch(() => []),
    User.findOne({ username: u }).select('id createdAt').lean().catch(() => null)
  ]);

  const refundsTotal = (refundAgg[0] && refundAgg[0].total) || 0;
  const refundsCount = (refundAgg[0] && refundAgg[0].count) || 0;
  const giveawaysTotal = (giveawayAgg[0] && giveawayAgg[0].total) || 0;
  const giveawaysCount = (giveawayAgg[0] && giveawayAgg[0].count) || 0;
  const bonusTotal = refundsTotal + giveawaysTotal;
  const bonusCount = refundsCount + giveawaysCount;

  // Cargas reales = deposits totales JUGAYGANA − bonos nuestros (los bonos
  // los acreditamos via creditUserBalance que JUGAYGANA puede contar como
  // deposit). Floor en 0 por si la cuenta queda negativa por timing/edge cases.
  const jDeposits = (jPayload && jPayload.success ? Number(jPayload.totalDeposits || 0) : 0);
  const jWithdraws = (jPayload && jPayload.success ? Number(jPayload.totalWithdraws || 0) : 0);
  const realDeposits = Math.max(0, jDeposits - bonusTotal);

  // Aproximacion de cargas-reales-count: por ahora, si el monto real > 0
  // contamos al menos 1, sino 0. Para el conteo exacto necesitariamos
  // listar transactions de JUGAYGANA — TODO en fase 2.
  const realChargesCount = realDeposits > 0 ? Math.max(1, Math.round(realDeposits / 5000)) : 0;

  const accountAgeDays = userDoc && userDoc.createdAt
    ? Math.floor((Date.now() - new Date(userDoc.createdAt).getTime()) / (24*3600*1000))
    : null;

  // Cargar el doc actual para preservar lastSeenApp (que se actualiza fuera
  // del refresh) y lastRecoveryPushAt.
  const existing = await PlayerStats.findOne({ username: u }).lean();
  const lastRealDepositDate = realDeposits > 0
    ? (existing && existing.lastRealDepositDate
       ? new Date(Math.max(new Date(existing.lastRealDepositDate).getTime(), Date.now() - periodMs/2))
       : new Date(Date.now() - periodMs/2)) // mid-period como aproximacion conservadora
    : (existing ? existing.lastRealDepositDate : null);

  // dias desde ultima carga real
  const daysSinceLastCharge = lastRealDepositDate
    ? Math.floor((Date.now() - new Date(lastRealDepositDate).getTime()) / (24*3600*1000))
    : null;

  const tier = _computeTier(realChargesCount, realDeposits, accountAgeDays);
  const activityStatus = _computeActivityStatus(daysSinceLastCharge, accountAgeDays, realChargesCount > 0);

  // Oportunista: bonos sin carga real subsiguiente.
  // Si bonusCount > 0 y realChargesCount == 0 -> claros oportunistas.
  // Si bonusCount >> realChargesCount -> sospechoso.
  let bonusesWithoutDeposit = 0;
  if (bonusCount > 0 && realChargesCount === 0) bonusesWithoutDeposit = bonusCount;
  else if (bonusCount > realChargesCount * 2) bonusesWithoutDeposit = bonusCount - realChargesCount;
  const isOpportunist = bonusesWithoutDeposit >= OPPORTUNIST_THRESHOLD;

  const netToHouse = realDeposits - jWithdraws - bonusTotal;

  await PlayerStats.updateOne(
    { username: u },
    {
      $set: {
        userId: userDoc ? userDoc.id : null,
        lastRealDepositDate,
        realDeposits30d: realDeposits,
        realChargesCount30d: realChargesCount,
        withdraws30d: jWithdraws,
        bonusGiven30d: bonusTotal,
        bonusCount30d: bonusCount,
        netToHouse30d: netToHouse,
        tier,
        activityStatus,
        bonusesClaimedWithoutDeposit30d: bonusesWithoutDeposit,
        isOpportunist,
        refreshedAt: new Date()
      },
      $setOnInsert: { username: u }
    },
    { upsert: true }
  );

  return { ok: true, username: u, tier, activityStatus };
}

// Estado del refresh (para que el admin vea progreso desde el panel).
let _statsRefreshState = { running: false, total: 0, done: 0, errors: 0, startedAt: null, finishedAt: null };

app.post('/api/admin/stats/refresh', authMiddleware, adminMiddleware, async (req, res) => {
  if (_statsRefreshState.running) {
    return res.json({
      success: false,
      message: 'Ya hay un refresh corriendo',
      state: _statsRefreshState
    });
  }

  // Empezamos asincronicamente — devolvemos 200 al admin enseguida.
  // El admin polea GET /api/admin/stats/refresh para ver progreso.
  _statsRefreshState = {
    running: true, total: 0, done: 0, errors: 0,
    startedAt: new Date().toISOString(), finishedAt: null
  };
  res.json({ success: true, state: _statsRefreshState });

  // Background work
  (async () => {
    try {
      // Listamos solo users que abrieron la app alguna vez O que tienen
      // claims, para no martillar JUGAYGANA con cuentas dormidas.
      const usernames = await User.find({
        role: { $nin: ['admin', 'depositor', 'withdrawer'] },
        isActive: true
      }).select('username').lean();
      _statsRefreshState.total = usernames.length;

      for (const u of usernames) {
        if (!u.username) continue;
        try {
          await _refreshPlayerStatsFor(u.username);
        } catch (e) {
          _statsRefreshState.errors++;
          logger.warn(`[stats refresh] ${u.username}: ${e.message}`);
        }
        _statsRefreshState.done++;
        // Throttle: 200ms entre users (~5/seg) para no romper JUGAYGANA.
        await new Promise(r => setTimeout(r, 200));
      }

      // Resolver outcomes pendientes de RecoveryPush (en el mismo pase).
      await _resolvePendingRecoveryOutcomes();
    } catch (e) {
      logger.error(`[stats refresh] fatal: ${e.message}`);
    } finally {
      _statsRefreshState.running = false;
      _statsRefreshState.finishedAt = new Date().toISOString();
    }
  })();
});

app.get('/api/admin/stats/refresh', authMiddleware, adminMiddleware, async (req, res) => {
  res.json({ state: _statsRefreshState });
});

// Para cada RecoveryPush con outcome=pending, mira si el user (a) reclamo
// el bono y/o (b) hizo carga real despues del sentAt. Si carga real ->
// 'recovered'. Si solo bono -> 'opportunist'. Si pasaron 14d sin nada ->
// 'no_response'.
async function _resolvePendingRecoveryOutcomes() {
  const pending = await RecoveryPush.find({ outcome: 'pending' }).lean();
  const NOW = Date.now();
  const FOURTEEN_DAYS = 14 * 24 * 3600 * 1000;
  for (const p of pending) {
    const sentMs = new Date(p.sentAt).getTime();
    const stats = await PlayerStats.findOne({ username: p.username }).lean();
    let outcome = 'pending';
    let realDepositMade = p.realDepositMade;
    let realDepositAt = p.realDepositAt;
    let realDepositAmount = p.realDepositAmount;
    let bonusClaimed = p.bonusClaimed;
    let bonusClaimedAt = p.bonusClaimedAt;

    if (stats && stats.lastRealDepositDate &&
        new Date(stats.lastRealDepositDate).getTime() >= sentMs) {
      outcome = 'recovered';
      realDepositMade = true;
      realDepositAt = realDepositAt || stats.lastRealDepositDate;
      realDepositAmount = realDepositAmount || stats.realDeposits30d;
    } else {
      // Mira si reclamo el bono que mandamos.
      const claimAfter = await Promise.all([
        MoneyGiveawayClaim.findOne({
          username: p.username,
          claimedAt: { $gte: new Date(sentMs) }
        }).lean(),
        RefundClaim.findOne({
          username: p.username,
          claimedAt: { $gte: new Date(sentMs) }
        }).lean()
      ]);
      if (claimAfter[0] || claimAfter[1]) {
        bonusClaimed = true;
        bonusClaimedAt = bonusClaimedAt || (claimAfter[0]?.claimedAt || claimAfter[1]?.claimedAt);
        // Si pasaron 14d desde el send y solo reclamo bono, es oportunista.
        if (NOW - sentMs >= FOURTEEN_DAYS) outcome = 'opportunist';
      } else if (NOW - sentMs >= FOURTEEN_DAYS) {
        outcome = 'no_response';
      }
    }

    if (outcome !== p.outcome || bonusClaimed !== p.bonusClaimed || realDepositMade !== p.realDepositMade) {
      await RecoveryPush.updateOne(
        { _id: p._id },
        {
          $set: {
            outcome,
            bonusClaimed,
            bonusClaimedAt,
            realDepositMade,
            realDepositAt,
            realDepositAmount,
            outcomeResolvedAt: outcome === 'pending' ? null : new Date()
          }
        }
      );
    }
  }
}

// GET /api/admin/stats/players — listado segmentado
// Query: ?tier=VIP&activityStatus=EN_RIESGO&sortBy=netToHouse30d&order=desc&limit=100
app.get('/api/admin/stats/players', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const q = {};
    if (req.query.tier) q.tier = String(req.query.tier);
    if (req.query.activityStatus) q.activityStatus = String(req.query.activityStatus);
    if (req.query.opportunist === 'true') q.isOpportunist = true;
    if (req.query.opportunist === 'false') q.isOpportunist = false;

    const sortBy = String(req.query.sortBy || 'netToHouse30d');
    const order = req.query.order === 'asc' ? 1 : -1;
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);

    const players = await PlayerStats.find(q)
      .sort({ [sortBy]: order })
      .limit(limit)
      .lean();

    res.json({ players, total: players.length });
  } catch (error) {
    logger.error(`/api/admin/stats/players: ${error.message}`);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// GET /api/admin/stats/segments — counts agregados por segmento + comparativo semanal
app.get('/api/admin/stats/segments', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const counts = await PlayerStats.aggregate([
      { $group: { _id: { tier: '$tier', activityStatus: '$activityStatus' }, count: { $sum: 1 } } }
    ]);
    const matrix = {};
    for (const c of counts) {
      const k = (c._id.tier || 'SIN_DATOS') + '-' + (c._id.activityStatus || 'INACTIVO');
      matrix[k] = c.count;
    }
    const tierTotals = {};
    const activityTotals = {};
    for (const c of counts) {
      const t = c._id.tier || 'SIN_DATOS';
      const a = c._id.activityStatus || 'INACTIVO';
      tierTotals[t] = (tierTotals[t] || 0) + c.count;
      activityTotals[a] = (activityTotals[a] || 0) + c.count;
    }

    // Recovery effectiveness ult. 30d
    const fromDate = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const recoveryAgg = await RecoveryPush.aggregate([
      { $match: { sentAt: { $gte: fromDate } } },
      { $group: { _id: '$outcome', count: { $sum: 1 }, totalBonus: { $sum: '$bonusAmount' }, totalRealDeposit: { $sum: '$realDepositAmount' } } }
    ]);
    const recovery = { sent: 0, recovered: 0, opportunist: 0, no_response: 0, pending: 0, totalBonus: 0, totalRealDeposit: 0 };
    for (const r of recoveryAgg) {
      recovery[r._id || 'pending'] = r.count;
      recovery.sent += r.count;
      recovery.totalBonus += r.totalBonus || 0;
      recovery.totalRealDeposit += r.totalRealDeposit || 0;
    }
    recovery.roiX = recovery.totalBonus > 0
      ? Number((recovery.totalRealDeposit / recovery.totalBonus).toFixed(2))
      : 0;

    // Semana vs semana anterior (basado en lastRealDepositDate)
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 3600 * 1000);
    const [activeThisWeek, activeLastWeek] = await Promise.all([
      PlayerStats.countDocuments({ lastRealDepositDate: { $gte: oneWeekAgo } }),
      PlayerStats.countDocuments({ lastRealDepositDate: { $gte: twoWeeksAgo, $lt: oneWeekAgo } })
    ]);
    const weekly = {
      activeThisWeek,
      activeLastWeek,
      delta: activeThisWeek - activeLastWeek,
      deltaPct: activeLastWeek > 0
        ? Number((((activeThisWeek - activeLastWeek) / activeLastWeek) * 100).toFixed(1))
        : 0
    };

    res.json({ matrix, tierTotals, activityTotals, recovery, weekly });
  } catch (error) {
    logger.error(`/api/admin/stats/segments: ${error.message}`);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// GET /api/admin/stats/roi-bonus — agrega bonos por buckets de monto y ROI
app.get('/api/admin/stats/roi-bonus', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const fromDate = new Date(Date.now() - 30 * 24 * 3600 * 1000);

    // Para cada giveaway claim del ult. mes, buscar si el user hizo carga real
    // despues. Stats agregados por bucket de amount.
    const giveaways = await MoneyGiveawayClaim.aggregate([
      { $match: { status: 'completed', claimedAt: { $gte: fromDate } } },
      { $group: {
          _id: '$amount',
          count: { $sum: 1 },
          totalGiven: { $sum: '$amount' },
          users: { $addToSet: '$username' }
      }},
      { $sort: { _id: -1 } }
    ]);

    // Para cada bucket, calcular cuantos de esos users hicieron carga real
    // (lastRealDepositDate >= claimedAt aprox: usamos lastRealDepositDate
    //  posterior a fromDate, simplificacion conservadora).
    const buckets = [];
    for (const g of giveaways) {
      const stats = await PlayerStats.find({
        username: { $in: g.users },
        lastRealDepositDate: { $gte: fromDate }
      }).select('username realDeposits30d').lean();
      const recovered = stats.length;
      const realDeposits = stats.reduce((acc, s) => acc + (s.realDeposits30d || 0), 0);
      buckets.push({
        amount: g._id,
        count: g.count,
        totalGiven: g.totalGiven,
        uniqueUsers: g.users.length,
        usersThatDeposited: recovered,
        realDepositsFromThem: realDeposits,
        roiX: g.totalGiven > 0 ? Number((realDeposits / g.totalGiven).toFixed(2)) : 0
      });
    }

    res.json({ buckets, periodDays: 30 });
  } catch (error) {
    logger.error(`/api/admin/stats/roi-bonus: ${error.message}`);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// POST /api/admin/stats/recovery-push — manda push masivo a un segmento
// Body: {
//   tier: 'VIP'|'ORO'|...,           opcional, filtra
//   activityStatus: 'EN_RIESGO'|...,  opcional, filtra
//   excludeOpportunists: true,        skip oportunistas
//   title, body,                       texto de la notif
//   bonusType: 'giveaway'|'promo'|'none',
//   giveawayAmount, giveawayBudget, giveawayMaxClaims, giveawayDurationMinutes,
//   promoMessage, promoCode, promoDurationHours
// }
// Respeta cooldown de 7d por user. Crea filas RecoveryPush + dispara la
// notif via sendBulkNotification existente (filtrando por la lista de
// usernames que pasaron el cooldown).
app.post('/api/admin/stats/recovery-push', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const b = req.body || {};
    const filter = {};
    if (b.tier) filter.tier = b.tier;
    if (b.activityStatus) filter.activityStatus = b.activityStatus;
    if (b.excludeOpportunists !== false) filter.isOpportunist = { $ne: true };

    const candidates = await PlayerStats.find(filter).select('username tier activityStatus').lean();
    if (candidates.length === 0) {
      return res.json({ success: false, message: 'No hay usuarios en ese segmento' });
    }

    // Filtrar por cooldown: skip los que ya recibieron push en los ult. 7d.
    const cutoff = new Date(Date.now() - RECOVERY_COOLDOWN_MS);
    const recent = await RecoveryPush.find({
      username: { $in: candidates.map(c => c.username) },
      sentAt: { $gte: cutoff }
    }).select('username').lean();
    const skipSet = new Set(recent.map(r => r.username));
    const toSend = candidates.filter(c => !skipSet.has(c.username));

    if (toSend.length === 0) {
      return res.json({
        success: false,
        message: 'Todos los usuarios del segmento ya recibieron push en los ultimos 7 dias',
        skipped: skipSet.size
      });
    }

    const campaignBatchId = uuidv4();
    const title = String(b.title || 'Te extrañamos').slice(0, 60);
    const body = String(b.body || 'Volve hoy y aprovecha').slice(0, 180);
    const bonusType = ['giveaway', 'promo', 'none'].includes(b.bonusType) ? b.bonusType : 'none';
    const bonusAmount = bonusType === 'giveaway' ? Number(b.giveawayAmount || 0) : 0;

    // Crear filas RecoveryPush primero (asi quedan registradas aunque la
    // notif falle parcialmente).
    const pushDocs = toSend.map(c => ({
      username: c.username,
      segmentAtSend: c.tier + '-' + c.activityStatus,
      tierAtSend: c.tier,
      activityStatusAtSend: c.activityStatus,
      bonusAmount,
      bonusType,
      campaignBatchId,
      sentAt: new Date(),
      sentBy: req.user.username || null
    }));
    await RecoveryPush.insertMany(pushDocs);

    // Update lastRecoveryPushAt en PlayerStats para que el panel lo refleje.
    await PlayerStats.updateMany(
      { username: { $in: toSend.map(c => c.username) } },
      { $set: { lastRecoveryPushAt: new Date() }, $inc: { recoveryAttemptsLifetime: 1 } }
    );

    // Disparar la notif: por simplicidad, mandamos a TODOS los usernames a
    // los que tenemos que pegar. Reutilizamos el endpoint
    // /api/admin/notifications/send via fetch interno NO — hacemos la
    // logica inline para tener control sobre la audiencia (lista exacta).
    // Por simplicidad de este MVP, retornamos los ids — el admin va a
    // disparar el envio masivo desde el composer normal usando la lista.
    res.json({
      success: true,
      campaignBatchId,
      sentCount: toSend.length,
      skipped: skipSet.size,
      usernames: toSend.map(c => c.username),
      message: 'Push de recuperacion registrado. Ahora dispara el envio en el composer con esta lista de usuarios.'
    });
  } catch (error) {
    logger.error(`/api/admin/stats/recovery-push: ${error.message}`);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================
// IMPORT CSV DE JUGAYGANA — analisis bulk de transacciones
// ============================================
//
// El admin sube un CSV exportado de JUGAYGANA con todas las transacciones
// de los ultimos N dias (puede tener 200k+ filas). Procesamos en streaming
// (sin cargar archivo entero a memoria), agregamos por user, actualizamos
// PlayerStats con las cargas REALES (deposit), retiros (withdraw) y bonos
// (individual_bonus, que sabemos son los nuestros). Los datos crudos NO
// se persisten — solo queda el resumen en JugayganaImport y los agregados
// en PlayerStats.
//
// Formato del CSV (primera fila = headers):
//   A: Type   (deposit | withdraw | individual_bonus)
//   B: Amount (decimal)
//   C: Initiator (agente, no usado)
//   D: User   (username del jugador)
//   E: Parent (grupo JUGAYGANA, no usado)
//   F: Time   (DD/M/YYYY o D/M/YYYY)
//   G: hora HH:MM:SS.ms (ignorada por ahora — usamos solo fecha)
//   H: balance antes (no usado)
//   I: balance despues (no usado)
//
// Limites: aceptamos hasta 100MB de body raw. Para 200k filas eso son
// ~30MB asi que sobra.
// ============================================
const csvImportLimitMb = '100mb';

// Parser flexible: detecta delimiter (',' o ';' o '\t'), parsea fechas
// DMY o ISO, normaliza tipo de operacion a {deposit, withdraw, bonus}.
function _parseJugayganaCsv(rawText) {
  const out = {
    rows: [],          // [{ type, amount, username, dateMs }, ...]
    skipped: 0,
    delimiter: null,
    dateFormat: null,
    headerRow: false
  };
  if (!rawText || typeof rawText !== 'string') return out;

  // Detectar delimiter — el primer split por linea, contar comas/semicolons/tabs.
  const firstNewline = rawText.indexOf('\n');
  const sample = firstNewline > 0 ? rawText.slice(0, Math.min(2000, firstNewline)) : rawText.slice(0, 2000);
  const counts = {
    ',': (sample.match(/,/g) || []).length,
    ';': (sample.match(/;/g) || []).length,
    '\t': (sample.match(/\t/g) || []).length
  };
  let delim = ',';
  if (counts[';'] > counts[',']) delim = ';';
  else if (counts['\t'] > counts[',']) delim = '\t';
  out.delimiter = delim;

  const lines = rawText.split(/\r?\n/);
  if (lines.length === 0) return out;

  // Header detection: si la primera linea tiene "Type" o "type" o "Amount"
  // o "User" la tratamos como header y la skipeamos.
  const firstLine = lines[0].toLowerCase();
  const hasHeader = /\btype\b|\bamount\b|\buser\b|\btime\b/.test(firstLine);
  out.headerRow = hasHeader;
  const startIdx = hasHeader ? 1 : 0;

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    const cols = _splitCsvLine(line, delim);
    if (cols.length < 6) { out.skipped++; continue; }

    const typeRaw = String(cols[0] || '').trim().toLowerCase();
    const amountRaw = String(cols[1] || '').trim();
    const userRaw = String(cols[3] || '').trim();
    const dateRaw = String(cols[5] || '').trim();
    const timeRaw = cols[6] ? String(cols[6]).trim() : '';

    if (!typeRaw || !userRaw || !amountRaw || !dateRaw) { out.skipped++; continue; }

    // Normalizar tipo: 'deposit', 'withdraw', 'bonus' (cubre individual_bonus,
    // bonus, etc).
    let type;
    if (typeRaw === 'deposit' || typeRaw.startsWith('depo')) type = 'deposit';
    else if (typeRaw === 'withdraw' || typeRaw.startsWith('with') || typeRaw.startsWith('retir')) type = 'withdraw';
    else if (typeRaw.includes('bonus') || typeRaw.includes('bonif')) type = 'bonus';
    else { out.skipped++; continue; }

    // Monto: limpiar $ , puntos miles, comas decimales.
    const amount = _parseAmount(amountRaw);
    if (!Number.isFinite(amount) || amount <= 0) { out.skipped++; continue; }

    // Fecha: el sample del cliente es DD/M/YYYY (mes sin cero).
    // Tambien soportamos DD/MM/YYYY y YYYY-MM-DD (ISO).
    const dateMs = _parseDateFlexible(dateRaw, timeRaw);
    if (!dateMs) { out.skipped++; continue; }

    out.rows.push({ type, amount, username: userRaw.toLowerCase(), dateMs });
  }

  if (out.rows.length > 0) {
    // Detectamos formato de fecha del primer row exitoso para el log.
    const sampleDate = lines[startIdx]?.split(delim)[5];
    out.dateFormat = /^\d{4}-\d{2}-\d{2}/.test(String(sampleDate || '')) ? 'iso' : 'dmy';
  }

  return out;
}

// Split CSV respetando comillas dobles (campos con comas adentro).
function _splitCsvLine(line, delim) {
  const out = [];
  let buf = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { buf += '"'; i++; } // escaped quote
      else inQuotes = !inQuotes;
    } else if (ch === delim && !inQuotes) {
      out.push(buf);
      buf = '';
    } else {
      buf += ch;
    }
  }
  out.push(buf);
  return out;
}

function _parseAmount(s) {
  if (!s) return NaN;
  // Quitar $, espacios.
  let t = String(s).replace(/[\s$]/g, '');
  // Si tiene tanto . como ,: el ultimo es decimal; el otro es separador miles.
  const lastDot = t.lastIndexOf('.');
  const lastComma = t.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    if (lastComma > lastDot) {
      // formato 1.234,56 → quitar puntos, cambiar coma por punto
      t = t.replace(/\./g, '').replace(',', '.');
    } else {
      // formato 1,234.56 → quitar comas
      t = t.replace(/,/g, '');
    }
  } else if (lastComma >= 0 && lastDot < 0) {
    // 1234,5 → coma como decimal
    t = t.replace(',', '.');
  }
  // si solo tiene punto, ya esta OK
  return parseFloat(t);
}

function _parseDateFlexible(dateStr, timeStr) {
  if (!dateStr) return null;
  let d;
  // ISO YYYY-MM-DD
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(dateStr);
  if (m) {
    d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  } else {
    // DMY: DD/M/YYYY o DD-M-YYYY
    m = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/.exec(dateStr);
    if (m) {
      let year = +m[3];
      if (year < 100) year += 2000;
      d = new Date(Date.UTC(year, +m[2] - 1, +m[1]));
    }
  }
  if (!d || !Number.isFinite(d.getTime())) return null;
  // Hora opcional HH:MM:SS o HH:MM:SS.ms
  if (timeStr) {
    const tm = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2})(?:\.(\d+))?)?/.exec(timeStr);
    if (tm) {
      d.setUTCHours(+tm[1], +tm[2], +(tm[3] || 0), 0);
    }
  }
  return d.getTime();
}

// Estado del import (para que el frontend polee).
let _csvImportState = { running: false, total: 0, parsed: 0, valid: 0, skipped: 0, startedAt: null, finishedAt: null, importId: null };

app.post(
  '/api/admin/stats/import-csv',
  authMiddleware,
  adminMiddleware,
  express.text({ limit: csvImportLimitMb, type: '*/*' }),
  async (req, res) => {
    if (_csvImportState.running) {
      return res.json({ success: false, message: 'Ya hay un import corriendo', state: _csvImportState });
    }
    const raw = req.body;
    if (!raw || typeof raw !== 'string' || raw.length < 100) {
      return res.status(400).json({ error: 'Archivo vacio o muy chico' });
    }

    // Hash para idempotencia.
    const contentHash = crypto.createHash('sha256').update(raw).digest('hex');
    const existing = await JugayganaImport.findOne({ contentHash, status: 'completed' }).lean();
    if (existing) {
      return res.json({
        success: true,
        skipped: true,
        message: 'Este archivo ya fue importado el ' + new Date(existing.uploadedAt).toLocaleString('es-AR') + '. No se reproceso.',
        importId: existing._id
      });
    }

    _csvImportState = {
      running: true, total: 0, parsed: 0, valid: 0, skipped: 0,
      startedAt: new Date().toISOString(), finishedAt: null, importId: null
    };
    res.json({ success: true, state: _csvImportState, message: 'Procesando en background...' });

    // Procesar en background usando el helper centralizado.
    _processCsvBackground(raw, contentHash, req.user.username || null);
  }
);

// GET state del import en curso o el ultimo terminado.
app.get('/api/admin/stats/import-csv', authMiddleware, adminMiddleware, async (req, res) => {
  const lastImport = await JugayganaImport.findOne({}).sort({ uploadedAt: -1 }).lean();
  res.json({ state: _csvImportState, lastImport });
});

// POST /api/admin/stats/import-csv-url
// Acepta un link de Google Sheets ("cualquier persona con el enlace puede
// ver"). Extrae el file ID, construye la URL de export CSV, descarga y
// procesa igual que el upload directo.
app.post('/api/admin/stats/import-csv-url', authMiddleware, adminMiddleware, async (req, res) => {
  if (_csvImportState.running) {
    return res.json({ success: false, message: 'Ya hay un import corriendo', state: _csvImportState });
  }
  const { url, gid } = req.body || {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Falta el link' });
  }

  // Extraer file ID. Soporta:
  //   docs.google.com/spreadsheets/d/{ID}/edit?...
  //   docs.google.com/spreadsheets/d/{ID}/
  const idMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/);
  if (!idMatch) {
    return res.status(400).json({ error: 'No es un link valido de Google Sheets' });
  }
  const fileId = idMatch[1];

  // Si el user paso un gid en el link original, lo respetamos. Sino, sheet 0.
  let gidParam = gid || null;
  if (!gidParam) {
    const gidMatch = url.match(/[?&#]gid=(\d+)/);
    if (gidMatch) gidParam = gidMatch[1];
  }
  const exportUrl = `https://docs.google.com/spreadsheets/d/${fileId}/export?format=csv` +
    (gidParam ? `&gid=${gidParam}` : '');

  // Bajar el CSV. axios sigue redirects por default.
  let raw = '';
  try {
    const resp = await axios.get(exportUrl, {
      timeout: 90_000,           // 90s, sheets grandes pueden tardar
      maxContentLength: 100 * 1024 * 1024, // 100MB
      maxBodyLength: 100 * 1024 * 1024,
      responseType: 'text',
      // Si la sheet no es publica Google devuelve HTML de login (200 OK,
      // text/html). Detectamos eso despues comparando content-type.
      validateStatus: (s) => s >= 200 && s < 400
    });
    const ct = String(resp.headers['content-type'] || '').toLowerCase();
    if (ct.includes('text/html')) {
      return res.status(400).json({
        error: 'El sheet no es publico. Cambialo a "Cualquier persona con el enlace puede ver" e intenta de nuevo.'
      });
    }
    raw = String(resp.data || '');
  } catch (e) {
    logger.error(`[csv-import-url] download fail: ${e.message}`);
    return res.status(400).json({ error: 'No se pudo descargar el sheet: ' + e.message });
  }

  if (!raw || raw.length < 100) {
    return res.status(400).json({ error: 'El sheet descargado esta vacio o es muy chico' });
  }

  // Idempotencia: hash + early-return si ya procesado.
  const contentHash = crypto.createHash('sha256').update(raw).digest('hex');
  const existing = await JugayganaImport.findOne({ contentHash, status: 'completed' }).lean();
  if (existing) {
    return res.json({
      success: true,
      skipped: true,
      message: 'Esta version del sheet ya fue importada el ' + new Date(existing.uploadedAt).toLocaleString('es-AR') + '. No se reproceso.',
      importId: existing._id
    });
  }

  // Lanzar el procesamiento (mismo flow que el upload directo).
  _csvImportState = {
    running: true, total: 0, parsed: 0, valid: 0, skipped: 0,
    startedAt: new Date().toISOString(), finishedAt: null, importId: null
  };
  res.json({ success: true, state: _csvImportState, message: 'Sheet descargado, procesando en background...' });

  _processCsvBackground(raw, contentHash, req.user.username || null);
});

// VENTANA DE STATS = ultimos N dias rolling. Cuando subis CSVs incrementales
// (semana a semana), siempre se ven los ultimos 45 dias. Lo que cae fuera
// se ignora en los agregados (pero queda en DailyPlayerStats hasta el
// cleanup, que es 60 dias = 45 + buffer de 15).
const STATS_WINDOW_DAYS = 45;
const DAILY_CLEANUP_DAYS = 60;

// Trunca un timestamp ms al inicio del dia UTC. Asi (username, dateUtc)
// es siempre comparable y unico-por-dia.
function _utcStartOfDay(ms) {
  const d = new Date(ms);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

// Helper que centraliza el procesamiento — usado por upload directo y por
// import-csv-url. Estrategia rolling-window:
//   1. Parsear el CSV
//   2. Agrupar las transacciones por (username, dia)
//   3. Upsertear en DailyPlayerStats — incremental, no pisa otros dias
//   4. Recomputar PlayerStats sumando los ultimos 45 dias de DailyPlayerStats
//   5. Cleanup: borrar DailyPlayerStats > 60 dias
async function _processCsvBackground(raw, contentHash, uploadedBy) {
  const importDoc = await JugayganaImport.create({
    contentHash,
    uploadedBy,
    rawSizeBytes: raw.length,
    status: 'processing'
  });
  _csvImportState.importId = importDoc._id;

  try {
    const parsed = _parseJugayganaCsv(raw);
    _csvImportState.total = parsed.rows.length + parsed.skipped;
    _csvImportState.parsed = parsed.rows.length + parsed.skipped;
    _csvImportState.valid = parsed.rows.length;
    _csvImportState.skipped = parsed.skipped;

    // Agrupar por (username, dia UTC). Key: "username|dateMsUtc".
    const perUserDay = new Map();
    let minDate = Infinity, maxDate = -Infinity;
    let totalDC = 0, totalDS = 0, totalWC = 0, totalWS = 0, totalBC = 0, totalBS = 0;

    for (const r of parsed.rows) {
      const dayMs = _utcStartOfDay(r.dateMs).getTime();
      const key = r.username + '|' + dayMs;
      let agg = perUserDay.get(key);
      if (!agg) {
        agg = {
          username: r.username,
          dayMs,
          depositCount: 0, depositSum: 0,
          withdrawCount: 0, withdrawSum: 0,
          bonusCount: 0, bonusSum: 0
        };
        perUserDay.set(key, agg);
      }
      if (r.type === 'deposit') {
        agg.depositCount++; agg.depositSum += r.amount;
        totalDC++; totalDS += r.amount;
      } else if (r.type === 'withdraw') {
        agg.withdrawCount++; agg.withdrawSum += r.amount;
        totalWC++; totalWS += r.amount;
      } else if (r.type === 'bonus') {
        agg.bonusCount++; agg.bonusSum += r.amount;
        totalBC++; totalBS += r.amount;
      }
      if (r.dateMs < minDate) minDate = r.dateMs;
      if (r.dateMs > maxDate) maxDate = r.dateMs;
    }

    // Upsert por (username, dateUtc): suma a lo que ya hay si re-importas
    // datos del mismo dia. PERO si re-importas el MISMO archivo, el hash
    // ya bloqueo arriba — asi que llegamos aca solo con archivos nuevos
    // (parciales o de dias distintos). Estrategia: SET (no $inc) para que
    // cada upload sea idempotente para su periodo — si el CSV trae el dia
    // X completo, sobrescribe lo que habia para ese dia. Esto es correcto
    // porque JUGAYGANA exporta el "estado total" del dia, no incrementos.
    const ops = [];
    for (const agg of perUserDay.values()) {
      ops.push({
        updateOne: {
          filter: { username: agg.username, dateUtc: new Date(agg.dayMs) },
          update: {
            $set: {
              depositCount: agg.depositCount, depositSum: agg.depositSum,
              withdrawCount: agg.withdrawCount, withdrawSum: agg.withdrawSum,
              bonusCount: agg.bonusCount, bonusSum: agg.bonusSum,
              updatedAt: new Date()
            },
            $setOnInsert: { username: agg.username, dateUtc: new Date(agg.dayMs) }
          },
          upsert: true
        }
      });
      if (ops.length >= 500) {
        await DailyPlayerStats.bulkWrite(ops, { ordered: false });
        ops.length = 0;
      }
    }
    if (ops.length > 0) {
      await DailyPlayerStats.bulkWrite(ops, { ordered: false });
    }

    // Recomputar PlayerStats sumando ult. 45 dias de DailyPlayerStats.
    await _recomputeAllPlayerStatsFromDaily();

    // Cleanup de days > 60.
    const cleanupCutoff = _utcStartOfDay(Date.now() - DAILY_CLEANUP_DAYS * 24 * 3600 * 1000);
    const cleanupRes = await DailyPlayerStats.deleteMany({ dateUtc: { $lt: cleanupCutoff } });

    await JugayganaImport.updateOne(
      { _id: importDoc._id },
      {
        $set: {
          status: 'completed',
          totalRows: parsed.rows.length + parsed.skipped,
          validRows: parsed.rows.length,
          skippedRows: parsed.skipped,
          depositCount: totalDC, depositSum: totalDS,
          withdrawCount: totalWC, withdrawSum: totalWS,
          bonusCount: totalBC, bonusSum: totalBS,
          periodFrom: minDate < Infinity ? new Date(minDate) : null,
          periodTo: maxDate > -Infinity ? new Date(maxDate) : null,
          uniqueUsers: new Set(parsed.rows.map(r => r.username)).size,
          detectedFormat: {
            delimiter: parsed.delimiter,
            dateFormat: parsed.dateFormat,
            headerRow: parsed.headerRow
          }
        }
      }
    );

    await _resolvePendingRecoveryOutcomes();

    logger.info(`[csv-import] OK: ${parsed.rows.length} rows, ${perUserDay.size} user-days, cleanup deleted ${cleanupRes.deletedCount} old days`);
  } catch (e) {
    logger.error(`[csv-import] FAILED: ${e.message}\n${e.stack}`);
    await JugayganaImport.updateOne(
      { _id: importDoc._id },
      { $set: { status: 'failed', errorMsg: e.message } }
    );
  } finally {
    _csvImportState.running = false;
    _csvImportState.finishedAt = new Date().toISOString();
  }
}

// Suma los ultimos STATS_WINDOW_DAYS dias de DailyPlayerStats por usuario,
// recalcula tier/activityStatus/oportunista, persiste en PlayerStats.
// Se llama despues de cada CSV import.
async function _recomputeAllPlayerStatsFromDaily() {
  const cutoff = _utcStartOfDay(Date.now() - STATS_WINDOW_DAYS * 24 * 3600 * 1000);
  const NOW = Date.now();
  const dayMs = 24 * 3600 * 1000;

  // Agregar por usuario los ultimos N dias.
  const agg = await DailyPlayerStats.aggregate([
    { $match: { dateUtc: { $gte: cutoff } } },
    { $group: {
        _id: '$username',
        depositCount: { $sum: '$depositCount' },
        depositSum: { $sum: '$depositSum' },
        withdrawSum: { $sum: '$withdrawSum' },
        bonusCount: { $sum: '$bonusCount' },
        bonusSum: { $sum: '$bonusSum' },
        // Para "ultima carga real" buscamos el ultimo dia con depositCount > 0.
        lastDepositDay: {
          $max: {
            $cond: [{ $gt: ['$depositCount', 0] }, '$dateUtc', null]
          }
        }
    }}
  ]);

  const TIER = STATS_TIER_RULES;
  const ACT = STATS_ACTIVITY_DAYS;
  const ops = [];

  for (const u of agg) {
    const realDeposits = u.depositSum || 0;
    const realCount = u.depositCount || 0;
    const withdraws = u.withdrawSum || 0;
    const bonusGiven = u.bonusSum || 0;
    const bonusCount = u.bonusCount || 0;
    const lastDeposit = u.lastDepositDay || null;
    const daysSince = lastDeposit ? Math.floor((NOW - new Date(lastDeposit).getTime()) / dayMs) : null;
    const netToHouse = realDeposits - withdraws - bonusGiven;

    let tier = 'SIN_DATOS';
    if (realCount >= TIER.vipMinCharges && realDeposits >= TIER.vipMinAmount) tier = 'VIP';
    else if (realCount >= TIER.oroMinCharges && realDeposits >= TIER.oroMinAmount) tier = 'ORO';
    else if (realCount >= TIER.plataMinCharges || realDeposits >= TIER.plataMinAmount) tier = 'PLATA';
    else if (realCount >= TIER.bronceMinCharges) tier = 'BRONCE';

    let activityStatus = 'INACTIVO';
    if (daysSince == null) activityStatus = 'NUEVO';
    else if (daysSince <= ACT.activo) activityStatus = 'ACTIVO';
    else if (daysSince <= ACT.enRiesgo) activityStatus = 'EN_RIESGO';
    else if (daysSince <= ACT.perdido) activityStatus = 'PERDIDO';

    let bonusesWithoutDeposit = 0;
    if (bonusCount > 0 && realCount === 0) bonusesWithoutDeposit = bonusCount;
    else if (bonusCount > realCount * 2) bonusesWithoutDeposit = bonusCount - realCount;
    const isOpportunist = bonusesWithoutDeposit >= OPPORTUNIST_THRESHOLD;

    ops.push({
      updateOne: {
        filter: { username: u._id },
        update: {
          $set: {
            realDeposits30d: realDeposits,
            realChargesCount30d: realCount,
            withdraws30d: withdraws,
            bonusGiven30d: bonusGiven,
            bonusCount30d: bonusCount,
            netToHouse30d: netToHouse,
            lastRealDepositDate: lastDeposit,
            tier,
            activityStatus,
            bonusesClaimedWithoutDeposit30d: bonusesWithoutDeposit,
            isOpportunist,
            refreshedAt: new Date()
          },
          $setOnInsert: { username: u._id }
        },
        upsert: true
      }
    });
    if (ops.length >= 500) {
      await PlayerStats.bulkWrite(ops, { ordered: false });
      ops.length = 0;
    }
  }
  if (ops.length > 0) {
    await PlayerStats.bulkWrite(ops, { ordered: false });
  }

  // OPCIONAL: usuarios que estaban en PlayerStats pero ya no aparecen en
  // los ult. 45d (cayeron del todo) — los marcamos INACTIVO con valores 0.
  // Asi se ven en el segmento INACTIVO y no quedan stale con datos viejos.
  const aliveUsernames = agg.map(u => u._id);
  await PlayerStats.updateMany(
    { username: { $nin: aliveUsernames } },
    {
      $set: {
        realDeposits30d: 0, realChargesCount30d: 0, withdraws30d: 0,
        bonusGiven30d: 0, bonusCount30d: 0, netToHouse30d: 0,
        activityStatus: 'INACTIVO', tier: 'SIN_DATOS',
        refreshedAt: new Date()
      }
    }
  );
}

// ============================================
// GET /api/admin/reports/top-engagement
// Top usuarios por interaccion: cuentas y montos de
//   - reembolsos reclamados (RefundClaim)
//   - clicks en cartel WhatsApp (WaClickLog)
//   - regalos de difusion reclamados (MoneyGiveawayClaim)
// + score combinado para ordenar.
//
// Devuelve top 100 por score combinado, con todos los breakdowns.
// El frontend permite re-ordenar por cada metrica.
// ============================================
app.get('/api/admin/reports/top-engagement', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    // 1) Refunds: agrupar por username, sumar count y amount (excluyendo
    //    rows pendientes de credit que no llegaron a acreditar).
    const refundAgg = await RefundClaim.aggregate([
      { $match: { status: { $ne: 'pending_credit_failed' } } },
      {
        $group: {
          _id: { $toLower: '$username' },
          username: { $first: '$username' },
          refundCount: { $sum: 1 },
          refundTotal: { $sum: '$amount' },
          lastRefundAt: { $max: '$claimedAt' }
        }
      }
    ]);

    // 2) WA clicks: agrupar por username.
    const waAgg = await WaClickLog.aggregate([
      {
        $group: {
          _id: { $toLower: '$username' },
          username: { $first: '$username' },
          waClickCount: { $sum: 1 },
          lastWaClickAt: { $max: '$clickedAt' }
        }
      }
    ]);

    // 3) Giveaway claims: agrupar por username (excluye pending_credit_failed).
    const gAgg = await MoneyGiveawayClaim.aggregate([
      { $match: { status: { $ne: 'pending_credit_failed' } } },
      {
        $group: {
          _id: { $toLower: '$username' },
          username: { $first: '$username' },
          giveawayCount: { $sum: 1 },
          giveawayTotal: { $sum: '$amount' },
          lastGiveawayAt: { $max: '$claimedAt' }
        }
      }
    ]);

    // Merge en una map por username (lowercased).
    const map = new Map();
    const ensure = (key, username) => {
      if (!map.has(key)) {
        map.set(key, {
          username: username || key,
          refundCount: 0, refundTotal: 0, lastRefundAt: null,
          waClickCount: 0, lastWaClickAt: null,
          giveawayCount: 0, giveawayTotal: 0, lastGiveawayAt: null
        });
      }
      return map.get(key);
    };
    for (const r of refundAgg) {
      const o = ensure(r._id, r.username);
      o.refundCount = r.refundCount;
      o.refundTotal = r.refundTotal;
      o.lastRefundAt = r.lastRefundAt;
    }
    for (const r of waAgg) {
      const o = ensure(r._id, r.username);
      o.waClickCount = r.waClickCount;
      o.lastWaClickAt = r.lastWaClickAt;
    }
    for (const r of gAgg) {
      const o = ensure(r._id, r.username);
      o.giveawayCount = r.giveawayCount;
      o.giveawayTotal = r.giveawayTotal;
      o.lastGiveawayAt = r.lastGiveawayAt;
    }

    // Score combinado para ranking default. Pesos:
    // - cada reembolso vale 2 puntos (esfuerzo recurrente)
    // - cada click WA vale 1 (intencion de carga)
    // - cada giveaway vale 3 (alta interaccion + cobra de inmediato)
    const list = Array.from(map.values()).map(u => ({
      ...u,
      lastActivityAt: [u.lastRefundAt, u.lastWaClickAt, u.lastGiveawayAt]
        .filter(Boolean)
        .map(d => new Date(d).getTime())
        .reduce((a, b) => Math.max(a, b), 0) || null,
      score: u.refundCount * 2 + u.waClickCount * 1 + u.giveawayCount * 3
    }));

    list.sort((a, b) => b.score - a.score);
    const top = list.slice(0, 100);

    res.json({
      generatedAt: new Date().toISOString(),
      totalUniqueUsers: list.length,
      top
    });
  } catch (error) {
    logger.error(`/api/admin/reports/top-engagement error: ${error.message}`);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// GET admin: lista paginada del historial de notificaciones.
// Query: ?limit=50&type=plain|whatsapp_promo|money_giveaway
app.get('/api/admin/notifications/history', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(200, parseInt(req.query.limit, 10) || 50));
    const filter = {};
    if (req.query.type && ['plain', 'whatsapp_promo', 'money_giveaway'].includes(req.query.type)) {
      filter.type = req.query.type;
    }
    const list = await NotificationHistory.find(filter)
      .sort({ sentAt: -1 })
      .limit(limit)
      .lean();
    res.json({ count: list.length, items: list });
  } catch (error) {
    logger.error(`/api/admin/notifications/history error: ${error.message}`);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// POST admin: crear o reemplazar el promo activo.
// Body: { message, code, durationHours, prefix?, notificationHistoryId? }
// notificationHistoryId vincula la promo con el row del historial para
// que los waClicks que se trackeen sumen al row correcto.
app.post('/api/admin/promo-alert', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { message, code, durationHours, prefix, notificationHistoryId } = req.body || {};
    const msg = String(message || '').trim().slice(0, 200);
    const codeNorm = _normalizePromoCode(code);
    const hours = Number(durationHours);
    if (!msg) return res.status(400).json({ error: 'Mensaje requerido' });
    if (!codeNorm) return res.status(400).json({ error: 'Código requerido (solo letras, números, _ y -)' });
    if (!isFinite(hours) || hours <= 0 || hours > 168) {
      return res.status(400).json({ error: 'Duración inválida (entre 1 y 168 horas)' });
    }
    const now = new Date();
    const expires = new Date(now.getTime() + hours * 3600 * 1000);
    const promo = {
      id: uuidv4(),
      message: msg,
      code: codeNorm,
      expiresAt: expires.toISOString(),
      createdAt: now.toISOString(),
      createdBy: req.user.username || null,
      prefix: prefix && typeof prefix === 'string' && prefix.trim() ? prefix.trim() : null,
      notificationHistoryId: notificationHistoryId || null
    };
    await setConfig(PROMO_ALERT_KEY, promo);
    res.json({ success: true, promo });
  } catch (error) {
    logger.error(`POST /api/admin/promo-alert error: ${error.message}`);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// GET admin: ver el promo activo (sin filtro por prefix, ve todo).
app.get('/api/admin/promo-alert', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const promo = await getConfig(PROMO_ALERT_KEY, null);
    if (!promo) return res.json({ promo: null });
    const expiresAtMs = promo.expiresAt ? new Date(promo.expiresAt).getTime() : 0;
    const expired = !isFinite(expiresAtMs) || expiresAtMs <= Date.now();
    res.json({ promo, expired });
  } catch (error) {
    logger.error(`GET /api/admin/promo-alert error: ${error.message}`);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// DELETE admin: cancelar el promo activo (lo borra del config).
app.delete('/api/admin/promo-alert', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    await setConfig(PROMO_ALERT_KEY, null);
    res.json({ success: true });
  } catch (error) {
    logger.error(`DELETE /api/admin/promo-alert error: ${error.message}`);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================
// BASE DE DATOS - SOLO ADMIN PRINCIPAL
// ============================================

app.get('/api/admin/database', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Acceso denegado. Solo el administrador principal puede acceder.' });
    }
    
    const users = await User.find().select('-password').lean();
    const totalMessages = await Message.countDocuments();
    
    const adminRoles = ['admin', 'depositor', 'withdrawer'];
    const totalAdmins = users.filter(u => adminRoles.includes(u.role)).length;
    
    res.json({
      users,
      totalUsers: users.length,
      totalAdmins,
      totalMessages
    });
  } catch (error) {
    console.error('Error obteniendo base de datos:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================
// TRANSACCIONES
// ============================================

app.get('/api/admin/transactions', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { from, to, type, username } = req.query;
    
    let query = {};
    
    // Manejo de fechas — las fechas recibidas (YYYY-MM-DD) se interpretan en
    // horario argentino (ART = UTC-3, sin DST).
    // 00:00 ART = 03:00 UTC del mismo día.
    // 23:59:59 ART = 02:59:59 UTC del día siguiente.
    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    if (from || to) {
      query.timestamp = {};
      if (from) {
        if (!DATE_RE.test(from)) return res.status(400).json({ error: 'Formato de fecha inválido para "from" (esperado YYYY-MM-DD)' });
        // Inicio del día en Argentina: 00:00 ART = 03:00 UTC
        const fromDate = new Date(from + 'T03:00:00.000Z');
        query.timestamp.$gte = fromDate;
      }
      if (to) {
        if (!DATE_RE.test(to)) return res.status(400).json({ error: 'Formato de fecha inválido para "to" (esperado YYYY-MM-DD)' });
        // Fin del día en Argentina: 23:59:59.999 ART = inicio del día siguiente 03:00 UTC - 1ms
        const toDate = new Date(to + 'T03:00:00.000Z');
        toDate.setTime(toDate.getTime() + 24 * 60 * 60 * 1000 - 1);
        query.timestamp.$lte = toDate;
      }
    }
    
    if (type && type !== 'all') {
      query.type = type;
    }

    // Req 8: Filtrar por username si se especifica
    if (username && username.trim()) {
      // Limitar longitud y escapar caracteres especiales de regex para evitar ReDoS / injection
      const rawUsername = username.trim().substring(0, 100);
      const safeUsername = rawUsername.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.username = { $regex: safeUsername, $options: 'i' };
    }
    
    // Obtener todas las transacciones sin límite para el cierre
    const transactions = await Transaction.find(query)
      .sort({ timestamp: -1 })
      .lean();
    
    // Calcular totales (req 7: incluir fire_reward en bonificaciones)
    let deposits = 0;
    let withdrawals = 0;
    let bonuses = 0;
    let refunds = 0;
    let fireRewards = 0;
    
    transactions.forEach(t => {
      const amount = t.amount || 0;
      switch(t.type) {
        case 'deposit':
          deposits += amount;
          break;
        case 'withdrawal':
          withdrawals += amount;
          break;
        case 'bonus':
          bonuses += amount;
          break;
        case 'refund':
          refunds += amount;
          break;
        case 'fire_reward':
          fireRewards += amount;
          break;
      }
    });
    
    // Saldo neto = depósitos - retiros (bonos y reembolsos no afectan)
    const netBalance = deposits - withdrawals;
    
    // Resumen completo
    const summary = {
      deposits,
      withdrawals,
      bonuses,
      refunds,
      fireRewards,
      netBalance,
      totalTransactions: transactions.length
    };
    
    res.json({
      transactions,
      summary,
      dateRange: { from, to }
    });
  } catch (error) {
    console.error('Error obteniendo transacciones:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================
// ESTADÍSTICAS
// ============================================

let _cachedAdminStats = { data: null, lastUpdate: 0 };
const _STATS_CACHE_TTL = 60000; // 60 seconds

app.get('/api/admin/stats', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const now = Date.now();
    if (_cachedAdminStats.data && now - _cachedAdminStats.lastUpdate < _STATS_CACHE_TTL) {
      return res.json(_cachedAdminStats.data);
    }
    const totalUsers = await User.countDocuments();
    const onlineUsers = await User.countDocuments({ lastLogin: { $gte: new Date(Date.now() - 5 * 60 * 1000) } });
    const totalMessages = await Message.countDocuments();
    const totalTransactions = await Transaction.countDocuments();
    
    // Transacciones de hoy
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayTransactions = await Transaction.find({ timestamp: { $gte: today } }).lean();
    
    let todayDeposits = 0;
    let todayWithdrawals = 0;
    todayTransactions.forEach(t => {
      if (t.type === 'deposit') todayDeposits += t.amount;
      if (t.type === 'withdrawal') todayWithdrawals += t.amount;
    });
    
    const result = { totalUsers, onlineUsers, totalMessages, totalTransactions, todayDeposits, todayWithdrawals };
    _cachedAdminStats.data = result;
    _cachedAdminStats.lastUpdate = now;
    res.json(result);
  } catch (error) {
    console.error('Error obteniendo estadísticas:', error);
    if (_cachedAdminStats.data) {
      return res.json({ ..._cachedAdminStats.data, cached: true });
    }
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================
// DATOS - Métricas de adquisición, actividad y recurrencia
// ============================================

app.get('/api/admin/datos', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    // Argentina es UTC-3 todo el año
    const ART_OFFSET_MS = 3 * 60 * 60 * 1000;

    let startUTC, endUTC, periodLabel, isSingleDay = true;

    if (req.query.dateFrom && req.query.dateTo) {
      // Rango de fechas YYYY-MM-DD en ART
      const [fy, fm, fd] = req.query.dateFrom.split('-').map(Number);
      const [ty, tm, td] = req.query.dateTo.split('-').map(Number);
      if (!fy || !fm || !fd || !ty || !tm || !td) {
        return res.status(400).json({ error: 'Formato de fecha inválido. Use YYYY-MM-DD.' });
      }
      startUTC = new Date(Date.UTC(fy, fm - 1, fd, 3, 0, 0, 0));
      endUTC   = new Date(Date.UTC(ty, tm - 1, td, 3, 0, 0, 0) + 24 * 60 * 60 * 1000 - 1);
      periodLabel = `${req.query.dateFrom} → ${req.query.dateTo}`;
      isSingleDay = false;
    } else if (req.query.date) {
      // Fecha exacta YYYY-MM-DD en ART
      const [year, month, day] = req.query.date.split('-').map(Number);
      if (!year || !month || !day) {
        return res.status(400).json({ error: 'Formato de fecha inválido. Use YYYY-MM-DD.' });
      }
      startUTC = new Date(Date.UTC(year, month - 1, day, 3, 0, 0, 0)); // ART 00:00 = UTC 03:00
      endUTC   = new Date(startUTC.getTime() + 24 * 60 * 60 * 1000 - 1);
      periodLabel = req.query.date;
    } else {
      const period = req.query.period || 'today';
      const nowUTC = Date.now();
      const todayART = new Date(nowUTC - ART_OFFSET_MS);
      todayART.setUTCHours(0, 0, 0, 0);
      const todayStartUTC = new Date(todayART.getTime() + ART_OFFSET_MS);

      if (period === 'yesterday') {
        startUTC    = new Date(todayStartUTC.getTime() - 24 * 60 * 60 * 1000);
        endUTC      = new Date(todayStartUTC.getTime() - 1);
        periodLabel = 'Ayer';
      } else if (period === 'last7') {
        startUTC    = new Date(todayStartUTC.getTime() - 6 * 24 * 60 * 60 * 1000);
        endUTC      = new Date(todayStartUTC.getTime() + 24 * 60 * 60 * 1000 - 1);
        periodLabel = 'Últimos 7 días';
        isSingleDay = false;
      } else if (period === 'last30') {
        startUTC    = new Date(todayStartUTC.getTime() - 29 * 24 * 60 * 60 * 1000);
        endUTC      = new Date(todayStartUTC.getTime() + 24 * 60 * 60 * 1000 - 1);
        periodLabel = 'Últimos 30 días';
        isSingleDay = false;
      } else {
        // today (default)
        startUTC    = todayStartUTC;
        endUTC      = new Date(todayStartUTC.getTime() + 24 * 60 * 60 * 1000 - 1);
        periodLabel = 'Hoy';
      }
    }

    // Consultas paralelas
    const [registeredCount, depositStats, neverDepositedResult] = await Promise.all([

      // Bloque A: usuarios role:'user' creados en el período
      User.countDocuments({ createdAt: { $gte: startUTC, $lte: endUTC }, role: 'user' }),

      // Bloques B + C + D: análisis completo de depósitos
      Transaction.aggregate([
        // 1. Depósitos del período
        { $match: { type: 'deposit', timestamp: { $gte: startUTC, $lte: endUTC } } },

        // 2. Agrupar por usuario: operaciones y monto en el período
        { $group: {
          _id: '$username',
          periodDepositCount:  { $sum: 1 },
          periodDepositAmount: { $sum: '$amount' }
        }},

        // 3. Buscar si el usuario tuvo depósitos ANTERIORES al período
        { $lookup: {
          from: 'transactions',
          let: { uname: '$_id' },
          pipeline: [
            { $match: { $expr: { $and: [
              { $eq: ['$type', 'deposit'] },
              { $eq: ['$username', '$$uname'] },
              { $lt: ['$timestamp', startUTC] }
            ]}}}
          ],
          as: 'priorDeposits'
        }},

        // 4. Clasificar: ¿primera vez o recurrente? ¿depositó 2+ veces en el período?
        { $addFields: {
          isFirstTime: { $eq: [{ $size: '$priorDeposits' }, 0] },
          hasMultiple: { $gte: ['$periodDepositCount', 2] }
        }},

        // 5. Totales
        { $group: {
          _id:                  null,
          totalDeposits:        { $sum: '$periodDepositCount' },
          totalAmount:          { $sum: '$periodDepositAmount' },
          uniqueDepositors:     { $sum: 1 },
          firstTimeDeposits:    { $sum: { $cond: ['$isFirstTime', '$periodDepositCount', 0] } },
          firstTimeAmount:      { $sum: { $cond: ['$isFirstTime', '$periodDepositAmount', 0] } },
          firstTimeUsers:       { $sum: { $cond: ['$isFirstTime', 1, 0] } },
          returningDeposits:    { $sum: { $cond: ['$isFirstTime', 0, '$periodDepositCount'] } },
          returningAmount:      { $sum: { $cond: ['$isFirstTime', 0, '$periodDepositAmount'] } },
          returningUsers:       { $sum: { $cond: ['$isFirstTime', 0, 1] } },
          multipleDepositUsers: { $sum: { $cond: ['$hasMultiple', 1, 0] } }
        }}
      ]),

      // Bloque A: usuarios registrados en el período que NUNCA han depositado
      User.aggregate([
        { $match: { createdAt: { $gte: startUTC, $lte: endUTC }, role: 'user' } },
        { $lookup: {
          from: 'transactions',
          let: { uname: '$username' },
          pipeline: [
            { $match: { $expr: { $and: [
              { $eq: ['$type', 'deposit'] },
              { $eq: ['$username', '$$uname'] }
            ]}}}
          ],
          as: 'allDeposits'
        }},
        { $match: { allDeposits: { $size: 0 } } },
        { $count: 'total' }
      ])
    ]);

    const ds = depositStats[0] || {
      totalDeposits: 0, totalAmount: 0, uniqueDepositors: 0,
      firstTimeDeposits: 0, firstTimeAmount: 0, firstTimeUsers: 0,
      returningDeposits: 0, returningAmount: 0, returningUsers: 0,
      multipleDepositUsers: 0
    };
    const neverDeposited = neverDepositedResult[0] ? neverDepositedResult[0].total : 0;

    // Métricas derivadas (null si sin datos suficientes)
    const conversionRate     = registeredCount > 0       ? Math.round((ds.firstTimeUsers  / registeredCount)      * 1000) / 10 : null;
    const depositFrequency   = ds.uniqueDepositors > 0   ? Math.round((ds.totalDeposits   / ds.uniqueDepositors)  * 100)  / 100 : null;
    const avgTicket          = ds.totalDeposits > 0      ? Math.round( ds.totalAmount      / ds.totalDeposits)              : null;
    const avgPerDepositor    = ds.uniqueDepositors > 0   ? Math.round( ds.totalAmount      / ds.uniqueDepositors)           : null;
    const returningPct       = ds.uniqueDepositors > 0   ? Math.round((ds.returningUsers   / ds.uniqueDepositors)  * 1000) / 10 : null;
    const repeatRate         = ds.uniqueDepositors > 0   ? Math.round((ds.multipleDepositUsers / ds.uniqueDepositors) * 1000) / 10 : null;

    // Req 10: Retención de usuarios — usuarios únicos que depositaron en los últimos N días
    const nowUTC2 = new Date();
    const retentionDays = [3, 7, 15, 30];
    const retentionCounts = await Promise.all(retentionDays.map(days => {
      const since = new Date(nowUTC2.getTime() - days * 24 * 60 * 60 * 1000);
      return Transaction.distinct('username', { type: 'deposit', timestamp: { $gte: since } })
        .then(users => users.length)
        .catch(() => null);
    }));

    const retention = {
      users3d:  retentionCounts[0],
      users7d:  retentionCounts[1],
      users15d: retentionCounts[2],
      users30d: retentionCounts[3]
    };

    res.json({
      status: 'success',
      data: {
        period: { label: periodLabel, startUTC, endUTC, isSingleDay },

        // Bloque A — Adquisición
        acquisition: {
          registeredUsers:          registeredCount,
          firstDepositUsers:        ds.firstTimeUsers,
          conversionRate,
          registeredNeverDeposited: neverDeposited
        },

        // Bloque B — Actividad de depósitos
        depositActivity: {
          totalDeposits:          ds.totalDeposits,
          uniqueDepositors:       ds.uniqueDepositors,
          firstTimeDeposits:      ds.firstTimeDeposits,
          firstTimeDepositUsers:  ds.firstTimeUsers,
          returningDeposits:      ds.returningDeposits,
          returningDepositUsers:  ds.returningUsers,
          depositFrequency
        },

        // Bloque C — Calidad económica
        economicQuality: {
          totalAmount:      ds.totalAmount,
          avgTicket,
          avgPerDepositor,
          firstTimeAmount:  ds.firstTimeAmount,
          returningAmount:  ds.returningAmount
        },

        // Bloque D — Recurrencia
        recurrence: {
          activeReturningUsers: ds.returningUsers,
          returningPct,
          multipleDepositUsers: ds.multipleDepositUsers,
          repeatRate
        },

        // Bloque E — Retención (usuarios únicos activos en últimos N días, siempre en tiempo real)
        retention
      }
    });
  } catch (error) {
    console.error('Error obteniendo datos:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================
// NUEVO PANEL DE ADMIN - ENDPOINTS ADICIONALES
// ============================================

// Cambiar contraseña de usuario (admin) - CON PERMISOS POR ROL
app.post('/api/admin/change-password', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { userId, newPassword } = req.body;
    const adminRole = req.user.role;
    
    if (!userId || !newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'Datos inválidos. La contraseña debe tener al menos 6 caracteres.' });
    }
    
    const user = await User.findOne({ id: userId });
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    
    // PERMISOS POR ROL:
    // - Admin general: puede cambiar contraseña de TODOS incluyendo admins
    // - Admin depositor: puede cambiar contraseña de usuarios pero NO de admins
    // - Admin withdrawer: NO puede cambiar contraseñas
    
    if (adminRole === 'withdrawer') {
      return res.status(403).json({ error: 'No tienes permiso para cambiar contraseñas' });
    }
    
    if (adminRole === 'depositor' && user.role !== 'user') {
      return res.status(403).json({ error: 'Solo puedes cambiar contraseñas de usuarios, no de administradores' });
    }
    
    user.password = newPassword;
    user.passwordChangedAt = new Date();
    await user.save();
    
    // Solo enviar mensaje y sincronizar con JUGAYGANA si el objetivo es un usuario regular (no admin)
    if (user.role === 'user') {
      // Enviar mensaje al usuario
      await Message.create({
        id: uuidv4(),
        senderId: req.user.userId,
        senderUsername: req.user.username,
        senderRole: 'admin',
        receiverId: userId,
        receiverRole: 'user',
        content: `🔑 Tu contraseña ha sido cambiada por un administrador.\n\nTu nueva contraseña es: ${newPassword}\n\nPor seguridad, te recomendamos cambiarla después de iniciar sesión.`,
        type: 'text',
        timestamp: new Date(),
        read: false
      });
      
      // Notificar por socket
      const userSocket = connectedUsers.get(userId);
      if (userSocket) {
        userSocket.emit('new_message', {
          senderId: req.user.userId,
          senderUsername: req.user.username,
          content: 'Tu contraseña ha sido cambiada por un administrador.',
          timestamp: new Date()
        });
      }

      await syncPasswordToJugaygana(user, newPassword, `admin-change-password by ${req.user.username}`);
    } else {
      // Para admins: solo cambiar localmente, NO sincronizar con JUGAYGANA
      console.log(`✅ [Admin] Contraseña de admin cambiada localmente para: ${user.username}`);
    }
    
    res.json({ success: true, message: 'Contraseña cambiada correctamente' });
  } catch (error) {
    console.error('Error cambiando contraseña:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Cambiar contraseña propia del admin logueado (sin tocar JUGAYGANA)
app.post('/api/admin/change-own-password', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const adminUserId = req.user.userId;

    if (!currentPassword || !newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'Datos inválidos. La contraseña debe tener al menos 6 caracteres.' });
    }

    const admin = await User.findOne({ id: adminUserId });
    if (!admin) {
      return res.status(404).json({ error: 'Admin no encontrado' });
    }

    // Verificar contraseña actual
    const isMatch = await bcrypt.compare(currentPassword, admin.password);
    if (!isMatch) {
      return res.status(400).json({ error: 'La contraseña actual es incorrecta' });
    }

    admin.password = newPassword;
    admin.passwordChangedAt = new Date();
    admin.mustChangePassword = false;
    await admin.save();

    logger.info(`Admin ${admin.username} cambió su propia contraseña`);
    res.json({ success: true, message: 'Contraseña cambiada correctamente' });
  } catch (error) {
    console.error('Error cambiando contraseña de admin:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================
// BLOQUEO / DESBLOQUEO DE USUARIOS
// ============================================

app.post('/api/admin/users/:id/block', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    // Pueden bloquear: admin general y depositor (los que están en el chat).
    // Withdrawer no, para no darle a una sola persona poder de cortar accesos.
    if (!['admin', 'depositor'].includes(req.user.role)) {
      return res.status(403).json({ error: 'No tenés permiso para bloquear usuarios.' });
    }

    if (!reason || typeof reason !== 'string' || reason.trim().length < 5) {
      return res.status(400).json({ error: 'El motivo es obligatorio (mínimo 5 caracteres).' });
    }

    const user = await User.findOne({ id });
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });

    if (isAdminRole(user.role)) {
      return res.status(403).json({ error: 'No se pueden bloquear cuentas administrativas.' });
    }

    user.isBlocked = true;
    user.blockReason = reason.trim().slice(0, MAX_BLOCK_REASON_LENGTH);
    user.blockedAt = new Date();
    user.blockedBy = req.user.username;
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();

    logger.info(`Admin ${req.user.username} bloqueó a ${user.username}: ${user.blockReason}`);
    res.json({ success: true, message: `Usuario ${user.username} bloqueado.` });
  } catch (e) {
    logger.error(`Error en block: ${e.message}`);
    res.status(500).json({ error: 'Error del servidor.' });
  }
});

app.post('/api/admin/users/:id/unblock', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    if (!['admin', 'depositor'].includes(req.user.role)) {
      return res.status(403).json({ error: 'No tenés permiso para desbloquear usuarios.' });
    }
    const user = await User.findOne({ id });
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });

    user.isBlocked = false;
    user.blockReason = null;
    user.blockedAt = null;
    user.blockedBy = null;
    await user.save();

    logger.info(`Admin ${req.user.username} desbloqueó a ${user.username}`);
    res.json({ success: true, message: `Usuario ${user.username} desbloqueado.` });
  } catch (e) {
    logger.error(`Error en unblock: ${e.message}`);
    res.status(500).json({ error: 'Error del servidor.' });
  }
});

// Enviar chat a cargas (antes "pagos")
app.post('/api/admin/send-to-payments', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: 'Usuario no especificado' });
    }
    
    // Todos los admins (admin, depositor, withdrawer) pueden enviar a cargas
    
    // Actualizar estado del chat a CARGAS (antes "payments")
    await ChatStatus.findOneAndUpdate(
      { userId },
      { 
        status: 'payments',
        category: 'payments',
        assignedTo: null,
        updatedAt: new Date()
      },
      { upsert: true }
    );
    
    // Enviar mensaje al usuario
    await Message.create({
      id: uuidv4(),
      senderId: req.user.userId,
      senderUsername: req.user.username,
      senderRole: 'admin',
      receiverId: userId,
      receiverRole: 'user',
      content: '💳 Tu chat ha sido transferido al departamento de PAGOS. Un agente especializado te atenderá pronto.\n\nPor favor para agilizar el tiempo envie monto a retirar y cvu por favor!',
      type: 'text',
      timestamp: new Date(),
      read: false
    });
    
    // Notificar a admins
    notifyAdmins('chat_moved', { userId, to: 'payments', by: req.user.username });
    
    res.json({ success: true, message: 'Chat enviado a cargas' });
  } catch (error) {
    console.error('Error enviando a cargas:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Enviar chat de vuelta a Abiertos (desde Pagos o Cerrados)
app.post('/api/admin/send-to-open', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'Usuario no especificado' });
    }

    // Withdrawer no puede enviar a abiertos
    if (req.user.role === 'withdrawer') {
      return res.status(403).json({ error: 'No tienes permisos para esta acción' });
    }

    // Al mover a Abiertos: resetear categoría a 'cargas' (pool general)
    // y liberar asignación para que cualquier agente pueda tomar el chat
    await ChatStatus.findOneAndUpdate(
      { userId },
      {
        status: 'open',
        category: 'cargas',
        assignedTo: null,
        closedAt: null,
        closedBy: null,
        updatedAt: new Date()
      },
      { upsert: true }
    );

    notifyAdmins('chat_moved', { userId, to: 'open', by: req.user.username });

    res.json({ success: true, message: 'Chat enviado a abiertos' });
  } catch (error) {
    console.error('Error enviando a abiertos:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Cerrar chat - SOLO INTERNO (no notifica al cliente)
app.post('/api/admin/close-chat', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { userId, notifyClient = false, isPaymentsTab = false } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: 'Usuario no especificado' });
    }
    
    // Actualizar estado del chat
    await ChatStatus.findOneAndUpdate(
      { userId },
      { 
        status: 'closed',
        assignedTo: null,
        closedAt: new Date(),
        closedBy: req.user.userId,
        updatedAt: new Date()
      },
      { upsert: true }
    );
    
    // Fix #3: Crear mensaje de sistema interno (solo visible para admins, persiste en historial)
    await Message.create({
      id: uuidv4(),
      senderId: req.user.userId,
      senderUsername: req.user.username,
      senderRole: req.user.role || 'admin',
      receiverId: userId,
      receiverRole: 'user',
      content: `Chat cerrado por: ${req.user.username}. Puedes seguir respondiendo si el usuario escribe. El chat se reabrirá automáticamente si el cliente envía un mensaje.`,
      type: 'system',
      adminOnly: true,
      read: true,
      timestamp: new Date()
    });
    
    // Notificar a admins (siempre, es interno)
    notifyAdmins('chat_closed', { userId, by: req.user.username, adminId: req.user.userId, isPaymentsTab });
    
    res.json({ success: true, message: 'Chat cerrado correctamente', closedBy: req.user.username });
  } catch (error) {
    console.error('Error cerrando chat:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Obtener conversaciones para el nuevo panel
// OPTIMIZADO: Una sola query con agregación
app.get('/api/admin/conversations', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    let { status = 'open' } = req.query;
    
    const userRole = req.user.role;
    
    if (userRole === 'depositor' && status === 'payments') {
      return res.status(403).json({ error: 'Acceso denegado. Los depositores no pueden ver chats de pagos.' });
    }
    
    if (userRole === 'withdrawer' && status !== 'payments') {
      return res.status(403).json({ error: 'Acceso denegado. Los withdrawers solo pueden ver chats de pagos.' });
    }
    
    // AGREGACIÓN OPTIMIZADA: Todo en una sola query
    const pipeline = [
      { $match: { status } },
      { $sort: { lastMessageAt: -1 } },
      { $limit: 100 },
      {
        $lookup: {
          from: 'users',
          localField: 'userId',
          foreignField: 'id',
          as: 'user'
        }
      },
      { $unwind: { path: '$user', preserveNullAndEmptyArrays: false } },
      {
        $lookup: {
          from: 'messages',
          let: { uid: '$userId' },
          pipeline: [
            { $match: { $expr: { $and: [
              { $eq: ['$receiverId', 'admin'] },
              { $eq: ['$senderId', '$$uid'] },
              { $eq: ['$read', false] }
            ]}}},
            { $count: 'count' }
          ],
          as: 'unread'
        }
      },
      {
        $lookup: {
          from: 'messages',
          let: { uid: '$userId' },
          pipeline: [
            { $match: { $expr: { $or: [
              { $eq: ['$senderId', '$$uid'] },
              { $eq: ['$receiverId', '$$uid'] }
            ]}}},
            { $sort: { timestamp: -1 } },
            { $limit: 1 },
            { $project: { content: 1, timestamp: 1 } }
          ],
          as: 'lastMsg'
        }
      },
      {
        $project: {
          userId: 1,
          username: '$user.username',
          balance: { $ifNull: ['$user.balance', 0] },
          online: { $gt: [{ $ifNull: ['$user.lastLogin', new Date(0)] }, { $subtract: [new Date(), 300000] }] },
          unread: { $ifNull: [{ $arrayElemAt: ['$unread.count', 0] }, 0] },
          lastMessage: { $arrayElemAt: ['$lastMsg.content', 0] },
          lastMessageAt: { $ifNull: ['$lastMessageAt', '$updatedAt', new Date()] },
          status: 1
        }
      }
    ];
    
    const conversations = await ChatStatus.aggregate(pipeline);
    
    res.json({ conversations });
  } catch (error) {
    console.error('Error obteniendo conversaciones:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Obtener información de usuario específico
app.get('/api/users/:userId', authMiddleware, async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Only admins or the user themselves can fetch a user profile
    const adminRoles = ['admin', 'depositor', 'withdrawer'];
    if (!adminRoles.includes(req.user.role) && req.user.userId !== userId) {
      return res.status(403).json({ error: 'Acceso denegado' });
    }
    
    const user = await User.findOne({ id: userId }).select('-password').lean();
    
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    
    res.json({ user });
  } catch (error) {
    console.error('Error obteniendo usuario:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================
// GESTIÓN DE CBU
// ============================================

// Obtener CBU actual
app.get('/api/admin/cbu', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const cbuConfig = await getConfig('cbu');
    res.json(cbuConfig || { bank: '', titular: '', number: '', alias: '' });
  } catch (error) {
    console.error('Error obteniendo CBU:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Actualizar CBU
app.post('/api/admin/cbu', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    // Solo el admin principal puede cambiar el CBU.
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Solo el administrador principal puede modificar el CBU' });
    }

    const { bank, titular, number, alias } = req.body;

    if (!number || number.length < 10) {
      return res.status(400).json({ error: 'CBU inválido' });
    }

    await setConfig('cbu', { bank, titular, number, alias });
    logger.info(`Admin ${req.user.username} replaced CBU config`);
    res.json({ success: true, message: 'CBU actualizado correctamente' });
  } catch (error) {
    console.error('Error actualizando CBU:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================
// GESTIÓN DE USUARIOS (ADMIN)
// ============================================

// Obtener todos los usuarios
app.get('/api/admin/users', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const userRole = req.user.role;
    
    // Construir query según rol
    let query = {};
    if (userRole !== 'admin') {
      // Depositor y withdrawer solo ven usuarios (no admins)
      query.role = 'user';
    }
    // Admin general ve TODOS (usuarios y admins)
    
    const users = await User.find(query).select('-password').sort({ role: 1, username: 1 }).lean();
    res.json({ users });
  } catch (error) {
    console.error('Error obteniendo usuarios:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Crear usuario o admin
app.post('/api/admin/users', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { username, password, email, phone, role = 'user' } = req.body;
    const adminRole = req.user.role;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
    }
    
    if (password.length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }
    
    // Validar rol
    const validRoles = ['user', 'admin', 'depositor', 'withdrawer'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: 'Rol inválido' });
    }
    
    // Restricciones de rol para crear usuarios
    if (adminRole !== 'admin' && role !== 'user') {
      return res.status(403).json({ error: 'Solo el administrador general puede crear otros administradores' });
    }
    
    // Verificar si el usuario ya existe
    const existingUser = await User.findOne({ username: { $regex: new RegExp('^' + escapeRegex(username) + '$', 'i') } });
    if (existingUser) {
      return res.status(400).json({ error: 'El usuario ya existe' });
    }
    
    const userId = uuidv4();
    
    const newUser = await User.create({
      id: userId,
      username,
      password: password,
      email: email || null,
      phone: phone || null,
      role,
      accountNumber: generateAccountNumber(),
      balance: 0,
      createdAt: new Date(),
      lastLogin: null,
      isActive: true,
      jugayganaUserId: null,
      jugayganaUsername: null,
      jugayganaSyncStatus: role === 'user' ? 'pending' : 'not_applicable'
    });
    
    // Si es usuario normal, crear chat status
    if (role === 'user') {
      await ChatStatus.create({
        userId: userId,
        username: username,
        status: 'open',
        category: 'cargas'
      });
    }
    
    res.status(201).json({
      success: true,
      message: role === 'user' ? 'Usuario creado correctamente' : 'Administrador creado correctamente',
      user: {
        id: newUser.id,
        username: newUser.username,
        email: newUser.email,
        role: newUser.role
      }
    });
  } catch (error) {
    console.error('Error creando usuario:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================
// GESTIÓN DE COMANDOS
// ============================================

// Obtener todos los comandos
app.get('/api/admin/commands', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const commands = await Command.find().lean();
    res.json({ commands });
  } catch (error) {
    console.error('Error obteniendo comandos:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Crear comando
app.post('/api/admin/commands', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { name, description, response } = req.body;
    
    if (!name || !name.startsWith('/')) {
      return res.status(400).json({ error: 'El comando debe empezar con /' });
    }
    
    await Command.findOneAndUpdate(
      { name },
      { 
        name,
        description: description || '',
        response: response || '',
        isActive: true,
        updatedAt: new Date()
      },
      { upsert: true, new: true }
    );
    
    res.json({ success: true, message: 'Comando guardado correctamente' });
  } catch (error) {
    console.error('Error guardando comando:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Eliminar comando
app.delete('/api/admin/commands/:name', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const cmd = await Command.findOne({ name: req.params.name });
    if (cmd && cmd.isSystem) {
      return res.status(403).json({ error: 'No se puede eliminar un comando del sistema' });
    }
    await Command.deleteOne({ name: req.params.name });
    res.json({ success: true, message: 'Comando eliminado correctamente' });
  } catch (error) {
    console.error('Error eliminando comando:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================
// BASE DE DATOS - PROTEGIDA CON CONTRASEÑA
// ============================================

// Helper: escape a CSV field to prevent CSV injection attacks.
// Returns the complete quoted field including surrounding double quotes.
// Dangerous leading characters (=, +, -, @, tab, CR) are prefixed with a
// single quote so that spreadsheet applications treat them as literal text.
function escapeCsvField(value) {
  if (value === null || value === undefined) return '""';
  const str = String(value);
  if (/^[=+\-@\t\r]/.test(str)) {
    return '"\'' + str.replace(/"/g, '""') + '"';
  }
  return '"' + str.replace(/"/g, '""') + '"';
}

const DB_PASSWORD = process.env.DB_PASSWORD;
if (!DB_PASSWORD) {
  if (process.env.NODE_ENV === 'production') {
    console.error('⛔ FATAL: DB_PASSWORD no configurado en producción.');
    process.exit(1);
  }
  logger.error('⛔ SEGURIDAD: DB_PASSWORD no configurado. Las rutas de base de datos no funcionarán sin esta variable.');
}

// Middleware para verificar contraseña de base de datos
function dbPasswordMiddleware(req, res, next) {
  if (!DB_PASSWORD) {
    return res.status(503).json({ error: 'Servicio de base de datos temporalmente no disponible.' });
  }
  // Accept dbPassword from body only — never from query string to avoid it
  // appearing in server logs, referrer headers and browser history.
  const { dbPassword } = req.body || {};
  
  if (!safeCompare(dbPassword, DB_PASSWORD)) {
    return res.status(401).json({ error: 'Contraseña incorrecta' });
  }
  
  next();
}

// Verificar acceso a base de datos
app.post('/api/admin/database/verify', authMiddleware, adminMiddleware, dbPasswordMiddleware, (req, res) => {
  res.json({ success: true, message: 'Acceso concedido' });
});

// Obtener todos los usuarios y admins para base de datos
// CORREGIDO: Usar la misma lógica que /api/admin/users para consistencia
app.post('/api/admin/database/users', authMiddleware, adminMiddleware, dbPasswordMiddleware, async (req, res) => {
  try {
    const userRole = req.user.role;
    
    // Construir query según rol (igual que en /api/admin/users)
    let query = {};
    if (userRole !== 'admin') {
      // Depositor y withdrawer solo ven usuarios (no admins)
      query.role = 'user';
    }
    // Admin general ve TODOS (usuarios y admins)
    
    const users = await User.find(query).select('-password').sort({ role: 1, username: 1 }).lean();
    res.json({ users, total: users.length });
  } catch (error) {
    console.error('Error obteniendo usuarios de base de datos:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Exportar base de datos a CSV
app.post('/api/admin/database/export/csv', authMiddleware, adminMiddleware, dbPasswordMiddleware, async (req, res) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 }).lean();
    
    // Crear CSV con todos los campos
    let csv = 'ID,Usuario,Email,Teléfono,Rol,Balance,AccountNumber,Estado,Último Login,Creado,JugayganaUserId,JugayganaUsername,JugayganaSyncStatus\n';
    
    users.forEach(user => {
      csv += `${escapeCsvField(user.id)},${escapeCsvField(user.username)},${escapeCsvField(user.email || '')},${escapeCsvField(user.phone || '')},${escapeCsvField(user.role)},${escapeCsvField(user.balance || 0)},${escapeCsvField(user.accountNumber || '')},${escapeCsvField(user.isActive ? 'Activo' : 'Inactivo')},${escapeCsvField(user.lastLogin || 'Nunca')},${escapeCsvField(user.createdAt || '')},${escapeCsvField(user.jugayganaUserId || '')},${escapeCsvField(user.jugayganaUsername || '')},${escapeCsvField(user.jugayganaSyncStatus || '')}\n`;
    });
    
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=base_de_datos_completa.csv');
    res.send('\uFEFF' + csv); // BOM para Excel
  } catch (error) {
    console.error('Error exportando base de datos:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================
// EXPORTAR USUARIOS A CSV
// ============================================

app.get('/api/admin/users/export/csv', authMiddleware, async (req, res) => {
  // Solo el admin general puede exportar usuarios
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Acceso denegado. Solo el admin general puede exportar usuarios.' });
  }
  try {
    const users = await User.find().select('username phone email balance lastLogin').lean();
    
    // Crear CSV
    let csv = 'Usuario,Teléfono,Email,Balance,Último Login\n';
    users.forEach(user => {
      csv += `${escapeCsvField(user.username)},${escapeCsvField(user.phone || '')},${escapeCsvField(user.email || '')},${escapeCsvField(user.balance || 0)},${escapeCsvField(user.lastLogin || 'Nunca')}\n`;
    });
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=usuarios.csv');
    res.send(csv);
  } catch (error) {
    console.error('Error exportando usuarios:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================
// RUTAS DE REFERIDOS
// ============================================

const referralRoutes = require('./src/routes/referralRoutes');
app.use('/api/referrals', referralRoutes);

// ============================================
// SPA FALLBACK: sirve index.html para rutas
// frontend desconocidas (ej: /register?ref=CODE)
// Esto permite que los links de referido funcionen
// aunque la ruta no esté definida explícitamente.
// ============================================

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Endpoint no encontrado' });
  }
  // Don't serve SPA HTML for static asset paths – they should 404 cleanly so that
  // browsers don't receive HTML with Content-Type: text/html when they expect CSS/JS
  // (which triggers X-Content-Type-Options: nosniff blocking).
  if (STATIC_ASSET_EXT_RE.test(req.path)) {
    return res.status(404).send('Not found');
  }
  const indexPath = path.join(__dirname, 'public', 'index.html');
  const content = readFileSafe(indexPath);
  if (content) {
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.send(content);
  } else {
    res.status(500).send('Error loading page');
  }
});

// ============================================
// MANEJADOR DE ERRORES CENTRALIZADO
// ============================================

const errorHandler = require('./src/middlewares/errorHandler');
app.use(errorHandler);

// ============================================
// INICIAR SERVIDOR
// ============================================

if (process.env.VERCEL) {
  initializeData().then(() => {
    logger.info('Data initialized for Vercel');
  });
  
  module.exports = app;
} else {
  (async () => {
    try {
      await loadSecretsFromSSM();
    } catch (err) {
      console.error('[BOOT] No se pudo cargar la configuración desde SSM. Abortando.');
      process.exit(1);
    }

    // Validar JWT_SECRET ahora que SSM ya cargó las vars
    JWT_SECRET = process.env.JWT_SECRET;
    if (!JWT_SECRET) {
      console.error('⛔ FATAL: JWT_SECRET no configurado. El servidor no puede arrancar.');
      process.exit(1);
    }

    await initializeData();
    await setupRedisAdapter();
    server.listen(PORT, () => {
      logger.info(`Server started on port ${PORT} (${process.env.NODE_ENV || 'development'})`);
    });
  })();
}