/**
 * Modelo de Pago de Referidos
 * Representa el pago mensual agregado para un referidor
 */
const mongoose = require('mongoose');

const referralPayoutSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  periodKey: {
    type: String,
    required: true,
    index: true,
    trim: true
    // e.g. "2026-04"
  },
  referrerUserId: {
    type: String,
    required: true,
    index: true
  },
  referrerUsername: {
    type: String,
    required: true,
    trim: true
  },
  currency: {
    type: String,
    default: 'ARS'
  },
  totalCommissionAmount: {
    type: Number,
    required: true,
    min: 0
  },
  referralCount: {
    type: Number,
    default: 0
  },
  status: {
    type: String,
    enum: ['pending', 'paid', 'failed', 'cancelled'],
    default: 'pending',
    index: true
  },
  creditedAt: {
    type: Date,
    default: null
  },
  transactionId: {
    type: String,
    default: null,
    index: true
  },
  externalTransactionId: {
    type: String,
    default: null
  },
  details: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  errorMessage: {
    type: String,
    default: null
  }
}, {
  timestamps: true
});

// Solo un pago por referidor por período
referralPayoutSchema.index(
  { periodKey: 1, referrerUserId: 1 },
  { unique: true }
);
referralPayoutSchema.index({ status: 1, periodKey: 1 });

module.exports = mongoose.models['ReferralPayout'] || mongoose.model('ReferralPayout', referralPayoutSchema);
