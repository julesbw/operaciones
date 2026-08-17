# Exportación de Operaciones 2.0

## Alcance

La primera versión exporta exclusivamente Cortes con `status = closed`. Un
lote puede contener varios Cortes, pero cada Corte se prepara como una unidad
atómica con sus snapshots históricos de gastos, pagos, transferencias y
efectivo físico.

El contrato se identifica con:

```json
{
  "version": "2.0",
  "origen": "operaciones_pwa",
  "tipo_exportacion": "cash_closings"
}
```

Este contrato no reemplaza al contrato `1.0` con origen
`contador_mobile_pwa`. El importador actual del Add-in continúa intacto y debe
incorporar `2.0` posteriormente como una ruta de validación y mapeo separada.

## Dos efectos independientes

Cada Corte contiene dos estructuras con responsabilidades distintas:

```text
financial_movements              physical_cash
entrada gross_cash               amount
salidas de gastos en efectivo    bills_total
salidas de pagos store_cash      bills
                                  coins_amount
```

`financial_movements` explica cómo se llega al efectivo neto. Las salidas
pueden provenir de gastos, pagos `store_cash` o Compras en efectivo;
`physical_cash`
representa una sola incorporación física al control central. El consumidor no
debe aplicar gastos o pagos nuevamente sobre las denominaciones.

## Identidades monetarias

El servidor calcula y valida con los snapshots del Corte:

```text
gross_cash = counted_cash
           + cash_expenses_total_snapshot
           + store_cash_payments_total_snapshot
           + cash_purchases_total_snapshot

gross_cash
- SUM(movimientos de gastos en efectivo)
- SUM(movimientos de pagos store_cash)
- SUM(movimientos de Compras en efectivo)
= net_cash

net_cash - cash_balance = physical_cash.amount = cash_to_withdraw

physical_cash.bills_total + physical_cash.coins_amount
= physical_cash.amount
```

`bills_total` incluye únicamente las denominaciones de billetes de 1000, 500,
200, 100, 50 y 20. `coins_amount` es un monto monetario independiente. Las
monedas siempre viajan en el contrato aunque el Add-in actual todavía no tenga
una celda o columna donde aplicarlas.

## Forma de un Corte

```json
{
  "id": "uuid",
  "store_id": "uuid",
  "store_name": "Tienda 1",
  "business_date": "2026-08-14",
  "sequence_number": 2,
  "gross_cash": 12780,
  "expenses_total": 500,
  "cash_expenses_total": 500,
  "store_cash_payments_total": 1000,
  "purchases_total": 1280,
  "cash_purchases_total": 1280,
  "net_cash": 10000,
  "cash_balance": 2000,
  "physical_cash_amount": 8000,
  "transfers_total": 2500,
  "expense_items": [],
  "payment_items": [],
  "purchase_items": [],
  "transfer_items": [],
  "financial_movements": [
    {
      "id": "uuid-del-corte",
      "source_type": "cash_closing",
      "source_id": "uuid-del-corte",
      "tipo": "entrada",
      "fecha_movimiento": "2026-08-14",
      "monto": 12780,
      "concepto": "Efectivo del día - Tienda 1 - Corte #2",
      "categoria": "Corte de caja",
      "store_id": "uuid"
    },
    {
      "id": "uuid-del-pago-compra",
      "source_type": "purchase",
      "source_id": "uuid-del-pago-compra",
      "tipo": "salida",
      "fecha_movimiento": "2026-08-14",
      "monto": 1280,
      "concepto": "Compra Bimbo",
      "categoria": "Compra",
      "store_id": "uuid"
    }
  ],
  "physical_cash": {
    "amount": 8000,
    "bills_total": 7950,
    "bills": {
      "b1000": 7,
      "b500": 1,
      "b200": 2,
      "b100": 0,
      "b50": 1,
      "b20": 0
    },
    "coins_amount": 50
  },
  "closed_at": "2026-08-14T17:45:00Z"
}
```

`expense_items` conserva todos los gastos históricos del Corte. Sólo los que
tienen `affects_cash = true` generan una salida financiera.
`payment_items` usa exclusivamente el `amount_snapshot` capturado desde
`paid_amount`. `purchase_items` conserva el proveedor, folio, forma de pago y
monto congelados; sólo las Compras en efectivo generan una salida financiera.
`transfer_items` es información operativa y nunca aparece como movimiento
financiero.

Los campos de Compras son una extensión aditiva. Un snapshot preparado antes de
`202608170001_purchases.sql` puede no contenerlos; el validador los interpreta
como totales cero y una lista vacía. Los lotes ya preparados nunca se reescriben.

## Ciclo de vida e idempotencia

```text
prepared  --confirm_export_batch--> confirmed
    |
    +-----cancel_export_batch-----> cancelled
```

- `prepare_export_batch` valida, crea el snapshot y reserva los Cortes.
- Descargar o regenerar el archivo no cambia el estado.
- Confirmar conserva las reservas como fuentes ya representadas.
- Cancelar conserva el historial pero libera los Cortes.
- Confirmar un lote confirmado y cancelar uno cancelado devuelven el mismo
  resultado sin una segunda transición.
- Reintentar la preparación con el mismo `batch_id` y la misma selección
  devuelve el snapshot existente.

El nombre de la tienda se congela en `cash_closings.store_name_snapshot` al
crear el Corte. La preparación utiliza únicamente `cash_closings` y las tablas
históricas `cash_closing_*_items`; nunca consulta las entidades vivas de
gastos, pagos, transferencias o colaboradores.

## Seguridad y operación

`export_batches` y `export_batch_items` tienen RLS de lectura exclusiva para
administración. Las mutaciones directas no se conceden a `authenticated`; las
RPC `security definer` vuelven a comprobar `private.is_admin()`.

La pantalla puede leer candidatos e historial guardados en Dexie sin conexión.
Preparar, confirmar y cancelar siempre requieren Supabase disponible.

## Despliegue

La migración
`supabase/migrations/202608140001_operations_export_batches.sql` debe revisarse
y aplicarse manualmente después de `202608130003_payments_module.sql`. Añadirla
al repositorio o generar un archivo JSON no aplica cambios a una base remota.

La extensión de Compras vive en
`supabase/migrations/202608170001_purchases.sql` y debe aplicarse después de
`202608160001_central_cash.sql`. Mantiene legibles los snapshots 2.0 anteriores.

Antes de habilitar el módulo en producción:

1. Aplicar las migraciones previas en orden.
2. Revisar y aplicar manualmente la migración de Exportación.
3. Preparar un lote de prueba y comparar el `payload_snapshot` con los
   snapshots del Corte.
4. No confirmar lotes hasta que el Add-in soporte el contrato `2.0` o exista
   otro consumidor autorizado.
