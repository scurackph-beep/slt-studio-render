# Solo Mac local (bloqueado Cloud Linux)

Este repo **no** debe trabajarse en Cursor Cloud / Linux remoto para el player iOS.

## Volver a tu Mac ahora

1. En el navegador: abrí [cursor.com/agents](https://cursor.com/agents) y **Stop / Archive** este Cloud Agent.
2. En tu **Mac**: abrí **Cursor Desktop** (app local).
3. **File → Open Folder** y elegí el proyecto local real:
   - `~/slt-studio-v2` **o**
   - la carpeta del player en Desktop (`BullShit-Mp3-Easy-Reproductor` / `apps/bullshit-mp3`)
4. En el composer del Agent, el menú del entorno debe decir **Local / This Mac**, **no Cloud**.
5. Si solo ves Cloud: el folder local no está abierto. Volvé al paso 3.
6. Pedí de nuevo: *poné DJ The Unicorn en el iPhone*.

## Por qué

Cloud Agent corre en una VM Linux sin Xcode ni tu iPhone USB. Tu máquina Apple sí los tiene.

## Guardrails en el repo

- Regla: `.cursor/rules/mac-local-only.mdc`
- Hook: `.cursor/hooks/block-cloud-linux.sh` (niega trabajo en Linux Cloud)
