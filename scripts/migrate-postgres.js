import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL is required to run PostgreSQL migrations.");
  process.exit(1);
}

const migrationsDir = resolve("migrations");
if (!existsSync(migrationsDir)) {
  console.error(`Migrations directory not found: ${migrationsDir}`);
  process.exit(1);
}

const migrationPaths = readdirSync(migrationsDir)
  .filter((file) => file.endsWith(".sql") && !file.endsWith(".down.sql"))
  .sort()
  .map((file) => resolve(migrationsDir, file));

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined
});

try {
  for (const migrationPath of migrationPaths) {
    await pool.query(readFileSync(migrationPath, "utf8"));
    console.log(`PostgreSQL migration applied: ${migrationPath}`);
  }
} finally {
  await pool.end();
}
