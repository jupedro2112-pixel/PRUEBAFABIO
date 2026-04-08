
/**
 * Índice de Modelos
 * Exporta todos los modelos de Mongoose
 */
const mongoose = require('mongoose');

// Importar modelos
const User = require('./User');
const Message = require('./Message');
const ChatStatus = require('./ChatStatus');
const Transaction = require('./Transaction');
const RefundClaim = require('./RefundClaim');
const FireStreak = require('./FireStreak');
const Command = require('./Command');
const Config = require('./Config');
const ReferralCommission = require('./ReferralCommission');
const ReferralPayout = require('./ReferralPayout');
const ReferralEvent = require('./ReferralEvent');

// Configuración de conexión
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/sala-de-juegos';

/**
 * Migration: drop the old unique index on referralpayouts {periodKey, referrerUserId}.
 *
 * Background: the original schema had a unique compound index on (periodKey, referrerUserId)
 * which allowed only ONE payout per referrer per period.  The incremental settlement feature
 * requires multiple payouts for the same referrer/period (one per delta batch).  The Mongoose
 * schema was already updated to remove the `unique: true` flag, but the physical MongoDB index
 * must be explicitly dropped — Mongoose does not remove existing indexes automatically.
 *
 * This migration is idempotent: if the unique index no longer exists, it exits silently.
 */
async function migrateReferralPayoutIndex() {
  try {
    const collection = mongoose.connection.collection('referralpayouts');

    // List existing indexes to detect the old unique one
    const indexes = await collection.indexes();
    const oldUniqueIndexName = 'periodKey_1_referrerUserId_1';
    const oldIndex = indexes.find(idx => idx.name === oldUniqueIndexName);

    if (!oldIndex) {
      console.log('[Migration] referralpayouts: old unique index not found — nothing to migrate');
      return;
    }

    const isUnique = !!oldIndex.unique;
    console.log(
      `[Migration] referralpayouts: found index "${oldUniqueIndexName}" unique=${isUnique} — ` +
      (isUnique ? 'dropping to enable incremental payouts' : 'already non-unique, dropping to recreate cleanly')
    );

    await collection.dropIndex(oldUniqueIndexName);
    console.log(
      `[Migration] referralpayouts: index "${oldUniqueIndexName}" dropped successfully. ` +
      'Multiple payouts per period+referrer are now supported (incremental settlement).'
    );
  } catch (err) {
    // Log but do not block startup — worst case the old index may still exist and will
    // only affect new delta payouts for referrers who already have a payout in that period.
    console.error('[Migration] referralpayouts: error dropping old unique index:', err.message);
  }
}

/**
 * Conectar a MongoDB y ejecutar migraciones de inicio
 */
async function connectDB() {
  try {
    await mongoose.connect(MONGODB_URI, {
      maxPoolSize: 50,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    console.log('✅ MongoDB conectado');

    // Run startup migrations
    await migrateReferralPayoutIndex();

    return true;
  } catch (error) {
    console.error('❌ Error conectando MongoDB:', error.message);
    return false;
  }
}

/**
 * Desconectar de MongoDB
 */
async function disconnectDB() {
  await mongoose.disconnect();
  console.log('MongoDB desconectado');
}

// Exportar modelos y funciones
module.exports = {
  // Modelos
  User,
  Message,
  ChatStatus,
  Transaction,
  RefundClaim,
  FireStreak,
  Command,
  Config,
  ReferralCommission,
  ReferralPayout,
  ReferralEvent,
  
  // Funciones de conexión
  connectDB,
  disconnectDB,
  
  // Utilidad para verificar conexión
  isConnected: () => mongoose.connection.readyState === 1,
  
  // Exportar mongoose para acceso directo si es necesario
  mongoose
};