# AUTH-FLOW.md

Fecha: 2026-07-12  
Proyecto: Sweet Little Trauma Studio

## Estado actual

El backend tiene login local y sesiones en memoria para pruebas. Esto sirve para staging local, pero no para produccion publica.

Rutas protegidas actuales:

- `/api/generate/*`
- `/api/jobs/*`
- `/api/ledger`
- `/api/assets*`
- `/api/uploads*`
- `/api/projects`
- `/api/history`
- `/api/billing*`
- `/api/subscription`
- `/api/user`
- `/api/studio/run`
- `/api/ceo/*`

Rutas publicas controladas:

- `/health`
- `/api/providers`
- `/api/forms/:kind`
- `/api/contact`
- Webhooks firmados.

## Flujo objetivo

1. Usuario inicia sesion con proveedor Auth real.
2. Frontend recibe token/session.
3. Frontend envia `Authorization: Bearer <token>`.
4. Backend valida firma, expiracion, audiencia y tenant.
5. Backend deriva `userId`, `tenantId`, `role` solo del token validado.
6. Todas las queries DB filtran por tenant.
7. Rutas CEO/admin requieren role elevado.

## Reglas

- Nunca confiar en `userId` del body.
- Nunca confiar en `x-slt-user-id` desde frontend.
- Webhooks no usan auth de usuario, usan firma criptografica.
- Contact/careers puede ser publico pero con rate limit, captcha si se abre masivamente y validacion de input.

## Implementacion pendiente

- Pegar credenciales reales Supabase en `.env`.
- Confirmar `SUPABASE_JWT_SECRET`.
- Probar signup/login/recovery contra Supabase real.
- Persistir roles/tenant en claims `app_metadata`.

## Proteccion actual

`server/production-infrastructure.js` marca Auth como incompleto para produccion si:

- `AUTH_PROVIDER=local`.
- No existe `AUTH_SECRET`, `AUTH_JWT_SECRET` o `SESSION_COOKIE_SECRET`.

Esto no reemplaza Auth real, pero impide declarar listo el sistema con login local.

## Implementacion Supabase agregada

- `AUTH_PROVIDER=supabase` activa validacion server-side del JWT.
- `strictAuthForRequest()` acepta solo JWT firmado por `SUPABASE_JWT_SECRET`.
- `/api/login` usa Supabase Auth.
- `/api/auth/signup` crea usuario con Supabase Admin.
- `/api/auth/password-recovery` dispara el flujo de recovery.
- `requestIdentity()` usa `tenantId` del token cuando existe.
- `canAccessRecord()` valida `tenantId` o `userId`.
