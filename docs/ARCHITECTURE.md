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
- No se eliminan físicamente tiendas ni colaboradores desde la aplicación.

## Conflictos y reintentos

Los registros locales mantienen `pending`, `syncing`, `synced` o `error`. La cola usa backoff exponencial con máximo de cinco minutos. Las RPC `sync_expense` y `sync_attendance` usan el UUID como clave idempotente, validan tienda/autor en PostgreSQL y rechazan una versión local anterior a la remota.

La primera versión no resuelve silenciosamente conflictos administrativos. La restricción de asistencia por `collaborator_id + attendance_date` existe en Dexie y PostgreSQL.

## Contexto de tienda en asistencias

El filtro de Asistencias se conserva en `App` mientras dura la sesión de navegación. Para administración puede valer `all` o el UUID de una tienda; para cashier la página ignora cualquier filtro visual y deriva siempre la tienda desde `profile.store_id`.

La vista global consulta Dexie por fecha y agrupa colaboradores por tienda. Al refrescar referencias desde Supabase se reemplaza la caché de tiendas y colaboradores con el conjunto autorizado por RLS, evitando que una sesión cashier conserve perfiles de otras tiendas descargados por una sesión anterior.
