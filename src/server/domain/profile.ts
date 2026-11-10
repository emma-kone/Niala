import { z } from "zod";
import { ESATIC_NAME } from "@/config/academic";

// ─────────────────────────────────────────────────────────────────────────────
// Profil académique : validation commune à l'inscription et à la page « Mon profil ».
// Chaque catégorie ne porte que ses propres champs ; ceux des autres catégories sont effacés à l'enregistrement.
// Un seul champ libre décrit la classe et la filière, écrit par l'étudiant lui-même (ex. « DASI 3 ») : plus de liste ni de niveau séparé.
// ─────────────────────────────────────────────────────────────────────────────

const free = (max: number, tooLong: string) => z.string().trim().max(max, tooLong).optional().transform((v) => v || undefined);
const required = (label: string, max = 120) => z.string({ error: `Indiquez ${label}.` }).trim().min(2, `Indiquez ${label}.`).max(max, `Valeur trop longue pour ${label}.`);

export const profileInputSchema = z.discriminatedUnion(
  "category",
  [
    z.object({
      category: z.literal("ESATIC"),
      field: required("votre classe ou filière (ex. DASI 3)", 60),
    }),
    z.object({
      category: z.literal("OTHER_SCHOOL"),
      institution: required("le nom de votre établissement", 160),
      field: required("votre classe ou filière", 60),
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
  // fieldCode, className, level et levelOther (anciens champs) ne sont plus renseignés : ils restent null.
  const empty = { institution: null, fieldCode: null, field: null, className: null, level: null, levelOther: null, situation: null, usageReason: null } as Record<string, string | null>;
  switch (p.category) {
    case "ESATIC":
      return { ...empty, category: p.category, institution: ESATIC_NAME, field: p.field };
    case "OTHER_SCHOOL":
      return { ...empty, category: p.category, institution: p.institution, field: p.field };
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
