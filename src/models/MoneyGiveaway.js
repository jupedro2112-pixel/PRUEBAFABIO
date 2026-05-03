/**
 * Modelo de Difusión con Regalo de Plata
 *
 * Una "difusión con regalo" es una promo donde el admin le manda push a
 * los usuarios, y los que entran a la app dentro de la ventana de tiempo
 * tocan un botón "Reclamá $X" que les acredita plata directo en JUGAYGANA.
 *
 * Limitado por DOS topes simultaneos:
 *   - totalBudget: cuanta plata maxima estamos dispuestos a regalar.
 *   - maxClaims:   cuantos usuarios maximo pueden reclamar.
 * Cualquiera que se alcance primero cierra la promo (status='closed_*').
 *
 * Tambien tiene expiresAt: pasada esa fecha, la promo no se puede
 * reclamar mas aunque queden slots y plata.
 *
 * Solo puede haber UNA promo activa a la vez por simplicidad. Cuando el
 * admin crea una nueva, las anteriores activas pasan a 'cancelled'.
 */
const mongoose = require('mongoose');

const moneyGiveawaySchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },

  amount: { type: Number, required: true, min: 1 },         // por persona
  totalBudget: { type: Number, required: true, min: 1 },    // tope global de plata
  maxClaims: { type: Number, required: true, min: 1 },      // tope de personas

  expiresAt: { type: Date, required: true, index: true },
  createdAt: { type: Date, default: Date.now, index: true },
  createdBy: { type: String, default: null },

  prefix: { type: String, default: null, trim: true },

  notificationHistoryId: { type: String, default: null, index: true },

  // Si está en true, solo pueden reclamar usuarios con saldo en JUGAYGANA
  // <= 0. El check se hace en el endpoint POST /api/money-giveaway/claim
  // consultando jugaygana.getUserInfoByName(username) antes de acreditar.
  // Si el balance lookup falla (timeout, JUGAYGANA caído), se rechaza por
  // defecto (fail-safe — no regalamos plata sin verificar).
  requireZeroBalance: { type: Boolean, default: false, index: true },

  // Contadores (incrementos atomicos via $inc).
  claimedCount: { type: Number, default: 0 },
  totalGiven: { type: Number, default: 0 },

  // 'active' = sigue abierta.
  // 'closed_expired' = vencio el tiempo.
  // 'closed_budget' = se agoto la plata.
  // 'closed_max' = se llego al maximo de personas.
  // 'cancelled' = el admin la cancelo.
  status: {
    type: String,
    enum: ['active', 'closed_expired', 'closed_budget', 'closed_max', 'cancelled'],
    default: 'active',
    index: true
  }
}, { timestamps: true });

moneyGiveawaySchema.index({ status: 1, expiresAt: 1 });

module.exports = mongoose.models['MoneyGiveaway'] ||
  mongoose.model('MoneyGiveaway', moneyGiveawaySchema);
