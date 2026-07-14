import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const sourcePath = resolve(root, ".env.supabase");
const targetPath = resolve(root, ".env");

const REQUIRED = [
  "DATABASE_URL",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_JWT_SECRET"
];

const DEFAULTS = {
  AUTH_PROVIDER: "supabase",
  STORAGE_PROVIDER: "supabase",
  STORAGE_BUCKET: "slt-assets",
  DATABASE_SSL: "true",
  PUBLIC_APP_URL: "http://127.0.0.1:5174"
};

function parseEnv(text) {
  const entries = new Map();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    entries.set(key, value);
  }
  return entries;
}

function serializeEnv(entries, comments = []) {
  const lines = [...comments, ""];
  for (const [key, value] of entries) {
    lines.push(`${key}=${value}`);
  }
  return `${lines.join("\n").trim()}\n`;
}

function upsertKey(entries, key, value) {
  if (value === undefined || value === null || String(value).trim() === "") return;
  entries.set(key, String(value).trim());
}

function loadSourceValues() {
  const values = new Map();
  for (const key of REQUIRED) {
    if (process.env[key]) values.set(key, process.env[key]);
  }
  for (const [key, value] of Object.entries(DEFAULTS)) {
    if (process.env[key]) values.set(key, process.env[key]);
  }
  if (existsSync(sourcePath)) {
    for (const [key, value] of parseEnv(readFileSync(sourcePath, "utf8"))) {
      values.set(key, value);
    }
  }
  return values;
}

const sourceValues = loadSourceValues();
const missing = REQUIRED.filter((key) => !sourceValues.get(key));

if (missing.length) {
  console.error("Missing Supabase configuration:");
  for (const key of missing) console.error(`  - ${key}`);
  console.error("");
  console.error("Create .env.supabase from .env.supabase.example, fill the values, then rerun:");
  console.error("  npm run supabase:configure");
  process.exit(1);
}

const targetEntries = existsSync(targetPath)
  ? parseEnv(readFileSync(targetPath, "utf8"))
  : new Map();

for (const [key, value] of sourceValues) {
  upsertKey(targetEntries, key, value);
}
for (const [key, value] of Object.entries(DEFAULTS)) {
  if (!targetEntries.has(key)) upsertKey(targetEntries, key, value);
}

const header = [
  "# Supabase configuration (merged by scripts/configure-supabase.js)",
  "# Source: .env.supabase or environment variables"
];
writeFileSync(targetPath, serializeEnv(targetEntries, header));
console.log(`Updated ${targetPath}`);

console.log("");
console.log("Next in Supabase Dashboard → Storage:");
console.log("  1. Create a public bucket named: slt-assets");
console.log("  2. Allow authenticated uploads if prompted");
console.log("");

const migrate = spawnSync(process.execPath, ["scripts/migrate-postgres.js"], {
  cwd: root,
  env: { ...process.env, ...Object.fromEntries(targetEntries) },
  stdio: "inherit"
});

if (migrate.status !== 0) {
  console.error("Migration failed. Fix DATABASE_URL / network and rerun: npm run supabase:configure");
  process.exit(migrate.status || 1);
}

const verify = spawnSync(process.execPath, ["scripts/verify-supabase-persistence.js"], {
  cwd: root,
  env: { ...process.env, ...Object.fromEntries(targetEntries) },
  stdio: "inherit"
});

if (verify.status !== 0) {
  console.error("Persistence verification failed.");
  process.exit(verify.status || 1);
}

console.log("");
console.log("Supabase is configured. Restart the API:");
console.log("  npm start");
console.log("Then open Profile → Create account to test signup/login.");
