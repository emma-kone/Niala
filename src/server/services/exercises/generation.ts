import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiHttpError } from "@/lib/api-helpers";
import { AiCallError, AiQuotaError, AiUnavailableError, isAiConfigured } from "@/server/ai/provider";
import { generateStructured } from "@/server/ai/structured";
import { UNTRUSTED_RULES, foldText, quoteInText, wrapUntrusted } from "@/server/ai/guard";
import type { PageText } from "@/server/domain/chunking";
import {
  DIFFICULTY_WEIGHT,
  TYPE_LABEL,
  allocatePoints,
  buildQuestion,
  buildSlots,
  exerciseConfigSchema,
  rawQuestionSchema,
  semanticProblem,
  type BuiltQuestion,
  type ExerciseConfig,
  type RawQuestion,
  type Slot,
} from "@/server/domain/exercise-model";
import { languageOf, type CodeTest, type SqlSpec } from "@/server/domain/lab-tests";
import { loadVersionPages, pagesBetween } from "@/server/services/analysis/analysis-service";
import { verifyCodeReference, verifySqlSpec } from "@/server/services/labs/execute";

// ─────────────────────────────────────────────────────────────────────────────
// ExerciseGenerationService. Source de connaissances UNIQUE : le document choisi (jamais les autres
// documents de la matière). L'IA propose ; le serveur décide : nombre de questions, types, barème,
// bonnes réponses cohérentes, et chaque question doit citer un passage RÉEL du document.
// Pas assez de matière → moins de questions (jamais d'invention pour atteindre le nombre demandé).
// ─────────────────────────────────────────────────────────────────────────────

export const GENERATION_PROMPT_VERSION = "exercise-v1";
const WINDOW_CHARS = 12_000;
const MAX_SLOTS_PER_CALL = 8;

interface Window {
  label: string;
  pages: PageText[];
  text: string;
  source: SourceCtx;
}
interface Target {
  window: Window;
  focus?: string;
}

const windowOf = (label: string, pages: PageText[], source: SourceCtx): Window => ({ label, pages, text: pages.map((p) => p.text).join("\n").slice(0, WINDOW_CHARS), source });

function windowsForAll(pages: PageText[], source: SourceCtx): Window[] {
  const out: Window[] = [];
  let cur: PageText[] = [];
  let size = 0;
  for (const p of pages) {
    if (cur.length && size + p.text.length > WINDOW_CHARS) {
      out.push(windowOf(`Pages ${cur[0].page ?? 1}–${cur.at(-1)!.page ?? 1}`, cur, source));
      cur = [];
      size = 0;
    }
    cur.push(p);
    size += p.text.length;
  }
  if (cur.length) out.push(windowOf(`Pages ${cur[0].page ?? 1}–${cur.at(-1)!.page ?? 1}`, cur, source));
  return out.filter((w) => w.text.replace(/\s/g, "").length >= 120);
}

// ── Instructions de format par type ──────────────────────────────────────────

const FORMAT: Record<string, string> = {
  qcm_single: `{"type":"qcm_single","options":["…","…","…","…"],"correctIndex":0}  (3 à 5 propositions plausibles, UNE seule correcte)`,
  qcm_multiple: `{"type":"qcm_multiple","options":["…","…","…","…"],"correctIndexes":[0,2]}  (4 à 6 propositions, au moins une fausse)`,
  true_false: `{"type":"true_false","answer":true}  (énoncé = une affirmation)`,
  fill_choices: `{"type":"fill_choices","statement":"… ___ …","blanks":[{"options":["…","…","…"],"correctIndex":1}]}  (un "___" par trou, autant d'éléments dans blanks)`,
  fill_blank: `{"type":"fill_blank","statement":"… ___ …","blanks":[{"accepted":["réponse","variante"]}]}  (un "___" par trou)`,
  short_answer: `{"type":"short_answer","accepted":["réponse","variante acceptée"]}`,
  definition: `{"type":"definition","reference":"définition de référence","keyPoints":["point clé 1","point clé 2"]}  (statement = « Définissez … »)`,
  open: `{"type":"open","reference":"réponse modèle","criteria":["critère 1","critère 2"]}`,
  matching: `{"type":"matching","pairs":[{"left":"…","right":"…"},{"left":"…","right":"…"},{"left":"…","right":"…"}]}`,
  practical: `{"type":"practical","reference":"résolution modèle","criteria":["critère 1","critère 2"]}`,
  code: `{"type":"code","language":"python","starterCode":"…","referenceSolution":"…","criteria":["critère 1","critère 2"],"tests":[{"name":"cas simple","call":{"fn":"nom_de_la_fonction","args":[3,4]},"expected":7},{"name":"cas limite : liste vide","call":{"fn":"nom_de_la_fonction","args":[[]]},"expected":0,"edge":true}]}  (langage : python, javascript ou typescript ; la solution DÉFINIT la fonction appelée par les tests ; 3 à 6 tests dont au moins un cas limite ; "expected" = valeur JSON retournée. Alternative sans fonction : {"name":"…","stdin":"entrée","expected":"sortie exacte du programme
"}. Chaque "expected" doit être EXACTEMENT ce que produit la solution de référence.)`,
  sql: `{"type":"sql","setupSql":"CREATE TABLE … ; INSERT … (au moins 5 lignes réalistes)","referenceSql":"SELECT …","criteria":["critère 1","critère 2"],"ordered":false,"checks":[],"variants":[{"name":"table vide ou valeurs NULL","extraSql":"DELETE FROM … ;"}]}  (SQLite ; "ordered":true seulement si l'énoncé impose un ORDER BY ; "checks" = requêtes SELECT de contrôle de l'état final, seulement pour INSERT/UPDATE/DELETE/DDL ; "variants" = 1 à 2 jeux de données limites ajoutés après setupSql)`,
};

const DIFFICULTY_HINT = {
  facile: "rappel direct d'une définition ou d'un fait écrit dans l'extrait",
  moyenne: "compréhension et application simple de ce que dit l'extrait",
  difficile: "analyse, comparaison, cas limite ou combinaison de plusieurs idées de l'extrait",
};

const SYSTEM = `Tu es un enseignant qui crée des exercices à partir d'UN extrait de cours.
${UNTRUSTED_RULES}

Règles de génération :
1. Chaque question est STRICTEMENT fondée sur l'extrait fourni : aucune connaissance extérieure, aucune notion absente de l'extrait.
2. Chaque question contient "source": {"quote": "<extrait recopié VERBATIM de l'extrait, 15 à 300 caractères, qui permet de répondre>"}.
3. Un seul créneau = une seule question, du type et de la difficulté demandés. Réponds en français.
4. Énoncés non ambigus, une seule interprétation ; mauvaises réponses plausibles mais clairement fausses.
5. Si l'extrait ne permet pas de poser une question fiable pour un créneau, n'invente rien : ajoute son numéro dans "insufficient".
6. "concepts" : 1 à 3 noms de notions du cours que la question évalue (utilise de préférence les notions listées).
7. "explanation" : explique POURQUOI la bonne réponse est correcte, en t'appuyant sur l'extrait.
Réponse : {"questions":[{"slot":<n>,"type":"...","statement":"...","source":{"quote":"..."},"concepts":["..."],"explanation":"...", ...champs du type}],"insufficient":[<slots>]}`;

const responseSchema = z.object({ questions: z.array(z.unknown()).max(40), insufficient: z.array(z.number().int()).max(40).catch([]) });

interface Accepted {
  slot: Slot;
  built: BuiltQuestion;
  explanation: string | null;
  refs: { quote: string; page: number | null; documentId: string; documentName: string; versionId: string }[];
  concepts: string[];
}

function pageOfQuote(quote: string, pages: PageText[]): number | null {
  for (const p of pages) if (quoteInText(quote, p.text)) return p.page;
  return null;
}

export class GenerationFailure extends Error {}

export const ADAPTATION_PROMPT: Record<string, string> = {
  edge_cases: "ADAPTATION : l'étudiant réussit la syntaxe mais se trompe sur la logique. Privilégie des questions de RAISONNEMENT qui testent les cas limites (vide, zéro, valeurs absentes, bornes) plutôt que la mémorisation.",
  compare: "ADAPTATION : l'étudiant confond des notions voisines. Privilégie des questions qui font DISTINGUER et COMPARER deux notions de l'extrait (différences, cas où l'une s'applique et pas l'autre).",
  harder: "ADAPTATION : l'étudiant maîtrise cette notion. Augmente la difficulté : situations nouvelles, combinaison de plusieurs notions de l'extrait.",
  prerequisite: "ADAPTATION : l'étudiant est fragile sur cette base. Reste sur des questions de BASE (définition, exemple simple, application directe) pour consolider avant de continuer.",
};

async function askWindow(userId: string, w: Window, slots: (Slot & { focus?: string })[], knownConcepts: string[], extra = "") {
  const spec = [...new Set(slots.map((s) => s.type))].map((t) => `- ${t} (${TYPE_LABEL[t]}) : ${FORMAT[t]}`).join("\n");
  const wanted = slots.map((s) => ({ slot: s.slot, type: s.type, difficulty: s.difficulty, niveau: DIFFICULTY_HINT[s.difficulty], ...(s.focus ? { notion_visee: s.focus } : {}) }));
  const user = `Créneaux à remplir :\n${JSON.stringify(wanted)}\n\nFormat des champs spécifiques :\n${spec}\n\n${
    knownConcepts.length ? `Notions connues du cours : ${knownConcepts.slice(0, 40).join(" ; ")}\n\n` : ""
  }${extra ? `${extra}\n\n` : ""}Extrait du cours (${w.label}) :\n${wrapUntrusted("cours", w.text)}`;
  return generateStructured({ userId, op: "exercise.generate", promptVersion: GENERATION_PROMPT_VERSION, system: SYSTEM, user, schema: responseSchema, maxTokens: 7000, temperature: 0.3 });
}

interface SourceCtx {
  index: number;
  documentId: string;
  name: string;
  subjectId: string;
  versionId: string;
  versionNumber: number;
  pages: PageText[];
  coverage: Record<string, unknown>;
}

interface Collected {
  ctx: SourceCtx;
  targets: Target[];
  knownConcepts: string[];
}

/** Fenêtres de texte d'UN document selon la couverture demandée (tout, sections, notions, notions difficiles). */
async function collectSource(userId: string, index: number, documentId: string, coverage: ExerciseConfig["coverage"], multi: boolean): Promise<Collected> {
  const doc = await db.document.findFirst({ where: { id: documentId, userId }, include: { currentVersion: true } });
  if (!doc) throw new ApiHttpError("Document introuvable.", 404);
  const tag = multi ? ` « ${doc.name} »` : "";
  if (!doc.subjectId) throw new ApiHttpError(`Le document${tag || " "} n'est rattaché à aucune matière.`, 409);
  const version = doc.currentVersion;
  if (!version || !["READY", "PARTIAL"].includes(version.extractStatus)) throw new ApiHttpError(`Le texte du document${tag} n'a pas pu être extrait : impossible de créer un exercice.`, 409);
  const pages = await loadVersionPages(userId, version.id);
  if (pages.every((p) => p.text.replace(/\s/g, "").length < 120)) throw new ApiHttpError(`Le document${tag} contient trop peu de texte pour créer un exercice.`, 409);

  const ctx: SourceCtx = { index, documentId: doc.id, name: doc.name, subjectId: doc.subjectId, versionId: version.id, versionNumber: version.number, pages, coverage: coverage as Record<string, unknown> };
  const analysis = await db.documentAnalysis.findFirst({ where: { userId, versionId: version.id, status: "READY" }, orderBy: { createdAt: "desc" } });
  const knownConcepts = analysis ? (await db.conceptSource.findMany({ where: { analysisId: analysis.id, userId }, include: { concept: true }, take: 200 })).map((s) => s.concept.name) : [];

  let targets: Target[] = [];
  if (coverage.mode === "all") {
    targets = windowsForAll(pages, ctx).map((window) => ({ window }));
  } else {
    if (!analysis) throw new ApiHttpError(`Analysez d'abord le document${tag || " "}(onglet Analyse du lecteur) pour choisir des sections ou des notions.`, 409);
    const sections = await db.courseSection.findMany({ where: { analysisId: analysis.id, userId } });
    const sectionWindow = (s: (typeof sections)[number]) => windowOf(`${s.numbering ? s.numbering + " " : ""}${s.label}`, pagesBetween(pages, s.pageStart, s.pageEnd), ctx);
    if (coverage.mode === "sections") {
      const picked = sections.filter((s) => coverage.sectionIds!.includes(s.id));
      if (picked.length !== new Set(coverage.sectionIds).size) throw new ApiHttpError(`Section introuvable dans l'analyse du document${tag || " "}.`, 404);
      targets = picked.map((s) => ({ window: sectionWindow(s) }));
    } else {
      let conceptIds = coverage.conceptIds ?? [];
      if (coverage.mode === "hard") {
        const sources = await db.conceptSource.findMany({ where: { analysisId: analysis.id, userId }, include: { concept: { include: { mastery: true } } } });
        const weak = sources.filter((s) => s.concept.mastery && s.concept.mastery.confidence >= 0.35 && s.concept.mastery.level < 0.5);
        const pool = weak.length ? weak : sources.filter((s) => s.concept.importance === 3);
        conceptIds = [...new Set(pool.map((s) => s.conceptId))];
        if (conceptIds.length === 0) throw new ApiHttpError(`Aucune notion difficile ou principale n'a été identifiée pour le document${tag || " "}.`, 409);
      }
      const sources = await db.conceptSource.findMany({ where: { analysisId: analysis.id, userId, conceptId: { in: conceptIds } }, include: { concept: true } });
      if (new Set(sources.map((s) => s.conceptId)).size !== new Set(conceptIds).size && coverage.mode === "concepts") throw new ApiHttpError(`Notion introuvable dans l'analyse du document${tag || " "}.`, 404);
      const seen = new Set<string>();
      for (const s of sources) {
        const sec = sections.find((x) => x.id === s.sectionId);
        if (!sec || seen.has(s.conceptId)) continue;
        seen.add(s.conceptId);
        targets.push({ window: sectionWindow(sec), focus: s.concept.name });
      }
    }
  }
  targets = targets.filter((t) => t.window.text.replace(/\s/g, "").length >= 120);
  if (targets.length === 0) throw new ApiHttpError(`La partie choisie du document${tag || " "}ne contient pas assez de texte.`, 409);
  return { ctx, targets, knownConcepts };
}

const CROSS_RULES = `
QUESTIONS TRANSVERSALES : tu reçois DEUX extraits, A et B, de cours différents. Chaque question doit nécessiter les DEUX extraits (comparer, relier, distinguer, ou appliquer une idée de l'un à l'autre).
- Chaque question DOIT contenir DEUX champs de citation : "source":{"quote":"<citation VERBATIM de l'extrait A>"} ET "source2":{"quote":"<citation VERBATIM de l'extrait B>"} (15 à 300 caractères chacune). Une question sans "source2" sera rejetée.
- Format de réponse pour ces questions : {"slot":<n>,"type":"...","statement":"...","source":{"quote":"..."},"source2":{"quote":"..."},"concepts":["..."],"explanation":"...", ...champs du type}.
- Si les deux extraits n'ont aucun lien exploitable, n'invente rien : ajoute le créneau dans "insufficient".`;

async function askCross(userId: string, a: Window, b: Window, slots: Slot[], extra = "") {
  const spec = [...new Set(slots.map((s) => s.type))].map((t) => `- ${t} (${TYPE_LABEL[t]}) : ${FORMAT[t]}`).join("\n");
  const wanted = slots.map((s) => ({ slot: s.slot, type: s.type, difficulty: s.difficulty, niveau: DIFFICULTY_HINT[s.difficulty] }));
  const half = (w: Window) => w.text.slice(0, WINDOW_CHARS / 2);
  const user = `Créneaux à remplir (questions transversales) :\n${JSON.stringify(wanted)}\n\nFormat des champs spécifiques :\n${spec}\n\n${extra ? `${extra}\n\n` : ""}Extrait A (cours « ${a.source.name} », ${a.label}) :\n${wrapUntrusted(`cours A ${a.source.name}`, half(a))}\n\nExtrait B (cours « ${b.source.name} », ${b.label}) :\n${wrapUntrusted(`cours B ${b.source.name}`, half(b))}`;
  return generateStructured({ userId, op: "exercise.generate.cross", promptVersion: GENERATION_PROMPT_VERSION, system: SYSTEM + CROSS_RULES, user, schema: responseSchema, maxTokens: 7000, temperature: 0.3 });
}

/** Alterne les sources : chaque cours contribue à l'exercice avant qu'un même cours ne revienne. */
function interleave<T>(lists: T[][]): T[] {
  const out: T[] = [];
  for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (i < l.length) out.push(l[i]);
  return out;
}

export async function generateExercise(userId: string, rawConfig: unknown) {
  const parsed = exerciseConfigSchema.safeParse(rawConfig);
  if (!parsed.success) throw new ApiHttpError(parsed.error.issues[0]?.message ?? "Configuration invalide.", 422);
  const config: ExerciseConfig = parsed.data;

  if (!isAiConfigured()) {
    throw new ApiHttpError("La génération d'exercices nécessite le service d'IA, qui n'est pas configuré (GEMINI_API_KEY).", 503);
  }

  // ── Sources : le document principal puis les sources ajoutées (jamais un document non choisi) ──
  const extras = config.extraSources ?? [];
  const multi = extras.length > 0;
  const collected: Collected[] = [await collectSource(userId, 0, config.documentId, config.coverage, multi)];
  for (const [i, e] of extras.entries()) collected.push(await collectSource(userId, i + 1, e.documentId, e.coverage, true));
  const primary = collected[0].ctx;
  const subjectId = primary.subjectId;
  const knownConcepts = [...new Set(collected.flatMap((c) => c.knownConcepts))];
  const targets: Target[] = interleave(collected.map((c) => c.targets));

  // ── Créneaux : ordinaires (une fenêtre) et transversaux (deux cours à la fois) ──
  const slots = buildSlots(config.questionCount, config.types, config.difficulty);
  const useCross = collected.length >= 2 && config.transversal !== false && config.questionCount >= 3;
  const crossCount = useCross ? Math.max(1, Math.floor(config.questionCount / 4)) : 0;
  const crossAt = new Set(Array.from({ length: crossCount }, (_, k) => Math.min(config.questionCount - 1, 2 + k * 4)));
  const byWindow = new Map<Window, (Slot & { focus?: string })[]>();
  const crossGroups = new Map<string, { a: Window; b: Window; slots: Slot[] }>();
  const pairs: [number, number][] = [];
  for (let i = 0; i < collected.length; i++) for (let j = i + 1; j < collected.length; j++) pairs.push([i, j]);
  let ordinary = 0;
  let crossIndex = 0;
  slots.forEach((s, i) => {
    if (crossAt.has(i) && pairs.length) {
      const [a, b] = pairs[crossIndex++ % pairs.length];
      const key = `${a}-${b}`;
      const g = crossGroups.get(key) ?? { a: collected[a].targets[0].window, b: collected[b].targets[0].window, slots: [] };
      g.slots.push(s);
      crossGroups.set(key, g);
      return;
    }
    const t = targets[ordinary++ % targets.length];
    byWindow.set(t.window, [...(byWindow.get(t.window) ?? []), { ...s, focus: t.focus }]);
  });

  // ── Appels IA + validation serveur ──
  const accepted: Accepted[] = [];
  const dropped = { invalid: 0, ungrounded: 0, duplicate: 0 };
  const insufficient = new Set<number>();
  let calls = 0;
  let failures = 0;
  let fatal: Error | null = null;
  const seenStatements = new Set<string>();
  // Adaptation : orientation demandée + énoncés DÉJÀ travaillés sur ces documents (pour ne pas faire répéter les mêmes questions)
  let extra = "";
  if (config.adaptation) {
    const ids = collected.map((c) => c.ctx.documentId);
    const prior = await db.question.findMany({ where: { userId, exercise: { OR: [{ documentId: { in: ids } }, { sources: { some: { documentId: { in: ids } } } }] } }, orderBy: { id: "desc" }, take: 15, select: { payload: true } });
    const statements = prior.map((q) => String((q.payload as { statement?: string }).statement ?? "")).filter(Boolean);
    extra = `${ADAPTATION_PROMPT[config.adaptation]}${statements.length ? `\nNe repose PAS ces questions déjà travaillées (reformule ou change de situation) :\n${statements.map((t) => `- ${t.slice(0, 160)}`).join("\n")}` : ""}`;
  }

  const refOf = (w: Window, quote: string, page: number | null) => ({ quote, page, documentId: w.source.documentId, documentName: w.source.name, versionId: w.source.versionId });
  const accept = (q: RawQuestion, slot: Slot, refs: Accepted["refs"]) => {
    const key = foldText(q.statement).slice(0, 80);
    if (seenStatements.has(key) || accepted.some((a) => a.slot.slot === q.slot)) {
      dropped.duplicate++;
      return;
    }
    seenStatements.add(key);
    accepted.push({ slot, built: buildQuestion(q), explanation: q.explanation ?? null, refs, concepts: q.concepts });
  };

  outer: for (const [w, list] of byWindow) {
    for (let i = 0; i < list.length; i += MAX_SLOTS_PER_CALL) {
      const group = list.slice(i, i + MAX_SLOTS_PER_CALL);
      calls++;
      let result: z.infer<typeof responseSchema>;
      try {
        result = (await askWindow(userId, w, group, knownConcepts, extra)).data;
      } catch (e) {
        failures++;
        if (e instanceof AiQuotaError || e instanceof AiUnavailableError) {
          fatal = e;
          break outer;
        }
        if (!(e instanceof AiCallError)) console.error("[exercise]", e);
        continue;
      }
      result.insufficient.forEach((s) => insufficient.add(s));
      for (const rawQ of result.questions) {
        const p = rawQuestionSchema.safeParse(rawQ);
        const slot = p.success ? group.find((g) => g.slot === p.data.slot) : undefined;
        if (!p.success || !slot || p.data.type !== slot.type || semanticProblem(p.data)) {
          dropped.invalid++;
          continue;
        }
        const q: RawQuestion = p.data;
        const page = pageOfQuote(q.source.quote, w.pages);
        if (page === null && !quoteInText(q.source.quote, w.text)) {
          dropped.ungrounded++; // la citation n'existe pas dans le document : question rejetée
          continue;
        }
        accept(q, slot, [refOf(w, q.source.quote, page)]);
      }
    }
  }

  // Questions transversales : les DEUX citations doivent exister, chacune dans son document
  if (!fatal) {
    for (const g of crossGroups.values()) {
      for (let i = 0; i < g.slots.length; i += MAX_SLOTS_PER_CALL) {
        const group = g.slots.slice(i, i + MAX_SLOTS_PER_CALL);
        calls++;
        let result: z.infer<typeof responseSchema>;
        try {
          result = (await askCross(userId, g.a, g.b, group, extra)).data;
        } catch (e) {
          failures++;
          if (e instanceof AiQuotaError || e instanceof AiUnavailableError) {
            fatal = e;
            break;
          }
          if (!(e instanceof AiCallError)) console.error("[exercise]", e);
          continue;
        }
        result.insufficient.forEach((s) => insufficient.add(s));
        for (const rawQ of result.questions) {
          const p = rawQuestionSchema.safeParse(rawQ);
          const slot = p.success ? group.find((s) => s.slot === p.data.slot) : undefined;
          if (!p.success || !slot || p.data.type !== slot.type || semanticProblem(p.data) || !p.data.source2) {
            dropped.invalid++;
            console.warn("[exercise] question transversale écartée :", !p.success ? p.error.issues.slice(0, 2).map((i) => `${i.path.join(".")} ${i.message}`).join(" ; ") : !slot ? "créneau inconnu" : p.data.type !== slot.type ? "type différent du créneau" : !p.data.source2 ? "seconde citation absente" : "incohérence interne");
            continue;
          }
          const q: RawQuestion = p.data;
          const q2 = q.source2!.quote;
          const inA = (t: string) => quoteInText(t, g.a.text);
          const inB = (t: string) => quoteInText(t, g.b.text);
          const [wa, wb] = inA(q.source.quote) && inB(q2) ? [g.a, g.b] : inB(q.source.quote) && inA(q2) ? [g.b, g.a] : [null, null];
          if (!wa || !wb) {
            dropped.ungrounded++; // une des deux citations n'existe pas dans « son » document
            console.warn("[exercise] question transversale écartée : citation introuvable dans son document");
            continue;
          }
          accept(q, slot, [refOf(wa, q.source.quote, pageOfQuote(q.source.quote, wa.pages)), refOf(wb, q2, pageOfQuote(q2, wb.pages))]);
        }
      }
      if (fatal) break;
    }
  }
  if (fatal && accepted.length === 0) {
    throw new ApiHttpError(fatal instanceof AiQuotaError ? fatal.message : "Le service d'IA n'est pas configuré.", fatal instanceof AiQuotaError ? 429 : 503);
  }
  if (accepted.length === 0) {
    console.warn("[exercise] aucune question retenue", { dropped, insufficient: [...insufficient], calls, failures });
    if (failures === calls) throw new ApiHttpError("Le service d'IA est momentanément indisponible. Réessayez dans un instant.", 502);
    throw new ApiHttpError(multi ? "Les documents choisis ne fournissent pas assez d'informations fiables pour créer des questions de ce type. Essayez d'autres types ou d'autres parties." : "Le document ne fournit pas assez d'informations fiables pour créer des questions de ce type. Essayez d'autres types ou une autre partie du document.", 422);
  }

  accepted.sort((a, b) => a.slot.slot - b.slot.slot);

  // Code / SQL : les tests proposés par l'IA ne sont que des CANDIDATS. Ils ne sont retenus que si la solution de
  // référence les réussit à l'exécution (isolée). Sinon la question reste valable, corrigée par lecture, et c'est signalé.
  let unverified = 0;
  for (const a of accepted) {
    const key = a.built.answerKey as Record<string, unknown>;
    if (a.built.type === "code") {
      const lang = languageOf(String(a.built.payload.language ?? ""));
      const v = lang && lang !== "sql" ? await verifyCodeReference(lang, String(key.reference), key.tests as CodeTest[]).catch(() => null) : null;
      if (v && v.tests.length >= 2) {
        key.tests = v.tests;
        key.verified = true;
      } else {
        key.tests = [];
        key.verified = false;
        unverified++;
      }
    } else if (a.built.type === "sql") {
      const v = await verifySqlSpec(key.sql as SqlSpec).catch(() => null);
      if (v?.baseOk) {
        key.sql = v.spec;
        key.verified = true;
      } else {
        key.verified = false;
        unverified++;
      }
    }
  }
  const points = allocatePoints(config.totalPoints, accepted.map((a) => DIFFICULTY_WEIGHT[a.slot.difficulty]));

  const notes: string[] = [];
  if (accepted.length < config.questionCount) {
    notes.push(`${accepted.length} question(s) sur ${config.questionCount} demandée(s) : ${multi ? "les sources choisies ne fournissent" : "le document ne fournit"} pas assez d'éléments fiables pour les autres (aucune question n'a été inventée). Le barème de ${config.totalPoints} points est réparti sur les questions créées.`);
  }
  if (multi) {
    const contributed = new Set(accepted.flatMap((a) => a.refs.map((r) => r.documentId)));
    const silent = collected.filter((c) => !contributed.has(c.ctx.documentId)).map((c) => `« ${c.ctx.name} »`);
    if (silent.length) notes.push(`Aucune question n'a pu être créée à partir de ${silent.join(", ")}.`);
    if (useCross && !accepted.some((a) => a.refs.length > 1)) notes.push("Aucune question transversale fiable n'a pu être créée : les sources choisies n'ont pas de lien exploitable.");
  }
  if (unverified) notes.push(`${unverified} question(s) de programmation ou SQL n'ont pas pu être validées par exécution (solution de référence non vérifiable) : elles seront corrigées par lecture, sans tests.`);
  if (fatal) notes.push(fatal.message);
  else if (failures) notes.push(`${failures} appel(s) au service d'IA ont échoué.`);
  const totalDropped = dropped.invalid + dropped.ungrounded + dropped.duplicate;
  if (totalDropped) notes.push(`${totalDropped} question(s) proposée(s) ont été écartées (format invalide, citation introuvable dans le document ou doublon).`);

  // ── Enregistrement : exercice indépendant, avec ses sources et la version exacte de chacune ──
  const exerciseId = await db.$transaction(async (tx) => {
    const conceptIdOf = async (name: string) => {
      const normalizedName = foldText(name);
      if (!normalizedName) return null;
      const existing = await tx.concept.findFirst({ where: { subjectId, normalizedName }, orderBy: { importance: "desc" } });
      if (existing) return existing.id;
      return (await tx.concept.create({ data: { userId, subjectId, name: name.slice(0, 120), normalizedName, kind: "NOTION" } })).id;
    };
    const ex = await tx.exercise.create({
      data: {
        userId,
        subjectId,
        documentId: primary.documentId,
        versionId: primary.versionId,
        title: config.title?.trim() || (multi ? `Exercice — ${primary.name} et ${extras.length} autre(s) source(s)` : `Exercice — ${primary.name}`).slice(0, 160),
        totalPoints: config.totalPoints,
        config: { ...config, generated: accepted.length, notice: notes.join(" ") || null, promptVersion: GENERATION_PROMPT_VERSION, windows: targets.length } as unknown as Prisma.InputJsonValue,
      },
    });
    await tx.exerciseSource.createMany({
      data: collected.map((c, i) => ({
        userId,
        exerciseId: ex.id,
        position: i + 1,
        documentId: c.ctx.documentId,
        versionId: c.ctx.versionId,
        documentName: c.ctx.name,
        versionNumber: c.ctx.versionNumber,
        coverage: { ...c.ctx.coverage, labels: c.targets.map((t) => t.window.label).slice(0, 20) } as unknown as Prisma.InputJsonValue,
      })),
    });
    for (let i = 0; i < accepted.length; i++) {
      const a = accepted[i];
      const q = await tx.question.create({
        data: {
          userId,
          exerciseId: ex.id,
          position: i + 1,
          type: a.built.type,
          points: points[i],
          difficulty: a.slot.difficulty,
          payload: a.built.payload as Prisma.InputJsonValue,
          answerKey: a.built.answerKey as Prisma.InputJsonValue,
          explanation: a.explanation,
          sourceRefs: a.refs as unknown as Prisma.InputJsonValue,
        },
      });
      const ids = new Set<string>();
      for (const name of a.concepts.slice(0, 3)) {
        const cid = await conceptIdOf(name);
        if (cid) ids.add(cid);
      }
      if (ids.size) await tx.questionConcept.createMany({ data: [...ids].map((conceptId) => ({ questionId: q.id, conceptId })) });
    }
    return ex.id;
  }, { timeout: 30_000 });

  return { id: exerciseId, created: accepted.length, requested: config.questionCount, notice: notes.join(" ") || null, sources: collected.length };
}
