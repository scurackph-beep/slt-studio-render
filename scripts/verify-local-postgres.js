import { migrateLocalPostgres, startLocalPostgres, verifyLocalPersistence } from "./local-postgres.js";

let server;
try {
  server = await startLocalPostgres();
  const migrations = await migrateLocalPostgres();
  await server.stop();
  server = null;
  const marker = await verifyLocalPersistence();
  console.log(JSON.stringify({ ok: true, durable: true, migrations, persistenceMarker: marker }, null, 2));
} finally {
  if (server) await server.stop().catch(() => {});
}
