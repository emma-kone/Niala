"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { AttemptQuestion } from "./types";
import { WorkspaceHost } from "@/features/workspaces/workspace-host";
import { describeWork, isStructured } from "@/workspaces";

// Saisie de la réponse, adaptée à chaque type de question. La valeur renvoyée a exactement la
// forme attendue par le serveur (voir valueSchemas dans services/exercises/attempts.ts).

type Opt = { id: string; label: string };
const asRecord = (v: unknown): Record<string, string> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, string>) : {});

/** Découpe « texte ___ texte ___ » en segments pour y insérer des champs. */
function Blanks({ statement, render }: { statement: string; render: (index: number) => React.ReactNode }) {
  const parts = statement.split("___");
  return (
    <p className="leading-10">
      {parts.map((p, i) => (
        <span key={i}>
          {p}
          {i < parts.length - 1 && <span className="mx-1 inline-block align-middle">{render(i)}</span>}
        </span>
      ))}
    </p>
  );
}

export function QuestionInput({ q, value, onChange, disabled, attemptId, statementNode }: { q: AttemptQuestion; value: unknown; onChange: (v: unknown) => void; disabled?: boolean; attemptId?: string; statementNode?: React.ReactNode }) {
  const p = q.payload as Record<string, unknown>;
  const statement = String(p.statement ?? "");
  const group = "rounded-lg border px-3 py-2.5 text-sm transition-colors";

  switch (q.type) {
    case "workspace":
      return attemptId ? <WorkspaceHost attemptId={attemptId} position={q.position} statement={statementNode ?? statement} payload={p} value={value} onChange={onChange} disabled={disabled} /> : null;
    case "qcm_single": {
      const options = p.options as Opt[];
      return (
        <div role="radiogroup" aria-label="Propositions" className="space-y-2">
          {options.map((o) => (
            <label key={o.id} className={cn(group, "flex cursor-pointer items-start gap-3 hover:bg-muted/50", value === o.id && "border-primary bg-primary/5")}>
              <input type="radio" name={`q${q.position}`} className="mt-1" checked={value === o.id} disabled={disabled} onChange={() => onChange(o.id)} />
              <span>{o.label}</span>
            </label>
          ))}
        </div>
      );
    }
    case "qcm_multiple": {
      const options = p.options as Opt[];
      const chosen = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div role="group" aria-label="Propositions (plusieurs réponses possibles)" className="space-y-2">
          <p className="typo-meta">Plusieurs réponses possibles.</p>
          {options.map((o) => (
            <label key={o.id} className={cn(group, "flex cursor-pointer items-start gap-3 hover:bg-muted/50", chosen.includes(o.id) && "border-primary bg-primary/5")}>
              <Checkbox checked={chosen.includes(o.id)} disabled={disabled} onCheckedChange={(c) => onChange(c === true ? [...chosen, o.id] : chosen.filter((x) => x !== o.id))} className="mt-0.5" />
              <span>{o.label}</span>
            </label>
          ))}
        </div>
      );
    }
    case "true_false":
      return (
        <div role="radiogroup" aria-label="Vrai ou faux" className="flex gap-3">
          {[{ v: true, l: "Vrai" }, { v: false, l: "Faux" }].map((o) => (
            <label key={o.l} className={cn(group, "flex flex-1 cursor-pointer items-center justify-center gap-2 font-medium hover:bg-muted/50", value === o.v && "border-primary bg-primary/5")}>
              <input type="radio" name={`q${q.position}`} checked={value === o.v} disabled={disabled} onChange={() => onChange(o.v)} />
              {o.l}
            </label>
          ))}
        </div>
      );
    case "fill_choices": {
      const blanks = p.blanks as { id: string; options: string[] }[];
      const given = asRecord(value);
      return (
        <Blanks
          statement={statement}
          render={(i) => (
            <select
              aria-label={`Trou ${i + 1}`}
              value={given[blanks[i].id] ?? ""}
              disabled={disabled}
              onChange={(e) => onChange({ ...given, [blanks[i].id]: e.target.value })}
              className="h-9 rounded-md border bg-background px-2 text-sm"
            >
              <option value="">…</option>
              {blanks[i].options.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          )}
        />
      );
    }
    case "fill_blank": {
      const blanks = p.blanks as { id: string }[];
      const given = asRecord(value);
      return (
        <Blanks
          statement={statement}
          render={(i) => <Input aria-label={`Trou ${i + 1}`} value={given[blanks[i].id] ?? ""} disabled={disabled} maxLength={300} onChange={(e) => onChange({ ...given, [blanks[i].id]: e.target.value })} className="inline-block h-9 w-40" />}
        />
      );
    }
    case "short_answer":
      return <Input aria-label="Votre réponse" value={typeof value === "string" ? value : ""} disabled={disabled} maxLength={600} onChange={(e) => onChange(e.target.value)} placeholder="Votre réponse" />;
    case "matching": {
      const left = p.left as Opt[];
      const right = p.right as Opt[];
      const given = asRecord(value);
      return (
        <div className="space-y-2">
          {left.map((l) => (
            <div key={l.id} className="flex flex-wrap items-center gap-3">
              <span className="min-w-40 flex-1 rounded-md bg-muted px-3 py-2 text-sm font-medium">{l.label}</span>
              <span aria-hidden>→</span>
              <select aria-label={`Associer « ${l.label} »`} value={given[l.id] ?? ""} disabled={disabled} onChange={(e) => onChange({ ...given, [l.id]: e.target.value })} className="h-10 min-w-48 flex-1 rounded-md border bg-background px-2 text-sm">
                <option value="">Choisir…</option>
                {right.map((r) => (
                  <option key={r.id} value={r.id}>{r.label}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      );
    }
    case "code":
    case "sql":
      return (
        <div className="space-y-2">
          {q.type === "code" && <p className="typo-meta">Langage : {String(p.language ?? "")}</p>}
          {q.type === "sql" && p.setupSql ? (
            <details className="rounded-md border p-2 text-xs">
              <summary className="cursor-pointer font-medium">Schéma et données fournis</summary>
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono">{String(p.setupSql)}</pre>
            </details>
          ) : null}
          <Textarea
            aria-label="Votre code"
            value={typeof value === "string" ? value : (q.type === "code" ? String(p.starterCode ?? "") : "")}
            disabled={disabled}
            rows={10}
            spellCheck={false}
            maxLength={12000}
            onChange={(e) => onChange(e.target.value)}
            className="font-mono text-sm"
          />
        </div>
      );
    default:
      return (
        <Textarea aria-label="Votre réponse" value={typeof value === "string" ? value : ""} disabled={disabled} rows={q.type === "definition" ? 4 : 7} maxLength={8000} onChange={(e) => onChange(e.target.value)} placeholder="Rédigez votre réponse…" />
      );
  }
}

/** Réponse de l'étudiant en lecture seule (correction). */
export function AnswerText({ q }: { q: AttemptQuestion }) {
  const p = q.payload as Record<string, unknown>;
  const v = q.answer;
  const label = (list: Opt[], id: string) => list.find((o) => o.id === id)?.label ?? id;
  if (v == null || v === "" || (Array.isArray(v) && v.length === 0)) return <span className="italic text-muted-foreground">Aucune réponse</span>;
  switch (q.type) {
    case "workspace":
      return isStructured(p.environment) ? <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-muted/50 p-2 font-code text-xs">{describeWork(p.environment, v)}</pre> : null;
    case "qcm_single":
      return <>{label(p.options as Opt[], String(v))}</>;
    case "qcm_multiple":
      return <>{(v as string[]).map((id) => label(p.options as Opt[], id)).join(" · ")}</>;
    case "true_false":
      return <>{v ? "Vrai" : "Faux"}</>;
    case "fill_choices":
    case "fill_blank":
      return <>{Object.values(asRecord(v)).filter(Boolean).join(" · ") || <em>Aucune réponse</em>}</>;
    case "matching": {
      const left = p.left as Opt[];
      const right = p.right as Opt[];
      return (
        <ul className="space-y-0.5">
          {left.map((l) => (
            <li key={l.id}>{l.label} → {asRecord(v)[l.id] ? label(right, asRecord(v)[l.id]) : <em>—</em>}</li>
          ))}
        </ul>
      );
    }
    case "code":
    case "sql":
      return <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-muted p-2 font-mono text-xs">{String(v)}</pre>;
    default:
      return <span className="whitespace-pre-wrap">{String(v)}</span>;
  }
}

/** Réponse attendue (correction). */
export function ExpectedText({ q }: { q: AttemptQuestion }) {
  const p = q.payload as Record<string, unknown>;
  const e = q.result?.expected as unknown;
  const label = (list: Opt[], id: string) => list.find((o) => o.id === id)?.label ?? id;
  if (e == null) return null;
  switch (q.type) {
    case "qcm_single":
    case "qcm_multiple":
      return <>{(e as string[]).map((id) => label(p.options as Opt[], id)).join(" · ")}</>;
    case "true_false":
      return <>{e ? "Vrai" : "Faux"}</>;
    case "fill_choices":
      return <>{Object.values(e as Record<string, string>).join(" · ")}</>;
    case "fill_blank":
      return <>{Object.values(e as Record<string, string[]>).map((a) => a.join(" / ")).join(" · ")}</>;
    case "short_answer":
      return <>{(e as string[]).join(" / ")}</>;
    case "matching": {
      const left = p.left as Opt[];
      const right = p.right as Opt[];
      return (
        <ul className="space-y-0.5">
          {left.map((l) => (
            <li key={l.id}>{l.label} → {label(right, (e as Record<string, string>)[l.id])}</li>
          ))}
        </ul>
      );
    }
    default: {
      const r = e as { reference?: string; criteria?: string[]; keyPoints?: string[] };
      return (
        <div className="space-y-1">
          {r.reference && <p className="whitespace-pre-wrap">{r.reference}</p>}
          {(r.criteria ?? r.keyPoints)?.length ? <ul className="list-disc pl-5 text-xs text-muted-foreground">{(r.criteria ?? r.keyPoints)!.map((c, i) => <li key={i}>{c}</li>)}</ul> : null}
        </div>
      );
    }
  }
}
