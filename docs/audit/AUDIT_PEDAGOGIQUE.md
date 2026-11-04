# Audit de cohérence pédagogique

Date : 2026-11-04. Question posée : *Niala accompagne-t-il réellement l'apprentissage, ou ses fonctionnalités restent-elles indépendantes ?*

**Réponse courte** : le **noyau** est réellement intégré — document → notions → exercices (avec citations) → tentatives → diagnostic → maîtrise → recommandations → tableau de bord est câblé de bout en bout dans le code et vérifié par `journey.test.ts`. En revanche **deux zones** restent isolées du suivi (chat, lecture/notes) et **une brèche** laisse entrer des notions sans source. Rien de cela n'a été observé avec de vraies données d'étudiant ni avec le vrai modèle.

## Chaîne de valeur : ce qui est réellement connecté

| Maillon | Lien en base | Constat |
|---|---|---|
| Matière → Document → Version → Passages | `Subject`, `Document.currentVersionId`, `DocumentChunk(versionId)` | Réel (import testé) |
| Version → Plan → Notions | `DocumentAnalysis(versionId)` → `CourseSection`, `ConceptSource(analysisId, page, origin)` | Provenance `DOCUMENT`/`AI_INFERRED` distinguée ; **citation vérifiée** |
| Notions → Questions | `QuestionConcept` | Alimenté à la génération (`generation.ts:481`) |
| Questions → Tentative figée | `ExerciseAttempt.snapshot` | Reprise cohérente ; version de document conservée (`ExerciseSource.versionNumber`) |
| Réponse → Diagnostic → Observation de compétence | `ErrorDiagnosis`/`DiagnosisReport` → `SkillObservation` | Constats d'outils = faits ; concept/inattention = **hypothèses** (explicite) |
| Preuves → Maîtrise | `ConceptMastery(level, confidence, state)` | Recalcul idempotent ; « confirmée » exige ≥ 4 réussites sur 3 tentatives, 2 jours d'écart |
| Maîtrise → Recommandation | `LearningRecommendation(reason: preuves)` | Chaque recommandation porte ses preuves chiffrées |
| Tableau de bord ← données | `/api/dashboard` | Réel : compteurs documents/exercices/notes/notions calculés en base (vérifié) |

## Incohérences et risques

| ID | Constat | Gravité | Preuve | Priorité |
|---|---|---|---|---|
| PED-01 | **Notions sans source** : `generation.ts:438-439` crée un `Concept` (`kind: NOTION`) pour tout nom proposé par l'IA qui n'existe pas dans la matière, sans `ConceptSource`. Cette notion devient mesurable (maîtrise, recommandations) alors qu'aucun passage n'établit son existence | Élevée | Confirmé (code) | P1 |
| PED-02 | Suppression d'une matière : notions et maîtrise supprimées, tentatives conservées sans exercice (DB-02) → historique sans référent | Élevée | Confirmé | P1 |
| PED-03 | Notions tronquées à l'analyse (AI-01) : exercices « par notion » et progression ignorent la fin des longues sections | Élevée | Confirmé | P1 |
| PED-04 | Le chat ne produit aucune activité ni observation (`LearningActivity` n'est créée que par lecture, exercice, labo) ; les questions posées à l'assistant n'alimentent ni profil ni recommandation, alors que `docs/FONCTIONNALITES-ET-LIMITES.md` dit que le chat **reçoit** le profil (sens unique) | Moyenne | Confirmé | P2 |
| PED-05 | La lecture et les notes ne touchent pas la maîtrise (aucune notion rattachée) : « Une note n'est pas une maîtrise » est un choix de conception assumé, mais lecture/notes restent hors du tableau « Où j'en suis ? » hormis la reprise | Faible | Confirmé | P3 |
| PED-06 | Type d'activité `REVISION` défini, jamais créé : pas de parcours de révision réel | Faible | Confirmé | P3 |
| PED-07 | Seuils (demi-vie 30 j, poids de difficulté, 45 jours « à revérifier », confiance 0,4–0,65) **non calibrés**, et « difficulté récurrente » repose sur 3 observations/2 jours : correct comme hypothèse, mais présenté dans la page Progression comme profil | Moyenne | Confirmé (doc) | P2 |
| PED-08 | Un exercice **mélange** `Exercise.documentId` (source principale) et `ExerciseSource[]` : « notions » et « notions difficiles » ne s'appliquent qu'au document de départ (documenté) → exercice multi-sources déséquilibré côté notions | Faible | Confirmé (doc) | P3 |
| PED-09 | Les sessions V1 ne comptent pas et ne sont plus consultables (données conservées) : perte de continuité pour un utilisateur V1 | Moyenne | Confirmé (doc) | P2 |
| PED-10 | Diagnostics sur des QCM isolés : hypothèses faibles par construction — correct, mais **deux modèles de diagnostic** (DB-03) peuvent diverger | Moyenne | Confirmé / À vérifier (divergence) | P2 |

## Réponses aux questions de l'audit
- *Notions sans source identifiable ?* Oui, voie PED-01.
- *Exercices sans lien clair avec les notions ?* Le lien existe (`QuestionConcept`) mais peut viser une notion créée sans source (PED-01).
- *Diagnostics qui ne correspondent pas aux réponses ?* Non constaté ; le garde-fou `validateInterpretation` écarte l'IA qui contredit l'outil (14 tests). Non évalué sur de vraies réponses.
- *Maîtrise sur trop peu d'observations ?* Non : un seul essai → « estimation prudente », jamais d'état tranché (tests `progress.test.ts`, `mastery.test.ts`).
- *Recommandations sans justification ?* Non : le champ `reason` contient texte + preuves ; recommandation écartée non réaffichée 7 jours (testé).
- *Prérequis incohérents ?* Un prérequis n'est désigné fragile que mesuré et après récidive ; en revanche les relations `PREREQUISITE` extraites par l'IA ne sont vérifiées que par citation facultative (origine `AI_INFERRED` possible) — **À vérifier** sur de vrais cours.
- *Progression calculée avec données incomplètes ?* Oui par construction (PED-03, PED-04, PED-09), mais l'interface affiche la **confiance** (bon signe).
- *Perte de contexte à la reprise ?* Les tentatives sont figées et reprennent à `lastPosition` ; la reprise d'un chat se fait par conversation persistée. **Reprise après fermeture de session non exécutée en réel** (À vérifier).
- *Contradictions dashboard / pages détaillées ?* Non observées (pas de données) ; les deux lisent les mêmes services `progress`. Test automatique : `progress.test.ts`.

## Verdict
Niala **n'est pas** une collection d'outils indépendants : le noyau exercices → diagnostic → maîtrise → recommandation est un vrai système avec garde-fous. Les trois points qui peuvent lui faire perdre sa crédibilité pédagogique sont PED-01 (notions sans source), AI-01 (analyse partielle non signalée) et DB-02 (perte/orphelinage lors d'une suppression). Les corriger avant d'ajouter des fonctionnalités.
