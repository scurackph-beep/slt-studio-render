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
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const app = express();
const port = Number(process.env.PORT || 3000);
const projectDir = dirname(fileURLToPath(import.meta.url));
const staticDir = process.env.SLT_STATIC_DIR || resolve(projectDir, "../dist");

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
    const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
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

aapp.use(cors({ origin: "*" }));

function requestIdentity(request, auth = null) {
  return auth?.userId || request.header?.("x-slt-user-id") || request.ip || request.socket?.remoteAddress || "anonymous";
}

function rateLimitForPath(path = "") {
  if (path.startsWith("/api/generate/")) return envNumber("GENERATE_RATE_LIMIT_PER_MINUTE", 10);
  return envNumber("API_RATE_LIMIT_PER_MINUTE", 90);
}

function rateLimitMiddleware(request, response, next) {
  if (!request.path.startsWith("/api/") || request.path === "/api/stripe/webhook") {
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
      error: "Too many requests. Wait a minute and try again.",
      retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000)
    });
    return;
  }
  next();
}

app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), (request, response) => {
  if (!hasEnvValue("STRIPE_WEBHOOK_SECRET")) {
    response.status(503).json({
      ok: false,
      code: "stripe_webhook_not_configured",
      error: "Stripe webhook secret is missing."
    });
    return;
  }

  try {
    const signature = request.header("Stripe-Signature") || "";
    const rawBody = Buffer.isBuffer(request.body) ? request.body : Buffer.from("");
    verifyStripeWebhookSignature(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
    const event = JSON.parse(rawBody.toString("utf8"));
    applyStripeWebhookEvent(event);
    response.json({ ok: true, received: true });
  } catch (error) {
    response.status(400).json({
      ok: false,
      code: "stripe_webhook_verification_failed",
      error: "Stripe webhook verification failed."
    });
  }
});

app.use(express.json({ limit: "50mb" }));
app.use(rateLimitMiddleware);

const providerFallbackMessage = "Provider not connected. Add API key.";
const preparedProviderMessage = "Prepared but not connected yet.";
const directEndpointMessage = "Direct endpoint needs confirmation.";
const missingConfigMessage = "Missing endpoint/config.";
const internalOnlyMessage = "Internal only.";
const disabledPreferenceMessage = "Disabled by project preference.";
const mockModeMessage = "Mock mode — provider not connected yet.";

const providerKeys = {
  image: ["OPENAI_API_KEY", "GEMINI_API_KEY", "XAI_API_KEY", "XAI_API", "LEONARDO_API_KEY", "RECRAFT_API_KEY", "REPLICATE_API_TOKEN", "COMFYUI_API_URL"],
  video: ["GEMINI_API_KEY", "SEEDANCE_API_KEY", "BYTEPLUS_API_KEY", "BYTEPLUS_VISION_AK", "WAN_API_KEY", "HAILUO_API_KEY", "MINIMAX_API_KEY", "PIXVERSE_API_KEY", "TENCENTCLOUD_SECRET_ID"],
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
    configEnvKeys: ["SEEDANCE_MODEL_ID"]
  },
  Veo: { kind: "video", envKey: "GEMINI_API_KEY", adapter: "veo-direct" },
  OmniHuman: {
    kind: "video",
    envKey: "BYTEPLUS_VISION_AK",
    adapter: "byteplus-omnihuman",
    configEnvKeys: ["BYTEPLUS_VISION_SK", "BYTEPLUS_VISION_REGION", "BYTEPLUS_VISION_SERVICE", "OMNIHUMAN_REQ_KEY"]
  },
  Runway: { kind: "video", envKey: "RUNWAY_API_KEY", adapter: "runway-video", endpointEnv: "RUNWAY_API_URL" },
  Kling: { kind: "video", envKey: "KLING_ACCESS_KEY", alternateEnvKeys: ["KLING_API_KEY"], adapter: "kling-video", endpointEnv: "KLING_API_URL", configEnvKeys: ["KLING_SECRET_KEY"] },
  Hailuo: { kind: "video", envKey: "HAILUO_API_KEY", alternateEnvKeys: ["MINIMAX_API_KEY"], adapter: "minimax-video", endpointEnv: "HAILUO_API_URL", alternateEndpointEnvKeys: ["MINIMAX_API_URL"] },
  Luma: { kind: "video", envKey: "LUMA_API_KEY", adapter: "luma-video", endpointEnv: "LUMA_API_URL" },
  PixVerse: { kind: "video", envKey: "PIXVERSE_API_KEY", adapter: "pixverse-video", endpointEnv: "PIXVERSE_API_URL" },
  Pika: { kind: "video", envKey: "PIKA_API_KEY", adapter: "generic-endpoint", endpointEnv: "PIKA_API_URL", disabledByPreference: true },
  Hunyuan: { kind: "video", envKey: "TENCENTCLOUD_SECRET_ID", adapter: "generic-endpoint", endpointEnv: "HUNYUAN_API_URL", configEnvKeys: ["TENCENTCLOUD_SECRET_KEY"], needsConfirmation: true },
  Wan: { kind: "video", envKey: "REPLICATE_API_TOKEN", adapter: "replicate-wan-video", configEnvKeys: ["WAN_REPLICATE_MODEL"] },
  HeyGen: { kind: "video", envKey: "HEYGEN_API_KEY", adapter: "heygen-video-agent", endpointEnv: "HEYGEN_API_URL" },
  "D-ID": { kind: "video", envKey: "DID_API_KEY", adapter: "did-talk", endpointEnv: "DID_API_URL" },

  Suno: { kind: "music", envKey: "SUNO_API_KEY", adapter: "generic-endpoint", endpointEnv: "SUNO_API_URL", preparedOnly: true },
  Udio: { kind: "music", envKey: "UDIO_API_KEY", adapter: "generic-endpoint", endpointEnv: "UDIO_API_URL", preparedOnly: true },
  "MiniMax Music": { kind: "music", envKey: "MINIMAX_API_KEY", alternateEnvKeys: ["HAILUO_API_KEY"], adapter: "minimax-music", endpointEnv: "MINIMAX_API_URL", alternateEndpointEnvKeys: ["HAILUO_API_URL"] },
  "SLT Composer": { kind: "music", envKey: "", adapter: "slt-composer", localProvider: true },
  "Stable Audio": { kind: "music", envKey: "STABLE_AUDIO_API_KEY", adapter: "stability-audio", endpointEnv: "STABLE_AUDIO_API_URL" },
  Mubert: { kind: "music", envKey: "MUBERT_API_KEY", adapter: "generic-endpoint", endpointEnv: "MUBERT_API_URL", preparedOnly: true },
  "AudioCraft local": { kind: "music", envKey: "REPLICATE_API_TOKEN", adapter: "replicate-musicgen", configEnvKeys: ["AUDIOCRAFT_REPLICATE_MODEL"] },
  Riffusion: { kind: "music", envKey: "REPLICATE_API_TOKEN", adapter: "replicate-riffusion", configEnvKeys: ["RIFFUSION_REPLICATE_MODEL"] },

  ElevenLabs: { kind: "sound", envKey: "ELEVENLABS_API_KEY", adapter: "elevenlabs-tts" },
  "OpenAI Audio": { kind: "sound", envKey: "OPENAI_API_KEY", adapter: "openai-speech" },
  "MiniMax Speech": { kind: "sound", envKey: "MINIMAX_API_KEY", alternateEnvKeys: ["HAILUO_API_KEY"], adapter: "minimax-speech", endpointEnv: "MINIMAX_API_URL", alternateEndpointEnvKeys: ["HAILUO_API_URL"] },
  "Stability Audio": { kind: "sound", envKey: "STABILITY_AUDIO_API_KEY", adapter: "stability-audio", endpointEnv: "STABILITY_AUDIO_API_URL" },
  "Dolby.io": { kind: "sound", envKey: "DOLBY_API_KEY", adapter: "generic-endpoint", endpointEnv: "DOLBY_API_URL", disabledByPreference: true },
  "iZotope": { kind: "sound", envKey: "IZOTOPE_API_KEY", adapter: "generic-endpoint", endpointEnv: "IZOTOPE_API_URL", preparedOnly: true },
  Moises: { kind: "sound", envKey: "MOISES_API_KEY", adapter: "moises-audio", endpointEnv: "MOISES_API_URL" },
  FFmpeg: { kind: "sound", envKey: "", adapter: "local-placeholder", internalOnly: true },

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

const defaultProvider = {
  image: "OpenAI Images",
  video: "Seedance",
  music: "SLT Composer",
  sound: "ElevenLabs",
  assist: "OpenAI",
  billing: "Stripe",
  subscription: "Stripe"
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

function creditCostFor(kind = "assist") {
  const costByKind = { image: 10, video: 300, music: 150, sound: 25, assist: 5 };
  return costByKind[kind] || 5;
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
  history: []
};

const sessions = new Map();

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
  return firstEnvValue([config.endpointEnv, ...(config.alternateEndpointEnvKeys || [])].filter(Boolean));
}

function envNumber(key, fallback) {
  const parsed = Number(process.env[key]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function requestId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

function getAuth(request) {
  const token = typeof request.header === "function" ? request.header("x-slt-session") : "";
  const session = token ? sessions.get(token) : null;
  if (session) {
    return {
      ok: true,
      mode: session.role === "CEO" ? "CEO_FULL_CREATIVE_MODE" : "local-session",
      userId: session.userId,
      role: session.role,
      email: session.email,
      username: session.username,
      message: session.role === "CEO" ? "CEO session accepted." : "Local session accepted."
    };
  }
  const userId = typeof request.header === "function" ? request.header("x-slt-user-id") || "demo-user" : "demo-user";
  return {
    ok: true,
    mode: "mock",
    userId,
    role: "standard",
    message: "Mock auth accepted. Replace this with real session validation before launch."
  };
}

function isOwnerAuth(auth = {}) {
  const ownerUserId = process.env.LOCAL_OWNER_USER_ID || "demo-user";
  const ownerEmail = process.env.CEO_EMAIL || "";
  return auth.role === "CEO" || auth.userId === ownerUserId || (ownerEmail && auth.email === ownerEmail);
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
    canGenerate: connected,
    message
  };
}

function providerList(kind = "") {
  return Object.keys(providerCatalog)
    .map(providerStatus)
    .filter((provider) => !kind || provider.kind === kind);
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

function validateCredits(kind) {
  const cost = creditCostFor(kind);
  if (state.subscription.credits < cost) {
    return {
      ok: false,
      code: "insufficient_credits",
      message: "Insufficient Credits",
      readableError: "You do not have enough credits for this action."
    };
  }
  return { ok: true, cost, remaining: state.subscription.credits - cost };
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

function baseChecks(request, kind) {
  const requestedProvider = request.body?.provider || defaultProvider[kind] || "Mock Provider";
  const status = providerStatus(requestedProvider);
  const auth = getAuth(request);
  return {
    auth,
    plan: validatePlan(kind, request, auth),
    credits: validateCredits(kind),
    provider: status
  };
}

function failProviderIfRequested(request, response) {
  if (request.body?.forceProviderFailure) {
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
  state.history.unshift(entry);
  state.history = state.history.slice(0, 50);
}

function saveProjectFromEntry(entry) {
  const project = {
    id: requestId("project"),
    title: entry.title,
    kind: entry.kind,
    status: entry.status,
    thumbnail: `local-placeholder://${entry.kind}/${entry.id}`,
    createdAt: entry.createdAt,
    updatedAt: entry.createdAt,
    exports: []
  };
  state.projects.unshift(project);
  state.projects = state.projects.slice(0, 30);
  return project;
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
      const message = data.error?.message || data.message || data.raw || `${response.status} ${response.statusText}`;
      throw new Error(message);
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
      const message = data.error?.message || data.message || data.raw || `${response.status} ${response.statusText}`;
      throw new Error(message);
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
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
  const payload = `${timestamp}.${rawBody.toString("utf8")}`;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  const matched = signatures.some((signature) => {
    const signatureBuffer = Buffer.from(signature, "hex");
    return signatureBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
  });
  if (!matched) throw new Error("Invalid Stripe signature.");
}

function applyStripeWebhookEvent(event = {}) {
  const object = event.data?.object || {};
  if (event.type === "checkout.session.completed") {
    if (object.metadata?.type === "credit_pack") {
      const pack = creditPackById(object.metadata?.creditPackId);
      const credits = Number(object.metadata?.credits || pack?.credits || 0);
      if (credits > 0) {
        state.subscription.credits += credits;
        state.user.credits = state.subscription.credits;
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
      return;
    }
    state.billing.stripeCustomerId = object.customer || state.billing.stripeCustomerId;
    state.subscription.stripeCustomerId = object.customer || state.subscription.stripeCustomerId;
    state.subscription.stripeSubscriptionId = object.subscription || state.subscription.stripeSubscriptionId;
    state.subscription.plan = object.metadata?.plan || state.subscription.plan;
    state.subscription.status = "active";
    state.subscription.credits = creditsForPlan(state.subscription.plan);
    state.user.plan = state.subscription.plan;
    state.user.credits = state.subscription.credits;
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
  if (event.type === "customer.subscription.deleted") {
    state.subscription.status = "cancelled";
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
  if (event.type === "invoice.payment_succeeded") {
    state.billing.invoices.unshift({
      id: object.number || object.id || requestId("invoice"),
      amount: object.amount_paid ? `$${(object.amount_paid / 100).toFixed(2)}` : "$0.00",
      status: "paid",
      date: new Date((object.created || Date.now() / 1000) * 1000).toISOString().slice(0, 10)
    });
    state.billing.invoices = state.billing.invoices.slice(0, 20);
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
      throw new Error(text || `${response.status} ${response.statusText}`);
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
      throw new Error(message);
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
      throw new Error(message);
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
  if (hasEnvValue("GEMINI_IMAGE_API_URL")) return process.env.GEMINI_IMAGE_API_URL;
  const baseUrl = (process.env.GEMINI_API_URL || "https://generativelanguage.googleapis.com/v1").replace(/\/$/, "");
  const model = process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image";
  return `${baseUrl}/models/${model}:generateContent`;
}

function extractGeminiImageResult(data = {}) {
  const candidates = Array.isArray(data.candidates) ? data.candidates : [];
  const parts = candidates.flatMap((candidate) => candidate.content?.parts || []);
  const imagePart = parts.find((part) => part.inlineData?.data || part.inline_data?.data);
  const inlineData = imagePart?.inlineData || imagePart?.inline_data || null;
  const textPart = parts.find((part) => part.text)?.text || data.promptFeedback?.blockReasonMessage || "";
  return {
    previewUrl: inlineData?.data ? `data:${inlineData.mimeType || inlineData.mime_type || "image/png"};base64,${inlineData.data}` : null,
    responseText: textPart,
    raw: data
  };
}

async function callGeminiImage({ prompt, title }) {
  const data = await postJson(geminiImageEndpoint(), {
    headers: { "x-goog-api-key": process.env.GEMINI_API_KEY },
    body: {
      contents: [
        {
          parts: [
            {
              text: prompt || title || "Create a cinematic futuristic garage studio image for Sweet Little Trauma."
            }
          ]
        }
      ],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        responseFormat: {
          image: {
            aspectRatio: process.env.GEMINI_IMAGE_ASPECT_RATIO || "1:1",
            imageSize: process.env.GEMINI_IMAGE_SIZE || "1K"
          }
        }
      }
    },
    timeoutMs: 90000
  });
  const result = extractGeminiImageResult(data);
  return {
    providerJobId: data.responseId || null,
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

async function callReplicateImage({ prompt, title, providerName }) {
  const data = await postJson(`${replicateBaseUrl()}/predictions`, {
    headers: {
      Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
      Prefer: "wait=60"
    },
    body: {
      version: replicateModelForProvider(providerName),
      input: {
        prompt: prompt || title || "Create a cinematic futuristic garage studio image for Sweet Little Trauma."
      }
    },
    timeoutMs: 90000
  });
  return {
    providerJobId: data.id || null,
    status: data.status || "processing",
    previewUrl: firstUrlFromReplicateOutput(data.output),
    note: data.status === "succeeded" ? "Replicate image completed." : "Replicate image submitted. Poll the provider prediction URL if it is still processing.",
    raw: data
  };
}

function replicateModelEndpoint(model) {
  return `${replicateBaseUrl()}/models/${model}/predictions`;
}

async function callReplicateModel({ model, input, timeoutMs = 120000 }) {
  return postJson(replicateModelEndpoint(model), {
    headers: {
      Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
      Prefer: "wait=60"
    },
    body: { input },
    timeoutMs
  });
}

async function callReplicateWanVideo({ prompt, title, payload = {} }) {
  const data = await callReplicateModel({
    model: process.env.WAN_REPLICATE_MODEL || "wavespeedai/wan-2.1-t2v-480p",
    input: {
      prompt: prompt || title || "Sweet Little Trauma Studio cinematic video.",
      aspect_ratio: process.env.WAN_ASPECT_RATIO || "16:9",
      duration: videoClipDuration(payload, "Wan", 5),
      fast_mode: process.env.WAN_FAST_MODE || "Balanced",
      sample_steps: Number(process.env.WAN_SAMPLE_STEPS || 30),
      sample_guide_scale: Number(process.env.WAN_GUIDANCE_SCALE || 5),
      negative_prompt: process.env.WAN_NEGATIVE_PROMPT || ""
    },
    timeoutMs: 180000
  });
  return {
    providerJobId: data.id || null,
    status: data.status || "processing",
    previewUrl: firstUrlFromReplicateOutput(data.output),
    note: data.status === "succeeded" ? "Wan video completed on Replicate." : "Wan video submitted on Replicate.",
    raw: data
  };
}

async function callReplicateMusicGen({ prompt, title }) {
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
    timeoutMs: 180000
  });
  return {
    providerJobId: data.id || null,
    status: data.status || "processing",
    previewUrl: firstUrlFromReplicateOutput(data.output),
    note: data.status === "succeeded" ? "AudioCraft / MusicGen completed on Replicate." : "AudioCraft / MusicGen submitted on Replicate.",
    raw: data
  };
}

async function callReplicateRiffusion({ prompt, title }) {
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
    timeoutMs: 180000
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

async function callStabilityAudio({ prompt, title }) {
  const apiKey = process.env.STABILITY_AUDIO_API_KEY || process.env.STABLE_AUDIO_API_KEY || process.env.STABILITY_API_KEY;
  const outputFormat = process.env.STABILITY_AUDIO_FORMAT || process.env.STABLE_AUDIO_FORMAT || "mp3";
  const audio = await postFormBinary(stabilityAudioEndpoint(), {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: `audio/${outputFormat}`
    },
    fields: {
      prompt: prompt || title || "A cinematic futuristic garage studio theme for Sweet Little Trauma.",
      duration: process.env.STABILITY_AUDIO_DURATION || process.env.STABLE_AUDIO_DURATION || 30,
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
      model_id: process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2"
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

function normalizeSeedanceStatus(data = {}) {
  const rawStatus = String(
    data.status ||
    data.data?.status ||
    data.result?.status ||
    data.task_status ||
    ""
  ).toLowerCase();
  if (["succeeded", "success", "completed", "complete", "done"].includes(rawStatus)) return "completed";
  if (["failed", "error", "cancelled", "canceled"].includes(rawStatus)) return "failed";
  return "processing";
}

function extractSeedanceOutputUrls(data = {}) {
  const directUrls = [
    data.video_url,
    data.videoUrl,
    data.output_url,
    data.outputUrl,
    data.url,
    data.data?.video_url,
    data.data?.videoUrl,
    data.data?.output_url,
    data.data?.outputUrl,
    data.result?.video_url,
    data.result?.videoUrl,
    data.result?.output_url,
    data.result?.outputUrl
  ].filter(Boolean);
  const nestedUrls = [
    ...(Array.isArray(data.output) ? data.output : []),
    ...(Array.isArray(data.outputs) ? data.outputs : []),
    ...(Array.isArray(data.data?.output) ? data.data.output : []),
    ...(Array.isArray(data.data?.outputs) ? data.data.outputs : []),
    ...(Array.isArray(data.result?.output) ? data.result.output : []),
    ...(Array.isArray(data.result?.outputs) ? data.result.outputs : [])
  ]
    .flatMap((item) => [item?.video_url, item?.videoUrl, item?.url, item?.output_url, item?.outputUrl])
    .filter(Boolean);
  return [...directUrls, ...nestedUrls];
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

async function callSeedanceVideo({ prompt, title, payload = {} }) {
  const apiKey = providerApiKey(providerCatalog.Seedance);
  const baseUrl = seedanceBaseUrl();
  const model = process.env.SEEDANCE_MODEL_ID || "dreamina-seedance-2-0-pro-250528";
  const data = await postJson(`${baseUrl}/contents/generations/tasks`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    body: {
      model,
      content: [
        {
          type: "text",
          text: prompt || title || "Create a cinematic black neon studio video shot."
        }
      ],
      ratio: process.env.SEEDANCE_RATIO || "16:9",
      duration: videoClipDuration(payload, "Seedance", Number(process.env.SEEDANCE_DURATION || 5)),
      resolution: process.env.SEEDANCE_RESOLUTION || "720p"
    },
    timeoutMs: 90000
  });
  const providerJobId = extractProviderJobId(data);
  return {
    providerJobId,
    status: "processing",
    previewUrl: null,
    note: providerJobId
      ? "Seedance task submitted. Poll /api/jobs/:jobId?provider=Seedance to retrieve the video."
      : "Seedance task submitted. The provider did not return a recognizable job id.",
    raw: data
  };
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
  const model = process.env.VEO_MODEL_ID || "veo-3.1-generate-preview";
  const data = await postJson(`${veoBaseUrl()}/models/${model}:predictLongRunning`, {
    headers: { "x-goog-api-key": process.env.GEMINI_API_KEY },
    body: {
      instances: [
        {
          prompt: prompt || title || "Create a cinematic futuristic garage studio video shot."
        }
      ],
      parameters: {
        aspectRatio: process.env.VEO_ASPECT_RATIO || "16:9",
        durationSeconds: videoClipDuration(payload, "Veo", Number(process.env.VEO_DURATION || 8))
      }
    },
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
    raw: data
  };
}

function runwayBaseUrl() {
  return (process.env.RUNWAY_API_URL || "https://api.dev.runwayml.com/v1").replace(/\/$/, "");
}

async function callRunwayVideo({ prompt, title, payload = {} }) {
  const data = await postJson(`${runwayBaseUrl()}/text_to_video`, {
    headers: {
      Authorization: `Bearer ${process.env.RUNWAY_API_KEY}`,
      "X-Runway-Version": process.env.RUNWAY_API_VERSION || "2024-11-06"
    },
    body: {
      model: process.env.RUNWAY_MODEL_ID || "gen4.5",
      promptText: prompt || title || "Create a cinematic futuristic garage studio video shot.",
      ratio: process.env.RUNWAY_RATIO || "1280:720",
      duration: videoClipDuration(payload, "Runway", Number(process.env.RUNWAY_DURATION || 5))
    },
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
    raw: data
  };
}

function lumaBaseUrl() {
  return (process.env.LUMA_API_URL || "https://api.lumalabs.ai/dream-machine/v1").replace(/\/$/, "");
}

async function callLumaVideo({ prompt, title, payload = {} }) {
  const data = await postJson(`${lumaBaseUrl()}/generations/video`, {
    headers: { Authorization: `Bearer ${process.env.LUMA_API_KEY}` },
    body: {
      model: process.env.LUMA_MODEL_ID || "ray-2",
      prompt: prompt || title || "Create a cinematic futuristic garage studio video shot.",
      aspect_ratio: process.env.LUMA_ASPECT_RATIO || "16:9",
      duration: `${videoClipDuration(payload, "Luma", Number.parseInt(process.env.LUMA_DURATION || "5", 10) || 5)}s`,
      resolution: process.env.LUMA_RESOLUTION || "720p"
    },
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
    raw: data
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
  const data = await postJson(`${klingBaseUrl()}/v1/videos/text2video`, {
    headers: { Authorization: `Bearer ${klingJwt()}` },
    body: {
      model_name: process.env.KLING_MODEL_ID || "kling-v1-6",
      prompt: prompt || title || "Create a cinematic futuristic garage studio video shot.",
      negative_prompt: process.env.KLING_NEGATIVE_PROMPT || "",
      cfg_scale: Number(process.env.KLING_CFG_SCALE || 0.5),
      mode: process.env.KLING_MODE || "std",
      aspect_ratio: process.env.KLING_ASPECT_RATIO || "16:9",
      duration: String(videoClipDuration(payload, "Kling", Number(process.env.KLING_DURATION || 5)))
    },
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
    raw: data
  };
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
      aspect_ratio: process.env.PIXVERSE_ASPECT_RATIO || "16:9",
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

async function callMiniMaxMusic({ prompt, title }) {
  const config = providerCatalog["MiniMax Music"];
  const lyrics = process.env.MINIMAX_MUSIC_LYRICS || `[verse]\n${prompt || title || "Sweet Little Trauma Studio original song."}`;
  const data = await postJson(minimaxEndpoint(config, "/v1/music_generation"), {
    headers: minimaxHeaders(config),
    body: {
      model: process.env.MINIMAX_MUSIC_MODEL || "music-2.6-free",
      prompt: prompt || title || "cinematic alternative pop, emotional, futuristic garage studio",
      lyrics,
      audio_setting: {
        sample_rate: Number(process.env.MINIMAX_MUSIC_SAMPLE_RATE || 44100),
        bitrate: Number(process.env.MINIMAX_MUSIC_BITRATE || 256000),
        format: process.env.MINIMAX_AUDIO_FORMAT || "mp3"
      }
    },
    timeoutMs: 90000
  });
  return {
    status: data.data?.status === 2 ? "complete" : "processing",
    audioHexPresent: Boolean(data.data?.audio),
    note: data.data?.audio
      ? "MiniMax Music returned audio data."
      : "MiniMax Music request submitted.",
    raw: data
  };
}

async function callMiniMaxSpeech({ prompt, title }) {
  const config = providerCatalog["MiniMax Speech"];
  const data = await postJson(minimaxEndpoint(config, "/v1/t2a_v2"), {
    headers: minimaxHeaders(config),
    body: {
      model: process.env.MINIMAX_SPEECH_MODEL || "speech-2.8-turbo",
      text: prompt || title || "Sweet Little Trauma Studio voice preview.",
      stream: false,
      voice_setting: {
        voice_id: process.env.MINIMAX_SPEECH_VOICE_ID || "male-qn-qingse",
        speed: Number(process.env.MINIMAX_SPEECH_SPEED || 1),
        vol: Number(process.env.MINIMAX_SPEECH_VOLUME || 1),
        pitch: Number(process.env.MINIMAX_SPEECH_PITCH || 0)
      },
      audio_setting: {
        sample_rate: Number(process.env.MINIMAX_SPEECH_SAMPLE_RATE || 32000),
        bitrate: Number(process.env.MINIMAX_SPEECH_BITRATE || 128000),
        format: process.env.MINIMAX_AUDIO_FORMAT || "mp3"
      }
    },
    timeoutMs: 90000
  });
  return {
    status: data.data?.status === 2 ? "complete" : "processing",
    audioHexPresent: Boolean(data.data?.audio),
    note: data.data?.audio
      ? "MiniMax Speech returned audio data."
      : "MiniMax Speech request submitted.",
    raw: data
  };
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

async function callGenericEndpoint({ providerStatus: status, prompt, title, kind, providerName }) {
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
      provider: providerName
    }
  });
}

async function attemptProviderCall({ kind, providerStatus: status, prompt, title, providerName, payload = {} }) {
  if (!status.connected) {
    const error = new Error(status.message || providerFallbackMessage);
    error.code = status.status || "provider_not_connected";
    throw error;
  }
  if (status.adapter === "openai-image") return callOpenAIImage({ prompt, title });
  if (status.adapter === "xai-image") return callXAIImage({ prompt, title });
  if (status.adapter === "gemini-image") return callGeminiImage({ prompt, title });
  if (status.adapter === "replicate-image") return callReplicateImage({ prompt, title, providerName });
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
  if (status.adapter === "kling-video") return callKlingVideo({ prompt, title, payload });
  if (status.adapter === "pixverse-video") return callPixVerseVideo({ prompt, title, payload });
  if (status.adapter === "replicate-wan-video") return callReplicateWanVideo({ prompt, title, payload });
  if (status.adapter === "heygen-video-agent") return callHeyGenVideoAgent({ prompt, title });
  if (status.adapter === "did-talk") return callDIDTalk({ prompt, title });
  if (status.adapter === "minimax-video") return callMiniMaxVideo({ prompt, title, payload });
  if (status.adapter === "minimax-music") return callMiniMaxMusic({ prompt, title });
  if (status.adapter === "replicate-musicgen") return callReplicateMusicGen({ prompt, title });
  if (status.adapter === "replicate-riffusion") return callReplicateRiffusion({ prompt, title });
  if (status.adapter === "minimax-speech") return callMiniMaxSpeech({ prompt, title });
  if (status.adapter === "slt-composer") return callSLTComposer({ prompt, title, payload });
  if (status.adapter === "moises-audio") return callMoisesAudio({ prompt, title, payload });
  if (status.adapter === "stability-audio") return callStabilityAudio({ prompt, title });
  if (status.adapter === "generic-endpoint") {
    return callGenericEndpoint({ providerStatus: status, prompt, title, kind, providerName });
  }
  return {
    previewUrl: `local-placeholder://${kind}/${Date.now()}`,
    note: "Local placeholder provider completed."
  };
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

function handleGenerate(kind) {
  return async (request, response) => {
    if (failProviderIfRequested(request, response)) return;

    const checks = baseChecks(request, kind);
    if (!checks.plan.ok) {
      const failed = buildFailedEntry({
        kind,
        title: request.body?.title || `${kind} project`,
        providerName: checks.provider.name,
        prompt: request.body?.prompt || request.body?.description || "",
        message: checks.plan.message,
        code: checks.plan.code || "plan_limit"
      });
      saveHistory(failed);
      response.status(checks.plan.statusCode || 403).json({ ok: false, checks, historyItem: failed, error: checks.plan.message, code: checks.plan.code || "plan_limit" });
      return;
    }
    if (!checks.credits.ok) {
      const failed = buildFailedEntry({
        kind,
        title: request.body?.title || `${kind} project`,
        providerName: checks.provider.name,
        prompt: request.body?.prompt || request.body?.description || "",
        message: checks.credits.readableError,
        code: "insufficient_credits"
      });
      saveHistory(failed);
      response.status(402).json({ ok: false, checks, historyItem: failed, error: checks.credits.readableError, code: "insufficient_credits" });
      return;
    }

    const prompt = request.body?.prompt || request.body?.description || "";
    const title = request.body?.title || `${kind} project`;
    const providerName = checks.provider.name;
    try {
      let payload = request.body || {};
      let videoPlan = null;
      if (kind === "video") {
        videoPlan = resolveVideoPlan({ payload, auth: checks.auth, providerName });
        payload = { ...payload, videoPlan };
      }
      const providerResult = kind === "video" && videoPlan?.mode === "timeline"
        ? buildLongVideoTimeline({ prompt, title, providerName, plan: videoPlan })
        : await attemptProviderCall({
          kind,
          providerStatus: checks.provider,
          prompt,
          title,
          providerName,
          payload
        });
      const entry = {
        id: requestId(kind),
        kind,
        title,
        provider: providerName,
        prompt,
        status: "completed",
        message: `${kind} generation completed with ${providerName}.`,
        creditsUsed: checks.credits.cost,
        result: {
          ...providerResult,
          exportFormats: exportFormatsFor(kind)
        },
        createdAt: new Date().toISOString()
      };
      state.subscription.credits = checks.credits.remaining;
      incrementUsage({ kind, request, auth: checks.auth });
      saveHistory(entry);
      const project = saveProjectFromEntry(entry);

      response.json({
        ok: true,
        checks,
        project,
        historyItem: entry,
        emptyState: emptyStateFor(kind),
        success: successFor(kind),
        errorFallback: errorFallbackFor(kind)
      });
    } catch (error) {
      const code = error.code || "provider_error";
      const readableError = code === "provider_not_connected" ? providerFallbackMessage : readableProviderError(error, providerName);
      const failedEntry = buildFailedEntry({
        kind,
        title,
        providerName,
        prompt,
        message: readableError,
        code
      });
      saveHistory(failedEntry);
      const statusCode = code === "provider_not_connected"
        ? 400
        : ["owner_long_video_required", "video_duration_limit", "ceo_video_duration_limit"].includes(code)
        ? 403
        : 502;
      response.status(statusCode).json({
        ok: false,
        checks,
        historyItem: failedEntry,
        code,
        warning: readableError,
        error: readableError,
        readableError,
        providerError: error.message || "",
        emptyState: emptyStateFor(kind),
        errorFallback: errorFallbackFor(kind)
      });
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
  response.json({
    ok: true,
    service: "slt-api-proxy-example",
    mode: "functional-provider-proxy",
    port,
    envFiles: loadedEnvFiles,
    providersConnected: providers.filter((provider) => provider.connected).length,
    providersTotal: providers.length
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

app.post("/api/generate/image", handleGenerate("image"));
app.post("/api/generate/video", handleGenerate("video"));
app.post("/api/generate/music", handleGenerate("music"));
app.post("/api/generate/sound", handleGenerate("sound"));

app.get("/api/jobs/:jobId", async (request, response) => {
  const providerName = normalizeProviderName(String(request.query.provider || "Seedance"));
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

app.post("/api/login", (request, response) => {
  const email = String(request.body?.email || "").trim();
  const username = String(request.body?.username || "").trim();
  const password = String(request.body?.password || "");
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

app.post("/api/assist", async (request, response) => {
  if (failProviderIfRequested(request, response)) return;
  const checks = baseChecks(request, "assist");
  const auth = getAuth(request);
  const prompt = request.body?.prompt || "What would you like to create today?";
  const title = request.body?.title || "Virtual Assist";

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
    try {
      const providerResult = await callOpenRouterHermes({ prompt, title });
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
        result: providerResult,
        createdAt: new Date().toISOString()
      };
      state.subscription.credits = checks.credits.remaining;
      saveHistory(entry);
      response.json({ ok: true, auth, historyItem: entry, success: "CEO Hermes response ready." });
    } catch (error) {
      const readableError = readableProviderError(error, "OpenRouter Hermes");
      const failedEntry = buildFailedEntry({
        kind: "assist",
        title,
        providerName: "OpenRouter Hermes",
        prompt,
        message: readableError,
        code: "ceo_mode_error"
      });
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

  try {
    const providerResult = await attemptProviderCall({
      kind: "assist",
      providerStatus: checks.provider,
      prompt,
      title,
      providerName: checks.provider.name
    });
    const entry = {
      id: requestId("assist"),
      kind: "assist",
      title,
      provider: checks.provider.name,
      prompt,
      status: "completed",
      message: "Assistant response ready.",
      response: providerResult.responseText || "I can help you plan, improve or control Image, Video, Sound FX, Music, Fashion and Engineering projects.",
      creditsUsed: checks.credits.cost,
      result: providerResult,
      createdAt: new Date().toISOString()
    };
    state.subscription.credits = checks.credits.remaining;
    saveHistory(entry);
    response.json({ ok: true, checks, historyItem: entry, success: "Assistant response ready." });
  } catch (error) {
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
      errorFallback: errorFallbackFor("assist")
    });
  }
});

app.get("/api/projects", (request, response) => {
  response.json({ ok: true, auth: getAuth(request), projects: state.projects, emptyState: "No Projects" });
});

app.post("/api/projects", (request, response) => {
  const project = {
    id: requestId("project"),
    title: request.body?.title || "Untitled project",
    kind: request.body?.kind || "studio",
    status: "saved",
    thumbnail: request.body?.thumbnail || "local-placeholder://project-thumbnail",
    versions: [{ id: requestId("version"), label: "Autosave", createdAt: new Date().toISOString() }],
    exports: request.body?.exports || [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  state.projects.unshift(project);
  saveHistory({
    id: requestId("history"),
    kind: project.kind,
    title: project.title,
    provider: "project storage mock",
    status: "mock",
    message: `${mockModeMessage} Project saved in local/mock storage.`,
    createdAt: project.createdAt
  });
  response.json({ ok: true, auth: getAuth(request), project, mock: true, message: `${mockModeMessage} Project saved in local/mock storage.` });
});

app.get("/api/history", (request, response) => {
  response.json({ ok: true, auth: getAuth(request), history: state.history, emptyState: "No History" });
});

app.post("/api/history", (request, response) => {
  const item = {
    id: requestId("history"),
    kind: request.body?.kind || "activity",
    title: request.body?.title || "Activity",
    provider: request.body?.provider || "frontend mock",
    status: request.body?.status || "saved",
    createdAt: new Date().toISOString()
  };
  saveHistory(item);
  response.json({ ok: true, auth: getAuth(request), historyItem: item, message: "History saved." });
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
  response.json({
    ok: true,
    auth: getAuth(request),
    balance: state.subscription.credits,
    packs: stripeCreditPackStatus()
  });
});

app.post("/api/stripe/checkout", async (request, response) => {
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
    const session = await stripeRequest("/v1/checkout/sessions", {
      mode: "subscription",
      success_url: stripeReturnUrl("success"),
      cancel_url: stripeReturnUrl("cancel"),
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      billing_address_collection: "auto",
      automatic_tax: { enabled: stripeAutomaticTaxEnabled() },
      customer: customer || undefined,
      customer_email: customer ? undefined : email,
      metadata: {
        plan,
        interval,
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
});

app.post("/api/stripe/credits/checkout", async (request, response) => {
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
    const session = await stripeRequest("/v1/checkout/sessions", {
      mode: "payment",
      success_url: stripeReturnUrl("success"),
      cancel_url: stripeReturnUrl("cancel"),
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      billing_address_collection: "auto",
      automatic_tax: { enabled: stripeAutomaticTaxEnabled() },
      customer: customer || undefined,
      customer_email: customer ? undefined : email,
      metadata: {
        type: "credit_pack",
        creditPackId: pack.id,
        credits: pack.credits,
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
});

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
    actions: ["checkout", "upgrade", "downgrade", "cancel", "reactivation", "invoices", "payment methods", "coupon codes", "failed payments"]
  });
});

app.post("/api/billing", (request, response) => {
  state.billing.paymentMethod = request.body?.paymentMethod || state.billing.paymentMethod;
  state.billing.coupon = request.body?.coupon || state.billing.coupon;
  response.json({ ok: true, auth: getAuth(request), billing: state.billing, message: "Payment method saved." });
});

app.get("/api/subscription", (request, response) => {
  response.json({ ok: true, auth: getAuth(request), subscription: state.subscription });
});

app.post("/api/subscription", (request, response) => {
  const action = request.body?.action || "status";
  const nextPlan = request.body?.plan || state.subscription.plan;
  if (["upgrade", "downgrade", "reactivate"].includes(action)) {
    state.subscription.plan = nextPlan;
    state.subscription.status = "active";
    state.subscription.credits = creditsForPlan(nextPlan);
    state.user.plan = nextPlan;
    state.user.credits = state.subscription.credits;
  }
  if (action === "cancel") {
    state.subscription.status = "cancelled";
    state.subscription.cancellationReason = request.body?.reason || "";
  }
  response.json({
    ok: true,
    auth: getAuth(request),
    subscription: state.subscription,
    message: action === "cancel" ? "Your subscription has been cancelled successfully." : "Subscription updated successfully."
  });
});

app.get("/api/user", (request, response) => {
  response.json({ ok: true, auth: getAuth(request), user: state.user });
});

app.post("/api/user", (request, response) => {
  state.user = {
    ...state.user,
    ...request.body,
    preferences: {
      ...state.user.preferences,
      ...(request.body?.preferences || {})
    }
  };
  response.json({ ok: true, auth: getAuth(request), user: state.user, message: "Profile saved." });
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

app.listen(port, () => {
  console.log(`SLT Studio running on http://127.0.0.1:${port} (API + React dist)`);
});
