/**
 * Sorteo mensual con prize pool fijo.
 *
 * Modelo:
 *   - Cada sorteo tiene una FECHA de mes (monthKey "2026-05" = mayo 2026).
 *   - Para participar el user paga `entryCost` de su NETWIN LOSS del mes
 *     en curso (no plata real, "creditos del sorteo"). Si entryCost = 20000
 *     y el user perdió 100.000 en el mes, le quedan 80.000 disponibles
 *     para otros sorteos.
 *   - Cada sorteo tiene un POOL FIJO de tickets (totalTickets). Cuando se
 *     hace el draw, los tickets se reparten en partes iguales entre todos
 *     los participantes (floor(totalTickets/participantCount)).
 *   - El draw lo hace el admin manualmente (primer lunes del mes proximo).
 *
 * Defaults sembrados al primer fetch:
 *   - iPhone:        entryCost 20.000 · 500 tickets
 *   - Viaje al Caribe (2 personas): entryCost 50.000 · 1000 tickets
 *   - Auto Gol Trend 2015: entryCost 100.000 · 500 tickets
 */
const mongoose = require('mongoose');

const raffleSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 100 },
  prizeName: { type: String, required: true, trim: true, maxlength: 200 },
  description: { type: String, default: '', maxlength: 500 },
  imageUrl: { type: String, default: null, maxlength: 800 },
  emoji: { type: String, default: '🎁', maxlength: 8 },

  // Mes al que aplica este sorteo. El budget de netwin loss del user para
  // entrar se mide sobre este mes. Formato: "YYYY-MM" en TZ Argentina.
  monthKey: { type: String, required: true, index: true },

  // Costo de entrada (loss credits, no plata real).
  entryCost: { type: Number, required: true, min: 0 },
  // Total de tickets a repartir entre participantes.
  totalTickets: { type: Number, required: true, min: 1 },

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
  drawnBy: { type: String, default: null }
}, { timestamps: true });

raffleSchema.index({ monthKey: 1, status: 1 });

module.exports = mongoose.models['Raffle'] || mongoose.model('Raffle', raffleSchema);
