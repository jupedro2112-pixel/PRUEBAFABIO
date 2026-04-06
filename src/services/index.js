
/**
 * Índice de Servicios
 * Exporta todos los servicios de la aplicación
 */
const authService = require('./authService');
const chatService = require('./chatService');
const jugayganaService = require('./jugayganaService');
const refundService = require('./refundService');
const transactionService = require('./transactionService');
const referralRevenueService = require('./referralRevenueService');
const referralCalculationService = require('./referralCalculationService');
const referralPayoutService = require('./referralPayoutService');

module.exports = {
  authService,
  chatService,
  jugayganaService,
  refundService,
  transactionService,
  referralRevenueService,
  referralCalculationService,
  referralPayoutService
};