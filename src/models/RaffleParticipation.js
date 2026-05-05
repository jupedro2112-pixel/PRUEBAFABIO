/**
 * Participacion de un usuario en un sorteo.
 *
 * Modelo MULTI-CUPO con números asignados: un user puede ocupar múltiples
 * cupos en el MISMO sorteo (un cupo por cada entryCost de su carga del
 * mes). Cada cupo recibe un NÚMERO ÚNICO secuencial dentro del sorteo
 * (1..totalTickets), guardado en `ticketNumbers`. Una sola row per
 * (raffleId, username) que acumula cuposCount + ticketNumbers + total
 * pagado con $inc cuando compra mas cupos.
 *
 * Ej.: auto con entryCost=100.000 y user con cargas 400.000 puede comprar
 * 4 cupos en ese sorteo. Recibe 4 números: ej [142, 143, 144, 145]. El
 * ganador se determina por la Lotería Nacional del primer lunes del mes
 * próximo: si sale el número 144, este user gana.
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

  // Números de cupo asignados a esta participación. Cada cupo comprado
  // recibe un número único secuencial dentro del sorteo (1..totalTickets).
  // El ganador se elige cuando la Lotería Nacional saca un número que
  // está en el `ticketNumbers` de alguna participación.
  ticketNumbers: { type: [Number], default: [] },

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
