/**
 * Participacion de un usuario en un sorteo.
 *
 * Modelo MULTI-CUPO: un user puede ocupar multiples cupos en el MISMO
 * sorteo (un cupo por cada entryCost de su netwin loss). Una sola row
 * per (raffleId, username) que acumula cuposCount + totalEntryCostPaid
 * con $inc cuando compra mas cupos.
 *
 * Ej.: auto con entryCost=500.000 y user con perdida 2.000.000 puede
 * comprar 4 cupos en ese sorteo. Cada cupo es un ticket independiente
 * en el draw. El ganador se elige al azar entre todos los cupos
 * vendidos (no entre users): un user con 4 cupos tiene 4 chances de
 * ganar.
 */
const mongoose = require('mongoose');

const raffleParticipationSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  raffleId: { type: String, required: true, index: true },
  username: { type: String, required: true, index: true, trim: true },
  joinedAt: { type: Date, default: Date.now, index: true },
  lastBoughtAt: { type: Date, default: Date.now },

  // Cantidad de cupos comprados por este user en este sorteo.
  // Cada cupo cuesta raffle.entryCost — se descuenta del budget.
  cuposCount: { type: Number, default: 1, min: 1 },

  // Snapshot del total pagado y del netwin al primer join (auditoria).
  // entryCostPaid representa el TOTAL acumulado (cuposCount * entryCost),
  // se mantiene para que el budget calc por sumatoria siga funcionando.
  entryCostPaid: { type: Number, required: true, min: 0 },
  netwinAtEntry: { type: Number, default: 0 },

  // Resultado: si este user gano (con cualquiera de sus cupos).
  isWinner: { type: Boolean, default: false }
}, { timestamps: true });

raffleParticipationSchema.index({ raffleId: 1, username: 1 }, { unique: true });

module.exports = mongoose.models['RaffleParticipation'] ||
  mongoose.model('RaffleParticipation', raffleParticipationSchema);
