"use client";

import { CATEGORY_CHOICES, ESATIC_FIELDS, ESATIC_LEVEL_CHOICES, OTHER_FIELD_CODE, OTHER_LEVEL, OTHER_SCHOOL_LEVEL_CHOICES, levelText, type LevelChoice, type ProfileCategory } from "@/config/academic";
import { profileInputSchema, type ProfileInput } from "@/server/domain/profile";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

// Champs académiques dynamiques, communs à l'inscription et à « Mon profil » :
// seuls les champs de la catégorie choisie sont affichés, et donc demandés.

export interface AcademicDraft {
  category: ProfileCategory | null;
  fieldCode: string;
  fieldOther: string;
  institution: string;
  field: string;
  className: string;
  level: string;
  levelOther: string;
  situation: string;
  usageReason: string;
}

export const EMPTY_ACADEMIC: AcademicDraft = { category: null, fieldCode: "", fieldOther: "", institution: "", field: "", className: "", level: "", levelOther: "", situation: "", usageReason: "" };

/** Valeurs à envoyer au serveur, ou premier message d'erreur à afficher. */
export function checkAcademic(d: AcademicDraft): { ok: true; value: ProfileInput } | { ok: false; message: string } {
  const level = { className: d.className, level: d.level || undefined, levelOther: d.levelOther };
  const candidate =
    d.category === "ESATIC"
      ? { category: d.category, fieldCode: d.fieldCode || undefined, fieldOther: d.fieldOther, ...level }
      : d.category === "OTHER_SCHOOL"
        ? { category: d.category, institution: d.institution, field: d.field, ...level }
        : d.category === "TESTER"
          ? { category: d.category, situation: d.situation, usageReason: d.usageReason }
          : {};
  const parsed = profileInputSchema.safeParse(candidate);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, message: parsed.error.issues[0]?.message ?? "Vérifiez les informations saisies." };
}

export function Required() {
  return <span className="text-destructive" aria-hidden> *</span>;
}

/** Niveau d'études : une liste, dont « Autre » qui ouvre un champ libre. */
export function LevelFields({ idPrefix, levels, level, levelOther, onChange }: { idPrefix: string; levels: readonly LevelChoice[]; level: string; levelOther: string; onChange: (patch: { level?: string; levelOther?: string }) => void }) {
  // Un niveau devenu impossible (BTS après un passage à l'ESATIC) n'est pas conservé silencieusement.
  const current = (levels as readonly string[]).includes(level) ? level : "";
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-level`}>Niveau d&apos;études<Required /></Label>
        <Select value={current} onValueChange={(v) => onChange({ level: v })}>
          <SelectTrigger id={`${idPrefix}-level`} className="w-full" aria-required><SelectValue placeholder="Choisir un niveau" /></SelectTrigger>
          <SelectContent>{levels.map((l) => <SelectItem key={l} value={l}>{l === OTHER_LEVEL ? "Autre" : levelText(l)}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      {current === OTHER_LEVEL && (
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-level-other`}>Précisez votre niveau<Required /></Label>
          <Input id={`${idPrefix}-level-other`} required maxLength={80} value={levelOther} onChange={(e) => onChange({ levelOther: e.target.value })} placeholder="Terminale, Doctorat, Formation continue…" />
        </div>
      )}
    </>
  );
}

function ClassField({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Classe <span className="font-normal text-muted-foreground">(facultatif)</span></Label>
      <Input id={id} maxLength={60} value={value} onChange={(e) => onChange(e.target.value)} placeholder="Ex. DASI 3, Terminale D, Groupe B…" />
    </div>
  );
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
            <Label htmlFor={id("field")}>Filière<Required /></Label>
            <Select value={draft.fieldCode} onValueChange={(v) => set({ fieldCode: v })}>
              <SelectTrigger id={id("field")} className="w-full" aria-required><SelectValue placeholder="Choisir une filière" /></SelectTrigger>
              <SelectContent>
                {ESATIC_FIELDS.map((f) => <SelectItem key={f.code} value={f.code}>{f.label}</SelectItem>)}
                <SelectItem value={OTHER_FIELD_CODE}>Autre filière</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {draft.fieldCode === OTHER_FIELD_CODE && (
            <div className="space-y-2">
              <Label htmlFor={id("field-other")}>Intitulé de votre filière<Required /></Label>
              <Input id={id("field-other")} required maxLength={120} value={draft.fieldOther} onChange={(e) => set({ fieldOther: e.target.value })} />
            </div>
          )}
          <LevelFields idPrefix={idPrefix} levels={ESATIC_LEVEL_CHOICES} level={draft.level} levelOther={draft.levelOther} onChange={set} />
          <ClassField id={id("class")} value={draft.className} onChange={(v) => set({ className: v })} />
        </div>
      )}

      {draft.category === "OTHER_SCHOOL" && (
        <div className="space-y-4 animate-in fade-in slide-in-from-top-1">
          <div className="space-y-2">
            <Label htmlFor={id("institution")}>Nom de l&apos;établissement<Required /></Label>
            <Input id={id("institution")} required maxLength={160} value={draft.institution} onChange={(e) => set({ institution: e.target.value })} placeholder="Votre école ou université" />
          </div>
          <div className="space-y-2">
            <Label htmlFor={id("speciality")}>Filière ou spécialité<Required /></Label>
            <Input id={id("speciality")} required maxLength={120} value={draft.field} onChange={(e) => set({ field: e.target.value })} />
          </div>
          <LevelFields idPrefix={idPrefix} levels={OTHER_SCHOOL_LEVEL_CHOICES} level={draft.level} levelOther={draft.levelOther} onChange={set} />
          <ClassField id={id("class")} value={draft.className} onChange={(v) => set({ className: v })} />
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
