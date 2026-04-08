const express = require('express');
const router = express.Router();
const movementController = require('../controllers/movementController');
const { authenticate } = require('../middlewares/auth');

// Balance
router.get('/balance', authenticate, movementController.getMovementsBalance);

// Movimientos (historial)
router.get('/', authenticate, movementController.getMovements);

// Depósito y retiro desde usuario
router.post('/deposit', authenticate, movementController.deposit);
router.post('/withdraw', authenticate, movementController.withdraw);

module.exports = router;
