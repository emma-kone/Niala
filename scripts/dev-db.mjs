// Base Postgres LOCALE de développement (PGlite + serveur de socket), sans toucher à Supabase.
// Usage : node scripts/dev-db.mjs            (persiste dans ./.pglite, port 5433)
// Puis :  DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5433/postgres?connection_limit=1" \
//         DIRECT_URL=<idem> npm run dev
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const dir = path.join(process.cwd(), "prisma", "migrations");
const db = await PGlite.create(process.env.PGLITE_DIR ?? ".pglite");

await db.exec(`CREATE TABLE IF NOT EXISTS _dev_migrations (name text PRIMARY KEY)`);
const done = new Set((await db.query("SELECT name FROM _dev_migrations")).rows.map((r) => r.name));
for (const name of readdirSync(dir).filter((n) => /^\d/.test(n)).sort()) {
  if (done.has(name)) continue;
  console.log("migration", name);
  await db.exec(readFileSync(path.join(dir, name, "migration.sql"), "utf8"));
  await db.query("INSERT INTO _dev_migrations VALUES ($1)", [name]);
}

const server = new PGLiteSocketServer({ db, port: Number(process.env.PGLITE_PORT ?? 5433), host: "127.0.0.1", maxConnections: 8 });
await server.start();
console.log("PGlite prêt sur 127.0.0.1:" + (process.env.PGLITE_PORT ?? 5433));
process.on("SIGINT", async () => {
  await server.stop();
  await db.close();
  process.exit(0);
});
