"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Database, FileUp, Loader2, Plus, Terminal } from "lucide-react";
import { api } from "@/lib/client-api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { routes } from "@/config/routes";
import type { LabKind, LabListItem } from "./types";
import { confirmAction } from "@/components/notifications";

const errText = (e: unknown, fb: string) => (e instanceof Error ? e.message : fb);
const CODE_LANGS = [
  { id: "python", label: "Python 3" },
  { id: "javascript", label: "JavaScript" },
  { id: "typescript", label: "TypeScript" },
];

interface Capabilities {
  available: boolean;
  reason?: string;
  note: string;
  fixtures: { id: string; label: string; description: string }[];
}

interface ImportResponse {
  workspaces: { id: string; title: string }[];
  notice: string | null;
}

export default function LabsHome({ kind }: { kind: LabKind }) {
  const router = useRouter();
  const base = kind === "SQL" ? routes.sql : routes.code;
  const [items, setItems] = useState<LabListItem[] | null>(null);
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lang, setLang] = useState("python");
  const [fixture, setFixture] = useState("bibliotheque");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // import d'un document
  const [subjects, setSubjects] = useState<{ id: string; name: string }[]>([]);
  const [subjectId, setSubjectId] = useState("");
  const [docs, setDocs] = useState<{ id: string; name: string }[]>([]);
  const [docId, setDocId] = useState("");
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<{ tone: "ok" | "warn"; text: string; created: { id: string; title: string }[] } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ workspaces: LabListItem[] }>(`/api/labs?kind=${kind}`);
      setItems(r.workspaces);
      setError(null);
    } catch (e) {
      setError(errText(e, "Chargement impossible."));
    }
  }, [kind]);

  useEffect(() => {
    void load();
    api.get<Capabilities>("/api/labs/capabilities").then(setCaps).catch(() => undefined);
    api.get<{ subjects: { id: string; name: string }[] }>("/api/subjects").then((r) => setSubjects(r.subjects)).catch(() => undefined);
  }, [load]);

  useEffect(() => {
    setDocs([]);
    setDocId("");
    if (!subjectId) return;
    api.get<{ documents: { id: string; name: string }[] }>(`/api/subjects/${subjectId}/documents`).then((r) => setDocs(r.documents)).catch(() => undefined);
  }, [subjectId]);

  async function createFree() {
    setBusy(true);
    setActionError(null);
    try {
      const r = await api.post<{ workspace: { id: string } }>("/api/labs", kind === "SQL" ? { from: "free", kind, fixtureId: fixture } : { from: "free", kind, language: lang });
      router.push(`${base}/${r.workspace.id}`);
    } catch (e) {
      setActionError(errText(e, "Création impossible."));
      setBusy(false);
    }
  }

  async function importDoc() {
    setImporting(true);
    setActionError(null);
    setImportMsg(null);
    try {
      const r = await api.post<ImportResponse>("/api/labs", { from: "document", kind, documentId: docId, ...(kind === "CODE" ? { language: lang } : {}) });
      void load();
      if (r.workspaces.length === 0) setImportMsg({ tone: "warn", text: r.notice ?? "Aucun exercice trouvé.", created: [] });
      else setImportMsg({ tone: r.notice ? "warn" : "ok", text: `${r.workspaces.length} exercice(s) créé(s).${r.notice ? " " + r.notice : ""}`, created: r.workspaces });
    } catch (e) {
      setActionError(errText(e, "Import impossible."));
    } finally {
      setImporting(false);
    }
  }

  async function remove(id: string) {
    if (!(await confirmAction("Supprimer cet espace de travail et son historique ?", { confirmLabel: "Supprimer" }))) return;
    try {
      await api.del(`/api/labs/${id}`);
      void load();
    } catch (e) {
      setActionError(errText(e, "Suppression impossible."));
    }
  }

  const Icon = kind === "SQL" ? Database : Terminal;
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <h1 className="typo-h1 flex items-center gap-2"><Icon className="h-6 w-6" aria-hidden /> {kind === "SQL" ? "Laboratoire SQL" : "Éditeur de code"}</h1>
      <p className="typo-subtitle mt-1">
        {kind === "SQL"
          ? "Écrivez des requêtes sur une base jetable, comparez-les à une solution de référence sur plusieurs jeux de données."
          : "Exécutez du code Python, JavaScript ou TypeScript dans un environnement isolé, librement ou face à des tests objectifs."}{" "}
        {caps?.note}
      </p>

      {caps && !caps.available && <Alert variant="destructive" className="mt-4"><AlertTitle>Exécution indisponible</AlertTitle><AlertDescription>{caps.reason}</AlertDescription></Alert>}

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <section aria-label="Nouvel espace libre" className="rounded-xl border bg-card p-4">
          <h2 className="typo-h3">Espace libre</h2>
          <p className="typo-subtitle mb-3">Pour expérimenter. Chaque exécution est enregistrée dans l&apos;historique.</p>
          <div className="flex flex-wrap items-end gap-2">
            {kind === "CODE" ? (
              <Select value={lang} onValueChange={setLang}>
                <SelectTrigger className="w-44" aria-label="Langage"><SelectValue /></SelectTrigger>
                <SelectContent>{CODE_LANGS.map((l) => <SelectItem key={l.id} value={l.id}>{l.label}</SelectItem>)}</SelectContent>
              </Select>
            ) : (
              <Select value={fixture} onValueChange={setFixture}>
                <SelectTrigger className="w-56" aria-label="Jeu de données"><SelectValue /></SelectTrigger>
                <SelectContent>{(caps?.fixtures ?? [{ id: "bibliotheque", label: "Bibliothèque", description: "" }]).map((f) => <SelectItem key={f.id} value={f.id}>{f.label}</SelectItem>)}</SelectContent>
              </Select>
            )}
            <Button className="gap-2" onClick={() => void createFree()} disabled={busy || caps?.available === false}>{busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />} Créer</Button>
          </div>
        </section>

        <section aria-label="Importer un énoncé" className="rounded-xl border bg-card p-4">
          <h2 className="typo-h3">Depuis un document</h2>
          <p className="typo-subtitle mb-3">Extrait les énoncés d&apos;un TP ou d&apos;un sujet, avec des tests validés par une solution de référence (nécessite l&apos;IA).</p>
          <div className="flex flex-wrap items-end gap-2">
            <Select value={subjectId} onValueChange={setSubjectId}>
              <SelectTrigger className="w-44" aria-label="Matière"><SelectValue placeholder="Matière" /></SelectTrigger>
              <SelectContent>{subjects.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={docId} onValueChange={setDocId} disabled={!subjectId}>
              <SelectTrigger className="w-56" aria-label="Document"><SelectValue placeholder={subjectId && docs.length === 0 ? "Aucun document" : "Document"} /></SelectTrigger>
              <SelectContent>{docs.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
            </Select>
            {kind === "CODE" && (
              <Select value={lang} onValueChange={setLang}>
                <SelectTrigger className="w-36" aria-label="Langage"><SelectValue /></SelectTrigger>
                <SelectContent>{CODE_LANGS.map((l) => <SelectItem key={l.id} value={l.id}>{l.label}</SelectItem>)}</SelectContent>
              </Select>
            )}
            <Button className="gap-2" onClick={() => void importDoc()} disabled={!docId || importing || caps?.available === false}>{importing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FileUp className="h-4 w-4" aria-hidden />} Extraire</Button>
          </div>
          {importing && <p className="mt-2 text-xs text-muted-foreground" aria-live="polite">Lecture du document, génération puis vérification des tests par exécution… (jusqu&apos;à quelques minutes)</p>}
          {importMsg && (
            <div role="status" className={`mt-3 rounded-md border p-3 text-sm ${importMsg.tone === "warn" ? "border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200" : "border-emerald-300 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200"}`}>
              <p>{importMsg.text}</p>
              {importMsg.created.length > 0 && <ul className="mt-1 list-disc pl-5">{importMsg.created.map((c) => <li key={c.id}><Link className="underline" href={`${base}/${c.id}`}>{c.title}</Link></li>)}</ul>}
            </div>
          )}
        </section>
      </div>
      {actionError && <p role="alert" className="mt-3 text-sm text-destructive">{actionError}</p>}

      <h2 className="typo-h3 mb-2 mt-8">Mes espaces de travail</h2>
      {error ? <Alert variant="destructive"><AlertTitle>Chargement impossible</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : !items ? (
        <div className="space-y-2" aria-busy><Skeleton className="h-16 rounded-xl" /><Skeleton className="h-16 rounded-xl" /></div>
      ) : items.length === 0 ? (
        <p className="typo-subtitle rounded-xl border border-dashed p-6 text-center">Aucun espace de travail pour l&apos;instant. Créez un espace libre ou importez les énoncés d&apos;un document.</p>
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {items.map((w) => (
            <li key={w.id} className="flex items-center gap-3 px-4 py-3">
              <Link href={`${base}/${w.id}`} className="min-w-0 flex-1">
                <span className="block truncate font-medium">{w.title}</span>
                <span className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline" className="font-normal">{w.mode === "EXERCISE" ? "Exercice" : "Libre"}</Badge>
                  {w.language && <span>{w.language}</span>}
                  {w.subjectName && <span>{w.subjectName}</span>}
                  <span>modifié le {new Date(w.updatedAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })}</span>
                </span>
              </Link>
              {w.lastResult && <span className={`text-sm font-semibold ${w.lastResult.allPassed ? "text-emerald-700 dark:text-emerald-400" : ""}`}>{w.lastResult.passed}/{w.lastResult.total}</span>}
              <Button variant="ghost" size="sm" className="text-destructive" onClick={() => void remove(w.id)} aria-label={`Supprimer ${w.title}`}>Supprimer</Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
