// Compétences ABSTRAITES, communes aux langages : elles permettent de rapprocher une erreur de condition en Python,
// en JavaScript et en SQL sans confondre leurs règles propres (la syntaxe reste propre à chaque langage).
// Le rapprochement n'est qu'une HYPOTHÈSE à vérifier : il ne dit jamais « l'étudiant ne comprend pas ».

export interface SkillInfo {
  key: string;
  label: string;
  /** Les langages concernés conservent leurs différences : rappel affiché avec le rapprochement. */
  note?: string;
}

const SKILLS: Record<string, SkillInfo> = {
  syntaxe: { key: "syntaxe", label: "Écriture correcte des instructions", note: "La syntaxe est propre à chaque langage." },
  "conditions-arret": { key: "conditions-arret", label: "Conditions d'arrêt et terminaison des boucles" },
  "cas-limites": { key: "cas-limites", label: "Gestion des cas limites (vide, zéro, valeurs absentes)" },
  "logique-resultat": { key: "logique-resultat", label: "Résultat conforme à l'attendu (raisonnement logique)" },
  "respect-consigne": { key: "respect-consigne", label: "Respect de la consigne (noms, forme, format imposés)" },
  "agregation-filtrage": { key: "agregation-filtrage", label: "Filtrer des lignes et filtrer des groupes", note: "En SQL : WHERE avant le regroupement, HAVING après." },
  "valeurs-nulles": { key: "valeurs-nulles", label: "Valeurs absentes (NULL, null, None)", note: "La comparaison à une valeur absente s'écrit différemment selon le langage." },
  "erreurs-execution": { key: "erreurs-execution", label: "Anticiper les erreurs à l'exécution" },
  calcul: { key: "calcul", label: "Exactitude des calculs" },
};

/** Compétence associée à un constat des outils (clé `kind` des diagnostics). */
export function skillForKind(kind: string): SkillInfo | null {
  switch (kind) {
    case "syntax":
      return SKILLS.syntaxe;
    case "timeout":
      return SKILLS["conditions-arret"];
    case "edge_case":
      return SKILLS["cas-limites"];
    case "wrong_output":
    case "partial":
      return SKILLS["logique-resultat"];
    case "format":
    case "instructions":
    case "schema_name":
      return SKILLS["respect-consigne"];
    case "sql_where_having":
      return SKILLS["agregation-filtrage"];
    case "sql_null_comparison":
      return SKILLS["valeurs-nulles"];
    case "runtime":
      return SKILLS["erreurs-execution"];
    default:
      return null;
  }
}

export const skillInfo = (key: string): SkillInfo | null => SKILLS[key] ?? null;

export interface SkillObservationView {
  skill: string;
  language: string | null;
  activity: string;
  at: Date;
}

export interface CrossInsight {
  skill: string;
  label: string;
  note?: string;
  occurrences: number;
  languages: string[];
  activities: string[];
  /** Toujours vrai : un rapprochement entre langages est une hypothèse à confirmer par une question ciblée. */
  needsVerification: true;
  statement: string;
}

/**
 * Difficultés récurrentes : même compétence en échec au moins 3 fois sur au moins 2 jours différents, dans la fenêtre.
 * `crossLanguage` : observée dans au moins deux langages ou activités différents.
 */
export function recurringDifficulties(observations: SkillObservationView[], now: Date = new Date(), windowDays = 45): CrossInsight[] {
  const since = now.getTime() - windowDays * 24 * 3600 * 1000;
  const bySkill = new Map<string, SkillObservationView[]>();
  for (const o of observations) if (o.at.getTime() >= since) bySkill.set(o.skill, [...(bySkill.get(o.skill) ?? []), o]);
  const out: CrossInsight[] = [];
  for (const [skill, list] of bySkill) {
    const info = skillInfo(skill);
    if (!info || list.length < 3) continue;
    const days = new Set(list.map((o) => o.at.toISOString().slice(0, 10))).size;
    if (days < 2) continue;
    const languages = [...new Set(list.map((o) => o.language).filter((l): l is string => !!l))];
    const activities = [...new Set(list.map((o) => o.activity))];
    const multi = languages.length >= 2 || activities.length >= 2;
    out.push({
      skill,
      label: info.label,
      note: info.note,
      occurrences: list.length,
      languages,
      activities,
      needsVerification: true,
      statement: multi
        ? `Difficulté possible sur « ${info.label} » : observée ${list.length} fois, dans ${[...languages.map((l) => l.toUpperCase())].join(", ") || activities.join(", ")}. À vérifier par une question ciblée.`
        : `Difficulté qui se répète sur « ${info.label} » (${list.length} fois sur ${days} jours).`,
    });
  }
  return out.sort((a, b) => b.occurrences - a.occurrences);
}
