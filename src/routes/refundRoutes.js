const express = require('express');
const router = express.Router();
const refundController = require('../controllers/refundController');
const { authenticate } = require('../middlewares/auth');

router.get('/status', authenticate, refundController.getStatus);
router.post('/claim/daily', authenticate, refundController.claimDaily);
router.post('/claim/weekly', authenticate, refundController.claimWeekly);
router.post('/claim/monthly', authenticate, refundController.claimMonthly);
router.get('/history', authenticate, refundController.getHistory);
router.get('/all', authenticate, refundController.getAll);

module.exports = router;
