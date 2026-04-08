/**
 * Entry point del servidor
 * Thin entry point — toda la lógica de negocio vive en src/
 */
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const { createClient } = require('redis');
const { createAdapter } = require('@socket.io/redis-adapter');
const { setRedisClient } = require('./src/utils/redisClient');
const { setupSocket } = require('./src/socket');
const { setIo } = require('./src/utils/ioSingleton');
const { initializeData } = require('./src/init');
const apiRoutes = require('./src/routes');
const staticRoutes = require('./src/routes/staticRoutes');
const errorHandler = require('./src/middlewares/errorHandler');
const logger = require('./src/utils/logger');
const notificationRoutes = require('./src/routes/notificationRoutes');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'sala-de-juegos-secret-key-2024';
if (!process.env.JWT_SECRET) {
  logger.warn('⚠️ JWT_SECRET no configurado. Usar variable de entorno en producción.');
}

const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);

const io = socketIo(server, {
  cors: {
    origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
    methods: ['GET', 'POST'],
    credentials: true
  },
  transports: ['websocket', 'polling'],
  pingInterval: 25000,
  pingTimeout: 60000
});

setIo(io);
setupSocket(io, JWT_SECRET);

// Notify notificationRoutes about the io instance
notificationRoutes.setIo(io);

// Security headers
function securityHeaders(req, res, next) {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' https://www.gstatic.com https://www.google.com https://apis.google.com; script-src-elem 'self' 'unsafe-inline' https://www.gstatic.com https://www.google.com https://apis.google.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self'; connect-src 'self' https://*.googleapis.com https://*.firebaseio.com https://*.google.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://fcm.googleapis.com https://firebaseinstallations.googleapis.com; frame-src 'self' https://*.firebaseapp.com https://*.google.com; manifest-src 'self';");
  next();
}

app.use(compression({ threshold: 1024 }));
app.use(securityHeaders);
app.use(rateLimit({ windowMs: 60 * 1000, max: 100, standardHeaders: true, legacyHeaders: false, message: { error: 'Demasiadas solicitudes.' } }));
app.use(cors({ origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*', credentials: true }));
app.use(express.json({ limit: '10mb' }));

// Static files
app.use(express.static(path.join(__dirname, 'public'), {
  dotfiles: 'deny',
  index: false,
  maxAge: '1d',
  setHeaders: (res, filePath) => {
    const noCache = filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css') ||
      filePath.includes('firebase-messaging-sw') || filePath.includes('user-sw') ||
      filePath.includes('admin-sw') || filePath.includes('manifest.json');
    if (noCache) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
    if (path.basename(filePath) === 'manifest.json') {
      res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
    }
  }
}));

// API and page routes
app.use(apiRoutes);
app.use(staticRoutes);
app.use(errorHandler);

// Redis adapter for Socket.IO horizontal scaling
async function setupRedisAdapter() {
  const redisUrl = process.env.REDIS_URL;
  const redisHost = process.env.REDIS_HOST;
  if (!redisUrl && !redisHost) {
    logger.warn('Redis not configured. Socket.IO running in single-instance mode.');
    return;
  }
  try {
    const opts = redisUrl ? { url: redisUrl } : {
      socket: { host: redisHost, port: parseInt(process.env.REDIS_PORT || '6379', 10) },
      username: process.env.REDIS_USERNAME || undefined,
      password: process.env.REDIS_PASSWORD || undefined
    };
    const pubClient = createClient(opts);
    const subClient = pubClient.duplicate();
    pubClient.on('error', (e) => logger.error(`Redis pub error: ${e.message}`));
    subClient.on('error', (e) => logger.error(`Redis sub error: ${e.message}`));
    await Promise.all([pubClient.connect(), subClient.connect()]);
    io.adapter(createAdapter(pubClient, subClient));
    setRedisClient(pubClient);
    logger.info('Socket.IO Redis adapter initialized');
  } catch (err) {
    logger.error(`Redis adapter failed: ${err.message}. Running in single-instance mode.`);
  }
}

if (process.env.VERCEL) {
  initializeData().then(() => logger.info('Data initialized for Vercel'));
  module.exports = app;
} else {
  initializeData().then(async () => {
    await setupRedisAdapter();
    server.listen(PORT, () => {
      logger.info(`Server started on port ${PORT} (${process.env.NODE_ENV || 'development'})`);
    });
  });
}
