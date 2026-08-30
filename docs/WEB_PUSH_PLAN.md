# Plan de implementación — Web Push para Operaciones

## Objetivo y alcance

Agregar Web Push como canal secundario de las notificaciones in-app existentes
para administradores:

```text
PURCHASE_CREATED
TRANSFER_CREATED
CASH_CLOSING_CLOSED
```

La fila en `notifications` y su destinatario en `notification_recipients`
seguirán siendo la fuente de verdad. La entrega Push ocurrirá después de que
la transacción de negocio haya creado esa notificación; un fallo, timeout o
reintento del canal Push no modificará la notificación in-app ni su estado de
lectura.

Quedan fuera de esta fase otros roles, otros eventos, preferencias por evento,
horarios silenciosos, agrupación, Realtime, email, SMS y Push de
Arrendamientos.

## Diagnóstico del repositorio

### PWA actual

- No hay plugin PWA. `src/main.tsx` registra manualmente `/sw.js` sólo en
  builds de producción.
- `public/manifest.webmanifest` usa `start_url: /`, `scope: /` y
  `display: standalone`.
- `public/sw.js` mantiene el app shell en una caché versionada, descubre los
  bundles con hash desde `index.html` y usa navegación network-first con
  fallback offline.
- La instalación ejecuta `skipWaiting()`; la activación elimina sólo cachés
  antiguas con el prefijo propio y ejecuta `clients.claim()`.
- `offlineShellService` comprueba mediante `VERIFY_APP_SHELL` que el worker
  activo tenga todos los recursos antes de considerar completa la
  inicialización online.
- El worker debe extenderse en el mismo archivo. No se reemplazará su registro,
  scope, ciclo de actualización ni estrategia de caché.

El origen canónico de producción no está documentado en el repositorio. Debe
confirmarse antes de generar la primera suscripción real, porque las
suscripciones pertenecen al origen y al service worker. Un cambio posterior de
dominio exigiría volver a suscribir cada dispositivo.

### Notificaciones y navegación actuales

- Las migraciones `202608290001_notifications.sql` y
  `202608290002_notification_source_app_isolation.sql` crean notificaciones
  idempotentes y destinatarios `auth_user` para admins activos.
- La unicidad actual es `source_app + event_type + entity_id`.
- Las RPC de listado y lectura filtran `source_app`; el frontend fija siempre
  `operaciones`.
- `NotificationCenter` marca como leída una notificación cuando el usuario la
  abre, no cuando se carga.
- `App.tsx` ya traduce `purchase`, `merchandise_transfer` y `cash_closing` a las
  páginas existentes y pasa el ID a sus vistas de detalle. No hace falta
  incorporar un router.
- La pestaña `Sistema` de `SettingsPage` es el lugar apropiado para administrar
  Push por dispositivo.

## Arquitectura objetivo

```text
Operación aceptada por PostgreSQL
        ↓
Notification(source_app = operaciones)
        ↓
notification_recipients(admin auth user)
        ├── centro in-app
        └── notification_deliveries(push, subscription)
                    ↓ asíncrono, después del commit
             Supabase Edge Function
                    ↓ VAPID
             proveedor Web Push
                    ↓
          service worker de Operaciones
```

Decisiones:

1. Usar una Supabase Edge Function como único emisor. La clave VAPID privada y
   la credencial elevada de base de datos nunca llegan al navegador.
2. Crear un registro de entrega por `notification_id + subscription_id`. Este
   registro desacopla el Push de la transacción de negocio, evita duplicados y
   permite reintentos observables.
3. Invocar el despachador mediante un Database Webhook asíncrono sobre cada
   `INSERT` en `notification_deliveries` como ruta rápida. La función recibe el
   ID de esa entrega, vuelve a cargarla desde la base y puede ejecutarse de
   nuevo sin generar una segunda entrega exitosa.
4. Añadir un barrido programado para reintentos pendientes con backoff y límite
   de intentos. La configuración del webhook, scheduler y sus credenciales se
   documentará, pero no se aplicará automáticamente a entornos remotos.
5. Mantener `source_app` en suscripciones, entregas, consultas y payloads. Una
   función de Operaciones rechazará cualquier fila de Arrendamientos.

## Fase 0 — Validaciones antes de implementar

1. Confirmar y documentar el origen HTTPS canónico de Operaciones.
2. Verificar en ese origen que el worker activo sea `/sw.js`, tenga scope `/` y
   que `offlineShellService.ensureReady()` siga pasando tras una actualización.
3. Ejecutar un spike local de la librería Web Push elegida dentro del runtime
   actual de Supabase Edge Functions. Debe poder generar VAPID y enviar usando
   las primitivas disponibles sin polyfills frágiles.
4. Si el spike exige una dependencia nueva, documentar versión, mantenimiento y
   compatibilidad Deno antes de incorporarla. No agregar una librería al bundle
   React: sólo pertenece a la función server-side.
5. Generar un par VAPID independiente por ambiente. No copiar las claves de
   producción a desarrollo ni compartirlas con Arrendamientos sin una decisión
   operativa explícita.

## Fase 1 — Modelo de datos y seguridad

Crear una migración aditiva posterior a las migraciones de notificaciones.

### `push_subscriptions`

Campos propuestos:

```text
id uuid primary key
source_app text not null
auth_user_id uuid not null
endpoint text not null
p256dh text not null
auth text not null
created_at timestamptz not null
updated_at timestamptz not null
last_seen_at timestamptz not null
revoked_at timestamptz null
```

Reglas:

- `UNIQUE (source_app, endpoint)` evita duplicar exactamente la misma
  suscripción y permite varios navegadores/dispositivos por admin.
- `auth_user_id` siempre se obtiene de `auth.uid()` dentro de una RPC. No se
  acepta desde el frontend.
- Para esta fase, las RPC fijan `source_app = 'operaciones'`; no reciben un
  dominio arbitrario.
- Registrar de nuevo un endpoint actualiza `p256dh`, `auth`, `last_seen_at` y
  limpia `revoked_at` sólo si pertenece al mismo usuario. Un endpoint asociado
  a otro usuario debe fallar de forma segura.
- Revocar afecta exclusivamente a la combinación usuario actual, Operaciones y
  endpoint de este dispositivo.
- Habilitar RLS, revocar acceso directo a `anon`/`authenticated` y exponer sólo
  RPCs con permisos mínimos.

RPCs propuestas:

```text
register_push_subscription(p_endpoint, p_p256dh, p_auth)
revoke_push_subscription(p_endpoint)
```

Ambas deben exigir sesión, comprobar `private.is_admin()`, validar longitudes y
formatos razonables, fijar `source_app` y usar `SECURITY DEFINER` con
`search_path = ''` y nombres de esquema explícitos.

### `notification_deliveries`

Campos propuestos:

```text
id uuid primary key
notification_id uuid not null
subscription_id uuid not null
channel text not null default 'push'
status text not null
attempt_count integer not null default 0
next_attempt_at timestamptz null
last_attempt_at timestamptz null
delivered_at timestamptz null
last_error text null
created_at timestamptz not null
updated_at timestamptz not null
```

Restricciones e índices:

```text
UNIQUE (notification_id, subscription_id, channel)
CHECK channel = push
CHECK status in (pending, processing, delivered, failed, abandoned)
index (status, next_attempt_at)
```

Un helper interno creará entregas al insertar un
`notification_recipients` de tipo `auth_user`, tomando sólo suscripciones
activas con el mismo usuario y el mismo `notifications.source_app`. El
`ON CONFLICT DO NOTHING` hace idempotente esta proyección.

No se concederá acceso directo del cliente a la tabla de entregas ni se
mezclará `status` de entrega con `notification_recipients.read_at`.

## Fase 2 — Registro y revocación en la PWA

Crear un servicio frontend aislado, por ejemplo
`src/services/pushNotificationService.ts`, responsable de:

1. Detectar soporte de `serviceWorker`, `PushManager` y `Notification`.
2. Detectar el caso iOS/iPadOS no instalado y devolver un estado explicativo;
   Web Push en esos dispositivos requiere una web app agregada a la pantalla de
   inicio.
3. Consultar `navigator.serviceWorker.ready` y
   `registration.pushManager.getSubscription()` para derivar el estado de este
   dispositivo.
4. Solicitar permiso solamente desde el click de `Activar notificaciones`.
5. Suscribir con `userVisibleOnly: true` y la clave pública VAPID convertida de
   Base64 URL-safe a `Uint8Array`.
6. Enviar `endpoint`, `p256dh` y `auth` a
   `register_push_subscription` usando la sesión Supabase actual.
7. Si el registro remoto falla después de crear la suscripción local, intentar
   `unsubscribe()` para no dejar un estado engañoso y mostrar un error
   recuperable.
8. Para desactivar, revocar primero mediante RPC y después ejecutar
   `subscription.unsubscribe()`. Si uno de los pasos falla, refrescar el estado
   real y permitir reintentar sin afectar otros dispositivos.

La clave pública se expondrá como
`VITE_WEB_PUSH_VAPID_PUBLIC_KEY`. Se agregará solamente el nombre y un valor de
ejemplo a `.env.example` y a los tipos de `vite-env`; la clave privada nunca
usará el prefijo `VITE_`.

## Fase 3 — UI administrativa

Agregar una sección `Notificaciones Push` dentro de la pestaña `Sistema` de
`SettingsPage`, visible sólo para admins autenticados.

Estados de presentación:

```text
No compatible
Instala la PWA para activar (iPhone/iPad)
Permiso no solicitado
Activadas en este dispositivo
Bloqueadas por el navegador
Desactivadas en este dispositivo
Registrando / desactivando
Error de registro
```

La UI no pedirá permisos al montar, no repetirá solicitudes después de
`denied`, no prometerá Push cuando esté offline y nunca mostrará endpoint ni
claves técnicas. `Activar` y `Desactivar` serán acciones explícitas del usuario.

## Fase 4 — Entrega server-side

Crear una Edge Function, por ejemplo
`supabase/functions/deliver-web-push/index.ts`, con estas responsabilidades:

1. Autenticar exclusivamente llamadas internas del webhook/scheduler.
2. Recibir un identificador de notificación o entrega; no aceptar del caller el
   contenido Push, el destinatario ni `source_app`.
3. Reclamar de forma atómica entregas `pending`/reintentables para evitar que dos
   invocaciones envíen la misma fila a la vez.
4. Cargar desde la base la notificación, el destinatario y la suscripción;
   comprobar nuevamente que todos pertenezcan a `operaciones` y al mismo
   `auth_user_id`.
5. Construir un payload pequeño desde datos autoritativos:

   ```text
   notificationId
   sourceApp
   eventType
   entityType
   entityId
   title
   body
   ```

6. Enviar con VAPID, registrar el intento y no modificar `notifications` ni
   `notification_recipients`.
7. Marcar `delivered` una sola vez. Un nuevo disparo sobre una entrega ya
   entregada debe ser un no-op.
8. Ante respuestas permanentes del proveedor (por ejemplo, suscripción expirada
   o inexistente), establecer `push_subscriptions.revoked_at` y abandonar sus
   entregas pendientes.
9. Ante errores transitorios, calcular backoff con jitter, incrementar
   `attempt_count` y limitar el número total de intentos. Al agotar el límite,
   dejar `abandoned` con un error sanitizado.
10. No registrar en logs `p256dh`, `auth`, JWT, claves VAPID ni el payload
    completo.

Los textos Push deben ser más breves que el detalle in-app. Su constructor debe
tener tests por evento y partir de la notificación persistida y sus referencias,
no de los triggers de negocio. Formato esperado:

```text
Compra registrada       — Tienda · $4,850
Transferencia registrada — Tienda A → Tienda B · $2,300
Corte cerrado            — Tienda B · Efectivo a retirar $18,750
```

### Secrets

Configurar manualmente por ambiente en Supabase Edge Function Secrets:

```text
WEB_PUSH_VAPID_PUBLIC_KEY
WEB_PUSH_VAPID_PRIVATE_KEY
WEB_PUSH_VAPID_SUBJECT=mailto:correo-operativo@example.com
```

La función usará además las credenciales server-side provistas por Supabase
para consultar y actualizar las entregas. Ninguno de estos valores se copiará a
Dexie, localStorage, el payload, el repositorio o el bundle Vite. La clave
pública del frontend debe corresponder exactamente al mismo par configurado en
la función.

## Fase 5 — Service worker y apertura de entidades

Extender `public/sw.js` con listeners `push` y `notificationclick`, conservando
intactos `install`, `activate`, `message`, `fetch`, `APP_SHELL` y el esquema de
caché.

En `push`:

- Validar defensivamente el JSON y `sourceApp === 'operaciones'`.
- Aceptar sólo los tres `eventType`/`entityType` conocidos.
- Ejecutar `showNotification(title, { body, icon, badge, data })`.
- Usar iconos locales ya incluidos en el app shell.
- No marcar la notificación in-app como leída.

En `notificationclick`:

1. Cerrar la notificación del sistema.
2. Buscar una ventana de este mismo origen con `clients.matchAll`.
3. Si existe, enfocarla y enviar un mensaje con el destino validado.
4. Si no existe, abrir `/?notificationId=...&entityType=...&entityId=...` con
   valores codificados.

`App.tsx` incorporará un adaptador pequeño que reciba el mensaje del worker o
lea esos query params al arrancar. Conservará el destino hasta resolver la
sesión, limpiará los parámetros de la barra con `history.replaceState` y
reutilizará `navigateFromNotification`. No se agregará un router.

Tocar la notificación del sistema cuenta como interacción. Una vez que la app
haya validado el destino y la sesión admin, podrá reutilizar
`mark_notification_read`; si está offline, navegará con los datos disponibles y
dejará el estado pendiente de lectura. La mera recepción del evento `push`
nunca cambia `read_at`.

## Fase 6 — Pruebas

### Migración y seguridad

- Admin autenticado registra y revoca sólo su suscripción de Operaciones.
- Usuario no admin no puede ejecutar las RPC ni leer las tablas.
- `auth_user_id` del frontend no puede falsificarse.
- El mismo admin admite varios endpoints; el mismo endpoint no se duplica.
- Operaciones no crea ni procesa entregas de `source_app = arrendamientos`.
- Repetir el evento de negocio conserva una notificación y una entrega por
  dispositivo.

### Frontend y worker

- Estados soportado, no solicitado, activo, bloqueado, no instalado y error.
- `requestPermission()` sólo ocurre tras el gesto del admin.
- Activar registra las claves correctas; desactivar afecta sólo al dispositivo.
- Un evento `push` válido llama a `showNotification`; payloads inválidos se
  descartan sin afectar el worker.
- `notificationclick` enfoca una ventana existente o abre una nueva.
- Compra, Transferencia y Corte llegan a sus detalles mediante la navegación
  actual.
- Recibir Push no marca leída la notificación.

### Entrega

- Cada evento produce in-app + Push para cada suscripción admin activa.
- Fallo Push conserva la notificación in-app.
- Dos workers concurrentes no reclaman la misma entrega.
- Un retry no reenvía una entrega marcada `delivered`.
- Errores transitorios respetan backoff y límite; endpoints permanentes se
  revocan.
- Ningún log o respuesta expone secretos o material de suscripción.

### Compatibilidad manual

Probar en el origen HTTPS definitivo:

```text
iPhone/iPadOS 16.4+ con PWA instalada
Android Chrome con PWA instalada
Chrome de escritorio
Edge de escritorio
```

En cada plataforma validar activación, recepción con la app cerrada, click,
desactivación y actualización del service worker. Además, repetir las pruebas de
arranque offline para comprobar que el app shell no tuvo regresiones.

Ejecutar al final:

```bash
npm test
npm run lint
npx --no-install tsc -b
npm run build
git diff --check
```

Si la Edge Function incorpora sus propias pruebas o verificación de tipos,
agregarlas al checklist y documentar el comando exacto.

## Archivos previstos

```text
.env.example
README.md
public/sw.js
src/main.tsx o un adaptador de eventos del service worker
src/App.tsx
src/pages/SettingsPage.tsx
src/pages/SettingsPage.test.tsx
src/services/pushNotificationService.ts
src/services/pushNotificationService.test.ts
src/types/database.ts
src/vite-env.d.ts
supabase/migrations/<timestamp>_web_push.sql
supabase/functions/deliver-web-push/index.ts
supabase/functions/deliver-web-push/*test*
docs/ARCHITECTURE.md
docs/WEB_PUSH.md (operación y despliegue, al implementar)
```

Los nombres finales pueden ajustarse al soporte de tests que ofrezca la versión
de Supabase CLI elegida, sin ampliar el alcance funcional.

## Despliegue gradual y rollback

1. Aplicar y verificar primero la migración aditiva. Sin UI ni función activa no
   cambia el comportamiento actual.
2. Desplegar la Edge Function y cargar manualmente secrets por ambiente.
3. Configurar manualmente el webhook de `INSERT` sobre
   `notification_deliveries` y el barrido programado con una credencial
   server-to-server; probar con una entrega controlada.
4. Desplegar la PWA con el worker extendido y la clave pública.
5. Habilitar la UI sólo después de verificar que las claves pública/privada
   coinciden y que el origen final no cambiará.
6. Observar tasas de `delivered`, `failed`, `abandoned` y subscriptions revocadas
   sin registrar su contenido sensible.

El rollback de aplicación consiste en ocultar la UI y desactivar webhook y
scheduler. Las tablas se conservan para auditoría y no se eliminan en el
rollback. El centro in-app continúa funcionando independientemente.

No se aplicarán migraciones remotas, secrets, webhooks, schedules o despliegues
como parte de la implementación local sin una instrucción explícita.

## Criterios de aceptación

```text
Compra / Transferencia / Corte aceptado
→ Notification(source_app = operaciones) idempotente
→ visible en el centro in-app
→ entrega Push intentada a cada dispositivo admin activo
→ fallo Push aislado del estado in-app
```

Con la aplicación cerrada:

```text
Push
→ admin toca la notificación
→ abre o enfoca la PWA de Operaciones
→ navega a la entidad existente
```

La fase queda completa cuando pasan las pruebas automatizadas, la matriz manual
móvil/desktop y la regresión offline, y cuando la documentación de despliegue
permite configurar cada ambiente sin almacenar secretos en Git.

## Referencias oficiales

- [Supabase Database Webhooks](https://supabase.com/docs/guides/database/webhooks)
- [Supabase Edge Function secrets](https://supabase.com/docs/guides/functions/secrets)
- [Supabase Edge Function authentication](https://supabase.com/docs/guides/functions/auth)
- [Web Push para web apps en iOS/iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)
