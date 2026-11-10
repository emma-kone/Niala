"use client";

import { CATEGORY_CHOICES, type ProfileCategory } from "@/config/academic";
import { profileInputSchema, type ProfileInput } from "@/server/domain/profile";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

// Champs académiques dynamiques, communs à l'inscription et à « Mon profil » :
// seuls les champs de la catégorie choisie sont affichés, et donc demandés.

export interface AcademicDraft {
  category: ProfileCategory | null;
  institution: string;
  field: string;
  situation: string;
  usageReason: string;
}

export const EMPTY_ACADEMIC: AcademicDraft = { category: null, institution: "", field: "", situation: "", usageReason: "" };

/** Valeurs à envoyer au serveur, ou premier message d'erreur à afficher. */
export function checkAcademic(d: AcademicDraft): { ok: true; value: ProfileInput } | { ok: false; message: string } {
  const candidate =
    d.category === "ESATIC"
      ? { category: d.category, field: d.field }
      : d.category === "OTHER_SCHOOL"
        ? { category: d.category, institution: d.institution, field: d.field }
        : d.category === "TESTER"
          ? { category: d.category, situation: d.situation, usageReason: d.usageReason }
          : {};
  const parsed = profileInputSchema.safeParse(candidate);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, message: parsed.error.issues[0]?.message ?? "Vérifiez les informations saisies." };
}

export function Required() {
  return <span className="text-destructive" aria-hidden> *</span>;
}

export function AcademicFields({ draft, onChange, idPrefix = "academic" }: { draft: AcademicDraft; onChange: (next: AcademicDraft) => void; idPrefix?: string }) {
  const set = (patch: Partial<AcademicDraft>) => onChange({ ...draft, ...patch });
  const id = (name: string) => `${idPrefix}-${name}`;
  return (
    <div className="space-y-4">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Êtes-vous étudiant à l&apos;ESATIC ?<Required /></legend>
        <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-required>
          {CATEGORY_CHOICES.map((c) => {
            const on = draft.category === c.value;
            return (
              <label key={c.value} className={cn("flex cursor-pointer flex-col gap-0.5 rounded-2xl border p-3 text-sm transition-colors hover:bg-muted/50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring", on && "border-primary bg-primary/5")}>
                <input type="radio" name={id("category")} className="sr-only" checked={on} onChange={() => set({ category: c.value })} />
                <span className="font-medium">{c.title}</span>
                <span className="typo-meta">{c.text}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {draft.category === "ESATIC" && (
        <div className="space-y-4 animate-in fade-in slide-in-from-top-1">
          <div className="space-y-2">
            <Label htmlFor={id("field")}>Classe / filière<Required /></Label>
            <Input id={id("field")} required minLength={2} maxLength={60} value={draft.field} onChange={(e) => set({ field: e.target.value })} placeholder="Ex. DASI 3" />
            <p className="typo-meta">Écrivez votre filière suivie de votre année, comme « DASI 3 » ou « SIGL 1 ».</p>
          </div>
        </div>
      )}

      {draft.category === "OTHER_SCHOOL" && (
        <div className="space-y-4 animate-in fade-in slide-in-from-top-1">
          <div className="space-y-2">
            <Label htmlFor={id("institution")}>Nom de l&apos;établissement<Required /></Label>
            <Input id={id("institution")} required maxLength={160} value={draft.institution} onChange={(e) => set({ institution: e.target.value })} placeholder="Votre école ou université" />
          </div>
          <div className="space-y-2">
            <Label htmlFor={id("speciality")}>Classe / filière<Required /></Label>
            <Input id={id("speciality")} required minLength={2} maxLength={60} value={draft.field} onChange={(e) => set({ field: e.target.value })} placeholder="Ex. Génie logiciel L2, Terminale D…" />
          </div>
        </div>
      )}

      {draft.category === "TESTER" && (
        <div className="space-y-4 animate-in fade-in slide-in-from-top-1">
          <div className="space-y-2">
            <Label htmlFor={id("situation")}>Situation actuelle <span className="font-normal text-muted-foreground">(facultatif)</span></Label>
            <Input id={id("situation")} maxLength={160} value={draft.situation} onChange={(e) => set({ situation: e.target.value })} placeholder="Enseignant, salarié, curieux…" />
          </div>
          <div className="space-y-2">
            <Label htmlFor={id("reason")}>Motif de l&apos;utilisation de Niala <span className="font-normal text-muted-foreground">(facultatif)</span></Label>
            <Textarea id={id("reason")} maxLength={500} rows={2} value={draft.usageReason} onChange={(e) => set({ usageReason: e.target.value })} />
          </div>
        </div>
      )}
    </div>
  );
}
