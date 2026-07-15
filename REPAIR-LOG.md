# REPAIR-LOG.md

Fecha: 2026-07-12
Proyecto: Sweet Little Trauma Studio
Modulo ejecutado: Modulo 1 - Orquestacion y Enrutamiento de Proveedores / Adaptador Unificado

## Diagnostico inicial breve

El repositorio es una app React + Vite con backend Express concentrado en `server/api-proxy.js`. El frontend llama endpoints internos como `/api/generate/video`, `/api/generate/image`, `/api/generate/music`, `/api/generate/sound` y `/api/assist` mediante `src/lib/api-client.js`.

Antes de esta intervencion, el backend ya tenia un `providerCatalog` amplio y funciones directas por proveedor, pero el flujo estaba acoplado en `attemptProviderCall`. Si el proveedor solicitado fallaba, la generacion fallaba completa aunque hubiera otro proveedor conectado que pudiera resolver el mismo tipo de tarea.

## Problema encontrado

### Provider routing sin gateway/fallback

- Archivo: `server/api-proxy.js`
- Estado previo:
  - `handleGenerate(kind)` elegia un provider y llamaba directo a `attemptProviderCall`.
  - `attemptProviderCall` tenia toda la decision por `status.adapter`.
  - `forceProviderFailure` cortaba la request con HTTP 503 antes de que existiera posibilidad de fallback.
  - `/api/assist` tambien llamaba directo al provider elegido en el flujo standard.

Impacto:

- Si Runway, Seedance, ElevenLabs, OpenAI u otro proveedor falla por timeout, rate limit, billing/quota o 5xx, el usuario recibe error aunque existan alternativas conectadas.
- La UI queda demasiado dependiente de nombres de providers concretos.
- No habia una ruta declarativa para fallback chains por modulo creativo.

## Cambios aplicados

### 1. Fallback chains declarativas por modulo

Archivo modificado:

- `server/api-proxy.js`

Se agrego `providerFallbackChains` para declarar el orden de respaldo por tipo:

- `image`: OpenAI Images -> Gemini Image -> Grok Image -> Stability -> Replicate
- `video`: Seedance -> Runway -> Luma -> Kling -> Wan -> Hailuo
- `music`: MiniMax Music -> SLT Composer -> AudioCraft local -> Riffusion -> Stable Audio
- `sound`: ElevenLabs -> OpenAI Audio -> MiniMax Speech -> Stability Audio -> Moises
- `assist`: OpenAI -> Gemini -> Meta Llama -> Hermes local -> Local model

### 2. Interfaz comun `ProviderAdapter`

Archivo modificado:

- `server/api-proxy.js`

Se agrego una clase `ProviderAdapter` que recibe el `providerStatus` y expone un metodo comun:

```js
adapter.generate({ kind, prompt, title, payload })
```

Este adaptador envuelve la logica existente de `attemptProviderCall`, por lo que no se duplicaron llamadas ni se movieron claves al frontend.

### 3. Gateway de ejecucion con fallback

Archivo modificado:

- `server/api-proxy.js`

Se agrego `runProviderGateway`, que:

- arma la cadena de proveedores a partir del provider solicitado y la fallback chain del modulo;
- saltea providers desconectados/preparados/no configurados si fallback esta habilitado;
- intenta el proveedor conectado;
- si falla por error elegible de fallback, prueba el siguiente;
- devuelve `providerRoute` y `providerFallback` en la respuesta;
- preserva el provider usado realmente en `historyItem.provider`.

### 4. Soporte para verificacion de fallback con error simulado

Archivo modificado:

- `server/api-proxy.js`

Se ajusto `forceProviderFailure` para que, con fallback habilitado, ya no corte toda la request antes de entrar al gateway. Ahora puede simular un HTTP 503 del proveedor principal y permitir que el backend pruebe el siguiente proveedor.

Para conservar el comportamiento viejo, puede enviarse:

```json
{
  "forceProviderFailure": true,
  "allowFallback": false
}
```

### 5. `/api/generate/*` conectado al gateway

Archivo modificado:

- `server/api-proxy.js`

Los endpoints:

- `/api/generate/image`
- `/api/generate/video`
- `/api/generate/music`
- `/api/generate/sound`

ahora usan `runProviderGateway` para generaciones normales.

El modo long-form/timeline de video se preservo sin cambiarlo, porque no envia un request unico a provider sino que arma una timeline.

### 6. `/api/assist` standard conectado al gateway

Archivo modificado:

- `server/api-proxy.js`

El flujo standard de asistente ahora usa fallback entre OpenAI, Gemini, Meta Llama y modelos locales si corresponde.

El modo CEO Hermes se preservo como estaba para no alterar su comportamiento especial.

## Flujos dejados conectados

- Generacion de imagen con fallback backend.
- Generacion de video con fallback backend para clips normales.
- Generacion de musica con fallback backend.
- Generacion de sonido/voz con fallback backend.
- Asistente standard con fallback backend.
- Respuesta enriquecida con:
  - `checks.requestedProvider`
  - `checks.provider`
  - `checks.providerFallback`
  - `checks.providerRoute`
  - `historyItem.result.providerRoute`
  - `historyItem.result.fallback`

## Elementos pendientes para fases futuras

No se implementaron todavia porque el prompt exige detenerse tras el Modulo 1:

- Jobs persistentes `IN_QUEUE`, `IN_PROGRESS`, `COMPLETED`, `FAILED`.
- Webhooks verificados por proveedor.
- Ledger transaccional de creditos.
- Moderacion multicapa.
- Descarga y almacenamiento propio/CDN de assets.
- Persistencia real en base de datos.
- Auth real y permisos productivos.
- UI especifica para mostrar fallback route al usuario.

## Pruebas ejecutadas durante este modulo

```txt
node --check server/api-proxy.js
```

Resultado:

```txt
OK - sin errores de sintaxis.
```

```txt
npm run lint
```

Resultado:

```txt
OK - exit 0. Oxlint reporto warnings existentes de mantenimiento, sin errores fatales.
```

```txt
npm run build
```

Resultado:

```txt
OK - Vite build completo en 645ms. Se regenero `dist/` como parte esperada del build.
```

## Validacion funcional de fallback

El backend ahora soporta fallback simulado enviando `forceProviderFailure` con fallback habilitado. No se ejecuto una generacion real de provider externo en esta fase para evitar gasto accidental de creditos/API. El criterio funcional queda listo para verificarse con un payload controlado por modulo cuando se autorice una prueba de generacion.

## Commit sugerido

```txt
feat: add provider gateway fallback routing
```

---

Fecha: 2026-07-12
Proyecto: Sweet Little Trauma Studio
Modulo ejecutado: Modulo 2 - Sistema de Inferencia Asincrona, Cola y Webhooks

## Diagnostico inicial breve

El backend sigue concentrado en `server/api-proxy.js` y no tiene ORM/base de datos persistente activa en este repo. La persistencia existente es un estado local en memoria (`state.projects`, `state.history`, `state.subscription`). Por esa razon, esta fase implementa la cola usando el mismo almacenamiento in-memory actual, sin agregar Redis, BullMQ ni dependencias nuevas.

## Problema encontrado

### Generaciones pesadas seguian acopladas a la request HTTP

- Archivo: `server/api-proxy.js`
- Estado previo:
  - `/api/generate/video` y `/api/generate/music` ejecutaban el provider gateway dentro del ciclo de la request.
  - El endpoint podia quedar esperando hasta que el proveedor respondiera o venciera el timeout.
  - `/api/jobs/:jobId` existia, pero solo para polling directo de Seedance/OmniHuman y no conocia jobs internos.
  - No existian endpoints de webhook para fal.ai o Replicate.

Impacto:

- El navegador podia quedar esperando demasiado tiempo en renders de video/musica.
- El servidor mezclaba "aceptar solicitud" con "esperar resultado final".
- Los proveedores asincronos no tenian una ruta segura para confirmar resultados.

## Cambios aplicados

### 1. Cola interna de jobs

Archivo modificado:

- `server/api-proxy.js`

Se agrego `state.jobs` con estados internos:

- `IN_QUEUE`
- `IN_PROGRESS`
- `COMPLETED`
- `FAILED`

Tambien se agregaron helpers para crear, buscar, actualizar y serializar jobs. La respuesta al frontend expone `status` compatible con la UI actual (`queued`, `processing`, `completed`, `failed`) y `state` con el estado interno.

### 2. `/api/generate/video` y `/api/generate/music` desacoplados

Archivo modificado:

- `server/api-proxy.js`

Los endpoints de video y musica ahora:

- validan plan, creditos y provider como antes;
- crean un job local;
- guardan un item de historial en `processing`;
- devuelven inmediatamente HTTP `202 Accepted` con `jobId/request_id`;
- disparan el provider gateway en background con `setTimeout(..., 0)`;
- mantienen `providerJobId` local para que el frontend actual pueda hacer polling.

No se modifico el diseno del frontend.

### 3. Polling unificado de jobs

Archivo modificado:

- `server/api-proxy.js`

`GET /api/jobs/:jobId` ahora primero busca un job local en `state.jobs`.

Si existe:

- devuelve estado local;
- devuelve `historyItem` asociado;
- devuelve `project` si ya fue completado;
- intenta refrescar Seedance/OmniHuman contra el proveedor cuando hay `providerJobId`.

Si no existe:

- conserva el comportamiento viejo de polling directo Seedance/OmniHuman para compatibilidad.

### 4. Webhooks seguros para proveedores asincronos

Archivo modificado:

- `server/api-proxy.js`

Se agregaron:

- `POST /api/webhooks/fal`
- `POST /api/webhooks/replicate`

Seguridad implementada:

- captura de `rawBody` en `express.json` para verificar firmas;
- HMAC SHA-256 con `crypto`;
- soporte flexible para headers tipo `webhook-signature`, `x-webhook-signature`, `x-fal-webhook-signature`, `svix-signature`, `x-replicate-signature`;
- validacion de timestamp con tolerancia configurable por `WEBHOOK_REPLAY_TOLERANCE_SECONDS`;
- rechazo de replay attacks si el timestamp esta fuera de ventana;
- secrets esperados:
  - `FAL_WEBHOOK_SECRET` o `FAL_AI_WEBHOOK_SECRET` o `WEBHOOK_SECRET`;
  - `REPLICATE_WEBHOOK_SECRET` o `WEBHOOK_SECRET`.

### 5. Idempotencia de webhooks

Archivo modificado:

- `server/api-proxy.js`

Se agrego `processedWebhookEvents` para ignorar duplicados por provider/event/status. Si un job ya esta en `COMPLETED` o `FAILED`, el webhook repetido devuelve `200 OK` y no vuelve a mutar historial/proyecto.

### 6. Adaptadores preparados para callback

Archivo modificado:

- `server/api-proxy.js`

El payload async ahora incluye:

- `jobId`
- `request_id`
- `webhookUrl`
- `webhook_url`
- `callbackUrl`
- `callback_url`

Los adaptadores genericos y Replicate reciben esos campos. Para Replicate, cuando hay webhook URL, se envia:

- `webhook`
- `webhook_events_filter: ["completed"]`

## Flujos dejados conectados

- Video y musica responden `202 Accepted` con `jobId`.
- Frontend actual puede usar `/api/jobs/:jobId`.
- Webhook fal.ai/Replicate puede completar o fallar un job local.
- Webhook duplicado se ignora con `200 OK`.
- Seedance/OmniHuman pueden seguir cerrando estado por polling cuando no llegue webhook.

## Pendientes para fases futuras

No se implementaron en esta fase porque el prompt exige detenerse antes de Ledger/facturacion:

- Persistencia real en base de datos.
- Ledger transaccional de creditos.
- Reintentos persistentes si Node se reinicia.
- Webhooks especificos de cada proveedor adicional.
- Firma exacta por SDK oficial si el proveedor exige un formato propietario distinto.
- UI dedicada para cola global de renders.

## Pruebas ejecutadas durante este modulo

```txt
node --check server/api-proxy.js
```

Resultado:

```txt
OK - sin errores de sintaxis.
```

```txt
npm run lint
```

Resultado:

```txt
OK - exit 0. Oxlint reporto warnings existentes/no fatales sobre exports de Fast Refresh y variables/catch params sin uso.
```

```txt
npm run build
```

Resultado:

```txt
OK - Vite build completo en 536ms. Se regenero `dist/` como salida esperada del build.
```

## Commit sugerido

```txt
feat: implement async job queue and secure webhooks
```

---

Fecha: 2026-07-12
Proyecto: Sweet Little Trauma Studio
Modulo ejecutado: Modulo 3 - Ledger Transaccional y Reserva de Creditos

## Diagnostico inicial breve

El repo no contiene Prisma, Drizzle ni otra base de datos persistente activa. Los saldos internos estaban en memoria dentro de `state.subscription.credits` y se mutaban directamente en endpoints de generacion, Stripe/subscription y assistant.

Como no hay tabla real `User`, `Wallet` o `Credits`, esta fase adapta la arquitectura existente agregando un ledger in-memory compatible con la futura migracion a base de datos:

- `state.wallet`
- `state.creditTransactions`
- `state.creditReservations`

## Problema encontrado

### Saldo simple con mutacion directa

- Archivo: `server/api-proxy.js`
- Estado previo:
  - `validateCredits` calculaba `remaining`.
  - Al completar una generacion se ejecutaba `state.subscription.credits = checks.credits.remaining`.
  - Si un job async fallaba despues de haberse descontado, no habia una reserva formal ni compensacion transaccional.

Impacto:

- Una generacion fallida podia dejar al usuario con percepcion de creditos perdidos.
- No habia idempotencia para cobros/reintentos.
- No habia historial auditable de movimientos de credito.

## Cambios aplicados

### 1. Ledger inmutable de transacciones

Archivo modificado:

- `server/api-proxy.js`

Se agrego `CreditTransaction` in-memory con:

- `id`
- `idempotencyKey`
- `idempotency_key`
- `type`
- `status`
- `amount`
- `reservationId`
- `jobId`
- `entries`
- `balanceDeltas`
- `metadata`
- `createdAt`

Cada movimiento se agrega como registro nuevo. No se modifican transacciones ya creadas.

### 2. Wallet con cuentas de doble entrada

Archivo modificado:

- `server/api-proxy.js`

Se agregaron cuentas logicas:

- `Tenant.Available`
- `Tenant.HeldByReservation`
- `SLT.CapturedRevenue`
- `SLT.CreditIssuer`
- `SLT.CreditExpiry`

Los saldos visibles se sincronizan desde `state.wallet` hacia:

- `state.subscription.credits`
- `state.subscription.heldCredits`
- `state.subscription.capturedCredits`
- `state.user.credits`

### 3. Servicio de ledger

Archivo modificado:

- `server/api-proxy.js`

Se agregaron metodos:

- `reserveCredits`
- `resolveReservation`
- `grantCredits`
- `adjustAvailableCredits`
- `appendCreditTransaction`
- `ledgerSnapshot`

`reserveCredits` mueve creditos desde `Tenant.Available` hacia `Tenant.HeldByReservation`.

`resolveReservation` ejecuta:

- `capture`: mueve desde `Tenant.HeldByReservation` hacia `SLT.CapturedRevenue`;
- `release`: mueve desde `Tenant.HeldByReservation` hacia `Tenant.Available`.

### 4. Generaciones conectadas al ledger

Archivo modificado:

- `server/api-proxy.js`

El flujo de generacion ahora hace:

1. Pre-flight con `validateCredits`.
2. Reserva con `reserveCredits`.
3. Creacion del job async.
4. Capture cuando el job termina en `COMPLETED`.
5. Release cuando el job termina en `FAILED` o error.

Los endpoints sync tambien usan reserva/capture/release para evitar cobros de fallos inmediatos.

### 5. Webhooks conectados al ledger

Archivo modificado:

- `server/api-proxy.js`

Cuando un webhook firmado marca un job como:

- `completed`: se ejecuta `capture`.
- `failed/cancelled`: se ejecuta `release`.

Los webhooks duplicados siguen siendo idempotentes y no vuelven a capturar/liberar.

### 6. Grants y ajustes de Stripe/subscription

Archivo modificado:

- `server/api-proxy.js`

Se reemplazaron mutaciones directas de credito por:

- `grantCredits` para packs de creditos.
- `adjustAvailableCredits` para cambios de plan/subscription.

### 7. Endpoint de inspeccion de ledger

Archivo modificado:

- `server/api-proxy.js`

Se agrego:

```txt
GET /api/ledger
```

Devuelve:

- wallet snapshot;
- ultimas reservas;
- ultimas transacciones.

No expone API keys ni secretos.

## Validacion funcional ejecutada

Se levanto servidor local con:

```txt
WEBHOOK_SECRET=test_secret PORT=3217 npm start
```

Prueba:

1. `POST /api/subscription` con plan `Pro` para tener saldo disponible.
2. `GET /api/ledger` antes de generar.
3. `POST /api/generate/music` con:
   - provider `SLT Composer`
   - `webhookOnly: true`
   - `idempotencyKey: ledger-m3-webhook-failure-test`
4. `GET /api/ledger` despues de reservar.
5. `POST /api/webhooks/replicate` con webhook firmado HMAC y status `failed`.
6. `GET /api/ledger` despues del release.

Resultado observado:

```txt
Antes:
availableCredits: 1500
heldCredits: 0

Reservado:
availableCredits: 1350
heldCredits: 150

Webhook FAILED / Release:
availableCredits: 1500
heldCredits: 0

exactRelease: true
```

Transacciones observadas:

```txt
release 150 released
reserve 150 reserved
manual_subscription_plan_credit_reset 1470 posted
opening_balance 30 posted
```

## Pruebas ejecutadas durante este modulo

```txt
node --check server/api-proxy.js
```

Resultado:

```txt
OK - sin errores de sintaxis.
```

```txt
npm run lint
```

Resultado:

```txt
OK - exit 0. Oxlint reporto warnings existentes/no fatales sobre Fast Refresh, variables sin uso y catch params.
```

```txt
npm run build
```

Resultado:

```txt
OK - Vite build completo en 868ms. Se regenero `dist/` como salida esperada del build.
```

## Commit sugerido

```txt
feat: implement double-entry credit ledger and reservations
```

---

Fecha: 2026-07-12
Proyecto: Sweet Little Trauma Studio
Modulo ejecutado: Modulo 4 - Tuberia de Moderacion Multicapa

## Diagnostico inicial breve

Los endpoints de generacion ya pasaban por gateway, jobs asincronos y ledger, pero todavia aceptaban texto de usuario sin un Input Gate previo. Eso implicaba que un prompt prohibido podia llegar a reservar creditos, crear job o intentar usar un proveedor externo antes de detectar el problema.

## Problema encontrado

### Falta de pre-moderacion sincronica

- Archivo: `server/api-proxy.js`
- Estado previo:
  - `/api/generate/image`
  - `/api/generate/video`
  - `/api/generate/music`
  - `/api/generate/sound`
  - `/api/assist`

No ejecutaban un filtro de politica antes de reservar creditos o entrar al proveedor.

Impacto:

- Riesgo de gastar creditos en prompts que proveedores externos rechacen.
- Riesgo de proteger mal claves/API accounts ante abuso.
- Riesgo de prompt injection contra instrucciones internas.

## Cambios aplicados

### 1. Input Gate sincronico

Archivo modificado:

- `server/api-proxy.js`

Se agrego `runInputModeration`, ejecutado antes de:

- `reserveCredits`
- creacion de Job
- llamada al provider gateway
- guardado de historial

Si el prompt se rechaza, el backend devuelve:

```txt
HTTP 400 Bad Request
code: moderation_rejected
```

No se mueve ningun credito y no se encola ningun job.

### 2. Moderacion local de baja latencia

Archivo modificado:

- `server/api-proxy.js`

Se agregaron reglas locales para:

- `self_harm`
- `violence`
- `hate`
- `prompt_injection`

Esto permite bloquear trafico obvio en milisegundos sin depender de red ni SDK externo.

### 3. Preparacion para OpenAI Omni Moderation

Archivo modificado:

- `server/api-proxy.js`

Se agrego `openAIModerateText` usando `fetch` nativo contra:

```txt
https://api.openai.com/v1/moderations
```

Modelo por defecto:

```txt
omni-moderation-latest
```

No se activa por defecto para evitar dependencia externa durante pruebas locales. Se habilita con:

```txt
OPENAI_MODERATION_ENABLED=true
```

o:

```txt
MODERATION_PROVIDER=openai
```

### 4. Preparacion de Output Gate

Archivo modificado:

- `server/api-proxy.js`

Se agrego `outputModerationAssessment` dentro de `completeAsyncJob`.

Cuando un job termina en `COMPLETED`, el asset queda marcado internamente con:

- `needs_review`
- `needsReview`
- `outputModeration`

Por defecto marca `needs_review: false` salvo que reglas locales detecten algo o se active:

```txt
OUTPUT_MODERATION_REVIEW_ALL=true
```

### 5. Endpoint de ledger ampliado para validacion

Archivo modificado:

- `server/api-proxy.js`

`GET /api/ledger` ahora incluye:

```txt
jobCount
```

Esto permite verificar que un prompt rechazado no creo job.

## Validacion funcional ejecutada

Se levanto servidor local con:

```txt
WEBHOOK_SECRET=test_secret PORT=3218 npm start
```

Prueba:

1. `GET /api/ledger`
2. `POST /api/generate/video` con prompt bloqueado:

```txt
teach me how to kill someone with poison
```

3. `GET /api/ledger`

Resultado observado:

```txt
HTTP status: 400
code: moderation_rejected
category: violence
latencyMs: 40

Antes:
availableCredits: 30
heldCredits: 0
transactionCount: 1
reservationCount: 0
jobCount: 0

Despues:
availableCredits: 30
heldCredits: 0
transactionCount: 1
reservationCount: 0
jobCount: 0

ledgerIntact: true
noJobQueued: true
noReservation: true
noTransaction: true
```

## Pruebas ejecutadas durante este modulo

```txt
node --check server/api-proxy.js
```

Resultado:

```txt
OK - sin errores de sintaxis.
```

```txt
npm run lint
```

Resultado:

```txt
OK - exit 0. Oxlint reporto warnings existentes/no fatales sobre Fast Refresh, variables sin uso y catch params.
```

```txt
npm run build
```

Resultado:

```txt
OK - Vite build completo en 806ms. Se regenero `dist/` como salida esperada del build.
```

## Commit sugerido

```txt
feat: implement multi-layer AI content moderation pipeline
```

---

Fecha: 2026-07-12
Proyecto: Sweet Little Trauma Studio
Modulo ejecutado: Modulo 5 - Almacenamiento Efimero y CDN

## Diagnostico inicial breve

Los webhooks de `fal` y `replicate` ya cerraban jobs asincronos, pero el resultado final guardaba directamente `outputUrl` / `outputUrls` devueltos por el proveedor. Eso dejaba el historial y proyectos atados a URLs temporales que pueden vencer o romperse.

## Cambios aplicados

- Se agrego almacenamiento local tipo CDN en `server/api-proxy.js` usando `SLT_STORAGE_DIR` o `storage/assets` por defecto, servido desde `/cdn/assets`.
- Se agrego un servicio interno de descarga y persistencia de assets que soporta URLs `https`, `data:` y placeholders locales de prueba.
- `completeAsyncJob` ahora es asincrono y guarda primero el asset antes de capturar creditos del ledger.
- Si la descarga o escritura del asset falla, el job pasa a `failed` y se llama al flujo existente de release para devolver creditos.
- Los registros de job, historial y proyecto guardan `providerOutputUrls`, `assets` y `storage`, pero exponen `outputUrl` / `outputUrls` ya reemplazados por URLs propias de `/cdn/assets`.
- Se agrego `GET /api/assets` para auditar assets persistidos.
- Se actualizo `src/hooks/useVideoChat.js` para mostrar solo URLs internas de CDN y evitar presentar URLs temporales externas en la UI de video.

## Estrategia de almacenamiento

En esta fase no se agregaron SDKs de S3/R2 porque el proyecto no tenia uno configurado. La implementacion queda compatible con una migracion posterior: basta con reemplazar la funcion de escritura local por subida a Cloudflare R2, S3 o Vercel Blob y mantener el contrato `publicUrl`.

## Regla de ledger preservada

La captura de creditos ocurre despues de persistir el archivo. Si el asset no queda guardado, no se captura saldo y la reserva se libera mediante `failAsyncJob`.

## Pruebas ejecutadas durante este modulo

```txt
node --check server/api-proxy.js
```

Resultado: OK, sin errores de sintaxis.

```txt
npm run lint
```

Resultado: OK, exit 0. Oxlint reporto warnings existentes de mantenimiento, sin errores fatales.

```txt
npm run build
```

Resultado: OK. Vite build completo en 768ms y regenero `dist/` como salida esperada.

## Validacion funcional de almacenamiento y ledger

Se levanto un servidor temporal en `http://127.0.0.1:3219` con `WEBHOOK_SECRET=test_secret` y `SLT_STORAGE_DIR=/private/tmp/slt-m5-assets`.

Caso exitoso:

- Se creo un job asincrono webhook-only con estado inicial `queued` y reserva `reserved`.
- Se envio un webhook firmado de Replicate con status `completed` y un PNG inline `data:image/png;base64,...`.
- El backend guardo el archivo en `/cdn/assets/music_job_1783849795023_0dcf14_e900b9cdbbc8.png`.
- `GET /api/jobs/:id` devolvio `job.status=completed`, `assets=1` y `outputUrl` propio de `http://127.0.0.1:3219/cdn/assets/...`.
- `GET /api/assets` devolvio 1 asset persistido con `contentType=image/png`, `bytes=68` y `status=stored`.
- La descarga del asset propio devolvio HTTP 200, `content-type=image/png` y header `X-SLT-Asset-Storage=local-cdn`.
- El ledger capturo creditos solo despues del guardado exitoso: `heldCredits=0`, `capturedCredits=150`.

Caso fallido:

- Se creo otro job webhook-only y se envio webhook `completed` con una URL temporal inaccesible.
- El backend marco el job como `failed`, con error `asset_download_failed`.
- La reserva paso a `released` y el saldo disponible volvio exactamente al valor anterior: `availableCredits=1350`, `heldCredits=0`.

## Commit sugerido

```txt
feat: implement persistent storage upload and CDN delivery for AI assets
```


---

Fecha: 2026-07-12
Proyecto: Sweet Little Trauma Studio
Modulo ejecutado: Modulo 6 - Primer Proveedor Completo de Punta a Punta

## Proveedor piloto seleccionado

Se selecciono Replicate/Flux para imagen porque el entorno historico del proyecto contiene `REPLICATE_API_TOKEN`, `REPLICATE_API_URL`, `REPLICATE_IMAGE_API_URL`, `REPLICATE_IMAGE_MODEL` y `REPLICATE_FLUX_MODEL` configurados.

## Cambios aplicados

- `image` con adaptador `replicate-image` ahora entra al flujo asincrono de Jobs cuando `sync` no es `true`.
- La solicitud a Replicate inyecta dinamicamente un webhook de Sweet Little Trauma Studio con `jobId` en query string y `webhook_events_filter: ["completed"]`.
- El webhook real puede mapear el evento por `jobId` de query, por `request_id` o por `providerJobId`.
- El parser de firma soporta headers estilo `webhook-*`, `x-replicate-*` y `svix-*`, incluyendo payload firmado como `timestamp.body` y `webhookId.timestamp.body`.
- El webhook responde HTTP 202 rapidamente y deja la descarga/storage/capture en el background para evitar reintentos innecesarios del proveedor.
- El storage usa `Authorization: Bearer REPLICATE_API_TOKEN` al descargar assets de Replicate, porque sus outputs API pueden requerir token.
- `/api/jobs/:id` tambien puede refrescar un job de imagen Replicate contra `GET /v1/predictions/:id` y cerrar el flujo si el webhook externo se retrasa.

## Condiciones necesarias para prueba real externa

Para que Replicate pueda llamar el webhook real, el backend debe correr con una URL publica HTTPS sin redirects en `PUBLIC_API_BASE_URL` o `WEBHOOK_BASE_URL`. Tambien debe existir `REPLICATE_WEBHOOK_SECRET` o `WEBHOOK_SECRET` con el secreto de firma del webhook de Replicate.

## Pruebas ejecutadas durante este modulo

```txt
node --check server/api-proxy.js
```

Resultado: OK, sin errores de sintaxis.

```txt
Replicate account check + default webhook secret endpoint check
```

Resultado: OK contra la API oficial de Replicate. El token respondio HTTP 200 en `/v1/account` y el endpoint `/v1/webhooks/default/secret` respondio HTTP 200 indicando que existe secreto de firma disponible. No se imprimio ningun secreto.

```txt
Mock local de Replicate + backend SLT temporal
```

Resultado: OK. Se levanto un mock local en `http://127.0.0.1:3220` y el backend SLT en `http://127.0.0.1:3221` con `WEBHOOK_SECRET=test_secret`, `ALLOW_LOCAL_WEBHOOK_URLS=true` y `SLT_STORAGE_DIR=/private/tmp/slt-m6-assets`.

Validacion E2E local firmada:

- `POST /api/generate/image` con provider `Flux` devolvio HTTP 202 y creo `job_1783851077686_c8b4ed`.
- El webhook configurado fue `http://127.0.0.1:3221/api/webhooks/replicate?jobId=job_1783851077686_c8b4ed`.
- El mock envio webhook firmado con status `succeeded` y output PNG inline.
- El backend acepto el webhook con HTTP 202 y proceso el asset en background.
- `GET /api/jobs/:id` devolvio `job.status=completed`, provider `Flux`, `assets=1` y URL final propia: `http://127.0.0.1:3221/cdn/assets/image_job_1783851077686_c8b4ed_e900b9cdbbc8.png`.
- `GET /api/assets` devolvio 1 asset persistido con `contentType=image/png`, `bytes=68`, `status=stored`.
- La descarga de la URL propia devolvio HTTP 200, `content-type=image/png` y header `X-SLT-Asset-Storage=local-cdn`.
- El ledger paso de reserva a captura: `availableCredits=20`, `heldCredits=0`, `capturedCredits=10`.

## Bloqueo de prueba externa real

No se ejecuto una generacion real externa contra Replicate porque esta Mac no tiene `cloudflared` ni `ngrok`, y el `.env` historico no contiene `PUBLIC_API_BASE_URL`, `WEBHOOK_BASE_URL`, `REPLICATE_WEBHOOK_SECRET` ni `WEBHOOK_SECRET`. Replicate necesita una URL publica HTTPS sin redirects para llamar el webhook real. El codigo ya valida esa condicion y devuelve error claro si se intenta usar localhost sin `ALLOW_LOCAL_WEBHOOK_URLS=true`.

```txt
npm run lint
```

Resultado: OK, exit 0. Oxlint reporto warnings existentes de mantenimiento, sin errores fatales.

```txt
npm run build
```

Resultado: OK. Vite build completo en 758ms y regenero `dist/` como salida esperada.

## Commit sugerido

```txt
feat: end-to-end integration for primary image provider
```


---

Fecha: 2026-07-12
Proyecto: Sweet Little Trauma Studio
Modulo ejecutado: Modulo 7 - Interfaz, Feedback y Estado Asincrono

## Cambios aplicados

- `src/lib/api-client.js` ahora reconoce la respuesta asincrona real del backend (`accepted`, `jobId`, `job.status`) y expone `extractOutputUrl()` para leer URLs finales desde `job.outputUrl/outputUrls`, `historyItem.result` o `project.result`.
- `src/hooks/useStudioGenerate.js` mantiene `generating=true` durante el polling, mapea estados `queued/processing/completed/failed`, expone `assetUrl`, `jobStatus`, `jobId` y `error`, y refresca `/api/ledger` al llegar a estado terminal.
- `src/context/StudioContext.jsx` agrega `refreshLedger()` y sincroniza creditos disponibles/retenidos con `localStorage`.
- `src/App.jsx` monta `StudioProvider` para que la barra superior y los estudios puedan reaccionar al ledger.
- `src/components/Navbar.jsx` y `src/components/Navbar.css` muestran el saldo de creditos disponible en la barra superior sin cambiar la navegacion.
- `src/pages/ImageStudio.jsx`, `src/pages/VideoStudio.jsx`, `src/pages/MusicStudio.jsx` y `src/pages/SoundStudio.jsx` renderizan el asset final cuando el job completa y muestran feedback de cola/error sin alterar el layout base.
- `src/pages/StudioLayout.css` agrega estilos de feedback asincrono y media output reutilizables.

## Criterio de aceptacion cubierto por codigo

- El frontend captura Job ID de HTTP 202 y consulta `/api/jobs/:jobId`.
- Los estados de cola/generacion/error se muestran en la UI existente.
- El asset final se lee desde `outputUrl/outputUrls`, incluyendo rutas propias `/cdn/assets/...` cuando el backend ya las persistio.
- El saldo visible se refresca contra `/api/ledger` al completar o fallar una generacion.
- Los rechazos HTTP 400/402 se convierten en mensajes claros y detienen loaders.

## Pruebas ejecutadas durante este modulo

```txt
node --check server/api-proxy.js
```

Resultado: OK, sin errores de sintaxis.

```txt
npm run lint
```

Resultado: OK, exit 0. Oxlint reporto warnings existentes de mantenimiento en `server/api-proxy.js` y warnings `react(only-export-components)` en contextos, sin errores fatales.

```txt
npm run build
```

Resultado: OK. Vite build completo en 940ms y regenero `dist/` como salida esperada.

## Commit sugerido

```txt
feat: connect frontend UI to async job states and reactive ledger
```


---

Fecha: 2026-07-12
Proyecto: Sweet Little Trauma Studio
Modulo ejecutado: Modulo 8 - Pagos, Suscripciones y Recarga de Creditos

## Cambios aplicados

- `server/api-proxy.js` conserva la logica de facturacion en backend y agrega el alias canonico `/api/webhooks/stripe` junto a `/api/stripe/webhook`.
- El webhook de Stripe ahora verifica firma HMAC con tolerancia temporal y solo permite omitir firma en local mediante `STRIPE_WEBHOOK_ALLOW_UNSIGNED=true` o `ALLOW_UNSIGNED_STRIPE_WEBHOOKS=true`.
- Se agrego idempotencia de eventos de pago con clave `stripe:event_id`/objeto Stripe antes de modificar ledger, para ignorar reintentos duplicados.
- `checkout.session.completed` y `checkout.session.async_payment_succeeded` procesan credit packs con `grantCredits()` y suscripciones con ajuste de allowance de plan.
- `invoice.paid` e `invoice.payment_succeeded` registran factura pagada y aplican allowance de suscripcion de forma idempotente.
- Las sesiones Checkout incluyen metadata de plan, creditos y usuario para reconciliacion futura.
- Se agregaron aliases de checkout `/api/billing/checkout` y `/api/billing/credits/checkout`, manteniendo compatibilidad con `/api/stripe/checkout` y `/api/stripe/credits/checkout`.
- `/api/billing` y `/api/ledger` ahora exponen `paymentEvents` recientes para auditoria.
- `src/lib/api-client.js` apunta los flujos frontend a las rutas `/api/billing/...`.

## Criterio de aceptacion cubierto por codigo

- El pago confirmado por Stripe desemboca en movimientos del Ledger mediante `grantCredits()` o `adjustAvailableCredits()`.
- Un webhook duplicado con el mismo ID queda marcado como `duplicate_ignored` y no duplica creditos ni facturas.
- Las claves secretas de Stripe permanecen solo en backend.
- La prueba local puede usar JSON sin firma solamente con flag explicito de desarrollo.

## Pruebas ejecutadas durante este modulo

```txt
node --check server/api-proxy.js
```

Resultado: OK, sin errores de sintaxis.

```txt
npm run lint
```

Resultado: OK, exit 0. Oxlint reporto warnings existentes de mantenimiento en `server/api-proxy.js` y warnings `react(only-export-components)` en contextos, sin errores fatales.

```txt
npm run build
```

Resultado: OK. Vite build completo y regenero `dist/` como salida esperada.

Simulacion local de webhook Stripe:

- Primer envio `checkout.session.completed` de credit pack: procesado, creditos otorgados al ledger.
- Segundo envio con el mismo evento: `duplicate_ignored`, sin duplicar creditos.

## Commit sugerido

```txt
feat: implement subscription handling and secure payment webhooks
```


---

Fecha: 2026-07-12
Proyecto: Sweet Little Trauma Studio
Modulo ejecutado: Modulo 9 - Auditoria de Seguridad y Proteccion de Endpoints

## Vulnerabilidades encontradas y corregidas

- Critico: `getAuth()` aceptaba sesiones mock basadas en `x-slt-user-id` cuando no existia token real. Un atacante podia inyectar un header y operar rutas de generacion, ledger o billing como otro usuario. Se reemplazo por validacion estricta de sesion `x-slt-session` o `Authorization: Bearer`.
- Critico: `requestIdentity()` usaba `x-slt-user-id` para identidad/rate limiting/ledger. Se elimino esa confianza; ahora solo usa sesion validada o IP anonima.
- Alto: rutas criticas (`/api/generate/*`, `/api/ledger`, `/api/jobs/*`, billing, subscription, user, projects/history y studio run) no tenian un guard server-side centralizado. Se agrego middleware de autenticacion antes de ejecutar logica de creditos/proveedores.
- Alto: `POST /api/subscription` permitia mutaciones locales de plan y creditos sin pasar por Stripe. Ahora las mutaciones requieren CEO mode; usuarios normales deben usar checkout/portal.
- Alto: `POST /api/user` aceptaba campos arbitrarios del body, incluyendo posibles cambios de `role`, `plan`, `credits` o `id`. Se reemplazo por whitelist de perfil.
- Medio: jobs, proyectos, historial, assets y ledger eran colecciones globales in-memory. Se agrego `tenantId` a nuevos registros y filtros server-side por sesion. Los registros legacy sin tenant se tratan como datos del `demo-user`; CEO puede ver todo.
- Medio: `/api/jobs/:jobId` permitia polling directo de IDs de proveedor sin pertenencia local. Ahora el polling de jobs externos no registrados requiere CEO mode.
- Medio: se reforzo rate limiting por clase de ruta: auth, generacion y billing tienen limites separados.

## Protecciones aplicadas

- Middleware `authProtectionMiddleware()` rechaza rutas sensibles con HTTP 401 si no existe sesion real.
- Rutas CEO/internal (`/api/ceo/*` y `/api/assets`) requieren rol propietario/CEO.
- Webhooks de proveedores se mantienen publicos pero firmados con HMAC y tolerancia anti-replay.
- Webhooks de Stripe se mantienen con firma `Stripe-Signature`; solo se permite modo unsigned en local con flag explicito.
- Los metadatos de checkout ahora toman usuario desde sesion validada, no desde headers controlados por frontend.

## Limitaciones conocidas

- No existe una base de datos real ni ORM en este repo; el estado actual sigue siendo in-memory en `server/api-proxy.js`. Por eso no se pudo implementar RLS de Supabase/Postgres. Se implemento aislamiento equivalente en servidor para esta arquitectura local, pero CODEX DEBE VERIFICARLO al migrar a una DB real.
- El login estandar sigue siendo una sesion local de desarrollo. Para produccion debe reemplazarse por un proveedor real de Auth con passwords/OAuth, expiracion de sesiones y rotacion de tokens.

## Pruebas ejecutadas durante este modulo

```txt
node --check server/api-proxy.js
```

Resultado: OK, sin errores de sintaxis.

```txt
npm run lint
```

Resultado: OK, exit 0. Oxlint reporto warnings existentes de mantenimiento, sin errores fatales.

```txt
npm run build
```

Resultado: OK. Vite build completo en 975ms y regenero `dist/` como salida esperada.

```txt
PORT=3339 node server/api-proxy.js
```

Resultado: servidor local levantado para pruebas de seguridad en `http://127.0.0.1:3339`.

```txt
curl -i http://127.0.0.1:3339/api/ledger
```

Resultado: HTTP 401 `auth_required`. El ledger no filtra datos sin sesion.

```txt
curl -i -X POST http://127.0.0.1:3339/api/generate/image \
  -H 'x-slt-user-id: victim-user'
```

Resultado: HTTP 401 `auth_required`. El header `x-slt-user-id` ya no autoriza generaciones.

```txt
curl -i http://127.0.0.1:3339/api/ledger \
  -H 'Authorization: Bearer <session_token>' \
  -H 'x-slt-user-id: victim-user'
```

Resultado: HTTP 200 con `auth.userId=demo-user`. La sesion validada prevalece sobre el header inyectado.

```txt
curl -i -X POST http://127.0.0.1:3339/api/subscription \
  -H 'Authorization: Bearer <session_token>' \
  -d '{"action":"upgrade","plan":"Film Lab"}'
```

Resultado: HTTP 403 `subscription_mutation_forbidden`. Un usuario estandar no puede modificar plan/creditos sin checkout o CEO mode.

```txt
curl -i -X POST http://127.0.0.1:3339/api/user \
  -H 'Authorization: Bearer <session_token>' \
  -d '{"role":"CEO","credits":999999,"plan":"Film Lab","username":"safe-name"}'
```

Resultado: HTTP 200, pero el servidor ignoro `role`, `credits` y `plan`; solo guardo `username`.

```txt
curl -i http://127.0.0.1:3339/api/assets \
  -H 'Authorization: Bearer <session_token>'
```

Resultado: HTTP 403 `forbidden`. El endpoint interno de assets no queda publico para usuarios estandar.

## Commit sugerido

```txt
fix: implement server-side auth validation, RLS, and rate limiting
```


---

Fecha: 2026-07-12
Proyecto: Sweet Little Trauma Studio
Modulo ejecutado: Modulo 10 - Pruebas Automatizadas y Validacion Continua

## Cambios aplicados

- `package.json` incorpora el script `npm run test` usando el runner nativo `node --test`, sin dependencias nuevas ni llamadas de red reales.
- `server/api-proxy.js` ahora soporta `SLT_TEST_MODE=1` para importar el servidor sin abrir puerto durante tests.
- `server/api-proxy.js` exporta helpers internos bajo `__test` para validar rutas criticas, ledger, moderacion, webhooks, firmas e idempotencia sin exponer secretos ni invocar proveedores reales.
- `tests/core-flows.test.js` agrega cobertura automatizada para seguridad, moderacion, ledger, gateway fallback, webhooks de proveedores, storage local y Stripe.

## Cobertura critica agregada

- Seguridad: rutas criticas rechazan solicitudes sin sesion y no aceptan `x-slt-user-id` como identidad.
- Moderacion: un prompt toxico queda bloqueado antes de reservar creditos; el ledger permanece intacto.
- Ledger: `reserveCredits`, `capture` y `release` conservan saldos exactos.
- Gateway: si el proveedor primario simula HTTP 503, el enrutador cae al fallback conectado y registra la ruta.
- Provider webhooks: firma HMAC valida, webhook `COMPLETED` guarda asset en storage local/CDN, captura creditos y rechaza duplicados por idempotencia.
- Stripe: firma `Stripe-Signature` valida/invalida, `checkout.session.completed` otorga creditos y el duplicado no duplica saldo.

## Nota pendiente del modulo de pagos

- Se completo la documentacion de la simulacion local de Stripe del Modulo 8: primer webhook de credit pack procesa creditos; segundo webhook con el mismo evento queda como `duplicate_ignored`.

## Pruebas ejecutadas durante este modulo

```txt
node --check server/api-proxy.js
```

Resultado: OK, sin errores de sintaxis.

```txt
node --check tests/core-flows.test.js
```

Resultado: OK, sin errores de sintaxis.

```txt
npm run test
```

Resultado: OK. `node --test` ejecuto 6 tests, 6 pass, 0 fail.

```txt
npm run lint
```

Resultado: OK, exit 0. Oxlint reporto warnings existentes de mantenimiento, sin errores fatales.

```txt
npm run build
```

Resultado: OK. Vite build completo en 1.14s y regenero `dist/` como salida esperada.

```txt
git diff --check
```

Resultado: OK, sin whitespace errors.

## Commit sugerido

```txt
test: implement automated test suite for core billing, security and generation flows
```


---

Fecha: 2026-07-12
Proyecto: Sweet Little Trauma Studio
Modulo ejecutado: Modulo 11 - Proveedores Multimodales y Modulos Creativos

## Cambios aplicados

- `server/api-proxy.js` amplia el catalogo de proveedores con metadata multimodal: ejecucion sincrona/asincrona, soporte de webhooks, modelo por defecto, modelos alternativos y perfil de pricing.
- Se agregan perfiles realistas para Runway video (`gen4_turbo`, `gen4.5`), Kling video (`kling-v3-standard`, `kling-omni` con estimacion interna), Suno musica (`suno-v5.5` preparado), ElevenLabs voz (`eleven_flash_v2_5`, `eleven_multilingual_v2`) y proveedores 3D preparados (`Meshy`, `Tripo3D`).
- El estimador de creditos deja de ser fijo para multimedia: video cobra por segundos, ElevenLabs TTS cobra por caracteres, musica/3D cobra por unidad de track/asset.
- `validateCredits` ahora recibe el payload real de la generacion para reservar creditos segun proveedor, modelo, duracion y texto.
- `providerStatus` expone metadata segura de modelo, pricing y ejecucion sin exponer secretos.
- `VideoStudio.jsx` muestra proveedor/modelo/costo por segundo y envia `model/modelId` al gateway.
- `ImageStudio.jsx` elimina proveedores no mapeados en backend como si estuvieran conectados (`Adobe Firefly`, `Magnific`) y usa nombres reales del catalogo.
- `MusicStudio.jsx` separa proveedores listos de proveedores preparados: `SLT Composer` queda como ruta segura; Suno/Udio/ElevenLabs Music quedan visibles pero bloqueados hasta tener endpoint real.
- `SoundStudio.jsx` muestra modelos reales/estado por proveedor y envia el proveedor seleccionado al gateway.
- `FashionStudio.jsx` y `EngineeringLab.jsx` dejan de exponer formularios de generacion mock. Ahora muestran un estado premium de `Coming Soon` con acciones deshabilitadas.
- `StudioLayout.css` agrega estilos discretos para proveedores preparados, modelos, estados bloqueados y nota de pricing de video.
- `tests/core-flows.test.js` agrega cobertura para estimacion variable de creditos multimodales.

## Decisiones tomadas

- Runway usa pricing oficial por segundo como referencia directa.
- ElevenLabs voz usa modelo Flash v2.5 por defecto por baja latencia; Multilingual v2 queda disponible por variable `ELEVENLABS_MODEL_ID`.
- Suno queda registrado como proveedor preparado porque el sitio publico documenta el producto, pero no se encontro una API oficial directa estable para ejecutar en este backend.
- Kling queda con modelo/costo estimado interno porque no se valido una fuente oficial de pricing/API equivalente durante esta fase.
- Fashion, Games, Apps y Engineering no se inventaron: quedan bloqueados visualmente hasta que exista flujo real de backend, precios y cola.

## Pruebas ejecutadas durante este modulo

```txt
node --check server/api-proxy.js
```

Resultado: OK, sin errores de sintaxis.

```txt
node --check tests/core-flows.test.js
```

Resultado: OK, sin errores de sintaxis.

```txt
npm run test
```

Resultado: OK. `node --test` ejecuto 7 tests, 7 pass, 0 fail. Se agrego cobertura para pricing multimodal variable.

```txt
npm run lint
```

Resultado: OK, exit 0. Oxlint mantiene warnings existentes de mantenimiento, sin errores fatales.

```txt
npm run build
```

Resultado: OK. Vite build completo en 1.10s y regenero `dist/`.

```txt
git diff --check
```

Resultado: OK, sin whitespace errors.

## Commit sugerido

```txt
feat: map multimodal providers and lock pending creative modules
```


---

Fecha: 2026-07-12
Proyecto: Sweet Little Trauma Studio
Modulo ejecutado: Modulo 12 - Documentacion final de arquitectura y checklist

## Cambios aplicados

- Se creo `SYSTEM-FLOW-CURRENT.md` para documentar el diagnostico historico: como funcionaban realmente los modulos antes de las reparaciones, donde se cortaban los flujos y que riesgos existian.
- Se creo `SYSTEM-FLOW-TARGET.md` para documentar la arquitectura objetivo real construida en el repositorio: gateway, jobs asincronos, webhooks, ledger, moderacion, storage/CDN local, seguridad, pagos, tests y modulos bloqueados.
- Se creo `CHECKLIST-FINAL.md` para consolidar criterios de aceptacion, estado final, riesgos restantes y Go/No-Go antes de produccion publica.
- No se modifico ningun archivo JS, JSX, CSS ni logica de aplicacion durante este modulo.

## Decisiones documentadas

- La documentacion refleja el codigo real: backend Express unico, frontend React/Vite, estado in-memory y storage local/configurable.
- Se deja explicitado que el patron profesional esta implementado, pero que DB real, storage bucket real y auth productiva siguen siendo requisitos antes de lanzamiento publico.
- Se confirma que los modulos sin backend real no se inventaron: quedan como `Coming Soon`.

## Pruebas ejecutadas durante este modulo

```txt
npm run lint
```

Resultado: OK, exit 0. Oxlint reporto warnings existentes de mantenimiento, sin errores fatales.

```txt
npm run test
```

Resultado: primer intento en paralelo fallo 1 test por timing async (`IN_PROGRESS` antes de `COMPLETED`); repeticion aislada inmediata OK con 7 tests, 7 pass, 0 fail.

Revalidacion final: OK con 7 tests, 7 pass, 0 fail.

```txt
npm run build
```

Resultado: OK. Vite build completo en 863ms.

Revalidacion final: OK. Vite build completo en 934ms.

## Commit sugerido

```txt
docs: finalize system architecture diagrams, target flow, and ultimate checklist
```


---

Fecha: 2026-07-12
Proyecto: Sweet Little Trauma Studio
Revalidacion solicitada: Modulos 1 a 6 - Gateway, async jobs, ledger, moderacion, storage/CDN y proveedor piloto

## Resultado de inspeccion

- No se hicieron cambios de codigo en esta revalidacion.
- El repositorio ya contiene la implementacion pedida para los modulos 1 a 6:
  - `ProviderAdapter`, `runProviderGateway` y `providerFallbackChains`.
  - Jobs asincronos con estados `IN_QUEUE`, `IN_PROGRESS`, `COMPLETED`, `FAILED`.
  - Webhooks firmados para `fal`, `replicate` y Stripe.
  - Ledger con `reserveCredits`, `resolveReservation`, capture y release.
  - Input Gate de moderacion antes de reservar creditos.
  - Output Gate preparado con `needs_review`.
  - Storage local/CDN configurable con salida `/cdn/assets/...`.
  - Integracion piloto de Replicate con webhook dinamico y modo simulado/test.

## Comandos ejecutados

```txt
node --check server/api-proxy.js
node --check tests/core-flows.test.js
npm run lint
npm run test
npm run build
```

## Resultados

- `node --check server/api-proxy.js`: OK.
- `node --check tests/core-flows.test.js`: OK.
- `npm run lint`: OK, exit 0, con warnings existentes de mantenimiento.
- `npm run test`: OK, 7 tests, 7 pass, 0 fail.
- `npm run build`: OK, Vite build completo en 955ms.

## Commit sugerido si se desea guardar esta revalidacion

```txt
docs: confirm gateway async ledger moderation storage pipeline validation
```


---

Fecha: 2026-07-12
Proyecto: Sweet Little Trauma Studio
Revalidacion solicitada: Modulos 7 a 12 - UI async, billing, seguridad, tests, proveedores multimodales y documentacion final

## Resultado de inspeccion

- No se hicieron cambios de codigo fuente en esta revalidacion.
- El repositorio ya contiene la implementacion pedida para los modulos 7 a 12:
  - Frontend conectado a jobs asincronos mediante `extractAsyncJob()`, `pollJob()` y `useStudioGenerate()`.
  - Refresh del ledger visible mediante `StudioProvider`, `refreshLedger()` y persistencia local del snapshot.
  - Billing/checkout en backend con rutas `/api/billing/checkout`, `/api/billing/credits/checkout`, `/api/stripe/webhook` y `/api/webhooks/stripe`.
  - Webhook Stripe firmado, idempotencia de eventos y otorgamiento de creditos por Ledger.
  - Auth server-side centralizado, aislamiento por identidad validada y rate limiting por rutas criticas.
  - Pruebas automatizadas para auth, moderacion, pricing multimodal, ledger, fallback, webhooks de providers, storage y Stripe.
  - Providers multimodales mapeados para imagen, video, musica, voz/audio y 3D.
  - Modulos no funcionales bloqueados visualmente con estado `Coming Soon`.
  - Documentacion final creada en `SYSTEM-FLOW-CURRENT.md`, `SYSTEM-FLOW-TARGET.md` y `CHECKLIST-FINAL.md`.

## Comandos ejecutados

```txt
node --check server/api-proxy.js
node --check tests/core-flows.test.js
npm run lint
npm run test
npm run build
```

## Resultados

- `node --check server/api-proxy.js`: OK.
- `node --check tests/core-flows.test.js`: OK.
- `npm run lint`: OK, exit 0, con warnings existentes de mantenimiento.
- `npm run test`: OK, 7 tests, 7 pass, 0 fail.
- `npm run build`: OK, Vite build completo en 756ms.

## Estado final

El plan tecnico de reparacion e implementacion queda revalidado hasta el Modulo 12. El patron profesional esta implementado y probado localmente: gateway, jobs, polling, webhooks, ledger, storage/CDN local, billing, seguridad, tests, proveedores multimodales y documentacion final.

Para produccion publica, se mantiene la advertencia documentada: migrar estado in-memory a base de datos durable, conectar auth productiva y configurar storage/CDN real.

## Commit sugerido si se desea guardar esta revalidacion

```txt
docs: confirm modules 7-12 final validation
```


---

Fecha: 2026-07-12
Proyecto: Sweet Little Trauma Studio
Revalidacion del adjunto: Modulos 7 a 12 - cierre full-stack

## Resultado

- El contenido solicitado por el adjunto ya esta implementado en el repositorio real.
- No se modificaron archivos de codigo fuente durante esta pasada.
- Se verifico nuevamente:
  - UI asincrona con polling y refresh de ledger.
  - Billing/checkout y webhooks Stripe firmados e idempotentes.
  - Auth server-side, aislamiento por identidad validada y rate limiting.
  - Tests nativos con mocks sin consumo de proveedores reales.
  - ProviderAdapter multimodal con video, musica, voz/audio y 3D.
  - Modulos no reales bloqueados visualmente como `Coming Soon`.
  - Documentacion final `SYSTEM-FLOW-CURRENT.md`, `SYSTEM-FLOW-TARGET.md` y `CHECKLIST-FINAL.md`.

## Comandos ejecutados

```txt
node --check server/api-proxy.js
node --check tests/core-flows.test.js
npm run lint
npm run test
npm run build
```

## Resultados

- `node --check server/api-proxy.js`: OK.
- `node --check tests/core-flows.test.js`: OK.
- `npm run lint`: OK, exit 0, con warnings existentes no bloqueantes.
- `npm run test`: OK, 7 tests, 7 pass, 0 fail.
- `npm run build`: OK, Vite build completo en 870ms.

## Commit sugerido

```txt
feat: finalize full-stack AI integration, billing, security, and documentation
```

---

Fecha: 2026-07-12
Proyecto: Sweet Little Trauma Studio
Intervencion: UI funcional completa + preparacion honesta de infraestructura productiva

## Archivos modificados

- `server/api-proxy.js`
  - Se agregaron helpers testeables para uploads, assets y formularios.
  - `/api/assets` lista assets filtrados por identidad.
  - `/api/assets/upload` y `/api/uploads/reference` guardan referencias locales con validacion MIME/tamano.
  - `/api/assets/:assetId/download` descarga assets propios.
  - `DELETE /api/assets/:assetId` elimina asset propio y archivo local.
  - `/api/forms/:kind` y `/api/contact` guardan solicitudes estructuradas con validacion.
- `src/lib/api-client.js`
  - Cliente para upload, listado/borrado de assets, download URL y forms.
- `src/components/ReferenceUploader.jsx`
  - Componente reutilizable para imagen, video, audio, musica y referencias.
- `src/pages/ImageStudio.jsx`, `VideoStudio.jsx`, `MusicStudio.jsx`, `SoundStudio.jsx`
  - Uploads de referencia conectados al payload de generacion.
- `src/pages/ContactPage.jsx`
  - Formulario real para contacto, soporte, careers, ventas, bugs, sugerencias, cancelaciones y recovery.
- `src/pages/LibraryPage.jsx`
  - Libreria de assets con preview, download y delete.
- `src/App.jsx`, `src/components/Navbar.jsx`, `src/pages/InfoPage.jsx`
  - Ruta y navegacion de Library.
- `src/pages/StudioLayout.css`
  - Estados visuales para uploader y library.
- `tests/core-flows.test.js`
  - Tests de upload/aislamiento tenant y formularios.
- `.env.example`
  - Variables productivas vacias para DB, Auth, Storage, Stripe y providers.

## Documentacion agregada

- `UI-FUNCTION-INVENTORY.md`
- `FULL-FUNCTIONAL-AUDIT.md`
- `USER-FLOWS-FINAL.md`
- `PRODUCTION-INFRASTRUCTURE.md`
- `DATABASE-SCHEMA.md`
- `AUTH-FLOW.md`
- `STORAGE-FLOW.md`
- `MIGRATION-GUIDE.md`
- `migrations/001_production_schema.sql`
- `migrations/001_production_schema.down.sql`

## Decision tecnica importante

No se declaro produccion publica porque el repositorio todavia depende de estado in-memory para usuarios, sesiones, jobs, ledger, forms y metadata de assets. La infraestructura productiva queda documentada y preparada para conectar cuando existan credenciales/proveedor real.

## Comandos a ejecutar para cierre

```txt
node --check server/api-proxy.js
node --check tests/core-flows.test.js
npm run lint
npm run test
npm run build
git diff --check
```

## Resultados ejecutados

- `node --check server/api-proxy.js`: OK.
- `node --check tests/core-flows.test.js`: OK.
- `npm run lint`: OK, exit 0. Quedan warnings existentes no bloqueantes de mantenimiento.
- `npm run test`: OK, 9 tests, 9 pass, 0 fail.
- `npm run build`: OK, Vite build completo en 418ms.
- `git diff --check`: OK, sin whitespace errors.

## Commit sugerido

```txt
feat: complete functional UI flows and production infrastructure docs
```

---

Fecha: 2026-07-12
Proyecto: Sweet Little Trauma Studio
Intervencion: guardia de infraestructura real de produccion

## Contexto

El adjunto exige reemplazar memoria/local/auth mock por Postgres/Auth/Storage reales. Se inspecciono el repo y no existe `.env` en `/Users/sweetlittletrauma/slt-studio-v2`; por lo tanto no hay `DATABASE_URL`, proveedor Auth ni Storage externo configurados en esta maquina.

## Cambios realizados

- Se agrego `server/production-infrastructure.js`.
- Se integro `assertProductionInfrastructureReady()` en `server/api-proxy.js`.
- `/health` ahora devuelve `infrastructure` con readiness de DB/Auth/Storage/Webhook sin imprimir secretos.
- Se exporto `getProductionReadinessReport` para tests.
- `.env.example` se actualizo con:
  - `SLT_REQUIRE_PRODUCTION_INFRASTRUCTURE`
  - `AUTH_SECRET`
  - `PUBLIC_APP_URL`
  - `WEBHOOK_BASE_URL`
  - `STORAGE_ACCESS_KEY`
  - `STORAGE_SECRET_KEY`
- `tests/core-flows.test.js` ahora valida que produccion falsa quede marcada como incompleta y que un set de variables minimo quede ready.

## Limitacion pendiente

La fase no puede marcarse como aceptada completamente porque aun no hay infraestructura externa real. El codigo ahora evita declararla lista por accidente.

## Verificacion ejecutada

```txt
node --check server/api-proxy.js
node --check server/production-infrastructure.js
node --check tests/core-flows.test.js
npm run lint
npm run test
npm run build
git diff --check
curl -sS http://127.0.0.1:3000/health
```

## Resultados

- `node --check server/api-proxy.js`: OK.
- `node --check server/production-infrastructure.js`: OK.
- `node --check tests/core-flows.test.js`: OK.
- `npm run lint`: OK, exit 0, con warnings existentes no bloqueantes.
- `npm run test`: OK, 10 tests, 10 pass, 0 fail.
- `npm run build`: OK, Vite build completo en 642ms.
- `git diff --check`: OK.
- `/health`: OK, muestra `infrastructure.ok=false` y `missing=["database","auth","storage","webhook"]` en modo development compatible.

## Commit sugerido

```txt
chore: add production infrastructure readiness guard
```

---

Fecha: 2026-07-12
Proyecto: Sweet Little Trauma Studio
Intervencion: PostgreSQL RuntimeStore y migracion durable inicial

## Inspeccion previa

- No existe Prisma.
- No existe Drizzle.
- No existe Supabase configurado.
- No existe Neon configurado.
- No existia driver `pg`.
- No existe `.env` local con `DATABASE_URL`.
- La Mac no tiene `psql`, `postgres`, `pg_ctl`, Docker ni Homebrew.

## Cambios realizados

- Se instalo `pg`.
- Se agrego `server/postgres-store.js`.
- Se agrego `scripts/migrate-postgres.js`.
- Se agrego script `npm run db:migrate`.
- `server/api-proxy.js` ahora crea `PostgresRuntimeStore` si hay `DATABASE_URL`.
- Al arrancar, el store ejecuta `migrations/001_production_schema.sql`.
- Al arrancar, intenta hidratar estado desde PostgreSQL.
- En mutaciones `/api/*`, persiste state a PostgreSQL cuando el store durable esta activo.
- `/health` ahora incluye `dataStore`.
- Se agrego `/api/db/status` protegido por owner/CEO.
- La migracion ahora incluye:
  - `sessions`
  - `credit_reservations`
  - `providers`
  - `models`
  - `runtime_state_snapshots`

## Limitacion de aceptacion

No se declara fase terminada porque el criterio "datos sobreviven reinicio del servidor" requiere un PostgreSQL real. En esta maquina no hay servidor Postgres ni `DATABASE_URL`.

## Comandos ejecutados hasta ahora

```txt
which psql
which postgres
which pg_ctl
which docker
which brew
npm ls pg
npm install pg
node --check server/api-proxy.js
node --check server/postgres-store.js
node --check scripts/migrate-postgres.js
node --check server/production-infrastructure.js
node --check tests/core-flows.test.js
npm run test
npm run lint
npm run build
git diff --check
curl -sS http://127.0.0.1:3000/health
```

## Resultados

- `psql/postgres/pg_ctl/docker/brew`: no instalados.
- `npm install pg`: OK, 14 packages, 0 vulnerabilities.
- `node --check`: OK.
- `npm run test`: OK, 10 tests, 10 pass.
- `npm run lint`: OK, exit 0, warnings existentes no bloqueantes.
- `npm run build`: OK, Vite build completo en 767ms.
- `git diff --check`: OK.
- `/health`: OK. Muestra `dataStore.kind="memory"` y `dataStore.durable=false` porque no hay `DATABASE_URL`.

## Pendiente para cerrar aceptacion

1. Crear o proveer `DATABASE_URL` real.
2. Iniciar backend con `DATABASE_URL`.
3. Crear usuario/proyecto/job/asset/form.
4. Reiniciar servidor.
5. Confirmar lectura de los datos persistidos.

---

Fecha: 2026-07-12
Proyecto: Sweet Little Trauma Studio
Intervencion: migracion productiva Supabase DB/Auth/Storage/RLS preparada

## Cambios realizados

- Se instalo `@supabase/supabase-js`.
- Se agrego `server/supabase-service.js`.
- `AUTH_PROVIDER=supabase` activa validacion JWT server-side con `SUPABASE_JWT_SECRET`.
- `/api/login` delega a Supabase Auth cuando el provider es Supabase.
- Se agregaron:
  - `POST /api/auth/signup`
  - `POST /api/auth/password-recovery`
- `storeProviderAsset()` y `storeUploadedReferenceAsset()` suben a Supabase Storage cuando `STORAGE_PROVIDER=supabase`.
- `DELETE /api/assets/:assetId` purga Supabase Storage si el asset tiene `storageKey`.
- `/health` ahora informa `storage.kind`, `storage.durable`, `storage.configured` y bucket.
- Se agrego `migrations/002_supabase_rls.sql`.
- Se agrego tabla `support_tickets`.
- Se agrego `scripts/verify-supabase-persistence.js`.
- Se agrego script `npm run db:verify-persistence`.
- `npm run db:migrate` ahora ejecuta todas las migraciones `.sql` en orden.

## Variables Supabase requeridas

```txt
DATABASE_URL=
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_JWT_SECRET=
AUTH_PROVIDER=supabase
STORAGE_PROVIDER=supabase
STORAGE_BUCKET=slt-assets
WEBHOOK_BASE_URL=
```

## Prueba pendiente

No se pudo ejecutar `npm run db:migrate` ni `npm run db:verify-persistence` porque esta Mac no tiene `.env` con `DATABASE_URL` ni credenciales Supabase.

## Verificacion ejecutada

```txt
node --check server/api-proxy.js
node --check server/supabase-service.js
node --check server/postgres-store.js
node --check scripts/migrate-postgres.js
node --check scripts/verify-supabase-persistence.js
node --check tests/core-flows.test.js
npm run test
npm run lint
npm run build
git diff --check
curl -sS http://127.0.0.1:3000/health
```

## Resultados

- `node --check`: OK.
- `npm run test`: OK, 11 tests, 11 pass.
- `npm run lint`: OK, exit 0, warnings existentes no bloqueantes.
- `npm run build`: OK, Vite build completo.
- `git diff --check`: OK.
- `/health`: OK. Muestra Supabase requerido pero no configurado:
  - `infrastructure.missing=["database","auth","storage","webhook"]`
  - `dataStore.kind="memory"`
  - `storage.kind="local"`

## Aceptacion pendiente

La migracion Supabase queda implementada en codigo, pero no activada. Para cerrar aceptacion se requiere pegar `.env` real de Supabase y ejecutar:

```txt
npm run db:migrate
npm run db:verify-persistence
```

## Commit sugerido

```txt
feat: migrate production infrastructure to Supabase
```

## Ajuste final de arquitectura Supabase

- `server/supabase-service.js` separa cliente admin (`SUPABASE_SERVICE_ROLE_KEY`) de cliente de usuario (`SUPABASE_ANON_KEY`).
- `/api/login` usa el cliente anon de Supabase para `signInWithPassword`.
- El service role queda reservado para tareas server-side: signup admin, storage y operaciones internas.
- Los assets guardados en Supabase Storage usan prefijo por tenant: `<tenantId>/<YYYY-MM-DD>/<asset>`.

## Verificacion final actualizada

```txt
node --check server/api-proxy.js
node --check server/supabase-service.js
node --check server/postgres-store.js
node --check scripts/migrate-postgres.js
node --check scripts/verify-supabase-persistence.js
node --check tests/core-flows.test.js
npm run test
npm run lint
npm run build
npm run db:migrate
npm run db:verify-persistence
git diff --check
```

## Resultados finales actualizados

- `node --check`: OK.
- `npm run test`: OK, 11 tests, 11 pass.
- `npm run lint`: OK, exit 0, warnings existentes no bloqueantes.
- `npm run build`: OK, Vite build completo.
- `git diff --check`: OK.
- `npm run db:migrate`: bloqueado correctamente porque falta `DATABASE_URL`.
- `npm run db:verify-persistence`: bloqueado correctamente porque falta `DATABASE_URL`.

## Estado real de aceptacion

La migracion a Supabase esta implementada en codigo y lista para activar, pero no puede declararse completamente probada en nube hasta pegar las variables reales de Supabase en `.env` y ejecutar:

```txt
npm run db:migrate
npm run db:verify-persistence
```

## Activacion real Supabase + Hetzner - 2026-07-14

Se activo la infraestructura real de produccion sin exponer secretos en consola ni chat.

### Cambios operativos realizados

- Se configuro Supabase como fuente durable:
  - `DATABASE_URL`: configurada con pooler de Supabase.
  - `AUTH_PROVIDER=supabase`.
  - `STORAGE_PROVIDER=supabase`.
  - `STORAGE_BUCKET=slt-assets`.
  - `WEBHOOK_BASE_URL=https://www.studiosweetlittletrauma.com`.
- Se creo/verifico el bucket publico `slt-assets` en Supabase Storage.
- Se subio un archivo smoke test al bucket para confirmar uploads reales.
- Se fusiono el `.env` de produccion con las variables Supabase, conservando las claves generativas existentes.
- Se creo backup local antes de modificar el `.env` de produccion:
  - `/Users/sweetlittletrauma/Desktop/Sweet Little Trauma Produccion/PROYECTO_COMPLETO/.env.backup-before-supabase-20260714`
- Se subio el `.env` fusionado al servidor Hetzner:
  - `/var/www/slt-studio-v2/.env`
- Se ajusto `slt-studio.service` para cargar:
  - `EnvironmentFile=/var/www/slt-studio-v2/.env`
- Se dejo el archivo remoto con permisos seguros:
  - owner `root:www-data`
  - mode `640`

### Comandos/verificaciones ejecutadas

```txt
npm run supabase:configure
ssh root@87.99.147.67 "cd /var/www/slt-studio-v2 && node .tmp-remote-verify.mjs"
ssh root@87.99.147.67 "systemctl restart slt-studio"
ssh root@87.99.147.67 "curl -sS http://127.0.0.1:3000/health"
curl -sS -I https://www.studiosweetlittletrauma.com
curl -sS -I 'https://www.studiosweetlittletrauma.com/?site_gate=Dientito2032'
curl -sS https://www.studiosweetlittletrauma.com/health
```

### Resultados

- `npm run supabase:configure`: OK.
- Migraciones aplicadas:
  - `001_production_schema.sql`
  - `002_supabase_rls.sql`
- Verificacion local de persistencia: OK.
- Verificacion remota desde Hetzner de persistencia: OK.
  - `users=1`
  - `projects=1`
  - `forms=1`
  - `jobs=1`
- `slt-studio.service`: active/running.
- `/health` publico:
  - `infrastructure.ok=true`
  - `dataStore.kind=postgres`
  - `dataStore.durable=true`
  - `storage.kind=supabase`
  - `storage.durable=true`
  - `providersConnected=43`
  - `providersTotal=56`
- `https://www.studiosweetlittletrauma.com`: responde por HTTPS.
- Sin clave de preview responde `403` por `SLT_SITE_GATE_KEY`.
- Con `?site_gate=Dientito2032` responde `200`.

### Estado final

Produccion queda arrancando con PostgreSQL/Supabase/Auth/Storage reales. La plataforma ya no depende de memoria como fuente principal en produccion. El sitio esta online detras del gate privado de preview.

## Hotfix gate/assets home publica - 2026-07-14

### Problema

La URL publica con `?site_gate=Dientito2032` devolvia el HTML de React, pero los archivos del build (`/assets/*.js` y `/assets/*.css`) quedaban bloqueados por el middleware del gate y respondian `403`. Como consecuencia, el navegador no podia montar la app real y el usuario veia una pantalla incorrecta/incompleta.

Ademas, el gate del frontend solo leia `sessionStorage`, por lo que el query param `site_gate` desbloqueaba el servidor pero no desbloqueaba la interfaz React.

### Cambio aplicado

- `server/api-proxy.js`:
  - Se agregaron excepciones para assets estaticos:
    - `/assets/`
    - `/favicon.svg`
    - `/icons.svg`
- `src/lib/site-gate.js`:
  - Se agrego `unlockSiteGateFromUrl()` para aceptar `?site_gate=...`.
- `src/components/SiteGate.jsx`:
  - El estado inicial ahora desbloquea si el query param trae la clave correcta.

### Verificacion

```txt
node --check server/api-proxy.js
npm run build
curl -sS -I https://www.studiosweetlittletrauma.com/assets/index-BJabaYqq.js
curl -sS https://www.studiosweetlittletrauma.com/health
```

Resultados:

- JS/CSS publicos del build: `200`.
- `/health`: OK.
- Render browser: Home visible, sin `Acceso privado` ni `Coming soon`.
- Controles visibles: Home, Video, Music, Image, Sound, Library, Contact, Sign in, chat, Image/Video/Sound FX/Music/Fashion/Engineering/Virtual Assist.

## Hotfix comportamiento gate dominio base - 2026-07-14

### Objetivo

Cuando un usuario entra a `studiosweetlittletrauma.com` o `www.studiosweetlittletrauma.com`, debe ver una pantalla con campo de clave. Al ingresar `Dientito2032`, debe aparecer la pantalla normal de Sweet Little Trauma Studio.

### Cambio aplicado

- `server/api-proxy.js`:
  - El middleware del gate ya no bloquea rutas visuales del frontend.
  - Las rutas no-API cargan React para que se muestre la pantalla de clave.
  - Las rutas `/api/...` siguen protegidas por `x-slt-site-gate` o `site_gate`.

### Verificacion

```txt
curl -sS -I https://www.studiosweetlittletrauma.com
curl -sS -I https://studiosweetlittletrauma.com
curl -sS -i https://www.studiosweetlittletrauma.com/api/ledger
```

Resultados:

- `https://www.studiosweetlittletrauma.com`: `200`, carga React.
- `https://studiosweetlittletrauma.com`: `200`, carga React.
- `/api/ledger` sin clave: `403 site_gate_required`.
- Verificacion visual en navegador:
  - Antes de clave: muestra `ACCESO PRIVADO`.
  - Campo `Clave de acceso`: visible.
  - Clave `Dientito2032`: desbloquea correctamente.
  - Despues de clave: muestra Home normal con chat, categorias y herramientas.

## Access portal, guest quotas y reporte - 2026-07-14

### Objetivo

La primera pantalla publica del dominio debe ofrecer entradas claras para crear usuario, loguearse, entrar en modo CEO, usar codigo de invitado o navegar como espia. El modo espia debe ser solo lectura. Los invitados deben poder probar creacion con limites simples por categoria.

### Cambio aplicado

- `src/components/SiteGate.jsx` y `src/components/SiteGate.css`:
  - Se reemplazo el gate de una sola clave por un portal con cinco modos:
    - Create User
    - Log In
    - CEO
    - Guest Code
    - Spy
  - El portal usa `x-slt-site-gate` internamente para poder crear/login antes de montar la app.
  - Se versiono el storage del gate para evitar bypass por accesos viejos.
- `server/api-proxy.js`:
  - Las sesiones locales del servidor ahora se validan antes del JWT de Supabase, permitiendo CEO e invitados en produccion.
  - Se agregaron codigos de invitado:
    - `NICO.slt`
    - `VALE.slt`
    - `MIRIAM.slt`
    - `CUÑA.slt`
    - `SOFI.slt`
    - `GUS.slt`
  - El invitado usa modo `INVITED_GUEST` sin cobro interno de creditos.
  - Engineering requiere sesion real para enviar formularios de proyecto.
- `src/lib/access-control.js`:
  - Se agrego control local de cuotas de invitado: 2 usos por video, image, sound, music, fashion y engineering.
- `src/hooks/useStudioGenerate.js`, `src/hooks/useVideoChat.js`, `src/pages/EngineeringLab.jsx`, `src/pages/Home.jsx`:
  - Espia queda bloqueado antes de generar, subir archivos o llamar al asistente.
  - Invitado consume una cuota al iniciar una generacion aceptada o enviar Engineering.
- `src/components/SiteReport.jsx`, `src/components/Layout.jsx`, `src/components/Layout.css`:
  - Se agrego boton rojo intermitente `REPORTE` con cara geometrica visible.
  - El reporte abre un panel lateral con desglose de modulos y cuotas restantes para invitados.

### Verificacion prevista

```txt
node --check server/api-proxy.js
bash -n scripts/deploy-hetzner.sh && bash -n scripts/hetzner-console-install.sh
npm run lint
npm run build
npm run deploy:hetzner
```

### Verificacion local

- `node --check server/api-proxy.js`: OK.
- `bash -n scripts/deploy-hetzner.sh && bash -n scripts/hetzner-console-install.sh`: OK.
- `npm run build`: OK.
- `npm run lint`: OK con warnings no bloqueantes preexistentes.

El dominio debe abrir primero el portal de acceso. Invitado con codigo valido debe entrar al sitio y ver cuotas en `REPORTE`. Espia debe poder navegar sin crear contenido.

## Hotfix inicializacion Supabase despues de .env - 2026-07-14

### Problema

El health remoto confirmaba variables de Supabase presentes, pero `auth.supabaseConfigured` y `storage.kind` podian reportar valores locales porque los clientes de Supabase se creaban antes de cargar `.env`.

### Cambio aplicado

- `server/api-proxy.js`:
  - `supabaseStorage`, `supabaseAdmin` y `supabaseAuth` ahora se inicializan despues de cargar `.env`.

### Verificacion

- `node --check server/api-proxy.js`: OK.
- `npm run build`: OK.
- `npm run lint`: OK con warnings no bloqueantes preexistentes.

## Clarificacion CEO/Guest API direct - 2026-07-14

### Aclaracion funcional

CEO e invitados no deben consumir creditos facturados por SLT ni pasar por checkout interno, pero las generaciones reales si llaman a las APIs de proveedores y por lo tanto consumen saldo/creditos directamente en esas cuentas proveedoras.

### Cambio aplicado

- Se reemplazaron textos tipo `unlimited` o `not charged` por `API direct` y mensajes explicitos de "sin facturacion interna SLT, con consumo directo del proveedor".
- El backend conserva costo interno `0` para CEO/Guest, pero sigue ejecutando los adaptadores reales de proveedores.

### Verificacion

- `node --check server/api-proxy.js`: OK.
- `npm run build`: OK.
- `npm run lint`: OK con warnings no bloqueantes preexistentes.
