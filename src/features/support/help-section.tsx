"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Paperclip, X } from "lucide-react";
import { api } from "@/lib/client-api";
import { cn } from "@/lib/utils";
import { notify } from "@/components/notifications";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MODULES, REQUEST_STATUSES, REQUEST_TYPES, CLOSED_STATUSES, type RequestStatus } from "@/server/analytics/definitions";

// « Aide, suggestions et retours » : dépôt d'une demande, suivi (« Mes demandes »), réponses de l'équipe et notifications.
// L'adresse e-mail n'est jamais redemandée : la demande est rattachée au compte connecté.

interface MyRequest { id: string; reference: string; type: string; subject: string; status: string; createdAt: string; updatedAt: string; replies: number }
interface Detail { id: string; reference: string; type: string; subject: string; description: string; module: string | null; status: string; createdAt: string; attachments: { index: number; name: string; size: number }[]; messages: { id: string; authorRole: "USER" | "ADMIN"; authorName: string | null; body: string; createdAt: string }[] }
interface NotificationsData { items: { id: string; kind: string; title: string; body: string | null; link: string | null; readAt: string | null; createdAt: string }[]; unread: number }

export const REQUESTS_KEY = ["support-requests"] as const;
export const NOTIFICATIONS_KEY = ["notifications"] as const;

const MAX_FILES = 3;
const MAX_BYTES = 5 * 1024 * 1024;
const select = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";
const fmt = (iso: string) => new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const errorText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

const STATUS_STYLE: Record<string, string> = {
  RECEIVED: "bg-sky-500/15 text-sky-800 dark:text-sky-300",
  PENDING_REVIEW: "bg-amber-500/20 text-amber-900 dark:text-amber-300",
  IN_PROGRESS: "bg-[var(--niala-accent)]/15 text-[var(--niala-accent)]",
  NEEDS_INFO: "bg-amber-500/25 text-amber-900 dark:text-amber-200",
  RESOLVED: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
  REJECTED: "bg-muted text-muted-foreground",
};
const StatusChip = ({ status }: { status: string }) => <span className={cn("inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", STATUS_STYLE[status])}>{REQUEST_STATUSES[status as RequestStatus] ?? status}</span>;

// ── Formulaire ───────────────────────────────────────────────────────────────

function RequestForm({ onSent }: { onSent: (reference: string, id: string) => void }) {
  const [type, setType] = useState<string>("");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [module, setModule] = useState("");
  const [urgency, setUrgency] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  function addFiles(list: FileList | null) {
    if (!list) return;
    const next = [...files];
    for (const f of Array.from(list)) {
      if (f.size > MAX_BYTES) return setProblem(`« ${f.name} » dépasse 5 Mo.`);
      if (next.length >= MAX_FILES) return setProblem(`${MAX_FILES} fichiers au maximum.`);
      next.push(f);
    }
    setProblem(null);
    setFiles(next);
    if (picker.current) picker.current.value = "";
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!type) return setProblem("Choisissez le type de demande.");
    setBusy(true);
    setProblem(null);
    try {
      const form = new FormData();
      form.set("type", type);
      form.set("subject", subject);
      form.set("description", description);
      if (module) form.set("module", module);
      if (urgency) form.set("urgency", urgency);
      files.forEach((f) => form.append("files", f));
      const r = await api.post<{ id: string; reference: string }>("/api/support/requests", form);
      setType(""); setSubject(""); setDescription(""); setModule(""); setUrgency(""); setFiles([]);
      onSent(r.reference, r.id);
    } catch (err) {
      setProblem(errorText(err, "Envoi impossible. Réessayez dans un instant."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 py-3.5" aria-label="Envoyer une demande">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="req-type">Type de demande</Label>
          <select id="req-type" required className={select} value={type} onChange={(e) => setType(e.target.value)}>
            <option value="" disabled>Choisir…</option>
            {Object.entries(REQUEST_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="req-module">Module concerné <span className="font-normal text-muted-foreground">(facultatif)</span></Label>
          <select id="req-module" className={select} value={module} onChange={(e) => setModule(e.target.value)}>
            <option value="">Non précisé</option>
            {Object.entries(MODULES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            <option value="other">Autre</option>
          </select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="req-subject">Objet</Label>
        <Input id="req-subject" required minLength={3} maxLength={120} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="En une phrase, de quoi s'agit-il ?" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="req-desc">Description détaillée</Label>
        <Textarea id="req-desc" required minLength={10} maxLength={5000} rows={5} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ce que vous avez fait, ce que vous attendiez, ce qui s'est passé…" />
        <p className="typo-meta text-right">{description.length}/5000</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="req-urgency">Niveau d&apos;urgence <span className="font-normal text-muted-foreground">(facultatif)</span></Label>
          <select id="req-urgency" className={select} value={urgency} onChange={(e) => setUrgency(e.target.value)}>
            <option value="">Non précisé</option><option value="LOW">Faible</option><option value="NORMAL">Normale</option><option value="HIGH">Élevée — je suis bloqué(e)</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="req-files">Capture d&apos;écran ou fichier <span className="font-normal text-muted-foreground">(facultatif)</span></Label>
          <input ref={picker} id="req-files" type="file" multiple accept="image/png,image/jpeg,image/webp,application/pdf,text/plain" className="sr-only" onChange={(e) => addFiles(e.target.files)} />
          <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => picker.current?.click()} disabled={files.length >= MAX_FILES}><Paperclip className="h-4 w-4" aria-hidden /> Joindre un fichier</Button>
          <p className="typo-meta">PNG, JPEG, WebP, PDF ou texte · 5 Mo · {MAX_FILES} fichiers maximum.</p>
        </div>
      </div>
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs">{f.name}<button type="button" aria-label={`Retirer ${f.name}`} onClick={() => setFiles(files.filter((_, k) => k !== i))}><X className="h-3 w-3" aria-hidden /></button></li>
          ))}
        </ul>
      )}
      {problem && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{problem}</p>}
      <div className="flex items-center justify-between gap-3">
        <p className="typo-meta">Votre demande est rattachée à votre compte : inutile de renseigner votre adresse e-mail.</p>
        <Button type="submit" disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Envoyer</Button>
      </div>
    </form>
  );
}

// ── Suivi d'une demande ──────────────────────────────────────────────────────

function RequestDetail({ id, onChanged }: { id: string; onChanged: () => void }) {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ["support-request", id], queryFn: () => api.get<{ request: Detail }>(`/api/support/requests/${id}`).then((r) => r.request) });
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);

  if (isLoading) return <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Chargement…</div>;
  if (error || !data) return <p role="alert" className="py-3 text-sm text-destructive">{errorText(error, "Demande introuvable.")}</p>;
  const closed = CLOSED_STATUSES.includes(data.status as RequestStatus);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post(`/api/support/requests/${id}/reply`, { body: reply });
      setReply("");
      await qc.invalidateQueries({ queryKey: ["support-request", id] });
      onChanged();
      notify({ title: "Message envoyé", variant: "success", durationMs: 2500 });
    } catch (err) {
      notify({ title: "Envoi impossible", description: errorText(err, ""), variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-2xl border bg-muted/30 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium">{REQUEST_TYPES[data.type as keyof typeof REQUEST_TYPES]}{data.module ? ` · ${MODULES[data.module as keyof typeof MODULES] ?? data.module}` : ""}</p><StatusChip status={data.status} /></div>
      <p className="whitespace-pre-wrap text-sm">{data.description}</p>
      {data.attachments.length > 0 && <ul className="flex flex-wrap gap-2">{data.attachments.map((a) => <li key={a.index}><a className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs hover:bg-muted" href={`/api/support/requests/${id}/attachments/${a.index}`} download><Paperclip className="h-3 w-3" aria-hidden />{a.name}</a></li>)}</ul>}
      <ol className="space-y-2" aria-label="Échanges">
        {data.messages.map((m) => (
          <li key={m.id} className={cn("rounded-xl border p-3 text-sm", m.authorRole === "ADMIN" ? "border-[var(--niala-accent)]/30 bg-[var(--niala-accent)]/8" : "bg-card")}>
            <p className="mb-1 flex justify-between gap-3 text-xs text-muted-foreground"><span className="font-medium text-foreground">{m.authorRole === "ADMIN" ? "Équipe Niala" : "Vous"}</span><time dateTime={m.createdAt}>{fmt(m.createdAt)}</time></p>
            <p className="whitespace-pre-wrap">{m.body}</p>
          </li>
        ))}
        {!data.messages.length && <li className="typo-meta">Pas encore de réponse. Vous serez notifié(e) dès qu&apos;elle sera disponible.</li>}
      </ol>
      {data.status === "NEEDS_INFO" && <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">L&apos;équipe a besoin d&apos;une information complémentaire : répondez ci-dessous.</p>}
      {!closed ? (
        <form onSubmit={send} className="space-y-2">
          <Label htmlFor={`reply-${id}`} className="sr-only">Votre message</Label>
          <Textarea id={`reply-${id}`} rows={3} required minLength={2} maxLength={4000} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Ajouter un message ou une précision…" />
          <div className="flex justify-end"><Button type="submit" size="sm" disabled={busy || reply.trim().length < 2}>{busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Envoyer</Button></div>
        </form>
      ) : <p className="typo-meta">Cette demande est clôturée. Pour un nouveau sujet, envoyez une nouvelle demande.</p>}
    </div>
  );
}

function MyRequests({ openId, setOpenId }: { openId: string | null; setOpenId: (id: string | null) => void }) {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: REQUESTS_KEY, queryFn: () => api.get<{ requests: MyRequest[] }>("/api/support/requests").then((r) => r.requests) });
  if (isLoading) return <div className="space-y-2 py-3.5">{[0, 1].map((i) => <div key={i} className="h-12 animate-pulse rounded-xl bg-muted" aria-hidden />)}</div>;
  if (error) return <p role="alert" className="py-3.5 text-sm text-destructive">{errorText(error, "Impossible de charger vos demandes.")}</p>;
  if (!data?.length) return <p className="typo-meta py-3.5">Vous n&apos;avez pas encore envoyé de demande.</p>;
  return (
    <ul className="space-y-2 py-3.5">
      {data.map((r) => (
        <li key={r.id}>
          <button type="button" aria-expanded={openId === r.id} onClick={() => setOpenId(openId === r.id ? null : r.id)} className="flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 text-left hover:bg-muted/50">
            <span className="min-w-0"><span className="block truncate text-sm font-medium">{r.subject}</span><span className="typo-meta"><span className="font-mono">{r.reference}</span> · {fmt(r.createdAt)}{r.replies ? ` · ${r.replies} réponse${r.replies > 1 ? "s" : ""}` : ""}</span></span>
            <StatusChip status={r.status} />
          </button>
          {openId === r.id && <div className="mt-2"><RequestDetail id={r.id} onChanged={() => void qc.invalidateQueries({ queryKey: REQUESTS_KEY })} /></div>}
        </li>
      ))}
    </ul>
  );
}

// ── Notifications ────────────────────────────────────────────────────────────

function Inbox({ onOpenRequest }: { onOpenRequest: (id: string) => void }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: NOTIFICATIONS_KEY, queryFn: () => api.get<NotificationsData>("/api/notifications") });
  if (!data?.items.length) return <p className="typo-meta py-3.5">Aucune notification pour l&apos;instant.</p>;
  async function markAll() {
    await api.post("/api/notifications", {}).catch(() => undefined);
    await qc.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
  }
  return (
    <div className="py-3.5">
      {data.unread > 0 && <div className="mb-2 flex justify-end"><Button variant="ghost" size="sm" onClick={() => void markAll()}>Tout marquer comme lu ({data.unread})</Button></div>}
      <ul className="space-y-2">
        {data.items.slice(0, 10).map((n) => {
          const requestId = n.kind !== "ANNOUNCEMENT" && n.link ? new URLSearchParams(n.link.split("?")[1]?.split("#")[0]).get("demande") : null;
          return (
            <li key={n.id} className={cn("rounded-xl border px-3.5 py-2.5 text-sm", !n.readAt && "border-[var(--niala-accent)]/40 bg-[var(--niala-accent)]/8")}>
              <div className="flex justify-between gap-3"><p className="font-medium">{n.title}</p><time className="typo-meta shrink-0" dateTime={n.createdAt}>{fmt(n.createdAt)}</time></div>
              {n.body && <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground">{n.body}</p>}
              {requestId && <button type="button" className="mt-1 text-xs underline" onClick={() => onOpenRequest(requestId)}>Voir la demande</button>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Section « Aide, suggestions et retours » des paramètres. */
export function HelpSection({ page = false }: { page?: boolean }) {
  const qc = useQueryClient();
  const [sent, setSent] = useState<{ reference: string; id: string } | null>(null);
  const [openId, setOpenId] = useState<string | null>(() => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("demande")));
  const { data: notes } = useQuery({ queryKey: NOTIFICATIONS_KEY, queryFn: () => api.get<NotificationsData>("/api/notifications") });

  // Consulter une réponse la marque comme lue.
  useEffect(() => {
    if (!openId || !notes?.unread) return;
    const ids = notes.items.filter((n) => !n.readAt && n.link?.includes(openId)).map((n) => n.id);
    if (ids.length) api.post("/api/notifications", { ids }).then(() => qc.invalidateQueries({ queryKey: NOTIFICATIONS_KEY })).catch(() => undefined);
  }, [openId, notes, qc]);

  const heading = (id: string, title: string, text: string, badge?: number) => (
    <div className="pt-4 first:pt-0"><h3 id={id} className="text-sm font-semibold">{title}{!!badge && <span className="ml-2 rounded-full bg-[var(--niala-accent)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--niala-accent-foreground)]">{badge}</span>}</h3><p className="typo-meta mt-0.5">{text}</p></div>
  );

  return (
    <section id="aide" aria-labelledby="aide-title" data-tour="suggestions-form" className="scroll-mt-4 rounded-3xl border bg-card p-5">
      <div className={page ? "sr-only" : undefined}>
        <h2 id="aide-title" className="typo-h2">Aide, suggestions et retours</h2>
        <p className="typo-meta mt-0.5">Une idée, un problème, une difficulté ? Écrivez à l&apos;équipe Niala et suivez le traitement de votre demande.</p>
        {!page && <Link href="/suggestions" className="mt-1 inline-block text-xs underline">Ouvrir la page Suggestions</Link>}
      </div>
      <div className="mt-2 divide-y">
        {sent && (
          <div role="status" className="my-3 flex gap-3 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-4">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden />
            <div className="text-sm"><p className="font-medium">Votre demande a bien été envoyée.</p><p className="mt-0.5">Référence de suivi : <span className="font-mono font-semibold">{sent.reference}</span>. Retrouvez-la ci-dessous dans « Mes demandes » ; vous serez notifié(e) de chaque réponse.</p><Button variant="outline" size="sm" className="mt-2" onClick={() => { setOpenId(sent.id); setSent(null); }}>Voir ma demande</Button></div>
          </div>
        )}
        {heading("aide-envoyer", "Envoyer une demande", "Suggestion, nouvelle fonctionnalité, problème technique, difficulté, IA, assistance…")}
        <RequestForm onSent={(reference, id) => { setSent({ reference, id }); void qc.invalidateQueries({ queryKey: REQUESTS_KEY }); }} />
        {heading("aide-demandes", "Mes demandes", "Leur état et les réponses de l'équipe.")}
        <MyRequests openId={openId} setOpenId={setOpenId} />
        {heading("aide-notifs", "Notifications de l'équipe", "Annonces, nouveautés, maintenance et réponses à vos demandes.", notes?.unread)}
        <Inbox onOpenRequest={(id) => { setOpenId(id); document.getElementById("aide-demandes")?.scrollIntoView({ behavior: "smooth" }); }} />
      </div>
    </section>
  );
}
