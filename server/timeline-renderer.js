import { spawn } from "node:child_process";
import { resolveFfmpegPath } from "./media-binaries.js";

export const TIMELINE_TRACK_TYPES = Object.freeze([
  "VIDEO",
  "DIALOGUE",
  "VOICE",
  "MUSIC",
  "SFX",
  "AMBIENCE"
]);

const AUDIO_TRACKS = new Set(["DIALOGUE", "VOICE", "MUSIC", "SFX", "AMBIENCE"]);

function number(value, fallback = 0, min = -Infinity, max = Infinity) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function ff(value) {
  return number(value).toFixed(3).replace(/\.000$/, "");
}

function safeItem(item = {}) {
  const trackType = String(item.trackType || "VIDEO").toUpperCase();
  return {
    ...item,
    trackType,
    startSeconds: number(item.startSeconds, 0, 0),
    sourceStartSeconds: number(item.sourceStartSeconds, 0, 0),
    durationSeconds: number(item.durationSeconds, 0, 0.04),
    volume: number(item.volume, 1, 0, 4),
    pan: number(item.pan, 0, -1, 1),
    fadeInSeconds: number(item.fadeInSeconds, 0, 0),
    fadeOutSeconds: number(item.fadeOutSeconds, 0, 0)
  };
}

export function buildTimelineRenderPlan({ items = [], assets = [], width = 1920, height = 1080, fps = 30 } = {}) {
  const assetMap = new Map(assets.map((asset) => [asset.id, asset]));
  const normalized = items
    .filter((item) => !item.deletedAt && item.assetId)
    .map(safeItem)
    .filter((item) => TIMELINE_TRACK_TYPES.includes(item.trackType) && item.durationSeconds > 0)
    .map((item) => ({ ...item, asset: assetMap.get(item.assetId) }))
    .filter((item) => item.asset?.filePath);

  if (!normalized.length) {
    const error = new Error("The Timeline has no renderable clips.");
    error.code = "timeline_empty";
    throw error;
  }

  const durationSeconds = Math.min(7200, Math.max(...normalized.map((item) => item.startSeconds + item.durationSeconds)));
  const safeWidth = Math.round(number(width, 1920, 320, 7680) / 2) * 2;
  const safeHeight = Math.round(number(height, 1080, 180, 4320) / 2) * 2;
  const safeFps = number(fps, 30, 12, 120);
  const videoItems = normalized.filter((item) => item.trackType === "VIDEO" && !item.muted);
  const audioCandidates = normalized.filter((item) => AUDIO_TRACKS.has(item.trackType) && !item.muted);
  const audioItems = audioCandidates.some((item) => item.solo)
    ? audioCandidates.filter((item) => item.solo)
    : audioCandidates;

  const args = [
    "-y",
    "-f", "lavfi", "-i", `color=c=black:s=${safeWidth}x${safeHeight}:r=${safeFps}:d=${ff(durationSeconds)}`,
    "-f", "lavfi", "-i", `anullsrc=channel_layout=stereo:sample_rate=48000:d=${ff(durationSeconds)}`
  ];

  const inputIndexes = new Map();
  normalized.forEach((item, index) => {
    const inputIndex = index + 2;
    inputIndexes.set(item.id, inputIndex);
    const contentType = String(item.asset.contentType || "").toLowerCase();
    if (contentType.startsWith("image/")) {
      args.push("-loop", "1", "-t", ff(item.durationSeconds), "-i", item.asset.filePath);
    } else {
      args.push("-i", item.asset.filePath);
    }
  });

  const filters = [`[0:v]setpts=PTS-STARTPTS[video_base_0]`];
  let currentVideo = "video_base_0";
  videoItems.forEach((item, index) => {
    const input = inputIndexes.get(item.id);
    const clip = `video_clip_${index}`;
    const next = `video_base_${index + 1}`;
    filters.push(
      `[${input}:v]trim=start=${ff(item.sourceStartSeconds)}:duration=${ff(item.durationSeconds)},` +
      `setpts=PTS-STARTPTS+${ff(item.startSeconds)}/TB,` +
      `scale=${safeWidth}:${safeHeight}:force_original_aspect_ratio=decrease,` +
      `pad=${safeWidth}:${safeHeight}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1[${clip}]`
    );
    filters.push(
      `[${currentVideo}][${clip}]overlay=eof_action=pass:enable='between(t,${ff(item.startSeconds)},${ff(item.startSeconds + item.durationSeconds)})'[${next}]`
    );
    currentVideo = next;
  });
  filters.push(`[${currentVideo}]format=yuv420p[vout]`);

  const audioLabels = [];
  audioItems.forEach((item, index) => {
    const input = inputIndexes.get(item.id);
    const label = `audio_clip_${index}`;
    const delayMs = Math.round(item.startSeconds * 1000);
    const fadeOutStart = Math.max(0, item.durationSeconds - item.fadeOutSeconds);
    const left = item.pan > 0 ? 1 - item.pan : 1;
    const right = item.pan < 0 ? 1 + item.pan : 1;
    const chain = [
      `atrim=start=${ff(item.sourceStartSeconds)}:duration=${ff(item.durationSeconds)}`,
      "asetpts=PTS-STARTPTS",
      "aresample=48000",
      `volume=${ff(item.volume)}`,
      `pan=stereo|c0=${ff(left)}*c0|c1=${ff(right)}*c1`
    ];
    if (item.fadeInSeconds > 0) chain.push(`afade=t=in:st=0:d=${ff(Math.min(item.fadeInSeconds, item.durationSeconds))}`);
    if (item.fadeOutSeconds > 0) chain.push(`afade=t=out:st=${ff(fadeOutStart)}:d=${ff(Math.min(item.fadeOutSeconds, item.durationSeconds))}`);
    chain.push(`adelay=${delayMs}|${delayMs}`);
    filters.push(`[${input}:a]${chain.join(",")}[${label}]`);
    audioLabels.push(`[${label}]`);
  });

  filters.push(`[1:a]atrim=duration=${ff(durationSeconds)},asetpts=PTS-STARTPTS[silence]`);
  if (audioLabels.length) {
    filters.push(`[silence]${audioLabels.join("")}amix=inputs=${audioLabels.length + 1}:duration=longest:dropout_transition=0,atrim=duration=${ff(durationSeconds)}[aout]`);
  } else {
    filters.push("[silence]anull[aout]");
  }

  args.push(
    "-filter_complex", filters.join(";"),
    "-map", "[vout]",
    "-map", "[aout]",
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", "18",
    "-pix_fmt", "yuv420p",
    "-r", String(safeFps),
    "-c:a", "aac",
    "-b:a", "192k",
    "-movflags", "+faststart",
    "-t", ff(durationSeconds)
  );

  return {
    args,
    durationSeconds,
    width: safeWidth,
    height: safeHeight,
    fps: safeFps,
    itemCount: normalized.length,
    videoItemCount: videoItems.length,
    audioItemCount: audioItems.length,
    manifest: normalized.map((item) => ({
      id: item.id,
      assetId: item.assetId,
      trackType: item.trackType,
      startSeconds: item.startSeconds,
      sourceStartSeconds: item.sourceStartSeconds,
      durationSeconds: item.durationSeconds,
      name: String(item.asset.displayName || item.asset.originalName || item.assetId)
    }))
  };
}

export async function renderTimeline({ items, assets, outputPath, ffmpegPath = resolveFfmpegPath(), width, height, fps, timeoutMs = 30 * 60 * 1000 } = {}) {
  const plan = buildTimelineRenderPlan({ items, assets, width, height, fps });
  const args = [...plan.args, outputPath];
  await new Promise((resolve, reject) => {
    const processHandle = spawn(ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    const timer = setTimeout(() => {
      processHandle.kill("SIGKILL");
      const error = new Error("FFmpeg Timeline render timed out.");
      error.code = "ffmpeg_timeout";
      reject(error);
    }, timeoutMs);
    processHandle.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-24_000);
    });
    processHandle.on("error", (error) => {
      clearTimeout(timer);
      error.code ||= "ffmpeg_not_available";
      reject(error);
    });
    processHandle.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else {
        const error = new Error(`FFmpeg Timeline render failed (${code}): ${stderr.slice(-4000)}`);
        error.code = "ffmpeg_render_failed";
        reject(error);
      }
    });
  });
  return { ...plan, outputPath };
}
