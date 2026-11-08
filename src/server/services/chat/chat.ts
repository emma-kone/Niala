import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiHttpError } from "@/lib/api-helpers";
import { AiCallError, getProvider, type ChatPart, type ChatTurn, type ToolDeclaration } from "@/server/ai/provider";
import { checkQuota } from "@/server/ai/structured";
import { UNTRUSTED_RULES, wrapUntrusted } from "@/server/ai/guard";
import { resolveCitations, type Citation, type Coverage } from "@/server/domain/retrieval";
import { embedPending } from "./indexing";
import { RELIABILITY_RULE, TIER_LABEL, assessReliability, hostOf } from "@/server/domain/web-trust";
import { WebSearchUnavailableError, searchWeb, webStatus } from "@/server/ai/web-search";
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

export const createSchema = z.object({
  scope: z.enum(["GLOBAL", "DOCUMENT"]),
  documentId: z.string().min(1).optional(),
  subjectId: z.string().min(1).optional(),
});
export const messageSchema = z.object({ content: z.string().trim().min(1, "Message vide.").max(MAX_MESSAGE_CHARS, "Message trop long."), web: z.boolean().optional() });

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

async function ownedConversation(userId: string, id: string) {
  const conv = await db.conversation.findFirst({ where: { id, userId } });
  if (!conv) throw new ApiHttpError("Conversation introuvable.", 404);
  return conv;
}

export async function getConversation(userId: string, id: string) {
  const conv = await ownedConversation(userId, id);
  const messages = await db.conversationMessage.findMany({
    where: { conversationId: id, userId },
    orderBy: { createdAt: "asc" },
    select: { id: true, role: true, content: true, citations: true, consulted: true, model: true, createdAt: true },
  });
  return { conversation: { id: conv.id, title: conv.title, scope: conv.scope, documentId: conv.documentId, subjectId: conv.subjectId, updatedAt: conv.updatedAt }, messages };
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
  await db.conversation.delete({ where: { id } });
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

  register(c: Omit<Citation, "n">, key: string): number {
    const existing = this.keys.get(key);
    if (existing) return existing;
    const n = this.known.size + 1;
    this.known.set(n, { n, ...c });
    this.keys.set(key, n);
    if (c.kind !== "web") this.docs.set(c.documentId, c.documentName);
    return n;
  }
}

const quoteOf = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 240);

function formatHits(hits: Hit[], ev: Evidence) {
  return hits.map((h) => {
    const ref = ev.register({ documentId: h.documentId, documentName: h.documentName, subjectId: h.subjectId, versionId: h.versionId, page: h.page, section: h.section, quote: quoteOf(h.content) }, `chunk:${h.chunkId}`);
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
          const ref = ctx.ev.register({ documentId: doc.id, documentName: doc.name, subjectId: doc.subjectId, versionId: doc.versionId, page: r.unit === "page" ? p.n : null, section: p.section, quote: quoteOf(p.text) }, `part:${doc.id}:${p.n}`);
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
          const reliability = assessReliability(out.results);
          ctx.ev.webSearches.push({ query, found: out.results.length });
          if (!out.results.length) return { fiabilite: reliability.level, resultat: "Aucune source web trouvée.", consigne: RELIABILITY_RULE.aucune };
          const lines = out.results.map((r) => {
            const ref = ctx.ev.register({ kind: "web", url: r.url, tier: r.tier, documentId: "", documentName: `${r.title} (${r.host})`, subjectId: null, versionId: "", page: null, section: null, quote: quoteOf(r.snippet) }, `web:${r.url}`);
            return `[${ref}] ${r.title} — ${r.host} — ${TIER_LABEL[r.tier]}\n${r.snippet}`;
          });
          const body = [out.summary ? `Synthèse du moteur de recherche (NON vérifiée : ne retiens que ce que les sources numérotées confirment) :\n${out.summary}` : "", ...lines].filter(Boolean).join("\n\n---\n\n");
          return {
            fiabilite: reliability.level,
            sources_reconnues: reliability.recognized,
            sites_distincts: reliability.independent,
            extraits_web: wrapUntrusted("extraits web", body),
            consigne: `${RELIABILITY_RULE[reliability.level]} Vérifie aussi que les extraits répondent VRAIMENT à la question : une source fiable sur un autre sujet ne prouve rien. Si aucun extrait ne répond, dis que tu n'as pas trouvé.`,
          };
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
  return `Tu es l'assistant pédagogique de Niala, une plateforme d'apprentissage personnelle. Tu aides un étudiant : comprendre ses cours, répondre à ses questions de connaissances générales, donner des explications, des exemples, des comparaisons, des approfondissements et des exercices d'application. Réponds en français (sauf demande contraire), de façon structurée et concise, en Markdown simple. N'utilise pas LaTeX ni les symboles $ : écris les formules en texte (n! = n × (n-1)!) ou dans un bloc de code.

${scope === "DOCUMENT" ? "Tu discutes d'UN SEUL cours. Tu n'as accès à aucun autre document." : `Tu as accès à la bibliothèque de l'étudiant (${totalDocs} document(s) consultables). L'étudiant peut aussi te poser des questions sans rapport avec ses cours : réponds alors directement, sans chercher dans ses documents.`}

Méthode :
- Pour toute question qui porte sur le contenu d'un cours, commence par search_passages (et read_pages / get_outline si la question est large ou si les extraits sont insuffisants). N'affirme jamais ce que dit un cours sans l'avoir consulté dans ce tour de conversation. Si la question est générale ou indépendante des cours, réponds directement, sans mentionner les documents de l'étudiant ni l'état de leur extraction (sauf s'il pose la question).
- Cite tes sources avec le numéro entre crochets, par exemple [2] ou [1, 3], placé juste après l'affirmation correspondante. N'utilise QUE des numéros fournis par les outils.
- Distingue ce qui vient du cours, ce qui vient du web et ce qui vient de tes connaissances générales (annonce celles-ci : « hors du cours : … ») ; ces dernières n'ont pas de numéro.
- Si le cours ne traite pas le sujet, dis-le.
${web ? `
Recherche web (outil search_web) :
- Utilise-la pour vérifier ou compléter un point d'un cours, pour toute information factuelle précise (date, chiffre, version, nom, définition officielle, loi, règlement, actualité) dont tu n'es pas certain, ou quand l'étudiant le demande. Pas pour ce qui est déjà clair dans le cours. Si une première requête ne donne rien d'utile, reformule une fois (par exemple en anglais) avant de conclure.
- Le serveur classe chaque source (« source reconnue » = documentation officielle, universités, administrations, références ; sinon « source à vérifier ») et calcule un niveau de fiabilité. Respecte la consigne renvoyée avec les résultats.
- Règle de présentation, OBLIGATOIRE pour toute information issue du web :
  • Information confirmée par une source reconnue : donne-la normalement, nomme le site et cite-le [n].
  • Information trouvée seulement sur des sources à vérifier, ou dont tu n'es pas sûr : donne-la précédée de « ⚠️ Information non officielle / non vérifiée : », cite la source [n] et invite l'étudiant à la recouper.
  • Rien de fiable trouvé : écris clairement « ❌ Je n'ai pas trouvé d'information fiable sur … ». N'invente pas, ne comble pas avec tes souvenirs. Tu peux ensuite proposer une piste (où chercher), sans la présenter comme une réponse.
- Si des sources se contredisent, dis-le et indique laquelle est officielle.
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

export interface SendOptions {
  /** Autorise la recherche web (si un moteur est disponible). */
  web?: boolean;
}

export async function sendMessage(userId: string, conversationId: string, content: string, options: SendOptions = {}): Promise<ChatReply> {
  const conv = await ownedConversation(userId, conversationId);
  const provider = getProvider();
  if (!provider?.converse) throw new ApiHttpError("Le chat nécessite le service d'IA Gemini, qui n'est pas configuré (variable GEMINI_API_KEY).", 503);
  await checkQuota(userId);

  const scope = conv.scope;
  const scopeFilter: Scope = scope === "DOCUMENT" ? { documentIds: [conv.documentId!] } : { subjectId: conv.subjectId };
  const docs = await resolveDocs(userId, scopeFilter);
  if (scope === "DOCUMENT" && docs.length === 0) {
    const exists = await db.document.findFirst({ where: { id: conv.documentId!, userId }, select: { id: true } });
    if (!exists) throw new ApiHttpError("Document introuvable.", 404);
  }

  const history = await db.conversationMessage.findMany({ where: { conversationId, userId }, orderBy: { createdAt: "desc" }, take: HISTORY_MESSAGES, select: { role: true, content: true } });
  const userMsg = await db.conversationMessage.create({ data: { userId, conversationId, role: "USER", content } });

  // Indexation sémantique des passages encore non vectorisés (document ouvert : budget court, reprise au message suivant)
  if (scope === "DOCUMENT" && docs[0]) await embedPending(userId, docs[0].versionId, 15_000);
  const withCoverage = await Promise.all(docs.slice(0, 12).map(async (doc) => ({ doc, cov: await documentCoverage(userId, doc) })));

  const webOn = options.web !== false && (await webStatus()) !== null;
  const ev = new Evidence();
  const ctx: ToolContext = { userId, scope, scopeFilter, docs, ev, signal: AbortSignal.timeout(110_000), web: webOn };
  const system = systemPrompt(scope, withCoverage, docs.length, webOn);
  const tools = webOn ? [...TOOLS[scope], WEB_TOOL] : TOOLS[scope];
  const turns: ChatTurn[] = [
    ...history.reverse().map((m): ChatTurn => ({ role: m.role === "USER" ? "user" : "model", parts: [{ text: m.content }] })),
    { role: "user", parts: [{ text: content }] },
  ];

  const started = Date.now();
  let answer = "";
  let model = provider.model;
  try {
    for (let step = 0; step <= MAX_STEPS; step++) {
      const last = step === MAX_STEPS;
      const res = await provider.converse({ system, turns, tools: last ? undefined : tools, maxTokens: 4000, temperature: 0.3, signal: ctx.signal });
      model = res.model;
      if (!res.calls.length || last) {
        answer = res.text;
        break;
      }
      turns.push({ role: "model", parts: res.modelParts });
      const responses: ChatPart[] = [];
      for (const call of res.calls.slice(0, 4)) responses.push({ functionResponse: { name: call.name, response: await runTool(ctx, call.name, call.args) } });
      turns.push({ role: "user", parts: responses });
    }
    if (!answer.trim()) throw new AiCallError("Réponse vide.");
    await logUsage(userId, model, system.length + content.length, answer.length, true, undefined, started);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erreur inconnue";
    console.warn(`[chat] ${message}`);
    await logUsage(userId, model, system.length + content.length, 0, false, message, started);
    throw new ApiHttpError("Le service d'IA est momentanément indisponible. Votre message est conservé : réessayez dans un instant.", 502);
  }

  const { text, citations } = resolveCitations(answer.trim(), ev.known);
  // Fiabilité calculée sur les sources web RÉELLEMENT citées dans la réponse (pas sur tout ce qui a été lu).
  const citedWeb = citations.filter((c) => c.kind === "web" && c.url).map((c) => ({ host: hostOf(c.url!) ?? c.url!, tier: c.tier ?? "a_verifier" }));
  const webReliability = ev.webSearches.length === 0 ? null : citedWeb.length ? assessReliability(citedWeb).level : ev.webSearches.every((s) => s.found < 0) ? "indisponible" : "aucune";
  const consulted = {
    webReliability,
    webSearches: ev.webSearches.length,
    documents: [...ev.docs].map(([id, name]) => ({ id, name })),
    passages: [...ev.known.values()].filter((c) => c.kind !== "web").length,
    webSources: [...ev.known.values()].filter((c) => c.kind === "web").length,
    web: webOn,
    pagesRead: ev.pagesRead.size,
    tools: ev.toolCalls,
    coverage: withCoverage.map(({ doc, cov }) => ({ documentId: doc.id, documentName: doc.name, ...cov })),
  };
  const saved = await db.conversationMessage.create({
    data: { userId, conversationId, role: "ASSISTANT", content: text, citations: citations as unknown as Prisma.InputJsonValue, consulted: consulted as unknown as Prisma.InputJsonValue, model },
  });
  let title = conv.title;
  if (conv.title === DEFAULT_TITLE) title = content.replace(/\s+/g, " ").slice(0, 60);
  await db.conversation.update({ where: { id: conversationId }, data: { title, updatedAt: new Date() } });
  return { message: { id: saved.id, role: "ASSISTANT", content: text, citations, consulted, model, createdAt: saved.createdAt }, userMessageId: userMsg.id, title };
}
