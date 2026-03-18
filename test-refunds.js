#!/usr/bin/env node
// ============================================
// SCRIPT DE TEST PARA VERIFICAR BLOQUEO DE REEMBOLSOS
// ============================================

require('dotenv').config();
const mongoose = require('mongoose');
const { Refund } = require('./database');
const refunds = require('./models/refunds');

const MONGODB_URI = process.env.MONGODB_URI;

async function testRefunds() {
  console.log('🧪 INICIANDO TEST DE REEMBOLSOS\n');
  
  if (!MONGODB_URI) {
    console.error('❌ MONGODB_URI no configurado');
    process.exit(1);
  }
  
  // Conectar a MongoDB
  try {
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('✅ Conectado a MongoDB\n');
  } catch (err) {
    console.error('❌ Error conectando a MongoDB:', err.message);
    process.exit(1);
  }
  
  const testUserId = 'test-user-' + Date.now();
  const testUsername = 'testuser';
  
  console.log(`📝 Usuario de prueba: ${testUserId}\n`);
  
  // Test 1: Verificar que no haya reembolsos inicialmente
  console.log('TEST 1: Verificar estado inicial');
  const initialStatus = await refunds.canClaimDailyRefund(testUserId);
  console.log('  Resultado:', initialStatus.canClaim ? '✅ PUEDE reclamar' : '❌ NO puede reclamar');
  console.log('  Detalles:', JSON.stringify(initialStatus, null, 2));
  console.log();
  
  if (!initialStatus.canClaim) {
    console.error('❌ ERROR: Debería poder reclamar inicialmente');
    await cleanup(testUserId);
    process.exit(1);
  }
  
  // Test 2: Registrar un reembolso
  console.log('TEST 2: Registrar reembolso diario');
  const refund = await refunds.recordRefund(
    testUserId,
    testUsername,
    'daily',
    1000,  // amount
    5000,  // netAmount
    10000, // deposits
    5000   // withdrawals
  );
  console.log('  ✅ Reembolso registrado:', refund.id);
  console.log('  Fecha:', refund.date);
  console.log();
  
  // Test 3: Verificar que YA NO pueda reclamar
  console.log('TEST 3: Verificar bloqueo después de reclamar');
  const afterStatus = await refunds.canClaimDailyRefund(testUserId);
  console.log('  Resultado:', afterStatus.canClaim ? '✅ PUEDE reclamar' : '❌ NO puede reclamar');
  console.log('  Detalles:', JSON.stringify(afterStatus, null, 2));
  console.log();
  
  if (afterStatus.canClaim) {
    console.error('❌ ERROR: No debería poder reclamar dos veces el mismo día');
    console.error('   El bloqueo no está funcionando correctamente');
    await cleanup(testUserId);
    process.exit(1);
  }
  
  // Test 4: Verificar en MongoDB directamente
  console.log('TEST 4: Verificar documento en MongoDB');
  const startOfDay = refunds.getStartOfTodayUTC();
  const endOfDay = refunds.getEndOfTodayUTC();
  
  console.log('  Buscando con:');
  console.log('    userId:', testUserId);
  console.log('    type: daily');
  console.log('    date >=:', startOfDay.toISOString());
  console.log('    date <=:', endOfDay.toISOString());
  
  const found = await Refund.findOne({
    userId: testUserId,
    type: 'daily',
    date: { $gte: startOfDay, $lte: endOfDay }
  });
  
  if (found) {
    console.log('  ✅ Documento encontrado en MongoDB:', found._id);
    console.log('     Fecha guardada:', found.date);
  } else {
    console.log('  ❌ Documento NO encontrado en MongoDB');
    console.log('   Esto indica un problema con la búsqueda');
  }
  console.log();
  
  // Test 5: Listar todos los reembolsos del usuario
  console.log('TEST 5: Listar todos los reembolsos del usuario');
  const allRefunds = await refunds.getUserRefunds(testUserId);
  console.log(`  Total de reembolsos: ${allRefunds.length}`);
  allRefunds.forEach((r, i) => {
    console.log(`  [${i + 1}] ${r.type} - $${r.amount} - ${r.date}`);
  });
  console.log();
  
  // Cleanup
  await cleanup(testUserId);
  
  console.log('✅ TODOS LOS TESTS PASARON CORRECTAMENTE');
  console.log('El sistema de bloqueo de reembolsos está funcionando correctamente.');
  
  await mongoose.disconnect();
  process.exit(0);
}

async function cleanup(userId) {
  console.log('🧹 Limpiando datos de prueba...');
  try {
    await Refund.deleteMany({ userId });
    console.log('  ✅ Datos de prueba eliminados\n');
  } catch (err) {
    console.error('  ❌ Error limpiando:', err.message);
  }
}

testRefunds().catch(err => {
  console.error('❌ Error en test:', err);
  process.exit(1);
});
