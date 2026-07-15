import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.SLT_TEST_MODE = "1";
process.env.NODE_ENV = "test";
process.env.SLT_STORAGE_DIR = mkdtempSync(join(tmpdir(), "slt-assets-"));
process.env.MODERATION_DISABLED = "false";
process.env.OPENAI_MODERATION_ENABLED = "false";
process.env.PROVIDER_FALLBACKS_ENABLED = "true";
process.env.REPLICATE_WEBHOOK_SECRET = "replicate_test_secret";
process.env.STRIPE_WEBHOOK_SECRET = "stripe_test_secret";

const { __test } = await import("../server/api-proxy.js");
const originalFetch = globalThis.fetch;

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

function isDurableAssetUrl(value = "") {
  return /\/cdn\/assets\//.test(value) || /\/storage\/v1\/object\/public\/slt-assets\//.test(value);
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
      dataUrl: `data:image/png;base64,${Buffer.from("png").toString("base64")}`,
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

test("Stripe signature verification and payment webhook idempotency are enforced", () => {
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
          credits: "500"
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

  const first = __test.applyStripeWebhookEvent(event);
  assert.equal(first.idempotent, false);
  assert.ok(first.actions.includes("credit_pack_granted"));
  assert.equal(__test.ledgerSnapshot().availableCredits, 600);

  const duplicate = __test.applyStripeWebhookEvent(event);
  assert.equal(duplicate.idempotent, true);
  assert.ok(duplicate.actions.includes("duplicate_ignored"));
  assert.equal(__test.ledgerSnapshot().availableCredits, 600);
});
