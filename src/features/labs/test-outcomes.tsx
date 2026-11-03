import { AlertTriangle, CheckCircle2, Clock, MinusCircle, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { CATEGORY_LABEL, type Diagnosis, type TestOutcome, type TestSummary } from "./types";

const show = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));

const ICON = {
  pass: <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-label="Réussi" />,
  fail: <XCircle className="h-4 w-4 text-red-600" aria-label="Échoué" />,
  error: <AlertTriangle className="h-4 w-4 text-red-600" aria-label="Erreur" />,
  timeout: <Clock className="h-4 w-4 text-amber-600" aria-label="Délai dépassé" />,
  not_run: <MinusCircle className="h-4 w-4 text-muted-foreground" aria-label="Non exécuté" />,
} as const;

/** Résultats de tests objectifs : exécutés dans le runner isolé, jamais jugés par une IA. */
export function TestOutcomes({ outcomes, summary, diagnoses }: { outcomes: TestOutcome[]; summary: TestSummary; diagnoses?: Diagnosis[] }) {
  return (
    <div className="space-y-3" data-testid="test-outcomes">
      <p className={cn("text-sm font-semibold", summary.allPassed ? "text-emerald-700 dark:text-emerald-400" : "text-foreground")} role="status">
        {summary.passed} / {summary.total} test(s) réussi(s)
        {summary.edgeTotal > 0 && <span className="font-normal text-muted-foreground"> · cas limites : {summary.edgePassed}/{summary.edgeTotal}</span>}
      </p>
      <ul className="space-y-1.5">
        {outcomes.map((o) => (
          <li key={o.id} className={cn("rounded-md border p-2 text-sm", o.status === "pass" ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/20" : o.status === "not_run" ? "bg-muted/40" : "border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-950/20")}>
            <div className="flex flex-wrap items-center gap-2">
              {ICON[o.status]}
              <span className="font-medium">{o.name}</span>
              {o.edge && <Badge variant="outline" className="font-normal">cas limite</Badge>}
              {o.hidden && <Badge variant="outline" className="font-normal">test caché</Badge>}
            </div>
            {o.status !== "pass" && (
              <div className="mt-1 space-y-1 pl-6 text-xs">
                {o.message && <p>{o.message}</p>}
                {o.expected !== undefined && <p><span className="text-muted-foreground">Attendu : </span><code className="break-all rounded bg-muted px-1">{show(o.expected)}</code></p>}
                {o.actual !== undefined && <p><span className="text-muted-foreground">Obtenu : </span><code className="break-all rounded bg-muted px-1">{show(o.actual)}</code></p>}
              </div>
            )}
          </li>
        ))}
      </ul>
      {diagnoses && diagnoses.length > 0 && (
        <div className="rounded-md border bg-muted/40 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Diagnostic (d&apos;après les tests)</p>
          <ul className="mt-1 space-y-1 text-sm">
            {diagnoses.map((d, i) => (
              <li key={i}><Badge variant="outline" className="mr-2 font-normal">{CATEGORY_LABEL[d.category] ?? d.category}</Badge>{d.label}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
