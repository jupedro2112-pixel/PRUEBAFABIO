#!/usr/bin/env node
// ============================================
// SEED PUNTUAL: Fire Streak para neymar11
//
// Propósito:
//   Deja al usuario "neymar11" con streak=9 y lastClaim=ayer (hora Argentina),
//   para que hoy pueda reclamar el día 10 y cobrar la recompensa.
//
// Uso:
//   node scripts/seed-neymar11-fire-streak.js
//
// Variables de entorno requeridas:
//   MONGODB_URI
//
// Cómo revertir:
//   Ejecutar este mismo script con DRY_RUN=1 para ver el estado previo,
//   o correr en mongo shell:
//     db.firestreaks.deleteOne({ username: "neymar11" })
//   para borrar el documento y que el usuario quede sin racha.
// ============================================

require('dotenv').config();

const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI;
const DRY_RUN = process.env.DRY_RUN === '1';
const TARGET_USERNAME = 'neymar11';

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI no definido en las variables de entorno.');
  process.exit(1);
}

// =====================
// Calcular "ayer al mediodía" en horario Argentina (UTC-3, sin DST)
// Argentina = UTC-3 → mediodía Argentina = 15:00 UTC
// =====================
function getYesterdayNoonArgentinaAsUTC() {
  const ARGENTINA_OFFSET_MS = 3 * 60 * 60 * 1000; // UTC-3
  const now = new Date();
  // Desplazar la hora UTC para obtener la fecha actual en Argentina
  const argNow = new Date(now.getTime() - ARGENTINA_OFFSET_MS);
  const argYear = argNow.getUTCFullYear();
  const argMonth = argNow.getUTCMonth(); // 0-indexed
  const argDay = argNow.getUTCDate();

  // Ayer en Argentina, mediodía (12:00 ART = 15:00 UTC)
  return new Date(Date.UTC(argYear, argMonth, argDay - 1, 15, 0, 0, 0));
}

// Verificar que el lastClaim calculado cae en "ayer" para Argentina
// Las siguientes helpers son copias exactas de fireController.js para garantizar
// que la verificación use la misma lógica que el controlador real.
function getArgentinaDateString(date) {
  const argentinaTime = new Date(date.toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }));
  return argentinaTime.toDateString();
}

function getArgentinaYesterday() {
  const now = new Date();
  const argentinaNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }));
  argentinaNow.setDate(argentinaNow.getDate() - 1);
  return argentinaNow.toDateString();
}

async function main() {
  console.log('==========================================================');
  console.log(` SEED PUNTUAL: Fire Streak para "${TARGET_USERNAME}"`);
  if (DRY_RUN) console.log(' ⚠️  MODO DRY RUN – no se escribirá nada en la base');
  console.log('==========================================================\n');

  await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  console.log('✅ Conectado a MongoDB\n');

  // strict:false permite operar sobre las colecciones existentes sin redefinir los schemas
  // completos (evita conflictos con los modelos ya registrados en src/models/).
  // Es el mismo patrón usado en scripts/backfill-jugaygana-userid.js.
  const User = mongoose.models['User'] || mongoose.model('User', new mongoose.Schema({}, { strict: false }));
  const FireStreak = mongoose.models['FireStreak'] || mongoose.model('FireStreak', new mongoose.Schema({}, { strict: false }));

  // Buscar el usuario neymar11
  const user = await User.findOne(
    { username: { $regex: new RegExp(`^${TARGET_USERNAME}$`, 'i') } },
    { id: 1, username: 1, _id: 1 }
  ).lean();

  if (!user) {
    console.log(`⚠️  El usuario "${TARGET_USERNAME}" NO existe en la colección de usuarios.`);
    console.log('   No se realizará ningún cambio.');
    await mongoose.disconnect();
    return;
  }

  const userId = user.id || user._id?.toString();
  console.log(`✅ Usuario encontrado: username="${user.username}", userId="${userId}"\n`);

  // Calcular lastClaim = ayer mediodía en Argentina (como UTC)
  const lastClaim = getYesterdayNoonArgentinaAsUTC();

  // Verificación de coherencia
  const lastClaimArgStr = getArgentinaDateString(lastClaim);
  const expectedYesterday = getArgentinaYesterday();

  console.log(`📅 Fecha actual en Argentina : ${getArgentinaDateString(new Date())}`);
  console.log(`📅 Ayer en Argentina         : ${expectedYesterday}`);
  console.log(`📅 lastClaim a setear (UTC)  : ${lastClaim.toISOString()}`);
  console.log(`📅 lastClaim en Argentina    : ${lastClaimArgStr}`);

  if (lastClaimArgStr !== expectedYesterday) {
    console.error('\n❌ Error de coherencia: el lastClaim calculado no corresponde a ayer en Argentina.');
    console.error(`   Calculado: "${lastClaimArgStr}" | Esperado: "${expectedYesterday}"`);
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log('✅ Coherencia de fechas verificada\n');

  // Buscar racha actual (si existe)
  const existing = await FireStreak.findOne({ userId }).lean();
  if (existing) {
    console.log(`ℹ️  FireStreak actual: streak=${existing.streak}, lastClaim=${existing.lastClaim}`);
  } else {
    console.log(`ℹ️  No existe FireStreak para "${TARGET_USERNAME}". Se creará uno nuevo.`);
  }

  const newData = {
    userId,
    username: user.username,
    streak: 9,
    lastClaim,
    totalClaimed: existing?.totalClaimed ?? 0,
    lastReset: existing?.lastReset ?? null,
    history: existing?.history ?? [],
    pendingNextLoadBonus: existing?.pendingNextLoadBonus ?? false
  };

  console.log('\n📝 Datos a escribir:');
  console.log(`   userId       : ${newData.userId}`);
  console.log(`   username     : ${newData.username}`);
  console.log(`   streak       : ${newData.streak}`);
  console.log(`   lastClaim    : ${newData.lastClaim.toISOString()} (${lastClaimArgStr} ART)`);
  console.log(`   totalClaimed : ${newData.totalClaimed}`);

  if (DRY_RUN) {
    console.log('\n⚠️  DRY RUN activo — no se realizaron cambios en la base.');
  } else {
    await FireStreak.findOneAndUpdate(
      { userId },
      { $set: newData },
      { upsert: true, new: true }
    );
    console.log(`\n✅ FireStreak de "${TARGET_USERNAME}" actualizado correctamente.`);
    console.log(`   → streak=9, lastClaim=ayer (${lastClaimArgStr} ART)`);
    console.log(`   → El usuario puede reclamar HOY y pasará al día 10.`);
  }

  console.log('\n==========================================================');
  console.log(' CÓMO REVERTIR:');
  console.log(`   En mongo shell:`);
  console.log(`   db.firestreaks.deleteOne({ username: "${TARGET_USERNAME}" })`);
  console.log('   (esto borra la racha completa y el usuario vuelve a cero)');
  console.log('==========================================================\n');

  await mongoose.disconnect();
  console.log('✅ Desconectado de MongoDB. Fin del script.');
}

main().catch(err => {
  console.error('❌ Error fatal:', err);
  process.exit(1);
});
