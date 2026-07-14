import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

function sanitizeEnvValue(value = "") {
  return String(value)
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .replace(/\s+folder\s*$/i, "")
    .trim();
}

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return false;
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    const value = sanitizeEnvValue(line.slice(separator + 1));
    if (key) process.env[key] ||= value;
  }
  return true;
}

[
  resolve(root, ".env"),
  resolve(root, ".env.local"),
  process.env.SLT_ENV_DIR ? resolve(process.env.SLT_ENV_DIR, ".env") : null,
  "/Users/sweetlittletrauma/Desktop/Sweet Little Trauma Produccion/PROYECTO_COMPLETO/.env"
].filter(Boolean).forEach(loadEnvFile);

const apiBase = (process.env.SLT_VERIFY_API_BASE || "http://127.0.0.1:3000").replace(/\/$/, "");
const gate = process.env.SLT_SITE_GATE_KEY || process.env.VITE_SITE_GATE_KEY || "Dientito2032";

const providerChecks = [
  { name: "OpenAI", keys: ["OPENAI_API_KEY"], models: [{ env: "OPENAI_TEXT_MODEL", ok: ["gpt-4.1-mini", "gpt-4o-mini"] }] },
  { name: "xAI", keys: ["XAI_API_KEY"], models: [{ env: "XAI_IMAGE_MODEL" }] },
  { name: "Gemini", keys: ["GEMINI_API_KEY"], models: [{ env: "GEMINI_TEXT_MODEL" }, { env: "GEMINI_IMAGE_MODEL" }] },
  { name: "Seedance", keys: ["SEEDANCE_API_KEY"], models: [{ env: "SEEDANCE_MODEL_ID", ok: ["dreamina-seedance-2-0-260128"], deprecated: ["dreamina-seedance-2-0-pro-250528"] }] },
  { name: "Runway", keys: ["RUNWAY_API_KEY"], models: [{ env: "RUNWAY_MODEL_ID", ok: ["gen4.5", "gen4_turbo"] }] },
  { name: "Luma", keys: ["LUMA_API_KEY"], models: [{ env: "LUMA_MODEL_ID", ok: ["ray-2"] }] },
  { name: "Kling", keys: ["KLING_ACCESS_KEY", "KLING_API_KEY"], extra: ["KLING_SECRET_KEY"], models: [{ env: "KLING_MODEL_ID", ok: ["kling-v1-6", "kling-v3-standard"] }] },
  { name: "Veo", keys: ["VEO_API_KEY", "GEMINI_API_KEY"], models: [{ env: "VEO_MODEL_ID", ok: ["veo-3.1-generate-preview"] }] },
  { name: "MiniMax/Hailuo", keys: ["MINIMAX_API_KEY", "HAILUO_API_KEY"], models: [{ env: "MINIMAX_VIDEO_MODEL" }] },
  { name: "PixVerse", keys: ["PIXVERSE_API_KEY"], models: [{ env: "PIXVERSE_MODEL", ok: ["v4.5"] }] },
  { name: "ElevenLabs", keys: ["ELEVENLABS_API_KEY"], models: [{ env: "ELEVENLABS_MODEL_ID" }] },
  { name: "Replicate", keys: ["REPLICATE_API_TOKEN"] },
  { name: "Stripe", keys: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"] },
  { name: "OmniHuman", keys: ["BYTEPLUS_VISION_AK"], extra: ["BYTEPLUS_VISION_SK"] }
];

function hasValue(key) {
  return Boolean(sanitizeEnvValue(process.env[key] || ""));
}

function reportEnvChecks() {
  const rows = [];
  let warnings = 0;
  let missing = 0;

  for (const provider of providerChecks) {
    const keyOk = provider.keys.some(hasValue);
    const extraOk = (provider.extra || []).every(hasValue);
    const connected = keyOk && extraOk;
    if (!connected) missing += 1;

    const modelNotes = [];
    for (const model of provider.models || []) {
      const value = sanitizeEnvValue(process.env[model.env] || "");
      if (!value) continue;
      if (model.deprecated?.includes(value)) {
        modelNotes.push(`${model.env}=${value} (deprecated → use ${model.ok?.[0] || "latest"})`);
        warnings += 1;
      } else if (model.ok && !model.ok.includes(value)) {
        modelNotes.push(`${model.env}=${value} (verify in provider console)`);
        warnings += 1;
      }
    }

    if (provider.name === "Seedance" && hasValue("BYTEPLUS_API_KEY") && /folder/i.test(process.env.BYTEPLUS_API_KEY || "")) {
      modelNotes.push("BYTEPLUS_API_KEY has trailing garbage — will be auto-trimmed on API start");
      warnings += 1;
    }

    rows.push({
      provider: provider.name,
      connected,
      modelNotes
    });
  }

  return { rows, warnings, missing };
}

async function reportLiveApi() {
  try {
    const health = await fetch(`${apiBase}/health`, {
      headers: { "x-slt-site-gate": gate }
    });
    if (!health.ok) return { online: false, providers: [] };

    const providers = await fetch(`${apiBase}/api/providers`, {
      headers: { "x-slt-site-gate": gate }
    });
    const data = await providers.json().catch(() => ({}));
    return {
      online: true,
      connected: (data.providers || []).filter((item) => item.connected).length,
      total: (data.providers || []).length,
      video: (data.providers || []).filter((item) => item.kind === "video").map((item) => ({
        name: item.name,
        connected: item.connected,
        status: item.status
      }))
    };
  } catch {
    return { online: false, providers: [] };
  }
}

const envReport = reportEnvChecks();
const liveReport = await reportLiveApi();

console.log("SLT Provider Verification");
console.log("=========================");
console.log(`API: ${liveReport.online ? `${apiBase} online (${liveReport.connected}/${liveReport.total} connected)` : `${apiBase} offline — run npm start`}`);
console.log("");

for (const row of envReport.rows) {
  const status = row.connected ? "OK" : "MISSING";
  console.log(`[${status}] ${row.provider}`);
  for (const note of row.modelNotes) console.log(`       ! ${note}`);
}

console.log("");
console.log(`Env summary: ${envReport.rows.filter((row) => row.connected).length}/${envReport.rows.length} providers configured, ${envReport.warnings} warning(s), ${envReport.missing} missing key(s).`);

if (liveReport.online && liveReport.video?.length) {
  console.log("");
  console.log("Video providers (live API):");
  for (const item of liveReport.video) {
    console.log(`  - ${item.name}: ${item.connected ? "connected" : item.status}`);
  }
}

if (envReport.warnings > 0 || envReport.missing > 0) {
  process.exitCode = 1;
}
