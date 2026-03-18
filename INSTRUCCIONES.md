# 📋 Instrucciones - Correcciones Aplicadas

## ✅ Cambios Realizados

### 1. `server.js` - Corregido OverwriteModelError
**Líneas 87-93**: Se cambió la forma de crear modelos para evitar el error cuando se cargan múltiples veces:

```javascript
// Antes (causaba error):
const User = mongoose.model('User', userSchema);

// Después (corregido):
const User = mongoose.models.User || mongoose.model('User', userSchema);
```

### 2. `database.js` - Nuevo archivo
Creado con:
- Modelo `Refund` para reembolsos en MongoDB
- Índices para búsquedas rápidas
- Funciones `connectDB()` y `disconnectDB()`
- Verificación de modelos existentes (evita OverwriteModelError)

### 3. `models/refunds.js` - Corregido
- Usa UTC para todas las fechas (consistente con MongoDB)
- Verifica en MongoDB antes de permitir reclamo
- Funciones `hasClaimedDailyToday()`, `hasClaimedWeeklyThisWeek()`, `hasClaimedMonthlyThisMonth()`

---

## 🚀 Cómo Subir a GitHub/Render

### Paso 1: Copiar archivos a tu repositorio local
```bash
cd paginacopia

# Copiar los archivos corregidos
cp /mnt/okcomputer/output/sala-de-juegos/server.js .
cp /mnt/okcomputer/output/sala-de-juegos/database.js .
cp /mnt/okcomputer/output/sala-de-juegos/models/refunds.js models/
```

### Paso 2: Agregar y commitear
```bash
git add server.js database.js models/refunds.js
git commit -m "Fix: OverwriteModelError y bloqueo de reembolsos en MongoDB"
```

### Paso 3: Subir a GitHub
```bash
git push origin main
```

### Paso 4: Render se actualiza automáticamente
Esperar a que el deploy termine (verificar en la pestaña "Events" de Render).

---

## 🧪 Verificación

Después del deploy, verificar en los logs de Render:
1. No debe aparecer `OverwriteModelError`
2. Debe decir `✅ MongoDB conectado`
3. El servidor debe iniciar sin errores

---

## 🔍 Si sigue dando error

1. **Limpiar caché del navegador** (Ctrl+Shift+R)
2. **Verificar logs de Render** (pestaña Logs)
3. **Asegurarse de que los archivos se subieron correctamente**:
   ```bash
   git log --oneline -5
   ```

---

## 📁 Archivos Modificados

| Archivo | Cambio |
|---------|--------|
| `server.js` | ✅ OverwriteModelError corregido |
| `database.js` | ✅ Nuevo - Modelo Refund |
| `models/refunds.js` | ✅ Verificación UTC en MongoDB |

---

## ⚠️ Nota Importante

El error `selectedNavItem is not defined` que aparece en el panel de admin es un problema del archivo `admin.js` que está en el servidor. Asegúrate de que el archivo `admin.js` en `public/adminprivado2026/` sea el correcto y no tenga errores.

Si el panel de admin sigue fallando, el problema es que el archivo en el servidor es diferente al local. Prueba:
1. Forzar refresh (Ctrl+Shift+R)
2. O borrar la caché del navegador
