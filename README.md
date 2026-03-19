# 🎮 Sala de Juegos - Backend Completo con MongoDB

Sistema backend completo para la aplicación de chat Sala de Juegos con autenticación, chat en tiempo real, panel de administración y **persistencia en MongoDB**.

## 📋 Características

- ✅ **API REST completa** con Express.js
- ✅ **Chat en tiempo real** con Socket.IO
- ✅ **Autenticación JWT** segura
- ✅ **Base de datos MongoDB** (persistencia garantizada)
- ✅ **Fallback a JSON** (si no hay MongoDB configurado)
- ✅ **Panel de administrador** web
- ✅ **Gestión de usuarios** (crear, editar, eliminar)
- ✅ **Conversaciones por usuario**
- ✅ **Mensajes no leídos** con notificaciones
- ✅ **Estadísticas en tiempo real**
- ✅ **Sistema de reembolsos** (diario, semanal, mensual)
- ✅ **Sistema de fueguito** (racha diaria)
- ✅ **Integración JUGAYGANA** para depósitos/retiros
- ✅ **Comandos personalizados**
- ✅ **Configuración de CBU**

## 🗄️ Datos Persistentes en MongoDB

| Colección | Descripción |
|-----------|-------------|
| `users` | Usuarios registrados |
| `messages` | Mensajes de chat |
| `chatstatuses` | Estado de los chats |
| `commands` | Comandos personalizados |
| `configs` | Configuración (CBU, mensajes) |
| `refunds` | Reembolsos reclamados |
| `firerewards` | Fueguitos (racha diaria) |
| `transactions` | Transacciones |
| `useractivities` | Actividad de usuarios |
| `externalusers` | Usuarios externos |

## 🚀 Deploy en Render con MongoDB

### Paso 1: Crear MongoDB Atlas

1. Ve a [mongodb.com/atlas](https://www.mongodb.com/cloud/atlas)
2. Crea una cuenta gratuita (plan **FREE M0**)
3. Crea un usuario de base de datos
4. Permite acceso desde cualquier IP (0.0.0.0/0)
5. Copia el **Connection String**

📖 **Guía detallada:** [README-MONGODB-SETUP.md](README-MONGODB-SETUP.md)

### Paso 2: Configurar Variables de Entorno en Render

Ve a tu servicio en Render → **Environment**:

```
MONGODB_URI=mongodb+srv://usuario:password@cluster.mongodb.net/sala-de-juegos?retryWrites=true&w=majority
JWT_SECRET=tu-clave-secreta-super-segura
PLATFORM_USER=tu_usuario_jugaygana
PLATFORM_PASS=tu_contraseña_jugaygana
PROXY_URL=http://usuario:password@proxy.com:80
```

### Paso 3: Deploy

1. Sube el código a GitHub
2. Conecta el repositorio en Render
3. Click en **Deploy**

## 📁 Estructura del Proyecto

```
sala-de-juegos-v55/
├── server.js                 # Servidor principal
├── package.json              # Dependencias
├── .env.example              # Ejemplo de variables
├── models/                   # Modelos MongoDB
│   ├── index.js             # Conexión y modelos
│   └── refunds.js           # Lógica de reembolsos
├── services/                 # Servicios de BD
│   └── database.js          # Operaciones CRUD
├── config/                   # Configuración
│   └── database.js          # Config MongoDB
├── public/                   # Frontend
│   ├── index.html           # App del usuario
│   └── adminprivado2026/    # Panel admin
│       ├── index.html
│       ├── admin.css
│       └── admin.js
├── scripts/                  # Scripts utilitarios
│   └── sync-all-users.js
├── jugaygana.js             # Integración JUGAYGANA
├── jugaygana-movements.js   # Movimientos de saldo
├── jugaygana-sync.js        # Sincronización masiva
└── vercel.json              # Config Vercel
```

## 🔑 Credenciales por Defecto

### Administrador
- **Usuario:** `ignite100`
- **Contraseña:** `pepsi100`

### Admin Respaldo
- **Usuario:** `admin`
- **Contraseña:** `admin123`

### Usuario de Prueba
- **Usuario:** `672rosana1`
- **Contraseña:** `asd123`

## 📡 API Endpoints

### Autenticación
```
POST /api/auth/login        - Login usuario
POST /api/auth/register     - Registrar usuario
GET  /api/auth/verify       - Verificar token
```

### Usuarios (Admin)
```
GET    /api/users           - Listar todos los usuarios
POST   /api/users           - Crear usuario
PUT    /api/users/:id       - Actualizar usuario
DELETE /api/users/:id       - Eliminar usuario
```

### Mensajes
```
GET /api/messages/:userId   - Obtener mensajes de un usuario
GET /api/conversations      - Obtener todas las conversaciones
POST /api/messages/send     - Enviar mensaje
POST /api/messages/read/:userId - Marcar como leídos
```

### Chats (Admin)
```
GET  /api/admin/chats/:status        - Chats por estado (open/closed)
POST /api/admin/chats/:userId/close  - Cerrar chat
POST /api/admin/chats/:userId/reopen - Reabrir chat
POST /api/admin/chats/:userId/assign - Asignar chat
```

### Reembolsos
```
GET  /api/refunds/status              - Estado de reembolsos
POST /api/refunds/claim/daily         - Reclamar diario
POST /api/refunds/claim/weekly        - Reclamar semanal
POST /api/refunds/claim/monthly       - Reclamar mensual
GET  /api/refunds/history             - Historial
```

### Fueguitos (Racha Diaria)
```
GET  /api/fire/status    - Estado de la racha
POST /api/fire/claim     - Reclamar fueguito
```

### Admin - Transacciones
```
POST /api/admin/deposit      - Realizar depósito
POST /api/admin/withdrawal   - Realizar retiro
POST /api/admin/bonus        - Dar bonificación
GET  /api/admin/transactions - Historial de transacciones
```

### Admin - Configuración
```
GET  /api/admin/config       - Obtener configuración
PUT  /api/admin/config/cbu   - Actualizar CBU
GET  /api/admin/commands     - Listar comandos
POST /api/admin/commands     - Crear comando
```

## 🔧 Instalación Local

```bash
# Clonar repositorio
git clone https://github.com/tuusuario/sala-de-juegos-backend.git

# Entrar al directorio
cd sala-de-juegos-backend

# Crear archivo .env
cp .env.example .env
# Editar .env con tus credenciales

# Instalar dependencias
npm install

# Iniciar servidor
npm start
```

## 🖥️ Panel de Administrador

Accede al panel en:
```
https://tusitio.com/adminprivado2026
```

### Funcionalidades:
- 📊 **Dashboard** con estadísticas en tiempo real
- 💬 **Chat** con usuarios
- 👥 **Gestión de usuarios**
- 💰 **Depósitos/Retiros/Bonificaciones**
- 📈 **Transacciones**
- ⚙️ **Configuración de CBU**
- 📝 **Comandos personalizados**

## 🛠️ Personalización

### Cambiar mensajes de bienvenida
```javascript
// En el panel admin o via API
PUT /api/admin/config
{
  "welcomeMessage": "¡Bienvenido!",
  "depositMessage": "¡Fichas cargadas!"
}
```

### Crear comando personalizado
```javascript
POST /api/admin/commands
{
  "name": "/bonus",
  "description": "Dar bonus",
  "type": "bonus",
  "bonusPercent": 10,
  "response": "¡Bonus aplicado!"
}
```

## 🐛 Solución de Problemas

### Error "Cannot connect to MongoDB"
- Verifica MONGODB_URI en variables de entorno
- Verifica que la IP esté permitida (0.0.0.0/0)
- Verifica el password

### Los datos se pierden al reiniciar
- Asegúrate de tener configurado MONGODB_URI
- Sin MongoDB, el sistema usa JSON local (datos temporales)

### Error en JUGAYGANA
- Verifica PLATFORM_USER y PLATFORM_PASS
- Verifica que el proxy tenga IP argentina

## 📝 Licencia

MIT License - Libre para usar y modificar.

---

**Hecho con ❤️ para Sala de Juegos**
