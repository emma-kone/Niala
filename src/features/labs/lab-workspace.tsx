"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "@/components/theme/theme-provider";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CodeMirror, { type Extension } from "@uiw/react-codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { sql as sqlLang } from "@codemirror/lang-sql";
import { ChevronRight, FileText, FlaskConical, History, Lightbulb, Loader2, Play, Eye, Sparkles, TerminalSquare, Trash2 } from "lucide-react";
import { api } from "@/lib/client-api";
import { routes } from "@/config/routes";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { LabAssistantPanel } from "@/features/lab-assistant/lab-assistant-panel";
import { TestOutcomes } from "./test-outcomes";
import { CATEGORY_LABEL, type Diagnosis, type RunDto, type RunHistoryItem, type RunOutput, type LabWorkspaceDto } from "./types";
import { confirmAction } from "@/components/notifications";
import { useModuleToolbar } from "@/components/layout/floating-toolbar";

const errText = (e: unknown, fb: string) => (e instanceof Error ? e.message : fb);
const fmtDate = (d: string) => new Date(d).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

interface Hint {
  level: number;
  source: "ai" | "tests";
  message: string;
}

export default function LabWorkspace({ id }: { id: string }) {
  const router = useRouter();
  const { resolvedTheme } = useTheme();
  const [ws, setWs] = useState<LabWorkspaceDto | null>(null);
  const [error, setError] = useState<{ message: string; status?: number } | null>(null);
  const [code, setCode] = useState("");
  const [stdin, setStdin] = useState("");
  const [saved, setSaved] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [running, setRunning] = useState<null | "run" | "tests">(null);
  const [run, setRun] = useState<RunDto | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [history, setHistory] = useState<RunHistoryItem[]>([]);
  const [hints, setHints] = useState<Hint[]>([]);
  const [hintBusy, setHintBusy] = useState(false);
  const [hintError, setHintError] = useState<string | null>(null);
  const [reference, setReference] = useState<{ reference: string } | null>(null);
  const [tab, setTab] = useState("result");
  const dirty = useRef(false);
  const codeRef = useRef("");
  codeRef.current = code;

  const loadHistory = useCallback(async () => {
    try {
      setHistory((await api.get<{ runs: RunHistoryItem[] }>(`/api/labs/${id}/runs`)).runs);
    } catch {
      /* l'historique est secondaire */
    }
  }, [id]);

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ workspace: LabWorkspaceDto }>(`/api/labs/${id}`);
      setWs(r.workspace);
      setCode((c) => (dirty.current ? c : r.workspace.files[0]?.content ?? ""));
      setError(null);
    } catch (e) {
      setError({ message: errText(e, "Chargement impossible."), status: (e as { status?: number }).status });
    }
  }, [id]);

  useEffect(() => {
    void load();
    void loadHistory();
  }, [load, loadHistory]);

  // Enregistrement automatique (1,5 s après la dernière frappe) + à la fermeture de l'onglet.
  const save = useCallback(
    async (content: string, keepalive = false) => {
      setSaved("saving");
      try {
        if (keepalive) {
          await fetch(`/api/labs/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }), keepalive: true });
        } else {
          await api.patch(`/api/labs/${id}`, { content });
        }
        if (codeRef.current === content) dirty.current = false;
        setSaved("saved");
      } catch {
        setSaved("error");
      }
    },
    [id],
  );
  useEffect(() => {
    if (!dirty.current) return;
    const t = setTimeout(() => void save(code), 1500);
    return () => clearTimeout(t);
  }, [code, save]);
  useEffect(() => {
    const onHide = () => {
      if (dirty.current) void save(codeRef.current, true);
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [save]);

  const kind = ws?.kind;
  const lang = ws?.files[0]?.language ?? "python";
  const extensions = useMemo<Extension[]>(() => (lang === "sql" ? [sqlLang()] : lang === "python" ? [python()] : [javascript({ typescript: lang === "typescript" })]), [lang]);

  async function exec(mode: "run" | "tests") {
    setRunning(mode);
    setRunError(null);
    try {
      const r = await api.post<RunDto>(`/api/labs/${id}/run`, { mode, content: code, stdin: kind === "CODE" && stdin ? stdin : undefined });
      dirty.current = false;
      setSaved("saved");
      setRun(r);
      setTab(mode === "tests" ? "tests" : "result");
      void loadHistory();
      void load();
    } catch (e) {
      setRunError(errText(e, "Exécution impossible."));
    } finally {
      setRunning(null);
    }
  }

  async function askHint() {
    const level = Math.min(3, hints.length + 1);
    setHintBusy(true);
    setHintError(null);
    try {
      const r = await api.post<Hint & { runId: string }>(`/api/labs/${id}/hint`, { level });
      setHints((h) => [...h, r]);
      setTab("hints");
    } catch (e) {
      setHintError(errText(e, "Indice indisponible."));
      setTab("hints");
    } finally {
      setHintBusy(false);
    }
  }

  async function reveal() {
    try {
      setReference(await api.post<{ reference: string }>(`/api/labs/${id}/reveal`));
      setTab("solution");
      void load();
    } catch (e) {
      setHintError(errText(e, "Solution indisponible."));
    }
  }

  async function remove() {
    if (!(await confirmAction("Supprimer cet espace de travail et son historique d'exécutions ?", { confirmLabel: "Supprimer" }))) return;
    try {
      await api.del(`/api/labs/${id}`);
      router.push(kind === "SQL" ? routes.sql : routes.code);
    } catch (e) {
      setRunError(errText(e, "Suppression impossible."));
    }
  }

  const showTab = (value: string) => {
    setTab(value);
    document.getElementById("lab-panels")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };
  useModuleToolbar(
    !ws || error
      ? null
      : [
          { id: "result", label: "Résultat", icon: TerminalSquare, color: "var(--accent-mint)" },
          { id: "assistant", label: "Assistant", icon: Sparkles, color: "var(--accent-lilac)" },
          ...(ws.brief?.verified ? [{ id: "tests", label: "Tests", icon: FlaskConical, color: "var(--accent-rose)" }] : []),
          { id: "hints", label: hints.length ? `Indices (${hints.length})` : "Indices", icon: Lightbulb, color: "var(--accent-sun)" },
          { id: "history", label: "Historique", icon: History, color: "var(--accent-sky)" },
          ...(reference ? [{ id: "solution", label: "Solution", icon: Eye, color: "var(--stack-base)" }] : []),
        ].map(({ id: value, ...action }) => ({ ...action, active: tab === value, onClick: () => showTab(value) }))
  );

  const home = kind === "SQL" ? routes.sql : routes.code;
  if (error) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <h1 className="typo-h2">{error.status === 404 ? "Espace de travail introuvable" : "Chargement impossible"}</h1>
        <p className="typo-subtitle mt-2">{error.message}</p>
        <Button asChild variant="outline" className="mt-6"><Link href={routes.code}>Retour aux laboratoires</Link></Button>
      </div>
    );
  }
  if (!ws) return <div className="mx-auto max-w-6xl space-y-3 px-4 py-8" aria-busy><Skeleton className="h-8 w-72" /><Skeleton className="h-96 rounded-xl" /></div>;

  const brief = ws.brief;
  const hasTests = !!brief?.verified;
  const out: RunOutput | undefined = run?.output;
  const diagnoses: Diagnosis[] = run?.diagnoses ?? [];

  return (
    <div className="mx-auto w-full max-w-7xl px-4 pt-6 pb-[calc(1.5rem+var(--toolbar-clearance,0px))] sm:px-6">
      <nav aria-label="Fil d'Ariane" className="mb-1 flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
        <Link href={home} className="hover:text-foreground">{kind === "SQL" ? "Laboratoire SQL" : "Éditeur de code"}</Link>
        <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        <span>{ws.mode === "EXERCISE" ? "Exercice" : "Espace libre"}</span>
      </nav>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="typo-h1 mr-auto">{ws.title}</h1>
        <Badge variant="outline">{ws.mode === "EXERCISE" ? "Mode exercice" : "Mode libre"}</Badge>
        <Badge variant="outline">{lang === "sql" ? "SQL (SQLite)" : lang}</Badge>
        <span className="text-xs text-muted-foreground" aria-live="polite">{saved === "saving" ? "Enregistrement…" : saved === "saved" ? "Enregistré" : saved === "error" ? "Échec de l'enregistrement" : ""}</span>
        <Button variant="ghost" size="sm" className="gap-1 text-destructive" onClick={() => void remove()}><Trash2 className="h-4 w-4" aria-hidden /> Supprimer</Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          {brief && (
            <section aria-label="Énoncé" className="rounded-xl border bg-card p-4">
              <h2 className="typo-h3 mb-1">Énoncé</h2>
              <p className="whitespace-pre-wrap text-sm">{brief.statement}</p>
              {brief.source?.documentName && brief.source.documentId && ws.subjectId && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Source :{" "}
                  <Link href={`${routes.subject(ws.subjectId)}/documents/${brief.source.documentId}${brief.source.page ? `?page=${brief.source.page}` : ""}`} className="inline-flex items-center gap-1 text-primary hover:underline">
                    <FileText className="h-3 w-3" aria-hidden /> {brief.source.documentName}{brief.source.page ? ` p. ${brief.source.page}` : ""}
                  </Link>
                </p>
              )}
              {ws.exerciseId && ws.subjectId && <p className="mt-1 text-xs"><Link className="text-primary hover:underline" href={`${routes.subject(ws.subjectId)}/exercices/${ws.exerciseId}`}>Retour à l&apos;exercice</Link></p>}
              {!hasTests && <p role="note" className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">Aucun test automatique fiable n&apos;a pu être validé pour cet exercice : exécutez votre code librement et demandez des indices. Aucune note n&apos;est inventée.</p>}
              {brief.sql && brief.sql.setupSql && (
                <details className="mt-3 rounded-md border p-2 text-xs">
                  <summary className="cursor-pointer font-medium">Schéma et données fournis</summary>
                  <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap font-mono">{brief.sql.setupSql}</pre>
                </details>
              )}
              {hasTests && <p className="mt-3 text-xs text-muted-foreground">{brief.tests.length || (brief.sql ? 1 + brief.sql.variants.length : 0)} test(s) automatique(s) validé(s) par une solution de référence{brief.sql?.variants.length ? ` (dont ${brief.sql.variants.length} jeu(x) de données limites)` : ""}.</p>}
            </section>
          )}
          {!brief && kind === "SQL" && ws.schemaSql && (
            <details className="rounded-xl border bg-card p-3 text-xs">
              <summary className="cursor-pointer font-medium">Schéma et données du jeu d&apos;exemple</summary>
              <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap font-mono">{ws.schemaSql}</pre>
            </details>
          )}

          <div className="overflow-hidden rounded-xl border" onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); void exec("run"); } }}>
            <CodeMirror
              value={code}
              height="360px"
              theme={resolvedTheme === "dark" ? oneDark : "light"}
              extensions={extensions}
              onChange={(v) => { dirty.current = true; setSaved("idle"); setCode(v); }}
              aria-label="Éditeur de code"
              basicSetup={{ lineNumbers: true, foldGutter: false }}
            />
          </div>

          {kind === "CODE" && (
            <details className="rounded-md border p-2 text-sm">
              <summary className="cursor-pointer font-medium">Entrée standard (input / readLine)</summary>
              <Textarea aria-label="Entrée standard" value={stdin} onChange={(e) => setStdin(e.target.value)} rows={3} maxLength={4000} className="mt-2 font-mono text-xs" placeholder="Une ligne par appel à input() (Python) ou readLine() (JS/TS)" />
            </details>
          )}

          <div className="flex flex-wrap gap-2">
            <Button className="gap-2" onClick={() => void exec("run")} disabled={running !== null || !code.trim()}>
              {running === "run" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />} Exécuter <kbd className="ml-1 hidden rounded border px-1 text-[10px] sm:inline">Ctrl+↵</kbd>
            </Button>
            {hasTests && (
              <Button variant="secondary" className="gap-2" onClick={() => void exec("tests")} disabled={running !== null || !code.trim()}>
                {running === "tests" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FlaskConical className="h-4 w-4" aria-hidden />} Lancer les tests
              </Button>
            )}
            <Button variant="outline" className="gap-2" onClick={() => void askHint()} disabled={hintBusy || running !== null || hints.length >= 3 || !run}>
              {hintBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Lightbulb className="h-4 w-4" aria-hidden />} Indice {hints.length < 3 ? `(${hints.length + 1}/3)` : "(épuisés)"}
            </Button>
            {ws.canReveal && !ws.brief?.revealedAt && <Button variant="ghost" className="gap-2" onClick={() => void reveal()}><Eye className="h-4 w-4" aria-hidden /> Voir la solution</Button>}
            {ws.brief?.revealedAt && <Button variant="ghost" className="gap-2" onClick={() => void reveal()}><Eye className="h-4 w-4" aria-hidden /> Revoir la solution</Button>}
          </div>
          {!run && <p className="text-xs text-muted-foreground">Exécutez d&apos;abord votre code : les indices s&apos;appuient sur le résultat réel.</p>}
          {runError && <Alert variant="destructive"><AlertTitle>Exécution impossible</AlertTitle><AlertDescription>{runError}</AlertDescription></Alert>}
        </div>

        <Tabs id="lab-panels" value={tab} onValueChange={setTab} className="min-w-0">

          {/* Toujours monté : la discussion survit au changement d'onglet. */}
          <TabsContent value="assistant" forceMount className="rounded-xl border bg-card p-4 data-[state=inactive]:hidden">
            <LabAssistantPanel endpoint={`/api/labs/${id}/assistant`} kind={ws.kind} guided={!!brief && !brief.revealedAt && ws.mode === "EXERCISE"} getCode={() => codeRef.current} onInsert={(c) => { dirty.current = true; setSaved("idle"); setCode(c); }} />
          </TabsContent>

          <TabsContent value="result" className="rounded-xl border bg-card p-4">
            {running === "run" ? <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-busy><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Exécution isolée en cours (le premier lancement Python peut prendre quelques secondes)…</p> : !out ? <p className="text-sm text-muted-foreground">Aucune exécution pour l&apos;instant. Lancez votre code pour voir son résultat ici.</p> : <OutputView out={out} diagnoses={run?.tests ? [] : diagnoses} />}
          </TabsContent>

          {hasTests && (
            <TabsContent value="tests" className="rounded-xl border bg-card p-4">
              {running === "tests" ? <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-busy><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Tests en cours…</p> : run?.tests ? <TestOutcomes outcomes={run.tests.outcomes} summary={run.tests.summary} diagnoses={run.tests.diagnoses} /> : (
                <div className="space-y-2 text-sm">
                  <p className="text-muted-foreground">Les tests s&apos;exécutent dans un environnement isolé et comparent votre résultat à celui d&apos;une solution de référence.</p>
                  <ul className="list-disc space-y-1 pl-5">
                    {(brief?.tests ?? []).map((t, i) => <li key={i}>{t.name}{t.edge ? " (cas limite)" : ""}{t.hidden ? " — caché" : ""}</li>)}
                    {brief?.sql && <li>Jeu de données de l&apos;énoncé</li>}
                    {brief?.sql?.variants.map((v, i) => <li key={i}>{v} (cas limite)</li>)}
                  </ul>
                </div>
              )}
            </TabsContent>
          )}

          <TabsContent value="hints" className="space-y-3 rounded-xl border bg-card p-4">
            <p className="text-xs text-muted-foreground">Les indices guident sans donner la solution : niveau 1 (où regarder), 2 (la notion), 3 (la démarche).</p>
            {hints.length === 0 && !hintError && <p className="text-sm text-muted-foreground">Aucun indice demandé.</p>}
            {hints.map((h, i) => (
              <div key={i} className="rounded-md border-l-4 border-primary bg-muted/50 p-3 text-sm">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Indice {h.level} · {h.source === "ai" ? "tuteur IA, à confronter à vos tests" : "d'après les résultats de vos tests"}</p>
                <p className="whitespace-pre-wrap">{h.message}</p>
              </div>
            ))}
            {hintError && <p role="alert" className="text-sm text-destructive">{hintError}</p>}
          </TabsContent>

          <TabsContent value="history" className="rounded-xl border bg-card p-2">
            {history.length === 0 ? <p className="p-2 text-sm text-muted-foreground">Aucune exécution enregistrée.</p> : (
              <ul className="divide-y">
                {history.map((h) => (
                  <li key={h.id} className="flex flex-wrap items-center gap-2 px-2 py-2 text-sm">
                    <span className="font-medium">{fmtDate(h.createdAt)}</span>
                    <Badge variant="outline" className="font-normal">{h.mode === "tests" ? "Tests" : "Exécution"}</Badge>
                    {h.summary && <span className={h.summary.allPassed ? "font-semibold text-emerald-700 dark:text-emerald-400" : "font-semibold"}>{h.summary.passed}/{h.summary.total}</span>}
                    <Button variant="ghost" size="sm" className="ml-auto" onClick={() => { dirty.current = true; setCode(h.content); setSaved("idle"); setRun({ id: h.id, mode: h.mode as "run" | "tests", output: h.output, tests: h.tests, diagnoses: h.tests?.diagnoses ?? [] }); setTab(h.tests ? "tests" : "result"); }}>Restaurer ce code</Button>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>

          {reference && (
            <TabsContent value="solution" className="rounded-xl border bg-card p-4">
              <p className="mb-2 text-xs text-muted-foreground">Solution de référence : une façon de résoudre l&apos;exercice parmi d&apos;autres possibles.</p>
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 font-mono text-xs">{reference.reference}</pre>
            </TabsContent>
          )}
        </Tabs>
      </div>
    </div>
  );
}

function Cell({ v }: { v: unknown }) {
  return v === null || v === undefined ? <span className="italic text-muted-foreground">NULL</span> : <>{String(v)}</>;
}

function OutputView({ out, diagnoses }: { out: RunOutput; diagnoses: Diagnosis[] }) {
  return (
    <div className="space-y-3 text-sm">
      {out.error && (
        <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
          <p className="font-semibold">{out.error.type}{out.error.line ? ` — ligne ${out.error.line}` : ""}</p>
          <p className="mt-0.5 whitespace-pre-wrap font-mono text-xs">{out.error.message}</p>
        </div>
      )}
      {out.kind === "code" && (
        <>
          {out.status === "timeout" && <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">Exécution interrompue : délai dépassé (boucle infinie ou calcul trop long ?).</p>}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sortie standard {out.durationMs != null && <span className="font-normal normal-case">· {out.durationMs} ms</span>}</p>
            <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 font-mono text-xs">{out.stdout || <span className="italic text-muted-foreground">(aucune sortie)</span>}</pre>
            {out.truncated && <p className="mt-1 text-xs text-amber-700">Sortie tronquée.</p>}
          </div>
          {out.stderr && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Erreurs (console.error / stderr)</p>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 font-mono text-xs">{out.stderr}</pre>
            </div>
          )}
        </>
      )}
      {out.kind === "sql" && (
        <>
          {out.status === "timeout" && <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">Requête interrompue : délai dépassé (récursion infinie ou jointure démesurée ?).</p>}
          {(out.statements ?? []).map((s, i) => (
            <div key={i}>
              <p className="truncate font-mono text-xs text-muted-foreground" title={s.sql}>{s.sql}</p>
              {s.columns ? (
                <div className="mt-1 max-h-72 overflow-auto rounded-md border">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-muted"><tr>{s.columns.map((c) => <th key={c} className="px-2 py-1 text-left font-semibold">{c}</th>)}</tr></thead>
                    <tbody>{(s.rows ?? []).map((r, ri) => <tr key={ri} className="border-t">{r.map((v, ci) => <td key={ci} className="px-2 py-1 font-mono"><Cell v={v} /></td>)}</tr>)}</tbody>
                  </table>
                  <p className="border-t px-2 py-1 text-xs text-muted-foreground">{s.rowCount ?? s.rows?.length ?? 0} ligne(s){(s.rowCount ?? 0) > (s.rows?.length ?? 0) ? ` (${s.rows?.length} affichées)` : ""}</p>
                </div>
              ) : <p className="mt-1 text-xs">{s.changes ?? 0} ligne(s) modifiée(s).</p>}
            </div>
          ))}
          {(out.statements ?? []).length === 0 && !out.error && out.status !== "timeout" && <p className="text-muted-foreground">Aucune instruction exécutée.</p>}
          {out.schema && out.schema.length > 0 && (
            <details className="rounded-md border p-2 text-xs">
              <summary className="cursor-pointer font-medium">Schéma de la base ({out.schema.length} table(s))</summary>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {out.schema.map((t) => (
                  <div key={t.name} className="rounded border p-2">
                    <p className="font-semibold">{t.name}</p>
                    <ul className="mt-1 font-mono">{t.columns.map((c) => <li key={c.name}>{c.name} <span className="text-muted-foreground">{c.type || "ANY"}{c.pk ? " · PK" : ""}{c.notNull ? " · NOT NULL" : ""}</span></li>)}</ul>
                    {t.foreignKeys.length > 0 && <p className="mt-1 text-muted-foreground">{t.foreignKeys.map((f) => `${f.from} → ${f.table}.${f.to}`).join(" ; ")}</p>}
                  </div>
                ))}
              </div>
            </details>
          )}
        </>
      )}
      {diagnoses.length > 0 && (
        <div className="rounded-md border bg-muted/40 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Diagnostic</p>
          <ul className="mt-1 space-y-1">{diagnoses.map((d, i) => <li key={i}><Badge variant="outline" className="mr-2 font-normal">{CATEGORY_LABEL[d.category] ?? d.category}</Badge>{d.label}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
