import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handle, limit, readJson } from "@/lib/api-helpers";
import { SQL_FIXTURES } from "@/server/labs/fixtures";
import { runSqlFree } from "@/server/services/labs/execute";

// Route de compatibilité pour la vue de session V1 (supprimée en phase 9). Les laboratoires utilisent /api/labs.
// Base SQLite WebAssembly jetable dans le runner isolé : la base de l'application n'est jamais touchée.

export const maxDuration = 120;

export async function GET() {
  return handle(async () => {
    await requireUser();
    return { fixtures: Object.entries(SQL_FIXTURES).map(([id, f]) => ({ id, label: f.label, description: f.description })) };
  });
}

const runSchema = z.object({ sql: z.string().min(1, "Requête vide").max(30_000), fixture: z.string().default("bibliotheque"), setupSql: z.string().max(30_000).optional() });

export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    limit(`sql:${user.id}`, 40, 60_000);
    const { sql, fixture, setupSql } = runSchema.parse(await readJson<unknown>(req));
    const setup = setupSql?.trim() ? setupSql : (SQL_FIXTURES[fixture]?.setupSql ?? SQL_FIXTURES.bibliotheque.setupSql);
    const r = await runSqlFree(setup, sql);
    if (r.unavailable || !r.result) return { ok: false, statements: [], error: r.unavailable ?? "Exécution indisponible.", durationMs: 0 };
    const res = r.result;
    if (res.status === "timeout") return { ok: false, statements: [], error: "Requête interrompue : délai dépassé.", durationMs: res.durationMs };
    const u = res.user;
    const statements = (u?.statements ?? []).map((s) => ({
      sql: s.sql,
      kind: s.columns ? "select" : "write",
      columns: s.columns,
      rows: s.columns ? s.rows?.map((row) => Object.fromEntries(s.columns!.map((c, i) => [c, row[i]]))) : undefined,
      changes: s.changes ?? s.rowCount,
    }));
    if (u?.error) statements.push({ sql: "", kind: "other", columns: undefined, rows: undefined, changes: undefined, error: u.error.message } as (typeof statements)[number] & { error: string });
    return { ok: !u?.error, statements, error: u?.error?.message, durationMs: res.durationMs };
  });
}
