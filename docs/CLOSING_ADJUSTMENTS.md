# Ajustes de Cortes cerrados

Los ajustes corrigen errores detectados después del cierre sin modificar
`cash_closings`. El Corte original conserva sus snapshots y sus valores
históricos; el estado actual se deriva como:

```text
Corte original + cash_closing_adjustments = estado efectivo
```

## Elegibilidad

La RPC `create_cash_closing_adjustment` vuelve a comprobar todas las
condiciones dentro de la misma transacción:

- el usuario es administrador;
- el Corte existe y está `closed`;
- no existe `central_cash_receipt`;
- no pertenece a un batch `prepared`;
- no pertenece a un batch `confirmed`;
- el monto es positivo y las denominaciones coinciden;
- el resultado efectivo no tiene denominaciones negativas y conserva la
  reconciliación física.

Un batch `cancelled` libera el Corte porque sus items pasan a `released`.
Un batch `confirmed` representa una exportación correcta y bloquea el Corte
permanentemente. La recepción en Caja Central también lo bloquea
permanentemente.

## Historial append-only

`cash_closing_adjustments` sólo concede lectura directa. La creación se hace
por RPC con un UUID generado por el cliente, por lo que repetir la misma
solicitud devuelve el mismo ajuste. Los ajustes no se actualizan ni eliminan.
Una corrección posterior se registra con un movimiento compensatorio.

Los montos son positivos; `type` (`inflow` u `outflow`) determina el signo.
Cada ajuste conserva billetes, monedas, concepto, notas, autor y fecha.

## Valores efectivos

```text
adjustments_net = entradas - salidas
effective_counted_cash = counted_cash + adjustments_net
effective_cash_to_withdraw = cash_to_withdraw + adjustments_net
```

Las denominaciones efectivas se calculan sumando o restando las
denominaciones de cada ajuste. Ni Exportación ni Caja Central sobrescriben
`counted_cash`, `cash_to_withdraw` o `withdraw_bills`.

## Exportación

El contrato 2.0 conserva compatibilidad aditiva. Los Cortes ajustados incluyen
opcionalmente `closing_adjustments`, `adjustments_net`,
`effective_counted_cash` y `effective_cash_to_withdraw`. Cada ajuste también
aparece explícitamente como movimiento `source_type = closing_adjustment`.

Los archivos 2.0 históricos que no contienen esos campos siguen siendo
válidos. La migración no modifica lotes ya preparados.

## Caja Central

Las consultas de pendientes, el resumen y la recepción utilizan el monto y
las denominaciones efectivos. La recepción conserva esos valores corregidos
en `central_cash_receipts` y en el movimiento del ledger.

## Offline

Los ajustes descargados se guardan en Dexie v14 para consulta offline. Crear
ajustes, preparar/confirmar/cancelar exportaciones y recibir efectivo siguen
requiriendo conexión.

La migración `202608180001_closing_adjustments.sql` sólo se añade al
repositorio. Debe revisarse, probarse y aplicarse manualmente; no se aplica a
producción automáticamente.
