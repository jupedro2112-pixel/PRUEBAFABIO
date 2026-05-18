/**
 * ajustar-elegibilidad.js
 *
 * Ajusta, en un sorteo (free/weekly) ya creado:
 *   - el umbral de elegibilidad: política NETWIN, CARGAS, o abierto a todos
 *   - la fecha de sorteo (drawDate), que controla el cierre de ventas
 *
 * Se conecta a Mongo con MONGODB_URI. Correlo donde la base sea accesible
 * (shell de Render, o el host donde corre la app).
 *
 * USO:
 *   node scripts/ajustar-elegibilidad.js
 *       -> LISTA los sorteos activos con su umbral y drawDate (no cambia nada)
 *
 *   node scripts/ajustar-elegibilidad.js netwin  <raffleId> <monto>
 *       -> exige perder al menos <monto> ARS netos esta semana
 *
 *   node scripts/ajustar-elegibilidad.js cargas  <raffleId> <monto>
 *       -> exige cargar al menos <monto> ARS esta semana
 *
 *   node scripts/ajustar-elegibilidad.js abierto <raffleId>
 *       -> sin filtro: TODOS pueden elegir número
 *
 *   node scripts/ajustar-elegibilidad.js fecha   <raffleId> <fechaISO>
 *       -> cambia el drawDate. Las ventas se cierran 3 hs ANTES de esa fecha.
 *          Ej: para que las ventas cierren a las 21:00, poné drawDate a las 24:00:
 *          node scripts/ajustar-elegibilidad.js fecha abc123 "2026-05-19T00:00:00-03:00"
 *
 * Recordá: en el endpoint de compra, minNetLossARS>0 manda sobre minCargasARS.
 * Por eso al setear "cargas" ponemos netloss en 0, y viceversa.
 */

const mongoose = require('mongoose');

function fmt(n) {
  return '$' + Number(n || 0).toLocaleString('es-AR');
}

function politica(r) {
  const nl = Number(r.minNetLossARS || 0);
  const ca = Number(r.minCargasARS || 0);
  if (nl > 0) return `NETWIN — pérdida neta ≥ ${fmt(nl)}`;
  if (ca > 0) return `CARGAS — cargas ≥ ${fmt(ca)}`;
  return 'ABIERTO — sin filtro, todos pueden';
}

// drawDate menos el cutoff hardcodeado de 3 hs = momento en que cierran ventas.
function cierreVentas(drawDate) {
  if (!drawDate) return '(sin fecha)';
  return new Date(new Date(drawDate).getTime() - 3 * 3600 * 1000).toISOString();
}

async function main() {
  const [, , cmd, raffleId, argVal] = process.argv;

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('⛔ Falta la variable de entorno MONGODB_URI.');
    process.exit(1);
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
  const raffles = mongoose.connection.db.collection('raffles');

  // --- Modo LISTAR (sin comando) -------------------------------------
  if (!cmd) {
    const activos = await raffles
      .find({ status: 'active' })
      .project({ id: 1, name: 1, status: 1, raffleType: 1, drawDate: 1, minNetLossARS: 1, minCargasARS: 1 })
      .sort({ drawDate: 1 })
      .toArray();

    if (activos.length === 0) {
      console.log('No hay sorteos en estado "active".');
    } else {
      console.log(`\n=== ${activos.length} sorteo(s) activo(s) ===\n`);
      for (const r of activos) {
        console.log(`  id:            ${r.id}`);
        console.log(`  nombre:        ${r.name}`);
        console.log(`  tipo:          ${r.raffleType}`);
        console.log(`  drawDate:      ${r.drawDate ? new Date(r.drawDate).toISOString() : '(sin fecha)'}`);
        console.log(`  cierra ventas: ${cierreVentas(r.drawDate)}  (3 hs antes del draw)`);
        console.log(`  política:      ${politica(r)}`);
        console.log('');
      }
    }
    console.log('Ajustar:  node scripts/ajustar-elegibilidad.js <netwin|cargas|abierto|fecha> <raffleId> [valor]\n');
    await mongoose.disconnect();
    return;
  }

  // --- Modo AJUSTAR --------------------------------------------------
  if (!['netwin', 'cargas', 'abierto', 'fecha'].includes(cmd)) {
    console.error(`⛔ Comando inválido: "${cmd}". Usá netwin | cargas | abierto | fecha.`);
    await mongoose.disconnect();
    process.exit(1);
  }
  if (!raffleId) {
    console.error('⛔ Falta el raffleId. Corré el script sin argumentos para ver la lista.');
    await mongoose.disconnect();
    process.exit(1);
  }

  const r = await raffles.findOne({ id: raffleId });
  if (!r) {
    console.error(`⛔ No existe ningún sorteo con id="${raffleId}".`);
    await mongoose.disconnect();
    process.exit(1);
  }

  let update;
  if (cmd === 'abierto') {
    update = { minNetLossARS: 0, minCargasARS: 0 };
  } else if (cmd === 'fecha') {
    const fecha = new Date(argVal);
    if (isNaN(fecha.getTime())) {
      console.error(`⛔ Fecha inválida: "${argVal}". Usá formato ISO, ej: "2026-05-19T00:00:00-03:00".`);
      await mongoose.disconnect();
      process.exit(1);
    }
    update = { drawDate: fecha };
  } else {
    const monto = Number(argVal);
    if (!Number.isFinite(monto) || monto < 0) {
      console.error(`⛔ Monto inválido: "${argVal}". Tiene que ser un número ≥ 0.`);
      await mongoose.disconnect();
      process.exit(1);
    }
    update = cmd === 'netwin'
      ? { minNetLossARS: monto, minCargasARS: 0 }
      : { minNetLossARS: 0, minCargasARS: monto };
  }

  console.log(`\nSorteo: ${r.name}  (id: ${r.id})`);
  if (cmd === 'fecha') {
    console.log(`  ANTES:    drawDate ${r.drawDate ? new Date(r.drawDate).toISOString() : '(sin fecha)'}  · cierra ventas ${cierreVentas(r.drawDate)}`);
  } else {
    console.log(`  ANTES:    ${politica(r)}`);
  }

  await raffles.updateOne({ id: raffleId }, { $set: update });

  const after = await raffles.findOne({ id: raffleId });
  if (cmd === 'fecha') {
    console.log(`  DESPUÉS:  drawDate ${new Date(after.drawDate).toISOString()}  · cierra ventas ${cierreVentas(after.drawDate)}`);
  } else {
    console.log(`  DESPUÉS:  ${politica(after)}`);
  }
  console.log('\n✅ Listo. El cambio impacta de inmediato en el endpoint de compra.\n');

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('⛔ Error:', err.message);
  process.exit(1);
});
