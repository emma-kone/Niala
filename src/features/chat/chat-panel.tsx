"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { AlertTriangle, BookOpen, ExternalLink, FileText, Globe, ImageIcon, Library, Loader2, MessageSquarePlus, PanelLeftClose, PanelLeftOpen, Paperclip, Pencil, Send, Trash2, X } from "lucide-react";
import { api, ApiError } from "@/lib/client-api";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { routes } from "@/config/routes";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ChatAttachmentDto, ChatCitation, ChatMessageDto, ConsultedInfo, ConversationDto } from "./types";

const MAX_ATTACHMENTS = 4;
const ACCEPT = ".pdf,.docx,.pptx,.txt,.md,.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp";
const IMAGE_RE = /\.(png|jpe?g|webp)$/i;

interface LibraryDoc {
  id: string;
  name: string;
  subject: string | null;
}

/** Envoie un message et lit la réponse en flux : statut des outils, texte au fil de la rédaction, puis message final. */
async function postMessageStream(
  url: string,
  body: FormData | { content: string; web: boolean },
  on: { status: (t: string) => void; delta: (t: string) => void }
): Promise<{ message: ChatMessageDto; title: string }> {
  const isForm = body instanceof FormData;
  const res = await fetch(url, {
    method: "POST",
    headers: { Accept: "application/x-ndjson", ...(isForm ? {} : { "Content-Type": "application/json" }) },
    body: isForm ? body : JSON.stringify(body),
    credentials: "same-origin",
  });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => null);
    throw new ApiError((data as { error?: string } | null)?.error ?? `Erreur ${res.status}`, res.status);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let done: { message: ChatMessageDto; title: string } | null = null;
  const handleLine = (line: string) => {
    if (!line.trim()) return;
    const ev = JSON.parse(line) as { type: string; text?: string; error?: string; status?: number; message?: ChatMessageDto; title?: string };
    if (ev.type === "status") on.status(ev.text ?? "");
    else if (ev.type === "delta") on.delta(ev.text ?? "");
    else if (ev.type === "error") throw new ApiError(ev.error ?? "Envoi impossible.", ev.status ?? 500);
    else if (ev.type === "done" && ev.message) done = { message: ev.message, title: ev.title ?? "" };
  };
  for (;;) {
    const { done: end, value } = await reader.read();
    if (end) break;
    buffer += decoder.decode(value, { stream: true });
    let i: number;
    while ((i = buffer.indexOf("\n")) >= 0) {
      handleLine(buffer.slice(0, i));
      buffer = buffer.slice(i + 1);
    }
  }
  handleLine(buffer);
  if (!done) throw new ApiError("La réponse a été interrompue. Votre message est conservé : réessayez.", 502);
  return done;
}

function AttachmentChip({ a, onRemove }: { a: { kind: ChatAttachmentDto["kind"] | "pending"; name: string }; onRemove?: () => void }) {
  const Icon = a.kind === "image" || (a.kind === "pending" && IMAGE_RE.test(a.name)) ? ImageIcon : a.kind === "library" ? Library : FileText;
  return (
    <span className="inline-flex max-w-[14rem] items-center gap-1 rounded-md border bg-background/70 px-2 py-0.5 text-xs text-foreground">
      <Icon className="h-3 w-3 shrink-0" aria-hidden />
      <span className="truncate" title={a.name}>{a.name}</span>
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={`Retirer ${a.name}`} className="shrink-0 text-muted-foreground hover:text-foreground">
          <X className="h-3 w-3" aria-hidden />
        </button>
      )}
    </span>
  );
}

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
  web?: { available: boolean; backend: "tavily" | "gemini" | null };
}

const STARTERS: Record<"GLOBAL" | "DOCUMENT", string[]> = {
  DOCUMENT: ["Résume ce cours en quelques points clés.", "Explique-moi la notion la plus difficile avec un exemple.", "Quelles sont les définitions importantes ?"],
  GLOBAL: ["Explique-moi une notion comme à un débutant.", "Compare les notions communes à mes cours.", "Quels sujets mes documents abordent-ils ?"],
};

const WEB_KEY = "niala-chat-web";
const ALL = "__all__";

function CitationList({ citations, onCitation }: { citations: ChatCitation[]; onCitation?: Props["onCitation"] }) {
  if (!citations.length) return null;
  return (
    <ul className="mt-3 space-y-1 border-t pt-2" aria-label="Sources">
      {citations.map((c) => {
        const cls = "block w-full rounded px-1 py-0.5 text-left text-xs hover:bg-muted";
        const num = <span className="mr-1.5 rounded bg-muted px-1.5 font-mono text-[11px]">{c.n}</span>;
        if (c.kind === "web" && c.url) {
          return (
            <li key={c.n}>
              <a className={cls} href={c.url} target="_blank" rel="noopener noreferrer">
                {num}
                <span className="font-medium">{c.documentName}</span>
                <ExternalLink className="ml-1 inline h-3 w-3 text-muted-foreground" aria-hidden />
                <span
                  className={cn(
                    "ml-2 rounded-full border px-1.5 py-px text-[10px]",
                    c.tier === "reconnue" ? "border-emerald-500/50 text-emerald-600 dark:text-emerald-400" : "border-amber-500/50 text-amber-700 dark:text-amber-300"
                  )}
                >
                  {c.tier === "reconnue" ? "source reconnue" : "source à vérifier"}
                </span>
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

/** Ce que l'IA a consulté. N'affiche rien quand aucune source n'a été utilisée (question libre), et ne signale que les limites utiles. */
function Consulted({ info }: { info: ConsultedInfo | null }) {
  if (!info) return null;
  const used = new Set(info.documents.map((d) => d.id));
  const consulted = info.coverage.filter((c) => used.has(c.documentId));
  const warnings = consulted.flatMap((c) => c.warnings.map((w) => (consulted.length > 1 ? `${c.documentName} : ${w}` : w)));
  const parts = [info.passages > 0 ? `${info.passages} passage(s) de cours${info.pagesRead ? `, ${info.pagesRead} page(s) lue(s)` : ""}` : null, info.webSources ? `${info.webSources} source(s) web` : null].filter(Boolean);
  if (!parts.length && !warnings.length) return null;
  return (
    <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
      {parts.length > 0 && (
        <p className="flex items-center gap-1">
          <BookOpen className="h-3 w-3" aria-hidden /> Consulté : {parts.join(" · ")}
        </p>
      )}
      {warnings.length > 0 && (
        <p className="flex items-start gap-1 text-amber-700 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          <span>{warnings.join(" ")}</span>
        </p>
      )}
    </div>
  );
}

function Bubble({ m, onCitation, large }: { m: ChatMessageDto; onCitation?: Props["onCitation"]; large: boolean }) {
  const mine = m.role === "USER";
  return (
    <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
      <div className={cn("rounded-xl px-4 py-2.5", large ? "max-w-[85%] text-[15px]" : "max-w-[92%] text-sm", mine ? "bg-primary text-primary-foreground" : "bg-muted/60")}>
        {mine ? (
          <>
            {!!m.attachments?.length && (
              <div className="mb-1.5 flex flex-wrap gap-1 text-foreground">
                {m.attachments.map((a, i) => (
                  <AttachmentChip key={i} a={a} />
                ))}
              </div>
            )}
            <p className="whitespace-pre-wrap break-words">{m.content}</p>
          </>
        ) : (
          <>
            <div className="space-y-2 break-words leading-relaxed [&_a]:underline [&_code]:rounded [&_code]:bg-background [&_code]:px-1 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_li]:ml-5 [&_ol]:list-decimal [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-background [&_pre]:p-2 [&_ul]:list-disc">
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

export default function ChatPanel({ scope, documentId, onCitation, variant = "panel", className }: Props) {
  const page = variant === "page";
  const [conversations, setConversations] = useState<ConversationDto[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageDto[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [web, setWeb] = useState(true);
  const [subjects, setSubjects] = useState<{ id: string; name: string }[]>([]);
  const [subjectId, setSubjectId] = useState<string>(ALL);
  const [sidebar, setSidebar] = useState(true);
  const [drawer, setDrawer] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [libDocs, setLibDocs] = useState<{ id: string; name: string }[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [library, setLibrary] = useState<LibraryDoc[] | null>(null);
  const [live, setLive] = useState<{ status: string; text: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const attachCount = files.length + libDocs.length;
  const listQuery = scope === "DOCUMENT" ? `scope=DOCUMENT&documentId=${documentId}` : "scope=GLOBAL";
  const aiReady = status ? status.configured && status.chat !== false : null;
  const webAvailable = !!status?.web?.available;

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
    if (scope === "GLOBAL") api.get<{ subjects: { id: string; name: string }[] }>("/api/subjects").then((r) => !cancelled && setSubjects(r.subjects)).catch(() => undefined);
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
  }, [listQuery, open, scope]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, sending, live?.text, live?.status]);

  function addFiles(list: File[]) {
    if (!list.length) return;
    const ok = list.filter((f) => /\.(pdf|docx|pptx|txt|md|png|jpe?g|webp)$/i.test(f.name));
    const room = MAX_ATTACHMENTS - attachCount;
    const problems: string[] = [];
    if (ok.length < list.length) problems.push("Format non pris en charge (PDF, Word, PowerPoint, texte, Markdown, PNG, JPEG, WebP).");
    if (ok.length > room) problems.push(`${MAX_ATTACHMENTS} pièces jointes au maximum par message.`);
    const tooBig = ok.find((f) => f.size > (IMAGE_RE.test(f.name) ? 5 : 10) * 1024 * 1024);
    if (tooBig) problems.push(`« ${tooBig.name} » est trop volumineux (${IMAGE_RE.test(tooBig.name) ? "5" : "10"} Mo maximum).`);
    setError(problems.length ? problems.join(" ") : null);
    setFiles((cur) => [...cur, ...ok.filter((f) => f.size <= (IMAGE_RE.test(f.name) ? 5 : 10) * 1024 * 1024).slice(0, Math.max(0, room))]);
  }

  async function openPicker() {
    setPickerOpen(true);
    if (library) return;
    try {
      setLibrary((await api.get<{ documents: LibraryDoc[] }>("/api/chat/documents")).documents);
    } catch (e) {
      setLibrary([]);
      setError(e instanceof Error ? e.message : "Bibliothèque indisponible.");
    }
  }

  function toggleLibDoc(d: LibraryDoc) {
    setLibDocs((cur) => (cur.some((x) => x.id === d.id) ? cur.filter((x) => x.id !== d.id) : attachCount >= MAX_ATTACHMENTS ? cur : [...cur, { id: d.id, name: d.name }]));
  }

  function toggleWeb(on: boolean) {
    setWeb(on);
    try {
      localStorage.setItem(WEB_KEY, on ? "1" : "0");
    } catch {
      /* ignoré */
    }
  }

  async function send(text: string) {
    const typed = text.trim();
    if ((!typed && !attachCount) || sending) return;
    // Message vide avec pièce jointe : une consigne par défaut
    const content = typed || "Analyse la pièce jointe et explique-m'en le contenu.";
    const sentFiles = files;
    const sentDocs = libDocs;
    const tmpId = `tmp-${Date.now()}`;
    setSending(true);
    setError(null);
    setInput("");
    setFiles([]);
    setLibDocs([]);
    setLive({ status: "", text: "" });
    const shown: ChatAttachmentDto[] = [...sentDocs.map((d): ChatAttachmentDto => ({ kind: "library", name: d.name, documentId: d.id })), ...sentFiles.map((f): ChatAttachmentDto => ({ kind: IMAGE_RE.test(f.name) ? "image" : "file", name: f.name }))];
    setMessages((m) => [...m, { id: tmpId, role: "USER", content, attachments: shown, citations: null, consulted: null, model: null, createdAt: new Date().toISOString() }]);
    try {
      let id = activeId;
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
      const useWeb = web && webAvailable;
      let body: FormData | { content: string; web: boolean };
      if (sentFiles.length || sentDocs.length) {
        body = new FormData();
        body.set("content", content);
        body.set("web", useWeb ? "1" : "0");
        body.set("libraryDocumentIds", JSON.stringify(sentDocs.map((d) => d.id)));
        for (const f of sentFiles) body.append("files", f, f.name);
      } else body = { content, web: useWeb };
      const r = await postMessageStream(`/api/conversations/${id}/messages`, body, {
        // Un nouveau statut (recherche, lecture…) annonce une étape : le texte provisoire éventuel est écarté
        status: (t) => setLive({ status: t, text: "" }),
        delta: (t) => setLive((l) => ({ status: l?.status ?? "", text: (l?.text ?? "") + t })),
      });
      setMessages((m) => [...m, r.message]);
      setConversations((list) => (list ?? []).map((c) => (c.id === id ? { ...c, title: r.title } : c)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Envoi impossible.");
      // Refus avant enregistrement (fichier invalide, limite…) : le brouillon est restitué tel quel
      if (e instanceof ApiError && [404, 413, 415, 422, 429].includes(e.status)) {
        setMessages((m) => m.filter((x) => x.id !== tmpId));
        setInput(typed);
        setFiles(sentFiles);
        setLibDocs(sentDocs);
      } else if (activeId) void open(activeId);
    } finally {
      setLive(null);
      setSending(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Supprimer cette conversation ?")) return;
    try {
      await api.del(`/api/conversations/${id}`);
      const rest = (conversations ?? []).filter((c) => c.id !== id);
      setConversations(rest);
      if (id === activeId) {
        setMessages([]);
        setActiveId(null);
        if (rest[0]) await open(rest[0].id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Suppression impossible.");
    }
  }

  async function rename(id: string, title: string) {
    setRenaming(null);
    const clean = title.trim();
    if (!clean) return;
    try {
      const r = await api.patch<{ title: string }>(`/api/conversations/${id}`, { title: clean });
      setConversations((list) => (list ?? []).map((c) => (c.id === id ? { ...c, title: r.title } : c)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Renommage impossible.");
    }
  }

  function newConversation() {
    setActiveId(null);
    setMessages([]);
    setError(null);
  }

  const webSwitch = (
    <label className="flex items-start gap-3 text-sm">
      <Switch checked={web && webAvailable} onCheckedChange={toggleWeb} disabled={!webAvailable} aria-label="Recherche web" />
      <span>
        <span className="flex items-center gap-1.5 font-medium">
          <Globe className="h-3.5 w-3.5" aria-hidden /> Recherche web
        </span>
        <span className="block text-xs text-muted-foreground">
          {webAvailable ? "Sources officielles et universitaires en priorité ; chaque source est classée." : "Indisponible : aucun moteur de recherche web n'est configuré pour ce site."}
        </span>
      </span>
    </label>
  );

  const sidebarEl = (
    <aside className="flex w-64 shrink-0 flex-col border-r bg-muted/20" aria-label="Historique et réglages">
      <div className="p-3">
        <Button className="w-full gap-2" onClick={newConversation} data-close>
          <MessageSquarePlus className="h-4 w-4" aria-hidden /> Nouvelle conversation
        </Button>
      </div>
      <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2" aria-label="Historique">
        <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Historique</p>
        {conversations === null && <Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" aria-label="Chargement" />}
        {conversations?.length === 0 && <p className="px-2 text-xs text-muted-foreground">Aucune conversation pour l&apos;instant.</p>}
        {(conversations ?? []).map((c) => (
          <div key={c.id} className={cn("group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm", c.id === activeId ? "bg-muted font-medium" : "hover:bg-muted/60")}>
            {renaming === c.id ? (
              <input
                autoFocus
                defaultValue={c.title}
                maxLength={100}
                aria-label="Nouveau titre"
                className="min-w-0 flex-1 rounded border bg-background px-1 text-sm"
                onBlur={(e) => void rename(c.id, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void rename(c.id, e.currentTarget.value);
                  if (e.key === "Escape") setRenaming(null);
                }}
              />
            ) : (
              <button type="button" className="min-w-0 flex-1 truncate text-left" onClick={() => void open(c.id)} title={c.title}>
                {c.title}
              </button>
            )}
            <button type="button" className="opacity-0 focus:opacity-100 group-hover:opacity-100" onClick={() => setRenaming(c.id)} aria-label={`Renommer ${c.title}`}>
              <Pencil className="h-3.5 w-3.5" aria-hidden />
            </button>
            <button type="button" className="opacity-0 focus:opacity-100 group-hover:opacity-100" onClick={() => void remove(c.id)} aria-label={`Supprimer ${c.title}`}>
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        ))}
      </nav>
      <div className="space-y-3 border-t p-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Réglages</p>
        {webSwitch}
        {scope === "GLOBAL" && subjects.length > 0 && (
          <div className="space-y-1">
            <span className="text-xs font-medium">Cours consultés (nouvelle conversation)</span>
            <Select value={subjectId} onValueChange={setSubjectId} disabled={!!activeId}>
              <SelectTrigger className="h-8 text-xs" aria-label="Matière consultée">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Toutes mes matières</SelectItem>
                {subjects.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {activeId && <span className="block text-[11px] text-muted-foreground">Fixé à la création de la conversation.</span>}
          </div>
        )}
      </div>
    </aside>
  );

  return (
    <div className={cn("flex h-full min-h-0", className)}>
      {page && sidebar && <div className="hidden md:flex">{sidebarEl}</div>}
      {page && drawer && (
        <div className="fixed inset-0 z-50 flex md:hidden" onClick={() => setDrawer(false)} role="presentation">
          <div className="flex bg-background" onClick={(e) => { e.stopPropagation(); if ((e.target as HTMLElement).closest("nav button, [data-close]")) setDrawer(false); }}>
            {sidebarEl}
          </div>
          <div className="flex-1 bg-black/50" />
        </div>
      )}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {page ? (
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <Button size="icon" variant="ghost" className="hidden h-8 w-8 md:inline-flex" onClick={() => setSidebar((v) => !v)} aria-label={sidebar ? "Masquer l'historique" : "Afficher l'historique"}>
              {sidebar ? <PanelLeftClose className="h-4 w-4" aria-hidden /> : <PanelLeftOpen className="h-4 w-4" aria-hidden />}
            </Button>
            <p className="min-w-0 flex-1 truncate text-sm font-medium">{(conversations ?? []).find((c) => c.id === activeId)?.title ?? "Nouvelle conversation"}</p>
            <Button size="sm" variant="outline" className="md:hidden" onClick={() => setDrawer(true)}>
              Historique
            </Button>
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

        <div className="min-h-0 flex-1 overflow-y-auto" role="log" aria-live="polite" aria-label="Conversation">
          <div className={cn("space-y-4 p-3", page && "mx-auto max-w-3xl px-4 py-6")}>
            {aiReady === false && (
              <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                Le service d&apos;IA n&apos;est pas configuré (variable <code>GEMINI_API_KEY</code>) : le chat est indisponible.
              </p>
            )}
            {conversations === null && <Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" aria-label="Chargement" />}
            {conversations !== null && messages.length === 0 && (
              <div className={cn("space-y-3 text-center", page ? "pt-16" : "pt-4")}>
                <p className={cn("text-muted-foreground", page ? "text-base" : "text-sm")}>
                  {scope === "DOCUMENT" ? "Posez une question sur ce cours." : "Posez une question sur vos cours, ou sur n'importe quel sujet."}
                </p>
                <div className={cn("flex gap-2", page ? "flex-wrap justify-center" : "flex-col")}>
                  {STARTERS[scope].map((s) => (
                    <button key={s} type="button" disabled={sending || aiReady === false} onClick={() => void send(s)} className="rounded-lg border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m) => (
              <Bubble key={m.id} m={m} onCitation={onCitation} large={page} />
            ))}
            {sending && live?.text ? (
              <div className="flex justify-start">
                <div className={cn("rounded-xl bg-muted/60 px-4 py-2.5", page ? "max-w-[85%] text-[15px]" : "max-w-[92%] text-sm")}>
                  <div className="space-y-2 break-words leading-relaxed [&_a]:underline [&_code]:rounded [&_code]:bg-background [&_code]:px-1 [&_li]:ml-5 [&_ol]:list-decimal [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-background [&_pre]:p-2 [&_ul]:list-disc">
                    <ReactMarkdown skipHtml>{live.text}</ReactMarkdown>
                  </div>
                </div>
              </div>
            ) : (
              sending && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> {live?.status || "L'assistant répond…"}
                </div>
              )
            )}
            {error && (
              <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                {error}
              </p>
            )}
            <div ref={endRef} />
          </div>
        </div>

        <form
          className={cn("border-t", page ? "p-3" : "p-2", dragging && "bg-primary/5 outline-dashed outline-2 -outline-offset-4 outline-primary/50")}
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes("Files")) {
              e.preventDefault();
              setDragging(true);
            }
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            if (!e.dataTransfer.files.length) return;
            e.preventDefault();
            setDragging(false);
            addFiles([...e.dataTransfer.files]);
          }}
        >
          <input
            ref={fileRef}
            type="file"
            multiple
            accept={ACCEPT}
            className="hidden"
            aria-label="Joindre un fichier ou une image"
            onChange={(e) => {
              addFiles([...(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
          {attachCount > 0 && (
            <div className={cn("mb-2 flex flex-wrap gap-1.5", page && "mx-auto max-w-3xl")} aria-label="Pièces jointes">
              {libDocs.map((d) => (
                <AttachmentChip key={d.id} a={{ kind: "library", name: d.name }} onRemove={() => setLibDocs((c) => c.filter((x) => x.id !== d.id))} />
              ))}
              {files.map((f, i) => (
                <AttachmentChip key={`${f.name}-${i}`} a={{ kind: "pending", name: f.name }} onRemove={() => setFiles((c) => c.filter((_, j) => j !== i))} />
              ))}
            </div>
          )}
          <div className={cn("flex items-end gap-2", page && "mx-auto max-w-3xl")}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" size="icon" variant="outline" className="h-9 w-9 shrink-0" disabled={sending || aiReady === false || attachCount >= MAX_ATTACHMENTS} aria-label="Joindre un document ou une image" title="Joindre un document ou une image">
                  <Paperclip className="h-4 w-4" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onSelect={() => fileRef.current?.click()}>
                  <FileText className="mr-2 h-4 w-4" aria-hidden /> Fichier ou image de l&apos;ordinateur
                </DropdownMenuItem>
                {scope === "GLOBAL" && (
                  <DropdownMenuItem onSelect={() => void openPicker()}>
                    <Library className="mr-2 h-4 w-4" aria-hidden /> Document de mes cours
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(input);
                }
              }}
              onPaste={(e) => {
                const pasted = [...e.clipboardData.files];
                if (pasted.length) {
                  e.preventDefault();
                  addFiles(pasted.map((f) => (f.name && /\.\w+$/.test(f.name) ? f : new File([f], `capture-${Date.now()}.${f.type.split("/")[1] === "jpeg" ? "jpg" : (f.type.split("/")[1] ?? "png")}`, { type: f.type }))));
                }
              }}
              rows={page ? 3 : 2}
              maxLength={6000}
              placeholder={scope === "DOCUMENT" ? "Votre question sur ce cours…" : "Posez votre question…"}
              className={cn("min-h-0 resize-none", page ? "text-[15px]" : "text-sm")}
              aria-label="Message"
              disabled={aiReady === false}
            />
            <Button type="submit" size="icon" className="h-9 w-9 shrink-0" disabled={sending || (!input.trim() && !attachCount) || aiReady === false} aria-label="Envoyer">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
            </Button>
          </div>
        </form>
      </div>

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Joindre un document de mes cours</DialogTitle>
            <DialogDescription>L&apos;assistant le consultera en priorité et citera ses passages. {MAX_ATTACHMENTS} pièces jointes au maximum.</DialogDescription>
          </DialogHeader>
          <div className="max-h-80 space-y-0.5 overflow-y-auto" role="group" aria-label="Documents">
            {library === null && <Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" aria-label="Chargement" />}
            {library?.length === 0 && <p className="text-sm text-muted-foreground">Aucun document prêt à être consulté dans votre bibliothèque.</p>}
            {(library ?? []).map((d) => {
              const picked = libDocs.some((x) => x.id === d.id);
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => toggleLibDoc(d)}
                  aria-pressed={picked}
                  className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted", picked && "bg-muted font-medium")}
                >
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{d.name}</span>
                  {d.subject && <span className="shrink-0 text-xs text-muted-foreground">{d.subject}</span>}
                  {picked && <span className="shrink-0 text-xs text-primary">Joint</span>}
                </button>
              );
            })}
          </div>
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setPickerOpen(false)}>
              Terminé
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
