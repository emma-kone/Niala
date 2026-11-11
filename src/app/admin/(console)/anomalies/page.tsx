import Link from "next/link";
import { Notice, PageHeader, Stat } from "@/components/admin/primitives";
import { fmtNumber } from "@/components/admin/format";
import { AnomalyBoard } from "@/features/admin/anomaly-board";
import { CATEGORY_LABELS, getAnomalies, PRIORITY_LABELS } from "@/server/admin/anomalies";
import { requireAdminPage } from "@/server/admin/session";
import { flat, type SP } from "../_lib";

export default async function AnomaliesPage({ searchParams }: { searchParams: SP }) {
  await requireAdminPage("tech.view");
  const q = await flat(searchParams);
  const days = [7, 14, 30].includes(Number(q.days)) ? Number(q.days) : 7;
  const report = await getAnomalies(days);
  const count = (p: string) => report.anomalies.filter((a) => a.priority === p).length;
  const tab = (active: boolean) => `rounded-lg px-3 py-1.5 text-sm ${active ? "bg-primary text-primary-foreground" : "border hover:bg-muted"}`;

  return (
    <>
      <PageHeader title="Anomalies à résoudre" description="Routes lentes, erreurs, échecs d'IA, imports en erreur et signalements des étudiants, classés par priorité comme une liste de tâches. Chaque anomalie vient avec un prompt prêt à être transmis pour la corriger." />
      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Période analysée">
        {[7, 14, 30].map((d) => <Link key={d} className={tab(days === d)} href={`?days=${d}`}>{d} derniers jours</Link>)}
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Critiques (P1)" value={fmtNumber(count("P1"))} tone={count("P1") ? "warn" : undefined} hint={PRIORITY_LABELS.P1} />
        <Stat label="Élevées (P2)" value={fmtNumber(count("P2"))} tone={count("P2") ? "warn" : undefined} />
        <Stat label="Moyennes (P3)" value={fmtNumber(count("P3"))} />
        <Stat label="Faibles (P4)" value={fmtNumber(count("P4"))} />
      </div>
      <AnomalyBoard
        anomalies={report.anomalies.map((a) => ({ id: a.id, priority: a.priority, category: CATEGORY_LABELS[a.category], title: a.title, summary: a.summary, evidence: a.evidence, files: a.files, prompt: a.prompt }))}
        masterPrompt={report.masterPrompt}
        priorityLabels={PRIORITY_LABELS}
      />
      <Notice className="mt-6">{report.notes.map((t) => <p key={t}>{t}</p>)}</Notice>
    </>
  );
}
