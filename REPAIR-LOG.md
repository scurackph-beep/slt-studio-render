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
