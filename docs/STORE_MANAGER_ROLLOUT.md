# Rollout de capacidades de `store_manager`

Este cambio debe desplegarse como una unidad: primero preparar los datos, después aplicar manualmente la migración `202608210001_store_manager_capabilities.sql` y enseguida publicar el frontend compatible. La migración no se aplica automáticamente desde este repositorio.

## Antes de la migración

1. Detener temporalmente nuevas operaciones en terminales de tienda.
2. Con cada identidad operativa original, sincronizar todas las colas pendientes que ya tengan `operatorAccountId`.
3. Usar una sesión técnica admin para sincronizar el trabajo legacy que todavía tenga `operatorAccountId = null`; esto conserva su autor técnico sin inventar un AppAccount.
4. Confirmar que no queden borradores de Corte o elementos de cola sin atribución operativa. No reasignarlos al operador que esté activo durante el rollout.
5. Respaldar y registrar los conteos pendientes por dispositivo antes de continuar.

Si queda un elemento residual sin atribución, el cliente nuevo lo conserva pendiente con el mensaje `Existe un cambio anterior sin identidad operativa. Debe revisarse antes de sincronizar.` No se borra ni se envía mediante un bypass.

## Despliegue

1. Aplicar manualmente `supabase/migrations/202608210001_store_manager_capabilities.sql` en el entorno objetivo.
2. Publicar inmediatamente el frontend de la misma versión.
3. No ampliar las políticas RLS de Compras, Cortes ni Proveedores. Sus accesos operativos pasan exclusivamente por RPCs `SECURITY DEFINER` con validación server-side.
4. Reactivar las terminales y obligar a validar de nuevo la AppSession operativa.

## Verificación mínima

- `cashier`: Gastos de Caja de Tienda, Asistencia y Transferencias de su tienda; sin Compras ni Cortes.
- `store_manager`: lo anterior más Compras pagadas desde Caja de Tienda y Cortes únicamente de su tienda.
- `store_manager`: sin Caja Central, Pagos a colaboradores, Exportaciones, configuración administrativa ni ajustes posteriores del Corte.
- `admin`: conserva los flujos globales existentes.
- Una AppSession revocada/expirada, una cuenta desactivada o un cambio de tienda bloquea la operación en backend y conserva el pendiente local.
- Reintentar una Compra o Corte con otra AppSession del mismo AppAccount es idempotente; hacerlo con otro AppAccount produce conflicto.
- Un `operatorAccountId = null` residual nunca se atribuye al operador activo.

## Firmas de Corte esperadas

Después de la migración, `authenticated` sólo conserva `EXECUTE` sobre estas firmas de `close_cash_closing`:

- 12 argumentos: flujo vigente admin-only.
- 13 argumentos: flujo protegido por token para admin o `store_manager` autorizado.

Las firmas históricas de 7, 9, 10 y 11 argumentos permanecen revocadas. La migración revoca primero por firma exacta también las de 12 y 13 argumentos y luego concede únicamente las dos firmas vigentes anteriores.

## Reversión operativa

Si la publicación del frontend falla después de aplicar la migración, mantener detenidas las terminales de tienda o limitar la operación a admin hasta publicar un cliente compatible. No restaurar permisos de los overloads históricos: hacerlo reabriría el bypass que este cambio elimina.
