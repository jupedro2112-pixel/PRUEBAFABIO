# Persistencia de Datos en Sala de Juegos

## Cómo se guardan los usuarios

Los usuarios creados en la plataforma se guardan automáticamente en archivos JSON en el servidor. No es necesario hacer nada especial - cada vez que se crea un usuario, se almacena permanentemente.

### Archivos de datos

Los siguientes archivos se encuentran en la carpeta `data/` (o `/tmp/data` en Vercel):

1. **users.json** - Contiene todos los usuarios registrados
2. **messages.json** - Contiene el historial de mensajes de chat
3. **chat-status.json** - Estado de los chats (abiertos/cerrados/pagos)
4. **transactions.json** - Registro de transacciones (depósitos/retiros/bonus)
5. **system-config.json** - Configuración del sistema (CBU, etc.)
6. **custom-commands.json** - Comandos personalizados
7. **external-users.json** - Base de datos externa de usuarios que hablaron
8. **user-activity.json** - Actividad para el sistema de fueguito
9. **fire-rewards.json** - Recompensas del fueguito

### Estructura de un usuario en users.json

```json
{
  "id": "uuid-unico",
  "username": "nombreusuario",
  "password": "hash-encriptado",
  "email": "usuario@email.com",
  "phone": "+5491112345678",
  "role": "user",
  "accountNumber": "ACC123456",
  "balance": 1500.00,
  "createdAt": "2024-01-15T10:30:00.000Z",
  "lastLogin": "2024-01-20T15:45:00.000Z",
  "isActive": true,
  "jugayganaUserId": "12345",
  "jugayganaUsername": "nombreusuario",
  "jugayganaSyncStatus": "synced",
  "tokenVersion": 0,
  "passwordChangedAt": "2024-01-18T12:00:00.000Z"
}
```

### Cómo funciona la persistencia

1. **Creación de usuario**: Cuando se crea un usuario, se agrega al array de usuarios y se guarda inmediatamente en `users.json`

2. **Backup automático**: Cada vez que hay un cambio, el archivo se sobrescribe con los datos actualizados

3. **Carga al iniciar**: Cuando el servidor se reinicia, automáticamente carga todos los usuarios desde `users.json`

### Funciones clave en server.js

```javascript
// Cargar usuarios desde el archivo
const loadUsers = () => {
  try {
    const data = fs.readFileSync(USERS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return [];
  }
};

// Guardar usuarios en el archivo
const saveUsers = (users) => {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
};
```

### Para hacer backup manual

Simplemente copia los archivos de la carpeta `data/`:

```bash
# En local
cp data/users.json backup-users-$(date +%Y%m%d).json

# En el servidor (si tienes acceso SSH)
scp usuario@servidor:/ruta/al/proyecto/data/users.json ./backup/
```

### Para restaurar datos

Reemplaza los archivos en la carpeta `data/` con tus archivos de backup y reinicia el servidor.

### En Vercel (serverless)

En Vercel, los archivos se almacenan en `/tmp/data/` que es un almacenamiento temporal. **IMPORTANTE**: En Vercel, los datos pueden perderse cuando la función se recicla. Para producción en Vercel, se recomienda:

1. Usar una base de datos externa (MongoDB, PostgreSQL, etc.)
2. O configurar un volumen persistente
3. O hacer backups regulares descargando los archivos

### Verificación de integridad

Al iniciar, el servidor verifica que los archivos existan y los crea si no están:

```javascript
// Crear archivos JSON si no existen
try {
  if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify([], null, 2));
  }
  if (!fs.existsSync(MESSAGES_FILE)) {
    fs.writeFileSync(MESSAGES_FILE, JSON.stringify([], null, 2));
  }
} catch (error) {
  console.error('Error creando archivos de datos:', error);
}
```

## Resumen

- ✅ Los usuarios se guardan automáticamente
- ✅ Los datos persisten entre reinicios del servidor
- ✅ Los archivos están en formato JSON legible
- ✅ Se puede hacer backup copiando los archivos
- ✅ En Vercel considerar usar base de datos externa para producción
