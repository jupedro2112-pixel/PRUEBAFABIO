const express = require('express');
const router = express.Router();
const diagnosticController = require('../controllers/diagnosticController');
const { authenticate, authorize } = require('../middlewares/auth');

router.get('/public', diagnosticController.publicDiagnostic);
router.post('/test-message', authenticate, authorize('admin'), diagnosticController.testMessage);
router.get('/messages', authenticate, authorize('admin'), diagnosticController.diagnosticMessages);

module.exports = router;
