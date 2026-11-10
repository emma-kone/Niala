import { api } from "@/lib/client-api";
import { CATEGORY_LABEL, type ProfileCategory } from "@/config/academic";

export interface Profile {
  name: string | null;
  email: string;
  createdAt: string;
  avatar: string | null;
  category: ProfileCategory | null;
  institution: string | null;
  /** Classe et filière, écrites par l'étudiant (ex. « DASI 3 »). */
  field: string | null;
  situation: string | null;
  usageReason: string | null;
  auth: { password: boolean; google: boolean };
}

export const PROFILE_KEY = ["profile"] as const;
export const fetchProfile = () => api.get<{ profile: Profile }>("/api/profile").then((r) => r.profile);

/** Lignes du résumé affiché dans le menu du compte et dans Paramètres : seules celles qui ont un sens pour cette catégorie. */
export function profileSummary(p: Profile): { label: string; value: string }[] {
  const rows: { label: string; value: string | null }[] = [
    { label: "Profil", value: p.category ? CATEGORY_LABEL[p.category] : null },
    { label: "Établissement", value: p.institution },
    { label: "Classe / filière", value: p.field },
  ];
  return rows.filter((r): r is { label: string; value: string } => !!r.value);
}
