// ============================================
// CONFIGURACIÓN MONGODB - PARA 100K+ USUARIOS
// ============================================

const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI;

// Schema de Usuario (coincide con estructura JSON existente)
const userSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  username: { type: String, required: true, unique: true, index: true },
  password: { type: String, required: true },
  email: { type: String, default: null },
  phone: { type: String, default: null },
  whatsapp: { type: String, default: null },
  role: { type: String, enum: ['user', 'admin', 'depositor', 'withdrawer'], default: 'user' },
  accountNumber: { type: String, unique: true },
  balance: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
  lastLogin: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
  
  // Campos adicionales
  tokenVersion: { type: Number, default: 0 },
  passwordChangedAt: { type: Date, default: null },
  needsPasswordChange: { type: Boolean, default: false },
  isFirstLogin: { type: Boolean, default: true },
  
  // Campos JUGAYGANA
  jugayganaUserId: { type: Number, default: null },
  jugayganaUsername: { type: String, default: null },
  jugayganaSyncStatus: { 
    type: String, 
    enum: ['pending', 'synced', 'linked', 'error', 'imported', 'not_applicable'], 
    default: 'pending' 
  },
  jugayganaSyncError: { type: String, default: null },
  source: { type: String, enum: ['local', 'jugaygana'], default: 'local' }
}, {
  timestamps: true
});

// Schema de Mensajes
const messageSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  senderId: { type: String, required: true, index: true },
  senderUsername: { type: String, required: true },
  senderRole: { type: String, enum: ['user', 'admin', 'system', 'system-welcome'], required: true },
  receiverId: { type: String, required: true, index: true },
  receiverRole: { type: String, enum: ['user', 'admin'], required: true },
  content: { type: String, required: true },
  type: { type: String, enum: ['text', 'image'], default: 'text' },
  read: { type: Boolean, default: false },
  timestamp: { type: Date, default: Date.now, index: true }
}, {
  timestamps: true
});

// Schema de Reembolsos
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
  status: { type: String, enum: ['claimed', 'pending'], default: 'claimed' }
}, {
  timestamps: true
});

// Schema de Estado de Chats
const chatStatusSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true, index: true },
  status: { type: String, enum: ['open', 'closed'], default: 'open' },
  category: { type: String, enum: ['cargas', 'pagos'], default: 'cargas' },
  assignedTo: { type: String, default: null },
  closedAt: { type: Date, default: null },
  closedBy: { type: String, default: null }
}, {
  timestamps: true
});

// Schema de Actividad de Usuario (Fueguito)
const userActivitySchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true, index: true },
  days: { type: Map, of: mongoose.Schema.Types.Mixed, default: {} }
}, {
  timestamps: true
});

// Schema de Recompensas de Fueguito
const fireRewardSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true, index: true },
  streak: { type: Number, default: 0 },
  lastClaim: { type: Date, default: null },
  totalClaimed: { type: Number, default: 0 }
}, {
  timestamps: true
});

// Schema de Configuración del Sistema
const configSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: mongoose.Schema.Types.Mixed, required: true }
}, {
  timestamps: true
});

// Schema de Comandos Personalizados
const customCommandSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  description: { type: String, default: '' },
  type: { type: String, default: 'text' },
  bonusPercent: { type: Number, default: 0 },
  response: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
}, {
  timestamps: true
});

// Schema de Transacciones
const transactionSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  type: { type: String, enum: ['deposit', 'withdrawal', 'bonus', 'refund'], required: true },
  amount: { type: Number, required: true },
  username: { type: String, required: true },
  description: { type: String, default: '' },
  adminId: { type: String, default: null },
  adminUsername: { type: String, default: null },
  adminRole: { type: String, default: null },
  timestamp: { type: Date, default: Date.now }
}, {
  timestamps: true
});

// Schema de Usuarios Externos (para base de datos externa)
const externalUserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  phone: { type: String, default: null },
  whatsapp: { type: String, default: null },
  firstSeen: { type: Date, default: Date.now },
  lastSeen: { type: Date, default: Date.now },
  messageCount: { type: Number, default: 1 }
}, {
  timestamps: true
});

// Schema de Log de Sincronización
const syncLogSchema = new mongoose.Schema({
  inProgress: { type: Boolean, default: false },
  inProgressStartedAt: { type: Date, default: null },
  lastSync: { type: Date, default: null },
  totalSynced: { type: Number, default: 0 },
  lastResult: { type: mongoose.Schema.Types.Mixed, default: null },
  lastError: { type: String, default: null }
}, {
  timestamps: true
});

// Índices para búsquedas rápidas
userSchema.index({ jugayganaUserId: 1 });
userSchema.index({ jugayganaSyncStatus: 1 });
userSchema.index({ phone: 1 });
userSchema.index({ createdAt: -1 });
messageSchema.index({ senderId: 1, receiverId: 1 });
messageSchema.index({ timestamp: -1 });
refundSchema.index({ userId: 1, type: 1 });
refundSchema.index({ date: -1 });
transactionSchema.index({ timestamp: -1 });
transactionSchema.index({ username: 1 });

const User = mongoose.model('User', userSchema);
const Message = mongoose.model('Message', messageSchema);
const Refund = mongoose.model('Refund', refundSchema);
const ChatStatus = mongoose.model('ChatStatus', chatStatusSchema);
const UserActivity = mongoose.model('UserActivity', userActivitySchema);
const FireReward = mongoose.model('FireReward', fireRewardSchema);
const Config = mongoose.model('Config', configSchema);
const CustomCommand = mongoose.model('CustomCommand', customCommandSchema);
const Transaction = mongoose.model('Transaction', transactionSchema);
const ExternalUser = mongoose.model('ExternalUser', externalUserSchema);
const SyncLog = mongoose.model('SyncLog', syncLogSchema);

// Conectar a MongoDB
async function connectDB() {
  if (!MONGODB_URI) {
    console.log('⚠️ MONGODB_URI no configurado. Usando almacenamiento en memoria/JSON.');
    return false;
  }
  
  try {
    await mongoose.connect(MONGODB_URI, {
      maxPoolSize: 50,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    console.log('✅ MongoDB conectado');
    return true;
  } catch (error) {
    console.error('❌ Error conectando MongoDB:', error.message);
    console.log('⚠️ Usando almacenamiento en memoria/JSON como fallback.');
    return false;
  }
}

// Desconectar
async function disconnectDB() {
  await mongoose.disconnect();
  console.log('MongoDB desconectado');
}

// Verificar conexión
function isConnected() {
  return mongoose.connection.readyState === 1;
}

module.exports = {
  connectDB,
  disconnectDB,
  isConnected,
  User,
  Message,
  Refund,
  ChatStatus,
  UserActivity,
  FireReward,
  Config,
  CustomCommand,
  Transaction,
  ExternalUser,
  SyncLog
};
