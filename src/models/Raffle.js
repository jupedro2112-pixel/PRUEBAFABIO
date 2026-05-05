/**
 * Sorteo mensual con prize pool fijo.
 *
 * Modelo:
 *   - Cada sorteo tiene una FECHA de mes (monthKey "2026-05" = mayo 2026).
 *   - Para participar el user paga `entryCost` de su SALDO REAL en JUGAYGANA
 *     (se descuenta del balance via jugaygana.withdrawFromUser).
 *   - Cada sorteo tiene un POOL FIJO de cupos (totalTickets). Cada cupo
 *     comprado recibe un NÚMERO ÚNICO secuencial (1..totalTickets).
 *   - El ganador se determina por la QUINIELA NACIONAL del primer lunes del
 *     mes próximo. Cada sorteo tiene un `lotteryRule` que describe la posicion
 *     exacta (ej. "1° puesto Quiniela Matutina"). Admin entra el numero
 *     ganador y el sistema busca a quien le pertenece. Si el cupo está
 *     incompleto, el numero se mapea al rango vendido vía modulo.
 *   - Si la cantidad de cupos vendidos no llega a totalTickets, el ganador
 *     recibe el proporcional al fill rate.
 *   - Pueden coexistir varias instancias del mismo tipo en un mes (ej. 10
 *     sorteos de iPhone con instanceNumber 1..10).
 */
const mongoose = require('mongoose');

const raffleSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 100 },
  prizeName: { type: String, required: true, trim: true, maxlength: 200 },
  description: { type: String, default: '', maxlength: 500 },
  imageUrl: { type: String, default: null, maxlength: 800 },
  emoji: { type: String, default: '🎁', maxlength: 8 },

  // Mes al que aplica este sorteo. Formato: "YYYY-MM" en TZ Argentina.
  monthKey: { type: String, required: true, index: true },

  // Tipo de sorteo (para agrupar en UI cuando hay multiples instancias).
  raffleType: {
    type: String,
    enum: ['iphone', 'caribe', 'auto', 'other'],
    default: 'other',
    index: true
  },
  // Numero de instancia dentro del tipo (1..10 para iPhones, 1..5 para Caribes,
  // 1 para Auto). Permite tener varios sorteos del mismo tipo en el mismo mes.
  instanceNumber: { type: Number, default: 1, min: 1 },
  // Texto que describe contra qué sorteo de Quiniela se determina el ganador.
  // Ej. "1° puesto Quiniela Matutina del primer lunes del mes próximo".
  // Aporta transparencia: cualquier user puede verificar el numero ganador en
  // los resultados oficiales de la Quiniela.
  lotteryRule: { type: String, default: '', maxlength: 300 },

  // Modo de entrada:
  //  - 'paid': el user PAGA con su saldo de JUGAYGANA (entryCost > 0).
  //            Numero de cupo asignado secuencialmente y sin limite por user.
  //  - 'wagered': sorteo EXCLUSIVO para clientes activos. Entry gratis pero
  //               el user debe haber apostado/cargado al menos `wageredThreshold`
  //               este mes. Max `maxCuposPerUser` (default 1). El user ELIGE
  //               su numero entre los libres del cupo total.
  entryMode: { type: String, enum: ['paid', 'wagered'], default: 'paid', index: true },
  // Costo de entrada en pesos (=0 si entryMode='wagered').
  entryCost: { type: Number, required: true, min: 0 },
  // Umbral de monto apostado/cargado del mes que habilita reclamar un numero
  // gratis. Solo aplica cuando entryMode='wagered'. Ej: 200000 → necesitas
  // haber apostado $200.000 este mes para entrar al sorteo exclusivo de iPhone.
  wageredThreshold: { type: Number, default: 0, min: 0 },
  // Cantidad maxima de cupos que un mismo user puede tener en este sorteo.
  // 0 = ilimitado (default para 'paid'). 1 = un solo cupo por persona (default
  // para 'wagered' exclusivos).
  maxCuposPerUser: { type: Number, default: 0, min: 0 },
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
