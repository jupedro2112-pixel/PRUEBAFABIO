
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
 * The ReferralPayout schema uses autoIndex:false so Mongoose never tries to auto-create its
 * indexes.  After this migration runs, we manually call ReferralPayout.createIndexes() to
 * ensure the new non-unique composite index is in place.  This prevents the race condition
 * where Mongoose's autoIndex fires before the migration and either silently fails (leaving
 * the old unique index in place) or creates a redundant index.
 *
 * This migration is idempotent: if the unique index no longer exists it exits silently.
 */
async function migrateReferralPayoutIndex() {
  const INDEX_NAME = 'periodKey_1_referrerUserId_1';
  try {
    const collection = mongoose.connection.collection('referralpayouts');

    // List existing indexes to detect the old unique one
    let indexes = [];
    try {
      indexes = await collection.indexes();
    } catch (listErr) {
      // Collection may not exist yet on a fresh deployment — that is fine
      console.log('[Migration] referralpayouts: could not list indexes (collection may not exist yet):', listErr.message);
    }

    const oldIndex = indexes.find(idx => idx.name === INDEX_NAME);

    if (!oldIndex) {
      console.log(`[Migration] referralpayouts: index "${INDEX_NAME}" not found — nothing to drop`);
    } else {
      const isUnique = !!oldIndex.unique;
      console.log(
        `[Migration] referralpayouts: found index "${INDEX_NAME}" unique=${isUnique} — ` +
        (isUnique ? 'dropping to enable incremental payouts' : 'already non-unique, dropping to recreate cleanly')
      );
      try {
        await collection.dropIndex(INDEX_NAME);
        console.log(
          `[Migration] referralpayouts: index "${INDEX_NAME}" dropped successfully. ` +
          'Multiple payouts per period+referrer are now supported (incremental settlement).'
        );
      } catch (dropErr) {
        console.error(`[Migration] referralpayouts: error dropping index "${INDEX_NAME}":`, dropErr.message);
      }
    }

    // Now create (or re-create) the correct non-unique indexes via the schema definition.
    // ReferralPayout.autoIndex is false so this must be done explicitly here.
    try {
      await ReferralPayout.createIndexes();
      console.log('[Migration] referralpayouts: indexes (re)created successfully — mongoPersistenceEnabled=true serverRestartSafe=true');
    } catch (createErr) {
      console.error('[Migration] referralpayouts: error creating indexes:', createErr.message);
    }
  } catch (err) {
    // Log but do not block startup — worst case the old index may still exist; the payout
    // service has its own E11000 recovery handler for this situation.
    console.error('[Migration] referralpayouts: unexpected error during index migration:', err.message);
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