"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { confirmAction, notify } from "@/components/notifications";
import { api } from "@/lib/client-api";

interface SettingRow { key: string; label: string; description: string; value: number | boolean; kind: "number" | "boolean"; isDefault: boolean }

export function SettingsForm({ settings, editable }: { settings: SettingRow[]; editable: boolean }) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, number | boolean>>(Object.fromEntries(settings.map((s) => [s.key, s.value])));
  const [busy, setBusy] = useState<string | null>(null);

  async function save(s: SettingRow) {
    if (!(await confirmAction(`Modifier « ${s.label} » ? Le changement est journalisé.`, { title: "Modifier un paramètre", confirmLabel: "Enregistrer" }))) return;
    setBusy(s.key);
    try {
      await api.put(`/api/admin/settings/${s.key}`, { value: values[s.key] });
      notify({ title: "Paramètre enregistré", variant: "success" });
      router.refresh();
    } catch (e) {
      notify({ title: "Enregistrement impossible", description: e instanceof Error ? e.message : undefined, variant: "error" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <ul className="divide-y">
      {settings.map((s) => (
        <li key={s.key} className="flex flex-wrap items-center justify-between gap-3 py-3">
          <div className="min-w-0"><p className="text-sm font-medium">{s.label}</p><p className="text-xs text-muted-foreground">{s.description}{s.isDefault ? " · valeur par défaut" : ""}</p></div>
          <div className="flex items-center gap-2">
            {s.kind === "number" ? (
              <input type="number" aria-label={s.label} disabled={!editable} min={1} className="h-9 w-24 rounded-lg border bg-background px-2 text-sm" value={Number(values[s.key])} onChange={(e) => setValues({ ...values, [s.key]: Number(e.target.value) })} />
            ) : (
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={!editable} checked={!!values[s.key]} onChange={(e) => setValues({ ...values, [s.key]: e.target.checked })} />{values[s.key] ? "Activé" : "Désactivé"}</label>
            )}
            {editable && <button disabled={busy === s.key || values[s.key] === s.value} onClick={() => void save(s)} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-40">Enregistrer</button>}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function RolesForm({ roles }: { roles: { value: string; label: string }[] }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState(roles[0]?.value ?? "ADMIN");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const label = role === "NONE" ? "retirer tout accès d'administration à" : `attribuer le rôle « ${roles.find((r) => r.value === role)?.label} » à`;
    if (!(await confirmAction(`Voulez-vous ${label} ${email} ?`, { title: "Modifier un rôle d'administration", confirmLabel: "Confirmer", danger: role === "NONE" || role === "SUPER_ADMIN" }))) return;
    setBusy(true);
    try {
      await api.post("/api/admin/admins", { email, role });
      notify({ title: "Rôle mis à jour", variant: "success" });
      setEmail("");
      router.refresh();
    } catch (err) {
      notify({ title: "Modification impossible", description: err instanceof Error ? err.message : undefined, variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
      <label className="min-w-[220px] flex-1 text-xs text-muted-foreground">Adresse e-mail du compte Niala<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 h-9 w-full rounded-lg border bg-background px-2.5 text-sm" /></label>
      <label className="text-xs text-muted-foreground">Rôle<select value={role} onChange={(e) => setRole(e.target.value)} className="mt-1 h-9 rounded-lg border bg-background px-2 text-sm">{roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}<option value="NONE">Retirer l'accès</option></select></label>
      <button disabled={busy} className="h-9 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50">Appliquer</button>
    </form>
  );
}
