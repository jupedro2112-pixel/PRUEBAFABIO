/**
 * Modelo de Evento de Referido
 * Registro de atribución para trazabilidad
 */
const mongoose = require('mongoose');

const referralEventSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true,
    unique: true,
    index: true
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
    unique: true, // un usuario solo puede ser referido una vez
    index: true
  },
  referredUsername: {
    type: String,
    required: true,
    trim: true
  },
  codeUsed: {
    type: String,
    required: true,
    trim: true
  },
  meta: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  }
}, {
  timestamps: true
});

referralEventSchema.index({ referrerUserId: 1, createdAt: -1 });

module.exports = mongoose.models['ReferralEvent'] || mongoose.model('ReferralEvent', referralEventSchema);
