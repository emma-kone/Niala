"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, BookOpen, ChevronDown, ExternalLink, Search } from "lucide-react";
import { routes } from "@/config/routes";
import { cn } from "@/lib/utils";
import type { ChatCitation, ConsultedInfo } from "./types";

const LEVEL_BADGE: Record<1 | 2 | 3 | 4, { label: string; cls: string }> = {
  1: { label: "source primaire", cls: "border-emerald-500/50 text-emerald-700 dark:text-emerald-400" },
  2: { label: "source secondaire", cls: "border-sky-500/50 text-sky-700 dark:text-sky-400" },
  3: { label: "forum ou communauté", cls: "border-amber-500/50 text-amber-700 dark:text-amber-300" },
  4: { label: "source non vérifiée", cls: "border-amber-500/50 text-amber-700 dark:text-amber-300" },
};

function CitationRow({ c, highlighted, onCitation, onVerify }: { c: ChatCitation; highlighted: boolean; onCitation?: (c: ChatCitation) => void; onVerify?: (c: ChatCitation) => void }) {
  const cls = "block w-full rounded-lg px-2 py-1 text-left text-xs transition-colors hover:bg-muted";
  const num = <span className="mr-1.5 rounded-md bg-muted px-1.5 font-mono text-[11px]">{c.n}</span>;
  const shell = cn("rounded-lg transition-colors", highlighted && "bg-[color-mix(in_srgb,var(--niala-accent)_16%,transparent)]");
  if (c.kind === "web" && c.url) {
    return (
      <li className={shell}>
        <a className={cls} href={c.url} target="_blank" rel="noopener noreferrer">
          {num}
          <span className="font-medium">{c.documentName}</span>
          <ExternalLink className="ml-1 inline h-3 w-3 text-muted-foreground" aria-hidden />
          {c.level ? (
            <span className={cn("ml-2 rounded-full border px-1.5 py-px text-[10px]", LEVEL_BADGE[c.level].cls)}>{LEVEL_BADGE[c.level].label}</span>
          ) : (
            <span className={cn("ml-2 rounded-full border px-1.5 py-px text-[10px]", c.tier === "reconnue" ? LEVEL_BADGE[1].cls : LEVEL_BADGE[4].cls)}>{c.tier === "reconnue" ? "source reconnue" : "source à vérifier"}</span>
          )}
          {c.retrievedAt && (
            <span className="block pl-7 text-[11px] text-muted-foreground">
              {c.organization ?? ""}
              {c.publishedAt ? ` · publié : ${c.publishedAt}` : " · date de publication inconnue"} · consulté le {new Date(c.retrievedAt).toLocaleDateString("fr-FR")}
            </span>
          )}
        </a>
      </li>
    );
  }
  const label = (
    <>
      {num}
      <span className="font-medium">{c.documentName}</span>
      {c.page ? <span className="text-muted-foreground"> · p. {c.page}</span> : null}
      {c.section ? <span className="text-muted-foreground"> · {c.section}</span> : null}
      <span className="block truncate pl-7 text-[11px] italic text-muted-foreground">« {c.quote} »</span>
    </>
  );
  return (
    <li className={shell}>
      {onVerify && (
        <button type="button" className="float-right ml-2 mt-1 inline-flex items-center gap-1 rounded px-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => onVerify(c)} title="Rechercher une confirmation dans des sources externes">
          <Search className="h-3 w-3" aria-hidden /> Vérifier ce point
        </button>
      )}
      {onCitation ? (
        <button type="button" className={cls} onClick={() => onCitation(c)}>
          {label}
        </button>
      ) : c.subjectId ? (
        <Link className={cls} href={`${routes.subject(c.subjectId)}/documents/${c.documentId}${c.page ? `?page=${c.page}` : ""}`}>
          {label}
        </Link>
      ) : (
        <div className={cls}>{label}</div>
      )}
    </li>
  );
}

/** Sources de la réponse : repliées par défaut pour laisser la place au texte, ouvertes par un renvoi [n]. */
export function SourceList({ citations, focus, onCitation, onVerify }: { citations: ChatCitation[]; focus: { n: number; nonce: number } | null; onCitation?: (c: ChatCitation) => void; onVerify?: (c: ChatCitation) => void }) {
  // Un renvoi [n] plus récent que le dernier geste sur le bouton ouvre la liste.
  const [toggled, setToggled] = useState({ open: false, nonce: 0 });
  const list = useRef<HTMLUListElement>(null);
  const focused = focus?.n ?? null;
  const nonce = focus?.nonce ?? 0;
  const open = nonce > toggled.nonce || toggled.open;
  useEffect(() => {
    if (focused === null) return;
    const t = setTimeout(() => list.current?.querySelector(`[data-source="${focused}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 40);
    return () => clearTimeout(t);
  }, [focused, nonce]);
  if (!citations.length) return null;
  const docs = citations.filter((c) => c.kind !== "web").length;
  const web = citations.length - docs;
  const summary = [docs ? `${docs} passage${docs > 1 ? "s" : ""} de cours` : null, web ? `${web} source${web > 1 ? "s" : ""} web` : null].filter(Boolean).join(" · ");
  return (
    <div className="mt-3">
      <button type="button" aria-expanded={open} onClick={() => setToggled({ open: !open, nonce })} className="inline-flex items-center gap-1.5 rounded-full bg-muted/60 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground">
        <BookOpen className="h-3 w-3" aria-hidden /> {summary}
        <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <ul ref={list} className="mt-1.5 space-y-0.5" aria-label="Sources">
          {citations.map((c) => (
            <div key={c.n} data-source={c.n}>
              <CitationRow c={c} highlighted={focused === c.n} onCitation={onCitation} onVerify={onVerify} />
            </div>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Limites de lecture utiles. N'affiche rien quand aucune source n'a été utilisée (question libre). */
export function ConsultedNotice({ info }: { info: ConsultedInfo | null }) {
  if (!info) return null;
  const used = new Set(info.documents.map((d) => d.id));
  const consulted = info.coverage.filter((c) => used.has(c.documentId));
  const warnings = consulted.flatMap((c) => c.warnings.map((w) => (consulted.length > 1 ? `${c.documentName} : ${w}` : w)));
  if (!warnings.length) return null;
  return (
    <p className="mt-2 flex items-start gap-1 text-[11px] text-amber-700 dark:text-amber-300">
      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
      <span>{warnings.join(" ")}</span>
    </p>
  );
}
