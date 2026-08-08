import { LOCAL_DATABASE_URL, migrateLocalPostgres, startLocalPostgres } from "./local-postgres.js";

const postgres = await startLocalPostgres();
process.env.SLT_SKIP_ENV_FILES = "1";
process.env.SLT_MANUAL_START = "1";
process.env.DATABASE_URL = LOCAL_DATABASE_URL;
process.env.DATABASE_SSL = "false";
process.env.SLT_STORAGE_DIR ||= new URL("../storage/assets", import.meta.url).pathname;
await migrateLocalPostgres();

const { startServer } = await import("../server/api-proxy.js");
const api = await startServer();

async function shutdown() {
  await new Promise((resolve) => api.close(resolve));
  await postgres.stop();
  process.exit(0);
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
