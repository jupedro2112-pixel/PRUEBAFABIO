# 🔧 Solución al Problema de Reembolsos Duplicados

## Problema
Los usuarios pueden reclamar reembolsos múltiples veces aunque ya aparezcan en MongoDB.

## Causa
El problema era que el sistema usaba **hora Argentina (GMT-3)** para buscar, pero MongoDB guarda las fechas en **UTC**. Esto causaba que la búsqueda no encontrara el documento recién creado.

## Solución Aplicada

### 1. Archivo `models/refunds.js` - CORREGIDO ✅
- **Antes**: Usaba `getStartOfDayArgentina()` con offset -03:00
- **Ahora**: Usa `getStartOfTodayUTC()` con UTC
- Todos los cálculos de fechas ahora usan UTC consistentemente

### 2. Funciones de fecha actualizadas:
```javascript
// UTC - Universal (lo que usa MongoDB internamente)
getStartOfTodayUTC()     // Inicio del día en UTC
getEndOfTodayUTC()       // Fin del día en UTC  
getStartOfWeekUTC()      // Lunes en UTC
getStartOfMonthUTC()     // Día 1 del mes en UTC
```

## ⚠️ PASOS IMPORTANTES PARA APLICAR LOS CAMBIOS

### Paso 1: Reiniciar el servidor
Los cambios en `models/refunds.js` requieren reiniciar Node.js:

```bash
# Detener el servidor (Ctrl+C)
# Luego iniciar de nuevo:
npm start
```

### Paso 2: Verificar índices de MongoDB
Los índices deben crearse automáticamente, pero verificalos en MongoDB Compass:

```javascript
// En MongoDB Compass, ejecutar en la colección refunds:
db.refunds.getIndexes()

// Deberías ver:
[
  { "key": { "userId": 1, "type": 1, "date": -1 } },
  { "key": { "userId": 1, "date": -1 } }
]
```

Si no aparecen, reinicia el servidor o créalos manualmente.

### Paso 3: Probar el sistema

#### Opción A: Test automático
```bash
node test-refunds.js
```

Debería mostrar:
```
✅ Conectado a MongoDB
✅ PUEDE reclamar (inicial)
✅ Reembolso registrado
❌ NO puede reclamar (después de registrar)  <-- ESTO ES LO IMPORTANTE
✅ TODOS LOS TESTS PASARON
```

#### Opción B: Prueba manual
1. Abrir la aplicación
2. Reclamar reembolso diario → Debería funcionar
3. Intentar reclamar de nuevo INMEDIATAMENTE → Debería bloquear
4. Verificar en MongoDB Compass que el documento existe

## 🔍 Diagnóstico

Si sigue sin funcionar, verificar los logs del servidor. Deberías ver:

```
🔍 Verificando reembolso diario para userId: xxx
🔍 Buscando en MongoDB - userId: xxx, type: daily
📅 Rango: 2026-03-19T00:00:00.000Z hasta 2026-03-19T23:59:59.999Z
✅ Usuario xxx NO ha reclamado reembolso diario hoy
```

O si ya reclamó:
```
🚫 Usuario xxx ya reclamó reembolso diario hoy (encontrado en MongoDB)
📄 Documento encontrado: {...}
```

## 📊 Estructura Correcta en MongoDB

Cada documento en la colección `refunds` debe verse así:

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
  "date": ISODate("2026-03-19T17:30:00.000Z"),  // UTC
  "status": "claimed",
  "createdAt": ISODate("2026-03-19T17:30:00.000Z"),
  "updatedAt": ISODate("2026-03-19T17:30:00.000Z")
}
```

**Importante**: La fecha se guarda en UTC (termina en Z), pero representa la hora correcta.

## 🔄 Flujo Correcto del Sistema

```
1. Usuario hace clic en "Reclamar Reembolso Diario"
2. Servidor consulta MongoDB:
   - userId: "abc123"
   - type: "daily"
   - date: entre hoy 00:00 UTC y hoy 23:59 UTC
3. Si NO encuentra → Acredita el reembolso
4. Guarda documento en MongoDB con fecha UTC
5. Si el usuario intenta de nuevo:
   - Misma consulta encuentra el documento
   - Bloquea con mensaje: "Ya reclamaste hoy"
```

## 🐛 Si sigue sin funcionar

### Verificar 1: userId como String
Asegurarse de que `userId` sea siempre string:
```javascript
// En refunds.js, línea 414:
userId: String(userId),  // Forzar conversión a string
```

### Verificar 2: Índices creados
Si los índices no se crearon automáticamente:
```javascript
// En MongoDB Compass:
db.refunds.createIndex({ userId: 1, type: 1, date: -1 })
db.refunds.createIndex({ userId: 1, date: -1 })
```

### Verificar 3: Cache del servidor
Si usas Vercel o similar, puede haber cache:
1. Hacer commit de los cambios
2. Forzar redeploy
3. O esperar a que la cache se invalide

## ✅ Checklist Final

- [ ] Archivo `models/refunds.js` actualizado con UTC
- [ ] Servidor reiniciado
- [ ] Índices creados en MongoDB
- [ ] Test pasado: `node test-refunds.js`
- [ ] Prueba manual exitosa

## 📞 Logs de Debug

El sistema ahora muestra logs detallados:
```
🔍 Verificando reembolso diario para userId: xxx
🔍 Buscando en MongoDB - userId: xxx, type: daily
📅 Rango: 2026-03-19T00:00:00.000Z hasta 2026-03-19T23:59:59.999Z
✅ Usuario xxx NO ha reclamado reembolso diario hoy
💾 Guardando reembolso: {...}
✅ Reembolso daily guardado en MongoDB para usuario xxx, ID: yyy
```

Si ves estos logs, el sistema está funcionando correctamente.
