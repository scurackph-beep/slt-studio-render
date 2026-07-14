import crypto from "node:crypto";
import pg from "pg";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL is required to verify Supabase/Postgres persistence.");
  process.exit(1);
}

function id(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

async function makePool() {
  return new Pool({
    connectionString: databaseUrl,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined
  });
}

const tenantId = id("tenant");
const userId = id("user");
const projectId = id("project");
const formId = id("form");
const jobId = id("job");

let pool = await makePool();
try {
  await pool.query("begin");
  await pool.query("insert into tenants (id, name, plan_code) values ($1, $2, $3)", [tenantId, "SLT Persistence Test", "test"]);
  await pool.query("insert into users (id, tenant_id, email, display_name, role) values ($1, $2, $3, $4, $5)", [
    userId,
    tenantId,
    "persistence-test@sweetlittletrauma.studio",
    "Persistence Test",
    "authenticated"
  ]);
  await pool.query("insert into wallets (tenant_id, available_credits, held_credits, captured_credits) values ($1, $2, $3, $4)", [
    tenantId,
    1000,
    0,
    0
  ]);
  await pool.query("insert into projects (id, tenant_id, user_id, title, kind, metadata) values ($1,$2,$3,$4,$5,$6::jsonb)", [
    projectId,
    tenantId,
    userId,
    "Persistence smoke project",
    "image",
    JSON.stringify({ test: true })
  ]);
  await pool.query("insert into platform_forms (id, tenant_id, user_id, kind, email, subject, message) values ($1,$2,$3,$4,$5,$6,$7)", [
    formId,
    tenantId,
    userId,
    "support",
    "persistence-test@sweetlittletrauma.studio",
    "Persistence smoke form",
    "This form verifies durable storage."
  ]);
  await pool.query("insert into jobs (id, tenant_id, user_id, kind, provider, prompt, status, metadata) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)", [
    jobId,
    tenantId,
    userId,
    "image",
    "persistence-test",
    "verify durable jobs",
    "IN_QUEUE",
    JSON.stringify({ test: true })
  ]);
  await pool.query("commit");
} catch (error) {
  await pool.query("rollback");
  throw error;
} finally {
  await pool.end();
}

pool = await makePool();
try {
  const result = await pool.query(
    `select
      (select count(*) from users where id = $1) as users,
      (select count(*) from projects where id = $2) as projects,
      (select count(*) from platform_forms where id = $3) as forms,
      (select count(*) from jobs where id = $4) as jobs`,
    [userId, projectId, formId, jobId]
  );
  const row = result.rows[0];
  const ok = ["users", "projects", "forms", "jobs"].every((key) => Number(row[key]) === 1);
  console.log(JSON.stringify({ ok, tenantId, userId, projectId, formId, jobId, counts: row }, null, 2));
  if (!ok) process.exit(2);
} finally {
  await pool.end();
}

