# AUDIT-SLT-STUDIO.md

Fecha de auditoria: 2026-07-12  
Proyecto auditado: `/Users/sweetlittletrauma/slt-studio-v2`  
Fase: 0 - Inventario y Auditoria  
Alcance: inspeccion completa de frontend, backend, rutas, proveedores, auth, billing, creditos, mocks, seguridad y checks no destructivos.

## Reglas aplicadas

- No se modifico codigo existente.
- No se ejecutaron generaciones de IA.
- No se ejecutaron pagos ni checkouts.
- No se consultaron balances externos de proveedores desde el endpoint CEO, para no tocar servicios externos.
- No se ejecuto `npm run build` porque escribe en `dist/` y esta fase exigia no modificar el proyecto.
- El unico archivo creado por esta fase es este informe: `AUDIT-SLT-STUDIO.md`.

## Resumen ejecutivo

El proyecto actual es una app React + Vite con un backend Express unico en `server/api-proxy.js`. La UI ya contiene Home, estudios creativos, perfil, CEO dashboard, paginas informativas y rutas principales. El backend tiene un catalogo amplio de proveedores y adaptadores reales para varias APIs externas, incluyendo OpenAI, xAI/Grok, Gemini, Replicate, Stability, Seedance/BytePlus, OmniHuman, Runway, Luma, Kling, PixVerse, MiniMax/Hailuo, ElevenLabs, Moises, OpenRouter/Hermes, Stripe y otros.

El estado real no es todavia SaaS listo para produccion. La app funciona como prototipo avanzado/proxy funcional, pero los pilares comerciales y de seguridad siguen en modo local: autenticacion mock, sesiones en memoria, usuarios en memoria, creditos en memoria, historial/proyectos en memoria y paginas legales provisionales. Tambien hay providers marcados como conectados por presencia de variables, no por validacion real de cuenta/modelo/cuota.

El riesgo principal es que el backend puede llamar proveedores reales con claves reales mientras la autenticacion todavia acepta usuarios mock. Eso vuelve urgente separar demo/local de produccion antes de exponerlo publicamente.

## Estado git antes del informe

`git status --short` ya mostraba cambios no committeados antes de crear este documento:

```txt
 M server/api-proxy.js
 M src/App.jsx
 M src/components/Layout.jsx
 M src/components/Navbar.css
 M src/components/Navbar.jsx
 M src/hooks/useStudioGenerate.js
 M src/lib/api-client.js
 M src/pages/EngineeringLab.jsx
 M src/pages/FashionStudio.jsx
 M src/pages/Home.css
 M src/pages/Home.jsx
 M src/pages/ImageStudio.jsx
 M src/pages/MusicStudio.jsx
 M src/pages/SoundStudio.jsx
 M src/pages/StudioLayout.css
 M src/pages/VideoStudio.jsx
?? src/context/AuthContext.jsx
?? src/hooks/useSubscription.js
?? src/hooks/useVideoChat.js
?? src/pages/ContactPage.jsx
?? src/pages/InfoPage.jsx
?? src/pages/ProfilePage.jsx
```

Interpretacion: la auditoria se hizo sobre un working tree ya modificado. No se revirtio ni se limpio nada.

## Arquitectura general

### Frontend

- Framework: React `19.2.7`.
- Router: `react-router-dom` `7.18.0`.
- Build/dev: Vite `8.1.0`.
- Lenguaje: JavaScript/JSX, no TypeScript.
- Estilos: CSS manual por componente y pagina.
- Estado cliente: React state + `localStorage`.
- Contextos:
  - `src/context/AuthContext.jsx`
  - `src/context/StudioContext.jsx`
- Hooks:
  - `src/hooks/useStudioGenerate.js`
  - `src/hooks/useSubscription.js`
  - `src/hooks/useVideoChat.js`
- Cliente API:
  - `src/lib/api-client.js`
  - `src/lib/storage.js`

### Backend

- Framework: Express `4.22.2`.
- Archivo principal: `server/api-proxy.js`.
- Rol: API proxy, catalogo de providers, billing, creditos, sesiones locales, proyectos, historial, Stripe, webhooks, polling y static serving.
- Persistencia: no hay base de datos; usa objetos y `Map` en memoria.
- Env: carga `.env`, `.env.local`, `../.env`, `../.env.local` y opcional `SLT_ENV_DIR`.

### Infraestructura/deploy

- `render.yaml` define servicio web Node:
  - `buildCommand: npm ci && npm run build`
  - `startCommand: npm start`
  - `healthCheckPath: /health`
  - `SLT_STATIC_DIR=./dist`
- `dist/` existe en el repo local como build generado.

## Rutas frontend actuales

Fuente: `src/App.jsx:18-41`

| Ruta | Vista |
|---|---|
| `/` | Home |
| `/music` | MusicStudio |
| `/video` | VideoStudio |
| `/image` | ImageStudio |
| `/sound` | SoundStudio |
| `/fashion` | FashionStudio |
| `/engineering` | EngineeringLab |
| `/contact` | ContactPage |
| `/ceo` | CEODashboard |
| `/about` | InfoPage about |
| `/careers` | InfoPage careers |
| `/privacy` | InfoPage privacy |
| `/terms` | InfoPage terms |
| `/sitemap` | InfoPage sitemap |
| `/subscription` | InfoPage subscription |
| `/profile` | ProfilePage |
| `/settings` | InfoPage settings |
| `/help` | InfoPage help |
| `/assist` | InfoPage assist |
| `*` | InfoPage not-found |

## Endpoints backend actuales

Fuente: `server/api-proxy.js`

| Metodo | Endpoint | Estado |
|---|---|---|
| POST | `/api/stripe/webhook` | Webhook Stripe con firma |
| GET | `/health` | Healthcheck |
| GET | `/api/providers` | Catalogo/estado de providers |
| POST | `/api/generate/image` | Generacion imagen |
| POST | `/api/generate/video` | Generacion video |
| POST | `/api/generate/music` | Generacion musica |
| POST | `/api/generate/sound` | Generacion sonido |
| GET | `/api/jobs/:jobId` | Polling limitado a Seedance/OmniHuman |
| POST | `/api/login` | Login local/CEO |
| POST | `/api/assist` | Asistente |
| GET | `/api/ceo/provider-credits` | Balances externos, requiere CEO |
| GET | `/api/projects` | Proyectos en memoria |
| POST | `/api/projects` | Guardado mock/en memoria |
| GET | `/api/history` | Historial en memoria |
| POST | `/api/history` | Historial en memoria |
| GET | `/api/stripe/status` | Estado Stripe |
| GET | `/api/credits/packs` | Packs de creditos |
| POST | `/api/stripe/checkout` | Checkout suscripcion |
| POST | `/api/stripe/credits/checkout` | Checkout creditos |
| POST | `/api/stripe/portal` | Portal Stripe |
| GET | `/api/billing` | Billing en memoria + Stripe status |
| POST | `/api/billing` | Actualiza billing en memoria |
| GET | `/api/subscription` | Subscripcion en memoria |
| POST | `/api/subscription` | Actualiza subscripcion en memoria |
| GET | `/api/user` | Usuario en memoria |
| POST | `/api/user` | Actualiza usuario en memoria |
| POST | `/api/studio/run` | Runner generico parcial |
| GET | `*` | Sirve SPA |

## Proveedores/API previstos o conectados

Fuente principal: `server/api-proxy.js:148-228` y `curl http://127.0.0.1:3000/api/providers`.

Resultado de health local:

```txt
providersConnected: 43
providersTotal: 53
envFiles: []
mode: functional-provider-proxy
```

### Imagen

- OpenAI Images
- Grok Image / xAI
- Gemini Image
- Leonardo
- Flux / FLUX / Stable Diffusion / Replicate
- Stability
- Ideogram
- Recraft
- ComfyUI local

### Video

- Seedance / BytePlus
- Veo / Gemini
- OmniHuman / BytePlus Vision
- Runway
- Kling
- Hailuo / MiniMax
- Luma
- PixVerse
- Pika: deshabilitado por preferencia
- Hunyuan/Tencent: necesita confirmacion
- Wan via Replicate
- HeyGen
- D-ID

### Musica

- Suno: preparado, no conectado
- Udio: preparado, no conectado
- MiniMax Music
- SLT Composer local
- Stable Audio
- Mubert: preparado, no conectado
- AudioCraft via Replicate
- Riffusion via Replicate

### Sonido/Voz

- ElevenLabs
- OpenAI Audio
- MiniMax Speech
- Stability Audio
- Dolby.io: deshabilitado por preferencia
- iZotope: preparado, no conectado
- Moises / Music.ai
- FFmpeg: interno/local placeholder

### Asistentes

- OpenAI
- GPT voz + texto
- GPT texto
- GPT-4.1
- GPT-4o
- Meta Llama via OpenRouter
- Anthropic/Claude: deshabilitado por preferencia
- Gemini
- Hermes local / Ollama
- Local model

### Billing

- Stripe

## Modulos creativos: estado real

| Modulo | Estado real |
|---|---|
| Home | Enruta intencion por clasificador local y hace intento breve de `/api/assist`; no es aun agente conversacional completo. |
| Video | UI bastante avanzada: text-to-video, image-to-video, lip sync, motion transfer, scene transfer, change look, avatar, long form. Llama `/api/generate/video`. Polling solo para Seedance y OmniHuman. |
| Image | UI de herramientas y providers; llama `/api/generate/image`. Algunas herramientas son labels, no flujos separados. |
| Music | UI de estudio musical, pero `handleGenerate` hardcodea Suno aunque la lista muestre varios providers. Suno figura preparado/no conectado. |
| Sound FX | UI de voz/audio, pero `handleGenerate` hardcodea ElevenLabs aunque la lista muestre varios providers. Import/Play son controles visuales. |
| Fashion | Usa generacion de imagen con providers visuales y puede guardar proyecto mock. |
| Engineering | UI de lab/proyectos, pero `handleExecute` no ejecuta ninguna accion real. |
| Projects/History | En memoria en backend y duplicados parciales en `localStorage`. No hay DB. |
| Profile/CEO | Login local con `ADMIN_UNFILTERED_KEY`, token en memoria/localStorage, balances externos desde endpoint CEO. |
| Billing | Stripe parcialmente integrado; checkout/portal existen, pero estado durable no. |

## Hallazgos por gravedad

### Critico 1 - Autenticacion mock permite operar endpoints sensibles

**Evidencia:**

```txt
src/lib/api-client.js:52:        'x-slt-user-id': session?.id || 'demo-user',
server/api-proxy.js:388:function getAuth(request) {
server/api-proxy.js:402:  const userId = typeof request.header === "function" ? request.header("x-slt-user-id") || "demo-user" : "demo-user";
server/api-proxy.js:408:    message: "Mock auth accepted. Replace this with real session validation before launch."
server/api-proxy.js:2969:app.post("/api/generate/image", handleGenerate("image"));
server/api-proxy.js:2970:app.post("/api/generate/video", handleGenerate("video"));
server/api-proxy.js:3413:app.post("/api/stripe/checkout", async (request, response) => {
```

**Ubicacion:** `src/lib/api-client.js:52`, `server/api-proxy.js:388-408`, `server/api-proxy.js:2969-2972`, `server/api-proxy.js:3413`.

**Impacto:** Cualquier cliente que alcance el backend puede ser aceptado como usuario mock y disparar endpoints que consumen creditos/proveedores reales o crean flujos de Stripe. Esto afecta costos, facturacion, privacidad y control de acceso.

**Causa probable:** Prototipo local evolucionado a proxy funcional sin reemplazar la autenticacion temporal.

**Recomendacion:** Implementar middleware de auth real obligatorio para endpoints mutables y de generacion. No confiar en `x-slt-user-id` enviado por cliente. Validar token firmado/session server-side y bloquear requests sin usuario real.

**Dependencia:** Sistema de usuarios/sesiones y base de datos.

**Criterio de validacion:** `curl -X POST /api/generate/video` sin token real devuelve `401`; un token invalido devuelve `401`; un token valido queda asociado a usuario real y cuotas reales.

### Critico 2 - No hay persistencia durable para usuarios, creditos, billing, proyectos ni sesiones

**Evidencia:**

```txt
server/api-proxy.js:318:const state = {
server/api-proxy.js:320:    id: "demo-user",
server/api-proxy.js:361:const sessions = new Map();
server/api-proxy.js:709:  state.history.unshift(entry);
server/api-proxy.js:724:  state.projects.unshift(project);
server/api-proxy.js:2854:      state.subscription.credits = checks.credits.remaining;
server/api-proxy.js:3676:  state.billing.paymentMethod = request.body?.paymentMethod || state.billing.paymentMethod;
```

**Ubicacion:** `server/api-proxy.js:318-361`, `server/api-proxy.js:709-725`, `server/api-proxy.js:2854`, `server/api-proxy.js:3676-3678`.

**Impacto:** Reiniciar el servidor borra sesiones, historial, proyectos y estado de creditos. Stripe puede cobrar, pero la app puede perder o desincronizar plan/creditos. Esto afecta usuarios, facturacion y soporte.

**Causa probable:** Backend usado como mock store durante desarrollo.

**Recomendacion:** Crear capa de datos real para Users, Sessions, Subscriptions, CreditLedger, Generations, Jobs, Projects, ProviderAccounts e Invoices. Toda mutacion de creditos debe ser transaccional.

**Dependencia:** Seleccion/creacion de base de datos y esquema.

**Criterio de validacion:** Crear proyecto, generar item, iniciar sesion y comprar creditos; reiniciar servidor; los datos siguen iguales y auditables.

### Alto 1 - CEO mode y permisos mezclan estado cliente, email local y clave unica

**Evidencia:**

```txt
src/context/AuthContext.jsx:10:    const savedUser = readStore(storageKeys.user, { email: 'ceo@slt.com' });
src/context/AuthContext.jsx:24:    const savedUser = readStore('slt-user-profile', { email: 'ceo@slt.com' });
src/hooks/useSubscription.js:11:  const isCEO = user?.email === 'tu-email@slt.com' || user?.email === 'ceo@slt.com' || user?.email?.endsWith('@slt.com');
src/pages/ProfilePage.jsx:64:    localStorage.setItem('sessionToken', result.data.session.token);
server/api-proxy.js:3134:    if (password !== process.env.ADMIN_UNFILTERED_KEY) {
```

**Ubicacion:** `src/context/AuthContext.jsx:10`, `src/context/AuthContext.jsx:24`, `src/hooks/useSubscription.js:11`, `src/pages/ProfilePage.jsx:64`, `server/api-proxy.js:3134`.

**Impacto:** La UI puede asumir privilegios CEO por email local/default, y la sesion CEO depende de una clave unica guardada en entorno. Aunque el backend valida `ADMIN_UNFILTERED_KEY` para sesion CEO, el frontend puede mostrar botones y rutas como si el usuario fuera CEO sin autoridad real.

**Causa probable:** Atajo local para permitir modo CEO rapido durante pruebas.

**Recomendacion:** Eliminar inferencia CEO por email cliente. La autoridad CEO debe venir solo de backend, con sesion firmada, expiracion, roles en DB, MFA y auditoria.

**Dependencia:** Auth real y tabla de roles/permisos.

**Criterio de validacion:** Editar `localStorage` no cambia permisos; `/api/ceo/provider-credits` exige sesion CEO real; UI lee rol desde `/api/me`.

### Alto 2 - `CEODashboard` usa `useStudio()` pero `StudioProvider` no esta montado

**Evidencia:**

```txt
src/pages/CEODashboard.jsx:33:  const { plan, planStatus, credits, billing, refresh } = useStudio();
src/context/StudioContext.jsx:64:    throw new Error('useStudio must be used within StudioProvider');
src/App.jsx:18:      <Routes>
```

Busqueda de providers:

```txt
src/context/StudioContext.jsx:7:export function StudioProvider({ children }) {
src/pages/CEODashboard.jsx:33:  const { plan, planStatus, credits, billing, refresh } = useStudio();
```

No aparece `StudioProvider` usado en `App.jsx` ni `main.jsx`.

**Ubicacion:** `src/pages/CEODashboard.jsx:33`, `src/context/StudioContext.jsx:61-64`, `src/App.jsx:18-41`.

**Impacto:** La ruta `/ceo` puede romper en runtime al renderizar el dashboard, impidiendo gestionar billing/creditos desde esa vista.

**Causa probable:** Se agrego `StudioContext` despues de montar la app y no se envolvio el arbol.

**Recomendacion:** Montar `StudioProvider` alrededor de rutas o refactorizar `CEODashboard` para no depender de contexto global sin provider. CODEX DEBE VERIFICARLO con navegador despues.

**Dependencia:** Decision de arquitectura de providers globales.

**Criterio de validacion:** Abrir `/ceo` en navegador no muestra error React y renderiza billing/creditos.

### Alto 3 - CORS esta abierto y la allowlist declarada no se usa

**Evidencia:**

```txt
server/api-proxy.js:55:function isLocalOrigin(origin = "") {
server/api-proxy.js:59:const allowedCorsOrigins = envList("CORS_ORIGINS");
server/api-proxy.js:69:app.use(cors({ origin: "*" }));
```

**Ubicacion:** `server/api-proxy.js:55-69`.

**Impacto:** Cualquier origen web puede llamar el API desde navegador. Combinado con auth mock, aumenta riesgo de abuso de generacion y endpoints comerciales.

**Causa probable:** Configuracion de desarrollo dejada abierta para pruebas locales.

**Recomendacion:** Usar `CORS_ORIGINS`, bloquear origen desconocido en produccion, definir credenciales/cookies de forma segura y agregar CSRF si se usan cookies.

**Dependencia:** Auth real y dominios definitivos.

**Criterio de validacion:** Request con `Origin: https://evil.example` no recibe `Access-Control-Allow-Origin`; dominios permitidos si lo reciben.

### Alto 4 - Estado de provider "connected" se basa en presencia de env/config, no en validacion real

**Evidencia:**

```txt
server/api-proxy.js:451:function providerStatus(name) {
server/api-proxy.js:465:  const keyPresent = config.localProvider
server/api-proxy.js:470:  const endpointPresent = config.endpointEnv || config.alternateEndpointEnvKeys?.length
server/api-proxy.js:496:  } else if (keyPresent && endpointPresent) {
server/api-proxy.js:497:    status = "connected";
server/api-proxy.js:498:    message = "Provider connected.";
server/api-proxy.js:521:    canGenerate: connected,
```

**Ubicacion:** `server/api-proxy.js:451-521`.

**Impacto:** La UI puede decir "On" o "connected" aunque la API key este invalida, el modelo no exista, falte billing o el proveedor rechace el request. Esto confunde al usuario y puede dejar jobs colgados.

**Causa probable:** Chequeo de configuracion usado como proxy de disponibilidad real.

**Recomendacion:** Separar `configured`, `authenticated`, `quotaOk`, `modelOk`, `canGenerate`. Agregar health checks por provider sin generar contenido.

**Dependencia:** Adaptadores de provider y almacenamiento de resultados de healthcheck.

**Criterio de validacion:** Provider con key invalida muestra `configured=true`, `authenticated=false`, `canGenerate=false`.

### Alto 5 - Jobs async solo se pueden consultar para Seedance y OmniHuman

**Evidencia:**

```txt
server/api-proxy.js:2974:app.get("/api/jobs/:jobId", async (request, response) => {
server/api-proxy.js:2976:  if (!["Seedance", "OmniHuman"].includes(providerName)) {
server/api-proxy.js:2980:      readableError: "Only direct async providers can be polled here right now."
src/lib/api-client.js:268:    jobId && (/poll \/api\/jobs/i.test(note) || status === 'processing'),
```

**Ubicacion:** `server/api-proxy.js:2974-2981`, `src/lib/api-client.js:263-269`.

**Impacto:** Video/replicate/luma/runway/kling/minimax pueden devolver job async, pero la app no tiene polling generico ni webhooks por provider. Esto explica estados tipo "Generating..." prolongados o resultados que no vuelven a la UI.

**Causa probable:** Se implemento polling para los primeros providers directos y no se generalizo.

**Recomendacion:** Crear tabla `Jobs` y adaptadores `submitJob`, `pollJob`, `handleWebhook` por provider. Persistir estado y reconciliar resultados.

**Dependencia:** Base de datos y jobs queue.

**Criterio de validacion:** Cada provider async soportado pasa de `queued` a `completed/failed` con URL persistida y visible en historial.

### Alto 6 - Stripe cobra/crea sesiones, pero el estado comercial se guarda en memoria

**Evidencia:**

```txt
server/api-proxy.js:1190:function applyStripeWebhookEvent(event = {}) {
server/api-proxy.js:1200:      state.billing.stripeCustomerId = object.customer || state.billing.stripeCustomerId;
server/api-proxy.js:1216:    state.subscription.stripeSubscriptionId = object.subscription || state.subscription.stripeSubscriptionId;
server/api-proxy.js:1218:    state.subscription.status = "active";
server/api-proxy.js:3413:app.post("/api/stripe/checkout", async (request, response) => {
server/api-proxy.js:3473:      automatic_tax: { enabled: stripeAutomaticTaxEnabled() },
server/api-proxy.js:3616:      error: "Stripe customer missing. Complete a checkout first or add STRIPE_CUSTOMER_ID in .env.",
```

`curl /api/billing` mostro:

```txt
customerIdPresent:false
automaticTaxEnabled:false
paymentMethod:"•••• 4242"
```

**Ubicacion:** `server/api-proxy.js:1190-1228`, `server/api-proxy.js:3413-3503`, `server/api-proxy.js:3604-3652`.

**Impacto:** Un pago puede completarse en Stripe pero la app perder el estado tras reinicio. El portal puede fallar si no hay customer id persistido. Taxes estan desactivados por env actual.

**Causa probable:** Integracion Stripe funcional inicial sin base de datos.

**Recomendacion:** Guardar `stripeCustomerId`, `stripeSubscriptionId`, price id, status, invoices y credit ledger en DB. Hacer webhooks idempotentes por `event.id`.

**Dependencia:** DB + modelo de billing.

**Criterio de validacion:** Checkout completado actualiza DB; restart conserva plan; webhook duplicado no duplica creditos.

### Alto 7 - `.gitignore` no ignora `.env` explicitamente

**Evidencia:**

```txt
.gitignore incluye:
node_modules
dist
dist-ssr
*.local
```

Busqueda actual de env:

```txt
/Users/sweetlittletrauma/slt-studio-v2/.env.example
```

**Ubicacion:** `.gitignore:8-11`, `.env.example`.

**Impacto:** Hoy no hay `.env` real dentro del repo, pero si se crea accidentalmente podria quedar trackeable porque `.env` no esta ignorado. Riesgo directo de exponer claves de proveedores.

**Causa probable:** `.gitignore` de template Vite sin reglas de secretos completas.

**Recomendacion:** Agregar `.env`, `.env.*`, `!.env.example` y revisar `git status` antes de cada commit. No hacerlo en esta fase por regla de no modificar.

**Dependencia:** Politica de manejo de secretos.

**Criterio de validacion:** Crear `.env` local no aparece en `git status`.

### Medio 1 - Frontend llama `/api/subscription-status`, endpoint inexistente

**Evidencia:**

```txt
src/hooks/useSubscription.js:20:      // First try /api/subscription-status as requested
src/hooks/useSubscription.js:21:      const statusRes = await apiRequest('/api/subscription-status');
```

Verificacion:

```txt
curl -sS http://127.0.0.1:3000/api/subscription-status
{"ok":false,"error":"Not Found","readableError":"This API route does not exist yet.","path":"/api/subscription-status"}
```

**Ubicacion:** `src/hooks/useSubscription.js:20-21`.

**Impacto:** Cada check de suscripcion hace una llamada fallida y luego cae a fallback. Puede provocar estados de UI incorrectos, delay y fail-open.

**Causa probable:** Se diseno hook para endpoint futuro y se implemento otro (`/api/subscription`).

**Recomendacion:** Crear endpoint real o cambiar hook a `/api/subscription` y `/api/credits/packs` segun contrato final.

**Dependencia:** Modelo final de billing/creditos.

**Criterio de validacion:** `/api/subscription-status` devuelve 200 o el frontend deja de llamarlo.

### Medio 2 - Music Studio muestra providers pero genera siempre con Suno

**Evidencia:**

```txt
src/pages/MusicStudio.jsx:20:const PROVIDERS = ['Suno', 'Udio', 'ElevenLabs', 'OpenAI Audio', 'Stability Audio', 'Lalal.ai', 'Moises', 'iZotope', 'FFmpeg'];
src/pages/MusicStudio.jsx:47:      provider: 'Suno',
src/pages/MusicStudio.jsx:48:      providerLabel: 'Suno',
server/api-proxy.js:198:  Suno: { kind: "music", envKey: "SUNO_API_KEY", adapter: "generic-endpoint", endpointEnv: "SUNO_API_URL", preparedOnly: true },
```

**Ubicacion:** `src/pages/MusicStudio.jsx:20`, `src/pages/MusicStudio.jsx:47-48`, `server/api-proxy.js:198`.

**Impacto:** Usuario puede pensar que elige Udio/Moises/Stability/etc., pero el request siempre intenta Suno, que figura preparado/no conectado. Music puede fallar aunque haya MiniMax o Replicate MusicGen disponibles.

**Causa probable:** UI de provider list creada antes del estado `activeProvider`.

**Recomendacion:** Agregar `activeProvider` real, wiring de botones y filtros por provider conectado.

**Dependencia:** Catalogo de providers normalizado para UI.

**Criterio de validacion:** Click en MiniMax Music envia `provider: "MiniMax Music"` y backend responde con ese provider.

### Medio 3 - Sound Studio muestra providers pero genera siempre con ElevenLabs

**Evidencia:**

```txt
src/pages/SoundStudio.jsx:20:const PROVIDERS = ['ElevenLabs', 'Dolby.io', 'iZotope', 'Stability Audio', 'OpenAI Audio', 'FFmpeg'];
src/pages/SoundStudio.jsx:36:      provider: 'ElevenLabs',
src/pages/SoundStudio.jsx:37:      providerLabel: 'ElevenLabs',
```

**Ubicacion:** `src/pages/SoundStudio.jsx:20`, `src/pages/SoundStudio.jsx:36-37`.

**Impacto:** Los botones de Dolby/iZotope/Stability/OpenAI/FFmpeg no enrutan generacion. El usuario no controla proveedor real.

**Causa probable:** Provider list visual sin estado ni handler.

**Recomendacion:** Igual que Music: `activeProvider`, botones conectados y disponibilidad desde `/api/providers?kind=sound`.

**Dependencia:** UI de provider selector comun.

**Criterio de validacion:** Click en OpenAI Audio envia `provider: "OpenAI Audio"` y el resultado indica OpenAI Audio.

### Medio 4 - Engineering Lab no ejecuta acciones reales

**Evidencia:**

```txt
src/pages/EngineeringLab.jsx:36:  const { hasCredits, isCEO } = useSubscription();
src/pages/EngineeringLab.jsx:38:  const handleExecute = () => {
src/pages/EngineeringLab.jsx:39:    if (!hasCredits && !isCEO) {
src/pages/EngineeringLab.jsx:40:      alert('Suscríbete para continuar');
src/pages/EngineeringLab.jsx:43:  };
```

**Ubicacion:** `src/pages/EngineeringLab.jsx:38-43`.

**Impacto:** Apps, games, automation y custom requests son UI sin backend. El usuario no puede encargar ni generar software desde ese modulo.

**Causa probable:** Pantalla scaffold/lista antes de implementar workflow.

**Recomendacion:** Definir endpoint de request/brief/ticket o asistente de engineering y persistirlo como proyecto.

**Dependencia:** Modelo Projects/Requests.

**Criterio de validacion:** Ejecutar comando crea proyecto/request persistente y muestra ID.

### Medio 5 - Long-form video planifica timeline, no render final largo

**Evidencia:**

```txt
src/pages/VideoStudio.jsx:67:const DURATIONS = ['5s', '10s', '15s', '30s', 'Timeline'];
src/pages/VideoStudio.jsx:84:  if (duration === 'Timeline') return 180;
server/api-proxy.js:2612:function buildLongVideoTimeline({ prompt, title, providerName, plan }) {
server/api-proxy.js:2628:    responseText: `CEO long video timeline ready: ${formatDurationLabel(plan.requestedDurationSeconds)} split into ${plan.sceneCount} clips.`,
```

**Ubicacion:** `src/pages/VideoStudio.jsx:67-84`, `server/api-proxy.js:2612-2634`.

**Impacto:** El usuario puede elegir `Timeline`, pero el sistema devuelve plan de escenas; no hay render batch completo, stitching, storage ni export final.

**Causa probable:** Se implemento una etapa de planificacion para resolver limites de clips antes del pipeline completo.

**Recomendacion:** Implementar jobs batch + stitch/export con FFmpeg/storage y progreso por escena.

**Dependencia:** Jobs, storage, FFmpeg/export worker.

**Criterio de validacion:** Un video de 3 minutos produce clips, los une y devuelve un MP4 final persistente.

### Medio 6 - Proyectos e historial son mock/local y pueden duplicarse entre backend y localStorage

**Evidencia:**

```txt
server/api-proxy.js:3368:    provider: "project storage mock",
server/api-proxy.js:3370:    message: `${mockModeMessage} Project saved in local/mock storage.`,
src/hooks/useStudioGenerate.js:9:    const history = readStore(storageKeys.history, []);
src/hooks/useStudioGenerate.js:10:    writeStore(storageKeys.history, [entry, ...history].slice(0, 40));
src/lib/api-client.js:119:    const local = readStore(storageKeys.projects, []);
src/lib/api-client.js:120:    writeStore(storageKeys.projects, [...projects.data.projects, ...local].slice(0, 30));
```

**Ubicacion:** `server/api-proxy.js:3351-3373`, `src/hooks/useStudioGenerate.js:7-15`, `src/lib/api-client.js:118-126`.

**Impacto:** Historial/proyectos pueden perderse, duplicarse o diferir entre navegador y backend. No hay owner real ni permisos por usuario.

**Causa probable:** Persistencia local temporal.

**Recomendacion:** Centralizar Projects/History en DB y usar localStorage solo como cache.

**Dependencia:** Auth + DB.

**Criterio de validacion:** Un proyecto creado en un navegador aparece en otro despues de login y no se duplica.

### Medio 7 - Paginas legales, settings y careers son placeholders

**Evidencia:**

```txt
src/pages/InfoPage.jsx:14:    body: 'This area is prepared for collaborators, developers, designers, editors, prompt artists, producers and AI operators.',
src/pages/InfoPage.jsx:20:    body: 'This page is ready for the final legal privacy policy. It should describe data collection, account data, uploaded files, generation history, cookies and provider processing.',
src/pages/InfoPage.jsx:26:    body: 'This page is ready for the final legal terms, including acceptable use, subscription rules, credits, refunds, generated content, licenses and service availability.',
src/pages/InfoPage.jsx:57:    body: 'This area is prepared for language, theme, default providers, API routing preferences, safety settings and storage options.',
```

**Ubicacion:** `src/pages/InfoPage.jsx:14`, `src/pages/InfoPage.jsx:20`, `src/pages/InfoPage.jsx:26`, `src/pages/InfoPage.jsx:57`.

**Impacto:** Sitio no esta listo legal/comercialmente para usuarios publicos. Falta politica real de privacidad, terminos, licencias, refunds, uso aceptable, seguridad de uploads y proveedores.

**Causa probable:** Paginas creadas como placeholders de navegacion.

**Recomendacion:** Redactar contenido legal real y revisar con asesor legal antes de produccion.

**Dependencia:** Modelo de negocio, proveedores, jurisdiccion, Stripe/refunds.

**Criterio de validacion:** Paginas legales finales versionadas y enlazadas; textos no dicen "ready for final".

### Medio 8 - Billing visible incluye datos mock de tarjeta/facturas

**Evidencia:**

```txt
server/api-proxy.js:346:    stripeCustomerId: process.env.STRIPE_CUSTOMER_ID || "",
server/api-proxy.js:348:    paymentMethod: "•••• 4242",
server/api-proxy.js:351:      { id: "INV-0004", amount: "$19.00", status: "paid", date: "2026-05-18" },
```

**Ubicacion:** `server/api-proxy.js:343-358`.

**Impacto:** Usuario/admin puede ver facturas/metodo de pago falsos y tomar decisiones incorrectas.

**Causa probable:** Estado demo para UI.

**Recomendacion:** Ocultar datos demo en produccion y leer PaymentMethods/Invoices reales desde Stripe o DB sincronizada.

**Dependencia:** Stripe customer persistence.

**Criterio de validacion:** Cuenta nueva sin metodo de pago muestra estado vacio real; cuenta con Stripe muestra datos reales.

### Medio 9 - No hay TypeScript ni tests configurados

**Evidencia:**

```txt
package.json scripts:
dev, build, start, start:prod, lint, preview

find *test*/*spec*: sin resultados
find tsconfig.json: sin resultados
```

**Ubicacion:** `package.json:7-13`.

**Impacto:** Cambios en rutas, props, provider payloads y billing pueden romperse sin detection temprana. El error de `StudioProvider` faltante no fue detectado por lint.

**Causa probable:** Proyecto iniciado desde template React JS minimo.

**Recomendacion:** Agregar suite minima de tests e idealmente migrar contratos criticos a TypeScript o schemas runtime.

**Dependencia:** Definir arquitectura final y flujos principales.

**Criterio de validacion:** `npm test` existe y cubre Home routing, video generation submit, auth guard, billing checkout guard y CEODashboard render.

### Bajo 1 - Lint pasa, pero hay warnings de mantenimiento

**Evidencia:**

```txt
npm run lint -> exit 0
server/api-proxy.js:55:10 warning no-unused-vars Function 'isLocalOrigin'
server/api-proxy.js:59:7 warning no-unused-vars Variable 'allowedCorsOrigins'
server/api-proxy.js:532:10 warning no-unused-vars Function 'providerConnected'
server/api-proxy.js:740:10 warning no-unused-vars Function 'buildMockEntry'
src/context/AuthContext.jsx warning react(only-export-components)
src/context/StudioContext.jsx warning react(only-export-components)
```

**Ubicacion:** Varias, listadas arriba.

**Impacto:** Ruido tecnico; no bloquea ejecucion pero oculta senales utiles y evidencia codigo de transicion.

**Causa probable:** Refactors parciales.

**Recomendacion:** Limpiar warnings cuando empiece Fase 1.

**Dependencia:** Ninguna, salvo decidir si helpers se usan.

**Criterio de validacion:** `npm run lint` devuelve 0 warnings.

### Bajo 2 - ContactPage mezcla idioma y estilo inline

**Evidencia:**

```txt
src/pages/ContactPage.jsx:8:        <h1>Contacto</h1>
src/pages/ContactPage.jsx:10:        <a href="mailto:info@studiosweetlittletrauma.com" style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>
```

**Ubicacion:** `src/pages/ContactPage.jsx:8-11`.

**Impacto:** Inconsistencia visual/idioma respecto a navbar en ingles y diseño global.

**Causa probable:** Pantalla rapida agregada aparte.

**Recomendacion:** Unificar idioma, tono y estilos via CSS.

**Dependencia:** Guia de contenido/brand.

**Criterio de validacion:** Contact page usa estilos del sistema y copy final consistente.

### Bajo 3 - Proveedores duplicados o aliases confusos

**Evidencia:**

```txt
server/api-proxy.js:162:  Flux: { kind: "image", envKey: "REPLICATE_API_TOKEN", adapter: "replicate-image" },
server/api-proxy.js:163:  FLUX: { kind: "image", envKey: "REPLICATE_API_TOKEN", adapter: "replicate-image" },
server/api-proxy.js:216:  OpenAI: { kind: "assist", envKey: "OPENAI_API_KEY", adapter: "openai-responses" },
server/api-proxy.js:217:  "GPT voz + texto": { kind: "assist", envKey: "OPENAI_API_KEY", adapter: "openai-responses" },
server/api-proxy.js:218:  "GPT texto": { kind: "assist", envKey: "OPENAI_API_KEY", adapter: "openai-responses" },
```

**Ubicacion:** `server/api-proxy.js:162-163`, `server/api-proxy.js:216-220`.

**Impacto:** La UI puede mostrar multiples opciones que son el mismo adaptador/API, confundiendo al usuario y al tracking de costos.

**Causa probable:** Se agregaron nombres comerciales/alias sin capa canonical.

**Recomendacion:** Separar `providerId`, `displayName`, `modelId`, `capabilities` y `aliases`.

**Dependencia:** Catalogo central de providers.

**Criterio de validacion:** UI muestra opciones canonicas y aliases no duplican balances/costos.

## Seguridad

### Secretos expuestos

- No hay `.env` real dentro de `/Users/sweetlittletrauma/slt-studio-v2`; solo `.env.example`.
- Escaneo especifico de patrones reales de claves en `src`, `server`, `public`, `dist` excluyendo assets ruidosos no encontro claves concretas.
- Riesgo pendiente: `.gitignore` no ignora `.env` explicitamente.

### Riesgos principales

1. Auth mock + CORS abierto + providers reales.
2. CEO mode con estado local y clave unica.
3. Inputs enviados a proveedores sin schemas estrictos por modulo.
4. No hay ownership real de proyectos/historial.
5. Rate limiting esta en memoria; no sirve para multiples instancias.

## Comandos ejecutados y resultados

```txt
pwd
Resultado: /Users/sweetlittletrauma/Documents/Codex/2026-06-05/podes-revisar-en-mis-archivos-sin
```

```txt
ls -la /Users/sweetlittletrauma/slt-studio-v2
Resultado: repo encontrado con .git, package.json, src, server, public, dist, render.yaml.
```

```txt
git status --short
Resultado: working tree ya tenia modificaciones y archivos nuevos antes de crear este informe.
```

```txt
rg --files -g '!node_modules/**' -g '!dist/**' -g '!.git/**'
Resultado: inventario de archivos fuente completado.
```

```txt
npm run lint
Resultado: exit 0; warnings de unused vars y react only-export-components, sin errores fatales.
```

```txt
node --check server/api-proxy.js
Resultado: exit 0; sintaxis backend valida.
```

```txt
npm ls --depth=0
Resultado: exit 0; dependencias instaladas.
```

```txt
npm run
Resultado: scripts disponibles: dev, build, start, start:prod, lint, preview. No existe test.
```

```txt
curl -sS http://127.0.0.1:3000/health
Resultado: ok true; providersConnected 43; providersTotal 53; envFiles [].
```

```txt
curl -sS http://127.0.0.1:3000/api/providers
Resultado: ok true; auth mock; providers listados; varios connected/prepared/disabled/needs_config.
```

```txt
curl -sS http://127.0.0.1:3000/api/subscription-status
Resultado: 404 Not Found; endpoint inexistente.
```

```txt
curl -sS http://127.0.0.1:3000/api/subscription
Resultado: ok true; auth mock; Free active; credits 30.
```

```txt
curl -sS -I http://127.0.0.1:5174/
curl -sS -I http://127.0.0.1:5174/video
Resultado: Vite responde 200 HTML.
```

```txt
curl -sS -I http://127.0.0.1:3000/video
Resultado: backend sirve SPA desde dist con 200.
```

```txt
curl -sS http://127.0.0.1:3000/api/billing
Resultado: ok true; Stripe secret/webhook/publishable presentes; customerIdPresent false; automaticTaxEnabled false; billing mock visible.
```

```txt
find /Users/sweetlittletrauma/slt-studio-v2 -maxdepth 2 -name '.env*' -type f
Resultado: solo .env.example.
```

```txt
rg -n "sk-...|xai-...|crsr_...|AIza...|sk_live_...|BEGIN PRIVATE KEY" ...
Resultado: exit 1; sin secretos concretos encontrados con patrones especificos.
```

```txt
find ... -name '*test*' -type f
find ... -name '*spec*' -type f
find ... -name 'tsconfig.json' -type f
Resultado: sin tests/specs/tsconfig.
```

## Archivos inspeccionados

Principales:

- `package.json`
- `package-lock.json`
- `README.md`
- `.gitignore`
- `.env.example`
- `render.yaml`
- `vite.config.js`
- `index.html`
- `server/api-proxy.js`
- `src/App.jsx`
- `src/main.jsx`
- `src/index.css`
- `src/lib/api-client.js`
- `src/lib/storage.js`
- `src/context/AuthContext.jsx`
- `src/context/StudioContext.jsx`
- `src/hooks/useStudioGenerate.js`
- `src/hooks/useSubscription.js`
- `src/hooks/useVideoChat.js`
- `src/components/Layout.jsx`
- `src/components/Navbar.jsx`
- `src/components/BrandLogo.jsx`
- `src/components/Layout.css`
- `src/components/Navbar.css`
- `src/components/BrandLogo.css`
- `src/pages/Home.jsx`
- `src/pages/Home.css`
- `src/pages/VideoStudio.jsx`
- `src/pages/ImageStudio.jsx`
- `src/pages/MusicStudio.jsx`
- `src/pages/SoundStudio.jsx`
- `src/pages/FashionStudio.jsx`
- `src/pages/EngineeringLab.jsx`
- `src/pages/CEODashboard.jsx`
- `src/pages/ProfilePage.jsx`
- `src/pages/InfoPage.jsx`
- `src/pages/ContactPage.jsx`
- `src/pages/StudioLayout.css`
- `public/assets/*`
- `dist/*` solo para busqueda de secretos/servido estatico, no para editar.

## Recomendacion de commit

```txt
docs: add AUDIT-SLT-STUDIO.md
```

## Detencion

Fase 0 completada. No avanzar a Fase 1 desde este documento sin orden explicita.
