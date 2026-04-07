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
    // Contains: { commissionIds: [...], settledOwnerRevenues: {...}, payoutIndex: N, isDelta: bool }
  },
  errorMessage: {
    type: String,
    default: null
  },
  // Sequence index when multiple payouts exist for the same period+referrer
  payoutIndex: {
    type: Number,
    default: 1
  },
  // True when this payout covers only newly generated revenue since the last settlement
  isDelta: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Multiple payouts allowed per referrer per period (incremental settlement support).
// Unique constraint is on the 'id' field only (defined above).
referralPayoutSchema.index({ periodKey: 1, referrerUserId: 1 });
referralPayoutSchema.index({ status: 1, periodKey: 1 });

module.exports = mongoose.models['ReferralPayout'] || mongoose.model('ReferralPayout', referralPayoutSchema);
