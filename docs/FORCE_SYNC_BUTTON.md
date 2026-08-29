Ajuste — Sincronización forzada desde el botón de estado
Objetivo
Convertir el botón actual de sincronización en una acción real de:

```text
validar sesión
→ subir pendientes
→ traer cambios remotos
→ actualizar caché/UI

```

sin añadir todavía Realtime, WebSockets ni cambios de arquitectura mayores.
Al pulsar el indicador/botón de sincronización:

```text
1. comprobar conexión
2. validar sesión Supabase técnica
3. validar OperatorSession si aplica
4. procesar SyncQueue
5. hacer pull de datos remotos permitidos
6. actualizar Dexie
7. refrescar UI

```

El botón debe mostrar mientras tanto:

```text
Sincronizando…

```

y evitar ejecuciones duplicadas simultáneas.
Si la sesión Supabase:

```text
expiró
fue revocada
no puede renovarse

```

no dejar la app simplemente en estado de error.
Hacer:

```text
limpiar estado técnico inválido
→ limpiar OperatorSession asociada
→ llevar al LoginPage Supabase

```

No eliminar datos locales pendientes.
Si Supabase sigue siendo válido pero la OperatorSession:

```text
expiró
fue revocada
cuenta desactivada
cambió de tienda

```

hacer:

```text
detener sync
→ conservar pendientes
→ limpiar sesión operativa inválida
→ mostrar OperatorLoginPage

```

No cerrar innecesariamente la sesión técnica.
Mantener este orden:

```text
PUSH SyncQueue
→ PULL remoto

```

Así evitamos refrescar primero y luego sobrescribir/confundir cambios locales pendientes.
Si algún pendiente falla:

```text
→ conservarlo
→ actualizar su diagnóstico
→ continuar con los elementos que sí puedan procesarse

```

salvo que el error invalide la sesión completa.
Después del push, refrescar los datos remotos correspondientes al usuario/rol actual.
Reutilizar los servicios de bootstrap/reference/pull existentes donde sea posible.
Como mínimo refrescar los dominios que actualmente ya cuentan con sincronización/cache local:

```text
Gastos
Asistencias
Transferencias
Compras
referencias necesarias

```

y cualquier otro dataset que el flujo actual ya refresque al recuperar conectividad.
No implementar todavía la nueva caché de Cortes en este ajuste; se hará aparte.
Después del pull:

```text
Supabase
→ Dexie
→ UI

```

Las vistas abiertas deben reflejar los nuevos datos sin requerir:

```text
cerrar app
refresh del navegador
logout/login

```

Mantener el comportamiento actual del inspector.
Después de sincronizar:

- pendientes resueltos desaparecen;
- errores persistentes permanecen;
- retryCount / lastAttemptAt / diagnóstico se actualizan.
  No eliminar pendientes sólo porque el usuario pulse “Sincronizar ahora”.
  El indicador debe distinguir al menos:

```text
Sincronizado
Sincronizando…
N pendientes
N con error
Sin conexión
Sesión requerida

```

No es necesario rediseñar completamente el componente.
Reutilizar esta misma secuencia cuando la app detecte:

```text
offline → online

```

Especialmente:

```text
validar sesiones
ANTES de procesar SyncQueue

```

Evitar tener una lógica distinta entre sync manual y sync automático si puede centralizarse.
Preferir una función/orquestador compartido equivalente a:

```text
synchronizeNow()

```

Fuera de alcance:

```text
Realtime
WebSockets
Supabase Realtime

polling continuo

caché nueva de Cortes

login PIN offline

eliminar manualmente pendientes

cambios de permisos/RLS

cambios de OperatorSession backend

```

Verificar:

```text
✓ sesión válida + pendientes → push correcto
✓ después del push se ejecuta pull
✓ UI refleja cambios remotos sin refresh
✓ Supabase session inválida → login técnico
✓ OperatorSession inválida → login operador
✓ pendientes se conservan al perder sesión
✓ error individual no borra el pendiente
✓ offline muestra estado correcto
✓ recuperar conexión valida sesión antes de sync
✓ múltiples taps no crean sync concurrentes
✓ inspector se actualiza después del intento

```

Ejecutar:

```bash
npm test
npm run lint
npx --no-install tsc -b
npm run build
git diff --check

```

No hacer commit.
El botón de sincronización deja de significar únicamente:

```text
“intentar subir pendientes”

```

y pasa a significar:

```text
“poner esta instalación al día ahora”

```

incluyendo identidad, push, pull y actualización de caché/UI.
