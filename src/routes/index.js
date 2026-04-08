/**
 * Índice de Rutas
 * Exporta todas las rutas de la aplicación
 */
const express = require('express');
const router = express.Router();

const authRoutes = require('./authRoutes');
const chatRoutes = require('./chatRoutes');
const adminRoutes = require('./adminRoutes');
const userRoutes = require('./userRoutes');
const referralRoutes = require('./referralRoutes');
const refundRoutes = require('./refundRoutes');
const fireRoutes = require('./fireRoutes');
const configRoutes = require('./configRoutes');
const movementRoutes = require('./movementRoutes');
const diagnosticRoutes = require('./diagnosticRoutes');
const uploadRoutes = require('./uploadRoutes');
const notificationRoutes = require('./notificationRoutes');
const configController = require('../controllers/configController');
const { authenticate } = require('../middlewares/auth');

// Auth
router.use('/api/auth', authRoutes);

// Chat
router.use('/api', chatRoutes);

// Admin
router.use('/api/admin', adminRoutes);

// User profile (keep /api/users for backward compat)
router.use('/api/users', userRoutes);

// Referrals
router.use('/api/referrals', referralRoutes);

// Refunds at correct path (/api/refunds/*)
router.use('/api/refunds', refundRoutes);

// Fire streak at correct path (/api/fire/*)
router.use('/api/fire', fireRoutes);

// Config (CBU, canal-url)
router.use('/api/config', configRoutes);

// CBU request by user
router.post('/api/cbu/request', authenticate, configController.cbuRequest);

// Movements and live balance
router.use('/api/movements', movementRoutes);
router.get('/api/balance/live', authenticate, require('../controllers/movementController').getBalanceLive);

// Notifications
router.use('/api/notifications', notificationRoutes);

// Uploads (S3 presigned URL)
router.use('/api/upload', uploadRoutes);

// Diagnostics
router.use('/api/diagnostic', diagnosticRoutes);

// Health check
router.get('/api/health', (req, res) => {
  const mongoose = require('mongoose');
  const { connectedUsers, connectedAdmins } = require('../socket');
  const mongoOk = mongoose.connection.readyState === 1;
  res.json({
    status: mongoOk ? 'ok' : 'degraded',
    mongodb: mongoOk,
    uptime: Math.floor(process.uptime()),
    connectedUsers: connectedUsers.size,
    connectedAdmins: connectedAdmins.size,
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
