"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Copy, History, Loader2, Maximize2, Minimize2, MessageSquare, Plus, Send, Sparkles, Square, Trash2, X } from "lucide-react";
import { api, ApiError, postStream } from "@/lib/client-api";
import { confirmAction } from "@/components/notifications";
import { useConversations, type Conversation } from "@/features/admin/assistant-history";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Assistant IA du back-office : panneau flottant présent sur toutes les rubriques.
// L'IA lit les données autorisées pour le rôle connecté et peut PROPOSER des actions ; chaque action s'affiche dans une
// carte et n'est exécutée qu'après un clic sur « Confirmer ». Les conversations sont historisées (voir assistant-history.ts).
// ─────────────────────────────────────────────────────────────────────────────

const ChatMarkdown = dynamic(() => import("@/features/chat/chat-markdown").then((m) => m.ChatMarkdown), {
  ssr: false,
  loading: () => <p className="text-sm text-muted-foreground">…</p>,
});

interface Proposal {
  token: string;
  action: string;
  title: string;
  lines: string[];
  danger?: boolean;
  typeToConfirm?: string;
}

interface ProposalState extends Proposal {
  state: "pending" | "running" | "done" | "cancelled" | "error";
  result?: string;
  link?: string;
  error?: string;
}

interface Message {
  id: string;
  role: "user" | "assistant" | "event";
  content: string;
  proposals?: ProposalState[];
}

const SUGGESTIONS = [
  "Résume l'activité des 7 derniers jours et ce qui a changé.",
  "Quelles demandes ouvertes sont urgentes ou en retard ?",
  "Y a-t-il des alertes ou des problèmes techniques en cours ?",
  "Quels comptes sont inactifs depuis plus de 30 jours ?",
  "Liste les anomalies à résoudre par ordre de priorité et écris un prompt pour chacune.",
];

export const ASSISTANT_PAGE = "/admin/assistant";

const uid = () => Math.random().toString(36).slice(2, 10);

/** Assistant en pleine page (rubrique dédiée) : même conversation que le panneau flottant, avec toute la place pour lire. */
export function AssistantPage({ adminId }: { adminId: string }) {
  return <AssistantPanel variant="page" adminId={adminId} />;
}

export function AdminAssistant({ adminId }: { adminId: string }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  // L'assistant a sa propre page : le bouton flottant n'y est pas nécessaire.
  if (pathname === ASSISTANT_PAGE) return null;
  return (
    <>
      <button
        type="button"
        data-tour="admin-assistant"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={open ? "Fermer l'assistant IA" : "Ouvrir l'assistant IA"}
        className={cn("fixed bottom-5 right-5 z-40 flex h-12 items-center gap-2 rounded-full bg-[#1c1530] px-4 text-sm font-medium text-white shadow-lg transition hover:bg-[#2a2045] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--niala-accent)]", open && "max-sm:hidden")}
      >
        {open ? <X className="h-4 w-4" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}
        <span className="hidden sm:inline">Assistant IA</span>
      </button>
      {open && <AssistantPanel variant="panel" adminId={adminId} onClose={() => setOpen(false)} />}
    </>
  );
}

function AssistantPanel({ onClose, variant, adminId }: { onClose?: () => void; variant: "panel" | "page"; adminId: string }) {
  const page = variant === "page";
  const pathname = usePathname();
  const router = useRouter();
  // Le panneau n'est monté qu'après un clic : l'historique est relu tout de suite. En pleine page, le composant est rendu côté
  // serveur : l'historique n'est relu qu'après l'hydratation.
  const conv = useConversations<Message>(adminId, !page);
  const { messages } = conv;
  const [showHistory, setShowHistory] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, draft, status]);
  useEffect(() => {
    if (page || !onClose) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, page]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const send = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || busy) return;
      const userMsg: Message = { id: uid(), role: "user", content };
      const history = [...messages, userMsg];
      // La conversation de départ est retenue : une réponse tardive reste dans SA conversation, même si l'on en ouvre une autre.
      const convId = conv.ensureActive();
      conv.update(convId, () => history);
      setInput("");
      setError(null);
      setBusy(true);
      setStatus("Réflexion…");
      setDraft("");
      const proposals: ProposalState[] = [];
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const reply = await postStream<{ text: string; proposals: Proposal[] }>(
          "/api/admin/assistant",
          { messages: history.filter((m) => m.content.trim()).slice(-30).map((m) => ({ role: m.role, content: m.content.slice(0, 8000) })), page: pathname },
          {
            status: (s) => {
              setStatus(s);
              setDraft("");
            },
            delta: (d) => {
              setStatus(null);
              setDraft((t) => t + d);
            },
            other: (e) => {
              if (e.type === "proposal") proposals.push({ ...(e.proposal as Proposal), state: "pending" });
            },
          },
          controller.signal
        );
        const finalProposals = reply.proposals?.length ? reply.proposals.map((p) => ({ ...p, state: "pending" as const })) : proposals;
        conv.update(convId, (m) => [...m, { id: uid(), role: "assistant", content: reply.text || (finalProposals.length ? "Voici ma proposition : confirmez-la ou annulez-la ci-dessous." : ""), proposals: finalProposals }]);
      } catch (e) {
        if (controller.signal.aborted) conv.update(convId, (m) => [...m, { id: uid(), role: "event", content: "Réponse interrompue par l'administrateur." }]);
        else setError(e instanceof ApiError ? e.message : "L'assistant n'a pas pu répondre.");
      } finally {
        setBusy(false);
        setStatus(null);
        setDraft("");
        abortRef.current = null;
      }
    },
    [busy, messages, pathname, conv.ensureActive, conv.update]
  );

  const setMessages = (fn: (m: Message[]) => Message[]) => conv.update(conv.ensureActive(), fn);

  const updateProposal = (msgId: string, token: string, patch: Partial<ProposalState>) =>
    setMessages((list) => list.map((m) => (m.id === msgId ? { ...m, proposals: m.proposals?.map((p) => (p.token === token ? { ...p, ...patch } : p)) } : m)));

  // Le compte rendu envoyé ensuite à l'IA ne reprend pas le titre de la carte, qui contient de vraies identités.
  const report = (content: string) => setMessages((list) => [...list, { id: uid(), role: "event", content }]);

  const confirm = async (msgId: string, p: ProposalState, typed?: string) => {
    updateProposal(msgId, p.token, { state: "running", error: undefined });
    try {
      const r = await api.post<{ message: string; link?: string }>("/api/admin/assistant/confirm", { token: p.token, typed });
      updateProposal(msgId, p.token, { state: "done", result: r.message, link: r.link });
      report(`Action « ${p.action} » confirmée et exécutée : ${r.message}`);
      router.refresh();
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "L'action a échoué.";
      updateProposal(msgId, p.token, { state: "error", error: message });
      report(`Action « ${p.action} » en échec : ${message}`);
    }
  };

  const cancel = (msgId: string, p: ProposalState) => {
    updateProposal(msgId, p.token, { state: "cancelled" });
    report(`Action « ${p.action} » annulée par l'administrateur.`);
  };

  // Changer de conversation interrompt la réponse en cours (elle est notée comme interrompue dans sa conversation d'origine).
  const leave = () => {
    abortRef.current?.abort();
    setError(null);
    setInput("");
  };
  const startNew = () => {
    leave();
    conv.startNew();
    setShowHistory(false);
    inputRef.current?.focus();
  };
  const open = (id: string) => {
    if (id !== conv.activeId) leave();
    conv.select(id);
    setShowHistory(false);
  };
  const removeConversation = async (c: Conversation<Message>) => {
    if (!(await confirmAction(`Supprimer la conversation « ${c.title} » ? Elle ne pourra pas être récupérée.`, { title: "Supprimer la conversation", confirmLabel: "Supprimer", danger: true }))) return;
    if (c.id === conv.activeId) leave();
    conv.remove(c.id);
  };

  return (
    <section role={page ? "region" : "dialog"} aria-label="Assistant IA du back-office" className={page ? "flex h-[calc(100dvh-8.5rem)] min-h-[460px] w-full flex-col overflow-hidden rounded-2xl border bg-card shadow-sm" : "fixed inset-0 z-50 flex flex-col bg-background shadow-2xl sm:inset-auto sm:bottom-20 sm:right-5 sm:h-[min(720px,calc(100dvh-7rem))] sm:w-[440px] sm:rounded-2xl sm:border"}>
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <Sparkles className="h-4 w-4 text-[var(--niala-accent)]" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Assistant IA</h2>
          <p className="truncate text-[11px] text-muted-foreground">Lit les données de votre rôle · agit seulement après votre confirmation</p>
        </div>
        <button type="button" onClick={startNew} className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium hover:bg-muted" aria-label="Nouvelle conversation" title="Nouvelle conversation">
          <Plus className="h-4 w-4" aria-hidden /><span className={page ? "inline" : "hidden sm:inline"}>Nouvelle conversation</span>
        </button>
        <button type="button" onClick={() => setShowHistory((v) => !v)} aria-pressed={showHistory} className={cn("rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground", page && "md:hidden", showHistory && "bg-muted text-foreground")} aria-label="Historique des conversations" title="Historique des conversations">
          <History className="h-4 w-4" aria-hidden />
        </button>
        {page ? (
          <Link href="/admin" className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Réduire l'assistant en panneau" title="Réduire en panneau">
            <Minimize2 className="h-4 w-4" aria-hidden />
          </Link>
        ) : (
          <>
            <Link href={ASSISTANT_PAGE} onClick={onClose} prefetch className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Ouvrir l'assistant en pleine page" title="Pleine page">
              <Maximize2 className="h-4 w-4" aria-hidden />
            </Link>
            <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Fermer l'assistant">
              <X className="h-4 w-4" />
            </button>
          </>
        )}
      </header>

      <div className="flex min-h-0 flex-1">
        {page && (
          <aside aria-label="Historique des conversations" className="hidden w-64 shrink-0 flex-col border-r md:flex">
            <HistoryList items={conv.items} activeId={conv.activeId} onOpen={open} onRemove={(c) => void removeConversation(c)} />
          </aside>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
      {showHistory && (
        <div className={cn("min-h-0 flex-1 overflow-y-auto", page && "md:hidden")}>
          <HistoryList items={conv.items} activeId={conv.activeId} onOpen={open} onRemove={(c) => void removeConversation(c)} />
        </div>
      )}
      <div className={cn("flex min-h-0 flex-1 flex-col", showHistory && (page ? "max-md:hidden" : "hidden"))}>
      <div className="min-h-0 flex-1 overflow-y-auto" aria-live="polite">
      <div className={cn("space-y-3 px-4 py-4", page && "mx-auto w-full max-w-3xl")}>
        {messages.length === 0 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Posez une question sur la plateforme ou demandez une action. Les noms et adresses des étudiants sont masqués avant d'être transmis à l'IA.</p>
            <div className="flex flex-col gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => void send(s)} className="rounded-xl border px-3 py-2 text-left text-sm hover:bg-muted">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="ml-8 whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-[#1c1530] px-3 py-2 text-sm text-white">{m.content}</div>
          ) : m.role === "event" ? (
            <p key={m.id} className="text-center text-[11px] text-muted-foreground">{m.content}</p>
          ) : (
            <div key={m.id} className="space-y-2">
              {m.content && <div className="min-w-0 break-words text-sm"><ChatMarkdown text={m.content} /></div>}
              {m.proposals?.map((p) => <ProposalCard key={p.token} p={p} onConfirm={(typed) => void confirm(m.id, p, typed)} onCancel={() => cancel(m.id, p)} />)}
            </div>
          )
        )}

        {busy && (
          <div className="space-y-1">
            {status && <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />{status}</p>}
            {draft && <div className="min-w-0 break-words text-sm"><ChatMarkdown text={draft} /></div>}
          </div>
        )}
        {error && <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        <div ref={endRef} />
      </div>
      </div>

      <form
        className="border-t p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <div className={cn("flex items-end gap-2", page && "mx-auto w-full max-w-3xl")}>
        <label htmlFor="admin-assistant-input" className="sr-only">Message à l'assistant</label>
        <textarea
          id="admin-assistant-input"
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
          rows={1}
          maxLength={8000}
          placeholder="Ex. : suspends le compte qui a envoyé 10 demandes aujourd'hui"
          className="max-h-32 min-h-10 flex-1 resize-none rounded-xl border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--niala-accent)]/40"
        />
        {busy ? (
          <button type="button" onClick={() => abortRef.current?.abort()} className="flex h-10 w-10 items-center justify-center rounded-xl border hover:bg-muted" aria-label="Arrêter la réponse">
            <Square className="h-4 w-4" />
          </button>
        ) : (
          <button type="submit" disabled={!input.trim()} className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1c1530] text-white disabled:opacity-40" aria-label="Envoyer">
            <Send className="h-4 w-4" />
          </button>
        )}
        </div>
      </form>
      </div>
        </div>
      </div>
    </section>
  );
}

const dateLabel = (t: number) => new Date(t).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function HistoryList({ items, activeId, onOpen, onRemove }: { items: Conversation<Message>[]; activeId: string; onOpen: (id: string) => void; onRemove: (c: Conversation<Message>) => void }) {
  if (!items.length) return <p className="px-4 py-6 text-center text-xs text-muted-foreground">Aucune conversation pour l'instant. Posez une première question : elle sera enregistrée ici.</p>;
  return (
    <ul className="space-y-0.5 overflow-y-auto p-2">
      {items.map((c) => (
        <li key={c.id} className={cn("group flex items-center gap-1 rounded-lg", c.id === activeId ? "bg-muted" : "hover:bg-muted/60")}>
          <button type="button" onClick={() => onOpen(c.id)} aria-current={c.id === activeId ? "true" : undefined} className="flex min-w-0 flex-1 items-start gap-2 px-2.5 py-2 text-left">
            <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{c.title}</span>
              <span className="block text-[11px] text-muted-foreground">{c.messages.length ? dateLabel(c.updatedAt) : "Vide"}</span>
            </span>
          </button>
          {c.messages.length > 0 && (
            <button type="button" onClick={() => onRemove(c)} aria-label={`Supprimer la conversation ${c.title}`} title="Supprimer" className="mr-1 rounded-md p-1.5 text-muted-foreground opacity-60 hover:bg-background hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100">
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function ProposalCard({ p, onConfirm, onCancel }: { p: ProposalState; onConfirm: (typed?: string) => void; onCancel: () => void }) {
  const [typed, setTyped] = useState("");
  const [copied, setCopied] = useState(false);
  const needsTyping = !!p.typeToConfirm;
  const typedOk = !needsTyping || typed.trim().toLowerCase() === p.typeToConfirm!.toLowerCase();
  const active = p.state === "pending" || p.state === "error";

  return (
    <div className={cn("rounded-xl border p-3 text-sm", p.danger ? "border-destructive/40 bg-destructive/5" : "bg-muted/40")}>
      <p className="flex items-start gap-2 font-medium">
        {p.danger && <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />}
        <span>{p.title}</span>
      </p>
      {p.lines.length > 0 && (
        <ul className="mt-1.5 space-y-1 text-xs text-muted-foreground">
          {p.lines.map((l, i) => <li key={i} className="whitespace-pre-wrap break-words">{l}</li>)}
        </ul>
      )}

      {active && needsTyping && (
        <div className="mt-2">
          <label className="text-xs" htmlFor={`confirm-${p.token.slice(-12)}`}>Recopiez <strong className="break-all">{p.typeToConfirm}</strong> pour confirmer :</label>
          <input id={`confirm-${p.token.slice(-12)}`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" className="mt-1 h-8 w-full rounded-lg border bg-background px-2 text-sm" />
        </div>
      )}
      {p.state === "error" && p.error && <p role="alert" className="mt-2 text-xs text-destructive">{p.error}</p>}

      {active && (
        <div className="mt-3 flex gap-2">
          <button type="button" disabled={!typedOk} onClick={() => onConfirm(needsTyping ? typed.trim() : undefined)} className={cn("h-8 rounded-lg px-3 text-xs font-medium text-white disabled:opacity-40", p.danger ? "bg-destructive" : "bg-[#1c1530]")}>
            Confirmer
          </button>
          <button type="button" onClick={onCancel} className="h-8 rounded-lg border px-3 text-xs font-medium hover:bg-muted">
            Annuler
          </button>
        </div>
      )}
      {p.state === "running" && <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />Exécution…</p>}
      {p.state === "cancelled" && <p className="mt-2 text-xs text-muted-foreground">Annulée.</p>}
      {p.state === "done" && (
        <div className="mt-2 space-y-1.5">
          <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400"><Check className="h-3.5 w-3.5" aria-hidden />{p.result}</p>
          {p.link && (
            <div className="flex items-center gap-2">
              <input readOnly value={p.link} aria-label="Lien à transmettre" className="h-8 min-w-0 flex-1 rounded-lg border bg-background px-2 text-xs" onFocus={(e) => e.currentTarget.select()} />
              <button type="button" className="flex h-8 items-center gap-1 rounded-lg border px-2 text-xs hover:bg-muted" onClick={() => void navigator.clipboard?.writeText(p.link!).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}>
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}Copier
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
