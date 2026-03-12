# 🎮 Sala de Juegos - Chat

Réplica exacta de la aplicación de chat https://chat.saladechat.com.ar/

## 🌐 URL de Preview

**https://5aho2au7mq66m.ok.kimi.link**

## 📋 Credenciales de Prueba

- **Usuario:** `672rosana1`
- **Contraseña:** `asd123`

## 📁 Estructura de Archivos

```
sala-de-juegos-replica/
├── index.html          # Aplicación completa (login + chat)
├── manifest.json       # Configuración PWA
├── service-worker.js   # Service Worker para funcionalidad offline
├── icons/              # Iconos de la aplicación
│   ├── icon-16x16.png
│   ├── icon-32x32.png
│   ├── icon-57x57.png
│   ├── icon-60x60.png
│   ├── icon-72x72.png
│   ├── icon-76x76.png
│   ├── icon-96x96.png
│   ├── icon-114x114.png
│   ├── icon-120x120.png
│   ├── icon-128x128.png
│   ├── icon-144x144.png
│   ├── icon-152x152.png
│   ├── icon-180x180.png
│   ├── icon-192x192.png
│   ├── icon-384x384.png
│   └── icon-512x512.png
└── README.md           # Este archivo
```

## 🚀 Funcionalidades

### Página de Login
- ✅ Formulario de autenticación con usuario y contraseña
- ✅ Botón "Ingresar a la Sala"
- ✅ Botón "👤 Crear Usuario" (abre WhatsApp)
- ✅ Botón "📞 Ayuda" (abre WhatsApp)
- ✅ Botón "📱 Instalar App" (PWA)
- ✅ Diseño con efecto glassmorphism
- ✅ Fondo degradado oscuro

### Sala de Chat
- ✅ Header dorado con animación shimmer
- ✅ Banner de promociones con marquee animado
- ✅ Botón "📞 SOPORTE" (pulsante)
- ✅ Nombre de usuario logueado
- ✅ Botón "🚪 Salir"
- ✅ Sección "Ingreso a Plataformas" con:
  - Botón "🎯 Link Ganamos" (morado)
  - Botón "🌶️ Link Picantes" (rojo)
- ✅ Área de mensajes con burbujas estilo WhatsApp
- ✅ Botón "Copiar" en cada mensaje
- ✅ Input para escribir mensajes
- ✅ Botón 📸 para adjuntar imágenes
- ✅ Botón "Enviar"
- ✅ Scroll automático al último mensaje

### Funcionalidades Técnicas
- ✅ **PWA (Progressive Web App)** - Instalable en móviles
- ✅ **Service Worker** - Funciona offline
- ✅ **Manifest.json** - Configuración de app
- ✅ **WebSockets** - Chat en tiempo real
- ✅ **LocalStorage** - Persistencia de sesión
- ✅ **Responsive Design** - Adaptable a móviles y desktop
- ✅ **Detección de teclado** - Ajustes para móviles
- ✅ **Copiar al portapapeles** - Funcionalidad moderna con fallback

## 🎨 Paleta de Colores

| Color | Código | Uso |
|-------|--------|-----|
| Dorado | `#d4af37`, `#ffd700` | Header, bordes, acentos |
| Verde neón | `#00ff88`, `#00cc6a` | Botones, tema PWA |
| Morado | `#9d4edd`, `#6603a8` | Soporte, crear usuario |
| Rojo | `#ff4444`, `#cc0000` | Logout, errores |
| Fondo oscuro | `#0a0015`, `#1a0033` | Background general |

## 📱 Instalación en tu Propio Servidor

### Opción 1: Servidor Web Simple (Recomendado)

1. **Descarga todos los archivos** de esta carpeta

2. **Sube los archivos** a tu servidor web (Apache, Nginx, etc.)

3. **Asegúrate de que los archivos estén en la raíz**:
   ```
   /public_html/
   ├── index.html
   ├── manifest.json
   ├── service-worker.js
   └── icons/
   ```

4. **Configura HTTPS** (obligatorio para PWA):
   - La aplicación requiere HTTPS para funcionar correctamente
   - Puedes usar Let's Encrypt para certificados gratuitos

### Opción 2: Node.js + Express

1. **Crea un proyecto nuevo**:
   ```bash
   mkdir mi-sala-de-juegos
   cd mi-sala-de-juegos
   npm init -y
   ```

2. **Instala Express**:
   ```bash
   npm install express
   ```

3. **Crea server.js**:
   ```javascript
   const express = require('express');
   const path = require('path');
   const app = express();
   const PORT = process.env.PORT || 3000;

   // Servir archivos estáticos
   app.use(express.static(path.join(__dirname, 'public')));

   // Ruta principal
   app.get('/', (req, res) => {
     res.sendFile(path.join(__dirname, 'public', 'index.html'));
   });

   app.listen(PORT, () => {
     console.log(`Servidor corriendo en http://localhost:${PORT}`);
   });
   ```

4. **Copia los archivos** a la carpeta `public/`

5. **Inicia el servidor**:
   ```bash
   node server.js
   ```

### Opción 3: Netlify / Vercel (Gratis)

1. **Comprime todos los archivos** en un ZIP

2. **Sube el ZIP** a:
   - [Netlify Drop](https://app.netlify.com/drop)
   - O [Vercel](https://vercel.com)

3. **Tu app estará online** en segundos

## 🔧 Personalización

### Cambiar el usuario de prueba

Edita `index.html` y busca la sección de autenticación:

```javascript
// Usuario de prueba
const TEST_USER = {
    username: '672rosana1',
    password: 'asd123'
};
```

### Cambiar los mensajes del marquee

Busca en `index.html`:

```html
<div class="promo-track">
    <span class="promo-item">🎁 ¡RETIRA HASTA $1.000.000 AL DÍA! 🎁</span>
    ...
</div>
```

### Cambiar los enlaces de plataformas

Busca en `index.html`:

```javascript
// Enlaces de plataformas
const LINKS = {
    ganamos: 'https://tulink.com',
    picantes: 'https://tulink.com'
};
```

## 🔐 Seguridad

⚠️ **IMPORTANTE**: Esta es una réplica frontend. Para uso en producción:

1. **Implementa autenticación real** con JWT o sesiones
2. **Usa HTTPS** obligatoriamente
3. **Valida todos los inputs** en el servidor
4. **Protege contra XSS** y CSRF
5. **No almacenes contraseñas** en texto plano

## 🛠️ Tecnologías Utilizadas

- HTML5
- CSS3 (Animaciones, Flexbox, Grid)
- JavaScript (ES6+)
- Socket.IO (WebSockets)
- Service Workers (PWA)
- LocalStorage

## 📄 Licencia

Este proyecto es una réplica educativa. Todos los derechos del diseño original pertenecen a sus respectivos dueños.

## 🤝 Soporte

¿Necesitas ayuda para implementar esta réplica? Contáctame.

---

**Nota:** Esta réplica incluye todas las funcionalidades visuales y de frontend. Para un chat en tiempo real completo, necesitarás implementar un backend con WebSockets.
