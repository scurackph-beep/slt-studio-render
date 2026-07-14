const TRUE_VALUES = new Set(["1", "true", "yes", "on", "production"]);

function envValue(env, key) {
  return String(env[key] || "").trim();
}

function hasValue(env, key) {
  return Boolean(envValue(env, key));
}

function isTruthy(env, key) {
  return TRUE_VALUES.has(envValue(env, key).toLowerCase());
}

function configuredOrMissing(env, keys = []) {
  return keys.map((key) => ({ key, configured: hasValue(env, key) }));
}

function firstConfigured(env, keys = []) {
  return keys.find((key) => hasValue(env, key)) || "";
}

export function getProductionReadinessReport(env = process.env) {
  const nodeEnv = envValue(env, "NODE_ENV") || "development";
  const requireProduction =
    nodeEnv === "production" ||
    isTruthy(env, "SLT_REQUIRE_PRODUCTION_INFRASTRUCTURE");

  const database = {
    ok: hasValue(env, "DATABASE_URL"),
    provider: hasValue(env, "DATABASE_URL") ? "postgres" : "missing",
    required: configuredOrMissing(env, ["DATABASE_URL"])
  };

  const authProvider = envValue(env, "AUTH_PROVIDER") || "local";
  const authSecretKey = firstConfigured(env, ["SUPABASE_JWT_SECRET", "AUTH_SECRET", "AUTH_JWT_SECRET", "SESSION_COOKIE_SECRET"]);
  const supabaseAuthReady = authProvider === "supabase"
    ? hasValue(env, "SUPABASE_URL") && hasValue(env, "SUPABASE_ANON_KEY") && hasValue(env, "SUPABASE_SERVICE_ROLE_KEY") && Boolean(authSecretKey)
    : Boolean(authSecretKey);
  const auth = {
    ok: authProvider !== "local" && supabaseAuthReady,
    provider: authProvider,
    required: configuredOrMissing(env, [
      "AUTH_PROVIDER",
      "SUPABASE_URL",
      "SUPABASE_ANON_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "SUPABASE_JWT_SECRET",
      "AUTH_SECRET",
      "AUTH_JWT_SECRET",
      "SESSION_COOKIE_SECRET"
    ])
  };

  const storageProvider = envValue(env, "STORAGE_PROVIDER") || "local";
  const storageKey = firstConfigured(env, ["STORAGE_ACCESS_KEY", "STORAGE_ACCESS_KEY_ID"]);
  const storageSecret = firstConfigured(env, ["STORAGE_SECRET_KEY", "STORAGE_SECRET_ACCESS_KEY"]);
  const supabaseStorageReady = storageProvider === "supabase"
    ? hasValue(env, "SUPABASE_URL") && hasValue(env, "SUPABASE_SERVICE_ROLE_KEY") && hasValue(env, "STORAGE_BUCKET")
    : Boolean(storageKey) && Boolean(storageSecret);
  const storage = {
    ok:
      storageProvider !== "local" &&
      hasValue(env, "STORAGE_BUCKET") &&
      (hasValue(env, "STORAGE_PUBLIC_BASE_URL") || storageProvider === "supabase") &&
      supabaseStorageReady,
    provider: storageProvider,
    required: configuredOrMissing(env, [
      "STORAGE_PROVIDER",
      "STORAGE_BUCKET",
      "STORAGE_PUBLIC_BASE_URL",
      "STORAGE_ENDPOINT",
      "STORAGE_REGION",
      "STORAGE_ACCESS_KEY",
      "STORAGE_ACCESS_KEY_ID",
      "STORAGE_SECRET_KEY",
      "STORAGE_SECRET_ACCESS_KEY",
      "SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY"
    ])
  };

  const webhook = {
    ok: hasValue(env, "WEBHOOK_BASE_URL") || hasValue(env, "PUBLIC_WEBHOOK_BASE_URL"),
    required: configuredOrMissing(env, ["WEBHOOK_BASE_URL", "PUBLIC_WEBHOOK_BASE_URL"])
  };

  const checks = { database, auth, storage, webhook };
  const missing = Object.entries(checks)
    .filter(([, check]) => !check.ok)
    .map(([name]) => name);

  return {
    ok: missing.length === 0,
    mode: requireProduction ? "production-required" : "development-compatible",
    nodeEnv,
    requireProduction,
    checks,
    missing,
    message: missing.length
      ? `Production infrastructure incomplete: ${missing.join(", ")}.`
      : "Production infrastructure variables are present."
  };
}

export function assertProductionInfrastructureReady(env = process.env) {
  const report = getProductionReadinessReport(env);
  if (report.requireProduction && !report.ok && !isTruthy(env, "SLT_ALLOW_UNSAFE_PRODUCTION")) {
    const error = new Error(report.message);
    error.code = "production_infrastructure_incomplete";
    error.report = report;
    throw error;
  }
  return report;
}
