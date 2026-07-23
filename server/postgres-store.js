import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;
const projectDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(projectDir, "..");

function json(value) {
  return JSON.stringify(value ?? null);
}

function dateOrNull(value) {
  return value ? new Date(value) : null;
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function defaultTenantId(state = {}) {
  return state.wallet?.tenantId || state.user?.id || "demo-user";
}

function stripRuntimeOnlyFields(asset = {}) {
  const { storagePath: _storagePath, ...safeAsset } = asset;
  return safeAsset;
}

function buildPool(databaseUrl) {
  return new Pool({
    connectionString: databaseUrl,
    max: Number(process.env.DATABASE_POOL_MAX || 5),
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined
  });
}

export class MemoryRuntimeStore {
  constructor() {
    this.kind = "memory";
    this.durable = false;
    this.ready = true;
  }

  async initialize() {
    return this.status();
  }

  async loadState() {
    return null;
  }

  async saveState() {
    return { ok: true, skipped: true, reason: "memory_store" };
  }

  async close() {}

  status() {
    return {
      ok: true,
      ready: true,
      kind: this.kind,
      durable: this.durable,
      message: "Development/test memory store active."
    };
  }
}

export class PostgresRuntimeStore {
  constructor({ databaseUrl, migrations = [] } = {}) {
    if (!databaseUrl) throw new Error("DATABASE_URL is required for PostgresRuntimeStore.");
    this.kind = "postgres";
    this.durable = true;
    this.ready = false;
    this.databaseUrl = databaseUrl;
    this.pool = buildPool(databaseUrl);
    this.migrations = migrations;
    this.lastSavedAt = null;
    this.lastError = null;
  }

  async initialize({ seedState = null } = {}) {
    for (const migrationPath of this.migrations) {
      const absolutePath = migrationPath.startsWith("/") ? migrationPath : resolve(repoRoot, migrationPath);
      if (!existsSync(absolutePath)) continue;
      await this.pool.query(readFileSync(absolutePath, "utf8"));
    }
    if (seedState) {
      await this.seedMinimumData(seedState);
    }
    this.ready = true;
    return this.status();
  }

  async seedMinimumData(state) {
    const tenantId = defaultTenantId(state);
    const user = state.user || {};
    const subscription = state.subscription || {};
    const wallet = state.wallet || {};
    await this.pool.query("begin");
    try {
      await this.pool.query(
        `insert into tenants (id, name, plan_code)
         values ($1, $2, $3)
         on conflict (id) do update set name = excluded.name, plan_code = excluded.plan_code, updated_at = now()`,
        [tenantId, user.username || "Sweet Little Trauma Studio", subscription.plan || user.plan || "Free"]
      );
      await this.pool.query(
        `insert into users (id, tenant_id, email, display_name, role)
         values ($1, $2, $3, $4, $5)
         on conflict (id) do update set
           tenant_id = excluded.tenant_id,
           email = excluded.email,
           display_name = excluded.display_name,
           role = excluded.role,
           updated_at = now()`,
        [user.id || tenantId, tenantId, user.email || null, user.username || null, user.role || "user"]
      );
      await this.pool.query(
        `insert into wallets (tenant_id, available_credits, held_credits, captured_credits)
         values ($1, $2, $3, $4)
         on conflict (tenant_id) do nothing`,
        [
          tenantId,
          Number(wallet.availableCredits ?? subscription.credits ?? user.credits ?? 0),
          Number(wallet.heldCredits ?? 0),
          Number(wallet.capturedCredits ?? 0)
        ]
      );
      await this.pool.query("commit");
    } catch (error) {
      await this.pool.query("rollback");
      throw error;
    }
  }

  async loadState() {
    const snapshot = await this.pool.query(
      "select payload from runtime_state_snapshots where id = $1",
      ["default"]
    );
    if (snapshot.rows[0]?.payload) {
      return snapshot.rows[0].payload;
    }
    return this.loadRelationalState();
  }

  async loadRelationalState() {
    const tenants = await this.pool.query("select * from tenants order by created_at asc limit 1");
    const tenant = tenants.rows[0];
    if (!tenant) return null;
    const tenantId = tenant.id;
    const [users, wallets, subscriptions, projects, history, jobs, assets, forms, reservations, transactions, payments, webhooks] =
      await Promise.all([
        this.pool.query("select * from users where tenant_id = $1 order by created_at asc", [tenantId]),
        this.pool.query("select * from wallets where tenant_id = $1 limit 1", [tenantId]),
        this.pool.query("select * from subscriptions where tenant_id = $1 order by updated_at desc limit 1", [tenantId]),
        this.pool.query("select * from projects where tenant_id = $1 order by created_at desc limit 100", [tenantId]),
        this.pool.query("select * from history_entries where tenant_id = $1 order by created_at desc limit 100", [tenantId]),
        this.pool.query("select * from jobs where tenant_id = $1 order by created_at desc limit 100", [tenantId]),
        this.pool.query("select * from assets where tenant_id = $1 order by created_at desc limit 100", [tenantId]),
        this.pool.query("select * from platform_forms where tenant_id = $1 or tenant_id is null order by created_at desc limit 100", [tenantId]),
        this.pool.query("select * from credit_reservations where tenant_id = $1 order by created_at desc limit 100", [tenantId]),
        this.pool.query("select * from credit_transactions where tenant_id = $1 order by created_at desc limit 300", [tenantId]),
        this.pool.query("select * from payment_events where tenant_id = $1 or tenant_id is null order by created_at desc limit 100", [tenantId]),
        this.pool.query("select * from webhook_events order by created_at desc limit 100")
      ]);
    const user = users.rows[0] || {};
    const wallet = wallets.rows[0] || {};
    const subscription = subscriptions.rows[0] || {};
    return {
      user: {
        id: user.id || tenantId,
        email: user.email || "",
        username: user.display_name || tenant.name || "sweetcreator",
        role: user.role || "user",
        plan: subscription.plan_code || tenant.plan_code || "Free",
        credits: Number(wallet.available_credits || 0)
      },
      subscription: {
        plan: subscription.plan_code || tenant.plan_code || "Free",
        status: subscription.status || "active",
        credits: Number(wallet.available_credits || 0),
        heldCredits: Number(wallet.held_credits || 0),
        capturedCredits: Number(wallet.captured_credits || 0),
        stripeCustomerId: subscription.provider_customer_id || "",
        stripeSubscriptionId: subscription.provider_subscription_id || ""
      },
      wallet: {
        tenantId,
        availableCredits: Number(wallet.available_credits || 0),
        heldCredits: Number(wallet.held_credits || 0),
        capturedCredits: Number(wallet.captured_credits || 0)
      },
      projects: projects.rows.map((row) => ({ ...row.metadata, id: row.id, tenantId: row.tenant_id, title: row.title, kind: row.kind, createdAt: row.created_at })),
      history: history.rows.map((row) => ({ ...row.result, id: row.id, tenantId: row.tenant_id, kind: row.kind, title: row.title, provider: row.provider, status: row.status, result: row.result, createdAt: row.created_at })),
      jobs: jobs.rows.map((row) => ({ ...row.metadata, id: row.id, tenantId: row.tenant_id, kind: row.kind, provider: row.provider, prompt: row.prompt, status: row.status, outputUrl: row.output_url, outputUrls: row.output_urls, error: row.error, createdAt: row.created_at, updatedAt: row.updated_at })),
      assets: assets.rows.map((row) => ({ ...row.metadata, id: row.id, tenantId: row.tenant_id, jobId: row.job_id, kind: row.kind, provider: row.provider, role: row.role, originalName: row.original_name, originalUrl: row.original_url, publicUrl: row.public_url, storageKey: row.storage_key, contentType: row.content_type, bytes: Number(row.bytes || 0), status: row.status, createdAt: row.created_at })),
      forms: forms.rows.map((row) => ({ ...row.metadata, id: row.id, tenantId: row.tenant_id, kind: row.kind, name: row.name, email: row.email, subject: row.subject, message: row.message, status: row.status, source: row.source, createdAt: row.created_at })),
      creditReservations: reservations.rows.map((row) => ({ ...row.metadata, id: row.id, tenantId: row.tenant_id, kind: row.kind, amount: row.amount, status: row.status, idempotencyKey: row.idempotency_key, idempotency_key: row.idempotency_key, jobId: row.job_id, createdAt: row.created_at, updatedAt: row.updated_at, capturedAt: row.captured_at, releasedAt: row.released_at })),
      creditTransactions: transactions.rows.map((row) => ({ ...row.metadata, id: row.id, tenantId: row.tenant_id, jobId: row.job_id, reservationId: row.reservation_id, type: row.type, status: row.status, amount: row.amount, idempotencyKey: row.idempotency_key, idempotency_key: row.idempotency_key, entries: row.entries, metadata: row.metadata, createdAt: row.created_at })),
      paymentEvents: payments.rows.map((row) => ({ id: row.id, provider: row.provider, eventId: row.event_id, tenantId: row.tenant_id, status: row.status, payload: row.payload, processedAt: row.processed_at, createdAt: row.created_at })),
      webhookEvents: webhooks.rows.map((row) => ({ id: row.id, provider: row.provider, eventId: row.event_id, jobId: row.job_id, status: row.status, payload: row.payload, processedAt: row.processed_at, createdAt: row.created_at }))
    };
  }

  async saveState({ state, reason = "runtime_persist" } = {}) {
    const tenantId = defaultTenantId(state);
    const user = state.user || {};
    const wallet = state.wallet || {};
    const subscription = state.subscription || {};
    await this.pool.query("begin");
    try {
      await this.pool.query(
        `insert into tenants (id, name, plan_code)
         values ($1, $2, $3)
         on conflict (id) do update set name = excluded.name, plan_code = excluded.plan_code, updated_at = now()`,
        [tenantId, user.username || tenantId, subscription.plan || user.plan || "Free"]
      );
      await this.pool.query(
        `insert into users (id, tenant_id, email, display_name, role)
         values ($1, $2, $3, $4, $5)
         on conflict (id) do update set tenant_id = excluded.tenant_id, email = excluded.email, display_name = excluded.display_name, role = excluded.role, updated_at = now()`,
        [user.id || tenantId, tenantId, user.email || null, user.username || null, user.role || "user"]
      );
      await this.pool.query(
        `insert into wallets (tenant_id, available_credits, held_credits, captured_credits)
         values ($1, $2, $3, $4)
         on conflict (tenant_id) do update set
           available_credits = excluded.available_credits,
           held_credits = excluded.held_credits,
           captured_credits = excluded.captured_credits,
           updated_at = now()`,
        [tenantId, Number(wallet.availableCredits || 0), Number(wallet.heldCredits || 0), Number(wallet.capturedCredits || 0)]
      );
      await this.persistCollections({ tenantId, state });
      await this.pool.query(
        `insert into runtime_state_snapshots (id, payload, reason)
         values ($1, $2::jsonb, $3)
         on conflict (id) do update set payload = excluded.payload, reason = excluded.reason, updated_at = now()`,
        ["default", json({ ...state, assets: safeArray(state.assets).map(stripRuntimeOnlyFields) }), reason]
      );
      await this.pool.query("commit");
      this.lastSavedAt = new Date().toISOString();
      this.lastError = null;
      return { ok: true, durable: true, savedAt: this.lastSavedAt };
    } catch (error) {
      await this.pool.query("rollback");
      this.lastError = error.message;
      throw error;
    }
  }

  async persistCollections({ tenantId, state }) {
    for (const transaction of safeArray(state.creditTransactions)) {
      await this.pool.query(
        `insert into credit_transactions (id, tenant_id, user_id, job_id, reservation_id, type, status, amount, idempotency_key, entries, metadata, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,coalesce($12, now()))
         on conflict (idempotency_key) do nothing`,
        [
          transaction.id,
          transaction.tenantId || tenantId,
          null,
          transaction.jobId || null,
          transaction.reservationId || null,
          transaction.type || "unknown",
          transaction.status || "posted",
          Number(transaction.amount || 0),
          transaction.idempotencyKey || transaction.idempotency_key || transaction.id,
          json(transaction.entries || []),
          json(transaction.metadata || {}),
          dateOrNull(transaction.createdAt)
        ]
      );
    }
    for (const reservation of safeArray(state.creditReservations)) {
      await this.pool.query(
        `insert into credit_reservations (id, tenant_id, kind, amount, status, idempotency_key, job_id, metadata, created_at, updated_at, captured_at, released_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,coalesce($9, now()),coalesce($10, now()),$11,$12)
         on conflict (id) do update set status = excluded.status, job_id = excluded.job_id, metadata = excluded.metadata, updated_at = now(), captured_at = excluded.captured_at, released_at = excluded.released_at`,
        [
          reservation.id,
          reservation.tenantId || tenantId,
          reservation.kind || "unknown",
          Number(reservation.amount || 0),
          reservation.status || "reserved",
          reservation.idempotencyKey || reservation.idempotency_key || reservation.id,
          reservation.jobId || null,
          json(reservation.metadata || {}),
          dateOrNull(reservation.createdAt),
          dateOrNull(reservation.updatedAt),
          dateOrNull(reservation.capturedAt),
          dateOrNull(reservation.releasedAt)
        ]
      );
    }
    for (const job of safeArray(state.jobs)) {
      await this.pool.query(
        `insert into jobs (id, tenant_id, user_id, kind, provider, model, prompt, status, reservation_id, provider_request_id, output_url, output_urls, error, metadata, created_at, updated_at, completed_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14::jsonb,coalesce($15, now()),coalesce($16, now()),$17)
         on conflict (id) do update set status = excluded.status, output_url = excluded.output_url, output_urls = excluded.output_urls, error = excluded.error, metadata = excluded.metadata, updated_at = now(), completed_at = excluded.completed_at`,
        [
          job.id,
          job.tenantId || tenantId,
          job.userId || null,
          job.kind || "unknown",
          job.provider || job.providerName || null,
          job.model || null,
          job.prompt || null,
          job.status || "IN_QUEUE",
          job.reservationId || job.checks?.credits?.reservation?.id || null,
          job.providerJobId || job.requestId || null,
          job.outputUrl || null,
          json(job.outputUrls || []),
          job.error || null,
          json(job),
          dateOrNull(job.createdAt),
          dateOrNull(job.updatedAt),
          dateOrNull(job.completedAt)
        ]
      );
    }
    for (const asset of safeArray(state.assets)) {
      const safeAsset = stripRuntimeOnlyFields(asset);
      await this.pool.query(
        `insert into assets (id, tenant_id, user_id, job_id, kind, provider, role, original_name, original_url, public_url, storage_key, content_type, bytes, status, metadata, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,coalesce($16, now()))
         on conflict (id) do update set public_url = excluded.public_url, status = excluded.status, metadata = excluded.metadata`,
        [
          safeAsset.id,
          safeAsset.tenantId || tenantId,
          safeAsset.userId || null,
          safeAsset.jobId || null,
          safeAsset.kind || "asset",
          safeAsset.provider || null,
          safeAsset.role || null,
          safeAsset.originalName || null,
          safeAsset.originalUrl || null,
          safeAsset.publicUrl,
          safeAsset.storageKey || safeAsset.publicUrl || safeAsset.id,
          safeAsset.contentType || null,
          Number(safeAsset.bytes || 0),
          safeAsset.status || "stored",
          json(safeAsset.metadata || safeAsset),
          dateOrNull(safeAsset.createdAt)
        ]
      );
    }
    for (const form of safeArray(state.forms)) {
      await this.pool.query(
        `insert into platform_forms (id, tenant_id, user_id, kind, name, email, subject, message, status, source, metadata, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,coalesce($12, now()))
         on conflict (id) do update set status = excluded.status, metadata = excluded.metadata`,
        [
          form.id,
          form.tenantId || null,
          form.userId || null,
          form.kind || "contact",
          form.name || null,
          form.email || null,
          form.subject || null,
          form.message || "",
          form.status || "received",
          form.source || "web",
          json(form.metadata || {}),
          dateOrNull(form.createdAt)
        ]
      );
      await this.pool.query(
        `insert into support_tickets (id, tenant_id, user_id, kind, name, email, subject, message, status, source, metadata, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,coalesce($12, now()))
         on conflict (id) do update set status = excluded.status, metadata = excluded.metadata, updated_at = now()`,
        [
          form.id,
          form.tenantId || null,
          form.userId || null,
          form.kind || "contact",
          form.name || null,
          form.email || null,
          form.subject || null,
          form.message || "",
          form.status || "received",
          form.source || "web",
          json(form.metadata || {}),
          dateOrNull(form.createdAt)
        ]
      );
    }
  }

  async close() {
    await this.pool.end();
  }

  status() {
    return {
      ok: this.ready && !this.lastError,
      ready: this.ready,
      kind: this.kind,
      durable: this.durable,
      lastSavedAt: this.lastSavedAt,
      lastError: this.lastError,
      message: this.ready ? "PostgreSQL runtime store active." : "PostgreSQL runtime store not initialized."
    };
  }
}

export function createRuntimeStore(env = process.env) {
  if (!env.DATABASE_URL || env.SLT_TEST_MODE === "1") {
    return new MemoryRuntimeStore();
  }
  const migrations = ["migrations/001_production_schema.sql"];
  const useSupabaseRls = env.ENABLE_SUPABASE_RLS === "1" || env.SUPABASE_RLS === "1" || env.DATABASE_PROVIDER === "supabase";
  if (useSupabaseRls) {
    migrations.push("migrations/002_supabase_rls.sql");
  }
  return new PostgresRuntimeStore({
    databaseUrl: env.DATABASE_URL,
    migrations
  });
}
