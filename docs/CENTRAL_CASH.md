# Caja Central v1

## Concepto

Caja Central es la fuente de verdad del efectivo que ya fue recibido físicamente
por administración. Un Corte cerrado sólo expresa cuánto debe salir de una
tienda; no cambia el saldo central hasta que se confirma su recepción.

```text
CashClosing (closed)
        ↓ confirmación online
CentralCashReceipt
        ↓ misma transacción
CentralCashMovement (inflow)
        ↓
saldo derivado del ledger
```

Los Cortes pendientes no forman parte del saldo. Exportación y Caja Central son
dominios independientes: un Corte puede estar exportado y seguir pendiente de
recepción, o ser recibido antes de exportarse.

## Entidades

`central_cash_receipts` registra el evento físico e inmutable. Conserva el Corte
único, monto, fecha operativa, denominaciones, monedas, tienda y número de Corte,
además de quién y cuándo recibió. `UNIQUE(cash_closing_id)` es la protección
autoritativa contra una segunda recepción.

`central_cash_movements` es el ledger financiero y físico. Todos los importes son
positivos y `movement_type` (`inflow`/`outflow`) determina la dirección. Cada fila
conserva seis cantidades de billetes, el monto agregado de monedas, autor y
snapshots suficientes para leer el historial aunque cambien nombres externos.
Los movimientos confirmados no se actualizan ni eliminan; una corrección se
registra con un ajuste compensatorio.

`source_type` admite actualmente `cash_closing`, `manual_adjustment` y
`purchase`. La misma estructura reserva `expense`, `collaborator_payment`,
`bank_deposit` y `other` para integraciones futuras sin rediseñar el ledger.

## Saldo y efectivo físico

El saldo no es una columna editable:

```text
balance = SUM(inflow.amount) - SUM(outflow.amount)
```

El inventario de cada billete y el monto agregado de monedas se derivan con el
mismo signo. Para toda recepción o ajuste se exige:

```text
SUM(cantidad de billetes × denominación) + coins_amount = amount
```

Un saldo inicial se crea como un movimiento `manual_adjustment/inflow`, nunca
como una edición especial del saldo.

## Autoridad, atomicidad e idempotencia

Las RPC públicas son:

- `get_central_cash_summary()`
- `list_pending_central_cash_closings(...)`
- `receive_cash_closing_into_central_cash(...)`
- `create_central_cash_adjustment(...)`
- `create_paid_purchase(...)`

Todas vuelven a validar `private.is_admin()`. Las tablas sólo conceden `SELECT` a
usuarios autenticados y RLS limita incluso esa lectura a administración; no hay
permisos directos de inserción, actualización ni eliminación.

La recepción bloquea y consulta el Corte autoritativo, valida `status = closed`,
usa `cash_to_withdraw` y `withdraw_bills`, crea receipt y movement en una sola
transacción y conserva `business_date` separado de `received_at`. El cliente
genera y reutiliza `p_receipt_id`; un retry con el mismo UUID devuelve el mismo
resultado. Una recepción concurrente con otro UUID se rechaza como
`CENTRAL_CASH_CLOSING_ALREADY_RECEIVED`.

Los ajustes siguen el mismo patrón con `p_movement_id`. Las salidas también
comprueban saldo y denominaciones disponibles bajo el bloqueo del ledger.

## Offline-first

Dexie v12 agrega `centralCashSummary`, `centralCashMovements` y
`centralCashPendingClosings`. La UI puede leer el último snapshot sin conexión,
pero nunca encola recepciones ni ajustes. Ambas operaciones requieren la RPC
online y, después de confirmar, se vuelven a consultar saldo, movimientos y
pendientes.

La caché administrativa se elimina si la identidad autenticada deja de ser
admin o cambia de usuario. La presentación offline no sustituye Auth, RLS ni las
validaciones de PostgreSQL.

## Compras

Una Compra pagada con `funding_source = central_cash` crea su salida mediante
`create_paid_purchase`. La RPC bloquea el ledger, comprueba saldo y, si el pago
es en efectivo, valida además que existan las denominaciones físicas. Compra,
Pago y movimiento se crean en una misma transacción idempotente. Consulta
[`PURCHASES.md`](PURCHASES.md).

## Integraciones posteriores

- Gastos centrales usarán `source_type = expense`.
- Pagos a colaboradores con `funding_source = central_cash` usarán
  `source_type = collaborator_payment`.
- Depósitos bancarios se modelarán como salidas del ledger.
- Las discrepancias físicas de una recepción requerirán un flujo explícito; v1
  no modifica silenciosamente un Corte cerrado.

Estas integraciones quedan fuera de v1 y no alteran Exportación v2.
