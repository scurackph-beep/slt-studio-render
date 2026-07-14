# FULL-FUNCTIONAL-AUDIT.md

Fecha: 2026-07-12  
Proyecto: Sweet Little Trauma Studio  
Alcance: revision funcional full-stack sobre UI, backend, APIs, jobs, assets, formularios, auth local y deuda para produccion.

## Resumen ejecutivo

El proyecto quedo como plataforma funcional local/staging: los modulos principales de Image, Video, Music y Sound llaman al Gateway, usan Jobs asincronos cuando corresponde, reservan creditos, moderan input, reciben webhooks simulables y almacenan assets en un CDN/local path propio (`/cdn/assets/...`).

Lo que no debe afirmarse aun: produccion publica completa. El backend todavia usa estado in-memory para sesiones, usuarios, jobs, ledger, formularios y assets metadata. Para vender publicamente hace falta DB real, auth real y storage real.

## Hallazgos criticos resueltos en esta pasada

### Uploads de referencia no tenian circuito completo

Ubicacion: `src/pages/ImageStudio.jsx`, `src/pages/VideoStudio.jsx`, `src/pages/MusicStudio.jsx`, `src/pages/SoundStudio.jsx`, `src/components/ReferenceUploader.jsx`, `server/api-proxy.js`

Resultado:

- Se agrego upload de referencia reutilizable.
- Los assets se guardan localmente bajo storage configurado.
- El cliente recibe URL `/cdn/assets/...` y no path interno.
- El payload de generacion incluye `referenceAssetIds` y URLs de referencia.

### Libreria/historial de assets no era accionable

Ubicacion: `src/pages/LibraryPage.jsx`, `src/App.jsx`, `src/components/Navbar.jsx`

Resultado:

- Nueva ruta `/library`.
- Lista assets del tenant/usuario.
- Preview, download y delete.

### Contacto/careers/help no persistian solicitudes

Ubicacion: `src/pages/ContactPage.jsx`, `server/api-proxy.js`

Resultado:

- Formularios estructurados.
- Endpoint de forms.
- Validacion de email/mensaje.
- Almacenamiento local en `state.forms`.

## Flujo funcional real por modulo

### Generacion de imagen

Usuario -> `ImageStudio.jsx` -> `useStudioGenerate()` -> `POST /api/generate/image` -> moderacion -> ledger reserve -> ProviderGateway -> respuesta directa o Job -> storage -> ledger capture/release -> UI renderiza output.

### Generacion de video

Usuario -> `VideoStudio.jsx` -> upload opcional -> `POST /api/generate/video` -> HTTP 202 con Job ID para flujos largos -> polling `/api/jobs/:jobId` -> webhook provider -> storage local/CDN -> ledger capture -> frontend muestra asset.

### Generacion de musica/audio

Usuario -> `MusicStudio.jsx` o `SoundStudio.jsx` -> upload opcional -> `POST /api/generate/music|sound` -> calculo de costo por tipo -> provider real/simulado segun credenciales -> Job/polling o respuesta directa.

### Formularios corporativos

Usuario -> `/contact` -> `POST /api/forms/:kind` -> validacion -> persistencia local -> respuesta 201.

### Libreria

Usuario -> `/library` -> `GET /api/assets` -> preview seguro -> download/delete protegidos por tenant/auth.

## Seguridad funcional actual

| Area | Estado |
|---|---|
| Auth server-side para generacion/ledger/billing/assets | Implementado local |
| Contact/forms publicos con validacion | Implementado |
| Tenant filtering para assets | Implementado local |
| Storage path oculto al cliente | Implementado |
| Webhook signatures | Implementado para providers/Stripe |
| Rate limiting | Implementado in-memory |
| RLS real | Pendiente de DB |
| Session store durable | Pendiente |

## Riesgos pendientes

1. Estado in-memory se pierde al reiniciar el servidor.
2. En multi-instancia, jobs/ledger/forms se desincronizan.
3. `state.forms` no reemplaza CRM/ticketing real.
4. Storage local no es CDN productivo.
5. Auth local no debe usarse como login final.
6. Stripe y providers deben testearse en entorno real con secrets de staging.

## Validaciones agregadas

Archivo: `tests/core-flows.test.js`

- Upload de referencia: crea asset, guarda archivo, oculta `storagePath`, impide acceso cross-tenant.
- Forms: guarda careers/support y rechaza email/mensaje invalidos.

## Conclusion

El sitio queda mejor preparado para pruebas reales: los controles principales ya tienen comportamiento backend verificable. El siguiente salto no es estetico ni de provider: es infraestructura durable.

