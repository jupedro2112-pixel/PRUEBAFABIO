# Cambios Realizados - Sistema de Reembolsos

## Resumen
Se implementó la verificación en MongoDB para evitar que los usuarios reclamen reembolsos múltiples, igual que funciona el sistema de fueguito.

---

## 🔴 CORRECCIÓN CRÍTICA: Zona Horaria UTC

**Problema identificado**: El sistema usaba hora Argentina (GMT-3) para buscar, pero MongoDB guarda las fechas en UTC. Esto causaba que la búsqueda no encontrara el documento recién creado.

**Solución**: Todas las fechas ahora usan UTC consistentemente:
- `getStartOfTodayUTC()` - Inicio del día en UTC
- `getEndOfTodayUTC()` - Fin del día en UTC
- `getStartOfWeekUTC()` - Lunes en UTC
- `getStartOfMonthUTC()` - Día 1 del mes en UTC

---

## Archivos Modificados

### 1. `/database.js` - NUEVO ARCHIVO
- Creado modelo `Refund` con schema completo para MongoDB
- Agregados índices para búsquedas rápidas: `userId + type + date`
- Incluye campos: `id, userId, username, type, amount, netAmount, deposits, withdrawals, date, status`

### 2. `/models/refunds.js` - COMPLETAMENTE REESCRITO
**Nuevas funciones de verificación en MongoDB:**

- `hasClaimedDailyToday(userId)` - Verifica si ya existe un reembolso diario para hoy en MongoDB
- `hasClaimedWeeklyThisWeek(userId)` - Verifica si ya existe un reembolso semanal esta semana
- `hasClaimedMonthlyThisMonth(userId)` - Verifica si ya existe un reembolso mensual este mes

**Funciones actualizadas:**

- `canClaimDailyRefund(userId)` - Ahora verifica primero en MongoDB antes de permitir reclamo
- `canClaimWeeklyRefund(userId)` - Verifica en MongoDB + validación de día (lunes/martes)
- `canClaimMonthlyRefund(userId)` - Verifica en MongoDB + validación de día (del 7 en adelante)
- `recordRefund()` - Ahora guarda en MongoDB y en archivo local

**Características:**
- Usa UTC para todas las operaciones de fecha (consistente con MongoDB)
- Fallback a archivo local si MongoDB no está conectado
- Mensajes descriptivos cuando ya se reclamó un reembolso
- Logs detallados para debug

### 3. `/server.js` - SCHEMA ACTUALIZADO
- Actualizado el schema de `refundSchema` para coincidir con el de database.js
- Agregados índices para búsquedas rápidas
- El resto del archivo permanece igual (las rutas ya usaban el módulo refunds.js correctamente)

---

## ⚠️ IMPORTANTE: Reiniciar el servidor

Después de actualizar los archivos, **es obligatorio reiniciar el servidor**:

```bash
# Detener el servidor (Ctrl+C)
# Luego iniciar de nuevo:
npm start
```

---

## 🧪 Testing

### Test automático:
```bash
node test-refunds.js
```

### Test manual:
1. Reclamar reembolso diario → Debería funcionar
2. Intentar reclamar de nuevo INMEDIATAMENTE → Debería bloquear con mensaje
3. Verificar en MongoDB Compass que el documento existe

---

## Cómo Funciona el Bloqueo

### Flujo de Reclamo Diario:
1. Usuario hace clic en "Reclamar Reembolso Diario"
2. El sistema verifica en MongoDB si ya existe un registro con:
   - `userId` = ID del usuario
   - `type` = 'daily'
   - `date` entre inicio y fin del día actual (UTC)
3. Si existe → Bloquea con mensaje: "Ya reclamaste tu reembolso diario hoy. Vuelve mañana!"
4. Si no existe → Permite el reclamo y guarda el registro en MongoDB

### Flujo de Reclamo Semanal:
1. Verifica si es lunes o martes
2. Verifica en MongoDB si ya existe un registro con:
   - `userId` = ID del usuario
   - `type` = 'weekly'
   - `date` >= inicio de la semana actual (lunes, UTC)
3. Si existe → Bloquea con mensaje de próximo lunes
4. Si no existe → Permite el reclamo

### Flujo de Reclamo Mensual:
1. Verifica si es día 7 o posterior
2. Verifica en MongoDB si ya existe un registro con:
   - `userId` = ID del usuario
   - `type` = 'monthly'
   - `date` >= inicio del mes actual (UTC)
3. Si existe → Bloquea con mensaje de próximo mes
4. Si no existe → Permite el reclamo

---

## 📊 Estructura en MongoDB

### Colección: `refunds`

```json
{
  "_id": ObjectId("..."),
  "id": "uuid-unico",
  "userId": "id-del-usuario",
  "username": "nombre_usuario",
  "type": "daily",
  "amount": 1500,
  "netAmount": 7500,
  "deposits": 10000,
  "withdrawals": 2500,
  "date": ISODate("2026-03-19T17:30:00.000Z"),
  "status": "claimed",
  "createdAt": ISODate("2026-03-19T17:30:00.000Z"),
  "updatedAt": ISODate("2026-03-19T17:30:00.000Z")
}
```

### Índices:
```javascript
{ userId: 1, type: 1, date: -1 }  // Para búsquedas rápidas
{ userId: 1, date: -1 }           // Para ordenar por fecha
```

---

## 🔍 Logs de Debug

El sistema ahora muestra logs detallados:
```
🔍 Verificando reembolso diario para userId: xxx
🔍 Buscando en MongoDB - userId: xxx, type: daily
📅 Rango: 2026-03-19T00:00:00.000Z hasta 2026-03-19T23:59:59.999Z
✅ Usuario xxx NO ha reclamado reembolso diario hoy
💾 Guardando reembolso: {...}
✅ Reembolso daily guardado en MongoDB para usuario xxx, ID: yyy
```
