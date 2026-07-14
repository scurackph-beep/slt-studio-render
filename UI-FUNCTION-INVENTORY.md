# UI-FUNCTION-INVENTORY.md

Fecha: 2026-07-12  
Proyecto: Sweet Little Trauma Studio  
Objetivo: inventario funcional de interfaz, rutas, botones, formularios y estados conectados.

## Estado general

La interfaz es React/Vite y consume el backend Express mediante `src/lib/api-client.js`. En esta pasada se priorizo que los controles visibles tengan una salida real: navegacion por rutas, generacion por Gateway, polling de Jobs, uploads de referencia, formularios persistidos y libreria de assets.

Este inventario no declara que la plataforma sea produccion publica: todavia usa estado local/in-memory para usuarios, sesiones, jobs, ledger y forms hasta que se conecte una base durable.

## Rutas principales

| Ruta | Componente | Funcion real |
|---|---|---|
| `/` | `Home.jsx` | Entrada conversacional, quick prompts y acceso a estudios |
| `/image` | `ImageStudio.jsx` | Generacion de imagen, provider selector, ratios y upload de referencia |
| `/video` | `VideoStudio.jsx` | Generacion de video asincrona, providers, tool selector y upload de referencia |
| `/music` | `MusicStudio.jsx` | Generacion musical, provider selector, modo y upload de audio/letra |
| `/sound` | `SoundStudio.jsx` | Generacion/voz/audio, provider selector y upload de referencia |
| `/fashion` | `FashionStudio.jsx` | Bloqueado como Coming Soon |
| `/engineering` | `EngineeringLab.jsx` | Bloqueado como Coming Soon |
| `/library` | `LibraryPage.jsx` | Lista, previsualiza, descarga y borra assets del usuario |
| `/profile` | `ProfilePage.jsx` | Login local/CEO, estado de creditos y cuenta |
| `/contact` | `ContactPage.jsx` | Formulario real para contacto, soporte, careers, ventas y recovery |
| `/about`, `/careers`, `/privacy`, `/terms`, `/sitemap`, `/subscription`, `/settings`, `/help`, `/assist` | `InfoPage.jsx` | Paginas corporativas/informativas con acciones de navegacion |
| `/ceo` | `CEODashboard.jsx` | Panel CEO/local para billing, providers y monitoreo |

## Navegacion global

Archivo: `src/components/Navbar.jsx`

| Elemento | Ruta/accion | Estado |
|---|---|---|
| Logo | `/` | Conectado |
| Who We Are | `/about` | Conectado |
| Careers | `/careers` | Conectado |
| Site Map | `/sitemap` | Conectado |
| Privacy | `/privacy` | Conectado |
| Terms | `/terms` | Conectado |
| Subscription | `/subscription` | Conectado |
| Library | `/library` | Conectado |
| Help | `/help` | Conectado |
| Contact | `/contact` | Conectado |
| Credit badge | `StudioContext` ledger snapshot | Conectado local |
| Profile glyph | `/profile` | Conectado |

## Modulos creativos conectados

### Image Studio

Archivo: `src/pages/ImageStudio.jsx`

Controles reales:

- Tool selector: cambia la herramienta activa.
- Provider selector: cambia el provider enviado al backend.
- Ratio selector: cambia `ratio`.
- Prompt input: se envia a `/api/generate/image`.
- Generate: llama `useStudioGenerate`.
- ReferenceUploader: sube imagen a `/api/assets/upload` y adjunta `referenceAssetIds`.

Estados:

- Loading/generating.
- Error desde moderacion, auth, ledger o provider.
- Resultado final por Job/polling o respuesta directa.

### Video Studio

Archivo: `src/pages/VideoStudio.jsx`

Controles reales:

- Tool selector: Lip Sync, Motion Transfer, Scene Transfer, Image to Video, Text to Video.
- Provider selector: se envia al Gateway.
- Duration y ratio selectors.
- Prompt textarea.
- Generate CTA.
- ReferenceUploader para video/motion reference.

Estados:

- Queued/processing mediante polling.
- Completed con asset CDN/local.
- Failed con mensaje de error y liberacion de creditos desde backend.

### Music Studio

Archivo: `src/pages/MusicStudio.jsx`

Controles reales:

- Tool selector y mode selector.
- Prompt input.
- Provider selector.
- ReferenceUploader para audio o letra.
- Generate CTA.

Nota: botones de preview/mute/solo visuales deben mantenerse como estados de reproductor local o deshabilitarse si no hay asset final.

### Sound Studio

Archivo: `src/pages/SoundStudio.jsx`

Controles reales:

- Tool selector.
- Prompt input.
- Provider selector.
- ReferenceUploader para audio/dubbing reference.
- Generate CTA.

## Uploads y libreria

### ReferenceUploader

Archivo: `src/components/ReferenceUploader.jsx`

Funcion:

- Lee archivos locales en el navegador.
- Convierte a data URL.
- Envia a `/api/assets/upload`.
- Recibe un asset seguro sin `storagePath`.
- Devuelve el asset al modulo creativo para adjuntarlo al payload.

Tipos permitidos:

- Imagen: png, jpg, webp, gif.
- Video: mp4, webm, quicktime.
- Audio/musica: mp3, wav, ogg, webm, mp4 audio, texto.
- Fashion/reference: imagen y PDF.

### LibraryPage

Archivo: `src/pages/LibraryPage.jsx`

Funciones:

- `GET /api/assets`.
- Preview de imagen/video/audio.
- Download via `/api/assets/:assetId/download`.
- Delete via `DELETE /api/assets/:assetId`.

## Formularios corporativos

Archivo: `src/pages/ContactPage.jsx`

Tipos:

- General Contact.
- Support.
- Careers.
- Business Inquiry.
- Report a Problem.
- Suggestion.
- Cancel Subscription.
- Account Recovery.

Backend:

- `POST /api/forms/:kind`
- `POST /api/contact`

Validacion:

- Email valido si se envia.
- Mensaje minimo 8 caracteres.
- Mensaje maximo 5000 caracteres.

## Botones bloqueados o no productivos

| Area | Estado actual | Motivo |
|---|---|---|
| Fashion action buttons | Disabled / Coming Soon | No hay proveedor/product pipeline real completo |
| Engineering action buttons | Disabled / Coming Soon | No hay app/game/software builder real conectado |
| Algunas acciones CEO de vista/edicion | Parciales | Dashboard administrativo local, no backoffice final |
| Reproductores visuales sin asset final | Deben esperar resultado | Evita prometer reproduccion sin archivo generado |

## Criterio actual de QA

- Los botones principales navegan o llaman una API real.
- Los modulos sin backend real no disparan acciones falsas.
- Upload y forms tienen pruebas automatizadas.
- No se exponen rutas de storage local al cliente.

