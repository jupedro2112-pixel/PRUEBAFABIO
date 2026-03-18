# 🔧 Errores Comunes y Soluciones

## Error 1: "Error loading admin page"

**Causa:** No existe el archivo `public/adminprivado2026/index.html`

**Solución:** Ya está creado el archivo. Verificar que exista:
```bash
ls -la public/adminprivado2026/
```

Debería mostrar:
```
admin.css
admin.js
index.html  <-- Este archivo debe existir
```

---

## Error 2: "OverwriteModelError: Cannot overwrite 'User' model once compiled."

**Causa:** Los modelos de Mongoose se definen dos veces (en server.js y database.js)

**Solución:** Ya está corregido. Verificar en server.js líneas 88-94:
```javascript
const User = mongoose.models.User || mongoose.model('User', userSchema);
```

---

## Error 3: No puede iniciar sesión en el panel de admin

**Causas posibles:**

### A. El archivo users.json está vacío o no existe
```bash
# Verificar que exista el archivo
cat data/users.json
```

### B. El usuario admin no existe
Crear un usuario admin manualmente:
```bash
# Agregar a data/users.json:
{
  "id": "admin-1",
  "username": "admin",
  "password": "$2a$10$...",  // bcrypt de "admin123"
  "role": "admin",
  "isActive": true
}
```

### C. El JWT_SECRET no está configurado
Verificar en Render:
```
Variables de entorno → JWT_SECRET debe estar definido
```

---

## Error 4: "Token no proporcionado" o "Token inválido"

**Causa:** Problema con el almacenamiento del token en el navegador

**Solución:**
1. Abrir DevTools (F12)
2. Ir a Application → Local Storage
3. Verificar que exista `adminToken`
4. Si no existe, borrar todo y volver a iniciar sesión

---

## Error 5: "Usuario no encontrado"

**Causa:** El authMiddleware busca en users.json pero el usuario solo existe en MongoDB

**Solución:** El sistema debe cargar usuarios de MongoDB cuando está conectado.

Verificar en server.js que `loadUsers()` también busque en MongoDB:
```javascript
const loadUsers = async () => {
  if (mongoConnected) {
    try {
      return await User.find().lean();
    } catch (err) {
      console.error('Error cargando usuarios de MongoDB:', err.message);
    }
  }
  // Fallback a archivo
  try {
    const data = fs.readFileSync(USERS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return [];
  }
};
```

**Nota:** Si `loadUsers` no es async, hay que cambiar el authMiddleware también.

---

## Cómo diagnosticar el error exacto

### 1. Ver logs de Render
Ir a Render → Tu servicio → Logs

Buscar mensajes de error como:
- `OverwriteModelError`
- `Error loading admin page`
- `Token no proporcionado`
- `Usuario no encontrado`

### 2. Ver consola del navegador
Abrir el panel de admin → F12 → Console

Buscar errores rojos.

### 3. Ver Network tab
Abrir el panel de admin → F12 → Network

Intentar iniciar sesión y ver:
- ¿La petición a `/api/auth/login` responde 200?
- ¿Qué devuelve el servidor?

---

## Solución rápida: Resetear todo

Si nada funciona, probar:

1. **Borrar datos de prueba:**
```bash
# En Render shell o local
rm -rf data/*.json
```

2. **Reiniciar el servidor**

3. **Crear usuario admin nuevo:**
Usar el endpoint de registro o crear manualmente en MongoDB.

---

## Verificación paso a paso

1. ✅ El servidor inicia sin errores
2. ✅ MongoDB está conectado
3. ✅ El archivo `index.html` del admin existe
4. ✅ El archivo `admin.js` existe
5. ✅ El archivo `admin.css` existe
6. ✅ El usuario admin existe en users.json o MongoDB
7. ✅ El JWT_SECRET está configurado
8. ✅ El login devuelve token válido
9. ✅ El token se guarda en localStorage
10. ✅ Las peticiones al admin incluyen el token

Si alguno falla, ahí está el problema.
