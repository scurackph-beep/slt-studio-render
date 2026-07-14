# MIGRATION-GUIDE.md

Fecha: 2026-07-12  
Proyecto: Sweet Little Trauma Studio

## Objetivo

Pasar de prototipo/staging local a infraestructura real sin romper la UI ni el Gateway.

## Paso 1: Crear base de datos

1. Crear Postgres en Supabase, Neon, Render o equivalente.
2. Copiar `DATABASE_URL` al hosting.
3. Ejecutar `npm run db:migrate` o aplicar `migrations/001_production_schema.sql`.
4. Confirmar indices y unique constraints.
5. Definir `SLT_REQUIRE_PRODUCTION_INFRASTRUCTURE=true` en staging para verificar que el servidor no arranca si falta algo.
6. Levantar el backend y confirmar `GET /health` con `dataStore.kind = "postgres"` y `dataStore.durable = true`.

## Paso 2: Conectar Auth real

1. Crear proyecto Supabase.
2. Copiar `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`.
3. Definir `AUTH_PROVIDER=supabase`.
4. Configurar callback domains.
5. Definir `tenant_id` y `role` en `app_metadata`.
6. Testear 401/403.

## Paso 3: Reemplazar repositorios in-memory

Orden sugerido:

1. Users/tenants.
2. Wallets + credit transactions.
3. Jobs.
4. Assets.
5. Webhook events.
6. Forms/projects/history.
7. Subscriptions/payments.

## Paso 4: Conectar storage real

1. Crear bucket Supabase `slt-assets` o el nombre elegido.
2. Definir `STORAGE_PROVIDER=supabase`.
3. Definir `STORAGE_BUCKET`.
4. Confirmar politicas de bucket publico o signed URLs segun la estrategia.
5. Testear upload/download/delete.

## Paso 5: Webhooks publicos

1. Configurar dominio HTTPS.
2. Definir `PUBLIC_WEBHOOK_BASE_URL`.
3. Registrar webhooks de Stripe y providers.
4. Validar firmas con payload real.

## Paso 6: Prueba controlada

1. Crear usuario interno.
2. Otorgar creditos test.
3. Ejecutar generacion de imagen.
4. Confirmar Job -> asset -> ledger capture.
5. Ejecutar falla simulada.
6. Confirmar release exacto.

## Paso 7: Prueba obligatoria de reinicio

Con `DATABASE_URL` configurado:

1. Iniciar backend.
2. Crear un proyecto o enviar un formulario.
3. Confirmar que aparece en PostgreSQL.
4. Detener backend.
5. Reiniciar backend.
6. Confirmar que el dato sigue visible desde la API.
7. Ejecutar `npm run db:verify-persistence`.

Esta prueba no se pudo ejecutar en la Mac actual porque no hay PostgreSQL local ni `DATABASE_URL`.

## Go-live checklist

- DB durable: requerido.
- Auth real: requerido.
- Storage/CDN real: requerido.
- `/health.infrastructure.ok = true`: requerido.
- Stripe test verde: requerido.
- Provider con limite de gasto: requerido.
- Legal/taxes/privacy/terms revisados: requerido.
