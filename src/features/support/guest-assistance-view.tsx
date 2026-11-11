"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CheckCircle2, Copy, LifeBuoy, Loader2, Send } from "lucide-react";
import { NialaLogo } from "@/components/brand/niala-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/client-api";
import { routes } from "@/config/routes";

// ─────────────────────────────────────────────────────────────────────────────
// Assistance SANS compte (accessible depuis la page de connexion) : le visiteur décrit son problème, reçoit les réponses
// de l'équipe par e-mail et suit l'échange par un lien personnel (/assistance/suivi#jeton).
// ─────────────────────────────────────────────────────────────────────────────

const errorText = (e: unknown) => (e instanceof Error && e.message ? e.message : "Une erreur est survenue. Réessayez.");

function Frame({ title, children, wide }: { title: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className={wide ? "w-full max-w-2xl" : "w-full max-w-md"}>
          <div className="mb-8 flex justify-center"><NialaLogo size="lg" wordmarkAs="h1" /></div>
          <section className="space-y-4 rounded-3xl border bg-card p-6 shadow-sm" aria-labelledby="assist-title">
            <h2 id="assist-title" className="typo-h2 flex items-center gap-2"><LifeBuoy className="h-5 w-5 text-primary" aria-hidden />{title}</h2>
            {children}
          </section>
          <p className="mt-4 text-center text-sm"><Link href={routes.login} className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">Retour à la connexion</Link></p>
        </div>
      </main>
    </div>
  );
}

function CopyLink({ url }: { url: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <Input readOnly value={url} aria-label="Lien de suivi" onFocus={(e) => e.currentTarget.select()} className="text-xs" />
      <Button type="button" variant="outline" size="sm" className="shrink-0 gap-1" onClick={() => void navigator.clipboard?.writeText(url).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); })}>
        {done ? <CheckCircle2 className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />} Copier
      </Button>
    </div>
  );
}

/** Formulaire d'assistance pour un visiteur sans compte. */
export function GuestAssistanceForm() {
  const [form, setForm] = useState({ email: "", name: "", subject: "", description: "", website: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ reference: string; url: string; emailed: boolean } | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setSent(await api.post<{ reference: string; url: string; emailed: boolean }>("/api/assistance", form));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <Frame title="Demande envoyée">
        <p className="flex gap-2 text-sm"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />Votre demande <strong>{sent.reference}</strong> est bien arrivée à l&apos;équipe Niala.</p>
        <p className="text-sm text-muted-foreground">
          {sent.emailed ? `Un e-mail de confirmation vient d'être envoyé à ${form.email}. Les réponses de l'équipe vous parviendront à cette adresse.` : "Les réponses de l'équipe vous seront envoyées par e-mail."}{" "}
          Gardez aussi ce lien : il vous permet de suivre l&apos;échange et de répondre, sans compte.
        </p>
        <CopyLink url={sent.url} />
        <Button asChild className="w-full"><a href={sent.url}>Ouvrir le suivi de ma demande</a></Button>
      </Frame>
    );
  }

  return (
    <Frame title="Assistance">
      <form onSubmit={submit} className="space-y-4">
        <p className="typo-meta">Un problème pour vous connecter, créer un compte ou utiliser Niala ? Décrivez-le : l&apos;équipe vous répondra par e-mail, sans que vous ayez besoin de vous connecter.</p>
        <div className="space-y-2">
          <Label htmlFor="assist-email">Votre adresse e-mail</Label>
          <Input id="assist-email" type="email" autoComplete="email" required maxLength={320} value={form.email} onChange={set("email")} placeholder="vous@exemple.fr" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="assist-name">Votre nom <span className="font-normal text-muted-foreground">(facultatif)</span></Label>
          <Input id="assist-name" autoComplete="name" maxLength={80} value={form.name} onChange={set("name")} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="assist-subject">Objet</Label>
          <Input id="assist-subject" required minLength={3} maxLength={120} value={form.subject} onChange={set("subject")} placeholder="Ex. : je ne reçois pas l'e-mail de réinitialisation" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="assist-description">Votre message</Label>
          <Textarea id="assist-description" required minLength={10} maxLength={5000} rows={6} value={form.description} onChange={set("description")} placeholder="Expliquez ce qui se passe, ce que vous avez essayé et, si possible, le message d'erreur affiché." />
        </div>
        {/* Champ piège invisible pour les robots : un humain ne le voit pas et ne le remplit pas. */}
        <div aria-hidden className="absolute left-[-10000px] h-0 w-0 overflow-hidden">
          <label htmlFor="assist-website">Site web</label>
          <input id="assist-website" tabIndex={-1} autoComplete="off" value={form.website} onChange={set("website")} />
        </div>
        {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">{error}</p>}
        <Button type="submit" className="w-full gap-2 font-semibold" disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />} Envoyer ma demande
        </Button>
        <p className="text-xs text-muted-foreground">Votre adresse sert uniquement à vous répondre. Voir la <Link href={routes.privacy} className="underline">politique de confidentialité</Link>.</p>
      </form>
    </Frame>
  );
}

interface Thread {
  reference: string;
  subject: string;
  description: string;
  status: string;
  statusLabel: string;
  createdAt: string;
  closed: boolean;
  name: string | null;
  messages: { id: string; authorRole: string; authorName: string | null; body: string; createdAt: string }[];
}

/** Suivi d'une demande par lien personnel : le jeton est lu dans le fragment (#) de l'adresse. */
export function GuestAssistanceThread() {
  const [token] = useState(() => (typeof window === "undefined" ? "" : window.location.hash.slice(1)));
  const [thread, setThread] = useState<Thread | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    api
      .post<Thread>("/api/assistance/suivi", { token })
      .then((t) => !cancelled && setThread(t))
      .catch((err) => !cancelled && setError(errorText(err)));
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      setThread(await api.post<Thread>("/api/assistance/suivi", { token, body: reply }));
      setReply("");
      setError(null);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (!token) return <Frame title="Suivi de demande"><p className="text-sm">Ce lien de suivi est incomplet. Ouvrez le lien reçu par e-mail, ou <Link href="/assistance" className="underline">envoyez une nouvelle demande</Link>.</p></Frame>;
  if (!thread) return <Frame title="Suivi de demande">{error ? <p role="alert" className="text-sm text-destructive">{error}</p> : <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />Chargement…</p>}</Frame>;

  return (
    <Frame title={`Demande ${thread.reference}`} wide>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium">{thread.statusLabel}</span>
        <span className="text-muted-foreground">envoyée le {new Date(thread.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}</span>
      </div>
      <ol className="space-y-3">
        <li className="rounded-xl border bg-muted/40 p-3 text-sm">
          <p className="mb-1 text-xs font-medium text-muted-foreground">Vous — {thread.subject}</p>
          <p className="whitespace-pre-wrap break-words">{thread.description}</p>
        </li>
        {thread.messages.map((m) => (
          <li key={m.id} className={m.authorRole === "ADMIN" ? "rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm" : "rounded-xl border bg-muted/40 p-3 text-sm"}>
            <p className="mb-1 flex justify-between gap-2 text-xs text-muted-foreground"><span className="font-medium text-foreground">{m.authorRole === "ADMIN" ? "Équipe Niala" : "Vous"}</span><time dateTime={m.createdAt}>{new Date(m.createdAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}</time></p>
            <p className="whitespace-pre-wrap break-words">{m.body}</p>
          </li>
        ))}
      </ol>
      {thread.closed ? (
        <p className="rounded-xl bg-muted px-3 py-2 text-sm">Cette demande est clôturée. Pour un nouveau problème, <Link href="/assistance" className="underline">envoyez une nouvelle demande</Link>.</p>
      ) : (
        <form onSubmit={send} className="space-y-2">
          <Label htmlFor="assist-reply">Votre réponse</Label>
          <Textarea id="assist-reply" required minLength={2} maxLength={4000} rows={4} value={reply} onChange={(e) => setReply(e.target.value)} />
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={busy || reply.trim().length < 2} className="gap-2">{busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />} Envoyer</Button>
        </form>
      )}
    </Frame>
  );
}
