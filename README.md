# La Piedad Operaciones

PWA local-first para gastos, asistencias y cortes de caja de las tiendas.

## Desarrollo

Requiere Node.js 22.12 o 24+.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Sin variables de Supabase la aplicación inicia en modo demostración, con perfiles de cajera y administración. Los datos se guardan en la base IndexedDB `operaciones-db`.

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
4. Adapta y ejecuta [`supabase/setup-operations.example.sql`](supabase/setup-operations.example.sql) para crear tiendas y asignar cada cajera.
5. Configura `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` en `.env.local`.
6. Verifica que cada perfil `cashier` tenga `store_id`; una cajera sin tienda no tendrá acceso a datos operativos por RLS.

La migración no reemplaza el trigger de usuarios, no cambia roles y no modifica las tablas financieras de Arrendamientos.

## Verificación

```bash
npm test
npm run lint
npm run build
```

La explicación de capas, sincronización y decisiones de seguridad está en [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). La paleta, tipografía y reglas de marca están en [`docs/VISUAL_IDENTITY.md`](docs/VISUAL_IDENTITY.md).
