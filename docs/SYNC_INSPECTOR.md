# Brief — Inspector de pendientes de sincronización

## Objetivo

Hacer visible desde la PWA **qué operaciones están pendientes de sincronizar y por qué**, sin cambiar todavía la lógica de sincronización.

Actualmente el indicador sólo muestra algo como:

```text
4 pendientes
```

pero no permite saber qué entidades son ni si están simplemente esperando conexión o fallando repetidamente.

---

## Alcance

Añadir un panel/modal de **Detalle de sincronización** accesible desde el indicador actual de sync.

Preferencia:

- click/tap sobre el badge o indicador → abrir detalle;
- si es viable, mantener pulsado también puede abrirlo en móvil.

No modificar todavía el comportamiento de “forzar sincronización”.

---

## Información por pendiente

Para cada `SyncQueueItem` mostrar, cuando esté disponible:

- tipo de operación;
- descripción útil;
- tienda;
- operador propietario;
- fecha/hora;
- estado;
- número de intentos;
- último intento;
- último error.

Ejemplos de descripción:

```text
Gasto · $350
Compra · Proveedor X
Transferencia · Tienda A → Tienda B
Asistencia · María
```

---

## Estados

Distinguir visualmente al menos:

```text
Pendiente
Sincronizando
Error
```

El contador general debería permitir distinguir posteriormente entre:

```text
4 pendientes
```

y:

```text
2 pendientes · 2 con error
```

---

## Errores

Mostrar mensajes entendibles en lugar de errores técnicos crudos.

Ejemplos:

```text
Sesión operativa expirada
Sin conexión con el servidor
El operador ya no tiene permiso
La operación pertenece a otra tienda
Registro legacy sin identidad operativa
```

Puede conservarse internamente el error original para diagnóstico.

Nunca mostrar:

```text
PIN
OperatorSession token
token_hash
credenciales
```

---

## Datos técnicos para admin

Si resulta sencillo, permitir expandir un bloque de diagnóstico únicamente para admin con:

```text
entityType
entityId
retryCount
lastAttemptAt
errorCode
```

Sin secretos.

Esto es opcional para v1.

---

## Reutilizar SyncQueue existente

No crear una segunda fuente de verdad.

El inspector debe leer directamente la información existente en:

```text
SyncQueue
+
entidades locales relacionadas
```

Si falta algún campo como `lastError` o `lastAttemptAt`, añadirlo de forma compatible.

No requiere migración IndexedDB si los nuevos campos no son índices.

---

## Muy importante

Este cambio es **sólo observabilidad**.

No implementar todavía:

- refresh forzado de sesiones;
- push + pull global;
- cambios de auth;
- caché de Cortes;
- WebSockets;
- Realtime;
- reintentos adicionales;
- eliminación manual de pendientes.

No cambiar las reglas actuales que bloquean pendientes de otro operador, cuentas desactivadas, downgrade de rol, etc.

---

## Pruebas mínimas

Verificar:

```text
✓ pendiente normal aparece
✓ pendiente con error muestra motivo
✓ retryCount se refleja
✓ operador correcto se muestra
✓ tienda correcta se muestra
✓ legacy sin operatorAccountId se identifica
✓ pendientes de otro operador no se atribuyen al actual
✓ panel funciona en móvil y desktop
✓ ningún secreto aparece en UI
```

Ejecutar:

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

Después de este cambio, cuando la PWA indique:

```text
4 pendientes
```

debe ser posible abrir el inspector y saber exactamente:

```text
qué son
de quién son
desde qué tienda
cuántas veces se intentaron sincronizar
por qué siguen pendientes
```

Primero necesitamos esa visibilidad; después se diseñará el comportamiento de sincronización forzada.
