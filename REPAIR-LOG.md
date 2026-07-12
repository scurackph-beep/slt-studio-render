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
