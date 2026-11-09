import { z } from "zod";
import { ESATIC_FIELDS, ESATIC_LEVEL_CHOICES, ESATIC_NAME, OTHER_FIELD_CODE, OTHER_LEVEL, OTHER_SCHOOL_LEVEL_CHOICES, type LevelChoice } from "@/config/academic";

// ─────────────────────────────────────────────────────────────────────────────
// Profil académique : validation commune à l'inscription et à la page « Mon profil ».
// Chaque catégorie ne porte que ses propres champs ; ceux des autres catégories sont effacés à l'enregistrement.
// La classe est libre ; le niveau est choisi dans une liste, ou « Autre » précisé par l'étudiant.
// ─────────────────────────────────────────────────────────────────────────────

const free = (max: number, tooLong: string) => z.string().trim().max(max, tooLong).optional().transform((v) => v || undefined);
const required = (label: string, max = 120) => z.string({ error: `Indiquez ${label}.` }).trim().min(2, `Indiquez ${label}.`).max(max, `Valeur trop longue pour ${label}.`);
const levelOf = (allowed: readonly LevelChoice[]) => z.enum(allowed as [LevelChoice, ...LevelChoice[]], { error: "Choisissez votre niveau d'études." });
const FIELD_CODES = [...ESATIC_FIELDS.map((f) => f.code), OTHER_FIELD_CODE] as unknown as [string, ...string[]];

/** Niveau « Autre » : l'étudiant doit alors préciser lequel. */
export function levelOtherProblem(p: { level?: string; levelOther?: string }): string | null {
  return p.level === OTHER_LEVEL && (p.levelOther?.length ?? 0) < 2 ? "Précisez votre niveau d'études." : null;
}

const academicLevel = (allowed: readonly LevelChoice[]) => ({
  className: free(60, "Classe trop longue."),
  level: levelOf(allowed),
  levelOther: free(80, "Niveau trop long."),
});

export const profileInputSchema = z.discriminatedUnion(
  "category",
  [
    z
      .object({
        category: z.literal("ESATIC"),
        fieldCode: z.enum(FIELD_CODES, { error: "Choisissez votre filière." }),
        fieldOther: free(120, "Intitulé de filière trop long."),
        ...academicLevel(ESATIC_LEVEL_CHOICES),
      })
      .superRefine((p, ctx) => {
        if (p.fieldCode === OTHER_FIELD_CODE && (p.fieldOther?.length ?? 0) < 2) ctx.addIssue({ code: "custom", path: ["fieldOther"], message: "Précisez votre filière." });
        const other = levelOtherProblem(p);
        if (other) ctx.addIssue({ code: "custom", path: ["levelOther"], message: other });
      }),
    z
      .object({
        category: z.literal("OTHER_SCHOOL"),
        institution: required("le nom de votre établissement", 160),
        field: required("votre filière ou spécialité"),
        ...academicLevel(OTHER_SCHOOL_LEVEL_CHOICES),
      })
      .superRefine((p, ctx) => {
        const other = levelOtherProblem(p);
        if (other) ctx.addIssue({ code: "custom", path: ["levelOther"], message: other });
      }),
    z.object({
      category: z.literal("TESTER"),
      situation: free(160, "Situation trop longue."),
      usageReason: free(500, "Motif trop long."),
    }),
  ],
  { error: "Indiquez si vous êtes étudiant à l'ESATIC." },
);
export type ProfileInput = z.infer<typeof profileInputSchema>;

/** Colonnes à enregistrer : tout champ qui n'appartient pas à la catégorie choisie est remis à null. */
export function profileColumns(p: ProfileInput) {
  const empty = { institution: null, fieldCode: null, field: null, className: null, level: null, levelOther: null, situation: null, usageReason: null } as Record<string, string | null>;
  const level = (q: { className?: string; level: string; levelOther?: string }) => ({ className: q.className ?? null, level: q.level, levelOther: q.level === OTHER_LEVEL ? (q.levelOther ?? null) : null });
  switch (p.category) {
    case "ESATIC":
      return { ...empty, category: p.category, institution: ESATIC_NAME, fieldCode: p.fieldCode, field: p.fieldCode === OTHER_FIELD_CODE ? p.fieldOther! : ESATIC_FIELDS.find((f) => f.code === p.fieldCode)!.label, ...level(p) };
    case "OTHER_SCHOOL":
      return { ...empty, category: p.category, institution: p.institution, field: p.field, ...level(p) };
    case "TESTER":
      return { ...empty, category: p.category, situation: p.situation ?? null, usageReason: p.usageReason ?? null };
  }
}

const MAX_AVATAR_CHARS = 200_000;

/** Photo de profil : petite image déjà réduite par le navigateur, ou null pour la retirer. */
export const avatarSchema = z
  .string()
  .max(MAX_AVATAR_CHARS, "Image trop volumineuse.")
  .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/, "Format d'image non pris en charge.")
  .nullable();
