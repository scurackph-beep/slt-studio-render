# Video Studio Phase 1A

## Scope

This phase adds an isolated, read-only Video Studio architecture surface. It does not replace the current studio or the approved V2 mockup.

## Local routes

- Current studio: `/video?site_gate=Dientito2032`
- Approved V2 mockup: `/video?site_gate=Dientito2032&studio=v2`
- Phase 1A live read model: `/video?site_gate=Dientito2032&studio=next`

## Connected resources

- `GET /api/projects`
- `GET /api/assets`
- `GET /api/history`
- `GET /api/jobs?kind=video&limit=50`
- `GET /api/ledger`

All calls reuse the existing API client, Site Gate header, session token and bearer authorization. The screen refreshes read-only data and cannot create jobs, upload assets, modify projects or spend credits.

## Backend addition

`GET /api/jobs` lists only records accessible to the authenticated tenant. It supports optional `kind` and `limit` query parameters and returns a status summary. The existing `/api/jobs/:jobId` behavior remains unchanged.

## Preserved behavior

- Home and global navigation are unchanged.
- Site Gate and CEO/Guest/Spy permissions are unchanged.
- Existing Video Studio is unchanged.
- `studio=v2` remains the simulated visual mockup.
- Provider adapters, generation routes, ledger mutations, PostgreSQL, Supabase Storage and production deployment are unchanged.
- No real generation API is called by `studio=next`.

## Stop condition

Do not add generation, batches, scenes, characters, versions, timeline persistence or new provider calls until this read-only foundation is reviewed.
