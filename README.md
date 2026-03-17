# 🎮 Sala de Juegos - Backend v63

Backend completo para Sala de Juegos Chat con **MongoDB Atlas** y **Cloudflare**.

## ✅ CAMBIOS EN ESTA VERSIÓN

### Nuevas Características:
1. **MongoDB Atlas** - Persistencia de datos en la nube
2. **Cloudflare Security Headers** - Headers de seguridad para Cloudflare Business
3. **Fallback a JSON** - Si MongoDB no está disponible, usa JSON automáticamente

### Todo funciona igual que en v56:
- ✅ Login/Registro de usuarios
- ✅ Chat en tiempo real
- ✅ Sistema de reembolsos (diario 20%, semanal 10%, mensual 5%)
- ✅ Integración JUGAYGANA
- ✅ Panel de administración
- ✅ Sistema de fueguito (racha diaria)
- ✅ Depósitos y retiros
- ✅ Gestión de usuarios

---

## 🚀 CONFIGURACIÓN EN RENDER

### 1. Variables de Entorno

En tu dashboard de Render, agrega estas variables:

```
# MongoDB Atlas (OBLIGATORIO)
MONGODB_URI=mongodb+srv://usuario:password@cluster.mongodb.net/sala-de-juegos?retryWrites=true&w=majority

# JUGAYGANA (OBLIGATORIO)
PLATFORM_USER=tu_usuario_jugaygana
PLATFORM_PASS=tu_contraseña_jugaygana
PROXY_URL=http://esruunltresidential-AR-rotate:oef27c64xo9p@p.webshare.io:80

# Seguridad (OBLIGATORIO)
JWT_SECRET=tu_secreto_jwt_seguro_aleatorio

# Opcional
ALLOWED_ORIGINS=https://tudominio.com,https://www.tudominio.com
```

### 2. Obtener MONGODB_URI

1. Ve a [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
2. Crea una cuenta o inicia sesión
3. Crea un nuevo cluster (gratis M0)
4. Ve a **Database Access** → Crea un usuario
5. Ve a **Network Access** → Agrega IP `0.0.0.0/0`
6. Ve a **Clusters** → Click **Connect** → **Connect your application**
7. Copia el string y reemplaza `<password>` con tu contraseña

---

## 🔐 CLOUDFLARE CONFIGURATION

### Si usas Cloudflare Business:

1. Ve a **SSL/TLS** → **Overview** → Set to **Full (strict)**
2. Ve a **SSL/TLS** → **Edge Certificates** → Activa **Always Use HTTPS**
3. Ve a **Rules** → **Configuration Rules** → Crea regla para tu dominio:
   - SSL: Full (strict)
   - Security Level: High
   - Browser Integrity Check: On

### Headers de Seguridad (ya incluidos en server.js):

El servidor ya incluye todos los headers necesarios para Cloudflare:
- `Strict-Transport-Security`
- `X-Frame-Options`
- `X-Content-Type-Options`
- `X-XSS-Protection`
- Y más...

---

## 📁 ESTRUCTURA DEL PROYECTO

```
sala-de-juegos-v63/
├── server.js              # Servidor principal
├── database.js            # Configuración MongoDB + modelos
├── package.json           # Dependencias
├── vercel.json           # Configuración Vercel
├── README.md             # Este archivo
├── jugaygana.js          # Integración JUGAYGANA
├── jugaygana-movements.js # Movimientos de saldo
├── jugaygana-sync.js     # Sincronización masiva
├── models/
│   └── refunds.js        # Modelo de reembolsos
├── public/
│   ├── index.html        # Frontend usuario
│   └── adminprivado2026/
│       ├── index.html    # Panel admin
│       ├── admin.js      # JS del admin
│       └── admin.css     # CSS del admin
└── scripts/
    └── sync-all-users.js # Script de sincronización
```

---

## 🔄 MIGRACIÓN DESDE v56

### Si tienes datos en JSON que quieres migrar:

1. Copia tus archivos JSON de la carpeta `data/` de v56
2. Péguelos en la carpeta `data/` de v63
3. El servidor detectará los datos y los migrará automáticamente a MongoDB

---

## 🧪 CREDENCIALES DE PRUEBA

### Admin:
- Usuario: `ignite100`
- Contraseña: `pepsi100`

### Usuario de prueba:
- Usuario: `672rosana1`
- Contraseña: `asd123`

---

## 📝 NOTAS IMPORTANTES

1. **MongoDB es opcional**: Si no configuras `MONGODB_URI`, el servidor usará JSON como antes
2. **Compatible con v56**: Todos los endpoints y funcionalidades son idénticos
3. **Cloudflare listo**: Headers de seguridad preconfigurados
4. **Sincronización JUGAYGANA**: Funciona igual que antes

---

## 🆘 SOPORTE

Si tienes problemas:
1. Verifica que `MONGODB_URI` esté correctamente configurado
2. Revisa los logs en Render
3. Verifica que el proxy de JUGAYGANA funcione
4. Contacta soporte si es necesario
