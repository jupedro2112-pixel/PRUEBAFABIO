/**
 * Review: opinión que deja un usuario sobre el servicio.
 *
 * 1 review por user (upsert). El user puede editar su propia review
 * cuando quiera; la última versión es la que se muestra.
 *
 * stars: 1-5 entero. Bucket de categoría se calcula al leer:
 *   1-2 = malo · 3 = regular · 4-5 = bueno
 */
const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  id:        { type: String, required: true, unique: true, index: true },
  userId:    { type: String, required: true, unique: true, index: true },
  username:  { type: String, required: true, index: true },
  stars:     { type: Number, required: true, min: 1, max: 5 },
  comment:   { type: String, default: '', maxlength: 100 },
  createdAt: { type: Date, default: Date.now, index: true },
  updatedAt: { type: Date, default: Date.now }
}, { timestamps: false });

reviewSchema.index({ stars: 1, createdAt: -1 });

module.exports = mongoose.models['Review'] ||
  mongoose.model('Review', reviewSchema);
