# 🎮 Sala de Juegos - Backend con MongoDB

Este backend ahora utiliza **MongoDB** para persistir todos los datos, lo que significa que los datos se mantienen incluso si el servidor se reinicia.

## 📋 Datos que se guardan en MongoDB

| Colección | Descripción |
|-----------|-------------|
| `users` | Usuarios registrados (incluyendo datos de JUGAYGANA) |
| `messages` | Mensajes de chat entre usuarios y admins |
| `commands` | Comandos personalizados configurados por admin |
| `configs` | Configuración del sistema (CBU, mensajes, etc.) |
| `refundclaims` | Historial de reclamos de reembolsos (diario, semanal, mensual) |
| `firestreaks` | Racha de fueguitos de cada usuario |
| `chatstatuses` | Estado de los chats (abierto/cerrado, categoría) |
| `transactions` | Registro de transacciones (depósitos, retiros, bonos) |
| `externalusers` | Usuarios que han interactuado con el sistema |
| `useractivities` | Actividad diaria de usuarios (para fueguito) |

## 🚀 Configuración

### 1. Crear cuenta en MongoDB Atlas (Recomendado)

1. Ve a [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
2. Crea una cuenta gratuita
3. Crea un nuevo cluster (el tier gratuito M0 es suficiente)
4. En "Database Access", crea un usuario con contraseña
5. En "Network Access", agrega `0.0.0.0/0` para permitir conexiones desde cualquier IP (o las IPs específicas de tu servidor)
6. En "Databases", haz clic en "Connect" > "Connect your application"
7. Copia la URI de conexión

### 2. Configurar variables de entorno

```bash
# Copiar el archivo de ejemplo
cp .env.example .env

# Editar .env con tus datos
nano .env
```

Variables necesarias:

```env
MONGODB_URI=mongodb+srv://usuario:password@cluster.mongodb.net/sala-de-juegos?retryWrites=true&w=majority
JUGAYGANA_USERNAME=tu_usuario
JUGAYGANA_PASSWORD=tu_password
JUGAYGANA_PARENT_ID=tu_parent_id
JWT_SECRET=un_secreto_muy_seguro_aqui
```

### 3. Instalar dependencias

```bash
npm install
```

### 4. Iniciar el servidor

```bash
# Modo desarrollo
npm run dev

# Modo producción
npm start
```

## 🔄 Migración desde archivos JSON (si tienes datos existentes)

Si tienes datos en archivos JSON que quieres migrar a MongoDB, puedes usar este script:

```javascript
// migrar-a-mongodb.js
const fs = require('fs');
const path = require('path');
const { connectDB, User, Message, RefundClaim, FireStreak, ChatStatus, Config, setConfig } = require('./config/database');

async function migrar() {
  await connectDB();
  
  const DATA_DIR = path.join(__dirname, 'data');
  
  // Migrar usuarios
  if (fs.existsSync(path.join(DATA_DIR, 'users.json'))) {
    const users = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'users.json'), 'utf8'));
    for (const user of users) {
      await User.findOneAndUpdate(
        { id: user.id },
        { ...user, createdAt: new Date(user.createdAt), lastLogin: user.lastLogin ? new Date(user.lastLogin) : null },
        { upsert: true }
      );
    }
    console.log(`✅ Migrados ${users.length} usuarios`);
  }
  
  // Migrar mensajes
  if (fs.existsSync(path.join(DATA_DIR, 'messages.json'))) {
    const messages = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'messages.json'), 'utf8'));
    for (const msg of messages) {
      await Message.findOneAndUpdate(
        { id: msg.id },
        { ...msg, timestamp: new Date(msg.timestamp) },
        { upsert: true }
      );
    }
    console.log(`✅ Migrados ${messages.length} mensajes`);
  }
  
  // Migrar reembolsos
  if (fs.existsSync(path.join(DATA_DIR, 'refunds.json'))) {
    const refunds = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'refunds.json'), 'utf8'));
    for (const refund of refunds) {
      await RefundClaim.findOneAndUpdate(
        { id: refund.id },
        { ...refund, claimedAt: new Date(refund.date || refund.claimedAt) },
        { upsert: true }
      );
    }
    console.log(`✅ Migrados ${refunds.length} reembolsos`);
  }
  
  // Migrar fueguitos
  if (fs.existsSync(path.join(DATA_DIR, 'fire-rewards.json'))) {
    const fireRewards = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'fire-rewards.json'), 'utf8'));
    for (const [userId, data] of Object.entries(fireRewards)) {
      await FireStreak.findOneAndUpdate(
        { userId },
        {
          userId,
          username: data.username || userId,
          streak: data.streak || 0,
          lastClaim: data.lastClaim ? new Date(data.lastClaim) : null,
          totalClaimed: data.totalClaimed || 0
        },
        { upsert: true }
      );
    }
    console.log(`✅ Migrados ${Object.keys(fireRewards).length} registros de fueguito`);
  }
  
  // Migrar chat status
  if (fs.existsSync(path.join(DATA_DIR, 'chat-status.json'))) {
    const chatStatus = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'chat-status.json'), 'utf8'));
    for (const [userId, data] of Object.entries(chatStatus)) {
      await ChatStatus.findOneAndUpdate(
        { userId },
        {
          userId,
          username: data.username || userId,
          status: data.status || 'open',
          category: data.category || 'cargas',
          assignedTo: data.assignedTo,
          closedAt: data.closedAt ? new Date(data.closedAt) : null,
          closedBy: data.closedBy
        },
        { upsert: true }
      );
    }
    console.log(`✅ Migrados ${Object.keys(chatStatus).length} estados de chat`);
  }
  
  // Migrar configuración CBU
  if (fs.existsSync(path.join(DATA_DIR, 'system-config.json'))) {
    const config = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'system-config.json'), 'utf8'));
    if (config.cbu) {
      await setConfig('cbu', config.cbu);
    }
    if (config.welcomeMessage) {
      await setConfig('welcomeMessage', config.welcomeMessage);
    }
    if (config.depositMessage) {
      await setConfig('depositMessage', config.depositMessage);
    }
    console.log('✅ Migrada configuración del sistema');
  }
  
  console.log('\n🎉 Migración completada!');
  process.exit(0);
}

migrar().catch(console.error);
```

Ejecutar:
```bash
node migrar-a-mongodb.js
```

## 📊 Estructura de la base de datos

### User
```javascript
{
  id: String,              // UUID del usuario
  username: String,        // Nombre de usuario
  password: String,        // Hash bcrypt
  email: String,
  phone: String,
  whatsapp: String,
  role: String,            // 'user', 'admin', 'depositor', 'withdrawer'
  accountNumber: String,
  balance: Number,
  isActive: Boolean,
  lastLogin: Date,
  createdAt: Date,
  // Campos JUGAYGANA
  jugayganaUserId: Number,
  jugayganaUsername: String,
  jugayganaSyncStatus: String
}
```

### Message
```javascript
{
  id: String,
  senderId: String,
  senderUsername: String,
  senderRole: String,      // 'user', 'admin', 'system'
  receiverId: String,
  receiverRole: String,
  content: String,
  type: String,            // 'text', 'image'
  read: Boolean,
  timestamp: Date
}
```

### RefundClaim
```javascript
{
  id: String,
  userId: String,
  username: String,
  type: String,            // 'daily', 'weekly', 'monthly'
  amount: Number,
  netAmount: Number,
  percentage: Number,
  deposits: Number,
  withdrawals: Number,
  period: String,
  transactionId: String,
  claimedAt: Date
}
```

### FireStreak
```javascript
{
  userId: String,
  username: String,
  streak: Number,          // Días consecutivos
  lastClaim: Date,
  totalClaimed: Number,    // Total de recompensas reclamadas
  history: [{
    date: Date,
    reward: Number,
    streakDay: Number
  }]
}
```

### ChatStatus
```javascript
{
  userId: String,
  username: String,
  status: String,          // 'open', 'closed'
  category: String,        // 'cargas', 'pagos'
  assignedTo: String,      // Admin asignado
  closedAt: Date,
  closedBy: String,
  lastMessageAt: Date
}
```

### Config
```javascript
{
  key: String,             // 'cbu', 'welcomeMessage', etc.
  value: Mixed,            // Cualquier tipo de dato
  updatedAt: Date
}
```

## 🔧 Troubleshooting

### Error de conexión a MongoDB
```
❌ Error conectando MongoDB: connection timed out
```
- Verifica que la URI de MongoDB sea correcta
- Asegúrate de que la IP de tu servidor esté en la lista blanca de MongoDB Atlas
- Verifica que el usuario y contraseña sean correctos

### Datos no se guardan
- Verifica que la conexión a MongoDB se haya establecido correctamente
- Revisa los logs del servidor para ver errores específicos

### Migración falla
- Asegúrate de que los archivos JSON existan y tengan formato válido
- Verifica que la conexión a MongoDB esté funcionando antes de migrar

## 📝 Notas

- Los datos ahora persisten entre reinicios del servidor
- No es necesario crear las colecciones manualmente, Mongoose las crea automáticamente
- Se recomienda hacer backups periódicos de la base de datos MongoDB
- Para producción, usa MongoDB Atlas o configura un cluster de MongoDB con réplicas
