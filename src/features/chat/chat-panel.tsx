"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { AlertTriangle, BookOpen, Loader2, MessageSquarePlus, Send, Trash2 } from "lucide-react";
import { api } from "@/lib/client-api";
import { routes } from "@/config/routes";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ChatCitation, ChatMessageDto, ConversationDto, ConsultedInfo } from "./types";

interface Props {
  scope: "GLOBAL" | "DOCUMENT";
  /** Obligatoire pour une conversation de document. */
  documentId?: string;
  /** Appelé au clic sur une référence (ex. aller à la page du PDF ouvert). Sinon : lien vers le document. */
  onCitation?: (c: ChatCitation) => void;
  className?: string;
}

const STARTERS: Record<"GLOBAL" | "DOCUMENT", string[]> = {
  DOCUMENT: ["Résume ce cours en quelques points clés.", "Explique-moi la notion la plus difficile avec un exemple.", "Quelles sont les définitions importantes ?"],
  GLOBAL: ["Compare les notions communes à mes cours.", "Quels sujets mes documents abordent-ils ?", "Explique-moi une notion de mon cours comme à un débutant."],
};

const NEW = "__new__";

function CitationList({ citations, onCitation }: { citations: ChatCitation[]; onCitation?: Props["onCitation"] }) {
  if (!citations.length) return null;
  return (
    <ul className="mt-3 space-y-1 border-t pt-2" aria-label="Sources">
      {citations.map((c) => {
        const label = (
          <>
            <span className="mr-1.5 rounded bg-muted px-1.5 font-mono text-[11px]">{c.n}</span>
            <span className="font-medium">{c.documentName}</span>
            {c.page ? <span className="text-muted-foreground"> · p. {c.page}</span> : null}
            {c.section ? <span className="text-muted-foreground"> · {c.section}</span> : null}
            <span className="block truncate pl-7 text-[11px] italic text-muted-foreground">« {c.quote} »</span>
          </>
        );
        const cls = "block w-full rounded px-1 py-0.5 text-left text-xs hover:bg-muted";
        return (
          <li key={c.n}>
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
      })}
    </ul>
  );
}

/** Ce que l'IA a réellement consulté, et les limites de l'extraction (calculées par le serveur). */
function Consulted({ info }: { info: ConsultedInfo | null }) {
  if (!info) return null;
  const warnings = info.coverage.flatMap((c) => c.warnings.map((w) => (info.coverage.length > 1 ? `${c.documentName} : ${w}` : w)));
  return (
    <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
      <p className="flex items-center gap-1">
        <BookOpen className="h-3 w-3" aria-hidden />
        {info.passages > 0 ? `Consulté : ${info.passages} passage(s)${info.pagesRead ? `, ${info.pagesRead} page(s) lue(s)` : ""}` : "Aucun passage de cours consulté pour cette réponse"}
      </p>
      {warnings.length > 0 && (
        <p className="flex items-start gap-1 text-amber-700 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          <span>{warnings.join(" ")}</span>
        </p>
      )}
    </div>
  );
}

function Bubble({ m, onCitation }: { m: ChatMessageDto; onCitation?: Props["onCitation"] }) {
  const mine = m.role === "USER";
  return (
    <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
      <div className={cn("max-w-[92%] rounded-xl px-3 py-2 text-sm", mine ? "bg-primary text-primary-foreground" : "bg-muted/60")}>
        {mine ? (
          <p className="whitespace-pre-wrap break-words">{m.content}</p>
        ) : (
          <>
            <div className="space-y-2 break-words leading-relaxed [&_code]:rounded [&_code]:bg-background [&_code]:px-1 [&_li]:ml-5 [&_ol]:list-decimal [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-background [&_pre]:p-2 [&_ul]:list-disc">
              <ReactMarkdown skipHtml>{m.content}</ReactMarkdown>
            </div>
            <CitationList citations={m.citations ?? []} onCitation={onCitation} />
            <Consulted info={m.consulted} />
          </>
        )}
      </div>
    </div>
  );
}

export default function ChatPanel({ scope, documentId, onCitation, className }: Props) {
  const [conversations, setConversations] = useState<ConversationDto[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageDto[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiReady, setAiReady] = useState<boolean | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const listQuery = scope === "DOCUMENT" ? `scope=DOCUMENT&documentId=${documentId}` : "scope=GLOBAL";

  const open = useCallback(async (id: string) => {
    setError(null);
    try {
      const r = await api.get<{ messages: ChatMessageDto[] }>(`/api/conversations/${id}`);
      setActiveId(id);
      setMessages(r.messages);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Conversation indisponible.");
    }
  }, []);

  // Chargement initial : dernière conversation du périmètre, et état du service d'IA
  useEffect(() => {
    let cancelled = false;
    api
      .get<{ configured: boolean }>("/api/ai/status")
      .then((s) => !cancelled && setAiReady(s.configured))
      .catch(() => !cancelled && setAiReady(false));
    api
      .get<{ conversations: ConversationDto[] }>(`/api/conversations?${listQuery}`)
      .then(async (r) => {
        if (cancelled) return;
        setConversations(r.conversations);
        if (r.conversations[0]) await open(r.conversations[0].id);
      })
      .catch((e) => !cancelled && (setConversations([]), setError(e instanceof Error ? e.message : "Chargement impossible.")));
    return () => {
      cancelled = true;
    };
  }, [listQuery, open]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, sending]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || sending) return;
    setSending(true);
    setError(null);
    setInput("");
    const optimistic: ChatMessageDto = { id: `tmp-${Date.now()}`, role: "USER", content, citations: null, consulted: null, model: null, createdAt: new Date().toISOString() };
    setMessages((m) => [...m, optimistic]);
    try {
      let id = activeId;
      if (!id) {
        const c = await api.post<{ conversation: ConversationDto }>("/api/conversations", { scope, ...(documentId ? { documentId } : {}) });
        id = c.conversation.id;
        setActiveId(id);
        setConversations((list) => [c.conversation, ...(list ?? [])]);
      }
      const r = await api.post<{ message: ChatMessageDto; title: string }>(`/api/conversations/${id}/messages`, { content });
      setMessages((m) => [...m, r.message]);
      setConversations((list) => (list ?? []).map((c) => (c.id === id ? { ...c, title: r.title } : c)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Envoi impossible.");
      // le message a pu être enregistré avant l'échec : on resynchronise avec le serveur
      if (activeId) void open(activeId);
    } finally {
      setSending(false);
    }
  }

  async function remove() {
    if (!activeId || !window.confirm("Supprimer cette conversation ?")) return;
    try {
      await api.del(`/api/conversations/${activeId}`);
      const rest = (conversations ?? []).filter((c) => c.id !== activeId);
      setConversations(rest);
      setMessages([]);
      setActiveId(null);
      if (rest[0]) await open(rest[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Suppression impossible.");
    }
  }

  function newConversation() {
    setActiveId(null);
    setMessages([]);
    setError(null);
  }

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <div className="flex items-center gap-2 border-b p-2">
        <Select value={activeId ?? NEW} onValueChange={(v) => (v === NEW ? newConversation() : void open(v))}>
          <SelectTrigger className="h-8 min-w-0 flex-1 text-xs" aria-label="Conversation">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NEW}>Nouvelle conversation</SelectItem>
            {(conversations ?? []).map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="icon" variant="outline" className="h-8 w-8 shrink-0" onClick={newConversation} aria-label="Nouvelle conversation" title="Nouvelle conversation">
          <MessageSquarePlus className="h-4 w-4" aria-hidden />
        </Button>
        <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={() => void remove()} disabled={!activeId} aria-label="Supprimer la conversation" title="Supprimer la conversation">
          <Trash2 className="h-4 w-4" aria-hidden />
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3" role="log" aria-live="polite" aria-label="Conversation">
        {aiReady === false && (
          <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            Le service d&apos;IA n&apos;est pas configuré (variable <code>GEMINI_API_KEY</code>) : le chat est indisponible.
          </p>
        )}
        {conversations === null && <Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" aria-label="Chargement" />}
        {conversations !== null && messages.length === 0 && (
          <div className="space-y-2 pt-4 text-center">
            <p className="text-sm text-muted-foreground">{scope === "DOCUMENT" ? "Posez une question sur ce cours." : "Posez une question sur vos cours ou une notion."}</p>
            <div className="flex flex-col gap-1.5">
              {STARTERS[scope].map((s) => (
                <button key={s} type="button" disabled={sending || aiReady === false} onClick={() => void send(s)} className="rounded-lg border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => (
          <Bubble key={m.id} m={m} onCitation={onCitation} />
        ))}
        {sending && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> L&apos;assistant consulte le cours…
          </div>
        )}
        {error && (
          <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
            {error}
          </p>
        )}
        <div ref={endRef} />
      </div>

      <form
        className="flex items-end gap-2 border-t p-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
          rows={2}
          maxLength={6000}
          placeholder={scope === "DOCUMENT" ? "Votre question sur ce cours…" : "Votre question…"}
          className="min-h-0 resize-none text-sm"
          aria-label="Message"
          disabled={aiReady === false}
        />
        <Button type="submit" size="icon" className="h-9 w-9 shrink-0" disabled={sending || !input.trim() || aiReady === false} aria-label="Envoyer">
          {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
        </Button>
      </form>
    </div>
  );
}
