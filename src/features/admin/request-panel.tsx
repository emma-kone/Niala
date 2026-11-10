"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { confirmAction, notify } from "@/components/notifications";
import { api } from "@/lib/client-api";
import { PRIORITIES, REQUEST_STATUSES, ROADMAP_STATUSES } from "@/server/analytics/definitions";

const sel = "h-9 w-full rounded-lg border bg-background px-2 text-sm";
const area = "w-full rounded-lg border bg-background p-2.5 text-sm";
const primary = "rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50";
const ghost = "rounded-lg border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50";

interface Props {
  id: string;
  status: string;
  priority: string;
  assigneeId: string | null;
  admins: { id: string; label: string }[];
  roadmap: { id: string; title: string }[];
  currentRoadmap: string | null;
  similar: { id: string; reference: string; subject: string; score: number; grouped: boolean }[];
  defaultTitle: string;
}

/** Traitement d'une demande : statut, priorité, responsable, réponse à l'étudiant, note interne, feuille de route. */
export function RequestPanel(p: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(p.status);
  const [priority, setPriority] = useState(p.priority);
  const [assignee, setAssignee] = useState(p.assigneeId ?? "");
  const [reply, setReply] = useState("");
  const [replyStatus, setReplyStatus] = useState("");
  const [note, setNote] = useState("");
  const [title, setTitle] = useState(p.defaultTitle);
  const [target, setTarget] = useState("");
  const [picked, setPicked] = useState<string[]>([]);

  async function run(task: () => Promise<unknown>, ok: string, after?: () => void) {
    setBusy(true);
    try {
      await task();
      notify({ title: ok, variant: "success" });
      after?.();
      router.refresh();
    } catch (e) {
      notify({ title: "Action impossible", description: e instanceof Error ? e.message : "Réessayez.", variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  const saveFields = async () => {
    const changed = status !== p.status;
    if (changed && !(await confirmAction(`Passer la demande à « ${REQUEST_STATUSES[status as keyof typeof REQUEST_STATUSES]} » ? L'étudiant en sera informé dans Niala.`, { title: "Changer le statut", confirmLabel: "Confirmer" }))) return;
    await run(() => api.patch(`/api/admin/requests/${p.id}`, { status, priority, assigneeId: assignee || null }), "Demande mise à jour");
  };

  const sendReply = async () => {
    if (!(await confirmAction("Envoyer cette réponse à l'étudiant ? Il la verra dans Niala et sera notifié.", { title: "Répondre à l'étudiant", confirmLabel: "Envoyer" }))) return;
    await run(() => api.post(`/api/admin/requests/${p.id}/reply`, { body: reply, status: replyStatus || undefined }), "Réponse envoyée", () => { setReply(""); setReplyStatus(""); });
  };

  const addNote = () => run(() => api.post(`/api/admin/requests/${p.id}/note`, { body: note }), "Note interne ajoutée", () => setNote(""));

  const group = async () => {
    if (target) return run(() => api.post(`/api/admin/roadmap/${target}`, { requestIds: [p.id, ...picked] }), "Demandes regroupées", () => setPicked([]));
    return run(() => api.post("/api/admin/roadmap", { title, requestIds: [p.id, ...picked] }), "Élément de feuille de route créé", () => setPicked([]));
  };

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border bg-card p-5 shadow-sm" aria-labelledby="rp-treat">
        <h2 id="rp-treat" className="mb-3 text-base font-semibold">Traitement</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-xs text-muted-foreground">Statut<select className={`${sel} mt-1`} value={status} onChange={(e) => setStatus(e.target.value)}>{Object.entries(REQUEST_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="text-xs text-muted-foreground">Priorité<select className={`${sel} mt-1`} value={priority} onChange={(e) => setPriority(e.target.value)}>{Object.entries(PRIORITIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="text-xs text-muted-foreground">Responsable<select className={`${sel} mt-1`} value={assignee} onChange={(e) => setAssignee(e.target.value)}><option value="">Non assignée</option>{p.admins.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></label>
        </div>
        <button disabled={busy} onClick={() => void saveFields()} className={`${primary} mt-3`}>Enregistrer</button>
      </section>

      <section className="rounded-2xl border bg-card p-5 shadow-sm" aria-labelledby="rp-reply">
        <h2 id="rp-reply" className="mb-3 text-base font-semibold">Répondre à l'étudiant</h2>
        <textarea className={area} rows={4} maxLength={4000} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Votre réponse (visible par l'étudiant)" aria-label="Réponse à l'étudiant" />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select className={`${sel} !w-auto`} value={replyStatus} onChange={(e) => setReplyStatus(e.target.value)} aria-label="Statut après envoi"><option value="">Statut : automatique</option>{Object.entries(REQUEST_STATUSES).map(([k, v]) => <option key={k} value={k}>Marquer : {v}</option>)}</select>
          <button disabled={busy || reply.trim().length < 2} onClick={() => void sendReply()} className={primary}>Envoyer la réponse</button>
        </div>
      </section>

      <section className="rounded-2xl border border-amber-500/40 bg-amber-500/5 p-5 shadow-sm" aria-labelledby="rp-note">
        <h2 id="rp-note" className="mb-1 text-base font-semibold">Note interne</h2>
        <p className="mb-3 text-xs text-muted-foreground">Visible uniquement par l'équipe, jamais par l'étudiant.</p>
        <textarea className={area} rows={3} maxLength={4000} value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note interne" />
        <button disabled={busy || note.trim().length < 2} onClick={() => void addNote()} className={`${ghost} mt-2`}>Ajouter la note</button>
      </section>

      <section className="rounded-2xl border bg-card p-5 shadow-sm" aria-labelledby="rp-road">
        <h2 id="rp-road" className="mb-1 text-base font-semibold">Feuille de route</h2>
        <p className="mb-3 text-xs text-muted-foreground">Regroupez les demandes similaires pour identifier un besoin récurrent, puis suivez-le : à étudier, planifié, en développement, déployé ou non retenu.</p>
        {p.currentRoadmap ? (
          <div className="flex items-center gap-2 text-sm"><span>Cette demande est rattachée à un élément de feuille de route.</span><button disabled={busy} className={ghost} onClick={() => void run(() => api.request("DELETE", `/api/admin/requests/${p.id}/roadmap`), "Demande détachée")}>Détacher</button></div>
        ) : (
          <div className="space-y-3">
            {p.similar.length > 0 && (
              <fieldset className="rounded-xl border p-3"><legend className="px-1 text-xs font-medium text-muted-foreground">Demandes proches (suggestion, à valider)</legend>
                <ul className="space-y-1.5 text-sm">{p.similar.map((s) => (
                  <li key={s.id} className="flex items-start gap-2"><input id={`sim-${s.id}`} type="checkbox" className="mt-1" checked={picked.includes(s.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, s.id] : picked.filter((x) => x !== s.id))} /><label htmlFor={`sim-${s.id}`}><span className="font-mono text-xs">{s.reference}</span> {s.subject} <span className="text-xs text-muted-foreground">· similarité {s.score} %{s.grouped ? " · déjà regroupée" : ""}</span></label></li>
                ))}</ul></fieldset>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-muted-foreground">Rattacher à un élément existant<select className={`${sel} mt-1`} value={target} onChange={(e) => setTarget(e.target.value)}><option value="">— Créer un nouvel élément —</option>{p.roadmap.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}</select></label>
              {!target && <label className="text-xs text-muted-foreground">Titre du nouvel élément<input className={`${sel} mt-1`} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} /></label>}
            </div>
            <button disabled={busy || (!target && title.trim().length < 3)} onClick={() => void group()} className={primary}>{target ? "Rattacher" : "Transformer en élément de feuille de route"}{picked.length ? ` (+${picked.length})` : ""}</button>
          </div>
        )}
      </section>
    </div>
  );
}

/** Changement de statut d'un élément de feuille de route (liste de la feuille de route). */
export function RoadmapStatusSelect({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [value, setValue] = useState(status);
  const [busy, setBusy] = useState(false);
  async function change(next: string) {
    if (next === "DEPLOYED" && !(await confirmAction("Marquer cet élément comme déployé ? Les étudiants qui l'avaient suggéré en seront informés dans Niala.", { title: "Élément déployé", confirmLabel: "Confirmer" }))) return;
    setBusy(true);
    try {
      await api.patch(`/api/admin/roadmap/${id}`, { status: next });
      setValue(next);
      notify({ title: "Statut mis à jour", variant: "success" });
      router.refresh();
    } catch (e) {
      notify({ title: "Mise à jour impossible", description: e instanceof Error ? e.message : undefined, variant: "error" });
    } finally {
      setBusy(false);
    }
  }
  return (
    <select aria-label="Statut de l'élément" disabled={busy} value={value} onChange={(e) => void change(e.target.value)} className="h-8 rounded-lg border bg-background px-2 text-sm">
      {Object.entries(ROADMAP_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
    </select>
  );
}
