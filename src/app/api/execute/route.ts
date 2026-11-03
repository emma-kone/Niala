import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handle, limit, readJson } from "@/lib/api-helpers";
import { capabilities, execLanguage, runCodeFree } from "@/server/services/labs/execute";

// Route de compatibilité pour la vue de session V1 (supprimée en phase 9). Les laboratoires utilisent /api/labs.
// Exécution dans le runner isolé (QuickJS / Pyodide, processus à permissions restreintes), jamais dans le serveur.

export const maxDuration = 120;

export async function GET() {
  return handle(async () => {
    await requireUser();
    const c = capabilities();
    return { languages: c.languages.map((l) => ({ id: l.id, label: l.label, executable: c.available })), note: c.note };
  });
}

const execSchema = z.object({ language: z.string().min(1).max(30), code: z.string().min(1, "Code vide").max(40_000) });

export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    limit(`exec:${user.id}`, 30, 60_000);
    const { language, code } = execSchema.parse(await readJson<unknown>(req));
    const lang = execLanguage(language);
    if (!lang || lang === "sql") {
      return { ok: false, stdout: "", stderr: `L'exécution de ${language} n'est pas disponible ici (jamais simulée). Python, JavaScript et TypeScript sont exécutables.`, exitCode: null, durationMs: 0, timedOut: false, note: "Langage non exécutable." };
    }
    const r = await runCodeFree(lang, code, undefined);
    if (r.unavailable || !r.result) return { ok: false, stdout: "", stderr: r.unavailable ?? "Exécution indisponible.", exitCode: null, durationMs: 0, timedOut: false, note: "Exécution indisponible." };
    const x = r.result;
    const trace = x.error ? `${x.error.type}: ${x.error.message}${x.error.line ? ` (ligne ${x.error.line})` : ""}` : "";
    return { ok: x.status === "ok", stdout: x.stdout, stderr: [x.stderr, trace].filter(Boolean).join("\n"), exitCode: x.status === "ok" ? 0 : 1, durationMs: x.durationMs, timedOut: x.status === "timeout", note: x.status === "timeout" ? "Exécution interrompue : délai dépassé." : undefined };
  });
}
