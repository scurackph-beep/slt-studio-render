// Sweet Little Trauma Studio — generación: adaptadores de proveedor y gateway.
//
// Extraído de server/api-proxy.js sin modificar los cuerpos de las funciones.
// Contiene los 36 adaptadores concretos (callRunwayVideo, callSeedanceVideo,
// callElevenLabsTTS, …), sus helpers de firma y endpoint, el despachador
// attemptProviderCall y la cadena de fallback runProviderGateway.
//
// Recibe estado y helpers compartidos por initGeneration().

import crypto from "node:crypto";
import { createReadStream, existsSync, openAsBlob } from "node:fs";
import { readFile, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// Del ledger se importa directo, sin inyección: credits.js no importa este
// módulo, así que no hay ciclo.
import {
  ledgerSnapshot,
  reserveCreditsTransactional,
  resolveReservationTransactional
} from "./credits.js";

let assetStorageDir;
let baseChecks;
let billableOutputCount;
let buildFailedEntry;
let buildQueuedHistoryEntry;
let collectUrlCandidates;
let createGenerationBatch;
let createGenerationProject;
let createGenerationSession;
let createJob;
let creditCostFor;
let defaultProvider;
let downloadUrlToFile;
let emptyStateFor;
let enqueueAsyncGeneration;
let envFlag;
let envNumber;
let errorFallbackFor;
let exportFormatsFor;
let extensionFromContentType;
let extractChatText;
let extractOpenAIText;
let failProviderIfRequested;
let findJob;
let firstReferenceAssetId;
let generationAction;
let generationIdempotencyKey;
let getJson;
let hasEnvValue;
let incidentHttpStatus;
let incrementUsage;
let isProviderFallbackError;
let isRealityTransformPayload;
let isRetryableProviderModelError;
let moderationFailurePayload;
let normalizeMultimodalOperation;
let normalizeProviderName;
let parseDataUrl;
let postBinary;
let postFormBinary;
let postFormJson;
let postJson;
let prepareGenerationPayload;
let providerApiKey;
let providerCatalog;
let providerDiagnosticKey;
let providerEndpoint;
let providerFallbackChain;
let providerFallbackMessage;
let providerFallbacksEnabled;
let providerMaxClipSeconds;
let providerModelConfig;
let providerPricingFor;
let providerRoutingError;
let providerStatus;
let readableProviderError;
let recomputeGenerationBatch;
let recordSltFailure;
let requestId;
let requestIdentity;
let resolveVideoPlan;
let routeMultimodalModel;
let runInputModeration;
let safeUploadName;
let sanitizeEnvValue;
let saveHistory;
let saveProjectFromEntry;
let serializeGenerationBatch;
let serializeJob;
let setProviderDiagnostic;
let shouldForceProviderFailure;
let shouldQueueGeneration;
let simulatedProviderFailure;
let sltErrorResponsePayload;
let state;
let successFor;
let temporaryUploadPath;
let uniqueEnvModels;
let updateJob;
let videoAspectRatio;
let videoClipDuration;
let webhookProviderForStatus;
let webhookUrlForJob;

export function initGeneration(context) {
  ({
    assetStorageDir,
    baseChecks,
    billableOutputCount,
    buildFailedEntry,
    buildQueuedHistoryEntry,
    collectUrlCandidates,
    createGenerationBatch,
    createGenerationProject,
    createGenerationSession,
    createJob,
    creditCostFor,
    defaultProvider,
    downloadUrlToFile,
    emptyStateFor,
    enqueueAsyncGeneration,
    envFlag,
    envNumber,
    errorFallbackFor,
    exportFormatsFor,
    extensionFromContentType,
    extractChatText,
    extractOpenAIText,
    failProviderIfRequested,
    findJob,
    firstReferenceAssetId,
    generationAction,
    generationIdempotencyKey,
    getJson,
    hasEnvValue,
    incidentHttpStatus,
    incrementUsage,
    isProviderFallbackError,
    isRealityTransformPayload,
    isRetryableProviderModelError,
    moderationFailurePayload,
    normalizeMultimodalOperation,
    normalizeProviderName,
    parseDataUrl,
    postBinary,
    postFormBinary,
    postFormJson,
    postJson,
    prepareGenerationPayload,
    providerApiKey,
    providerCatalog,
    providerDiagnosticKey,
    providerEndpoint,
    providerFallbackChain,
    providerFallbackMessage,
    providerFallbacksEnabled,
    providerMaxClipSeconds,
    providerModelConfig,
    providerPricingFor,
    providerRoutingError,
    providerStatus,
    readableProviderError,
    recomputeGenerationBatch,
    recordSltFailure,
    requestId,
    requestIdentity,
    resolveVideoPlan,
    routeMultimodalModel,
    runInputModeration,
    safeUploadName,
    sanitizeEnvValue,
    saveHistory,
    saveProjectFromEntry,
    serializeGenerationBatch,
    serializeJob,
    setProviderDiagnostic,
    shouldForceProviderFailure,
    shouldQueueGeneration,
    simulatedProviderFailure,
    sltErrorResponsePayload,
    state,
    successFor,
    temporaryUploadPath,
    uniqueEnvModels,
    updateJob,
    videoAspectRatio,
    videoClipDuration,
    webhookProviderForStatus,
    webhookUrlForJob
  } = context);
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

// Las rutas se registran desde api-proxy para conservar el orden original
// de los middlewares y del resto de las rutas de Express.
export function registerGenerationRoutes(app) {
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
}

export {
  handleGenerate,
  buildLongVideoTimeline,
  callOpenRouterHermes,
  extractProviderFailureMessage,
  extractSeedanceOutputUrls,
  fileForInputAsset,
  firstUrlFromReplicateOutput,
  getOmniHumanJob,
  isInternalStudioJobId,
  miniMaxAudioResult,
  mutableCodedError,
  normalizeSeedanceStatus,
  parseEmbeddedJson,
  prepareSeedanceProviderPayload,
  replicateBaseUrl,
  requestedAudioDuration,
  runProviderGateway,
  runwayBaseUrl,
  runwayHeaders,
  seedanceBaseUrl
};
