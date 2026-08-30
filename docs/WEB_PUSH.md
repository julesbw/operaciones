# Web Push de Operaciones

Web Push es un canal secundario para los administradores de Operaciones. La
fuente de verdad sigue siendo `notifications` y
`notification_recipients`; `notification_deliveries` sólo registra el intento
de entrega. Un error de Push nunca cambia `read_at`.

## Componentes

- `202608290003_web_push.sql` crea suscripciones, entregas, RPCs protegidas y
  la proyección idempotente desde destinatarios administrativos.
- `supabase/functions/deliver-web-push` es el único emisor. Carga la entrega y
  sus referencias desde Supabase, construye un payload breve y envía mediante
  VAPID.
- `public/sw.js` recibe sólo eventos de `operaciones` y abre Compras,
  Transferencias o Cortes mediante la navegación existente.
- La pestaña `Sistema` permite activar o desactivar únicamente el dispositivo
  actual y sólo para un administrador autenticado.

## Configuración por ambiente

Confirma primero el origen HTTPS canónico de Operaciones. La suscripción queda
ligada al origen y a `/sw.js`; cambiar de dominio requiere volver a suscribir
los dispositivos. Verifica también que el worker activo tenga scope `/` y que
`offlineShellService.ensureReady()` siga pasando.

En el build de la PWA configura sólo la clave pública:

```env
VITE_WEB_PUSH_VAPID_PUBLIC_KEY=<clave-publica-url-safe-base64>
```

Genera un par VAPID independiente para cada ambiente. La versión usada por la
función es `web-push@3.6.7`, fijada en su `deno.json`:

```bash
npx --yes web-push@3.6.7 generate-vapid-keys
```

Guarda la salida en un gestor de secretos; nunca la copies al repositorio, a
`.env.example`, a Dexie ni al bundle Vite.

Configura manualmente en los secrets de la Edge Function:

```text
WEB_PUSH_VAPID_PUBLIC_KEY=<misma-clave-publica-del-build>
WEB_PUSH_VAPID_PRIVATE_KEY=<clave-privada-del-ambiente>
WEB_PUSH_VAPID_SUBJECT=mailto:correo-operativo@example.com
WEB_PUSH_DISPATCH_SECRET=<secreto-largo-para-webhook-y-scheduler>
```

La función usa además los valores server-side provistos por Supabase
(`SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`). La clave privada, la service
role key y `WEB_PUSH_DISPATCH_SECRET` no usan prefijo `VITE_`.

## Despliegue manual

Después de revisar la migración, aplícala en cada ambiente y despliega la
función:

```bash
supabase functions deploy deliver-web-push
```

Configura un Database Webhook asíncrono para `INSERT` en
`public.notification_deliveries`. Debe hacer `POST` a:

```text
https://<project-ref>.supabase.co/functions/v1/deliver-web-push
```

Incluye el header `x-web-push-secret` y el cuerpo estándar del webhook, que
contiene `record.id`. La función vuelve a cargar la fila y no acepta del
caller el destinatario, el texto, el evento ni `source_app`.

Configura además un scheduler server-to-server que consulte entregas de
Operaciones con estado `pending` o `failed` cuyo `next_attempt_at` ya venció y
envíe:

```json
{ "deliveryId": "<uuid-de-la-entrega>" }
```

El scheduler debe usar el mismo header secreto. La función reclama cada fila de
forma atómica, limita los intentos a cinco y aplica backoff con jitter. Un
`404`, `410` o respuesta equivalente de suscripción expirada revoca el endpoint
y abandona sus entregas pendientes. Una entrega `delivered` es un no-op en
posteriores invocaciones.

La migración, los secrets, el webhook y el scheduler no se aplican
automáticamente desde este repositorio.

## Logout y cambio de usuario

`authService.signOut()` ejecuta primero la limpieza del dispositivo actual
mediante `pushNotificationService.disableForLogout()`: revoca el endpoint de
`operaciones` para el administrador autenticado y después llama a
`PushSubscription.unsubscribe()`. El logout de Supabase usa alcance local para
no invalidar sesiones del mismo usuario en otros dispositivos. Si alguna de
estas operaciones falla, se registra un diagnóstico seguro y el logout de
Supabase continúa.

La activación explícita elimina la marca local de Push desactivado. Por eso, al
volver a iniciar sesión en el dispositivo, Push aparece desactivado y no se
reactiva ni solicita permiso automáticamente. Cerrar la PWA o bloquear el
teléfono no ejecuta este flujo y mantiene la suscripción activa.

## Pruebas y operación

Antes de habilitar la UI en producción:

1. Comprueba que el frontend y la función usan exactamente el mismo par VAPID.
2. Registra y revoca dos navegadores del mismo admin; confirma que uno no
   afecta al otro.
3. Inserta una entrega controlada y verifica `pending → processing →
   delivered`.
4. Repite el webhook y confirma que no se envía una segunda entrega marcada
   `delivered`.
5. Simula un endpoint expirado y confirma `revoked_at` y `abandoned` sin
   modificar `notifications` ni `read_at`.
6. Prueba con la PWA cerrada en iOS/iPadOS 16.4+, Android Chrome, Chrome de
   escritorio y Edge de escritorio. Repite la regresión de arranque offline.

Los logs sólo deben contener códigos de error sanitizados y el identificador
de la entrega. No registres endpoints, `p256dh`, `auth`, JWT, claves VAPID ni
el payload completo.

Para rollback, oculta la UI y desactiva webhook/scheduler. Conserva las tablas
para auditoría; el centro in-app continúa funcionando.
