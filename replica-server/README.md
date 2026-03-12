# Replica Chat Server

Backend para aplicación de chat con autenticación y WebSockets.

## Características

- ✅ Autenticación de usuarios (login/registro)
- ✅ WebSockets en tiempo real con Socket.io
- ✅ Salas de chat múltiples
- ✅ Historial de mensajes persistente
- ✅ Mensajes privados entre usuarios
- ✅ Indicador de "escribiendo..."
- ✅ Notificaciones de conexión/desconexión
- ✅ Lista de usuarios conectados por sala
- ✅ Persistencia en archivos JSON

## Instalación

```bash
npm install
```

## Uso

### Iniciar servidor

```bash
# Modo producción
npm start

# Modo desarrollo (con auto-reload)
npm run dev
```

El servidor se iniciará en `http://localhost:3000`

### Usuario de prueba

- **Usuario:** `672rosana1`
- **Contraseña:** `asd123`

## API REST

### Autenticación

#### Login
```http
POST /api/auth/login
Content-Type: application/json

{
  "username": "672rosana1",
  "password": "asd123"
}
```

Respuesta:
```json
{
  "success": true,
  "token": "uuid-del-usuario",
  "user": {
    "id": "uuid-del-usuario",
    "username": "672rosana1"
  }
}
```

#### Registro
```http
POST /api/auth/register
Content-Type: application/json

{
  "username": "nuevo-usuario",
  "password": "contraseña123"
}
```

#### Verificar Token
```http
GET /api/auth/verify
Authorization: uuid-del-usuario
```

### Salas

#### Listar salas
```http
GET /api/rooms
Authorization: uuid-del-usuario
```

### Mensajes

#### Obtener mensajes de una sala
```http
GET /api/messages/general?limit=50
Authorization: uuid-del-usuario
```

Parámetros opcionales:
- `limit`: Cantidad de mensajes (default: 50)
- `before`: Timestamp para paginación

## WebSocket Events

### Cliente → Servidor

| Evento | Descripción | Datos |
|--------|-------------|-------|
| `join-room` | Unirse a una sala | `{ room: "general" }` |
| `leave-room` | Salir de una sala | `{ room: "general" }` |
| `send-message` | Enviar mensaje | `{ room: "general", content: "Hola!", type: "text" }` |
| `typing` | Indicar que está escribiendo | `{ room: "general", isTyping: true }` |
| `private-message` | Mensaje privado | `{ toUsername: "usuario", content: "Hola!" }` |

### Servidor → Cliente

| Evento | Descripción | Datos |
|--------|-------------|-------|
| `joined-room` | Confirmación de unión | `{ room, username, timestamp }` |
| `user-joined` | Usuario se unió | `{ username, room, timestamp }` |
| `user-left` | Usuario salió | `{ username, room, timestamp }` |
| `new-message` | Nuevo mensaje | `{ id, room, username, content, timestamp }` |
| `message-history` | Historial de mensajes | `{ room, messages: [] }` |
| `users-in-room` | Lista de usuarios | `{ room, users: [] }` |
| `user-typing` | Usuario escribiendo | `{ username, room, isTyping }` |
| `private-message` | Mensaje privado recibido | `{ id, from, to, content, timestamp }` |
| `error` | Error | `{ message }` |

## Ejemplo de uso con Socket.io Client

```javascript
const socket = io('http://localhost:3000', {
    auth: {
        token: 'uuid-del-usuario-obtenido-del-login'
    }
});

// Unirse a una sala
socket.emit('join-room', 'general');

// Escuchar mensajes
socket.on('new-message', (message) => {
    console.log(`${message.username}: ${message.content}`);
});

// Enviar mensaje
socket.emit('send-message', {
    room: 'general',
    content: 'Hola a todos!'
});

// Indicar que estás escribiendo
socket.emit('typing', {
    room: 'general',
    isTyping: true
});
```

## Estructura de archivos

```
replica-server/
├── server.js          # Servidor principal
├── package.json       # Dependencias
├── README.md          # Documentación
├── users.json         # Usuarios registrados (auto-generado)
└── messages.json      # Mensajes almacenados (auto-generado)
```

## Variables de entorno

| Variable | Descripción | Default |
|----------|-------------|---------|
| `PORT` | Puerto del servidor | `3000` |

## Notas

- Los mensajes se guardan en `messages.json` (últimos 1000)
- Los usuarios se guardan en `users.json`
- Las contraseñas se almacenan hasheadas con bcrypt
- En producción, usar JWT para tokens y una base de datos real
