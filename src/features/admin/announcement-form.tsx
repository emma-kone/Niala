"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { confirmAction, notify } from "@/components/notifications";
import { api } from "@/lib/client-api";

const KINDS = { INFO: "Information générale", FEATURE: "Nouvelle fonctionnalité", MAINTENANCE: "Maintenance", ALERT: "Alerte importante" } as const;
const CATEGORIES = { ESATIC: "Étudiants ESATIC", OTHER_SCHOOL: "Étudiants d'autres établissements", TESTER: "Autres utilisateurs et testeurs" } as const;

interface Preview {
  recipients: number;
  kindLabel: string;
  remainingToday: number;
  dailyLimit: number;
  email: { configured: boolean; reachable: number };
  push: { configured: boolean; reachable: number };
}

/** Rédaction → aperçu (destinataires réels, plafond restant) → confirmation → diffusion. */
export function AnnouncementForm({ institutions }: { institutions: string[] }) {
  const router = useRouter();
  const [kind, setKind] = useState<keyof typeof KINDS>("INFO");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [cats, setCats] = useState<string[]>([]);
  const [inst, setInst] = useState<string[]>([]);
  const [target, setTarget] = useState<"all" | "targeted">("all");
  const [email, setEmail] = useState(true);
  const [push, setPush] = useState(true);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);

  const payload = () => ({ kind, title, body, target, audience: target === "all" ? {} : { ...(cats.length ? { categories: cats } : {}), ...(inst.length ? { institutions: inst } : {}) }, channels: { email, push } });
  const toggle = (list: string[], set: (v: string[]) => void, v: string) => { set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]); setPreview(null); };
  const input = "h-9 w-full rounded-lg border bg-background px-2.5 text-sm";

  async function doPreview(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      setPreview(await api.post<Preview>("/api/admin/communications/preview", payload()));
    } catch (err) {
      notify({ title: "Aperçu impossible", description: err instanceof Error ? err.message : undefined, variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (!preview) return;
    const via = ["dans Niala", ...(email ? ["par e-mail"] : []), ...(push ? ["en notification push"] : [])].join(", ");
    if (!(await confirmAction(`Diffuser « ${title} » à ${preview.recipients} destinataire(s) (${via}) ? Les e-mails et notifications push envoyés ne pourront pas être repris.`, { title: "Confirmer la diffusion", confirmLabel: "Diffuser", danger: kind === "ALERT" }))) return;
    setBusy(true);
    try {
      const r = await api.post<{ recipients: number }>("/api/admin/communications", { ...payload(), confirm: true });
      notify({ title: "Annonce diffusée", description: `${r.recipients} destinataire(s) notifié(s) dans Niala${email || push ? " ; envois par e-mail et push en cours" : ""}.`, variant: "success" });
      setTitle(""); setBody(""); setCats([]); setInst([]); setTarget("all"); setPreview(null);
      router.refresh();
    } catch (err) {
      notify({ title: "Diffusion impossible", description: err instanceof Error ? err.message : undefined, variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  const chip = (active: boolean) => `cursor-pointer rounded-full border px-3 py-1 text-sm ${active ? "border-[var(--niala-accent)] bg-[var(--niala-accent)]/15 font-medium" : "hover:bg-muted"}`;

  return (
    <form onSubmit={doPreview} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-xs text-muted-foreground">Type de message<select className={`${input} mt-1`} value={kind} onChange={(e) => { setKind(e.target.value as keyof typeof KINDS); setPreview(null); }}>{Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="text-xs text-muted-foreground sm:col-span-2">Titre<input className={`${input} mt-1`} value={title} onChange={(e) => { setTitle(e.target.value); setPreview(null); }} maxLength={100} required /></label>
      </div>
      <label className="block text-xs text-muted-foreground">Message<textarea className="mt-1 w-full rounded-lg border bg-background p-2.5 text-sm" rows={4} maxLength={1000} value={body} onChange={(e) => { setBody(e.target.value); setPreview(null); }} required /><span className="float-right">{body.length}/1000</span></label>

      <fieldset><legend className="mb-1.5 text-xs font-semibold text-muted-foreground">Destinataires</legend>
        <div className="mb-2 flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="radio" name="target" checked={target === "all"} onChange={() => { setTarget("all"); setPreview(null); }} /> Tous les utilisateurs actifs</label>
          <label className="flex items-center gap-2"><input type="radio" name="target" checked={target === "targeted"} onChange={() => { setTarget("targeted"); setPreview(null); }} /> Audience ciblée</label>
        </div>
        {target === "targeted" && (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Catégories">{Object.entries(CATEGORIES).map(([k, v]) => <button type="button" key={k} aria-pressed={cats.includes(k)} onClick={() => toggle(cats, setCats, k)} className={chip(cats.includes(k))}>{v}</button>)}</div>
            {institutions.length > 0 && <div className="flex flex-wrap gap-1.5" role="group" aria-label="Établissements">{institutions.map((l) => <button type="button" key={l} aria-pressed={inst.includes(l)} onClick={() => toggle(inst, setInst, l)} className={chip(inst.includes(l))}>{l}</button>)}</div>}
            <p className="text-xs text-muted-foreground">Choisissez au moins une catégorie ou un établissement.</p>
          </div>
        )}
      </fieldset>

      <fieldset><legend className="mb-1.5 text-xs font-semibold text-muted-foreground">Canaux — l&apos;annonce apparaît toujours dans Niala (cloche)</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={email} onChange={(e) => { setEmail(e.target.checked); setPreview(null); }} /> Aussi par e-mail</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={push} onChange={(e) => { setPush(e.target.checked); setPreview(null); }} /> Aussi en notification push (téléphone, ordinateur, même site fermé)</label>
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <button disabled={busy || title.trim().length < 3 || body.trim().length < 5} className="rounded-lg border px-3.5 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50">Prévisualiser</button>
      </div>

      {preview && (
        <div className="space-y-3 rounded-2xl border border-[var(--niala-accent)]/40 bg-[var(--niala-accent)]/5 p-4" aria-live="polite">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Aperçu — tel que l'étudiant le verra</p>
          <div className="rounded-xl border bg-card p-3 shadow-sm"><p className="text-xs text-muted-foreground">{preview.kindLabel}</p><p className="font-medium">{title}</p><p className="mt-1 whitespace-pre-wrap text-sm">{body}</p></div>
          <p className="text-sm"><strong>{preview.recipients}</strong> destinataire(s) dans Niala · annonces restantes sur 24 h : <strong>{preview.remainingToday}</strong> / {preview.dailyLimit}</p>
          {email && <p className="text-sm">{preview.email.configured ? <>Par e-mail : <strong>{preview.email.reachable}</strong> (ceux qui ne se sont pas désinscrits).</> : <span className="text-amber-700 dark:text-amber-400">E-mail non configuré (RESEND_API_KEY, EMAIL_FROM) : aucun e-mail ne partira.</span>}</p>}
          {push && <p className="text-sm">{preview.push.configured ? <>En push : <strong>{preview.push.reachable}</strong> étudiant(s) ont activé les notifications sur au moins un appareil.</> : <span className="text-amber-700 dark:text-amber-400">Notifications push non configurées (clés VAPID) : aucune ne partira.</span>}</p>}
          <button type="button" disabled={busy || preview.recipients === 0 || preview.remainingToday === 0} onClick={() => void publish()} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">Diffuser…</button>
          {preview.recipients === 0 && <p className="text-sm text-destructive">Aucun destinataire ne correspond à ces critères.</p>}
          {preview.remainingToday === 0 && <p className="text-sm text-destructive">Le plafond quotidien est atteint.</p>}
        </div>
      )}
    </form>
  );
}

/** Suppression d'une annonce : retirée des notifications des étudiants (les e-mails et push déjà reçus restent). */
export function DeleteAnnouncementButton({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function remove() {
    if (!(await confirmAction(`Supprimer l'annonce « ${title} » ? Elle disparaîtra de l'historique et des notifications des étudiants dans Niala. Les e-mails et notifications push déjà reçus ne peuvent pas être repris.`, { title: "Supprimer l'annonce", confirmLabel: "Supprimer", danger: true }))) return;
    setBusy(true);
    try {
      const r = await api.del<{ notificationsRemoved: number }>(`/api/admin/communications/${id}`);
      notify({ title: "Annonce supprimée", description: `${r.notificationsRemoved} notification(s) retirée(s).`, variant: "success" });
      router.refresh();
    } catch (err) {
      notify({ title: "Suppression impossible", description: err instanceof Error ? err.message : undefined, variant: "error" });
    } finally {
      setBusy(false);
    }
  }
  return <button type="button" disabled={busy} onClick={() => void remove()} className="rounded-lg border border-destructive/40 px-2.5 py-1 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50">Supprimer</button>;
}
