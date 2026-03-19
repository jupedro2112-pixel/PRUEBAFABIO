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

// Índices para búsquedas rápidas
userSchema.index({ jugayganaUserId: 1 });
userSchema.index({ jugayganaSyncStatus: 1 });
messageSchema.index({ senderId: 1, receiverId: 1 });
messageSchema.index({ timestamp: -1 });

const User = mongoose.model('User', userSchema);
const Message = mongoose.model('Message', messageSchema);

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
  Message
};