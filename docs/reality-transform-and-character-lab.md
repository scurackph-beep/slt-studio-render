# Reality Transform and Character Lab

## Decision

Sweet Little Trauma uses its own orchestration layer and does not depend on a copied interface or proprietary engine.

- Primary Reality Transform provider: Runway API, `POST /v1/video_to_video`, model `aleph2`.
- Controlled fallback: the official `luma/modify-video` model through Replicate.
- OpenAI remains useful for prompt direction, moderation and assistant workflows. It is not the renderer for this video-to-video operation.
- Apple developer frameworks are optional capture accelerators, not the cloud generation backend.

Official references:

- Runway API: <https://docs.dev.runwayml.com/api/>
- Runway uploads: <https://docs.dev.runwayml.com/assets/uploads/>
- Runway output retention: <https://docs.dev.runwayml.com/assets/outputs/>
- Runway pricing: <https://docs.dev.runwayml.com/guides/pricing/>
- Luma Modify API schema: <https://replicate.com/luma/modify-video/api/schema>

## Reality Transform flow

1. The creator selects **Reality Transform** in Video Studio.
2. SLT requires a source performance video. Supported browser uploads are MP4, MOV and WebM.
3. The binary upload endpoint stores the file without converting the complete video to base64 in browser memory.
4. SLT records source duration metadata and validates the provider window of 2 to 30 seconds.
5. The interface requests a server-side credit estimate. Runway Aleph 2 is estimated at 28 provider credits per second with a 56-credit minimum.
6. On Generate, moderation runs before money or jobs move.
7. The ledger reserves the complete cost, including 1 to 8 requested outputs.
8. The gateway submits to Runway. A private/local source is transferred through Runway's ephemeral upload workflow; a compatible HTTPS asset can be referenced directly.
9. The API returns HTTP 202 with the internal SLT job ID.
10. The UI shows queue state and elapsed time while polling `/api/jobs/:jobId`.
11. SLT polls the provider task. On success, the ephemeral output is downloaded and copied to SLT storage.
12. Only after persistent storage succeeds does the ledger capture the reservation. Storage or provider failure marks the job failed and releases the reservation.
13. The permanent asset appears in the player, Library, history and project records.

## Provider fallback

Reality Transform has a deliberately narrow fallback chain:

1. Runway `aleph2`.
2. Replicate `luma/modify-video`.

It does not silently route this task to text-to-video providers that cannot preserve the original performance.

## Character Lab

Character Lab is a provider-neutral identity dataset system. It separates identity collection from provider training so that source media, consent and versions remain owned by SLT.

### Capture areas

- Identity and explicit consent.
- Face angles and lighting variation.
- Expressions including neutral, laugh, cry, shout, anger, fear, surprise and eyes closed.
- Full body, hands, sitting, standing and wardrobe variation.
- Performance videos with walking, turning, gesturing and speech.
- Voice calibration: alphabet and numbers, a calibration phrase, neutral narration, whisper, shout, laugh, cry, anger and fear.

The recommended baseline is 50 images, 6 performance videos, 8 voice clips, 8 angles and 8 expressions. This is not a maximum. The schema and batch intake are designed for substantially larger collections, including thousands of references.

Each saved dataset version stores the exact asset IDs, consent IDs and coverage counts. Saving a version does not start an external training job until a provider-specific adapter is intentionally configured.

## Apple developer tools

The web product does not need an Apple-only dependency to function. A future iPhone/macOS capture companion can improve input quality with:

- AVFoundation for guided recording, trimming, frame extraction and audio capture.
- Vision for face/body landmark coverage and blur/occlusion checks.
- ARKit depth and pose guidance on supported devices.
- VideoToolbox for hardware-assisted local transcoding.
- Core ML for local capture-quality scoring.

These tools prepare better source material. Runway or Luma still performs the generative environment transformation.

## Environment variables

```dotenv
RUNWAY_API_KEY=
RUNWAY_API_URL=https://api.dev.runwayml.com/v1
RUNWAY_API_VERSION=2024-11-06
REPLICATE_API_TOKEN=
LUMA_MODIFY_REPLICATE_MODEL=luma/modify-video
MAX_VIDEO_UPLOAD_BYTES=209715200
MAX_AUDIO_UPLOAD_BYTES=104857600
MAX_BINARY_UPLOAD=210mb
```

Secrets remain backend-only. No real provider request should be made by automated tests.

## New routes

- `POST /api/generate/estimate`
- `POST /api/assets/upload-binary`
- `GET /api/characters`
- `POST /api/characters`
- `GET /api/characters/:characterId`
- `PATCH /api/characters/:characterId`
- `POST /api/characters/:characterId/consent`
- `POST /api/characters/:characterId/assets`
- `POST /api/characters/:characterId/versions`

## Verification boundary

Automated verification uses mocked provider responses. It must confirm routing, job polling, durable asset storage, credit capture/release, tenant isolation and character dataset coverage without consuming provider credits.
