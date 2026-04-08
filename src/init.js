/**
 * Inicialización de datos del servidor
 */
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { connectDB, User, getConfig, setConfig, Command } = require('../config/database');
const jugaygana = require('../jugaygana');
const logger = require('./utils/logger');

async function initializeData() {
  const dbConnected = await connectDB();
  if (!dbConnected) {
    console.error('❌ No se pudo conectar a MongoDB');
    return;
  }

  if (process.env.PROXY_URL) {
    console.log('🔍 Verificando IP pública...');
    await jugaygana.logProxyIP();
  }

  console.log('🔑 Probando conexión con JUGAYGANA...');
  const sessionOk = await jugaygana.ensureSession();
  if (sessionOk) {
    console.log('✅ Conexión con JUGAYGANA establecida');
  } else {
    console.log('⚠️ No se pudo conectar con JUGAYGANA');
  }

  const defaultAdminPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'pepsi100';
  let adminExists = await User.findOne({ username: 'ignite100' });
  if (!adminExists) {
    const adminPasswordHash = await bcrypt.hash(defaultAdminPassword, 10);
    await User.create({
      id: uuidv4(),
      username: 'ignite100',
      password: adminPasswordHash,
      email: 'admin@saladejuegos.com',
      phone: null,
      role: 'admin',
      accountNumber: 'ADMIN001',
      balance: 0,
      createdAt: new Date(),
      lastLogin: null,
      isActive: true,
      jugayganaUserId: null,
      jugayganaUsername: null,
      jugayganaSyncStatus: 'not_applicable'
    });
  } else {
    adminExists.password = await bcrypt.hash(defaultAdminPassword, 10);
    adminExists.role = 'admin';
    adminExists.isActive = true;
    await adminExists.save();
  }
  console.log('✅ Admin verificado: ignite100');

  const backupAdminPassword = process.env.BACKUP_ADMIN_PASSWORD || 'admin123';
  let oldAdmin = await User.findOne({ username: 'admin' });
  if (!oldAdmin) {
    const adminPasswordHash = await bcrypt.hash(backupAdminPassword, 10);
    await User.create({
      id: uuidv4(),
      username: 'admin',
      password: adminPasswordHash,
      email: 'admin@saladejuegos.com',
      phone: null,
      role: 'admin',
      accountNumber: 'ADMIN002',
      balance: 0,
      createdAt: new Date(),
      lastLogin: null,
      isActive: true,
      jugayganaUserId: null,
      jugayganaUsername: null,
      jugayganaSyncStatus: 'not_applicable'
    });
  } else {
    oldAdmin.password = await bcrypt.hash(backupAdminPassword, 10);
    oldAdmin.role = 'admin';
    oldAdmin.isActive = true;
    await oldAdmin.save();
  }
  console.log('✅ Admin respaldo verificado: admin');

  const cbuConfig = await getConfig('cbu');
  if (!cbuConfig) {
    await setConfig('cbu', {
      number: '0000000000000000000000',
      alias: 'mi.alias.cbu',
      bank: 'Banco Ejemplo',
      titular: 'Sala de Juegos'
    });
    console.log('✅ Configuración CBU por defecto creada');
  }

  const systemCmds = [
    {
      name: '/sys_deposit',
      description: 'Mensaje automático al realizar un depósito sin bonus. Variables disponibles: ${amount}, ${balance}',
      type: 'message',
      response: '🔒💰 Depósito de ${amount} acreditado con éxito. ✅ \n💸 Tu nuevo saldo es ${balance} 💸\n\nPuedes verificarlo en: https://jugaygana.bet\n\n🔥 Mañana podes revisar si tenes reembolso para reclamar de forma automatica 🔥'
    },
    {
      name: '/sys_deposit_bonus',
      description: 'Mensaje automático al realizar un depósito con bonus. Variables disponibles: ${amount}, ${bonus}, ${balance}',
      type: 'message',
      response: '🔒💰 Depósito de ${amount} (incluye ${bonus} de bonificación) acreditado con éxito. ✅ \n💸 Tu nuevo saldo es ${balance} 💸\n\nPuedes verificarlo en: https://jugaygana.bet\n\n🔥 Mañana podes revisar si tenes reembolso para reclamar de forma automatica 🔥'
    },
    {
      name: '/sys_bonus',
      description: 'Mensaje automático al aplicar una bonificación. Variables disponibles: ${amount}, ${balance}',
      type: 'message',
      response: '🎁 ¡Bonificación de ${amount} acreditada en tu cuenta! ✅\n💸 Tu saldo actual es ${balance} 💸\n\nPuedes verificarlo en: https://www.jugaygana44.bet'
    },
    {
      name: '/sys_withdrawal',
      description: 'Mensaje automático al realizar un retiro. Variables disponibles: ${amount}, ${balance}',
      type: 'message',
      response: '🔒💸 Retiro de ${amount} realizado correctamente. \n💸 Tu nuevo saldo es ${balance} 💸\nSu pago se está procesando. Por favor, aguarde un momento.'
    },
    {
      name: '/sys_reminder',
      description: 'Mensaje recordatorio enviado después de cada depósito (sin variables de monto por defecto).',
      type: 'message',
      response: '🎮 ¡Recuerda!\nPara cargar o cobrar, ingresa a 🌐 www.vipcargas.com.\n🔥 ¡Ya tienes el acceso guardado, así que te queda más fácil y rápido cada vez que entres!  \n🕹️ ¡No olvides guardarla y mantenerla a mano!\n\nwww.vipcargas.com'
    }
  ];

  for (const cmd of systemCmds) {
    await Command.findOneAndUpdate(
      { name: cmd.name },
      {
        $set: { isSystem: true },
        $setOnInsert: {
          name: cmd.name,
          description: cmd.description,
          type: cmd.type,
          response: cmd.response,
          isActive: true,
          usageCount: 0
        }
      },
      { upsert: true }
    );
  }
  console.log('✅ Comandos de sistema verificados');
  console.log('✅ Datos inicializados correctamente');
}

module.exports = { initializeData };
