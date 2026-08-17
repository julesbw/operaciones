# La Piedad Operaciones

PWA local-first para gastos, transferencias de mercancía, asistencias, pagos a colaboradores y cortes de caja de las tiendas.

## Desarrollo

Requiere Node.js 22.12 o 24+.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Sin variables de Supabase la aplicación inicia en modo demostración, con perfiles de cajera y administración. Los datos se guardan en la base IndexedDB `operaciones-db`.

Después de una inicialización online completa, la PWA puede arrancar desde cero sin conexión. El contexto local permite presentar el perfil y los datos cacheados, pero Supabase Auth, RLS y las RPC siguen siendo la única autoridad para sincronizar y para operaciones definitivas como cerrar un corte. El primer uso del dispositivo siempre requiere conexión.

Conecta el mismo proyecto de Arrendamientos usando únicamente credenciales públicas:

```env
VITE_SUPABASE_URL=https://TU-PROYECTO.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=TU_LLAVE_PUBLISHABLE
```

`VITE_SUPABASE_ANON_KEY` continúa aceptándose temporalmente como alternativa. Nunca incluyas `service_role`.

## Supabase

1. Aplica primero las migraciones existentes de Arrendamientos; proporcionan `profiles`, roles, `private.is_admin()` y el trigger compartido de auditoría.
2. Revisa y aplica [`supabase/migrations/202608060001_initial_operations.sql`](supabase/migrations/202608060001_initial_operations.sql). La migración crea `stores`, añade `profiles.store_id` y agrega únicamente las entidades de Operaciones.
3. Aplica las migraciones posteriores de Operaciones en orden; `202608070001_collaborator_management.sql` habilita el alta atómica de colaboradores, `202608100001_cash_closing_flow.sql` añade los campos financieros del corte guiado y `202608100002_cash_balance_denominations.sql` conserva el desglose de saldo y retiro.
4. Revisa antes de aplicar [`supabase/migrations/202608120001_merchandise_transfers.sql`](supabase/migrations/202608120001_merchandise_transfers.sql). Crea las transferencias, su RPC idempotente y RLS; además permite a las cajeras leer los nombres de todas las tiendas activas para elegir un destino, sin ampliar su acceso a movimientos.
5. Aplica [`supabase/migrations/202608130001_cash_closing_operational_outflows.sql`](supabase/migrations/202608130001_cash_closing_operational_outflows.sql). Agrega snapshots de salidas, la relación histórica con transferencias y la RPC autoritativa de cierre; desde esta migración los cierres ya no se escriben directamente desde el cliente.
6. Aplica [`supabase/migrations/202608130002_cash_closing_selection_history.sql`](supabase/migrations/202608130002_cash_closing_selection_history.sql). Sustituye el cierre automático por selección explícita, permite varios cortes diarios con consecutivo por tienda/fecha y garantiza que cada gasto o transferencia sólo pertenezca a un corte.
7. Revisa antes de aplicar [`supabase/migrations/202608130003_payments_module.sql`](supabase/migrations/202608130003_payments_module.sql). Es una migración aditiva: conserva `weekly_payments`, revoca su RPC de creación, incorpora historial salarial efectivo, pagos por asistencia, protecciones de concurrencia y la selección de pagos `store_cash` dentro de Cortes. No genera gastos duplicados. Esta migración se entrega pendiente de aplicación remota.
8. Revisa antes de aplicar [`supabase/migrations/202608140001_operations_export_batches.sql`](supabase/migrations/202608140001_operations_export_batches.sql). Añade el contrato `2.0`, snapshots de lotes, reservas de Cortes y RPC administrativas idempotentes. La migración se entrega sin aplicar a ninguna base remota.
9. Revisa antes de aplicar [`supabase/migrations/202608160001_central_cash.sql`](supabase/migrations/202608160001_central_cash.sql). Crea el ledger y las recepciones inmutables de Caja Central, más RPCs administrativas atómicas e idempotentes. La migración se entrega sin aplicar a ninguna base remota.
10. Adapta y ejecuta [`supabase/setup-operations.example.sql`](supabase/setup-operations.example.sql) para crear tiendas y asignar cada cajera.
11. Configura `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` en `.env.local`.
12. Verifica que cada perfil `cashier` tenga `store_id`; una cajera sin tienda no tendrá acceso a datos operativos por RLS.

Las migraciones no reemplazan el trigger de usuarios, no cambian roles y no modifican las tablas financieras de Arrendamientos.

## Verificación

```bash
npm test
npm run lint
npm run build
```

La explicación de capas, sincronización y decisiones de seguridad está en [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Caja Central se documenta en [`docs/CENTRAL_CASH.md`](docs/CENTRAL_CASH.md). El contrato y flujo de lotes se documentan en [`docs/EXPORTS_V2.md`](docs/EXPORTS_V2.md). La paleta, tipografía y reglas de marca están en [`docs/VISUAL_IDENTITY.md`](docs/VISUAL_IDENTITY.md).
