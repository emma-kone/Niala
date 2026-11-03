# Schéma de données (Prisma / Postgres)

Source de vérité : `prisma/schema.prisma`. Toutes les tables portent `userId` (ou en dépendent via une matière) et sont supprimées en cascade avec l'utilisateur.

## Organisation et documents
| Modèle | Rôle |
|---|---|
| `User`, `UserSettings` | Compte et réglages |
| `Subject` | Matière |
| `Folder` | Dossier libre et récursif d'une matière (nom unique par dossier) |
| `Document` | Fichier de l'étudiant (nom, type, dossier, version courante, dernière page lue) |
| `DocumentVersion` | **Version immuable** : fichier original (`storageKey`, SHA-256, mime, taille), état d'extraction (`ExtractStatus`), avertissements |
| `DocumentChunk` | Texte extrait indexé par page et décalages (sert à la recherche, au lecteur de repli et aux citations ; jamais à remplacer l'original) |

## Analyse pédagogique
| Modèle | Rôle |
|---|---|
| `DocumentAnalysis` | Une analyse par version de document (modèle, version de prompt, statut, résumé) |
| `CourseSection` | Plan hiérarchique fidèle à la numérotation (CHAPITRE > I > A > 1 > a), pages, `Origin` |
| `Concept` | Notion **d'une matière** (nom normalisé unique par matière et type), importance 1–3 |
| `ConceptSource` | Où une notion apparaît (section, définition, citations) et son origine |
| `ConceptRelation` | Relation typée (`PREREQUISITE`, `PART_OF`, `EXAMPLE_OF`, `DEFINES`, `CONTRASTS`, `RELATED`) avec provenance |

## Notes et cartes
| Modèle | Rôle |
|---|---|
| `Note` / `NoteLink` | Note unifiée (`PERSONAL`, `DOCUMENT`, `ANNOTATION`, `SUMMARY`), contenu Tiptap JSON validé, `revision` ; liens vers un document/passage/page |
| `MindMap`, `MindMapNode`, `MindMapEdge`, `MindMapRevision` | Cartes éditables (structure ou concepts), nœuds avec `Origin`, liens vers section/notion, versions restaurables |

## Exercices et progression
| Modèle | Rôle |
|---|---|
| `Exercise` | Exercice indépendant, rattaché à un document et à sa version (`SetNull` si supprimé), configuration validée |
| `Question` | Type (12), points, difficulté, `payload` (visible), `answerKey` (jamais envoyée avant correction), références au cours |
| `QuestionConcept` | Notions évaluées par une question |
| `ExerciseAttempt` | Tentative avec **copie figée** (`snapshot`) de l'exercice, reprise, score |
| `Answer` | Réponse, verdict, points, `GradedBy` (`RULE`, `AI`, `MIXED`), retour détaillé (dont tests exécutés) |
| `ErrorDiagnosis` | Catégorie (`ErrorCategory`) **avec preuves** (`evidence`) et confiance ; source `tests`/`execution` ou `ai` |
| `ConceptMastery` | Maîtrise estimée (0–1) **et confiance** par notion ; entièrement recalculable depuis les preuves |
| `LearningActivity` | Activités en cours (lecture, exercice, laboratoire) pour la reprise |
| `LearningRecommendation` | Suggestions justifiées (type, raison, preuves, statut) |

## Laboratoires
| Modèle | Rôle |
|---|---|
| `LabWorkspace` | Espace libre ou d'exercice : fichiers, énoncé et tests (`brief`, la référence n'est jamais envoyée au client), schéma SQL |
| `LabRun` | Une exécution : entrée, sortie, résultats de tests, indices |

## Technique
`AIUsageLog` (quota, coût, erreurs d'appels IA).

## Tables V1 conservées (non supprimées)
`Chapter`, `Session`, `SessionItem`, `LegacyExercise`, `LegacyAnswer`, `LegacyDocumentChunk`, `LegacyDocumentAnalysis`, `ConceptStat`, `StudyRecommendation`, `ProgramRun`, `SqlQueryLog`, `ChatMessage`. Le code V2 ne les écrit plus ; elles restent pour ne perdre aucune donnée. `prisma/optional/archive_v1_tables.sql` permet de les archiver (voir `docs/MIGRATION.md`).

## Migrations
Voir `docs/MIGRATION.md` : `v1_baseline`, `v2_foundation`, `v2_backfill` (idempotente, avec contrôles d'intégrité), `v2_rls`. Les 4 sont rejouées sur PGlite par les tests.
