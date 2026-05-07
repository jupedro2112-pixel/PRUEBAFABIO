/**
 * NotifStrategyConfig: configuracion mensual editable desde el panel
 * admin (seccion Encuesta) para definir cuantos pushes y cuanta plata
 * destinamos a cada uno de los 4 niveles que el user puede elegir.
 *
 * Singleton: existe UN solo doc activo. La key es 'monthly-default'.
 * Cada vez que el admin guarda, se actualiza ese doc — el historial de
 * cambios queda en `revisions` (append-only) para poder revertir o
 * auditar quien movio que.
 */
const mongoose = require('mongoose');

const tierConfigSchema = new mongoose.Schema({
  bonos: { type: Number, default: 0, min: 0 },
  juegos: { type: Number, default: 0, min: 0 },     // "juga con nosotros"
  regalos: { type: Number, default: 0, min: 0 },
  budget: { type: Number, default: 0, min: 0 },     // monto total $ por user/mes
  refundsOnly: { type: Boolean, default: false }    // true = solo notifica si hay refund disponible
}, { _id: false });

const revisionSchema = new mongoose.Schema({
  at: { type: Date, default: Date.now },
  by: { type: String, default: 'admin' },
  prefs: { type: mongoose.Schema.Types.Mixed, default: {} },
  monthlyCap: { type: Number, default: 0 }
}, { _id: false });

const notifStrategyConfigSchema = new mongoose.Schema({
  // Singleton key — siempre 'monthly-default' por ahora. Si en el
  // futuro queremos perfiles distintos (ej por equipo) se agregan keys.
  key: { type: String, required: true, unique: true, default: 'monthly-default', index: true },

  preferences: {
    suave: { type: tierConfigSchema, default: () => ({ bonos: 2, juegos: 5, regalos: 2, budget: 1000 }) },
    normal: { type: tierConfigSchema, default: () => ({ bonos: 4, juegos: 5, regalos: 2, budget: 1500 }) },
    activo: { type: tierConfigSchema, default: () => ({ bonos: 6, juegos: 10, regalos: 3, budget: 2500 }) },
    solo_reembolsos: { type: tierConfigSchema, default: () => ({ bonos: 0, juegos: 0, regalos: 0, budget: 0, refundsOnly: true }) }
  },

  // Tope mensual GLOBAL de regalos (suma de "regalos" * "budget" por
  // user no debe exceder esto). El admin elige.
  monthlyCap: { type: Number, default: 1000000, min: 0 },

  // Historial de cambios (ultimos 50). Append-only.
  revisions: { type: [revisionSchema], default: [] },

  updatedAt: { type: Date, default: Date.now },
  updatedBy: { type: String, default: 'admin' }
}, { timestamps: false });

module.exports = mongoose.models['NotifStrategyConfig'] ||
  mongoose.model('NotifStrategyConfig', notifStrategyConfigSchema);
