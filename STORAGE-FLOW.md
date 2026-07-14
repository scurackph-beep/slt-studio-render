# STORAGE-FLOW.md

Fecha: 2026-07-12  
Proyecto: Sweet Little Trauma Studio

## Estado actual

El backend guarda assets en storage local configurable:

- Directorio: `SLT_STORAGE_DIR` o `../storage/assets`.
- URL publica local: `/cdn/assets/...`.
- Metadata: `state.assets`.

Esto es suficiente para pruebas locales, pero no para produccion multi-instancia.

## Flujo actual de upload

1. Frontend lee archivo con `FileReader`.
2. Envia data URL a `/api/assets/upload`.
3. Backend valida MIME y tamaño.
4. Backend escribe archivo local.
5. Backend guarda metadata en `state.assets`.
6. Frontend recibe asset sin `storagePath`.

## Flujo objetivo con bucket

1. Backend recibe archivo o asset temporal de provider.
2. Backend valida MIME, tamaño y ownership.
3. Backend sube bytes a R2/S3/Supabase Storage.
4. Backend guarda metadata en DB.
5. Frontend consume solo URL propia o firmada.
6. Delete elimina metadata y objeto del bucket.

## Variables requeridas

- `STORAGE_PROVIDER`
- `STORAGE_BUCKET`
- `STORAGE_PUBLIC_BASE_URL`
- `STORAGE_ACCESS_KEY_ID`
- `STORAGE_SECRET_ACCESS_KEY`
- `STORAGE_REGION`
- `STORAGE_ENDPOINT`

## Reglas

- No guardar URLs temporales de provider como output final.
- No exponer `storagePath`.
- No permitir cross-tenant download/delete.
- No capturar creditos si falla la descarga/subida del asset final.

## Proteccion actual

`server/production-infrastructure.js` marca Storage como incompleto para produccion si:

- `STORAGE_PROVIDER=local`.
- Falta `STORAGE_BUCKET`.
- Falta `STORAGE_PUBLIC_BASE_URL`.
- Faltan claves de acceso (`STORAGE_ACCESS_KEY`/`STORAGE_ACCESS_KEY_ID` y `STORAGE_SECRET_KEY`/`STORAGE_SECRET_ACCESS_KEY`).

El storage local sigue disponible solo para development/staging.

## Implementacion Supabase agregada

- `server/supabase-service.js` crea un cliente admin Supabase con service role.
- `storeProviderAsset()` y `storeUploadedReferenceAsset()` suben a Supabase Storage cuando `STORAGE_PROVIDER=supabase`.
- Los assets guardan:
  - `publicUrl`
  - `storageKey`
  - `storageProvider=supabase`
  - `bucket`
- Descarga redirige a `publicUrl` si el archivo no existe localmente.
- Delete purga el objeto de Supabase Storage cuando hay `storageKey`.
