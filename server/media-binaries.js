import { existsSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function bundledFfmpegPath() {
  try {
    const value = require("ffmpeg-static");
    return typeof value === "string" && existsSync(value) ? value : "";
  } catch {
    return "";
  }
}

function bundledFfprobePath() {
  try {
    const value = require("ffprobe-static");
    return typeof value?.path === "string" && existsSync(value.path) ? value.path : "";
  } catch {
    return "";
  }
}

export function resolveFfmpegPath() {
  return String(process.env.FFMPEG_PATH || bundledFfmpegPath() || "ffmpeg");
}

export function resolveFfprobePath() {
  return String(process.env.FFPROBE_PATH || bundledFfprobePath() || "ffprobe");
}

export function mediaBinaryStatus() {
  const ffmpegPath = resolveFfmpegPath();
  const ffprobePath = resolveFfprobePath();
  return {
    ffmpeg: { path: ffmpegPath, bundled: ffmpegPath.includes("node_modules/ffmpeg-static"), detected: ffmpegPath === "ffmpeg" || existsSync(ffmpegPath) },
    ffprobe: { path: ffprobePath, bundled: ffprobePath.includes("node_modules/ffprobe-static"), detected: ffprobePath === "ffprobe" || existsSync(ffprobePath) }
  };
}
