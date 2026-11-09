// Relevé réel de « DASI 3.pdf » (emploi du temps ESATIC, semestre 5, partie 2) : positions des textes dans la page.
import type { TextItem } from "./pdf-layout";

const WIDTH_PER_CHAR = 3.7;
const line = (y: number, parts: [number, string][]): TextItem[] => parts.map(([x, s]) => ({ x, y, s, w: s.length * WIDTH_PER_CHAR }));
const code = (y: number, value: string, columns: number[]) => line(y, columns.map((x): [number, string] => [x, value]));

const S = [133, 206, 279, 351, 424, 497, 569];

export const DASI_ITEMS: TextItem[] = [
  ...line(474, [[62, "SEMAINES"], [146, "1"], [219, "2"], [291, "3"], [364, "4"], [436, "5"], [509, "6"], [582, "7"], [654, "8"], [724, "9"], [792, "10"]]),
  ...line(465, [[68, "DATES"], [128, "02/11/2026"], [201, "09/11/2026"], [273, "16/11/2026"], [346, "23/11/2026"], [418, "30/11/2026"], [491, "07/12/2026"], [564, "14/12/2026"], [636, "21/12/2026"], [706, "28/12/2026"], [776, "04/01/2027"]]),
  ...line(450, [[61, "7h30 -10h00"]]),
  ...line(438, [[59, "10h15 -12h45"]]), ...code(438, "1INF3403", S.slice(0, 7)),
  ...line(429, [[36, "LUNDI"]]),
  ...line(426, [[59, "14h30 -17h00"]]), ...code(426, "1INF3404", S.slice(0, 5)),
  ...line(414, [[61, "7h30 -10h00"]]), ...code(414, "1INF3400", S.slice(0, 7)),
  ...line(399, [[59, "10h15 -12h45"], [569, "1INF3400"]]),
  ...line(390, [[36, "MARDI"]]),
  ...line(387, [[59, "14h30 -17h00"], [137, "APP 3"], [210, "APP 3"], [283, "APP 3"], [355, "APP 3"], [428, "APP 3"], [500, "APP 3"], [571, "DASI 3"]]),
  ...line(372, [[61, "7h30 -10h00"]]), ...code(372, "1INF3404", S.slice(0, 5)),
  ...line(360, [[59, "10h15 -12h45"]]), ...code(360, "1INF3403", S.slice(0, 7)),
  ...line(348, [[138, "SPORT"], [204, "COACHING"], [283, "SPORT"], [349, "COACHING"], [429, "SPORT"], [495, "COACHING"], [574, "SPORT"]]),
  ...line(345, [[36, "MERCREDI"], [59, "16h30 -18h00"]]),
  ...line(333, [[61, "7h30 -10h00"]]), ...code(333, "1MAN3401", [132, 205, 277, 350, 422]),
  ...line(318, [[59, "10h15 -12h45"]]), ...code(318, "1MAN3401", [132, 205, 277, 350, 422]),
  ...line(312, [[36, "JEUDI"]]),
  ...line(306, [[59, "14h30 -17h00"]]), ...code(306, "1INF3405", S.slice(0, 7)),
  ...line(291, [[61, "7h30 -10h00"]]), ...code(291, "1INF3405", [133, 206, 279, 351, 497, 569]),
  ...line(282, [[423, "JOURNEE"]]),
  ...line(279, [[59, "10h15 -12h45"], [133, "1INF3405"], [205, "1MAN3400"], [277, "1MAN3400"], [350, "1MAN3400"], [495, "1MAN3400"], [568, "1MAN3400"]]),
  ...line(273, [[417, "CULTURELLE"]]),
  ...line(264, [[59, "14h30 -17h00"]]), ...code(264, "1MAN3400", [132, 205, 277, 350, 495]),
  ...line(261, [[36, "VENDREDI"]]),
  ...line(243, [[122, "JOURNEE DE LA"], [261, "DEVOIRS ET COURS"], [333, "DEVOIRS ET COURS"], [406, "DEVOIRS ET COURS"], [479, "DEVOIRS ET COURS"], [551, "DEVOIRS ET COURS"]]),
  ...line(240, [[69, "8h-12h"]]),
  ...line(234, [[126, "SALUBRITE 1"], [266, "DE RATTRAPAGE"], [339, "DE RATTRAPAGE"], [411, "DE RATTRAPAGE"], [484, "DE RATTRAPAGE"], [556, "DE RATTRAPAGE"]]),
  ...line(228, [[36, "SAMEDI"]]),
  ...line(207, [[71, "CODE"], [213, "ECUE"], [634, "ENSEIGNANTS"]]),
  ...line(192, [[47, "1MAN3400"], [113, "Gestion de projets"]]),
  // Texte vertical des cellules fusionnées (congé, examens) : des lettres isolées.
  ...line(432, [[648, "C"], [719, "C"]]),
  ...line(423, [[647, "O"], [718, "O"]]),
];

const course = (code: string | null, matiere: string, jour: number, debut: string, fin: string, semaines: number[]) => ({ code, matiere, jour, debut, fin, semaines, semaine: "ALL" as const, recurrent: true, confiance: "elevee" as const });

/** Réponse du modèle observée lors d'un essai réel : colonnes décalées après une cellule vide le vendredi et le samedi. */
export const DASI_AI_ANSWER = {
  semaines: ["2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23", "2026-11-30", "2026-12-07", "2026-12-14", "2026-12-21", "2026-12-28", "2027-01-04"].map((debut, i) => ({ numero: i + 1, debut })),
  matieres: [
    { code: "1MAN3400", intitule: "Gestion de projets", enseignant: "Dr DOHO LIBAUD RUDY EURELIEN" },
    { code: "1MAN3401", intitule: "Entrepreunariat", enseignant: "M. SILUE YACOUBA" },
    { code: "1INF3400", intitule: "UML et Java", enseignant: "Dr JOHNSON GRACE Epse KOUASSI" },
    { code: "1INF3403", intitule: "Java EE", enseignant: "Dr KIE EBA VICTOIRE" },
    { code: "1INF3404", intitule: "AGL avec la méthode AGILE", enseignant: "M. N'DRIN HUGUES AUGUSTE" },
    { code: "1INF3405", intitule: "Développement web et multimédia", enseignant: "M. N'GOUANDI EHOUMAN FRANCK" },
  ],
  cours: [
    course("1INF3403", "Java EE", 1, "10:15", "12:45", [1, 2, 3, 4, 5, 6, 7]),
    course("1INF3404", "AGL avec la méthode AGILE", 1, "14:30", "17:00", [1, 2, 3, 4, 5]),
    course("1INF3400", "UML et Java", 2, "07:30", "10:00", [1, 2, 3, 4, 5, 6, 7]),
    course("1INF3400", "UML et Java", 2, "10:15", "12:45", [7]),
    course(null, "APP 3", 2, "14:30", "17:00", [1, 2, 3, 4, 5, 6]),
    course(null, "DASI 3", 2, "14:30", "17:00", [7]),
    course("1INF3404", "AGL avec la méthode AGILE", 3, "07:30", "10:00", [1, 2, 3, 4, 5]),
    course("1INF3403", "Java EE", 3, "10:15", "12:45", [1, 2, 3, 4, 5, 6, 7]),
    course(null, "SPORT", 3, "16:30", "18:00", [1, 3, 5, 7]),
    course(null, "COACHING", 3, "16:30", "18:00", [2, 4, 6]),
    course("1MAN3401", "Entrepreunariat", 4, "07:30", "10:00", [1, 2, 3, 4, 5]),
    course("1MAN3401", "Entrepreunariat", 4, "10:15", "12:45", [1, 2, 3, 4, 5]),
    course("1INF3405", "Développement web et multimédia", 4, "14:30", "17:00", [1, 2, 3, 4, 5, 6, 7]),
    course("1INF3405", "Développement web et multimédia", 5, "07:30", "10:00", [1, 2, 3, 4, 5, 6]),
    course("1INF3405", "Développement web et multimédia", 5, "10:15", "12:45", [1]),
    course("1MAN3400", "Gestion de projets", 5, "10:15", "12:45", [2, 3, 4, 5, 6]),
    course(null, "JOURNEE CULTURELLE", 5, "10:15", "12:45", [5]),
    course("1MAN3400", "Gestion de projets", 5, "14:30", "17:00", [1, 2, 3, 4, 5, 6]),
    course(null, "JOURNEE DE LA SALUBRITE 1", 6, "08:00", "12:00", [1]),
    course(null, "DEVOIRS ET COURS DE RATTRAPAGE", 6, "08:00", "12:00", [2, 3, 4, 5, 6, 7]),
  ],
  periodes: [
    { libelle: "CONGE DE NOEL ET DU NOUVEL AN", type: "CONGE" as const, semaines: [8, 9], confiance: "elevee" as const },
    { libelle: "EXAMENS DEUXIEME PARTIE SEMESTRES IMPAIRS", type: "EXAMEN" as const, semaines: [10], confiance: "elevee" as const },
  ],
};
