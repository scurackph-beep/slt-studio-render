// Sweet Little Trauma Studio API proxy example.
// Keep API keys here, never inside index.html.
//
// Run:
//   npm install
//   npm start
//
// Then call:
//   http://127.0.0.1:3000/api/generate/image

import express from "express";
import cors from "cors";
import crypto from "node:crypto";
import { createReadStream, createWriteStream, existsSync, openAsBlob, readFileSync } from "node:fs";
import { mkdir, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Readable, Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { assertProductionInfrastructureReady, getProductionReadinessReport } from "./production-infrastructure.js";
import { createRuntimeStore } from "./postgres-store.js";
import { createSupabaseAdminClient, createSupabaseStorageService, createSupabaseUserClient, verifySupabaseJwt } from "./supabase-service.js";
import { assertMediaSignature, assertRealityTransformMedia, extractVideoFrame, validateMediaFile } from "./media-validation.js";
import {
  SLT_ERROR_BY_NAME,
  SLT_ERROR_REGISTRY,
  classifySltError,
  createIncidentId,
  publicErrorPayload,
  registrySummary,
  sanitizeDiagnosticText
} from "./error-registry.js";

const app = express();
const port = Number(process.env.PORT || 3000);
const projectDir = dirname(fileURLToPath(import.meta.url));
const staticDir = process.env.SLT_STATIC_DIR || resolve(projectDir, "../dist");
const assetStorageDir = process.env.SLT_STORAGE_DIR || resolve(projectDir, "../storage/assets");
let supabaseStorage;
let supabaseAdmin;
let supabaseAuth;

function loadEnvFile(filename) {
  const filePath = typeof filename === "string" && filename.includes("/")
    ? filename
    : resolve(projectDir, filename);
  if (!existsSync(filePath)) return false;
  const content = readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    const value = sanitizeEnvValue(line.slice(separator + 1));
    if (key) process.env[key] = value;
  }
  return true;
}

const loadedEnvFiles = [".env", ".env.local"].filter(loadEnvFile);
[
  resolve(projectDir, "../.env"),
  resolve(projectDir, "../.env.local"),
  process.env.SLT_ENV_DIR ? resolve(process.env.SLT_ENV_DIR, ".env") : null
].filter(Boolean).forEach((filePath) => loadEnvFile(filePath));

const startupInfrastructureReadiness = assertProductionInfrastructureReady(process.env);
supabaseStorage = createSupabaseStorageService(process.env);
supabaseAdmin = createSupabaseAdminClient(process.env);
supabaseAuth = createSupabaseUserClient(process.env);

function envList(key) {
  return String(process.env[key] || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isLocalOrigin(origin = "") {
  return /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin);
}

const allowedCorsOrigins = envList("CORS_ORIGINS");

app.use((request, response, next) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "SAMEORIGIN");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});

app.use(cors({ origin: "*" }));

const SITE_GATE_KEY = String(process.env.SLT_SITE_GATE_KEY || "Dientito2032").trim();
const INVITE_CODES = envList("SLT_INVITE_CODES").map((entry, index) => {
  const separator = entry.indexOf(":");
  if (separator === -1) {
    return { username: `Guest ${index + 1}`, code: entry.trim() };
  }
  return {
    username: entry.slice(0, separator).trim() || `Guest ${index + 1}`,
    code: entry.slice(separator + 1).trim()
  };
}).filter((entry) => entry.code);

function secureEqualText(a = "", b = "") {
  const left = Buffer.from(String(a || "").trim().normalize("NFC").toLowerCase());
  const right = Buffer.from(String(b || "").trim().normalize("NFC").toLowerCase());
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function safeGuestSlug(value = "guest") {
  return String(value || "guest")
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "guest";
}

function inviteGuestProfile(code = "") {
  const normalized = String(code || "").trim();
  const matched = INVITE_CODES.find((entry) => secureEqualText(entry.code, normalized));
  if (!matched) return null;
  return {
    username: matched.username
  };
}

function siteGateExempt(path = "") {
  return [
    "/assets/",
    "/favicon.svg",
    "/icons.svg",
    "/health",
    "/api/stripe/webhook",
    "/api/webhooks/"
  ].some((prefix) => path === prefix || path.startsWith(prefix));
}

function siteGateMiddleware(request, response, next) {
  if (!SITE_GATE_KEY) {
    next();
    return;
  }
  if (siteGateExempt(request.path)) {
    next();
    return;
  }
  if (!request.path.startsWith("/api/")) {
    next();
    return;
  }
  const provided = String(
    request.header?.("x-slt-site-gate") ||
    request.query?.site_gate ||
    ""
  ).trim();
  if (provided === SITE_GATE_KEY) {
    next();
    return;
  }
  response.status(403).json({
    ok: false,
    code: "site_gate_required",
    error: "Private preview. Site gate required.",
    readableError: "Acceso privado. Ingresá la clave del sitio."
  });
}

app.use(siteGateMiddleware);

function authTokenFromRequest(request) {
  const bearer = String(request.header?.("authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1] || "";
  return String(request.header?.("x-slt-session") || bearer || "").trim();
}

function strictAuthForRequest(request) {
  const token = authTokenFromRequest(request);
  const session = token ? sessions.get(token) : null;
  if (session) {
    return {
      ok: true,
      mode: session.mode || (session.role === "CEO" ? "CEO_FULL_CREATIVE_MODE" : "local-session"),
      tenantId: session.tenantId || session.userId,
      userId: session.userId,
      role: session.role,
      email: session.email,
      username: session.username,
      token,
      message: session.role === "CEO" ? "CEO session accepted." : "Server session accepted."
    };
  }
  if (String(process.env.AUTH_PROVIDER || "").toLowerCase() === "supabase") {
    return verifySupabaseJwt(token, process.env);
  }
  if (!session) return null;
  return {
    ok: true,
    mode: session.role === "CEO" ? "CEO_FULL_CREATIVE_MODE" : "local-session",
    userId: session.userId,
    role: session.role,
    email: session.email,
    username: session.username,
    token,
    message: session.role === "CEO" ? "CEO session accepted." : "Local session accepted."
  };
}

function requestIdentity(request, auth = null) {
  const sessionAuth = auth?.ok ? auth : strictAuthForRequest(request);
  return sessionAuth?.tenantId || sessionAuth?.userId || request.ip || request.socket?.remoteAddress || "anonymous";
}

function rateLimitForPath(path = "") {
  if (path === "/api/login" || path.startsWith("/api/auth/")) return envNumber("AUTH_RATE_LIMIT_PER_MINUTE", 8);
  if (path.startsWith("/api/generate/")) return envNumber("GENERATE_RATE_LIMIT_PER_MINUTE", 10);
  if (path.includes("/checkout") || path.includes("/portal")) return envNumber("BILLING_RATE_LIMIT_PER_MINUTE", 20);
  return envNumber("API_RATE_LIMIT_PER_MINUTE", 90);
}

function authFailurePayload(code = "auth_required") {
  const definition = code === "forbidden" ? SLT_ERROR_BY_NAME.PERMISSION_DENIED : SLT_ERROR_BY_NAME.SESSION_EXPIRED;
  return {
    ok: false,
    code,
    errorCode: definition.code,
    errorName: definition.name,
    error: code === "forbidden" ? "Forbidden." : "Authentication required.",
    readableError: code === "forbidden" ? "This action needs a higher access level." : "Please log in before using this action.",
    customerMessage: definition.customerMessage,
    retryable: definition.retryable
  };
}

function requiresServerAuth(path = "") {
  return [
    "/api/generate/",
    "/api/assist",
    "/api/jobs",
    "/api/batches",
    "/api/generation-sessions",
    "/api/ledger",
    "/api/assets",
    "/api/characters",
    "/api/references",
    "/api/scenes",
    "/api/timeline",
    "/api/workflows",
    "/api/applications",
    "/api/versions",
    "/api/provider-status",
    "/api/uploads",
    "/api/projects",
    "/api/history",
    "/api/model-router",
    "/api/billing",
    "/api/subscription",
    "/api/user",
    "/api/studio/run",
    "/api/stripe/checkout",
    "/api/stripe/credits/checkout",
    "/api/stripe/portal",
    "/api/support/incidents",
    "/api/compensation",
    "/api/db/status",
    "/api/ceo/provider-credits"
  ].some((prefix) => path === prefix || path.startsWith(prefix));
}

function requiresOwnerAuth(path = "") {
  return path.startsWith("/api/ceo/") || path === "/api/db/status";
}

function authProtectionMiddleware(request, response, next) {
  if (!requiresServerAuth(request.path)) {
    next();
    return;
  }

  const auth = strictAuthForRequest(request);
  if (!auth) {
    response.status(401).json(authFailurePayload("auth_required"));
    return;
  }
  if (requiresOwnerAuth(request.path) && !isOwnerAuth(auth)) {
    response.status(403).json({ ...authFailurePayload("forbidden"), auth: { ok: true, role: auth.role } });
    return;
  }

  request.sltAuth = auth;
  next();
}

function rateLimitMiddleware(request, response, next) {
  if (!request.path.startsWith("/api/") || request.path === "/api/stripe/webhook" || request.path.startsWith("/api/webhooks/")) {
    next();
    return;
  }
  const now = Date.now();
  const windowMs = 60_000;
  const limit = rateLimitForPath(request.path);
  const bucketKey = `${requestIdentity(request)}:${request.path}`;
  const bucket = rateBuckets.get(bucketKey) || { count: 0, resetAt: now + windowMs };
  if (bucket.resetAt <= now) {
    bucket.count = 0;
    bucket.resetAt = now + windowMs;
  }
  bucket.count += 1;
  rateBuckets.set(bucketKey, bucket);
  response.setHeader("X-RateLimit-Limit", String(limit));
  response.setHeader("X-RateLimit-Remaining", String(Math.max(0, limit - bucket.count)));
  if (bucket.count > limit) {
    response.status(429).json({
      ok: false,
      code: "rate_limit_exceeded",
      errorCode: SLT_ERROR_BY_NAME.PROVIDER_RATE_LIMIT.code,
      errorName: SLT_ERROR_BY_NAME.PROVIDER_RATE_LIMIT.name,
      error: "Too many requests. Wait a minute and try again.",
      retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000)
    });
    return;
  }
  next();
}

app.post(["/api/stripe/webhook", "/api/webhooks/stripe"], express.raw({ type: "application/json" }), handleStripeWebhook);
app.use(rateLimitMiddleware);
app.use(authProtectionMiddleware);
app.post(["/api/assets/upload-binary", "/api/uploads/file"], handleStreamingReferenceUpload);
app.use(express.json({
  limit: "50mb",
  verify: (request, _response, buffer) => {
    request.rawBody = Buffer.from(buffer || "");
  }
}));
app.use((request, response, next) => {
  const mutates = ["POST", "PUT", "PATCH", "DELETE"].includes(request.method);
  if (mutates && request.path.startsWith("/api/")) {
    response.on("finish", () => {
      if (response.statusCode < 500) {
        void persistRuntimeState(`${request.method} ${request.path}`);
      }
    });
  }
  next();
});

const providerFallbackMessage = "Provider not connected. Add API key.";
const preparedProviderMessage = "Prepared but not connected yet.";
const directEndpointMessage = "Direct endpoint needs confirmation.";
const missingConfigMessage = "Missing endpoint/config.";
const internalOnlyMessage = "Internal only.";
const disabledPreferenceMessage = "Disabled by project preference.";
const mockModeMessage = "Mock mode — provider not connected yet.";

const providerKeys = {
  image: ["OPENAI_API_KEY", "GEMINI_API_KEY", "XAI_API_KEY", "XAI_API", "LEONARDO_API_KEY", "RECRAFT_API_KEY", "REPLICATE_API_TOKEN", "COMFYUI_API_URL"],
  video: ["GEMINI_API_KEY", "SEEDANCE_API_KEY", "BYTEPLUS_API_KEY", "BYTEPLUS_VISION_AK", "RUNWAY_API_KEY", "LUMA_API_KEY", "REPLICATE_API_TOKEN", "WAN_API_KEY", "HAILUO_API_KEY", "MINIMAX_API_KEY", "PIXVERSE_API_KEY", "TENCENTCLOUD_SECRET_ID"],
  music: ["SUNO_API_KEY", "UDIO_API_KEY", "MINIMAX_API_KEY", "HAILUO_API_KEY", "REPLICATE_API_TOKEN"],
  sound: ["ELEVENLABS_API_KEY", "OPENAI_API_KEY", "MINIMAX_API_KEY", "HAILUO_API_KEY"],
  assist: ["OPENAI_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY", "LOCAL_MODEL_API_URL"],
  billing: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
  subscription: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]
};

const providerCatalog = {
  "OpenAI Images": { kind: "image", envKey: "OPENAI_API_KEY", adapter: "openai-image" },
  "Grok Image": { kind: "image", envKey: "XAI_API_KEY", alternateEnvKeys: ["XAI_API", "GROK_API_KEY"], adapter: "xai-image" },
  "Gemini Image": { kind: "image", envKey: "GEMINI_API_KEY", adapter: "gemini-image" },
  Leonardo: { kind: "image", envKey: "LEONARDO_API_KEY", adapter: "leonardo-image", endpointEnv: "LEONARDO_API_URL" },
  Flux: { kind: "image", envKey: "REPLICATE_API_TOKEN", adapter: "replicate-image" },
  FLUX: { kind: "image", envKey: "REPLICATE_API_TOKEN", adapter: "replicate-image" },
  "Stable Diffusion": { kind: "image", envKey: "REPLICATE_API_TOKEN", adapter: "replicate-image" },
  Stability: { kind: "image", envKey: "STABILITY_API_KEY", adapter: "stability-image" },
  Ideogram: { kind: "image", envKey: "IDEOGRAM_API_KEY", adapter: "ideogram-image", endpointEnv: "IDEOGRAM_API_URL" },
  Recraft: { kind: "image", envKey: "RECRAFT_API_KEY", adapter: "recraft-image", endpointEnv: "RECRAFT_API_URL" },
  Replicate: { kind: "image", envKey: "REPLICATE_API_TOKEN", adapter: "replicate-image" },
  "ComfyUI local": { kind: "image", envKey: "COMFYUI_API_URL", adapter: "comfyui-local", endpointEnv: "COMFYUI_API_URL" },

  Seedance: {
    kind: "video",
    envKey: "SEEDANCE_API_KEY",
    alternateEnvKeys: ["BYTEPLUS_API_KEY"],
    adapter: "seedance-direct",
    endpointEnv: "SEEDANCE_API_URL",
    alternateEndpointEnvKeys: ["BYTEPLUS_BASE_URL"],
    configEnvKeys: ["SEEDANCE_MODEL_ID"],
    execution: "async",
    supportsWebhook: true,
    defaultModel: "dreamina-seedance-2-0-260128",
    modelEnv: "SEEDANCE_MODEL_ID",
    pricing: { chargeUnit: "second", creditsPerSecond: 12, minimumCredits: 60, source: "internal_estimate" }
  },
  Veo: { kind: "video", envKey: "GEMINI_API_KEY", adapter: "veo-direct" },
  OmniHuman: {
    kind: "video",
    envKey: "BYTEPLUS_VISION_AK",
    adapter: "byteplus-omnihuman",
    configEnvKeys: ["BYTEPLUS_VISION_SK", "BYTEPLUS_VISION_REGION", "BYTEPLUS_VISION_SERVICE", "OMNIHUMAN_REQ_KEY"],
    execution: "async",
    supportsWebhook: true,
    defaultModel: "dreamina-omnihuman-1.0",
    pricing: { chargeUnit: "second", creditsPerSecond: 18, minimumCredits: 90, source: "internal_estimate" }
  },
  Runway: {
    kind: "video",
    envKey: "RUNWAY_API_KEY",
    adapter: "runway-video",
    endpointEnv: "RUNWAY_API_URL",
    defaultEndpoint: "https://api.dev.runwayml.com/v1",
    execution: "async",
    supportsWebhook: true,
    defaultModel: "gen4_turbo",
    modelEnv: "RUNWAY_MODEL_ID",
    models: [
      {
        id: "gen4_turbo",
        label: "Gen-4 Turbo",
        pricing: { chargeUnit: "second", creditsPerSecond: 5, minimumCredits: 25, source: "runway_official_api_pricing" }
      },
      {
        id: "gen4.5",
        label: "Gen-4.5",
        pricing: { chargeUnit: "second", creditsPerSecond: 12, minimumCredits: 60, source: "runway_official_api_pricing" }
      },
      {
        id: "aleph2",
        label: "Aleph 2.0 · Reality Transform",
        pricing: { chargeUnit: "second", creditsPerSecond: 28, minimumCredits: 56, source: "runway_official_api_pricing" }
      }
    ],
    pricing: { chargeUnit: "second", creditsPerSecond: 5, minimumCredits: 25, source: "runway_official_api_pricing" }
  },
  Kling: {
    kind: "video",
    envKey: "KLING_ACCESS_KEY",
    alternateEnvKeys: ["KLING_API_KEY"],
    adapter: "kling-video",
    endpointEnv: "KLING_API_URL",
    configEnvKeys: ["KLING_SECRET_KEY"],
    execution: "async",
    supportsWebhook: true,
    defaultModel: "kling-v3-standard",
    modelEnv: "KLING_MODEL_ID",
    models: [
      {
        id: "kling-v3-standard",
        label: "Kling 3.0 Standard",
        pricing: { chargeUnit: "second", creditsPerSecond: 8, minimumCredits: 40, source: "internal_estimate_pending_vendor_pricing" }
      },
      {
        id: "kling-omni",
        label: "Kling Omni",
        pricing: { chargeUnit: "second", creditsPerSecond: 14, minimumCredits: 70, source: "internal_estimate_pending_vendor_pricing" }
      }
    ],
    pricing: { chargeUnit: "second", creditsPerSecond: 8, minimumCredits: 40, source: "internal_estimate_pending_vendor_pricing" }
  },
  Hailuo: { kind: "video", envKey: "HAILUO_API_KEY", alternateEnvKeys: ["MINIMAX_API_KEY"], adapter: "minimax-video", endpointEnv: "HAILUO_API_URL", alternateEndpointEnvKeys: ["MINIMAX_API_URL"] },
  Luma: { kind: "video", envKey: "LUMA_API_KEY", adapter: "luma-video", endpointEnv: "LUMA_API_URL" },
  "Luma Modify": {
    kind: "video",
    envKey: "REPLICATE_API_TOKEN",
    adapter: "replicate-luma-modify",
    execution: "async",
    supportsWebhook: true,
    defaultModel: "luma/modify-video",
    pricing: { chargeUnit: "second", creditsPerSecond: 42, minimumCredits: 84, source: "replicate_luma_pixel_pricing_720p_estimate" }
  },
  PixVerse: { kind: "video", envKey: "PIXVERSE_API_KEY", adapter: "pixverse-video", endpointEnv: "PIXVERSE_API_URL" },
  Pika: { kind: "video", envKey: "PIKA_API_KEY", adapter: "generic-endpoint", endpointEnv: "PIKA_API_URL", disabledByPreference: true },
  Hunyuan: { kind: "video", envKey: "TENCENTCLOUD_SECRET_ID", adapter: "generic-endpoint", endpointEnv: "HUNYUAN_API_URL", configEnvKeys: ["TENCENTCLOUD_SECRET_KEY"], needsConfirmation: true },
  Wan: { kind: "video", envKey: "REPLICATE_API_TOKEN", adapter: "replicate-wan-video", configEnvKeys: ["WAN_REPLICATE_MODEL"] },
  HeyGen: { kind: "video", envKey: "HEYGEN_API_KEY", adapter: "heygen-video-agent", endpointEnv: "HEYGEN_API_URL" },
  "D-ID": { kind: "video", envKey: "DID_API_KEY", adapter: "did-talk", endpointEnv: "DID_API_URL" },

  Suno: {
    kind: "music",
    envKey: "SUNO_API_KEY",
    adapter: "generic-endpoint",
    endpointEnv: "SUNO_API_URL",
    preparedOnly: true,
    execution: "async",
    supportsWebhook: true,
    defaultModel: "suno-v5.5",
    modelEnv: "SUNO_MODEL_ID",
    pricing: { chargeUnit: "track", creditsPerUnit: 180, minimumCredits: 180, source: "internal_estimate_public_product_reference" }
  },
  Udio: { kind: "music", envKey: "UDIO_API_KEY", adapter: "generic-endpoint", endpointEnv: "UDIO_API_URL", preparedOnly: true },
  "MiniMax Music": { kind: "music", envKey: "MINIMAX_API_KEY", alternateEnvKeys: ["HAILUO_API_KEY"], adapter: "minimax-music", endpointEnv: "MINIMAX_API_URL", alternateEndpointEnvKeys: ["HAILUO_API_URL"] },
  "SLT Composer": {
    kind: "music",
    envKey: "",
    adapter: "slt-composer",
    localProvider: true,
    preparedOnly: true,
    execution: "sync",
    defaultModel: "slt-local-composer-plan",
    pricing: { chargeUnit: "track", creditsPerUnit: 75, minimumCredits: 75, source: "internal_local_planning" }
  },
  "Stable Audio": {
    kind: "music",
    envKey: "STABLE_AUDIO_API_KEY",
    alternateEnvKeys: ["STABILITY_AUDIO_API_KEY", "STABILITY_API_KEY"],
    adapter: "stability-audio",
    endpointEnv: "STABLE_AUDIO_API_URL",
    alternateEndpointEnvKeys: ["STABILITY_AUDIO_API_URL", "STABILITY_API_URL"]
  },
  "ElevenLabs Music": {
    kind: "music",
    envKey: "ELEVENLABS_API_KEY",
    adapter: "generic-endpoint",
    endpointEnv: "ELEVENLABS_MUSIC_API_URL",
    preparedOnly: true,
    execution: "async",
    supportsWebhook: true,
    defaultModel: "music_v2",
    pricing: { chargeUnit: "track", creditsPerUnit: 160, minimumCredits: 160, source: "internal_estimate" }
  },
  Mubert: { kind: "music", envKey: "MUBERT_API_KEY", adapter: "generic-endpoint", endpointEnv: "MUBERT_API_URL", preparedOnly: true },
  "AudioCraft local": { kind: "music", envKey: "REPLICATE_API_TOKEN", adapter: "replicate-musicgen", configEnvKeys: ["AUDIOCRAFT_REPLICATE_MODEL"] },
  Riffusion: { kind: "music", envKey: "REPLICATE_API_TOKEN", adapter: "replicate-riffusion", configEnvKeys: ["RIFFUSION_REPLICATE_MODEL"] },

  ElevenLabs: {
    kind: "sound",
    envKey: "ELEVENLABS_API_KEY",
    adapter: "elevenlabs-tts",
    execution: "sync",
    defaultModel: "eleven_flash_v2_5",
    modelEnv: "ELEVENLABS_MODEL_ID",
    models: [
      {
        id: "eleven_flash_v2_5",
        label: "Flash v2.5",
        pricing: { chargeUnit: "character", unitSize: 50, creditsPerUnit: 1, minimumCredits: 2, source: "runway_audio_pricing_reference" }
      },
      {
        id: "eleven_multilingual_v2",
        label: "Multilingual v2",
        pricing: { chargeUnit: "character", unitSize: 50, creditsPerUnit: 1, minimumCredits: 2, source: "runway_audio_pricing_reference" }
      }
    ],
    pricing: { chargeUnit: "character", unitSize: 50, creditsPerUnit: 1, minimumCredits: 2, source: "runway_audio_pricing_reference" }
  },
  "OpenAI Audio": { kind: "sound", envKey: "OPENAI_API_KEY", adapter: "openai-speech" },
  "MiniMax Speech": { kind: "sound", envKey: "MINIMAX_API_KEY", alternateEnvKeys: ["HAILUO_API_KEY"], adapter: "minimax-speech", endpointEnv: "MINIMAX_API_URL", alternateEndpointEnvKeys: ["HAILUO_API_URL"] },
  "Stability Audio": { kind: "sound", envKey: "STABILITY_AUDIO_API_KEY", adapter: "stability-audio", endpointEnv: "STABILITY_AUDIO_API_URL" },
  "Dolby.io": { kind: "sound", envKey: "DOLBY_API_KEY", adapter: "generic-endpoint", endpointEnv: "DOLBY_API_URL", disabledByPreference: true },
  "iZotope": { kind: "sound", envKey: "IZOTOPE_API_KEY", adapter: "generic-endpoint", endpointEnv: "IZOTOPE_API_URL", preparedOnly: true },
  Moises: { kind: "sound", envKey: "MOISES_API_KEY", adapter: "moises-audio", endpointEnv: "MOISES_API_URL" },
  FFmpeg: { kind: "sound", envKey: "", adapter: "local-placeholder", internalOnly: true },

  Meshy: {
    kind: "3d",
    envKey: "MESHY_API_KEY",
    adapter: "generic-endpoint",
    endpointEnv: "MESHY_API_URL",
    preparedOnly: true,
    execution: "async",
    supportsWebhook: true,
    defaultModel: "meshy-text-to-3d",
    pricing: { chargeUnit: "asset", creditsPerUnit: 120, minimumCredits: 120, source: "internal_estimate" }
  },
  Tripo3D: {
    kind: "3d",
    envKey: "TRIPO3D_API_KEY",
    adapter: "generic-endpoint",
    endpointEnv: "TRIPO3D_API_URL",
    preparedOnly: true,
    execution: "async",
    supportsWebhook: true,
    defaultModel: "tripo-text-to-3d",
    pricing: { chargeUnit: "asset", creditsPerUnit: 120, minimumCredits: 120, source: "internal_estimate" }
  },

  OpenAI: { kind: "assist", envKey: "OPENAI_API_KEY", adapter: "openai-responses" },
  "GPT voz + texto": { kind: "assist", envKey: "OPENAI_API_KEY", adapter: "openai-responses" },
  "GPT texto": { kind: "assist", envKey: "OPENAI_API_KEY", adapter: "openai-responses" },
  "GPT-4.1": { kind: "assist", envKey: "OPENAI_API_KEY", adapter: "openai-responses" },
  "GPT-4o": { kind: "assist", envKey: "OPENAI_API_KEY", adapter: "openai-responses" },
  "Meta Llama": { kind: "assist", envKey: "OPENROUTER_API_KEY", adapter: "openrouter-chat" },
  Anthropic: { kind: "assist", envKey: "ANTHROPIC_API_KEY", adapter: "generic-endpoint", endpointEnv: "ANTHROPIC_API_URL", disabledByPreference: true },
  Claude: { kind: "assist", envKey: "ANTHROPIC_API_KEY", adapter: "generic-endpoint", endpointEnv: "ANTHROPIC_API_URL", disabledByPreference: true },
  Gemini: { kind: "assist", envKey: "GEMINI_API_KEY", adapter: "gemini-text" },
  "Hermes local": { kind: "assist", envKey: "LOCAL_MODEL_API_URL", adapter: "ollama-chat", endpointEnv: "LOCAL_MODEL_API_URL", configEnvKeys: ["LOCAL_MODEL_NAME"] },
  "Local model": { kind: "assist", envKey: "LOCAL_MODEL_API_URL", adapter: "ollama-chat", endpointEnv: "LOCAL_MODEL_API_URL", configEnvKeys: ["LOCAL_MODEL_NAME"] },

  Stripe: { kind: "billing", envKey: "STRIPE_SECRET_KEY", adapter: "stripe-status" }
};

const multimodalOperations = {
  image: [
    ["text_to_image", "Text to Image"],
    ["image_to_image", "Image to Image"],
    ["references_to_image", "References to Image"],
    ["character_image", "Character Image"],
    ["product_image", "Product Image"],
    ["style_transfer", "Style Transfer"],
    ["inpaint", "Inpaint"],
    ["outpaint", "Outpaint"],
    ["remove_object", "Remove Object"],
    ["background_replacement", "Background Replacement"],
    ["product_reshoot", "Product Reshoot"],
    ["mockup", "Mockup"],
    ["create_ad", "Create Ad"],
    ["vary_ad", "Vary Ad"],
    ["ad_concepter", "Ad Concepter"],
    ["ad_localization", "Ad Localization"],
    ["generative_expand", "Generative Expand"],
    ["upscale", "Upscale"]
  ],
  video: [
    ["text_to_video", "Text to Video"],
    ["image_to_video", "Image to Video"],
    ["references_to_video", "References to Video"],
    ["video_to_video", "Video to Video"],
    ["reality_transform", "Reality Transform"],
    ["scene_builder", "Scene Builder"],
    ["first_last_frame", "First Frame / Last Frame"],
    ["keyframes", "Keyframes"],
    ["character_performance", "Character Performance"],
    ["lip_sync", "Lip Sync"],
    ["stylize", "Stylize"],
    ["background_replacement", "Background Replacement"],
    ["remove_object", "Remove Object"],
    ["color_grade", "Color Grade"],
    ["lighting", "Lighting"],
    ["weather", "Weather"],
    ["time_of_day", "Time of Day"],
    ["seamless_loop", "Seamless Loop"],
    ["stitch", "Stitch"],
    ["upscale", "Upscale"],
    ["frame_extraction", "Frame Extraction"]
  ],
  music: [
    ["text_to_music", "Text to Music"],
    ["lyrics_to_song", "Lyrics to Song"],
    ["instrumental", "Instrumental"],
    ["vocal_song", "Vocal Song"],
    ["background_score", "Background Score"],
    ["film_score", "Film Score"],
    ["trailer_music", "Trailer Music"],
    ["jingle", "Jingle"],
    ["ad_music", "Ad Music"],
    ["loop", "Loop"],
    ["remix", "Remix"],
    ["extend_song", "Extend Song"],
    ["variation", "Variation"],
    ["style_transfer", "Style Transfer"],
    ["reference_to_music", "Reference to Music"],
    ["vocal_replacement", "Vocal Replacement"],
    ["stem_generation", "Stem Generation"],
    ["stem_separation", "Stem Separation"],
    ["mastering", "Mastering"],
    ["audio_enhance", "Upscale / Enhance Audio"]
  ],
  sound: [
    ["text_to_sfx", "Text to SFX"],
    ["foley", "Foley"],
    ["ambience", "Ambience"],
    ["room_tone", "Room Tone"],
    ["weather", "Weather"],
    ["impact", "Impact"],
    ["whoosh", "Whoosh"],
    ["riser", "Riser"],
    ["transition", "Transition"],
    ["creature_sound", "Creature Sound"],
    ["cinematic_sound", "Cinematic Sound"],
    ["ui_sound", "UI Sound"],
    ["game_sound", "Game Sound"],
    ["background_atmosphere", "Background Atmosphere"],
    ["text_to_speech", "Text to Speech"],
    ["speech_to_speech", "Speech to Speech"],
    ["voice_isolation", "Voice Isolation"],
    ["voice_cleanup", "Voice Cleanup"],
    ["voice_dubbing", "Voice Dubbing"],
    ["voice_cloning", "Voice Cloning"],
    ["lip_sync_audio", "Lip Sync Audio"],
    ["audio_extend", "Audio Extend"],
    ["audio_remix", "Audio Remix"],
    ["audio_enhance", "Audio Enhance"]
  ],
  voice: [
    ["text_to_speech", "Text to Speech"],
    ["speech_to_speech", "Speech to Speech"],
    ["voice_dubbing", "Voice Dubbing"],
    ["voice_cloning", "Voice Cloning"]
  ]
};

const multimodalModelRegistry = [
  {
    id: "openai-image-default",
    provider: "OpenAI Images",
    model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-1",
    label: "OpenAI Images",
    modality: "image",
    operations: ["text_to_image"],
    outputs: { aspectRatios: ["1:1", "3:2", "2:3"], maxNativeResolution: "provider-managed" },
    ratings: { quality: 5, speed: 3, cost: 2 }
  },
  {
    id: "gemini-image-default",
    provider: "Gemini Image",
    model: process.env.GEMINI_IMAGE_MODEL || "gemini-image",
    label: "Gemini Image",
    modality: "image",
    operations: ["text_to_image", "image_to_image", "references_to_image", "character_image", "style_transfer"],
    inputs: { imageReference: true, videoReference: false, maxReferences: 4 },
    outputs: { aspectRatios: ["1:1", "4:5", "16:9", "9:16"], maxNativeResolution: "provider-managed" },
    ratings: { quality: 4, speed: 4, cost: 3 }
  },
  {
    id: "grok-image-default",
    provider: "Grok Image",
    model: process.env.XAI_IMAGE_MODEL || "grok-image",
    label: "Grok Image",
    modality: "image",
    operations: ["text_to_image"],
    outputs: { aspectRatios: ["1:1", "16:9", "9:16"], maxNativeResolution: "provider-managed" },
    ratings: { quality: 4, speed: 4, cost: 3 }
  },
  {
    id: "replicate-flux",
    provider: "Replicate",
    model: process.env.REPLICATE_IMAGE_MODEL || "black-forest-labs/flux-schnell",
    label: "FLUX via Replicate",
    modality: "image",
    operations: ["text_to_image"],
    outputs: { aspectRatios: ["1:1", "4:5", "16:9", "9:16", "3:2", "2:3"], maxNativeResolution: "provider-managed" },
    ratings: { quality: 4, speed: 5, cost: 4 }
  },
  {
    id: "seedance-2",
    provider: "Seedance",
    model: process.env.SEEDANCE_MODEL_ID || "dreamina-seedance-2-0-260128",
    label: "Seedance 2.0",
    modality: "video",
    operations: ["text_to_video", "image_to_video"],
    inputs: { imageReference: true, videoReference: false, maxReferences: 1 },
    outputs: { durations: [5, 10], resolutions: ["720p", "1080p"], aspectRatios: ["16:9", "9:16", "1:1"], nativeAudio: false },
    ratings: { quality: 4, speed: 4, cost: 3 }
  },
  {
    id: "runway-gen4-turbo",
    provider: "Runway",
    model: "gen4_turbo",
    label: "Runway Gen-4 Turbo",
    modality: "video",
    operations: ["text_to_video", "image_to_video", "references_to_video", "first_last_frame", "keyframes"],
    inputs: { imageReference: true, videoReference: false, maxReferences: 5 },
    outputs: { durations: [5, 10], resolutions: ["720p", "1080p"], aspectRatios: ["16:9", "9:16", "1:1"], nativeAudio: false },
    ratings: { quality: 4, speed: 4, cost: 3 }
  },
  {
    id: "runway-gen45",
    provider: "Runway",
    model: "gen4.5",
    label: "Runway Gen-4.5",
    modality: "video",
    operations: ["text_to_video", "image_to_video", "references_to_video", "first_last_frame", "keyframes"],
    inputs: { imageReference: true, videoReference: false, maxReferences: 5 },
    outputs: { durations: [5, 10], resolutions: ["720p", "1080p"], aspectRatios: ["16:9", "9:16", "1:1"], nativeAudio: false },
    ratings: { quality: 5, speed: 2, cost: 1 }
  },
  {
    id: "runway-aleph2",
    provider: "Runway",
    model: "aleph2",
    label: "Runway Aleph 2 · Reality Transform",
    modality: "video",
    operations: ["video_to_video", "reality_transform", "stylize", "background_replacement", "color_grade", "lighting", "weather", "time_of_day"],
    inputs: { imageReference: true, videoReference: true, minDurationSeconds: 2, maxDurationSeconds: 30, maxInputFps: 30, maxReferences: 5 },
    outputs: { durations: { min: 2, max: 30 }, resolutions: ["1080p"], maxNativeResolution: "1080p", nativeAudio: false, upscaleIsPostProcess: true },
    ratings: { quality: 5, speed: 2, cost: 1 }
  },
  {
    id: "luma-modify",
    provider: "Luma Modify",
    model: "luma/modify-video",
    label: "Luma Modify",
    modality: "video",
    operations: ["video_to_video", "reality_transform", "stylize", "background_replacement"],
    inputs: { imageReference: false, videoReference: true, maxReferences: 1 },
    outputs: { resolutions: ["720p"], nativeAudio: false, upscaleIsPostProcess: true },
    ratings: { quality: 4, speed: 2, cost: 1 }
  },
  {
    id: "minimax-music-default",
    provider: "MiniMax Music",
    model: process.env.MINIMAX_MUSIC_MODEL || "music-2.0",
    label: "MiniMax Music",
    modality: "music",
    operations: ["text_to_music", "lyrics_to_song", "instrumental", "vocal_song", "background_score", "film_score", "trailer_music", "jingle", "ad_music", "loop", "variation"],
    inputs: { audioReference: false, lyrics: true },
    outputs: { durations: { min: 10, max: 240 }, formats: ["mp3", "wav"] },
    ratings: { quality: 4, speed: 3, cost: 3 }
  },
  {
    id: "stable-audio-default",
    provider: "Stable Audio",
    model: process.env.STABLE_AUDIO_MODEL || "stable-audio-2",
    label: "Stable Audio",
    modality: "music",
    operations: ["text_to_music", "instrumental", "background_score", "film_score", "trailer_music", "jingle", "ad_music", "loop", "variation"],
    inputs: { audioReference: false, lyrics: false },
    outputs: { durations: { min: 1, max: 180 }, formats: ["mp3", "wav"] },
    ratings: { quality: 4, speed: 3, cost: 3 }
  },
  {
    id: "audiocraft-musicgen",
    provider: "AudioCraft local",
    model: process.env.AUDIOCRAFT_REPLICATE_MODEL || "meta/musicgen",
    label: "MusicGen via Replicate",
    modality: "music",
    operations: ["text_to_music", "instrumental", "background_score", "loop", "variation"],
    inputs: { audioReference: false, lyrics: false },
    outputs: { durations: { min: 1, max: 30 }, formats: ["wav"] },
    ratings: { quality: 3, speed: 4, cost: 4 }
  },
  {
    id: "elevenlabs-tts",
    provider: "ElevenLabs",
    model: process.env.ELEVENLABS_MODEL_ID || "eleven_flash_v2_5",
    label: "ElevenLabs Voice",
    modality: "sound",
    operations: ["text_to_speech"],
    inputs: { audioReference: false, text: true },
    outputs: { formats: ["mp3"] },
    ratings: { quality: 5, speed: 5, cost: 4 }
  },
  {
    id: "openai-speech",
    provider: "OpenAI Audio",
    model: process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts",
    label: "OpenAI Speech",
    modality: "sound",
    operations: ["text_to_speech"],
    inputs: { audioReference: false, text: true },
    outputs: { formats: ["mp3"] },
    ratings: { quality: 4, speed: 5, cost: 4 }
  },
  {
    id: "minimax-speech-default",
    provider: "MiniMax Speech",
    model: process.env.MINIMAX_SPEECH_MODEL || "speech-02-hd",
    label: "MiniMax Speech",
    modality: "sound",
    operations: ["text_to_speech"],
    inputs: { audioReference: false, text: true },
    outputs: { formats: ["mp3"] },
    ratings: { quality: 4, speed: 4, cost: 3 }
  },
  {
    id: "stability-audio-sfx",
    provider: "Stability Audio",
    model: process.env.STABILITY_AUDIO_MODEL || "stable-audio-2",
    label: "Stability Audio",
    modality: "sound",
    operations: ["text_to_sfx", "foley", "ambience", "room_tone", "weather", "impact", "whoosh", "riser", "transition", "creature_sound", "cinematic_sound", "ui_sound", "game_sound", "background_atmosphere"],
    inputs: { audioReference: false, text: true },
    outputs: { durations: { min: 1, max: 180 }, formats: ["mp3", "wav"] },
    ratings: { quality: 4, speed: 3, cost: 3 }
  },
  {
    id: "moises-processing",
    provider: "Moises",
    model: "workflow",
    label: "Moises Audio Processing",
    modality: "sound",
    operations: ["voice_isolation", "voice_cleanup", "stem_separation", "audio_enhance"],
    inputs: { audioReference: true, text: false },
    outputs: { formats: ["wav", "mp3"] },
    ratings: { quality: 4, speed: 2, cost: 2 }
  },
  {
    id: "elevenlabs-voice",
    provider: "ElevenLabs",
    model: process.env.ELEVENLABS_MODEL_ID || "eleven_flash_v2_5",
    label: "ElevenLabs Voice",
    modality: "voice",
    operations: ["text_to_speech"],
    inputs: { audioReference: false, text: true },
    outputs: { formats: ["mp3"] },
    ratings: { quality: 5, speed: 5, cost: 4 }
  },
  {
    id: "openai-voice",
    provider: "OpenAI Audio",
    model: process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts",
    label: "OpenAI Voice",
    modality: "voice",
    operations: ["text_to_speech"],
    inputs: { audioReference: false, text: true },
    outputs: { formats: ["mp3"] },
    ratings: { quality: 4, speed: 5, cost: 4 }
  },
  {
    id: "minimax-voice",
    provider: "MiniMax Speech",
    model: process.env.MINIMAX_SPEECH_MODEL || "speech-02-hd",
    label: "MiniMax Voice",
    modality: "voice",
    operations: ["text_to_speech"],
    inputs: { audioReference: false, text: true },
    outputs: { formats: ["mp3"] },
    ratings: { quality: 4, speed: 4, cost: 3 }
  }
];

function normalizeMultimodalOperation(value = "", modality = "") {
  const normalized = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  const aliases = {
    text2video: "text_to_video",
    text2image: "text_to_image",
    image2video: "image_to_video",
    image2image: "image_to_image",
    video2video: "video_to_video",
    realitytransform: "reality_transform",
    video_to_video: "video_to_video",
    scene_transfer: "reality_transform",
    background_styling: "reality_transform"
  };
  if (aliases[normalized]) return aliases[normalized];
  if (normalized) return normalized;
  if (modality === "video") return "text_to_video";
  if (modality === "music") return "text_to_music";
  if (["sound", "voice"].includes(modality)) return modality === "voice" ? "text_to_speech" : "text_to_sfx";
  return "text_to_image";
}

function modelAvailability(model) {
  const provider = providerStatus(model.provider);
  return {
    ...model,
    connected: provider.connected,
    providerStatus: provider.status,
    canGenerate: provider.canGenerate,
    message: provider.message,
    pricing: providerModelConfig(providerCatalog[model.provider] || {}, { model: model.model })?.pricing || provider.pricing || null
  };
}

function operationCatalog(modality = "") {
  const models = multimodalModelRegistry.filter((model) => model.modality === modality).map(modelAvailability);
  return (multimodalOperations[modality] || []).map(([id, label]) => {
    const candidates = models.filter((model) => model.operations.includes(id));
    return {
      id,
      label,
      implemented: candidates.length > 0,
      available: candidates.some((model) => model.connected),
      status: candidates.some((model) => model.connected) ? "available" : candidates.length ? "provider_not_connected" : "coming_soon",
      providers: [...new Set(candidates.map((model) => model.provider))],
      models: candidates.map((model) => model.id)
    };
  });
}

function supportsRouterRequest(model, request = {}) {
  if (model.modality !== request.modality || !model.operations.includes(request.operation)) return false;
  const references = Array.isArray(request.references) ? request.references : [];
  if (references.some((reference) => reference.kind === "video") && !model.inputs?.videoReference) return false;
  if (references.some((reference) => reference.kind === "image") && !model.inputs?.imageReference) return false;
  if (references.some((reference) => reference.kind === "audio") && !model.inputs?.audioReference) return false;
  const duration = Number(request.durationSeconds || 0);
  if (duration && model.inputs?.minDurationSeconds && duration < model.inputs.minDurationSeconds) return false;
  if (duration && model.inputs?.maxDurationSeconds && duration > model.inputs.maxDurationSeconds) return false;
  const resolutions = model.outputs?.resolutions || [];
  if (request.resolution && resolutions.length && !resolutions.includes(request.resolution)) return false;
  if (request.audio === true && model.outputs?.nativeAudio === false) return false;
  return true;
}

function routeMultimodalModel(payload = {}) {
  const modality = String(payload.modality || payload.kind || "image").toLowerCase();
  const operation = normalizeMultimodalOperation(payload.operation || payload.actionId || payload.tool, modality);
  const priority = ["speed", "cost", "quality"].includes(String(payload.priority || "quality").toLowerCase())
    ? String(payload.priority || "quality").toLowerCase()
    : "quality";
  const references = (payload.referenceAssetIds || []).map((id) => {
    const asset = state.assets.find((item) => item.id === id);
    const contentType = String(asset?.contentType || "");
    return { id, kind: contentType.startsWith("video/") ? "video" : contentType.startsWith("audio/") ? "audio" : "image" };
  });
  const request = {
    modality,
    operation,
    priority,
    references,
    durationSeconds: Number(payload.durationSeconds || payload.videoDurationSeconds || 0) || null,
    resolution: payload.resolution || payload.outputResolution || null,
    audio: payload.audio === true || payload.generateAudio === true
  };
  let candidates = multimodalModelRegistry.map(modelAvailability).filter((model) => supportsRouterRequest(model, request));
  const manualProvider = normalizeProviderName(payload.provider || payload.providerLabel || "");
  const manualModel = String(payload.model || payload.modelId || "").trim();
  if (manualProvider && !["auto", "slt auto"].includes(manualProvider.toLowerCase())) candidates = candidates.filter((model) => model.provider === manualProvider);
  if (manualModel && manualModel.toLowerCase() !== "auto") candidates = candidates.filter((model) => model.model === manualModel || model.id === manualModel);
  const ratingKey = priority;
  candidates.sort((left, right) => {
    if (left.connected !== right.connected) return left.connected ? -1 : 1;
    return Number(right.ratings?.[ratingKey] || 0) - Number(left.ratings?.[ratingKey] || 0);
  });
  const selected = candidates.find((model) => model.connected) || candidates[0] || null;
  return {
    ok: Boolean(selected?.connected),
    request,
    selected,
    candidates,
    comingSoon: !candidates.length,
    message: selected?.connected
      ? `${selected.label} selected for ${operation}.`
      : candidates.length
        ? "A compatible route exists, but no provider is connected."
        : "Coming Soon: no real provider route implements this operation yet."
  };
}

const defaultProvider = {
  image: "OpenAI Images",
  video: "Seedance",
  music: "SLT Composer",
  sound: "ElevenLabs",
  assist: "OpenAI",
  billing: "Stripe",
  subscription: "Stripe"
};

const providerFallbackChains = {
  image: ["OpenAI Images", "Gemini Image", "Grok Image", "Stability", "Replicate"],
  video: ["Seedance", "Runway", "Luma", "Kling", "Wan", "Hailuo"],
  music: ["MiniMax Music", "SLT Composer", "AudioCraft local", "Riffusion", "Stable Audio"],
  sound: ["ElevenLabs", "OpenAI Audio", "MiniMax Speech", "Stability Audio", "Moises"],
  assist: ["OpenAI", "Gemini", "Meta Llama", "Hermes local", "Local model"]
};

const planCreditAllowance = {
  Free: 30,
  Pro: 1500,
  Studio: 5000,
  Business: 12000,
  Creator: 20000,
  Enterprise: 0
};

const planUsageRules = {
  Free: { maxVideoSeconds: 10, dailyVideoLimit: 3 },
  Pro: { maxVideoSeconds: 10, dailyVideoLimit: 20 },
  Studio: { maxVideoSeconds: 15, dailyVideoLimit: 60 },
  Business: { maxVideoSeconds: 30, dailyVideoLimit: 120 },
  Creator: { maxVideoSeconds: 60, dailyVideoLimit: 200 },
  Enterprise: { maxVideoSeconds: 300, dailyVideoLimit: 500 }
};

const creditPackCatalog = {
  credits_500: {
    id: "credits_500",
    name: "500 extra credits",
    credits: 500,
    amount: 3000,
    price: "$30",
    envKey: "STRIPE_PRICE_CREDITS_500"
  },
  credits_1000: {
    id: "credits_1000",
    name: "1,000 extra credits",
    credits: 1000,
    amount: 4900,
    price: "$49",
    envKey: "STRIPE_PRICE_CREDITS_1000"
  },
  credits_3000: {
    id: "credits_3000",
    name: "3,000 extra credits",
    credits: 3000,
    amount: 12900,
    price: "$129",
    envKey: "STRIPE_PRICE_CREDITS_3000"
  },
  credits_7500: {
    id: "credits_7500",
    name: "7,500 extra credits",
    credits: 7500,
    amount: 29900,
    price: "$299",
    envKey: "STRIPE_PRICE_CREDITS_7500"
  },
  credits_15000: {
    id: "credits_15000",
    name: "15,000 extra credits",
    credits: 15000,
    amount: 54900,
    price: "$549",
    envKey: "STRIPE_PRICE_CREDITS_15000"
  }
};

const rateBuckets = new Map();
const usageBuckets = new Map();

function creditsForPlan(plan = "Free") {
  return planCreditAllowance[plan] ?? planCreditAllowance.Free;
}

function providerModelConfig(config = {}, payload = {}) {
  const requestedModel = String(
    payload.model ||
    payload.modelId ||
    payload.providerModel ||
    payload.providerModelId ||
    ""
  ).trim();
  const envModel = config.modelEnv ? String(process.env[config.modelEnv] || "").trim() : "";
  const preferredModel = requestedModel || envModel || config.defaultModel || "";
  const models = Array.isArray(config.models) ? config.models : [];
  return (
    models.find((model) => model.id === preferredModel || model.label === preferredModel) ||
    models.find((model) => model.id === config.defaultModel) ||
    (preferredModel ? { id: preferredModel, label: preferredModel, pricing: config.pricing || null } : null)
  );
}

function providerPricingFor(config = {}, payload = {}) {
  const model = providerModelConfig(config, payload);
  return model?.pricing || config.pricing || null;
}

function meteredTextLength(payload = {}) {
  const source = [
    payload.prompt,
    payload.text,
    payload.input,
    payload.script,
    payload.lyrics,
    payload.description,
    payload.title
  ].filter(Boolean).join("\n");
  return Math.max(1, source.length || 1);
}

function billableVideoSeconds(payload = {}) {
  const fromPlan = Number(payload.videoPlan?.requestedDurationSeconds || 0);
  if (Number.isFinite(fromPlan) && fromPlan > 0) return fromPlan;
  return requestedVideoDurationSeconds(payload);
}

function billableUnitCount(payload = {}, keys = ["count", "quantity"]) {
  for (const key of keys) {
    const parsed = Number.parseInt(String(payload[key] || ""), 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 1;
}

function billableOutputCount(payload = {}) {
  const units = billableUnitCount(payload, [
    "outputCount",
    "outputs",
    "variants",
    "imageCount",
    "videoCount",
    "trackCount",
    "songCount",
    "assetCount",
    "count",
    "quantity"
  ]);
  return Math.min(8, Math.max(1, units));
}

function creditCostFor(kind = "assist", payload = {}) {
  const requestedProvider = payload.provider || payload.providerLabel || defaultProvider[kind] || "";
  const normalizedProvider = normalizeProviderName(String(requestedProvider));
  const config = providerCatalog[normalizedProvider];
  const pricing = providerPricingFor(config, payload);
  const outputCount = ["image", "video", "music", "sound", "fashion"].includes(kind)
    ? billableOutputCount(payload)
    : 1;
  if (pricing?.chargeUnit === "second") {
    const seconds = billableVideoSeconds(payload);
    const perOutput = Math.max(pricing.minimumCredits || 0, Math.ceil(seconds * (pricing.creditsPerSecond || pricing.creditsPerUnit || 1)));
    return perOutput * outputCount;
  }
  if (pricing?.chargeUnit === "character") {
    const unitSize = pricing.unitSize || 1;
    const units = Math.ceil(meteredTextLength(payload) / unitSize);
    return Math.max(pricing.minimumCredits || 0, units * (pricing.creditsPerUnit || 1)) * outputCount;
  }
  if (["track", "song", "asset"].includes(pricing?.chargeUnit)) {
    const units = billableUnitCount(payload, ["trackCount", "songCount", "assetCount", "outputCount", "outputs", "count", "quantity"]);
    return Math.max(pricing.minimumCredits || 0, units * (pricing.creditsPerUnit || 1));
  }
  const costByKind = { image: 10, video: 300, music: 150, sound: 25, fashion: 25, assist: 5 };
  return (costByKind[kind] || 5) * outputCount;
}

function usageRulesForPlan(plan = "Free") {
  return planUsageRules[plan] || planUsageRules.Free;
}

const state = {
  user: {
    id: "demo-user",
    email: "creator@sweetlittletrauma.studio",
    username: "sweetcreator",
    plan: "Free",
    language: "Spanish",
    accountType: "Creator",
    credits: creditsForPlan("Free"),
    storageUsed: "3.2 GB",
    preferences: {
      visualStyle: "black neon",
      assistantVoice: "soft",
      assistantMemory: "creative preferences"
    }
  },
  subscription: {
    plan: "Free",
    status: "active",
    renewsAt: "2026-06-18",
    credits: creditsForPlan("Free"),
    heldCredits: 0,
    capturedCredits: 0,
    cancellationReason: "",
    stripeCustomerId: process.env.STRIPE_CUSTOMER_ID || "",
    stripeSubscriptionId: ""
  },
  billing: {
    paymentMethod: "•••• 4242",
    coupon: "",
    stripeCustomerId: process.env.STRIPE_CUSTOMER_ID || "",
    invoices: [
      { id: "INV-0004", amount: "$19.00", status: "paid", date: "2026-05-18" },
      { id: "INV-0003", amount: "$19.00", status: "paid", date: "2026-04-18" },
      { id: "INV-0002", amount: "$0.00", status: "trial", date: "2026-03-18" }
    ],
    failedPayment: {
      amount: "$19.00",
      message: "Payment failed. Update your payment method and retry."
    }
  },
  projects: [],
  generationSessions: [],
  generationBatches: [],
  history: [],
  jobs: [],
  assets: [],
  forms: [],
  characters: [],
  characterConsents: [],
  characterCaptureSessions: [],
  characterAssets: [],
  characterVersions: [],
  creativeReferences: [],
  scenes: [],
  sceneItems: [],
  timelineItems: [],
  workflows: [],
  workflowNodes: [],
  workflowEdges: [],
  appInstances: [],
  webhookEvents: [],
  paymentEvents: [],
  errorIncidents: [],
  compensationCoupons: [],
  providerDiagnostics: [
    {
      provider: "Runway",
      status: "PROVIDER_NO_CREDITS",
      errorName: "PROVIDER_NO_CREDITS",
      errorCode: "SLT-1002",
      customerMessage: "Temporarily unavailable — provider balance required.",
      checkedAt: new Date().toISOString(),
      metadata: { source: "verified_external_balance" }
    },
    {
      provider: "Replicate",
      status: "PROVIDER_BILLING_REQUIRED",
      errorName: "PROVIDER_BILLING_REQUIRED",
      errorCode: "SLT-1003",
      customerMessage: "Temporarily unavailable — provider billing required.",
      checkedAt: new Date().toISOString(),
      metadata: { source: "verified_external_billing" }
    }
  ],
  wallet: {
    tenantId: "demo-user",
    availableCredits: creditsForPlan("Free"),
    heldCredits: 0,
    capturedCredits: 0
  },
  wallets: [
    {
      tenantId: "demo-user",
      availableCredits: creditsForPlan("Free"),
      heldCredits: 0,
      capturedCredits: 0
    }
  ],
  creditReservations: [],
  creditTransactions: [
    {
      id: "credit_tx_opening_demo_user_free",
      idempotencyKey: "opening:demo-user:free",
      idempotency_key: "opening:demo-user:free",
      type: "opening_balance",
      status: "posted",
      amount: creditsForPlan("Free"),
      reservationId: null,
      jobId: null,
      tenantId: "demo-user",
      entries: [
        { account: "SLT.CreditIssuer", direction: "debit", amount: creditsForPlan("Free") },
        { account: "Tenant.Available", direction: "credit", amount: creditsForPlan("Free") }
      ],
      balanceDeltas: {
        availableCredits: creditsForPlan("Free"),
        heldCredits: 0,
        capturedCredits: 0
      },
      metadata: { plan: "Free", source: "startup_migration" },
      createdAt: new Date().toISOString()
    }
  ]
};

const sessions = new Map();
const processedWebhookEvents = new Set();
const generationExecutionQueue = [];
let activeGenerationExecutions = 0;
const runtimeStore = createRuntimeStore(process.env);
let runtimeStoreInitialized = false;
let runtimeStoreLastError = null;
let runtimePersistChain = Promise.resolve();

function hydrateRuntimeState(persisted = {}) {
  for (const key of ["user", "subscription", "billing", "wallet"]) {
    if (persisted[key] && typeof persisted[key] === "object") {
      state[key] = { ...state[key], ...persisted[key] };
    }
  }
  for (const key of [
    "projects",
    "generationSessions",
    "generationBatches",
    "history",
    "jobs",
    "assets",
    "forms",
    "characters",
    "characterConsents",
    "characterCaptureSessions",
    "characterAssets",
    "characterVersions",
    "creativeReferences",
    "scenes",
    "sceneItems",
    "timelineItems",
    "workflows",
    "workflowNodes",
    "workflowEdges",
    "appInstances",
    "webhookEvents",
    "paymentEvents",
    "errorIncidents",
    "compensationCoupons",
    "providerDiagnostics",
    "creditReservations",
    "creditTransactions"
  ]) {
    if (Array.isArray(persisted[key])) {
      state[key] = persisted[key];
    }
  }
  if (Array.isArray(persisted.wallets)) {
    state.wallets = persisted.wallets;
  } else if (persisted.wallet?.tenantId) {
    state.wallets = [{ ...persisted.wallet }];
  }
  if (!state.providerDiagnostics.some((item) => item.provider === "Runway")) {
    state.providerDiagnostics.push({
      provider: "Runway",
      status: "PROVIDER_NO_CREDITS",
      errorName: "PROVIDER_NO_CREDITS",
      errorCode: "SLT-1002",
      customerMessage: "Temporarily unavailable — provider balance required.",
      checkedAt: new Date().toISOString(),
      metadata: { source: "verified_external_balance" }
    });
  }
  if (!state.providerDiagnostics.some((item) => item.provider === "Replicate")) {
    state.providerDiagnostics.push({
      provider: "Replicate",
      status: "PROVIDER_BILLING_REQUIRED",
      errorName: "PROVIDER_BILLING_REQUIRED",
      errorCode: "SLT-1003",
      customerMessage: "Temporarily unavailable — provider billing required.",
      checkedAt: new Date().toISOString(),
      metadata: { source: "verified_external_billing" }
    });
  }
  for (const paymentEvent of state.paymentEvents) {
    if (paymentEvent.eventKey || paymentEvent.eventId || paymentEvent.id) {
      processedWebhookEvents.add(paymentEvent.eventKey || paymentEvent.eventId || paymentEvent.id);
    }
  }
  for (const webhookEvent of state.webhookEvents) {
    if (webhookEvent.eventKey || webhookEvent.eventId || webhookEvent.id) {
      processedWebhookEvents.add(webhookEvent.eventKey || webhookEvent.eventId || webhookEvent.id);
    }
  }
  syncCreditViews();
}

async function initializeRuntimeStore() {
  if (runtimeStoreInitialized) return runtimeStore.status();
  try {
    await runtimeStore.initialize({ seedState: state });
    const persisted = await runtimeStore.loadState();
    if (persisted) hydrateRuntimeState(persisted);
    await runtimeStore.saveState({ state, sessions, reason: "startup_sync" });
    runtimeStoreInitialized = true;
    runtimeStoreLastError = null;
  } catch (error) {
    runtimeStoreLastError = error.message;
    throw error;
  }
  return runtimeStore.status();
}

async function persistRuntimeState(reason = "mutation") {
  if (!runtimeStore.durable || !runtimeStoreInitialized) {
    return { ok: true, skipped: true, reason: "non_durable_runtime_store" };
  }
  const persist = async () => {
    try {
      const result = await runtimeStore.saveState({ state, sessions, reason });
      runtimeStoreLastError = null;
      return result;
    } catch (error) {
      runtimeStoreLastError = error.message;
      console.error("[SLT] Failed to persist runtime state:", error.message);
      return { ok: false, error: error.message };
    }
  };
  const result = runtimePersistChain.then(persist, persist);
  runtimePersistChain = result.then(() => undefined, () => undefined);
  return result;
}

function runtimeStoreStatus() {
  return {
    ...runtimeStore.status(),
    initialized: runtimeStoreInitialized,
    lastError: runtimeStoreLastError || runtimeStore.status().lastError || null
  };
}

function hasEnvValue(key) {
  return Boolean(process.env[key] && process.env[key].trim());
}

function firstEnvValue(keys = []) {
  return keys.map((key) => process.env[key]).find((value) => value && value.trim()) || "";
}

function providerApiKey(config = {}) {
  return firstEnvValue([config.envKey, ...(config.alternateEnvKeys || [])].filter(Boolean));
}

function providerEndpoint(config = {}) {
  return firstEnvValue([config.endpointEnv, ...(config.alternateEndpointEnvKeys || [])].filter(Boolean)) || config.defaultEndpoint || "";
}

function envNumber(key, fallback) {
  const parsed = Number(process.env[key]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sanitizeEnvValue(value = "") {
  return String(value)
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .replace(/\s+folder\s*$/i, "")
    .trim();
}

function uniqueEnvModels(candidates = []) {
  const seen = new Set();
  return candidates
    .map((item) => sanitizeEnvValue(item))
    .filter((item) => {
      if (!item || seen.has(item)) return false;
      seen.add(item);
      return true;
    });
}

function isRetryableProviderModelError(error) {
  const lower = String(error?.message || "").toLowerCase();
  return [400, 404, 422].includes(error?.statusCode) && (
    lower.includes("model") ||
    lower.includes("endpoint") ||
    lower.includes("not found") ||
    lower.includes("notopen") ||
    lower.includes("invalid") ||
    lower.includes("does not exist") ||
    lower.includes("unknown")
  );
}

const providerModelEnvHints = {
  Seedance: "SEEDANCE_MODEL_ID",
  Runway: "RUNWAY_MODEL_ID",
  Luma: "LUMA_MODEL_ID",
  Kling: "KLING_MODEL_ID",
  Veo: "VEO_MODEL_ID",
  PixVerse: "PIXVERSE_MODEL"
};

function requestId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

function incidentHttpStatus(classification = {}) {
  if (classification.code === "SLT-1001") return 402;
  if (["SLT-1101", "SLT-1102", "SLT-1103"].includes(classification.code)) return 401;
  if (classification.code === "SLT-1104") return 403;
  if (["MODEL", "INPUT", "MODERATION"].includes(classification.category)) return 400;
  if (classification.code === "SLT-1503") return 429;
  if (["SLT-1002", "SLT-1003", "SLT-1202", "SLT-1205", "SLT-1504", "SLT-1701", "SLT-1801", "SLT-1802"].includes(classification.code)) return 503;
  return 502;
}

function incidentForId(incidentId = "") {
  return state.errorIncidents.find((item) => item.incidentId === incidentId || item.id === incidentId) || null;
}

function couponForIncident(incidentId = "") {
  return state.compensationCoupons.find((item) => item.incidentId === incidentId) || null;
}

function incidentDedupeCandidate({ tenantId, jobId, errorCode, provider, route } = {}) {
  const cutoff = Date.now() - envNumber("INCIDENT_DEDUPE_MINUTES", 15) * 60_000;
  return state.errorIncidents.find((incident) => {
    if (incident.tenantId !== tenantId || incident.errorCode !== errorCode) return false;
    if (jobId) return incident.jobId === jobId;
    return incident.provider === provider
      && incident.route === route
      && new Date(incident.createdAt || 0).getTime() >= cutoff
      && !["RESOLVED", "IGNORED"].includes(incident.status);
  }) || null;
}

function compensationAllowed(classification = {}, context = {}) {
  if (!classification.compensationEligible) return false;
  if (["INPUT", "MODERATION"].includes(classification.category)) return false;
  if (["USER_INSUFFICIENT_CREDITS", "PERMISSION_DENIED", "SESSION_EXPIRED", "MODEL_NOT_FOUND", "MODEL_PARAMETER_UNSUPPORTED"].includes(classification.name)) return false;
  if (context.cancelled || context.deliberateInvalid || context.abuse || context.fraud) return false;
  return true;
}

function compensationExpiry() {
  const days = Math.max(1, envNumber("COMPENSATION_COUPON_EXPIRY_DAYS", 30));
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

function createCompensationCoupon({ incident, userId, tenantId } = {}) {
  if (!incident?.incidentId) return null;
  const existing = couponForIncident(incident.incidentId);
  if (existing) return existing;
  const coupon = {
    id: requestId("compensation_coupon"),
    tenantId,
    userId: userId || null,
    incidentId: incident.incidentId,
    code: `SLT-SORRY-${crypto.randomBytes(4).toString("hex").toUpperCase()}`,
    discountPercent: 5,
    status: "ACTIVE",
    stripeCouponId: null,
    promotionCodeId: null,
    createdAt: new Date().toISOString(),
    expiresAt: compensationExpiry(),
    redeemedAt: null,
    metadata: { oneUse: true, transferable: false, source: "automatic_incident_compensation" }
  };
  state.compensationCoupons.unshift(coupon);
  state.compensationCoupons = state.compensationCoupons.slice(0, 10_000);
  if (hasEnvValue("STRIPE_SECRET_KEY") && process.env.SLT_TEST_MODE !== "1" && envFlag("STRIPE_COMPENSATION_ENABLED", true)) {
    void syncCompensationCouponWithStripe(coupon);
  }
  return coupon;
}

async function syncCompensationCouponWithStripe(coupon) {
  if (!coupon || coupon.promotionCodeId || coupon.status !== "ACTIVE") return coupon;
  try {
    const stripeCoupon = await stripeRequest("/v1/coupons", {
      percent_off: coupon.discountPercent,
      duration: "once",
      name: `SLT incident ${coupon.incidentId}`,
      metadata: { incidentId: coupon.incidentId, tenantId: coupon.tenantId, userId: coupon.userId || "" }
    });
    const customer = currentStripeCustomerId();
    const promotion = await stripeRequest("/v1/promotion_codes", {
      coupon: stripeCoupon.id,
      code: coupon.code,
      max_redemptions: 1,
      expires_at: Math.floor(new Date(coupon.expiresAt).getTime() / 1000),
      customer: customer || undefined,
      metadata: { incidentId: coupon.incidentId, tenantId: coupon.tenantId, userId: coupon.userId || "" }
    });
    coupon.stripeCouponId = stripeCoupon.id;
    coupon.promotionCodeId = promotion.id;
    coupon.metadata = { ...coupon.metadata, stripeSyncedAt: new Date().toISOString() };
  } catch (error) {
    coupon.metadata = {
      ...coupon.metadata,
      stripeSyncError: sanitizeDiagnosticText(error.message),
      stripeSyncFailedAt: new Date().toISOString()
    };
  }
  await persistRuntimeState(`compensation_coupon_stripe_sync:${coupon.incidentId}`);
  return coupon;
}

function createSltIncident({ request = null, auth = {}, job = null, error = {}, classification, ledgerResolution = null, context = {} } = {}) {
  const resolvedAuth = auth?.ok ? auth : request ? getAuth(request) : auth;
  const tenantId = context.tenantId || job?.tenantId || resolvedAuth?.tenantId || resolvedAuth?.userId || state.wallet.tenantId;
  const walletAfter = ledgerResolution?.wallet || ledgerSnapshot(tenantId);
  const reservedCredits = Number(context.creditsReserved ?? job?.creditCost ?? 0);
  const creditsAfter = Number(context.creditsAfter ?? walletAfter?.availableCredits ?? 0);
  const creditsBefore = Number(context.creditsBefore ?? job?.checks?.credits?.available ?? (creditsAfter + (ledgerResolution?.reservation?.status === "released" ? 0 : reservedCredits)));
  const route = sanitizeDiagnosticText(context.route || request?.originalUrl || request?.path || "", { maxLength: 300 });
  const provider = context.provider || job?.provider || null;
  const existing = incidentDedupeCandidate({ tenantId, jobId: job?.id || context.jobId || null, errorCode: classification.code, provider, route });
  if (existing) return existing;
  const incidentId = createIncidentId();
  const clientMessage = sanitizeDiagnosticText(context.customerMessage || classification.customerMessage, { maxLength: 500 });
  const incident = {
    id: incidentId,
    incidentId,
    errorCode: classification.code,
    errorName: classification.name,
    category: classification.category,
    tenantId,
    userId: context.userId || job?.userId || resolvedAuth?.userId || null,
    projectId: context.projectId || job?.projectId || null,
    sessionId: context.sessionId || job?.sessionId || null,
    batchId: context.batchId || job?.batchId || null,
    jobId: context.jobId || job?.id || null,
    reservationId: context.reservationId || job?.reservationId || ledgerResolution?.reservation?.id || null,
    assetId: context.assetId || job?.assetId || null,
    modality: context.modality || job?.modality || String(job?.kind || context.kind || "").toUpperCase() || null,
    provider,
    model: context.model || job?.parameters?.model || job?.payload?.model || null,
    operation: context.operation || job?.operation || generationAction(job?.parameters || {}),
    httpStatus: Number(error.statusCode || context.httpStatus || incidentHttpStatus(classification)),
    sanitizedProviderError: sanitizeDiagnosticText(error.providerBody?.error?.message || error.providerBody?.message || error.message || ""),
    clientVisibleMessage: clientMessage,
    technicalMessage: sanitizeDiagnosticText(`${classification.technicalMessage}${error.message ? ` Provider detail: ${error.message}` : ""}`),
    browser: sanitizeDiagnosticText(request?.header?.("user-agent") || context.browser || "", { maxLength: 500 }),
    route,
    retryable: Boolean(classification.retryable),
    creditsBefore,
    creditsReserved: reservedCredits,
    creditsAfter,
    reservationReleased: Boolean(context.reservationReleased ?? ledgerResolution?.reservation?.status === "released"),
    compensationEligible: compensationAllowed(classification, context),
    reported: false,
    reportedAt: null,
    status: "OPEN",
    metadata: {
      originalErrorCode: sanitizeDiagnosticText(error.code || "", { maxLength: 120 }),
      providerRoute: Array.isArray(context.providerRoute || error.route)
        ? (context.providerRoute || error.route).map((item) => ({ provider: item.provider || null, status: item.status || null, code: item.code || null, ok: Boolean(item.ok) })).slice(0, 10)
        : [],
      retryOfJobId: job?.retryOfJobId || null,
      source: context.source || "generation"
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    resolvedAt: null
  };
  state.errorIncidents.unshift(incident);
  state.errorIncidents = state.errorIncidents.slice(0, 10_000);
  return incident;
}

function incidentForClient(incident) {
  if (!incident) return null;
  return {
    incidentId: incident.incidentId,
    errorCode: incident.errorCode,
    errorName: incident.errorName,
    category: incident.category,
    jobId: incident.jobId || null,
    batchId: incident.batchId || null,
    projectId: incident.projectId || null,
    sessionId: incident.sessionId || null,
    provider: incident.provider || null,
    model: incident.model || null,
    customerMessage: incident.clientVisibleMessage,
    retryable: Boolean(incident.retryable),
    reservationReleased: Boolean(incident.reservationReleased),
    reported: Boolean(incident.reported),
    status: incident.status,
    createdAt: incident.createdAt
  };
}

async function recordSltFailure({ request = null, auth = {}, job = null, error = {}, ledgerResolution = null, context = {} } = {}) {
  const classification = classifySltError(error, {
    provider: context.provider || job?.provider,
    operation: context.operation || job?.operation,
    httpStatus: context.httpStatus || error.statusCode,
    jobId: context.jobId || job?.id,
    system: context.system
  });
  const incident = createSltIncident({ request, auth, job, error, classification, ledgerResolution, context });
  const provider = context.provider || job?.provider || null;
  if (provider && ["PROVIDER_NO_CREDITS", "PROVIDER_BILLING_REQUIRED", "PROVIDER_AUTH_FAILED"].includes(classification.name)) {
    setProviderDiagnostic(providerDiagnosticKey(normalizeProviderName(provider), providerCatalog[normalizeProviderName(provider)] || {}), {
      status: classification.name,
      errorName: classification.name,
      errorCode: classification.code,
      customerMessage: classification.name === "PROVIDER_NO_CREDITS"
        ? "Temporarily unavailable — provider balance required."
        : classification.name === "PROVIDER_BILLING_REQUIRED"
        ? "Temporarily unavailable — provider billing required."
        : classification.customerMessage,
      metadata: { source: "classified_provider_failure", incidentId: incident.incidentId }
    });
  }
  const coupon = incident.compensationEligible
    ? createCompensationCoupon({ incident, userId: incident.userId, tenantId: incident.tenantId })
    : null;
  await persistRuntimeState(`error_incident:${incident.incidentId}`);
  return {
    classification,
    incident,
    coupon,
    publicError: publicErrorPayload({ classification, incident, coupon, credits: {
      before: incident.creditsBefore,
      reserved: incident.creditsReserved,
      after: incident.creditsAfter
    } })
  };
}

function sltErrorResponsePayload(failure, extras = {}) {
  const message = failure.incident?.clientVisibleMessage || failure.classification.customerMessage;
  return {
    ok: false,
    code: failure.classification.name,
    errorCode: failure.classification.code,
    incidentId: failure.incident?.incidentId || null,
    error: message,
    readableError: message,
    customerMessage: message,
    retryable: Boolean(failure.classification.retryable),
    reservationReleased: Boolean(failure.incident?.reservationReleased),
    creditsReturned: Boolean(failure.incident?.reservationReleased),
    incident: incidentForClient(failure.incident),
    compensation: failure.publicError.compensation,
    ...extras
  };
}

function creditAccount(name) {
  return `Tenant.${name}`;
}

function walletForTenant(tenantId = state.wallet.tenantId, { create = true, initialCredits = 0 } = {}) {
  const normalizedTenantId = String(tenantId || state.wallet.tenantId || "demo-user");
  let wallet = state.wallets.find((item) => item.tenantId === normalizedTenantId) || null;
  if (!wallet && state.wallet?.tenantId === normalizedTenantId) {
    wallet = state.wallet;
    state.wallets.push(wallet);
  }
  if (!wallet && create) {
    wallet = {
      tenantId: normalizedTenantId,
      availableCredits: Math.max(0, Number(initialCredits) || 0),
      heldCredits: 0,
      capturedCredits: 0
    };
    state.wallets.push(wallet);
  }
  return wallet;
}

function ledgerSnapshot(tenantId = state.wallet.tenantId) {
  const wallet = walletForTenant(tenantId, { create: true });
  return {
    tenantId: wallet.tenantId,
    availableCredits: wallet.availableCredits,
    heldCredits: wallet.heldCredits,
    capturedCredits: wallet.capturedCredits,
    transactionCount: state.creditTransactions.filter((item) => item.tenantId === wallet.tenantId).length,
    reservationCount: state.creditReservations.filter((item) => item.tenantId === wallet.tenantId).length
  };
}

function syncCreditViews(tenantId = state.wallet.tenantId) {
  const wallet = walletForTenant(tenantId, { create: true });
  if (state.wallet.tenantId === wallet.tenantId) {
    state.wallet = wallet;
    state.subscription.credits = wallet.availableCredits;
    state.subscription.heldCredits = wallet.heldCredits;
    state.subscription.capturedCredits = wallet.capturedCredits;
    state.user.credits = wallet.availableCredits;
  }
  return ledgerSnapshot(wallet.tenantId);
}

function findCreditTransactionByIdempotency(idempotencyKey = "") {
  return state.creditTransactions.find((transaction) => transaction.idempotencyKey === idempotencyKey) || null;
}

function appendCreditTransaction({
  type,
  amount,
  debitAccount,
  creditAccount: creditedAccount,
  idempotencyKey,
  reservationId = null,
  jobId = null,
  tenantId = state.wallet.tenantId,
  status = "posted",
  metadata = {},
  availableDelta = 0,
  heldDelta = 0,
  capturedDelta = 0
}) {
  const existing = findCreditTransactionByIdempotency(idempotencyKey);
  if (existing) return { transaction: existing, idempotent: true, wallet: ledgerSnapshot(existing.tenantId || tenantId) };
  const wallet = walletForTenant(tenantId, { create: true });

  const transaction = {
    id: requestId("credit_tx"),
    idempotencyKey,
    idempotency_key: idempotencyKey,
    type,
    status,
    amount,
    reservationId,
    jobId,
    tenantId,
    entries: [
      { account: debitAccount, direction: "debit", amount },
      { account: creditedAccount, direction: "credit", amount }
    ],
    balanceDeltas: {
      availableCredits: availableDelta,
      heldCredits: heldDelta,
      capturedCredits: capturedDelta
    },
    metadata,
    createdAt: new Date().toISOString()
  };

  wallet.availableCredits += availableDelta;
  wallet.heldCredits += heldDelta;
  wallet.capturedCredits += capturedDelta;
  if (wallet.availableCredits < 0 || wallet.heldCredits < 0) {
    wallet.availableCredits -= availableDelta;
    wallet.heldCredits -= heldDelta;
    wallet.capturedCredits -= capturedDelta;
    const error = new Error("Credit ledger would produce a negative balance.");
    error.code = "negative_ledger_balance";
    error.statusCode = 409;
    throw error;
  }

  state.creditTransactions.unshift(transaction);
  state.creditTransactions = state.creditTransactions.slice(0, 500);
  syncCreditViews(tenantId);
  return { transaction, idempotent: false, wallet: ledgerSnapshot(tenantId) };
}

function grantCredits({ amount, idempotencyKey, reason = "credit_grant", metadata = {}, tenantId = state.wallet.tenantId }) {
  if (!amount) return { transaction: null, wallet: ledgerSnapshot(tenantId), skipped: true };
  return appendCreditTransaction({
    type: reason,
    amount: Math.abs(amount),
    debitAccount: "SLT.CreditIssuer",
    creditAccount: creditAccount("Available"),
    idempotencyKey,
    tenantId,
    status: "posted",
    metadata,
    availableDelta: Math.abs(amount)
  });
}

function adjustAvailableCredits({ targetAmount, idempotencyKey, reason = "plan_credit_adjustment", metadata = {}, tenantId = state.wallet.tenantId }) {
  const target = Math.max(0, Number(targetAmount) || 0);
  const wallet = walletForTenant(tenantId, { create: true });
  const delta = target - wallet.availableCredits;
  if (delta === 0) return { transaction: null, wallet: ledgerSnapshot(tenantId), skipped: true };
  if (delta > 0) {
    return grantCredits({ amount: delta, idempotencyKey, reason, metadata, tenantId });
  }
  return appendCreditTransaction({
    type: reason,
    amount: Math.abs(delta),
    debitAccount: creditAccount("Available"),
    creditAccount: "SLT.CreditExpiry",
    idempotencyKey,
    tenantId,
    status: "posted",
    metadata,
    availableDelta: delta
  });
}

function findCreditReservation(reservationId = "") {
  return state.creditReservations.find((reservation) => reservation.id === reservationId) || null;
}

function reserveCredits({ amount, kind, auth, request, idempotencyKey, metadata = {}, initialCredits = 0 }) {
  const cost = Math.max(0, Number(amount) || 0);
  const tenantId = requestIdentity(request, auth);
  const wallet = walletForTenant(tenantId, { create: true, initialCredits });
  if (!cost) {
    return {
      reservation: null,
      transaction: null,
      wallet: ledgerSnapshot(tenantId),
      skipped: true,
      message: "No reservation needed for zero-credit operation."
    };
  }

  const existingTransaction = findCreditTransactionByIdempotency(idempotencyKey);
  if (existingTransaction?.reservationId) {
    return {
      reservation: findCreditReservation(existingTransaction.reservationId),
      transaction: existingTransaction,
      wallet: ledgerSnapshot(tenantId),
      idempotent: true
    };
  }

  if (wallet.availableCredits < cost) {
    const error = new Error("Insufficient Credits");
    error.code = "insufficient_credits";
    error.statusCode = 402;
    error.readableError = "You do not have enough credits for this action.";
    throw error;
  }

  const reservation = {
    id: requestId("reservation"),
    tenantId,
    kind,
    amount: cost,
    status: "reserved",
    idempotencyKey,
    idempotency_key: idempotencyKey,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    capturedAt: null,
    releasedAt: null,
    jobId: metadata.jobId || null,
    metadata
  };
  state.creditReservations.unshift(reservation);
  state.creditReservations = state.creditReservations.slice(0, 300);

  const result = appendCreditTransaction({
    type: "reserve",
    amount: cost,
    debitAccount: creditAccount("Available"),
    creditAccount: creditAccount("HeldByReservation"),
    idempotencyKey,
    reservationId: reservation.id,
    jobId: metadata.jobId || null,
    tenantId,
    status: "reserved",
    metadata,
    availableDelta: -cost,
    heldDelta: cost
  });
  return { reservation, transaction: result.transaction, wallet: result.wallet, idempotent: result.idempotent };
}

function resolveReservation({ reservationId, outcome, jobId = null, idempotencyKey, reason = "" }) {
  const reservation = findCreditReservation(reservationId);
  if (!reservation) {
    return { reservation: null, transaction: null, wallet: null, skipped: true, reason: "reservation_not_found" };
  }
  if (["captured", "released"].includes(reservation.status)) {
    return { reservation, transaction: findCreditTransactionByIdempotency(idempotencyKey), wallet: ledgerSnapshot(reservation.tenantId), idempotent: true };
  }

  const capture = outcome === "capture";
  const transaction = appendCreditTransaction({
    type: capture ? "capture" : "release",
    amount: reservation.amount,
    debitAccount: creditAccount("HeldByReservation"),
    creditAccount: capture ? "SLT.CapturedRevenue" : creditAccount("Available"),
    idempotencyKey,
    reservationId,
    jobId: jobId || reservation.jobId,
    tenantId: reservation.tenantId,
    status: capture ? "captured" : "released",
    metadata: { reason, originalReservationKey: reservation.idempotencyKey },
    availableDelta: capture ? 0 : reservation.amount,
    heldDelta: -reservation.amount,
    capturedDelta: capture ? reservation.amount : 0
  });

  reservation.status = capture ? "captured" : "released";
  reservation.updatedAt = new Date().toISOString();
  reservation.jobId = jobId || reservation.jobId;
  if (capture) reservation.capturedAt = reservation.updatedAt;
  else reservation.releasedAt = reservation.updatedAt;
  return { reservation, transaction: transaction.transaction, wallet: transaction.wallet, idempotent: transaction.idempotent };
}

function initialCreditsForAuth(auth = {}) {
  if (isOwnerAuth(auth)) return envNumber("CEO_INTERNAL_CREDITS", 1_000_000);
  if (isGuestAuth(auth)) return envNumber("GUEST_INTERNAL_CREDITS", 10_000);
  if (auth.userId === state.wallet.tenantId || auth.tenantId === state.wallet.tenantId) {
    return state.wallet.availableCredits;
  }
  return envNumber("NEW_TENANT_STARTING_CREDITS", 0);
}

function mirrorLedgerResult(result = {}) {
  const reservation = result.reservation;
  const transaction = result.transaction;
  const wallet = result.wallet;
  if (reservation?.id) {
    const index = state.creditReservations.findIndex((item) => item.id === reservation.id);
    if (index === -1) state.creditReservations.unshift(reservation);
    else state.creditReservations[index] = { ...state.creditReservations[index], ...reservation };
  }
  if (transaction?.id) {
    const index = state.creditTransactions.findIndex((item) => item.id === transaction.id || item.idempotencyKey === transaction.idempotencyKey);
    if (index === -1) state.creditTransactions.unshift(transaction);
    else state.creditTransactions[index] = { ...state.creditTransactions[index], ...transaction };
  }
  if (wallet?.tenantId) {
    const target = walletForTenant(wallet.tenantId, { create: true });
    Object.assign(target, wallet);
    syncCreditViews(wallet.tenantId);
  }
  return result;
}

async function reserveCreditsTransactional(args) {
  const auth = args.auth || getAuth(args.request);
  const tenantId = requestIdentity(args.request, auth);
  const reservationId = args.reservationId || requestId("reservation");
  const initialCredits = initialCreditsForAuth(auth);
  if (runtimeStore.durable && typeof runtimeStore.reserveCredits === "function") {
    const result = await runtimeStore.reserveCredits({
      reservationId,
      tenantId,
      userId: auth.userId || null,
      amount: args.amount,
      kind: args.kind,
      idempotencyKey: args.idempotencyKey,
      jobId: args.metadata?.jobId || null,
      metadata: args.metadata || {},
      initialCredits
    });
    return mirrorLedgerResult(result);
  }
  return reserveCredits({ ...args, initialCredits });
}

async function resolveReservationTransactional(args) {
  if (runtimeStore.durable && typeof runtimeStore.resolveReservation === "function") {
    const result = await runtimeStore.resolveReservation(args);
    return mirrorLedgerResult(result);
  }
  return resolveReservation(args);
}

async function grantCreditsTransactional({ tenantId, userId = null, amount, idempotencyKey, reason = "credit_grant", metadata = {}, initialCredits = 0 } = {}) {
  if (runtimeStore.durable && typeof runtimeStore.grantCredits === "function") {
    const result = await runtimeStore.grantCredits({
      tenantId,
      userId,
      amount,
      idempotencyKey,
      type: reason,
      metadata,
      initialCredits
    });
    return mirrorLedgerResult(result);
  }
  return grantCredits({ amount, idempotencyKey, reason, metadata, tenantId });
}

async function adjustAvailableCreditsTransactional({ tenantId, userId = null, targetAmount, idempotencyKey, reason = "plan_credit_adjustment", metadata = {}, initialCredits = 0 } = {}) {
  if (runtimeStore.durable && typeof runtimeStore.adjustAvailableCredits === "function") {
    const result = await runtimeStore.adjustAvailableCredits({
      tenantId,
      userId,
      targetAmount,
      idempotencyKey,
      type: reason,
      metadata,
      initialCredits
    });
    return mirrorLedgerResult(result);
  }
  return adjustAvailableCredits({ targetAmount, idempotencyKey, reason, metadata, tenantId });
}

function generationIdempotencyKey(request, kind, phase) {
  const auth = getAuth(request);
  const clientKey =
    request.header("Idempotency-Key") ||
    request.body?.idempotencyKey ||
    request.body?.clientRequestId ||
    request.body?.request_id ||
    request.body?.requestId ||
    requestId(`${kind}_request`);
  return `${phase}:${requestIdentity(request, auth)}:${kind}:${clientKey}`;
}

const moderationLocalRules = [
  {
    category: "self_harm",
    reason: "Self-harm intent or instructions are not allowed.",
    patterns: [
      /\b(kill myself|suicide|end my life|hurt myself|self[-\s]?harm)\b/i,
      /\b(matarme|suicidarme|quitarme la vida|hacerme dano|hacerme daño|autolesion)\b/i
    ]
  },
  {
    category: "violence",
    reason: "Violent harm instructions or threats are not allowed.",
    patterns: [
      /\b(how to|instructions? to|teach me to|help me)\s+(kill|murder|stab|shoot|poison|bomb)\b/i,
      /\b(kill|murder|stab|shoot|poison)\s+(him|her|them|someone|people|a person|myself|yourself)\b/i,
      /\b(bomb making|make a bomb|build a bomb|explosive device)\b/i,
      /\b(como|cómo|ensen[aá]me|ayudame a|ayúdame a)\s+(matar|asesinar|apu[ñn]alar|disparar|envenenar)\b/i,
      /\b(matar|asesinar|apu[ñn]alar|disparar|envenenar)\s+(a|me|te|lo|la|los|las|alguien|personas)\b/i
    ]
  },
  {
    category: "hate",
    reason: "Hate, dehumanization or violent targeting of protected groups is not allowed.",
    patterns: [
      /\b(exterminate|eliminate|kill|wipe out)\s+(all\s+)?(jews|muslims|christians|immigrants|gay people|trans people|black people|latinos|women|disabled people)\b/i,
      /\b(genocide|ethnic cleansing)\b/i,
      /\b(exterminar|eliminar|matar)\s+(a\s+)?(judios|judíos|musulmanes|cristianos|inmigrantes|gays|personas trans|negros|latinos|mujeres|discapacitados)\b/i
    ]
  },
  {
    category: "prompt_injection",
    reason: "Prompt injection attempts that target system secrets or hidden instructions are blocked.",
    patterns: [
      /\b(ignore|disregard|override)\s+(all\s+)?(previous|prior|system|developer)\s+(instructions?|messages?|rules?)\b/i,
      /\b(reveal|show|print|dump|exfiltrate)\s+(the\s+)?(system prompt|developer message|api key|secret|environment variables?|\.env)\b/i,
      /\b(jailbreak|dan mode|developer mode|bypass safety|bypass policy)\b/i,
      /\b(ignora|olvida|anula)\s+(las\s+)?(instrucciones|reglas|mensajes)\s+(anteriores|del sistema|del desarrollador)\b/i,
      /\b(muestra|revela|imprime|filtra)\s+(el\s+)?(system prompt|mensaje del sistema|api key|clave secreta|\.env|variables de entorno)\b/i
    ]
  }
];

function moderationTextFromRequest({ kind, title, prompt, payload = {} }) {
  const fields = [
    kind,
    title,
    prompt,
    payload.description,
    payload.negativePrompt,
    payload.negative_prompt,
    payload.lyrics,
    payload.script,
    payload.scene,
    payload.style,
    payload.tool,
    payload.actionId
  ];
  return fields
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, envNumber("MODERATION_MAX_INPUT_CHARS", 6000));
}

function localModerateText(text = "") {
  const categories = {};
  const reasons = [];
  for (const rule of moderationLocalRules) {
    const matched = rule.patterns.some((pattern) => pattern.test(text));
    if (matched) {
      categories[rule.category] = true;
      reasons.push(rule.reason);
    }
  }
  return {
    ok: reasons.length === 0,
    provider: "local-policy",
    flagged: reasons.length > 0,
    categories,
    categoryScores: Object.fromEntries(Object.keys(categories).map((category) => [category, 1])),
    reasons,
    latencyMs: 0
  };
}

async function openAIModerateText(text = "") {
  const startedAt = Date.now();
  const data = await postJson("https://api.openai.com/v1/moderations", {
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: {
      model: process.env.OPENAI_MODERATION_MODEL || "omni-moderation-latest",
      input: text
    },
    timeoutMs: envNumber("OPENAI_MODERATION_TIMEOUT_MS", 2500)
  });
  const result = data.results?.[0] || {};
  return {
    ok: !result.flagged,
    provider: "openai-moderation",
    flagged: Boolean(result.flagged),
    categories: result.categories || {},
    categoryScores: result.category_scores || {},
    reasons: Object.entries(result.categories || {})
      .filter((entry) => entry[1])
      .map(([category]) => `OpenAI moderation flagged ${category}.`),
    raw: data,
    latencyMs: Date.now() - startedAt
  };
}

async function runInputModeration({ kind, title, prompt, payload = {} }) {
  if (envFlag("MODERATION_DISABLED", false)) {
    return { ok: true, provider: "disabled", flagged: false, categories: {}, reasons: [], skipped: true };
  }
  const text = moderationTextFromRequest({ kind, title, prompt, payload });
  const localStartedAt = Date.now();
  const local = localModerateText(text);
  local.latencyMs = Date.now() - localStartedAt;
  if (!local.ok) return local;

  const shouldUseOpenAI = hasEnvValue("OPENAI_API_KEY") && (
    envFlag("OPENAI_MODERATION_ENABLED", false) ||
    String(process.env.MODERATION_PROVIDER || "").toLowerCase() === "openai"
  );
  if (!shouldUseOpenAI) {
    return {
      ...local,
      provider: "local-policy",
      simulated: true,
      message: "OpenAI moderation not enabled; local policy gate passed."
    };
  }

  try {
    return await openAIModerateText(text);
  } catch (error) {
    if (envFlag("MODERATION_FAIL_CLOSED", false)) {
      return {
        ok: false,
        provider: "openai-moderation",
        flagged: true,
        categories: { moderation_unavailable: true },
        reasons: ["Moderation service unavailable and fail-closed is enabled."],
        error: error.message || "Moderation service unavailable."
      };
    }
    return {
      ...local,
      provider: "local-policy-fallback",
      warning: error.message || "OpenAI moderation unavailable; local policy gate passed."
    };
  }
}

function moderationFailurePayload({ moderation, kind, title }) {
  return {
    ok: false,
    code: "moderation_rejected",
    error: "Prompt rejected by content policy.",
    readableError: "Prompt rejected by content policy.",
    kind,
    title,
    moderation: {
      provider: moderation.provider,
      flagged: moderation.flagged,
      categories: moderation.categories,
      categoryScores: moderation.categoryScores,
      reasons: moderation.reasons,
      latencyMs: moderation.latencyMs || 0
    }
  };
}

function outputModerationAssessment({ job, result = {}, outputUrls = [] }) {
  const text = moderationTextFromRequest({
    kind: job?.kind || "output",
    title: job?.title || "",
    prompt: [
      result.responseText,
      result.note,
      result.raw?.error,
      result.raw?.message,
      Array.isArray(outputUrls) ? outputUrls.join("\n") : ""
    ].filter(Boolean).join("\n"),
    payload: {}
  });
  const local = localModerateText(text);
  const reviewAll = envFlag("OUTPUT_MODERATION_REVIEW_ALL", false);
  const externalAsset = outputUrls.some((url) => /^https?:\/\//i.test(url));
  return {
    gate: "output",
    provider: "local-policy",
    needs_review: reviewAll || !local.ok,
    needsReview: reviewAll || !local.ok,
    categories: local.categories,
    reasons: local.reasons,
    assetCount: outputUrls.length,
    externalAsset
  };
}

function getAuth(request) {
  const session = strictAuthForRequest(request);
  if (session) return session;
  return {
    ok: false,
    mode: "unauthenticated",
    userId: null,
    role: "anonymous",
    email: "",
    username: "",
    message: "No valid server-side session."
  };
}

function isOwnerAuth(auth = {}) {
  const ownerUserId = process.env.LOCAL_OWNER_USER_ID || "";
  const ownerEmail = process.env.CEO_EMAIL || "";
  return auth.role === "CEO" || (ownerUserId && auth.userId === ownerUserId) || (ownerEmail && auth.email === ownerEmail);
}

function isGuestAuth(auth = {}) {
  return auth.role === "GUEST" || auth.mode === "INVITED_GUEST";
}

function recordTenantId(record = {}) {
  return record.tenantId || record.userId || record.metadata?.userId || record.metadata?.tenantId || record.checks?.auth?.userId || "";
}

function canAccessRecord(record = {}, auth = {}) {
  if (isOwnerAuth(auth)) return true;
  const tenantId = recordTenantId(record);
  const authTenants = [auth.tenantId, auth.userId].filter(Boolean);
  if (!tenantId) return isOwnerAuth(auth);
  return authTenants.includes(tenantId);
}

function filterRecordsForAuth(records = [], auth = {}) {
  return records.filter((record) => canAccessRecord(record, auth));
}

function assertTenantAccess(record = {}, auth = {}) {
  if (canAccessRecord(record, auth)) return true;
  const error = new Error("Forbidden.");
  error.code = "forbidden";
  error.statusCode = 403;
  throw error;
}

function normalizeProviderName(name = "") {
  const direct = providerCatalog[name];
  if (direct) return name;
  const lower = name.toLowerCase();
  if (lower.includes("openai images") || lower.includes("gpt image") || lower.includes("gpt 5") || lower.includes("gpt-5")) return "OpenAI Images";
  if (lower.includes("grok image") || lower.includes("xai image")) return "Grok Image";
  if (lower.includes("gemini image") || lower.includes("nano banana") || lower.includes("imagen")) return "Gemini Image";
  if (lower.includes("openai audio")) return "OpenAI Audio";
  if (lower === "pixverse") return "PixVerse";
  if (lower.includes("minimax") && (lower.includes("music") || lower.includes("song"))) return "MiniMax Music";
  if (lower.includes("minimax") && (lower.includes("speech") || lower.includes("voice") || lower.includes("tts"))) return "MiniMax Speech";
  if (lower === "hailuo" || lower.includes("minimax") || lower.includes("hailuo")) return "Hailuo";
  if (lower === "hunyuan") return "Hunyuan";
  if (lower.includes("flow") || lower.includes("veo")) return "Veo";
  if (lower === "seedance" || lower.startsWith("seedance ")) return "Seedance";
  if (
    lower.includes("omnihuman") ||
    lower.includes("omni human") ||
    lower.includes("dreamina omnihuman") ||
    lower.includes("dreamactor") ||
    lower.includes("flash avatar") ||
    lower.includes("clone avatar")
  ) return "OmniHuman";
  if (lower === "wan" || lower.startsWith("wan ")) return "Wan";
  if (lower.includes("gpt")) return "OpenAI";
  if (lower.includes("meta") || lower.includes("llama")) return "Meta Llama";
  if (lower.includes("hermes")) return "Hermes local";
  if (lower.includes("local model") || lower.includes("ollama")) return "Local model";
  if (lower.includes("claude")) return "Claude";
  if (lower.includes("gemini")) return "Gemini";
  return name;
}

function providerDiagnosticKey(normalized = "", config = {}) {
  if (normalized === "Runway") return "Runway";
  if (normalized === "Replicate" || String(config.adapter || "").startsWith("replicate-")) return "Replicate";
  return normalized;
}

function providerDiagnosticFor(normalized = "", config = {}) {
  const key = providerDiagnosticKey(normalized, config);
  const forcedAvailable = key === "Runway"
    ? envFlag("RUNWAY_PROVIDER_AVAILABLE", false) || envFlag("RUNWAY_PROVIDER_BALANCE_OK", false)
    : key === "Replicate"
    ? envFlag("REPLICATE_PROVIDER_AVAILABLE", false) || envFlag("REPLICATE_BILLING_ACTIVE", false)
    : false;
  if (forcedAvailable) {
    return {
      provider: key,
      status: "AVAILABLE",
      errorName: null,
      errorCode: null,
      customerMessage: "Provider available.",
      checkedAt: new Date().toISOString(),
      metadata: { source: "environment_override" }
    };
  }
  const current = state.providerDiagnostics.find((item) => item.provider === key) || null;
  if (!current || ["AVAILABLE", "HEALTHY", "CONNECTED"].includes(current.status)) return current;
  return current;
}

function setProviderDiagnostic(provider, patch = {}) {
  const normalized = provider === "Replicate" ? "Replicate" : normalizeProviderName(provider);
  const index = state.providerDiagnostics.findIndex((item) => item.provider === normalized);
  const diagnostic = {
    provider: normalized,
    status: "UNKNOWN",
    errorName: null,
    errorCode: null,
    customerMessage: "Provider status has not been verified.",
    ...(index >= 0 ? state.providerDiagnostics[index] : {}),
    ...patch,
    checkedAt: patch.checkedAt || new Date().toISOString(),
    metadata: {
      ...(index >= 0 ? state.providerDiagnostics[index]?.metadata : {}),
      ...(patch.metadata || {})
    }
  };
  if (index >= 0) state.providerDiagnostics[index] = diagnostic;
  else state.providerDiagnostics.push(diagnostic);
  return diagnostic;
}

function providerStatus(name) {
  const normalized = normalizeProviderName(name);
  const config = providerCatalog[normalized];
  if (!config) {
    return {
      name,
      normalizedName: normalized,
      kind: "unknown",
      connected: false,
      keyPresent: false,
      adapter: "unknown",
      message: providerFallbackMessage
    };
  }
  const keyPresent = config.localProvider
    ? true
    : config.envKey || config.alternateEnvKeys?.length
    ? Boolean(providerApiKey(config))
    : config.adapter === "local-placeholder";
  const endpointPresent = config.endpointEnv || config.alternateEndpointEnvKeys?.length
    ? Boolean(providerEndpoint(config))
    : true;
  const missingConfigKeys = (config.configEnvKeys || []).filter((key) => !hasEnvValue(key));
  let status = "missing_key";
  let message = providerFallbackMessage;
  let connected = false;

  if (config.disabledByPreference) {
    status = "disabled";
    message = disabledPreferenceMessage;
  } else if (config.preparedOnly) {
    status = "prepared";
    message = preparedProviderMessage;
  } else if (config.disabledPlaceholder) {
    status = "future";
    message = preparedProviderMessage;
  } else if (config.internalOnly) {
    status = "internal";
    message = internalOnlyMessage;
  } else if (keyPresent && (!endpointPresent || missingConfigKeys.length)) {
    status = "missing_config";
    message = missingConfigMessage;
  } else if (keyPresent && config.needsConfirmation) {
    status = "needs_config";
    message = directEndpointMessage;
  } else if (keyPresent && endpointPresent) {
    status = "connected";
    message = "Provider connected.";
    connected = true;
  }

  const selectedModel = providerModelConfig(config);
  const pricing = providerPricingFor(config);
  const diagnostic = providerDiagnosticFor(normalized, config);
  if (diagnostic && !["AVAILABLE", "HEALTHY", "CONNECTED"].includes(diagnostic.status)) {
    status = diagnostic.status;
    message = diagnostic.customerMessage || message;
    connected = false;
  }

  return {
    name: normalized,
    kind: config.kind,
    envKey: config.envKey || "local",
    alternateEnvKeys: config.alternateEnvKeys || [],
    endpointEnv: config.endpointEnv || null,
    alternateEndpointEnvKeys: config.alternateEndpointEnvKeys || [],
    missingConfigKeys,
    keyPresent,
    endpointPresent,
    connected,
    status,
    adapter: config.adapter,
    disabledPlaceholder: Boolean(config.disabledPlaceholder),
    disabledByPreference: Boolean(config.disabledByPreference),
    internalOnly: Boolean(config.internalOnly),
    localProvider: Boolean(config.localProvider),
    needsConfirmation: Boolean(config.needsConfirmation),
    preparedOnly: Boolean(config.preparedOnly),
    execution: config.execution || (config.kind === "video" || config.kind === "music" || config.kind === "3d" ? "async" : "sync"),
    supportsWebhook: Boolean(config.supportsWebhook),
    model: selectedModel ? { id: selectedModel.id, label: selectedModel.label || selectedModel.id } : null,
    models: (config.models || []).map((model) => ({
      id: model.id,
      label: model.label || model.id,
      pricing: model.pricing || null
    })),
    pricing,
    canGenerate: connected,
    message,
    diagnostic: diagnostic ? {
      provider: diagnostic.provider,
      status: diagnostic.status,
      errorName: diagnostic.errorName || null,
      errorCode: diagnostic.errorCode || null,
      checkedAt: diagnostic.checkedAt || null
    } : null,
    errorName: diagnostic?.errorName || null,
    errorCode: diagnostic?.errorCode || null
  };
}

function providerList(kind = "") {
  return Object.keys(providerCatalog)
    .map(providerStatus)
    .filter((provider) => !kind || provider.kind === kind);
}

function uniqueProviders(names = []) {
  const seen = new Set();
  return names
    .map((name) => normalizeProviderName(String(name || "")))
    .filter((name) => {
      if (!name || seen.has(name)) return false;
      seen.add(name);
      return true;
    });
}

const realityTransformActions = new Set([
  "REALITY_TRANSFORM",
  "VIDEO2VIDEO",
  "VIDEO_TO_VIDEO",
  "SCENE_TRANSFER",
  "BACKGROUND_STYLING"
]);

function generationAction(payload = {}) {
  return String(payload.actionId || payload.tool || payload.mode || "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
}

function isRealityTransformPayload(payload = {}) {
  return payload.realityTransform === true || realityTransformActions.has(generationAction(payload));
}

function providerFallbackChain(kind, requestedProvider = "", payload = {}) {
  const configured = isRealityTransformPayload(payload)
    ? ["Runway", "Luma Modify"]
    : providerFallbackChains[kind] || [];
  return uniqueProviders([
    requestedProvider,
    ...configured,
    defaultProvider[kind]
  ]).filter((name) => providerCatalog[name]?.kind === kind && (!isRealityTransformPayload(payload) || ["Runway", "Luma Modify"].includes(name)));
}

function providerFallbacksEnabled(payload = {}) {
  if (payload.allowFallback === false || payload.fallback === false) return false;
  if (String(payload.providerFallback || "").toLowerCase() === "off") return false;
  return envFlag("PROVIDER_FALLBACKS_ENABLED", true);
}

function providerRoutingError(status) {
  const error = new Error(status.message || providerFallbackMessage);
  error.code = status.status || "provider_not_connected";
  error.statusCode = status.connected ? 502 : 400;
  return error;
}

function shouldForceProviderFailure(payload = {}, status, attemptIndex = 0) {
  const forced = payload.forceProviderFailure;
  if (!forced) return false;
  if (forced === true) return attemptIndex === 0;
  const forcedProviders = String(forced)
    .split(",")
    .map((item) => normalizeProviderName(item.trim()))
    .filter(Boolean);
  return forcedProviders.includes(status.name);
}

function simulatedProviderFailure(status) {
  const error = new Error(`${status.name} simulated HTTP 503 for fallback verification.`);
  error.code = "provider_simulated_503";
  error.statusCode = 503;
  return error;
}

function isProviderFallbackError(error) {
  const code = String(error?.code || "");
  if (["insufficient_credits", "plan_limit", "daily_video_limit_reached", "video_duration_limit", "ceo_video_duration_limit"].includes(code)) {
    return false;
  }
  if (["missing_key", "missing_config", "needs_config", "prepared", "disabled", "internal", "provider_not_connected", "provider_simulated_503"].includes(code)) {
    return true;
  }
  const message = String(error?.message || "").toLowerCase();
  return /429|rate|quota|billing|timeout|abort|offline|unavailable|temporar|5\d\d|500|502|503|504/.test(message);
}

function providerConnected(kind) {
  return (providerKeys[kind] || []).some((key) => Boolean(process.env[key]));
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function usageBucketKey({ kind, request, auth }) {
  return `${todayKey()}:${kind}:${requestIdentity(request, auth)}`;
}

function usageCount({ kind, request, auth }) {
  return usageBuckets.get(usageBucketKey({ kind, request, auth })) || 0;
}

function incrementUsage({ kind, request, auth }) {
  const key = usageBucketKey({ kind, request, auth });
  usageBuckets.set(key, (usageBuckets.get(key) || 0) + 1);
}

function validatePlan(kind, request, auth) {
  const plan = state.subscription.plan || "Free";
  const rules = usageRulesForPlan(plan);
  if (isGuestAuth(auth)) {
    return {
      ok: true,
      mode: "guest-limited-pass",
      message: "Guest mode uses category quotas. Generations call provider APIs directly and skip SLT internal billing."
    };
  }
  if (kind === "video" && !isOwnerAuth(auth)) {
    const used = usageCount({ kind, request, auth });
    const dailyLimit = envNumber(`PLAN_${plan.toUpperCase()}_DAILY_VIDEO_LIMIT`, rules.dailyVideoLimit);
    if (used >= dailyLimit) {
      return {
        ok: false,
        code: "daily_video_limit_reached",
        statusCode: 429,
        mode: "limit",
        message: `Daily video limit reached for ${plan}. Buy more credits or upgrade if you need more generations today.`,
        used,
        dailyLimit
      };
    }
  }
  if (plan === "Free" && kind === "video") {
    return {
      ok: true,
      mode: "free-video-limited",
      message: "Free can use bought credits for short video only. Daily and duration limits apply."
    };
  }
  if (plan === "Free" && kind === "music") {
    return {
      ok: true,
      mode: "mock-warning",
      message: "Free can preview music planning. Real music generation needs enough credits or a paid plan."
    };
  }
  return { ok: true, mode: "mock", message: "Plan validation passed." };
}

function validateCredits(kind, auth = {}, payload = {}) {
  const cost = creditCostFor(kind, payload);
  const tenantId = auth.tenantId || auth.userId || state.wallet.tenantId;
  const wallet = ledgerSnapshot(tenantId);
  if (isOwnerAuth(auth) || isGuestAuth(auth)) {
    return {
      ok: true,
      cost: 0,
      originalCost: cost,
      remaining: wallet.availableCredits,
      available: wallet.availableCredits,
      held: wallet.heldCredits,
      wallet,
      mode: isOwnerAuth(auth) ? "ceo-provider-direct" : "guest-provider-direct",
      message: isOwnerAuth(auth)
        ? "CEO mode: SLT internal billing is skipped; provider API credits may be consumed directly."
        : "Guest mode: SLT internal billing is skipped; provider API credits may be consumed directly."
    };
  }
  if (wallet.availableCredits < cost) {
    return {
      ok: false,
      code: "insufficient_credits",
      message: "Insufficient Credits",
      readableError: "You do not have enough credits for this action.",
      available: wallet.availableCredits,
      held: wallet.heldCredits,
      wallet
    };
  }
  return {
    ok: true,
    cost,
    remaining: wallet.availableCredits - cost,
    available: wallet.availableCredits,
    held: wallet.heldCredits,
    wallet
  };
}

const providerMaxClipSeconds = {
  Seedance: 15,
  Veo: 8,
  Runway: 10,
  Luma: 10,
  Kling: 10,
  PixVerse: 8,
  Hailuo: 6,
  Wan: 10,
  HeyGen: 60,
  "D-ID": 60,
  OmniHuman: 60
};

function maxClipSecondsForProvider(providerName = "Seedance") {
  const normalized = normalizeProviderName(providerName);
  return providerMaxClipSeconds[normalized] || 10;
}

function requestedVideoDurationSeconds(payload = {}) {
  const raw = payload.durationSeconds || payload.videoDurationSeconds || payload.duration || payload.videoDuration || "";
  const text = String(raw).trim().toLowerCase();
  if (text.includes("30") && text.includes("min")) return 1800;
  if (text.includes("3") && text.includes("min")) return 180;
  const parsed = Number.parseInt(text.replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10;
}

function resolveVideoPlan({ payload = {}, auth = {}, providerName = "Seedance" }) {
  const requested = requestedVideoDurationSeconds(payload);
  const providerMax = maxClipSecondsForProvider(providerName);
  const ownerAllowed = isOwnerAuth(auth);
  const plan = state.subscription.plan || "Free";
  const rules = usageRulesForPlan(plan);
  const planMaxSeconds = envNumber(`PLAN_${plan.toUpperCase()}_MAX_VIDEO_SECONDS`, rules.maxVideoSeconds);
  const maxAllowedSeconds = ownerAllowed
    ? envNumber("CEO_LONG_VIDEO_MAX_SECONDS", 1800)
    : planMaxSeconds;
  if (requested > maxAllowedSeconds) {
    const error = new Error(ownerAllowed
      ? `CEO video duration is capped at ${maxAllowedSeconds} seconds.`
      : `${plan} video duration is capped at ${maxAllowedSeconds} seconds.`);
    error.code = ownerAllowed ? "ceo_video_duration_limit" : "video_duration_limit";
    error.maxAllowedSeconds = maxAllowedSeconds;
    error.requestedSeconds = requested;
    throw error;
  }
  const ownerClipSeconds = Math.min(envNumber("CEO_LONG_VIDEO_CLIP_SECONDS", 10), providerMax);
  const clipDurationSeconds = requested > providerMax
    ? ownerClipSeconds
    : Math.min(requested, providerMax);
  const sceneCount = Math.max(1, Math.ceil(requested / clipDurationSeconds));
  return {
    requestedDurationSeconds: requested,
    clipDurationSeconds,
    sceneCount,
    providerMaxClipSeconds: providerMax,
    maxAllowedDurationSeconds: maxAllowedSeconds,
    plan,
    ownerAllowed,
    mode: sceneCount > 1 ? "timeline" : "single_clip"
  };
}

function videoClipDuration(payload = {}, providerName = "Seedance", fallback = 5) {
  const plan = payload.videoPlan || resolveVideoPlan({ payload, auth: { userId: process.env.LOCAL_OWNER_USER_ID || "demo-user" }, providerName });
  return plan.clipDurationSeconds || fallback;
}

function videoAspectRatio(payload = {}, fallback = "16:9") {
  return String(payload.aspectRatio || payload.aspect_ratio || payload.ratio || payload.videoRatio || fallback);
}

function baseChecks(request, kind) {
  const requestedProvider = request.body?.provider || defaultProvider[kind] || "Mock Provider";
  const status = providerStatus(requestedProvider);
  const auth = getAuth(request);
  return {
    auth,
    plan: validatePlan(kind, request, auth),
    credits: validateCredits(kind, auth, request.body || {}),
    provider: status
  };
}

function failProviderIfRequested(request, response) {
  if (request.body?.forceProviderFailure && request.body?.allowFallback === false) {
    response.status(503).json({
      ok: false,
      error: "Provider Offline",
      readableError: "This provider is unavailable. Try another provider."
    });
    return true;
  }
  return false;
}

function saveHistory(entry) {
  if (entry && !entry.tenantId) {
    entry.tenantId = entry.checks?.auth?.userId || entry.ledger?.reservation?.tenantId || entry.result?.tenantId || "";
  }
  state.history.unshift(entry);
  state.history = state.history.slice(0, 50);
}

function retainProjectsWithActiveRelations(limit = 2000) {
  const referencedProjectIds = new Set();
  const relationalCollections = [
    state.generationSessions,
    state.generationBatches,
    state.jobs,
    state.assets,
    state.creativeReferences,
    state.scenes,
    state.timelineItems,
    state.workflows,
    state.appInstances
  ];
  for (const collection of relationalCollections) {
    for (const record of Array.isArray(collection) ? collection : []) {
      if (record?.projectId) referencedProjectIds.add(record.projectId);
    }
  }
  const retained = [];
  const retainedIds = new Set();
  for (const project of state.projects) {
    if (retained.length < limit || referencedProjectIds.has(project.id)) {
      if (!retainedIds.has(project.id)) {
        retained.push(project);
        retainedIds.add(project.id);
      }
    }
  }
  state.projects = retained;
}

function saveProjectFromEntry(entry) {
  const project = {
    id: requestId("project"),
    tenantId: entry.tenantId || entry.checks?.auth?.userId || "",
    title: entry.title,
    kind: entry.kind,
    status: entry.status,
    thumbnail: `local-placeholder://${entry.kind}/${entry.id}`,
    createdAt: entry.createdAt,
    updatedAt: entry.createdAt,
    exports: []
  };
  state.projects.unshift(project);
  retainProjectsWithActiveRelations();
  return project;
}

const jobStates = {
  pending: "PENDING",
  queued: "PENDING",
  throttled: "THROTTLED",
  processing: "PROCESSING",
  completed: "COMPLETED",
  failed: "FAILED",
  cancelled: "CANCELLED"
};

function clientJobStatus(stateValue = jobStates.processing) {
  if (stateValue === jobStates.completed) return "completed";
  if (stateValue === jobStates.failed) return "failed";
  if (stateValue === jobStates.cancelled) return "cancelled";
  if (stateValue === jobStates.throttled) return "throttled";
  if ([jobStates.pending, "IN_QUEUE"].includes(stateValue)) return "pending";
  if (stateValue === "IN_PROGRESS") return "processing";
  return "processing";
}

function isAsyncGenerationKind(kind = "") {
  return ["image", "video", "music", "sound"].includes(kind);
}

function shouldQueueGeneration(kind = "", providerStatus = {}, payload = {}) {
  if (payload.sync === true) return false;
  if (["image", "video", "music", "sound"].includes(kind)) return true;
  if (billableOutputCount(payload) > 1) return true;
  if (providerStatus?.execution === "async") return true;
  if (isAsyncGenerationKind(kind)) return true;
  return kind === "image" && providerStatus?.adapter === "replicate-image";
}

function createGenerationProject({ tenantId, userId, title, kind, requestedProjectId = null }) {
  if (requestedProjectId) {
    const existing = state.projects.find((item) => item.id === requestedProjectId && item.tenantId === tenantId);
    if (existing) return existing;
  }
  const now = new Date().toISOString();
  const project = {
    id: requestId("project"),
    tenantId,
    userId: userId || null,
    title,
    kind,
    status: "PROCESSING",
    thumbnail: null,
    createdAt: now,
    updatedAt: now,
    exports: [],
    metadata: { source: "generation" }
  };
  state.projects.unshift(project);
  retainProjectsWithActiveRelations();
  return project;
}

function createGenerationSession({ tenantId, userId, projectId, title, kind, requestedSessionId = null }) {
  if (requestedSessionId) {
    const existing = state.generationSessions.find((item) => item.id === requestedSessionId && item.tenantId === tenantId);
    if (existing) return existing;
  }
  const now = new Date().toISOString();
  const session = {
    id: requestId("generation_session"),
    tenantId,
    userId: userId || null,
    projectId,
    title,
    kind,
    status: "ACTIVE",
    createdAt: now,
    updatedAt: now,
    metadata: { source: "generation" }
  };
  state.generationSessions.unshift(session);
  state.generationSessions = state.generationSessions.slice(0, 500);
  return session;
}

function createGenerationBatch({
  tenantId,
  userId,
  projectId,
  sessionId,
  kind,
  payload,
  providerName,
  outputCount,
  idempotencyKey,
  totalCredits
}) {
  const existing = state.generationBatches.find((item) => item.idempotencyKey === idempotencyKey);
  if (existing) return existing;
  const now = new Date().toISOString();
  const batch = {
    id: requestId("generation_batch"),
    tenantId,
    userId: userId || null,
    projectId,
    sessionId,
    modality: String(kind || "").toUpperCase(),
    kind,
    operation: generationAction(payload),
    provider: providerName,
    model: payload.model || payload.modelId || null,
    status: jobStates.pending,
    requestedOutputs: outputCount,
    completedOutputs: 0,
    failedOutputs: 0,
    cancelledOutputs: 0,
    reservedCredits: totalCredits,
    capturedCredits: 0,
    releasedCredits: 0,
    idempotencyKey,
    parameters: { ...payload, outputCount },
    createdAt: now,
    updatedAt: now,
    completedAt: null
  };
  state.generationBatches.unshift(batch);
  state.generationBatches = state.generationBatches.slice(0, 300);
  return batch;
}

function findGenerationBatch(batchId = "") {
  return state.generationBatches.find((item) => item.id === batchId) || null;
}

function recomputeGenerationBatch(batchId = "") {
  const batch = findGenerationBatch(batchId);
  if (!batch) return null;
  const jobs = state.jobs.filter((item) => item.batchId === batch.id);
  const completed = jobs.filter((item) => item.status === jobStates.completed);
  const failed = jobs.filter((item) => item.status === jobStates.failed);
  const cancelled = jobs.filter((item) => item.status === jobStates.cancelled);
  const processing = jobs.filter((item) => [jobStates.processing, "IN_PROGRESS"].includes(item.status));
  const throttled = jobs.filter((item) => item.status === jobStates.throttled);
  const terminalCount = completed.length + failed.length + cancelled.length;
  let status = jobStates.pending;
  if (terminalCount === jobs.length && jobs.length) {
    status = completed.length ? jobStates.completed : failed.length ? jobStates.failed : jobStates.cancelled;
  } else if (processing.length) {
    status = jobStates.processing;
  } else if (throttled.length && throttled.length === jobs.length) {
    status = jobStates.throttled;
  }
  batch.status = status;
  batch.completedOutputs = completed.length;
  batch.failedOutputs = failed.length;
  batch.cancelledOutputs = cancelled.length;
  batch.capturedCredits = completed.reduce((total, item) => total + Number(item.creditCost || 0), 0);
  batch.releasedCredits = [...failed, ...cancelled].reduce((total, item) => total + Number(item.creditCost || 0), 0);
  batch.partial = terminalCount === jobs.length && completed.length > 0 && terminalCount > completed.length;
  batch.updatedAt = new Date().toISOString();
  if (terminalCount === jobs.length && jobs.length) batch.completedAt = batch.updatedAt;
  const project = state.projects.find((item) => item.id === batch.projectId);
  if (project) {
    project.status = status;
    project.updatedAt = batch.updatedAt;
  }
  return batch;
}

function serializeGenerationBatch(batch) {
  if (!batch) return null;
  const jobs = state.jobs.filter((item) => item.batchId === batch.id).sort((a, b) => a.batchIndex - b.batchIndex);
  return {
    ...batch,
    status: clientJobStatus(batch.status),
    state: batch.status,
    jobs: jobs.map(serializeJob),
    jobIds: jobs.map((job) => job.id)
  };
}

function createJob({ jobId = null, kind, title, providerName, prompt, payload, checks, request, batch = null, batchIndex = 1, projectId = null, sessionId = null }) {
  const now = new Date().toISOString();
  const job = {
    id: jobId || requestId("job"),
    requestId: null,
    tenantId: requestIdentity(request, checks.auth),
    userId: checks.auth?.userId || null,
    kind,
    modality: String(kind || "").toUpperCase(),
    operation: generationAction(payload),
    batchId: batch?.id || payload.batchId || null,
    batchIndex,
    sessionId: sessionId || payload.sessionId || null,
    title,
    provider: providerName,
    requestedProvider: checks.provider?.name || providerName,
    prompt,
    status: jobStates.pending,
    progress: 0,
    createdAt: now,
    updatedAt: now,
    providerJobId: null,
    historyItemId: null,
    projectId: projectId || payload.projectId || null,
    reservationId: checks.credits?.reservation?.id || null,
    reservationStatus: checks.credits?.reservation?.status || null,
    outputUrl: null,
    outputUrls: [],
    providerOutputUrls: [],
    assets: [],
    assetId: null,
    retryOfJobId: payload.retryOfJobId || null,
    incidentId: null,
    storage: null,
    error: null,
    payload: {
      provider: payload.provider,
      providerLabel: payload.providerLabel,
      tool: payload.tool,
      actionId: payload.actionId,
      duration: payload.duration,
      model: payload.model || payload.modelId || null,
      videoPlan: payload.videoPlan || null,
      realityTransform: Boolean(payload.realityTransform),
      sourceAssetId: payload.sourceAssetId || null,
      sourceDurationSeconds: payload.sourceDurationSeconds || null,
      transformStrength: payload.transformStrength || null,
      preservationMode: payload.preservationMode || null
    },
    parameters: { ...payload, outputCount: 1 },
    checks: {
      auth: checks.auth,
      plan: checks.plan,
      credits: checks.credits,
      provider: checks.provider
    },
    providerRoute: [],
    providerFallback: null,
    creditCost: checks.credits?.cost || 0,
    creditsRemaining: checks.credits?.wallet?.availableCredits ?? checks.credits?.remaining ?? state.subscription.credits,
    usageKey: usageBucketKey({ kind, request, auth: checks.auth })
  };
  job.requestId = job.id;
  state.jobs.unshift(job);
  state.jobs = state.jobs.slice(0, 100);
  return job;
}

function findJob(jobId = "") {
  const id = String(jobId || "");
  return state.jobs.find((job) => job.id === id || job.requestId === id || job.providerJobId === id) || null;
}

function updateJob(jobId, patch = {}) {
  const job = findJob(jobId);
  if (!job) return null;
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  if (job.batchId) recomputeGenerationBatch(job.batchId);
  return job;
}

function serializeJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    request_id: job.requestId || job.id,
    jobId: job.id,
    providerJobId: job.providerJobId,
    providerRequestId: job.providerJobId,
    batchId: job.batchId || null,
    batchIndex: job.batchIndex || 1,
    projectId: job.projectId || null,
    sessionId: job.sessionId || null,
    kind: job.kind,
    mediaType: job.kind,
    provider: job.provider,
    requestedProvider: job.requestedProvider,
    status: clientJobStatus(job.status),
    state: job.status,
    progress: Number(job.progress || 0),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    outputUrl: job.outputUrl || null,
    outputUrls: job.outputUrls || [],
    providerOutputUrls: job.providerOutputUrls || [],
    previewUrl: job.outputUrl || null,
    assets: job.assets || [],
    assetId: job.assetId || job.assets?.[0]?.id || null,
    retryOfJobId: job.retryOfJobId || null,
    incidentId: job.incidentId || job.error?.incidentId || null,
    parameters: job.parameters || job.payload || {},
    creditCost: Number(job.creditCost || 0),
    storage: job.storage || null,
    needs_review: Boolean(job.needs_review),
    needsReview: Boolean(job.needsReview),
    outputModeration: job.outputModeration || null,
    error: job.error,
    reservationId: job.reservationId,
    reservationStatus: job.reservationStatus,
    providerRoute: job.providerRoute || [],
    providerFallback: job.providerFallback || null
  };
}

function publicApiBaseUrl(request) {
  const configured = process.env.PUBLIC_API_BASE_URL || process.env.WEBHOOK_BASE_URL || process.env.APP_URL || "";
  if (configured) return configured.replace(/\/$/, "");
  const protocol = request.header("x-forwarded-proto") || request.protocol || "http";
  const host = request.header("x-forwarded-host") || request.header("host") || `127.0.0.1:${port}`;
  return `${protocol}://${host}`.replace(/\/$/, "");
}

function webhookProviderForStatus(status = {}) {
  const adapter = String(status.adapter || "").toLowerCase();
  const name = String(status.name || "").toLowerCase();
  if (adapter.includes("seedance") || name.includes("seedance") || adapter.includes("byteplus") || name.includes("byteplus") || name.includes("dreamina")) {
    return "seedance";
  }
  if (adapter.includes("omnihuman") || name.includes("omnihuman") || name.includes("omni human")) {
    return "omnihuman";
  }
  if (adapter.includes("replicate") || name.includes("replicate") || name.includes("wan") || name.includes("riffusion") || name.includes("audiocraft")) {
    return "replicate";
  }
  if (adapter.includes("fal") || name.includes("fal")) return "fal";
  return "replicate";
}

function webhookUrlFor(request, status = {}) {
  return `${publicApiBaseUrl(request)}/api/webhooks/${webhookProviderForStatus(status)}`;
}

function webhookUrlForJob(request, status = {}, jobId = "") {
  const url = new URL(webhookUrlFor(request, status));
  if (jobId) url.searchParams.set("jobId", jobId);
  return url.toString();
}

function storagePublicBaseUrl(request = null) {
  if (supabaseStorage.configured && process.env.STORAGE_PUBLIC_BASE_URL) {
    return process.env.STORAGE_PUBLIC_BASE_URL.replace(/\/$/, "");
  }
  const configured = process.env.SLT_CDN_BASE_URL || process.env.PUBLIC_CDN_BASE_URL || process.env.ASSET_CDN_BASE_URL || "";
  if (configured) return configured.replace(/\/$/, "");
  return request ? `${publicApiBaseUrl(request)}/cdn/assets` : "/cdn/assets";
}

function isPlatformAssetUrl(url = "") {
  const value = String(url || "");
  const configured = process.env.SLT_CDN_BASE_URL || process.env.PUBLIC_CDN_BASE_URL || process.env.ASSET_CDN_BASE_URL || "";
  if (value.startsWith("/cdn/assets/")) return true;
  if (value.includes("/cdn/assets/")) return true;
  return Boolean(configured && value.startsWith(configured.replace(/\/$/, "")));
}

function extensionFromContentType(contentType = "", sourceUrl = "") {
  const normalized = String(contentType || "").split(";")[0].trim().toLowerCase();
  const byType = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/webm": "webm",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/ogg": "ogg",
    "audio/webm": "webm",
    "audio/mp4": "m4a",
    "application/pdf": "pdf",
    "application/json": "json"
  };
  if (byType[normalized]) return byType[normalized];

  try {
    const parsed = new URL(sourceUrl);
    const cleanPath = parsed.pathname.split("?")[0];
    const match = cleanPath.match(/\.([a-z0-9]{2,5})$/i);
    if (match) return match[1].toLowerCase();
  } catch {
    const match = String(sourceUrl || "").split("?")[0].match(/\.([a-z0-9]{2,5})$/i);
    if (match) return match[1].toLowerCase();
  }
  return "bin";
}

function safeStorageSegment(value = "tenant") {
  return String(value || "tenant").replace(/[^a-zA-Z0-9_.=-]/g, "_").replace(/_+/g, "_").slice(0, 96) || "tenant";
}

async function storeAssetBytes({ bytes, contentType, fileName, request = null, tenantId = "" }) {
  if (supabaseStorage.configured && process.env.SLT_TEST_MODE !== "1") {
    const tenantPrefix = safeStorageSegment(tenantId || "tenant");
    const datePrefix = new Date().toISOString().slice(0, 10);
    const storageKey = `${tenantPrefix}/${datePrefix}/${fileName}`;
    return supabaseStorage.upload({ key: storageKey, bytes, contentType });
  }

  await mkdir(assetStorageDir, { recursive: true });
  const storagePath = resolve(assetStorageDir, fileName);
  await writeFile(storagePath, bytes);
  return {
    provider: "local",
    storageKey: fileName,
    storagePath,
    publicUrl: `${storagePublicBaseUrl(request).replace(/\/$/, "")}/${fileName}`
  };
}

async function hashFile(filePath) {
  const digest = crypto.createHash("sha256");
  await pipeline(createReadStream(filePath), new Writable({
    write(chunk, _encoding, callback) {
      digest.update(chunk);
      callback();
    }
  }));
  return digest.digest("hex");
}

async function moveFile(sourcePath, destinationPath) {
  try {
    await rename(sourcePath, destinationPath);
  } catch (error) {
    if (error.code !== "EXDEV") throw error;
    await pipeline(createReadStream(sourcePath), createWriteStream(destinationPath, { flags: "wx" }));
    await rm(sourcePath, { force: true });
  }
}

async function storeAssetFile({ filePath, contentType, fileName, request = null, tenantId = "", move = true }) {
  const fileStats = await stat(filePath);
  if (supabaseStorage.configured && process.env.SLT_TEST_MODE !== "1") {
    const tenantPrefix = safeStorageSegment(tenantId || "tenant");
    const datePrefix = new Date().toISOString().slice(0, 10);
    const storageKey = `${tenantPrefix}/${datePrefix}/${fileName}`;
    const stored = await supabaseStorage.uploadFile({ key: storageKey, filePath, contentType });
    if (move) await rm(filePath, { force: true });
    return { ...stored, bytes: fileStats.size };
  }

  await mkdir(assetStorageDir, { recursive: true });
  const storagePath = resolve(assetStorageDir, fileName);
  if (move) await moveFile(filePath, storagePath);
  else await pipeline(createReadStream(filePath), createWriteStream(storagePath, { flags: "wx" }));
  return {
    provider: "local",
    storageKey: fileName,
    storagePath,
    publicUrl: `${storagePublicBaseUrl(request).replace(/\/$/, "")}/${fileName}`,
    bytes: fileStats.size
  };
}

async function temporaryUploadPath(prefix = "upload", extension = "bin") {
  const incomingDir = resolve(assetStorageDir, ".incoming");
  await mkdir(incomingDir, { recursive: true });
  return resolve(incomingDir, `${safeStorageSegment(prefix)}_${requestId("tmp")}.${safeStorageSegment(extension)}`);
}

async function streamToFile(readable, filePath, maxBytes) {
  let bytes = 0;
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        const error = new Error(`Upload exceeds ${Math.round(maxBytes / 1024 / 1024)}MB limit.`);
        error.code = "upload_too_large";
        error.statusCode = 413;
        callback(error);
        return;
      }
      callback(null, chunk);
    }
  });
  await pipeline(readable, limiter, createWriteStream(filePath, { flags: "wx" }));
  return bytes;
}

async function downloadUrlToFile(url, filePath, { headers = {}, maxBytes = envNumber("MAX_PROVIDER_ASSET_BYTES", 1024 * 1024 * 1024) } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), envNumber("ASSET_DOWNLOAD_TIMEOUT_MS", 120000));
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.ok || !response.body) {
      const error = new Error(`Asset download failed with HTTP ${response.status}.`);
      error.code = "asset_download_failed";
      throw error;
    }
    const bytes = await streamToFile(Readable.fromWeb(response.body), filePath, maxBytes);
    return {
      bytes,
      contentType: response.headers.get("content-type") || "application/octet-stream"
    };
  } catch (error) {
    if (!error.code) error.code = "asset_download_failed";
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function parseDataUrl(dataUrl = "") {
  const match = String(dataUrl).match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (!match) {
    const error = new Error("Invalid data URL returned by provider.");
    error.code = "asset_download_failed";
    throw error;
  }
  const contentType = match[1] || "application/octet-stream";
  const isBase64 = Boolean(match[2]);
  const body = match[3] || "";
  return {
    contentType,
    bytes: Buffer.from(isBase64 ? body : decodeURIComponent(body), isBase64 ? "base64" : "utf8")
  };
}

async function downloadProviderAsset(url, { headers = {} } = {}) {
  const sourceUrl = String(url || "");
  if (!sourceUrl) {
    const error = new Error("Provider completed without an asset URL.");
    error.code = "asset_missing";
    throw error;
  }

  if (isPlatformAssetUrl(sourceUrl)) {
    return { alreadyStored: true, sourceUrl, publicUrl: sourceUrl, bytes: null, contentType: "" };
  }

  if (sourceUrl.startsWith("local-placeholder://")) {
    return {
      bytes: Buffer.from(JSON.stringify({ sourceUrl, storedAt: new Date().toISOString() }, null, 2)),
      contentType: "application/json",
      placeholder: true
    };
  }

  if (sourceUrl.startsWith("data:")) return parseDataUrl(sourceUrl);

  if (!/^https?:\/\//i.test(sourceUrl)) {
    const error = new Error(`Unsupported provider asset URL: ${sourceUrl.slice(0, 80)}`);
    error.code = "asset_download_failed";
    throw error;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), envNumber("ASSET_DOWNLOAD_TIMEOUT_MS", 30000));
  try {
    const response = await fetch(sourceUrl, { headers, signal: controller.signal });
    if (!response.ok) {
      const error = new Error(`Provider asset download failed with HTTP ${response.status}.`);
      error.code = "asset_download_failed";
      throw error;
    }
    const contentType = response.headers.get("content-type") || "application/octet-stream";
    const bytes = Buffer.from(await response.arrayBuffer());
    return { bytes, contentType };
  } catch (error) {
    if (!error.code) error.code = "asset_download_failed";
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function storeProviderAsset({ job, sourceUrl, cdnBaseUrl, sourceHeaders = {} }) {
  const assetTenantId = job.tenantId || recordTenantId(job) || state.wallet.tenantId;
  const lineage = assetLineage({
    tenantId: assetTenantId,
    parentVersionId: job.parameters?.parentVersionId,
    parentAssetId: job.parameters?.parentAssetId,
    versionType: job.parameters?.versionType || (job.retryOfJobId ? "RETRY" : "GENERATION")
  });
  if (/^https?:\/\//i.test(String(sourceUrl || "")) && !isPlatformAssetUrl(sourceUrl)) {
    let tempPath = await temporaryUploadPath(`${job.kind}-${job.id}`, extensionFromContentType("", sourceUrl));
    try {
      const downloaded = await downloadUrlToFile(sourceUrl, tempPath, { headers: sourceHeaders });
      const validation = await validateMediaFile({
        filePath: tempPath,
        declaredMime: downloaded.contentType,
        kind: job.kind,
        maxBytes: envNumber("MAX_PROVIDER_ASSET_BYTES", 1024 * 1024 * 1024),
        skipProbe: process.env.SLT_TEST_MODE === "1",
        probeLimits: {
          maxDuration: envNumber("MAX_VIDEO_DURATION_SECONDS", 3600),
          maxWidth: envNumber("MAX_VIDEO_WIDTH", 8192),
          maxHeight: envNumber("MAX_VIDEO_HEIGHT", 8192),
          maxFps: envNumber("MAX_VIDEO_FPS", 120)
        }
      });
      const contentType = validation.detectedMime;
      const extension = extensionFromContentType(contentType, sourceUrl);
      const digest = (await hashFile(tempPath)).slice(0, 12);
      const fileName = `${job.kind}_${job.id}_${digest}.${extension}`.replace(/[^a-zA-Z0-9_.-]/g, "_");
      const stored = await storeAssetFile({ filePath: tempPath, contentType, fileName, tenantId: assetTenantId, move: true });
      tempPath = "";
      const asset = {
        id: requestId("asset"),
        tenantId: assetTenantId,
        userId: job.userId || null,
        jobId: job.id,
        batchId: job.batchId || null,
        projectId: job.projectId || null,
        sessionId: job.sessionId || null,
        ...lineage,
        displayName: job.title || `${job.kind} generation`,
        kind: job.kind,
        provider: job.provider,
        originalUrl: sourceUrl,
        publicUrl: stored.publicUrl || `${cdnBaseUrl.replace(/\/$/, "")}/${fileName}`,
        storageKey: stored.storageKey || fileName,
        storageProvider: stored.provider || "local",
        storagePath: stored.storagePath || null,
        contentType,
        bytes: validation.bytes,
        status: "stored",
        metadata: {
          media: validation.media,
          signatureMime: validation.detectedMime,
          serverValidated: process.env.SLT_TEST_MODE !== "1",
          operation: job.operation || job.parameters?.operation || null,
          prompt: job.prompt || "",
          referenceAssetIds: job.parameters?.referenceAssetIds || []
        },
        createdAt: new Date().toISOString()
      };
      state.assets.unshift(asset);
      state.assets = state.assets.slice(0, 200);
      return asset;
    } catch (error) {
      if (tempPath) await rm(tempPath, { force: true }).catch(() => {});
      throw error;
    }
  }

  const downloaded = await downloadProviderAsset(sourceUrl, { headers: sourceHeaders });
  if (downloaded.alreadyStored) {
    const asset = {
      id: requestId("asset"),
      tenantId: assetTenantId,
      userId: job.userId || null,
      jobId: job.id,
      batchId: job.batchId || null,
      projectId: job.projectId || null,
      sessionId: job.sessionId || null,
      ...lineage,
      displayName: job.title || `${job.kind} generation`,
      kind: job.kind,
      provider: job.provider,
      originalUrl: sourceUrl,
      publicUrl: downloaded.publicUrl,
      contentType: downloaded.contentType || "",
      bytes: 0,
      status: "already_stored",
      createdAt: new Date().toISOString()
    };
    state.assets.unshift(asset);
    state.assets = state.assets.slice(0, 300);
    return asset;
  }

  const contentType = downloaded.contentType || "application/octet-stream";
  const extension = extensionFromContentType(contentType, sourceUrl);
  const digest = crypto.createHash("sha256").update(String(sourceUrl)).update(downloaded.bytes).digest("hex").slice(0, 12);
  const fileName = `${job.kind}_${job.id}_${digest}.${extension}`.replace(/[^a-zA-Z0-9_.-]/g, "_");
  const stored = await storeAssetBytes({ bytes: downloaded.bytes, contentType, fileName, tenantId: assetTenantId });

  const asset = {
    id: requestId("asset"),
    tenantId: assetTenantId,
    userId: job.userId || null,
    jobId: job.id,
    batchId: job.batchId || null,
    projectId: job.projectId || null,
    sessionId: job.sessionId || null,
    ...lineage,
    displayName: job.title || `${job.kind} generation`,
    kind: job.kind,
    provider: job.provider,
    originalUrl: sourceUrl.startsWith("data:") ? "data-url" : sourceUrl,
    publicUrl: stored.publicUrl || `${cdnBaseUrl.replace(/\/$/, "")}/${fileName}`,
    storageKey: stored.storageKey || fileName,
    storageProvider: stored.provider || "local",
    storagePath: stored.storagePath || null,
    contentType,
    bytes: downloaded.bytes.length,
    status: downloaded.placeholder ? "placeholder_stored" : "stored",
    metadata: {
      operation: job.operation || job.parameters?.operation || null,
      prompt: job.prompt || "",
      referenceAssetIds: job.parameters?.referenceAssetIds || []
    },
    createdAt: new Date().toISOString()
  };
  state.assets.unshift(asset);
  state.assets = state.assets.slice(0, 200);
  return asset;
}

async function persistProviderAssets({ job, outputUrls = [], cdnBaseUrl, sourceHeaders = {} }) {
  const urls = [...new Set((outputUrls || []).filter(Boolean))];
  if (!urls.length) {
    return { assets: [], outputUrls: [], outputUrl: null, storage: { status: "skipped", reason: "no_provider_asset" } };
  }

  const assets = [];
  for (const sourceUrl of urls) {
    assets.push(await storeProviderAsset({ job, sourceUrl, cdnBaseUrl, sourceHeaders }));
  }

  const storedUrls = assets.map((asset) => asset.publicUrl).filter(Boolean);
  return {
    assets,
    outputUrls: storedUrls,
    outputUrl: storedUrls[0] || null,
    storage: {
      status: "stored",
      providerUrlCount: urls.length,
      storedAssetCount: assets.length,
      cdnBaseUrl
    }
  };
}

const uploadMimeGroups = {
  image: ["image/png", "image/jpeg", "image/webp", "image/gif"],
  video: ["image/png", "image/jpeg", "image/webp", "image/gif", "video/mp4", "video/webm", "video/quicktime"],
  music: ["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/ogg", "audio/webm", "audio/mp4", "text/plain"],
  sound: ["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/ogg", "audio/webm", "audio/mp4", "video/mp4", "video/webm", "video/quicktime"],
  fashion: ["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"],
  reference: ["image/png", "image/jpeg", "image/webp", "image/gif", "video/mp4", "video/webm", "video/quicktime", "audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/ogg", "audio/webm", "audio/mp4", "text/plain", "application/pdf"]
};

function allowedUploadMimes(kind = "reference") {
  return uploadMimeGroups[kind] || uploadMimeGroups.reference;
}

function normalizeUploadKind(kind = "") {
  const value = String(kind || "").toLowerCase();
  if (["image", "video", "music", "sound", "fashion"].includes(value)) return value;
  return "reference";
}

function safeUploadName(name = "asset.bin") {
  const clean = String(name || "asset.bin").split(/[\\/]/).pop().replace(/[^a-zA-Z0-9_. -]/g, "_").trim();
  return clean || "asset.bin";
}

function parseUploadedBytes({ dataUrl = "", base64 = "" } = {}) {
  if (dataUrl) return parseDataUrl(dataUrl);
  if (!base64) {
    const error = new Error("Upload body must include dataUrl or base64.");
    error.code = "upload_missing_bytes";
    throw error;
  }
  return {
    contentType: "application/octet-stream",
    bytes: Buffer.from(String(base64), "base64")
  };
}

function maxUploadBytesFor(uploadKind = "reference") {
  if (uploadKind === "video") return envNumber("MAX_VIDEO_UPLOAD_BYTES", 200 * 1024 * 1024);
  if (["music", "sound"].includes(uploadKind)) return envNumber("MAX_AUDIO_UPLOAD_BYTES", 100 * 1024 * 1024);
  return envNumber("MAX_UPLOAD_BYTES", 25 * 1024 * 1024);
}

function validateDeclaredUpload({ uploadKind, contentType, bytes = null }) {
  const accepted = allowedUploadMimes(uploadKind);
  if (!accepted.includes(contentType)) {
    const error = new Error(`Unsupported upload type ${contentType || "unknown"} for ${uploadKind}.`);
    error.code = "upload_invalid_mime";
    error.statusCode = 400;
    throw error;
  }
  const maxBytes = maxUploadBytesFor(uploadKind);
  if (Number.isFinite(bytes) && bytes > maxBytes) {
    const error = new Error(`Upload exceeds ${Math.round(maxBytes / 1024 / 1024)}MB limit.`);
    error.code = "upload_too_large";
    error.statusCode = 413;
    throw error;
  }
  return { accepted, maxBytes };
}

const assetVersionTypes = new Set(["GENERATION", "VARIATION", "REMIX", "RETRY", "CONTINUATION", "EDIT", "EXTENSION"]);

function normalizeAssetVersionType(value = "GENERATION") {
  const normalized = String(value || "GENERATION").trim().toUpperCase();
  return assetVersionTypes.has(normalized) ? normalized : "GENERATION";
}

function assetLineage({ tenantId, parentVersionId = null, parentAssetId = null, versionType = "GENERATION" } = {}) {
  const immediateParentId = parentVersionId || parentAssetId || null;
  const immediateParent = immediateParentId
    ? state.assets.find((item) => item.id === immediateParentId && item.tenantId === tenantId)
    : null;
  if (!immediateParent) {
    return { parentAssetId: null, parentVersionId: null, version: 1, versionType: normalizeAssetVersionType(versionType) };
  }
  const rootAssetId = immediateParent.parentAssetId || immediateParent.id;
  const lineage = state.assets.filter((item) => item.tenantId === tenantId && (item.id === rootAssetId || item.parentAssetId === rootAssetId));
  const version = Math.max(1, ...lineage.map((item) => Number(item.version || 1))) + 1;
  return {
    parentAssetId: rootAssetId,
    parentVersionId: immediateParent.id,
    version,
    versionType: normalizeAssetVersionType(versionType)
  };
}

function registerUploadedAsset({ request, auth, payload, uploadKind, contentType, detectedContentType, bytes, stored, media = null }) {
  const tenantId = requestIdentity(request, auth);
  const lineage = assetLineage({
    tenantId,
    parentVersionId: payload.parentVersionId,
    parentAssetId: payload.parentAssetId,
    versionType: payload.versionType || "GENERATION"
  });
  const asset = {
    id: requestId("asset"),
    tenantId,
    userId: auth?.userId || null,
    projectId: payload.projectId || null,
    sessionId: payload.sessionId || null,
    jobId: payload.jobId || null,
    ...lineage,
    displayName: String(payload.displayName || payload.fileName || "Uploaded asset").slice(0, 180),
    kind: uploadKind,
    module: payload.module || uploadKind,
    provider: "user-upload",
    role: payload.role || "reference",
    originalName: safeUploadName(payload.fileName),
    originalUrl: "user-upload",
    publicUrl: stored.publicUrl,
    storageKey: stored.storageKey,
    storageProvider: stored.provider || "local",
    storagePath: stored.storagePath || null,
    contentType: detectedContentType || contentType,
    bytes,
    status: "stored",
    metadata: {
      promptRole: payload.promptRole || "",
      note: payload.note || "",
      signatureMime: detectedContentType || contentType,
      durationSeconds: media?.durationSeconds ?? (process.env.SLT_TEST_MODE === "1" && Number.isFinite(Number(payload.durationSeconds)) ? Number(payload.durationSeconds) : null),
      width: media?.width || null,
      height: media?.height || null,
      frameRate: media?.frameRate || null,
      codec: media?.codec || null,
      videoTracks: media?.videoTracks ?? null,
      audioTracks: media?.audioTracks ?? null,
      audioCodecs: media?.audioCodecs || [],
      serverValidated: process.env.SLT_TEST_MODE !== "1"
    },
    createdAt: new Date().toISOString()
  };
  state.assets.unshift(asset);
  state.assets = state.assets.slice(0, 300);
  return asset;
}

async function storeUploadedReferenceFile({ request, auth, payload = {}, filePath }) {
  const uploadKind = normalizeUploadKind(payload.kind || payload.module || payload.studio);
  const declaredContentType = String(payload.contentType || "application/octet-stream").split(";")[0].trim().toLowerCase();
  const { accepted, maxBytes } = validateDeclaredUpload({ uploadKind, contentType: declaredContentType });
  let validation;
  try {
    validation = await validateMediaFile({
      filePath,
      declaredMime: declaredContentType,
      kind: uploadKind,
      maxBytes,
      skipProbe: process.env.SLT_TEST_MODE === "1",
      probeLimits: {
        maxDuration: envNumber("MAX_VIDEO_DURATION_SECONDS", 3600),
        maxWidth: envNumber("MAX_VIDEO_WIDTH", 8192),
        maxHeight: envNumber("MAX_VIDEO_HEIGHT", 8192),
        maxFps: envNumber("MAX_VIDEO_FPS", 120)
      }
    });
    if (!accepted.includes(validation.detectedMime) && !(validation.detectedMime === "video/webm" && accepted.includes("audio/webm"))) {
      const error = new Error(`Detected media type ${validation.detectedMime} is not accepted for ${uploadKind}.`);
      error.code = "upload_invalid_mime";
      error.statusCode = 400;
      throw error;
    }
    const tenantId = requestIdentity(request, auth);
    const extension = extensionFromContentType(validation.detectedMime, payload.fileName || "");
    const digest = (await hashFile(filePath)).slice(0, 12);
    const fileName = `${uploadKind}_${safeStorageSegment(tenantId)}_${Date.now()}_${digest}.${extension}`;
    const stored = await storeAssetFile({ filePath, contentType: validation.detectedMime, fileName, request, tenantId, move: true });
    return registerUploadedAsset({
      request,
      auth,
      payload,
      uploadKind,
      contentType: declaredContentType,
      detectedContentType: validation.detectedMime,
      bytes: validation.bytes,
      stored,
      media: validation.media
    });
  } catch (error) {
    await rm(filePath, { force: true }).catch(() => {});
    throw error;
  }
}

async function handleStreamingReferenceUpload(request, response) {
  const auth = request.sltAuth || getAuth(request);
  const payload = {
    kind: request.query.kind,
    module: request.query.module,
    role: request.query.role,
    projectId: request.query.projectId || null,
    sessionId: request.query.sessionId || null,
    note: request.query.note || "",
    fileName: request.query.fileName || "upload.bin",
    contentType: String(request.headers["content-type"] || "application/octet-stream").split(";")[0].trim().toLowerCase(),
    durationSeconds: request.query.durationSeconds || null
  };
  const uploadKind = normalizeUploadKind(payload.kind || payload.module);
  let tempPath = "";
  try {
    if (supabaseStorage.configured && process.env.SLT_TEST_MODE !== "1") {
      response.status(409).json({
        ok: false,
        code: "signed_upload_required",
        error: "Use the signed upload preflight for durable cloud storage.",
        uploadIntentEndpoint: "/api/uploads/signed"
      });
      return;
    }
    const contentLength = Number(request.headers["content-length"] || 0);
    const { maxBytes } = validateDeclaredUpload({ uploadKind, contentType: payload.contentType, bytes: contentLength || null });
    tempPath = await temporaryUploadPath(uploadKind, extensionFromContentType(payload.contentType, payload.fileName));
    await streamToFile(request, tempPath, maxBytes);
    const asset = await storeUploadedReferenceFile({ request, auth, payload, filePath: tempPath });
    tempPath = "";
    response.status(201).json({
      ok: true,
      auth,
      asset: serializeAssetForClient(asset),
      cdnBaseUrl: storagePublicBaseUrl(request),
      message: "Reference asset streamed, validated and stored."
    });
  } catch (error) {
    if (tempPath) await rm(tempPath, { force: true }).catch(() => {});
    response.status(error.statusCode || 400).json({
      ok: false,
      auth,
      code: error.code || "upload_failed",
      error: error.message,
      readableError: error.message,
      details: error.details || null
    });
  }
}

async function storeUploadedReferenceBytes({ request, auth, payload = {}, bytes, detectedContentType = "" }) {
  const uploadKind = normalizeUploadKind(payload.kind || payload.module || payload.studio);
  const contentType = String(payload.contentType || detectedContentType || "application/octet-stream").split(";")[0].trim().toLowerCase();
  const { accepted } = validateDeclaredUpload({ uploadKind, contentType, bytes: bytes?.length || 0 });
  if (!bytes?.length) {
    const error = new Error("Upload file is empty.");
    error.code = "upload_empty";
    error.statusCode = 400;
    throw error;
  }
  const signatureMime = assertMediaSignature({ bytes: bytes.subarray(0, 512), declaredMime: contentType });
  if (!accepted.includes(signatureMime) && !(signatureMime === "video/webm" && accepted.includes("audio/webm"))) {
    const error = new Error(`Detected media type ${signatureMime} is not accepted for ${uploadKind}.`);
    error.code = "upload_invalid_mime";
    error.statusCode = 400;
    throw error;
  }
  if (signatureMime.startsWith("video/") && process.env.SLT_TEST_MODE !== "1") {
    const error = new Error("Video files must use the streaming or signed upload pipeline.");
    error.code = "streaming_upload_required";
    error.statusCode = 409;
    throw error;
  }

  const tenantId = requestIdentity(request, auth);
  const extension = extensionFromContentType(signatureMime, payload.fileName || "");
  const digest = crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 12);
  const fileName = `${uploadKind}_${tenantId}_${Date.now()}_${digest}.${extension}`.replace(/[^a-zA-Z0-9_.-]/g, "_");
  const stored = await storeAssetBytes({ bytes, contentType: signatureMime, fileName, request, tenantId });
  return registerUploadedAsset({
    request,
    auth,
    payload,
    uploadKind,
    contentType,
    detectedContentType: signatureMime,
    bytes: bytes.length,
    stored,
    media: null
  });
}

async function storeUploadedReferenceAsset({ request, auth, payload = {} }) {
  const parsed = parseUploadedBytes(payload);
  return storeUploadedReferenceBytes({
    request,
    auth,
    payload,
    bytes: parsed.bytes,
    detectedContentType: parsed.contentType
  });
}

function serializeAssetForClient(asset = {}) {
  const { storagePath: _storagePath, ...safeAsset } = asset;
  return safeAsset;
}

function findOwnedAsset(assetId, auth) {
  const asset = state.assets.find((item) => item.id === assetId);
  if (!asset) return null;
  if (!canAccessRecord(asset, auth)) {
    const error = new Error("Forbidden.");
    error.code = "forbidden";
    error.statusCode = 403;
    throw error;
  }
  return asset;
}

function normalizeFormKind(kind = "") {
  const value = String(kind || "contact").toLowerCase().replace(/[^a-z0-9_-]/g, "");
  const allowed = new Set(["contact", "support", "help", "careers", "suggestion", "sales", "bug", "account-recovery", "subscription-cancel"]);
  return allowed.has(value) ? value : "contact";
}

function validateFormPayload(payload = {}) {
  const email = String(payload.email || "").trim();
  const message = String(payload.message || payload.body || "").trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Invalid email.";
  if (message.length < 8) return "Message must have at least 8 characters.";
  if (message.length > 5000) return "Message is too long.";
  return null;
}

function savePlatformForm({ request, auth, kind, payload = {} }) {
  const validationError = validateFormPayload(payload);
  if (validationError) {
    const error = new Error(validationError);
    error.code = "form_validation_failed";
    error.statusCode = 400;
    throw error;
  }
  const form = {
    id: requestId("form"),
    tenantId: requestIdentity(request, auth),
    kind: normalizeFormKind(kind),
    name: String(payload.name || payload.fullName || "").trim(),
    email: String(payload.email || auth.email || "").trim(),
    subject: String(payload.subject || payload.topic || "").trim() || normalizeFormKind(kind),
    message: String(payload.message || payload.body || "").trim(),
    status: "received",
    source: payload.source || "web",
    metadata: payload.metadata || {},
    createdAt: new Date().toISOString()
  };
  state.forms.unshift(form);
  state.forms = state.forms.slice(0, 200);
  return form;
}


function buildQueuedHistoryEntry({ job, checks }) {
  return {
    id: requestId(job.kind),
    tenantId: job.tenantId,
    userId: job.userId || null,
    jobId: job.id,
    batchId: job.batchId || null,
    projectId: job.projectId || null,
    sessionId: job.sessionId || null,
    kind: job.kind,
    title: job.title,
    provider: job.provider,
    prompt: job.prompt,
    status: "processing",
    message: `${job.kind} generation queued with ${job.provider}.`,
    creditsUsed: 0,
    result: {
      providerJobId: job.id,
      jobId: job.id,
      request_id: job.id,
      batchId: job.batchId || null,
      projectId: job.projectId || null,
      sessionId: job.sessionId || null,
      status: "processing",
      state: job.status,
      reservationId: job.reservationId,
      reservationStatus: job.reservationStatus,
      note: `Poll /api/jobs/${job.id} for status.`,
      providerRoute: [],
      fallback: null,
      exportFormats: exportFormatsFor(job.kind)
    },
    checks,
    createdAt: job.createdAt
  };
}

function updateHistoryItem(entryId, patcher) {
  const entry = state.history.find((item) => item.id === entryId);
  if (!entry) return null;
  const patch = typeof patcher === "function" ? patcher(entry) : patcher;
  Object.assign(entry, patch);
  return entry;
}

function appendJobEvent(job, event) {
  const events = Array.isArray(job.events) ? job.events : [];
  job.events = [...events, { ...event, at: new Date().toISOString() }].slice(-20);
}

function mockProviderResult(kind, providerName, reason = providerFallbackMessage) {
  return {
    mock: true,
    mode: "test",
    previewUrl: `local-placeholder://${kind}/${Date.now()}`,
    responseText: `${mockModeMessage} ${reason}`,
    note: `${mockModeMessage} ${reason}`,
    provider: providerName
  };
}

function buildMockEntry({ kind, title, providerName, prompt, message = mockModeMessage, code = "mock_mode" }) {
  return {
    id: requestId(kind),
    kind,
    title,
    provider: providerName,
    prompt,
    status: "mock",
    code,
    message,
    creditsUsed: 0,
    result: {
      ...mockProviderResult(kind, providerName, message),
      exportFormats: exportFormatsFor(kind)
    },
    createdAt: new Date().toISOString()
  };
}

function extractOpenAIText(data) {
  if (data.output_text) return data.output_text;
  const message = data.output?.find((item) => item.type === "message");
  const textPart = message?.content?.find((item) => item.type === "output_text");
  return textPart?.text || data.choices?.[0]?.message?.content || "Assistant response ready.";
}

function extractChatText(data) {
  return data.choices?.[0]?.message?.content || data.output_text || "Assistant response ready.";
}

async function postJson(url, { headers = {}, body = {}, timeoutMs = 60000 }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch (_error) {
      data = { raw: text };
    }
    if (!response.ok) {
      const message =
        data.error?.message ||
        data.message ||
        data.error?.code ||
        data.code ||
        data.raw ||
        `${response.status} ${response.statusText}`;
      const error = new Error(message);
      error.statusCode = response.status;
      error.code = data.error?.code || data.code || `provider_http_${response.status}`;
      error.providerBody = data;
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

async function getJson(url, { headers = {}, timeoutMs = 60000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal
    });
    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch (_error) {
      data = { raw: text };
    }
    if (!response.ok) {
      const message =
        data.error?.message ||
        data.message ||
        data.error?.code ||
        data.code ||
        data.raw ||
        `${response.status} ${response.statusText}`;
      const error = new Error(message);
      error.statusCode = response.status;
      error.code = data.error?.code || data.code || `provider_http_${response.status}`;
      error.providerBody = data;
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

async function providerCreditFetch(name, url, { headers = {}, timeoutMs = 12000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal
    });
    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch (_error) {
      data = { raw: text };
    }
    return { name, ok: response.ok, status: response.status, data };
  } catch (error) {
    return { name, ok: false, status: "error", error: error.name || error.message };
  } finally {
    clearTimeout(timeout);
  }
}

function creditUnavailable(name, status, message = "Credit balance is not exposed by the tested API endpoint.") {
  return {
    name,
    kind: providerStatus(name).kind || "unknown",
    connected: providerStatus(name).connected,
    ok: false,
    status: status || providerStatus(name).status,
    balance: null,
    unit: "",
    detail: message
  };
}

function creditConnectedNoApi(name, detail = "Connected. This provider does not expose account credit balance through the normal API key endpoint.") {
  const status = providerStatus(name);
  return {
    name,
    kind: status.kind,
    connected: status.connected,
    ok: status.connected,
    status: status.status,
    balance: null,
    unit: "",
    detail
  };
}

async function readProviderCredit(name) {
  const status = providerStatus(name);
  if (!status.connected) {
    return {
      name,
      kind: status.kind,
      connected: false,
      ok: false,
      status: status.status,
      balance: null,
      unit: "",
      detail: status.message
    };
  }

  try {
    if (name === "Stability") {
      const result = await providerCreditFetch(name, `${(process.env.STABILITY_API_URL || "https://api.stability.ai").replace(/\/$/, "")}/v1/user/balance`, {
        headers: { Authorization: `Bearer ${process.env.STABILITY_API_KEY}` }
      });
      return result.ok
        ? { name, kind: status.kind, connected: true, ok: true, status: "ok", balance: result.data.credits ?? null, unit: "credits", detail: "Stability account balance." }
        : creditUnavailable(name, result.status, result.data?.message || result.error);
    }

    if (name === "ElevenLabs") {
      const result = await providerCreditFetch(name, "https://api.elevenlabs.io/v1/user/subscription", {
        headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY }
      });
      if (!result.ok) return creditUnavailable(name, result.status, result.data?.detail || result.error);
      const used = Number(result.data.character_count || 0);
      const limit = Number(result.data.character_limit || 0);
      return {
        name,
        kind: status.kind,
        connected: true,
        ok: true,
        status: "ok",
        balance: Math.max(limit - used, 0),
        unit: "characters",
        detail: `${used} used of ${limit}. Tier: ${result.data.tier || "unknown"}.`
      };
    }

    if (name === "HeyGen") {
      const result = await providerCreditFetch(name, `${(process.env.HEYGEN_API_URL || "https://api.heygen.com").replace(/\/$/, "")}/v2/user/remaining_quota`, {
        headers: { "x-api-key": process.env.HEYGEN_API_KEY }
      });
      return result.ok
        ? { name, kind: status.kind, connected: true, ok: true, status: "ok", balance: result.data.data?.remaining_quota ?? null, unit: "quota", detail: `API quota: ${result.data.data?.details?.api ?? result.data.data?.remaining_quota ?? "unknown"}.` }
        : creditUnavailable(name, result.status, result.data?.message || result.error);
    }

    if (name === "D-ID") {
      const result = await providerCreditFetch(name, `${(process.env.DID_API_URL || "https://api.d-id.com").replace(/\/$/, "")}/credits`, {
        headers: { Authorization: `Basic ${process.env.DID_API_KEY}` }
      });
      return result.ok
        ? { name, kind: status.kind, connected: true, ok: true, status: "ok", balance: result.data.remaining ?? 0, unit: "credits", detail: `Total: ${result.data.total ?? 0}.` }
        : creditUnavailable(name, result.status, result.data?.message || result.error);
    }

    if (name === "Leonardo") {
      const result = await providerCreditFetch(name, `${(process.env.LEONARDO_API_URL || "https://cloud.leonardo.ai/api/rest/v1").replace(/\/$/, "")}/me`, {
        headers: { authorization: `Bearer ${process.env.LEONARDO_API_KEY}` }
      });
      if (!result.ok) return creditUnavailable(name, result.status, result.data?.error || result.error);
      const details = result.data.user_details?.[0] || {};
      return {
        name,
        kind: status.kind,
        connected: true,
        ok: true,
        status: "ok",
        balance: details.apiPaidTokens ?? details.subscriptionTokens ?? null,
        unit: "tokens",
        detail: `API paid: ${details.apiPaidTokens ?? "—"} / subscription: ${details.subscriptionTokens ?? "—"} / GPT: ${details.subscriptionGptTokens ?? "—"}.`
      };
    }

    if (name === "Recraft") {
      const result = await providerCreditFetch(name, `${(process.env.RECRAFT_API_URL || "https://external.api.recraft.ai/v1").replace(/\/$/, "")}/users/me`, {
        headers: { Authorization: `Bearer ${process.env.RECRAFT_API_KEY}` }
      });
      return result.ok
        ? { name, kind: status.kind, connected: true, ok: true, status: "ok", balance: result.data.credits ?? null, unit: "credits", detail: "Recraft account credits." }
        : creditUnavailable(name, result.status, result.data?.message || result.error);
    }

    if (name === "Runway") {
      const result = await providerCreditFetch(name, `${(process.env.RUNWAY_API_URL || "https://api.dev.runwayml.com/v1").replace(/\/$/, "")}/organization`, {
        headers: {
          Authorization: `Bearer ${process.env.RUNWAY_API_KEY}`,
          "X-Runway-Version": process.env.RUNWAY_API_VERSION || "2024-11-06"
        }
      });
      return result.ok
        ? { name, kind: status.kind, connected: true, ok: true, status: "ok", balance: result.data.creditBalance ?? null, unit: "credits", detail: `Monthly max spend: ${result.data.tier?.maxMonthlyCreditSpend ?? "unknown"}.` }
        : creditUnavailable(name, result.status, result.data?.message || result.error);
    }

    if (name === "Meta Llama") {
      const result = await providerCreditFetch("OpenRouter", "https://openrouter.ai/api/v1/credits", {
        headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` }
      });
      return result.ok
        ? { name, kind: status.kind, connected: true, ok: true, status: "ok", balance: result.data.data?.total_credits ?? null, unit: "credits", detail: `OpenRouter usage: ${result.data.data?.total_usage ?? 0}.` }
        : creditUnavailable(name, result.status, result.data?.error?.message || result.error);
    }

    if (name === "Stripe") {
      const result = await providerCreditFetch(name, "https://api.stripe.com/v1/balance", {
        headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` }
      });
      const usd = result.data.available?.find((item) => item.currency === "usd")?.amount ?? 0;
      return result.ok
        ? { name, kind: status.kind, connected: true, ok: true, status: "ok", balance: usd / 100, unit: "USD available", detail: `Mode: ${result.data.livemode ? "live" : "test"}. Pending USD: ${(result.data.pending?.find((item) => item.currency === "usd")?.amount ?? 0) / 100}.` }
        : creditUnavailable(name, result.status, result.data?.error?.message || result.error);
    }
  } catch (error) {
    return creditUnavailable(name, "error", error.message);
  }

  if (["OpenAI", "OpenAI Images", "OpenAI Audio", "GPT voz + texto", "GPT texto", "GPT-4.1", "GPT-4o", "Grok Image", "Gemini", "Gemini Image", "Veo", "Replicate", "Flux", "FLUX", "Stable Diffusion", "Wan", "AudioCraft local", "Riffusion"].includes(name)) {
    return creditConnectedNoApi(name);
  }

  if (["Seedance", "OmniHuman"].includes(name)) {
    return creditConnectedNoApi(name, "Connected through BytePlus. Balance must be checked in BytePlus Console billing.");
  }

  if (["Kling", "Hailuo", "MiniMax Music", "MiniMax Speech", "Luma", "PixVerse", "Moises"].includes(name)) {
    return creditConnectedNoApi(name, "Connected. I do not have a confirmed public balance endpoint for this provider yet.");
  }

  if (["Hermes local", "Local model", "ComfyUI local", "SLT Composer", "FFmpeg"].includes(name)) {
    return { name, kind: status.kind, connected: status.connected, ok: true, status: status.status, balance: null, unit: "local", detail: "Local/internal provider. No external provider credits." };
  }

  return creditUnavailable(name, status.status, status.message);
}

async function providerCreditSummary() {
  const names = [
    "Stability",
    "ElevenLabs",
    "HeyGen",
    "D-ID",
    "Leonardo",
    "Recraft",
    "Runway",
    "Meta Llama",
    "Stripe",
    "Seedance",
    "OmniHuman",
    "OpenAI",
    "Grok Image",
    "Gemini",
    "Veo",
    "Replicate",
    "Wan",
    "Kling",
    "Hailuo",
    "MiniMax Music",
    "MiniMax Speech",
    "Luma",
    "PixVerse",
    "Moises",
    "Hermes local",
    "ComfyUI local"
  ];
  const balances = await Promise.all(names.map(readProviderCredit));
  return balances.map((item) => ({
    ...item,
    checkedAt: new Date().toISOString()
  }));
}

async function refreshProviderDiagnostic(providerName) {
  const provider = providerName === "Replicate" ? "Replicate" : normalizeProviderName(providerName);
  if (provider === "Runway") {
    if (!hasEnvValue("RUNWAY_API_KEY")) {
      return setProviderDiagnostic("Runway", {
        status: "PROVIDER_AUTH_FAILED",
        errorName: "PROVIDER_AUTH_FAILED",
        errorCode: "SLT-1103",
        customerMessage: SLT_ERROR_BY_NAME.PROVIDER_AUTH_FAILED.customerMessage,
        metadata: { source: "provider_health_check", credentialPresent: false }
      });
    }
    const result = await providerCreditFetch("Runway", `${(process.env.RUNWAY_API_URL || "https://api.dev.runwayml.com/v1").replace(/\/$/, "")}/organization`, {
      headers: {
        Authorization: `Bearer ${process.env.RUNWAY_API_KEY}`,
        "X-Runway-Version": process.env.RUNWAY_API_VERSION || "2024-11-06"
      }
    });
    const balance = Number(result.data?.creditBalance ?? 0);
    if (result.ok && balance > 0) {
      return setProviderDiagnostic("Runway", {
        status: "AVAILABLE",
        errorName: null,
        errorCode: null,
        customerMessage: "Provider available.",
        metadata: { source: "provider_health_check", balancePositive: true, httpStatus: result.status }
      });
    }
    const classification = classifySltError({
      statusCode: result.status,
      message: result.data?.error?.message || result.data?.message || result.error || (result.ok ? "Provider balance is zero." : "Runway health check failed.")
    }, { provider: "Runway", operation: "organization_balance" });
    const noBalance = result.ok || classification.name === "PROVIDER_NO_CREDITS";
    return setProviderDiagnostic("Runway", {
      status: noBalance ? "PROVIDER_NO_CREDITS" : classification.name,
      errorName: noBalance ? "PROVIDER_NO_CREDITS" : classification.name,
      errorCode: noBalance ? "SLT-1002" : classification.code,
      customerMessage: noBalance
        ? "Temporarily unavailable — provider balance required."
        : classification.customerMessage,
      metadata: { source: "provider_health_check", balancePositive: false, httpStatus: result.status }
    });
  }

  if (provider === "Replicate") {
    const enabled = envFlag("REPLICATE_PROVIDER_AVAILABLE", false) || envFlag("REPLICATE_BILLING_ACTIVE", false);
    return setProviderDiagnostic("Replicate", {
      status: enabled ? "AVAILABLE" : "PROVIDER_BILLING_REQUIRED",
      errorName: enabled ? null : "PROVIDER_BILLING_REQUIRED",
      errorCode: enabled ? null : "SLT-1003",
      customerMessage: enabled ? "Provider available." : "Temporarily unavailable — provider billing required.",
      metadata: { source: "provider_health_check", billingEnabled: enabled }
    });
  }

  const status = providerStatus(provider);
  return setProviderDiagnostic(provider, {
    status: status.connected ? "AVAILABLE" : status.status,
    errorName: status.errorName || null,
    errorCode: status.errorCode || null,
    customerMessage: status.message,
    metadata: { source: "provider_health_check" }
  });
}

function appendStripeParam(params, key, value) {
  if (value === undefined || value === null || value === "") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => appendStripeParam(params, `${key}[${index}]`, item));
    return;
  }
  if (typeof value === "object") {
    Object.entries(value).forEach(([childKey, childValue]) => appendStripeParam(params, `${key}[${childKey}]`, childValue));
    return;
  }
  params.append(key, String(value));
}

async function stripeRequest(pathname, params = {}) {
  if (!hasEnvValue("STRIPE_SECRET_KEY")) {
    const error = new Error("Stripe setup required. Add STRIPE_SECRET_KEY in .env.");
    error.code = "stripe_setup_required";
    throw error;
  }
  const form = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => appendStripeParam(form, key, value));
  const response = await fetch(`https://api.stripe.com${pathname}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: form
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.error?.message || `${response.status} ${response.statusText}`;
    const error = new Error(message);
    error.code = data.error?.code || data.error?.type || "stripe_error";
    throw error;
  }
  return data;
}

function stripePlanKey(plan = "", interval = "monthly") {
  const normalizedPlan = String(plan || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  const normalizedInterval = String(interval || "monthly").toLowerCase().startsWith("year") ? "YEARLY" : "MONTHLY";
  return `STRIPE_PRICE_${normalizedPlan}_${normalizedInterval}`;
}

function stripePriceIdFor(plan = "", interval = "monthly") {
  return process.env[stripePlanKey(plan, interval)] || "";
}

function stripePlanStatus() {
  const planNames = ["Creator", "Pro", "Studio", "Business", "Enterprise"];
  return planNames.map((plan) => ({
    plan,
    monthlyEnv: stripePlanKey(plan, "monthly"),
    monthlyConfigured: Boolean(stripePriceIdFor(plan, "monthly")),
    yearlyEnv: stripePlanKey(plan, "yearly"),
    yearlyConfigured: Boolean(stripePriceIdFor(plan, "yearly"))
  }));
}

function stripeCreditPackStatus() {
  return Object.values(creditPackCatalog).map((pack) => ({
    id: pack.id,
    name: pack.name,
    credits: pack.credits,
    price: pack.price,
    envKey: pack.envKey,
    configured: Boolean(process.env[pack.envKey])
  }));
}

function creditPackById(packId = "") {
  return creditPackCatalog[packId] || null;
}

function stripeCreditPackPriceId(packId = "") {
  const pack = creditPackById(packId);
  return pack ? process.env[pack.envKey] || "" : "";
}

function envFlag(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function stripeAutomaticTaxEnabled() {
  return envFlag("STRIPE_AUTOMATIC_TAX_ENABLED", false);
}

function stripeReturnUrl(kind = "success") {
  if (kind === "cancel") return process.env.STRIPE_CANCEL_URL || "http://127.0.0.1:4173/?stripe=cancel";
  return process.env.STRIPE_SUCCESS_URL || "http://127.0.0.1:4173/?stripe=success";
}

function currentStripeCustomerId() {
  return state.billing.stripeCustomerId || state.subscription.stripeCustomerId || process.env.STRIPE_CUSTOMER_ID || "";
}

function stripeSetupStatus() {
  return {
    secretKeyPresent: hasEnvValue("STRIPE_SECRET_KEY"),
    webhookSecretPresent: hasEnvValue("STRIPE_WEBHOOK_SECRET"),
    publishableKeyPresent: hasEnvValue("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"),
    customerIdPresent: Boolean(currentStripeCustomerId()),
    automaticTaxEnabled: stripeAutomaticTaxEnabled(),
    prices: stripePlanStatus(),
    creditPacks: stripeCreditPackStatus()
  };
}

function stripeSetupError(message, code = "stripe_setup_required") {
  const error = new Error(message);
  error.code = code;
  return error;
}

function verifyStripeWebhookSignature(rawBody, signatureHeader, secret) {
  const parts = Object.fromEntries(String(signatureHeader).split(",").map((part) => {
    const [key, value] = part.split("=");
    return [key, value];
  }));
  const timestamp = parts.t;
  const signatures = String(signatureHeader)
    .split(",")
    .filter((part) => part.startsWith("v1="))
    .map((part) => part.slice(3));
  if (!timestamp || !signatures.length) throw new Error("Missing Stripe signature.");

  const timestampSeconds = Number(timestamp);
  const toleranceSeconds = envNumber("STRIPE_WEBHOOK_TOLERANCE_SECONDS", 300);
  if (!Number.isFinite(timestampSeconds) || Math.abs(Date.now() / 1000 - timestampSeconds) > toleranceSeconds) {
    throw new Error("Stripe signature timestamp outside tolerance.");
  }

  const payload = `${timestamp}.${rawBody.toString("utf8")}`;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  const matched = signatures.some((signature) => {
    const signatureBuffer = Buffer.from(signature, "hex");
    return signatureBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
  });
  if (!matched) throw new Error("Invalid Stripe signature.");
}

function allowUnsignedStripeWebhook(request) {
  const allowed = envFlag("STRIPE_WEBHOOK_ALLOW_UNSIGNED", false) || envFlag("ALLOW_UNSIGNED_STRIPE_WEBHOOKS", false);
  const productionAllowed = envFlag("STRIPE_WEBHOOK_ALLOW_UNSIGNED_IN_PRODUCTION", false);
  const host = String(request.header("host") || "");
  const localHost = /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host);
  return Boolean(allowed && (localHost || process.env.NODE_ENV !== "production" || productionAllowed));
}

function stripeRawBody(request) {
  if (Buffer.isBuffer(request.body)) return request.body;
  if (Buffer.isBuffer(request.rawBody)) return request.rawBody;
  if (typeof request.body === "string") return Buffer.from(request.body, "utf8");
  return Buffer.from(JSON.stringify(request.body || {}), "utf8");
}

function stripeEventKey(event = {}) {
  const object = event.data?.object || {};
  return `stripe:${event.id || `${event.type || "event"}:${object.id || object.subscription || object.customer || "unknown"}`}`;
}

function stripeLineItems(object = {}) {
  const direct = object.lines?.data || object.line_items?.data || object.display_items || [];
  return Array.isArray(direct) ? direct : [];
}

function planFromStripePriceId(priceId = "") {
  if (!priceId) return "";
  for (const plan of Object.keys(planCreditAllowance)) {
    if (stripePriceIdFor(plan, "monthly") === priceId || stripePriceIdFor(plan, "yearly") === priceId) return plan;
  }
  return "";
}

function planFromStripeObject(object = {}) {
  const line = stripeLineItems(object).find((item) => item?.metadata?.plan || item?.price?.id || item?.plan?.id) || {};
  const priceId = line.price?.id || line.plan?.id || object.price?.id || "";
  return object.metadata?.plan
    || object.subscription_details?.metadata?.plan
    || line.metadata?.plan
    || planFromStripePriceId(priceId)
    || state.subscription.plan
    || "Free";
}

function creditPackFromStripeObject(object = {}) {
  const line = stripeLineItems(object).find((item) => item?.metadata?.creditPackId || item?.price?.id) || {};
  const packId = object.metadata?.creditPackId || line.metadata?.creditPackId || "";
  if (packId) return creditPackById(packId);
  const priceId = line.price?.id || object.price?.id || "";
  return Object.values(creditPackCatalog).find((pack) => process.env[pack.envKey] === priceId) || null;
}

function recordStripePaymentEvent(event, result = {}) {
  const object = event.data?.object || {};
  const tenantId = stripeTenantIdFromObject(object);
  state.paymentEvents.unshift({
    id: event.id || result.eventKey,
    eventKey: result.eventKey,
    type: event.type || "unknown",
    objectId: object.id || null,
    status: result.idempotent ? "duplicate_ignored" : "processed",
    actions: result.actions || [],
    tenantId,
    wallet: result.wallet || ledgerSnapshot(tenantId),
    receivedAt: new Date().toISOString()
  });
  state.paymentEvents = state.paymentEvents.slice(0, 100);
}

async function handleStripeWebhook(request, response) {
  const rawBody = stripeRawBody(request);
  const signature = request.header("Stripe-Signature") || "";
  const unsignedAllowed = allowUnsignedStripeWebhook(request);

  if (!hasEnvValue("STRIPE_WEBHOOK_SECRET") && !unsignedAllowed) {
    response.status(503).json({
      ok: false,
      code: "stripe_webhook_not_configured",
      error: "Stripe webhook secret is missing."
    });
    return;
  }

  try {
    if (!unsignedAllowed) {
      verifyStripeWebhookSignature(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
    }
    const event = JSON.parse(rawBody.toString("utf8"));
    const result = await applyStripeWebhookEvent(event);
    response.json({
      ok: true,
      received: true,
      verified: !unsignedAllowed,
      idempotent: result.idempotent,
      actions: result.actions,
      wallet: result.wallet
    });
  } catch (_error) {
    response.status(400).json({
      ok: false,
      code: "stripe_webhook_verification_failed",
      error: "Stripe webhook verification failed."
    });
  }
}

function stripeTenantIdFromObject(object = {}) {
  return String(
    object.metadata?.tenantId ||
    object.metadata?.tenant_id ||
    object.subscription_details?.metadata?.tenantId ||
    object.subscription_details?.metadata?.tenant_id ||
    object.client_reference_id ||
    object.metadata?.userId ||
    state.wallet.tenantId
  );
}

async function applyStripeWebhookEvent(event = {}) {
  const object = event.data?.object || {};
  const eventKey = stripeEventKey(event);
  const tenantId = stripeTenantIdFromObject(object);
  if (processedWebhookEvents.has(eventKey)) {
    const result = { idempotent: true, eventKey, actions: ["duplicate_ignored"], wallet: ledgerSnapshot(tenantId) };
    recordStripePaymentEvent(event, result);
    return result;
  }

  processedWebhookEvents.add(eventKey);
  const actions = [];

  try {
    if (["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(event.type)) {
      const paymentStatus = object.payment_status || "paid";
      const paymentConfirmed = ["paid", "no_payment_required"].includes(paymentStatus) || object.mode === "subscription";
      if (!paymentConfirmed) {
        actions.push("checkout_not_paid_yet");
      } else if (object.metadata?.type === "credit_pack") {
        const pack = creditPackFromStripeObject(object);
        const credits = Number(object.metadata?.credits || pack?.credits || 0);
        if (credits > 0) {
          const ledgerResult = await grantCreditsTransactional({
            amount: credits,
            tenantId,
            userId: object.metadata?.userId || null,
            idempotencyKey: `stripe:checkout:${object.id}:credit_pack`,
            reason: "credit_pack_purchase",
            metadata: { eventId: event.id || "", stripeSessionId: object.id, packId: pack?.id || object.metadata?.creditPackId || "" }
          });
          actions.push(ledgerResult.idempotent ? "credit_pack_duplicate" : "credit_pack_granted");
        }
        state.billing.stripeCustomerId = object.customer || state.billing.stripeCustomerId;
        state.subscription.stripeCustomerId = object.customer || state.subscription.stripeCustomerId;
        saveHistory({
          id: requestId("credits"),
          kind: "billing",
          title: `Credit pack purchased: ${pack?.name || "extra credits"}`,
          provider: "Stripe",
          status: "paid",
          message: `${credits} extra credits added to the workspace.`,
          creditsAdded: credits,
          createdAt: new Date().toISOString()
        });
      } else {
        const plan = planFromStripeObject(object);
        state.billing.stripeCustomerId = object.customer || state.billing.stripeCustomerId;
        state.subscription.stripeCustomerId = object.customer || state.subscription.stripeCustomerId;
        state.subscription.stripeSubscriptionId = object.subscription || state.subscription.stripeSubscriptionId;
        state.subscription.plan = plan;
        state.subscription.status = "active";
        state.user.plan = plan;
        const ledgerResult = await adjustAvailableCreditsTransactional({
          targetAmount: creditsForPlan(plan),
          tenantId,
          userId: object.metadata?.userId || null,
          idempotencyKey: `stripe:checkout:${object.id}:subscription_allowance`,
          reason: "subscription_plan_credit_reset",
          metadata: { eventId: event.id || "", stripeSessionId: object.id, stripeSubscriptionId: object.subscription || "", plan }
        });
        actions.push(ledgerResult.idempotent ? "subscription_allowance_duplicate" : "subscription_allowance_applied");
        saveHistory({
          id: requestId("billing"),
          kind: "billing",
          title: "Stripe checkout completed",
          provider: "Stripe",
          status: "paid",
          message: "Stripe checkout completed and subscription state updated.",
          createdAt: new Date().toISOString()
        });
      }
      if (paymentConfirmed) {
        const redeemedCoupon = markCompensationCouponRedeemed(object);
        if (redeemedCoupon) actions.push("compensation_coupon_redeemed");
      }
    }

    if (event.type === "customer.subscription.deleted") {
      state.subscription.status = "cancelled";
      actions.push("subscription_cancelled");
      saveHistory({
        id: requestId("subscription"),
        kind: "subscription",
        title: "Stripe subscription cancelled",
        provider: "Stripe",
        status: "cancelled",
        message: "Stripe reported subscription cancellation.",
        createdAt: new Date().toISOString()
      });
    }

    if (event.type === "invoice.payment_failed") {
      state.billing.failedPayment = {
        amount: object.amount_due ? `$${(object.amount_due / 100).toFixed(2)}` : state.billing.failedPayment.amount,
        message: "Stripe reported a failed payment. Ask the customer to update their payment method."
      };
      actions.push("invoice_failed_recorded");
      saveHistory({
        id: requestId("billing"),
        kind: "billing",
        title: "Stripe payment failed",
        provider: "Stripe",
        status: "failed",
        message: state.billing.failedPayment.message,
        createdAt: new Date().toISOString()
      });
    }

    if (["invoice.paid", "invoice.payment_succeeded"].includes(event.type)) {
      const plan = planFromStripeObject(object);
      const amountPaid = object.amount_paid ?? object.total ?? 0;
      state.billing.invoices.unshift({
        id: object.number || object.id || requestId("invoice"),
        amount: amountPaid ? `$${(amountPaid / 100).toFixed(2)}` : "$0.00",
        status: "paid",
        date: new Date((object.created || Date.now() / 1000) * 1000).toISOString().slice(0, 10)
      });
      state.billing.invoices = state.billing.invoices.slice(0, 20);
      if (object.subscription || plan !== "Free") {
        state.subscription.plan = plan;
        state.subscription.status = "active";
        state.subscription.stripeSubscriptionId = object.subscription || state.subscription.stripeSubscriptionId;
        state.user.plan = plan;
        const periodStart = object.lines?.data?.[0]?.period?.start || object.period_start || object.created || "current";
        const ledgerResult = await adjustAvailableCreditsTransactional({
          targetAmount: creditsForPlan(plan),
          tenantId,
          userId: object.metadata?.userId || null,
          idempotencyKey: `stripe:invoice:${object.id || event.id}:${periodStart}:subscription_allowance`,
          reason: "subscription_invoice_credit_reset",
          metadata: { eventId: event.id || "", invoiceId: object.id || "", stripeSubscriptionId: object.subscription || "", plan, periodStart }
        });
        actions.push(ledgerResult.idempotent ? "invoice_allowance_duplicate" : "invoice_allowance_applied");
      } else {
        actions.push("invoice_recorded");
      }
    }

    const result = { idempotent: false, eventKey, actions, wallet: ledgerSnapshot(tenantId) };
    recordStripePaymentEvent(event, result);
    return result;
  } catch (error) {
    processedWebhookEvents.delete(eventKey);
    throw error;
  }
}

async function postBinary(url, { headers = {}, body = {}, timeoutMs = 60000 }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!response.ok) {
      const text = await response.text();
      const error = new Error(text || `${response.status} ${response.statusText}`);
      error.statusCode = response.status;
      error.code = `provider_http_${response.status}`;
      error.providerBody = { message: text.slice(0, 1200) };
      throw error;
    }
    const arrayBuffer = await response.arrayBuffer();
    const contentType = response.headers.get("content-type") || "application/octet-stream";
    return {
      contentType,
      base64: Buffer.from(arrayBuffer).toString("base64")
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function postFormJson(url, { headers = {}, fields = {}, timeoutMs = 60000 }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const form = new FormData();
    Object.entries(fields).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") form.append(key, String(value));
    });
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: form,
      signal: controller.signal
    });
    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch (_error) {
      data = { raw: text };
    }
    if (!response.ok) {
      const message = data.errors?.join(", ") || data.error?.message || data.message || data.raw || `${response.status} ${response.statusText}`;
      const error = new Error(message);
      error.statusCode = response.status;
      error.code = data.error?.code || data.code || `provider_http_${response.status}`;
      error.providerBody = data;
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

async function postFormBinary(url, { headers = {}, fields = {}, timeoutMs = 120000 }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const form = new FormData();
    Object.entries(fields).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") form.append(key, String(value));
    });
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: form,
      signal: controller.signal
    });
    if (!response.ok) {
      const text = await response.text();
      let data = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch (_error) {
        data = { raw: text };
      }
      const message = data.errors?.join(", ") || data.error?.message || data.message || data.raw || `${response.status} ${response.statusText}`;
      const error = new Error(message);
      error.statusCode = response.status;
      error.code = data.error?.code || data.code || `provider_http_${response.status}`;
      error.providerBody = data;
      throw error;
    }
    const arrayBuffer = await response.arrayBuffer();
    const contentType = response.headers.get("content-type") || "audio/mpeg";
    return {
      contentType,
      base64: Buffer.from(arrayBuffer).toString("base64")
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function callOpenAIImage({ prompt, title }) {
  const data = await postJson("https://api.openai.com/v1/images/generations", {
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: {
      model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-2",
      prompt: prompt || title || "Create a cinematic black neon studio image.",
      size: process.env.OPENAI_IMAGE_SIZE || "1024x1024"
    }
  });
  const first = data.data?.[0] || {};
  return {
    providerJobId: data.id || null,
    previewUrl: first.url || (first.b64_json ? `data:image/png;base64,${first.b64_json}` : null),
    raw: data
  };
}

function geminiImageEndpoint() {
  if (hasEnvValue("GEMINI_IMAGE_INTERACTIONS_API_URL")) return process.env.GEMINI_IMAGE_INTERACTIONS_API_URL;
  const configured = process.env.GEMINI_IMAGE_API_URL || process.env.GEMINI_API_URL || "https://generativelanguage.googleapis.com/v1beta";
  try {
    const parsed = new URL(configured);
    return `${parsed.origin}/v1beta/interactions`;
  } catch {
    return "https://generativelanguage.googleapis.com/v1beta/interactions";
  }
}

function extractGeminiImageResult(data = {}) {
  const interactionParts = (Array.isArray(data.steps) ? data.steps : [])
    .filter((step) => step?.type === "model_output")
    .flatMap((step) => step.content || []);
  const candidates = Array.isArray(data.candidates) ? data.candidates : [];
  const parts = [
    ...interactionParts,
    ...candidates.flatMap((candidate) => candidate.content?.parts || [])
  ];
  const imagePart = parts.find((part) => part.type === "image" || part.inlineData?.data || part.inline_data?.data);
  const inlineData = imagePart?.inlineData || imagePart?.inline_data || null;
  const imageData = imagePart?.data || inlineData?.data || "";
  const mimeType = imagePart?.mime_type || imagePart?.mimeType || inlineData?.mimeType || inlineData?.mime_type || "image/jpeg";
  const textPart = parts.find((part) => part.type === "text" || part.text)?.text || data.output_text || data.promptFeedback?.blockReasonMessage || "";
  return {
    previewUrl: imageData ? `data:${mimeType};base64,${imageData}` : null,
    responseText: textPart,
    raw: data
  };
}

async function geminiImageReferenceParts(payload = {}) {
  const ids = Array.isArray(payload.referenceAssetIds) ? payload.referenceAssetIds.slice(0, 4) : [];
  const parts = [];
  for (const assetId of ids) {
    const asset = state.assets.find((item) => item.id === assetId);
    if (!asset || !String(asset.contentType || "").startsWith("image/")) continue;
    const source = await bytesForInputAsset(asset, asset.publicUrl);
    if (source.bytes.length > 20 * 1024 * 1024) continue;
    parts.push({
      type: "image",
      mime_type: asset.contentType || source.contentType || "image/png",
      data: source.bytes.toString("base64")
    });
  }
  return parts;
}

async function callGeminiImage({ prompt, title, payload = {} }) {
  const referenceParts = await geminiImageReferenceParts(payload);
  const model = process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image";
  const request = {
    headers: { "x-goog-api-key": process.env.GEMINI_API_KEY },
    body: {
      model,
      input: [
        ...referenceParts,
        {
          type: "text",
          text: prompt || title || "Create a cinematic futuristic garage studio image for Sweet Little Trauma."
        }
      ],
      response_format: {
        type: "image",
        mime_type: "image/jpeg",
        aspect_ratio: process.env.GEMINI_IMAGE_ASPECT_RATIO || "1:1",
        image_size: process.env.GEMINI_IMAGE_SIZE || "1K"
      }
    },
    timeoutMs: 90000
  };
  const maxAttempts = Math.max(1, Math.min(4, envNumber("GEMINI_IMAGE_MAX_ATTEMPTS", 3)));
  let data = null;
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      data = await postJson(geminiImageEndpoint(), request);
      break;
    } catch (error) {
      lastError = error;
      const status = Number(error?.statusCode || 0);
      const code = String(error?.code || "").toLowerCase();
      const message = String(error?.message || "").toLowerCase();
      const retryable = status === 429 || status >= 500 || code === "api_error" || message.includes("high demand") || message.includes("internal error");
      if (!retryable || attempt === maxAttempts) throw error;
      const delayMs = attempt * envNumber("GEMINI_IMAGE_RETRY_DELAY_MS", 5000);
      await new Promise((resolveRetry) => setTimeout(resolveRetry, delayMs));
    }
  }
  if (!data) throw lastError || new Error("Gemini image generation returned no response.");
  const result = extractGeminiImageResult(data);
  return {
    providerJobId: data.id || data.responseId || null,
    previewUrl: result.previewUrl,
    responseText: result.responseText,
    raw: result.raw
  };
}

function geminiTextEndpoint() {
  if (hasEnvValue("GEMINI_TEXT_API_URL")) return process.env.GEMINI_TEXT_API_URL;
  const baseUrl = (process.env.GEMINI_API_URL || "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
  const model = process.env.GEMINI_TEXT_MODEL || "gemini-2.0-flash";
  return `${baseUrl}/models/${model}:generateContent`;
}

function extractGeminiTextResult(data = {}) {
  const candidates = Array.isArray(data.candidates) ? data.candidates : [];
  const parts = candidates.flatMap((candidate) => candidate.content?.parts || []);
  const text = parts.map((part) => part.text).filter(Boolean).join("\n\n");
  return text || data.promptFeedback?.blockReasonMessage || "Gemini response ready.";
}

async function callGeminiText({ prompt, title }) {
  const data = await postJson(geminiTextEndpoint(), {
    headers: { "x-goog-api-key": process.env.GEMINI_API_KEY },
    body: {
      contents: [
        {
          parts: [
            {
              text: prompt || title || "Ayudame a planificar una idea creativa para Sweet Little Trauma Studio."
            }
          ]
        }
      ]
    },
    timeoutMs: 90000
  });
  return {
    providerJobId: data.responseId || null,
    responseText: extractGeminiTextResult(data),
    raw: data
  };
}

function replicateBaseUrl() {
  const configured = process.env.REPLICATE_API_URL || "";
  const imageEndpoint = process.env.REPLICATE_IMAGE_API_URL || process.env.STABLE_DIFFUSION_API_URL || "";
  const source = configured || imageEndpoint || "https://api.replicate.com/v1";
  return source.replace(/\/predictions\/?$/, "").replace(/\/$/, "");
}

function replicateModelForProvider(providerName = "") {
  const lower = providerName.toLowerCase();
  if (lower.includes("stable")) {
    return process.env.REPLICATE_STABLE_DIFFUSION_MODEL || "stability-ai/sdxl";
  }
  return process.env.REPLICATE_FLUX_MODEL || process.env.REPLICATE_IMAGE_MODEL || "black-forest-labs/flux-schnell";
}

function firstUrlFromReplicateOutput(output) {
  if (!output) return null;
  if (typeof output === "string") return output;
  if (Array.isArray(output)) {
    for (const item of output) {
      const url = firstUrlFromReplicateOutput(item);
      if (url) return url;
    }
  }
  if (typeof output === "object") {
    return (
      firstUrlFromReplicateOutput(output.url) ||
      firstUrlFromReplicateOutput(output.image) ||
      firstUrlFromReplicateOutput(output.images) ||
      firstUrlFromReplicateOutput(output.output) ||
      null
    );
  }
  return null;
}

function replicateImageInput({ prompt, title, payload = {} }) {
  const input = {
    prompt: prompt || title || "Create a cinematic futuristic garage studio image for Sweet Little Trauma."
  };
  const aspectRatio = payload.aspectRatio || payload.aspect_ratio || process.env.REPLICATE_IMAGE_ASPECT_RATIO || "1:1";
  const outputFormat = payload.outputFormat || payload.output_format || process.env.REPLICATE_IMAGE_OUTPUT_FORMAT || "png";
  const outputQuality = Number(payload.outputQuality || payload.output_quality || process.env.REPLICATE_IMAGE_OUTPUT_QUALITY || 90);
  if (aspectRatio) input.aspect_ratio = aspectRatio;
  if (outputFormat) input.output_format = outputFormat;
  if (Number.isFinite(outputQuality)) input.output_quality = outputQuality;
  return input;
}

function assertPublicWebhookUrl(webhookUrl = "") {
  if (!webhookUrl) return;
  let parsed;
  try {
    parsed = new URL(webhookUrl);
  } catch {
    const error = new Error("Replicate webhook URL is invalid.");
    error.code = "replicate_webhook_url_invalid";
    throw error;
  }
  const allowLocal = envFlag("ALLOW_LOCAL_WEBHOOK_URLS", false) || envFlag("ALLOW_INSECURE_WEBHOOK_URLS", false);
  const isLocal = ["localhost", "127.0.0.1", "0.0.0.0"].includes(parsed.hostname);
  if (!allowLocal && (parsed.protocol !== "https:" || isLocal)) {
    const error = new Error("Replicate requires a public HTTPS webhook URL. Set PUBLIC_API_BASE_URL or WEBHOOK_BASE_URL to a public HTTPS domain/tunnel.");
    error.code = "replicate_webhook_url_not_public";
    error.statusCode = 503;
    throw error;
  }
}

async function callReplicateImage({ prompt, title, providerName, payload = {} }) {
  const webhookUrl = payload.webhookUrl || payload.webhook_url || payload.callbackUrl || payload.callback_url || "";
  if (webhookUrl) assertPublicWebhookUrl(webhookUrl);
  const data = await postJson(`${replicateBaseUrl()}/predictions`, {
    headers: {
      Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
      ...(webhookUrl ? {} : { Prefer: "wait=60" })
    },
    body: {
      version: replicateModelForProvider(providerName),
      input: replicateImageInput({ prompt, title, payload }),
      ...(webhookUrl ? { webhook: webhookUrl, webhook_events_filter: ["completed"] } : {})
    },
    timeoutMs: 90000
  });
  const outputUrl = firstUrlFromReplicateOutput(data.output);
  return {
    providerJobId: data.id || null,
    status: data.status || "processing",
    previewUrl: outputUrl,
    outputUrl,
    outputUrls: outputUrl ? [outputUrl] : [],
    webhookUrl,
    note: data.status === "succeeded" ? "Replicate image completed." : "Replicate image submitted; waiting for provider webhook.",
    raw: data
  };
}

function replicateModelEndpoint(model) {
  return `${replicateBaseUrl()}/models/${model}/predictions`;
}

async function callReplicateModel({ model, input, timeoutMs = 120000, webhookUrl = "", prefer = "wait=60" }) {
  return postJson(replicateModelEndpoint(model), {
    headers: {
      Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
      ...(prefer ? { Prefer: prefer } : {})
    },
    body: {
      input,
      ...(webhookUrl ? { webhook: webhookUrl, webhook_events_filter: ["completed"] } : {})
    },
    timeoutMs
  });
}

async function callReplicateWanVideo({ prompt, title, payload = {} }) {
  const data = await callReplicateModel({
    model: process.env.WAN_REPLICATE_MODEL || "wavespeedai/wan-2.1-t2v-480p",
    input: {
      prompt: prompt || title || "Sweet Little Trauma Studio cinematic video.",
      aspect_ratio: videoAspectRatio(payload, process.env.WAN_ASPECT_RATIO || "16:9"),
      duration: videoClipDuration(payload, "Wan", 5),
      fast_mode: process.env.WAN_FAST_MODE || "Balanced",
      sample_steps: Number(process.env.WAN_SAMPLE_STEPS || 30),
      sample_guide_scale: Number(process.env.WAN_GUIDANCE_SCALE || 5),
      negative_prompt: process.env.WAN_NEGATIVE_PROMPT || ""
    },
    timeoutMs: 180000,
    webhookUrl: payload.webhookUrl || payload.webhook_url || payload.callbackUrl || payload.callback_url || ""
  });
  return {
    providerJobId: data.id || null,
    status: data.status || "processing",
    previewUrl: firstUrlFromReplicateOutput(data.output),
    note: data.status === "succeeded" ? "Wan video completed on Replicate." : "Wan video submitted on Replicate.",
    raw: data
  };
}

async function callReplicateMusicGen({ prompt, title, payload = {} }) {
  const data = await callReplicateModel({
    model: process.env.AUDIOCRAFT_REPLICATE_MODEL || "meta/musicgen",
    input: {
      prompt: prompt || title || "cinematic alternative pop, futuristic garage studio, emotional",
      duration: Number(process.env.AUDIOCRAFT_DURATION || 8),
      model_version: process.env.AUDIOCRAFT_MODEL_VERSION || "stereo-melody-large",
      output_format: process.env.AUDIOCRAFT_OUTPUT_FORMAT || "wav",
      temperature: Number(process.env.AUDIOCRAFT_TEMPERATURE || 1),
      classifier_free_guidance: Number(process.env.AUDIOCRAFT_GUIDANCE || 3)
    },
    timeoutMs: 180000,
    webhookUrl: payload.webhookUrl || payload.webhook_url || payload.callbackUrl || payload.callback_url || ""
  });
  return {
    providerJobId: data.id || null,
    status: data.status || "processing",
    previewUrl: firstUrlFromReplicateOutput(data.output),
    note: data.status === "succeeded" ? "AudioCraft / MusicGen completed on Replicate." : "AudioCraft / MusicGen submitted on Replicate.",
    raw: data
  };
}

async function callReplicateRiffusion({ prompt, title, payload = {} }) {
  const data = await callReplicateModel({
    model: process.env.RIFFUSION_REPLICATE_MODEL || "riffusion/riffusion",
    input: {
      prompt_a: prompt || title || "cinematic futuristic synth theme",
      prompt_b: process.env.RIFFUSION_PROMPT_B || "",
      alpha: Number(process.env.RIFFUSION_ALPHA || 0.5),
      denoising: Number(process.env.RIFFUSION_DENOISING || 0.75),
      seed_image_id: process.env.RIFFUSION_SEED_IMAGE_ID || "vibes",
      num_inference_steps: Number(process.env.RIFFUSION_STEPS || 50)
    },
    timeoutMs: 180000,
    webhookUrl: payload.webhookUrl || payload.webhook_url || payload.callbackUrl || payload.callback_url || ""
  });
  return {
    providerJobId: data.id || null,
    status: data.status || "processing",
    previewUrl: firstUrlFromReplicateOutput(data.output),
    note: data.status === "succeeded" ? "Riffusion completed on Replicate." : "Riffusion submitted on Replicate.",
    raw: data
  };
}

function stabilityImageEndpoint() {
  return (
    process.env.STABILITY_IMAGE_API_URL ||
    `${(process.env.STABILITY_API_URL || "https://api.stability.ai").replace(/\/$/, "")}/v2beta/stable-image/generate/core`
  );
}

async function callStabilityImage({ prompt, title }) {
  const data = await postFormJson(stabilityImageEndpoint(), {
    headers: {
      Authorization: `Bearer ${process.env.STABILITY_API_KEY}`,
      Accept: "application/json"
    },
    fields: {
      prompt: prompt || title || "Create a cinematic futuristic garage studio image for Sweet Little Trauma.",
      output_format: process.env.STABILITY_IMAGE_FORMAT || "png"
    },
    timeoutMs: 90000
  });
  return {
    providerJobId: data.id || null,
    previewUrl: data.image ? `data:image/${process.env.STABILITY_IMAGE_FORMAT || "png"};base64,${data.image}` : null,
    raw: data
  };
}

function stabilityAudioEndpoint() {
  const configured =
    process.env.STABILITY_AUDIO_API_URL ||
    process.env.STABLE_AUDIO_API_URL ||
    process.env.STABILITY_API_URL ||
    "https://api.stability.ai";
  const baseUrl = configured.replace(/\/$/, "");
  if (baseUrl.includes("/v2beta/audio/")) return baseUrl;
  return `${baseUrl}/v2beta/audio/stable-audio-2/text-to-audio`;
}

function requestedAudioDuration(payload = {}, fallback = 30) {
  const requested = Number(
    payload.durationSeconds ||
    payload.audioDurationSeconds ||
    payload.musicDurationSeconds ||
    payload.duration ||
    fallback
  );
  return Math.min(180, Math.max(1, Number.isFinite(requested) ? requested : fallback));
}

async function callStabilityAudio({ prompt, title, payload = {} }) {
  const apiKey = process.env.STABILITY_AUDIO_API_KEY || process.env.STABLE_AUDIO_API_KEY || process.env.STABILITY_API_KEY;
  const outputFormat = process.env.STABILITY_AUDIO_FORMAT || process.env.STABLE_AUDIO_FORMAT || "mp3";
  const audio = await postFormBinary(stabilityAudioEndpoint(), {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "audio/*"
    },
    fields: {
      prompt: prompt || title || "A cinematic futuristic garage studio theme for Sweet Little Trauma.",
      duration: requestedAudioDuration(
        payload,
        Number(process.env.STABILITY_AUDIO_DURATION || process.env.STABLE_AUDIO_DURATION || 30)
      ),
      output_format: outputFormat
    },
    timeoutMs: 180000
  });
  return {
    previewUrl: `data:${audio.contentType};base64,${audio.base64}`,
    note: "Stability Audio completed.",
    raw: {
      contentType: audio.contentType
    }
  };
}

function xaiImageEndpoint() {
  const baseUrl = (process.env.XAI_API_URL || process.env.XAI_API_BASE_URL || process.env.XAI_BASE_URL || process.env.GROK_API_URL || "https://api.x.ai/v1").replace(/\/$/, "");
  return `${baseUrl}/images/generations`;
}

function xaiApiKey() {
  return process.env.XAI_API_KEY || process.env.XAI_API || process.env.GROK_API_KEY || "";
}

async function callXAIImage({ prompt, title }) {
  const data = await postJson(xaiImageEndpoint(), {
    headers: { Authorization: `Bearer ${xaiApiKey()}` },
    body: {
      model: process.env.XAI_IMAGE_MODEL || "grok-imagine-image-quality",
      prompt: prompt || title || "Create a cinematic futuristic garage studio image for Sweet Little Trauma.",
      n: Number(process.env.XAI_IMAGE_COUNT || 1),
      aspect_ratio: process.env.XAI_IMAGE_ASPECT_RATIO || "1:1",
      resolution: process.env.XAI_IMAGE_RESOLUTION || "1k"
    },
    timeoutMs: 90000
  });
  const first = data.data?.[0] || {};
  return {
    providerJobId: data.id || null,
    previewUrl: first.url || (first.b64_json ? `data:image/jpeg;base64,${first.b64_json}` : null),
    raw: data
  };
}

function ideogramImageEndpoint() {
  const configured = process.env.IDEOGRAM_API_URL || "https://api.ideogram.ai";
  const baseUrl = configured.replace(/\/$/, "");
  if (baseUrl.endsWith("/generate")) return baseUrl;
  return `${baseUrl}/v1/ideogram-v3/generate`;
}

async function callIdeogramImage({ prompt, title }) {
  const data = await postJson(ideogramImageEndpoint(), {
    headers: { "Api-Key": process.env.IDEOGRAM_API_KEY },
    body: {
      prompt: prompt || title || "Create a cinematic futuristic garage studio image for Sweet Little Trauma.",
      rendering_speed: process.env.IDEOGRAM_RENDERING_SPEED || "TURBO",
      style_type: process.env.IDEOGRAM_STYLE_TYPE || "AUTO"
    },
    timeoutMs: 90000
  });
  const first = data.data?.[0] || {};
  return {
    providerJobId: data.id || first.id || null,
    previewUrl: first.url || null,
    raw: data
  };
}

function recraftImageEndpoint() {
  const configured = (process.env.RECRAFT_IMAGE_API_URL || process.env.RECRAFT_API_URL || "https://external.api.recraft.ai/v1").replace(/\/$/, "");
  if (configured.endsWith("/images/generations")) return configured;
  return `${configured}/images/generations`;
}

async function callRecraftImage({ prompt, title }) {
  const data = await postJson(recraftImageEndpoint(), {
    headers: { Authorization: `Bearer ${process.env.RECRAFT_API_KEY}` },
    body: {
      model: process.env.RECRAFT_MODEL_ID || "recraftv4_1",
      prompt: prompt || title || "Create a cinematic futuristic garage studio image for Sweet Little Trauma.",
      n: Number(process.env.RECRAFT_IMAGE_COUNT || 1),
      response_format: process.env.RECRAFT_RESPONSE_FORMAT || "url"
    },
    timeoutMs: 90000
  });
  const first = data.data?.[0] || {};
  return {
    providerJobId: data.id || first.id || null,
    previewUrl: first.url || (first.b64_json ? `data:image/png;base64,${first.b64_json}` : null),
    raw: data
  };
}

async function callLeonardoImage({ prompt, title }) {
  const baseUrl = (process.env.LEONARDO_API_URL || "https://cloud.leonardo.ai/api/rest/v1").replace(/\/$/, "");
  const modelId = process.env.LEONARDO_MODEL_ID || "de7d3faf-762f-48e0-b3b7-9d0ac3a3fcf3";
  const data = await postJson(`${baseUrl}/generations`, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${process.env.LEONARDO_API_KEY}`
    },
    body: {
      alchemy: false,
      height: 1024,
      width: 1024,
      modelId,
      num_images: 1,
      prompt: prompt || title || "Create a cinematic black neon studio image.",
      public: false
    }
  });
  const generationId =
    data.sdGenerationJob?.generationId ||
    data.generationId ||
    data.id ||
    null;
  return {
    providerJobId: generationId,
    status: generationId ? "processing" : "submitted",
    previewUrl: null,
    note: generationId
      ? "Leonardo generation submitted. Polling/output retrieval will use the generation id."
      : "Leonardo generation submitted.",
    raw: data
  };
}

async function callOpenAIResponses({ prompt, title }) {
  const data = await postJson("https://api.openai.com/v1/responses", {
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: {
      model: process.env.OPENAI_TEXT_MODEL || "gpt-4.1-mini",
      input: prompt || title || "Help me create inside Sweet Little Trauma Studio."
    }
  });
  return {
    responseText: extractOpenAIText(data),
    providerJobId: data.id || null,
    raw: data
  };
}

async function callOpenRouterHermes({ prompt, title }) {
  const baseUrl = (process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/$/, "");
  const model = process.env.CEO_HERMES_MODEL || "nousresearch/hermes-3-llama-3.1-405b";
  const data = await postJson(`${baseUrl}/chat/completions`, {
    headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
    body: {
      model,
      messages: [
        {
          role: "system",
          content: "You are Hermes inside Sweet Little Trauma Studio CEO mode. Help with private strategic, creative and operational work. Do not expose secrets."
        },
        {
          role: "user",
          content: prompt || title || "Help me work in CEO mode."
        }
      ]
    }
  });
  return {
    responseText: extractChatText(data),
    providerJobId: data.id || null,
    raw: data
  };
}

async function callOpenRouterChat({ prompt, title, providerName }) {
  const baseUrl = (process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/$/, "");
  const model = process.env.OPENROUTER_META_MODEL || "meta-llama/llama-3.3-70b-instruct";
  const data = await postJson(`${baseUrl}/chat/completions`, {
    headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
    body: {
      model,
      messages: [
        {
          role: "system",
          content: `${providerName} inside Sweet Little Trauma Studio. Help with creative, technical and production planning.`
        },
        {
          role: "user",
          content: prompt || title || "Help me create inside Sweet Little Trauma Studio."
        }
      ]
    }
  });
  return {
    responseText: extractChatText(data),
    providerJobId: data.id || null,
    raw: data
  };
}

async function callOpenAISpeech({ prompt, title }) {
  const data = await postBinary("https://api.openai.com/v1/audio/speech", {
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: {
      model: process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts",
      voice: process.env.OPENAI_TTS_VOICE || "alloy",
      input: prompt || title || "Sweet Little Trauma Studio sound preview."
    }
  });
  return {
    previewUrl: `data:${data.contentType};base64,${data.base64}`,
    contentType: data.contentType
  };
}

async function callElevenLabsTTS({ prompt, title }) {
  const voiceId = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
  const data = await postBinary(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY },
    body: {
      text: prompt || title || "Sweet Little Trauma Studio sound preview.",
      model_id: process.env.ELEVENLABS_MODEL_ID || "eleven_flash_v2_5"
    }
  });
  return {
    previewUrl: `data:${data.contentType};base64,${data.base64}`,
    contentType: data.contentType
  };
}

function seedanceBaseUrl() {
  return (
    process.env.SEEDANCE_API_URL ||
    process.env.BYTEPLUS_BASE_URL ||
    "https://ark.ap-southeast.bytepluses.com/api/v3"
  ).replace(/\/$/, "");
}

function extractProviderJobId(data = {}) {
  return (
    data.id ||
    data.task_id ||
    data.taskId ||
    data.job_id ||
    data.jobId ||
    data.data?.id ||
    data.data?.task_id ||
    data.data?.taskId ||
    data.result?.id ||
    data.result?.task_id ||
    null
  );
}

function parseEmbeddedJson(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeSeedanceStatus(data = {}) {
  const embedded = parseEmbeddedJson(data.resp_data || data.data?.resp_data || data.result?.resp_data) || {};
  const rawStatus = String(
    data.status ||
    data.data?.status ||
    data.data?.task_status ||
    data.data?.state ||
    data.result?.status ||
    data.result?.task_status ||
    data.task_status ||
    data.taskStatus ||
    data.state ||
    data.event ||
    embedded.status ||
    embedded.task_status ||
    ""
  ).toLowerCase();
  if (["succeeded", "success", "completed", "complete", "done", "finished", "finish"].includes(rawStatus)) return "completed";
  if (["failed", "failure", "error", "errored", "cancelled", "canceled", "rejected"].includes(rawStatus)) return "failed";
  if (["queued", "queue", "pending", "starting", "in_queue"].includes(rawStatus)) return "queued";
  if (data.code && Number(data.code) !== 10000 && !rawStatus) return "failed";
  return "processing";
}

function extractSeedanceOutputUrls(data = {}) {
  const embedded = parseEmbeddedJson(data.resp_data || data.data?.resp_data || data.result?.resp_data) || {};
  const sources = [data, data.data, data.content, data.result, embedded, embedded.data, embedded.result].filter(Boolean);
  const directUrls = sources.flatMap((source) => [
    source.video_url,
    source.videoUrl,
    source.output_url,
    source.outputUrl,
    source.result_url,
    source.resultUrl,
    source.url
  ]).filter(Boolean);
  const nestedUrls = sources.flatMap((source) => collectUrlCandidates([
    source.output,
    source.outputs,
    source.result,
    source.results,
    source.video,
    source.videos,
    source.media,
    source.assets
  ])).filter(Boolean);
  return [...new Set([...directUrls, ...nestedUrls])];
}

function extractProviderFailureMessage(data = {}, fallback = "Provider job failed.") {
  const providerError = data.error || data.data?.error || data.result?.error || {};
  const code = providerError.code || data.code || data.data?.code || data.result?.code || "";
  const message = providerError.message || data.message || data.data?.message || data.result?.message || "";
  if (code && message) return `${code}: ${message}`;
  return message || code || fallback;
}

function byteplusVisionConfig() {
  return {
    accessKey: process.env.BYTEPLUS_VISION_AK || "",
    secretKey: process.env.BYTEPLUS_VISION_SK || "",
    host: process.env.BYTEPLUS_VISION_HOST || "cv.byteplusapi.com",
    region: process.env.BYTEPLUS_VISION_REGION || "ap-singapore-1",
    service: process.env.BYTEPLUS_VISION_SERVICE || "cv",
    version: process.env.BYTEPLUS_VISION_VERSION || "2024-06-06",
    reqKey: process.env.OMNIHUMAN_REQ_KEY || "realman_avatar_picture_omni_cv"
  };
}

function encodeByteplusComponent(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function normalizeByteplusQuery(params = {}) {
  return Object.keys(params)
    .sort()
    .map((key) => `${encodeByteplusComponent(key)}=${encodeByteplusComponent(params[key])}`)
    .join("&")
    .replace(/\+/g, "%20");
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function hmacSha256(key, value) {
  return crypto.createHmac("sha256", key).update(value, "utf8").digest();
}

function signByteplusVisionRequest({ action, bodyText }) {
  const config = byteplusVisionConfig();
  const date = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const shortDate = date.slice(0, 8);
  const query = { Action: action, Version: config.version };
  const bodyHash = sha256Hex(bodyText);
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    Host: config.host,
    "X-Date": date,
    "X-Content-Sha256": bodyHash
  };
  const signedHeaders = {
    "content-type": headers["Content-Type"],
    host: config.host,
    "x-content-sha256": bodyHash,
    "x-date": date
  };
  const signedHeaderNames = Object.keys(signedHeaders).sort();
  const signedHeaderString = signedHeaderNames.map((key) => `${key}:${signedHeaders[key]}\n`).join("");
  const credentialScope = `${shortDate}/${config.region}/${config.service}/request`;
  const canonicalRequest = [
    "POST",
    "/",
    normalizeByteplusQuery(query),
    signedHeaderString,
    signedHeaderNames.join(";"),
    bodyHash
  ].join("\n");
  const signingString = ["HMAC-SHA256", date, credentialScope, sha256Hex(canonicalRequest)].join("\n");
  const signingKey = hmacSha256(
    hmacSha256(hmacSha256(hmacSha256(Buffer.from(config.secretKey, "utf8"), shortDate), config.region), config.service),
    "request"
  );
  const signature = crypto.createHmac("sha256", signingKey).update(signingString, "utf8").digest("hex");
  headers.Authorization = `HMAC-SHA256 Credential=${config.accessKey}/${credentialScope}, SignedHeaders=${signedHeaderNames.join(";")}, Signature=${signature}`;
  return {
    url: `https://${config.host}/?${normalizeByteplusQuery(query)}`,
    headers
  };
}

async function postByteplusVision(action, body, timeoutMs = 90000) {
  const bodyText = JSON.stringify(body);
  const signed = signByteplusVisionRequest({ action, bodyText });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(signed.url, {
      method: "POST",
      headers: signed.headers,
      body: bodyText,
      signal: controller.signal
    });
    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch (_error) {
      data = { raw: text };
    }
    if (!response.ok) {
      const message = data.message || data.error?.message || data.raw || `${response.status} ${response.statusText}`;
      throw new Error(message);
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeOmniHumanStatus(data = {}) {
  const rawStatus = String(data.data?.status || data.status || data.task_status || "").toLowerCase();
  if (["done", "succeeded", "success", "completed", "complete"].includes(rawStatus)) return "completed";
  if (["failed", "error", "cancelled", "canceled"].includes(rawStatus)) return "failed";
  return "processing";
}

function extractOmniHumanOutputUrls(data = {}) {
  const respData = data.data?.resp_data;
  let parsedRespData = {};
  if (typeof respData === "string") {
    try {
      parsedRespData = JSON.parse(respData);
    } catch (_error) {
      parsedRespData = {};
    }
  } else if (respData && typeof respData === "object") {
    parsedRespData = respData;
  }
  return [
    parsedRespData.video_url,
    parsedRespData.videoUrl,
    data.video_url,
    data.videoUrl,
    data.data?.video_url,
    data.data?.videoUrl
  ].filter(Boolean);
}

function isInternalStudioJobId(jobId = "") {
  return /^(job|video|image|music|sound|assist|project|session|ceo_session|tenant)_[0-9]+_/i.test(String(jobId || ""));
}

function seedanceModelCandidates() {
  return uniqueEnvModels([
    "dreamina-seedance-2-0-260128",
    process.env.SEEDANCE_MODEL_ID,
    "dreamina-seedance-2-0-fast-260128",
    "seedance-1-0-pro-250528"
  ]);
}

function runwayModelCandidates() {
  return uniqueEnvModels([
    process.env.RUNWAY_MODEL_ID,
    "gen4.5",
    "gen4_turbo"
  ]);
}

function lumaModelCandidates() {
  return uniqueEnvModels([
    process.env.LUMA_MODEL_ID,
    "ray-2",
    "ray-flash-2",
    "ray-1-6"
  ]);
}

function klingModelCandidates() {
  return uniqueEnvModels([
    process.env.KLING_MODEL_ID,
    "kling-v1-6",
    "kling-v3-standard",
    "kling-v1"
  ]);
}

function veoModelCandidates() {
  return uniqueEnvModels([
    process.env.VEO_MODEL_ID,
    "veo-3.1-generate-preview",
    "veo-3.0-generate-preview",
    "veo-2.0-generate-001"
  ]);
}

function buildSeedanceContent({ prompt, title, payload = {} }) {
  const content = [];
  const tool = String(payload.tool || payload.actionId || "").toUpperCase();
  const imageUrl = payload.image_url || payload.imageUrl || payload.referenceImageUrl || payload.image || "";
  const lastFrameUrl = payload.last_frame_url || payload.lastFrameUrl || payload.endImageUrl || "";

  if ((tool.includes("IMAGE") || tool.includes("IMG")) && !imageUrl) {
    const error = new Error("Seedance image-to-video requires a reference image URL. Upload an image in Home or attach it to the request.");
    error.code = "seedance_missing_image";
    error.statusCode = 400;
    throw error;
  }

  if (imageUrl) {
    content.push({
      type: "image_url",
      image_url: { url: String(imageUrl) },
      role: "first_frame"
    });
  }
  if (lastFrameUrl) {
    content.push({
      type: "image_url",
      image_url: { url: String(lastFrameUrl) },
      role: "last_frame"
    });
  }

  content.push({
    type: "text",
    text: prompt || title || "Create a cinematic black neon studio video shot."
  });
  return content;
}

function seedanceReadyImageReference(value = "") {
  const reference = String(value || "").trim();
  return reference.startsWith("data:image/") || reference.startsWith("https://") || reference.startsWith("asset://");
}

function seedanceReferenceAsset(payload = {}, explicitReference = "", { lastFrame = false } = {}) {
  const explicitAsset = explicitReference
    ? state.assets.find((asset) => asset.publicUrl === explicitReference && !asset.deletedAt)
    : null;
  if (explicitAsset && String(explicitAsset.contentType || "").startsWith("image/")) return explicitAsset;

  const candidateIds = lastFrame
    ? [payload.lastFrameAssetId, payload.endFrameAssetId]
    : [
        payload.firstFrameAssetId,
        payload.sourceAssetId,
        ...(Array.isArray(payload.referenceAssetIds) ? payload.referenceAssetIds : [])
      ];
  return candidateIds
    .filter(Boolean)
    .map((assetId) => state.assets.find((asset) => asset.id === assetId && !asset.deletedAt))
    .find((asset) => asset && String(asset.contentType || "").startsWith("image/")) || null;
}

async function seedanceImageReference(payload = {}, { lastFrame = false } = {}) {
  const explicitReference = String(lastFrame
    ? payload.last_frame_url || payload.lastFrameUrl || payload.endImageUrl || ""
    : payload.image_url || payload.imageUrl || payload.referenceImageUrl || payload.image || "").trim();
  if (explicitReference.startsWith("data:image/") || explicitReference.startsWith("asset://")) return explicitReference;

  const asset = seedanceReferenceAsset(payload, explicitReference, { lastFrame });
  if (!asset) {
    if (seedanceReadyImageReference(explicitReference)) return explicitReference;
    if (explicitReference) {
      const error = new Error("Seedance cannot access this local image reference. Store it as an SLT Asset or provide an HTTPS/Base64 reference.");
      error.code = "seedance_reference_unreachable";
      error.statusCode = 400;
      throw error;
    }
    return "";
  }

  const source = await bytesForInputAsset(asset, asset.publicUrl || explicitReference);
  if (source.bytes.length > 30 * 1024 * 1024) {
    const error = new Error("Seedance image references must be smaller than 30 MB.");
    error.code = "seedance_reference_too_large";
    error.statusCode = 400;
    throw error;
  }
  const contentType = String(asset.contentType || source.contentType || "image/jpeg").toLowerCase();
  if (!contentType.startsWith("image/")) {
    const error = new Error("Seedance requires an image Asset for image-to-video generation.");
    error.code = "seedance_reference_mime_invalid";
    error.statusCode = 400;
    throw error;
  }
  return `data:${contentType};base64,${source.bytes.toString("base64")}`;
}

async function prepareSeedanceProviderPayload(payload = {}) {
  const referenceImageUrl = await seedanceImageReference(payload);
  const lastFrameUrl = await seedanceImageReference(payload, { lastFrame: true });
  return {
    ...payload,
    referenceImageUrl,
    lastFrameUrl
  };
}

async function callSeedanceVideo({ prompt, title, payload = {} }) {
  const apiKey = providerApiKey(providerCatalog.Seedance);
  const baseUrl = seedanceBaseUrl();
  const providerPayload = await prepareSeedanceProviderPayload(payload);
  const duration = Math.max(1, Math.round(videoClipDuration(providerPayload, "Seedance", Number(process.env.SEEDANCE_DURATION || 5))));
  const requestBody = {
    content: buildSeedanceContent({ prompt, title, payload: providerPayload }),
    ratio: videoAspectRatio(providerPayload, process.env.SEEDANCE_RATIO || "16:9"),
    duration,
    resolution: process.env.SEEDANCE_RESOLUTION || "720p",
    generate_audio: envFlag("SEEDANCE_GENERATE_AUDIO", false)
  };
  const callbackUrl = providerPayload.callback_url || providerPayload.callbackUrl || providerPayload.webhookUrl || providerPayload.webhook_url || "";
  if (callbackUrl) requestBody.callback_url = callbackUrl;

  let lastError = null;
  for (const model of seedanceModelCandidates()) {
    try {
      const data = await postJson(`${baseUrl}/contents/generations/tasks`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        body: { ...requestBody, model },
        timeoutMs: 90000
      });
      const providerJobId = extractProviderJobId(data);
      return {
        providerJobId,
        status: "processing",
        previewUrl: null,
        note: providerJobId
          ? "Seedance task submitted. Poll /api/jobs/:jobId to retrieve the video."
          : "Seedance task submitted. The provider did not return a recognizable job id.",
        raw: data,
        model
      };
    } catch (error) {
      lastError = error;
      if (!isRetryableProviderModelError(error)) break;
    }
  }
  throw lastError || new Error("Seedance request failed.");
}

async function callOmniHumanVideo({ prompt, title, payload = {} }) {
  const config = byteplusVisionConfig();
  const imageUrl = payload.image_url || payload.imageUrl || payload.referenceImageUrl || payload.image || process.env.OMNIHUMAN_TEST_IMAGE_URL || "";
  const audioUrl = payload.audio_url || payload.audioUrl || payload.voiceUrl || payload.audio || process.env.OMNIHUMAN_TEST_AUDIO_URL || "";
  if (!imageUrl || !audioUrl) {
    const error = new Error("OmniHuman needs image_url and audio_url. Upload/host the image and audio first, then send their URLs.");
    error.code = "omnihuman_missing_media_urls";
    throw error;
  }
  const data = await postByteplusVision("CVSubmitTask", {
    req_key: config.reqKey,
    image_url: imageUrl,
    audio_url: audioUrl,
    callback_url: payload.callback_url || payload.callbackUrl || process.env.OMNIHUMAN_CALLBACK_URL || undefined,
    callback_auth_info: payload.callback_auth_info || payload.callbackAuthInfo || process.env.OMNIHUMAN_CALLBACK_AUTH_INFO || undefined
  });
  const providerJobId = extractProviderJobId(data);
  return {
    providerJobId,
    status: "processing",
    previewUrl: null,
    note: providerJobId
      ? "OmniHuman task submitted. Poll /api/jobs/:jobId?provider=OmniHuman to retrieve the video."
      : "OmniHuman task submitted. The provider did not return a recognizable task id.",
    raw: data
  };
}

async function getOmniHumanJob(jobId) {
  const config = byteplusVisionConfig();
  const data = await postByteplusVision("CVGetResult", {
    req_key: config.reqKey,
    task_id: jobId
  }, 60000);
  const outputUrls = extractOmniHumanOutputUrls(data);
  return {
    data,
    outputUrls,
    jobStatus: normalizeOmniHumanStatus(data)
  };
}

function veoBaseUrl() {
  return (process.env.VEO_API_URL || "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
}

async function callVeoVideo({ prompt, title, payload = {} }) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.VEO_API_KEY || "";
  const body = {
    instances: [
      {
        prompt: prompt || title || "Create a cinematic futuristic garage studio video shot."
      }
    ],
    parameters: {
      aspectRatio: videoAspectRatio(payload, process.env.VEO_ASPECT_RATIO || "16:9"),
      durationSeconds: videoClipDuration(payload, "Veo", Number(process.env.VEO_DURATION || 8))
    }
  };
  let lastError = null;
  for (const model of veoModelCandidates()) {
    try {
      const data = await postJson(`${veoBaseUrl()}/models/${model}:predictLongRunning`, {
        headers: { "x-goog-api-key": apiKey },
        body,
        timeoutMs: 90000
      });
      const providerJobId = extractProviderJobId(data) || data.name || null;
      return {
        providerJobId,
        status: "processing",
        previewUrl: null,
        note: providerJobId
          ? "Flow / Veo task submitted. Polling/output retrieval will use the operation id."
          : "Flow / Veo task submitted. The provider did not return a recognizable operation id.",
        raw: data,
        model
      };
    } catch (error) {
      lastError = error;
      if (!isRetryableProviderModelError(error)) break;
    }
  }
  throw lastError || new Error("Veo request failed.");
}

function runwayBaseUrl() {
  return (process.env.RUNWAY_API_URL || "https://api.dev.runwayml.com/v1").replace(/\/$/, "");
}

function runwayHeaders() {
  return {
    Authorization: `Bearer ${process.env.RUNWAY_API_KEY}`,
    "X-Runway-Version": process.env.RUNWAY_API_VERSION || "2024-11-06"
  };
}

function payloadSourceAsset(payload = {}) {
  const assetId = firstReferenceAssetId(payload);
  return assetId ? state.assets.find((asset) => asset.id === assetId) || null : null;
}

function providerReadyHttpsUrl(value = "") {
  try {
    const parsed = new URL(String(value || ""));
    return parsed.protocol === "https:" && Boolean(parsed.hostname) && !/^\d{1,3}(\.\d{1,3}){3}$/.test(parsed.hostname);
  } catch {
    return false;
  }
}

async function fileForInputAsset(asset = null, fallbackUrl = "") {
  const storageKey = String(asset?.storageKey || "").replace(/^\/+/, "");
  const storagePath = asset?.storagePath || (storageKey ? resolve(assetStorageDir, storageKey) : "");
  if (storagePath && storagePath.startsWith(resolve(assetStorageDir)) && existsSync(storagePath)) {
    const fileStats = await stat(storagePath);
    return {
      filePath: storagePath,
      bytes: fileStats.size,
      contentType: asset?.contentType || "application/octet-stream",
      fileName: safeUploadName(asset?.originalName || storageKey || "source.mp4"),
      temporary: false
    };
  }

  const sourceUrl = String(fallbackUrl || asset?.publicUrl || "");
  if (!sourceUrl) {
    const error = new Error("The source video is stored, but its bytes are not available for provider upload.");
    error.code = "source_asset_unavailable";
    error.statusCode = 422;
    throw error;
  }
  const tempPath = await temporaryUploadPath("runway-source", extensionFromContentType(asset?.contentType || "", asset?.originalName || sourceUrl));
  if (sourceUrl.startsWith("data:")) {
    const parsed = parseDataUrl(sourceUrl);
    if (parsed.bytes.length > envNumber("MAX_DATA_URI_INPUT_BYTES", 25 * 1024 * 1024)) {
      const error = new Error("Large video data URIs are not accepted. Upload the source to SLT Storage first.");
      error.code = "data_uri_too_large";
      error.statusCode = 413;
      throw error;
    }
    await writeFile(tempPath, parsed.bytes);
    return {
      filePath: tempPath,
      bytes: parsed.bytes.length,
      contentType: asset?.contentType || parsed.contentType || "application/octet-stream",
      fileName: safeUploadName(asset?.originalName || "source.mp4"),
      temporary: true
    };
  }
  if (!/^https?:\/\//i.test(sourceUrl)) {
    const error = new Error("The source media is not available through SLT Storage.");
    error.code = "source_asset_unavailable";
    error.statusCode = 422;
    throw error;
  }
  const downloaded = await downloadUrlToFile(sourceUrl, tempPath, { maxBytes: 200 * 1024 * 1024 });
  return {
    filePath: tempPath,
    bytes: downloaded.bytes,
    contentType: asset?.contentType || downloaded.contentType || "video/mp4",
    fileName: safeUploadName(asset?.originalName || "source.mp4"),
    temporary: true
  };
}

async function createRunwayEphemeralUpload({ asset = null, sourceUrl = "", fallbackName = "source.mp4" } = {}) {
  const source = await fileForInputAsset(asset, sourceUrl);
  try {
    const maxBytes = 200 * 1024 * 1024;
    if (source.bytes < 512 || source.bytes > maxBytes) {
      const error = new Error("Runway source files must be between 512 bytes and 200MB.");
      error.code = "runway_upload_size_invalid";
      error.statusCode = 400;
      throw error;
    }

    const fileName = safeUploadName(source.fileName || fallbackName);
    const upload = await postJson(`${runwayBaseUrl()}/uploads`, {
      headers: runwayHeaders(),
      body: { filename: fileName, type: "ephemeral" },
      timeoutMs: 60000
    });
    if (!upload.uploadUrl || !upload.runwayUri || !upload.fields) {
      const error = new Error("Runway did not return a valid ephemeral upload target.");
      error.code = "runway_upload_target_invalid";
      throw error;
    }

    const form = new FormData();
    Object.entries(upload.fields).forEach(([key, value]) => form.append(key, String(value)));
    const fileBlob = await openAsBlob(source.filePath, { type: source.contentType });
    form.append("file", fileBlob, fileName);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), envNumber("RUNWAY_UPLOAD_TIMEOUT_MS", 180000));
    try {
      const response = await fetch(upload.uploadUrl, { method: "POST", body: form, signal: controller.signal });
      if (!response.ok) {
        const error = new Error(`Runway source upload failed with HTTP ${response.status}.`);
        error.code = "runway_upload_failed";
        error.statusCode = response.status;
        throw error;
      }
    } finally {
      clearTimeout(timeout);
    }
    return upload.runwayUri;
  } finally {
    if (source.temporary) await rm(source.filePath, { force: true }).catch(() => {});
  }
}

async function bytesForInputAsset(asset = null, sourceUrl = "") {
  const source = await fileForInputAsset(asset, sourceUrl);
  try {
    return {
      bytes: await readFile(source.filePath),
      contentType: source.contentType,
      fileName: source.fileName
    };
  } finally {
    if (source.temporary) await rm(source.filePath, { force: true }).catch(() => {});
  }
}

async function runwayMediaUri(payload = {}, { kind = "video" } = {}) {
  const asset = payloadSourceAsset(payload);
  const sourceUrl = String(
    kind === "image"
      ? payload.referenceImageUrl || payload.promptImage || asset?.publicUrl || ""
      : payload.sourceVideoUrl || payload.referenceVideoUrl || payload.videoUri || asset?.publicUrl || ""
  ).trim();
  if (sourceUrl.startsWith("runway://") || providerReadyHttpsUrl(sourceUrl)) return sourceUrl;
  return createRunwayEphemeralUpload({
    asset,
    sourceUrl,
    fallbackName: kind === "image" ? "reference.png" : "source.mp4"
  });
}

async function runwayKeyframes(payload = {}) {
  const entries = Array.isArray(payload.keyframes) ? payload.keyframes.slice(0, 5) : [];
  const resolved = [];
  for (const entry of entries) {
    const asset = entry.assetId ? state.assets.find((item) => item.id === entry.assetId) || null : null;
    const uri = String(entry.uri || entry.publicUrl || asset?.publicUrl || "").trim();
    if (!uri && !asset) continue;
    const mediaUri = providerReadyHttpsUrl(uri) || uri.startsWith("runway://") || uri.startsWith("data:image/")
      ? uri
      : await createRunwayEphemeralUpload({ asset, sourceUrl: uri, fallbackName: "keyframe.png" });
    const seconds = Number(entry.seconds);
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 30) continue;
    const keyframe = { uri: mediaUri, seconds };
    if (entry.range?.start_seconds !== undefined && entry.range?.end_seconds !== undefined) {
      keyframe.range = {
        start_seconds: Number(entry.range.start_seconds),
        end_seconds: Number(entry.range.end_seconds)
      };
    }
    resolved.push(keyframe);
  }
  return resolved;
}

async function callRunwayVideo({ prompt, title, payload = {} }) {
  if (isRealityTransformPayload(payload)) {
    const videoUri = await runwayMediaUri(payload, { kind: "video" });
    const keyframes = await runwayKeyframes(payload);
    const body = {
      model: "aleph2",
      videoUri,
      promptText: String(prompt || title || "Transform the environment while preserving the original performance.").slice(0, 1000),
      ...(keyframes.length ? { keyframes } : {})
    };
    const data = await postJson(`${runwayBaseUrl()}/video_to_video`, {
      headers: runwayHeaders(),
      body,
      timeoutMs: 90000
    });
    const providerJobId = extractProviderJobId(data);
    return {
      providerJobId,
      status: providerJobId ? "processing" : "submitted",
      previewUrl: null,
      note: providerJobId
        ? "Runway Aleph 2.0 Reality Transform submitted."
        : "Runway accepted the transform but did not return a recognizable task id.",
      raw: data,
      model: "aleph2",
      operation: "reality_transform"
    };
  }

  const operation = normalizeMultimodalOperation(payload.operation || payload.actionId || payload.tool, "video");
  const imageToVideo = operation === "image_to_video" || Boolean(payload.referenceImageUrl || payload.promptImage);
  if (imageToVideo) {
    const promptImage = await runwayMediaUri(payload, { kind: "image" });
    const body = {
      model: sanitizeEnvValue(payload.model || payload.modelId || "") || "gen4_turbo",
      promptImage,
      promptText: String(prompt || title || "Animate the reference image with controlled cinematic movement.").slice(0, 1000),
      ratio: videoAspectRatio(payload, "1280:720").replace("16:9", "1280:720").replace("9:16", "720:1280").replace("1:1", "960:960"),
      duration: Math.min(10, Math.max(2, Math.round(videoClipDuration(payload, "Runway", 5))))
    };
    const data = await postJson(`${runwayBaseUrl()}/image_to_video`, {
      headers: runwayHeaders(),
      body,
      timeoutMs: 90000
    });
    const providerJobId = extractProviderJobId(data);
    return {
      providerJobId,
      status: providerJobId ? "processing" : "submitted",
      previewUrl: null,
      note: providerJobId ? "Runway image-to-video task submitted." : "Runway accepted image-to-video without a recognizable task id.",
      raw: data,
      model: body.model,
      operation: "image_to_video"
    };
  }

  const requestBody = {
    promptText: prompt || title || "Create a cinematic futuristic garage studio video shot.",
    ratio: videoAspectRatio(payload, process.env.RUNWAY_RATIO || "1280:720").replace("16:9", "1280:720").replace("9:16", "720:1280"),
    duration: videoClipDuration(payload, "Runway", Number(process.env.RUNWAY_DURATION || 5))
  };
  const explicitModel = sanitizeEnvValue(payload.model || payload.modelId || "");
  const models = explicitModel ? [explicitModel] : runwayModelCandidates();
  let lastError = null;
  for (const model of models) {
    try {
      const data = await postJson(`${runwayBaseUrl()}/text_to_video`, {
        headers: runwayHeaders(),
        body: { ...requestBody, model },
        timeoutMs: 90000
      });
      const providerJobId = extractProviderJobId(data);
      return {
        providerJobId,
        status: "processing",
        previewUrl: null,
        note: providerJobId
          ? "Runway task submitted. Poll the provider task endpoint for the output."
          : "Runway task submitted. The provider did not return a recognizable task id.",
        raw: data,
        model
      };
    } catch (error) {
      lastError = error;
      if (!isRetryableProviderModelError(error)) break;
    }
  }
  throw lastError || new Error("Runway request failed.");
}

function lumaBaseUrl() {
  return (process.env.LUMA_API_URL || "https://api.lumalabs.ai/dream-machine/v1").replace(/\/$/, "");
}

async function callLumaVideo({ prompt, title, payload = {} }) {
  const requestBody = {
    prompt: prompt || title || "Create a cinematic futuristic garage studio video shot.",
    aspect_ratio: videoAspectRatio(payload, process.env.LUMA_ASPECT_RATIO || "16:9"),
    duration: `${videoClipDuration(payload, "Luma", Number.parseInt(process.env.LUMA_DURATION || "5", 10) || 5)}s`,
    resolution: process.env.LUMA_RESOLUTION || "720p"
  };
  let lastError = null;
  for (const model of lumaModelCandidates()) {
    try {
      const data = await postJson(`${lumaBaseUrl()}/generations/video`, {
        headers: { Authorization: `Bearer ${process.env.LUMA_API_KEY}` },
        body: { ...requestBody, model },
        timeoutMs: 90000
      });
      const providerJobId = extractProviderJobId(data);
      return {
        providerJobId,
        status: "processing",
        previewUrl: data.assets?.video || null,
        note: providerJobId
          ? "Luma task submitted. Poll the provider generation endpoint for the output."
          : "Luma task submitted. The provider did not return a recognizable generation id.",
        raw: data,
        model
      };
    } catch (error) {
      lastError = error;
      if (!isRetryableProviderModelError(error)) break;
    }
  }
  throw lastError || new Error("Luma request failed.");
}

function lumaModifyMode(payload = {}) {
  const value = String(payload.transformStrength || payload.preservationMode || payload.modifyMode || "balanced").toLowerCase();
  if (["preserve", "adhere", "adhere_1", "subtle"].includes(value)) return "adhere_1";
  if (["reimagine", "reimagine_1", "strong"].includes(value)) return "reimagine_1";
  return "flex_1";
}

async function replicateVideoInput(payload = {}) {
  const asset = payloadSourceAsset(payload);
  const sourceUrl = String(payload.sourceVideoUrl || payload.referenceVideoUrl || payload.videoUri || asset?.publicUrl || "").trim();
  if (providerReadyHttpsUrl(sourceUrl)) return sourceUrl;
  const source = await bytesForInputAsset(asset, sourceUrl);
  if (source.bytes.length > 100 * 1024 * 1024) {
    const error = new Error("Luma Modify accepts source videos up to 100MB.");
    error.code = "luma_modify_upload_too_large";
    error.statusCode = 400;
    throw error;
  }
  return `data:${source.contentType || "video/mp4"};base64,${source.bytes.toString("base64")}`;
}

async function callReplicateLumaModify({ prompt, title, payload = {} }) {
  const webhookUrl = payload.webhookUrl || payload.webhook_url || payload.callbackUrl || payload.callback_url || "";
  if (webhookUrl) assertPublicWebhookUrl(webhookUrl);
  const video = await replicateVideoInput(payload);
  const firstFrame = String(payload.firstFrameUrl || payload.first_frame || "").trim();
  const data = await callReplicateModel({
    model: process.env.LUMA_MODIFY_REPLICATE_MODEL || "luma/modify-video",
    input: {
      video,
      prompt: prompt || title || "Transform the environment while preserving the original performance.",
      mode: lumaModifyMode(payload),
      ...(firstFrame ? { first_frame: firstFrame } : {})
    },
    timeoutMs: 90000,
    webhookUrl,
    prefer: ""
  });
  const outputUrl = firstUrlFromReplicateOutput(data.output);
  return {
    providerJobId: data.id || null,
    status: data.status || "processing",
    previewUrl: outputUrl,
    outputUrl,
    outputUrls: outputUrl ? [outputUrl] : [],
    note: data.status === "succeeded"
      ? "Luma Modify completed on Replicate."
      : "Luma Modify Reality Transform submitted on Replicate.",
    raw: data,
    model: "luma/modify-video",
    operation: "reality_transform"
  };
}

function base64UrlEncode(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function klingBaseUrl() {
  return (process.env.KLING_API_URL || "https://api-singapore.klingai.com").replace(/\/$/, "");
}

function klingJwt() {
  const accessKey = process.env.KLING_ACCESS_KEY || process.env.KLING_API_KEY || "";
  const secretKey = process.env.KLING_SECRET_KEY || process.env.KLING_SecretKey || "";
  if (!accessKey || !secretKey) {
    throw new Error("Kling needs KLING_ACCESS_KEY and KLING_SECRET_KEY.");
  }
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64UrlEncode(JSON.stringify({ iss: accessKey, exp: now + 1800, nbf: now - 5 }));
  const signature = crypto.createHmac("sha256", secretKey).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

async function callKlingVideo({ prompt, title, payload = {} }) {
  const requestBody = {
    prompt: prompt || title || "Create a cinematic futuristic garage studio video shot.",
    negative_prompt: process.env.KLING_NEGATIVE_PROMPT || "",
    cfg_scale: Number(process.env.KLING_CFG_SCALE || 0.5),
    mode: process.env.KLING_MODE || "std",
    aspect_ratio: videoAspectRatio(payload, process.env.KLING_ASPECT_RATIO || "16:9"),
    duration: String(videoClipDuration(payload, "Kling", Number(process.env.KLING_DURATION || 5)))
  };
  const explicitModel = sanitizeEnvValue(payload.model || payload.modelId || "");
  const models = explicitModel ? [explicitModel] : klingModelCandidates();
  let lastError = null;
  for (const model of models) {
    try {
      const data = await postJson(`${klingBaseUrl()}/v1/videos/text2video`, {
        headers: { Authorization: `Bearer ${klingJwt()}` },
        body: { ...requestBody, model_name: model },
        timeoutMs: 90000
      });
      const providerJobId = data.data?.task_id || data.task_id || extractProviderJobId(data);
      return {
        providerJobId,
        status: providerJobId ? "processing" : "submitted",
        previewUrl: null,
        note: providerJobId
          ? "Kling task submitted. Poll the Kling task endpoint for the output."
          : "Kling request submitted. The provider did not return a recognizable task id.",
        raw: data,
        model
      };
    } catch (error) {
      lastError = error;
      if (!isRetryableProviderModelError(error)) break;
    }
  }
  throw lastError || new Error("Kling request failed.");
}

function pixverseBaseUrl() {
  const configured = process.env.PIXVERSE_API_URL || "https://app-api.pixverse.ai/openapi/v2";
  return configured.replace(/\/video\/text\/generate\/?$/, "").replace(/\/$/, "");
}

async function callPixVerseVideo({ prompt, title, payload = {} }) {
  const data = await postJson(`${pixverseBaseUrl()}/video/text/generate`, {
    headers: {
      "API-KEY": process.env.PIXVERSE_API_KEY,
      "Ai-trace-id": requestId("pixverse")
    },
    body: {
      aspect_ratio: videoAspectRatio(payload, process.env.PIXVERSE_ASPECT_RATIO || "16:9"),
      duration: videoClipDuration(payload, "PixVerse", Number(process.env.PIXVERSE_DURATION || 5)),
      model: process.env.PIXVERSE_MODEL || "v4.5",
      motion_mode: process.env.PIXVERSE_MOTION_MODE || "normal",
      prompt: prompt || title || "Create a cinematic futuristic garage studio video for Sweet Little Trauma.",
      quality: process.env.PIXVERSE_QUALITY || "540p",
      seed: Number(process.env.PIXVERSE_SEED || 0)
    },
    timeoutMs: 90000
  });
  if (data.ErrCode && data.ErrCode !== 0) {
    throw new Error(data.ErrMsg || "PixVerse rejected the request.");
  }
  const videoId = data.Resp?.video_id || data.video_id || data.id || null;
  return {
    providerJobId: videoId,
    status: videoId ? "processing" : "submitted",
    previewUrl: null,
    note: videoId ? "PixVerse video submitted. Poll the video status endpoint for the output." : "PixVerse request submitted.",
    raw: data
  };
}

function heygenBaseUrl() {
  return (process.env.HEYGEN_API_URL || "https://api.heygen.com").replace(/\/$/, "");
}

async function callHeyGenVideoAgent({ prompt, title }) {
  const data = await postJson(`${heygenBaseUrl()}/v3/video-agents`, {
    headers: { "x-api-key": process.env.HEYGEN_API_KEY },
    body: {
      prompt: prompt || title || "Create a cinematic video for Sweet Little Trauma Studio.",
      mode: process.env.HEYGEN_AGENT_MODE || "generate",
      orientation: process.env.HEYGEN_ORIENTATION || "landscape",
      incognito_mode: true
    },
    timeoutMs: 90000
  });
  const payload = data.data || data;
  return {
    providerJobId: payload.session_id || payload.video_id || null,
    status: payload.status || "processing",
    previewUrl: null,
    note: "HeyGen Video Agent session submitted.",
    raw: data
  };
}

function didBaseUrl() {
  return (process.env.DID_API_URL || "https://api.d-id.com").replace(/\/$/, "");
}

function didAuthorizationHeader() {
  const raw = process.env.DID_API_KEY || "";
  if (raw.startsWith("Bearer ")) return raw;
  if (raw.startsWith("Basic ")) return raw;
  return `Basic ${Buffer.from(raw).toString("base64")}`;
}

async function callDIDTalk({ prompt, title }) {
  const data = await postJson(`${didBaseUrl()}/talks`, {
    headers: { Authorization: didAuthorizationHeader() },
    body: {
      source_url: process.env.DID_SOURCE_URL || "https://d-id-public-bucket.s3.us-west-2.amazonaws.com/alice.jpg",
      script: {
        type: "text",
        input: prompt || title || "Sweet Little Trauma Studio video preview.",
        provider: {
          type: "microsoft",
          voice_id: process.env.DID_VOICE_ID || "en-US-JennyNeural"
        }
      },
      config: { result_format: "mp4" }
    },
    timeoutMs: 90000
  });
  const providerJobId = extractProviderJobId(data);
  return {
    providerJobId,
    status: data.status || "processing",
    previewUrl: data.result_url || null,
    note: providerJobId
      ? "D-ID talk submitted. Poll the provider talk endpoint for the output."
      : "D-ID talk submitted. The provider did not return a recognizable talk id.",
    raw: data
  };
}

function minimaxEndpoint(config, pathname) {
  const configured = providerEndpoint(config) || process.env.MINIMAX_API_URL || "https://api.minimaxi.com";
  const clean = configured.replace(/\/$/, "");
  if (clean.endsWith(pathname)) return clean;
  return `${clean}${pathname}`;
}

function minimaxHeaders(config) {
  return { Authorization: `Bearer ${providerApiKey(config)}` };
}

function miniMaxAudioMime(format = "mp3") {
  const normalized = String(format || "mp3").trim().toLowerCase();
  if (["mp3", "mpeg"].includes(normalized)) return "audio/mpeg";
  if (["wav", "wave"].includes(normalized)) return "audio/wav";
  if (normalized === "flac") return "audio/flac";
  if (["m4a", "mp4"].includes(normalized)) return "audio/mp4";
  if (["ogg", "oga"].includes(normalized)) return "audio/ogg";
  return `audio/${normalized.replace(/[^a-z0-9.+-]/g, "") || "mpeg"}`;
}

function miniMaxAudioResult(data = {}, { provider = "MiniMax", format = "mp3" } = {}) {
  const responseCode = Number(data.base_resp?.status_code ?? 0);
  if (Number.isFinite(responseCode) && responseCode !== 0) {
    const error = new Error(data.base_resp?.status_msg || `${provider} rejected the audio request.`);
    error.code = "provider_invalid_response";
    error.statusCode = 502;
    error.provider = provider;
    error.providerBody = { base_resp: data.base_resp, trace_id: data.trace_id || null };
    throw error;
  }

  const audioValue = data.data?.audio || data.data?.audio_url || data.audio_url || "";
  if (typeof audioValue !== "string" || !audioValue.trim()) {
    const error = new Error(`${provider} completed without returning audio data.`);
    error.code = "provider_invalid_response";
    error.statusCode = 502;
    error.provider = provider;
    error.providerBody = { base_resp: data.base_resp || null, trace_id: data.trace_id || null };
    throw error;
  }

  const compactAudio = audioValue.trim();
  let previewUrl = compactAudio;
  let audioBytes = Number(data.extra_info?.audio_size || 0) || null;
  if (!/^https?:\/\//i.test(compactAudio) && !compactAudio.startsWith("data:")) {
    const hex = compactAudio.replace(/\s+/g, "");
    if (!hex.length || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) {
      const error = new Error(`${provider} returned audio in an unsupported encoding.`);
      error.code = "provider_invalid_response";
      error.statusCode = 502;
      error.provider = provider;
      throw error;
    }
    const bytes = Buffer.from(hex, "hex");
    audioBytes = bytes.length;
    previewUrl = `data:${miniMaxAudioMime(format)};base64,${bytes.toString("base64")}`;
  }

  const { audio: _audio, audio_url: _audioUrl, ...safeData } = data.data || {};
  return {
    providerJobId: data.trace_id || data.traceId || null,
    status: "complete",
    previewUrl,
    audioUrl: previewUrl,
    audioBytes,
    note: `${provider} returned audio data.`,
    raw: {
      ...data,
      data: { ...safeData, audioBytes },
      audio_url: undefined
    }
  };
}

async function callMiniMaxVideo({ prompt, title, payload = {} }) {
  const config = providerCatalog.Hailuo;
  const data = await postJson(minimaxEndpoint(config, "/v1/video_generation"), {
    headers: minimaxHeaders(config),
    body: {
      model: process.env.MINIMAX_VIDEO_MODEL || "MiniMax-Hailuo-2.3",
      prompt: prompt || title || "Sweet Little Trauma Studio cinematic video.",
      duration: videoClipDuration(payload, "Hailuo", Number(process.env.MINIMAX_VIDEO_DURATION || 6)),
      resolution: process.env.MINIMAX_VIDEO_RESOLUTION || "1080P",
      prompt_optimizer: process.env.MINIMAX_PROMPT_OPTIMIZER !== "false",
      aigc_watermark: process.env.MINIMAX_AIGC_WATERMARK === "true"
    },
    timeoutMs: 90000
  });
  const providerJobId = data.task_id || data.data?.task_id || extractProviderJobId(data);
  return {
    providerJobId,
    status: "processing",
    note: providerJobId
      ? "MiniMax / Hailuo video task submitted. Poll the MiniMax task endpoint for the output."
      : "MiniMax / Hailuo video task submitted. The provider did not return a recognizable task id.",
    raw: data
  };
}

async function callMiniMaxMusic({ prompt, title, payload = {} }) {
  const config = providerCatalog["MiniMax Music"];
  const instrumental = payload.operation === "instrumental" || payload.isInstrumental === true;
  const lyrics = payload.lyrics || process.env.MINIMAX_MUSIC_LYRICS || `[verse]\n${prompt || title || "Sweet Little Trauma Studio original song."}`;
  const format = payload.outputFormat || process.env.MINIMAX_AUDIO_FORMAT || "mp3";
  const data = await postJson(minimaxEndpoint(config, "/v1/music_generation"), {
    headers: minimaxHeaders(config),
    body: {
      model: process.env.MINIMAX_MUSIC_MODEL || "music-2.6-free",
      prompt: prompt || title || "cinematic alternative pop, emotional, futuristic garage studio",
      ...(instrumental ? { is_instrumental: true } : { lyrics }),
      stream: false,
      output_format: "hex",
      audio_setting: {
        sample_rate: Number(process.env.MINIMAX_MUSIC_SAMPLE_RATE || 44100),
        bitrate: Number(process.env.MINIMAX_MUSIC_BITRATE || 256000),
        format
      }
    },
    timeoutMs: 90000
  });
  return miniMaxAudioResult(data, { provider: "MiniMax Music", format });
}

async function callMiniMaxSpeech({ prompt, title, payload = {} }) {
  const config = providerCatalog["MiniMax Speech"];
  const format = payload.outputFormat || process.env.MINIMAX_AUDIO_FORMAT || "mp3";
  const data = await postJson(minimaxEndpoint(config, "/v1/t2a_v2"), {
    headers: minimaxHeaders(config),
    body: {
      model: process.env.MINIMAX_SPEECH_MODEL || "speech-2.8-turbo",
      text: prompt || title || "Sweet Little Trauma Studio voice preview.",
      stream: false,
      output_format: "hex",
      voice_setting: {
        voice_id: payload.voiceId || process.env.MINIMAX_SPEECH_VOICE_ID || "male-qn-qingse",
        speed: Number(payload.speed || process.env.MINIMAX_SPEECH_SPEED || 1),
        vol: Number(payload.volume || process.env.MINIMAX_SPEECH_VOLUME || 1),
        pitch: Number(payload.pitch || process.env.MINIMAX_SPEECH_PITCH || 0)
      },
      audio_setting: {
        sample_rate: Number(process.env.MINIMAX_SPEECH_SAMPLE_RATE || 32000),
        bitrate: Number(process.env.MINIMAX_SPEECH_BITRATE || 128000),
        format
      }
    },
    timeoutMs: 90000
  });
  return miniMaxAudioResult(data, { provider: "MiniMax Speech", format });
}

function compactList(value = "") {
  return String(value)
    .split(/[,\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function callSLTComposer({ prompt, title, payload = {} }) {
  const mode = payload.composerMode || payload.musicMode || "Cancion completa";
  const style = payload.musicStyle || "Pop alternativo";
  const duration = payload.musicLength || "90 segundos";
  const voiceMode = payload.voiceMode || "Mi voz real limpia";
  const trainingMode = payload.trainingMode || "Aprender de feedback";
  const instruments = compactList(payload.instruments || "drums, bass, synth, piano, vocal texture");
  const references = compactList(payload.references || "");
  const idea = prompt || "Sweet Little Trauma original song idea";
  const sections = [
    { section: "intro", purpose: "Set mood and sonic identity", length: "4-8 bars" },
    { section: "verse", purpose: "Tell the emotional detail", length: "8-16 bars" },
    { section: "pre chorus", purpose: "Lift tension before the hook", length: "4-8 bars" },
    { section: "chorus", purpose: "Main memorable hook", length: "8-16 bars" },
    { section: "bridge", purpose: "Change perspective or texture", length: "4-8 bars" },
    { section: "outro", purpose: "Resolve or leave an aftertaste", length: "4-8 bars" }
  ];
  const pipeline = [
    { stage: "lyrics", engine: "OpenAI or Gemini", task: "turn the idea into lyric drafts, hooks and structure" },
    { stage: "melody", engine: "SLT melody capture", task: "use hummed melody or manual topline as the main author source" },
    { stage: "instrumental", engine: "Stable Audio, MiniMax Music or Mubert", task: "generate licensed instrumental directions and variations" },
    { stage: "voice", engine: "MiniMax Speech, ElevenLabs or OpenAI Audio", task: "guide voice, cleanup, narration or vocal sketch" },
    { stage: "stems", engine: "Moises, Demucs or provider stems", task: "split voice, drums, bass, instruments and ambience" },
    { stage: "mix", engine: "Dolby, iZotope or local FFmpeg chain", task: "clean, level, master and export" },
    { stage: "learning", engine: "SLT feedback memory", task: "save ratings, accepted edits, rejected directions and reusable presets" }
  ];
  return {
    status: "complete",
    previewUrl: `local-placeholder://music/slt-composer/${Date.now()}`,
    responseText: "SLT Composer blueprint created. Connect music/audio providers to render final audio.",
    note: "SLT Composer created a song production plan without calling Suno or Udio.",
    composition: {
      title,
      idea,
      mode,
      style,
      duration,
      voiceMode,
      trainingMode,
      instruments,
      references,
      sections,
      promptPack: {
        lyricPrompt: `Write a ${style} song about: ${idea}. Keep a strong hook, emotional clarity and original phrasing.`,
        melodyPrompt: `Use the creator humming/topline as the main melody. Build harmony and rhythm around it.`,
        productionPrompt: `Produce ${style} with ${instruments.join(", ")}. Keep it cinematic, direct and emotionally readable.`,
        voicePrompt: `Preserve the creator voice identity where permission exists. Clean pitch and timing without erasing character.`
      },
      trainingPolicy: [
        "Store only user-owned uploads, ratings and approved edits.",
        "Do not train on commercial songs unless explicit rights are documented.",
        "Use API outputs as references for routing and feedback, not as unlicensed training data.",
        "Prefer provider terms that allow commercial use for paid plans."
      ],
      pipeline
    }
  };
}

function moisesBaseUrl() {
  return (process.env.MOISES_API_URL || "https://api.music.ai/v1").replace(/\/$/, "");
}

async function callMoisesAudio({ prompt, title, payload = {} }) {
  const workflow = payload.workflow || payload.workflowSlug || process.env.MOISES_WORKFLOW_SLUG || "";
  const inputUrl = payload.inputUrl || payload.audioUrl || payload.audio_url || "";
  if (!workflow || !inputUrl) {
    return {
      status: "ready",
      responseText: "Music AI is connected. To create a processing job, send a workflow slug and an audio inputUrl.",
      note: "Music AI/Moises API key is valid. Create or choose a workflow in the dashboard, then submit jobs with workflow + inputUrl.",
      raw: {
        required: ["workflow", "inputUrl"],
        docs: "https://music.ai/docs/api/reference/"
      }
    };
  }

  const data = await postJson(`${moisesBaseUrl()}/job`, {
    headers: {
      Authorization: process.env.MOISES_API_KEY,
      "Content-Type": "application/json"
    },
    body: {
      name: title || "SLT Music AI audio job",
      workflow,
      params: { inputUrl },
      metadata: {
        source: "sweet-little-trauma-studio",
        prompt: prompt || ""
      }
    },
    timeoutMs: 90000
  });
  return {
    providerJobId: data.id || null,
    status: "processing",
    note: "Music AI job created. Poll /job/:id for status and results.",
    raw: data
  };
}

function formatDurationLabel(seconds) {
  if (seconds >= 60) {
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
  }
  return `${seconds}s`;
}

function buildLongVideoTimeline({ prompt, title, providerName, plan }) {
  const sampleCount = Math.min(plan.sceneCount, 12);
  const scenes = Array.from({ length: sampleCount }, (_item, index) => {
    const start = index * plan.clipDurationSeconds;
    const end = Math.min(start + plan.clipDurationSeconds, plan.requestedDurationSeconds);
    return {
      scene: index + 1,
      timecode: `${formatDurationLabel(start)}-${formatDurationLabel(end)}`,
      durationSeconds: end - start,
      prompt: `${prompt || title || "Sweet Little Trauma Studio cinematic sequence."} Scene ${index + 1}: keep continuity, visual style, character identity and camera language.`
    };
  });
  return {
    providerJobId: requestId("ceo_video_timeline"),
    status: "timeline_planned",
    previewUrl: null,
    responseText: `CEO long video timeline ready: ${formatDurationLabel(plan.requestedDurationSeconds)} split into ${plan.sceneCount} clips.`,
    note: "Long video mode does not send one giant provider request. It creates a controlled scene timeline to render in batches and stitch with FFmpeg/export tools.",
    longVideo: true,
    timeline: {
      mode: "CEO_LONG_VIDEO_TIMELINE",
      requestedDurationSeconds: plan.requestedDurationSeconds,
      requestedDurationLabel: formatDurationLabel(plan.requestedDurationSeconds),
      provider: providerName,
      clipDurationSeconds: plan.clipDurationSeconds,
      providerMaxClipSeconds: plan.providerMaxClipSeconds,
      sceneCount: plan.sceneCount,
      sampleScenesShown: scenes.length,
      remainingScenes: Math.max(0, plan.sceneCount - scenes.length),
      assembly: "Render clips scene-by-scene, then stitch into one video with transitions, sound, music, color and watermark/export rules.",
      scenes
    }
  };
}

async function callComfyUILocal({ prompt, title }) {
  const baseUrl = (process.env.COMFYUI_API_URL || "http://127.0.0.1:8188").replace(/\/$/, "");
  const data = await getJson(`${baseUrl}/system_stats`, { timeoutMs: 30000 });
  return {
    status: "ready",
    responseText: "ComfyUI local is connected. Send a workflow payload to create a real image job.",
    note: "ComfyUI is running locally. This readiness check does not spend credits or submit a workflow.",
    raw: {
      prompt: prompt || title || "",
      comfyuiVersion: data.system?.comfyui_version || null,
      pythonVersion: data.system?.python_version || null,
      device: data.devices?.[0]?.name || null
    }
  };
}

async function callOllamaChat({ prompt, title, providerName }) {
  const baseUrl = (process.env.LOCAL_MODEL_API_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
  const model = process.env.LOCAL_MODEL_NAME || process.env.OLLAMA_MODEL || "hermes3";
  const data = await postJson(`${baseUrl}/api/chat`, {
    body: {
      model,
      stream: false,
      messages: [
        {
          role: "system",
          content: "You are the local Hermes assistant inside Sweet Little Trauma Studio. Help with creative planning, production and operations. Do not expose secrets."
        },
        {
          role: "user",
          content: prompt || title || "Help me inside Sweet Little Trauma Studio."
        }
      ]
    },
    timeoutMs: 120000
  });
  return {
    responseText: data.message?.content || data.response || `${providerName || "Local model"} response ready.`,
    providerJobId: data.created_at || null,
    raw: data
  };
}

async function callGenericEndpoint({ providerStatus: status, prompt, title, kind, providerName, payload = {} }) {
  const config = providerCatalog[status.name];
  const endpoint = providerEndpoint(config);
  if (!endpoint) {
    throw new Error(`${providerName} key found, but ${status.endpointEnv || "provider endpoint"} is missing.`);
  }
  const apiKey = providerApiKey(config);
  return postJson(endpoint, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    body: {
      prompt,
      title,
      kind,
      provider: providerName,
      request_id: payload.request_id || payload.jobId || undefined,
      jobId: payload.jobId || payload.request_id || undefined,
      webhookUrl: payload.webhookUrl || payload.webhook_url || undefined,
      callback_url: payload.callback_url || payload.webhookUrl || undefined
    }
  });
}

class ProviderAdapter {
  constructor(status) {
    this.name = status.name;
    this.kind = status.kind;
    this.adapter = status.adapter;
    this.status = status;
  }

  async generate({ kind, prompt, title, payload = {} }) {
    return attemptProviderCall({
      kind,
      providerStatus: this.status,
      prompt,
      title,
      providerName: this.name,
      payload
    });
  }
}

function mutableCodedError(source, fallbackCode) {
  const message = source?.message || String(source || "Unknown error");
  const error = new Error(message);
  error.name = source?.name || "Error";
  error.code = source?.code || fallbackCode;
  if (source?.statusCode) error.statusCode = source.statusCode;
  if (source?.providerBody) error.providerBody = source.providerBody;
  if (source?.stack) error.stack = source.stack;
  error.cause = source;
  return error;
}

async function attemptProviderCall({ kind, providerStatus: status, prompt, title, providerName, payload = {} }) {
  if (!status.connected) {
    const error = new Error(status.message || providerFallbackMessage);
    error.code = status.status || "provider_not_connected";
    throw error;
  }
  if (status.adapter === "openai-image") return callOpenAIImage({ prompt, title });
  if (status.adapter === "xai-image") return callXAIImage({ prompt, title });
  if (status.adapter === "gemini-image") return callGeminiImage({ prompt, title, payload });
  if (status.adapter === "replicate-image") return callReplicateImage({ prompt, title, providerName, payload });
  if (status.adapter === "stability-image") return callStabilityImage({ prompt, title });
  if (status.adapter === "ideogram-image") return callIdeogramImage({ prompt, title });
  if (status.adapter === "recraft-image") return callRecraftImage({ prompt, title });
  if (status.adapter === "leonardo-image") return callLeonardoImage({ prompt, title });
  if (status.adapter === "comfyui-local") return callComfyUILocal({ prompt, title });
  if (status.adapter === "openai-responses") return callOpenAIResponses({ prompt, title });
  if (status.adapter === "gemini-text") return callGeminiText({ prompt, title });
  if (status.adapter === "openrouter-chat") return callOpenRouterChat({ prompt, title, providerName });
  if (status.adapter === "ollama-chat") return callOllamaChat({ prompt, title, providerName });
  if (status.adapter === "openai-speech") return callOpenAISpeech({ prompt, title });
  if (status.adapter === "elevenlabs-tts") return callElevenLabsTTS({ prompt, title });
  if (status.adapter === "seedance-direct") return callSeedanceVideo({ prompt, title, payload });
  if (status.adapter === "byteplus-omnihuman") return callOmniHumanVideo({ prompt, title, payload });
  if (status.adapter === "veo-direct") return callVeoVideo({ prompt, title, payload });
  if (status.adapter === "runway-video") return callRunwayVideo({ prompt, title, payload });
  if (status.adapter === "luma-video") return callLumaVideo({ prompt, title, payload });
  if (status.adapter === "replicate-luma-modify") return callReplicateLumaModify({ prompt, title, payload });
  if (status.adapter === "kling-video") return callKlingVideo({ prompt, title, payload });
  if (status.adapter === "pixverse-video") return callPixVerseVideo({ prompt, title, payload });
  if (status.adapter === "replicate-wan-video") return callReplicateWanVideo({ prompt, title, payload });
  if (status.adapter === "heygen-video-agent") return callHeyGenVideoAgent({ prompt, title });
  if (status.adapter === "did-talk") return callDIDTalk({ prompt, title });
  if (status.adapter === "minimax-video") return callMiniMaxVideo({ prompt, title, payload });
  if (status.adapter === "minimax-music") return callMiniMaxMusic({ prompt, title, payload });
  if (status.adapter === "replicate-musicgen") return callReplicateMusicGen({ prompt, title, payload });
  if (status.adapter === "replicate-riffusion") return callReplicateRiffusion({ prompt, title, payload });
  if (status.adapter === "minimax-speech") return callMiniMaxSpeech({ prompt, title, payload });
  if (status.adapter === "slt-composer") return callSLTComposer({ prompt, title, payload });
  if (status.adapter === "moises-audio") return callMoisesAudio({ prompt, title, payload });
  if (status.adapter === "stability-audio") return callStabilityAudio({ prompt, title, payload });
  if (status.adapter === "generic-endpoint") {
    return callGenericEndpoint({ providerStatus: status, prompt, title, kind, providerName, payload });
  }
  return {
    previewUrl: `local-placeholder://${kind}/${Date.now()}`,
    note: "Local placeholder provider completed."
  };
}

async function runProviderGateway({ kind, providerStatus: requestedStatus, prompt, title, payload = {} }) {
  const requestedProvider = requestedStatus.name;
  const fallbackEnabled = providerFallbacksEnabled(payload);
  const candidates = providerFallbackChain(kind, requestedProvider, payload);
  const route = [];
  let lastError = null;

  for (let index = 0; index < candidates.length; index += 1) {
    const candidateName = candidates[index];
    const status = providerStatus(candidateName);
    const routeItem = {
      provider: status.name,
      adapter: status.adapter,
      status: status.status,
      attempted: false,
      ok: false
    };

    if (!status.connected) {
      const error = providerRoutingError(status);
      lastError = error;
      route.push({
        ...routeItem,
        skipped: true,
        code: error.code,
        message: status.message || providerFallbackMessage
      });
      if (!fallbackEnabled) break;
      continue;
    }

    routeItem.attempted = true;

    try {
      if (shouldForceProviderFailure(payload, status, index)) {
        throw simulatedProviderFailure(status);
      }

      const adapter = new ProviderAdapter(status);
      const result = await adapter.generate({ kind, prompt, title, payload });
      const diagnosticKey = providerDiagnosticKey(status.name, providerCatalog[status.name] || {});
      if (["Runway", "Replicate"].includes(diagnosticKey)) {
        setProviderDiagnostic(diagnosticKey, {
          status: "AVAILABLE",
          errorName: null,
          errorCode: null,
          customerMessage: "Provider available.",
          metadata: { source: "successful_provider_request" }
        });
      }
      const fallback = status.name === requestedProvider
        ? null
        : {
            from: requestedProvider,
            to: status.name,
            reason: lastError ? readableProviderError(lastError, requestedProvider) : "Primary provider unavailable."
          };

      route.push({ ...routeItem, ok: true });
      return {
        providerName: status.name,
        providerStatus: status,
        providerResult: result,
        fallback,
        route
      };
    } catch (error) {
      lastError = error;
      route.push({
        ...routeItem,
        code: error.code || "provider_error",
        message: readableProviderError(error, status.name)
      });

      if (!fallbackEnabled || !isProviderFallbackError(error)) {
        break;
      }
    }
  }

  const error = mutableCodedError(lastError || new Error(providerFallbackMessage), "provider_gateway_failed");
  error.route = route;
  throw error;
}

function buildFailedEntry({ kind, title, providerName, prompt, message, code }) {
  return {
    id: requestId(kind),
    kind,
    title,
    provider: providerName,
    prompt,
    status: "error",
    code,
    message,
    creditsUsed: 0,
    result: null,
    createdAt: new Date().toISOString()
  };
}

function readableProviderError(error, providerName) {
  const message = error?.message || "";
  const lower = message.toLowerCase();
  if (error?.code === "seedance_missing_image") {
    return message;
  }
  const envHint = providerModelEnvHints[providerName];
  if (envHint && (lower.includes("invalid model") || lower.includes("model not found") || lower.includes("does not exist") || lower.includes("modelnotopen"))) {
    return `${providerName} rejected the model ID. Update ${envHint} in your .env.`;
  }
  if ([400, 404].includes(error?.statusCode) && envHint) {
    return `${providerName} rejected the request (${error.statusCode}): ${message || `Check ${envHint}, duration, and required media URLs.`}`;
  }
  if (lower.includes("quota") || lower.includes("billing")) {
    return `${providerName} is connected, but the account quota or billing limit stopped the request.`;
  }
  if (lower.includes("401") || lower.includes("unauthorized") || lower.includes("invalid api key")) {
    return `${providerName} rejected the API key. Check the key in your environment settings.`;
  }
  if (lower.includes("abort") || lower.includes("timeout")) {
    return `${providerName} took too long to respond. Try again or switch provider.`;
  }
  return message || errorFallbackFor("studio");
}

function collectUrlCandidates(value, urls = []) {
  if (!value) return urls;
  if (typeof value === "string") {
    if (/^https?:\/\//i.test(value) || value.startsWith("data:") || value.startsWith("local-placeholder://")) urls.push(value);
    return urls;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectUrlCandidates(item, urls));
    return urls;
  }
  if (typeof value === "object") {
    [
      value.url,
      value.uri,
      value.video_url,
      value.videoUrl,
      value.audio_url,
      value.audioUrl,
      value.image_url,
      value.imageUrl,
      value.output_url,
      value.outputUrl,
      value.result_url,
      value.resultUrl,
      value.previewUrl,
      value.output,
      value.outputs,
      value.images,
      value.videos,
      value.audio,
      value.data,
      value.result
    ].forEach((item) => collectUrlCandidates(item, urls));
  }
  return urls;
}

function extractProviderOutputUrls(result = {}) {
  const urls = collectUrlCandidates([
    result.previewUrl,
    result.outputUrl,
    result.outputUrls,
    result.videoUrl,
    result.audioUrl,
    result.raw
  ]);
  const replicateUrl = firstUrlFromReplicateOutput(result.raw?.output || result.output);
  return [...new Set([replicateUrl, ...urls].filter(Boolean))];
}

function providerResultIsFailed(result = {}) {
  const status = String(result.status || result.raw?.status || "").toLowerCase();
  return ["failed", "error", "errored", "cancelled", "canceled"].includes(status);
}

function providerResultIsPending(result = {}) {
  const status = String(result.status || result.raw?.status || "").toLowerCase();
  const outputUrls = extractProviderOutputUrls(result);
  if (providerResultIsFailed(result)) return false;
  if (["succeeded", "success", "completed", "complete", "done"].includes(status)) return false;
  if (["timeline_planned", "ready"].includes(status)) return false;
  if (["processing", "queued", "submitted", "starting", "in_queue", "in_progress"].includes(status)) return true;
  return Boolean(result.providerJobId && outputUrls.length === 0);
}

function applyUsageForJob(job) {
  if (!job.usageKey) return;
  usageBuckets.set(job.usageKey, (usageBuckets.get(job.usageKey) || 0) + 1);
}

function storageDownloadHeadersForProvider(providerName = "", result = {}) {
  const provider = String(providerName || result.provider || result.raw?.model || "").toLowerCase();
  if ((provider.includes("replicate") || provider.includes("flux") || provider.includes("stable")) && hasEnvValue("REPLICATE_API_TOKEN")) {
    return { Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}` };
  }
  return {};
}

async function completeAsyncJob({ job, providerRun, providerResult, message, request = null }) {
  if (!job) return { job: null, historyItem: null, project: null };
  const result = providerResult || providerRun?.providerResult || {};
  const providerOutputUrls = extractProviderOutputUrls(result);
  const providerName = providerRun?.providerName || job.provider;
  const providerRoute = providerRun?.route || job.providerRoute || [];
  const providerFallback = providerRun?.fallback || job.providerFallback || null;
  const cdnBaseUrl = result.cdnBaseUrl || job.cdnBaseUrl || storagePublicBaseUrl(request);
  const sourceHeaders = storageDownloadHeadersForProvider(providerName, result);

  let storageResult;
  try {
    storageResult = await persistProviderAssets({
      job: { ...job, provider: providerName },
      outputUrls: providerOutputUrls,
      cdnBaseUrl,
      sourceHeaders
    });
  } catch (error) {
    const storageError = mutableCodedError(error, "asset_storage_failed");
    appendJobEvent(job, { type: "asset_storage_failed", error: storageError.message });
    return await failAsyncJob({ job, error: storageError, providerRun });
  }

  const outputUrls = storageResult.outputUrls.length ? storageResult.outputUrls : providerOutputUrls;
  const outputUrl = storageResult.outputUrl || outputUrls[0] || result.previewUrl || null;
  const persistedProviderOutputUrls = providerOutputUrls.map((url) =>
    String(url || "").startsWith("data:") ? "inline-provider-output:persisted-to-slt-storage" : url
  );
  const persistedProviderResult = {
    ...result,
    previewUrl: outputUrl,
    outputUrl,
    outputUrls,
    audioUrl: String(result.audioUrl || "").startsWith("data:") ? outputUrl : result.audioUrl,
    providerOutputUrls: persistedProviderOutputUrls
  };
  const outputModeration = outputModerationAssessment({ job, result, outputUrls });

  const ledgerResolution = job.reservationId
    ? await resolveReservationTransactional({
        reservationId: job.reservationId,
        outcome: "capture",
        jobId: job.id,
        idempotencyKey: `capture:${job.reservationId}`,
        reason: "provider_completed_asset_stored"
      })
    : { reservation: null, transaction: null, wallet: ledgerSnapshot(job.tenantId), skipped: true };

  updateJob(job.id, {
    status: jobStates.completed,
    progress: 100,
    provider: providerName,
    providerJobId: result.providerJobId || job.providerJobId,
    reservationStatus: ledgerResolution.reservation?.status || job.reservationStatus,
    ledgerTransactionId: ledgerResolution.transaction?.id || job.ledgerTransactionId || null,
    outputUrl,
    outputUrls,
    providerOutputUrls: persistedProviderOutputUrls,
    providerResult: persistedProviderResult,
    assets: storageResult.assets,
    assetId: storageResult.assets?.[0]?.id || null,
    storage: storageResult.storage,
    needs_review: outputModeration.needs_review,
    needsReview: outputModeration.needsReview,
    outputModeration,
    providerRoute,
    providerFallback,
    error: null
  });
  applyUsageForJob(job);
  const entry = updateHistoryItem(job.historyItemId, {
    provider: providerName,
    status: "completed",
    message: message || `${job.kind} generation completed with ${providerName}.`,
    creditsUsed: job.creditCost,
    ledger: {
      reservationId: job.reservationId,
      resolution: "capture",
      transactionId: ledgerResolution.transaction?.id || null,
      wallet: ledgerResolution.wallet
    },
    result: {
      ...persistedProviderResult,
      providerJobId: job.id,
      providerRequestId: result.providerJobId || job.providerJobId || null,
      jobId: job.id,
      request_id: job.id,
      batchId: job.batchId || null,
      projectId: job.projectId || null,
      sessionId: job.sessionId || null,
      status: "completed",
      state: jobStates.completed,
      reservationId: job.reservationId,
      reservationStatus: ledgerResolution.reservation?.status || null,
      previewUrl: outputUrl,
      outputUrl,
      outputUrls,
      providerOutputUrls: persistedProviderOutputUrls,
      assets: storageResult.assets,
      storage: storageResult.storage,
      needs_review: outputModeration.needs_review,
      needsReview: outputModeration.needsReview,
      outputModeration,
      fallback: providerFallback,
      providerRoute,
      exportFormats: exportFormatsFor(job.kind)
    }
  });
  let project = state.projects.find((item) => item.id === job.projectId) || null;
  if (project) {
    project.status = jobStates.completed;
    project.thumbnail = outputUrl;
    project.updatedAt = new Date().toISOString();
  } else if (entry) {
    project = saveProjectFromEntry(entry);
    updateJob(job.id, { projectId: project.id });
  }
  await persistRuntimeState(`async_job_completed:${job.id}`);
  return { job: findJob(job.id), historyItem: entry, project };
}

async function failAsyncJob({ job, error, providerRun = null }) {
  if (!job) return { job: null, historyItem: null };
  const originalCode = error?.code || "provider_error";
  const providerRoute = error?.route || providerRun?.route || job.providerRoute || [];
  const ledgerResolution = job.reservationId
    ? await resolveReservationTransactional({
        reservationId: job.reservationId,
        outcome: "release",
        jobId: job.id,
        idempotencyKey: `release:${job.reservationId}`,
        reason: originalCode
      })
    : { reservation: null, transaction: null, wallet: ledgerSnapshot(job.tenantId), skipped: true };
  const failure = await recordSltFailure({
    job,
    error,
    ledgerResolution,
    context: {
      provider: providerRun?.providerName || job.provider,
      providerRoute,
      source: "async_generation",
      reservationReleased: ledgerResolution.reservation?.status === "released"
    }
  });
  const code = failure.classification.name;
  const message = failure.incident.clientVisibleMessage;
  updateJob(job.id, {
    status: jobStates.failed,
    progress: Number(job.progress || 0),
    reservationStatus: ledgerResolution.reservation?.status || job.reservationStatus,
    ledgerTransactionId: ledgerResolution.transaction?.id || job.ledgerTransactionId || null,
    incidentId: failure.incident.incidentId,
    error: {
      code,
      errorCode: failure.classification.code,
      incidentId: failure.incident.incidentId,
      message,
      customerMessage: message,
      retryable: failure.classification.retryable,
      reservationReleased: failure.incident.reservationReleased,
      compensation: failure.publicError.compensation
    },
    providerRoute
  });
  const entry = updateHistoryItem(job.historyItemId, {
    status: "error",
    code,
    message,
    creditsUsed: 0,
    ledger: {
      reservationId: job.reservationId,
      resolution: "release",
      transactionId: ledgerResolution.transaction?.id || null,
      wallet: ledgerResolution.wallet
    },
    result: {
      providerJobId: job.id,
      jobId: job.id,
      request_id: job.id,
      batchId: job.batchId || null,
      projectId: job.projectId || null,
      sessionId: job.sessionId || null,
      status: "failed",
      state: jobStates.failed,
      reservationId: job.reservationId,
      reservationStatus: ledgerResolution.reservation?.status || null,
      error: message,
      errorCode: failure.classification.code,
      incidentId: failure.incident.incidentId,
      retryable: failure.classification.retryable,
      compensation: failure.publicError.compensation,
      providerRoute,
      exportFormats: exportFormatsFor(job.kind)
    }
  });
  await persistRuntimeState(`async_job_failed:${job.id}`);
  return { job: findJob(job.id), historyItem: entry, failure };
}

async function processAsyncGenerationJob({ jobId, kind, prompt, title, payload, checks }) {
  const job = updateJob(jobId, { status: jobStates.processing, progress: 3 });
  if (!job) return;
  appendJobEvent(job, { type: "started" });
  try {
    if (payload.webhookOnly === true || payload.deferProviderUntilWebhook === true) {
      updateJob(job.id, {
        status: jobStates.processing,
        providerJobId: payload.providerJobId || job.id
      });
      updateHistoryItem(job.historyItemId, (entry) => ({
        message: `${kind} generation reserved and waiting for provider webhook.`,
        result: {
          ...entry.result,
          providerJobId: job.id,
          providerRequestId: payload.providerJobId || job.id,
          jobId: job.id,
          request_id: job.id,
          status: "processing",
          state: jobStates.processing,
          note: "Webhook-only simulation is waiting for a signed provider callback.",
          exportFormats: exportFormatsFor(kind)
        }
      }));
      appendJobEvent(findJob(job.id), { type: "webhook_only_wait" });
      return;
    }

    const providerRun = kind === "video" && payload.videoPlan?.mode === "timeline"
      ? {
          providerName: job.provider,
          providerStatus: checks.provider,
          providerResult: buildLongVideoTimeline({ prompt, title, providerName: job.provider, plan: payload.videoPlan }),
          fallback: null,
          route: [{ provider: job.provider, adapter: checks.provider.adapter, status: "timeline_planned", attempted: true, ok: true }]
        }
      : await runProviderGateway({
          kind,
          providerStatus: checks.provider,
          prompt,
          title,
          payload
        });

    const providerResult = providerRun.providerResult || {};
    updateJob(job.id, {
      provider: providerRun.providerName,
      providerJobId: providerResult.providerJobId || job.providerJobId,
      providerRoute: providerRun.route || [],
      providerFallback: providerRun.fallback || null,
      providerResult
    });

    updateHistoryItem(job.historyItemId, (entry) => ({
      provider: providerRun.providerName,
      message: `${kind} generation processing with ${providerRun.providerName}.`,
      result: {
        ...entry.result,
        ...providerResult,
        providerJobId: job.id,
        providerRequestId: providerResult.providerJobId || null,
        jobId: job.id,
        request_id: job.id,
        status: providerResultIsPending(providerResult) ? "processing" : clientJobStatus(job.status),
        state: findJob(job.id)?.status || jobStates.processing,
        fallback: providerRun.fallback,
        providerRoute: providerRun.route,
        exportFormats: exportFormatsFor(kind)
      }
    }));

    if (providerResultIsFailed(providerResult)) {
      const error = new Error(providerResult.note || "Provider returned a failed job.");
      error.code = "provider_job_failed";
      await failAsyncJob({ job: findJob(job.id), error, providerRun });
      return;
    }

    if (providerResultIsPending(providerResult)) {
      appendJobEvent(findJob(job.id), { type: "provider_submitted", providerJobId: providerResult.providerJobId || null });
      return;
    }

    await completeAsyncJob({
      job: findJob(job.id),
      providerRun,
      providerResult,
      message: `${kind} generation completed with ${providerRun.providerName}.`
    });
  } catch (error) {
    await failAsyncJob({ job: findJob(job.id), error });
  }
}

function drainGenerationQueue() {
  const limit = Math.max(1, envNumber("GENERATION_DISPATCH_CONCURRENCY", 3));
  while (activeGenerationExecutions < limit && generationExecutionQueue.length) {
    const task = generationExecutionQueue.shift();
    activeGenerationExecutions += 1;
    updateJob(task.job.id, { status: jobStates.processing, progress: 1 });
    void processAsyncGenerationJob(task)
      .catch((error) => failAsyncJob({ job: findJob(task.job.id), error }))
      .finally(() => {
        activeGenerationExecutions = Math.max(0, activeGenerationExecutions - 1);
        drainGenerationQueue();
      });
  }
}

function enqueueAsyncGeneration({ job, kind, prompt, title, payload, checks }) {
  const limit = Math.max(1, envNumber("GENERATION_DISPATCH_CONCURRENCY", 3));
  const waitingForCapacity = activeGenerationExecutions >= limit || generationExecutionQueue.length > 0;
  updateJob(job.id, {
    status: waitingForCapacity ? jobStates.throttled : jobStates.pending,
    progress: 0
  });
  generationExecutionQueue.push({ job, jobId: job.id, kind, prompt, title, payload, checks });
  queueMicrotask(drainGenerationQueue);
}

async function refreshLocalJobFromProvider(job) {
  if (!job || [jobStates.completed, jobStates.failed].includes(job.status) || !job.providerJobId) {
    return { job, historyItem: state.history.find((item) => item.id === job?.historyItemId) || null, project: null };
  }

  if (job.provider === "OmniHuman") {
    const { data, outputUrls, jobStatus } = await getOmniHumanJob(job.providerJobId);
    if (jobStatus === "completed" && outputUrls.length) {
      return await completeAsyncJob({
        job,
        providerResult: {
          providerJobId: job.providerJobId,
          status: "completed",
          previewUrl: outputUrls[0],
          outputUrl: outputUrls[0],
          outputUrls,
          cdnBaseUrl: storagePublicBaseUrl(),
          raw: data
        },
        message: "OmniHuman video completed."
      });
    }
    if (jobStatus === "failed") {
      const error = new Error("OmniHuman video failed.");
      error.code = "provider_job_failed";
      return await failAsyncJob({ job, error });
    }
  }

  if (job.provider === "Seedance") {
    const apiKey = providerApiKey(providerCatalog.Seedance);
    const data = await getJson(`${seedanceBaseUrl()}/contents/generations/tasks/${encodeURIComponent(job.providerJobId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeoutMs: 60000
    });
    const outputUrls = extractSeedanceOutputUrls(data);
    const jobStatus = normalizeSeedanceStatus(data);
    if (jobStatus === "completed" && outputUrls.length) {
      return await completeAsyncJob({
        job,
        providerResult: {
          providerJobId: job.providerJobId,
          status: "completed",
          previewUrl: outputUrls[0],
          outputUrl: outputUrls[0],
          outputUrls,
          cdnBaseUrl: storagePublicBaseUrl(),
          raw: data
        },
        message: "Seedance video completed."
      });
    }
    if (jobStatus === "failed") {
      const error = new Error(extractProviderFailureMessage(data, "Seedance video failed."));
      error.code = "provider_job_failed";
      error.provider = "Seedance";
      error.providerJobId = job.providerJobId;
      return await failAsyncJob({ job, error });
    }
  }

  if (job.provider === "Runway") {
    const data = await getJson(`${runwayBaseUrl()}/tasks/${encodeURIComponent(job.providerJobId)}`, {
      headers: runwayHeaders(),
      timeoutMs: 60000
    });
    const jobStatus = normalizeWebhookStatus(data.status);
    const outputUrls = collectUrlCandidates(data.output || data.outputs || data.result);
    if (jobStatus === "completed" && outputUrls.length) {
      return await completeAsyncJob({
        job,
        providerResult: {
          providerJobId: job.providerJobId,
          status: "completed",
          previewUrl: outputUrls[0],
          outputUrl: outputUrls[0],
          outputUrls,
          cdnBaseUrl: storagePublicBaseUrl(),
          raw: data,
          model: data.model || job.providerResult?.model || null
        },
        message: job.payload?.realityTransform
          ? "Runway Reality Transform completed."
          : "Runway video completed."
      });
    }
    if (jobStatus === "failed") {
      const error = new Error(extractProviderFailureMessage(data, "Runway video failed."));
      error.code = "provider_job_failed";
      error.provider = "Runway";
      error.providerJobId = job.providerJobId;
      return await failAsyncJob({ job, error });
    }
    updateJob(job.id, {
      status: jobStatus === "queued" ? jobStates.queued : jobStates.processing,
      providerResult: { ...(job.providerResult || {}), raw: data, status: jobStatus }
    });
  }

  if (providerCatalog[job.provider]?.adapter === "replicate-luma-modify") {
    const data = await getJson(`${replicateBaseUrl()}/predictions/${encodeURIComponent(job.providerJobId)}`, {
      headers: { Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}` },
      timeoutMs: 60000
    });
    const outputUrl = firstUrlFromReplicateOutput(data.output);
    const jobStatus = normalizeWebhookStatus(data.status);
    if (jobStatus === "completed" && outputUrl) {
      return await completeAsyncJob({
        job,
        providerResult: {
          providerJobId: job.providerJobId,
          status: "completed",
          previewUrl: outputUrl,
          outputUrl,
          outputUrls: [outputUrl],
          cdnBaseUrl: storagePublicBaseUrl(),
          raw: data,
          model: "luma/modify-video"
        },
        message: "Luma Modify Reality Transform completed."
      });
    }
    if (jobStatus === "failed") {
      const error = new Error(data.error || "Luma Modify failed.");
      error.code = "provider_job_failed";
      error.provider = "Luma Modify";
      error.providerJobId = job.providerJobId;
      return await failAsyncJob({ job, error });
    }
    updateJob(job.id, {
      status: jobStatus === "queued" ? jobStates.queued : jobStates.processing,
      providerResult: { ...(job.providerResult || {}), raw: data, status: jobStatus }
    });
  }

  if (job.kind === "image" && providerCatalog[job.provider]?.adapter === "replicate-image") {
    const data = await getJson(`${replicateBaseUrl()}/predictions/${encodeURIComponent(job.providerJobId)}`, {
      headers: { Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}` },
      timeoutMs: 60000
    });
    const outputUrl = firstUrlFromReplicateOutput(data.output);
    const jobStatus = normalizeWebhookStatus(data.status);
    if (jobStatus === "completed" && outputUrl) {
      return await completeAsyncJob({
        job,
        providerResult: {
          providerJobId: job.providerJobId,
          status: "completed",
          previewUrl: outputUrl,
          outputUrl,
          outputUrls: [outputUrl],
          cdnBaseUrl: storagePublicBaseUrl(),
          raw: data
        },
        message: "Replicate image completed."
      });
    }
    if (jobStatus === "failed") {
      const error = new Error(data.error || "Replicate image failed.");
      error.code = "provider_job_failed";
      return await failAsyncJob({ job, error });
    }
  }

  return {
    job: findJob(job.id),
    historyItem: state.history.find((item) => item.id === job.historyItemId) || null,
    project: job.projectId ? state.projects.find((item) => item.id === job.projectId) || null : null
  };
}

function firstReferenceAssetId(payload = {}) {
  const ids = [
    payload.sourceAssetId,
    payload.referenceVideoAssetId,
    ...(Array.isArray(payload.referenceAssetIds) ? payload.referenceAssetIds : [])
  ].filter(Boolean);
  return ids[0] || null;
}

function prepareCharacterReferences({ payload = {}, auth }) {
  const requestedIds = [...new Set((Array.isArray(payload.characterIds) ? payload.characterIds : [payload.characterId]).filter(Boolean))].slice(0, 8);
  if (!requestedIds.length) return payload;

  const selectedAssets = [];
  const characterReferences = requestedIds.map((characterId) => {
    const summary = characterDatasetSummary(characterId, auth);
    if (!summary) {
      const error = new Error("Character not found.");
      error.code = "character_not_found";
      error.statusCode = 404;
      throw error;
    }
    if (!summary.consentGranted) {
      const error = new Error(`Character ${summary.character.name} cannot be used because consent is not currently granted.`);
      error.code = "character_consent_required";
      error.statusCode = 409;
      throw error;
    }
    const preferred = [
      summary.character.primaryAssetId,
      ...summary.assets.filter(({ asset }) => String(asset.contentType || "").startsWith("image/")).map(({ asset }) => asset.id),
      ...summary.assets.filter(({ asset }) => String(asset.contentType || "").startsWith("video/")).map(({ asset }) => asset.id)
    ].filter(Boolean);
    const assetIds = [...new Set(preferred)].slice(0, 5);
    assetIds.forEach((assetId) => {
      const asset = findOwnedAsset(assetId, auth);
      if (asset) selectedAssets.push(asset);
    });
    return {
      id: summary.character.id,
      name: summary.character.name,
      version: summary.versions[0]?.version || null,
      ready: summary.ready,
      referenceAssetIds: assetIds
    };
  });

  const referenceAssetIds = [...new Set([
    ...(Array.isArray(payload.referenceAssetIds) ? payload.referenceAssetIds : []),
    ...selectedAssets.map((asset) => asset.id)
  ])].slice(0, 12);
  const imageReference = selectedAssets.find((asset) => String(asset.contentType || "").startsWith("image/"));
  const videoReference = selectedAssets.find((asset) => String(asset.contentType || "").startsWith("video/"));
  return {
    ...payload,
    characterIds: requestedIds,
    characterReferences,
    referenceAssetIds,
    referenceImageUrl: payload.referenceImageUrl || imageReference?.publicUrl || "",
    referenceVideoUrl: payload.referenceVideoUrl || videoReference?.publicUrl || ""
  };
}

function prepareGenerationPayload({ kind, payload = {}, auth }) {
  const preparedPayload = prepareCharacterReferences({ payload, auth });
  if (kind !== "video" || !isRealityTransformPayload(preparedPayload)) return preparedPayload;

  const sourceAssetId = firstReferenceAssetId(preparedPayload);
  const sourceAsset = sourceAssetId ? findOwnedAsset(sourceAssetId, auth) : null;
  if (sourceAsset && !String(sourceAsset.contentType || "").startsWith("video/")) {
    const error = new Error("Reality Transform needs a source video, not an image or audio file.");
    error.code = "reality_transform_video_required";
    error.statusCode = 400;
    throw error;
  }

  const sourceVideoUrl = String(
    preparedPayload.sourceVideoUrl ||
    preparedPayload.referenceVideoUrl ||
    preparedPayload.videoUri ||
    sourceAsset?.publicUrl ||
    ""
  ).trim();
  if (!sourceVideoUrl && !sourceAsset) {
    const error = new Error("Upload the source performance video before starting Reality Transform.");
    error.code = "reality_transform_source_required";
    error.statusCode = 400;
    throw error;
  }

  if (process.env.SLT_TEST_MODE !== "1") {
    if (!sourceAsset) {
      const error = new Error("Reality Transform requires a source video uploaded and validated by SLT Storage.");
      error.code = "reality_transform_validated_asset_required";
      error.statusCode = 400;
      throw error;
    }
    const mediaMetadata = sourceAsset.metadata?.media || sourceAsset.metadata || {};
    if (!sourceAsset.metadata?.serverValidated) {
      const error = new Error("This source predates server validation. Upload it again before using Reality Transform.");
      error.code = "reality_transform_revalidation_required";
      error.statusCode = 400;
      throw error;
    }
    assertRealityTransformMedia(mediaMetadata);
  }

  const requestedDuration = Number(
    preparedPayload.sourceDurationSeconds ||
    sourceAsset?.metadata?.durationSeconds ||
    preparedPayload.durationSeconds ||
    preparedPayload.videoDurationSeconds ||
    0
  );
  if (Number.isFinite(requestedDuration) && requestedDuration > 0 && (requestedDuration < 2 || requestedDuration > 30)) {
    const error = new Error("Reality Transform accepts source clips from 2 to 30 seconds.");
    error.code = "reality_transform_duration_invalid";
    error.statusCode = 400;
    throw error;
  }

  const requestedResolution = String(preparedPayload.outputResolution || preparedPayload.resolution || "1080p").toLowerCase();
  if (["2k", "4k", "8k"].includes(requestedResolution)) {
    const error = new Error("Runway Aleph 2 generates up to 1080p. Choose 1080p, then run Upscale as a separate operation.");
    error.code = "reality_transform_native_resolution_invalid";
    error.statusCode = 400;
    throw error;
  }

  return {
    ...preparedPayload,
    sourceAssetId: sourceAsset?.id || sourceAssetId || null,
    sourceVideoUrl,
    referenceVideoUrl: sourceVideoUrl,
    sourceDurationSeconds: requestedDuration || null,
    resolution: preparedPayload.resolution || "1080p",
    outputResolution: preparedPayload.outputResolution || preparedPayload.resolution || "1080p",
    realityTransform: true,
    model: preparedPayload.model || (normalizeProviderName(preparedPayload.provider || preparedPayload.providerLabel || "") === "Runway" ? "aleph2" : preparedPayload.model)
  };
}

function handleGenerate(kind) {
  return async (request, response) => {
    if (failProviderIfRequested(request, response)) return;

    const requestedProvider = String(request.body?.provider || request.body?.providerLabel || "").trim().toLowerCase();
    if (["auto", "slt auto"].includes(requestedProvider)) {
      const routed = routeMultimodalModel({ ...(request.body || {}), modality: kind });
      if (!routed.ok || !routed.selected) {
        response.status(routed.comingSoon ? 422 : 409).json({
          ok: false,
          code: routed.comingSoon ? "operation_coming_soon" : "compatible_provider_unavailable",
          error: routed.message,
          readableError: routed.message,
          route: routed
        });
        return;
      }
      request.body = {
        ...(request.body || {}),
        provider: routed.selected.provider,
        providerLabel: routed.selected.provider,
        model: routed.selected.model,
        modelId: routed.selected.model,
        operation: routed.request.operation,
        modelRoute: { priority: routed.request.priority, selectedModelId: routed.selected.id }
      };
    } else if (request.body?.capabilityAware === true) {
      const routed = routeMultimodalModel({ ...(request.body || {}), modality: kind });
      if (!routed.selected) {
        response.status(422).json({
          ok: false,
          code: "operation_coming_soon",
          error: routed.message,
          readableError: routed.message,
          route: routed
        });
        return;
      }
    }

    if (
      kind === "video" &&
      isRealityTransformPayload(request.body || {}) &&
      normalizeProviderName(request.body?.provider || request.body?.providerLabel || "") === "Runway" &&
      !request.body?.model &&
      !request.body?.modelId
    ) {
      request.body = { ...(request.body || {}), model: "aleph2" };
    }
    const checks = baseChecks(request, kind);
    const prompt = request.body?.prompt || request.body?.description || "";
    const title = request.body?.title || `${kind} project`;
    if (!checks.plan.ok) {
      const failed = buildFailedEntry({
        kind,
        title,
        providerName: checks.provider.name,
        prompt,
        message: checks.plan.message,
        code: checks.plan.code || "plan_limit"
      });
      saveHistory(failed);
      response.status(checks.plan.statusCode || 403).json({ ok: false, checks, historyItem: failed, error: checks.plan.message, code: checks.plan.code || "plan_limit" });
      return;
    }

    const inputModeration = await runInputModeration({ kind, title, prompt, payload: request.body || {} });
    if (!inputModeration.ok) {
      const moderationError = new Error(inputModeration.reason || "Prompt blocked by input moderation.");
      moderationError.sltCode = "PROMPT_BLOCKED";
      moderationError.code = "moderation_blocked";
      moderationError.statusCode = 400;
      const failure = await recordSltFailure({
        request,
        auth: checks.auth,
        error: moderationError,
        context: { kind, modality: kind.toUpperCase(), provider: checks.provider.name, source: "input_moderation", deliberateInvalid: true }
      });
      response.status(400).json(sltErrorResponsePayload(failure, {
        moderation: moderationFailurePayload({ moderation: inputModeration, kind, title }).moderation
      }));
      return;
    }

    if (!checks.credits.ok) {
      const failed = buildFailedEntry({
        kind,
        title,
        providerName: checks.provider.name,
        prompt,
        message: checks.credits.readableError,
        code: "insufficient_credits"
      });
      saveHistory(failed);
      const creditError = new Error(checks.credits.readableError || "Insufficient credits.");
      creditError.sltCode = "USER_INSUFFICIENT_CREDITS";
      creditError.code = "insufficient_credits";
      creditError.statusCode = 402;
      const failure = await recordSltFailure({
        request,
        auth: checks.auth,
        error: creditError,
        context: {
          kind,
          modality: kind.toUpperCase(),
          provider: checks.provider.name,
          system: "ledger",
          creditsBefore: checks.credits.available,
          creditsReserved: 0,
          creditsAfter: checks.credits.available,
          source: "credit_preflight"
        }
      });
      response.status(402).json(sltErrorResponsePayload(failure, { checks, historyItem: failed }));
      return;
    }

    if (checks.provider.errorName && !checks.provider.connected) {
      const providerError = new Error(checks.provider.message || "Provider temporarily unavailable.");
      providerError.sltCode = checks.provider.errorName;
      providerError.code = checks.provider.errorName;
      providerError.statusCode = 503;
      const failure = await recordSltFailure({
        request,
        auth: checks.auth,
        error: providerError,
        context: {
          kind,
          modality: kind.toUpperCase(),
          provider: checks.provider.diagnostic?.provider || checks.provider.name,
          model: request.body?.model || request.body?.modelId || checks.provider.model?.id || null,
          operation: generationAction(request.body || {}),
          creditsBefore: checks.credits.available,
          creditsReserved: 0,
          creditsAfter: checks.credits.available,
          customerMessage: checks.provider.message,
          source: "provider_preflight"
        }
      });
      response.status(503).json(sltErrorResponsePayload(failure, { checks, provider: checks.provider }));
      return;
    }

    const providerName = checks.provider.name;
    let selectedProviderName = providerName;
    let runtimeChecks = checks;
    let activeReservation = null;
    const activeReservations = [];
    try {
      let payload = prepareGenerationPayload({ kind, payload: request.body || {}, auth: checks.auth });
      let videoPlan = null;
      if (kind === "video") {
        videoPlan = resolveVideoPlan({ payload, auth: checks.auth, providerName });
        payload = { ...payload, videoPlan };
      }

      if (shouldQueueGeneration(kind, checks.provider, payload)) {
        const outputCount = billableOutputCount(payload);
        const tenantId = requestIdentity(request, checks.auth);
        const perOutputCost = checks.credits.mode?.includes("provider-direct")
          ? 0
          : creditCostFor(kind, { ...payload, outputCount: 1, count: 1, quantity: 1 });
        const totalCredits = perOutputCost * outputCount;
        const batchRequestKey = generationIdempotencyKey(request, kind, "batch");
        const existingBatch = state.generationBatches.find((item) => item.idempotencyKey === batchRequestKey);
        if (existingBatch) {
          const serialized = serializeGenerationBatch(existingBatch);
          response.status(202).json({
            ok: true,
            accepted: true,
            async: true,
            idempotent: true,
            batchId: existingBatch.id,
            jobId: serialized.jobIds[0] || null,
            jobIds: serialized.jobIds,
            jobs: serialized.jobs,
            batch: serialized,
            message: `${kind} generation batch already accepted.`
          });
          return;
        }

        const project = createGenerationProject({
          tenantId,
          userId: checks.auth.userId,
          title,
          kind,
          requestedProjectId: payload.projectId || null
        });
        const generationSession = createGenerationSession({
          tenantId,
          userId: checks.auth.userId,
          projectId: project.id,
          title,
          kind,
          requestedSessionId: payload.sessionId || null
        });
        const batch = createGenerationBatch({
          tenantId,
          userId: checks.auth.userId,
          projectId: project.id,
          sessionId: generationSession.id,
          kind,
          payload,
          providerName,
          outputCount,
          idempotencyKey: batchRequestKey,
          totalCredits
        });
        const jobs = [];
        const historyItems = [];
        const reservedOutputs = [];
        const pendingDispatches = [];
        let latestWallet = ledgerSnapshot(tenantId);

        // Reserve every output before dispatching any provider request. This prevents
        // partially-funded batches from leaking already-running jobs.
        for (let index = 1; index <= outputCount; index += 1) {
          const jobId = requestId("job");
          const variationPayload = {
            ...payload,
            outputCount: 1,
            count: 1,
            quantity: 1,
            batchId: batch.id,
            batchIndex: index,
            projectId: project.id,
            sessionId: generationSession.id,
            variationIndex: index,
            variationCount: outputCount,
            seed: Number.isFinite(Number(payload.seed)) ? Number(payload.seed) + index - 1 : undefined
          };
          const reservationResult = await reserveCreditsTransactional({
            amount: perOutputCost,
            kind,
            auth: checks.auth,
            request,
            idempotencyKey: `${batchRequestKey}:reserve:${index}`,
            metadata: {
              jobId,
              title,
              provider: providerName,
              batchId: batch.id,
              batchIndex: index,
              projectId: project.id,
              sessionId: generationSession.id,
              promptHash: crypto.createHash("sha256").update(prompt).digest("hex")
            }
          });
          if (reservationResult.reservation) activeReservations.push(reservationResult.reservation);
          latestWallet = reservationResult.wallet || latestWallet;
          reservedOutputs.push({ index, jobId, variationPayload, reservationResult });
        }

        for (const reservedOutput of reservedOutputs) {
          const { index, jobId, variationPayload, reservationResult } = reservedOutput;
          const outputWallet = reservationResult.wallet || latestWallet;
          const ledgerCredits = {
            ...checks.credits,
            cost: perOutputCost,
            reservation: reservationResult.reservation,
            reserveTransactionId: reservationResult.transaction?.id || null,
            remaining: outputWallet.availableCredits,
            available: outputWallet.availableCredits,
            held: outputWallet.heldCredits,
            wallet: outputWallet
          };
          const ledgerChecks = {
            ...checks,
            credits: ledgerCredits,
            ledger: {
              reservationId: reservationResult.reservation?.id || null,
              reserveTransactionId: reservationResult.transaction?.id || null,
              wallet: outputWallet,
              skipped: Boolean(reservationResult.skipped)
            }
          };
          const job = createJob({
            jobId,
            kind,
            title: outputCount > 1 ? `${title} · ${index}/${outputCount}` : title,
            providerName,
            prompt,
            payload: variationPayload,
            checks: ledgerChecks,
            request,
            batch,
            batchIndex: index,
            projectId: project.id,
            sessionId: generationSession.id
          });
          // Local durable staging relies on provider polling when no public HTTPS
          // callback is available. Production keeps signed webhooks enabled.
          const webhookUrl = envFlag("DISABLE_PROVIDER_WEBHOOKS", false)
            ? ""
            : webhookUrlForJob(request, checks.provider, job.id);
          const asyncPayload = {
            ...variationPayload,
            jobId: job.id,
            request_id: job.id,
            webhookUrl,
            webhook_url: webhookUrl,
            callbackUrl: webhookUrl,
            callback_url: webhookUrl
          };
          const queuedChecks = {
            ...ledgerChecks,
            requestedProvider: checks.provider,
            providerWebhook: {
              provider: webhookProviderForStatus(checks.provider),
              url: webhookUrl,
              signatureRequired: Boolean(webhookUrl)
            }
          };
          const queuedEntry = buildQueuedHistoryEntry({ job, checks: queuedChecks });
          queuedEntry.batchId = batch.id;
          queuedEntry.projectId = project.id;
          queuedEntry.sessionId = generationSession.id;
          saveHistory(queuedEntry);
          if (reservationResult.reservation) {
            reservationResult.reservation.jobId = job.id;
            reservationResult.reservation.updatedAt = new Date().toISOString();
          }
          updateJob(job.id, {
            historyItemId: queuedEntry.id,
            reservationId: reservationResult.reservation?.id || null,
            reservationStatus: reservationResult.reservation?.status || null
          });
          pendingDispatches.push({ job: findJob(job.id), kind, prompt, title: job.title, payload: asyncPayload, checks: ledgerChecks });
          jobs.push(findJob(job.id));
          historyItems.push(queuedEntry);
        }

        pendingDispatches.forEach(enqueueAsyncGeneration);
        recomputeGenerationBatch(batch.id);
        const serializedBatch = serializeGenerationBatch(batch);
        runtimeChecks = {
          ...checks,
          credits: {
            ...checks.credits,
            cost: totalCredits,
            perOutputCost,
            outputCount,
            wallet: latestWallet,
            remaining: latestWallet.availableCredits,
            available: latestWallet.availableCredits,
            held: latestWallet.heldCredits
          }
        };
        response.status(202).json({
          ok: true,
          accepted: true,
          async: true,
          batchId: batch.id,
          request_id: batch.id,
          jobId: jobs[0]?.id || null,
          jobIds: jobs.map((job) => job.id),
          jobs: jobs.map(serializeJob),
          batch: serializedBatch,
          project,
          session: generationSession,
          checks: runtimeChecks,
          historyItems,
          historyItem: historyItems[0] || null,
          emptyState: emptyStateFor(kind),
          success: successFor(kind),
          message: `${outputCount} ${kind} output${outputCount === 1 ? "" : "s"} queued in batch ${batch.id}.`
        });
        return;
      }

      const reservationResult = await reserveCreditsTransactional({
        amount: checks.credits.cost,
        kind,
        auth: checks.auth,
        request,
        idempotencyKey: generationIdempotencyKey(request, kind, "reserve"),
        metadata: {
          title,
          provider: providerName,
          promptHash: crypto.createHash("sha256").update(prompt).digest("hex")
        }
      });
      activeReservation = reservationResult.reservation;
      if (activeReservation) activeReservations.push(activeReservation);
      const ledgerCredits = {
        ...checks.credits,
        reservation: reservationResult.reservation,
        reserveTransactionId: reservationResult.transaction?.id || null,
        remaining: reservationResult.wallet.availableCredits,
        available: reservationResult.wallet.availableCredits,
        held: reservationResult.wallet.heldCredits,
        wallet: reservationResult.wallet
      };
      const ledgerChecks = {
        ...checks,
        credits: ledgerCredits,
        ledger: {
          reservationId: reservationResult.reservation?.id || null,
          reserveTransactionId: reservationResult.transaction?.id || null,
          wallet: reservationResult.wallet,
          skipped: Boolean(reservationResult.skipped)
        }
      };
      runtimeChecks = ledgerChecks;

      const providerRun = kind === "video" && videoPlan?.mode === "timeline"
        ? {
            providerName,
            providerStatus: checks.provider,
            providerResult: buildLongVideoTimeline({ prompt, title, providerName, plan: videoPlan }),
            fallback: null,
            route: [{ provider: providerName, adapter: checks.provider.adapter, status: "timeline_planned", attempted: true, ok: true }]
          }
        : await runProviderGateway({
            kind,
            providerStatus: checks.provider,
            prompt,
            title,
            payload
          });
      selectedProviderName = providerRun.providerName;
      runtimeChecks = {
        ...ledgerChecks,
        requestedProvider: checks.provider,
        provider: providerRun.providerStatus,
        providerFallback: providerRun.fallback,
        providerRoute: providerRun.route
      };
      const syncLedgerResolution = activeReservation
        ? await resolveReservationTransactional({
            reservationId: activeReservation.id,
            outcome: "capture",
            idempotencyKey: `capture:${activeReservation.id}`,
            reason: "sync_provider_completed"
          })
        : null;
      const entry = {
        id: requestId(kind),
        tenantId: requestIdentity(request, checks.auth),
        kind,
        title,
        provider: selectedProviderName,
        prompt,
        status: "completed",
        message: `${kind} generation completed with ${selectedProviderName}.`,
        creditsUsed: checks.credits.cost,
        ledger: activeReservation
          ? {
              reservationId: activeReservation.id,
              resolution: "capture",
              ...syncLedgerResolution
            }
          : { reservationId: null, resolution: "none", wallet: ledgerSnapshot(requestIdentity(request, checks.auth)) },
        result: {
          ...providerRun.providerResult,
          fallback: providerRun.fallback,
          providerRoute: providerRun.route,
          exportFormats: exportFormatsFor(kind)
        },
        createdAt: new Date().toISOString()
      };
      incrementUsage({ kind, request, auth: checks.auth });
      saveHistory(entry);
      const project = saveProjectFromEntry(entry);

      response.json({
        ok: true,
        checks: runtimeChecks,
        project,
        historyItem: entry,
        emptyState: emptyStateFor(kind),
        success: successFor(kind),
        errorFallback: errorFallbackFor(kind)
      });
    } catch (error) {
      let releasedReservation = null;
      for (const reservation of activeReservations) {
        if (!reservation?.id || ["captured", "released"].includes(reservation.status)) continue;
        releasedReservation = await resolveReservationTransactional({
          reservationId: reservation.id,
          outcome: "release",
          idempotencyKey: `release:${reservation.id}`,
          reason: error.code || "generation_setup_failed"
        });
      }
      const originalCode = error.code || "provider_error";
      const failure = await recordSltFailure({
        request,
        auth: checks.auth,
        error,
        ledgerResolution: releasedReservation,
        context: {
          kind,
          modality: kind.toUpperCase(),
          provider: selectedProviderName,
          model: request.body?.model || request.body?.modelId || null,
          operation: generationAction(request.body || {}),
          providerRoute: error.route || runtimeChecks.providerRoute || [],
          creditsBefore: checks.credits.available,
          creditsReserved: activeReservations.reduce((total, reservation) => total + Number(reservation?.amount || 0), 0),
          creditsAfter: releasedReservation?.wallet?.availableCredits ?? checks.credits.available,
          reservationReleased: activeReservations.length > 0 && activeReservations.every((reservation) => ["released", "captured"].includes(reservation.status)),
          deliberateInvalid: ["model_not_found", "invalid_model", "model_parameter_unsupported"].includes(originalCode),
          source: "generation_setup"
        }
      });
      const code = failure.classification.name;
      const readableError = failure.incident.clientVisibleMessage;
      const failedEntry = buildFailedEntry({
        kind,
        title,
        providerName: selectedProviderName,
        prompt,
        message: readableError,
        code
      });
      failedEntry.errorCode = failure.classification.code;
      failedEntry.incidentId = failure.incident.incidentId;
      failedEntry.retryable = failure.classification.retryable;
      failedEntry.compensation = failure.publicError.compensation;
      failedEntry.ledger = releasedReservation
        ? {
            reservationId: activeReservation?.id || releasedReservation.reservation?.id || null,
            resolution: "release",
            transactionId: releasedReservation.transaction?.id || null,
            wallet: releasedReservation.wallet
          }
        : null;
      saveHistory(failedEntry);
      const statusCode = error.statusCode || incidentHttpStatus(failure.classification);
      response.status(statusCode).json(sltErrorResponsePayload(failure, {
        checks: runtimeChecks,
        historyItem: failedEntry,
        warning: readableError,
        providerRoute: (error.route || runtimeChecks.providerRoute || []).map((item) => ({ provider: item.provider, status: item.status, code: item.code, ok: item.ok })),
        emptyState: emptyStateFor(kind),
        errorFallback: errorFallbackFor(kind)
      }));
    }
  };
}

function exportFormatsFor(kind) {
  const formats = {
    image: ["PNG", "JPG", "ZIP", "JSON project"],
    video: ["MP4", "ProRes", "ZIP", "JSON project"],
    music: ["WAV", "MP3", "ZIP", "JSON project"],
    sound: ["WAV", "MP3", "ZIP", "JSON project"],
    assist: ["PDF", "JSON project"]
  };
  return formats[kind] || ["ZIP", "JSON project"];
}

function emptyStateFor(kind) {
  const states = {
    image: "Start with a prompt, upload a reference, or choose a visual mode.",
    video: "Create a cinematic shot from text, image, reference video or storyboard.",
    music: "Describe the genre, instruments, emotion and structure.",
    sound: "Describe the sound, environment and intensity.",
    assist: "Ask me to help you create, plan, improve or control your project."
  };
  return states[kind] || "No results yet. Generate something to see it here.";
}

function successFor(kind) {
  const states = {
    image: "Image generated successfully.",
    video: "Video generation started. You can track progress in the render queue.",
    music: "Music generation started. You can track progress in the render queue.",
    sound: "Sound generated successfully.",
    assist: "Assistant response ready."
  };
  return states[kind] || "Request completed successfully.";
}

function errorFallbackFor(kind) {
  const states = {
    image: "We couldn’t generate this image. Try adjusting the prompt or switching provider.",
    video: "This provider could not process the request.",
    music: "This provider could not process the request.",
    sound: "This provider could not process the request.",
    assist: "The assistant could not respond. Try again."
  };
  return states[kind] || "Something went wrong. Try again.";
}

app.get("/health", (_request, response) => {
  const providers = providerList();
  const authProvider = String(process.env.AUTH_PROVIDER || "local").toLowerCase();
  response.json({
    ok: true,
    service: "slt-api-proxy-example",
    mode: "functional-provider-proxy",
    port,
    envFiles: loadedEnvFiles,
    infrastructure: startupInfrastructureReadiness,
    auth: {
      provider: authProvider,
      supabaseConfigured: authProvider === "supabase" && Boolean(supabaseAuth && supabaseAdmin),
      signupEnabled: authProvider === "supabase" && Boolean(supabaseAdmin)
    },
    dataStore: runtimeStoreStatus(),
    storage: {
      kind: supabaseStorage.configured ? supabaseStorage.kind : "local",
      durable: supabaseStorage.configured ? supabaseStorage.durable : Boolean(process.env.SLT_STORAGE_DIR),
      configured: supabaseStorage.configured || Boolean(process.env.SLT_STORAGE_DIR),
      bucket: supabaseStorage.bucket || "local-assets"
    },
    providersConnected: providers.filter((provider) => provider.connected).length,
    providersTotal: providers.length
  });
});

app.get("/api/db/status", (request, response) => {
  response.json({
    ok: true,
    auth: getAuth(request),
    dataStore: runtimeStoreStatus(),
    durable: runtimeStore.durable,
    productionReady: startupInfrastructureReadiness.ok
  });
});

app.get("/api/providers", (request, response) => {
  const kind = typeof request.query.kind === "string" ? request.query.kind : "";
  const providers = providerList(kind);
  response.json({
    ok: true,
    auth: getAuth(request),
    providers,
    message: providers.some((provider) => provider.connected) ? "At least one provider is connected." : providerFallbackMessage
  });
});

app.get("/api/error-registry", (_request, response) => {
  response.json({
    ok: true,
    ...registrySummary(),
    errors: Object.values(SLT_ERROR_REGISTRY).map(({ code, name, category, customerMessage, retryable }) => ({
      code,
      name,
      category,
      customerMessage,
      retryable
    }))
  });
});

app.get("/api/model-router/capabilities", (request, response) => {
  const supportedModalities = ["image", "video", "music", "sound", "voice"];
  const modality = supportedModalities.includes(String(request.query.modality || request.query.kind || "").toLowerCase())
    ? String(request.query.modality || request.query.kind).toLowerCase()
    : "";
  const models = multimodalModelRegistry
    .filter((model) => !modality || model.modality === modality)
    .map(modelAvailability);
  const operations = modality
    ? operationCatalog(modality)
    : supportedModalities.flatMap(operationCatalog);
  response.json({
    ok: true,
    auth: getAuth(request),
    modality: modality || "all",
    priorities: ["quality", "speed", "cost"],
    operations,
    models,
    rules: {
      incompatibleParametersHidden: true,
      unsupportedOperations: "coming_soon",
      upscale: "post_process"
    }
  });
});

app.get("/api/provider-status", (request, response) => {
  const auth = getAuth(request);
  const kind = String(request.query.kind || "").trim().toLowerCase();
  const providers = Object.keys(providerCatalog)
    .map((name) => providerStatus(name))
    .filter((item) => !kind || item.kind === kind)
    .map((item) => ({
      name: item.name,
      kind: item.kind,
      status: item.connected ? "AVAILABLE" : item.status,
      available: item.connected,
      canGenerate: item.canGenerate,
      execution: item.execution,
      supportsWebhook: item.supportsWebhook,
      message: item.message,
      errorCode: item.errorCode || null,
      errorName: item.errorName || null,
      model: item.model ? { id: item.model.id, label: item.model.label, pricing: item.model.pricing || null } : null,
      pricing: item.pricing || null
    }));
  response.json({
    ok: true,
    auth,
    checkedAt: new Date().toISOString(),
    providers,
    summary: {
      available: providers.filter((item) => item.available).length,
      temporarilyUnavailable: providers.filter((item) => ["PROVIDER_NO_CREDITS", "PROVIDER_BILLING_REQUIRED"].includes(item.status)).length,
      comingSoon: providers.filter((item) => ["prepared", "future", "missing_key", "missing_config"].includes(item.status)).length
    }
  });
});

app.post("/api/model-router/resolve", (request, response) => {
  try {
    const route = routeMultimodalModel(request.body || {});
    response.status(route.ok ? 200 : route.comingSoon ? 422 : 409).json({ ok: route.ok, route, message: route.message });
  } catch (error) {
    response.status(error.statusCode || 400).json({ ok: false, code: error.code || "model_route_failed", error: error.message });
  }
});

function webhookSecretFor(provider) {
  if (provider === "fal") return firstEnvValue(["FAL_WEBHOOK_SECRET", "FAL_AI_WEBHOOK_SECRET", "WEBHOOK_SECRET"]);
  if (provider === "replicate") return firstEnvValue(["REPLICATE_WEBHOOK_SECRET", "WEBHOOK_SECRET"]);
  return firstEnvValue(["WEBHOOK_SECRET"]);
}

function webhookTimestampMs(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) {
    const numeric = Number(raw);
    return numeric > 10_000_000_000 ? numeric : numeric * 1000;
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function timingSafeStringEqual(left = "", right = "") {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeSignatureParts(signature = "") {
  return String(signature || "")
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.replace(/^v\d+=/i, "").replace(/^sha256=/i, ""));
}

function verifyProviderWebhookSignature(request, provider) {
  const secret = webhookSecretFor(provider);
  if (!secret) {
    const error = new Error(`${provider} webhook secret is missing.`);
    error.statusCode = 503;
    error.code = "webhook_secret_missing";
    throw error;
  }

  const timestamp =
    request.header("webhook-timestamp") ||
    request.header("x-webhook-timestamp") ||
    request.header("x-fal-webhook-timestamp") ||
    request.header("svix-timestamp") ||
    request.header("x-replicate-timestamp") ||
    "";
  const signature =
    request.header("webhook-signature") ||
    request.header("x-webhook-signature") ||
    request.header("x-fal-webhook-signature") ||
    request.header("svix-signature") ||
    request.header("x-replicate-signature") ||
    "";
  const webhookId =
    request.header("webhook-id") ||
    request.header("x-webhook-id") ||
    request.header("svix-id") ||
    request.header("x-replicate-webhook-id") ||
    "";
  const timestampMs = webhookTimestampMs(timestamp);
  const toleranceMs = envNumber("WEBHOOK_REPLAY_TOLERANCE_SECONDS", 300) * 1000;
  if (!timestampMs || Math.abs(Date.now() - timestampMs) > toleranceMs) {
    const error = new Error("Webhook timestamp is missing or outside the replay tolerance.");
    error.statusCode = 401;
    error.code = "webhook_replay_rejected";
    throw error;
  }
  const signatures = normalizeSignatureParts(signature);
  if (!signatures.length) {
    const error = new Error("Webhook signature is missing.");
    error.statusCode = 401;
    error.code = "webhook_signature_missing";
    throw error;
  }

  const rawBody = Buffer.isBuffer(request.rawBody)
    ? request.rawBody
    : Buffer.from(JSON.stringify(request.body || {}));
  const rawPayload = rawBody.toString("utf8");
  const signedPayloads = [
    `${timestamp}.${rawPayload}`,
    webhookId ? `${webhookId}.${timestamp}.${rawPayload}` : "",
    rawPayload
  ].filter(Boolean);
  const expected = signedPayloads.flatMap((payload) => {
    const hmac = crypto.createHmac("sha256", secret).update(payload).digest();
    return [
      hmac.toString("hex"),
      hmac.toString("base64"),
      hmac.toString("base64url")
    ];
  });
  const ok = signatures.some((received) => expected.some((candidate) => timingSafeStringEqual(received, candidate)));
  if (!ok) {
    const error = new Error("Webhook signature verification failed.");
    error.statusCode = 401;
    error.code = "webhook_signature_invalid";
    throw error;
  }
  return true;
}

function normalizeWebhookStatus(value = "") {
  const status = String(value || "").toLowerCase();
  if (["succeeded", "success", "completed", "complete", "done"].includes(status)) return "completed";
  if (["failed", "error", "errored", "cancelled", "canceled"].includes(status)) return "failed";
  if (status === "throttled") return "throttled";
  if (["queued", "pending", "starting"].includes(status)) return "queued";
  return "processing";
}

function normalizeProviderWebhookPayload(provider, body = {}) {
  const data = body.data || body.prediction || body;
  const embedded = parseEmbeddedJson(body.resp_data || data.resp_data || body.data?.resp_data || body.result?.resp_data) || {};
  const payloadData = provider === "seedance" || provider === "omnihuman"
    ? { ...data, ...embedded, data: data.data || embedded.data, result: data.result || embedded.result || embedded }
    : data;
  const requestId =
    body.request_id ||
    body.requestId ||
    body.jobId ||
    body.job_id ||
    body.task_id ||
    body.taskId ||
    body.metadata?.jobId ||
    body.metadata?.request_id ||
    payloadData.request_id ||
    payloadData.requestId ||
    payloadData.jobId ||
    payloadData.job_id ||
    payloadData.task_id ||
    payloadData.taskId ||
    payloadData.data?.task_id ||
    payloadData.data?.taskId ||
    payloadData.result?.task_id ||
    payloadData.id ||
    body.id ||
    "";
  const providerJobId = payloadData.task_id || payloadData.taskId || payloadData.data?.task_id || payloadData.data?.taskId || payloadData.id || body.id || payloadData.prediction_id || body.prediction_id || requestId;
  const status = provider === "seedance" || provider === "omnihuman"
    ? normalizeSeedanceStatus({ ...body, data: payloadData, result: payloadData.result })
    : normalizeWebhookStatus(body.status || payloadData.status || body.event || body.type);
  const providerUrls = provider === "seedance" || provider === "omnihuman"
    ? extractSeedanceOutputUrls({ ...body, data: payloadData, result: payloadData.result })
    : [];
  const outputUrls = [...new Set([
    ...providerUrls,
    ...collectUrlCandidates([payloadData.output, payloadData.outputs, payloadData.urls, payloadData.result, payloadData.url, body.output, body.result]).filter(Boolean)
  ])];
  const errorMessage = payloadData.error?.message || payloadData.error || body.error?.message || body.error || payloadData.message || body.message || "";
  return {
    provider,
    eventId: body.event_id || body.eventId || body.id || providerJobId || requestId,
    requestId,
    providerJobId,
    status,
    outputUrls,
    outputUrl: outputUrls[0] || null,
    errorMessage: typeof errorMessage === "string" ? errorMessage : JSON.stringify(errorMessage),
    raw: body
  };
}

function handleProviderWebhook(provider) {
  return async (request, response) => {
    try {
      verifyProviderWebhookSignature(request, provider);
      const event = normalizeProviderWebhookPayload(provider, request.body || {});
      const queryJobId = typeof request.query.jobId === "string" ? request.query.jobId : "";
      const job = findJob(queryJobId) || findJob(event.requestId) || findJob(event.providerJobId);
      const eventKey = `${provider}:${event.eventId || queryJobId || event.requestId}:${event.status}`;
      if (processedWebhookEvents.has(eventKey)) {
        response.json({ ok: true, duplicate: true, ignored: true });
        return;
      }
      state.webhookEvents.unshift({
        id: requestId("webhook_event"),
        eventKey,
        eventId: event.eventId || eventKey,
        provider,
        jobId: job?.id || queryJobId || null,
        event,
        payload: event.raw,
        status: event.status,
        receivedAt: new Date().toISOString()
      });
      state.webhookEvents = state.webhookEvents.slice(0, 200);
      if (!job) {
        processedWebhookEvents.add(eventKey);
        state.webhookEvents[0].status = "orphan";
        response.status(202).json({ ok: true, accepted: true, orphan: true });
        return;
      }
      if ([jobStates.completed, jobStates.failed].includes(job.status)) {
        processedWebhookEvents.add(eventKey);
        response.json({ ok: true, duplicate: true, terminal: true, job: serializeJob(job) });
        return;
      }

      processedWebhookEvents.add(eventKey);
      appendJobEvent(job, { type: "webhook", provider, status: event.status, providerJobId: event.providerJobId });

      if (event.status === "failed") {
        const error = new Error(event.errorMessage || `${provider} webhook reported failure.`);
        error.code = "provider_webhook_failed";
        const failed = await failAsyncJob({ job, error });
        response.json({ ok: true, job: serializeJob(failed.job), historyItem: failed.historyItem });
        return;
      }

      if (event.status === "completed") {
        updateJob(job.id, {
          status: jobStates.processing,
          providerJobId: event.providerJobId || job.providerJobId
        });
        const cdnBaseUrl = storagePublicBaseUrl(request);
        setTimeout(() => {
          completeAsyncJob({
            job: findJob(job.id),
            providerResult: {
              providerJobId: event.providerJobId,
              status: "completed",
              previewUrl: event.outputUrl,
              outputUrl: event.outputUrl,
              outputUrls: event.outputUrls,
              cdnBaseUrl,
              note: `${provider} webhook completed.`,
              raw: event.raw
            },
            message: `${job.kind} generation completed from ${provider} webhook.`
          }).catch((error) => {
            void failAsyncJob({ job: findJob(job.id), error });
          });
        }, 0);
        response.status(202).json({ ok: true, accepted: true, job: serializeJob(findJob(job.id)), message: "Webhook accepted for async asset persistence." });
        return;
      }

      updateJob(job.id, {
        status: event.status === "throttled"
          ? jobStates.throttled
          : event.status === "queued"
          ? jobStates.pending
          : jobStates.processing,
        providerJobId: event.providerJobId || job.providerJobId
      });
      response.json({ ok: true, job: serializeJob(findJob(job.id)) });
    } catch (error) {
      response.status(error.statusCode || 400).json({
        ok: false,
        code: error.code || "webhook_rejected",
        error: error.message || "Webhook rejected."
      });
    }
  };
}

app.post("/api/generate/estimate", (request, response) => {
  const kind = String(request.body?.kind || "video").toLowerCase();
  if (!["image", "video", "music", "sound", "fashion"].includes(kind)) {
    response.status(400).json({ ok: false, code: "invalid_generation_kind", error: "Unsupported generation kind." });
    return;
  }
  const payload = {
    ...(request.body?.payload || {}),
    ...request.body,
    provider: request.body?.provider || request.body?.providerLabel || defaultProvider[kind]
  };
  const providerName = normalizeProviderName(String(payload.provider || defaultProvider[kind]));
  const config = providerCatalog[providerName] || null;
  const model = providerModelConfig(config || {}, payload);
  response.json({
    ok: true,
    kind,
    provider: providerName,
    model: model?.id || payload.model || null,
    outputCount: billableOutputCount(payload),
    estimatedCredits: creditCostFor(kind, payload),
    pricing: providerPricingFor(config || {}, payload),
    note: "Estimate only. Credits are reserved server-side when the job is submitted."
  });
});

app.post("/api/generate/image", handleGenerate("image"));
app.post("/api/generate/video", handleGenerate("video"));
app.post("/api/generate/music", handleGenerate("music"));
app.post("/api/generate/sound", handleGenerate("sound"));

app.post("/api/webhooks/fal", handleProviderWebhook("fal"));
app.post("/api/webhooks/replicate", handleProviderWebhook("replicate"));
app.post("/api/webhooks/seedance", handleProviderWebhook("seedance"));
app.post("/api/webhooks/omnihuman", handleProviderWebhook("omnihuman"));

app.get("/api/jobs", (request, response) => {
  const auth = getAuth(request);
  const kind = typeof request.query.kind === "string" ? request.query.kind.trim().toLowerCase() : "";
  const requestedLimit = Number.parseInt(request.query.limit, 10);
  const limit = Number.isFinite(requestedLimit) ? Math.min(100, Math.max(1, requestedLimit)) : 50;
  const ownedJobs = filterRecordsForAuth(state.jobs, auth)
    .filter((job) => !kind || String(job.kind || "").toLowerCase() === kind);
  const jobs = ownedJobs.slice(0, limit).map(serializeJob);
  const summary = ownedJobs.reduce((counts, job) => {
    const status = clientJobStatus(job.status);
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});

  response.json({
    ok: true,
    auth,
    jobs,
    summary,
    total: ownedJobs.length,
    emptyState: "No Jobs"
  });
});

app.get("/api/batches", (request, response) => {
  const auth = getAuth(request);
  const kind = typeof request.query.kind === "string" ? request.query.kind.trim().toLowerCase() : "";
  const batches = filterRecordsForAuth(state.generationBatches, auth)
    .filter((batch) => !kind || String(batch.kind || "").toLowerCase() === kind)
    .slice(0, 50)
    .map((batch) => serializeGenerationBatch(recomputeGenerationBatch(batch.id)));
  response.json({ ok: true, auth, batches, total: batches.length });
});

app.get("/api/generation-sessions", (request, response) => {
  const auth = getAuth(request);
  const kind = typeof request.query.kind === "string" ? request.query.kind.trim().toLowerCase() : "";
  const sessions = filterRecordsForAuth(state.generationSessions, auth)
    .filter((session) => !kind || String(session.kind || "").toLowerCase() === kind)
    .slice(0, 100)
    .map((session) => {
      const jobs = filterRecordsForAuth(state.jobs, auth).filter((job) => job.sessionId === session.id);
      const assets = filterRecordsForAuth(state.assets, auth).filter((asset) => asset.sessionId === session.id);
      return {
        ...session,
        jobCount: jobs.length,
        assetCount: assets.length,
        latestAsset: assets[0] ? serializeAssetForClient(assets[0]) : null
      };
    });
  response.json({ ok: true, auth, sessions, total: sessions.length });
});

app.post("/api/generation-sessions", (request, response) => {
  const auth = getAuth(request);
  const tenantId = requestIdentity(request, auth);
  const projectId = request.body?.projectId || null;
  if (projectId) {
    const project = state.projects.find((item) => item.id === projectId);
    if (!project || !canAccessRecord(project, auth)) {
      response.status(404).json({ ok: false, code: "project_not_found", error: "Project not found." });
      return;
    }
  }
  const now = new Date().toISOString();
  const session = {
    id: requestId("generation_session"),
    tenantId,
    userId: auth.userId || null,
    projectId,
    title: String(request.body?.title || "Untitled session").slice(0, 180),
    kind: String(request.body?.kind || "multimodal").slice(0, 80),
    status: "ACTIVE",
    metadata: request.body?.metadata && typeof request.body.metadata === "object" ? request.body.metadata : {},
    createdAt: now,
    updatedAt: now
  };
  state.generationSessions.unshift(session);
  response.status(201).json({ ok: true, auth, session });
});

app.get("/api/generation-sessions/:sessionId", (request, response) => {
  const auth = getAuth(request);
  const session = state.generationSessions.find((item) => item.id === request.params.sessionId);
  if (!session || !canAccessRecord(session, auth)) {
    response.status(404).json({ ok: false, code: "session_not_found", error: "Session not found." });
    return;
  }
  const jobs = filterRecordsForAuth(state.jobs, auth).filter((item) => item.sessionId === session.id);
  const assets = filterRecordsForAuth(state.assets, auth).filter((item) => item.sessionId === session.id && !item.deletedAt).map(serializeAssetForClient);
  const history = filterRecordsForAuth(state.history, auth).filter((item) => item.sessionId === session.id || jobs.some((job) => job.id === item.jobId));
  response.json({ ok: true, auth, session, jobs, assets, history });
});

app.patch("/api/generation-sessions/:sessionId", (request, response) => {
  const auth = getAuth(request);
  const session = state.generationSessions.find((item) => item.id === request.params.sessionId);
  if (!session || !canAccessRecord(session, auth)) {
    response.status(404).json({ ok: false, code: "session_not_found", error: "Session not found." });
    return;
  }
  if (typeof request.body?.title === "string" && request.body.title.trim()) session.title = request.body.title.trim().slice(0, 180);
  if (["ACTIVE", "ARCHIVED"].includes(String(request.body?.status || "").toUpperCase())) session.status = String(request.body.status).toUpperCase();
  if (request.body?.projectId !== undefined) session.projectId = request.body.projectId || null;
  session.updatedAt = new Date().toISOString();
  response.json({ ok: true, auth, session });
});

app.get("/api/batches/:batchId", (request, response) => {
  const auth = getAuth(request);
  const batch = findGenerationBatch(request.params.batchId);
  if (!batch) {
    response.status(404).json({ ok: false, code: "batch_not_found", error: "Generation batch not found." });
    return;
  }
  try {
    assertTenantAccess(batch, auth);
  } catch (error) {
    response.status(error.statusCode || 403).json({ ok: false, code: error.code || "forbidden", error: "Forbidden." });
    return;
  }
  response.json({ ok: true, auth, batch: serializeGenerationBatch(recomputeGenerationBatch(batch.id)) });
});

function buildRetryGenerationPayload(originalJob, requestBody = {}) {
  const retryKey = `retry:${originalJob.id}:${Date.now()}:${crypto.randomBytes(3).toString("hex")}`;
  return {
    retryKey,
    payload: {
      ...(originalJob.parameters || {}),
      ...(requestBody.overrides || {}),
      title: requestBody.title || originalJob.title || `${originalJob.kind} retry`,
      prompt: requestBody.prompt || originalJob.prompt || "",
      provider: requestBody.provider || originalJob.provider,
      providerLabel: requestBody.provider || originalJob.provider,
      model: requestBody.model || originalJob.parameters?.model || originalJob.payload?.model || undefined,
      outputCount: 1,
      count: 1,
      quantity: 1,
      projectId: originalJob.projectId || undefined,
      sessionId: originalJob.sessionId || undefined,
      retryOfJobId: originalJob.id,
      idempotencyKey: retryKey,
      clientRequestId: retryKey
    }
  };
}

app.post("/api/jobs/:jobId/retry", async (request, response) => {
  const auth = getAuth(request);
  const originalJob = findJob(request.params.jobId);
  if (!originalJob) {
    response.status(404).json({ ok: false, code: "job_not_found", error: "Generation job not found." });
    return;
  }
  try {
    assertTenantAccess(originalJob, auth);
  } catch (error) {
    response.status(error.statusCode || 403).json(authFailurePayload("forbidden"));
    return;
  }
  if (![jobStates.failed, jobStates.cancelled].includes(originalJob.status)) {
    response.status(409).json({ ok: false, code: "job_not_retryable_state", error: "Only failed or cancelled jobs can be retried." });
    return;
  }
  const incident = incidentForId(originalJob.incidentId || originalJob.error?.incidentId || "");
  const definition = incident
    ? SLT_ERROR_REGISTRY[incident.errorCode]
    : SLT_ERROR_REGISTRY[originalJob.error?.errorCode] || classifySltError(originalJob.error || {}, { provider: originalJob.provider, jobId: originalJob.id });
  if (!definition?.retryable) {
    response.status(409).json({
      ok: false,
      code: "job_error_not_retryable",
      errorCode: definition?.code || originalJob.error?.errorCode || null,
      error: "This generation error is not retryable. Adjust the request before generating again."
    });
    return;
  }

  const retry = buildRetryGenerationPayload(originalJob, request.body || {});
  const retryKey = retry.retryKey;
  request.body = retry.payload;
  request.headers = request.headers || {};
  request.headers["idempotency-key"] = retryKey;
  if (incident) {
    incident.metadata = {
      ...(incident.metadata || {}),
      retryRequestedAt: new Date().toISOString()
    };
    incident.updatedAt = new Date().toISOString();
  }
  await handleGenerate(originalJob.kind)(request, response);
});

app.get("/api/jobs/:jobId", async (request, response) => {
  const auth = getAuth(request);
  const localJob = findJob(request.params.jobId);
  if (localJob) {
    try {
      assertTenantAccess(localJob, auth);
    } catch (error) {
      response.status(error.statusCode || 403).json({ ok: false, code: error.code || "forbidden", error: "Forbidden." });
      return;
    }
    let refreshed;
    try {
      refreshed = await refreshLocalJobFromProvider(localJob);
    } catch (error) {
      response.status(502).json({
        ok: false,
        job: serializeJob(localJob),
        error: readableProviderError(error, localJob.provider),
        readableError: readableProviderError(error, localJob.provider)
      });
      return;
    }
    const currentJob = refreshed.job || findJob(localJob.id);
    const historyItem = refreshed.historyItem && canAccessRecord(refreshed.historyItem, auth)
      ? refreshed.historyItem
      : state.history.find((item) => item.id === currentJob?.historyItemId && canAccessRecord(item, auth)) || null;
    const project = refreshed.project && canAccessRecord(refreshed.project, auth)
      ? refreshed.project
      : currentJob?.projectId
      ? state.projects.find((item) => item.id === currentJob.projectId && canAccessRecord(item, auth)) || null
      : null;
    response.json({
      ok: true,
      job: serializeJob(currentJob),
      historyItem,
      project,
      message: currentJob?.status === jobStates.completed
        ? `${currentJob.kind} generation completed.`
        : currentJob?.status === jobStates.failed
        ? currentJob.error?.message || `${currentJob.kind} generation failed.`
        : `${currentJob?.kind || "Job"} generation is still processing.`
    });
    return;
  }

  if (isInternalStudioJobId(request.params.jobId)) {
    response.status(404).json({
      ok: false,
      code: "job_not_found",
      error: "Studio job not found.",
      readableError: "Job not found. The server may have restarted — generate again, or stay on the same API process while polling."
    });
    return;
  }

  const providerName = normalizeProviderName(String(request.query.provider || "Seedance"));
  if (!isOwnerAuth(auth)) {
    response.status(403).json({
      ok: false,
      code: "forbidden_external_job_lookup",
      error: "Direct provider job lookup requires CEO mode.",
      readableError: "This job is not registered under your session."
    });
    return;
  }
  if (!["Seedance", "OmniHuman"].includes(providerName)) {
    response.status(400).json({
      ok: false,
      error: "Unsupported job provider.",
      readableError: "Only direct async providers can be polled here right now."
    });
    return;
  }

  const status = providerStatus(providerName);
  if (!status.connected) {
    response.status(400).json({
      ok: false,
      provider: status,
      error: status.message || providerFallbackMessage,
      readableError: status.message || providerFallbackMessage
    });
    return;
  }

  try {
    if (providerName === "OmniHuman") {
      const { data, outputUrls, jobStatus } = await getOmniHumanJob(request.params.jobId);
      const normalized = {
        success: jobStatus !== "failed",
        providerId: "omnihuman",
        provider: "OmniHuman",
        mediaType: "video",
        status: jobStatus,
        jobId: request.params.jobId,
        outputUrl: outputUrls[0] || null,
        outputUrls,
        thumbnailUrl: null,
        raw: data
      };

      let historyItem = null;
      let project = null;
      if (jobStatus === "completed" && outputUrls.length) {
        historyItem = state.history.find((item) => item.result?.providerJobId === request.params.jobId) || null;
        if (!historyItem) {
          historyItem = {
            id: requestId("video"),
            kind: "video",
            title: "OmniHuman video result",
            provider: "OmniHuman",
            prompt: "",
            status: "completed",
            message: "OmniHuman video completed.",
            creditsUsed: 0,
            result: {
              ...normalized,
              providerJobId: request.params.jobId,
              previewUrl: outputUrls[0],
              exportFormats: exportFormatsFor("video")
            },
            createdAt: new Date().toISOString()
          };
          saveHistory(historyItem);
          project = saveProjectFromEntry(historyItem);
        }
      }

      response.json({
        ok: true,
        provider: status,
        job: normalized,
        historyItem,
        project,
        message: jobStatus === "completed" ? "OmniHuman video completed." : "OmniHuman video is still processing."
      });
      return;
    }

    const apiKey = providerApiKey(providerCatalog.Seedance);
    const data = await getJson(`${seedanceBaseUrl()}/contents/generations/tasks/${encodeURIComponent(request.params.jobId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeoutMs: 60000
    });
    const outputUrls = extractSeedanceOutputUrls(data);
    const jobStatus = normalizeSeedanceStatus(data);
    const normalized = {
      success: jobStatus !== "failed",
      providerId: "seedance",
      provider: "Seedance",
      mediaType: "video",
      status: jobStatus,
      jobId: request.params.jobId,
      outputUrl: outputUrls[0] || null,
      outputUrls,
      thumbnailUrl: null,
      raw: data
    };

    let historyItem = null;
    let project = null;
    if (jobStatus === "completed" && outputUrls.length) {
      historyItem = state.history.find((item) => item.result?.providerJobId === request.params.jobId) || null;
      if (!historyItem) {
        historyItem = {
          id: requestId("video"),
          kind: "video",
          title: "Seedance video result",
          provider: "Seedance",
          prompt: "",
          status: "completed",
          message: "Seedance video completed.",
          creditsUsed: 0,
          result: {
            ...normalized,
            providerJobId: request.params.jobId,
            previewUrl: outputUrls[0],
            exportFormats: exportFormatsFor("video")
          },
          createdAt: new Date().toISOString()
        };
        saveHistory(historyItem);
        project = saveProjectFromEntry(historyItem);
      }
    }

    response.json({ ok: true, provider: status, job: normalized, historyItem, project });
  } catch (error) {
    response.status(502).json({
      ok: false,
      provider: status,
      error: readableProviderError(error, "Seedance"),
      readableError: readableProviderError(error, "Seedance")
    });
  }
});

app.post("/api/login", async (request, response) => {
  const email = String(request.body?.email || "").trim();
  const username = String(request.body?.username || "").trim();
  const password = String(request.body?.password || "");
  const inviteCode = String(request.body?.inviteCode || request.body?.code || "").trim();
  const configuredCeoEmail = process.env.CEO_EMAIL || "";
  const configuredCeoUsername = process.env.CEO_USERNAME || "";
  const attemptingCeo =
    (configuredCeoEmail && email.toLowerCase() === configuredCeoEmail.toLowerCase()) ||
    (configuredCeoUsername && username.toLowerCase() === configuredCeoUsername.toLowerCase()) ||
    email.toLowerCase() === "ceo@studiosweetlittletrauma.com" ||
    username.toLowerCase() === "ceo";

  if (attemptingCeo) {
    if (!hasEnvValue("ADMIN_UNFILTERED_KEY")) {
      const failed = buildFailedEntry({
        kind: "auth",
        title: "CEO login",
        providerName: "local session",
        prompt: "CEO login",
        message: "CEO mode not configured.",
        code: "ceo_mode_not_configured"
      });
      saveHistory(failed);
      response.status(503).json({ ok: false, error: "CEO mode not configured.", readableError: "CEO mode not configured.", historyItem: failed });
      return;
    }
    if (password !== process.env.ADMIN_UNFILTERED_KEY) {
      response.status(401).json({ ok: false, error: "Invalid CEO credentials.", readableError: "Invalid CEO credentials." });
      return;
    }
    const token = requestId("ceo_session");
    const session = {
      token,
      userId: "ceo-user",
      role: "CEO",
      email: email || configuredCeoEmail || "ceo@studiosweetlittletrauma.com",
      username: username || configuredCeoUsername || "CEO",
      mode: "CEO_FULL_CREATIVE_MODE",
      createdAt: new Date().toISOString()
    };
    sessions.set(token, session);
    state.user = { ...state.user, id: session.userId, email: session.email, username: session.username, role: session.role };
    response.json({
      ok: true,
      session: { token, id: session.userId, email: session.email, username: session.username, role: session.role, mode: session.mode },
      user: state.user,
      message: "CEO session started."
    });
    return;
  }

  if (inviteCode) {
    const inviteProfile = inviteGuestProfile(inviteCode);
    if (!inviteProfile) {
      response.status(401).json({ ok: false, code: "invalid_invite_code", error: "Invalid guest code.", readableError: "Código de invitado inválido." });
      return;
    }
    const guestSlug = safeGuestSlug(inviteProfile.username);
    const token = requestId("guest_session");
    const session = {
      token,
      userId: `guest-${guestSlug}`,
      tenantId: `guest-${guestSlug}`,
      role: "GUEST",
      email: `${guestSlug}@guest.slt.local`,
      username: inviteProfile.username,
      mode: "INVITED_GUEST",
      createdAt: new Date().toISOString()
    };
    sessions.set(token, session);
    const user = {
      id: session.userId,
      tenantId: session.tenantId,
      email: session.email,
      username: session.username,
      role: session.role,
      mode: session.mode
    };
    response.json({
      ok: true,
      session: { token, id: session.userId, tenantId: session.tenantId, email: session.email, username: session.username, role: session.role, mode: session.mode },
      user,
      message: "Guest session started."
    });
    return;
  }

  if (String(process.env.AUTH_PROVIDER || "").toLowerCase() === "supabase") {
    if (!supabaseAuth) {
      response.status(503).json({
        ok: false,
        code: "supabase_auth_not_configured",
        error: "Supabase Auth is not configured.",
        readableError: "Supabase Auth is not configured."
      });
      return;
    }
    const { data, error } = await supabaseAuth.auth.signInWithPassword({ email, password });
    if (error || !data.session?.access_token || !data.user?.id) {
      response.status(401).json({
        ok: false,
        code: "invalid_supabase_credentials",
        error: error?.message || "Invalid credentials.",
        readableError: "Invalid email or password."
      });
      return;
    }
    const role = data.user.app_metadata?.role || data.user.user_metadata?.role || "authenticated";
    const tenantId = data.user.app_metadata?.tenant_id || data.user.user_metadata?.tenant_id || data.user.id;
    state.user = {
      ...state.user,
      id: data.user.id,
      email: data.user.email || email,
      username: data.user.user_metadata?.username || data.user.user_metadata?.full_name || data.user.email || email,
      role
    };
    const wallet = walletForTenant(tenantId, {
      create: true,
      initialCredits: envNumber("NEW_TENANT_STARTING_CREDITS", 0)
    });
    response.json({
      ok: true,
      session: {
        token: data.session.access_token,
        refreshToken: data.session.refresh_token,
        id: data.user.id,
        tenantId,
        email: data.user.email,
        username: state.user.username,
        role,
        mode: "supabase"
      },
      user: state.user,
      wallet: ledgerSnapshot(wallet.tenantId),
      message: "Supabase session started."
    });
    return;
  }

  const token = requestId("session");
  const session = {
    token,
    userId: "demo-user",
    role: "standard",
    email: email || state.user.email,
    username: username || request.body?.full_name || state.user.username,
    mode: "standard",
    createdAt: new Date().toISOString()
  };
  sessions.set(token, session);
  state.user = { ...state.user, email: session.email, username: session.username, role: session.role };
  response.json({
    ok: true,
    session: { token, id: session.userId, email: session.email, username: session.username, role: session.role, mode: session.mode },
    user: state.user,
    message: "Session started."
  });
});

app.post("/api/auth/signup", async (request, response) => {
  if (String(process.env.AUTH_PROVIDER || "").toLowerCase() !== "supabase" || !supabaseAdmin) {
    response.status(503).json({ ok: false, code: "supabase_auth_not_configured", error: "Supabase Auth is not configured." });
    return;
  }
  const email = String(request.body?.email || "").trim();
  const password = String(request.body?.password || "");
  const username = String(request.body?.username || request.body?.full_name || "").trim();
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: false,
    user_metadata: { username, full_name: username },
    app_metadata: { tenant_id: requestId("tenant"), role: "authenticated" }
  });
  if (error) {
    response.status(400).json({ ok: false, code: "supabase_signup_failed", error: error.message, readableError: error.message });
    return;
  }
  response.status(201).json({ ok: true, user: { id: data.user?.id, email: data.user?.email }, message: "Supabase user created." });
});

app.post("/api/auth/password-recovery", async (request, response) => {
  if (String(process.env.AUTH_PROVIDER || "").toLowerCase() !== "supabase" || !supabaseAdmin) {
    response.status(503).json({ ok: false, code: "supabase_auth_not_configured", error: "Supabase Auth is not configured." });
    return;
  }
  const email = String(request.body?.email || "").trim();
  const redirectTo = process.env.PUBLIC_APP_URL ? `${process.env.PUBLIC_APP_URL.replace(/\/$/, "")}/profile` : undefined;
  const { error } = await supabaseAdmin.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) {
    response.status(400).json({ ok: false, code: "supabase_password_recovery_failed", error: error.message, readableError: error.message });
    return;
  }
  response.json({ ok: true, message: "Password recovery email requested." });
});

app.post("/api/assist", async (request, response) => {
  if (failProviderIfRequested(request, response)) return;
  const checks = baseChecks(request, "assist");
  const auth = getAuth(request);
  const prompt = request.body?.prompt || "What would you like to create today?";
  const title = request.body?.title || "Virtual Assist";

  const inputModeration = await runInputModeration({ kind: "assist", title, prompt, payload: request.body || {} });
  if (!inputModeration.ok) {
    response.status(400).json(moderationFailurePayload({ moderation: inputModeration, kind: "assist", title }));
    return;
  }

  if (!checks.credits.ok) {
    const failed = buildFailedEntry({
      kind: "assist",
      title,
      providerName: checks.provider.name,
      prompt,
      message: checks.credits.readableError,
      code: "insufficient_credits"
    });
    saveHistory(failed);
    response.status(402).json({ ok: false, checks, historyItem: failed, error: checks.credits.readableError, code: "insufficient_credits" });
    return;
  }

  if (auth.role === "CEO") {
    if (!hasEnvValue("OPENROUTER_API_KEY")) {
      const failedEntry = buildFailedEntry({
        kind: "assist",
        title,
        providerName: "OpenRouter Hermes",
        prompt,
        message: "CEO mode not configured.",
        code: "ceo_mode_not_configured"
      });
      saveHistory(failedEntry);
      response.status(503).json({
        ok: false,
        auth,
        historyItem: failedEntry,
        code: "ceo_mode_not_configured",
        warning: "CEO mode not configured.",
        error: "CEO mode not configured.",
        readableError: "CEO mode not configured."
      });
      return;
    }
    let assistReservation = null;
    try {
      const reservationResult = await reserveCreditsTransactional({
        amount: checks.credits.cost,
        kind: "assist",
        auth,
        request,
        idempotencyKey: generationIdempotencyKey(request, "assist", "reserve"),
        metadata: {
          title,
          provider: "OpenRouter Hermes",
          promptHash: crypto.createHash("sha256").update(prompt).digest("hex")
        }
      });
      assistReservation = reservationResult.reservation;
      const providerResult = await callOpenRouterHermes({ prompt, title });
      const ledgerResolution = assistReservation
        ? await resolveReservationTransactional({
            reservationId: assistReservation.id,
            outcome: "capture",
            idempotencyKey: `capture:${assistReservation.id}`,
            reason: "assist_completed"
          })
        : { reservation: null, transaction: null, wallet: ledgerSnapshot(requestIdentity(request, auth)), skipped: true };
      const entry = {
        id: requestId("assist"),
        kind: "assist",
        title,
        provider: "OpenRouter Hermes",
        prompt,
        status: "completed",
        message: "CEO Hermes response ready.",
        response: providerResult.responseText || "CEO Hermes response ready.",
        creditsUsed: checks.credits.cost,
        ledger: {
          reservationId: assistReservation?.id || null,
          resolution: assistReservation ? "capture" : "none",
          transactionId: ledgerResolution.transaction?.id || null,
          wallet: ledgerResolution.wallet
        },
        result: providerResult,
        createdAt: new Date().toISOString()
      };
      saveHistory(entry);
      response.json({ ok: true, auth, historyItem: entry, success: "CEO Hermes response ready." });
    } catch (error) {
      let ledgerResolution = null;
      if (assistReservation?.id) {
        ledgerResolution = await resolveReservationTransactional({
          reservationId: assistReservation.id,
          outcome: "release",
          idempotencyKey: `release:${assistReservation.id}`,
          reason: error.code || "assist_failed"
        });
      }
      const readableError = readableProviderError(error, "OpenRouter Hermes");
      const failedEntry = buildFailedEntry({
        kind: "assist",
        title,
        providerName: "OpenRouter Hermes",
        prompt,
        message: readableError,
        code: "ceo_mode_error"
      });
      failedEntry.ledger = ledgerResolution
        ? {
            reservationId: assistReservation.id,
            resolution: "release",
            transactionId: ledgerResolution.transaction?.id || null,
            wallet: ledgerResolution.wallet
          }
        : null;
      saveHistory(failedEntry);
      response.status(502).json({
        ok: false,
        auth,
        historyItem: failedEntry,
        code: "ceo_mode_error",
        warning: readableError,
        error: readableError,
        readableError
      });
    }
    return;
  }

  let assistReservation = null;
  try {
    const reservationResult = await reserveCreditsTransactional({
      amount: checks.credits.cost,
      kind: "assist",
      auth,
      request,
      idempotencyKey: generationIdempotencyKey(request, "assist", "reserve"),
      metadata: {
        title,
        provider: checks.provider.name,
        promptHash: crypto.createHash("sha256").update(prompt).digest("hex")
      }
    });
    assistReservation = reservationResult.reservation;
    const providerRun = await runProviderGateway({
      kind: "assist",
      providerStatus: checks.provider,
      prompt,
      title,
      payload: request.body || {}
    });
    const ledgerResolution = assistReservation
      ? await resolveReservationTransactional({
          reservationId: assistReservation.id,
          outcome: "capture",
          idempotencyKey: `capture:${assistReservation.id}`,
          reason: "assist_completed"
        })
      : { reservation: null, transaction: null, wallet: ledgerSnapshot(requestIdentity(request, auth)), skipped: true };
    const entry = {
      id: requestId("assist"),
      kind: "assist",
      title,
      provider: providerRun.providerName,
      prompt,
      status: "completed",
      message: "Assistant response ready.",
      response: providerRun.providerResult.responseText || "I can help you plan, improve or control Image, Video, Sound FX, Music, Fashion and Engineering projects.",
      creditsUsed: checks.credits.cost,
      ledger: {
        reservationId: assistReservation?.id || null,
        resolution: assistReservation ? "capture" : "none",
        transactionId: ledgerResolution.transaction?.id || null,
        wallet: ledgerResolution.wallet
      },
      result: {
        ...providerRun.providerResult,
        fallback: providerRun.fallback,
        providerRoute: providerRun.route
      },
      createdAt: new Date().toISOString()
    };
    saveHistory(entry);
    response.json({
      ok: true,
      checks: {
        ...checks,
        requestedProvider: checks.provider,
        provider: providerRun.providerStatus,
        providerFallback: providerRun.fallback,
        providerRoute: providerRun.route
      },
      historyItem: entry,
      success: "Assistant response ready."
    });
  } catch (error) {
    let ledgerResolution = null;
    if (assistReservation?.id) {
      ledgerResolution = await resolveReservationTransactional({
        reservationId: assistReservation.id,
        outcome: "release",
        idempotencyKey: `release:${assistReservation.id}`,
        reason: error.code || "assist_failed"
      });
    }
    const code = error.code || "provider_error";
    const readableError = code === "provider_not_connected" ? providerFallbackMessage : readableProviderError(error, checks.provider.name);
    const failedEntry = buildFailedEntry({
      kind: "assist",
      title,
      providerName: checks.provider.name,
      prompt,
      message: readableError,
      code
    });
    failedEntry.ledger = ledgerResolution
      ? {
          reservationId: assistReservation.id,
          resolution: "release",
          transactionId: ledgerResolution.transaction?.id || null,
          wallet: ledgerResolution.wallet
        }
      : null;
    saveHistory(failedEntry);
    response.status(code === "provider_not_connected" ? 400 : 502).json({
      ok: false,
      checks,
      historyItem: failedEntry,
      code,
      warning: readableError,
      error: readableError,
      readableError,
      providerError: error.message || "",
      providerRoute: error.route || [],
      errorFallback: errorFallbackFor("assist")
    });
  }
});

function refreshCouponExpiry(coupon) {
  if (coupon?.status === "ACTIVE" && new Date(coupon.expiresAt || 0).getTime() <= Date.now()) {
    coupon.status = "EXPIRED";
  }
  return coupon;
}

function compensationCouponForClient(coupon) {
  if (!coupon) return null;
  refreshCouponExpiry(coupon);
  return {
    code: coupon.code,
    discountPercent: Number(coupon.discountPercent || 5),
    status: coupon.status,
    incidentId: coupon.incidentId,
    expiresAt: coupon.expiresAt,
    oneUse: true,
    transferable: false
  };
}

function compensationCouponForCheckout(code, tenantId, userId = null) {
  const normalized = String(code || "").trim().toUpperCase();
  if (!normalized) return null;
  const coupon = state.compensationCoupons.find((item) => String(item.code || "").toUpperCase() === normalized) || null;
  if (!coupon || coupon.tenantId !== tenantId || (coupon.userId && userId && coupon.userId !== userId)) return null;
  refreshCouponExpiry(coupon);
  return coupon.status === "ACTIVE" ? coupon : null;
}

function markCompensationCouponRedeemed(object = {}) {
  const promotionIds = (object.total_details?.breakdown?.discounts || [])
    .map((item) => item.discount?.promotion_code || item.promotion_code)
    .filter(Boolean);
  const code = String(object.metadata?.compensationCode || "").trim().toUpperCase();
  const coupon = state.compensationCoupons.find((item) => (
    (code && String(item.code || "").toUpperCase() === code)
    || (item.promotionCodeId && promotionIds.includes(item.promotionCodeId))
  )) || null;
  if (!coupon || coupon.status !== "ACTIVE") return null;
  coupon.status = "REDEEMED";
  coupon.redeemedAt = new Date().toISOString();
  coupon.metadata = { ...(coupon.metadata || {}), stripeCheckoutSessionId: object.id || null };
  return coupon;
}

function incidentForCeo(incident) {
  return {
    ...incident,
    coupon: compensationCouponForClient(couponForIncident(incident.incidentId)),
    sanitizedProviderError: sanitizeDiagnosticText(incident.sanitizedProviderError || ""),
    technicalMessage: sanitizeDiagnosticText(incident.technicalMessage || ""),
    browser: sanitizeDiagnosticText(incident.browser || "", { maxLength: 500 }),
    route: sanitizeDiagnosticText(incident.route || "", { maxLength: 300 })
  };
}

function matchesIncidentFilter(incident, query = {}) {
  const status = String(query.status || "").trim().toUpperCase();
  const category = String(query.category || "").trim().toUpperCase();
  const provider = String(query.provider || "").trim().toLowerCase();
  const modality = String(query.modality || query.type || "").trim().toUpperCase();
  const filter = String(query.filter || "").trim().toLowerCase();
  const search = String(query.search || "").trim().toLowerCase();
  if (status && status !== "ALL" && incident.status !== status) return false;
  if (category && category !== "ALL" && incident.category !== category) return false;
  if (provider && !String(incident.provider || "").toLowerCase().includes(provider)) return false;
  if (modality && modality !== "ALL" && incident.modality !== modality) return false;
  if (query.reported === "true" && !incident.reported) return false;
  if (query.reported === "false" && incident.reported) return false;
  const categoryFilters = { credits: "CREDIT", provider: "PROVIDER", storage: "STORAGE", database: "DATABASE" };
  if (categoryFilters[filter] && incident.category !== categoryFilters[filter]) return false;
  if (filter === "open" && !["OPEN", "INVESTIGATING"].includes(incident.status)) return false;
  if (filter === "resolved" && incident.status !== "RESOLVED") return false;
  if (filter === "openai" && !/openai|gpt/i.test(`${incident.provider || ""} ${incident.model || ""} ${incident.technicalMessage || ""}`)) return false;
  if (filter === "video" && incident.modality !== "VIDEO") return false;
  if (filter === "image" && incident.modality !== "IMAGE") return false;
  if (search) {
    const haystack = [incident.incidentId, incident.errorCode, incident.errorName, incident.userId, incident.tenantId, incident.projectId, incident.jobId, incident.provider, incident.model].filter(Boolean).join(" ").toLowerCase();
    if (!haystack.includes(search)) return false;
  }
  return true;
}

app.post("/api/support/incidents", async (request, response) => {
  const auth = getAuth(request);
  const incident = incidentForId(String(request.body?.incidentId || "").trim());
  if (!incident) {
    response.status(404).json({ ok: false, code: "incident_not_found", error: "Incident not found." });
    return;
  }
  try {
    assertTenantAccess(incident, auth);
  } catch (error) {
    response.status(error.statusCode || 403).json(authFailurePayload("forbidden"));
    return;
  }
  const duplicate = Boolean(incident.reported);
  if (!duplicate) {
    incident.reported = true;
    incident.reportedAt = new Date().toISOString();
    incident.browser = incident.browser || sanitizeDiagnosticText(request.header("user-agent") || "", { maxLength: 500 });
    incident.route = incident.route || sanitizeDiagnosticText(request.body?.route || request.header("referer") || "", { maxLength: 300 });
    incident.metadata = {
      ...(incident.metadata || {}),
      reportContext: {
        note: sanitizeDiagnosticText(request.body?.note || "", { maxLength: 500 }),
        clientRoute: sanitizeDiagnosticText(request.body?.route || "", { maxLength: 300 })
      }
    };
    incident.updatedAt = new Date().toISOString();
    await persistRuntimeState(`incident_reported:${incident.incidentId}`);
  }
  response.json({
    ok: true,
    duplicate,
    incident: incidentForClient(incident),
    message: `Report sent successfully. Our technical team can reference incident ${incident.incidentId}.`
  });
});

app.get("/api/compensation/coupons", async (request, response) => {
  const auth = getAuth(request);
  const coupons = state.compensationCoupons
    .filter((coupon) => canAccessRecord(coupon, auth))
    .map(refreshCouponExpiry)
    .map(compensationCouponForClient);
  await persistRuntimeState("compensation_coupon_expiry_refresh");
  response.json({ ok: true, coupons, total: coupons.length });
});

app.get("/api/ceo/errors", (request, response) => {
  const auth = getAuth(request);
  if (!isOwnerAuth(auth)) {
    response.status(403).json(authFailurePayload("forbidden"));
    return;
  }
  const requestedLimit = Number.parseInt(request.query.limit, 10);
  const limit = Number.isFinite(requestedLimit) ? Math.min(500, Math.max(1, requestedLimit)) : 100;
  const incidents = state.errorIncidents
    .filter((incident) => matchesIncidentFilter(incident, request.query))
    .slice(0, limit)
    .map(incidentForCeo);
  const summary = state.errorIncidents.reduce((counts, incident) => {
    counts.total += 1;
    counts.status[incident.status] = (counts.status[incident.status] || 0) + 1;
    counts.category[incident.category] = (counts.category[incident.category] || 0) + 1;
    return counts;
  }, { total: 0, status: {}, category: {} });
  response.json({ ok: true, incidents, total: incidents.length, summary });
});

app.get("/api/ceo/errors/:incidentId", (request, response) => {
  const auth = getAuth(request);
  if (!isOwnerAuth(auth)) {
    response.status(403).json(authFailurePayload("forbidden"));
    return;
  }
  const incident = incidentForId(request.params.incidentId);
  if (!incident) {
    response.status(404).json({ ok: false, code: "incident_not_found", error: "Incident not found." });
    return;
  }
  response.json({ ok: true, incident: incidentForCeo(incident) });
});

app.patch("/api/ceo/errors/:incidentId", async (request, response) => {
  const auth = getAuth(request);
  if (!isOwnerAuth(auth)) {
    response.status(403).json(authFailurePayload("forbidden"));
    return;
  }
  const incident = incidentForId(request.params.incidentId);
  if (!incident) {
    response.status(404).json({ ok: false, code: "incident_not_found", error: "Incident not found." });
    return;
  }
  const status = String(request.body?.status || "").trim().toUpperCase();
  if (!["OPEN", "INVESTIGATING", "RESOLVED", "IGNORED"].includes(status)) {
    response.status(400).json({ ok: false, code: "invalid_incident_status", error: "Invalid incident status." });
    return;
  }
  incident.status = status;
  incident.updatedAt = new Date().toISOString();
  incident.resolvedAt = status === "RESOLVED" ? incident.updatedAt : null;
  incident.metadata = {
    ...(incident.metadata || {}),
    ceoNote: sanitizeDiagnosticText(request.body?.note || incident.metadata?.ceoNote || "", { maxLength: 1000 })
  };
  await persistRuntimeState(`incident_status:${incident.incidentId}:${status}`);
  response.json({ ok: true, incident: incidentForCeo(incident), message: `Incident marked ${status}.` });
});

app.post("/api/ceo/providers/refresh", async (request, response) => {
  const auth = getAuth(request);
  if (!isOwnerAuth(auth)) {
    response.status(403).json(authFailurePayload("forbidden"));
    return;
  }
  const requested = String(request.body?.provider || "all").trim();
  const providers = requested.toLowerCase() === "all" ? ["Runway", "Replicate"] : [requested];
  const diagnostics = [];
  for (const provider of providers) {
    diagnostics.push(await refreshProviderDiagnostic(provider));
  }
  await persistRuntimeState("provider_diagnostics_refresh");
  response.json({
    ok: true,
    diagnostics: diagnostics.map((diagnostic) => ({
      provider: diagnostic.provider,
      status: diagnostic.status,
      errorName: diagnostic.errorName,
      errorCode: diagnostic.errorCode,
      customerMessage: diagnostic.customerMessage,
      checkedAt: diagnostic.checkedAt
    }))
  });
});

app.get("/api/ceo/provider-credits", async (request, response) => {
  const auth = getAuth(request);
  if (!isOwnerAuth(auth)) {
    response.status(403).json({
      ok: false,
      auth,
      code: "ceo_required",
      error: "CEO mode required.",
      readableError: "Enter CEO mode to view provider credit balances."
    });
    return;
  }

  try {
    const providers = await providerCreditSummary();
    response.json({
      ok: true,
      auth,
      providers,
      checkedAt: new Date().toISOString(),
      message: "Provider credit summary ready."
    });
  } catch (error) {
    response.status(502).json({
      ok: false,
      auth,
      code: "provider_credit_summary_failed",
      error: error.message,
      readableError: "Could not refresh provider credits right now."
    });
  }
});

app.get("/api/projects", (request, response) => {
  const auth = getAuth(request);
  response.json({ ok: true, auth, projects: filterRecordsForAuth(state.projects, auth), emptyState: "No Projects" });
});

app.post("/api/projects", (request, response) => {
  const auth = getAuth(request);
  const tenantId = requestIdentity(request, auth);
  const project = {
    id: requestId("project"),
    tenantId,
    userId: auth.userId || null,
    title: request.body?.title || "Untitled project",
    kind: request.body?.kind || "studio",
    status: "saved",
    thumbnail: request.body?.thumbnail || null,
    versions: [{ id: requestId("version"), label: "Autosave", createdAt: new Date().toISOString() }],
    exports: request.body?.exports || [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  state.projects.unshift(project);
  saveHistory({
    id: requestId("history"),
    tenantId,
    kind: project.kind,
    title: project.title,
    provider: "SLT Project Manager",
    status: "saved",
    message: "Project saved in the active SLT data store.",
    createdAt: project.createdAt
  });
  response.json({ ok: true, auth, project, message: "Project saved." });
});

app.get("/api/projects/:projectId", (request, response) => {
  const auth = getAuth(request);
  const project = state.projects.find((item) => item.id === request.params.projectId);
  if (!project || !canAccessRecord(project, auth)) {
    response.status(404).json({ ok: false, code: "project_not_found", error: "Project not found." });
    return;
  }
  const sessions = filterRecordsForAuth(state.generationSessions, auth).filter((item) => item.projectId === project.id);
  const jobs = filterRecordsForAuth(state.jobs, auth).filter((item) => item.projectId === project.id);
  const assets = filterRecordsForAuth(state.assets, auth).filter((item) => item.projectId === project.id && !item.deletedAt).map(serializeAssetForClient);
  const scenes = filterRecordsForAuth(state.scenes, auth).filter((item) => item.projectId === project.id);
  response.json({ ok: true, auth, project, sessions, jobs, assets, scenes });
});

app.patch("/api/projects/:projectId", (request, response) => {
  const auth = getAuth(request);
  const project = state.projects.find((item) => item.id === request.params.projectId);
  if (!project || !canAccessRecord(project, auth)) {
    response.status(404).json({ ok: false, code: "project_not_found", error: "Project not found." });
    return;
  }
  if (typeof request.body?.title === "string" && request.body.title.trim()) project.title = request.body.title.trim().slice(0, 180);
  if (typeof request.body?.kind === "string" && request.body.kind.trim()) project.kind = request.body.kind.trim().slice(0, 80);
  if (["ACTIVE", "SAVED", "ARCHIVED"].includes(String(request.body?.status || "").toUpperCase())) project.status = String(request.body.status).toLowerCase();
  project.updatedAt = new Date().toISOString();
  response.json({ ok: true, auth, project });
});

app.delete("/api/projects/:projectId", (request, response) => {
  const auth = getAuth(request);
  const project = state.projects.find((item) => item.id === request.params.projectId);
  if (!project || !canAccessRecord(project, auth)) {
    response.status(404).json({ ok: false, code: "project_not_found", error: "Project not found." });
    return;
  }
  project.status = "archived";
  project.updatedAt = new Date().toISOString();
  response.json({ ok: true, auth, project, message: "Project archived without deleting its history or assets." });
});

app.get("/api/history", (request, response) => {
  const auth = getAuth(request);
  response.json({ ok: true, auth, history: filterRecordsForAuth(state.history, auth), emptyState: "No History" });
});

app.post("/api/history", (request, response) => {
  const auth = getAuth(request);
  const item = {
    id: requestId("history"),
    tenantId: auth.userId,
    kind: request.body?.kind || "activity",
    title: request.body?.title || "Activity",
    provider: request.body?.provider || "frontend mock",
    status: request.body?.status || "saved",
    createdAt: new Date().toISOString()
  };
  saveHistory(item);
  response.json({ ok: true, auth, historyItem: item, message: "History saved." });
});

app.get("/api/stripe/status", (request, response) => {
  response.json({
    ok: true,
    auth: getAuth(request),
    stripe: stripeSetupStatus(),
    message: hasEnvValue("STRIPE_SECRET_KEY")
      ? "Stripe secret key detected server-side."
      : "Stripe setup required. Add STRIPE_SECRET_KEY and plan price IDs in .env."
  });
});

app.get("/api/credits/packs", (request, response) => {
  const auth = getAuth(request);
  const tenantId = requestIdentity(request, auth);
  response.json({
    ok: true,
    auth,
    balance: ledgerSnapshot(tenantId).availableCredits,
    packs: stripeCreditPackStatus()
  });
});

async function handleSubscriptionCheckout(request, response) {
  const plan = request.body?.plan || "Creator";
  const interval = request.body?.interval || "monthly";
  const email = request.body?.email || state.user.email;
  const priceId = stripePriceIdFor(plan, interval);
  if (plan === "Free") {
    response.status(400).json({ ok: false, code: "free_plan_no_checkout", error: "Free plan does not require checkout." });
    return;
  }
  if (!hasEnvValue("STRIPE_SECRET_KEY")) {
    const failed = buildFailedEntry({
      kind: "billing",
      title: `Stripe checkout ${plan}`,
      providerName: "Stripe",
      prompt: `${plan} ${interval}`,
      message: "Stripe setup required. Add STRIPE_SECRET_KEY in .env.",
      code: "stripe_setup_required"
    });
    saveHistory(failed);
    response.status(503).json({
      ok: false,
      code: "stripe_setup_required",
      stripe: stripeSetupStatus(),
      historyItem: failed,
      error: "Stripe setup required. Add STRIPE_SECRET_KEY in .env.",
      readableError: "Stripe setup required. Add STRIPE_SECRET_KEY in .env."
    });
    return;
  }
  if (!priceId) {
    const envName = stripePlanKey(plan, interval);
    const failed = buildFailedEntry({
      kind: "billing",
      title: `Stripe checkout ${plan}`,
      providerName: "Stripe",
      prompt: `${plan} ${interval}`,
      message: `Stripe price missing. Add ${envName} in .env.`,
      code: "stripe_price_missing"
    });
    saveHistory(failed);
    response.status(503).json({
      ok: false,
      code: "stripe_price_missing",
      stripe: stripeSetupStatus(),
      historyItem: failed,
      error: `Stripe price missing. Add ${envName} in .env.`,
      readableError: `Stripe price missing. Add ${envName} in .env.`
    });
    return;
  }

  try {
    const customer = currentStripeCustomerId();
    const auth = getAuth(request);
    const tenantId = requestIdentity(request, auth);
    const requestedCompensationCode = String(request.body?.compensationCode || "").trim();
    const compensationCoupon = requestedCompensationCode
      ? compensationCouponForCheckout(requestedCompensationCode, tenantId, auth.userId)
      : null;
    if (requestedCompensationCode && !compensationCoupon) {
      response.status(400).json({ ok: false, code: "compensation_coupon_invalid", error: "This compensation coupon is invalid, expired, redeemed or belongs to another user." });
      return;
    }
    if (compensationCoupon && !compensationCoupon.promotionCodeId) {
      await syncCompensationCouponWithStripe(compensationCoupon);
    }
    const session = await stripeRequest("/v1/checkout/sessions", {
      mode: "subscription",
      success_url: stripeReturnUrl("success"),
      cancel_url: stripeReturnUrl("cancel"),
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: !compensationCoupon?.promotionCodeId,
      discounts: compensationCoupon?.promotionCodeId ? [{ promotion_code: compensationCoupon.promotionCodeId }] : undefined,
      billing_address_collection: "auto",
      automatic_tax: { enabled: stripeAutomaticTaxEnabled() },
      customer: customer || undefined,
      customer_email: customer ? undefined : email,
      metadata: {
        plan,
        interval,
        credits: creditsForPlan(plan),
        tenantId,
        userId: auth.userId || tenantId,
        compensationCode: compensationCoupon?.code || "",
        source: "sweet-little-trauma-studio"
      }
    });
    const entry = {
      id: requestId("billing"),
      kind: "billing",
      title: `Stripe checkout created: ${plan}`,
      provider: "Stripe",
      status: "checkout_created",
      message: "Stripe Checkout session created. Redirect user to Stripe-hosted checkout.",
      result: { id: session.id, livemode: session.livemode, plan, interval },
      createdAt: new Date().toISOString()
    };
    saveHistory(entry);
    response.json({
      ok: true,
      auth: getAuth(request),
      checkout: {
        id: session.id,
        url: session.url,
        livemode: session.livemode,
        plan,
        interval
      },
      historyItem: entry,
      message: "Stripe Checkout session created."
    });
  } catch (error) {
    const failed = buildFailedEntry({
      kind: "billing",
      title: `Stripe checkout failed: ${plan}`,
      providerName: "Stripe",
      prompt: `${plan} ${interval}`,
      message: error.message,
      code: error.code || "stripe_error"
    });
    saveHistory(failed);
    response.status(error.code === "stripe_setup_required" ? 503 : 502).json({
      ok: false,
      code: error.code || "stripe_error",
      stripe: stripeSetupStatus(),
      historyItem: failed,
      error: error.message,
      readableError: error.message
    });
  }
}

app.post("/api/stripe/checkout", handleSubscriptionCheckout);
app.post("/api/billing/checkout", handleSubscriptionCheckout);

async function handleCreditPackCheckout(request, response) {
  const packId = request.body?.packId || "credits_1000";
  const email = request.body?.email || state.user.email;
  const pack = creditPackById(packId);
  const priceId = stripeCreditPackPriceId(packId);

  if (!pack) {
    response.status(400).json({ ok: false, code: "credit_pack_not_found", error: "Credit pack does not exist." });
    return;
  }
  if (!hasEnvValue("STRIPE_SECRET_KEY")) {
    response.status(503).json({ ok: false, code: "stripe_setup_required", stripe: stripeSetupStatus(), error: "Stripe setup required. Add STRIPE_SECRET_KEY in .env." });
    return;
  }
  if (!priceId) {
    response.status(503).json({ ok: false, code: "stripe_credit_price_missing", stripe: stripeSetupStatus(), error: `Stripe credit pack price missing. Add ${pack.envKey} in .env.` });
    return;
  }

  try {
    const customer = currentStripeCustomerId();
    const auth = getAuth(request);
    const tenantId = requestIdentity(request, auth);
    const requestedCompensationCode = String(request.body?.compensationCode || "").trim();
    const compensationCoupon = requestedCompensationCode
      ? compensationCouponForCheckout(requestedCompensationCode, tenantId, auth.userId)
      : null;
    if (requestedCompensationCode && !compensationCoupon) {
      response.status(400).json({ ok: false, code: "compensation_coupon_invalid", error: "This compensation coupon is invalid, expired, redeemed or belongs to another user." });
      return;
    }
    if (compensationCoupon && !compensationCoupon.promotionCodeId) {
      await syncCompensationCouponWithStripe(compensationCoupon);
    }
    const session = await stripeRequest("/v1/checkout/sessions", {
      mode: "payment",
      success_url: stripeReturnUrl("success"),
      cancel_url: stripeReturnUrl("cancel"),
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: !compensationCoupon?.promotionCodeId,
      discounts: compensationCoupon?.promotionCodeId ? [{ promotion_code: compensationCoupon.promotionCodeId }] : undefined,
      billing_address_collection: "auto",
      automatic_tax: { enabled: stripeAutomaticTaxEnabled() },
      customer: customer || undefined,
      customer_email: customer ? undefined : email,
      metadata: {
        type: "credit_pack",
        creditPackId: pack.id,
        credits: pack.credits,
        tenantId,
        userId: auth.userId || tenantId,
        compensationCode: compensationCoupon?.code || "",
        source: "sweet-little-trauma-studio"
      }
    });
    const entry = {
      id: requestId("credits"),
      kind: "billing",
      title: `Stripe credit checkout created: ${pack.name}`,
      provider: "Stripe",
      status: "checkout_created",
      message: "Stripe Checkout session created for extra credits.",
      result: { id: session.id, livemode: session.livemode, packId: pack.id, credits: pack.credits },
      createdAt: new Date().toISOString()
    };
    saveHistory(entry);
    response.json({
      ok: true,
      auth: getAuth(request),
      checkout: { id: session.id, url: session.url, livemode: session.livemode, pack },
      historyItem: entry,
      message: "Stripe credit checkout session created."
    });
  } catch (error) {
    const failed = buildFailedEntry({
      kind: "billing",
      title: `Stripe credit checkout failed: ${pack.name}`,
      providerName: "Stripe",
      prompt: pack.id,
      message: error.message,
      code: error.code || "stripe_error"
    });
    saveHistory(failed);
    response.status(error.code === "stripe_setup_required" ? 503 : 502).json({
      ok: false,
      code: error.code || "stripe_error",
      stripe: stripeSetupStatus(),
      historyItem: failed,
      error: error.message,
      readableError: error.message
    });
  }
}

app.post("/api/stripe/credits/checkout", handleCreditPackCheckout);
app.post("/api/billing/credits/checkout", handleCreditPackCheckout);

app.post("/api/stripe/portal", async (request, response) => {
  const flowTypeByAction = {
    payment_method_update: "payment_method_update",
    subscription_cancel: "subscription_cancel",
    subscription_update: "subscription_update"
  };
  const customer = currentStripeCustomerId();
  if (!customer) {
    response.status(503).json({
      ok: false,
      code: "stripe_customer_missing",
      stripe: stripeSetupStatus(),
      error: "Stripe customer missing. Complete a checkout first or add STRIPE_CUSTOMER_ID in .env.",
      readableError: "Stripe customer missing. Complete a checkout first or add STRIPE_CUSTOMER_ID in .env."
    });
    return;
  }
  try {
    const flow = flowTypeByAction[request.body?.flow] || "";
    const session = await stripeRequest("/v1/billing_portal/sessions", {
      customer,
      return_url: process.env.STRIPE_PORTAL_RETURN_URL || stripeReturnUrl("success"),
      flow_data: flow
        ? {
            type: flow,
            after_completion: {
              type: "redirect",
              redirect: { return_url: process.env.STRIPE_PORTAL_RETURN_URL || stripeReturnUrl("success") }
            }
          }
        : undefined
    });
    saveHistory({
      id: requestId("billing"),
      kind: "billing",
      title: "Stripe customer portal opened",
      provider: "Stripe",
      status: "portal_created",
      message: "Stripe Customer Portal session created.",
      result: { id: session.id, flow: flow || "portal_home" },
      createdAt: new Date().toISOString()
    });
    response.json({
      ok: true,
      auth: getAuth(request),
      portal: { id: session.id, url: session.url, flow: flow || "portal_home" },
      message: "Stripe Customer Portal session created."
    });
  } catch (error) {
    response.status(error.code === "stripe_setup_required" ? 503 : 502).json({
      ok: false,
      code: error.code || "stripe_error",
      stripe: stripeSetupStatus(),
      error: error.message,
      readableError: error.message
    });
  }
});

app.get("/api/billing", (request, response) => {
  const stripeStatus = providerStatus("Stripe");
  response.json({
    ok: true,
    auth: getAuth(request),
    provider: stripeStatus,
    stripe: stripeSetupStatus(),
    billing: state.billing,
    paymentEvents: state.paymentEvents.slice(0, 20),
    actions: ["checkout", "upgrade", "downgrade", "cancel", "reactivation", "invoices", "payment methods", "coupon codes", "failed payments"]
  });
});

app.post("/api/billing", (request, response) => {
  state.billing.paymentMethod = request.body?.paymentMethod || state.billing.paymentMethod;
  state.billing.coupon = request.body?.coupon || state.billing.coupon;
  response.json({ ok: true, auth: getAuth(request), billing: state.billing, message: "Payment method saved." });
});

app.get("/api/ledger", async (request, response) => {
  const auth = getAuth(request);
  const tenantId = auth.tenantId || auth.userId;
  if (runtimeStore.durable && typeof runtimeStore.getWallet === "function") {
    const durableWallet = await runtimeStore.getWallet(tenantId);
    if (durableWallet) mirrorLedgerResult({ wallet: durableWallet });
  }
  const reservations = filterRecordsForAuth(state.creditReservations, auth);
  const transactions = filterRecordsForAuth(state.creditTransactions, auth);
  const assets = filterRecordsForAuth(state.assets, auth);
  response.json({
    ok: true,
    auth,
    wallet: ledgerSnapshot(tenantId),
    jobCount: filterRecordsForAuth(state.jobs, auth).length,
    reservations: reservations.slice(0, 20),
    transactions: transactions.slice(0, 50),
    paymentEvents: state.paymentEvents.slice(0, 20),
    assetCount: assets.length
  });
});

const characterCapturePlan = [
  {
    stage: "consent",
    label: "Identity and consent",
    recommended: 1,
    instructions: ["Confirm the subject identity", "Grant explicit likeness, voice and training consent", "Choose revocation and commercial-use scope"]
  },
  {
    stage: "face_angles",
    label: "Face geometry",
    recommended: 24,
    instructions: ["Front", "Left and right profile", "Three-quarter left and right", "High and low angles", "Neutral light and hard light"]
  },
  {
    stage: "expressions",
    label: "Expressions",
    recommended: 24,
    instructions: ["Neutral", "Smile", "Laugh", "Cry", "Shout", "Anger", "Fear", "Surprise", "Disgust", "Eyes closed"]
  },
  {
    stage: "body",
    label: "Body and wardrobe",
    recommended: 12,
    instructions: ["Full body front, side and back", "Sitting and standing", "Natural wardrobe variations", "Hands visible"]
  },
  {
    stage: "performance_video",
    label: "Motion performance",
    recommended: 6,
    instructions: ["Walk and turn", "Sit and stand", "Gesture naturally", "Speak to camera", "Fast movement", "Slow controlled movement"]
  },
  {
    stage: "voice",
    label: "Voice calibration",
    recommended: 8,
    instructions: ["Alphabet and numbers", "Calibration phrase", "Neutral narration", "Whisper", "Shout", "Laugh", "Cry", "Anger and fear"]
  }
];

function findOwnedCharacter(characterId, auth) {
  const character = state.characters.find((item) => item.id === characterId);
  if (!character) return null;
  assertTenantAccess(character, auth);
  return character;
}

function ensureCharacterCreativeAsset(character) {
  if (!character) return null;
  const existing = state.assets.find((asset) => asset.metadata?.characterId === character.id && asset.kind === "character");
  if (existing) {
    character.metadata = { ...(character.metadata || {}), creativeAssetId: existing.id };
    return existing;
  }
  const now = new Date().toISOString();
  const asset = {
    id: requestId("asset"),
    tenantId: character.tenantId,
    userId: character.userId || null,
    jobId: null,
    batchId: null,
    projectId: null,
    sessionId: null,
    parentAssetId: null,
    kind: "character",
    provider: "SLT Character Lab",
    role: "character",
    originalName: character.name,
    originalUrl: null,
    publicUrl: `/api/characters/${encodeURIComponent(character.id)}`,
    storageKey: null,
    storageProvider: "postgres",
    storagePath: null,
    contentType: "application/vnd.slt.character+json",
    bytes: 0,
    status: "ready",
    metadata: { characterId: character.id, creativeAsset: true },
    createdAt: now
  };
  state.assets.unshift(asset);
  character.metadata = { ...(character.metadata || {}), creativeAssetId: asset.id };
  character.updatedAt = now;
  return asset;
}

function characterDatasetSummary(characterId, auth) {
  const character = findOwnedCharacter(characterId, auth);
  if (!character) return null;
  const links = state.characterAssets.filter((item) => item.characterId === characterId && canAccessRecord(item, auth));
  const linkedAssets = links
    .map((link) => ({ link, asset: state.assets.find((asset) => asset.id === link.assetId) || null }))
    .filter((item) => item.asset);
  const consents = state.characterConsents
    .filter((item) => item.characterId === characterId && canAccessRecord(item, auth))
    .sort((left, right) => new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime());
  const counts = linkedAssets.reduce((result, { link, asset }) => {
    const media = String(asset.contentType || "").split("/")[0] || "other";
    result.total += 1;
    result[media] = (result[media] || 0) + 1;
    result.categories[link.category] = (result.categories[link.category] || 0) + 1;
    if (link.angle) result.angles.add(link.angle);
    if (link.expression) result.expressions.add(link.expression);
    return result;
  }, { total: 0, image: 0, video: 0, audio: 0, other: 0, categories: {}, angles: new Set(), expressions: new Set() });
  const consentGranted = consents[0]?.status === "granted";
  const requirements = {
    consent: consentGranted,
    images: { current: counts.image, recommended: 50, complete: counts.image >= 50 },
    videos: { current: counts.video, recommended: 6, complete: counts.video >= 6 },
    voice: { current: counts.audio, recommended: 8, complete: counts.audio >= 8 },
    angles: { current: counts.angles.size, recommended: 8, complete: counts.angles.size >= 8 },
    expressions: { current: counts.expressions.size, recommended: 8, complete: counts.expressions.size >= 8 }
  };
  const ready = consentGranted && Object.values(requirements).filter((value) => typeof value === "object").every((value) => value.complete);
  return {
    character,
    consentGranted,
    consents,
    assets: linkedAssets,
    counts: { ...counts, angles: [...counts.angles], expressions: [...counts.expressions] },
    requirements,
    ready,
    capturePlan: characterCapturePlan,
    versions: state.characterVersions
      .filter((item) => item.characterId === characterId && canAccessRecord(item, auth))
      .sort((left, right) => Number(right.version || 0) - Number(left.version || 0)),
    previewAsset: linkedAssets.find(({ asset }) => asset.id === character.primaryAssetId)?.asset
      || linkedAssets.find(({ asset }) => String(asset.contentType || "").startsWith("image/"))?.asset
      || null
  };
}

app.get("/api/characters", (request, response) => {
  const auth = getAuth(request);
  const characters = filterRecordsForAuth(state.characters, auth).map((character) => {
    const creativeAsset = ensureCharacterCreativeAsset(character);
    const summary = characterDatasetSummary(character.id, auth);
    return {
      ...character,
      readiness: summary?.requirements || null,
      ready: Boolean(summary?.ready),
      consentGranted: Boolean(summary?.consentGranted),
      assetCount: Number(summary?.counts?.total || 0),
      creativeAssetId: creativeAsset?.id || null,
      previewAsset: summary?.previewAsset ? serializeAssetForClient(summary.previewAsset) : null
    };
  });
  response.json({ ok: true, auth, characters, capturePlan: characterCapturePlan });
});

app.post("/api/characters", (request, response) => {
  const auth = getAuth(request);
  const name = String(request.body?.name || "").trim();
  if (name.length < 2 || name.length > 120) {
    response.status(400).json({ ok: false, code: "character_name_invalid", error: "Character name must contain 2 to 120 characters." });
    return;
  }
  const now = new Date().toISOString();
  const tenantId = requestIdentity(request, auth);
  const baseSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "character";
  const character = {
    id: requestId("character"),
    tenantId,
    userId: auth.userId || null,
    name,
    slug: `${baseSlug}-${Date.now().toString(36)}`,
    description: String(request.body?.description || "").trim(),
    status: "draft",
    datasetStatus: "collecting",
    primaryAssetId: null,
    trainingProvider: null,
    providerModelId: null,
    metadata: { source: "character_lab", unlimitedDatasetIntake: true },
    createdAt: now,
    updatedAt: now
  };
  state.characters.unshift(character);
  const creativeAsset = ensureCharacterCreativeAsset(character);
  response.status(201).json({ ok: true, auth, character, creativeAsset: serializeAssetForClient(creativeAsset), capturePlan: characterCapturePlan });
});

app.get("/api/characters/:characterId", (request, response) => {
  const auth = getAuth(request);
  try {
    const summary = characterDatasetSummary(request.params.characterId, auth);
    if (!summary) {
      response.status(404).json({ ok: false, code: "character_not_found", error: "Character not found." });
      return;
    }
    response.json({ ok: true, auth, ...summary });
  } catch (error) {
    response.status(error.statusCode || 500).json({ ok: false, code: error.code || "character_read_failed", error: error.message });
  }
});

app.get("/api/characters/:characterId/use", (request, response) => {
  const auth = getAuth(request);
  try {
    const summary = characterDatasetSummary(request.params.characterId, auth);
    if (!summary) {
      response.status(404).json({ ok: false, code: "character_not_found", error: "Character not found." });
      return;
    }
    if (!summary.consentGranted) {
      response.status(409).json({ ok: false, code: "character_consent_required", error: "Current character consent is required." });
      return;
    }
    const prepared = prepareCharacterReferences({ payload: { characterIds: [summary.character.id] }, auth });
    response.json({
      ok: true,
      auth,
      character: summary.character,
      ready: summary.ready,
      referenceAssetIds: prepared.referenceAssetIds,
      references: prepared.characterReferences,
      previewAsset: summary.previewAsset ? serializeAssetForClient(summary.previewAsset) : null
    });
  } catch (error) {
    response.status(error.statusCode || 500).json({ ok: false, code: error.code || "character_use_failed", error: error.message });
  }
});

app.patch("/api/characters/:characterId", (request, response) => {
  const auth = getAuth(request);
  try {
    const character = findOwnedCharacter(request.params.characterId, auth);
    if (!character) {
      response.status(404).json({ ok: false, code: "character_not_found", error: "Character not found." });
      return;
    }
    if (typeof request.body?.name === "string" && request.body.name.trim()) character.name = request.body.name.trim().slice(0, 120);
    if (typeof request.body?.description === "string") character.description = request.body.description.trim().slice(0, 2000);
    if (request.body?.primaryAssetId) {
      const asset = findOwnedAsset(request.body.primaryAssetId, auth);
      if (!asset) throw Object.assign(new Error("Primary asset not found."), { statusCode: 404, code: "asset_not_found" });
      character.primaryAssetId = asset.id;
    }
    character.updatedAt = new Date().toISOString();
    response.json({ ok: true, auth, character });
  } catch (error) {
    response.status(error.statusCode || 500).json({ ok: false, code: error.code || "character_update_failed", error: error.message });
  }
});

app.post("/api/characters/:characterId/consent", (request, response) => {
  const auth = getAuth(request);
  try {
    const character = findOwnedCharacter(request.params.characterId, auth);
    if (!character) {
      response.status(404).json({ ok: false, code: "character_not_found", error: "Character not found." });
      return;
    }
    const status = String(request.body?.status || "granted").toLowerCase();
    if (!["granted", "revoked"].includes(status)) {
      response.status(400).json({ ok: false, code: "consent_status_invalid", error: "Consent status must be granted or revoked." });
      return;
    }
    const now = new Date().toISOString();
    const consent = {
      id: requestId("character_consent"),
      characterId: character.id,
      tenantId: character.tenantId,
      subjectUserId: auth.userId || null,
      subjectName: String(request.body?.subjectName || character.name).trim().slice(0, 160),
      status,
      scope: {
        likeness: request.body?.scope?.likeness !== false,
        voice: request.body?.scope?.voice !== false,
        training: request.body?.scope?.training !== false,
        commercialUse: Boolean(request.body?.scope?.commercialUse),
        expiresAt: request.body?.scope?.expiresAt || null
      },
      evidenceAssetId: request.body?.evidenceAssetId || null,
      signedAt: status === "granted" ? now : null,
      revokedAt: status === "revoked" ? now : null,
      metadata: { capturedBy: auth.userId || null },
      createdAt: now,
      updatedAt: now
    };
    state.characterConsents.unshift(consent);
    character.updatedAt = now;
    response.status(201).json({ ok: true, auth, consent });
  } catch (error) {
    response.status(error.statusCode || 500).json({ ok: false, code: error.code || "character_consent_failed", error: error.message });
  }
});

app.post("/api/characters/:characterId/assets", (request, response) => {
  const auth = getAuth(request);
  try {
    const summary = characterDatasetSummary(request.params.characterId, auth);
    if (!summary) {
      response.status(404).json({ ok: false, code: "character_not_found", error: "Character not found." });
      return;
    }
    if (!summary.consentGranted) {
      response.status(409).json({ ok: false, code: "character_consent_required", error: "Grant explicit subject consent before adding biometric assets." });
      return;
    }
    const asset = findOwnedAsset(request.body?.assetId, auth);
    if (!asset) {
      response.status(404).json({ ok: false, code: "asset_not_found", error: "Asset not found." });
      return;
    }
    const existing = state.characterAssets.find((item) => item.characterId === summary.character.id && item.assetId === asset.id);
    if (existing) {
      response.json({ ok: true, auth, characterAsset: existing, duplicate: true, summary });
      return;
    }
    const link = {
      id: requestId("character_asset"),
      characterId: summary.character.id,
      assetId: asset.id,
      tenantId: summary.character.tenantId,
      category: String(request.body?.category || "identity_photo").slice(0, 80),
      angle: String(request.body?.angle || "").slice(0, 80) || null,
      expression: String(request.body?.expression || "").slice(0, 80) || null,
      captureStage: String(request.body?.captureStage || "identity").slice(0, 80),
      qualityStatus: "pending",
      consentScope: "character_training",
      metadata: { originalName: asset.originalName || null },
      createdAt: new Date().toISOString()
    };
    state.characterAssets.unshift(link);
    summary.character.updatedAt = new Date().toISOString();
    response.status(201).json({ ok: true, auth, characterAsset: link, summary: characterDatasetSummary(summary.character.id, auth) });
  } catch (error) {
    response.status(error.statusCode || 500).json({ ok: false, code: error.code || "character_asset_failed", error: error.message });
  }
});

app.post("/api/characters/:characterId/versions", (request, response) => {
  const auth = getAuth(request);
  try {
    const summary = characterDatasetSummary(request.params.characterId, auth);
    if (!summary) {
      response.status(404).json({ ok: false, code: "character_not_found", error: "Character not found." });
      return;
    }
    if (!summary.consentGranted) {
      response.status(409).json({ ok: false, code: "character_consent_required", error: "Consent is required before creating a dataset version." });
      return;
    }
    const nextVersion = Math.max(0, ...summary.versions.map((item) => Number(item.version || 0))) + 1;
    const now = new Date().toISOString();
    const version = {
      id: requestId("character_version"),
      characterId: summary.character.id,
      tenantId: summary.character.tenantId,
      version: nextVersion,
      status: summary.ready ? "dataset_ready" : "collecting",
      provider: null,
      providerModelId: null,
      datasetSnapshot: {
        assetIds: summary.assets.map((item) => item.asset.id),
        counts: summary.counts,
        requirements: summary.requirements,
        consentIds: summary.consents.filter((item) => item.status === "granted").map((item) => item.id)
      },
      metadata: { providerTrainingStarted: false },
      createdAt: now,
      updatedAt: now
    };
    state.characterVersions.unshift(version);
    summary.character.datasetStatus = version.status;
    summary.character.updatedAt = now;
    response.status(201).json({ ok: true, auth, version, ready: summary.ready });
  } catch (error) {
    response.status(error.statusCode || 500).json({ ok: false, code: error.code || "character_version_failed", error: error.message });
  }
});

app.get("/api/assets", (request, response) => {
  const auth = getAuth(request);
  const kind = String(request.query.kind || "").trim().toLowerCase();
  const projectId = String(request.query.projectId || "").trim();
  const sessionId = String(request.query.sessionId || "").trim();
  response.json({
    ok: true,
    auth,
    cdnBaseUrl: storagePublicBaseUrl(request),
    storageProvider: process.env.STORAGE_PROVIDER || "local",
    assets: filterRecordsForAuth(state.assets, auth)
      .filter((asset) => !asset.deletedAt)
      .filter((asset) => !kind || String(asset.kind || "").toLowerCase() === kind)
      .filter((asset) => !projectId || asset.projectId === projectId)
      .filter((asset) => !sessionId || asset.sessionId === sessionId)
      .slice(0, 500)
      .map(serializeAssetForClient)
  });
});

app.get("/api/assets/:assetId", (request, response) => {
  const auth = getAuth(request);
  const asset = findOwnedAsset(request.params.assetId, auth);
  if (!asset || asset.deletedAt) {
    response.status(404).json({ ok: false, code: "asset_not_found", error: "Asset not found." });
    return;
  }
  const rootId = asset.parentAssetId || asset.id;
  const versions = filterRecordsForAuth(state.assets, auth)
    .filter((item) => !item.deletedAt && (item.id === rootId || item.parentAssetId === rootId))
    .sort((left, right) => Number(left.version || 1) - Number(right.version || 1))
    .map(serializeAssetForClient);
  response.json({ ok: true, auth, asset: serializeAssetForClient(asset), versions });
});

app.patch("/api/assets/:assetId", (request, response) => {
  const auth = getAuth(request);
  const asset = findOwnedAsset(request.params.assetId, auth);
  if (!asset || asset.deletedAt) {
    response.status(404).json({ ok: false, code: "asset_not_found", error: "Asset not found." });
    return;
  }
  if (typeof request.body?.displayName === "string" && request.body.displayName.trim()) asset.displayName = request.body.displayName.trim().slice(0, 180);
  if (request.body?.projectId !== undefined) asset.projectId = request.body.projectId || null;
  if (request.body?.sessionId !== undefined) asset.sessionId = request.body.sessionId || null;
  if (typeof request.body?.role === "string") asset.role = request.body.role.trim().slice(0, 80);
  asset.metadata = { ...(asset.metadata || {}), ...(request.body?.metadata && typeof request.body.metadata === "object" ? request.body.metadata : {}) };
  response.json({ ok: true, auth, asset: serializeAssetForClient(asset) });
});

app.get(["/api/versions", "/api/assets/:assetId/versions"], (request, response) => {
  const auth = getAuth(request);
  const requestedAssetId = request.params.assetId || String(request.query.assetId || "").trim();
  let assets = filterRecordsForAuth(state.assets, auth).filter((item) => !item.deletedAt);
  if (requestedAssetId) {
    const selected = assets.find((item) => item.id === requestedAssetId);
    if (!selected) {
      response.status(404).json({ ok: false, code: "asset_not_found", error: "Asset not found." });
      return;
    }
    const rootId = selected.parentAssetId || selected.id;
    assets = assets.filter((item) => item.id === rootId || item.parentAssetId === rootId);
  }
  const groups = new Map();
  for (const asset of assets) {
    const rootId = asset.parentAssetId || asset.id;
    if (!groups.has(rootId)) groups.set(rootId, []);
    groups.get(rootId).push(serializeAssetForClient(asset));
  }
  const lineages = [...groups.entries()].map(([rootAssetId, versions]) => ({
    rootAssetId,
    versions: versions.sort((left, right) => Number(left.version || 1) - Number(right.version || 1))
  }));
  response.json({ ok: true, auth, lineages, total: lineages.length });
});

app.post(["/api/assets/upload", "/api/uploads/reference"], async (request, response) => {
  const auth = getAuth(request);
  try {
    const asset = await storeUploadedReferenceAsset({ request, auth, payload: request.body || {} });
    response.status(201).json({
      ok: true,
      auth,
      asset: serializeAssetForClient(asset),
      cdnBaseUrl: storagePublicBaseUrl(request),
      message: "Reference asset uploaded."
    });
  } catch (error) {
    response.status(error.statusCode || 400).json({
      ok: false,
      auth,
      code: error.code || "upload_failed",
      error: error.message,
      readableError: error.message
    });
  }
});

app.post("/api/uploads/signed", async (request, response) => {
  const auth = getAuth(request);
  try {
    const payload = {
      kind: request.body?.kind,
      module: request.body?.module,
      role: request.body?.role,
      projectId: request.body?.projectId || null,
      sessionId: request.body?.sessionId || null,
      note: request.body?.note || "",
      fileName: request.body?.fileName || "upload.bin",
      contentType: String(request.body?.contentType || "application/octet-stream").split(";")[0].trim().toLowerCase(),
      bytes: Number(request.body?.bytes || 0),
      durationSeconds: request.body?.durationSeconds || null
    };
    const uploadKind = normalizeUploadKind(payload.kind || payload.module);
    validateDeclaredUpload({ uploadKind, contentType: payload.contentType, bytes: payload.bytes || null });
    if (!payload.bytes) {
      const error = new Error("File size is required before upload.");
      error.code = "upload_size_required";
      error.statusCode = 400;
      throw error;
    }
    if (!supabaseStorage.configured || process.env.SLT_TEST_MODE === "1") {
      response.json({
        ok: true,
        mode: "stream",
        uploadUrl: "/api/assets/upload-binary",
        maxBytes: maxUploadBytesFor(uploadKind),
        requiresCompletion: false
      });
      return;
    }
    const tenantId = requestIdentity(request, auth);
    const extension = extensionFromContentType(payload.contentType, payload.fileName);
    const storageKey = `${safeStorageSegment(tenantId)}/${new Date().toISOString().slice(0, 10)}/upload_${requestId("asset")}.${extension}`;
    const signed = await supabaseStorage.createSignedUpload({ key: storageKey, upsert: false });
    response.json({
      ok: true,
      mode: "signed",
      provider: signed.provider,
      storageKey: signed.storageKey,
      signedUrl: signed.signedUrl,
      token: signed.token,
      completeUrl: "/api/uploads/complete",
      expiresInSeconds: 7200,
      metadata: payload
    });
  } catch (error) {
    response.status(error.statusCode || 400).json({
      ok: false,
      auth,
      code: error.code || "upload_failed",
      error: error.message,
      readableError: error.message
    });
  }
});

app.post("/api/uploads/complete", async (request, response) => {
  const auth = getAuth(request);
  const payload = request.body?.metadata || request.body || {};
  const storageKey = String(request.body?.storageKey || payload.storageKey || "").replace(/^\/+/, "");
  const tenantId = requestIdentity(request, auth);
  const tenantPrefix = `${safeStorageSegment(tenantId)}/`;
  let tempPath = "";
  try {
    if (!supabaseStorage.configured) {
      const error = new Error("Signed upload completion requires Supabase Storage.");
      error.code = "signed_upload_not_configured";
      error.statusCode = 409;
      throw error;
    }
    if (!storageKey || !storageKey.startsWith(tenantPrefix)) {
      const error = new Error("The uploaded object does not belong to this tenant.");
      error.code = "upload_storage_key_forbidden";
      error.statusCode = 403;
      throw error;
    }
    const existing = state.assets.find((asset) => asset.tenantId === tenantId && asset.storageKey === storageKey);
    if (existing) {
      response.json({ ok: true, asset: serializeAssetForClient(existing), idempotent: true });
      return;
    }
    const uploadKind = normalizeUploadKind(payload.kind || payload.module);
    const declaredContentType = String(payload.contentType || "application/octet-stream").split(";")[0].trim().toLowerCase();
    const { accepted, maxBytes } = validateDeclaredUpload({ uploadKind, contentType: declaredContentType, bytes: Number(payload.bytes || 0) || null });
    const signedDownload = await supabaseStorage.createSignedDownload({ key: storageKey, expiresIn: 180 });
    tempPath = await temporaryUploadPath(uploadKind, extensionFromContentType(declaredContentType, payload.fileName));
    await downloadUrlToFile(signedDownload.signedUrl, tempPath, { maxBytes });
    const validation = await validateMediaFile({
      filePath: tempPath,
      declaredMime: declaredContentType,
      kind: uploadKind,
      maxBytes,
      probeLimits: {
        maxDuration: envNumber("MAX_VIDEO_DURATION_SECONDS", 3600),
        maxWidth: envNumber("MAX_VIDEO_WIDTH", 8192),
        maxHeight: envNumber("MAX_VIDEO_HEIGHT", 8192),
        maxFps: envNumber("MAX_VIDEO_FPS", 120)
      }
    });
    if (!accepted.includes(validation.detectedMime) && !(validation.detectedMime === "video/webm" && accepted.includes("audio/webm"))) {
      const error = new Error(`Detected media type ${validation.detectedMime} is not accepted for ${uploadKind}.`);
      error.code = "upload_invalid_mime";
      error.statusCode = 400;
      throw error;
    }
    const publicUrl = process.env.STORAGE_PUBLIC_BASE_URL
      ? `${String(process.env.STORAGE_PUBLIC_BASE_URL).replace(/\/$/, "")}/${storageKey}`
      : supabaseStorage.publicUrl(storageKey);
    const asset = registerUploadedAsset({
      request,
      auth,
      payload,
      uploadKind,
      contentType: declaredContentType,
      detectedContentType: validation.detectedMime,
      bytes: validation.bytes,
      stored: { provider: "supabase", storageKey, publicUrl },
      media: validation.media
    });
    await rm(tempPath, { force: true });
    tempPath = "";
    response.status(201).json({ ok: true, auth, asset: serializeAssetForClient(asset), message: "Signed upload validated and registered." });
  } catch (error) {
    if (tempPath) await rm(tempPath, { force: true }).catch(() => {});
    if (storageKey && storageKey.startsWith(tenantPrefix)) await supabaseStorage.remove(storageKey).catch(() => {});
    response.status(error.statusCode || 400).json({
      ok: false,
      auth,
      code: error.code || "upload_completion_failed",
      error: error.message,
      readableError: error.message,
      details: error.details || null
    });
  }
});

app.post("/api/assets/:assetId/extract-frame", async (request, response) => {
  const auth = getAuth(request);
  let temporarySourcePath = "";
  let outputPath = "";
  try {
    const sourceAsset = findOwnedAsset(request.params.assetId, auth);
    if (!sourceAsset) {
      response.status(404).json({ ok: false, code: "asset_not_found", error: "Video asset not found." });
      return;
    }
    if (!String(sourceAsset.contentType || "").startsWith("video/")) {
      response.status(400).json({ ok: false, code: "video_asset_required", error: "Frame extraction requires a video asset." });
      return;
    }

    const duration = Number(sourceAsset.metadata?.durationSeconds || 0);
    const requestedTimestamp = Math.max(0, Number(request.body?.timestampSeconds || 0) || 0);
    const timestampSeconds = duration > 0 ? Math.min(requestedTimestamp, Math.max(0, duration - 0.04)) : requestedTimestamp;
    let sourcePath = sourceAsset.storagePath && existsSync(sourceAsset.storagePath) ? sourceAsset.storagePath : "";
    if (!sourcePath) {
      temporarySourcePath = await temporaryUploadPath("frame-source", extensionFromContentType(sourceAsset.contentType, sourceAsset.originalName || "video.mp4"));
      const downloadUrl = sourceAsset.storageProvider === "supabase" && sourceAsset.storageKey && supabaseStorage.configured
        ? (await supabaseStorage.createSignedDownload({ key: sourceAsset.storageKey, expiresIn: 180 })).signedUrl
        : sourceAsset.publicUrl;
      if (!downloadUrl || !/^https?:\/\//i.test(downloadUrl)) {
        const error = new Error("The persistent video file is not available for frame extraction.");
        error.code = "asset_file_missing";
        error.statusCode = 404;
        throw error;
      }
      await downloadUrlToFile(downloadUrl, temporarySourcePath, { maxBytes: maxUploadBytesFor("video") });
      sourcePath = temporarySourcePath;
    }

    outputPath = await temporaryUploadPath("extracted-frame", "png");
    await extractVideoFrame({ sourcePath, outputPath, timestampSeconds });
    const validation = await validateMediaFile({
      filePath: outputPath,
      declaredMime: "image/png",
      kind: "image",
      maxBytes: maxUploadBytesFor("image"),
      skipProbe: true
    });
    const tenantId = requestIdentity(request, auth);
    const digest = (await hashFile(outputPath)).slice(0, 12);
    const fileName = `frame_${safeStorageSegment(tenantId)}_${Date.now()}_${digest}.png`;
    const stored = await storeAssetFile({
      filePath: outputPath,
      contentType: "image/png",
      fileName,
      request,
      tenantId,
      move: true
    });
    outputPath = "";
    const now = new Date().toISOString();
    const frameAsset = {
      id: requestId("asset"),
      tenantId,
      userId: auth.userId || null,
      jobId: null,
      batchId: null,
      projectId: sourceAsset.projectId || null,
      sessionId: sourceAsset.sessionId || null,
      parentAssetId: sourceAsset.id,
      kind: "image",
      module: "image",
      provider: "SLT Frame Extraction",
      role: "extracted_frame",
      originalName: fileName,
      originalUrl: sourceAsset.publicUrl || null,
      publicUrl: stored.publicUrl,
      storageKey: stored.storageKey,
      storageProvider: stored.provider || "local",
      storagePath: stored.storagePath || null,
      contentType: validation.detectedMime,
      bytes: validation.bytes,
      status: "stored",
      metadata: {
        sourceAssetId: sourceAsset.id,
        timestampSeconds,
        serverValidated: true
      },
      createdAt: now
    };
    state.assets.unshift(frameAsset);
    state.assets = state.assets.slice(0, 300);
    response.status(201).json({
      ok: true,
      auth,
      asset: serializeAssetForClient(frameAsset),
      sourceAssetId: sourceAsset.id,
      message: "Frame extracted and stored as a reusable SLT Asset."
    });
  } catch (error) {
    if (outputPath) await rm(outputPath, { force: true }).catch(() => {});
    response.status(error.statusCode || 500).json({
      ok: false,
      auth,
      code: error.code || "frame_extraction_failed",
      error: error.message,
      readableError: error.message
    });
  } finally {
    if (temporarySourcePath) await rm(temporarySourcePath, { force: true }).catch(() => {});
  }
});

app.get("/api/assets/:assetId/download", (request, response) => {
  const auth = getAuth(request);
  try {
    const asset = findOwnedAsset(request.params.assetId, auth);
    if (!asset) {
      response.status(404).json({ ok: false, code: "asset_not_found", error: "Asset not found." });
      return;
    }
    if ((!asset.storagePath || !existsSync(asset.storagePath)) && asset.publicUrl) {
      response.redirect(asset.publicUrl);
      return;
    }
    if (!asset.storagePath || !existsSync(asset.storagePath)) {
      response.status(404).json({ ok: false, code: "asset_file_missing", error: "Asset file is not available in local storage." });
      return;
    }
    response.download(asset.storagePath, asset.originalName || asset.storagePath.split("/").pop());
  } catch (error) {
    response.status(error.statusCode || 500).json({ ok: false, code: error.code || "asset_download_failed", error: error.message });
  }
});

app.delete("/api/assets/:assetId", async (request, response) => {
  const auth = getAuth(request);
  try {
    const asset = findOwnedAsset(request.params.assetId, auth);
    if (!asset) {
      response.status(404).json({ ok: false, code: "asset_not_found", error: "Asset not found." });
      return;
    }
    asset.deletedAt = new Date().toISOString();
    asset.status = "deleted";
    state.creativeReferences.forEach((reference) => {
      if (reference.assetId === asset.id) {
        reference.status = "DELETED";
        reference.updatedAt = asset.deletedAt;
      }
    });
    response.json({ ok: true, auth, assetId: asset.id, message: "Asset removed from the active Library. Version history remains durable." });
  } catch (error) {
    response.status(error.statusCode || 500).json({ ok: false, code: error.code || "asset_delete_failed", error: error.message });
  }
});

const creativeReferenceTypes = new Set(["FACE", "CHARACTER", "IMAGE", "STYLE", "PRODUCT", "LOCATION", "AUDIO", "MUSIC", "VOICE"]);
const timelineTrackTypes = new Set(["VIDEO", "DIALOGUE", "VOICE", "MUSIC", "SFX", "AMBIENCE", "FOLEY", "EFFECT"]);
const workflowNodeTypes = new Set(["TEXT", "IMAGE", "VIDEO", "MUSIC", "AUDIO", "VOICE", "CHARACTER", "SCENE", "UTILITY"]);

function normalizeReferenceType(value = "IMAGE") {
  const normalized = String(value || "IMAGE").trim().toUpperCase();
  return creativeReferenceTypes.has(normalized) ? normalized : "IMAGE";
}

function createCreativeReference({ auth, asset, payload = {} }) {
  const tenantId = requestIdentity({ headers: {} }, auth);
  const referenceType = normalizeReferenceType(payload.referenceType || payload.type);
  const existing = state.creativeReferences.find((item) => item.tenantId === tenantId && item.assetId === asset.id && item.referenceType === referenceType);
  const now = new Date().toISOString();
  if (existing) {
    existing.name = String(payload.name || existing.name || asset.displayName || asset.originalName || "Reference").slice(0, 180);
    existing.projectId = payload.projectId !== undefined ? payload.projectId || null : existing.projectId;
    existing.sessionId = payload.sessionId !== undefined ? payload.sessionId || null : existing.sessionId;
    existing.status = "ACTIVE";
    existing.updatedAt = now;
    return existing;
  }
  const reference = {
    id: requestId("reference"),
    tenantId,
    userId: auth.userId || null,
    assetId: asset.id,
    projectId: payload.projectId || asset.projectId || null,
    sessionId: payload.sessionId || asset.sessionId || null,
    referenceType,
    name: String(payload.name || asset.displayName || asset.originalName || `${referenceType} reference`).slice(0, 180),
    status: "ACTIVE",
    metadata: payload.metadata && typeof payload.metadata === "object" ? payload.metadata : {},
    createdAt: now,
    updatedAt: now
  };
  state.creativeReferences.unshift(reference);
  return reference;
}

function serializeReference(reference, auth) {
  const asset = state.assets.find((item) => item.id === reference.assetId && !item.deletedAt && canAccessRecord(item, auth));
  return { ...reference, asset: asset ? serializeAssetForClient(asset) : null };
}

app.get("/api/references", (request, response) => {
  const auth = getAuth(request);
  const type = String(request.query.type || request.query.referenceType || "").toUpperCase();
  const projectId = String(request.query.projectId || "").trim();
  const sessionId = String(request.query.sessionId || "").trim();
  const references = filterRecordsForAuth(state.creativeReferences, auth)
    .filter((item) => item.status === "ACTIVE")
    .filter((item) => !type || item.referenceType === type)
    .filter((item) => !projectId || item.projectId === projectId)
    .filter((item) => !sessionId || item.sessionId === sessionId)
    .map((item) => serializeReference(item, auth));
  response.json({ ok: true, auth, references, types: [...creativeReferenceTypes], total: references.length });
});

app.post("/api/references", (request, response) => {
  const auth = getAuth(request);
  const asset = findOwnedAsset(request.body?.assetId, auth);
  if (!asset || asset.deletedAt) {
    response.status(404).json({ ok: false, code: "asset_not_found", error: "A stored Asset is required to create a Reference." });
    return;
  }
  const reference = createCreativeReference({ auth, asset, payload: request.body || {} });
  response.status(201).json({ ok: true, auth, reference: serializeReference(reference, auth) });
});

app.patch("/api/references/:referenceId", (request, response) => {
  const auth = getAuth(request);
  const reference = state.creativeReferences.find((item) => item.id === request.params.referenceId);
  if (!reference || !canAccessRecord(reference, auth) || reference.status !== "ACTIVE") {
    response.status(404).json({ ok: false, code: "reference_not_found", error: "Reference not found." });
    return;
  }
  if (typeof request.body?.name === "string" && request.body.name.trim()) reference.name = request.body.name.trim().slice(0, 180);
  if (request.body?.projectId !== undefined) reference.projectId = request.body.projectId || null;
  if (request.body?.sessionId !== undefined) reference.sessionId = request.body.sessionId || null;
  if (request.body?.referenceType) reference.referenceType = normalizeReferenceType(request.body.referenceType);
  reference.updatedAt = new Date().toISOString();
  response.json({ ok: true, auth, reference: serializeReference(reference, auth) });
});

app.delete("/api/references/:referenceId", (request, response) => {
  const auth = getAuth(request);
  const reference = state.creativeReferences.find((item) => item.id === request.params.referenceId);
  if (!reference || !canAccessRecord(reference, auth) || reference.status !== "ACTIVE") {
    response.status(404).json({ ok: false, code: "reference_not_found", error: "Reference not found." });
    return;
  }
  reference.status = "DELETED";
  reference.updatedAt = new Date().toISOString();
  response.json({ ok: true, auth, referenceId: reference.id });
});

app.post("/api/assets/:assetId/actions", (request, response) => {
  const auth = getAuth(request);
  const asset = findOwnedAsset(request.params.assetId, auth);
  if (!asset || asset.deletedAt) {
    response.status(404).json({ ok: false, code: "asset_not_found", error: "Asset not found." });
    return;
  }
  const action = String(request.body?.action || "").trim().toUpperCase();
  const navigation = {
    OPEN: `/library?assetId=${encodeURIComponent(asset.id)}`,
    DOWNLOAD: `/api/assets/${encodeURIComponent(asset.id)}/download`,
    USE_IN_VIDEO: `/video?studio=v2&referenceAssetId=${encodeURIComponent(asset.id)}`,
    USE_IN_IMAGE: `/image?studio=v2&referenceAssetId=${encodeURIComponent(asset.id)}`,
    OPEN_FRAME_IN_IMAGE: `/image?studio=v2&referenceAssetId=${encodeURIComponent(asset.id)}&versionType=VARIATION`,
    GENERATE_SOUND: `/sound?referenceAssetId=${encodeURIComponent(asset.id)}`,
    GENERATE_MUSIC: `/music?referenceAssetId=${encodeURIComponent(asset.id)}`
  };
  if (navigation[action]) {
    response.json({ ok: true, auth, action, asset: serializeAssetForClient(asset), navigateTo: navigation[action] });
    return;
  }
  if (action === "ADD_AS_REFERENCE") {
    const reference = createCreativeReference({ auth, asset, payload: request.body || {} });
    response.status(201).json({ ok: true, auth, action, reference: serializeReference(reference, auth) });
    return;
  }
  if (action === "ADD_TO_SCENE") {
    const scene = state.scenes.find((item) => item.id === request.body?.sceneId && canAccessRecord(item, auth));
    if (!scene) {
      response.status(404).json({ ok: false, code: "scene_not_found", error: "Choose an existing Scene first." });
      return;
    }
    const item = {
      id: requestId("scene_item"),
      sceneId: scene.id,
      tenantId: scene.tenantId,
      itemType: String(asset.kind || "ASSET").toUpperCase(),
      assetId: asset.id,
      characterId: null,
      referenceId: null,
      track: String(asset.kind || "asset").toUpperCase(),
      position: state.sceneItems.filter((entry) => entry.sceneId === scene.id).length,
      parameters: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    state.sceneItems.push(item);
    if (asset.kind === "image") scene.currentFrameAssetId = asset.id;
    if (asset.kind === "video") scene.currentVideoAssetId = asset.id;
    scene.updatedAt = new Date().toISOString();
    response.status(201).json({ ok: true, auth, action, scene, item });
    return;
  }
  response.status(400).json({ ok: false, code: "asset_action_not_supported", error: "This Asset action is not supported." });
});

function scenePayload(scene, auth) {
  const items = state.sceneItems.filter((item) => item.sceneId === scene.id && !item.deletedAt && canAccessRecord(item, auth));
  const timeline = state.timelineItems.filter((item) => item.sceneId === scene.id && !item.deletedAt && canAccessRecord(item, auth));
  return { ...scene, items, timeline };
}

app.get("/api/scenes", (request, response) => {
  const auth = getAuth(request);
  const projectId = String(request.query.projectId || "").trim();
  const scenes = filterRecordsForAuth(state.scenes, auth)
    .filter((item) => !projectId || item.projectId === projectId)
    .map((item) => scenePayload(item, auth));
  response.json({ ok: true, auth, scenes, total: scenes.length });
});

app.post("/api/scenes", (request, response) => {
  const auth = getAuth(request);
  const now = new Date().toISOString();
  const scene = {
    id: requestId("scene"),
    tenantId: requestIdentity(request, auth),
    userId: auth.userId || null,
    projectId: request.body?.projectId || null,
    sessionId: request.body?.sessionId || null,
    title: String(request.body?.title || "Untitled scene").slice(0, 180),
    status: "DRAFT",
    prompt: String(request.body?.prompt || "").slice(0, 12000),
    movementPrompt: String(request.body?.movementPrompt || "").slice(0, 12000),
    currentFrameAssetId: request.body?.currentFrameAssetId || null,
    currentVideoAssetId: request.body?.currentVideoAssetId || null,
    parameters: request.body?.parameters && typeof request.body.parameters === "object" ? request.body.parameters : {},
    metadata: request.body?.metadata && typeof request.body.metadata === "object" ? request.body.metadata : {},
    createdAt: now,
    updatedAt: now
  };
  state.scenes.unshift(scene);
  response.status(201).json({ ok: true, auth, scene: scenePayload(scene, auth) });
});

app.get("/api/scenes/:sceneId", (request, response) => {
  const auth = getAuth(request);
  const scene = state.scenes.find((item) => item.id === request.params.sceneId);
  if (!scene || !canAccessRecord(scene, auth)) {
    response.status(404).json({ ok: false, code: "scene_not_found", error: "Scene not found." });
    return;
  }
  response.json({ ok: true, auth, scene: scenePayload(scene, auth) });
});

app.patch("/api/scenes/:sceneId", (request, response) => {
  const auth = getAuth(request);
  const scene = state.scenes.find((item) => item.id === request.params.sceneId);
  if (!scene || !canAccessRecord(scene, auth)) {
    response.status(404).json({ ok: false, code: "scene_not_found", error: "Scene not found." });
    return;
  }
  for (const key of ["projectId", "sessionId", "currentFrameAssetId", "currentVideoAssetId"]) {
    if (request.body?.[key] !== undefined) scene[key] = request.body[key] || null;
  }
  for (const key of ["title", "prompt", "movementPrompt"]) {
    if (typeof request.body?.[key] === "string") scene[key] = request.body[key].slice(0, key === "title" ? 180 : 12000);
  }
  if (request.body?.status) scene.status = String(request.body.status).toUpperCase().slice(0, 40);
  if (request.body?.parameters && typeof request.body.parameters === "object") scene.parameters = { ...(scene.parameters || {}), ...request.body.parameters };
  scene.updatedAt = new Date().toISOString();
  response.json({ ok: true, auth, scene: scenePayload(scene, auth) });
});

app.post("/api/scenes/:sceneId/items", (request, response) => {
  const auth = getAuth(request);
  const scene = state.scenes.find((entry) => entry.id === request.params.sceneId);
  if (!scene || !canAccessRecord(scene, auth)) {
    response.status(404).json({ ok: false, code: "scene_not_found", error: "Scene not found." });
    return;
  }
  for (const [key, collection] of [["assetId", state.assets], ["characterId", state.characters], ["referenceId", state.creativeReferences]]) {
    const id = request.body?.[key];
    if (id && !collection.some((entry) => entry.id === id && canAccessRecord(entry, auth))) {
      response.status(404).json({ ok: false, code: `${key.replace("Id", "")}_not_found`, error: `${key.replace("Id", "")} not found.` });
      return;
    }
  }
  const now = new Date().toISOString();
  const item = {
    id: requestId("scene_item"),
    sceneId: scene.id,
    tenantId: scene.tenantId,
    itemType: String(request.body?.itemType || "ASSET").toUpperCase().slice(0, 80),
    assetId: request.body?.assetId || null,
    characterId: request.body?.characterId || null,
    referenceId: request.body?.referenceId || null,
    track: String(request.body?.track || "").toUpperCase().slice(0, 80) || null,
    position: Number(request.body?.position ?? state.sceneItems.filter((entry) => entry.sceneId === scene.id).length),
    parameters: request.body?.parameters && typeof request.body.parameters === "object" ? request.body.parameters : {},
    createdAt: now,
    updatedAt: now
  };
  state.sceneItems.push(item);
  scene.updatedAt = now;
  response.status(201).json({ ok: true, auth, item, scene: scenePayload(scene, auth) });
});

app.delete("/api/scenes/:sceneId/items/:itemId", (request, response) => {
  const auth = getAuth(request);
  const scene = state.scenes.find((entry) => entry.id === request.params.sceneId);
  if (!scene || !canAccessRecord(scene, auth)) {
    response.status(404).json({ ok: false, code: "scene_not_found", error: "Scene not found." });
    return;
  }
  const item = state.sceneItems.find((entry) => entry.id === request.params.itemId && entry.sceneId === scene.id && !entry.deletedAt);
  if (!item) {
    response.status(404).json({ ok: false, code: "scene_item_not_found", error: "Scene item not found." });
    return;
  }
  item.deletedAt = new Date().toISOString();
  item.updatedAt = item.deletedAt;
  response.json({ ok: true, auth, itemId: request.params.itemId });
});

app.get("/api/timeline", (request, response) => {
  const auth = getAuth(request);
  const projectId = String(request.query.projectId || "").trim();
  const sceneId = String(request.query.sceneId || "").trim();
  const items = filterRecordsForAuth(state.timelineItems, auth)
    .filter((item) => !item.deletedAt)
    .filter((item) => !projectId || item.projectId === projectId)
    .filter((item) => !sceneId || item.sceneId === sceneId)
    .sort((left, right) => Number(left.position || 0) - Number(right.position || 0) || Number(left.startSeconds || 0) - Number(right.startSeconds || 0));
  response.json({ ok: true, auth, items, trackTypes: [...timelineTrackTypes] });
});

app.post("/api/timeline", (request, response) => {
  const auth = getAuth(request);
  const trackType = String(request.body?.trackType || "VIDEO").toUpperCase();
  if (!timelineTrackTypes.has(trackType)) {
    response.status(400).json({ ok: false, code: "timeline_track_invalid", error: "Timeline track type is invalid." });
    return;
  }
  if (request.body?.assetId && !findOwnedAsset(request.body.assetId, auth)) {
    response.status(404).json({ ok: false, code: "asset_not_found", error: "Asset not found." });
    return;
  }
  const now = new Date().toISOString();
  const item = {
    id: requestId("timeline_item"),
    tenantId: requestIdentity(request, auth),
    projectId: request.body?.projectId || null,
    sessionId: request.body?.sessionId || null,
    sceneId: request.body?.sceneId || null,
    assetId: request.body?.assetId || null,
    trackType,
    startSeconds: Math.max(0, Number(request.body?.startSeconds || 0)),
    durationSeconds: request.body?.durationSeconds == null ? null : Math.max(0, Number(request.body.durationSeconds)),
    position: Number(request.body?.position || 0),
    muted: Boolean(request.body?.muted),
    solo: Boolean(request.body?.solo),
    volume: Number(request.body?.volume ?? 1),
    pan: Number(request.body?.pan || 0),
    fadeInSeconds: Math.max(0, Number(request.body?.fadeInSeconds || 0)),
    fadeOutSeconds: Math.max(0, Number(request.body?.fadeOutSeconds || 0)),
    parameters: request.body?.parameters && typeof request.body.parameters === "object" ? request.body.parameters : {},
    createdAt: now,
    updatedAt: now
  };
  state.timelineItems.push(item);
  response.status(201).json({ ok: true, auth, item });
});

app.patch("/api/timeline/:itemId", (request, response) => {
  const auth = getAuth(request);
  const item = state.timelineItems.find((entry) => entry.id === request.params.itemId);
  if (!item || !canAccessRecord(item, auth)) {
    response.status(404).json({ ok: false, code: "timeline_item_not_found", error: "Timeline item not found." });
    return;
  }
  for (const key of ["startSeconds", "durationSeconds", "position", "volume", "pan", "fadeInSeconds", "fadeOutSeconds"]) {
    if (request.body?.[key] !== undefined) item[key] = Number(request.body[key]);
  }
  for (const key of ["muted", "solo"]) if (request.body?.[key] !== undefined) item[key] = Boolean(request.body[key]);
  if (request.body?.trackType && timelineTrackTypes.has(String(request.body.trackType).toUpperCase())) item.trackType = String(request.body.trackType).toUpperCase();
  item.updatedAt = new Date().toISOString();
  response.json({ ok: true, auth, item });
});

app.delete("/api/timeline/:itemId", (request, response) => {
  const auth = getAuth(request);
  const item = state.timelineItems.find((entry) => entry.id === request.params.itemId);
  if (!item || !canAccessRecord(item, auth)) {
    response.status(404).json({ ok: false, code: "timeline_item_not_found", error: "Timeline item not found." });
    return;
  }
  item.deletedAt = new Date().toISOString();
  item.updatedAt = item.deletedAt;
  response.json({ ok: true, auth, itemId: item.id });
});

function workflowPayload(workflow, auth) {
  return {
    ...workflow,
    nodes: state.workflowNodes.filter((item) => item.workflowId === workflow.id && canAccessRecord(item, auth)),
    edges: state.workflowEdges.filter((item) => item.workflowId === workflow.id && canAccessRecord(item, auth))
  };
}

app.get("/api/workflows", (request, response) => {
  const auth = getAuth(request);
  const workflows = filterRecordsForAuth(state.workflows, auth).map((item) => workflowPayload(item, auth));
  response.json({ ok: true, auth, workflows, nodeTypes: [...workflowNodeTypes] });
});

app.post("/api/workflows", (request, response) => {
  const auth = getAuth(request);
  const now = new Date().toISOString();
  const workflow = {
    id: requestId("workflow"),
    tenantId: requestIdentity(request, auth),
    userId: auth.userId || null,
    projectId: request.body?.projectId || null,
    name: String(request.body?.name || "Untitled workflow").slice(0, 180),
    status: "DRAFT",
    description: String(request.body?.description || "").slice(0, 1000),
    metadata: {},
    createdAt: now,
    updatedAt: now
  };
  state.workflows.unshift(workflow);
  response.status(201).json({ ok: true, auth, workflow: workflowPayload(workflow, auth) });
});

app.post("/api/workflows/:workflowId/nodes", (request, response) => {
  const auth = getAuth(request);
  const workflow = state.workflows.find((item) => item.id === request.params.workflowId);
  if (!workflow || !canAccessRecord(workflow, auth)) {
    response.status(404).json({ ok: false, code: "workflow_not_found", error: "Workflow not found." });
    return;
  }
  const nodeType = String(request.body?.nodeType || "UTILITY").toUpperCase();
  if (!workflowNodeTypes.has(nodeType)) {
    response.status(400).json({ ok: false, code: "workflow_node_invalid", error: "Workflow node type is invalid." });
    return;
  }
  const now = new Date().toISOString();
  const node = {
    id: requestId("workflow_node"),
    workflowId: workflow.id,
    tenantId: workflow.tenantId,
    nodeType,
    label: String(request.body?.label || nodeType).slice(0, 180),
    position: request.body?.position && typeof request.body.position === "object" ? request.body.position : { x: 0, y: 0 },
    configuration: request.body?.configuration && typeof request.body.configuration === "object" ? request.body.configuration : {},
    createdAt: now,
    updatedAt: now
  };
  state.workflowNodes.push(node);
  workflow.updatedAt = now;
  response.status(201).json({ ok: true, auth, node, workflow: workflowPayload(workflow, auth) });
});

app.post("/api/workflows/:workflowId/edges", (request, response) => {
  const auth = getAuth(request);
  const workflow = state.workflows.find((item) => item.id === request.params.workflowId);
  if (!workflow || !canAccessRecord(workflow, auth)) {
    response.status(404).json({ ok: false, code: "workflow_not_found", error: "Workflow not found." });
    return;
  }
  const nodes = state.workflowNodes.filter((item) => item.workflowId === workflow.id);
  if (!nodes.some((item) => item.id === request.body?.sourceNodeId) || !nodes.some((item) => item.id === request.body?.targetNodeId)) {
    response.status(400).json({ ok: false, code: "workflow_edge_invalid", error: "Both workflow nodes must exist." });
    return;
  }
  const edge = {
    id: requestId("workflow_edge"),
    workflowId: workflow.id,
    tenantId: workflow.tenantId,
    sourceNodeId: request.body.sourceNodeId,
    targetNodeId: request.body.targetNodeId,
    metadata: request.body?.metadata && typeof request.body.metadata === "object" ? request.body.metadata : {},
    createdAt: new Date().toISOString()
  };
  state.workflowEdges.push(edge);
  response.status(201).json({ ok: true, auth, edge, workflow: workflowPayload(workflow, auth) });
});

const creativeApplicationCatalog = [
  { id: "storyboard", label: "Storyboard Builder", status: "AVAILABLE", route: "/scene-builder" },
  { id: "reality-transform", label: "Reality Transform", status: "AVAILABLE", route: "/video?studio=v2&operation=reality_transform" },
  { id: "character-pack", label: "Character Reference Pack", status: "AVAILABLE", route: "/characters" },
  { id: "ad-creator", label: "Multimodal Ad Creator", status: "COMING_SOON", reason: "WORKFLOW_EXECUTION_NOT_CONNECTED" },
  { id: "social-campaign", label: "Social Campaign Factory", status: "COMING_SOON", reason: "WORKFLOW_EXECUTION_NOT_CONNECTED" }
];

app.get("/api/applications", (request, response) => {
  const auth = getAuth(request);
  response.json({ ok: true, auth, applications: creativeApplicationCatalog, instances: filterRecordsForAuth(state.appInstances, auth) });
});

app.post("/api/applications", (request, response) => {
  const auth = getAuth(request);
  const definition = creativeApplicationCatalog.find((item) => item.id === request.body?.appType);
  if (!definition) {
    response.status(400).json({ ok: false, code: "application_not_found", error: "Application type not found." });
    return;
  }
  if (definition.status !== "AVAILABLE") {
    response.status(409).json({ ok: false, code: "application_coming_soon", error: "Coming Soon", reason: definition.reason });
    return;
  }
  const now = new Date().toISOString();
  const instance = {
    id: requestId("application"),
    tenantId: requestIdentity(request, auth),
    userId: auth.userId || null,
    projectId: request.body?.projectId || null,
    sessionId: request.body?.sessionId || null,
    appType: definition.id,
    title: String(request.body?.title || definition.label).slice(0, 180),
    status: "DRAFT",
    configuration: request.body?.configuration && typeof request.body.configuration === "object" ? request.body.configuration : {},
    createdAt: now,
    updatedAt: now
  };
  state.appInstances.unshift(instance);
  response.status(201).json({ ok: true, auth, instance, definition });
});

app.post(["/api/forms/:kind", "/api/contact"], (request, response) => {
  const auth = getAuth(request);
  const kind = request.params.kind || request.body?.kind || "contact";
  if (kind === "engineering" && !auth.ok) {
    response.status(401).json({
      ok: false,
      auth,
      code: "auth_required",
      error: "Authentication required.",
      readableError: "Engineering requests need user, CEO or guest access."
    });
    return;
  }
  try {
    const form = savePlatformForm({ request, auth, kind, payload: request.body || {} });
    response.status(201).json({
      ok: true,
      auth,
      form,
      message: "Request received. It was stored for follow-up."
    });
  } catch (error) {
    response.status(error.statusCode || 400).json({
      ok: false,
      auth,
      code: error.code || "form_submit_failed",
      error: error.message,
      readableError: error.message
    });
  }
});

app.get("/api/subscription", (request, response) => {
  response.json({ ok: true, auth: getAuth(request), subscription: state.subscription });
});

app.get("/api/subscription-status", (request, response) => {
  const auth = getAuth(request);
  const wallet = ledgerSnapshot(requestIdentity(request, auth));
  const subscription = state.subscription;
  const isCeo = auth.role === "CEO";
  response.json({
    ok: true,
    auth,
    subscription,
    subscriptionActive: isCeo || subscription.status === "active" || subscription.status === "trialing",
    hasCredits: isCeo || wallet.availableCredits > 0,
    credits: wallet.availableCredits,
    heldCredits: wallet.heldCredits,
    plan: subscription.plan || "Free",
    status: subscription.status || "unknown"
  });
});

app.post("/api/subscription", async (request, response) => {
  const auth = getAuth(request);
  const tenantId = requestIdentity(request, auth);
  const action = request.body?.action || "status";
  const nextPlan = request.body?.plan || state.subscription.plan;
  if (action !== "status" && !isOwnerAuth(auth)) {
    response.status(403).json({
      ok: false,
      auth,
      code: "subscription_mutation_forbidden",
      error: "Subscription changes must go through billing checkout or CEO mode.",
      readableError: "Use checkout or the billing portal to change a subscription."
    });
    return;
  }
  if (["upgrade", "downgrade", "reactivate"].includes(action)) {
    state.subscription.plan = nextPlan;
    state.subscription.status = "active";
    state.user.plan = nextPlan;
    await adjustAvailableCreditsTransactional({
      tenantId,
      userId: auth.userId || null,
      targetAmount: creditsForPlan(nextPlan),
      idempotencyKey: `manual_subscription:${action}:${nextPlan}:${Date.now()}`,
      reason: "manual_subscription_plan_credit_reset",
      metadata: { action, plan: nextPlan }
    });
  }
  if (action === "cancel") {
    state.subscription.status = "cancelled";
    state.subscription.cancellationReason = request.body?.reason || "";
  }
  response.json({
    ok: true,
    auth,
    subscription: state.subscription,
    message: action === "cancel" ? "Your subscription has been cancelled successfully." : "Subscription updated successfully."
  });
});

app.get("/api/user", (request, response) => {
  response.json({ ok: true, auth: getAuth(request), user: state.user });
});

app.post("/api/user", (request, response) => {
  const auth = getAuth(request);
  const allowedPreferences = typeof request.body?.preferences === "object" && request.body.preferences !== null
    ? request.body.preferences
    : {};
  state.user = {
    ...state.user,
    id: auth.userId || state.user.id,
    role: auth.role || state.user.role,
    email: typeof request.body?.email === "string" && request.body.email.trim() ? request.body.email.trim() : state.user.email,
    username: typeof request.body?.username === "string" && request.body.username.trim() ? request.body.username.trim() : state.user.username,
    language: typeof request.body?.language === "string" && request.body.language.trim() ? request.body.language.trim() : state.user.language,
    accountType: typeof request.body?.accountType === "string" && request.body.accountType.trim() ? request.body.accountType.trim() : state.user.accountType,
    preferences: {
      ...state.user.preferences,
      ...allowedPreferences
    }
  };
  response.json({ ok: true, auth, user: state.user, message: "Profile saved." });
});

app.post("/api/studio/run", (request, response) => {
  const { providerRoute, module, tool, payload } = request.body || {};

  if (!providerRoute || !module || !tool || !payload) {
    response.status(400).json({ ok: false, error: "Missing providerRoute, module, tool or payload." });
    return;
  }

  const kind = module === "assistant" ? "assist" : module;
  const checks = baseChecks({ ...request, body: { ...payload, provider: providerRoute } }, kind);
  const canRun = checks.provider.connected;
  const entry = {
    id: requestId("studio"),
    kind,
    title: payload.toolTitle || payload.moduleTitle || tool,
    provider: providerRoute,
    prompt: payload.prompt || "",
    status: canRun ? "queued" : "error",
    code: canRun ? "queued" : checks.provider.status,
    message: canRun ? `${providerRoute} accepted the request.` : checks.provider.message,
    fileUrl: `local-placeholder://${providerRoute}`,
    createdAt: new Date().toISOString()
  };
  saveHistory(entry);
  response.status(canRun ? 200 : 400).json({ ok: canRun, checks, historyItem: entry, error: canRun ? null : checks.provider.message, ...entry });
});

app.use("/cdn/assets", express.static(assetStorageDir, {
  dotfiles: "deny",
  immutable: true,
  maxAge: "365d",
  setHeaders: (response) => {
    response.setHeader("X-SLT-Asset-Storage", "local-cdn");
  }
}));

app.use(express.static(staticDir, { index: "index.html", dotfiles: "deny" }));

app.get("*", (request, response, next) => {
  if (request.path.startsWith("/api/")) {
    next();
    return;
  }
  response.sendFile(resolve(staticDir, "index.html"));
});

app.use((request, response) => {
  response.status(404).json({
    ok: false,
    error: "Not Found",
    readableError: "This API route does not exist yet.",
    path: request.path
  });
});

function resetTestState({ credits = 100 } = {}) {
  sessions.clear();
  processedWebhookEvents.clear();
  generationExecutionQueue.length = 0;
  activeGenerationExecutions = 0;
  rateBuckets.clear();
  usageBuckets.clear();
  state.user = {
    id: "demo-user",
    email: "creator@sweetlittletrauma.studio",
    username: "sweetcreator",
    plan: "Free",
    language: "Spanish",
    accountType: "Creator",
    credits,
    storageUsed: "3.2 GB",
    preferences: {
      visualStyle: "black neon",
      assistantVoice: "soft",
      assistantMemory: "creative preferences"
    }
  };
  state.subscription = {
    plan: "Free",
    status: "active",
    renewsAt: "2026-06-18",
    credits,
    heldCredits: 0,
    capturedCredits: 0,
    cancellationReason: "",
    stripeCustomerId: process.env.STRIPE_CUSTOMER_ID || "",
    stripeSubscriptionId: ""
  };
  state.projects = [];
  state.generationSessions = [];
  state.generationBatches = [];
  state.history = [];
  state.jobs = [];
  state.assets = [];
  state.characters = [];
  state.characterConsents = [];
  state.characterCaptureSessions = [];
  state.characterAssets = [];
  state.characterVersions = [];
  state.creativeReferences = [];
  state.scenes = [];
  state.sceneItems = [];
  state.timelineItems = [];
  state.workflows = [];
  state.workflowNodes = [];
  state.workflowEdges = [];
  state.appInstances = [];
  state.webhookEvents = [];
  state.paymentEvents = [];
  state.errorIncidents = [];
  state.compensationCoupons = [];
  state.providerDiagnostics = [
    {
      provider: "Runway",
      status: "AVAILABLE",
      errorName: null,
      errorCode: null,
      customerMessage: "Provider available in isolated tests.",
      checkedAt: new Date().toISOString(),
      metadata: { source: "test_reset" }
    },
    {
      provider: "Replicate",
      status: "AVAILABLE",
      errorName: null,
      errorCode: null,
      customerMessage: "Provider available in isolated tests.",
      checkedAt: new Date().toISOString(),
      metadata: { source: "test_reset" }
    }
  ];
  state.wallet = {
    tenantId: "demo-user",
    availableCredits: credits,
    heldCredits: 0,
    capturedCredits: 0
  };
  state.wallets = [state.wallet];
  state.creditReservations = [];
  state.creditTransactions = [
    {
      id: "credit_tx_test_opening",
      idempotencyKey: "opening:test",
      idempotency_key: "opening:test",
      type: "opening_balance",
      status: "posted",
      amount: credits,
      reservationId: null,
      jobId: null,
      tenantId: "demo-user",
      entries: [
        { account: "SLT.CreditIssuer", direction: "debit", amount: credits },
        { account: "Tenant.Available", direction: "credit", amount: credits }
      ],
      balanceDeltas: {
        availableCredits: credits,
        heldCredits: 0,
        capturedCredits: 0
      },
      metadata: { source: "test_reset" },
      createdAt: new Date().toISOString()
    }
  ];
  syncCreditViews();
  return state;
}

async function startServer() {
  await initializeRuntimeStore();
  return app.listen(port, () => {
    console.log(`SLT Studio running on http://127.0.0.1:${port} (API + React dist)`);
  });
}

if (process.env.SLT_TEST_MODE !== "1") {
  startServer().catch((error) => {
    console.error("[SLT] Server startup failed:", error.message);
    if (error.report) {
      console.error(JSON.stringify(error.report, null, 2));
    }
    process.exit(1);
  });
}

export { app, startServer };

export const __test = {
  app,
  state,
  sessions,
  runtimeStore,
  runtimeStoreStatus,
  initializeRuntimeStore,
  persistRuntimeState,
  resetTestState,
  getAuth,
  requestIdentity,
  getProductionReadinessReport,
  authProtectionMiddleware,
  rateLimitForPath,
  providerStatus,
  providerDiagnosticFor,
  setProviderDiagnostic,
  refreshProviderDiagnostic,
  SLT_ERROR_REGISTRY,
  SLT_ERROR_BY_NAME,
  classifySltError,
  createSltIncident,
  incidentForClient,
  recordSltFailure,
  compensationAllowed,
  createCompensationCoupon,
  compensationCouponForCheckout,
  markCompensationCouponRedeemed,
  registrySummary,
  multimodalModelRegistry,
  operationCatalog,
  routeMultimodalModel,
  runProviderGateway,
  creditCostFor,
  billableOutputCount,
  isRealityTransformPayload,
  prepareCharacterReferences,
  prepareGenerationPayload,
  prepareSeedanceProviderPayload,
  miniMaxAudioResult,
  requestedAudioDuration,
  refreshLocalJobFromProvider,
  reserveCredits,
  reserveCreditsTransactional,
  resolveReservation,
  resolveReservationTransactional,
  ledgerSnapshot,
  walletForTenant,
  runInputModeration,
  moderationFailurePayload,
  verifyProviderWebhookSignature,
  handleProviderWebhook,
  verifyStripeWebhookSignature,
  applyStripeWebhookEvent,
  createJob,
  createGenerationBatch,
  findGenerationBatch,
  recomputeGenerationBatch,
  serializeGenerationBatch,
  buildRetryGenerationPayload,
  handleGenerate,
  findJob,
  storeUploadedReferenceAsset,
  storeUploadedReferenceBytes,
  serializeAssetForClient,
  findOwnedAsset,
  findOwnedCharacter,
  characterDatasetSummary,
  characterCapturePlan,
  savePlatformForm,
  buildQueuedHistoryEntry,
  completeAsyncJob,
  failAsyncJob
};
