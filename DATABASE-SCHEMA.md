# DATABASE-SCHEMA.md

Fecha: 2026-07-12  
Proyecto: Sweet Little Trauma Studio

## Objetivo

Definir el esquema durable minimo para migrar el backend desde `state` in-memory a Postgres.

## Entidades principales

| Tabla | Proposito |
|---|---|
| `tenants` | Cuenta/organizacion del usuario |
| `users` | Usuarios autenticados |
| `sessions` | Sesiones o refresh tokens si no se usa auth gestionado |
| `wallets` | Saldos agregados por tenant |
| `credit_reservations` | Fondos retenidos antes de captura/release |
| `credit_transactions` | Ledger inmutable double-entry |
| `jobs` | Cola asincrona de generaciones |
| `assets` | Metadata de archivos persistidos |
| `providers` | Catalogo persistible de proveedores |
| `models` | Modelos por proveedor/tipo |
| `projects` | Proyectos guardados |
| `history_entries` | Historial de generaciones |
| `webhook_events` | Idempotencia de providers y Stripe |
| `subscriptions` | Estado comercial |
| `payment_events` | Eventos de pago procesados |
| `platform_forms` | Contacto, soporte, careers, recovery |
| `runtime_state_snapshots` | Snapshot de compatibilidad para hidratar el estado actual |

## Reglas de integridad

- `credit_transactions.idempotency_key` debe ser unico.
- `webhook_events.provider + event_id` debe ser unico.
- Jobs terminales no deben volver a capturar creditos.
- Assets deben pertenecer a `tenant_id`.
- Lectura/escritura siempre filtra por `tenant_id`.

## Migracion

Archivo SQL inicial: `migrations/001_production_schema.sql`.

Rollback: `migrations/001_production_schema.down.sql`.

Runtime store: `server/postgres-store.js`.

Driver: `pg`.

RLS Supabase: `migrations/002_supabase_rls.sql`.

Soporte/formularios:

- `platform_forms`
- `support_tickets`

Prueba de persistencia: `npm run db:verify-persistence`.

## RLS recomendada si se usa Supabase

Politicas minimas:

- `tenant_id = auth.jwt()->>'tenant_id'` para SELECT/INSERT/UPDATE en tablas de usuario.
- Webhooks usan service role server-side, nunca desde frontend.
- Ledger solo escribible por service role/backend.

## Campos sensibles

No guardar claves de proveedores por usuario en texto plano. Si en el futuro se habilitan BYOK/API keys por cliente, guardarlas cifradas con KMS y nunca devolverlas al frontend.
