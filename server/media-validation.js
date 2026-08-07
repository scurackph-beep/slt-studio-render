import { open, stat } from "node:fs/promises";
import { spawn } from "node:child_process";

const VIDEO_MIMES = new Set(["video/mp4", "video/quicktime", "video/webm"]);
const IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const AUDIO_MIMES = new Set(["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/ogg", "audio/webm", "audio/mp4"]);

function mediaError(message, code, statusCode = 400, details = null) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  if (details) error.details = details;
  return error;
}

function ascii(bytes, start, end) {
  return Buffer.from(bytes).subarray(start, end).toString("ascii");
}

export function detectMediaMime(bytes = Buffer.alloc(0)) {
  const header = Buffer.from(bytes || "");
  if (header.length >= 8 && header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return "image/jpeg";
  if (header.length >= 6 && ["GIF87a", "GIF89a"].includes(ascii(header, 0, 6))) return "image/gif";
  if (header.length >= 12 && ascii(header, 0, 4) === "RIFF" && ascii(header, 8, 12) === "WEBP") return "image/webp";
  if (header.length >= 12 && ascii(header, 0, 4) === "RIFF" && ascii(header, 8, 12) === "WAVE") return "audio/wav";
  if (header.length >= 4 && ascii(header, 0, 4) === "OggS") return "audio/ogg";
  if (header.length >= 4 && header.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return "video/webm";
  if (header.length >= 3 && ascii(header, 0, 3) === "ID3") return "audio/mpeg";
  if (header.length >= 2 && header[0] === 0xff && (header[1] & 0xe0) === 0xe0) return "audio/mpeg";
  if (header.length >= 5 && ascii(header, 0, 5) === "%PDF-") return "application/pdf";
  if (header.length >= 12 && ascii(header, 4, 8) === "ftyp") {
    const brand = ascii(header, 8, 12).trim().toLowerCase();
    return brand.startsWith("qt") ? "video/quicktime" : "video/mp4";
  }
  const sample = header.subarray(0, 512);
  if (sample.length && !sample.includes(0)) {
    const printable = [...sample].filter((value) => value === 9 || value === 10 || value === 13 || (value >= 32 && value <= 126)).length;
    if (printable / sample.length > 0.92) return "text/plain";
  }
  return "application/octet-stream";
}

export function mimeTypesCompatible(declaredMime = "", detectedMime = "") {
  const declared = String(declaredMime || "").split(";")[0].trim().toLowerCase();
  const detected = String(detectedMime || "").split(";")[0].trim().toLowerCase();
  if (!declared || declared === "application/octet-stream") return detected !== "application/octet-stream";
  if (declared === detected) return true;
  if ([declared, detected].every((value) => ["video/mp4", "video/quicktime"].includes(value))) return true;
  if ([declared, detected].every((value) => ["audio/mpeg", "audio/mp3"].includes(value))) return true;
  if ([declared, detected].every((value) => ["audio/wav", "audio/x-wav"].includes(value))) return true;
  if (detected === "video/webm" && ["audio/webm", "video/webm"].includes(declared)) return true;
  if (detected === "video/mp4" && declared === "audio/mp4") return true;
  return false;
}

export async function readMediaSignature(filePath, bytes = 512) {
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

export function parseFrameRate(value = "") {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value || "").trim();
  if (!text) return null;
  if (!text.includes("/")) {
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const [numerator, denominator] = text.split("/").map(Number);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  return numerator / denominator;
}

export function normalizeProbeMetadata(probe = {}) {
  const streams = Array.isArray(probe.streams) ? probe.streams : [];
  const videoStreams = streams.filter((stream) => stream.codec_type === "video");
  const audioStreams = streams.filter((stream) => stream.codec_type === "audio");
  const primaryVideo = videoStreams[0] || {};
  const duration = Number(probe.format?.duration ?? primaryVideo.duration);
  const bytes = Number(probe.format?.size);
  const frameRate = parseFrameRate(primaryVideo.avg_frame_rate || primaryVideo.r_frame_rate);
  return {
    durationSeconds: Number.isFinite(duration) ? Number(duration.toFixed(3)) : null,
    bytes: Number.isFinite(bytes) ? bytes : null,
    format: String(probe.format?.format_name || ""),
    codec: String(primaryVideo.codec_name || ""),
    width: Number(primaryVideo.width || 0) || null,
    height: Number(primaryVideo.height || 0) || null,
    frameRate: Number.isFinite(frameRate) ? Number(frameRate.toFixed(3)) : null,
    videoTracks: videoStreams.length,
    audioTracks: audioStreams.length,
    audioCodecs: [...new Set(audioStreams.map((stream) => stream.codec_name).filter(Boolean))],
    channels: Math.max(0, ...audioStreams.map((stream) => Number(stream.channels || 0))),
    sampleRate: Math.max(0, ...audioStreams.map((stream) => Number(stream.sample_rate || 0))) || null
  };
}

export function validateProbeMetadata(metadata = {}, limits = {}) {
  const acceptedCodecs = new Set(limits.acceptedCodecs || ["h264", "hevc", "vp8", "vp9", "av1", "prores"]);
  if (!metadata.videoTracks) throw mediaError("The file does not contain a video track.", "video_track_missing", 400);
  if (!metadata.codec || !acceptedCodecs.has(metadata.codec)) {
    throw mediaError(`Unsupported video codec: ${metadata.codec || "unknown"}.`, "video_codec_unsupported", 400, { acceptedCodecs: [...acceptedCodecs] });
  }
  if (!Number.isFinite(metadata.durationSeconds) || metadata.durationSeconds <= 0) {
    throw mediaError("Video duration could not be verified.", "video_duration_invalid", 400);
  }
  if (!metadata.width || !metadata.height) throw mediaError("Video resolution could not be verified.", "video_resolution_invalid", 400);
  if (!Number.isFinite(metadata.frameRate) || metadata.frameRate <= 0) throw mediaError("Video frame rate could not be verified.", "video_fps_invalid", 400);
  if (limits.minDuration && metadata.durationSeconds < limits.minDuration) {
    throw mediaError(`Video must be at least ${limits.minDuration} seconds.`, "video_duration_too_short", 400);
  }
  if (limits.maxDuration && metadata.durationSeconds > limits.maxDuration) {
    throw mediaError(`Video must be ${limits.maxDuration} seconds or shorter.`, "video_duration_too_long", 400);
  }
  if (limits.maxWidth && metadata.width > limits.maxWidth) throw mediaError(`Video width exceeds ${limits.maxWidth}px.`, "video_width_too_large", 400);
  if (limits.maxHeight && metadata.height > limits.maxHeight) throw mediaError(`Video height exceeds ${limits.maxHeight}px.`, "video_height_too_large", 400);
  if (limits.maxFps && metadata.frameRate > limits.maxFps + 0.01) throw mediaError(`Video frame rate must be ${limits.maxFps} fps or lower.`, "video_fps_too_high", 400);
  return metadata;
}

export function probeMediaFile(filePath, { ffprobePath = process.env.FFPROBE_PATH || "ffprobe", timeoutMs = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffprobePath, [
      "-v", "error",
      "-show_entries", "format=duration,size,format_name:stream=index,codec_type,codec_name,width,height,duration,r_frame_rate,avg_frame_rate,channels,sample_rate",
      "-of", "json",
      filePath
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      if (!settled) {
        settled = true;
        reject(mediaError("ffprobe timed out while validating the video.", "ffprobe_timeout", 503));
      }
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.once("error", (error) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      reject(mediaError(
        error.code === "ENOENT" ? "ffprobe is required on the server before video uploads can be accepted." : `ffprobe failed: ${error.message}`,
        error.code === "ENOENT" ? "ffprobe_unavailable" : "ffprobe_failed",
        503
      ));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (code !== 0) {
        reject(mediaError(`The video could not be decoded: ${stderr.trim() || `ffprobe exited ${code}`}.`, "video_decode_failed", 400));
        return;
      }
      try {
        resolve(JSON.parse(stdout || "{}"));
      } catch {
        reject(mediaError("ffprobe returned invalid metadata.", "ffprobe_invalid_output", 503));
      }
    });
  });
}

export function extractVideoFrame({
  sourcePath,
  outputPath,
  timestampSeconds = 0,
  ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg",
  timeoutMs = 60000
} = {}) {
  if (!sourcePath || !outputPath) {
    return Promise.reject(mediaError("Source and output paths are required for frame extraction.", "frame_extraction_paths_required", 400));
  }
  const timestamp = Math.max(0, Number(timestampSeconds) || 0);
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, [
      "-v", "error",
      "-ss", timestamp.toFixed(3),
      "-i", sourcePath,
      "-frames:v", "1",
      "-f", "image2",
      "-vcodec", "png",
      "-y",
      outputPath
    ], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      if (!settled) {
        settled = true;
        reject(mediaError("FFmpeg timed out while extracting the frame.", "frame_extraction_timeout", 503));
      }
    }, timeoutMs);
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.once("error", (error) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      reject(mediaError(
        error.code === "ENOENT" ? "FFmpeg is required on the server for frame extraction." : `FFmpeg failed: ${error.message}`,
        error.code === "ENOENT" ? "ffmpeg_unavailable" : "frame_extraction_failed",
        503
      ));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (code !== 0) {
        reject(mediaError(`The frame could not be extracted: ${stderr.trim() || `FFmpeg exited ${code}`}.`, "frame_extraction_failed", 422));
        return;
      }
      resolve({ sourcePath, outputPath, timestampSeconds: timestamp });
    });
  });
}

export async function validateMediaFile({
  filePath,
  declaredMime = "application/octet-stream",
  kind = "reference",
  maxBytes = Infinity,
  probeLimits = {},
  ffprobePath,
  skipProbe = false
}) {
  const fileStats = await stat(filePath);
  if (!fileStats.size) throw mediaError("Upload file is empty.", "upload_empty", 400);
  if (fileStats.size > maxBytes) throw mediaError(`Upload exceeds ${Math.round(maxBytes / 1024 / 1024)}MB limit.`, "upload_too_large", 413);
  const signature = await readMediaSignature(filePath);
  const detectedMime = detectMediaMime(signature);
  if (detectedMime === "application/octet-stream") throw mediaError("The file signature is not a supported media format.", "upload_signature_invalid", 400);
  if (!mimeTypesCompatible(declaredMime, detectedMime)) {
    throw mediaError(`File signature is ${detectedMime}, not ${declaredMime}.`, "upload_mime_mismatch", 400, { declaredMime, detectedMime });
  }

  let probe = null;
  let media = null;
  if (VIDEO_MIMES.has(detectedMime)) {
    if (!skipProbe) {
      probe = await probeMediaFile(filePath, { ffprobePath });
      media = validateProbeMetadata(normalizeProbeMetadata(probe), probeLimits);
    }
  }

  const family = VIDEO_MIMES.has(detectedMime)
    ? "video"
    : IMAGE_MIMES.has(detectedMime)
      ? "image"
      : AUDIO_MIMES.has(detectedMime)
        ? "audio"
        : detectedMime === "application/pdf"
          ? "document"
          : "text";
  return { kind, family, detectedMime, bytes: fileStats.size, media, probe };
}

export function assertMediaSignature({ bytes, declaredMime = "application/octet-stream" }) {
  const detectedMime = detectMediaMime(bytes);
  if (detectedMime === "application/octet-stream") throw mediaError("The file signature is not a supported media format.", "upload_signature_invalid", 400);
  if (!mimeTypesCompatible(declaredMime, detectedMime)) {
    throw mediaError(`File signature is ${detectedMime}, not ${declaredMime}.`, "upload_mime_mismatch", 400, { declaredMime, detectedMime });
  }
  return detectedMime;
}

export function assertRealityTransformMedia(metadata = {}) {
  return validateProbeMetadata(metadata, {
    minDuration: 2,
    maxDuration: 30,
    maxFps: 30,
    maxWidth: 1920,
    maxHeight: 1920
  });
}
