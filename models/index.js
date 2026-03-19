// ============================================
// MODELOS MONGODB - SALA DE JUEGOS
// ============================================

const mongoose = require('mongoose');

// ============================================
// ESQUEMA DE USUARIOS
// ============================================
const userSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  username: { type: String, required: true, unique: true, index: true },
  password: { type: String, required: true },
  email: { type: String },
  phone: { type: String },
  whatsapp: { type: String },
  role: { 
    type: String, 
    enum: ['user', 'admin', 'depositor', 'withdrawer'], 
    default: 'user',
    index: true 
  },
  accountNumber: { type: String, unique: true },
  balance: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
  lastLogin: { type: Date },
  isActive: { type: Boolean, default: true },
  
  // JUGAYGANA Integration
  jugayganaUserId: { type: String, index: true },
  jugayganaUsername: { type: String },
  jugayganaSyncStatus: { 
    type: String, 
    enum: ['pending', 'synced', 'linked', 'not_applicable'], 
    default: 'pending' 
  },
  
  // Token version for logout all sessions
  tokenVersion: { type: Number, default: 0 },
  passwordChangedAt: { type: Date }
});

// ============================================
// ESQUEMA DE MENSAJES (CHAT)
// ============================================
const messageSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  senderId: { type: String, required: true, index: true },
  senderUsername: { type: String, required: true },
  senderRole: { type: String, required: true },
  receiverId: { type: String, required: true, index: true },
  receiverRole: { type: String, required: true },
  content: { type: String, required: true },
  type: { type: String, default: 'text' },
  timestamp: { type: Date, default: Date.now, index: true },
  read: { type: Boolean, default: false },
  
  // Para mensajes con archivos/imágenes
  attachments: [{
    type: { type: String },
    url: String,
    name: String
  }]
});

// Índices para búsquedas rápidas
messageSchema.index({ senderId: 1, receiverId: 1, timestamp: -1 });
messageSchema.index({ receiverRole: 1, read: 1 });

// ============================================
// ESQUEMA DE ESTADO DE CHATS
// ============================================
const chatStatusSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true, index: true },
  username: { type: String, required: true },
  status: { 
    type: String, 
    enum: ['open', 'closed'], 
    default: 'open',
    index: true 
  },
  category: { 
    type: String, 
    enum: ['cargas', 'pagos'], 
    default: 'cargas' 
  },
  assignedTo: { type: String }, // Admin asignado
  closedAt: { type: Date },
  closedBy: { type: String },
  lastMessageAt: { type: Date, default: Date.now },
  unreadCount: { type: Number, default: 0 },
  notes: { type: String } // Notas del admin sobre el chat
});

// ============================================
// ESQUEMA DE COMANDOS PERSONALIZADOS
// ============================================
const commandSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, index: true },
  description: { type: String },
  type: { 
    type: String, 
    enum: ['message', 'bonus', 'redirect', 'api'], 
    default: 'message' 
  },
  bonusPercent: { type: Number, default: 0 },
  response: { type: String },
  responseType: { 
    type: String, 
    enum: ['text', 'markdown', 'html'], 
    default: 'text' 
  },
  isActive: { type: Boolean, default: true },
  usageCount: { type: Number, default: 0 },
  createdBy: { type: String }, // Admin que lo creó
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// ============================================
// ESQUEMA DE CONFIGURACIÓN (CBU, etc)
// ============================================
const configSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, index: true },
  value: { type: mongoose.Schema.Types.Mixed },
  updatedBy: { type: String },
  updatedAt: { type: Date, default: Date.now }
});

// ============================================
// ESQUEMA DE REEMBOLSOS
// ============================================
const refundSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  userId: { type: String, required: true, index: true },
  username: { type: String, required: true },
  type: { 
    type: String, 
    enum: ['daily', 'weekly', 'monthly'], 
    required: true,
    index: true 
  },
  amount: { type: Number, required: true },
  percentage: { type: Number, required: true },
  netAmount: { type: Number, required: true },
  deposits: { type: Number, default: 0 },
  withdrawals: { type: Number, default: 0 },
  period: { type: String }, // Fecha o rango del período
  claimedAt: { type: Date, default: Date.now, index: true },
  transactionId: { type: String }, // ID de transacción en JUGAYGANA
  status: { 
    type: String, 
    enum: ['completed', 'failed', 'pending'], 
    default: 'completed' 
  }
});

// Índice para evitar reclamos duplicados
refundSchema.index({ userId: 1, type: 1, claimedAt: -1 });

// ============================================
// ESQUEMA DE FUEGUITOS (RACHA DIARIA)
// ============================================
const fireRewardSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true, index: true },
  username: { type: String, required: true },
  streak: { type: Number, default: 0 },
  lastClaim: { type: Date },
  totalClaimed: { type: Number, default: 0 },
  history: [{
    date: { type: Date },
    streak: { type: Number },
    reward: { type: Number, default: 0 },
    transactionId: { type: String }
  }],
  updatedAt: { type: Date, default: Date.now }
});

// ============================================
// ESQUEMA DE TRANSACCIONES
// ============================================
const transactionSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  userId: { type: String, index: true },
  username: { type: String, required: true, index: true },
  type: { 
    type: String, 
    enum: ['deposit', 'withdrawal', 'bonus', 'refund', 'fire_reward'], 
    required: true,
    index: true 
  },
  amount: { type: Number, required: true },
  description: { type: String },
  status: { 
    type: String, 
    enum: ['pending', 'completed', 'failed'], 
    default: 'completed' 
  },
  externalId: { type: String }, // ID en JUGAYGANA
  adminId: { type: String }, // Quién realizó la acción (si aplica)
  adminUsername: { type: String },
  adminRole: { type: String },
  timestamp: { type: Date, default: Date.now, index: true }
});

// ============================================
// ESQUEMA DE ACTIVIDAD DE USUARIOS
// ============================================
const userActivitySchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  username: { type: String, required: true },
  date: { type: Date, required: true, index: true },
  deposits: { type: Number, default: 0 },
  withdrawals: { type: Number, default: 0 },
  messages: { type: Number, default: 0 },
  lastActivity: { type: Date, default: Date.now }
});

userActivitySchema.index({ userId: 1, date: 1 }, { unique: true });

// ============================================
// ESQUEMA DE USUARIOS EXTERNOS (base de datos externa)
// ============================================
const externalUserSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  username: { type: String, required: true, index: true },
  phone: { type: String },
  whatsapp: { type: String },
  email: { type: String },
  source: { type: String, default: 'chat' },
  firstContact: { type: Date, default: Date.now },
  lastContact: { type: Date, default: Date.now },
  messageCount: { type: Number, default: 0 },
  notes: { type: String }
});

// ============================================
// CREAR MODELOS
// ============================================
const User = mongoose.model('User', userSchema);
const Message = mongoose.model('Message', messageSchema);
const ChatStatus = mongoose.model('ChatStatus', chatStatusSchema);
const Command = mongoose.model('Command', commandSchema);
const Config = mongoose.model('Config', configSchema);
const Refund = mongoose.model('Refund', refundSchema);
const FireReward = mongoose.model('FireReward', fireRewardSchema);
const Transaction = mongoose.model('Transaction', transactionSchema);
const UserActivity = mongoose.model('UserActivity', userActivitySchema);
const ExternalUser = mongoose.model('ExternalUser', externalUserSchema);

// ============================================
// FUNCIÓN PARA CONECTAR A MONGODB
// ============================================
async function connectDB() {
  const MONGODB_URI = process.env.MONGODB_URI;
  
  if (!MONGODB_URI) {
    console.log('⚠️  MONGODB_URI no configurado. Usando JSON local (datos se perderán al reiniciar).');
    console.log('💡 Para persistencia, configura MONGODB_URI en variables de entorno.');
    return false;
  }
  
  try {
    await mongoose.connect(MONGODB_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    
    console.log('✅ Conectado a MongoDB Atlas');
    
    // Crear índices
    await Promise.all([
      User.createIndexes(),
      Message.createIndexes(),
      ChatStatus.createIndexes(),
      Command.createIndexes(),
      Config.createIndexes(),
      Refund.createIndexes(),
      FireReward.createIndexes(),
      Transaction.createIndexes(),
      UserActivity.createIndexes(),
      ExternalUser.createIndexes()
    ]);
    
    console.log('✅ Índices creados');
    return true;
  } catch (error) {
    console.error('❌ Error conectando a MongoDB:', error.message);
    console.log('⚠️  Fallback a JSON local');
    return false;
  }
}

// ============================================
// FUNCIONES HELPER
// ============================================

// Generar ID único
function generateId() {
  return require('uuid').v4();
}

// Generar número de cuenta
function generateAccountNumber() {
  return 'ACC' + Date.now().toString(36).toUpperCase() + 
         Math.random().toString(36).substr(2, 4).toUpperCase();
}

// ============================================
// EXPORTAR
// ============================================
module.exports = {
  connectDB,
  User,
  Message,
  ChatStatus,
  Command,
  Config,
  Refund,
  FireReward,
  Transaction,
  UserActivity,
  ExternalUser,
  generateId,
  generateAccountNumber
};
