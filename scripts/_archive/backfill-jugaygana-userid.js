#!/usr/bin/env node
// ============================================
// BACKFILL MASIVO DE jugayganaUserId
//
// Este script revisa todos los usuarios locales que no tienen jugayganaUserId
// y los intenta completar consultando la plataforma JUGAYGANA por username exacto.
//
// Uso:
//   node scripts/backfill-jugaygana-userid.js
//
// Variables de entorno requeridas (igual que el servidor):
//   MONGODB_URI, PLATFORM_USER, PLATFORM_PASS, PROXY_URL (opcional)
//
// Opciones de entorno opcionales:
//   BACKFILL_BATCH_DELAY_MS  - ms de espera entre usuarios (default: 300)
//   BACKFILL_DRY_RUN=1       - simular sin escribir en la base
// ============================================

require('dotenv').config();

const mongoose = require('mongoose');
const jugayganaService = require('../src/services/jugayganaService');

// =====================
// Configuración
// =====================
const MONGODB_URI = process.env.MONGODB_URI;
const BATCH_DELAY_MS = parseInt(process.env.BACKFILL_BATCH_DELAY_MS || '300', 10);
const DRY_RUN = process.env.BACKFILL_DRY_RUN === '1';

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI no definido en las variables de entorno.');
  process.exit(1);
}

// =====================
// Helpers
// =====================
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// =====================
// Main
// =====================
async function main() {
  console.log('==========================================================');
  console.log(' BACKFILL MASIVO: jugayganaUserId');
  if (DRY_RUN) console.log(' ⚠️  MODO DRY RUN – no se escribirá nada en la base');
  console.log('==========================================================\n');

  // Conectar a MongoDB
  await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  console.log('✅ Conectado a MongoDB\n');

  // Importar modelo User (después de conectar)
  const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }));

  // Buscar usuarios sin jugayganaUserId y con rol 'user'
  const usersToProcess = await User.find(
    {
      role: 'user',
      $or: [
        { jugayganaUserId: null },
        { jugayganaUserId: { $exists: false } }
      ]
    },
    { id: 1, username: 1, jugayganaUserId: 1 }
  ).lean();

  const total = usersToProcess.length;
  console.log(`🔍 Usuarios sin jugayganaUserId encontrados: ${total}\n`);

  if (total === 0) {
    console.log('✅ Ningún usuario requiere backfill. Fin.');
    await mongoose.disconnect();
    return;
  }

  // Contadores de resultado
  const result = {
    updated: 0,
    skipped: 0,
    conflict: 0,
    error: 0
  };

  const log = {
    updated: [],
    skipped: [],
    conflict: [],
    error: []
  };

  for (let i = 0; i < usersToProcess.length; i++) {
    const user = usersToProcess[i];
    const username = user.username;
    const userId = user.id || user._id?.toString();

    process.stdout.write(`[${i + 1}/${total}] ${username} … `);

    try {
      const jgUser = await jugayganaService.getUserInfo(username);

      if (!jgUser || !jgUser.id) {
        console.log('⚠️  no encontrado en JUGAYGANA (omitido)');
        result.skipped++;
        log.skipped.push(username);
        await sleep(BATCH_DELAY_MS);
        continue;
      }

      // Verificar match exacto de username
      const remoteUsername = String(jgUser.username || '').toLowerCase().trim();
      const localUsername = String(username || '').toLowerCase().trim();

      if (remoteUsername !== localUsername) {
        console.log(`⚠️  match no confiable: local="${localUsername}" vs JUGAYGANA="${remoteUsername}" (omitido)`);
        result.conflict++;
        log.conflict.push({ username, remote: jgUser.username });
        await sleep(BATCH_DELAY_MS);
        continue;
      }

      const resolvedId = jgUser.id;

      if (DRY_RUN) {
        console.log(`[DRY RUN] jugayganaUserId=${resolvedId}`);
        result.updated++;
        log.updated.push({ username, jugayganaUserId: resolvedId });
      } else {
        const updateResult = await User.updateOne(
          {
            $or: [{ id: userId }, { _id: user._id }],
            $or: [
              { jugayganaUserId: null },
              { jugayganaUserId: { $exists: false } }
            ]
          },
          {
            $set: {
              jugayganaUserId: resolvedId,
              jugayganaUsername: jgUser.username,
              jugayganaSyncStatus: 'linked'
            }
          }
        );

        if (updateResult.modifiedCount > 0) {
          console.log(`✅ jugayganaUserId=${resolvedId}`);
          result.updated++;
          log.updated.push({ username, jugayganaUserId: resolvedId });
        } else {
          console.log('ℹ️  sin cambios (puede ya estar cargado en otro proceso)');
          result.skipped++;
          log.skipped.push(username);
        }
      }
    } catch (err) {
      console.log(`❌ error: ${err.message}`);
      result.error++;
      log.error.push({ username, error: err.message });
    }

    await sleep(BATCH_DELAY_MS);
  }

  // Resumen final
  console.log('\n==========================================================');
  console.log(' RESUMEN DEL BACKFILL');
  console.log('==========================================================');
  console.log(`  Total procesados : ${total}`);
  console.log(`  ✅ Actualizados   : ${result.updated}`);
  console.log(`  ⚠️  Omitidos       : ${result.skipped}`);
  console.log(`  ⚠️  Conflictos     : ${result.conflict}`);
  console.log(`  ❌ Errores        : ${result.error}`);

  if (log.conflict.length > 0) {
    console.log('\nConflictos (username no coincide exactamente):');
    log.conflict.forEach(c => console.log(`  - ${c.username} (JUGAYGANA: ${c.remote})`));
  }

  if (log.error.length > 0) {
    console.log('\nErrores:');
    log.error.forEach(e => console.log(`  - ${e.username}: ${e.error}`));
  }

  console.log('==========================================================\n');

  await mongoose.disconnect();
  console.log('✅ Desconectado de MongoDB. Fin del backfill.');
}

main().catch(err => {
  console.error('❌ Error fatal en backfill:', err);
  process.exit(1);
});
