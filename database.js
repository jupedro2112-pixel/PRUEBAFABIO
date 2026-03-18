// ============================================
// CONFIGURACIÓN MONGODB - PARA 100K+ USUARIOS
// ============================================

const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/sala-de-juegos';

// Schema de Usuario
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, index: true },
  password: { type: String, required: true },
  email: { type: String, default: null },
  phone: { type: String, default: null },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  accountNumber: { type: String, unique: true },
  balance: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
  lastLogin: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
  
  // Campos JUGAYGANA
  jugayganaUserId: { type: Number, default: null },
  jugayganaUsername: { type: String, default: null },
  jugayganaSyncStatus: { 
    type: String, 
    enum: ['pending', 'synced', 'linked', 'error', 'imported'], 
    default: 'pending' 
  },
  jugayganaSyncError: { type: String, default: null },
  source: { type: String, enum: ['local', 'jugaygana'], default: 'local' }
}, {
  timestamps: true
});

// Schema de Mensajes
const messageSchema = new mongoose.Schema({
  senderId: { type: String, required: true, index: true },
  senderUsername: { type: String, required: true },
  senderRole: { type: String, enum: ['user', 'admin'], required: true },
  receiverId: { type: String, required: true, index: true },
  receiverRole: { type: String, enum: ['user', 'admin'], required: true },
  content: { type: String, required: true },
  type: { type: String, enum: ['text', 'image'], default: 'text' },
  read: { type: Boolean, default: false },
  timestamp: { type: Date, default: Date.now, index: true }
}, {
  timestamps: true
});

// Schema de Reembolsos - NUEVO para verificación en MongoDB
const refundSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  userId: { type: String, required: true, index: true },
  username: { type: String, required: true },
  type: { type: String, enum: ['daily', 'weekly', 'monthly'], required: true },
  amount: { type: Number, required: true },
  netAmount: { type: Number, required: true },
  deposits: { type: Number, default: 0 },
  withdrawals: { type: Number, default: 0 },
  date: { type: Date, default: Date.now },
  status: { type: String, enum: ['claimed', 'pending', 'failed'], default: 'claimed' }
}, {
  timestamps: true
});

// Índices para búsquedas rápidas de reembolsos
refundSchema.index({ userId: 1, type: 1, date: -1 });
refundSchema.index({ userId: 1, date: -1 });

// Schema para Fueguito (Fire Reward)
const fireRewardSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  streak: { type: Number, default: 0 },
  lastClaim: { type: Date, default: null },
  totalClaimed: { type: Number, default: 0 }
}, {
  timestamps: true
});

// Índices para búsquedas rápidas
userSchema.index({ jugayganaUserId: 1 });
userSchema.index({ jugayganaSyncStatus: 1 });
messageSchema.index({ senderId: 1, receiverId: 1 });
messageSchema.index({ timestamp: -1 });

// Verificar si los modelos ya existen (para evitar OverwriteModelError)
const User = mongoose.models.User || mongoose.model('User', userSchema);
const Message = mongoose.models.Message || mongoose.model('Message', messageSchema);
const Refund = mongoose.models.Refund || mongoose.model('Refund', refundSchema);
const FireReward = mongoose.models.FireReward || mongoose.model('FireReward', fireRewardSchema);

// Conectar a MongoDB
async function connectDB() {
  try {
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      maxPoolSize: 50, // Para manejar muchas conexiones
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    console.log('✅ MongoDB conectado');
    return true;
  } catch (error) {
    console.error('❌ Error conectando MongoDB:', error.message);
    return false;
  }
}

// Desconectar
async function disconnectDB() {
  await mongoose.disconnect();
  console.log('MongoDB desconectado');
}

module.exports = {
  connectDB,
  disconnectDB,
  User,
  Message,
  Refund,
  FireReward
};
