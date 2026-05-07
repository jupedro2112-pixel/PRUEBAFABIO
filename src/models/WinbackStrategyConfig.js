/**
 * WinbackStrategyConfig — singleton key='winback-default'.
 *
 * Cron horario: si isActive, escanea PlayerStats.lastRealDepositDate y
 * dispara push escalonado en 3 tiers según días sin cargar.
 *
 *  Tier 1 (default 7d):  push suave, SIN bono ("te extrañamos")
 *  Tier 2 (default 14d): push + MoneyGiveaway $X, vence 48h
 *  Tier 3 (default 30d): push + promo-alert COD100 (% configurable), vence 72h
 *  Tier 4 (default 60d): cooldown — no mandar más
 *
 * Idempotencia: User.winbackTier + User.winbackLastSentAt. Si el user
 * carga, su tier vuelve a 0 (libre para volver a entrar al ciclo).
 */
const mongoose = require('mongoose');

const tierMessageSchema = new mongoose.Schema({
  title: { type: String, default: '', maxlength: 80 },
  body:  { type: String, default: '', maxlength: 200 }
}, { _id: false });

const winbackStrategyConfigSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, default: 'winback-default', index: true },

  // Master switch — default OFF para que el admin revise antes de prender.
  isActive: { type: Boolean, default: false },
  activatedAt: { type: Date, default: null },
  activatedBy: { type: String, default: null },

  // Umbrales por tier (días sin cargar reales).
  tier1Days: { type: Number, default: 7,  min: 3,  max: 30 },
  tier2Days: { type: Number, default: 14, min: 7,  max: 45 },
  tier3Days: { type: Number, default: 30, min: 14, max: 90 },
  tier4Days: { type: Number, default: 60, min: 30, max: 365 }, // cooldown

  // Mensajes por tier (editables).
  tier1Message: {
    type: tierMessageSchema,
    default: () => ({
      title: '🤗 Te extrañamos',
      body:  'Hace unos días que no te vemos. ¿Todo bien? Hay novedades para vos.'
    })
  },
  tier2Message: {
    type: tierMessageSchema,
    default: () => ({
      title: '🎁 $1.000 GRATIS para vos',
      body:  'Volvé y te regalamos $1.000 listos para usar. Tocá la app.'
    })
  },
  tier3Message: {
    type: tierMessageSchema,
    default: () => ({
      title: '🔥 Última oportunidad — bono 100%',
      body:  'Cargás cualquier monto y te lo duplicamos. Pedí el código COD100.'
    })
  },

  // Bono del tier 2 (giveaway cash).
  tier2BonusAmount: { type: Number, default: 1000, min: 0, max: 50000 },
  tier2DurationHours: { type: Number, default: 48, min: 6, max: 168 },

  // Bono del tier 3 (promo-alert con código).
  tier3BonusPct: { type: Number, default: 100, min: 25, max: 200 },     // 50 ó 100 típicos
  tier3SuggestedAmount: { type: Number, default: 2000, min: 500, max: 100000 }, // texto del wa.link
  tier3DurationHours: { type: Number, default: 72, min: 12, max: 168 },

  // Filtros: solo gente que respondió encuesta? Excluir VIP top tier?
  onlySurveyResponders: { type: Boolean, default: false },
  excludeOpportunists: { type: Boolean, default: true },

  // Cap diario por tier para no quemar plata si la base es enorme.
  dailyCapTier2: { type: Number, default: 50, min: 0, max: 5000 },  // máx 50 cash giveaways/día
  dailyCapTier3: { type: Number, default: 100, min: 0, max: 5000 },

  // Stats agregadas (auto-actualiza el cron).
  totalSentByTier: {
    tier1: { type: Number, default: 0 },
    tier2: { type: Number, default: 0 },
    tier3: { type: Number, default: 0 }
  },
  lastCronRunAt: { type: Date, default: null },
  lastCronOutcome: { type: mongoose.Schema.Types.Mixed, default: null },

  updatedAt: { type: Date, default: Date.now },
  updatedBy: { type: String, default: 'admin' }
}, { timestamps: false });

module.exports = mongoose.models['WinbackStrategyConfig'] ||
  mongoose.model('WinbackStrategyConfig', winbackStrategyConfigSchema);
