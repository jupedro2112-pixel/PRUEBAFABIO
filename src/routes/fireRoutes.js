const express = require('express');
const router = express.Router();
const fireController = require('../controllers/fireController');
const { authenticate } = require('../middlewares/auth');

router.get('/status', authenticate, fireController.getStatus);
router.post('/claim', authenticate, fireController.claim);

module.exports = router;
