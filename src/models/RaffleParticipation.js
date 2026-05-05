/**
 * Participacion de un usuario en un sorteo.
 *
 * Index unique por (raffleId, username) — un user solo puede entrar UNA vez
 * a cada sorteo. La cantidad de tickets que tiene se calcula al draw (no
 * se guarda al join, asi crece dinamico mientras se va sumando gente).
 */
const mongoose = require('mongoose');

const raffleParticipationSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  raffleId: { type: String, required: true, index: true },
  username: { type: String, required: true, index: true, trim: true },
  joinedAt: { type: Date, default: Date.now, index: true },

  // Snapshot del costo y del netwin del user al momento de entrar
  // (para auditoria si hace falta).
  entryCostPaid: { type: Number, required: true, min: 0 },
  netwinAtEntry: { type: Number, default: 0 },

  // Resultado: si gano este sorteo.
  isWinner: { type: Boolean, default: false }
}, { timestamps: true });

raffleParticipationSchema.index({ raffleId: 1, username: 1 }, { unique: true });

module.exports = mongoose.models['RaffleParticipation'] ||
  mongoose.model('RaffleParticipation', raffleParticipationSchema);
