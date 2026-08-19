# Compras v1 y Proveedores

## Límite del dominio

Una Compra representa la adquisición comercial de mercancía; no es un Gasto.
Aunque ambos dominios puedan producir una salida de dinero, conservan tablas,
servicios, históricos y conceptos independientes.

```text
Purchase (hecho comercial)
        ↓
PurchasePayment (cómo se liquidó)
        ↓
funding_source (qué caja recibe el efecto)
```

V1 registra una sola liquidación por el monto completo de la Compra. Mantener
`purchases` y `purchase_payments` separados permite agregar posteriormente
crédito, abonos y cuentas por pagar sin cambiar la identidad de la Compra. No
se incluyen artículos, inventario, impuestos detallados, OCR ni datos fiscales.

## Proveedores

`suppliers` requiere únicamente un nombre y conserva auditoría, estado activo y
fechas. La aplicación permite crear, renombrar, activar y desactivar desde
`Ajustes → Proveedores`; nunca elimina históricos al desactivar.

La unicidad normaliza espacios y mayúsculas, de modo que `Bimbo`, `BIMBO` y
` bimbo ` se consideran el mismo nombre. Las Compras guardan tanto
`supplier_id` como `supplier_name_snapshot`: un cambio posterior del catálogo
no altera el histórico.

## Origen del pago

`purchase_payments.funding_source` decide el efecto financiero:

- `central_cash`: requiere conexión. `create_paid_purchase` valida saldo y, en
  la misma transacción, crea Compra, Pago y un `CentralCashMovement` de salida
  con `source_type = purchase` y `source_id = purchase_payment.id`. Si el pago
  es en efectivo y contiene monedas, también crea una entrada de monedas con
  `source_type = purchase_coin_compensation`, relacionada con el mismo Pago.
- `store_cash`: requiere `source_store_id`, se guarda localmente con un UUID
  idempotente y se sincroniza después. No crea movimiento de Caja Central y
  queda disponible para el Corte de esa tienda y fecha.

Para pagos `cash` desde `central_cash`, el desglose de billetes y monedas es
obligatorio y debe coincidir exactamente con el monto. En `store_cash` el
desglose es opcional: cuando no se captura, `purchase_payments.bills` permanece
en `null` y la Compra conserva únicamente su monto financiero; cuando se activa
la captura, el desglose debe coincidir exactamente con el monto. En Caja
Central, las monedas se compensan dentro de la misma transacción y no requieren
saldo previo; los billetes declarados sí deben existir físicamente. Las formas
`transfer`, `card` y `other` no modifican el inventario físico, aunque una
Compra central sí reduce el saldo financiero por el monto completo.

La creación de Compras es administrativa en v1. RLS y la RPC vuelven a validar
el rol, el proveedor, la tienda, el saldo y las denominaciones; ocultar opciones
en React no es una frontera de seguridad.

## Integración con Cortes

Sólo los Pagos `store_cash` de la misma tienda y fecha son candidatos. El
Corte guarda un registro inmutable en `cash_closing_purchase_items`, con
snapshots del proveedor, folio, monto, forma de pago y fecha. La restricción
única sobre `purchase_payment_id` impide usar una Compra en dos Cortes.

Las Compras se muestran separadas de Gastos, Pagos a colaboradores y
Transferencias. `purchases_total` participa en las salidas operativas;
`cash_purchases_total` participa en la reconstrucción física:

```text
gross_cash = counted_cash
           + cash_expenses_total
           + store_cash_payments_total
           + cash_purchases_total

net_cash = gross_cash
         - cash_expenses_total
         - store_cash_payments_total
         - cash_purchases_total
```

Una Compra local pendiente de sincronizar bloquea el cierre. Confirmado el
Corte, sus snapshots son la fuente histórica y el Pago no vuelve a ser
elegible.

## Exportación

El contrato 2.0 se extiende de forma aditiva con `purchases_total`,
`cash_purchases_total`, `purchase_items` y movimientos financieros con
`source_type = purchase`. Los lotes preparados antes de esta migración se
conservan sin reescritura y siguen siendo válidos para el lector compatible.

## Despliegue

La migración `202608170001_purchases.sql` es aditiva y debe revisarse y probarse
en local/dev antes de aplicarse manualmente. No se aplica automáticamente a una
base remota al incluirla en el repositorio.
