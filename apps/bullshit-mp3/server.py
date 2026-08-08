#!/usr/bin/env python3
"""BullShit Mp3 — servidor local: UI + letras + stems IA."""
from __future__ import annotations

import os
import shutil
import subprocess
import uuid
from pathlib import Path

import requests
from flask import Flask, jsonify, request, send_from_directory

ROOT = Path(__file__).resolve().parent
APP_DIR = ROOT / "app"
STEMS_DIR = ROOT / "stems_cache"
STEMS_DIR.mkdir(exist_ok=True)

app = Flask(__name__, static_folder=str(APP_DIR), static_url_path="")


@app.get("/")
def index():
    return send_from_directory(APP_DIR, "index.html")


@app.get("/api/health")
def health():
    demucs = False
    try:
        import demucs  # noqa: F401
        demucs = True
    except Exception:
        demucs = shutil.which("demucs") is not None
    return jsonify({
        "ok": True,
        "demucs": demucs,
        "ffmpeg": shutil.which("ffmpeg") is not None,
    })


@app.get("/api/lyrics")
def lyrics():
    q = (request.args.get("q") or "").strip()
    artist = (request.args.get("artist") or "").strip()
    track = (request.args.get("track") or "").strip()
    duration = request.args.get("duration")

    try:
        if artist and track:
            params = {"artist_name": artist, "track_name": track}
            if duration:
                try:
                    params["duration"] = int(float(duration))
                except ValueError:
                    pass
            r = requests.get("https://lrclib.net/api/get", params=params, timeout=15)
            if r.status_code == 200:
                return jsonify({"ok": True, "source": "get", "data": r.json()})

        search_q = q or f"{artist} {track}".strip()
        if not search_q:
            return jsonify({"ok": False, "error": "Escribe el nombre de la canción"}), 400

        r = requests.get("https://lrclib.net/api/search", params={"q": search_q}, timeout=15)
        r.raise_for_status()
        results = r.json() or []
        if not results:
            return jsonify({"ok": False, "error": "No encontré letras"}), 404

        best = results[0]
        for item in results:
            if item.get("syncedLyrics"):
                best = item
                break
        return jsonify({"ok": True, "source": "search", "data": best, "results": results[:8]})
    except requests.RequestException as exc:
        return jsonify({"ok": False, "error": f"Error de red: {exc}"}), 502


def _run_demucs(input_path: Path, out_dir: Path) -> dict:
    cmd = [
        "python3", "-m", "demucs",
        "--two-stems", "vocals",
        "-n", "htdemucs",
        "-o", str(out_dir),
        str(input_path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=60 * 40)
    if proc.returncode != 0:
        raise RuntimeError((proc.stderr or proc.stdout or "Demucs falló")[-2000:])

    found = list(out_dir.rglob("*.wav"))
    vocals = next((p for p in found if p.stem.lower() == "vocals"), None)
    instrumental = next(
        (p for p in found if p.stem.lower() in {"no_vocals", "instrumental"}),
        None,
    )
    if not vocals or not instrumental:
        if len(found) >= 2:
            vocals, instrumental = found[0], found[1]
        else:
            raise RuntimeError("No se generaron stems")
    return {"vocals": vocals, "instrumental": instrumental}


@app.post("/api/stems")
def stems():
    if "file" not in request.files:
        return jsonify({"ok": False, "error": "Sube un archivo"}), 400
    f = request.files["file"]
    if not f.filename:
        return jsonify({"ok": False, "error": "Archivo vacío"}), 400

    demucs_ok = False
    try:
        import demucs  # noqa: F401
        demucs_ok = True
    except Exception:
        demucs_ok = shutil.which("demucs") is not None

    if not demucs_ok:
        return jsonify({
            "ok": False,
            "need_install": True,
            "error": "Motor IA (Demucs) no instalado. Usa separación rápida en la app, o instala Demucs.",
            "install": "pip3 install demucs torch torchaudio",
        }), 501

    job = uuid.uuid4().hex[:12]
    job_dir = STEMS_DIR / job
    job_dir.mkdir(parents=True, exist_ok=True)
    ext = Path(f.filename).suffix or ".wav"
    inp = job_dir / f"input{ext}"
    f.save(inp)

    try:
        paths = _run_demucs(inp, job_dir / "out")
        vocals_dst = job_dir / "vocals.wav"
        instr_dst = job_dir / "instrumental.wav"
        shutil.copy2(paths["vocals"], vocals_dst)
        shutil.copy2(paths["instrumental"], instr_dst)
        return jsonify({
            "ok": True,
            "job": job,
            "stems": {
                "vocals": f"/stems_cache/{job}/vocals.wav",
                "instrumental": f"/stems_cache/{job}/instrumental.wav",
            },
        })
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 500


@app.get("/stems_cache/<path:filename>")
def stems_files(filename: str):
    return send_from_directory(STEMS_DIR, filename)


def main():
    port = int(os.environ.get("PORT", "8765"))
    print("")
    print("========================================")
    print("  BullShit Mp3 Easy Reproductor")
    print("  By Sweet Little Trauma")
    print(f"  http://localhost:{port}")
    print("========================================")
    print("")
    app.run(host="0.0.0.0", port=port, debug=False, threaded=True)


if __name__ == "__main__":
    main()
