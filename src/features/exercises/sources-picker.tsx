"use client";

import { useEffect, useState } from "react";
import { FileText, Loader2, Plus, X } from "lucide-react";
import { api } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface ExtraSource {
  documentId: string;
  name: string;
  subjectName: string | null;
  analyzed: boolean;
  mode: "all" | "sections";
  sectionIds: string[];
}

interface Candidate {
  id: string;
  name: string;
  subjectName: string | null;
  analyzed: boolean;
  pageCount: number | null;
}

interface Section {
  id: string;
  label: string;
  numbering: string | null;
  level: number;
}

const MAX_EXTRA = 7;

/**
 * Sources d'un exercice : le document de départ (toujours présent) plus, au choix, d'autres cours entiers ou certaines de leurs
 * sections. Seuls les documents de l'étudiant sont proposés ; rien n'est choisi à sa place.
 */
export function SourcesPicker({ primary, value, onChange, transversal, onTransversal }: { primary: { id: string; name: string }; value: ExtraSource[]; onChange: (v: ExtraSource[]) => void; transversal: boolean; onTransversal: (v: boolean) => void }) {
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sections, setSections] = useState<Record<string, Section[] | "loading">>({});

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ documents: Candidate[] }>("/api/exercises/sources")
      .then((r) => !cancelled && setCandidates(r.documents))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Documents indisponibles."));
    return () => {
      cancelled = true;
    };
  }, []);

  async function loadSections(documentId: string) {
    if (sections[documentId]) return;
    setSections((s) => ({ ...s, [documentId]: "loading" }));
    try {
      const o = await api.get<{ sections: Section[] }>(`/api/files/${documentId}/exercise-options`);
      setSections((s) => ({ ...s, [documentId]: o.sections }));
    } catch {
      setSections((s) => ({ ...s, [documentId]: [] }));
    }
  }

  const chosen = new Set([primary.id, ...value.map((v) => v.documentId)]);
  const available = (candidates ?? []).filter((c) => !chosen.has(c.id));
  const patch = (id: string, p: Partial<ExtraSource>) => onChange(value.map((v) => (v.documentId === id ? { ...v, ...p } : v)));

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">Sources de l&apos;exercice</legend>
      <p className="typo-meta">Les questions sont tirées uniquement de ces documents, chacune avec sa citation. Vous pouvez ajouter ou retirer des cours avant de générer.</p>

      <ul className="space-y-2">
        <li className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
          <FileText className="h-4 w-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate font-medium">{primary.name}</span>
          <span className="text-xs text-muted-foreground">source de départ · couverture choisie ci-dessous</span>
        </li>
        {value.map((v) => {
          const secs = sections[v.documentId];
          return (
            <li key={v.documentId} className="rounded-lg border px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <FileText className="h-4 w-4 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1 truncate font-medium">
                  {v.name}
                  {v.subjectName && <span className="ml-1 text-xs font-normal text-muted-foreground">· {v.subjectName}</span>}
                </span>
                <Select
                  value={v.mode}
                  onValueChange={(m) => {
                    patch(v.documentId, { mode: m as "all" | "sections", sectionIds: [] });
                    if (m === "sections") void loadSections(v.documentId);
                  }}
                >
                  <SelectTrigger className="h-8 w-44 text-xs" aria-label={`Couverture de ${v.name}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tout le document</SelectItem>
                    <SelectItem value="sections" disabled={!v.analyzed}>
                      Sections choisies{v.analyzed ? "" : " (analyse requise)"}
                    </SelectItem>
                  </SelectContent>
                </Select>
                <Button type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={() => onChange(value.filter((x) => x.documentId !== v.documentId))} aria-label={`Retirer ${v.name}`}>
                  <X className="h-4 w-4" aria-hidden />
                </Button>
              </div>
              {v.mode === "sections" && (
                <div className="mt-2 max-h-44 space-y-1 overflow-y-auto border-t pt-2">
                  {secs === "loading" || !secs ? (
                    <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Chargement des sections…</p>
                  ) : secs.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Aucune section détectée dans ce document.</p>
                  ) : (
                    secs.map((s) => (
                      <label key={s.id} className="flex items-center gap-2 text-xs" style={{ paddingLeft: `${Math.min(s.level, 4) * 12}px` }}>
                        <Checkbox checked={v.sectionIds.includes(s.id)} onCheckedChange={(on) => patch(v.documentId, { sectionIds: on ? [...v.sectionIds, s.id] : v.sectionIds.filter((x) => x !== s.id) })} />
                        {s.numbering ? `${s.numbering} ` : ""}
                        {s.label}
                      </label>
                    ))
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {value.length < MAX_EXTRA && (
        <div className="flex items-center gap-2">
          <Select
            value=""
            onValueChange={(id) => {
              const c = candidates?.find((x) => x.id === id);
              if (c) onChange([...value, { documentId: c.id, name: c.name, subjectName: c.subjectName, analyzed: c.analyzed, mode: "all", sectionIds: [] }]);
            }}
            disabled={!candidates || available.length === 0}
          >
            <SelectTrigger className="h-9 w-full max-w-sm text-sm" aria-label="Ajouter un document source">
              <span className="flex items-center gap-2 text-muted-foreground">
                <Plus className="h-4 w-4" aria-hidden />
                {!candidates ? "Chargement…" : available.length === 0 ? "Aucun autre document disponible" : "Ajouter un document"}
              </span>
            </SelectTrigger>
            <SelectContent>
              {available.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                  {c.subjectName ? ` · ${c.subjectName}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {value.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border bg-muted/20 p-3">
          <Checkbox id="ex-transversal" checked={transversal} onCheckedChange={(on) => onTransversal(on === true)} className="mt-0.5" />
          <div>
            <Label htmlFor="ex-transversal" className="text-sm font-medium">Questions transversales</Label>
            <p className="typo-meta">Environ une question sur quatre fait comparer ou relier deux cours ; chaque citation vient de son document. S&apos;il n&apos;y a aucun lien exploitable entre eux, aucune question de ce genre n&apos;est inventée.</p>
          </div>
        </div>
      )}
    </fieldset>
  );
}
