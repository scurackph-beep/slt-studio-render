import { existsSync, readFileSync } from "node:fs";
import crypto from "node:crypto";
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

function walletFromRow(row = {}, tenantId = "") {
  return {
    tenantId: row.tenant_id || tenantId,
    availableCredits: Number(row.available_credits || 0),
    heldCredits: Number(row.held_credits || 0),
    capturedCredits: Number(row.captured_credits || 0)
  };
}

function reservationFromRow(row = {}) {
  if (!row?.id) return null;
  return {
    ...row.metadata,
    id: row.id,
    tenantId: row.tenant_id,
    kind: row.kind,
    amount: Number(row.amount || 0),
    status: row.status,
    idempotencyKey: row.idempotency_key,
    idempotency_key: row.idempotency_key,
    jobId: row.job_id,
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    capturedAt: row.captured_at,
    releasedAt: row.released_at
  };
}

function transactionFromRow(row = {}) {
  if (!row?.id) return null;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    jobId: row.job_id,
    reservationId: row.reservation_id,
    type: row.type,
    status: row.status || "posted",
    amount: Number(row.amount || 0),
    idempotencyKey: row.idempotency_key,
    idempotency_key: row.idempotency_key,
    entries: row.entries || [],
    metadata: row.metadata || {},
    createdAt: row.created_at
  };
}

function cryptoRandomId() {
  return crypto.randomUUID().replace(/-/g, "");
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
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `insert into tenants (id, name, plan_code)
         values ($1, $2, $3)
         on conflict (id) do update set name = excluded.name, plan_code = excluded.plan_code, updated_at = now()`,
        [tenantId, user.username || "Sweet Little Trauma Studio", subscription.plan || user.plan || "Free"]
      );
      await client.query(
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
      await client.query(
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
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async ensureTenantRows(client, { tenantId, userId = null, initialCredits = 0 } = {}) {
    await client.query(
      `insert into tenants (id, name, plan_code)
       values ($1, $2, 'Free')
       on conflict (id) do nothing`,
      [tenantId, tenantId]
    );
    if (userId) {
      await client.query(
        `insert into users (id, tenant_id, role)
         values ($1, $2, 'user')
         on conflict (id) do update set tenant_id = excluded.tenant_id, updated_at = now()`,
        [userId, tenantId]
      );
    }
    await client.query(
      `insert into wallets (tenant_id, available_credits, held_credits, captured_credits)
       values ($1, $2, 0, 0)
       on conflict (tenant_id) do nothing`,
      [tenantId, Math.max(0, Number(initialCredits) || 0)]
    );
  }

  async getWallet(tenantId) {
    const result = await this.pool.query(
      `select tenant_id, available_credits, held_credits, captured_credits
       from wallets where tenant_id = $1`,
      [tenantId]
    );
    return result.rows[0] ? walletFromRow(result.rows[0], tenantId) : null;
  }

  async reserveCredits({
    reservationId,
    tenantId,
    userId = null,
    amount,
    kind,
    idempotencyKey,
    jobId = null,
    metadata = {},
    initialCredits = 0
  } = {}) {
    const cost = Math.max(0, Number(amount) || 0);
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await this.ensureTenantRows(client, { tenantId, userId, initialCredits });

      const existing = await client.query(
        `select * from credit_transactions where idempotency_key = $1 limit 1`,
        [idempotencyKey]
      );
      if (existing.rows[0]) {
        const reservation = await client.query(
          `select * from credit_reservations where id = $1 limit 1`,
          [existing.rows[0].reservation_id]
        );
        const wallet = await client.query(
          `select * from wallets where tenant_id = $1 for update`,
          [tenantId]
        );
        await client.query("commit");
        return {
          reservation: reservationFromRow(reservation.rows[0]),
          transaction: transactionFromRow(existing.rows[0]),
          wallet: walletFromRow(wallet.rows[0], tenantId),
          idempotent: true
        };
      }

      const wallet = await client.query(
        `select * from wallets where tenant_id = $1 for update`,
        [tenantId]
      );
      const current = walletFromRow(wallet.rows[0], tenantId);
      if (current.availableCredits < cost) {
        const error = new Error("Insufficient Credits");
        error.code = "insufficient_credits";
        error.statusCode = 402;
        error.readableError = "You do not have enough credits for this action.";
        throw error;
      }

      const now = new Date();
      const reservationResult = await client.query(
        `insert into credit_reservations
          (id, tenant_id, kind, amount, status, idempotency_key, job_id, metadata, created_at, updated_at)
         values ($1,$2,$3,$4,'reserved',$5,$6,$7::jsonb,$8,$8)
         returning *`,
        [reservationId, tenantId, kind, cost, idempotencyKey, jobId, json(metadata), now]
      );
      const transactionId = `credit_tx_${cryptoRandomId()}`;
      const entries = [
        { account: "Tenant.Available", direction: "debit", amount: cost },
        { account: "Tenant.HeldByReservation", direction: "credit", amount: cost }
      ];
      const transactionResult = await client.query(
        `insert into credit_transactions
          (id, tenant_id, user_id, job_id, reservation_id, type, status, amount, idempotency_key, entries, metadata, created_at)
         values ($1,$2,$3,$4,$5,'reserve','reserved',$6,$7,$8::jsonb,$9::jsonb,$10)
         returning *`,
        [transactionId, tenantId, userId, jobId, reservationId, cost, idempotencyKey, json(entries), json(metadata), now]
      );
      const updatedWallet = await client.query(
        `update wallets
         set available_credits = available_credits - $2,
             held_credits = held_credits + $2,
             updated_at = now()
         where tenant_id = $1
         returning *`,
        [tenantId, cost]
      );
      await client.query("commit");
      return {
        reservation: reservationFromRow(reservationResult.rows[0]),
        transaction: transactionFromRow(transactionResult.rows[0]),
        wallet: walletFromRow(updatedWallet.rows[0], tenantId),
        idempotent: false
      };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async resolveReservation({ reservationId, outcome, jobId = null, idempotencyKey, reason = "" } = {}) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const reservationResult = await client.query(
        `select * from credit_reservations where id = $1 for update`,
        [reservationId]
      );
      const reservationRow = reservationResult.rows[0];
      if (!reservationRow) {
        await client.query("commit");
        return { reservation: null, transaction: null, wallet: null, skipped: true, reason: "reservation_not_found" };
      }
      const tenantId = reservationRow.tenant_id;
      const existing = await client.query(
        `select * from credit_transactions where idempotency_key = $1 limit 1`,
        [idempotencyKey]
      );
      const walletResult = await client.query(
        `select * from wallets where tenant_id = $1 for update`,
        [tenantId]
      );
      if (existing.rows[0] || ["captured", "released", "cancelled"].includes(reservationRow.status)) {
        await client.query("commit");
        return {
          reservation: reservationFromRow(reservationRow),
          transaction: transactionFromRow(existing.rows[0]),
          wallet: walletFromRow(walletResult.rows[0], tenantId),
          idempotent: true
        };
      }

      const capture = outcome === "capture";
      const amount = Number(reservationRow.amount || 0);
      if (Number(walletResult.rows[0]?.held_credits || 0) < amount) {
        const error = new Error("Credit ledger held balance is lower than the reservation.");
        error.code = "invalid_held_balance";
        error.statusCode = 409;
        throw error;
      }
      const terminalStatus = capture ? "captured" : "released";
      const now = new Date();
      const updatedReservation = await client.query(
        `update credit_reservations
         set status = $2,
             job_id = coalesce($3, job_id),
             updated_at = $4,
             captured_at = case when $2 = 'captured' then $4 else captured_at end,
             released_at = case when $2 = 'released' then $4 else released_at end
         where id = $1
         returning *`,
        [reservationId, terminalStatus, jobId, now]
      );
      const updatedWallet = await client.query(
        `update wallets
         set available_credits = available_credits + $2,
             held_credits = held_credits - $3,
             captured_credits = captured_credits + $4,
             updated_at = now()
         where tenant_id = $1
         returning *`,
        [tenantId, capture ? 0 : amount, amount, capture ? amount : 0]
      );
      const transactionId = `credit_tx_${cryptoRandomId()}`;
      const entries = [
        { account: "Tenant.HeldByReservation", direction: "debit", amount },
        { account: capture ? "SLT.CapturedRevenue" : "Tenant.Available", direction: "credit", amount }
      ];
      const transactionResult = await client.query(
        `insert into credit_transactions
          (id, tenant_id, job_id, reservation_id, type, status, amount, idempotency_key, entries, metadata, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11)
         returning *`,
        [
          transactionId,
          tenantId,
          jobId || reservationRow.job_id,
          reservationId,
          capture ? "capture" : "release",
          terminalStatus,
          amount,
          idempotencyKey,
          json(entries),
          json({ reason, originalReservationKey: reservationRow.idempotency_key }),
          now
        ]
      );
      await client.query("commit");
      return {
        reservation: reservationFromRow(updatedReservation.rows[0]),
        transaction: transactionFromRow(transactionResult.rows[0]),
        wallet: walletFromRow(updatedWallet.rows[0], tenantId),
        idempotent: false
      };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async changeAvailableCredits({
    tenantId,
    userId = null,
    amount = null,
    targetAmount = null,
    type = "credit_grant",
    idempotencyKey,
    metadata = {},
    initialCredits = 0
  } = {}) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await this.ensureTenantRows(client, { tenantId, userId, initialCredits });
      const existing = await client.query(
        `select * from credit_transactions where idempotency_key = $1 limit 1`,
        [idempotencyKey]
      );
      const walletResult = await client.query(
        `select * from wallets where tenant_id = $1 for update`,
        [tenantId]
      );
      if (existing.rows[0]) {
        await client.query("commit");
        return {
          transaction: transactionFromRow(existing.rows[0]),
          wallet: walletFromRow(walletResult.rows[0], tenantId),
          idempotent: true
        };
      }

      const current = walletFromRow(walletResult.rows[0], tenantId);
      const delta = targetAmount === null
        ? Math.abs(Number(amount) || 0)
        : Math.max(0, Number(targetAmount) || 0) - current.availableCredits;
      if (delta === 0) {
        await client.query("commit");
        return { transaction: null, wallet: current, skipped: true };
      }
      if (current.availableCredits + delta < 0) {
        const error = new Error("Credit adjustment would produce a negative available balance.");
        error.code = "negative_ledger_balance";
        error.statusCode = 409;
        throw error;
      }

      const now = new Date();
      const updatedWallet = await client.query(
        `update wallets
         set available_credits = available_credits + $2,
             updated_at = now()
         where tenant_id = $1
         returning *`,
        [tenantId, delta]
      );
      const credit = delta > 0;
      const transactionId = `credit_tx_${cryptoRandomId()}`;
      const entries = credit
        ? [
            { account: "SLT.CreditIssuer", direction: "debit", amount: Math.abs(delta) },
            { account: "Tenant.Available", direction: "credit", amount: Math.abs(delta) }
          ]
        : [
            { account: "Tenant.Available", direction: "debit", amount: Math.abs(delta) },
            { account: "SLT.CreditExpiry", direction: "credit", amount: Math.abs(delta) }
          ];
      const transactionResult = await client.query(
        `insert into credit_transactions
          (id, tenant_id, user_id, type, status, amount, idempotency_key, entries, metadata, created_at)
         values ($1,$2,$3,$4,'posted',$5,$6,$7::jsonb,$8::jsonb,$9)
         returning *`,
        [transactionId, tenantId, userId, type, Math.abs(delta), idempotencyKey, json(entries), json(metadata), now]
      );
      await client.query("commit");
      return {
        transaction: transactionFromRow(transactionResult.rows[0]),
        wallet: walletFromRow(updatedWallet.rows[0], tenantId),
        idempotent: false
      };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async grantCredits(args = {}) {
    return this.changeAvailableCredits({ ...args, targetAmount: null });
  }

  async adjustAvailableCredits(args = {}) {
    return this.changeAvailableCredits({ ...args, amount: null });
  }

  async loadState() {
    return this.loadRelationalState();
  }

  async loadRelationalState() {
    const tenants = await this.pool.query("select * from tenants order by created_at asc");
    const tenant = tenants.rows[0];
    if (!tenant) return null;
    const tenantId = tenant.id;
    const [
      users,
      wallets,
      subscriptions,
      projects,
      generationSessions,
      generationBatches,
      history,
      jobs,
      assets,
      forms,
      reservations,
      transactions,
      payments,
      webhooks,
      characters,
      characterConsents,
      characterCaptureSessions,
      characterAssets,
      characterVersions,
      errorIncidents,
      compensationCoupons,
      providerDiagnostics,
      creativeReferences,
      scenes,
      sceneItems,
      timelineItems,
      workflows,
      workflowNodes,
      workflowEdges,
      appInstances,
      characterTrainings,
      workflowRuns,
      workflowNodeRuns
    ] =
      await Promise.all([
        this.pool.query("select * from users order by created_at asc limit 2000"),
        this.pool.query("select * from wallets order by tenant_id asc"),
        this.pool.query("select * from subscriptions order by updated_at desc limit 2000"),
        this.pool.query("select * from projects order by created_at desc limit 2000"),
        this.pool.query("select * from generation_sessions order by created_at desc limit 5000"),
        this.pool.query("select * from generation_batches order by created_at desc limit 5000"),
        this.pool.query("select * from history_entries order by created_at desc limit 5000"),
        this.pool.query("select * from jobs order by created_at desc limit 5000"),
        this.pool.query("select * from assets order by created_at desc limit 10000"),
        this.pool.query("select * from platform_forms order by created_at desc limit 5000"),
        this.pool.query("select * from credit_reservations order by created_at desc limit 10000"),
        this.pool.query("select * from credit_transactions order by created_at desc limit 20000"),
        this.pool.query("select * from payment_events order by created_at desc limit 5000"),
        this.pool.query("select * from webhook_events order by created_at desc limit 100"),
        this.pool.query("select * from characters order by updated_at desc limit 5000"),
        this.pool.query("select * from character_consents order by created_at desc limit 10000"),
        this.pool.query("select * from character_capture_sessions order by updated_at desc limit 10000"),
        this.pool.query("select * from character_assets order by created_at desc limit 50000"),
        this.pool.query("select * from character_versions order by created_at desc limit 10000"),
        this.pool.query("select * from error_incidents order by created_at desc limit 10000"),
        this.pool.query("select * from compensation_coupons order by created_at desc limit 10000"),
        this.pool.query("select * from provider_diagnostics order by checked_at desc limit 1000"),
        this.pool.query("select * from creative_references order by updated_at desc limit 10000"),
        this.pool.query("select * from scenes order by updated_at desc limit 10000"),
        this.pool.query("select * from scene_items order by scene_id, position, created_at limit 50000"),
        this.pool.query("select * from timeline_items order by project_id, track_type, position, start_seconds limit 50000"),
        this.pool.query("select * from workflows order by updated_at desc limit 10000"),
        this.pool.query("select * from workflow_nodes order by workflow_id, created_at limit 50000"),
        this.pool.query("select * from workflow_edges order by workflow_id, created_at limit 50000"),
        this.pool.query("select * from creative_app_instances order by updated_at desc limit 10000"),
        this.pool.query("select * from character_trainings order by updated_at desc limit 10000"),
        this.pool.query("select * from workflow_runs order by created_at desc limit 10000"),
        this.pool.query("select * from workflow_node_runs order by created_at desc limit 50000")
      ]);
    const user = users.rows.find((row) => row.tenant_id === tenantId) || users.rows[0] || {};
    const wallet = wallets.rows.find((row) => row.tenant_id === tenantId) || wallets.rows[0] || {};
    const subscription = subscriptions.rows.find((row) => row.tenant_id === tenantId) || subscriptions.rows[0] || {};
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
      wallets: wallets.rows.map((row) => walletFromRow(row, row.tenant_id)),
      projects: projects.rows.map((row) => ({ ...row.metadata, id: row.id, tenantId: row.tenant_id, title: row.title, kind: row.kind, createdAt: row.created_at })),
      generationSessions: generationSessions.rows.map((row) => ({ ...row.metadata, id: row.id, tenantId: row.tenant_id, userId: row.user_id, projectId: row.project_id, title: row.title, status: row.status, metadata: row.metadata, createdAt: row.created_at, updatedAt: row.updated_at })),
      generationBatches: generationBatches.rows.map((row) => ({ ...row.parameters, id: row.id, tenantId: row.tenant_id, userId: row.user_id, projectId: row.project_id, sessionId: row.session_id, modality: row.modality, kind: String(row.modality || "").toLowerCase(), operation: row.operation, provider: row.provider, model: row.model, status: row.status, requestedOutputs: row.requested_outputs, completedOutputs: row.completed_outputs, failedOutputs: row.failed_outputs, cancelledOutputs: row.cancelled_outputs, reservedCredits: row.reserved_credits, capturedCredits: row.captured_credits, releasedCredits: row.released_credits, idempotencyKey: row.idempotency_key, parameters: row.parameters, createdAt: row.created_at, updatedAt: row.updated_at, completedAt: row.completed_at })),
      history: history.rows.map((row) => ({
        ...row.result,
        id: row.id,
        tenantId: row.tenant_id,
        userId: row.user_id,
        jobId: row.job_id || row.result?.jobId || null,
        batchId: row.batch_id || row.result?.batchId || null,
        projectId: row.project_id || row.result?.projectId || null,
        sessionId: row.session_id || row.result?.sessionId || null,
        kind: row.kind,
        title: row.title,
        provider: row.provider,
        status: row.status,
        result: row.result,
        createdAt: row.created_at
      })),
      jobs: jobs.rows.map((row) => ({ ...row.metadata, id: row.id, tenantId: row.tenant_id, userId: row.user_id, batchId: row.batch_id, batchIndex: row.batch_index, projectId: row.project_id, sessionId: row.session_id, modality: row.modality, operation: row.operation, parameters: row.parameters, progress: row.progress, assetId: row.asset_id, retryOfJobId: row.retry_of_job_id, incidentId: row.error_incident_id, kind: row.kind, provider: row.provider, prompt: row.prompt, status: row.status, outputUrl: row.output_url, outputUrls: row.output_urls, error: row.error, createdAt: row.created_at, updatedAt: row.updated_at })),
      assets: assets.rows.map((row) => ({ ...row.metadata, id: row.id, tenantId: row.tenant_id, userId: row.user_id, jobId: row.job_id, batchId: row.batch_id, projectId: row.project_id, sessionId: row.session_id, parentAssetId: row.parent_asset_id, parentVersionId: row.parent_version_id, version: row.version, versionType: row.version_type, displayName: row.display_name, kind: row.kind, provider: row.provider, role: row.role, originalName: row.original_name, originalUrl: row.original_url, publicUrl: row.public_url, storageKey: row.storage_key, contentType: row.content_type, bytes: Number(row.bytes || 0), status: row.status, metadata: row.metadata || {}, createdAt: row.created_at, deletedAt: row.deleted_at })),
      forms: forms.rows.map((row) => ({ ...row.metadata, id: row.id, tenantId: row.tenant_id, kind: row.kind, name: row.name, email: row.email, subject: row.subject, message: row.message, status: row.status, source: row.source, createdAt: row.created_at })),
      creditReservations: reservations.rows.map((row) => ({ ...row.metadata, id: row.id, tenantId: row.tenant_id, kind: row.kind, amount: row.amount, status: row.status, idempotencyKey: row.idempotency_key, idempotency_key: row.idempotency_key, jobId: row.job_id, createdAt: row.created_at, updatedAt: row.updated_at, capturedAt: row.captured_at, releasedAt: row.released_at })),
      creditTransactions: transactions.rows.map((row) => ({ ...row.metadata, id: row.id, tenantId: row.tenant_id, jobId: row.job_id, reservationId: row.reservation_id, type: row.type, status: row.status, amount: row.amount, idempotencyKey: row.idempotency_key, idempotency_key: row.idempotency_key, entries: row.entries, metadata: row.metadata, createdAt: row.created_at })),
      paymentEvents: payments.rows.map((row) => ({ id: row.id, provider: row.provider, eventId: row.event_id, tenantId: row.tenant_id, status: row.status, payload: row.payload, processedAt: row.processed_at, createdAt: row.created_at })),
      webhookEvents: webhooks.rows.map((row) => ({ id: row.id, provider: row.provider, eventId: row.event_id, jobId: row.job_id, status: row.status, payload: row.payload, processedAt: row.processed_at, createdAt: row.created_at })),
      characters: characters.rows.map((row) => ({ ...row.metadata, id: row.id, tenantId: row.tenant_id, userId: row.user_id, name: row.name, slug: row.slug, description: row.description, status: row.status, primaryAssetId: row.primary_asset_id, datasetStatus: row.dataset_status, trainingProvider: row.training_provider, providerModelId: row.provider_model_id, metadata: row.metadata, createdAt: row.created_at, updatedAt: row.updated_at })),
      characterConsents: characterConsents.rows.map((row) => ({ ...row.metadata, id: row.id, characterId: row.character_id, tenantId: row.tenant_id, subjectUserId: row.subject_user_id, subjectName: row.subject_name, status: row.status, scope: row.scope, evidenceAssetId: row.evidence_asset_id, signedAt: row.signed_at, revokedAt: row.revoked_at, metadata: row.metadata, createdAt: row.created_at, updatedAt: row.updated_at })),
      characterCaptureSessions: characterCaptureSessions.rows.map((row) => ({ ...row.metadata, id: row.id, characterId: row.character_id, tenantId: row.tenant_id, stage: row.stage, status: row.status, requirements: row.requirements, progress: row.progress, metadata: row.metadata, createdAt: row.created_at, updatedAt: row.updated_at })),
      characterAssets: characterAssets.rows.map((row) => ({ ...row.metadata, id: row.id, characterId: row.character_id, assetId: row.asset_id, tenantId: row.tenant_id, category: row.category, angle: row.angle, expression: row.expression, captureStage: row.capture_stage, qualityStatus: row.quality_status, consentScope: row.consent_scope, metadata: row.metadata, createdAt: row.created_at })),
      characterVersions: characterVersions.rows.map((row) => ({ ...row.metadata, id: row.id, characterId: row.character_id, tenantId: row.tenant_id, version: row.version, status: row.status, provider: row.provider, providerModelId: row.provider_model_id, datasetSnapshot: row.dataset_snapshot, metadata: row.metadata, createdAt: row.created_at, updatedAt: row.updated_at })),
      errorIncidents: errorIncidents.rows.map((row) => ({
        id: row.id,
        incidentId: row.incident_id,
        errorCode: row.error_code,
        errorName: row.error_name,
        category: row.category,
        tenantId: row.tenant_id,
        userId: row.user_id,
        projectId: row.project_id,
        sessionId: row.session_id,
        batchId: row.batch_id,
        jobId: row.job_id,
        reservationId: row.reservation_id,
        assetId: row.asset_id,
        modality: row.modality,
        provider: row.provider,
        model: row.model,
        operation: row.operation,
        httpStatus: row.http_status,
        sanitizedProviderError: row.sanitized_provider_error,
        clientVisibleMessage: row.client_visible_message,
        technicalMessage: row.technical_message,
        browser: row.browser,
        route: row.route,
        retryable: row.retryable,
        creditsBefore: row.credits_before,
        creditsReserved: row.credits_reserved,
        creditsAfter: row.credits_after,
        reservationReleased: row.reservation_released,
        compensationEligible: row.compensation_eligible,
        reported: row.reported,
        reportedAt: row.reported_at,
        status: row.status,
        metadata: row.metadata || {},
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        resolvedAt: row.resolved_at
      })),
      compensationCoupons: compensationCoupons.rows.map((row) => ({
        id: row.id,
        tenantId: row.tenant_id,
        userId: row.user_id,
        incidentId: row.incident_id,
        code: row.code,
        discountPercent: row.discount_percent,
        status: row.status,
        stripeCouponId: row.stripe_coupon_id,
        promotionCodeId: row.promotion_code_id,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        redeemedAt: row.redeemed_at,
        metadata: row.metadata || {}
      })),
      providerDiagnostics: providerDiagnostics.rows.map((row) => ({
        provider: row.provider,
        status: row.status,
        errorName: row.error_name,
        errorCode: row.error_code,
        customerMessage: row.customer_message,
        checkedAt: row.checked_at,
        metadata: row.metadata || {}
      })),
      creativeReferences: creativeReferences.rows.map((row) => ({
        ...row.metadata,
        id: row.id,
        tenantId: row.tenant_id,
        userId: row.user_id,
        assetId: row.asset_id,
        projectId: row.project_id,
        sessionId: row.session_id,
        referenceType: row.reference_type,
        name: row.name,
        status: row.status,
        metadata: row.metadata || {},
        createdAt: row.created_at,
        updatedAt: row.updated_at
      })),
      scenes: scenes.rows.map((row) => ({
        ...row.metadata,
        ...row.parameters,
        id: row.id,
        tenantId: row.tenant_id,
        userId: row.user_id,
        projectId: row.project_id,
        sessionId: row.session_id,
        title: row.title,
        status: row.status,
        prompt: row.prompt,
        movementPrompt: row.movement_prompt,
        currentFrameAssetId: row.current_frame_asset_id,
        currentVideoAssetId: row.current_video_asset_id,
        parameters: row.parameters || {},
        metadata: row.metadata || {},
        createdAt: row.created_at,
        updatedAt: row.updated_at
      })),
      sceneItems: sceneItems.rows.map((row) => ({
        ...row.parameters,
        id: row.id,
        sceneId: row.scene_id,
        tenantId: row.tenant_id,
        itemType: row.item_type,
        assetId: row.asset_id,
        characterId: row.character_id,
        referenceId: row.reference_id,
        track: row.track,
        position: row.position,
        parameters: row.parameters || {},
        deletedAt: row.deleted_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      })),
      timelineItems: timelineItems.rows.map((row) => ({
        ...row.parameters,
        id: row.id,
        tenantId: row.tenant_id,
        projectId: row.project_id,
        sessionId: row.session_id,
        sceneId: row.scene_id,
        assetId: row.asset_id,
        trackType: row.track_type,
        startSeconds: Number(row.start_seconds || 0),
        sourceStartSeconds: Number(row.source_start_seconds || 0),
        durationSeconds: row.duration_seconds == null ? null : Number(row.duration_seconds),
        position: row.position,
        muted: row.muted,
        solo: row.solo,
        volume: Number(row.volume || 0),
        pan: Number(row.pan || 0),
        fadeInSeconds: Number(row.fade_in_seconds || 0),
        fadeOutSeconds: Number(row.fade_out_seconds || 0),
        parameters: row.parameters || {},
        deletedAt: row.deleted_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      })),
      workflows: workflows.rows.map((row) => ({
        ...row.metadata,
        id: row.id,
        tenantId: row.tenant_id,
        userId: row.user_id,
        projectId: row.project_id,
        name: row.name,
        status: row.status,
        description: row.description,
        metadata: row.metadata || {},
        createdAt: row.created_at,
        updatedAt: row.updated_at
      })),
      workflowNodes: workflowNodes.rows.map((row) => ({
        id: row.id,
        workflowId: row.workflow_id,
        tenantId: row.tenant_id,
        nodeType: row.node_type,
        label: row.label,
        position: row.position || {},
        configuration: row.configuration || {},
        createdAt: row.created_at,
        updatedAt: row.updated_at
      })),
      workflowEdges: workflowEdges.rows.map((row) => ({
        ...row.metadata,
        id: row.id,
        workflowId: row.workflow_id,
        tenantId: row.tenant_id,
        sourceNodeId: row.source_node_id,
        targetNodeId: row.target_node_id,
        metadata: row.metadata || {},
        createdAt: row.created_at
      })),
      appInstances: appInstances.rows.map((row) => ({
        ...row.configuration,
        id: row.id,
        tenantId: row.tenant_id,
        userId: row.user_id,
        projectId: row.project_id,
        sessionId: row.session_id,
        appType: row.app_type,
        title: row.title,
        status: row.status,
        configuration: row.configuration || {},
        createdAt: row.created_at,
        updatedAt: row.updated_at
      })),
      characterTrainings: characterTrainings.rows.map((row) => ({
        id: row.id,
        tenantId: row.tenant_id,
        userId: row.user_id,
        characterId: row.character_id,
        provider: row.provider,
        externalTrainingId: row.external_training_id,
        status: row.status,
        modelRef: row.model_ref,
        error: row.error,
        configuration: row.configuration || {},
        metadata: row.metadata || {},
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        completedAt: row.completed_at
      })),
      workflowRuns: workflowRuns.rows.map((row) => ({
        id: row.id,
        tenantId: row.tenant_id,
        userId: row.user_id,
        workflowId: row.workflow_id,
        projectId: row.project_id,
        sessionId: row.session_id,
        status: row.status,
        input: row.input || {},
        output: row.output || {},
        error: row.error,
        createdAt: row.created_at,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        updatedAt: row.updated_at
      })),
      workflowNodeRuns: workflowNodeRuns.rows.map((row) => ({
        id: row.id,
        tenantId: row.tenant_id,
        workflowRunId: row.workflow_run_id,
        workflowNodeId: row.workflow_node_id,
        jobId: row.job_id,
        status: row.status,
        input: row.input || {},
        output: row.output || {},
        error: row.error,
        attempt: row.attempt,
        createdAt: row.created_at,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        updatedAt: row.updated_at
      }))
    };
  }

  async saveState({ state, reason = "runtime_persist" } = {}) {
    const tenantId = defaultTenantId(state);
    const user = state.user || {};
    const subscription = state.subscription || {};
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `insert into tenants (id, name, plan_code)
         values ($1, $2, $3)
         on conflict (id) do update set name = excluded.name, plan_code = excluded.plan_code, updated_at = now()`,
        [tenantId, user.username || tenantId, subscription.plan || user.plan || "Free"]
      );
      await client.query(
        `insert into users (id, tenant_id, email, display_name, role)
         values ($1, $2, $3, $4, $5)
         on conflict (id) do update set tenant_id = excluded.tenant_id, email = excluded.email, display_name = excluded.display_name, role = excluded.role, updated_at = now()`,
        [user.id || tenantId, tenantId, user.email || null, user.username || null, user.role || "user"]
      );
      // Wallet balances are changed only by the atomic ledger methods above.
      await this.persistCollections({ tenantId, state, client });
      await client.query(
        `insert into runtime_state_snapshots (id, payload, reason)
         values ($1, $2::jsonb, $3)
         on conflict (id) do update set payload = excluded.payload, reason = excluded.reason, updated_at = now()`,
        ["default", json({ ...state, assets: safeArray(state.assets).map(stripRuntimeOnlyFields) }), reason]
      );
      await client.query("commit");
      this.lastSavedAt = new Date().toISOString();
      this.lastError = null;
      return { ok: true, durable: true, savedAt: this.lastSavedAt };
    } catch (error) {
      await client.query("rollback");
      this.lastError = error.message;
      throw error;
    } finally {
      client.release();
    }
  }

  async persistCollections({ tenantId, state, client = this.pool }) {
    const tenantUsers = new Map();
    for (const record of [
      ...safeArray(state.projects),
      ...safeArray(state.generationSessions),
      ...safeArray(state.generationBatches),
      ...safeArray(state.jobs),
      ...safeArray(state.assets),
      ...safeArray(state.creativeReferences),
      ...safeArray(state.scenes),
      ...safeArray(state.workflows),
      ...safeArray(state.appInstances),
      ...safeArray(state.characterTrainings),
      ...safeArray(state.workflowRuns),
      ...safeArray(state.workflowNodeRuns),
      ...safeArray(state.errorIncidents),
      ...safeArray(state.compensationCoupons)
    ]) {
      const recordTenantId = record.tenantId || tenantId;
      if (!tenantUsers.has(recordTenantId)) tenantUsers.set(recordTenantId, new Set());
      if (record.userId) tenantUsers.get(recordTenantId).add(record.userId);
    }
    for (const [recordTenantId, userIds] of tenantUsers) {
      await client.query(
        `insert into tenants (id, name, plan_code)
         values ($1, $1, 'Free')
         on conflict (id) do nothing`,
        [recordTenantId]
      );
      for (const userId of userIds) {
        await client.query(
          `insert into users (id, tenant_id, role)
           values ($1, $2, 'user')
           on conflict (id) do update set tenant_id = excluded.tenant_id, updated_at = now()`,
          [userId, recordTenantId]
        );
      }
    }

    for (const project of safeArray(state.projects)) {
      await client.query(
        `insert into projects (id, tenant_id, user_id, title, kind, metadata, created_at, updated_at)
         values ($1,$2,$3,$4,$5,$6::jsonb,coalesce($7, now()),coalesce($8, now()))
         on conflict (id) do update set title = excluded.title, kind = excluded.kind, metadata = excluded.metadata, updated_at = excluded.updated_at`,
        [
          project.id,
          project.tenantId || tenantId,
          project.userId || null,
          project.title || "Untitled project",
          project.kind || null,
          json(project),
          dateOrNull(project.createdAt),
          dateOrNull(project.updatedAt)
        ]
      );
    }
    for (const session of safeArray(state.generationSessions)) {
      await client.query(
        `insert into generation_sessions (id, tenant_id, user_id, project_id, title, status, metadata, created_at, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7::jsonb,coalesce($8, now()),coalesce($9, now()))
         on conflict (id) do update set title = excluded.title, status = excluded.status, metadata = excluded.metadata, updated_at = excluded.updated_at`,
        [
          session.id,
          session.tenantId || tenantId,
          session.userId || null,
          session.projectId || null,
          session.title || null,
          session.status || "ACTIVE",
          json(session.metadata || session),
          dateOrNull(session.createdAt),
          dateOrNull(session.updatedAt)
        ]
      );
    }
    for (const batch of safeArray(state.generationBatches)) {
      await client.query(
        `insert into generation_batches
          (id, tenant_id, user_id, project_id, session_id, modality, operation, provider, model, status,
           requested_outputs, completed_outputs, failed_outputs, cancelled_outputs, reserved_credits,
           captured_credits, released_credits, idempotency_key, parameters, created_at, updated_at, completed_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,coalesce($20, now()),coalesce($21, now()),$22)
         on conflict (id) do update set status = excluded.status, completed_outputs = excluded.completed_outputs,
           failed_outputs = excluded.failed_outputs, cancelled_outputs = excluded.cancelled_outputs,
           captured_credits = excluded.captured_credits, released_credits = excluded.released_credits,
           parameters = excluded.parameters, updated_at = excluded.updated_at, completed_at = excluded.completed_at`,
        [
          batch.id,
          batch.tenantId || tenantId,
          batch.userId || null,
          batch.projectId || null,
          batch.sessionId || null,
          batch.modality || String(batch.kind || "unknown").toUpperCase(),
          batch.operation || null,
          batch.provider || null,
          batch.model || null,
          batch.status || "PENDING",
          Number(batch.requestedOutputs || 1),
          Number(batch.completedOutputs || 0),
          Number(batch.failedOutputs || 0),
          Number(batch.cancelledOutputs || 0),
          Number(batch.reservedCredits || 0),
          Number(batch.capturedCredits || 0),
          Number(batch.releasedCredits || 0),
          batch.idempotencyKey || batch.id,
          json(batch.parameters || {}),
          dateOrNull(batch.createdAt),
          dateOrNull(batch.updatedAt),
          dateOrNull(batch.completedAt)
        ]
      );
    }
    for (const transaction of safeArray(state.creditTransactions)) {
      await client.query(
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
      await client.query(
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
      await client.query(
        `insert into jobs
          (id, tenant_id, user_id, kind, provider, model, prompt, status, reservation_id,
           provider_request_id, output_url, output_urls, error, metadata, created_at, updated_at,
           completed_at, batch_id, project_id, session_id, modality, operation, parameters,
           progress, asset_id, batch_index, retry_of_job_id, error_incident_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14::jsonb,
           coalesce($15, now()),coalesce($16, now()),$17,$18,$19,$20,$21,$22,$23::jsonb,
           $24,$25,$26,$27,$28)
         on conflict (id) do update set
           status = excluded.status,
           provider = excluded.provider,
           model = excluded.model,
           provider_request_id = excluded.provider_request_id,
           output_url = excluded.output_url,
           output_urls = excluded.output_urls,
           error = excluded.error,
           metadata = excluded.metadata,
           batch_id = excluded.batch_id,
           project_id = excluded.project_id,
           session_id = excluded.session_id,
           modality = excluded.modality,
           operation = excluded.operation,
           parameters = excluded.parameters,
           progress = excluded.progress,
           asset_id = excluded.asset_id,
           batch_index = excluded.batch_index,
           retry_of_job_id = excluded.retry_of_job_id,
           error_incident_id = excluded.error_incident_id,
           updated_at = excluded.updated_at,
           completed_at = excluded.completed_at`,
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
          dateOrNull(job.completedAt),
          job.batchId || null,
          job.projectId || null,
          job.sessionId || null,
          job.modality || String(job.kind || "unknown").toUpperCase(),
          job.operation || job.tool || null,
          json(job.parameters || {}),
          Math.max(0, Math.min(100, Number(job.progress || 0))),
          job.assetId || null,
          Number.isInteger(job.batchIndex) ? job.batchIndex : null,
          job.retryOfJobId || null,
          job.incidentId || null
        ]
      );
    }
    const orderedAssets = [...safeArray(state.assets)].sort((left, right) => {
      const versionDelta = Number(left.version || 1) - Number(right.version || 1);
      if (versionDelta !== 0) return versionDelta;
      return new Date(left.createdAt || 0).getTime() - new Date(right.createdAt || 0).getTime();
    });
    for (const asset of orderedAssets) {
      const safeAsset = stripRuntimeOnlyFields(asset);
      await client.query(
        `insert into assets
          (id, tenant_id, user_id, job_id, kind, provider, role, original_name, original_url,
           public_url, storage_key, content_type, bytes, status, metadata, created_at,
           project_id, session_id, batch_id, parent_asset_id, version, display_name,
           version_type, parent_version_id, deleted_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,
           coalesce($16, now()),$17,$18,$19,$20,$21,$22,$23,$24,$25)
         on conflict (id) do update set
           public_url = excluded.public_url,
           status = excluded.status,
           metadata = excluded.metadata,
           project_id = excluded.project_id,
           session_id = excluded.session_id,
           batch_id = excluded.batch_id,
           parent_asset_id = excluded.parent_asset_id,
           version = excluded.version,
           display_name = excluded.display_name,
           version_type = excluded.version_type,
           parent_version_id = excluded.parent_version_id,
           deleted_at = excluded.deleted_at`,
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
          dateOrNull(safeAsset.createdAt),
          safeAsset.projectId || null,
          safeAsset.sessionId || null,
          safeAsset.batchId || null,
          safeAsset.parentAssetId || null,
          Math.max(1, Number(safeAsset.version || 1)),
          safeAsset.displayName || safeAsset.originalName || null,
          safeAsset.versionType || "GENERATION",
          safeAsset.parentVersionId || null,
          dateOrNull(safeAsset.deletedAt)
        ]
      );
    }
    for (const entry of safeArray(state.history)) {
      await client.query(
        `insert into history_entries
          (id, tenant_id, user_id, job_id, batch_id, project_id, session_id, kind, title, provider, status, result, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,coalesce($13, now()))
         on conflict (id) do update set
           user_id = excluded.user_id,
           job_id = excluded.job_id,
           batch_id = excluded.batch_id,
           project_id = excluded.project_id,
           session_id = excluded.session_id,
           kind = excluded.kind,
           title = excluded.title,
           status = excluded.status,
           provider = excluded.provider,
           result = excluded.result`,
        [
          entry.id,
          entry.tenantId || tenantId,
          entry.userId || null,
          entry.jobId || null,
          entry.batchId || null,
          entry.projectId || null,
          entry.sessionId || null,
          entry.kind || "generation",
          entry.title || null,
          entry.provider || null,
          entry.status || null,
          json(entry.result || entry),
          dateOrNull(entry.createdAt)
        ]
      );
    }
    for (const event of safeArray(state.webhookEvents)) {
      const eventId = event.eventKey || event.eventId || event.id;
      await client.query(
        `insert into webhook_events
          (id, provider, event_id, job_id, status, payload, processed_at, created_at)
         values ($1,$2,$3,$4,$5,$6::jsonb,$7,coalesce($8, now()))
         on conflict (provider, event_id) do update set
           job_id = excluded.job_id,
           status = excluded.status,
           payload = excluded.payload,
           processed_at = excluded.processed_at`,
        [
          event.id || `webhook_${cryptoRandomId()}`,
          event.provider || "unknown",
          eventId,
          event.jobId || null,
          event.status || "received",
          json(event.payload || event.event || {}),
          dateOrNull(event.processedAt || event.receivedAt),
          dateOrNull(event.createdAt || event.receivedAt)
        ]
      );
    }
    for (const event of safeArray(state.paymentEvents)) {
      const eventId = event.eventKey || event.eventId || event.id;
      await client.query(
        `insert into payment_events
          (id, provider, event_id, tenant_id, status, payload, processed_at, created_at)
         values ($1,$2,$3,$4,$5,$6::jsonb,$7,coalesce($8, now()))
         on conflict (event_id) do update set
           tenant_id = excluded.tenant_id,
           status = excluded.status,
           payload = excluded.payload,
           processed_at = excluded.processed_at`,
        [
          event.id || `payment_${cryptoRandomId()}`,
          event.provider || "stripe",
          eventId,
          event.tenantId || null,
          event.status || "processed",
          json(event.payload || event),
          dateOrNull(event.processedAt || event.receivedAt),
          dateOrNull(event.createdAt || event.receivedAt)
        ]
      );
    }
    for (const form of safeArray(state.forms)) {
      await client.query(
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
      await client.query(
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
    for (const character of safeArray(state.characters)) {
      await client.query(
        `insert into characters (id, tenant_id, user_id, name, slug, description, status, primary_asset_id, dataset_status, training_provider, provider_model_id, metadata, created_at, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,coalesce($13, now()),coalesce($14, now()))
         on conflict (id) do update set name = excluded.name, description = excluded.description, status = excluded.status, primary_asset_id = excluded.primary_asset_id, dataset_status = excluded.dataset_status, training_provider = excluded.training_provider, provider_model_id = excluded.provider_model_id, metadata = excluded.metadata, updated_at = now()`,
        [
          character.id,
          character.tenantId || tenantId,
          character.userId || null,
          character.name || "Untitled character",
          character.slug || null,
          character.description || null,
          character.status || "draft",
          character.primaryAssetId || null,
          character.datasetStatus || "collecting",
          character.trainingProvider || null,
          character.providerModelId || null,
          json(character.metadata || {}),
          dateOrNull(character.createdAt),
          dateOrNull(character.updatedAt)
        ]
      );
    }
    for (const consent of safeArray(state.characterConsents)) {
      await client.query(
        `insert into character_consents (id, character_id, tenant_id, subject_user_id, subject_name, status, scope, evidence_asset_id, signed_at, revoked_at, metadata, created_at, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11::jsonb,coalesce($12, now()),coalesce($13, now()))
         on conflict (id) do update set status = excluded.status, scope = excluded.scope, evidence_asset_id = excluded.evidence_asset_id, signed_at = excluded.signed_at, revoked_at = excluded.revoked_at, metadata = excluded.metadata, updated_at = now()`,
        [
          consent.id,
          consent.characterId,
          consent.tenantId || tenantId,
          consent.subjectUserId || null,
          consent.subjectName || "Unnamed subject",
          consent.status || "pending",
          json(consent.scope || {}),
          consent.evidenceAssetId || null,
          dateOrNull(consent.signedAt),
          dateOrNull(consent.revokedAt),
          json(consent.metadata || {}),
          dateOrNull(consent.createdAt),
          dateOrNull(consent.updatedAt)
        ]
      );
    }
    for (const capture of safeArray(state.characterCaptureSessions)) {
      await client.query(
        `insert into character_capture_sessions (id, character_id, tenant_id, stage, status, requirements, progress, metadata, created_at, updated_at)
         values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,coalesce($9, now()),coalesce($10, now()))
         on conflict (id) do update set status = excluded.status, requirements = excluded.requirements, progress = excluded.progress, metadata = excluded.metadata, updated_at = now()`,
        [
          capture.id,
          capture.characterId,
          capture.tenantId || tenantId,
          capture.stage || "identity",
          capture.status || "open",
          json(capture.requirements || {}),
          json(capture.progress || {}),
          json(capture.metadata || {}),
          dateOrNull(capture.createdAt),
          dateOrNull(capture.updatedAt)
        ]
      );
    }
    for (const link of safeArray(state.characterAssets)) {
      await client.query(
        `insert into character_assets (id, character_id, asset_id, tenant_id, category, angle, expression, capture_stage, quality_status, consent_scope, metadata, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,coalesce($12, now()))
         on conflict (character_id, asset_id) do update set category = excluded.category, angle = excluded.angle, expression = excluded.expression, capture_stage = excluded.capture_stage, quality_status = excluded.quality_status, consent_scope = excluded.consent_scope, metadata = excluded.metadata`,
        [
          link.id,
          link.characterId,
          link.assetId,
          link.tenantId || tenantId,
          link.category || "identity_photo",
          link.angle || null,
          link.expression || null,
          link.captureStage || null,
          link.qualityStatus || "pending",
          link.consentScope || null,
          json(link.metadata || {}),
          dateOrNull(link.createdAt)
        ]
      );
    }
    for (const version of safeArray(state.characterVersions)) {
      await client.query(
        `insert into character_versions (id, character_id, tenant_id, version, status, provider, provider_model_id, dataset_snapshot, metadata, created_at, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,coalesce($10, now()),coalesce($11, now()))
         on conflict (character_id, version) do update set status = excluded.status, provider = excluded.provider, provider_model_id = excluded.provider_model_id, dataset_snapshot = excluded.dataset_snapshot, metadata = excluded.metadata, updated_at = now()`,
        [
          version.id,
          version.characterId,
          version.tenantId || tenantId,
          Number(version.version || 1),
          version.status || "dataset_ready",
          version.provider || null,
          version.providerModelId || null,
          json(version.datasetSnapshot || {}),
          json(version.metadata || {}),
          dateOrNull(version.createdAt),
          dateOrNull(version.updatedAt)
        ]
      );
    }
    for (const reference of safeArray(state.creativeReferences)) {
      await client.query(
        `insert into creative_references
          (id, tenant_id, user_id, asset_id, project_id, session_id, reference_type, name,
           status, metadata, created_at, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,coalesce($11, now()),coalesce($12, now()))
         on conflict (id) do update set
           asset_id = excluded.asset_id,
           project_id = excluded.project_id,
           session_id = excluded.session_id,
           reference_type = excluded.reference_type,
           name = excluded.name,
           status = excluded.status,
           metadata = excluded.metadata,
           updated_at = excluded.updated_at`,
        [
          reference.id,
          reference.tenantId || tenantId,
          reference.userId || null,
          reference.assetId,
          reference.projectId || null,
          reference.sessionId || null,
          reference.referenceType || "IMAGE",
          reference.name || "Untitled reference",
          reference.status || "ACTIVE",
          json(reference.metadata || {}),
          dateOrNull(reference.createdAt),
          dateOrNull(reference.updatedAt)
        ]
      );
    }
    for (const scene of safeArray(state.scenes)) {
      await client.query(
        `insert into scenes
          (id, tenant_id, user_id, project_id, session_id, title, status, prompt,
           movement_prompt, current_frame_asset_id, current_video_asset_id, parameters,
           metadata, created_at, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,
           coalesce($14, now()),coalesce($15, now()))
         on conflict (id) do update set
           project_id = excluded.project_id,
           session_id = excluded.session_id,
           title = excluded.title,
           status = excluded.status,
           prompt = excluded.prompt,
           movement_prompt = excluded.movement_prompt,
           current_frame_asset_id = excluded.current_frame_asset_id,
           current_video_asset_id = excluded.current_video_asset_id,
           parameters = excluded.parameters,
           metadata = excluded.metadata,
           updated_at = excluded.updated_at`,
        [
          scene.id,
          scene.tenantId || tenantId,
          scene.userId || null,
          scene.projectId || null,
          scene.sessionId || null,
          scene.title || "Untitled scene",
          scene.status || "DRAFT",
          scene.prompt || null,
          scene.movementPrompt || null,
          scene.currentFrameAssetId || null,
          scene.currentVideoAssetId || null,
          json(scene.parameters || {}),
          json(scene.metadata || {}),
          dateOrNull(scene.createdAt),
          dateOrNull(scene.updatedAt)
        ]
      );
    }
    for (const item of safeArray(state.sceneItems)) {
      await client.query(
        `insert into scene_items
          (id, scene_id, tenant_id, item_type, asset_id, character_id, reference_id,
           track, position, parameters, deleted_at, created_at, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,coalesce($12, now()),coalesce($13, now()))
         on conflict (id) do update set
           item_type = excluded.item_type,
           asset_id = excluded.asset_id,
           character_id = excluded.character_id,
           reference_id = excluded.reference_id,
           track = excluded.track,
           position = excluded.position,
           parameters = excluded.parameters,
           deleted_at = excluded.deleted_at,
           updated_at = excluded.updated_at`,
        [
          item.id,
          item.sceneId,
          item.tenantId || tenantId,
          item.itemType || "ASSET",
          item.assetId || null,
          item.characterId || null,
          item.referenceId || null,
          item.track || null,
          Number(item.position || 0),
          json(item.parameters || {}),
          dateOrNull(item.deletedAt),
          dateOrNull(item.createdAt),
          dateOrNull(item.updatedAt)
        ]
      );
    }
    for (const item of safeArray(state.timelineItems)) {
      await client.query(
        `insert into timeline_items
          (id, tenant_id, project_id, session_id, scene_id, asset_id, track_type,
           start_seconds, source_start_seconds, duration_seconds, position, muted, solo, volume, pan,
           fade_in_seconds, fade_out_seconds, parameters, deleted_at, created_at, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19,
           coalesce($20, now()),coalesce($21, now()))
         on conflict (id) do update set
           project_id = excluded.project_id,
           session_id = excluded.session_id,
           scene_id = excluded.scene_id,
           asset_id = excluded.asset_id,
           track_type = excluded.track_type,
           start_seconds = excluded.start_seconds,
           source_start_seconds = excluded.source_start_seconds,
           duration_seconds = excluded.duration_seconds,
           position = excluded.position,
           muted = excluded.muted,
           solo = excluded.solo,
           volume = excluded.volume,
           pan = excluded.pan,
           fade_in_seconds = excluded.fade_in_seconds,
           fade_out_seconds = excluded.fade_out_seconds,
           parameters = excluded.parameters,
           deleted_at = excluded.deleted_at,
           updated_at = excluded.updated_at`,
        [
          item.id,
          item.tenantId || tenantId,
          item.projectId || null,
          item.sessionId || null,
          item.sceneId || null,
          item.assetId || null,
          item.trackType || "VIDEO",
          Number(item.startSeconds || 0),
          Number(item.sourceStartSeconds || 0),
          item.durationSeconds == null ? null : Number(item.durationSeconds),
          Number(item.position || 0),
          Boolean(item.muted),
          Boolean(item.solo),
          Number(item.volume ?? 1),
          Number(item.pan || 0),
          Number(item.fadeInSeconds || 0),
          Number(item.fadeOutSeconds || 0),
          json(item.parameters || {}),
          dateOrNull(item.deletedAt),
          dateOrNull(item.createdAt),
          dateOrNull(item.updatedAt)
        ]
      );
    }
    for (const workflow of safeArray(state.workflows)) {
      await client.query(
        `insert into workflows
          (id, tenant_id, user_id, project_id, name, status, description, metadata, created_at, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,coalesce($9, now()),coalesce($10, now()))
         on conflict (id) do update set
           project_id = excluded.project_id,
           name = excluded.name,
           status = excluded.status,
           description = excluded.description,
           metadata = excluded.metadata,
           updated_at = excluded.updated_at`,
        [
          workflow.id,
          workflow.tenantId || tenantId,
          workflow.userId || null,
          workflow.projectId || null,
          workflow.name || "Untitled workflow",
          workflow.status || "DRAFT",
          workflow.description || null,
          json(workflow.metadata || {}),
          dateOrNull(workflow.createdAt),
          dateOrNull(workflow.updatedAt)
        ]
      );
    }
    for (const node of safeArray(state.workflowNodes)) {
      await client.query(
        `insert into workflow_nodes
          (id, workflow_id, tenant_id, node_type, label, position, configuration, created_at, updated_at)
         values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,coalesce($8, now()),coalesce($9, now()))
         on conflict (id) do update set
           node_type = excluded.node_type,
           label = excluded.label,
           position = excluded.position,
           configuration = excluded.configuration,
           updated_at = excluded.updated_at`,
        [
          node.id,
          node.workflowId,
          node.tenantId || tenantId,
          node.nodeType || "UTILITY",
          node.label || "Untitled node",
          json(node.position || {}),
          json(node.configuration || {}),
          dateOrNull(node.createdAt),
          dateOrNull(node.updatedAt)
        ]
      );
    }
    for (const edge of safeArray(state.workflowEdges)) {
      await client.query(
        `insert into workflow_edges
          (id, workflow_id, tenant_id, source_node_id, target_node_id, metadata, created_at)
         values ($1,$2,$3,$4,$5,$6::jsonb,coalesce($7, now()))
         on conflict (id) do update set
           source_node_id = excluded.source_node_id,
           target_node_id = excluded.target_node_id,
           metadata = excluded.metadata`,
        [
          edge.id,
          edge.workflowId,
          edge.tenantId || tenantId,
          edge.sourceNodeId,
          edge.targetNodeId,
          json(edge.metadata || {}),
          dateOrNull(edge.createdAt)
        ]
      );
    }
    for (const instance of safeArray(state.appInstances)) {
      await client.query(
        `insert into creative_app_instances
          (id, tenant_id, user_id, project_id, session_id, app_type, title, status,
           configuration, created_at, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,coalesce($10, now()),coalesce($11, now()))
         on conflict (id) do update set
           project_id = excluded.project_id,
           session_id = excluded.session_id,
           title = excluded.title,
           status = excluded.status,
           configuration = excluded.configuration,
           updated_at = excluded.updated_at`,
        [
          instance.id,
          instance.tenantId || tenantId,
          instance.userId || null,
          instance.projectId || null,
          instance.sessionId || null,
          instance.appType || "CUSTOM",
          instance.title || "Untitled application",
          instance.status || "DRAFT",
          json(instance.configuration || {}),
          dateOrNull(instance.createdAt),
          dateOrNull(instance.updatedAt)
        ]
      );
    }
    for (const training of safeArray(state.characterTrainings)) {
      await client.query(
        `insert into character_trainings
          (id, tenant_id, user_id, character_id, provider, external_training_id, status,
           model_ref, error, configuration, metadata, created_at, updated_at, completed_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,
           coalesce($12, now()),coalesce($13, now()),$14)
         on conflict (id) do update set
           provider = excluded.provider,
           external_training_id = excluded.external_training_id,
           status = excluded.status,
           model_ref = excluded.model_ref,
           error = excluded.error,
           configuration = excluded.configuration,
           metadata = excluded.metadata,
           updated_at = excluded.updated_at,
           completed_at = excluded.completed_at`,
        [
          training.id,
          training.tenantId || tenantId,
          training.userId || null,
          training.characterId,
          training.provider || null,
          training.externalTrainingId || null,
          training.status || "DATASET",
          training.modelRef || null,
          training.error || null,
          json(training.configuration || {}),
          json(training.metadata || {}),
          dateOrNull(training.createdAt),
          dateOrNull(training.updatedAt),
          dateOrNull(training.completedAt)
        ]
      );
    }
    for (const run of safeArray(state.workflowRuns)) {
      await client.query(
        `insert into workflow_runs
          (id, tenant_id, user_id, workflow_id, project_id, session_id, status, input,
           output, error, created_at, started_at, completed_at, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,
           coalesce($11, now()),$12,$13,coalesce($14, now()))
         on conflict (id) do update set
           status = excluded.status,
           input = excluded.input,
           output = excluded.output,
           error = excluded.error,
           started_at = excluded.started_at,
           completed_at = excluded.completed_at,
           updated_at = excluded.updated_at`,
        [
          run.id,
          run.tenantId || tenantId,
          run.userId || null,
          run.workflowId,
          run.projectId || null,
          run.sessionId || null,
          run.status || "PENDING",
          json(run.input || {}),
          json(run.output || {}),
          json(run.error || null),
          dateOrNull(run.createdAt),
          dateOrNull(run.startedAt),
          dateOrNull(run.completedAt),
          dateOrNull(run.updatedAt)
        ]
      );
    }
    for (const nodeRun of safeArray(state.workflowNodeRuns)) {
      await client.query(
        `insert into workflow_node_runs
          (id, tenant_id, workflow_run_id, workflow_node_id, job_id, status, input,
           output, error, attempt, created_at, started_at, completed_at, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,
           coalesce($11, now()),$12,$13,coalesce($14, now()))
         on conflict (id) do update set
           job_id = excluded.job_id,
           status = excluded.status,
           input = excluded.input,
           output = excluded.output,
           error = excluded.error,
           attempt = excluded.attempt,
           started_at = excluded.started_at,
           completed_at = excluded.completed_at,
           updated_at = excluded.updated_at`,
        [
          nodeRun.id,
          nodeRun.tenantId || tenantId,
          nodeRun.workflowRunId,
          nodeRun.workflowNodeId,
          nodeRun.jobId || null,
          nodeRun.status || "PENDING",
          json(nodeRun.input || {}),
          json(nodeRun.output || {}),
          json(nodeRun.error || null),
          Math.max(1, Number(nodeRun.attempt || 1)),
          dateOrNull(nodeRun.createdAt),
          dateOrNull(nodeRun.startedAt),
          dateOrNull(nodeRun.completedAt),
          dateOrNull(nodeRun.updatedAt)
        ]
      );
    }
    for (const incident of safeArray(state.errorIncidents)) {
      await client.query(
        `insert into error_incidents
          (id, incident_id, error_code, error_name, category, tenant_id, user_id, project_id,
           session_id, batch_id, job_id, reservation_id, asset_id, modality, provider, model,
           operation, http_status, sanitized_provider_error, client_visible_message,
           technical_message, browser, route, retryable, credits_before, credits_reserved,
           credits_after, reservation_released, compensation_eligible, reported, reported_at,
           status, metadata, created_at, updated_at, resolved_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
           $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33::jsonb,coalesce($34, now()),coalesce($35, now()),$36)
         on conflict (incident_id) do update set
           reported = excluded.reported,
           reported_at = excluded.reported_at,
           status = excluded.status,
           metadata = excluded.metadata,
           updated_at = excluded.updated_at,
           resolved_at = excluded.resolved_at`,
        [
          incident.id || incident.incidentId,
          incident.incidentId || incident.id,
          incident.errorCode,
          incident.errorName,
          incident.category,
          incident.tenantId || tenantId,
          incident.userId || null,
          incident.projectId || null,
          incident.sessionId || null,
          incident.batchId || null,
          incident.jobId || null,
          incident.reservationId || null,
          incident.assetId || null,
          incident.modality || null,
          incident.provider || null,
          incident.model || null,
          incident.operation || null,
          Number.isFinite(Number(incident.httpStatus)) ? Number(incident.httpStatus) : null,
          incident.sanitizedProviderError || null,
          incident.clientVisibleMessage || "The studio could not complete this operation.",
          incident.technicalMessage || "Unclassified SLT incident.",
          incident.browser || null,
          incident.route || null,
          Boolean(incident.retryable),
          Number.isFinite(Number(incident.creditsBefore)) ? Number(incident.creditsBefore) : null,
          Number.isFinite(Number(incident.creditsReserved)) ? Number(incident.creditsReserved) : null,
          Number.isFinite(Number(incident.creditsAfter)) ? Number(incident.creditsAfter) : null,
          Boolean(incident.reservationReleased),
          Boolean(incident.compensationEligible),
          Boolean(incident.reported),
          dateOrNull(incident.reportedAt),
          incident.status || "OPEN",
          json(incident.metadata || {}),
          dateOrNull(incident.createdAt),
          dateOrNull(incident.updatedAt),
          dateOrNull(incident.resolvedAt)
        ]
      );
    }
    for (const coupon of safeArray(state.compensationCoupons)) {
      await client.query(
        `insert into compensation_coupons
          (id, tenant_id, user_id, incident_id, code, discount_percent, status,
           stripe_coupon_id, promotion_code_id, created_at, expires_at, redeemed_at, metadata)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,coalesce($10, now()),$11,$12,$13::jsonb)
         on conflict (incident_id) do update set
           status = excluded.status,
           stripe_coupon_id = excluded.stripe_coupon_id,
           promotion_code_id = excluded.promotion_code_id,
           redeemed_at = excluded.redeemed_at,
           metadata = excluded.metadata`,
        [
          coupon.id,
          coupon.tenantId || tenantId,
          coupon.userId || null,
          coupon.incidentId,
          coupon.code,
          Number(coupon.discountPercent || 5),
          coupon.status || "ACTIVE",
          coupon.stripeCouponId || null,
          coupon.promotionCodeId || null,
          dateOrNull(coupon.createdAt),
          dateOrNull(coupon.expiresAt),
          dateOrNull(coupon.redeemedAt),
          json(coupon.metadata || {})
        ]
      );
    }
    for (const diagnostic of safeArray(state.providerDiagnostics)) {
      await client.query(
        `insert into provider_diagnostics
          (provider, status, error_name, error_code, customer_message, checked_at, metadata)
         values ($1,$2,$3,$4,$5,coalesce($6, now()),$7::jsonb)
         on conflict (provider) do update set
           status = excluded.status,
           error_name = excluded.error_name,
           error_code = excluded.error_code,
           customer_message = excluded.customer_message,
           checked_at = excluded.checked_at,
           metadata = excluded.metadata`,
        [
          diagnostic.provider,
          diagnostic.status || "UNKNOWN",
          diagnostic.errorName || null,
          diagnostic.errorCode || null,
          diagnostic.customerMessage || null,
          dateOrNull(diagnostic.checkedAt),
          json(diagnostic.metadata || {})
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
  migrations.push("migrations/003_character_lab.sql");
  migrations.push("migrations/004_unified_generation_batches.sql");
  migrations.push("migrations/005_error_incidents_and_compensation.sql");
  migrations.push("migrations/006_multimodal_workspace.sql");
  migrations.push("migrations/007_history_linkage.sql");
  migrations.push("migrations/008_functional_closure.sql");
  return new PostgresRuntimeStore({
    databaseUrl: env.DATABASE_URL,
    migrations
  });
}
