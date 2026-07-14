# PRODUCTION-INFRASTRUCTURE.md

Fecha: 2026-07-12  
Proyecto: Sweet Little Trauma Studio  
Objetivo: infraestructura real necesaria para pasar de staging/local a produccion publica.

## Decision honesta de estado

El repositorio no debe declararse listo para produccion publica mientras siga usando:

- Sesiones en memoria.
- Usuarios en memoria.
- Jobs en memoria.
- Ledger en memoria.
- Forms en memoria.
- Storage local como destino final.

Esta pasada preparo el codigo y la documentacion para migrar, pero no inventa credenciales ni conecta servicios externos sin configuracion real.

## Proteccion agregada en runtime

Archivo: `server/production-infrastructure.js`

El backend ahora calcula un reporte de infraestructura con:

- `DATABASE_URL`.
- `AUTH_PROVIDER` + `AUTH_SECRET`/`AUTH_JWT_SECRET`.
- `STORAGE_PROVIDER`, bucket, URL publica y claves de storage.
- `WEBHOOK_BASE_URL` o `PUBLIC_WEBHOOK_BASE_URL`.

Si `NODE_ENV=production` o `SLT_REQUIRE_PRODUCTION_INFRASTRUCTURE=true` y faltan esas piezas, el servidor lanza error y no arranca salvo que se fuerce explicitamente `SLT_ALLOW_UNSAFE_PRODUCTION=true`.

Esto evita subir una version publica que siga dependiendo de usuarios simulados, memoria global o storage local.

`/health` expone el reporte de readiness sin imprimir secretos.

## PostgreSQL RuntimeStore agregado

Archivo: `server/postgres-store.js`

Se agrego una capa de datos para PostgreSQL usando el driver oficial `pg`.

Funcionamiento:

- Si `DATABASE_URL` existe y no estamos en `SLT_TEST_MODE=1`, el backend crea `PostgresRuntimeStore`.
- Al arrancar, ejecuta `migrations/001_production_schema.sql`.
- Hace seed minimo de tenant, user y wallet.
- Intenta hidratar el estado desde `runtime_state_snapshots` o desde tablas relacionales.
- Despues de mutaciones `POST`, `PUT`, `PATCH` o `DELETE` en `/api/*`, persiste el runtime state a PostgreSQL.
- En test/development sin `DATABASE_URL`, usa `MemoryRuntimeStore` separado.

Ruta de control:

- `GET /api/db/status` muestra el store activo. Esta ruta queda protegida y requiere rol owner/CEO.

Limitacion honesta:

- En esta Mac no hay `psql`, `postgres`, `pg_ctl`, Docker ni `.env` con `DATABASE_URL`. Por eso no se pudo ejecutar la prueba final de supervivencia real tras reinicio.
- La fase no debe considerarse aceptada hasta proveer un Postgres real y verificar create -> restart -> read.

## Supabase como infraestructura unificada

Archivos:

- `server/supabase-service.js`
- `server/postgres-store.js`
- `migrations/002_supabase_rls.sql`
- `scripts/verify-supabase-persistence.js`

Variables obligatorias para modo productivo Supabase:

- `DATABASE_URL`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_JWT_SECRET`
- `AUTH_PROVIDER=supabase`
- `STORAGE_PROVIDER=supabase`
- `STORAGE_BUCKET`
- `WEBHOOK_BASE_URL` o `PUBLIC_WEBHOOK_BASE_URL`

Auth:

- `/api/login` usa `supabase.auth.signInWithPassword()` cuando `AUTH_PROVIDER=supabase`.
- `/api/auth/signup` crea usuario en Supabase Auth mediante service role.
- `/api/auth/password-recovery` solicita recovery email desde Supabase.
- Rutas privadas validan JWT Supabase server-side con `SUPABASE_JWT_SECRET`.

Storage:

- Si `STORAGE_PROVIDER=supabase`, uploads de usuario y assets de webhooks se suben a Supabase Storage.
- El frontend recibe `publicUrl` de Supabase Storage.
- `DELETE /api/assets/:id` borra el objeto del bucket usando `storageKey`.

RLS:

- `migrations/002_supabase_rls.sql` habilita RLS y politicas por `tenant_id`, `user_id` y claims JWT.

Prueba de fuego:

- Ejecutar `npm run db:migrate`.
- Ejecutar `npm run db:verify-persistence`.

No se ejecuto aun porque no hay credenciales Supabase ni `DATABASE_URL` en esta maquina.

## Infraestructura minima requerida

| Componente | Recomendado | Motivo |
|---|---|---|
| Base de datos | Postgres via Supabase, Neon o Render Postgres | Ledger y Jobs necesitan transacciones |
| Auth | Supabase Auth, Clerk, Auth0 o JWT propio server-side | Reemplaza login local |
| Storage/CDN | Cloudflare R2, S3 o Supabase Storage | Persistencia de assets generados |
| Webhooks publicos | Dominio HTTPS estable | Providers/Stripe deben llamar URL publica |
| Secrets manager | Render/Vercel env vars | Evitar keys en repo |
| Observabilidad | Logs + alertas de costos | Control de fallos y gasto |

## Variables nuevas necesarias

Ver `.env.example`.

Obligatorias para produccion:

- `DATABASE_URL`
- `AUTH_PROVIDER`
- `AUTH_JWT_SECRET` o provider-specific keys.
- `STORAGE_PROVIDER`
- `STORAGE_BUCKET`
- `STORAGE_PUBLIC_BASE_URL`
- `STORAGE_ACCESS_KEY_ID`
- `STORAGE_SECRET_ACCESS_KEY`
- `STORAGE_REGION`
- `PUBLIC_WEBHOOK_BASE_URL`

## Rutas que deben usar persistencia real

| Ruta | Persistencia requerida |
|---|---|
| `/api/login` | Usuarios/sesiones reales |
| `/api/generate/*` | Jobs, ledger, generations, assets |
| `/api/jobs/:jobId` | Jobs durable |
| `/api/webhooks/*` | Jobs, webhook events, ledger, assets |
| `/api/billing/*` | Payment events, subscriptions, credit grants |
| `/api/assets*` | Metadata DB + storage bucket |
| `/api/forms/*` | Forms/tickets DB |
| `/api/projects`, `/api/history` | DB por tenant |

## Plan de migracion por etapas

1. Crear Postgres.
2. Ejecutar `migrations/001_production_schema.sql`.
3. Configurar auth real y emitir JWT validable por backend.
4. Reemplazar `state.*` por repositorios DB.
5. Configurar bucket R2/S3.
6. Reemplazar escritura local de assets por upload al bucket.
7. Configurar `PUBLIC_WEBHOOK_BASE_URL` HTTPS.
8. Validar Stripe/provider webhooks con URLs publicas.
9. Correr tests con mocks.
10. Hacer prueba real de provider con limite de gasto.

## No hacer antes de la migracion

- No abrir registro publico.
- No vender suscripciones a usuarios finales.
- No permitir cargas grandes sin bucket/CDN.
- No correr multiples instancias con estado en memoria.
- No confiar en el header `x-slt-user-id`.
