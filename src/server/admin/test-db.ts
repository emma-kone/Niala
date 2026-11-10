// Utilitaire de tests : base PGlite jetable avec TOUTES les migrations, et le client Prisma de l'application branché dessus.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

export async function startTestDb() {
  const pg = await PGlite.create();
  const dir = path.join(process.cwd(), "prisma", "migrations");
  for (const name of readdirSync(dir).filter((n) => /^\d/.test(n)).sort()) {
    await pg.exec(readFileSync(path.join(dir, name, "migration.sql"), "utf8"));
  }
  const port = 45000 + Math.floor(Math.random() * 4000);
  const server = new PGLiteSocketServer({ db: pg, port, host: "127.0.0.1", maxConnections: 4 });
  await server.start();
  process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${port}/postgres?connection_limit=1&pgbouncer=true`;
  process.env.DIRECT_URL = process.env.DATABASE_URL;
  process.env.AUTH_SECRET = "test-secret-test-secret-test-secret-123456";
  const { db } = await import("@/lib/db");
  return {
    db,
    async stop() {
      await db.$disconnect();
      await server.stop();
      await pg.close();
    },
  };
}
