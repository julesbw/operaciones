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

Las operaciones administrativas críticas (tiendas, confirmación de pagos y cierre definitivo) requieren conexión. Los cortes incompletos se conservan como borradores locales; la selección de un pago puede prepararse offline, pero nunca se encola como una confirmación pendiente.

## Arranque offline-first

El arranque tiene dos fases independientes:

```text
Local bootstrap                         Remote bootstrap
Dexie + LocalAppContext                 sesión Supabase
        ↓                                      ↓
UI operativa inmediata                  perfil + referencias
                                               ↓
                                         push + pull
```

`loading-local` sólo cubre la apertura de Dexie y la lectura del contexto. Si existe un contexto con acceso offline habilitado, React muestra inmediatamente los datos locales; la restauración de Auth, las referencias y la sincronización continúan en segundo plano. Si el dispositivo nunca fue inicializado, el primer uso sin red muestra una pantalla explícita en lugar de esperar Supabase.

Dexie v9 agrega `appContexts`. El registro `current` conserva únicamente el perfil mínimo para configurar la experiencia local: identificador, nombre, rol, tienda y fechas de autenticación/sincronización. No contiene JWT, credenciales ni permisos remotos. Dexie v10 agrega `payments`, `paymentAttendanceItems` y `compensationHistory`, además de la selección de pagos en los borradores de Corte. Dexie v11 agrega `exportCandidates` y `exportBatches` para consulta cacheada. Estas tablas administrativas se limpian si el perfil autenticado deja de ser administrador.

Una inicialización se considera completa después de obtener el perfil y las referencias autorizadas, verificar el app shell en producción y guardar `LocalAppContext`. El service worker precachea el HTML y descubre los bundles JS/CSS con hash generados por Vite; las respuestas de Supabase no forman parte de esa caché.

## Decisiones de seguridad

- La UI oculta funciones por rol, pero PostgreSQL RLS es la autoridad.
- `profiles`, los roles y `private.is_admin()` pertenecen al backend compartido de Arrendamientos. Operaciones sólo añade `profiles.store_id` y consume esa identidad.
- `collaborator_compensation` está separada de `collaborators`. Una política de filas no puede ocultar sólo `weekly_pay`; separar la compensación evita descargarla al dispositivo de una cajera.
- Operaciones consume los roles del sistema compartido y nunca permite escribirlos desde la PWA. La asignación o promoción de roles debe permanecer en el flujo confiable existente.
- Los históricos referencian UUID; renombrar o desactivar una tienda no rompe relaciones.
- No se eliminan físicamente tiendas, colaboradores ni transferencias desde la aplicación.
- Una cashier puede descargar el catálogo de tiendas activas para elegir un destino y conserva acceso al nombre de su tienda asignada si se desactiva, pero RLS sólo le entrega transferencias cuyo `origin_store_id` coincide con su perfil.
- El perfil guardado en Dexie sólo autoriza la presentación local. Antes de procesar `syncQueue`, `SyncService` exige que el usuario de la sesión Supabase coincida con el propietario del contexto; RLS y las RPC siguen decidiendo cada escritura remota.
- El dispositivo conserva una sola identidad cacheada. Un cambio de usuario limpia datos sincronizados y reconstruye la caché con el nuevo scope. Si existen elementos en `syncQueue` o borradores, el cambio se bloquea y los datos quedan ocultos hasta autenticar a su propietario.
- Cerrar sesión deshabilita el acceso offline automático pero no borra la cola ni los borradores. Una sesión expirada sigue la misma regla y puede reanudarse al autenticar nuevamente al mismo usuario.
- Los salarios actuales sólo pueden modificarse mediante la RPC administrativa que escribe simultáneamente una versión en `collaborator_compensation_history`. Los pagos y sus días sólo admiten lectura directa; la creación ocurre mediante una RPC `security definer` que vuelve a validar permisos y reglas.

## Conflictos y reintentos

Los registros locales mantienen `pending`, `syncing`, `synced` o `error`. La cola usa backoff exponencial con máximo de cinco minutos. Las RPC `sync_expense`, `sync_attendance` y `sync_merchandise_transfer` usan el UUID como clave idempotente, validan tienda/autor en PostgreSQL y rechazan una versión local anterior a la remota.

`SyncService` reutiliza una única promesa mientras hay un proceso activo, por lo que el arranque remoto, el evento `online`, las capturas y el botón manual no ejecutan colas simultáneas. Cuando el navegador declara que no hay red, la cola permanece pendiente sin registrar un intento fallido; si hay red pero Supabase no responde, el error de cada request se conserva como error remoto.

La primera versión no resuelve silenciosamente conflictos administrativos. La restricción de asistencia por `collaborator_id + attendance_date` existe en Dexie y PostgreSQL.

## Pagos por asistencias

`pay_cycle_end_weekday` pertenece al colaborador y define el final de su periodo individual. La migración no completa este campo para registros existentes: hasta que un administrador lo configure, la UI y `confirm_collaborator_payment` bloquean el pago. Para altas nuevas, un trigger y la nueva firma de `create_collaborator` lo exigen explícitamente.

La vista Pagos se construye desde Dexie con colaboradores, todas las asistencias históricas, pagos, días cubiertos y salarios efectivos. Los periodos y sus estados son derivados; no existe una semana global. Sólo una asistencia `present` con fecha no futura puede seleccionarse. La fecha operacional se calcula siempre en `America/Mexico_City`, tanto en React como en PostgreSQL.

El monto diario es `floor(weeklyPay / 6)`. Un periodo terminado con seis días tiene como objetivo exacto `weeklyPay`; el resto usa `dailyPay × workedDays`. Las parcialidades guardan `suggested_allocation` por asistencia. Cuando una selección cubre todos los días todavía pendientes, el sugerido se calcula como objetivo del periodo menos lo ya asignado, absorbiendo el residuo semanal. El monto realmente pagado permanece separado y puede ser decidido por administración.

`collaborator_compensation_history` conserva versiones efectivas por fecha. La migración siembra la compensación actual y los snapshots salariales disponibles en `weekly_payments`; no inventa versiones ausentes. Un periodo que ya recibió una parcialidad reutiliza siempre sus snapshots; uno sin pagos toma la versión efectiva al cierre del periodo, o a la fecha actual si sigue abierto. Por ello un cambio salarial posterior no recalcula deuda histórica ni parcialidades previas.

Confirmar es online-required. El cliente genera `payment_id`, sincroniza asistencias, refresca el cache y revalida la selección antes de invocar `confirm_collaborator_payment`. La RPC toma bloqueos por UUID y colaborador, vuelve a calcular periodos/sugerencias y no recibe `suggested_amount` del cliente. `UNIQUE(attendance_id)` impide pagar el mismo día dos veces; un trigger vuelve inmutable toda asistencia pagada. Repetir la RPC con el mismo UUID devuelve el pago ya confirmado.

`weekly_payments` se conserva únicamente para compatibilidad histórica. Su RPC queda sin permiso de ejecución y ningún pago nuevo genera un registro en `expenses`; `collaborator_payments` es la única fuente de verdad nueva. El nombre remoto evita colisionar con `public.payments`, que pertenece a Arrendamientos en el proyecto Supabase compartido; Dexie mantiene `payments` como almacén local del módulo.

## Contexto de tienda en asistencias

El filtro de Asistencias se conserva en `App` mientras dura la sesión de navegación. Para administración puede valer `all` o el UUID de una tienda; para cashier la página ignora cualquier filtro visual y deriva siempre la tienda desde `profile.store_id`.

La vista global consulta Dexie por fecha y agrupa colaboradores por tienda. Al refrescar referencias desde Supabase se reemplaza la caché de tiendas y colaboradores con el conjunto autorizado por RLS, evitando que una sesión cashier conserve perfiles de otras tiendas descargados por una sesión anterior.

## Transferencias de mercancía

Dexie v6 añade `merchandiseTransfers`, indexada por origen/fecha, destino/fecha y ticket. El origen de una cashier siempre se deriva de `profile.store_id`; para administración el scope puede ser `all` o una tienda. El ticket permanece como texto, los totales se acumulan en centavos y `businessDate` se valida con la zona operativa `America/Mexico_City`.

La migración `202608120001_merchandise_transfers.sql` crea los mismos índices en PostgreSQL. La RPC requiere que ambas tiendas estén activas al insertar, impide fechas futuras con `America/Mexico_City` y permite retries idempotentes. Una cashier no puede corregir históricos; una corrección administrativa futura debe usar la misma RPC versionada.

Para Cortes, una transferencia saliente se consulta por `origin_store_id + business_date` y suma a salidas operativas. No se suma a salidas físicas de efectivo y el MVP no contiene artículos, cantidades ni movimientos de inventario.

## Corte de caja guiado

La sección abre en un historial que combina cortes cerrados de Supabase con borradores locales de Dexie. Crear es una acción explícita; sólo entonces se inicia el flujo de cuatro fases. Cada cambio se persiste en `closingDrafts` y existe como máximo un borrador local por tienda/fecha para evitar flujos accidentales duplicados.

El Resumen consulta por RPC los gastos, transferencias salientes y pagos desde caja elegibles de la tienda/fecha. Los IDs seleccionados y conocidos viven en el borrador, pero no reservan movimientos. Todos se seleccionan inicialmente; una exclusión se conserva y los movimientos nuevos se seleccionan al refrescar. `operationalOutflowsTotal` incluye gastos, transferencias y pagos `store_cash`; `cashOutflowsTotal` incluye gastos pagados en efectivo y pagos `store_cash`. Los pagos `central_cash` nunca son candidatos.

Antes de cerrar, la PWA procesa la cola y bloquea la confirmación si un movimiento seleccionado sigue sin sincronizar. La RPC `close_cash_closing` valida los IDs, recalcula los totales en PostgreSQL y crea `cash_closing_expense_items`, `cash_closing_transfer_items` y `cash_closing_payment_items` con snapshots. Las restricciones `UNIQUE(expense_id)`, `UNIQUE(transfer_id)` y `UNIQUE(payment_id)` impiden reutilización incluso entre clientes concurrentes. La elegibilidad de un pago se determina exclusivamente por `source_store_id + payment.business_date`.

Puede haber varios cortes cerrados para la misma tienda y fecha. Bajo un bloqueo transaccional por ese par, PostgreSQL asigna `closing_number = max + 1`; la unicidad real es `store_id + business_date + closing_number`. Cerrar un corte inmoviliza únicamente sus movimientos asociados y no impide registrar otros o crear un nuevo corte el mismo día.

El saldo también se captura por denominación en `balanceBills`. `withdrawBills` se deriva restando cada valor a `bills`; ninguna denominación del saldo puede superar la cantidad contada. Dexie v5 conserva borradores anteriores representando su saldo monetario histórico dentro de `monedas`, ya que esos borradores no contenían una composición verificable de billetes.

## Exportación de Cortes

Exportación es un flujo administrativo online-first para sus transiciones y
offline-readable para datos previamente cacheados. La preparación recibe IDs de
Cortes, pero toda regla financiera se vuelve a evaluar dentro de PostgreSQL. El
cliente descarga directamente el `payload_snapshot`; no construye ni recalcula
el contrato.

```text
Cortes cerrados + relaciones snapshot
                 ↓ prepare_export_batch
        export_batches(prepared)
                 ↓
       JSON 2.0 descargable
          ↙              ↘
     cancelled         confirmed
   libera Cortes     conserva reserva
```

Una restricción parcial sobre `export_batch_items.cash_closing_id` impide que un
Corte esté reservado o confirmado en más de un lote. Cancelar cambia el item a
`released`, conservando auditoría y recuperando elegibilidad. Confirmar o
cancelar repetidamente es idempotente en su estado terminal válido.

El efecto financiero y el físico están desacoplados. La rama financiera usa
una entrada por el efectivo bruto reconstruido y salidas individuales sólo para
gastos en efectivo y pagos `store_cash`. La rama física contiene una única
composición por Corte: total de billetes, conteos y monto de monedas. Consulta
[`EXPORTS_V2.md`](EXPORTS_V2.md) para el contrato completo.
