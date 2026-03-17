# 🎮 Sala de Juegos - Backend v56

Backend completo para Sala de Juegos Chat - **VERSIÓN ORIGINAL FUNCIONANDO**

## 📦 Versión
- **v56.0.0** - Versión estable y funcionando

## ✅ Características

- ✅ Login/Registro de usuarios
- ✅ Chat en tiempo real (Socket.IO)
- ✅ Sistema de reembolsos (diario 20%, semanal 10%, mensual 5%)
- ✅ Integración JUGAYGANA
- ✅ Panel de administración completo
- ✅ Sistema de fueguito (racha diaria)
- ✅ Depósitos y retiros
- ✅ Gestión de usuarios
- ✅ Sincronización masiva de usuarios

## 🔐 Credenciales

### Admin:
- Usuario: `ignite100`
- Contraseña: `pepsi100`

### Usuario de prueba:
- Usuario: `672rosana1`
- Contraseña: `asd123`

## 🚀 Configuración en Render

### Variables de Entorno:

```bash
# JUGAYGANA (OBLIGATORIO)
PLATFORM_USER=tu_usuario_jugaygana
PLATFORM_PASS=tu_contraseña_jugaygana
PROXY_URL=http://esruunltresidential-AR-rotate:oef27c64xo9p@p.webshare.io:80

# Seguridad (OBLIGATORIO)
JWT_SECRET=tu_secreto_jwt_seguro_aleatorio

# Opcional
ALLOWED_ORIGINS=https://tudominio.com,https://www.tudominio.com
```

## 📁 Estructura

```
sala-de-juegos-v56/
├── server.js                 # Servidor principal
├── jugaygana.js              # Integración JUGAYGANA
├── jugaygana-movements.js    # Movimientos de saldo
├── jugaygana-sync.js         # Sincronización masiva
├── database.js               # Configuración MongoDB (opcional)
├── models/
│   └── refunds.js            # Modelo de reembolsos
├── scripts/
│   └── sync-all-users.js     # Script de sincronización
├── public/
│   ├── index.html            # Frontend usuario
│   └── adminprivado2026/
│       ├── index.html        # Panel admin
│       ├── admin.js          # JS del admin
│       └── admin.css         # CSS del admin
├── package.json              # Dependencias
└── vercel.json               # Configuración Vercel
```

## 📝 Notas

- Usa archivos JSON para persistencia de datos
- Compatible con Render y Vercel
- Cloudflare listo con headers de seguridad
- MongoDB opcional (fallback a JSON)

---
**Esta es la versión ORIGINAL que funcionaba perfectamente.**
