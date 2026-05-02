/**
 * Notificación programada para envío futuro.
 *
 * El admin la crea con un scheduledFor en el futuro (hasta 1 semana).
 * Un worker en background cada 60s busca filas con status='pending' y
 * scheduledFor <= ahora, las dispara, y las marca como 'sent' o 'failed'.
 *
 * payload incluye TODO lo necesario para replicar el envío exactamente
 * como si el admin hubiera tocado "Enviar ahora": title, body, prefix,
 * promo (si aplica), giveaway (si aplica).
 */
const mongoose = require('mongoose');

const scheduledNotificationSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },

  scheduledFor: { type: Date, required: true, index: true },

  status: {
    type: String,
    enum: ['pending', 'processing', 'sent', 'failed', 'cancelled'],
    default: 'pending',
    index: true
  },

  // Marcado al pasar a 'processing' para detectar rows abandonadas si
  // el server crashea entre claim y completion.
  processingStartedAt: { type: Date, default: null },

  // Payload completo para replicar el envio. Mismo shape que el admin
  // pasa a sendBulkNotification.
  title: { type: String, required: true },
  body:  { type: String, required: true },
  audiencePrefix: { type: String, default: null, trim: true },

  // Tipo de extra: 'none' | 'promo' | 'giveaway'
  extraType: { type: String, enum: ['none', 'promo', 'giveaway'], default: 'none' },

  // Si extraType === 'promo'
  promoMessage:        { type: String, default: null },
  promoCode:           { type: String, default: null },
  promoDurationHours:  { type: Number, default: null },

  // Si extraType === 'giveaway'
  giveawayAmount:           { type: Number, default: null },
  giveawayBudget:           { type: Number, default: null },
  giveawayMaxClaims:        { type: Number, default: null },
  giveawayDurationMinutes:  { type: Number, default: null },

  createdAt: { type: Date, default: Date.now, index: true },
  createdBy: { type: String, default: null },

  // Cuando efectivamente se ejecuto (== scheduledFor + drift del worker).
  executedAt: { type: Date, default: null },
  errorMsg:   { type: String, default: null },

  // Vinculo al row de NotificationHistory creado al ejecutar (para que
  // el admin pueda hacer click y ver los contadores de respuesta).
  notificationHistoryId: { type: String, default: null }
}, { timestamps: true });

scheduledNotificationSchema.index({ status: 1, scheduledFor: 1 });

module.exports = mongoose.models['ScheduledNotification'] ||
  mongoose.model('ScheduledNotification', scheduledNotificationSchema);
