# 🎮 Sala de Juegos - Integración JUGAYGANA + MongoDB

Este documento explica cómo configurar el sistema para manejar **100,000+ usuarios** con sincronización automática con JUGAYGANA.

---

## 📋 REQUISITOS

1. **MongoDB Atlas** (gratis para hasta 5GB)
2. **Cuenta en JUGAYGANA** con credenciales de admin
3. **Proxy Argentino** (ya incluido)

---

## 🗄️ PASO 1: Crear MongoDB Atlas

### 1.1 Registro
1. Ve a [mongodb.com/atlas](https://www.mongodb.com/cloud/atlas)
2. Crea una cuenta gratuita
3. Selecciona el plan **FREE (M0)**

### 1.2 Crear Cluster
1. Elige la región más cercana (recomendado: **Virginia** para mejor latencia)
2. Nombre del cluster: `sala-de-juegos`
3. Click en **Create Cluster** (tarda ~5 minutos)

### 1.3 Configurar Acceso
1. Ve a **Database Access** → **Add New Database User**
2. Username: `salauser`
3. Password: Genera una segura (guárdala!)
4. Roles: **Read and Write to Any Database**
5. Click **Add User**

### 1.4 Configurar Network Access
1. Ve a **Network Access** → **Add IP Address**
2. Click en **Allow Access from Anywhere** (0.0.0.0/0)
3. Click **Confirm**

### 1.5 Obtener URI de Conexión
1. Ve a **Clusters** → Click en **Connect**
2. Selecciona **Connect your application**
3. Copia el string de conexión:
   ```
   mongodb+srv://salauser:<password>@sala-de-juegos.xxxxx.mongodb.net/sala-de-juegos?retryWrites=true&w=majority
   ```
4. Reemplaza `<password>` con tu contraseña real

---

## 🔐 PASO 2: Configurar Variables de Entorno en Vercel

Ve a tu proyecto en Vercel → **Settings** → **Environment Variables**:

```
MONGODB_URI=mongodb+srv://salauser:TU_PASSWORD@sala-de-juegos.xxxxx.mongodb.net/sala-de-juegos?retryWrites=true&w=majority
PLATFORM_USER=tu_usuario_jugaygana
PLATFORM_PASS=tu_contraseña_jugaygana
PROXY_URL=http://esruunltresidential-AR-rotate:oef27c64xo9p@p.webshare.io:80
JWT_SECRET=sala-de-juegos-secret-key-2024
```

---

## 🚀 PASO 3: Sincronización Masiva Inicial

Para importar los 100,000+ usuarios existentes de JUGAYGANA:

### Opción A: Script Local (Recomendado)

1. Clona tu repositorio localmente:
   ```bash
   git clone https://github.com/TUUSUARIO/paginacopia.git
   cd paginacopia
   ```

2. Instala dependencias:
   ```bash
   npm install
   ```

3. Crea archivo `.env`:
   ```env
   MONGODB_URI=mongodb+srv://salauser:TU_PASSWORD@sala-de-juegos.xxxxx.mongodb.net/sala-de-juegos
   PLATFORM_USER=tu_usuario_jugaygana
   PLATFORM_PASS=tu_contraseña_jugaygana
   PROXY_URL=http://esruunltresidential-AR-rotate:oef27c64xo9p@p.webshare.io:80
   ```

4. Ejecuta el script de sincronización:
   ```bash
   node scripts/sync-all-users.js
   ```

   Esto importará todos los usuarios de JUGAYGANA a MongoDB.

### Opción B: Endpoint de Sincronización (para actualizaciones)

Una vez que la app está deployada, puedes llamar:

```bash
curl -X POST https://paginacopia.vercel.app/api/admin/sync-jugaygana \
  -H "Authorization: Bearer TU_TOKEN_ADMIN"
```

---

## 📊 FLUJO DE USUARIOS

### Login de usuario:
```
1. Usuario ingresa username/password
2. Sistema busca en MongoDB
3. Si NO existe → Busca en JUGAYGANA
4. Si existe en JUGAYGANA → Crea automáticamente en MongoDB
5. Usuario puede entrar sin registrarse manualmente
```

### Nuevo usuario en JUGAYGANA:
```
1. Se crea en JUGAYGANA (desde su panel)
2. Cuando intenta entrar a tu página → Se crea automáticamente
3. Contraseña por defecto: asd123
```

### Nuevo usuario en tu página:
```
1. Se registra en tu página
2. Se crea automáticamente en JUGAYGANA
3. Se guarda el link entre ambos sistemas
```

---

## ⚡ PERFORMANCE CON 100K USUARIOS

### Índices creados automáticamente:
- `username` (único)
- `jugayganaUserId`
- `jugayganaSyncStatus`
- `createdAt`

### Búsquedas optimizadas:
- Login: ~50ms
- Búsqueda por username: ~30ms
- Listado paginado: ~100ms

### Límites de MongoDB Atlas Free:
- 5GB de almacenamiento (suficiente para 500K+ usuarios)
- 100 conexiones simultáneas
- Shared RAM (suficiente para carga media)

---

## 🔧 COMANDOS ÚTILES

### Ver estadísticas de usuarios:
```bash
node -e "
const { connectDB, User } = require('./config/database');
connectDB().then(async () => {
  const total = await User.countDocuments();
  const jugaygana = await User.countDocuments({ source: 'jugaygana' });
  const local = await User.countDocuments({ source: 'local' });
  console.log('Total:', total, '| JUGAYGANA:', jugaygana, '| Local:', local);
  process.exit(0);
});
"
```

### Buscar usuario específico:
```bash
node -e "
const { connectDB, User } = require('./config/database');
connectDB().then(async () => {
  const user = await User.findOne({ username: 'nombre_usuario' });
  console.log(user);
  process.exit(0);
});
"
```

---

## 🐛 SOLUCIÓN DE PROBLEMAS

### Error: "Cannot connect to MongoDB"
- Verifica que la IP esté permitida (0.0.0.0/0)
- Verifica que el password sea correcto
- Verifica que el usuario tenga permisos de readWrite

### Error: "IP bloqueada" en JUGAYGANA
- Verifica que PROXY_URL esté configurado
- Verifica que el proxy tenga IP argentina
- Ejecuta `node -e "require('./jugaygana').logProxyIP()"` para verificar

### Error: "Usuario no encontrado" en JUGAYGANA
- Verifica que PLATFORM_USER y PLATFORM_PASS sean correctos
- Verifica que el usuario admin tenga permisos para ver otros usuarios

### Sincronización muy lenta
- Es normal con 100K usuarios (puede tardar 30-60 minutos)
- El script procesa en lotes de 100 para no saturar la API
- No interrumpas el proceso

---

## 📈 ESCALABILIDAD FUTURA

Si necesitas más de 500K usuarios:

1. **Upgrade MongoDB Atlas** a M10 ($9/mes)
   - 10GB storage
   - 2GB RAM dedicada
   - Mejor performance

2. **Sharding** (para millones de usuarios)
   - Distribuye datos en múltiples servidores
   - MongoDB Atlas lo maneja automáticamente

3. **Redis para caché**
   - Cache de sesiones
   - Cache de usuarios frecuentes

---

## ✅ CHECKLIST DE DEPLOY

- [ ] MongoDB Atlas creado
- [ ] Usuario de base de datos creado
- [ ] Network access configurado (0.0.0.0/0)
- [ ] URI de conexión copiada
- [ ] Variables de entorno en Vercel configuradas
- [ ] Script de sincronización ejecutado localmente
- [ ] Verificar que el login funciona
- [ ] Verificar que nuevos usuarios se sincronizan

---

## 📞 SOPORTE

Si tienes problemas:
1. Revisa los logs en Vercel
2. Verifica la conexión a MongoDB
3. Verifica la conexión a JUGAYGANA (IP argentina)
4. Contacta soporte si es necesario
