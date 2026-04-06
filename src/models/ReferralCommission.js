/**
 * Modelo de Comisión de Referido
 * Representa el cálculo mensual de comisión por un usuario referido
 */
const mongoose = require('mongoose');

const providerBreakdownSchema = new mongoose.Schema({
  providerName: { type: String, required: true },
  ggr: { type: Number, default: 0 },
  ownerCommissionRate: { type: Number, default: 0 },
  ownerRevenue: { type: Number, default: 0 }
}, { _id: false });

const referralCommissionSchema = new mongoose.Schema({
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
  referredUserId: {
    type: String,
    required: true,
    index: true
  },
  referredUsername: {
    type: String,
    required: true,
    trim: true
  },
  currency: {
    type: String,
    default: 'ARS'
  },
  totalBets: {
    type: Number,
    default: 0
  },
  totalWins: {
    type: Number,
    default: 0
  },
  totalGgr: {
    type: Number,
    default: 0
  },
  totalOwnerRevenue: {
    type: Number,
    default: 0
  },
  referralRate: {
    type: Number,
    default: 0.07
  },
  commissionAmount: {
    type: Number,
    default: 0
  },
  providersBreakdown: {
    type: [providerBreakdownSchema],
    default: []
  },
  status: {
    type: String,
    enum: ['calculated', 'paid', 'skipped', 'excluded'],
    default: 'calculated',
    index: true
  },
  calculatedAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  paidAt: {
    type: Date,
    default: null
  },
  payoutId: {
    type: String,
    default: null,
    index: true
  }
}, {
  timestamps: true
});

// Evitar duplicados: un solo cálculo por referido+período
referralCommissionSchema.index(
  { periodKey: 1, referredUserId: 1 },
  { unique: true }
);
referralCommissionSchema.index({ periodKey: 1, referrerUserId: 1 });
referralCommissionSchema.index({ status: 1, periodKey: 1 });

module.exports = mongoose.models['ReferralCommission'] || mongoose.model('ReferralCommission', referralCommissionSchema);
