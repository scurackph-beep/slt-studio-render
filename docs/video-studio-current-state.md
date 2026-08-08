# Sweet Little Trauma Studio - Video Studio V2 Current State

Date: 2026-08-06

## Scope of this checkpoint

This document records the current local state of the isolated Video Studio V2 mockup. No Phase 1B work has been started. No real generation API was connected to the V2 mockup, and no production deployment was performed as part of this checkpoint.

## 1. Mockup integrity

The Video Studio V2 mockup remains present and isolated behind the `studio=v2` query parameter.

Routing evidence in `src/pages/VideoStudio.jsx`:

```js
const previewMode = new URLSearchParams(window.location.search).get('studio') === 'v2';

if (previewMode) {
  return <VideoStudioV2Preview />;
}
```

Verified file checksums:

```text
7722cacb27e6cfe7672f9279f1098e3e67e931d5  src/pages/VideoStudio.jsx
5ba91b05d38112300ba744c9deda742d03d0bbf0  src/pages/VideoStudioV2Preview.jsx
ec68c3ec617fe250f8ed580f227f757ad7b19cd6  src/pages/VideoStudioV2Preview.css
```

The local Vite server returned HTTP 200 for both the V2 and previous Video Studio URLs.

## 2. Exact local URL for Video Studio V2

```text
http://127.0.0.1:5177/video?site_gate=Dientito2032&studio=v2
```

The Vite development server must remain running on port `5177` for this URL to open.

## 3. Return to the previous Video Studio interface

Remove `&studio=v2` from the URL. The previous interface is available at:

```text
http://127.0.0.1:5177/video?site_gate=Dientito2032
```

No file restoration is required. Both interfaces coexist in `VideoStudio.jsx`; the query parameter only chooses which component React renders.

## 4. Controls that currently work in the V2 mockup

These controls perform real client-side React state changes inside the mockup. They do not call generation providers.

- Workspace tabs: Projects, Assets, Characters and References.
- Selection of individual library rows.
- Prompt textarea and character counter.
- Create, Director and Output inspector tabs.
- Model selector.
- Duration selector: 5, 10 and 15 seconds.
- Aspect ratio selector: 16:9, 9:16 and 1:1.
- Output quantity stepper, limited from 1 through 8.
- Advanced settings expand/collapse control.
- Motion strength and prompt adherence sliders.
- Lock seed checkbox.
- Camera movement and shot selectors.
- Editable lens, lighting, scene start and scene end controls.
- Editable resolution, frame rate, format, audio and watermark controls.
- Player play/pause, previous-frame, next-frame and timeline scrubber.
- Timeline clip selection.
- Version-card selection.
- Remix: copies a remix instruction into the prompt and opens the Create tab.
- Generate and Generate Video: add a simulated job to the local queue.
- Queue rows: select a job and show its local status message.
- Library link: navigates to the existing `/library` route.
- Save Draft: changes the local status message only.

## 5. Controls that are visual, partial or simulated

The following controls do not yet perform their production action:

- Add Item has no handler.
- Workspace search accepts text but does not filter data.
- Upload Reference only changes the local notice; it does not open the real uploader.
- Canvas, Storyboard and Versions toolbar buttons do not switch workspace views.
- Zoom out, zoom in and fullscreen have no handlers.
- Sound and player download controls have no handlers.
- Save Frame only changes the notice; it does not create an Asset.
- Download only changes the notice; it does not create or download a file.
- View All only changes the notice; it does not open complete history.
- Undo, Redo and Split have no timeline-editing implementation.
- Timeline tracks and clips are display data and cannot be trimmed, moved or persisted.

The following information is entirely simulated in `VideoStudioV2Preview.jsx`:

- Projects, assets, characters and reference collections.
- Preview image, duration, take and safe-frame presentation.
- Initial generation jobs and their providers.
- Queue progress, elapsed time and automatic state changes.
- Generation history and versions.
- Character reference and its percentage.
- Project name and session context.
- Timeline clips, effects track and audio track.
- Available and reserved credit values in the status bar.
- Estimated cost calculation shown by the V2 interface.
- Generated result metadata such as resolution, FPS and provider.

The V2 component imports React state utilities and `Link`; it does not import `api-client`, `useVideoChat`, `useStudioGenerate`, provider adapters or database services.

## 6. Files modified or created for Video Studio V2

### Modified

- `src/pages/VideoStudio.jsx`: imports the V2 preview and selects it only when `studio=v2` is present.

### Created

- `src/pages/VideoStudioV2Preview.jsx`: isolated interactive mockup using simulated data.
- `src/pages/VideoStudioV2Preview.css`: isolated V2 visual styling.
- `docs/video-studio-current-state.md`: this checkpoint document.

The repository contains other pre-existing uncommitted and untracked files unrelated to this checkpoint. They were not modified while creating this document.

## 7. Unaffected systems

- Home: unchanged by Video Studio V2 and unchanged during this checkpoint.
- Backend: no files under `server/` were changed.
- Database: no migration or database file was changed or executed.
- Providers: no adapter, provider configuration, credential or routing logic was changed.
- Storage: no upload or storage operation was triggered.
- Production: no commit, push, deployment, service restart or production write was performed.

A read-only production health request returned `ok: true`, with PostgreSQL reported as durable and ready, Supabase Storage reported as durable and configured, and no missing production infrastructure variables.

## 8. Verification commands

Read-only checks performed:

```text
git status --short
shasum src/pages/VideoStudio.jsx src/pages/VideoStudioV2Preview.jsx src/pages/VideoStudioV2Preview.css
curl http://127.0.0.1:5177/video?site_gate=Dientito2032&studio=v2
curl http://127.0.0.1:5177/video?site_gate=Dientito2032
curl https://www.studiosweetlittletrauma.com/health
```

No build was executed because this task explicitly prohibited modifying any other file, and a build would regenerate `dist/`.

## Stop condition

Work is stopped at this checkpoint. Video Studio V2 remains a visual and interaction mockup. Phase 1B, real API wiring, database changes and production deployment require separate explicit approval.
