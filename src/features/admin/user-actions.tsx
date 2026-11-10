"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { confirmAction, notify } from "@/components/notifications";
import { api } from "@/lib/client-api";

interface Props { id: string; email: string; name: string | null; status: string; category: string | null; institution: string | null; field: string | null; canManage: boolean; canDelete: boolean }

/** Actions sensibles sur un compte : chacune exige une confirmation, un motif (suspension, désactivation) et est journalisée côté serveur. */
export function UserActions(p: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [mode, setMode] = useState<null | "edit" | "delete">(null);
  const [typed, setTyped] = useState("");
  const [resetLink, setResetLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [form, setForm] = useState({ name: p.name ?? "", category: p.category ?? "", institution: p.institution ?? "", field: p.field ?? "" });

  async function run(task: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      await task();
      notify({ title: ok, variant: "success" });
      router.refresh();
      setMode(null);
    } catch (e) {
      notify({ title: "Action impossible", description: e instanceof Error ? e.message : "Réessayez.", variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(status: "ACTIVE" | "SUSPENDED" | "DISABLED") {
    const verb = { ACTIVE: "réactiver", SUSPENDED: "suspendre", DISABLED: "désactiver" }[status];
    if (status !== "ACTIVE" && reason.trim().length < 3) return notify({ title: "Motif requis", description: "Indiquez le motif (visible uniquement par l'administration).", variant: "warning" });
    const ok = await confirmAction(status === "ACTIVE" ? `Réactiver le compte de ${p.email} ?` : `Voulez-vous vraiment ${verb} le compte de ${p.email} ? Ses sessions ouvertes seront fermées immédiatement.`, { title: `Confirmer : ${verb} le compte`, confirmLabel: verb.charAt(0).toUpperCase() + verb.slice(1), danger: status !== "ACTIVE" });
    if (!ok) return;
    await run(() => api.post(`/api/admin/users/${p.id}/status`, { status, reason: reason.trim() || undefined }), { ACTIVE: "Compte réactivé", SUSPENDED: "Compte suspendu", DISABLED: "Compte désactivé" }[status]);
    setReason("");
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const body = { name: form.name.trim() || undefined, category: (form.category || undefined) as string | undefined, institution: form.institution.trim() || null, field: form.field.trim() || null };
    if (!(await confirmAction("Enregistrer ces renseignements administratifs ?", { title: "Modifier le compte", confirmLabel: "Enregistrer" }))) return;
    await run(() => api.patch(`/api/admin/users/${p.id}`, body), "Renseignements mis à jour");
  }

  async function remove() {
    if (typed.trim().toLowerCase() !== p.email.toLowerCase()) return notify({ title: "Adresse incorrecte", description: "Saisissez l'adresse exacte du compte pour confirmer.", variant: "warning" });
    if (!(await confirmAction(`Supprimer définitivement le compte ${p.email} et toutes ses données (cours, exercices, notes) ? Cette action est irréversible.`, { title: "Suppression définitive", confirmLabel: "Supprimer définitivement", danger: true }))) return;
    setBusy(true);
    try {
      await api.request("DELETE", `/api/admin/users/${p.id}`, { confirmEmail: typed.trim() });
      notify({ title: "Compte supprimé", variant: "success" });
      router.replace("/admin/utilisateurs");
      router.refresh();
    } catch (e) {
      notify({ title: "Suppression impossible", description: e instanceof Error ? e.message : "Réessayez.", variant: "error" });
      setBusy(false);
    }
  }

  async function createResetLink() {
    if (!(await confirmAction(`Créer un lien de réinitialisation du mot de passe pour ${p.email} ? Valable 24 h et une seule fois ; tout lien précédent est annulé. Transmettez-le uniquement à l'étudiant, par un canal vérifié.`, { title: "Lien de réinitialisation", confirmLabel: "Créer le lien" }))) return;
    setBusy(true);
    try {
      setResetLink(await api.post<{ url: string; expiresAt: string }>(`/api/admin/users/${p.id}/reset-link`));
    } catch (e) {
      notify({ title: "Action impossible", description: e instanceof Error ? e.message : "Réessayez.", variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  const btn = "rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50";
  const input = "h-9 w-full rounded-lg border bg-background px-2.5 text-sm";

  return (
    <div className="space-y-3">
      {p.canManage && (
        <>
          {p.status === "ACTIVE" ? (
            <>
              <label className="block text-xs text-muted-foreground" htmlFor="reason">Motif (interne, obligatoire pour suspendre ou désactiver)</label>
              <input id="reason" className={input} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="ex. usage abusif signalé" />
              <div className="flex flex-wrap gap-2">
                <button disabled={busy} onClick={() => void setStatus("SUSPENDED")} className={btn}>Suspendre</button>
                <button disabled={busy} onClick={() => void setStatus("DISABLED")} className={`${btn} text-destructive`}>Désactiver</button>
              </div>
            </>
          ) : (
            <button disabled={busy} onClick={() => void setStatus("ACTIVE")} className={btn}>Réactiver le compte</button>
          )}
          <button disabled={busy} onClick={() => setMode(mode === "edit" ? null : "edit")} className={btn}>Modifier les renseignements</button>
          {p.status === "ACTIVE" && <button disabled={busy} onClick={() => void createResetLink()} className={btn}>Lien de réinitialisation du mot de passe</button>}
          {resetLink && (
            <div className="space-y-2 rounded-xl border p-3">
              <p className="text-xs text-muted-foreground">Lien à usage unique, valable jusqu&apos;au {new Date(resetLink.expiresAt).toLocaleString("fr-FR")}. Il n&apos;est affiché qu&apos;une fois.</p>
              <input readOnly className={input} value={resetLink.url} aria-label="Lien de réinitialisation" onFocus={(e) => e.currentTarget.select()} />
              <button type="button" className={btn} onClick={() => void navigator.clipboard.writeText(resetLink.url).then(() => notify({ title: "Lien copié", variant: "success" }))}>Copier le lien</button>
            </div>
          )}
          {mode === "edit" && (
            <form onSubmit={save} className="space-y-2 rounded-xl border p-3">
              <label className="block text-xs text-muted-foreground">Nom<input className={`${input} mt-1`} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={80} /></label>
              <label className="block text-xs text-muted-foreground">Catégorie
                <select className={`${input} mt-1`} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}><option value="">Inchangée</option><option value="ESATIC">Étudiant ESATIC</option><option value="OTHER_SCHOOL">Autre établissement</option><option value="TESTER">Autre / testeur</option></select></label>
              <label className="block text-xs text-muted-foreground">Établissement<input className={`${input} mt-1`} value={form.institution} onChange={(e) => setForm({ ...form, institution: e.target.value })} maxLength={120} /></label>
              <label className="block text-xs text-muted-foreground">Classe / filière<input className={`${input} mt-1`} value={form.field} onChange={(e) => setForm({ ...form, field: e.target.value })} maxLength={120} /></label>
              <button disabled={busy} className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" aria-label="Enregistrement" /> : "Enregistrer"}</button>
            </form>
          )}
        </>
      )}
      {p.canDelete && (
        <>
          <button disabled={busy} onClick={() => setMode(mode === "delete" ? null : "delete")} className={`${btn} border-destructive/40 text-destructive`}>Supprimer le compte…</button>
          {mode === "delete" && (
            <div className="space-y-2 rounded-xl border border-destructive/40 p-3">
              <p className="text-xs text-muted-foreground">Suppression définitive du compte et de toutes ses données. Les statistiques agrégées sont conservées sous forme pseudonymisée. Saisissez l'adresse <strong>{p.email}</strong> pour confirmer.</p>
              <input className={input} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={p.email} aria-label="Adresse du compte à supprimer" autoComplete="off" />
              <button disabled={busy} onClick={() => void remove()} className="rounded-lg bg-destructive px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">Supprimer définitivement</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
