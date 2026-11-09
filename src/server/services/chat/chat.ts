import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiHttpError } from "@/lib/api-helpers";
import { AiCallError, getProvider, type ChatPart, type ChatTurn, type ToolDeclaration } from "@/server/ai/provider";
import { checkQuota } from "@/server/ai/structured";
import { UNTRUSTED_RULES, wrapUntrusted } from "@/server/ai/guard";
import { resolveCitations, type Citation, type Coverage } from "@/server/domain/retrieval";
import { embedPending } from "./indexing";
import { hostOf } from "@/server/domain/web-trust";
import { RELIABILITY_RULES, applyVerification, failedVerification, needsVerification, pendingVerification, verifyAnswer, type VerificationReport, type WebStatus } from "@/server/reliability/claims";
import { registrableDomain } from "@/server/reliability/cross-check";
import { LEVEL_LABEL, assessSource, inferPublication, searchGuidance, type SourceKind } from "@/server/reliability/sources";
import { saveVerification, type SavedSource } from "@/server/reliability/store";
import { WebSearchUnavailableError, searchWeb, webStatus, type WebResult } from "@/server/ai/web-search";
import { documentCoverage, outline, readPart, resolveDocs, searchPassages, type DocInfo, type Hit, type Scope } from "./retrieval";

// ─────────────────────────────────────────────────────────────────────────────
// Chat pédagogique. Deux portées STRICTEMENT séparées :
//  - DOCUMENT : la conversation ne voit que ce cours (version courante) ;
//  - GLOBAL   : toute la bibliothèque de l'utilisateur, ou une matière.
// L'IA explore les documents par OUTILS (recherche, lecture de pages, plan) au lieu de recevoir un
// résumé ; chaque passage consulté reçoit un numéro, et seules les références [n] qui correspondent à un
// passage réellement consulté sont conservées. La couverture (pages sans texte, vecteurs manquants) est
// calculée côté serveur et fournie au modèle ET à l'utilisateur.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_STEPS = 5;
const HISTORY_MESSAGES = 14;
const MAX_MESSAGE_CHARS = 6000;
const DEFAULT_TITLE = "Nouvelle conversation";
/** Au-delà, la vérification n'est plus lancée : la requête doit se terminer avant la limite de la route (120 s). */
const VERIFICATION_DEADLINE_MS = 65_000;
const STALE_VERIFICATION_MS = 150_000;

export const createSchema = z.object({
  scope: z.enum(["GLOBAL", "DOCUMENT"]),
  documentId: z.string().min(1).optional(),
  subjectId: z.string().min(1).optional(),
});
export const messageSchema = z
  .object({
    content: z.string().trim().max(MAX_MESSAGE_CHARS, "Message trop long.").default(""),
    web: z.boolean().optional(),
    /** Documents choisis comme contexte pour ce message. */
    documentIds: z.array(z.string().min(1)).max(12).optional(),
    /** Relance la dernière question au lieu d'en poser une nouvelle. */
    regenerate: z.boolean().optional(),
  })
  .refine((m) => m.regenerate || m.content.length > 0, { message: "Message vide.", path: ["content"] });

// ── Conversations ────────────────────────────────────────────────────────────

export async function createConversation(userId: string, input: z.infer<typeof createSchema>) {
  if (input.scope === "DOCUMENT") {
    if (!input.documentId) throw new ApiHttpError("Un document est requis pour cette conversation.", 422);
    const doc = await db.document.findFirst({ where: { id: input.documentId, userId }, select: { id: true, name: true } });
    if (!doc) throw new ApiHttpError("Document introuvable.", 404);
    return db.conversation.create({ data: { userId, scope: "DOCUMENT", documentId: doc.id, title: DEFAULT_TITLE } });
  }
  if (input.subjectId) {
    const subject = await db.subject.findFirst({ where: { id: input.subjectId, userId }, select: { id: true } });
    if (!subject) throw new ApiHttpError("Matière introuvable.", 404);
  }
  return db.conversation.create({ data: { userId, scope: "GLOBAL", subjectId: input.subjectId ?? null, title: DEFAULT_TITLE } });
}

export async function listConversations(userId: string, scope: "GLOBAL" | "DOCUMENT", documentId?: string) {
  if (scope === "DOCUMENT" && !documentId) throw new ApiHttpError("Un document est requis.", 422);
  return db.conversation.findMany({
    where: { userId, scope, ...(scope === "DOCUMENT" ? { documentId } : {}) },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: { id: true, title: true, scope: true, documentId: true, subjectId: true, updatedAt: true, createdAt: true },
  });
}

/** Retire la dernière question et ce qui la suit, et renvoie son texte pour la reposer. */
export async function takeLastTurn(userId: string, conversationId: string): Promise<string> {
  await ownedConversation(userId, conversationId);
  await checkQuota(userId);
  const question = await db.conversationMessage.findFirst({ where: { conversationId, userId, role: "USER" }, orderBy: { createdAt: "desc" }, select: { content: true, createdAt: true } });
  if (!question) throw new ApiHttpError("Aucune question à relancer.", 422);
  const removed = await db.conversationMessage.findMany({ where: { conversationId, userId, createdAt: { gte: question.createdAt } }, select: { id: true } });
  const ids = removed.map((m) => m.id);
  await db.$transaction([
    db.verificationRun.deleteMany({ where: { userId, entityType: "ConversationMessage", entityId: { in: ids } } }),
    db.conversationMessage.deleteMany({ where: { id: { in: ids }, userId } }),
  ]);
  return question.content;
}

async function ownedConversation(userId: string, id: string) {
  const conv = await db.conversation.findFirst({ where: { id, userId } });
  if (!conv) throw new ApiHttpError("Conversation introuvable.", 404);
  return conv;
}

function asInterrupted(consulted: { verification?: VerificationReport }): Prisma.JsonObject {
  return { ...consulted, verification: failedVerification(consulted.verification!.webStatus) } as unknown as Prisma.JsonObject;
}

export async function getConversation(userId: string, id: string) {
  const conv = await ownedConversation(userId, id);
  const messages = await db.conversationMessage.findMany({
    where: { conversationId: id, userId },
    orderBy: { createdAt: "asc" },
    select: { id: true, role: true, content: true, citations: true, consulted: true, model: true, createdAt: true },
  });
  // Vérification interrompue (redémarrage du serveur, par exemple) : on ne la laisse pas « en cours » indéfiniment.
  const visible = messages.map((m) => {
    const consulted = m.consulted as { verification?: VerificationReport } | null;
    if (consulted?.verification?.status !== "en_cours" || Date.now() - m.createdAt.getTime() < STALE_VERIFICATION_MS) return m;
    return { ...m, consulted: asInterrupted(consulted) };
  });
  return { conversation: { id: conv.id, title: conv.title, scope: conv.scope, documentId: conv.documentId, subjectId: conv.subjectId, updatedAt: conv.updatedAt }, messages: visible };
}

export async function renameConversation(userId: string, id: string, title: string) {
  await ownedConversation(userId, id);
  const clean = title.replace(/\s+/g, " ").trim().slice(0, 100);
  if (!clean) throw new ApiHttpError("Titre vide.", 422);
  await db.conversation.update({ where: { id }, data: { title: clean } });
  return { ok: true, title: clean };
}

export async function deleteConversation(userId: string, id: string) {
  await ownedConversation(userId, id);
  // Les vérifications référencent les messages sans clé étrangère : elles doivent disparaître avec la conversation.
  const messages = await db.conversationMessage.findMany({ where: { conversationId: id, userId }, select: { id: true } });
  await db.$transaction([
    db.verificationRun.deleteMany({ where: { userId, entityType: "ConversationMessage", entityId: { in: messages.map((m) => m.id) } } }),
    db.conversation.delete({ where: { id } }),
  ]);
  return { ok: true };
}

// ── Outils d'exploration ─────────────────────────────────────────────────────

const TOOLS: Record<"GLOBAL" | "DOCUMENT", ToolDeclaration[]> = {
  DOCUMENT: [
    { name: "search_passages", description: "Cherche dans le cours les passages qui répondent à une requête (mots-clés et sens). À utiliser avant toute réponse portant sur le contenu du cours.", parameters: { type: "OBJECT", properties: { query: { type: "STRING", description: "Requête de recherche précise" } }, required: ["query"] } },
    { name: "read_pages", description: "Lit des pages du cours (ou des parties si le document n'a pas de pagination). Maximum 4 à la fois ; renvoie aussi le total.", parameters: { type: "OBJECT", properties: { from: { type: "INTEGER", description: "Première page ou partie" }, to: { type: "INTEGER", description: "Dernière (facultatif)" } }, required: ["from"] } },
    { name: "get_outline", description: "Donne le plan du cours (titres et pages) pour se repérer avant de lire.", parameters: { type: "OBJECT", properties: {} } },
  ],
  GLOBAL: [
    { name: "list_documents", description: "Liste les documents de l'étudiant (identifiant, nom, pages, état d'extraction).", parameters: { type: "OBJECT", properties: {} } },
    { name: "search_passages", description: "Cherche dans les documents de l'étudiant les passages qui répondent à une requête. Peut être restreint à un document.", parameters: { type: "OBJECT", properties: { query: { type: "STRING", description: "Requête de recherche précise" }, document_id: { type: "STRING", description: "Identifiant d'un document (facultatif)" } }, required: ["query"] } },
    { name: "read_pages", description: "Lit des pages (ou parties) d'un document. Maximum 4 à la fois.", parameters: { type: "OBJECT", properties: { document_id: { type: "STRING" }, from: { type: "INTEGER" }, to: { type: "INTEGER" } }, required: ["document_id", "from"] } },
    { name: "get_outline", description: "Plan d'un document (titres et pages).", parameters: { type: "OBJECT", properties: { document_id: { type: "STRING" } }, required: ["document_id"] } },
  ],
};

const WEB_TOOL: ToolDeclaration = {
  name: "search_web",
  description: "Cherche sur le web (documentation officielle, universités, références) pour compléter ou vérifier un cours, ou répondre à une question hors cours. Chaque source est classée « reconnue » ou « à vérifier ».",
  parameters: { type: "OBJECT", properties: { query: { type: "STRING", description: "Requête précise (mots-clés, de préférence en anglais pour la documentation technique)" } }, required: ["query"] },
};

/** Registre des passages consultés pendant un tour : numérote, dédoublonne, et sert à vérifier les citations. */
class Evidence {
  readonly known = new Map<number, Citation>();
  private keys = new Map<string, number>();
  readonly docs = new Map<string, string>();
  readonly pagesRead = new Set<string>();
  readonly toolCalls: string[] = [];
  /** Recherches web lancées pendant ce tour, avec le nombre de résultats (0 = rien trouvé, -1 = moteur en échec). */
  readonly webSearches: { query: string; found: number }[] = [];
  /** Texte intégral de chaque passage : c'est là que les preuves sont recherchées (la citation affichée est tronquée). */
  readonly text = new Map<number, string>();

  register(c: Omit<Citation, "n">, key: string, fullText: string): number {
    const existing = this.keys.get(key);
    if (existing) return existing;
    const n = this.known.size + 1;
    this.known.set(n, { n, ...c });
    this.keys.set(key, n);
    this.text.set(n, fullText);
    if (c.kind !== "web") this.docs.set(c.documentId, c.documentName);
    return n;
  }
}

function sourcesOf(ev: Evidence): SavedSource[] {
  return [...ev.known.values()].map((c) => {
    const common = { n: c.n, title: c.documentName, text: ev.text.get(c.n) ?? c.quote, retrievedAt: c.retrievedAt ?? new Date().toISOString() };
    if (c.kind !== "web") return { ...common, kind: "document" as const, documentId: c.documentId, page: c.page };
    return { ...common, kind: "web" as const, url: c.url, host: c.url ? (hostOf(c.url) ?? undefined) : undefined, level: c.level, sourceKind: c.sourceKind as SourceKind | undefined, organization: c.organization, publishedAt: c.publishedAt, year: c.publishedAt ? Number(/(?:19|20)\d{2}/.exec(c.publishedAt)?.[0]) || null : null };
  });
}

const quoteOf = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 240);

/** Enregistre une page web avec son évaluation : niveau, nature, organisme, date lisible et date de consultation. */
function registerWeb(ev: Evidence, r: WebResult) {
  const assessment = assessSource({ url: r.url, title: r.title });
  const publication = inferPublication(r.url, r.snippet);
  const n = ev.register(
    { kind: "web", url: r.url, tier: r.tier, level: assessment.level, sourceKind: assessment.kind, organization: registrableDomain(r.host), publishedAt: publication.label, retrievedAt: new Date().toISOString(), documentId: "", documentName: `${r.title} (${r.host})`, subjectId: null, versionId: "", page: null, section: null, quote: quoteOf(r.snippet) },
    `web:${r.url}`,
    r.snippet
  );
  return { n, assessment, publication };
}

function formatHits(hits: Hit[], ev: Evidence) {
  return hits.map((h) => {
    const ref = ev.register({ documentId: h.documentId, documentName: h.documentName, subjectId: h.subjectId, versionId: h.versionId, page: h.page, section: h.section, quote: quoteOf(h.content) }, `chunk:${h.chunkId}`, h.content);
    return `[${ref}] ${h.documentName}${h.page ? `, page ${h.page}` : ""}${h.section ? ` — ${h.section}` : ""}\n${h.content}`;
  });
}

interface ToolContext {
  userId: string;
  scope: "GLOBAL" | "DOCUMENT";
  scopeFilter: Scope;
  docs: DocInfo[];
  ev: Evidence;
  signal: AbortSignal;
  web: boolean;
}

async function runTool(ctx: ToolContext, name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  ctx.ev.toolCalls.push(name);
  // En conversation de document, l'identifiant est imposé : le modèle ne peut pas en viser un autre.
  const fixedId = ctx.scope === "DOCUMENT" ? ctx.scopeFilter.documentIds![0] : undefined;
  const docId = fixedId ?? (typeof args.document_id === "string" ? args.document_id : undefined);
  const known = (id: string | undefined) => (id ? ctx.docs.find((d) => d.id === id) : undefined);
  try {
    switch (name) {
      case "list_documents":
        if (ctx.scope !== "GLOBAL") return { erreur: "Outil indisponible." };
        return { documents: ctx.docs.slice(0, 80).map((d) => ({ document_id: d.id, nom: d.name, pages: d.pageCount, etat: d.extractStatus })) };
      case "search_passages": {
        const query = String(args.query ?? "").slice(0, 300);
        if (!query.trim()) return { erreur: "Requête vide." };
        const filter: Scope = docId ? { ...ctx.scopeFilter, documentIds: [docId] } : ctx.scopeFilter;
        if (docId && !known(docId)) return { erreur: "Document inconnu ou non consultable." };
        const hits = await searchPassages(ctx.userId, filter, query, 8, ctx.signal);
        if (!hits.length) return { resultat: "Aucun passage trouvé pour cette requête. Reformule, ou lis des pages avec read_pages." };
        return { extraits: wrapUntrusted("extraits", formatHits(hits, ctx.ev).join("\n\n---\n\n")) };
      }
      case "read_pages": {
        const doc = known(docId);
        if (!doc) return { erreur: "Document inconnu ou non consultable." };
        const from = Number(args.from);
        if (!Number.isFinite(from) || from < 1) return { erreur: "Numéro de page invalide." };
        const r = await readPart(ctx.userId, doc.id, from, args.to == null ? undefined : Number(args.to));
        const blocks = r.parts.map((p) => {
          ctx.ev.pagesRead.add(`${doc.id}:${p.n}`);
          const ref = ctx.ev.register({ documentId: doc.id, documentName: doc.name, subjectId: doc.subjectId, versionId: doc.versionId, page: r.unit === "page" ? p.n : null, section: p.section, quote: quoteOf(p.text) }, `part:${doc.id}:${p.n}`, p.text);
          return `[${ref}] ${doc.name}, ${r.unit} ${p.n}${p.section ? ` — ${p.section}` : ""}\n${p.text}`;
        });
        return {
          total: `${r.total} ${r.unit}(s) au total`,
          ...(r.missing.length ? { sans_texte_extrait: r.missing, avertissement: "Ces pages n'ont pas de texte extrait : ne les décris pas." } : {}),
          contenu: blocks.length ? wrapUntrusted("pages", blocks.join("\n\n---\n\n")) : "Aucun texte pour cette plage.",
        };
      }
      case "search_web": {
        if (!ctx.web) return { erreur: "Recherche web désactivée par l'étudiant." };
        const query = String(args.query ?? "").slice(0, 300);
        if (!query.trim()) return { erreur: "Requête vide." };
        try {
          const out = await searchWeb(query, ctx.signal);
          ctx.ev.webSearches.push({ query, found: out.results.length });
          if (!out.results.length) return { resultat: "Aucune source web trouvée.", consigne: searchGuidance([]) };
          const registered = out.results.map((r) => ({ r, ...registerWeb(ctx.ev, r) }));
          const lines = registered.map(({ r, n, assessment, publication }) => `[${n}] ${r.title} — ${r.host} — niveau ${assessment.level} (${LEVEL_LABEL[assessment.level]})${publication.label ? ` — ${publication.label}` : ""}\n${r.snippet}`);
          const body = [out.summary ? `Synthèse du moteur de recherche (NON vérifiée : ne retiens que ce que les sources numérotées confirment) :\n${out.summary}` : "", ...lines].filter(Boolean).join("\n\n---\n\n");
          return { extraits_web: wrapUntrusted("extraits web", body), consigne: searchGuidance(registered.map((x) => x.assessment.level)) };
        } catch (e) {
          ctx.ev.webSearches.push({ query, found: -1 });
          return { erreur: e instanceof WebSearchUnavailableError ? "La recherche web est momentanément indisponible. Dis-le à l'étudiant et réponds sans prétendre avoir vérifié sur le web (marque ta réponse « non vérifiée en ligne »)." : "Recherche web en échec." };
        }
      }
      case "get_outline": {
        if (!known(docId)) return { erreur: "Document inconnu ou non consultable." };
        const o = await outline(ctx.userId, docId!);
        return o.sections.length ? { plan: wrapUntrusted("plan", JSON.stringify(o.sections)) } : { resultat: "Aucun plan détecté pour ce document." };
      }
      default:
        return { erreur: "Outil inconnu." };
    }
  } catch (e) {
    return { erreur: e instanceof ApiHttpError ? e.message : "Outil momentanément indisponible." };
  }
}

// ── Consigne système ─────────────────────────────────────────────────────────

function coverageText(docs: { doc: DocInfo; cov: Coverage }[]): string {
  return docs
    .map(({ doc, cov }) => {
      const parts = [`« ${doc.name} » : ${cov.indexedPassages} passages extraits`];
      if (cov.pageCount) parts.push(`${cov.pageCount} pages (${cov.pagesWithText} avec texte)`);
      parts.push(cov.complete ? "extraction complète" : "extraction PARTIELLE");
      if (cov.warnings.length) parts.push(`limites : ${cov.warnings.join(" ")}`);
      return `- ${parts.join(" ; ")}`;
    })
    .join("\n");
}

function systemPrompt(scope: "GLOBAL" | "DOCUMENT", docs: { doc: DocInfo; cov: Coverage }[], totalDocs: number, web: boolean): string {
  return `Tu es l'assistant pédagogique de Niala, une plateforme d'apprentissage personnelle. Tu aides un étudiant : comprendre ses cours, répondre à ses questions de connaissances générales, donner des explications, des exemples, des comparaisons, des approfondissements et des exercices d'application. Réponds en français (sauf demande contraire), de façon structurée et concise, en Markdown simple. Écris les formules mathématiques en LaTeX entre doubles dollars, par exemple $$n! = n \\times (n-1)!$$ ; n'utilise jamais un dollar seul pour une formule.

${scope === "DOCUMENT" ? "Tu discutes d'UN SEUL cours. Tu n'as accès à aucun autre document." : `Tu as accès à la bibliothèque de l'étudiant (${totalDocs} document(s) consultables). L'étudiant peut aussi te poser des questions sans rapport avec ses cours : réponds alors directement, sans chercher dans ses documents.`}

Méthode :
- Pour toute question qui porte sur le contenu d'un cours, commence par search_passages (et read_pages / get_outline si la question est large ou si les extraits sont insuffisants). N'affirme jamais ce que dit un cours sans l'avoir consulté dans ce tour de conversation. Si la question est générale ou indépendante des cours, réponds directement, sans mentionner les documents de l'étudiant ni l'état de leur extraction (sauf s'il pose la question).
- Cite tes sources avec le numéro entre crochets, par exemple [2] ou [1, 3], placé juste après l'affirmation correspondante. N'utilise QUE des numéros fournis par les outils.
- Distingue ce qui vient du cours (« Selon ton document, … »), ce qui vient du web et ce qui vient de tes connaissances générales (annonce celles-ci : « hors du cours : … ») ; ces dernières n'ont pas de numéro.
- Si le cours ne traite pas le sujet, dis-le. Si le cours semble contenir une erreur ou une information dépassée, signale-le avec tact et cherche une référence externe si la recherche est disponible.

${RELIABILITY_RULES}
${web ? `
Recherche web (outil search_web) :
- Utilise-la pour vérifier ou compléter un point d'un cours, pour toute information factuelle précise (date, chiffre, version, nom, définition officielle, loi, règlement, actualité) dont tu n'es pas certain, ou quand l'étudiant le demande. Pas pour ce qui est déjà clair dans le cours. Si une première requête ne donne rien d'utile, reformule une fois (par exemple en anglais) avant de conclure.
- Le serveur classe chaque source du niveau 1 (primaire ou institutionnelle) au niveau 4 (non vérifiée) ; un forum réputé reste de niveau 3. Le niveau décrit la nature de la source, pas sa pertinence. Après ta réponse, le serveur contrôle chaque affirmation contre les sources : ne cite [n] que si le passage établit précisément ce que tu affirmes.
- Règle de présentation, OBLIGATOIRE pour toute information issue du web :
  • Information confirmée par une source de niveau 1 ou 2 : donne-la normalement, nomme le site et cite-le [n].
  • Information trouvée seulement sur des forums ou sources de niveau 3 ou 4, ou dont tu n'es pas sûr : donne-la précédée de « ⚠️ Information non officielle / non vérifiée : », cite la source [n] et invite l'étudiant à la recouper.
  • Rien de fiable trouvé : écris clairement « ❌ Je n'ai pas trouvé d'information fiable sur … ». N'invente pas, ne comble pas avec tes souvenirs. Tu peux ensuite proposer une piste (où chercher), sans la présenter comme une réponse.
- Si des sources se contredisent, décris précisément la divergence, compare leur autorité, leurs dates et leurs contextes, et ne choisis pas la version la plus fréquente. Si rien ne permet de trancher, dis-le. Pour le droit, précise toujours le pays ; en programmation, précise les versions quand cela change le résultat.
- N'affirme rien que les extraits web ne soutiennent pas. La « synthèse du moteur » n'est pas une source : seules les sources numérotées comptent. Si la recherche est indisponible, dis-le.
- Si tu réponds de mémoire à une question factuelle précise sans vérification en ligne, précise « (d'après mes connaissances, non vérifié en ligne) ».
` : `
La recherche web est désactivée : n'affirme pas avoir vérifié quoi que ce soit sur le web.
`}
Honnêteté sur la lecture (état réel de l'extraction, calculé par le serveur) :
${coverageText(docs) || "- Aucun document consultable."}
- Ne prétends JAMAIS avoir lu un document en entier : tu n'as lu que les passages renvoyés par les outils. Pour une demande de résumé complet, lis le plan puis les parties utiles, et indique ce que tu as réellement consulté.
- Si une extraction est partielle ou si des pages n'ont pas de texte, signale-le dès que cela peut affecter la réponse.

${UNTRUSTED_RULES.replace("Ne produis que le JSON demandé, sans texte autour.", "Réponds uniquement à l'étudiant.")}`;
}

// ── Envoi d'un message ───────────────────────────────────────────────────────

export interface ChatReply {
  message: { id: string; role: "ASSISTANT"; content: string; citations: Citation[]; consulted: unknown; model: string | null; createdAt: Date };
  userMessageId: string;
  title: string;
}

async function logUsage(userId: string, model: string, promptChars: number, respChars: number, ok: boolean, error: string | undefined, started: number) {
  await db.aIUsageLog.create({ data: { userId, op: "chat.turn@1", model, promptChars, respChars, ok, error: error?.slice(0, 500) ?? null, durationMs: Date.now() - started } }).catch(() => undefined);
}

export type ChatEvent = { type: "status"; text: string } | { type: "delta"; text: string };

const TOOL_STATUS: Record<string, string> = {
  search_web: "Recherche sur le web…",
  search_passages: "Recherche dans vos cours…",
  read_pages: "Lecture des pages…",
  get_outline: "Lecture du plan…",
  list_documents: "Consultation de vos documents…",
};

export interface SendOptions {
  /** Autorise la recherche web (si un moteur est disponible). */
  web?: boolean;
  /** Reçoit l'avancement et le texte au fur et à mesure de la rédaction. */
  emit?: (event: ChatEvent) => void;
  /** Exécute une tâche après l'envoi de la réponse. Absent : tout est fait avant de répondre. */
  defer?: (task: () => Promise<unknown>) => void;
  /** Conversation globale : limite ce message aux documents choisis par l'étudiant. */
  documentIds?: string[];
  /** Interruption demandée par l'étudiant : le texte déjà rédigé est conservé. */
  signal?: AbortSignal;
}

/** Code renvoyé quand l'étudiant interrompt une génération avant le moindre texte. */
export const INTERRUPTED_STATUS = 499;

export async function sendMessage(userId: string, conversationId: string, content: string, options: SendOptions = {}): Promise<ChatReply> {
  const conv = await ownedConversation(userId, conversationId);
  const provider = getProvider();
  if (!provider?.converse) throw new ApiHttpError("Le chat nécessite le service d'IA Gemini, qui n'est pas configuré (variable GEMINI_API_KEY).", 503);

  const scope = conv.scope;
  const scopeFilter: Scope = scope === "DOCUMENT" ? { documentIds: [conv.documentId!] } : { subjectId: conv.subjectId, ...(options.documentIds?.length ? { documentIds: options.documentIds } : {}) };
  // Lectures groupées : chaque aller-retour vers la base coûte environ 0,5 s.
  const [, docs, history] = await Promise.all([
    checkQuota(userId),
    resolveDocs(userId, scopeFilter),
    db.conversationMessage.findMany({ where: { conversationId, userId }, orderBy: { createdAt: "desc" }, take: HISTORY_MESSAGES, select: { role: true, content: true } }),
  ]);
  if (scope === "DOCUMENT" && docs.length === 0) {
    const exists = await db.document.findFirst({ where: { id: conv.documentId!, userId }, select: { id: true } });
    if (!exists) throw new ApiHttpError("Document introuvable.", 404);
  }


  // Indexation sémantique des passages encore non vectorisés (document ouvert : budget court, reprise au message suivant)
  if (scope === "DOCUMENT" && docs[0]) {
    if (options.defer) options.defer(() => embedPending(userId, docs[0].versionId, 15_000));
    else await embedPending(userId, docs[0].versionId, 15_000);
  }
  const [userMsg, withCoverage] = await Promise.all([
    db.conversationMessage.create({ data: { userId, conversationId, role: "USER", content } }),
    Promise.all(docs.slice(0, 12).map(async (doc) => ({ doc, cov: await documentCoverage(userId, doc) }))),
  ]);

  const webOn = options.web !== false && (await webStatus()) !== null;
  const ev = new Evidence();
  const ctx: ToolContext = { userId, scope, scopeFilter, docs, ev, signal: options.signal ? AbortSignal.any([AbortSignal.timeout(110_000), options.signal]) : AbortSignal.timeout(110_000), web: webOn };
  const system = systemPrompt(scope, withCoverage, docs.length, webOn);
  const tools = webOn ? [...TOOLS[scope], WEB_TOOL] : TOOLS[scope];
  const turns: ChatTurn[] = [
    ...history.reverse().map((m): ChatTurn => ({ role: m.role === "USER" ? "user" : "model", parts: [{ text: m.content }] })),
    { role: "user", parts: [{ text: content }] },
  ];

  const started = Date.now();
  let answer = "";
  /** Texte de l'étape en cours : c'est ce qui est conservé si l'étudiant interrompt la rédaction. */
  let partial = "";
  let interrupted = false;
  let model = provider.model;
  try {
    for (let step = 0; step <= MAX_STEPS; step++) {
      const last = step === MAX_STEPS;
      const res = await provider.converse({ system, turns, tools: last ? undefined : tools, maxTokens: 4000, temperature: 0.3, signal: ctx.signal, onText: options.emit ? (d) => { partial += d; options.emit!({ type: "delta", text: d }); } : undefined });
      model = res.model;
      if (!res.calls.length || last) {
        answer = res.text;
        break;
      }
      turns.push({ role: "model", parts: res.modelParts });
      partial = "";
      // Un nouveau statut annonce une étape : le client efface le texte provisoire éventuel.
      options.emit?.({ type: "status", text: TOOL_STATUS[res.calls[0].name] ?? "Recherche…" });
      const responses: ChatPart[] = await Promise.all(res.calls.slice(0, 4).map(async (call) => ({ functionResponse: { name: call.name, response: await runTool(ctx, call.name, call.args) } })));
      turns.push({ role: "user", parts: responses });
    }
    if (!answer.trim()) throw new AiCallError("Réponse vide.");
    await logUsage(userId, model, system.length + content.length, answer.length, true, undefined, started);
  } catch (e) {
    if (options.signal?.aborted) {
      interrupted = true;
      if (!partial.trim()) throw new ApiHttpError("Génération interrompue.", INTERRUPTED_STATUS);
      answer = partial;
    } else {
      const message = e instanceof Error ? e.message : "Erreur inconnue";
      console.warn(`[chat] ${message}`);
      await logUsage(userId, model, system.length + content.length, 0, false, message, started);
      throw new ApiHttpError("Le service d'IA est momentanément indisponible. Votre message est conservé : réessayez dans un instant.", 502);
    }
  }

  // 1. Citations inventées retirées ; 2. contrôle de chaque affirmation ; 3. avertissements placés à côté de ce qui est incertain.
  const resolved = resolveCitations(answer.trim(), ev.known);
  const webState: WebStatus = !webOn ? (options.web === false ? "desactivee" : "indisponible") : ev.webSearches.length === 0 ? "non_utilisee" : ev.webSearches.every((s) => s.found < 0) ? "indisponible" : "utilisee";
  const crossCheck = webOn
    ? async (query: string) => {
        const out = await searchWeb(query, ctx.signal);
        ev.webSearches.push({ query, found: out.results.length });
        const numbers = new Set(out.results.map((r) => registerWeb(ev, r).n));
        return sourcesOf(ev).filter((s) => numbers.has(s.n));
      }
    : undefined;
  const citedDocument = resolved.citations.some((c) => c.kind !== "web");
  const check = async () => {
    const verification = await verifyAnswer({ userId, question: content, answer: resolved.text, sources: sourcesOf(ev), citedDocument, webStatus: webState, search: crossCheck, deadlineAt: started + VERIFICATION_DEADLINE_MS });
    const final = resolveCitations(applyVerification(resolved.text, verification), ev.known);
    // Une source qui sert de preuve reste consultable, même si la réponse ne la cite pas.
    const proofs = verification.claims.flatMap((c) => c.evidence.map((e) => e.n)).filter((n) => !final.citations.some((c) => c.n === n));
    const citations = [...final.citations, ...[...new Set(proofs)].map((n) => ev.known.get(n)!)].sort((a, b) => a.n - b.n);
    return { verification, text: final.text, citations };
  };
  const consultedWith = (verification: VerificationReport) => ({
    verification,
    webSearches: ev.webSearches.length,
    documents: [...ev.docs].map(([id, name]) => ({ id, name })),
    passages: [...ev.known.values()].filter((c) => c.kind !== "web").length,
    webSources: [...ev.known.values()].filter((c) => c.kind === "web").length,
    web: webOn,
    pagesRead: ev.pagesRead.size,
    tools: ev.toolCalls,
    coverage: withCoverage.map(({ doc, cov }) => ({ documentId: doc.id, documentName: doc.name, ...cov })),
  });
  const asJson = (v: unknown) => v as Prisma.InputJsonValue;
  const title = conv.title === DEFAULT_TITLE ? content.replace(/\s+/g, " ").slice(0, 60) : conv.title;
  const store = async (text: string, citations: Citation[], consulted: unknown) => {
    const [saved] = await Promise.all([
      db.conversationMessage.create({ data: { userId, conversationId, role: "ASSISTANT", content: text, citations: asJson(citations), consulted: asJson(consulted), model } }),
      db.conversation.update({ where: { id: conversationId }, data: { title, updatedAt: new Date() } }),
    ]);
    return { reply: { message: { id: saved.id, role: "ASSISTANT" as const, content: text, citations, consulted, model, createdAt: saved.createdAt }, userMessageId: userMsg.id, title }, messageId: saved.id };
  };
  // Réponse interrompue : conservée telle quelle et signalée, sans vérification d'un texte incomplet.
  if (interrupted) {
    const { verification: _none, ...consulted } = consultedWith(pendingVerification(webState));
    return (await store(resolved.text, resolved.citations, { ...consulted, interrupted: true })).reply;
  }
  const trace = (messageId: string, verification: VerificationReport) => saveVerification(userId, { feature: "chat", entityType: "ConversationMessage", entityId: messageId }, verification, sourcesOf(ev));

  // L'étudiant reçoit la réponse tout de suite, annoncée « en cours de vérification » ; le résultat la complète ensuite.
  if (options.defer && needsVerification(resolved.text, sourcesOf(ev), citedDocument)) {
    const { reply, messageId } = await store(resolved.text, resolved.citations, consultedWith(pendingVerification(webState)));
    options.defer(async () => {
      try {
        const done = await check();
        const { count } = await db.conversationMessage.updateMany({ where: { id: messageId, userId }, data: { content: done.text, citations: asJson(done.citations), consulted: asJson(consultedWith(done.verification)) } });
        if (count && done.verification.status !== "ignoree") await trace(messageId, done.verification);
      } catch (e) {
        console.warn("[chat] vérification différée impossible :", e instanceof Error ? e.message : e);
        await db.conversationMessage.updateMany({ where: { id: messageId, userId }, data: { consulted: asJson(consultedWith(failedVerification(webState))) } }).catch(() => undefined);
      }
    });
    return reply;
  }

  const done = await check();
  const { reply, messageId } = await store(done.text, done.citations, consultedWith(done.verification));
  if (done.verification.status !== "ignoree") await trace(messageId, done.verification);
  return reply;
}
