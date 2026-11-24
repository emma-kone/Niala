"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight, Copy, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { api } from "@/lib/client-api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

type Granularity = "document" | "major" | "all" | "custom";

interface GuideUnit {
  key: string;
  label: string;
  numbering: string | null;
  level: number;
  pageStart: number | null;
  pageEnd: number | null;
  summary: string;
  retain: string[];
  abilities: string[];
  definitions: { term: string; definition: string }[];
  mechanisms: { name: string; explanation: string }[];
}

interface Guide {
  key: string;
  granularity: Granularity;
  createdAt: string;
  notice: string | null;
  units: GuideUnit[];
}

export interface GuideSection {
  id: string;
  parentId: string | null;
  label: string;
  numbering: string | null;
  level: number;
  pageStart: number | null;
}

const SCOPES: { id: Granularity; label: string; hint: string }[] = [
  { id: "document", label: "Tout le cours", hint: "Une fiche d'ensemble" },
  { id: "major", label: "Grandes parties", hint: "Une fiche par grande partie" },
  { id: "all", label: "Chaque section", hint: "Une fiche par section du plan" },
  { id: "custom", label: "Mon choix", hint: "Les parties que vous cochez" },
];

const BLOCKS = [
  { id: "summary", label: "Résumé" },
  { id: "retain", label: "À retenir" },
  { id: "abilities", label: "Savoir-faire" },
  { id: "definitions", label: "Définitions" },
  { id: "mechanisms", label: "Mécanismes" },
] as const;
type BlockId = (typeof BLOCKS)[number]["id"];

const errText = (e: unknown, fb: string) => (e instanceof Error ? e.message : fb);
const guideKey = (g: Granularity, ids: string[]) => (g === "custom" ? `custom:${[...new Set(ids)].sort().join(",")}` : g);

function toMarkdown(guide: Guide, shown: Set<BlockId>): string {
  return guide.units
    .map((u) => {
      const out = [`${"#".repeat(Math.min(u.level + 2, 4))} ${u.numbering ? u.numbering + " " : ""}${u.label}`];
      if (shown.has("summary") && u.summary) out.push(u.summary);
      if (shown.has("retain") && u.retain.length) out.push("**À retenir**", ...u.retain.map((r) => `- ${r}`));
      if (shown.has("abilities") && u.abilities.length) out.push("**Être capable de**", ...u.abilities.map((r) => `- ${r}`));
      if (shown.has("definitions") && u.definitions.length) out.push("**Définitions**", ...u.definitions.map((d) => `- **${d.term}** : ${d.definition}`));
      if (shown.has("mechanisms") && u.mechanisms.length) out.push("**Mécanismes et méthodes**", ...u.mechanisms.map((m) => `- **${m.name}** : ${m.explanation}`));
      return out.join("\n\n");
    })
    .join("\n\n");
}

function Bullets({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="mt-2.5">
      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
      <ul className="mt-1 list-disc space-y-1 pl-4 text-sm">
        {items.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>
    </div>
  );
}

/** Fiches de cours : résumé et « à retenir » par partie, à la granularité choisie par l'étudiant. */
export function StudyGuidePanel({ docId, analysisId, sections, aiConfigured, onGoToPage }: { docId: string; analysisId: string; sections: GuideSection[]; aiConfigured: boolean; onGoToPage: (page: number) => void }) {
  const [scope, setScope] = useState<Granularity>("major");
  const [picked, setPicked] = useState<string[]>([]);
  const [guides, setGuides] = useState<Guide[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState<Set<BlockId>>(new Set(BLOCKS.map((b) => b.id)));
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ guides: Guide[] }>(`/api/files/${docId}/study-guide?analysisId=${analysisId}`);
      setGuides(r.guides);
    } catch (e) {
      setError(errText(e, "Fiches indisponibles."));
      setGuides([]);
    }
  }, [docId, analysisId]);
  useEffect(() => {
    void load();
  }, [load]);

  const key = guideKey(scope, picked);
  const guide = useMemo(() => guides?.find((g) => g.key === key) ?? null, [guides, key]);
  const noPlan = sections.length === 0 && scope !== "document";

  async function generate(force: boolean) {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ guide: Guide }>(`/api/files/${docId}/study-guide`, { granularity: scope, analysisId, force, ...(scope === "custom" ? { sectionIds: picked } : {}) });
      setGuides((list) => [r.guide, ...(list ?? []).filter((g) => g.key !== r.guide.key)]);
    } catch (e) {
      setError(errText(e, "La génération a échoué."));
    } finally {
      setBusy(false);
    }
  }

  function toggle<T>(set: Set<T>, value: T): Set<T> {
    const n = new Set(set);
    if (n.has(value)) n.delete(value);
    else n.add(value);
    return n;
  }

  async function copy() {
    if (!guide) return;
    try {
      await navigator.clipboard.writeText(toMarkdown(guide, shown));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Copie impossible.");
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2.5 border-b p-3">
        <div role="radiogroup" aria-label="Portée de la fiche" className="grid grid-cols-2 gap-1.5">
          {SCOPES.map((s) => (
            <button key={s.id} type="button" role="radio" aria-checked={scope === s.id} onClick={() => setScope(s.id)} title={s.hint} className={cn("rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors", scope === s.id ? "border-foreground bg-muted font-semibold" : "hover:bg-muted/60")}>
              {s.label}
              <span className="block text-[10px] font-normal text-muted-foreground">{s.hint}</span>
            </button>
          ))}
        </div>

        {scope === "custom" && (
          <ul aria-label="Parties à résumer" className="max-h-40 space-y-0.5 overflow-y-auto rounded-lg border p-1.5">
            {sections.length === 0 && <li className="px-1 py-0.5 text-xs text-muted-foreground">Aucune section dans le plan.</li>}
            {sections.map((s) => (
              <li key={s.id} style={{ paddingLeft: Math.min(s.level, 4) * 12 }}>
                <label className="flex cursor-pointer items-start gap-2 rounded px-1 py-0.5 text-xs hover:bg-muted/60">
                  <Checkbox checked={picked.includes(s.id)} onCheckedChange={(v) => setPicked((p) => (v === true ? [...p, s.id] : p.filter((x) => x !== s.id)))} className="mt-0.5" aria-label={s.label} />
                  <span>{s.numbering ? `${s.numbering} ` : ""}{s.label}</span>
                </label>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center gap-2">
          <Button size="sm" className="flex-1 gap-1.5" disabled={busy || !aiConfigured || noPlan || (scope === "custom" && picked.length === 0)} onClick={() => void generate(!!guide)}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : guide ? <RefreshCw className="h-4 w-4" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}
            {busy ? "Génération en cours…" : guide ? "Régénérer" : "Générer la fiche"}
          </Button>
          {guide && (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void copy()}>
              {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />} {copied ? "Copié" : "Copier"}
            </Button>
          )}
        </div>
        {!aiConfigured && <p role="note" className="text-xs text-amber-700 dark:text-amber-400">Le service d&apos;IA n&apos;est pas configuré : les fiches ne peuvent pas être générées.</p>}
        {noPlan && <p role="note" className="text-xs text-muted-foreground">Ce cours n&apos;a pas de plan : choisissez « Tout le cours », ou complétez le plan dans l&apos;onglet Plan.</p>}
        {busy && <p role="status" className="text-xs text-muted-foreground">Lecture du cours et rédaction des fiches : cela peut prendre une à plusieurs minutes.</p>}
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}

        {guide && (
          <div role="group" aria-label="Rubriques affichées" className="flex flex-wrap gap-1">
            {BLOCKS.map((b) => (
              <button key={b.id} type="button" aria-pressed={shown.has(b.id)} onClick={() => setShown((s) => toggle(s, b.id))} className={cn("rounded-full border px-2 py-0.5 text-[11px] transition-colors", shown.has(b.id) ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:bg-muted")}>
                {b.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {guides === null && <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Chargement…</p>}
        {guides && !guide && !busy && <p className="text-sm text-muted-foreground">Choisissez la portée de la fiche, puis générez-la : résumé, points à retenir, savoir-faire, définitions et mécanismes de chaque partie.</p>}
        {guide?.notice && <p role="note" className="mb-2 rounded-md bg-muted p-2 text-xs text-muted-foreground">{guide.notice}</p>}
        <ul className="space-y-2">
          {guide?.units.map((u) => {
            const open = !closed.has(u.key);
            return (
              <li key={u.key} className="rounded-lg border bg-card">
                <button type="button" aria-expanded={open} onClick={() => setClosed((c) => toggle(c, u.key))} className="flex w-full items-start gap-1.5 px-2.5 py-2 text-left">
                  {open ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
                  <span className="min-w-0 flex-1 text-sm font-semibold">{u.numbering ? `${u.numbering} ` : ""}{u.label}</span>
                  {u.pageStart && (
                    <span
                      role="link"
                      tabIndex={0}
                      onClick={(e) => { e.stopPropagation(); onGoToPage(u.pageStart!); }}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onGoToPage(u.pageStart!); } }}
                      className="shrink-0 text-[11px] text-primary hover:underline"
                    >
                      p. {u.pageStart}{u.pageEnd && u.pageEnd !== u.pageStart ? `–${u.pageEnd}` : ""}
                    </span>
                  )}
                </button>
                {open && (
                  <div className="border-t px-3 pb-3 pt-1">
                    {shown.has("summary") && u.summary && <p className="mt-2 whitespace-pre-line text-sm">{u.summary}</p>}
                    {shown.has("retain") && <Bullets title="À retenir" items={u.retain} />}
                    {shown.has("abilities") && <Bullets title="À la fin, vous devez être capable de" items={u.abilities} />}
                    {shown.has("definitions") && u.definitions.length > 0 && (
                      <div className="mt-2.5">
                        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Définitions</h4>
                        <dl className="mt-1 space-y-1.5 text-sm">
                          {u.definitions.map((d, i) => (
                            <div key={i}>
                              <dt className="font-medium">{d.term}</dt>
                              <dd className="text-muted-foreground">{d.definition}</dd>
                            </div>
                          ))}
                        </dl>
                      </div>
                    )}
                    {shown.has("mechanisms") && u.mechanisms.length > 0 && (
                      <div className="mt-2.5">
                        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Mécanismes et méthodes</h4>
                        <ul className="mt-1 space-y-1.5 text-sm">
                          {u.mechanisms.map((m, i) => (
                            <li key={i}>
                              <span className="font-medium">{m.name}</span> — <span className="text-muted-foreground">{m.explanation}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
