
/**
 * Modelo de Fueguito (Racha Diaria)
 * Gestiona las rachas de actividad diaria de usuarios
 */
const mongoose = require('mongoose');

const fireStreakSchema = new mongoose.Schema({
  userId: { 
    type: String, 
    required: true, 
    unique: true, 
    index: true 
  },
  username: { 
    type: String, 
    required: true,
    trim: true
  },
  streak: { 
    type: Number, 
    default: 0,
    min: 0
  },
  lastClaim: { 
    type: Date, 
    default: null 
  },
  totalClaimed: { 
    type: Number, 
    default: 0,
    min: 0
  },
  lastReset: { 
    type: Date, 
    default: null 
  },
  history: [{
    date: { type: Date },
    reward: { type: Number, default: 0 },
    streakDay: { type: Number }
  }],
  // Premio pendiente "100% en próxima carga" (día 15)
  pendingNextLoadBonus: {
    type: Boolean,
    default: false
  },
  // Premio en efectivo pendiente de reclamo (días 10, 20, 30)
  pendingCashReward: {
    type: Number,
    default: 0,
    min: 0
  },
  pendingCashRewardDay: {
    type: Number,
    default: 0
  },
  pendingCashRewardDesc: {
    type: String,
    default: ''
  },
  // Fecha (string en formato Argentina) en que se desbloqueó la recompensa pendiente
  // Se usa para expirarla automáticamente si no se reclama el mismo día
  pendingCashRewardDate: {
    type: String,
    default: null
  }
}, {
  timestamps: true
});

// Método estático para obtener o crear streak
fireStreakSchema.statics.getOrCreate = async function(userId, username) {
  let streak = await this.findOne({ userId });
  
  if (!streak) {
    streak = await this.create({
      userId,
      username,
      streak: 0,
      totalClaimed: 0
    });
  }
  
  return streak;
};

// Método de instancia para verificar si puede reclamar hoy
fireStreakSchema.methods.canClaimToday = function() {
  if (!this.lastClaim) return true;
  
  const lastClaimDate = new Date(this.lastClaim).toDateString();
  const today = new Date().toDateString();
  
  return lastClaimDate !== today;
};

// Método de instancia para verificar si la racha está activa
fireStreakSchema.methods.isStreakActive = function() {
  if (!this.lastClaim) return false;
  
  const lastClaimDate = new Date(this.lastClaim);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  
  const lastClaimStr = lastClaimDate.toDateString();
  const yesterdayStr = yesterday.toDateString();
  const todayStr = new Date().toDateString();
  
  return lastClaimStr === yesterdayStr || lastClaimStr === todayStr;
};

// Método de instancia para reclamar día
fireStreakSchema.methods.claim = async function() {
  const today = new Date();
  const lastClaimDate = this.lastClaim ? new Date(this.lastClaim) : null;
  
  // Verificar si la racha continúa o se reinicia
  if (lastClaimDate) {
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    const lastClaimStr = lastClaimDate.toDateString();
    const yesterdayStr = yesterday.toDateString();
    const todayStr = today.toDateString();
    
    if (lastClaimStr !== yesterdayStr && lastClaimStr !== todayStr) {
      // Rota perdida
      this.streak = 0;
      this.lastReset = today;
    }
  }
  
  this.streak += 1;
  this.lastClaim = today;
  
  // Calcular recompensa
  let reward = 0;
  if (this.streak === 10) {
    reward = 10000;
    this.totalClaimed += reward;
  }
  
  // Agregar al historial
  this.history.push({
    date: today,
    reward,
    streakDay: this.streak
  });
  
  await this.save();
  
  return {
    streak: this.streak,
    reward,
    totalClaimed: this.totalClaimed
  };
};

module.exports = mongoose.models['FireStreak'] || mongoose.model('FireStreak', fireStreakSchema);