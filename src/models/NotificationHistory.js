/**
 * Modelo de Historial de Notificaciones
 * Cada vez que se manda un push masivo (con o sin promo), se guarda una
 * entrada con: titulo, cuerpo, audiencia, tipo de promo, contadores de
 * clicks WhatsApp y reclamos de regalo, y stats del envio.
 *
 * Sirve para que el admin tenga analisis historico: que mando, a quien,
 * cuando, y cuanta gente respondio.
 */
const mongoose = require('mongoose');

const notificationHistorySchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },

  // Cuando se mando realmente (si fue inmediato == createdAt; si fue
  // programado == el momento real de envio).
  sentAt: { type: Date, default: Date.now, index: true },

  // Si fue programado para el futuro, registramos cuando se programo y
  // cuando se ejecuto. scheduledFor=null significa envio inmediato.
  scheduledFor: { type: Date, default: null },

  // Audiencia: 'all' o 'prefix'. Si prefix, guardamos el prefix usado.
  audienceType: { type: String, enum: ['all', 'prefix'], default: 'all' },
  audiencePrefix: { type: String, default: null, trim: true },

  // Contenido del push.
  title: { type: String, required: true },
  body:  { type: String, required: true },

  // Tipo de notificacion. 'plain' = solo push.
  // 'whatsapp_promo' = ademas activo cartel "RECLAMÁ" con codigo + WA.
  // 'money_giveaway' = ademas activo regalo de plata reclamable on-tap.
  type: {
    type: String,
    enum: ['plain', 'whatsapp_promo', 'money_giveaway'],
    default: 'plain',
    index: true
  },

  // Snapshot de la promo (para display historico aunque la promo se borre).
  promoMessage: { type: String, default: null },
  promoCode:    { type: String, default: null },
  promoExpiresAt: { type: Date, default: null },

  // Snapshot del giveaway (para display historico).
  giveawayAmount:        { type: Number, default: null },
  giveawayDurationMins:  { type: Number, default: null },
  giveawayExpiresAt:     { type: Date, default: null },

  // Stats del envio FCM.
  totalUsers:    { type: Number, default: 0 },
  successCount:  { type: Number, default: 0 },
  failureCount:  { type: Number, default: 0 },
  cleanedTokens: { type: Number, default: 0 },

  // Contadores de respuesta del usuario.
  // waClicks = veces que un user toco el cartel/boton de WhatsApp
  //   habilitado por esta notificacion.
  // giveawayClaims = veces que un user reclamo el regalo de esta notif
  //   (idealmente = users distintos porque el endpoint es one-time per user).
  waClicks:        { type: Number, default: 0 },
  giveawayClaims:  { type: Number, default: 0 },

  sentBy: { type: String, default: null },
}, {
  timestamps: true
});

notificationHistorySchema.index({ sentAt: -1 });
notificationHistorySchema.index({ type: 1, sentAt: -1 });

module.exports = mongoose.models['NotificationHistory'] ||
  mongoose.model('NotificationHistory', notificationHistorySchema);
