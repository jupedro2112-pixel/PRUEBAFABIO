const express = require('express');
const router = express.Router();
const configController = require('../controllers/configController');
const { authenticate, authorize } = require('../middlewares/auth');

// GET /api/config/cbu
router.get('/cbu', authenticate, configController.getCbu);
// GET /api/config/canal-url
router.get('/canal-url', authenticate, configController.getCanalUrl);

module.exports = router;
