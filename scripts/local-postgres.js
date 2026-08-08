import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";

const { Pool } = pg;
export const LOCAL_DATABASE = "slt_studio";
export const LOCAL_DATABASE_PORT = Number(process.env.SLT_LOCAL_POSTGRES_PORT || 55432);
export const LOCAL_DATABASE_URL = `postgresql://slt_app:slt_local_only@127.0.0.1:${LOCAL_DATABASE_PORT}/${LOCAL_DATABASE}`;

function databaseDirectory() {
  return resolve(process.env.SLT_LOCAL_POSTGRES_DIR || ".local/postgres");
}

export async function startLocalPostgres() {
  const directory = databaseDirectory();
  mkdirSync(dirname(directory), { recursive: true });
  const server = new EmbeddedPostgres({
    databaseDir: directory,
    user: "slt_app",
    password: "slt_local_only",
    port: LOCAL_DATABASE_PORT,
    persistent: true,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    onLog: (message) => {
      if (process.env.SLT_LOCAL_POSTGRES_DEBUG === "true") process.stderr.write(String(message || ""));
    },
    onError: (message) => {
      const text = String(message || "");
      if (!/already exists|already running/i.test(text)) console.error(`[local-postgres] ${text}`);
    }
  });
  if (!existsSync(resolve(directory, "PG_VERSION"))) await server.initialise();
  await server.start();
  const admin = server.getPgClient();
  await admin.connect();
  const existing = await admin.query("select 1 from pg_database where datname = $1", [LOCAL_DATABASE]);
  await admin.end();
  if (!existing.rowCount) await server.createDatabase(LOCAL_DATABASE);
  return server;
}

async function installAuthCompatibility(pool) {
  await pool.query(`
    create schema if not exists auth;
    create or replace function auth.uid() returns text language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')
    $$;
    create or replace function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
    $$;
    create or replace function auth.role() returns text language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'service_role')
    $$;
  `);
}

export async function migrateLocalPostgres() {
  const pool = new Pool({ connectionString: LOCAL_DATABASE_URL });
  try {
    await installAuthCompatibility(pool);
    const migrationsDirectory = resolve("migrations");
    const files = readdirSync(migrationsDirectory)
      .filter((file) => file.endsWith(".sql") && !file.endsWith(".down.sql"))
      .sort();
    for (const file of files) {
      const path = resolve(migrationsDirectory, file);
      if (!existsSync(path)) continue;
      await pool.query(readFileSync(path, "utf8"));
      console.log(`[local-postgres] applied ${file}`);
    }
    return files;
  } finally {
    await pool.end();
  }
}

export async function verifyLocalPersistence() {
  const marker = `persist_${Date.now()}`;
  let server = await startLocalPostgres();
  const pool = new Pool({ connectionString: LOCAL_DATABASE_URL });
  await pool.query("create table if not exists slt_local_persistence_probe (id text primary key, created_at timestamptz not null default now())");
  await pool.query("insert into slt_local_persistence_probe (id) values ($1)", [marker]);
  await pool.end();
  await server.stop();

  server = await startLocalPostgres();
  const restartedPool = new Pool({ connectionString: LOCAL_DATABASE_URL });
  const result = await restartedPool.query("select id from slt_local_persistence_probe where id = $1", [marker]);
  await restartedPool.end();
  await server.stop();
  if (result.rows[0]?.id !== marker) throw new Error("Local PostgreSQL persistence probe was not found after restart.");
  return marker;
}
