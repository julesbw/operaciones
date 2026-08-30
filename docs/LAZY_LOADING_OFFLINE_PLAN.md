# Lazy loading con precache offline

## Resumen

Crear `docs/LAZY_LOADING_OFFLINE_PLAN.md` con este plan y enlazarlo desde el README.

Línea base actual:

- Bundle principal: 562.13 kB minificado / 150.82 kB gzip.
- JavaScript eager total aproximado: 886.17 kB / 244.23 kB gzip, incluyendo React, Dexie y Supabase.
- Build exitoso, con warning por el chunk principal mayor a 500 kB.
- 61 archivos de pruebas y 286 pruebas pasan; lint, TypeScript y `git diff --check` pasan.

No se añadirán dependencias, migraciones ni un router nuevo.

## Cambios de implementación

- Mantener eager `App`, Login, OperatorLogin, AppShell, Dashboard, capabilities, sesión, bootstrap, Dexie/sincronización y UI compartida.
- Convertir en páginas lazy, conservando sus interfaces actuales: Gastos, Transferencias, Colaboradores/Asistencias, Compras, Cortes, Caja Central, Exportación y Ajustes.
- Separar Pagos en un chunk lazy propio dentro de Colaboradores. Asistencias permanecerá agrupada con la página Colaboradores; Pagos sólo se importará al abrir su pestaña con capability válida.
- Envolver las páginas en un único `Suspense` con fallback discreto y reutilizable. No crear loaders por módulo.
- Evaluar `canAccessPage` antes de renderizar cualquier página lazy y `hasCapability('payments')` antes de importar Pagos. El precache descargará los archivos a Cache Storage, pero no los importará ni ejecutará.
- Conservar los `manualChunks` actuales de React, Dexie y Supabase; no añadir fragmentación por componentes ni ajustes artificiales para perseguir un tamaño concreto.

## Precache, releases y recuperación

- Extender el build en `vite.config.ts` para recopilar todos los assets emitidos por Vite e inyectar en el `public/sw.js` generado:
  - un `RELEASE_ID` único por build;
  - la lista completa de chunks JS y assets asociados, incluidos todos los imports dinámicos.
- Mantener los handlers actuales de navegación, caché, Push, `notificationclick`, `skipWaiting` y `clients.claim`. El `install` seguirá siendo atómico mediante `cache.addAll`, ahora con assets eager y lazy.
- Versionar la caché con `RELEASE_ID`. `VERIFY_APP_SHELL` comprobará también todos los chunks lazy y devolverá la versión instalada.
- Hacer que `offlineShellService.ensureReady()` sólo habilite el contexto offline cuando el worker activo corresponde al mismo release del cliente y todo su precache está completo; durante una actualización esperará al nuevo worker dentro del timeout existente.
- Añadir un límite de error alrededor de las páginas lazy:
  - reconocer `ChunkLoadError` y mensajes equivalentes de Chrome, Safari y Firefox;
  - consultar el release activo del service worker;
  - si difiere del cliente, recargar automáticamente una sola vez por transición `release-anterior → release-nuevo`, registrada en `sessionStorage`;
  - si la versión coincide, no puede comprobarse o ya se intentó, mostrar una pantalla recuperable con acción manual de actualización;
  - no recargar automáticamente por errores normales de renderizado ni crear loops.
- Mantener intactos Dexie/local-first, la cola de sincronización, autorización real, Push y las respuestas de Supabase fuera de Cache Storage.

Interfaces internas nuevas:

- `import.meta.env.RELEASE_ID`.
- Mensajes del worker para consultar/verificar `{ ready, releaseId }`.
- Helper común de páginas lazy y recuperación de chunks; las props y exports públicos de las páginas no cambian.

## Pruebas y validación

- Añadir pruebas para:
  - generación del precache y ausencia de placeholders en `dist/sw.js`;
  - inclusión de cada chunk dinámico emitido;
  - fallo de instalación si falta cualquier asset;
  - verificación de release en `offlineShellService`;
  - clasificación de errores de import dinámico y máximo de un reload automático;
  - fallback final cuando la recuperación no funciona;
  - no importar Pagos ni páginas no autorizadas sin capability.
- Comparar el build antes/después y documentar tamaño del entrypoint, JS eager total y chunks por página. El criterio es una separación limpia y ausencia de warnings relevantes, no un límite arbitrario.
- Ejecutar:

```bash
npm test
npm run lint
npx --no-install tsc -b
npm run build
git diff --check
```

- Validar manualmente en un origen de prueba:
  - login, OperatorLogin y Dashboard;
  - navegación autorizada por todos los módulos;
  - instalar un release sin visitar módulos, desconectar la red y abrir cada página;
  - refresh completamente offline;
  - recepción y navegación desde Push;
  - mantener un release anterior abierto, desplegar el siguiente y provocar una carga lazy para confirmar una sola recarga y ausencia de pantalla rota.

## Documentación y supuestos

- Registrar en `docs/LAZY_LOADING_OFFLINE_PLAN.md` la arquitectura, línea base, resultados finales y protocolo offline entre dos releases.
- Actualizar la descripción de precache en Arquitectura y añadir el enlace al nuevo documento en README.
- “Ajustes” corresponde a `SettingsPage`; los ajustes de cortes permanecen agrupados con Cortes.
- El service worker continúa siendo manual y se amplía en el mismo archivo; no se incorpora Workbox ni otro plugin PWA.

## Implementación aplicada

- `vite.config.ts` genera `dist/sw.js` a partir de `public/sw.js`, reemplaza `RELEASE_ID` y agrega todos los archivos emitidos por Vite al precache. El worker conserva sus handlers de navegación, caché, Push, `notificationclick`, `skipWaiting` y `clients.claim`.
- `offlineShellService` verifica `{ ready, releaseId }`, solicita una actualización cuando el worker activo es anterior y sólo permite persistir el contexto autenticado cuando coincide el release y está completo el precache.
- Las páginas lazy usan `lazyNamedPage`; el boundary de acceso se evalúa con `canAccessPage` antes de renderizar cada módulo. `CollaboratorsPage` conserva Attendance estático dentro de su chunk y carga Payments mediante `hasCapability(identity, 'payments')` únicamente al seleccionar la pestaña.
- `LazyPageErrorBoundary` distingue errores de carga de imports dinámicos de errores normales. La recuperación automática se limita a una transición `release-anterior → release-nuevo`; si no se puede comprobar el worker, las versiones coinciden o ya se reintentó, se muestra la acción manual `Actualizar`.

## Resultados medidos

Build de referencia: 562.13 kB min / 150.82 kB gzip para el entrypoint y 886.17 kB / 244.23 kB gzip de JavaScript eager aproximado, con warning por superar 500 kB.

Build posterior a la implementación:

| Área | Minificado | Gzip |
| --- | ---: | ---: |
| Entrypoint eager | 341.19 kB | 100.86 kB |
| JavaScript eager total (`index` + React + Dexie + Supabase) | 665.23 kB | 194.27 kB |
| CSS inicial | 94.00 kB | 13.42 kB |

Chunks principales por página:

| Página/chunk | Minificado | Gzip |
| --- | ---: | ---: |
| Colaboradores + Asistencias | 9.49 kB | 3.53 kB |
| Pagos | 16.61 kB | 5.25 kB |
| Gastos | 13.15 kB | 4.68 kB |
| Transferencias | 15.64 kB | 5.20 kB |
| Compras | 14.22 kB | 4.65 kB |
| Cortes | 67.43 kB | 15.82 kB |
| Caja Central | 19.40 kB | 5.54 kB |
| Exportación | 21.76 kB | 6.90 kB |
| Ajustes | 45.59 kB | 10.50 kB |

El build posterior no emitió warnings de tamaño. `dist/sw.js` contiene el release y cada chunk dinámico emitido, sin placeholders de generación.

La validación automatizada posterior quedó en 65 archivos de prueba y 299 pruebas exitosas; también pasaron lint, TypeScript y `git diff --check`.

## Protocolo offline entre releases

1. Publicar el build completo, incluyendo `index.html`, todos los archivos de `dist/assets` y el `dist/sw.js` generado del mismo build.
2. El cliente nuevo registra el worker y `ensureReady()` espera hasta que el worker activo responda con su mismo `RELEASE_ID` y confirme todos los assets precacheados. Mientras tanto no habilita una nueva inicialización offline.
3. Si un release anterior permanece abierto y falla un import dinámico, la PWA consulta el worker activo. Cuando detecta `release-anterior → release-nuevo`, guarda esa transición en `sessionStorage` y recarga una sola vez.
4. Tras la recarga, si el chunk aún falla, si el worker no puede consultarse o si ya se registró la transición, se conserva la pantalla recuperable con `Actualizar`; no se crea un bucle.
5. Validar manualmente en un origen de prueba los escenarios de login, todos los módulos autorizados, instalación sin visitar módulos, cada página offline, refresh offline, Push y la transición con un release anterior abierto.
