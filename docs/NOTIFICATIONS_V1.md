# Brief — Notificaciones v1 para Compras, Transferencias y Cortes

## Objetivo

Implementar la infraestructura base de notificaciones **in-app** para tres eventos:

```text
PURCHASE_CREATED
TRANSFER_CREATED
CASH_CLOSING_CLOSED
```

Destinatario inicial:

```text
admin
```

La arquitectura debe quedar preparada para añadir **push notifications** después, sin rehacer el modelo.

---

## 1. Principio de arquitectura

Separar:

```text
Evento de negocio
→ Notification
→ canales de entrega
```

En v1 sólo existe:

```text
Notification
→ centro in-app
```

Más adelante:

```text
Notification
├── in-app
└── push
```

No implementar Push todavía.

---

## 2. Cuándo crear la notificación

La notificación debe generarse **cuando el backend acepta definitivamente la operación**.

Ejemplos:

```text
Compra offline
→ local
→ todavía NO notification
→ sync aceptado por backend
→ crear Notification
```

```text
Transferencia offline
→ sync aceptado
→ crear Notification
```

```text
Corte cerrado online
→ close_cash_closing exitoso
→ crear Notification
```

No generar notificaciones desde eventos puramente locales.

---

## 3. Idempotencia

La creación debe ser idempotente.

Usar una clave conceptual equivalente a:

```text
event_type + entity_id
```

Ejemplo:

```text
PURCHASE_CREATED + purchase_id
```

Un retry de sync no debe producir dos notificaciones.

---

## 4. Modelo

Crear una migración aditiva con una tabla equivalente a:

```text
notifications
```

Campos mínimos:

```text
id
event_type

title
message

store_id

entity_type
entity_id

actor_operator_account_id nullable
actor_auth_user_id nullable

created_at
```

Y estado de lectura separado por destinatario, por ejemplo:

```text
notification_recipients
```

con:

```text
notification_id
recipient_type
recipient_id
read_at
```

No usar simplemente:

```text
notification.read = true
```

porque una misma notificación puede tener varios destinatarios.

---

## 5. Destinatarios v1

Inicialmente las tres notificaciones se crean para:

```text
admins activos
```

La solución debe respetar que actualmente:

```text
admin
→ identidad Supabase

cashier / store_manager
→ AppAccount
```

No asumir que todos los destinatarios tienen `operatorAccountId`.

Puede utilizarse una representación equivalente a:

```text
recipient_type = auth_user
recipient_id = admin auth.uid()
```

para v1.

Diseñar el modelo de modo que después pueda soportar:

```text
recipient_type = app_account
```

sin rehacer tablas.

---

## 6. Contenido

### Compra

Ejemplo:

```text
Compra registrada

Tienda Centro · $8,450
Proveedor: Coca-Cola
Registró: María
```

Incluir cuando estén disponibles:

```text
tienda
monto
proveedor
operador
```

---

### Transferencia

```text
Transferencia registrada

Tienda A → Tienda B
$3,280
Registró: Juan
```

---

### Corte

```text
Corte cerrado

Tienda B · Corte #42
Efectivo a retirar: $18,750
Diferencia: -$35
Cerró: Pedro
```

Reutilizar los datos autoritativos ya generados por el Corte.

---

## 7. Autor

Preferir la identidad humana cuando exista:

```text
operatorAccountId
→ AppAccount.displayName
```

Admin:

```text
operatorAccountId = null
→ perfil Supabase / nombre admin
```

No mostrar nombre de la cuenta técnica de tienda como si fuera la persona que realizó la acción.

---

## 8. Centro de notificaciones

Añadir en el header:

```text
campana
+
badge de no leídas
```

Al abrir:

```text
panel/modal de notificaciones
```

Mostrar:

```text
título
mensaje/resumen
fecha/hora
estado leído/no leído
```

Orden:

```text
más recientes primero
```

---

## 9. Leído / no leído

Al abrir una notificación o marcarla explícitamente:

```text
read_at = now()
```

Añadir:

```text
Marcar como leída
```

y, si encaja bien con la UI:

```text
Marcar todas como leídas
```

No eliminar notificaciones al leerlas.

---

## 10. Navegación desde notificación

Las notificaciones deben ser accionables.

```text
Compra
→ abrir detalle de Compra

Transferencia
→ abrir Transferencias / entidad correspondiente

Corte
→ abrir detalle del Corte
```

Usar el sistema de navegación interno existente.

No introducir un router nuevo sólo para esto.

---

## 11. Scope

El admin puede recibir eventos de todas las tiendas.

No mostrar una notificación a usuarios que no sean destinatarios.

El backend debe controlar la lectura/listado de notificaciones.

No confiar sólo en ocultar la campana.

---

## 12. RPCs / acceso

Preferir RPCs controladas, por ejemplo:

```text
list_notifications
mark_notification_read
mark_all_notifications_read
```

y helpers internos para creación idempotente.

Seguir patrones existentes:

```text
SECURITY DEFINER
search_path = ''
schema qualification
grants mínimos
```

No exponer escritura directa de notificaciones al cliente.

---

## 13. Integración con eventos existentes

Integrar la creación en los paths autoritativos de:

```text
create_paid_purchase / sync purchase
sync_merchandise_transfer
close_cash_closing
```

o en los wrappers actuales equivalentes.

No romper:

```text
idempotencia
locks
retries
OperatorSession
autoría
```

La notificación debe formar parte del resultado exitoso de negocio sin duplicarse en reintentos.

---

## 14. Offline

Las notificaciones nuevas requieren backend.

Si la app está offline:

```text
→ mostrar las ya cacheadas si se decide persistirlas localmente
→ no inventar notificaciones locales
```

Puede añadirse una caché simple en Dexie si encaja con el patrón actual, pero no es obligatorio si amplía demasiado el alcance.

---

## 15. No implementar todavía

Fuera de alcance:

```text
Push API
Service Worker push
Web Push subscriptions
permisos de navegador
Realtime
WebSockets
notificaciones por Asistencias
notificaciones por Gastos
notificaciones por Pagos
preferencias configurables
email
SMS
```

---

## 16. Pruebas mínimas

Verificar:

```text
✓ Compra aceptada crea una sola notificación
✓ retry de Compra no duplica notificación

✓ Transferencia aceptada crea una sola notificación
✓ retry no duplica

✓ Corte cerrado crea una sola notificación
✓ retry/idempotencia no duplica

✓ admin ve notificaciones de todas las tiendas
✓ cashier/store_manager no ven notificaciones admin

✓ operador humano correcto aparece como autor
✓ admin usa identidad Supabase cuando corresponda

✓ badge refleja no leídas
✓ marcar como leída funciona
✓ marcar todas funciona si se implementa
✓ abrir Compra navega correctamente
✓ abrir Transferencia navega correctamente
✓ abrir Corte navega correctamente
```

Validar:

```bash
npm test
npm run lint
npx --no-install tsc -b
npm run build
git diff --check
```

No aplicar migraciones remotas y no hacer commit.

---

## Resultado esperado

Después de esta fase:

```text
Compra / Transferencia / Corte
→ backend acepta operación
→ crea Notification idempotente
→ admin la ve en la campana
→ puede abrir la entidad relacionada
```

Y la infraestructura queda preparada para la siguiente fase:

```text
Notification
→ Push PWA
```
