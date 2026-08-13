# Arquitectura de Operaciones

## Capas

```text
React pages/components
        ↓
Domain services
        ↓
OperationsRepository
        ↓
Dexie (operaciones-db)
        ↓
SyncService
        ↓
Supabase + PostgreSQL RLS
```

La captura cotidiana escribe primero en Dexie y actualiza la interfaz sin esperar la red. Cada escritura sincronizable crea, en la misma transacción local, un elemento idempotente en `syncQueue`. Los UUID se generan en el cliente y son los mismos en PostgreSQL.

Las operaciones administrativas críticas (tiendas y cierre definitivo) requieren conexión. Los cortes incompletos se conservan como borradores locales.

## Decisiones de seguridad

- La UI oculta funciones por rol, pero PostgreSQL RLS es la autoridad.
- `profiles`, los roles y `private.is_admin()` pertenecen al backend compartido de Arrendamientos. Operaciones sólo añade `profiles.store_id` y consume esa identidad.
- `collaborator_compensation` está separada de `collaborators`. Una política de filas no puede ocultar sólo `weekly_pay`; separar la compensación evita descargarla al dispositivo de una cajera.
- Operaciones consume los roles del sistema compartido y nunca permite escribirlos desde la PWA. La asignación o promoción de roles debe permanecer en el flujo confiable existente.
- Los históricos referencian UUID; renombrar o desactivar una tienda no rompe relaciones.
- No se eliminan físicamente tiendas, colaboradores ni transferencias desde la aplicación.
- Una cashier puede descargar el catálogo de tiendas activas para elegir un destino y conserva acceso al nombre de su tienda asignada si se desactiva, pero RLS sólo le entrega transferencias cuyo `origin_store_id` coincide con su perfil.

## Conflictos y reintentos

Los registros locales mantienen `pending`, `syncing`, `synced` o `error`. La cola usa backoff exponencial con máximo de cinco minutos. Las RPC `sync_expense`, `sync_attendance` y `sync_merchandise_transfer` usan el UUID como clave idempotente, validan tienda/autor en PostgreSQL y rechazan una versión local anterior a la remota.

La primera versión no resuelve silenciosamente conflictos administrativos. La restricción de asistencia por `collaborator_id + attendance_date` existe en Dexie y PostgreSQL.

## Contexto de tienda en asistencias

El filtro de Asistencias se conserva en `App` mientras dura la sesión de navegación. Para administración puede valer `all` o el UUID de una tienda; para cashier la página ignora cualquier filtro visual y deriva siempre la tienda desde `profile.store_id`.

La vista global consulta Dexie por fecha y agrupa colaboradores por tienda. Al refrescar referencias desde Supabase se reemplaza la caché de tiendas y colaboradores con el conjunto autorizado por RLS, evitando que una sesión cashier conserve perfiles de otras tiendas descargados por una sesión anterior.

## Transferencias de mercancía

Dexie v6 añade `merchandiseTransfers`, indexada por origen/fecha, destino/fecha y ticket. El origen de una cashier siempre se deriva de `profile.store_id`; para administración el scope puede ser `all` o una tienda. El ticket permanece como texto, los totales se acumulan en centavos y `businessDate` se valida con la zona operativa `America/Mexico_City`.

La migración `202608120001_merchandise_transfers.sql` crea los mismos índices en PostgreSQL. La RPC requiere que ambas tiendas estén activas al insertar, impide fechas futuras con `America/Mexico_City` y permite retries idempotentes. Una cashier no puede corregir históricos; una corrección administrativa futura debe usar la misma RPC versionada.

Para Cortes, una transferencia saliente se consulta por `origin_store_id + business_date` y suma a salidas operativas. No se suma a salidas físicas de efectivo y el MVP no contiene artículos, cantidades ni movimientos de inventario.

## Corte de caja guiado

El corte se captura en cuatro fases y cada cambio se persiste inmediatamente en `closingDrafts`. Dexie v4 transforma borradores anteriores: el antiguo `openingBalance` se conserva como `cashBalance` y se eliminan los campos que ya no forman parte del flujo.

Los gastos y las transferencias salientes se consultan por tienda y fecha, sin copiarlos en el borrador. `operationalOutflowsTotal` incluye gastos, transferencias y el espacio reservado para pagos; `cashOutflowsTotal` incluye únicamente salidas físicas de efectivo. Por eso una transferencia afecta la comparación operativa con el POS, pero no `expectedCash` ni la reconstrucción del efectivo bruto.

Antes de cerrar, la PWA procesa la cola y bloquea la confirmación si quedan gastos o transferencias del día sin sincronizar. La RPC `close_cash_closing` vuelve a calcular ambos totales en PostgreSQL, crea sus snapshots y relaciona cada transferencia mediante `cash_closing_transfer_items`. Un bloqueo transaccional serializa movimientos y cierre para evitar omisiones concurrentes; después del cierre, los movimientos de esa tienda y fecha quedan inmutables.

El saldo también se captura por denominación en `balanceBills`. `withdrawBills` se deriva restando cada valor a `bills`; ninguna denominación del saldo puede superar la cantidad contada. Dexie v5 conserva borradores anteriores representando su saldo monetario histórico dentro de `monedas`, ya que esos borradores no contenían una composición verificable de billetes.
