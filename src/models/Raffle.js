/**
 * Sorteo mensual con prize pool fijo.
 *
 * Modelo:
 *   - Cada sorteo tiene una FECHA de mes (monthKey "2026-05" = mayo 2026).
 *   - Para participar el user paga `entryCost` de su MONTO CARGADO del mes
 *     en curso (no plata real, "creditos del sorteo"). Si entryCost = 50000
 *     y el user cargó 100.000 en el mes, le quedan 50.000 disponibles
 *     para otros sorteos.
 *   - Cada sorteo tiene un POOL FIJO de cupos (totalTickets). Cada cupo
 *     comprado recibe un NÚMERO ÚNICO secuencial (1..totalTickets).
 *   - El ganador se determina por el primer premio de la LOTERÍA NACIONAL
 *     del primer lunes del mes próximo. Admin entra el lotteryDrawNumber
 *     y el sistema busca a quién le pertenece ese número.
 *   - Si la cantidad de cupos vendidos no llega a totalTickets, el ganador
 *     recibe el proporcional al fill rate.
 */
const mongoose = require('mongoose');

const raffleSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 100 },
  prizeName: { type: String, required: true, trim: true, maxlength: 200 },
  description: { type: String, default: '', maxlength: 500 },
  imageUrl: { type: String, default: null, maxlength: 800 },
  emoji: { type: String, default: '🎁', maxlength: 8 },

  // Mes al que aplica este sorteo. El budget de cargas del user para
  // entrar se mide sobre este mes. Formato: "YYYY-MM" en TZ Argentina.
  monthKey: { type: String, required: true, index: true },

  // Costo de entrada (credits = monto cargado, no plata real).
  entryCost: { type: Number, required: true, min: 0 },
  // Total de cupos disponibles. Cada cupo tiene un número único 1..totalTickets.
  totalTickets: { type: Number, required: true, min: 1 },
  // Valor del premio en pesos. Si la cantidad de cupos vendidos no llega a
  // totalTickets, el ganador recibe el proporcional:
  //   actualPayout = prizeValueARS * min(1, totalCuposSold / totalTickets)
  prizeValueARS: { type: Number, default: 0, min: 0 },

  // Contador atomico de cupos asignados. Se incrementa por $inc en cada
  // participacion para asegurar numeros secuenciales sin duplicados ni
  // race conditions.
  _ticketCounter: { type: Number, default: 0, min: 0 },

  // Fecha en la que se sortea (informativa). Primer lunes del mes proximo.
  drawDate: { type: Date, required: true, index: true },

  status: {
    type: String,
    enum: ['active', 'closed', 'drawn', 'cancelled'],
    default: 'active',
    index: true
  },

  // Resultado del draw.
  winnerUsername: { type: String, default: null },
  winningTicketNumber: { type: Number, default: null },
  drawnAt: { type: Date, default: null },
  drawnBy: { type: String, default: null },

  // Trazabilidad de la Lotería Nacional que determinó al ganador.
  // lotteryDrawNumber es el número que salió y que determinó el cupo
  // ganador. lotteryDrawSource describe qué sorteo de lotería fue
  // (ej. "Lotería Nacional Nocturna - Primer premio - 06/05/2026").
  lotteryDrawDate: { type: Date, default: null },
  lotteryDrawNumber: { type: Number, default: null },
  lotteryDrawSource: { type: String, default: null, maxlength: 200 }
}, { timestamps: true });

raffleSchema.index({ monthKey: 1, status: 1 });

module.exports = mongoose.models['Raffle'] || mongoose.model('Raffle', raffleSchema);
