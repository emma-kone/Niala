import { z } from "zod";
import { generateStructured } from "@/server/ai/structured";
import { UNTRUSTED_RULES, foldText, quoteInText, wrapUntrusted, groundedRatio } from "@/server/ai/guard";
import type { PageText } from "@/server/domain/chunking";

// ─────────────────────────────────────────────────────────────────────────────
// Services IA de l'analyse : ConceptExtractionService et DocumentStructureService (repli IA).
// Reçoivent un contexte structuré, renvoient des résultats VALIDÉS et VÉRIFIÉS :
// une notion n'est marquée « présente dans le document » que si sa citation y figure réellement.
// ─────────────────────────────────────────────────────────────────────────────

export const PROMPT_VERSION = "analysis-v1";

const RELATIONS = ["PREREQUISITE", "PART_OF", "EXAMPLE_OF", "DEFINES", "CONTRASTS", "RELATED"] as const;
const KINDS = ["NOTION", "DEFINITION", "PROPERTY", "RULE", "EXAMPLE"] as const;

const conceptOut = z.object({
  name: z.string().trim().min(2).max(120),
  kind: z.enum(KINDS).catch("NOTION"),
  importance: z.number().int().min(1).max(3).catch(2),
  definition: z.string().trim().max(600).optional(),
  quote: z.string().trim().max(400).optional(),
});
const relationOut = z.object({
  from: z.string().trim().min(2).max(120),
  to: z.string().trim().min(2).max(120),
  type: z.enum(RELATIONS).catch("RELATED"),
  quote: z.string().trim().max(400).optional(),
});
const conceptsResponse = z.object({
  sections: z
    .array(z.object({ id: z.number().int(), concepts: z.array(conceptOut).max(25).catch([]), relations: z.array(relationOut).max(30).catch([]) }))
    .max(40),
});

export interface SectionInput {
  key: number;
  numbering: string | null;
  label: string;
  text: string;
  /** Pages couvertes par la section (pour attribuer une page à chaque citation vérifiée). */
  pages: PageText[];
}

export interface ExtractedConcept {
  name: string;
  normalizedName: string;
  kind: (typeof KINDS)[number];
  importance: number;
  definition: string | null;
  origin: "DOCUMENT" | "AI_INFERRED";
  /** Présent uniquement si la citation a été retrouvée dans le texte source. */
  ref: { page: number | null; quote: string } | null;
}

export interface ExtractedRelation {
  from: string;
  to: string;
  type: (typeof RELATIONS)[number];
  origin: "DOCUMENT" | "AI_INFERRED";
}

export interface SectionExtraction {
  key: number;
  concepts: ExtractedConcept[];
  relations: ExtractedRelation[];
}

const MAX_BATCH_CHARS = 16_000;
const MIN_DEFINITION_GROUNDING = 0.5;
const MAX_SECTION_CHARS = 6_000;

function pageOfQuote(quote: string, pages: PageText[]): number | null {
  for (const p of pages) if (quoteInText(quote, p.text)) return p.page;
  return null;
}

/** Regroupe les sections en lots de taille bornée (un appel IA par lot). */
export function batchSections(sections: SectionInput[]): SectionInput[][] {
  const batches: SectionInput[][] = [];
  let cur: SectionInput[] = [];
  let size = 0;
  for (const s of sections) {
    const clipped = { ...s, text: s.text.slice(0, MAX_SECTION_CHARS) };
    if (cur.length && (size + clipped.text.length > MAX_BATCH_CHARS || cur.length >= 8)) {
      batches.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(clipped);
    size += clipped.text.length;
  }
  if (cur.length) batches.push(cur);
  return batches;
}

const CONCEPT_SYSTEM = `Tu es un assistant pédagogique. Tu analyses des sections d'un cours et tu en extrais les notions.
${UNTRUSTED_RULES}

Pour chaque section demandée, renvoie :
- "concepts" : les notions (name, kind parmi NOTION|DEFINITION|PROPERTY|RULE|EXAMPLE, importance 1-3, definition courte)
- "quote" : UNIQUEMENT si l'élément est explicitement écrit dans la section, recopie VERBATIM l'extrait du document qui l'établit (15 à 300 caractères). Si c'est ta déduction, n'écris PAS de quote.
- "relations" : liens entre notions (from, to = noms de notions, type parmi PREREQUISITE|PART_OF|EXAMPLE_OF|DEFINES|CONTRASTS|RELATED), avec "quote" seulement si le lien est écrit dans le document.
Réponds : {"sections":[{"id":<numéro>,"concepts":[...],"relations":[...]}]}`;

/** ConceptExtractionService : notions et relations d'un lot de sections, vérifiées contre le texte source. */
export async function extractConcepts(userId: string, batch: SectionInput[]): Promise<{ results: SectionExtraction[]; model: string }> {
  const body = batch
    .map((s) => `[[SECTION ${s.key}]] ${s.numbering ? s.numbering + " " : ""}${s.label}\n${s.text.slice(0, MAX_SECTION_CHARS)}`)
    .join("\n\n");
  const { data, model } = await generateStructured({
    userId,
    op: "analysis.concepts",
    promptVersion: PROMPT_VERSION,
    system: CONCEPT_SYSTEM,
    user: `Sections à analyser :\n${wrapUntrusted("cours", body)}`,
    schema: conceptsResponse,
    maxTokens: 6000,
  });

  const results: SectionExtraction[] = [];
  for (const s of batch) {
    const out = data.sections.find((x) => x.id === s.key);
    const concepts: ExtractedConcept[] = [];
    const seen = new Set<string>();
    for (const c of out?.concepts ?? []) {
      const normalizedName = foldText(c.name);
      if (!normalizedName || seen.has(`${normalizedName}|${c.kind}`)) continue;
      seen.add(`${normalizedName}|${c.kind}`);
      // Vérification serveur : la citation doit exister dans la section
      const verified = c.quote && quoteInText(c.quote, s.text) ? c.quote : null;
      // Une citation exacte ne suffit pas : la définition reformulée doit, elle aussi, venir de la section.
      const definitionGrounded = !c.definition || groundedRatio(c.definition, s.text) >= MIN_DEFINITION_GROUNDING;
      concepts.push({
        name: c.name,
        normalizedName,
        kind: c.kind,
        importance: c.importance,
        definition: c.definition ?? null,
        origin: verified && definitionGrounded ? "DOCUMENT" : "AI_INFERRED",
        ref: verified ? { page: pageOfQuote(verified, s.pages), quote: verified } : null,
      });
    }
    const names = new Set(concepts.map((c) => c.normalizedName));
    const relations: ExtractedRelation[] = [];
    for (const r of out?.relations ?? []) {
      const from = foldText(r.from);
      const to = foldText(r.to);
      if (from === to || !names.has(from) || !names.has(to)) continue; // jamais de relation vers une notion inconnue
      relations.push({ from, to, type: r.type, origin: r.quote && quoteInText(r.quote, s.text) ? "DOCUMENT" : "AI_INFERRED" });
    }
    results.push({ key: s.key, concepts, relations });
  }
  return { results, model };
}

// ── Repli IA pour les documents sans numérotation exploitable ────────────────

const structureResponse = z.object({
  sections: z
    .array(z.object({ numbering: z.string().trim().max(20).nullable().optional(), label: z.string().trim().min(2).max(160), level: z.number().int().min(0).max(5), page: z.number().int().min(1).nullable().optional() }))
    .min(1)
    .max(80),
});

export interface InferredSection {
  numbering: string | null;
  label: string;
  level: number;
  page: number | null;
}

const STRUCTURE_SYSTEM = `Tu repères le plan d'un cours dont la numérotation n'est pas détectable automatiquement.
${UNTRUSTED_RULES}
Les pages sont repérées par des marqueurs [[PAGE n]]. Renvoie les titres et sous-titres dans l'ordre du document :
{"sections":[{"numbering":<numérotation écrite ou null>,"label":"<titre>","level":<0 pour un grand titre, 1 pour un sous-titre, …>,"page":<numéro de page>}]}
Ne crée pas de titre qui n'existe pas dans le document.`;

/** DocumentStructureService (repli) : plan proposé par l'IA — toujours marqué « déduit ». */
export async function inferStructure(userId: string, pages: PageText[]): Promise<{ sections: InferredSection[]; model: string }> {
  const text = pages.map((p) => `[[PAGE ${p.page ?? 1}]]\n${p.text}`).join("\n\n").slice(0, 30_000);
  const { data, model } = await generateStructured({
    userId,
    op: "analysis.structure",
    promptVersion: PROMPT_VERSION,
    system: STRUCTURE_SYSTEM,
    user: `Document :\n${wrapUntrusted("cours", text)}`,
    schema: structureResponse,
    maxTokens: 4000,
  });
  // Cohérence : un niveau ne peut pas dépasser celui du précédent + 1 ; chaque titre doit exister dans le texte
  const out: InferredSection[] = [];
  let prev = -1;
  for (const s of data.sections) {
    if (!quoteInText(s.label, text, 4)) continue;
    const level = Math.min(s.level, prev + 1);
    out.push({ numbering: s.numbering ?? null, label: s.label, level, page: s.page ?? null });
    prev = level;
  }
  return { sections: out, model };
}
