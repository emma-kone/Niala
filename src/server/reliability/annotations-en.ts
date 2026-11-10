// Traduction anglaise des avertissements de fiabilité placés dans le texte d'une réponse, quand l'étudiant discute en anglais.
// Les textes français sont produits par confidence.ts ; toute phrase inconnue reçoit un avertissement générique.

const EXACT: Record<string, string> = {
  "Il s'agit d'une hypothèse, et non d'un fait établi.": "This is a hypothesis, not an established fact.",
  "Il s'agit d'une interprétation probable, et non d'un fait directement établi.": "This is a likely interpretation, not a directly established fact.",
  "Il s'agit d'une opinion, et non d'un fait établi.": "This is an opinion, not an established fact.",
  "Aucune source consultée ne permet de confirmer ce point.": "None of the sources consulted confirms this point.",
  "Votre cours affirme ceci, mais une source de référence indique autre chose : à vérifier auprès de votre enseignant.": "Your course states this, but a reference source says otherwise: check with your teacher.",
  "Les sources disponibles présentent des informations contradictoires sur ce point.": "The available sources contradict each other on this point.",
  "Cette affirmation est contredite par une source de référence.": "This statement is contradicted by a reference source.",
  "Cette information ne repose que sur des sources non vérifiées.": "This information relies only on unverified sources.",
  "Cette information est rapportée sur un forum spécialisé, mais elle n'a pas été confirmée par une documentation officielle.": "This information comes from a specialised forum and has not been confirmed by official documentation.",
  "Il s'agit d'une déduction à partir des sources, et non d'un fait directement établi.": "This is inferred from the sources, not a directly established fact.",
  "Ce point sensible n'est confirmé que par une seule source indépendante.": "This sensitive point is confirmed by only one independent source.",
};

export function annotationInEnglish(text: string): string {
  if (EXACT[text]) return EXACT[text];
  const outdated = /^Cette information pourrait être obsolète \(source de (\d{4})\)\.$/.exec(text);
  if (outdated) return `This information may be out of date (source from ${outdated[1]}).`;
  return "Unverified: check the sources.";
}
