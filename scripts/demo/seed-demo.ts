// ─────────────────────────────────────────────────────────────────────────────
// Données FICTIVES de démonstration, pour les captures d'écran de la page d'accueil. À lancer UNIQUEMENT sur la base
// locale (scripts/dev-db.mjs) : le script refuse toute autre base.
//   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/postgres?connection_limit=1 npx tsx scripts/demo/seed-demo.ts
// Compte créé : demo@niala.local / mot de passe affiché à la fin.
// ─────────────────────────────────────────────────────────────────────────────

const url = process.env.DATABASE_URL ?? "";
if (!/@(127\.0\.0\.1|localhost):/.test(url)) {
  console.error("Refus : ce script ne s'exécute que sur une base locale (127.0.0.1 ou localhost).");
  process.exit(1);
}

import type { AiProvider } from "@/server/ai/provider";

export const DEMO_EMAIL = "demo@niala.local";
export const DEMO_PASSWORD = "demo-niala-2026";

const MONDAY = "2026-11-09";
const addDays = (d: string, n: number) => new Date(new Date(`${d}T12:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
const hm = (h: number, m = 0) => h * 60 + m;

/** Contenu réaliste des questions, par matière : le faux fournisseur d'IA remplit les créneaux demandés. */
const BANK: Record<string, { qcm: [string, string[]][]; tf: [string, boolean][]; fill: [string, string][]; short: [string, string][]; concepts: string[] }> = {
  Algorithmique: {
    qcm: [["Quelle est la complexité de la recherche dichotomique dans un tableau trié ?", ["O(log n)", "O(n)", "O(n²)", "O(1)"]], ["Qu'est-ce qu'une fonction récursive ?", ["Une fonction qui s'appelle elle-même", "Une fonction sans paramètre", "Une boucle infinie", "Une fonction anonyme"]]],
    tf: [["Une fonction récursive doit toujours comporter un cas de base.", true], ["Le tri à bulles est en O(n log n) dans le pire cas.", false]],
    fill: [["Une pile suit le principe ___ (dernier entré, premier sorti).", "LIFO"]],
    short: [["Comment appelle-t-on la structure qui suit le principe « premier entré, premier sorti » ?", "file"]],
    concepts: ["Récursivité", "Complexité", "Structures de données"],
  },
  "Réseaux": {
    qcm: [["À quelle couche du modèle OSI appartient le protocole IP ?", ["Réseau", "Transport", "Liaison", "Application"]], ["Quel protocole attribue automatiquement une adresse IP ?", ["DHCP", "DNS", "ARP", "FTP"]]],
    tf: [["TCP garantit la livraison ordonnée des segments.", true], ["Une adresse IPv4 est codée sur 64 bits.", false]],
    fill: [["Le protocole ___ traduit un nom de domaine en adresse IP.", "DNS"]],
    short: [["Combien de couches compte le modèle OSI ?", "7"]],
    concepts: ["Modèle OSI", "Adressage IP", "Protocoles"],
  },
  "Bases de données": {
    qcm: [["Quelle clause SQL filtre les groupes après un GROUP BY ?", ["HAVING", "WHERE", "ORDER BY", "LIMIT"]], ["Une clé étrangère sert à…", ["référencer la clé primaire d'une autre table", "trier les lignes", "chiffrer une colonne", "créer un index unique"]]],
    tf: [["Une table en troisième forme normale est aussi en deuxième forme normale.", true], ["DELETE supprime la structure de la table.", false]],
    fill: [["La commande SQL ___ ajoute des lignes à une table.", "INSERT"]],
    short: [["Quel mot-clé SQL supprime les doublons d'un résultat ?", "DISTINCT"]],
    concepts: ["SQL", "Normalisation", "Modèle relationnel"],
  },
};

function fakeProvider(subjectOf: () => string): AiProvider {
  return {
    name: "demo",
    model: "demo",
    async complete(req) {
      const m = req.user.match(/Créneaux à remplir :\n(\[[\s\S]*?\])\n/);
      const slots = m ? (JSON.parse(m[1]) as { slot: number; type: string }[]) : [];
      const b = BANK[subjectOf()];
      const counters = { qcm: 0, tf: 0, fill: 0, short: 0 };
      const questions = slots.map((s) => {
        const base = { slot: s.slot, type: s.type, concepts: [b.concepts[s.slot % b.concepts.length]], explanation: "Revoyez la partie correspondante du cours.", source: { quote: "Extrait du cours de démonstration." } };
        if (s.type === "qcm_single") {
          const [statement, options] = b.qcm[counters.qcm++ % b.qcm.length];
          return { ...base, statement, options, correctIndex: 0 };
        }
        if (s.type === "true_false") {
          const [statement, answer] = b.tf[counters.tf++ % b.tf.length];
          return { ...base, statement, answer };
        }
        if (s.type === "fill_blank") {
          const [statement, word] = b.fill[counters.fill++ % b.fill.length];
          return { ...base, statement, blanks: [{ accepted: [word] }] };
        }
        const [statement, accepted] = b.short[counters.short++ % b.short.length];
        return { ...base, statement, accepted: [accepted] };
      });
      return { model: "demo", text: JSON.stringify({ questions, insufficient: [] }) };
    },
  };
}

async function main() {
  const { dbAll: db } = await import("@/lib/db");
  const { hashPassword } = await import("@/lib/auth");
  const prov = await import("@/server/ai/provider");
  const { createEvent } = await import("@/server/services/agenda/agenda");
  const { createTask } = await import("@/server/services/agenda/tasks");
  const { createNote } = await import("@/server/services/notes");
  const { createEmptyMap, saveMap } = await import("@/server/services/maps");
  const { generateFreeExercise } = await import("@/server/services/exercises/generation");
  const att = await import("@/server/services/exercises/attempts");

  const existing = await db.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (existing) {
    console.log("Compte de démonstration déjà présent : rien à faire.");
    return;
  }
  const user = await db.user.create({
    data: { email: DEMO_EMAIL, name: "Aïcha Traoré", passwordHash: hashPassword(DEMO_PASSWORD), settings: { create: {} }, profile: { create: { category: "ESATIC", institution: "ESATIC", level: "L3", field: "Informatique", className: "DASI 3" } } },
  });
  const U = user.id;

  const subjects: Record<string, string> = {};
  for (const [name, color, icon] of [["Algorithmique", "#8061b3", "code"], ["Réseaux", "#2f80ed", "network"], ["Bases de données", "#27ae60", "database"], ["Mathématiques", "#f2994a", "sigma"]] as const) {
    subjects[name] = (await db.subject.create({ data: { userId: U, name, color, icon } })).id;
  }
  // Documents (sans fichier) : ils peuplent la bibliothèque et les matières.
  for (const [subject, docs] of Object.entries({ Algorithmique: ["Cours 3 — Récursivité.pdf", "TD 2 — Tris.pdf"], "Réseaux": ["Chapitre 2 — Modèle OSI.pdf", "TP — Adressage IP.pdf"], "Bases de données": ["Cours — SQL avancé.pdf"], "Mathématiques": ["Probabilités — rappels.pdf"] })) {
    for (const [i, name] of docs.entries()) {
      const d = await db.document.create({ data: { userId: U, subjectId: subjects[subject], name, originalName: name, type: "pdf", size: 420_000 + i * 90_000, status: "READY", pageCount: 12 + i * 6, lastOpenedAt: new Date(Date.now() - (i + 1) * 3_600_000 * (subject === "Algorithmique" ? 1 : 30)), lastPage: 4 + i } });
      const v = await db.documentVersion.create({ data: { userId: U, documentId: d.id, number: 1, mime: "application/pdf", size: d.size, pageCount: d.pageCount, extractStatus: "READY" } });
      await db.document.update({ where: { id: d.id }, data: { currentVersionId: v.id } });
    }
  }

  // Emploi du temps de la semaine (cours hebdomadaires).
  const courses: [string, number, number, number, string, string][] = [
    ["Algorithmique", 0, hm(8), hm(10), "Salle B12", "M. Kouassi"],
    ["Réseaux", 0, hm(10, 15), hm(12, 15), "Labo réseaux", "Mme Yao"],
    ["Bases de données", 1, hm(8), hm(11), "Salle A04", "M. Diabaté"],
    ["Mathématiques", 2, hm(14), hm(16), "Amphi 2", "Mme N'Guessan"],
    ["Algorithmique", 2, hm(16, 15), hm(18), "Salle B12", "M. Kouassi"],
    ["Réseaux", 3, hm(9), hm(12), "Labo réseaux", "Mme Yao"],
    ["Bases de données", 4, hm(13), hm(15), "Salle A04", "M. Diabaté"],
  ];
  for (const [s, day, start, end, room, teacher] of courses) {
    await createEvent(U, { subjectId: subjects[s], kind: "COURSE", date: addDays(MONDAY, day), startMinutes: start, endMinutes: end, recurrence: "WEEKLY", weekPattern: "ALL", room, teacher, force: true } as never);
  }

  // Tâches et devoirs.
  for (const [title, s, type, due, priority] of [["Rendre le TP d'adressage IP", "Réseaux", "DEVOIR", addDays(MONDAY, 4), "HAUTE"], ["Réviser la récursivité", "Algorithmique", "REVISION", addDays(MONDAY, 3), "NORMALE"], ["Projet : modèle conceptuel de données", "Bases de données", "PROJET", addDays(MONDAY, 11), "HAUTE"], ["Exercices de probabilités", "Mathématiques", "DEVOIR", addDays(MONDAY, 6), "NORMALE"]] as const) {
    await createTask(U, { title, subjectId: subjects[s], type, dueDate: due, priority, status: "A_COMMENCER", estimatedMinutes: 90, requiresSubmission: type !== "REVISION", recurrence: "NONE" } as never).catch((e) => console.warn("tâche ignorée :", title, e instanceof Error ? e.message : e));
  }

  // Notes.
  const doc = (paragraphs: string[]) => ({ type: "doc", content: paragraphs.map((t) => ({ type: "paragraph", content: [{ type: "text", text: t }] })) });
  await createNote(U, { subjectId: subjects.Algorithmique, title: "Récursivité — l'essentiel", content: doc(["Toujours écrire le cas de base en premier.", "Chaque appel doit rapprocher du cas de base, sinon la récursion ne s'arrête jamais.", "Exemple : factorielle(n) = n × factorielle(n − 1), avec factorielle(0) = 1."]) });
  await createNote(U, { subjectId: subjects["Réseaux"], title: "Les 7 couches OSI", content: doc(["Physique, Liaison, Réseau, Transport, Session, Présentation, Application.", "Moyen mnémotechnique : « Pour Le Réseau, Tout Se Passe Automatiquement »."]) });
  await createNote(U, { subjectId: subjects["Bases de données"], title: "Jointures SQL", content: doc(["INNER JOIN : seulement les lignes qui correspondent des deux côtés.", "LEFT JOIN : toutes les lignes de gauche, même sans correspondance."]) });

  // Carte mentale.
  const map = await createEmptyMap(U, subjects["Réseaux"], "Modèle OSI", "CONCEPT" as never);
  const labels = ["Modèle OSI", "Physique", "Liaison", "Réseau", "Transport", "Session", "Présentation", "Application"];
  const nodes = labels.map((label, i) => ({ id: `node-demo-${String(i).padStart(2, "0")}`, label, origin: "USER", x: i === 0 ? 0 : Math.round(Math.cos(((i - 1) / 7) * 2 * Math.PI) * 320), y: i === 0 ? 0 : Math.round(Math.sin(((i - 1) / 7) * 2 * Math.PI) * 220) }));
  const edges = labels.slice(1).map((_, i) => ({ id: `edge-demo-${String(i).padStart(2, "0")}`, source: nodes[0].id, target: nodes[i + 1].id, type: "PART_OF", origin: "USER" }));
  const created = await db.mindMap.findFirstOrThrow({ where: { userId: U }, select: { id: true, revision: true } });
  await saveMap(U, (map as { id?: string }).id ?? created.id, { revision: created.revision, title: "Modèle OSI", nodes, edges }).catch((e) => console.warn("carte ignorée :", e instanceof Error ? e.message : e));

  // Exercices générés (faux fournisseur d'IA) puis tentatives corrigées par les règles.
  let current = "Algorithmique";
  prov.__setProviderForTests(fakeProvider(() => current));
  const plan: [string, string, number, boolean[]][] = [
    ["Algorithmique", "Récursivité et complexité", 6, [true, true, true, false, true, true]],
    ["Réseaux", "Modèle OSI et protocoles", 6, [true, false, true, true, false, true]],
    ["Bases de données", "Requêtes SQL", 6, [true, true, true, true, true, false]],
  ];
  for (const [subject, chapter, count, pattern] of plan) {
    current = subject;
    const r = (await generateFreeExercise(U, { source: "free", subject, chapter, level: "L3", title: `${subject} — ${chapter}`, questionCount: count, totalPoints: 20, types: ["qcm_single", "true_false", "fill_blank", "short_answer"], difficulty: "moyenne", saved: true })) as { id?: string; exerciseId?: string };
    const exId = r.id ?? r.exerciseId ?? (await db.exercise.findFirstOrThrow({ where: { userId: U, title: { startsWith: subject } }, orderBy: { createdAt: "desc" } })).id;
    const started = (await att.startAttempt(U, exId)) as { id?: string; attemptId?: string };
    const attemptId = started.id ?? started.attemptId!;
    const snap = (await db.exerciseAttempt.findUniqueOrThrow({ where: { id: attemptId } })).snapshot as { questions: { position: number; type: string; answerKey: Record<string, unknown> }[] };
    for (const q of snap.questions) {
      const good = pattern[(q.position - 1) % pattern.length];
      const k = q.answerKey;
      const value =
        q.type === "qcm_single" ? (good ? (k.correct as string[])[0] : "mauvaise réponse")
        : q.type === "true_false" ? (good ? k.answer : !k.answer)
        : q.type === "fill_blank" ? Object.fromEntries(Object.entries(k.answers as Record<string, string[]>).map(([b, v]) => [b, good ? v[0] : "?"]))
        : good ? (k.accepted as string[])[0] : "je ne sais pas";
      await att.saveAnswer(U, attemptId, q.position, value);
    }
    await att.submitAttempt(U, attemptId);
  }
  prov.__setProviderForTests(undefined);

  // Conversation avec l'assistant IA.
  const conv = await db.conversation.create({ data: { userId: U, scope: "GLOBAL", title: "Comprendre la récursivité" } });
  await db.conversationMessage.create({ data: { userId: U, conversationId: conv.id, role: "USER", content: "Peux-tu m'expliquer simplement la récursivité avec un exemple ?" } });
  await db.conversationMessage.create({ data: { userId: U, conversationId: conv.id, role: "ASSISTANT", content: "Une fonction **récursive** est une fonction qui s'appelle elle-même pour résoudre un problème plus petit.\n\n**Exemple : la factorielle**\n\n```python\ndef factorielle(n):\n    if n == 0:        # cas de base\n        return 1\n    return n * factorielle(n - 1)\n```\n\n1. Le **cas de base** (`n == 0`) arrête les appels.\n2. Chaque appel **rapproche** du cas de base (`n - 1`).\n\nVeux-tu que je te propose un exercice pour t'entraîner ?" } });

  console.log(`Compte de démonstration prêt : ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
