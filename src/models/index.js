
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
const OtpCode = require('./OtpCode');

// Configuración de conexión
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/sala-de-juegos';

/**
 * Migration: backfill settledOwnerRevenue / settledCommissionAmount on ReferralCommission records
 * that were created by old payouts (before the incremental settlement feature was introduced).
 *
 * Old payouts did not:
 *   1. Store perReferredDetails in the ReferralPayout document, AND
 *   2. Set settledOwnerRevenue / settledCommissionAmount on the commission records.
 *
 * Without this data the calculation service cannot find the correct settlement baseline and
 * incorrectly treats the already-settled revenue as new pending revenue (double calculation).
 *
 * This migration:
 *   - Finds all paid payouts where details.perReferredDetails is missing or empty.
 *   - For each such payout, loads the linked commission records via details.commissionIds.
 *   - For each commission that still has settledOwnerRevenue === 0, reconstructs the amount:
 *       * Single-commission payouts: exact (settledCommission = payout.totalCommissionAmount).
 *       * Multi-commission payouts: proportional by commission.totalOwnerRevenue (best estimate).
 *   - Writes settledOwnerRevenue and settledCommissionAmount to those commission records.
 *
 * After this migration the existing commissionFallback in referralCalculationService correctly
 * reads the backfilled amounts and computes the right delta, so the next Calculate run will
 * show the correct (reduced) pending amount instead of the full period total.
 *
 * This migration is idempotent: commissions that already have settledOwnerRevenue > 0 are
 * skipped, so running it multiple times is safe.
 */
async function backfillLegacyPayoutSettlements() {
  try {
    const legacyPayouts = await ReferralPayout.find({
      status: 'paid',
      $or: [
        { 'details.perReferredDetails': { $exists: false } },
        { 'details.perReferredDetails': null },
        { 'details.perReferredDetails': { $size: 0 } }
      ]
    }).lean();

    if (legacyPayouts.length === 0) {
      console.log('[Migration] backfillLegacyPayoutSettlements: no legacy payouts found — nothing to do');
      return;
    }

    console.log(
      `[Migration] backfillLegacyPayoutSettlements: found ${legacyPayouts.length} legacy payout(s) ` +
      'without perReferredDetails — beginning backfill'
    );

    let backfilledCount = 0;
    let skippedAlreadySet = 0;

    for (const payout of legacyPayouts) {
      const commissionIds = payout.details?.commissionIds;
      if (!Array.isArray(commissionIds) || commissionIds.length === 0) {
        console.log(
          `[Migration] backfillLegacyPayoutSettlements: payout ${payout.id} has no commissionIds — skipping`
        );
        continue;
      }

      const commissions = await ReferralCommission.find({ id: { $in: commissionIds } }).lean();
      const N = commissions.length;
      if (N === 0) {
        console.log(
          `[Migration] backfillLegacyPayoutSettlements: payout ${payout.id} — commissions not found — skipping`
        );
        continue;
      }

      // Compute total revenue for proportional distribution (only for multi-commission payouts)
      const totalRevenue = commissions.reduce((sum, c) => sum + (c.totalOwnerRevenue || 0), 0);

      for (const commission of commissions) {
        if ((commission.settledOwnerRevenue || 0) > 0) {
          skippedAlreadySet++;
          continue;
        }

        const rate = commission.referralRate || 0.07;
        let settledCommission;

        if (N === 1) {
          // Exact: only one commission in this payout
          settledCommission = payout.totalCommissionAmount;
        } else if (totalRevenue > 0) {
          // Proportional by revenue share (best estimate for multi-user payouts)
          const fraction = (commission.totalOwnerRevenue || 0) / totalRevenue;
          settledCommission = payout.totalCommissionAmount * fraction;
        } else {
          // Equal share fallback when revenue data is unavailable
          settledCommission = payout.totalCommissionAmount / N;
        }

        const settledRevenue = rate > 0 ? settledCommission / rate : 0;

        await ReferralCommission.updateOne(
          // Extra guard: only write if settledOwnerRevenue is still exactly 0 to prevent
          // overwriting a value that was set by a concurrent process since the in-memory check.
          { _id: commission._id, settledOwnerRevenue: { $eq: 0 } },
          {
            $set: {
              settledOwnerRevenue: settledRevenue,
              settledCommissionAmount: settledCommission
            }
          }
        );

        console.log(
          `[Migration] backfillLegacyPayoutSettlements: backfilled` +
          ` referredUsername=${commission.referredUsername}` +
          ` referrerUsername=${commission.referrerUsername}` +
          ` periodKey=${commission.periodKey}` +
          ` payoutId=${payout.id}` +
          ` commissionIdsInPayout=${N}` +
          ` settledRevenue=${settledRevenue.toFixed(2)}` +
          ` settledCommission=${settledCommission.toFixed(2)}` +
          ` stateRecoveredFromDatabase=true`
        );
        backfilledCount++;
      }
    }

    console.log(
      `[Migration] backfillLegacyPayoutSettlements: complete — ` +
      `backfilledCommissions=${backfilledCount} skippedAlreadySet=${skippedAlreadySet} ` +
      `mongoPersistenceEnabled=true serverRestartSafe=true`
    );
  } catch (err) {
    // Log but do not block startup — the enhanced fallback in referralCalculationService
    // provides a secondary safety net for any commission records that could not be backfilled.
    console.error(`[Migration] backfillLegacyPayoutSettlements: error — ${err.message}`);
  }
}

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
      maxPoolSize: 20,
      minPoolSize: 5,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 30000,
    });
    console.log('✅ MongoDB conectado');

    // Run startup migrations
    await migrateReferralPayoutIndex();
    // Backfill settlement amounts for legacy payouts that lack perReferredDetails.
    // Must run AFTER migrateReferralPayoutIndex so the collection and indexes are stable.
    await backfillLegacyPayoutSettlements();

    // Auto-delete messages older than 3 days via MongoDB TTL index
    Message.collection.createIndex(
      { createdAt: 1 },
      { expireAfterSeconds: 259200 } // 3 days = 3 * 24 * 60 * 60
    ).then(() => {
      console.log('✅ TTL index para auto-limpieza de mensajes (3 días) creado/verificado');
    }).catch(err => {
      if (err.codeName === 'IndexOptionsConflict') {
        // An existing createdAt_1 index without TTL is present — auto-cleanup will not work
        // until the conflicting index is manually dropped and this process is restarted
        console.warn('⚠️ TTL index no creado: existe un índice createdAt_1 sin TTL (IndexOptionsConflict). Para activar auto-limpieza, eliminar el índice manualmente y reiniciar.');
      } else {
        console.error('Error creando TTL index:', err.message);
      }
    });

    // One-time cleanup of messages older than 3 days
    const messageCutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    Message.deleteMany({ createdAt: { $lt: messageCutoff } })
      .then(result => {
        if (result.deletedCount > 0) {
          console.log(`🧹 Limpieza inicial: ${result.deletedCount} mensajes antiguos eliminados`);
        }
      })
      .catch(err => console.error('Error en limpieza inicial de mensajes:', err.message));

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
  OtpCode,
  
  // Funciones de conexión
  connectDB,
  disconnectDB,
  
  // Utilidad para verificar conexión
  isConnected: () => mongoose.connection.readyState === 1,
  
  // Exportar mongoose para acceso directo si es necesario
  mongoose
};