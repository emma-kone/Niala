"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ChevronRight, ClipboardList, FileText, Play } from "lucide-react";
import { api } from "@/lib/client-api";
import { SubjectIcon } from "@/components/subject-icon";
import { routes } from "@/config/routes";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SubjectTabs } from "@/features/subject-files/tabs";
import { fmtPoints, type ExerciseListItem } from "./types";

const errText = (e: unknown, fb: string) => (e instanceof Error ? e.message : fb);

/** Liste des exercices : d'une matière (onglet) ou de toutes les matières (page « Exercices »). */
export default function ExercisesView({ subjectId }: { subjectId?: string }) {
  const [items, setItems] = useState<ExerciseListItem[] | null>(null);
  const [error, setError] = useState<{ message: string; status?: number } | null>(null);
  const [subject, setSubject] = useState<{ name: string; color: string; icon?: string | null } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ exercises: ExerciseListItem[] }>(`/api/exercises${subjectId ? `?subjectId=${subjectId}` : ""}`);
      setItems(r.exercises);
      setError(null);
    } catch (e) {
      setError({ message: errText(e, "Chargement impossible."), status: (e as { status?: number }).status });
    }
  }, [subjectId]);

  useEffect(() => {
    void load();
    if (subjectId) api.get<{ subject: { name: string; color: string; icon?: string | null } }>(`/api/subjects/${subjectId}`).then((r) => setSubject(r.subject)).catch(() => undefined);
  }, [subjectId, load]);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      {subjectId ? (
        <>
          <nav aria-label="Fil d'Ariane" className="mb-1 flex items-center gap-1 text-sm text-muted-foreground">
            <Link href={routes.subjects} className="hover:text-foreground">Mes matières</Link>
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            <Link href={routes.subject(subjectId)} className="hover:text-foreground">{subject?.name ?? "…"}</Link>
          </nav>
          <h1 className="typo-h1 mb-5 flex items-center gap-3">
            {subject && <SubjectIcon icon={subject.icon} name={subject.name} color={subject.color} />}
            {subject?.name ?? <Skeleton className="h-8 w-48" />}
          </h1>
          <SubjectTabs subjectId={subjectId} active="exercises" />
        </>
      ) : (
        <header className="mb-6">
          <h1 className="typo-h1">Exercices</h1>
          <p className="typo-subtitle mt-1">Vos exercices, créés à partir de vos cours, avec leurs tentatives et leurs corrections.</p>
        </header>
      )}

      {!subjectId && <DocumentPicker />}

      {error && (
        <div role="alert" className="mb-3 flex items-center justify-between rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error.message}
          <Button size="sm" variant="outline" onClick={() => void load()}>Réessayer</Button>
        </div>
      )}
      {!items && !error && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy>{[0, 1, 2].map((i) => <Skeleton key={i} className="h-36 rounded-xl" />)}</div>}
      {items?.length === 0 && (
        <div className="rounded-xl border border-dashed px-6 py-14 text-center">
          <ClipboardList className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden />
          <h2 className="typo-h3 mt-3">Aucun exercice</h2>
          <p className="typo-subtitle mx-auto mt-1 max-w-md">Ouvrez un de vos documents et choisissez « Créer un exercice » : les questions sont fondées uniquement sur ce document, avec le barème et les types que vous choisissez.</p>
        </div>
      )}
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items?.map((e) => (
          <li key={e.id} className="rounded-xl border bg-card p-4 transition-shadow hover:shadow-md">
            <Link href={`${routes.subject(e.subject.id)}/exercices/${e.id}`} className="block">
              {!subjectId && (
                <p className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                  <SubjectIcon icon={e.subject.icon} name={e.subject.name} color={e.subject.color} size="xs" /> {e.subject.name}
                </p>
              )}
              <h2 className="typo-h3">{e.title}</h2>
              {e.document && <p className="typo-meta mt-1 flex items-center gap-1"><FileText className="h-3 w-3" aria-hidden /> {e.document.name}{e.versionNumber ? ` · v${e.versionNumber}` : ""}</p>}
              <p className="typo-meta mt-2">{e.questions} question(s) · {fmtPoints(e.totalPoints)} points</p>
              <p className="typo-meta">
                {e.attempts === 0 ? "Jamais tenté" : `${e.attempts} tentative(s)${e.best != null ? ` · meilleur score ${fmtPoints(e.best)} / ${fmtPoints(e.totalPoints)}` : ""}`}
              </p>
            </Link>
            {e.inProgress && (
              <Button asChild size="sm" className="mt-3 gap-1.5"><Link href={`${routes.subject(e.subject.id)}/exercices/${e.id}/tentatives/${e.inProgress}`}><Play className="h-4 w-4" aria-hidden /> Reprendre</Link></Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Choix d'un document pour créer un exercice depuis la page globale. */
function DocumentPicker() {
  const router = useRouter();
  const [subjects, setSubjects] = useState<{ id: string; name: string }[]>([]);
  const [subject, setSubject] = useState("");
  const [docs, setDocs] = useState<{ id: string; name: string }[]>([]);
  const [doc, setDoc] = useState("");

  useEffect(() => {
    api.get<{ subjects: { id: string; name: string }[] }>("/api/subjects").then((r) => setSubjects(r.subjects)).catch(() => undefined);
  }, []);
  useEffect(() => {
    setDoc("");
    setDocs([]);
    if (subject) api.get<{ documents: { id: string; name: string }[] }>(`/api/subjects/${subject}/documents`).then((r) => setDocs(r.documents)).catch(() => undefined);
  }, [subject]);

  return (
    <section aria-label="Créer un exercice" className="mb-6 flex flex-wrap items-end gap-2 rounded-xl border bg-card p-4">
      <div className="min-w-48 flex-1">
        <p className="mb-1 text-xs font-medium text-muted-foreground">Matière</p>
        <Select value={subject} onValueChange={setSubject}>
          <SelectTrigger aria-label="Matière"><SelectValue placeholder="Choisir une matière" /></SelectTrigger>
          <SelectContent>{subjects.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="min-w-48 flex-1">
        <p className="mb-1 text-xs font-medium text-muted-foreground">Document source</p>
        <Select value={doc} onValueChange={setDoc} disabled={!subject}>
          <SelectTrigger aria-label="Document"><SelectValue placeholder={subject && docs.length === 0 ? "Aucun document" : "Choisir un document"} /></SelectTrigger>
          <SelectContent>{docs.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <Button disabled={!subject || !doc} onClick={() => router.push(`${routes.subject(subject)}/exercices/nouveau?document=${doc}`)}>Créer un exercice</Button>
    </section>
  );
}
