
/**
 * Rutas del Fueguito (racha diaria)
 */
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middlewares/auth');
const fireController = require('../controllers/fireController');

router.get('/fire/status', authenticate, fireController.getStatus);
router.post('/fire/claim', authenticate, fireController.claim);

module.exports = router;
