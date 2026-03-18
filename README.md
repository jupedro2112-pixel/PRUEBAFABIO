# 🎮 Sala de Juegos - Backend Completo

Sistema backend completo para la aplicación de chat Sala de Juegos con autenticación, chat en tiempo real y panel de administración.

## 📋 Características

- ✅ **API REST completa** con Express.js
- ✅ **Chat en tiempo real** con Socket.IO
- ✅ **Autenticación JWT** segura
- ✅ **Base de datos JSON** (sin configuración compleja)
- ✅ **Panel de administrador** web
- ✅ **Gestión de usuarios** (crear, editar, eliminar)
- ✅ **Conversaciones por usuario**
- ✅ **Mensajes no leídos** con notificaciones
- ✅ **Estadísticas en tiempo real**
- ✅ **PWA lista** para instalar

## 🚀 Deploy en Vercel (Recomendado)

### Paso 1: Preparar archivos

1. **Descarga esta carpeta** `sala-de-juegos-backend`

2. **Crea un repositorio en GitHub**:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/tuusuario/sala-de-juegos-backend.git
   git push -u origin main
   ```

### Paso 2: Deploy en Vercel

1. **Ve a [Vercel](https://vercel.com)** e inicia sesión

2. **Click en "New Project"**

3. **Importa tu repositorio de GitHub**

4. **Configuración**:
   - Framework Preset: `Other`
   - Build Command: `npm install`
   - Output Directory: `public`
   - Install Command: `npm install`

5. **Variables de Entorno** (opcional):
   ```
   JWT_SECRET = tu-clave-secreta-aqui
   ```

6. **Click en "Deploy"**

7. **Espera 2-3 minutos** y tu backend estará online

### Paso 3: Configurar Frontend

1. **Copia la URL de tu backend** (ej: `https://tuproyecto.vercel.app`)

2. **Actualiza el frontend** con esta URL en la configuración

## 📁 Estructura del Proyecto

```
sala-de-juegos-backend/
├── server.js              # Servidor principal
├── package.json           # Dependencias
├── vercel.json            # Configuración de Vercel
├── README.md              # Este archivo
├── data/                  # Base de datos JSON
│   ├── users.json         # Usuarios
│   └── messages.json      # Mensajes
└── public/                # Frontend y Panel Admin
    ├── index.html         # App del usuario
    ├── manifest.json      # PWA manifest
    ├── service-worker.js  # Service Worker
    ├── icons/             # Iconos PWA
    └── admin/             # Panel de administrador
        ├── index.html
        ├── admin.css
        └── admin.js
```

## 🔑 Credenciales por Defecto

### Administrador
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
POST /api/auth/change-password - Cambiar contraseña
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
GET /api/conversations      - Obtener todas las conversaciones (admin)
POST /api/messages/read/:userId - Marcar mensajes como leídos
```

## 🔧 Instalación Local

```bash
# Clonar repositorio
git clone https://github.com/tuusuario/sala-de-juegos-backend.git

# Entrar al directorio
cd sala-de-juegos-backend

# Instalar dependencias
npm install

# Iniciar servidor
npm start

# O en modo desarrollo
npm run dev
```

El servidor correrá en `http://localhost:3000`

## 🖥️ Panel de Administrador

Accede al panel de administrador en:
```
https://tuproyecto.vercel.app/admin
```

### Funcionalidades del Panel:
- 📊 **Dashboard** con estadísticas en tiempo real
- 💬 **Chat** con usuarios (responder mensajes)
- 👥 **Gestión de usuarios** (crear, editar, eliminar)
- 📈 **Estadísticas** de uso
- 🔔 **Notificaciones** de mensajes nuevos

## 🗄️ Base de Datos

El sistema usa archivos JSON como base de datos (simple y efectivo):

- **users.json**: Almacena usuarios y contraseñas hasheadas
- **messages.json**: Almacena todos los mensajes del chat

### Migrar a MongoDB (Opcional)

Si necesitas más escalabilidad, puedes migrar fácilmente a MongoDB:

1. Instala mongoose:
   ```bash
   npm install mongoose
   ```

2. Crea un archivo `config/database.js`:
   ```javascript
   const mongoose = require('mongoose');
   
   mongoose.connect(process.env.MONGODB_URI, {
     useNewUrlParser: true,
     useUnifiedTopology: true
   });
   ```

3. Define los modelos y reemplaza las funciones `loadUsers()` y `saveUsers()`

## 🔐 Seguridad

- ✅ Contraseñas hasheadas con bcrypt
- ✅ Tokens JWT con expiración
- ✅ Middleware de autenticación
- ✅ Validación de roles (admin/user)
- ✅ Sanitización de inputs

## 🛠️ Personalización

### Cambiar el puerto
```javascript
// En server.js
const PORT = process.env.PORT || 3000;
```

### Cambiar el secreto JWT
```javascript
// En server.js
const JWT_SECRET = process.env.JWT_SECRET || 'tu-secreto-aqui';
```

### Agregar más campos al usuario
Edita la función de creación de usuario en `server.js`:
```javascript
const newUser = {
  id: uuidv4(),
  username,
  password: hashedPassword,
  email,
  phone,
  // Agrega más campos aquí
  customField: 'valor',
  role: 'user',
  // ...
};
```

## 📱 PWA (Progressive Web App)

La aplicación incluye:
- ✅ Manifest.json configurado
- ✅ Service Worker para offline
- ✅ Iconos en todos los tamaños
- ✅ Instalable en Android/iOS

## 🐛 Solución de Problemas

### Error: "Cannot find module"
```bash
rm -rf node_modules package-lock.json
npm install
```

### Error: "EACCES: permission denied"
```bash
sudo chown -R $(whoami) ~/.npm
```

### Los cambios no se guardan en Vercel
Los archivos JSON se reinician en cada deploy. Para persistencia:
1. Usa MongoDB Atlas (gratis)
2. O usa Vercel KV/Postgres

### Socket.IO no funciona en Vercel
Vercel usa serverless, los WebSockets tienen limitaciones. Considera:
1. Usar [Pusher](https://pusher.com) para WebSockets
2. O deploy en [Railway](https://railway.app) / [Render](https://render.com)

## 📝 Variables de Entorno

Crea un archivo `.env` para desarrollo local:
```
JWT_SECRET=tu-clave-secreta-super-segura
PORT=3000
MONGODB_URI=mongodb+srv://usuario:password@cluster.mongodb.net/sala-de-juegos
```

## 🤝 Soporte

¿Necesitas ayuda?
- 📧 Email: soporte@saladejuegos.com
- 💬 WhatsApp: +1234567890

## 📄 Licencia

MIT License - Libre para usar y modificar.

---

**Hecho con ❤️ para Sala de Juegos**
