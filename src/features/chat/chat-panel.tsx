"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { AlertTriangle, ArrowDown, Globe, History, Loader2, MessageSquarePlus, PanelLeftClose, PanelLeftOpen, RefreshCw, Trash2 } from "lucide-react";
import { ApiError, api, postStream } from "@/lib/client-api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { confirmAction } from "@/components/notifications";
import { ChatComposer, type ComposerHandle, type ContextDocument, type RecentDoc, type SubjectChoice } from "./chat-composer";
import { AssistantMessage, LiveMessage, TypingBubble, UserBubble } from "./chat-message";
import { ChatSidebar } from "./chat-sidebar";
import { ChatWelcome, type Suggestion } from "./chat-welcome";
import type { ChatCitation, ChatMessageDto, ConversationDto } from "./types";

interface Props {
  scope: "GLOBAL" | "DOCUMENT";
  /** Obligatoire pour une conversation de document. */
  documentId?: string;
  /** Appelé au clic sur une référence de cours (ex. aller à la page du PDF ouvert). Sinon : lien vers le document. */
  onCitation?: (c: ChatCitation) => void;
  /** « page » : grand espace avec barre latérale (historique, réglages) ; « panel » : version compacte du lecteur. */
  variant?: "page" | "panel";
  className?: string;
}

interface AiStatus {
  configured: boolean;
  chat?: boolean;
  web?: { available: boolean; backend: "tavily" | "gemini" | "wikipedia" | null };
}

const DOCUMENT_STARTERS = ["Résume ce cours en quelques points clés.", "Explique-moi la notion la plus difficile avec un exemple.", "Quelles sont les définitions importantes ?"];

const WEB_KEY = "niala-chat-web";
const VERIFICATION_POLL_MS = 1500;
const VERIFICATION_MAX_POLLS = 100;
const ALL = "__all__";
/** Silence au-delà duquel l'indicateur prévient que la réponse tarde. */
const SLOW_AFTER_MS = 15_000;
/** Au-delà de la limite du serveur (120 s), le flux est considéré comme perdu. */
const RESPONSE_TIMEOUT_MS = 130_000;
const INTERRUPTED_STATUS = 499;
const NEAR_BOTTOM_PX = 120;

type Notice = { kind: "error" | "interrupted"; text: string; retry: string | null };

const localMessage = (role: ChatMessageDto["role"], content: string, id: string): ChatMessageDto => ({ id, role, content, citations: null, consulted: null, model: null, createdAt: new Date().toISOString() });

export default function ChatPanel({ scope, documentId, onCitation, variant = "panel", className }: Props) {
  const page = variant === "page";
  const [conversations, setConversations] = useState<ConversationDto[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageDto[]>([]);
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  /** Réponse en cours de rédaction : étape annoncée et texte reçu. */
  const [live, setLive] = useState<{ status: string; text: string } | null>(null);
  const [slow, setSlow] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [web, setWeb] = useState(true);
  const [subjects, setSubjects] = useState<SubjectChoice[]>([]);
  const [subjectId, setSubjectId] = useState<string>(ALL);
  const [recent, setRecent] = useState<RecentDoc[]>([]);
  const [contextDocs, setContextDocs] = useState<ContextDocument[]>([]);
  const [sidebar, setSidebar] = useState(true);
  const [drawer, setDrawer] = useState(false);
  const [atBottom, setAtBottom] = useState(true);

  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const composer = useRef<ComposerHandle>(null);
  const controller = useRef<AbortController | null>(null);
  const streamed = useRef("");
  const conversationOfTurn = useRef<string | null>(null);
  const stopRequested = useRef(false);

  const listQuery = scope === "DOCUMENT" ? `scope=DOCUMENT&documentId=${documentId}` : "scope=GLOBAL";
  const aiReady = status ? status.configured && status.chat !== false : null;
  const webAvailable = !!status?.web?.available;
  const active = (conversations ?? []).find((c) => c.id === activeId) ?? null;

  // La vérification se termine après l'envoi de la réponse : on recharge la conversation jusqu'à son résultat.
  const verifying = !sending && messages.some((m) => m.consulted?.verification?.status === "en_cours");
  useEffect(() => {
    if (!verifying || !activeId) return;
    const id = activeId;
    let ticks = 0;
    const timer = setInterval(() => {
      if (++ticks > VERIFICATION_MAX_POLLS) return clearInterval(timer);
      api.get<{ messages: ChatMessageDto[] }>(`/api/conversations/${id}`).then((r) => setMessages((prev) => (JSON.stringify(prev) === JSON.stringify(r.messages) ? prev : r.messages))).catch(() => undefined);
    }, VERIFICATION_POLL_MS);
    return () => clearInterval(timer);
  }, [verifying, activeId]);

  const open = useCallback(async (id: string) => {
    setNotice(null);
    setContextDocs([]);
    try {
      const r = await api.get<{ conversation: ConversationDto; messages: ChatMessageDto[] }>(`/api/conversations/${id}`);
      stick.current = true;
      setActiveId(id);
      setMessages(r.messages);
      setSubjectId(r.conversation.subjectId ?? ALL);
    } catch (e) {
      setNotice({ kind: "error", text: e instanceof Error ? e.message : "Conversation indisponible.", retry: null });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .get<AiStatus>("/api/ai/status")
      .then((s) => {
        if (cancelled) return;
        try {
          setWeb(localStorage.getItem(WEB_KEY) !== "0");
        } catch {
          /* préférence non mémorisable : valeur par défaut */
        }
        setStatus(s);
      })
      .catch(() => !cancelled && setStatus({ configured: false }));
    if (scope === "GLOBAL") {
      api.get<{ subjects: SubjectChoice[] }>("/api/subjects").then((r) => !cancelled && setSubjects(r.subjects)).catch(() => undefined);
      api.get<{ documents: RecentDoc[] }>("/api/files/recent").then((r) => !cancelled && setRecent(r.documents)).catch(() => undefined);
    }
    api
      .get<{ conversations: ConversationDto[] }>(`/api/conversations?${listQuery}`)
      .then(async (r) => {
        if (cancelled) return;
        setConversations(r.conversations);
        // La page Assistant s'ouvre sur l'accueil ; le panneau d'un cours reprend sa dernière conversation.
        if (!page && r.conversations[0]) await open(r.conversations[0].id);
      })
      .catch((e) => {
        if (cancelled) return;
        setConversations([]);
        setNotice({ kind: "error", text: e instanceof Error ? e.message : "Chargement impossible.", retry: null });
      });
    return () => {
      cancelled = true;
    };
  }, [listQuery, open, scope, page]);

  // Suit la rédaction tant que l'étudiant est en bas ; s'il remonte relire, le défilement lui appartient.
  useEffect(() => {
    if (!stick.current || !scroller.current) return;
    scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [messages, sending, live?.text, live?.status, notice]);

  // L'indicateur annonce un délai inhabituel dès que le flux reste silencieux.
  useEffect(() => {
    if (!sending) return;
    const t = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => {
      clearTimeout(t);
      setSlow(false);
    };
  }, [sending, live?.status, live?.text]);

  function onScroll() {
    const el = scroller.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    stick.current = near;
    setAtBottom(near);
  }

  function scrollDown() {
    stick.current = true;
    setAtBottom(true);
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }

  function toggleWeb(on: boolean) {
    setWeb(on);
    try {
      localStorage.setItem(WEB_KEY, on ? "1" : "0");
    } catch {
      /* ignoré */
    }
  }

  function verifyPoint(c: ChatCitation) {
    void send(`Vérifie dans des sources externes fiables ce passage de mon cours (${c.documentName}${c.page ? `, page ${c.page}` : ""}) : « ${c.quote} ». Signale toute erreur ou information dépassée.`);
  }

  /** Envoie une question (ou relance la dernière). Le texte reçu s'affiche au fil de l'eau, la réponse finale le remplace. */
  async function run(request: { content: string; regenerate?: boolean; documentIds?: string[] }) {
    if (sending) return;
    const ac = new AbortController();
    controller.current = ac;
    stopRequested.current = false;
    streamed.current = "";
    stick.current = true;
    setAtBottom(true);
    setSending(true);
    setStopping(false);
    setNotice(null);
    setLive({ status: "", text: "" });
    const timeout = setTimeout(() => ac.abort(), RESPONSE_TIMEOUT_MS);
    let id = activeId;
    const offerRetry = () => (request.regenerate ? "" : request.content);
    try {
      if (!id) {
        const c = await api.post<{ conversation: ConversationDto }>("/api/conversations", {
          scope,
          ...(documentId ? { documentId } : {}),
          ...(scope === "GLOBAL" && subjectId !== ALL ? { subjectId } : {}),
        });
        id = c.conversation.id;
        setActiveId(id);
        setConversations((list) => [c.conversation, ...(list ?? [])]);
      }
      conversationOfTurn.current = id;
      const conversation = id;
      const r = await postStream<{ message: ChatMessageDto; title: string }>(
        `/api/conversations/${conversation}/messages`,
        { content: request.content, web: web && webAvailable, ...(request.regenerate ? { regenerate: true } : {}), ...(request.documentIds?.length ? { documentIds: request.documentIds } : {}) },
        {
          status: (t) => {
            streamed.current = "";
            setLive({ status: t, text: "" });
          },
          delta: (t) => {
            streamed.current += t;
            setLive((l) => ({ status: l?.status ?? "", text: (l?.text ?? "") + t }));
          },
        },
        ac.signal
      );
      setMessages((m) => [...m, r.message]);
      setConversations((list) => (list ?? []).map((c) => (c.id === conversation ? { ...c, title: r.title, updatedAt: new Date().toISOString() } : c)));
    } catch (e) {
      const partial = streamed.current.trim();
      if (stopRequested.current || (e instanceof ApiError && e.status === INTERRUPTED_STATUS)) {
        // Interruption voulue : le texte déjà rédigé reste affiché, signalé comme incomplet.
        if (partial) setMessages((m) => [...m, { ...localMessage("ASSISTANT", partial, `local-${Date.now()}`), consulted: { documents: [], passages: 0, pagesRead: 0, tools: [], coverage: [], interrupted: true } }]);
        else setNotice({ kind: "interrupted", text: "Génération interrompue.", retry: offerRetry() });
      } else {
        const lost = e instanceof DOMException && e.name === "AbortError";
        setNotice({ kind: "error", text: lost ? "La réponse a mis trop de temps à arriver." : e instanceof Error ? e.message : "Envoi impossible.", retry: offerRetry() });
        if (id) void resync(id);
      }
    } finally {
      clearTimeout(timeout);
      controller.current = null;
      setLive(null);
      setSending(false);
      setStopping(false);
    }
  }

  /** Après une erreur : la conversation reflète ce que le serveur a réellement enregistré, sans effacer le message d'erreur. */
  async function resync(id: string) {
    try {
      const r = await api.get<{ messages: ChatMessageDto[] }>(`/api/conversations/${id}`);
      setMessages(r.messages);
    } catch {
      /* la conversation affichée reste utilisable */
    }
  }

  async function send(text: string, documents: ContextDocument[] = contextDocs) {
    const content = text.trim();
    if (!content || sending) return;
    setMessages((m) => [...m, localMessage("USER", content, `tmp-${Date.now()}`)]);
    await run({ content, documentIds: documents.map((d) => d.id) });
  }

  function regenerate() {
    setMessages((m) => {
      const lastUser = m.map((x) => x.role).lastIndexOf("USER");
      return lastUser >= 0 ? m.slice(0, lastUser + 1) : m;
    });
    void run({ content: "", regenerate: true, documentIds: contextDocs.map((d) => d.id) });
  }

  /** Réessai : la question est reposée si le serveur l'a perdue, relancée telle quelle sinon. */
  function retry(saved: string | null) {
    const last = messages[messages.length - 1];
    if (last?.role === "USER" && !last.id.startsWith("tmp-")) return regenerate();
    if (saved) {
      setMessages((m) => (m[m.length - 1]?.id.startsWith("tmp-") ? m.slice(0, -1) : m));
      void send(saved);
    }
  }

  async function stop() {
    const id = conversationOfTurn.current;
    stopRequested.current = true;
    setStopping(true);
    // Le serveur conserve le texte déjà rédigé et termine le flux normalement ; à défaut, le flux est coupé ici.
    const stopped = id ? await api.del<{ stopped: boolean }>(`/api/conversations/${id}/messages`).then((r) => r.stopped).catch(() => false) : false;
    if (!stopped) controller.current?.abort();
  }

  async function remove(id: string) {
    if (!(await confirmAction("Supprimer cette conversation ?", { confirmLabel: "Supprimer" }))) return;
    try {
      await api.del(`/api/conversations/${id}`);
      const rest = (conversations ?? []).filter((c) => c.id !== id);
      setConversations(rest);
      if (id === activeId) {
        setMessages([]);
        setActiveId(null);
        if (!page && rest[0]) await open(rest[0].id);
      }
    } catch (e) {
      setNotice({ kind: "error", text: e instanceof Error ? e.message : "Suppression impossible.", retry: null });
    }
  }

  async function rename(id: string, title: string) {
    const clean = title.trim();
    if (!clean || clean === (conversations ?? []).find((c) => c.id === id)?.title) return;
    try {
      const r = await api.patch<{ title: string }>(`/api/conversations/${id}`, { title: clean });
      setConversations((list) => (list ?? []).map((c) => (c.id === id ? { ...c, title: r.title } : c)));
    } catch (e) {
      setNotice({ kind: "error", text: e instanceof Error ? e.message : "Renommage impossible.", retry: null });
    }
  }

  function newConversation() {
    setActiveId(null);
    setMessages([]);
    setNotice(null);
    setContextDocs([]);
    setSubjectId(ALL);
    requestAnimationFrame(() => composer.current?.focus());
  }

  function pickSuggestion(s: Suggestion) {
    const documents = s.documents?.map((d) => ({ id: d.id, name: d.name })) ?? [];
    setContextDocs(documents);
    void send(s.prompt, documents);
  }

  const webHint = webAvailable ? (status?.web?.backend === "wikipedia" ? "Wikipédia uniquement : aucun moteur web complet n'est configuré." : "Sources officielles et universitaires en priorité.") : "Aucun moteur de recherche web n'est configuré.";
  const settings = (
    <label className="flex items-start gap-2.5 text-sm">
      <Switch checked={web && webAvailable} onCheckedChange={toggleWeb} disabled={!webAvailable} aria-label="Recherche web" className="mt-0.5" />
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 font-medium">
          <Globe className="h-3.5 w-3.5" aria-hidden /> Recherche web
        </span>
        <span className="block text-xs leading-snug text-muted-foreground">{webHint}</span>
      </span>
    </label>
  );

  const sidebarEl = <ChatSidebar conversations={conversations} activeId={activeId} onNew={newConversation} onOpen={(id) => void open(id)} onRename={(id, t) => void rename(id, t)} onRemove={(id) => void remove(id)} settings={settings} />;
  const empty = conversations !== null && messages.length === 0 && !sending;
  const welcome = empty && page && scope === "GLOBAL";
  const lastAssistant = messages[messages.length - 1]?.role === "ASSISTANT" ? messages[messages.length - 1].id : null;

  const composerEl = (
    <ChatComposer
      ref={composer}
      scope={scope}
      large={page}
      hero={welcome}
      disabled={aiReady === false}
      sending={sending}
      stopping={stopping}
      onSend={(t) => void send(t)}
      onStop={() => void stop()}
      subjects={subjects}
      subjectId={subjectId}
      onSubject={setSubjectId}
      subjectLocked={!!activeId}
      recent={recent}
      documents={contextDocs}
      onDocuments={setContextDocs}
    />
  );

  return (
    <div className={cn("flex h-full min-h-0", className)}>
      {page && sidebar && <div className="hidden h-full md:flex">{sidebarEl}</div>}
      {page && drawer && (
        <div className="fixed inset-0 z-50 flex md:hidden" onClick={() => setDrawer(false)} role="presentation">
          <div
            className="flex h-full bg-background"
            onClick={(e) => {
              e.stopPropagation();
              if ((e.target as HTMLElement).closest("nav li > button[aria-current], nav li > button[title], [data-close]")) setDrawer(false);
            }}
          >
            {sidebarEl}
          </div>
          <div className="flex-1 bg-black/50" />
        </div>
      )}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {page ? (
          <div className="flex h-12 shrink-0 items-center gap-1.5 px-3">
            <Button size="icon" variant="ghost" className="hidden h-8 w-8 md:inline-flex" onClick={() => setSidebar((v) => !v)} aria-label={sidebar ? "Masquer l'historique" : "Afficher l'historique"}>
              {sidebar ? <PanelLeftClose className="h-4 w-4" aria-hidden /> : <PanelLeftOpen className="h-4 w-4" aria-hidden />}
            </Button>
            <Button size="icon" variant="ghost" className="h-8 w-8 md:hidden" onClick={() => setDrawer(true)} aria-label="Ouvrir l'historique">
              <History className="h-4 w-4" aria-hidden />
            </Button>
            <p className="min-w-0 flex-1 truncate text-sm font-medium">{active?.title ?? ""}</p>
            {(!sidebar || activeId) && (
              <Button size="icon" variant="ghost" className="h-8 w-8 md:hidden" onClick={newConversation} aria-label="Nouvelle conversation">
                <MessageSquarePlus className="h-4 w-4" aria-hidden />
              </Button>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 border-b p-2">
            <Select value={activeId ?? "__new__"} onValueChange={(v) => (v === "__new__" ? newConversation() : void open(v))}>
              <SelectTrigger className="h-8 min-w-0 flex-1 text-xs" aria-label="Conversation">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__new__">Nouvelle conversation</SelectItem>
                {(conversations ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="icon" variant={web && webAvailable ? "secondary" : "ghost"} className="h-8 w-8 shrink-0" onClick={() => toggleWeb(!web)} disabled={!webAvailable} aria-pressed={web && webAvailable} aria-label="Recherche web" title={webAvailable ? (web ? "Recherche web activée" : "Recherche web désactivée") : "Recherche web indisponible"}>
              <Globe className="h-4 w-4" aria-hidden />
            </Button>
            <Button size="icon" variant="outline" className="h-8 w-8 shrink-0" onClick={newConversation} aria-label="Nouvelle conversation" title="Nouvelle conversation">
              <MessageSquarePlus className="h-4 w-4" aria-hidden />
            </Button>
            <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={() => activeId && void remove(activeId)} disabled={!activeId} aria-label="Supprimer la conversation" title="Supprimer la conversation">
              <Trash2 className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        )}

        <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto" role="log" aria-live="polite" aria-label="Conversation">
          {welcome ? (
            <ChatWelcome recent={recent} disabled={aiReady === false} composer={composerEl} onSuggestion={pickSuggestion} onQuickAction={(t) => composer.current?.prefill(t)} />
          ) : (
            <div className={cn("space-y-6 p-3", page && "mx-auto max-w-3xl px-4 pb-8 pt-2")}>
              {conversations === null && <Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" aria-label="Chargement" />}
              {empty && (
                <div className="space-y-3 pt-4 text-center">
                  <p className="text-sm text-muted-foreground">{scope === "DOCUMENT" ? "Posez une question sur ce cours." : "Posez votre question."}</p>
                  {scope === "DOCUMENT" && (
                    <div className="flex flex-col gap-1.5">
                      {DOCUMENT_STARTERS.map((s) => (
                        <button key={s} type="button" disabled={aiReady === false} onClick={() => void send(s)} className="rounded-2xl rounded-tl-md bg-muted/50 px-3 py-2 text-left text-xs transition-colors hover:bg-muted disabled:opacity-50">
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {messages.map((m) =>
                m.role === "USER" ? (
                  <UserBubble key={m.id} content={m.content} large={page} />
                ) : (
                  <AssistantMessage key={m.id} m={m} large={page} isLast={m.id === lastAssistant} busy={sending} onCitation={onCitation} onVerify={webAvailable && !sending ? verifyPoint : undefined} onRegenerate={regenerate} onFollowUp={() => composer.current?.focus()} />
                )
              )}
              <AnimatePresence initial={false}>{sending && !live?.text && <TypingBubble key="typing" status={live?.status ?? ""} slow={slow} large={page} />}</AnimatePresence>
              {sending && live?.text && <LiveMessage text={live.text} large={page} />}
              {notice && (
                <div role={notice.kind === "error" ? "alert" : "status"} className={cn("flex items-center gap-2 rounded-2xl px-3 py-2 text-xs", notice.kind === "error" ? "bg-destructive/10 text-destructive" : "bg-muted/60 text-muted-foreground")}>
                  {notice.kind === "error" && <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />}
                  <span className="min-w-0 flex-1">{notice.text}</span>
                  {notice.retry !== null && !sending && (
                    <button type="button" onClick={() => retry(notice.retry)} className="inline-flex shrink-0 items-center gap-1 font-medium underline-offset-2 hover:underline">
                      <RefreshCw className="h-3 w-3" aria-hidden /> Réessayer
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {!atBottom && !welcome && (
          <button type="button" onClick={scrollDown} aria-label="Aller à la fin de la conversation" className="absolute bottom-24 left-1/2 z-10 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full border bg-card shadow-md transition-transform hover:scale-105">
            <ArrowDown className="h-4 w-4" aria-hidden />
          </button>
        )}

        {aiReady === false && (
          <p role="alert" className={cn("mx-3 mb-2 rounded-xl border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200", page && "mx-auto w-full max-w-3xl")}>
            Le service d&apos;IA n&apos;est pas configuré (variable <code>GEMINI_API_KEY</code>) : la discussion est indisponible.
          </p>
        )}
        {!welcome && <div className={cn("shrink-0 p-2", page && "mx-auto w-full max-w-3xl px-4 pb-4 pt-1")}>{composerEl}</div>}
      </div>
    </div>
  );
}
