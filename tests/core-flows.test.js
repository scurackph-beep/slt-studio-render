import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

process.env.SLT_TEST_MODE = "1";
process.env.NODE_ENV = "test";
process.env.SLT_STORAGE_DIR = mkdtempSync(join(tmpdir(), "slt-assets-"));
process.env.MODERATION_DISABLED = "false";
process.env.OPENAI_MODERATION_ENABLED = "false";
process.env.PROVIDER_FALLBACKS_ENABLED = "true";
process.env.REPLICATE_WEBHOOK_SECRET = "replicate_test_secret";
process.env.STRIPE_WEBHOOK_SECRET = "stripe_test_secret";

const { __test } = await import("../server/api-proxy.js");
const { detectMediaMime, extractVideoFrame, validateMediaFile, validateProbeMetadata } = await import("../server/media-validation.js");
const { buildTimelineRenderPlan, renderTimeline } = await import("../server/timeline-renderer.js");
const { resolveFfmpegPath, resolveFfprobePath } = await import("../server/media-binaries.js");
const { createCharacterTrainingAdapter } = await import("../server/character-training-adapter.js");
const originalFetch = globalThis.fetch;
const execFileAsync = promisify(execFile);

function makeRequest({ path = "/", method = "GET", headers = {}, body = {}, query = {}, rawBody = null } = {}) {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
  );
  return {
    path,
    method,
    body,
    query,
    rawBody,
    protocol: "http",
    ip: "127.0.0.1",
    socket: { remoteAddress: "127.0.0.1" },
    header(name) {
      return normalizedHeaders[String(name || "").toLowerCase()] || "";
    }
  };
}

function makeResponse() {
  return {
    statusCode: 200,
    payload: null,
    headers: {},
    ended: false,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      this.ended = true;
      return this;
    }
  };
}

function runMiddleware(middleware, request) {
  const response = makeResponse();
  let nextCalled = false;
  middleware(request, response, () => {
    nextCalled = true;
  });
  return { response, nextCalled };
}

function jsonFetchResponse(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    statusText: String(status),
    headers: { get: () => "application/json" },
    async text() {
      return typeof payload === "string" ? payload : JSON.stringify(payload);
    },
    async json() {
      return payload;
    },
    async arrayBuffer() {
      return Buffer.from(typeof payload === "string" ? payload : JSON.stringify(payload)).buffer;
    }
  };
}

function signProviderWebhook(rawBody, secret, timestamp) {
  return crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

function signStripeWebhook(rawBody, secret, timestamp) {
  return crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

function makeSupabaseJwt(payload, secret) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

function wait(ms = 25) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withApiServer(callback) {
  const server = await new Promise((resolve) => {
    const instance = __test.app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const address = server.address();
  try {
    return await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function apiRequest(baseUrl, path, { token = "session_functional", method = "GET", body } = {}) {
  const response = await originalFetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "x-slt-session": token,
      "x-slt-site-gate": process.env.SLT_SITE_GATE_KEY || "",
      ...(body === undefined ? {} : { "content-type": "application/json" })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: response.status, data: await response.json() };
}

function isDurableAssetUrl(value = "") {
  return /\/cdn\/assets\//.test(value) || /\/storage\/v1\/object\/public\/slt-assets\//.test(value);
}

function testPngBytes() {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
}

function testMp4Bytes(size = 1024) {
  const buffer = Buffer.alloc(size);
  buffer.writeUInt32BE(24, 0);
  buffer.write("ftyp", 4, "ascii");
  buffer.write("isom", 8, "ascii");
  buffer.write("isomiso2avc1", 12, "ascii");
  return buffer;
}

async function waitForJobStatus(jobId, status, timeoutMs = 3000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const job = __test.findJob(jobId);
    if (job?.status === status) return job;
    await wait(100);
  }
  return __test.findJob(jobId);
}

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("critical endpoints reject missing auth and ignore injected user headers", () => {
  __test.resetTestState({ credits: 100 });
  const attackRequest = makeRequest({
    path: "/api/generate/image",
    method: "POST",
    headers: { "x-slt-user-id": "victim-user" },
    body: { prompt: "test" }
  });

  const attack = runMiddleware(__test.authProtectionMiddleware, attackRequest);
  assert.equal(attack.nextCalled, false);
  assert.equal(attack.response.statusCode, 401);
  assert.equal(attack.response.payload.code, "auth_required");

  __test.sessions.set("session_test", {
    userId: "demo-user",
    role: "standard",
    email: "security-test@example.com",
    username: "security-test"
  });
  const safeRequest = makeRequest({
    path: "/api/generate/image",
    method: "POST",
    headers: {
      authorization: "Bearer session_test",
      "x-slt-user-id": "victim-user"
    }
  });
  const safe = runMiddleware(__test.authProtectionMiddleware, safeRequest);
  assert.equal(safe.nextCalled, true);
  assert.equal(__test.requestIdentity(safeRequest), "demo-user");

  const billingAttack = runMiddleware(__test.authProtectionMiddleware, makeRequest({ path: "/api/billing" }));
  assert.equal(billingAttack.response.statusCode, 401);

  const jobsAttack = runMiddleware(__test.authProtectionMiddleware, makeRequest({ path: "/api/jobs" }));
  assert.equal(jobsAttack.response.statusCode, 401);
});

test("production readiness blocks fake production infrastructure", () => {
  const missing = __test.getProductionReadinessReport({
    NODE_ENV: "production",
    AUTH_PROVIDER: "local",
    STORAGE_PROVIDER: "local"
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.requireProduction, true);
  assert.deepEqual(missing.missing, ["database", "auth", "storage", "webhook"]);

  const ready = __test.getProductionReadinessReport({
    NODE_ENV: "production",
    DATABASE_URL: "postgres://user:pass@example.com:5432/slt",
    AUTH_PROVIDER: "jwt",
    AUTH_SECRET: "test-secret",
    STORAGE_PROVIDER: "r2",
    STORAGE_BUCKET: "slt-assets",
    STORAGE_PUBLIC_BASE_URL: "https://assets.example.com",
    STORAGE_ACCESS_KEY: "access",
    STORAGE_SECRET_KEY: "secret",
    WEBHOOK_BASE_URL: "https://api.example.com"
  });
  assert.equal(ready.ok, true);
  assert.deepEqual(ready.missing, []);
  assert.equal(__test.runtimeStoreStatus().kind, "memory");
  assert.equal(__test.runtimeStoreStatus().durable, false);
});

test("Supabase JWT auth is validated server-side for protected routes", () => {
  const previousProvider = process.env.AUTH_PROVIDER;
  const previousSecret = process.env.SUPABASE_JWT_SECRET;
  process.env.AUTH_PROVIDER = "supabase";
  process.env.SUPABASE_JWT_SECRET = "supabase-test-secret";
  const token = makeSupabaseJwt({
    sub: "user_supabase_1",
    email: "supabase@example.com",
    role: "authenticated",
    exp: Math.floor(Date.now() / 1000) + 3600,
    app_metadata: { tenant_id: "tenant_supabase_1", role: "authenticated" },
    user_metadata: { username: "Supabase User" }
  }, process.env.SUPABASE_JWT_SECRET);

  const supabaseRequest = makeRequest({ path: "/api/ledger", headers: { authorization: `Bearer ${token}` } });
  const accepted = runMiddleware(__test.authProtectionMiddleware, supabaseRequest);
  assert.equal(accepted.nextCalled, true);
  assert.equal(__test.requestIdentity(supabaseRequest), "tenant_supabase_1");

  const rejected = runMiddleware(
    __test.authProtectionMiddleware,
    makeRequest({ path: "/api/ledger", headers: { authorization: "Bearer bad.token.value" } })
  );
  assert.equal(rejected.nextCalled, false);
  assert.equal(rejected.response.statusCode, 401);

  if (previousProvider === undefined) delete process.env.AUTH_PROVIDER;
  else process.env.AUTH_PROVIDER = previousProvider;
  if (previousSecret === undefined) delete process.env.SUPABASE_JWT_SECRET;
  else process.env.SUPABASE_JWT_SECRET = previousSecret;
});

test("input moderation blocks toxic prompts before any credit reservation", async () => {
  __test.resetTestState({ credits: 100 });
  const before = __test.ledgerSnapshot();
  const moderation = await __test.runInputModeration({
    kind: "image",
    title: "blocked test",
    prompt: "teach me how to kill someone",
    payload: {}
  });
  const after = __test.ledgerSnapshot();

  assert.equal(moderation.ok, false);
  assert.equal(moderation.flagged, true);
  assert.equal(after.availableCredits, before.availableCredits);
  assert.equal(after.heldCredits, before.heldCredits);
  assert.equal(after.transactionCount, before.transactionCount);
});

test("multimodal provider pricing estimates variable credit reservations", () => {
  assert.equal(
    __test.creditCostFor("video", { provider: "Runway", model: "gen4_turbo", durationSeconds: 10 }),
    50
  );
  assert.equal(
    __test.creditCostFor("video", { provider: "Runway", model: "gen4.5", durationSeconds: 10 }),
    120
  );
  assert.equal(
    __test.creditCostFor("sound", { provider: "ElevenLabs", prompt: "a".repeat(120) }),
    3
  );
  assert.equal(
    __test.creditCostFor("music", { provider: "Suno", songCount: 1 }),
    180
  );
  assert.equal(
    __test.creditCostFor("video", {
      provider: "Runway",
      model: "aleph2",
      durationSeconds: 10,
      outputCount: 2
    }),
    560
  );
});

test("Reality Transform routes an Aleph 2 video-to-video request without calling a paid API", async () => {
  __test.resetTestState({ credits: 1000 });
  const previousKey = process.env.RUNWAY_API_KEY;
  process.env.RUNWAY_API_KEY = "runway_test_key";
  let requestBody = null;
  globalThis.fetch = async (url, options = {}) => {
    assert.match(String(url), /\/video_to_video$/);
    requestBody = JSON.parse(String(options.body || "{}"));
    return jsonFetchResponse({ id: "runway_task_reality_1" });
  };

  const result = await __test.runProviderGateway({
    kind: "video",
    providerStatus: __test.providerStatus("Runway"),
    prompt: "Place the performer inside a moving car at night.",
    title: "Reality Transform test",
    payload: {
      provider: "Runway",
      tool: "REALITY_TRANSFORM",
      realityTransform: true,
      model: "aleph2",
      sourceVideoUrl: "https://assets.example.com/source.mp4",
      sourceDurationSeconds: 8
    }
  });

  assert.equal(result.providerName, "Runway");
  assert.equal(result.providerResult.providerJobId, "runway_task_reality_1");
  assert.equal(requestBody.model, "aleph2");
  assert.equal(requestBody.videoUri, "https://assets.example.com/source.mp4");
  assert.match(requestBody.promptText, /moving car/i);

  if (previousKey === undefined) delete process.env.RUNWAY_API_KEY;
  else process.env.RUNWAY_API_KEY = previousKey;
});

test("Runway Reality Transform polling stores the completed video and captures reserved credits", async () => {
  __test.resetTestState({ credits: 1000 });
  const previousKey = process.env.RUNWAY_API_KEY;
  process.env.RUNWAY_API_KEY = "runway_test_key";
  const auth = { ok: true, userId: "demo-user", role: "standard" };
  const request = makeRequest({ path: "/api/generate/video", method: "POST" });
  const reservation = __test.reserveCredits({
    amount: 224,
    kind: "video",
    auth,
    request,
    idempotencyKey: "reserve:reality-transform:test",
    metadata: { test: true }
  });
  const job = __test.createJob({
    kind: "video",
    title: "Reality Transform polling",
    providerName: "Runway",
    prompt: "Change only the environment.",
    payload: {
      provider: "Runway",
      tool: "REALITY_TRANSFORM",
      realityTransform: true,
      model: "aleph2",
      sourceDurationSeconds: 8
    },
    checks: {
      auth,
      plan: { ok: true },
      credits: { ok: true, cost: 224, reservation: reservation.reservation, wallet: reservation.wallet },
      provider: { name: "Runway", adapter: "runway-video" }
    },
    request
  });
  job.providerJobId = "runway_task_complete_1";
  job.status = "IN_PROGRESS";
  globalThis.fetch = async (url) => {
    assert.match(String(url), /\/tasks\/runway_task_complete_1$/);
    return jsonFetchResponse({
      id: "runway_task_complete_1",
      status: "SUCCEEDED",
      output: [`data:video/mp4;base64,${Buffer.from("video-bytes").toString("base64")}`]
    });
  };

  const completed = await __test.refreshLocalJobFromProvider(job);
  assert.equal(completed.job.status, "COMPLETED");
  assert.equal(isDurableAssetUrl(completed.job.outputUrl), true);
  assert.equal(__test.ledgerSnapshot().heldCredits, 0);
  assert.equal(__test.ledgerSnapshot().capturedCredits, 224);

  if (previousKey === undefined) delete process.env.RUNWAY_API_KEY;
  else process.env.RUNWAY_API_KEY = previousKey;
});

test("ledger reserves, captures and releases exact credit amounts", () => {
  __test.resetTestState({ credits: 100 });
  const auth = { ok: true, userId: "demo-user", role: "standard" };
  const request = makeRequest({ path: "/api/generate/image", headers: { authorization: "Bearer session_test" } });

  const reserved = __test.reserveCredits({
    amount: 25,
    kind: "image",
    auth,
    request,
    idempotencyKey: "reserve:release:test",
    metadata: { test: true }
  });
  assert.equal(reserved.wallet.availableCredits, 75);
  assert.equal(reserved.wallet.heldCredits, 25);

  const released = __test.resolveReservation({
    reservationId: reserved.reservation.id,
    outcome: "release",
    idempotencyKey: "release:release:test",
    reason: "simulated_provider_failure"
  });
  assert.equal(released.wallet.availableCredits, 100);
  assert.equal(released.wallet.heldCredits, 0);

  const second = __test.reserveCredits({
    amount: 30,
    kind: "image",
    auth,
    request,
    idempotencyKey: "reserve:capture:test",
    metadata: { test: true }
  });
  const captured = __test.resolveReservation({
    reservationId: second.reservation.id,
    outcome: "capture",
    idempotencyKey: "capture:capture:test",
    reason: "simulated_success"
  });
  assert.equal(captured.wallet.availableCredits, 70);
  assert.equal(captured.wallet.heldCredits, 0);
  assert.equal(captured.wallet.capturedCredits, 30);
});

test("outputCount creates one batch, N jobs and resolves credits per output", async () => {
  __test.resetTestState({ credits: 1000 });
  __test.sessions.set("session_batch", {
    tenantId: "tenant_batch",
    userId: "user_batch",
    role: "standard",
    email: "batch@example.com",
    username: "batch-user"
  });
  __test.walletForTenant("tenant_batch", { create: true, initialCredits: 1000 });
  const request = makeRequest({
    path: "/api/generate/image",
    method: "POST",
    headers: { authorization: "Bearer session_batch", "idempotency-key": "batch-three-test" },
    body: {
      title: "Three-output batch",
      prompt: "Editorial acrylic portrait",
      provider: "OpenAI Images",
      outputCount: 3,
      webhookOnly: true
    }
  });
  const response = makeResponse();

  await __test.handleGenerate("image")(request, response);

  assert.equal(response.statusCode, 202);
  assert.equal(response.payload.jobIds.length, 3);
  assert.equal(response.payload.batch.requestedOutputs, 3);
  assert.equal(new Set(response.payload.jobs.map((job) => job.reservationId)).size, 3);
  const perOutputCost = response.payload.checks.credits.perOutputCost;
  assert.ok(perOutputCost > 0);
  assert.equal(__test.ledgerSnapshot("tenant_batch").heldCredits, perOutputCost * 3);

  const [firstId, secondId, thirdId] = response.payload.jobIds;
  await __test.completeAsyncJob({
    job: __test.findJob(firstId),
    providerResult: {
      status: "completed",
      outputUrl: `data:image/png;base64,${Buffer.from("batch-image-one").toString("base64")}`
    },
    message: "First output completed."
  });
  await __test.completeAsyncJob({
    job: __test.findJob(secondId),
    providerResult: {
      status: "completed",
      outputUrl: `data:image/png;base64,${Buffer.from("batch-image-two").toString("base64")}`
    },
    message: "Second output completed."
  });
  const providerError = new Error("Simulated third-output failure.");
  providerError.code = "simulated_provider_failure";
  await __test.failAsyncJob({ job: __test.findJob(thirdId), error: providerError });

  const batch = __test.serializeGenerationBatch(__test.findGenerationBatch(response.payload.batchId));
  assert.equal(batch.jobs.length, 3);
  assert.equal(batch.completedOutputs, 2);
  assert.equal(batch.failedOutputs, 1);
  assert.equal(batch.partial, true);
  assert.equal(batch.status, "completed");
  assert.equal(__test.state.assets.filter((asset) => asset.batchId === batch.id).length, 2);
  const batchHistory = __test.state.history.filter((entry) => response.payload.jobIds.includes(entry.jobId));
  assert.equal(batchHistory.length, 3);
  assert.equal(batchHistory.every((entry) => entry.batchId === batch.id), true);
  assert.equal(batchHistory.every((entry) => entry.result?.jobId === entry.jobId), true);
  assert.equal(__test.ledgerSnapshot("tenant_batch").heldCredits, 0);
  assert.equal(__test.ledgerSnapshot("tenant_batch").capturedCredits, perOutputCost * 2);
  assert.equal(__test.ledgerSnapshot("tenant_batch").availableCredits, 1000 - perOutputCost * 2);
});

test("tenant wallets remain isolated across reserve, capture and release", () => {
  __test.resetTestState({ credits: 100 });
  const tenantA = { ok: true, tenantId: "tenant_a", userId: "user_a", role: "standard" };
  const tenantB = { ok: true, tenantId: "tenant_b", userId: "user_b", role: "standard" };
  const requestA = makeRequest({ path: "/api/generate/image", method: "POST" });
  const requestB = makeRequest({ path: "/api/generate/image", method: "POST" });

  const reserveA = __test.reserveCredits({
    amount: 30,
    kind: "image",
    auth: tenantA,
    request: requestA,
    initialCredits: 100,
    idempotencyKey: "tenant-a-reserve"
  });
  const reserveB = __test.reserveCredits({
    amount: 20,
    kind: "image",
    auth: tenantB,
    request: requestB,
    initialCredits: 60,
    idempotencyKey: "tenant-b-reserve"
  });
  __test.resolveReservation({
    reservationId: reserveA.reservation.id,
    outcome: "capture",
    idempotencyKey: "tenant-a-capture"
  });
  __test.resolveReservation({
    reservationId: reserveB.reservation.id,
    outcome: "release",
    idempotencyKey: "tenant-b-release"
  });

  assert.deepEqual(
    {
      available: __test.ledgerSnapshot("tenant_a").availableCredits,
      held: __test.ledgerSnapshot("tenant_a").heldCredits,
      captured: __test.ledgerSnapshot("tenant_a").capturedCredits
    },
    { available: 70, held: 0, captured: 30 }
  );
  assert.deepEqual(
    {
      available: __test.ledgerSnapshot("tenant_b").availableCredits,
      held: __test.ledgerSnapshot("tenant_b").heldCredits,
      captured: __test.ledgerSnapshot("tenant_b").capturedCredits
    },
    { available: 60, held: 0, captured: 0 }
  );
  assert.equal(__test.ledgerSnapshot("demo-user").availableCredits, 100);
});

test("provider gateway falls back after a simulated primary 5xx", async () => {
  __test.resetTestState({ credits: 100 });
  process.env.OPENAI_API_KEY = "test_openai";
  process.env.GEMINI_API_KEY = "test_gemini";
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return jsonFetchResponse({
      responseId: "gemini_response_test",
      candidates: [
        {
          content: {
            parts: [
              {
                inlineData: {
                  mimeType: "image/png",
                  data: Buffer.from("png").toString("base64")
                }
              }
            ]
          }
        }
      ]
    });
  };

  const result = await __test.runProviderGateway({
    kind: "image",
    providerStatus: __test.providerStatus("OpenAI Images"),
    prompt: "cinematic garage",
    title: "fallback test",
    payload: { forceProviderFailure: "OpenAI Images" }
  });

  assert.equal(result.providerName, "Gemini Image");
  assert.equal(result.fallback.from, "OpenAI Images");
  assert.equal(result.route[0].code, "provider_simulated_503");
  assert.equal(result.route.at(-1).ok, true);
  assert.equal(fetchCount, 1);
  assert.match(result.providerResult.previewUrl, /^data:image\/png;base64,/);
});

test("reference uploads are stored as tenant-owned assets without exposing storage paths", async () => {
  __test.resetTestState({ credits: 100 });
  const auth = { ok: true, userId: "demo-user", role: "standard", email: "creator@example.com" };
  const request = makeRequest({
    path: "/api/assets/upload",
    method: "POST",
    headers: { authorization: "Bearer session_test" }
  });

  const asset = await __test.storeUploadedReferenceAsset({
    request,
    auth,
    payload: {
      kind: "image",
      module: "image",
      role: "image-to-image",
      fileName: "reference.png",
      contentType: "image/png",
      dataUrl: `data:image/png;base64,${testPngBytes().toString("base64")}`,
      note: "test reference"
    }
  });

  assert.equal(asset.tenantId, "demo-user");
  assert.equal(asset.kind, "image");
  assert.equal(isDurableAssetUrl(asset.publicUrl), true);
  if (asset.storagePath) assert.equal(existsSync(asset.storagePath), true);
  assert.equal(__test.findOwnedAsset(asset.id, auth).id, asset.id);
  assert.equal("storagePath" in __test.serializeAssetForClient(asset), false);
  assert.throws(() => {
    __test.findOwnedAsset(asset.id, { ok: true, userId: "other-user", role: "standard" });
  }, /Forbidden/);
});

test("Seedance materializes a durable local image Asset as a provider-ready Base64 reference", async () => {
  __test.resetTestState({ credits: 100 });
  const auth = { ok: true, userId: "demo-user", role: "standard", email: "creator@example.com" };
  const request = makeRequest({
    path: "/api/assets/upload",
    method: "POST",
    headers: { authorization: "Bearer session_test" }
  });
  const asset = await __test.storeUploadedReferenceAsset({
    request,
    auth,
    payload: {
      kind: "image",
      module: "image",
      role: "image-to-video",
      fileName: "seedance-reference.png",
      contentType: "image/png",
      dataUrl: `data:image/png;base64,${testPngBytes().toString("base64")}`
    }
  });

  const payload = await __test.prepareSeedanceProviderPayload({
    operation: "image_to_video",
    tool: "IMAGE2VIDEO",
    referenceAssetIds: [asset.id],
    referenceImageUrl: asset.publicUrl
  });

  assert.match(payload.referenceImageUrl, /^data:image\/png;base64,/);
  assert.equal(Buffer.from(payload.referenceImageUrl.split(",")[1], "base64").equals(testPngBytes()), true);
});

test("binary video uploads keep duration metadata for Reality Transform validation", async () => {
  __test.resetTestState({ credits: 1000 });
  const auth = { ok: true, userId: "demo-user", role: "standard" };
  const request = makeRequest({ path: "/api/assets/upload-binary", method: "POST" });
  const asset = await __test.storeUploadedReferenceBytes({
    request,
    auth,
    payload: {
      kind: "video",
      module: "video",
      role: "Reality Transform",
      fileName: "performance.mp4",
      contentType: "video/mp4",
      durationSeconds: 8.25
    },
    bytes: testMp4Bytes(),
    detectedContentType: "video/mp4"
  });

  const prepared = __test.prepareGenerationPayload({
    kind: "video",
    auth,
    payload: {
      provider: "Runway",
      tool: "REALITY_TRANSFORM",
      referenceAssetIds: [asset.id]
    }
  });
  assert.equal(asset.metadata.durationSeconds, 8.25);
  assert.equal(prepared.sourceAssetId, asset.id);
  assert.equal(prepared.sourceDurationSeconds, 8.25);
  assert.equal(prepared.model, "aleph2");
});

test("media validation checks real signatures and ffprobe metadata", async () => {
  assert.equal(detectMediaMime(testPngBytes()), "image/png");
  assert.equal(detectMediaMime(testMp4Bytes()), "video/mp4");
  assert.throws(
    () => validateProbeMetadata({ codec: "h264", durationSeconds: 8, width: 1920, height: 1080, frameRate: 60, videoTracks: 1 }, { maxFps: 30 }),
    /30 fps or lower/
  );

  const validationDir = mkdtempSync(join(tmpdir(), "slt-ffprobe-"));
  const videoPath = join(validationDir, "source.mp4");
  const fakeProbePath = join(validationDir, "ffprobe-test");
  writeFileSync(videoPath, testMp4Bytes());
  writeFileSync(fakeProbePath, `#!/bin/sh\nprintf '%s' '{"format":{"duration":"8.25","size":"1024","format_name":"mov,mp4"},"streams":[{"codec_type":"video","codec_name":"h264","width":1920,"height":1080,"avg_frame_rate":"24/1"},{"codec_type":"audio","codec_name":"aac","channels":2,"sample_rate":"48000"}]}'\n`);
  chmodSync(fakeProbePath, 0o755);
  const validated = await validateMediaFile({
    filePath: videoPath,
    declaredMime: "video/mp4",
    kind: "video",
    maxBytes: 2048,
    ffprobePath: fakeProbePath,
    probeLimits: { minDuration: 2, maxDuration: 30, maxFps: 30, maxWidth: 1920, maxHeight: 1920 }
  });
  assert.equal(validated.detectedMime, "video/mp4");
  assert.equal(validated.media.durationSeconds, 8.25);
  assert.equal(validated.media.codec, "h264");
  assert.equal(validated.media.videoTracks, 1);
  assert.equal(validated.media.audioTracks, 1);
});

test("Character Lab keeps tenant ownership, explicit consent and capture coverage separate", async () => {
  __test.resetTestState({ credits: 1000 });
  const auth = { ok: true, userId: "demo-user", role: "standard" };
  const character = {
    id: "character_test_1",
    tenantId: "demo-user",
    userId: "demo-user",
    name: "Test Character",
    status: "draft",
    datasetStatus: "collecting",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  __test.state.characters.push(character);
  __test.state.characterConsents.push({
    id: "consent_test_1",
    characterId: character.id,
    tenantId: "demo-user",
    subjectName: "Test Character",
    status: "granted",
    scope: { likeness: true, voice: true, training: true },
    signedAt: new Date().toISOString()
  });
  const asset = await __test.storeUploadedReferenceBytes({
    request: makeRequest({ path: "/api/assets/upload-binary", method: "POST" }),
    auth,
    payload: { kind: "image", fileName: "front.png", contentType: "image/png" },
    bytes: testPngBytes(),
    detectedContentType: "image/png"
  });
  __test.state.characterAssets.push({
    id: "character_asset_test_1",
    characterId: character.id,
    assetId: asset.id,
    tenantId: "demo-user",
    category: "identity_photo",
    angle: "front",
    expression: "neutral"
  });

  const summary = __test.characterDatasetSummary(character.id, auth);
  assert.equal(summary.consentGranted, true);
  assert.equal(summary.counts.image, 1);
  assert.deepEqual(summary.counts.angles, ["front"]);
  assert.equal(summary.ready, false);
  assert.equal(__test.characterCapturePlan.length, 6);
  assert.throws(
    () => __test.findOwnedCharacter(character.id, { ok: true, userId: "other-user", role: "standard" }),
    /Forbidden/
  );
});

test("platform forms persist structured requests and reject invalid input", () => {
  __test.resetTestState({ credits: 100 });
  const request = makeRequest({ path: "/api/forms/careers", method: "POST" });
  const auth = { ok: false, userId: null, role: "anonymous" };

  const form = __test.savePlatformForm({
    request,
    auth,
    kind: "careers",
    payload: {
      name: "Creative Lead",
      email: "talent@example.com",
      subject: "Careers",
      message: "I want to collaborate with Sweet Little Trauma Studio.",
      source: "test"
    }
  });

  assert.equal(form.kind, "careers");
  assert.equal(form.status, "received");
  assert.equal(__test.state.forms.length, 1);
  assert.throws(() => {
    __test.savePlatformForm({
      request,
      auth,
      kind: "support",
      payload: { email: "bad-email", message: "This is long enough." }
    });
  }, /Invalid email/);
  assert.throws(() => {
    __test.savePlatformForm({
      request,
      auth,
      kind: "support",
      payload: { email: "ok@example.com", message: "short" }
    });
  }, /at least 8 characters/);
});

test("provider webhook validates signatures, stores completed assets and ignores duplicates", async () => {
  __test.resetTestState({ credits: 100 });
  const auth = { ok: true, userId: "demo-user", role: "standard" };
  const request = makeRequest({ path: "/api/generate/image" });
  const reservation = __test.reserveCredits({
    amount: 10,
    kind: "image",
    auth,
    request,
    idempotencyKey: "reserve:webhook:test",
    metadata: { test: true }
  });
  const checks = {
    auth,
    plan: { ok: true },
    credits: { ok: true, cost: 10, reservation: reservation.reservation, wallet: reservation.wallet },
    provider: { name: "Flux", adapter: "replicate-image" }
  };
  const job = __test.createJob({
    kind: "image",
    title: "webhook image",
    providerName: "Flux",
    prompt: "webhook prompt",
    payload: { provider: "Flux" },
    checks,
    request
  });

  const body = {
    id: "provider_evt_1",
    request_id: job.id,
    status: "succeeded",
    output: [`data:image/png;base64,${Buffer.from("png").toString("base64")}`]
  };
  const rawBody = JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = signProviderWebhook(rawBody, process.env.REPLICATE_WEBHOOK_SECRET, timestamp);
  const handler = __test.handleProviderWebhook("replicate");
  const providerRequest = makeRequest({
    path: "/api/webhooks/replicate",
    method: "POST",
    query: { jobId: job.id },
    body,
    rawBody: Buffer.from(rawBody),
    headers: {
      host: "127.0.0.1:3000",
      "webhook-timestamp": timestamp,
      "webhook-signature": signature
    }
  });

  const response = makeResponse();
  await handler(providerRequest, response);
  assert.equal(response.statusCode, 202);
  assert.equal(response.payload.accepted, true);

  const completedJob = await waitForJobStatus(job.id, "COMPLETED");
  assert.equal(completedJob.status, "COMPLETED");
  assert.equal(__test.state.assets.length, 1);
  assert.equal(isDurableAssetUrl(completedJob.outputUrl), true);
  assert.equal(__test.ledgerSnapshot().capturedCredits, 10);

  const duplicate = makeResponse();
  await handler(providerRequest, duplicate);
  assert.equal(duplicate.payload.duplicate, true);
  assert.equal(__test.state.assets.length, 1);
  assert.equal(__test.ledgerSnapshot().capturedCredits, 10);

  const invalid = makeResponse();
  const invalidRequest = makeRequest({
    path: "/api/webhooks/replicate",
    method: "POST",
    body,
    rawBody: Buffer.from(rawBody),
    headers: {
      "webhook-timestamp": timestamp,
      "webhook-signature": "bad"
    }
  });
  await handler(invalidRequest, invalid);
  assert.equal(invalid.statusCode, 401);
  assert.equal(invalid.payload.code, "webhook_signature_invalid");
});

test("Stripe signature verification and payment webhook idempotency are enforced", async () => {
  __test.resetTestState({ credits: 100 });
  const event = {
    id: "evt_credit_pack_test",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_credit_pack_test",
        customer: "cus_test",
        payment_status: "paid",
        metadata: {
          type: "credit_pack",
          creditPackId: "credits_500",
          credits: "500",
          // handleCreditPackCheckout siempre nombra el tenant en la metadata.
          // Un evento sin tenant no acredita a nadie, por diseño.
          tenantId: "demo-user"
        }
      }
    }
  };
  const rawBody = Buffer.from(JSON.stringify(event));
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = signStripeWebhook(rawBody, process.env.STRIPE_WEBHOOK_SECRET, timestamp);

  assert.doesNotThrow(() => {
    __test.verifyStripeWebhookSignature(rawBody, `t=${timestamp},v1=${signature}`, process.env.STRIPE_WEBHOOK_SECRET);
  });
  assert.throws(() => {
    __test.verifyStripeWebhookSignature(rawBody, `t=${timestamp},v1=bad`, process.env.STRIPE_WEBHOOK_SECRET);
  }, /Invalid Stripe signature/);

  const first = await __test.applyStripeWebhookEvent(event);
  assert.equal(first.idempotent, false);
  assert.ok(first.actions.includes("credit_pack_granted"));
  assert.equal(__test.ledgerSnapshot().availableCredits, 600);

  const duplicate = await __test.applyStripeWebhookEvent(event);
  assert.equal(duplicate.idempotent, true);
  assert.ok(duplicate.actions.includes("duplicate_ignored"));
  assert.equal(__test.ledgerSnapshot().availableCredits, 600);
});

test("a Stripe subscription webhook only moves the plan of its own tenant", async () => {
  __test.resetTestState({ credits: 100 });

  const tenantA = "tenant-alpha";
  const tenantB = "tenant-beta";
  __test.subscriptionForTenant(tenantA).stripeCustomerId = "cus_alpha";
  __test.subscriptionForTenant(tenantB).stripeCustomerId = "cus_beta";

  assert.equal(__test.planForTenant(tenantA), "Free");
  assert.equal(__test.planForTenant(tenantB), "Free");

  // Alpha compra Studio. El evento nombra su tenant en metadata.
  const upgradeAlpha = await __test.applyStripeWebhookEvent({
    id: "evt_alpha_checkout",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_alpha",
        customer: "cus_alpha",
        mode: "subscription",
        subscription: "sub_alpha",
        payment_status: "paid",
        metadata: { plan: "Studio", tenantId: tenantA }
      }
    }
  });

  assert.equal(upgradeAlpha.tenantId, tenantA);
  assert.equal(__test.planForTenant(tenantA), "Studio");
  assert.equal(__test.planForTenant(tenantB), "Free", "el plan de beta no debe moverse");

  // Beta recibe una factura que sólo trae el customer, sin metadata de tenant.
  // Tiene que resolverse por customer y no tocar a alpha.
  const invoiceBeta = await __test.applyStripeWebhookEvent({
    id: "evt_beta_invoice",
    type: "invoice.paid",
    data: {
      object: {
        id: "in_beta",
        customer: "cus_beta",
        subscription: "sub_beta",
        amount_paid: 1900,
        lines: { data: [{ metadata: { plan: "Pro" }, period: { start: 1 } }] }
      }
    }
  });

  assert.equal(invoiceBeta.tenantId, tenantB);
  assert.equal(__test.planForTenant(tenantB), "Pro");
  assert.equal(__test.planForTenant(tenantA), "Studio", "el plan de alpha no debe moverse");

  // La cancelación de beta tampoco puede alcanzar a alpha.
  await __test.applyStripeWebhookEvent({
    id: "evt_beta_cancel",
    type: "customer.subscription.deleted",
    data: { object: { id: "sub_beta", customer: "cus_beta" } }
  });

  assert.equal(__test.subscriptionForTenant(tenantB).status, "cancelled");
  assert.equal(__test.subscriptionForTenant(tenantA).status, "active");

  // Un evento de un customer desconocido no puede caer sobre ningún tenant.
  const orphan = await __test.applyStripeWebhookEvent({
    id: "evt_orphan",
    type: "invoice.paid",
    data: {
      object: {
        id: "in_orphan",
        customer: "cus_desconocido",
        subscription: "sub_orphan",
        lines: { data: [{ metadata: { plan: "Enterprise" }, period: { start: 1 } }] }
      }
    }
  });

  assert.ok(orphan.actions.includes("tenant_unresolved"));
  assert.equal(orphan.tenantId, null);
  assert.equal(__test.planForTenant(tenantA), "Studio");
  assert.equal(__test.planForTenant(tenantB), "Pro");
  assert.ok(
    !__test.state.subscriptions.some((item) => item.plan === "Enterprise"),
    "ningún tenant debe haber recibido el plan del evento huérfano"
  );
});

test("credit grants and plan limits read the tenant of the caller, not a global default", async () => {
  __test.resetTestState({ credits: 0 });

  const tenantA = "limits-alpha";
  const tenantB = "limits-beta";
  __test.subscriptionForTenant(tenantA).plan = "Creator";
  __test.subscriptionForTenant(tenantB).plan = "Free";

  const authA = { ok: true, tenantId: tenantA, userId: tenantA, role: "standard" };
  const authB = { ok: true, tenantId: tenantB, userId: tenantB, role: "standard" };

  // Creator permite 60 segundos de video; Free, 10.
  const longClip = { durationSeconds: 45, videoDurationSeconds: 45 };
  assert.doesNotThrow(() => {
    __test.resolveVideoPlan({ payload: longClip, auth: authA, providerName: "Runway" });
  });
  assert.throws(
    () => __test.resolveVideoPlan({ payload: longClip, auth: authB, providerName: "Runway" }),
    /capped at/
  );
});

test("multimodal router exposes only implemented operations and rejects incompatible native output", () => {
  const reality = __test.routeMultimodalModel({
    modality: "video",
    operation: "reality_transform",
    provider: "Runway",
    model: "aleph2",
    durationSeconds: 8,
    resolution: "1080p"
  });
  assert.equal(reality.selected?.id, "runway-aleph2");
  assert.equal(reality.request.operation, "reality_transform");
  assert.equal(reality.selected?.outputs?.maxNativeResolution, "1080p");

  const incompatible = __test.routeMultimodalModel({
    modality: "video",
    operation: "reality_transform",
    provider: "Runway",
    model: "aleph2",
    durationSeconds: 8,
    resolution: "4K"
  });
  assert.equal(incompatible.selected, null);
  assert.equal(incompatible.comingSoon, true);

  const unsupported = __test.routeMultimodalModel({ modality: "video", operation: "remove_object" });
  assert.equal(unsupported.selected, null);
  assert.equal(unsupported.comingSoon, true);
  const removeObject = __test.operationCatalog("video").find((operation) => operation.id === "remove_object");
  assert.equal(removeObject.status, "coming_soon");
});

test("music, sound and voice share the capability router without advertising unimplemented tools", () => {
  const music = __test.operationCatalog("music");
  const sound = __test.operationCatalog("sound");
  const voice = __test.operationCatalog("voice");

  assert.equal(music.find((operation) => operation.id === "text_to_music")?.implemented, true);
  assert.equal(music.find((operation) => operation.id === "stem_separation")?.status, "coming_soon");
  assert.equal(sound.find((operation) => operation.id === "text_to_speech")?.implemented, true);
  assert.equal(sound.find((operation) => operation.id === "voice_cloning")?.status, "coming_soon");
  assert.equal(voice.find((operation) => operation.id === "text_to_speech")?.implemented, true);
  assert.equal(voice.find((operation) => operation.id === "speech_to_speech")?.status, "coming_soon");

  const routed = __test.routeMultimodalModel({
    modality: "voice",
    operation: "text_to_speech",
    provider: "ElevenLabs"
  });
  assert.equal(routed.selected?.id, "elevenlabs-voice");
  assert.equal(routed.request.operation, "text_to_speech");
});

test("MiniMax hex audio becomes a storable data URL without retaining provider bytes", () => {
  const result = __test.miniMaxAudioResult({
    data: { audio: "49443304000000000000", status: 2 },
    extra_info: { audio_size: 10, audio_format: "mp3" },
    trace_id: "trace_audio_test",
    base_resp: { status_code: 0, status_msg: "success" }
  }, { provider: "MiniMax Music", format: "mp3" });

  assert.equal(result.status, "complete");
  assert.equal(result.providerJobId, "trace_audio_test");
  assert.match(result.previewUrl, /^data:audio\/mpeg;base64,/);
  assert.equal(result.audioBytes, 10);
  assert.equal(result.raw.data.audio, undefined);
  assert.equal(result.raw.data.audioBytes, 10);
  assert.equal(result.raw.trace_id, "trace_audio_test");
  assert.equal(__test.requestedAudioDuration({ durationSeconds: 0.2 }), 1);
  assert.equal(__test.requestedAudioDuration({ durationSeconds: 12 }), 12);
  assert.equal(__test.requestedAudioDuration({ durationSeconds: 999 }), 180);
});

test("MiniMax missing audio fails explicitly instead of leaving a Job processing forever", () => {
  assert.throws(
    () => __test.miniMaxAudioResult({ data: { status: 2 }, base_resp: { status_code: 0 } }, { provider: "MiniMax Speech" }),
    (error) => error.code === "provider_invalid_response" && /without returning audio data/i.test(error.message)
  );
});

test("Character Lab references are tenant-scoped, consent-gated and reusable by both studios", () => {
  __test.resetTestState({ credits: 100 });
  const tenantId = "tenant_character_reference";
  const auth = { ok: true, tenantId, userId: "user_character_reference", role: "standard" };
  const now = new Date().toISOString();
  __test.state.characters.push({
    id: "character_reference_1",
    tenantId,
    userId: auth.userId,
    name: "Reference Subject",
    primaryAssetId: "asset_character_face",
    metadata: {},
    createdAt: now,
    updatedAt: now
  });
  __test.state.assets.push({
    id: "asset_character_face",
    tenantId,
    userId: auth.userId,
    kind: "image",
    contentType: "image/png",
    publicUrl: "https://assets.example.com/character-face.png",
    metadata: { serverValidated: true },
    createdAt: now
  });
  __test.state.characterAssets.push({
    id: "character_asset_link_1",
    characterId: "character_reference_1",
    assetId: "asset_character_face",
    tenantId,
    category: "identity_photo",
    createdAt: now
  });
  __test.state.characterConsents.push({
    id: "character_consent_granted_1",
    characterId: "character_reference_1",
    tenantId,
    status: "granted",
    createdAt: now
  });

  const imagePayload = __test.prepareGenerationPayload({
    kind: "image",
    payload: { characterIds: ["character_reference_1"] },
    auth
  });
  assert.deepEqual(imagePayload.characterIds, ["character_reference_1"]);
  assert.deepEqual(imagePayload.referenceAssetIds, ["asset_character_face"]);
  assert.equal(imagePayload.referenceImageUrl, "https://assets.example.com/character-face.png");

  const later = new Date(Date.now() + 1000).toISOString();
  __test.state.characterConsents.push({
    id: "character_consent_revoked_1",
    characterId: "character_reference_1",
    tenantId,
    status: "revoked",
    createdAt: later
  });
  assert.throws(() => __test.prepareCharacterReferences({
    payload: { characterIds: ["character_reference_1"] },
    auth
  }), /consent is not currently granted/i);
});

test("FFmpeg frame extraction produces a server-validated reusable PNG without a provider call", async () => {
  const directory = mkdtempSync(join(tmpdir(), "slt-frame-extraction-"));
  const fakeFfmpeg = join(directory, "fake-ffmpeg");
  const sourcePath = join(directory, "source.mp4");
  const outputPath = join(directory, "frame.png");
  writeFileSync(sourcePath, testMp4Bytes());
  writeFileSync(fakeFfmpeg, `#!/usr/bin/env node
const fs = require('node:fs');
const output = process.argv[process.argv.length - 1];
fs.writeFileSync(output, Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0x00,0x00,0x00,0x0d]));
`);
  chmodSync(fakeFfmpeg, 0o755);

  const result = await extractVideoFrame({ sourcePath, outputPath, timestampSeconds: 1.25, ffmpegPath: fakeFfmpeg });
  assert.equal(result.timestampSeconds, 1.25);
  assert.equal(existsSync(outputPath), true);
  const validation = await validateMediaFile({
    filePath: outputPath,
    declaredMime: "image/png",
    kind: "image",
    maxBytes: 1024,
    skipProbe: true
  });
  assert.equal(validation.detectedMime, "image/png");
  assert.equal(validation.family, "image");
});

test("SLT error registry exposes 55 stable public codes and creates safe incident IDs", () => {
  __test.resetTestState({ credits: 100 });
  const summary = __test.registrySummary();
  assert.equal(summary.count, 55);
  assert.equal(Object.keys(__test.SLT_ERROR_REGISTRY).length, 55);
  assert.equal(new Set(Object.values(__test.SLT_ERROR_REGISTRY).map((item) => item.name)).size, 55);

  const incident = __test.createSltIncident({
    auth: { ok: true, tenantId: "demo-user", userId: "demo-user", role: "standard" },
    error: { message: "authorization=super-secret-token /Users/private/project/.env" },
    classification: __test.SLT_ERROR_BY_NAME.INTERNAL_SLT_ERROR,
    context: { route: "/api/generate/video" }
  });
  assert.match(incident.incidentId, /^ERR-\d{8}-[A-F0-9]{6}$/);
  assert.doesNotMatch(incident.technicalMessage, /super-secret-token/);
  assert.doesNotMatch(incident.technicalMessage, /\/Users\/private/);
});

test("diagnostic classifier distinguishes provider balance, auth, rate, storage, database and media failures", () => {
  const cases = [
    [{ statusCode: 402, message: "Runway insufficient balance" }, { provider: "Runway" }, "SLT-1002"],
    [{ statusCode: 402, message: "Replicate billing required" }, { provider: "Replicate" }, "SLT-1003"],
    [{ statusCode: 401, message: "invalid api key" }, { provider: "Seedance" }, "SLT-1103"],
    [{ statusCode: 429, message: "rate limit" }, { provider: "Gemini" }, "SLT-1503"],
    [{ code: "asset_storage_failed", message: "storage write failed" }, { provider: "Gemini" }, "SLT-1604"],
    [{ message: "Postgres database unavailable" }, {}, "SLT-1701"],
    [{ message: "ffmpeg not found ENOENT" }, {}, "SLT-1801"]
  ];
  for (const [error, context, code] of cases) {
    assert.equal(__test.classifySltError(error, context).code, code);
  }
});

test("Runway and Replicate diagnostics expose their exact unavailable reasons without making paid calls", () => {
  __test.resetTestState({ credits: 100 });
  __test.setProviderDiagnostic("Runway", {
    status: "PROVIDER_NO_CREDITS",
    errorName: "PROVIDER_NO_CREDITS",
    errorCode: "SLT-1002",
    customerMessage: "Temporarily unavailable — provider balance required."
  });
  __test.setProviderDiagnostic("Replicate", {
    status: "PROVIDER_BILLING_REQUIRED",
    errorName: "PROVIDER_BILLING_REQUIRED",
    errorCode: "SLT-1003",
    customerMessage: "Temporarily unavailable — provider billing required."
  });
  const runway = __test.providerStatus("Runway");
  const replicate = __test.providerStatus("Replicate");
  assert.equal(runway.connected, false);
  assert.equal(runway.errorName, "PROVIDER_NO_CREDITS");
  assert.equal(runway.message, "Temporarily unavailable — provider balance required.");
  assert.equal(replicate.connected, false);
  assert.equal(replicate.errorName, "PROVIDER_BILLING_REQUIRED");
  assert.equal(replicate.message, "Temporarily unavailable — provider billing required.");
});

test("known provider blockers remain visible and cannot be selected for generation", () => {
  __test.resetTestState({ credits: 100 });
  const expected = [
    ["MiniMax Music", "PROVIDER_AUTH_FAILED", "SLT-1103"],
    ["MiniMax Speech", "PROVIDER_AUTH_FAILED", "SLT-1103"],
    ["PixVerse", "API_KEY_REQUIRED", "SLT-1102"],
    ["Moises", "API_KEY_REQUIRED", "SLT-1102"]
  ];

  for (const [provider, status, errorCode] of expected) {
    const result = __test.providerStatus(provider);
    assert.equal(result.connected, false, provider);
    assert.equal(result.canGenerate, false, provider);
    assert.equal(result.status, status, provider);
    assert.equal(result.errorCode, errorCode, provider);
    assert.match(result.message, /Temporarily unavailable/i, provider);
  }
});

test("provider failure releases the exact reservation, creates one durable incident and one 5% coupon", async () => {
  __test.resetTestState({ credits: 100 });
  const auth = { ok: true, tenantId: "demo-user", userId: "demo-user", role: "standard" };
  const request = makeRequest({ path: "/api/generate/video" });
  const reserved = __test.reserveCredits({
    amount: 12,
    kind: "video",
    auth,
    request,
    idempotencyKey: "reserve:incident:test"
  });
  const checks = {
    auth,
    plan: { ok: true },
    credits: { ok: true, cost: 12, reservation: reserved.reservation, wallet: reserved.wallet },
    provider: { name: "Seedance" }
  };
  const job = __test.createJob({
    kind: "video",
    title: "Incident release test",
    providerName: "Seedance",
    prompt: "test",
    payload: { provider: "Seedance", model: "seedance-test" },
    checks,
    request
  });
  const error = new Error("provider timed out");
  error.code = "provider_timeout";
  error.statusCode = 504;
  const failed = await __test.failAsyncJob({ job, error });
  const ledger = __test.ledgerSnapshot("demo-user");
  assert.equal(ledger.availableCredits, 100);
  assert.equal(ledger.heldCredits, 0);
  assert.equal(failed.failure.incident.errorCode, "SLT-1502");
  assert.equal(failed.failure.incident.reservationReleased, true);
  assert.equal(failed.failure.coupon.discountPercent, 5);
  assert.equal(__test.state.errorIncidents.length, 1);
  assert.equal(__test.state.compensationCoupons.length, 1);

  const duplicate = await __test.recordSltFailure({ job, error, context: { provider: "Seedance" } });
  assert.equal(duplicate.incident.incidentId, failed.failure.incident.incidentId);
  assert.equal(duplicate.coupon.code, failed.failure.coupon.code);
  assert.equal(__test.state.errorIncidents.length, 1);
  assert.equal(__test.state.compensationCoupons.length, 1);
});

test("5% compensation is excluded for user credits, invalid input, moderation, cancellation and abuse", () => {
  const excluded = [
    ["USER_INSUFFICIENT_CREDITS", {}],
    ["INVALID_PROMPT", {}],
    ["PROMPT_BLOCKED", {}],
    ["PROVIDER_REQUEST_FAILED", { cancelled: true }],
    ["PROVIDER_REQUEST_FAILED", { deliberateInvalid: true }],
    ["PROVIDER_REQUEST_FAILED", { abuse: true }],
    ["PROVIDER_REQUEST_FAILED", { fraud: true }]
  ];
  for (const [name, context] of excluded) {
    assert.equal(__test.compensationAllowed(__test.SLT_ERROR_BY_NAME[name], context), false, name);
  }
  assert.equal(__test.compensationAllowed(__test.SLT_ERROR_BY_NAME.PROVIDER_TIMEOUT, {}), true);
});

test("retry payload creates a separate Job linked to the failure and never reuses providerTaskId", () => {
  __test.resetTestState({ credits: 100 });
  const auth = { ok: true, tenantId: "demo-user", userId: "demo-user", role: "standard" };
  const request = makeRequest({ path: "/api/generate/image" });
  const checks = {
    auth,
    plan: { ok: true },
    credits: { ok: true, cost: 0, reservation: null, wallet: __test.ledgerSnapshot("demo-user") },
    provider: { name: "Gemini Image" }
  };
  const original = __test.createJob({
    kind: "image",
    title: "Original failed image",
    providerName: "Gemini Image",
    prompt: "editorial image",
    payload: { provider: "Gemini Image", model: "gemini-image" },
    checks,
    request
  });
  original.status = "FAILED";
  original.providerJobId = "provider-task-old";
  const retry = __test.buildRetryGenerationPayload(original, { overrides: { quality: "High" } });
  const next = __test.createJob({
    kind: original.kind,
    title: retry.payload.title,
    providerName: retry.payload.provider,
    prompt: retry.payload.prompt,
    payload: retry.payload,
    checks,
    request
  });
  assert.notEqual(next.id, original.id);
  assert.equal(next.retryOfJobId, original.id);
  assert.equal(next.providerJobId, null);
  assert.notEqual(retry.retryKey, original.requestId);
  assert.equal(retry.payload.outputCount, 1);
});

test("Timeline API edits, moves, trims, splits, mutes, solos and deletes tenant clips", async () => {
  __test.resetTestState({ credits: 100 });
  __test.sessions.set("session_functional", { tenantId: "demo-user", userId: "demo-user", role: "standard" });
  __test.state.assets.push({
    id: "asset_timeline_api",
    tenantId: "demo-user",
    userId: "demo-user",
    kind: "video",
    contentType: "video/mp4",
    metadata: { durationSeconds: 8 },
    createdAt: new Date().toISOString()
  });

  await withApiServer(async (baseUrl) => {
    const created = await apiRequest(baseUrl, "/api/timeline", {
      method: "POST",
      body: { projectId: "project_timeline", assetId: "asset_timeline_api", trackType: "VIDEO", startSeconds: 1, durationSeconds: 6 }
    });
    assert.equal(created.status, 201);
    const itemId = created.data.item.id;

    const edited = await apiRequest(baseUrl, `/api/timeline/${itemId}`, {
      method: "PATCH",
      body: { startSeconds: 2, sourceStartSeconds: 1, durationSeconds: 4, position: 3, muted: true, solo: true, volume: 0.65, fadeInSeconds: 0.4, fadeOutSeconds: 0.5 }
    });
    assert.equal(edited.data.item.startSeconds, 2);
    assert.equal(edited.data.item.sourceStartSeconds, 1);
    assert.equal(edited.data.item.position, 3);
    assert.equal(edited.data.item.muted, true);
    assert.equal(edited.data.item.solo, true);

    const split = await apiRequest(baseUrl, `/api/timeline/${itemId}/split`, { method: "POST", body: { atSeconds: 4 } });
    assert.equal(split.status, 201);
    assert.equal(split.data.leftItem.durationSeconds, 2);
    assert.equal(split.data.rightItem.sourceStartSeconds, 3);

    const removed = await apiRequest(baseUrl, `/api/timeline/${split.data.rightItem.id}`, { method: "DELETE" });
    assert.equal(removed.status, 200);
    assert.ok(__test.state.timelineItems.find((item) => item.id === split.data.rightItem.id).deletedAt);
  });
});

test("real FFmpeg composition mixes Video, Music and SFX into H.264/AAC MP4", async () => {
  const directory = mkdtempSync(join(tmpdir(), "slt-real-render-"));
  const sourcePath = join(directory, "source.mp4");
  const outputPath = join(directory, "final.mp4");
  await execFileAsync(resolveFfmpegPath(), [
    "-y", "-f", "lavfi", "-i", "color=c=blue:s=320x180:r=12:d=1",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=1",
    "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", sourcePath
  ]);
  const assets = [{ id: "asset_av", filePath: sourcePath, contentType: "video/mp4", originalName: "source.mp4" }];
  const items = [
    { id: "clip_video", assetId: "asset_av", trackType: "VIDEO", startSeconds: 0, sourceStartSeconds: 0, durationSeconds: 1 },
    { id: "clip_music", assetId: "asset_av", trackType: "MUSIC", startSeconds: 0, sourceStartSeconds: 0, durationSeconds: 1, volume: 0.4, fadeInSeconds: 0.1, fadeOutSeconds: 0.1 },
    { id: "clip_sfx", assetId: "asset_av", trackType: "SFX", startSeconds: 0.25, sourceStartSeconds: 0, durationSeconds: 0.5, volume: 0.25 }
  ];
  const plan = buildTimelineRenderPlan({ items, assets, width: 320, height: 180, fps: 12 });
  assert.equal(plan.videoItemCount, 1);
  assert.equal(plan.audioItemCount, 2);
  await renderTimeline({ items, assets, outputPath, width: 320, height: 180, fps: 12 });
  assert.equal(existsSync(outputPath), true);
  const { stdout } = await execFileAsync(resolveFfprobePath(), ["-v", "error", "-show_entries", "stream=codec_type,codec_name", "-of", "json", outputPath]);
  const streams = JSON.parse(stdout).streams;
  assert.equal(streams.some((stream) => stream.codec_type === "video" && stream.codec_name === "h264"), true);
  assert.equal(streams.some((stream) => stream.codec_type === "audio" && stream.codec_name === "aac"), true);
});

test("Music, Sound and Character Assets use real cross-modal Library actions", async () => {
  __test.resetTestState({ credits: 100 });
  __test.sessions.set("session_functional", { tenantId: "demo-user", userId: "demo-user", role: "standard" });
  const now = new Date().toISOString();
  __test.state.assets.push(
    { id: "asset_music_route", tenantId: "demo-user", userId: "demo-user", kind: "music", contentType: "audio/mpeg", metadata: { durationSeconds: 12 }, createdAt: now },
    { id: "asset_sound_route", tenantId: "demo-user", userId: "demo-user", kind: "sound", contentType: "audio/wav", metadata: { durationSeconds: 3 }, createdAt: now },
    { id: "asset_face_route", tenantId: "demo-user", userId: "demo-user", kind: "image", contentType: "image/png", createdAt: now }
  );
  __test.state.scenes.push({ id: "scene_route", tenantId: "demo-user", userId: "demo-user", projectId: "project_route", sessionId: "session_route", title: "Route Scene", parameters: {}, createdAt: now, updatedAt: now });
  __test.state.characters.push({ id: "character_route", tenantId: "demo-user", userId: "demo-user", name: "Route Character", createdAt: now, updatedAt: now });
  __test.state.characterConsents.push({ id: "consent_route", characterId: "character_route", tenantId: "demo-user", status: "granted", scope: { likeness: true, training: true }, signedAt: now });

  await withApiServer(async (baseUrl) => {
    const music = await apiRequest(baseUrl, "/api/assets/asset_music_route/actions", { method: "POST", body: { action: "ADD_TO_TIMELINE", projectId: "project_route" } });
    const sound = await apiRequest(baseUrl, "/api/assets/asset_sound_route/actions", { method: "POST", body: { action: "ADD_TO_SCENE", sceneId: "scene_route" } });
    const character = await apiRequest(baseUrl, "/api/assets/asset_face_route/actions", { method: "POST", body: { action: "ADD_TO_CHARACTER", characterId: "character_route" } });
    assert.equal(music.status, 201);
    assert.equal(music.data.timelineItem.trackType, "MUSIC");
    assert.equal(sound.status, 201);
    assert.equal(__test.state.timelineItems.some((item) => item.assetId === "asset_sound_route" && item.trackType === "SFX"), true);
    assert.equal(character.status, 201);
    assert.equal(__test.state.characterAssets.some((item) => item.assetId === "asset_face_route" && item.characterId === "character_route"), true);
  });
});

test("Scene final render creates an async Job, persistent Asset, History and captured credits", async () => {
  __test.resetTestState({ credits: 100 });
  __test.sessions.set("session_functional", { tenantId: "demo-user", userId: "demo-user", role: "standard" });
  const sourcePath = join(process.env.SLT_STORAGE_DIR, "scene-render-source.mp4");
  await execFileAsync(resolveFfmpegPath(), [
    "-y", "-f", "lavfi", "-i", "color=c=red:s=320x180:r=12:d=1",
    "-f", "lavfi", "-i", "sine=frequency=220:sample_rate=48000:duration=1",
    "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", sourcePath
  ]);
  const now = new Date().toISOString();
  __test.state.assets.push({ id: "asset_scene_render", tenantId: "demo-user", userId: "demo-user", projectId: "project_scene_render", kind: "video", contentType: "video/mp4", storagePath: sourcePath, publicUrl: "/cdn/assets/scene.mp4", metadata: { durationSeconds: 1 }, createdAt: now });
  __test.state.timelineItems.push(
    { id: "timeline_scene_video", tenantId: "demo-user", projectId: "project_scene_render", sceneId: "scene_final", assetId: "asset_scene_render", trackType: "VIDEO", startSeconds: 0, sourceStartSeconds: 0, durationSeconds: 1, position: 0, volume: 1, pan: 0, createdAt: now, updatedAt: now },
    { id: "timeline_scene_music", tenantId: "demo-user", projectId: "project_scene_render", sceneId: "scene_final", assetId: "asset_scene_render", trackType: "MUSIC", startSeconds: 0, sourceStartSeconds: 0, durationSeconds: 1, position: 0, volume: 0.4, pan: 0, createdAt: now, updatedAt: now }
  );

  await withApiServer(async (baseUrl) => {
    const accepted = await apiRequest(baseUrl, "/api/timeline/render", { method: "POST", body: { projectId: "project_scene_render", sceneId: "scene_final", width: 320, height: 180, fps: 12 } });
    assert.equal(accepted.status, 202);
    const job = await waitForJobStatus(accepted.data.jobId, "COMPLETED", 15000);
    assert.equal(job.status, "COMPLETED", job.error?.message);
    assert.ok(job.assetId);
    assert.equal(__test.state.assets.some((asset) => asset.id === job.assetId && asset.provider === "SLT FFmpeg"), true);
    assert.equal(__test.state.history.some((entry) => entry.jobId === job.id && entry.status === "completed"), true);
    assert.equal(__test.ledgerSnapshot("demo-user").heldCredits, 0);
    assert.equal(__test.ledgerSnapshot("demo-user").capturedCredits, 5);
  });
});

test("Workflow executor persists typed node runs and adds predecessor Assets to Timeline", async () => {
  __test.resetTestState({ credits: 100 });
  const now = new Date().toISOString();
  __test.state.assets.push({ id: "asset_workflow_timeline", tenantId: "demo-user", userId: "demo-user", projectId: "project_workflow", kind: "music", contentType: "audio/mpeg", metadata: { durationSeconds: 6 }, createdAt: now });
  __test.state.workflows.push({ id: "workflow_exec", tenantId: "demo-user", userId: "demo-user", projectId: "project_workflow", name: "Typed workflow", status: "DRAFT", description: "", createdAt: now, updatedAt: now });
  __test.state.workflowNodes.push(
    { id: "workflow_text", workflowId: "workflow_exec", tenantId: "demo-user", nodeType: "TEXT", label: "Brief", position: { x: 0, y: 0 }, configuration: { text: "A restrained film score" }, createdAt: now, updatedAt: now },
    { id: "workflow_timeline", workflowId: "workflow_exec", tenantId: "demo-user", nodeType: "TIMELINE", label: "Add Music", position: { x: 1, y: 0 }, configuration: { assetId: "asset_workflow_timeline", action: "ADD_TO_TIMELINE", trackType: "MUSIC" }, createdAt: now, updatedAt: now }
  );
  __test.state.workflowEdges.push({ id: "workflow_edge_exec", workflowId: "workflow_exec", tenantId: "demo-user", sourceNodeId: "workflow_text", targetNodeId: "workflow_timeline", metadata: {}, createdAt: now });
  __test.state.workflowRuns.push({ id: "workflow_run_exec", tenantId: "demo-user", userId: "demo-user", workflowId: "workflow_exec", projectId: "project_workflow", sessionId: null, status: "PENDING", input: { prompt: "A restrained film score" }, output: {}, error: null, createdAt: now, updatedAt: now });

  const ordered = __test.orderedWorkflowNodes("workflow_exec");
  assert.deepEqual(ordered.nodes.map((node) => node.id), ["workflow_text", "workflow_timeline"]);
  await __test.executeWorkflowRun("workflow_run_exec");
  const run = __test.state.workflowRuns.find((item) => item.id === "workflow_run_exec");
  assert.equal(run.status, "COMPLETED", run.error?.message);
  assert.equal(__test.state.workflowNodeRuns.filter((item) => item.workflowRunId === run.id && item.status === "COMPLETED").length, 2);
  assert.equal(__test.state.timelineItems.some((item) => item.assetId === "asset_workflow_timeline" && item.trackType === "MUSIC"), true);
});

test("Applications expose real availability and create reusable workflow templates", () => {
  __test.resetTestState({ credits: 100 });
  const catalog = __test.creativeApplicationCatalog();
  assert.equal(catalog.find((item) => item.id === "scene-builder")?.status, "AVAILABLE");
  assert.equal(catalog.every((item) => ["AVAILABLE", "TEMPORARILY_UNAVAILABLE", "COMING_SOON"].includes(item.status)), true);
  const definition = catalog.find((item) => item.id === "music-video");
  const now = new Date().toISOString();
  const instance = { id: "application_music_video", tenantId: "demo-user", userId: "demo-user", projectId: "project_application", sessionId: null, appType: "music-video", title: "Music Video Test", status: "DRAFT", configuration: {}, createdAt: now, updatedAt: now };
  const workflow = __test.createApplicationWorkflow({ definition, instance, auth: { userId: "demo-user" }, now });
  assert.ok(workflow.id);
  assert.equal(workflow.nodes.some((node) => node.nodeType === "IMAGE"), true);
  assert.equal(workflow.nodes.some((node) => node.nodeType === "VIDEO"), true);
  assert.equal(workflow.nodes.some((node) => node.nodeType === "MUSIC"), true);
  assert.equal(workflow.nodes.filter((node) => node.nodeType === "TIMELINE").length, 2);
});

test("Character datasets stay REFERENCE READY when no real training provider is configured", async () => {
  __test.resetTestState({ credits: 100 });
  const previousUrl = process.env.CHARACTER_TRAINING_API_URL;
  const previousKey = process.env.CHARACTER_TRAINING_API_KEY;
  delete process.env.CHARACTER_TRAINING_API_URL;
  delete process.env.CHARACTER_TRAINING_API_KEY;
  const now = new Date().toISOString();
  __test.state.characters.push({ id: "character_reference_ready", tenantId: "demo-user", userId: "demo-user", name: "Reference Ready", datasetStatus: "ready", providerModelId: null, createdAt: now, updatedAt: now });
  __test.state.characterConsents.push({ id: "consent_reference_ready", characterId: "character_reference_ready", tenantId: "demo-user", status: "granted", scope: { likeness: true, training: true }, signedAt: now });
  const summary = __test.characterDatasetSummary("character_reference_ready", { ok: true, tenantId: "demo-user", userId: "demo-user", role: "standard" });
  const adapter = createCharacterTrainingAdapter(process.env);
  assert.equal(summary.character.datasetStatus, "ready");
  assert.equal(summary.character.providerModelId, null);
  assert.equal(adapter.configured, false);
  await assert.rejects(() => adapter.createTraining({ characterId: "character_reference_ready" }), (error) => error.code === "character_training_provider_unavailable");
  if (previousUrl !== undefined) process.env.CHARACTER_TRAINING_API_URL = previousUrl;
  if (previousKey !== undefined) process.env.CHARACTER_TRAINING_API_KEY = previousKey;
});

test("media binary detection is real and both executables answer with versions", async () => {
  const status = __test.mediaBinaryStatus();
  assert.equal(status.ffmpeg.detected, true);
  assert.equal(status.ffprobe.detected, true);
  const ffmpeg = await execFileAsync(status.ffmpeg.path, ["-version"]);
  const ffprobe = await execFileAsync(status.ffprobe.path, ["-version"]);
  assert.match(ffmpeg.stdout, /ffmpeg version/i);
  assert.match(ffprobe.stdout, /ffprobe version/i);
});
