
// ============================================
// CONFIGURACIÓN MONGODB - PARA 100K+ USUARIOS
// ============================================

const mongoose = require('mongoose');


// ============================================
// MODELOS COMPARTIDOS
// Se importan desde src/models para evitar doble registro en Mongoose.
// config/database.js era el archivo legacy que definía los schemas inline;
// src/models/ es ahora la fuente canónica de todos los modelos compartidos.
// ============================================
const {
  User,
  Message,
  Command,
  Config,
  RefundClaim,
  FireStreak,
  ChatStatus,
  Transaction
} = require('../src/models');

// ============================================
// SCHEMA DE USUARIOS EXTERNOS (BASE EXTERNA)
// ============================================
const externalUserSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, sparse: true },
  username: { type: String, required: true, unique: true, index: true },
  phone: { type: String, default: null },
  whatsapp: { type: String, default: null },
  firstSeen: { type: Date, default: Date.now },
  lastSeen: { type: Date, default: Date.now },
  messageCount: { type: Number, default: 0 }
}, {
  timestamps: true
});

// ============================================
// SCHEMA DE ACTIVIDAD DE USUARIOS (PARA FUEGUITO)
// ============================================
const userActivitySchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  date: { type: String, required: true, index: true },
  deposits: { type: Number, default: 0 },
  withdrawals: { type: Number, default: 0 },
  lastActivity: { type: Date, default: Date.now }
}, {
  timestamps: true
});

userActivitySchema.index({ userId: 1, date: 1 }, { unique: true });

// ============================================
// CREAR MODELOS (solo los exclusivos de config/database)
// User, Message, Command, Config, RefundClaim, FireStreak,
// ChatStatus y Transaction se importan desde src/models arriba.
// ============================================
const ExternalUser = mongoose.models['ExternalUser'] || mongoose.model('ExternalUser', externalUserSchema);
const UserActivity = mongoose.models['UserActivity'] || mongoose.model('UserActivity', userActivitySchema);

// ============================================
// CONEXIÓN A MONGODB
// ============================================
async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/sala-de-juegos', {
      maxPoolSize: 20,
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

// ============================================
// DESCONECTAR
// ============================================
async function disconnectDB() {
  await mongoose.disconnect();
  console.log('MongoDB desconectado');
}

// ============================================
// FUNCIONES HELPER PARA CONFIGURACIÓN
// ============================================

// Obtener configuración por clave
async function getConfig(key, defaultValue = null) {
  try {
    const config = await Config.findOne({ key });
    return config ? config.value : defaultValue;
  } catch (error) {
    console.error(`Error obteniendo config ${key}:`, error);
    return defaultValue;
  }
}

// Guardar configuración
async function setConfig(key, value) {
  try {
    await Config.findOneAndUpdate(
      { key },
      { key, value, updatedAt: new Date() },
      { upsert: true, new: true }
    );
    return true;
  } catch (error) {
    console.error(`Error guardando config ${key}:`, error);
    return false;
  }
}

// ============================================
// FUNCIONES HELPER PARA COMANDOS
// ============================================

// Obtener todos los comandos
async function getAllCommands() {
  try {
    const commands = await Command.find({ isActive: true }).lean();
    const result = {};
    commands.forEach(cmd => {
      result[cmd.name] = cmd;
    });
    return result;
  } catch (error) {
    console.error('Error obteniendo comandos:', error);
    return {};
  }
}

// Obtener comando por nombre
async function getCommand(name) {
  try {
    return await Command.findOne({ name, isActive: true });
  } catch (error) {
    console.error(`Error obteniendo comando ${name}:`, error);
    return null;
  }
}

// Guardar comando
async function saveCommand(name, data) {
  try {
    await Command.findOneAndUpdate(
      { name },
      { ...data, name, updatedAt: new Date() },
      { upsert: true, new: true }
    );
    return true;
  } catch (error) {
    console.error(`Error guardando comando ${name}:`, error);
    return false;
  }
}

// Eliminar comando
async function deleteCommand(name) {
  try {
    await Command.deleteOne({ name });
    return true;
  } catch (error) {
    console.error(`Error eliminando comando ${name}:`, error);
    return false;
  }
}

// Incrementar uso de comando
async function incrementCommandUsage(name) {
  try {
    await Command.updateOne({ name }, { $inc: { usageCount: 1 } });
    return true;
  } catch (error) {
    console.error(`Error incrementando uso de comando ${name}:`, error);
    return false;
  }
}

// ============================================
// EXPORTAR
// ============================================
module.exports = {
  connectDB,
  disconnectDB,
  User,
  Message,
  Command,
  Config,
  RefundClaim,
  FireStreak,
  ChatStatus,
  Transaction,
  ExternalUser,
  UserActivity,
  // Helpers
  getConfig,
  setConfig,
  getAllCommands,
  getCommand,
  saveCommand,
  deleteCommand,
  incrementCommandUsage
};