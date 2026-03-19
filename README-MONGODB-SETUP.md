# 🗄️ Configuración de MongoDB - Sala de Juegos

Este documento explica cómo configurar MongoDB Atlas para que todos los datos se guarden de forma persistente.

## 📋 Datos que se guardan en MongoDB

| Colección | Descripción |
|-----------|-------------|
| `users` | Usuarios registrados |
| `messages` | Mensajes de chat |
| `chatstatuses` | Estado de los chats (abierto/cerrado) |
| `commands` | Comandos personalizados |
| `configs` | Configuración (CBU, mensajes) |
| `refunds` | Reembolsos reclamados (diario/semanal/mensual) |
| `firerewards` | Fueguitos (racha diaria) |
| `transactions` | Transacciones (depósitos/retiros/bonus) |
| `useractivities` | Actividad de usuarios |
| `externalusers` | Usuarios externos que contactaron |

---

## 🚀 Paso 1: Crear cuenta en MongoDB Atlas

1. Ve a [mongodb.com/atlas](https://www.mongodb.com/cloud/atlas)
2. Crea una cuenta gratuita
3. Selecciona el plan **FREE (M0)**

---

## 🗄️ Paso 2: Crear Cluster

1. Elige la región más cercana (recomendado: **Virginia** o **São Paulo** para mejor latencia)
2. Nombre del cluster: `sala-de-juegos`
3. Click en **Create Cluster** (tarda ~5 minutos)

---

## 👤 Paso 3: Crear Usuario de Base de Datos

1. Ve a **Database Access** → **Add New Database User**
2. Username: `salauser`
3. Password: Genera una contraseña segura (¡guárdala!)
4. Roles: **Read and Write to Any Database**
5. Click **Add User**

---

## 🌐 Paso 4: Configurar Acceso de Red

1. Ve a **Network Access** → **Add IP Address**
2. Click en **Allow Access from Anywhere** (0.0.0.0/0)
3. Click **Confirm**

---

## 🔗 Paso 5: Obtener Connection String

1. Ve a **Clusters** → Click en **Connect**
2. Selecciona **Connect your application**
3. Copia el string de conexión:
   ```
   mongodb+srv://salauser:<password>@sala-de-juegos.xxxxx.mongodb.net/sala-de-juegos?retryWrites=true&w=majority
   ```
4. Reemplaza `<password>` con tu contraseña real

---

## ⚙️ Paso 6: Configurar Variables de Entorno en Render

Ve a tu servicio en Render → **Environment** → **Add Environment Variable**:

```
MONGODB_URI=mongodb+srv://salauser:TU_PASSWORD@sala-de-juegos.xxxxx.mongodb.net/sala-de-juegos?retryWrites=true&w=majority
```

También agrega:
```
JWT_SECRET=tu-clave-secreta-super-segura-aqui
PLATFORM_USER=tu_usuario_jugaygana
PLATFORM_PASS=tu_contraseña_jugaygana
PROXY_URL=http://usuario:password@proxy.com:80
```

---

## 🔄 Paso 7: Redeploy

1. Ve a tu dashboard de Render
2. Click en **Manual Deploy** → **Deploy latest commit**
3. Espera a que termine el deploy

---

## ✅ Verificar Conexión

En los logs deberías ver:
```
🔌 Conectando a base de datos...
✅ Conectado a MongoDB Atlas
✅ Índices creados
```

Si no configuras MONGODB_URI, el sistema usará JSON local (datos se perderán al reiniciar).

---

## 📊 Estructura de la Base de Datos

### Usuarios
```javascript
{
  id: "uuid",
  username: "usuario123",
  password: "hash",
  email: "user@email.com",
  phone: "+5491112345678",
  role: "user", // user, admin, depositor, withdrawer
  accountNumber: "ACC...",
  balance: 0,
  createdAt: Date,
  lastLogin: Date,
  isActive: true,
  jugayganaUserId: "12345",
  jugayganaSyncStatus: "synced"
}
```

### Mensajes
```javascript
{
  id: "uuid",
  senderId: "user-id",
  senderUsername: "usuario",
  senderRole: "user",
  receiverId: "admin",
  receiverRole: "admin",
  content: "Hola!",
  type: "text",
  timestamp: Date,
  read: false
}
```

### Reembolsos
```javascript
{
  id: "uuid",
  userId: "user-id",
  username: "usuario",
  type: "daily", // daily, weekly, monthly
  amount: 100,
  percentage: 20,
  netAmount: 500,
  deposits: 600,
  withdrawals: 100,
  claimedAt: Date,
  transactionId: "jugaygana-id"
}
```

### Fueguitos
```javascript
{
  userId: "user-id",
  username: "usuario",
  streak: 5,
  lastClaim: Date,
  totalClaimed: 10000,
  history: [
    { date: Date, streak: 10, reward: 10000 }
  ]
}
```

### Configuración (CBU)
```javascript
{
  key: "cbu",
  value: {
    number: "123456789",
    alias: "mi.alias",
    bank: "Banco",
    titular: "Nombre",
    message: "Mensaje personalizado"
  },
  updatedBy: "admin",
  updatedAt: Date
}
```

---

## 🛠️ Troubleshooting

### Error: "Cannot connect to MongoDB"
- Verifica que la IP esté permitida (0.0.0.0/0)
- Verifica que el password sea correcto
- Verifica que el usuario tenga permisos de readWrite

### Error: "IP bloqueada" en JUGAYGANA
- Verifica que PROXY_URL esté configurado
- Verifica que el proxy tenga IP argentina

### Los datos no persisten
- Verifica que MONGODB_URI esté configurado correctamente
- Revisa los logs de Render para ver si la conexión fue exitosa

---

## 💡 Notas

- MongoDB Atlas Free incluye 5GB de almacenamiento (suficiente para cientos de miles de usuarios)
- El sistema automáticamente hace fallback a JSON si MongoDB no está disponible
- Los índices se crean automáticamente al iniciar el servidor
