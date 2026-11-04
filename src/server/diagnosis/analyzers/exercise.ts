import type { Diagnosis } from "@/server/domain/lab-tests";
import type { QuestionType } from "@/server/domain/exercise-model";
import { normalizeAnswer } from "@/server/domain/exercise-grading";
import { RELATION_TEXT, type NumericRelation } from "@/server/domain/numeric";

// Analyseur des exercices classiques (QCM, vrai/faux, textes à compléter, réponses courtes et numériques, appariement,
// définitions et questions ouvertes). Les FAITS viennent de la correction (réponse attendue vs donnée, critères manqués) ;
// ce qu'ils révèlent de la compréhension reste une HYPOTHÈSE de confiance modérée, jamais présentée comme établie.

export interface ExerciseObservation {
  diagnoses: Diagnosis[];
  /** Faits observés, présentables tels quels à l'étudiant. */
  facts: string[];
  observed?: unknown;
}

const d = (category: Diagnosis["category"], kind: Diagnosis["kind"], label: string, confidence: number): Diagnosis => ({ category, kind, confidence, label, tests: [] });

/** Distance d'édition (Levenshtein) bornée : sert à reconnaître une faute de frappe plutôt qu'une mauvaise réponse. */
export function editDistance(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/** La réponse est-elle à une ou deux lettres près de l'une des réponses acceptées ? */
export function nearMiss(given: string, accepted: string[]): string | null {
  const g = normalizeAnswer(given);
  if (g.length < 4) return null;
  for (const a of accepted) {
    const n = normalizeAnswer(a);
    if (n.length >= 4 && n !== g && editDistance(g, n, 2) <= (n.length >= 8 ? 2 : 1)) return a;
  }
  return null;
}

export interface GradeView {
  verdict: string;
  detail?: Record<string, unknown>;
}

export function analyzeExerciseAnswer(type: QuestionType, key: Record<string, unknown>, value: unknown, grade: GradeView): ExerciseObservation {
  const out: Diagnosis[] = [];
  const facts: string[] = [];
  const detail = grade.detail ?? {};

  switch (type) {
    case "qcm_single":
    case "true_false": {
      facts.push(type === "true_false" ? `Réponse donnée : ${value === true ? "vrai" : "faux"} ; réponse attendue : ${key.answer === true ? "vrai" : "faux"}.` : "Le choix effectué n'est pas la bonne proposition.");
      out.push(d("CONCEPT", "wrong_output", "Mauvais choix : la notion concernée est peut-être mal comprise (une seule réponse ne suffit pas à l'affirmer).", 0.4));
      break;
    }
    case "qcm_multiple": {
      const hits = Number(detail.hits ?? 0);
      const wrong = Number(detail.wrong ?? 0);
      const total = Number(detail.total ?? 0);
      if (wrong === 0 && hits < total) {
        facts.push(`${hits} bonne(s) réponse(s) sur ${total} : aucune proposition fausse n'est cochée, mais ${total - hits} bonne(s) manque(nt).`);
        out.push(d("FORGETTING", "partial", "Réponse juste mais incomplète : des propositions correctes n'ont pas été cochées (oubli ou doute).", 0.5));
      } else {
        facts.push(`${wrong} proposition(s) fausse(s) cochée(s) ; ${hits} bonne(s) réponse(s) sur ${total}.`);
        out.push(d("CONCEPT", "wrong_output", "Des propositions fausses ont été choisies : une confusion entre notions voisines est possible.", 0.45));
      }
      break;
    }
    case "fill_choices":
    case "fill_blank": {
      const blanks = (detail.blanks ?? {}) as Record<string, boolean>;
      const answers = (key.answers ?? {}) as Record<string, string | string[]>;
      const given = (value ?? {}) as Record<string, string>;
      const failed = Object.entries(blanks).filter(([, ok]) => !ok).map(([id]) => id);
      facts.push(`${Object.keys(blanks).length - failed.length} trou(s) juste(s) sur ${Object.keys(blanks).length}.`);
      const typos = type === "fill_blank" ? failed.filter((id) => nearMiss(String(given[id] ?? ""), [answers[id]].flat().map(String))) : [];
      if (typos.length) {
        facts.push(`${typos.length} trou(s) à une ou deux lettres près de la bonne réponse (faute d'orthographe ou de frappe probable).`);
        out.push(d("CARELESS", "partial", "Réponse très proche de la bonne : une faute de frappe ou d'orthographe est possible (hypothèse).", 0.55));
      }
      if (failed.length > typos.length) out.push(d("CONCEPT", "wrong_output", "Des termes ou notions attendus ne sont pas ceux donnés : à revoir.", 0.4));
      break;
    }
    case "short_answer": {
      const numeric = detail.numeric as { relation: NumericRelation; expected: number } | undefined;
      if (numeric) {
        const rel = numeric.relation;
        if (rel === "different") {
          facts.push("Le résultat numérique ne correspond pas à la valeur attendue.");
          out.push(d("LOGIC", "numeric", "Résultat de calcul incorrect.", 0.8));
        } else if (rel !== "equal" && rel !== "rounded") {
          facts.push(RELATION_TEXT[rel]);
          out.push(d("LOGIC", "numeric", `Résultat de calcul incorrect : ${RELATION_TEXT[rel]}`, 0.8));
          // Le schéma d'écart est un constat ; l'inattention n'est qu'une explication possible
          if (rel === "opposite" || rel === "off_by_one") out.push(d("CARELESS", "partial", "Écart typique d'une étourderie de calcul (signe ou décalage d'une unité) : hypothèse à vérifier.", 0.45));
        }
        break;
      }
      const near = nearMiss(String(value), (key.accepted as string[]) ?? []);
      if (near) {
        facts.push("La réponse est à une ou deux lettres près d'une réponse acceptée.");
        out.push(d("CARELESS", "partial", "Réponse très proche de la bonne : une faute de frappe ou d'orthographe est possible (hypothèse).", 0.55));
      } else {
        facts.push("La réponse ne correspond à aucune réponse acceptée.");
        out.push(d("CONCEPT", "wrong_output", "Réponse différente de celle attendue : la notion est peut-être à revoir.", 0.4));
      }
      break;
    }
    case "matching": {
      const pairs = (detail.pairs ?? {}) as Record<string, boolean>;
      const expected = (key.pairs ?? {}) as Record<string, string>;
      const given = (value ?? {}) as Record<string, string>;
      const wrongs = Object.entries(pairs).filter(([, ok]) => !ok).map(([l]) => l);
      facts.push(`${Object.keys(pairs).length - wrongs.length} association(s) juste(s) sur ${Object.keys(pairs).length}.`);
      // Deux éléments dont les associations sont échangées : confusion explicite entre deux notions (fait observable)
      const swapped = wrongs.filter((l) => wrongs.some((o) => o !== l && given[l] === expected[o] && given[o] === expected[l]));
      if (swapped.length >= 2) {
        facts.push(`Les associations de « ${swapped[0]} » et « ${swapped[1]} » sont échangées.`);
        out.push(d("CONCEPT", "wrong_output", `Confusion entre deux notions : « ${swapped[0]} » et « ${swapped[1]} » ont été associées l'une à la place de l'autre.`, 0.65));
      } else if (wrongs.length) out.push(d("CONCEPT", "wrong_output", "Des associations sont incorrectes : les notions concernées sont peut-être à revoir.", 0.4));
      break;
    }
    case "definition":
    case "open": {
      const criteria = (detail.criteria ?? []) as { label: string; met: boolean }[];
      const keyPoints = (detail.keyPoints ?? []) as { point: string; found: boolean }[];
      const missing = [...criteria.filter((c) => !c.met).map((c) => c.label), ...keyPoints.filter((k) => !k.found).map((k) => k.point), ...(((detail.missing as string[] | undefined) ?? []))];
      const unique = [...new Set(missing)];
      const total = criteria.length || keyPoints.length;
      if (unique.length) facts.push(`Éléments attendus non retrouvés : ${unique.slice(0, 4).join(" ; ")}${unique.length > 4 ? "…" : ""}`);
      if (grade.verdict === "partial") out.push(d("FORGETTING", "partial", `Réponse partielle : ${unique.length || "des"} élément(s) attendu(s) manque(nt)${total ? ` sur ${total}` : ""}.`, 0.5));
      else out.push(d("CONCEPT", "wrong_output", "La réponse ne couvre pas les éléments attendus : la notion est peut-être à revoir.", 0.45));
      break;
    }
    default:
      break;
  }
  return { diagnoses: out, facts, observed: value ?? undefined };
}
