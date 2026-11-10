// Détection de la langue d'un texte de cours (français ou anglais), sans appel à l'IA : on compte les mots outils
// propres à chaque langue. Sert à générer un exercice dans la langue de son document.

export type ContentLang = "fr" | "en";

const FR = new Set("le la les des du un une et est sont dans pour par sur avec que qui ce cette ces au aux pas plus ne se son sa ses leur nous vous il elle ils elles on être avoir fait comme mais ou donc où entre selon lors chaque".split(" "));
const EN = new Set("the and of to is are in for on with that this these those by from as be was were it its which an not or but have has had can will would should their there into each between when where how what".split(" "));

/** Langue dominante d'un texte ; `fallback` si le texte est trop court ou ambigu. */
export function detectLanguage(text: string, fallback: ContentLang = "fr"): ContentLang {
  const words = text.toLowerCase().normalize("NFC").match(/[a-zàâäçéèêëîïôöùûüÿœ']+/g) ?? [];
  let fr = 0;
  let en = 0;
  for (const raw of words.slice(0, 6000)) {
    const w = raw.replace(/^[ldjmnstc]'/, "");
    if (FR.has(w)) fr++;
    if (EN.has(w)) en++;
  }
  if (fr + en < 8) return fallback;
  if (en > fr * 1.3) return "en";
  if (fr > en * 1.3) return "fr";
  return fallback;
}

/** Nom de la langue tel qu'il est écrit dans les consignes données au modèle. */
export const languageLabel = (lang: ContentLang) => (lang === "en" ? "anglais" : "français");
