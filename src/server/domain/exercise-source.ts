// Nature d'un document déposé pour créer un exercice : un sujet d'exercices (TD, devoir, examen) est reproduit tel quel,
// un cours sert de matière pour de nouvelles questions. Heuristique locale, sans appel IA : l'étudiant peut toujours corriger.

export type DocumentKind = "sheet" | "course";

const HEADING = /^\s*(?:exercice|exercise|question|problème|probleme)\s*(?:n°\s*)?\d+/gim;
const IMPERATIVE = /(?:^|[.?!:\n]\s*)(?:calcul(?:er|ez)|montr(?:er|ez)|démontr(?:er|ez)|détermin(?:er|ez)|écri(?:re|vez)|donn(?:er|ez)|justifi(?:er|ez)|résou(?:dre|dez)|expliqu(?:er|ez)|propos(?:er|ez)|constru(?:ire|isez)|trouv(?:er|ez)|compl(?:éter|étez)|soit|soient|étant donné|que vaut|quelle|quel|quels|quelles)\b/gi;
const NAME = /\b(?:td|tp|ds)\d*\b|\b(?:examen|exam|devoir|sujet|partiel|interrogation|série|serie|exercices?|contrôle|controle)\b/i;

/** Un document est un sujet d'exercices si plusieurs en-têtes « Exercice n » / « Question n » y figurent, ou si le nom, le ton impératif et la structure concordent. */
export function detectDocumentKind(name: string, text: string): DocumentKind {
  const sample = text.slice(0, 40_000);
  const length = Math.max(sample.length, 1);
  const headings = (sample.match(HEADING) ?? []).length;
  const verbsPerThousand = ((sample.match(IMPERATIVE) ?? []).length / length) * 1000;
  const score = Math.min(headings, 2) + (NAME.test(name) ? 1 : 0) + (verbsPerThousand >= 1.5 ? 1 : 0);
  return score >= 2 ? "sheet" : "course";
}
