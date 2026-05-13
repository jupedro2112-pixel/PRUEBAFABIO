/**
 * Cierre diario por sector.
 *
 * Modelo financiero para que el owner controle día a día:
 *   - depósitos que entran (banco cobra comisión por cada uno)
 *   - ventas que hay que pagar (bajar)
 *   - cuánto se bajó y cuánto quedó pendiente (arrastra al día siguiente)
 *   - bonos regalados
 *   - comprobantes de bajada (fotos)
 *   - si quedó pendiente, comprobante del banco que muestre que la plata
 *     sigue ahí (sino se considera plata faltante)
 *
 * Sectores: ganamos | publicidad | buffalo (este último tiene 7 slots
 * de equipo individual, con nombre editable).
 *
 * Reglas:
 *   - draft: editable libremente.
 *   - confirmed: editable hasta 24h del confirmedAt. Después, locked.
 *   - Cualquier edit registra en editHistory para auditoría.
 */
const mongoose = require('mongoose');

const editEntrySchema = new mongoose.Schema({
  editedAt: { type: Date, default: Date.now },
  editedBy: { type: String, default: '' },
  field: { type: String, default: '' },
  before: { type: mongoose.Schema.Types.Mixed },
  after: { type: mongoose.Schema.Types.Mixed }
}, { _id: false });

const comprobanteSchema = new mongoose.Schema({
  url: { type: String, required: true },
  // 'bajada' = comprobante de transferencia hecha
  // 'pendiente_bank' = screenshot del banco mostrando que la plata pendiente
  //                    SIGUE EN LA CUENTA (defensa contra plata faltante)
  kind: {
    type: String,
    enum: ['bajada', 'pendiente_bank'],
    default: 'bajada'
  },
  note: { type: String, default: '' },
  uploadedAt: { type: Date, default: Date.now },
  uploadedBy: { type: String, default: '' }
}, { _id: false });

const closingSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },

  // YYYY-MM-DD hora Argentina
  dateKey: { type: String, required: true, index: true },

  sector: {
    type: String,
    enum: ['ganamos', 'publicidad', 'buffalo'],
    required: true,
    index: true
  },

  // Solo para sector 'buffalo': qué slot de equipo (0-6) y nombre editable.
  // El nombre se persiste en cada cierre para que aunque el owner lo
  // cambie en config, los cierres viejos mantengan el nombre con el que
  // se cargaron.
  teamSlot: { type: Number, default: null }, // 0..6 para buffalo
  teamName: { type: String, default: '', trim: true },

  // === Plata que entra ===
  depositsARS: { type: Number, default: 0 },
  // % que cobra el banco por cada depósito. Editable porque varía según
  // qué banco se usa ese día.
  bankMarginPercent: { type: Number, default: 0, min: 0, max: 100 },

  // === Plata que tiene que bajar (ventas a pagar) ===
  ventasARS: { type: Number, default: 0 },
  // Cuánto efectivamente bajó hoy (transferencias hechas).
  bajadaARS: { type: Number, default: 0 },
  // Plata que quedó pendiente del día ANTERIOR (arrastre). Setable manual
  // o se calcula automático leyendo el cierre del día previo.
  pendienteAnteriorARS: { type: Number, default: 0 },

  // === Bonificaciones / regalos ===
  bonusARS: { type: Number, default: 0 },
  bonusNote: { type: String, default: '', trim: true },

  // === Volumen operacional ===
  // Cantidad de transacciones procesadas ese día por el sector.
  // Sirve para tracking de actividad — ticket promedio, comparativas,
  // detectar caídas de volumen.
  transactionsCount: { type: Number, default: 0, min: 0 },

  // === Adjuntos: comprobantes de bajada + screenshots de banco ===
  comprobantes: { type: [comprobanteSchema], default: [] },

  // === Estado + auditoría ===
  status: {
    type: String,
    enum: ['draft', 'confirmed'],
    default: 'draft',
    index: true
  },
  confirmedAt: { type: Date, default: null },
  confirmedBy: { type: String, default: '' },
  lockedAt: { type: Date, default: null }, // confirmedAt + 24h

  editHistory: { type: [editEntrySchema], default: [] },

  createdBy: { type: String, default: '' },
  notes: { type: String, default: '' }
}, { timestamps: true });

// Índices útiles
closingSchema.index({ dateKey: 1, sector: 1, teamSlot: 1 }, { unique: true, partialFilterExpression: { teamSlot: { $ne: null } } });
closingSchema.index({ dateKey: 1, sector: 1 }, { unique: true, partialFilterExpression: { teamSlot: null } });
closingSchema.index({ status: 1, dateKey: -1 });

module.exports = mongoose.models['ClosingEntry'] ||
  mongoose.model('ClosingEntry', closingSchema);
