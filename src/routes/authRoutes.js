
/**
 * Rutas de Autenticación
 */
const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authenticate } = require('../middlewares/auth');
const { authLimiter, validateRegister, validateLogin } = require('../middlewares/security');

// Públicas
router.post('/register', validateRegister, authController.register);
router.post('/login', authLimiter, validateLogin, authController.login);
router.get('/check-username', authController.checkUsername);

// OTP para registro
router.post('/send-register-otp', authController.sendRegisterOtp);

// Reset de contraseña via OTP
router.post('/request-password-reset', authController.requestPasswordReset);
router.post('/verify-reset-otp', authController.verifyResetOtp);
router.post('/complete-password-reset', authController.completePasswordReset);

// Protegidas
router.post('/logout', authenticate, authController.logout);
router.get('/verify', authenticate, authController.verify);
router.post('/change-password', authenticate, authController.changePassword);
router.post('/refresh-token', authenticate, authController.refreshToken);
router.post('/platform-login', authenticate, authController.platformLogin);

module.exports = router;
