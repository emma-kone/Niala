import { z } from "zod";
import { db } from "@/lib/db";
import { ApiHttpError } from "@/lib/api-helpers";
import { runPool } from "@/lib/concurrency";
import { UNTRUSTED_RULES, wrapUntrusted } from "@/server/ai/guard";
import { generateStructured } from "@/server/ai/structured";
import { isAiConfigured } from "@/server/ai/provider";
import type { PageText } from "@/server/domain/chunking";
import { loadVersionPages, pagesBetween } from "./analysis-service";

// ─────────────────────────────────────────────────────────────────────────────
// Fiche de cours : pour chaque partie choisie par l'étudiant (tout le cours, chaque grande partie, chaque section ou une
// sélection), un résumé et un « à retenir » complet — ce qu'il doit savoir, être capable de faire, les définitions et les
// mécanismes. Tout est construit à partir du texte du document ; les fiches générées sont conservées avec l'analyse.
// ─────────────────────────────────────────────────────────────────────────────

export const GUIDE_PROMPT_VERSION = "study-guide-v1";

export const GRANULARITIES = ["document", "major", "all", "custom"] as const;
export type Granularity = (typeof GRANULARITIES)[number];

const MAX_UNITS = 60;
const MAX_UNIT_CHARS = 14_000;
const MAX_BATCH_CHARS = 30_000;
const MAX_BATCH_UNITS = 4;
const DOCUMENT_BUDGET_CHARS = 42_000;
const CONCURRENCY = 3;

const list = (max: number, len = 400) => z.array(z.string().trim().min(2).max(len)).max(max).catch([]);
const unitOut = z.object({
  id: z.number().int(),
  summary: z.string().trim().max(3000).catch(""),
  retain: list(20),
  abilities: list(15),
  definitions: z.array(z.object({ term: z.string().trim().min(1).max(160), definition: z.string().trim().min(2).max(700) })).max(25).catch([]),
  mechanisms: z.array(z.object({ name: z.string().trim().min(1).max(200), explanation: z.string().trim().min(2).max(1200) })).max(15).catch([]),
});
const response = z.object({ units: z.array(unitOut).max(MAX_BATCH_UNITS + 2) });

export interface GuideUnit {
  key: string;
  label: string;
  numbering: string | null;
  level: number;
  pageStart: number | null;
  pageEnd: number | null;
  summary: string;
  /** Ce qu'il faut savoir à la fin de cette partie. */
  retain: string[];
  /** Ce que l'étudiant doit être capable de faire. */
  abilities: string[];
  definitions: { term: string; definition: string }[];
  /** Mécanismes, méthodes, démonstrations, formules. */
  mechanisms: { name: string; explanation: string }[];
}

export interface Guide {
  key: string;
  granularity: Granularity;
  createdAt: string;
  model: string | null;
  notice: string | null;
  units: GuideUnit[];
}

interface Cache {
  v: 1;
  guides: Record<string, Guide>;
}

function readCache(summary: string | null): Cache {
  if (!summary) return { v: 1, guides: {} };
  try {
    const parsed = JSON.parse(summary) as Partial<Cache>;
    return parsed?.v === 1 && parsed.guides && typeof parsed.guides === "object" ? (parsed as Cache) : { v: 1, guides: {} };
  } catch {
    return { v: 1, guides: {} };
  }
}

/** Texte d'un document long ramené au budget : chaque page garde son début, en proportion. */
export function condensePages(pages: PageText[], budget = DOCUMENT_BUDGET_CHARS): string {
  const total = pages.reduce((n, p) => n + p.text.length, 0);
  if (total <= budget) return pages.map((p) => p.text).join("\n\n");
  const share = Math.max(300, Math.floor(budget / Math.max(1, pages.length)));
  return pages.map((p) => `[page ${p.page ?? "?"}] ${p.text.slice(0, share)}`).join("\n\n").slice(0, budget + 2000);
}

const SYSTEM = `Tu prépares la fiche de révision d'un étudiant à partir de parties de son cours.
${UNTRUSTED_RULES}

Pour CHAQUE partie demandée (identifiée par son numéro), renvoie :
- "summary" : un résumé fidèle de la partie (5 à 12 phrases), sans rien ajouter qui ne soit dans le texte ;
- "retain" : l'« à retenir » : les idées, faits, règles, propriétés et résultats qu'il faut connaître à la fin de cette partie ;
- "abilities" : ce que l'étudiant doit être capable de faire après l'avoir travaillée (verbes d'action : calculer, expliquer, démontrer, écrire, comparer…) ;
- "definitions" : TOUTES les définitions et notions-clés introduites dans la partie, avec leur définition ;
- "mechanisms" : les mécanismes, méthodes, démonstrations, algorithmes ou formules, expliqués étape par étape.
Ne laisse aucune notion du texte de côté ; n'invente rien. Une liste vide est permise quand la partie ne contient rien de tel.
Réponds : {"units":[{"id":<numéro>,"summary":"…","retain":[…],"abilities":[…],"definitions":[{"term":"…","definition":"…"}],"mechanisms":[{"name":"…","explanation":"…"}]}]}`;

interface UnitInput {
  key: string;
  label: string;
  numbering: string | null;
  level: number;
  pageStart: number | null;
  pageEnd: number | null;
  text: string;
}

function batches(units: UnitInput[]): UnitInput[][] {
  const out: UnitInput[][] = [];
  let cur: UnitInput[] = [];
  let size = 0;
  for (const u of units) {
    if (cur.length && (cur.length >= MAX_BATCH_UNITS || size + u.text.length > MAX_BATCH_CHARS)) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(u);
    size += u.text.length;
  }
  if (cur.length) out.push(cur);
  return out;
}

async function resolveAnalysis(userId: string, documentId: string, analysisId?: string) {
  const doc = await db.document.findFirst({ where: { id: documentId, userId }, select: { id: true } });
  if (!doc) throw new ApiHttpError("Document introuvable.", 404);
  const analysis = await db.documentAnalysis.findFirst({
    where: { userId, version: { documentId }, ...(analysisId ? { id: analysisId } : { status: "READY" }) },
    orderBy: { createdAt: "desc" },
  });
  if (!analysis) throw new ApiHttpError(analysisId ? "Analyse introuvable." : "Analysez d'abord le document pour obtenir ses fiches.", analysisId ? 404 : 409);
  if (analysis.status !== "READY") throw new ApiHttpError("Cette analyse n'est pas terminée.", 409);
  return analysis;
}

/** Fiches déjà générées pour une analyse. */
export async function listGuides(userId: string, documentId: string, analysisId?: string) {
  const doc = await db.document.findFirst({ where: { id: documentId, userId }, select: { id: true } });
  if (!doc) throw new ApiHttpError("Document introuvable.", 404);
  const analysis = await db.documentAnalysis.findFirst({
    where: { userId, version: { documentId }, ...(analysisId ? { id: analysisId } : { status: "READY" }) },
    orderBy: { createdAt: "desc" },
    select: { id: true, summary: true },
  });
  if (!analysis) return { analysisId: null, guides: [] as Guide[] };
  return { analysisId: analysis.id, guides: Object.values(readCache(analysis.summary).guides).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) };
}

export interface GuideRequest {
  granularity: Granularity;
  sectionIds?: string[];
  analysisId?: string;
  force?: boolean;
}

export function guideKey(granularity: Granularity, sectionIds: string[] = []): string {
  return granularity === "custom" ? `custom:${[...new Set(sectionIds)].sort().join(",")}` : granularity;
}

export async function generateGuide(userId: string, documentId: string, req: GuideRequest): Promise<Guide> {
  if (!isAiConfigured()) throw new ApiHttpError("Le service d'IA n'est pas configuré : les fiches ne peuvent pas être générées.", 503);
  const analysis = await resolveAnalysis(userId, documentId, req.analysisId);
  const key = guideKey(req.granularity, req.sectionIds);
  if (req.granularity === "custom" && !req.sectionIds?.length) throw new ApiHttpError("Choisissez au moins une partie.", 422);

  const cache = readCache(analysis.summary);
  if (!req.force && cache.guides[key]) return cache.guides[key];

  const pages = await loadVersionPages(userId, analysis.versionId);
  if (pages.every((p) => !p.text.trim())) throw new ApiHttpError("Aucun texte indexé pour ce document.", 409);

  const sections = await db.courseSection.findMany({ where: { analysisId: analysis.id, userId }, orderBy: [{ level: "asc" }, { position: "asc" }] });
  const notices: string[] = [];
  let inputs: UnitInput[];

  if (req.granularity === "document") {
    const doc = await db.document.findFirst({ where: { id: documentId, userId }, select: { name: true } });
    const outline = sections.slice(0, 80).map((s) => `${"  ".repeat(Math.min(s.level, 4))}${s.numbering ? s.numbering + " " : ""}${s.label}`).join("\n");
    const total = pages.reduce((n, p) => n + p.text.length, 0);
    if (total > DOCUMENT_BUDGET_CHARS) notices.push("Cours long : la fiche d'ensemble s'appuie sur le début de chaque page. Pour un détail complet, demandez les fiches par partie.");
    inputs = [{ key: "document", label: doc?.name ?? "Cours complet", numbering: null, level: 0, pageStart: pages[0]?.page ?? null, pageEnd: pages.at(-1)?.page ?? null, text: `${outline ? `Plan du cours :\n${outline}\n\n` : ""}${condensePages(pages)}` }];
  } else {
    const byId = new Map(sections.map((s) => [s.id, s]));
    const chosen =
      req.granularity === "major"
        ? sections.filter((s) => s.parentId === null)
        : req.granularity === "all"
          ? sections
          : (req.sectionIds ?? []).map((id) => byId.get(id)).filter((s): s is NonNullable<typeof s> => !!s);
    if (chosen.length === 0) throw new ApiHttpError("Ce document n'a pas de plan : générez la fiche d'ensemble, ou complétez le plan d'abord.", 409);
    if (chosen.length > MAX_UNITS) notices.push(`Fiches limitées aux ${MAX_UNITS} premières parties : choisissez les autres une par une.`);
    // Du document dans l'ordre de lecture (niveau puis position ne suffit pas : on suit les pages).
    const ordered = [...chosen].sort((a, b) => (a.pageStart ?? 0) - (b.pageStart ?? 0) || a.level - b.level || a.position - b.position).slice(0, MAX_UNITS);
    inputs = ordered.map((s) => {
      const text = pagesBetween(pages, s.pageStart, s.pageEnd).map((p) => p.text).join("\n").slice(0, MAX_UNIT_CHARS);
      return { key: s.id, label: s.label, numbering: s.numbering, level: s.level, pageStart: s.pageStart, pageEnd: s.pageEnd, text };
    });
    const empty = inputs.filter((u) => u.text.replace(/\s/g, "").length < 40).length;
    if (empty) notices.push(`${empty} partie(s) sans texte exploitable ont été ignorées.`);
    inputs = inputs.filter((u) => u.text.replace(/\s/g, "").length >= 40);
    if (inputs.length === 0) throw new ApiHttpError("Les parties choisies ne contiennent pas de texte exploitable.", 409);
  }

  let model: string | null = null;
  let failed = 0;
  const done = new Map<string, GuideUnit>();
  await runPool(batches(inputs), CONCURRENCY, async (batch) => {
    const body = batch.map((u, i) => `[[PARTIE ${i + 1}]] ${u.numbering ? u.numbering + " " : ""}${u.label}\n${u.text}`).join("\n\n");
    try {
      const { data, model: m } = await generateStructured({
        userId,
        op: "analysis.study-guide",
        promptVersion: GUIDE_PROMPT_VERSION,
        system: SYSTEM,
        user: `Parties à résumer :\n${wrapUntrusted("cours", body)}`,
        schema: response,
        maxTokens: 8000,
        temperature: 0.2,
      });
      model = m;
      batch.forEach((u, i) => {
        const out = data.units.find((x) => x.id === i + 1);
        if (!out || (!out.summary && !out.retain.length && !out.definitions.length)) return void failed++;
        done.set(u.key, { key: u.key, label: u.label, numbering: u.numbering, level: u.level, pageStart: u.pageStart, pageEnd: u.pageEnd, summary: out.summary, retain: out.retain, abilities: out.abilities, definitions: out.definitions, mechanisms: out.mechanisms });
      });
    } catch (e) {
      failed += batch.length;
      if (e instanceof Error && /quota|limite/i.test(e.message)) notices.push(e.message);
    }
  });

  const units = inputs.map((u) => done.get(u.key)).filter((u): u is GuideUnit => !!u);
  if (units.length === 0) throw new ApiHttpError("La génération a échoué. Réessayez dans un instant.", 502);
  if (failed) notices.push(`${failed} partie(s) n'ont pas pu être résumées : relancez la génération pour les obtenir.`);

  const guide: Guide = { key, granularity: req.granularity, createdAt: new Date().toISOString(), model, notice: [...new Set(notices)].join(" ") || null, units };
  // Relecture avant écriture : une autre fiche générée entre-temps n'est pas perdue.
  const fresh = await db.documentAnalysis.findFirst({ where: { id: analysis.id, userId }, select: { summary: true } });
  const next = readCache(fresh?.summary ?? null);
  next.guides[key] = guide;
  await db.documentAnalysis.updateMany({ where: { id: analysis.id, userId }, data: { summary: JSON.stringify(next) } });
  return guide;
}
