# Audit de la base de données — Niala

Date : 2026-11-04 · Schéma : `prisma/schema.prisma` (1 195 lignes, 48 modèles) · 10 migrations.
Méthode : lecture du schéma et des migrations, recherche d'usage de chaque modèle dans `src/`, migrations rejouées sur PGlite jetable (appliquées sans erreur : 10/10), vérification RLS par comparaison des listes. **Non fait** : `EXPLAIN` sur données volumineuses, migration sur une copie de la base Supabase, mesure de charge.

## Cartographie

- **Cœur V2 (36 modèles)** : `User` → `Subject` → `Folder`/`Document` → `DocumentVersion` → `DocumentChunk` ; `DocumentAnalysis` → `CourseSection`, `Concept`/`ConceptSource`/`ConceptRelation` ; `Note`/`NoteLink` ; `MindMap*` ; `Exercise` → `Question`/`QuestionConcept`/`ExerciseSource` ; `ExerciseAttempt` → `Answer` ; `ErrorDiagnosis`, `DiagnosisReport`, `SkillObservation`, `DiagnosisFollowup` ; `ConceptMastery`, `LearningActivity`, `LearningRecommendation` ; `LabWorkspace` → `LabRun` ; `Conversation` → `ConversationMessage` ; `UserSettings`, `AIUsageLog`.
- **Héritage V1 (12 modèles)** : `Chapter`, `LegacyDocumentChunk`, `LegacyDocumentAnalysis`, `LegacyExercise`, `Session`, `SessionItem`, `LegacyAnswer`, `ConceptStat`, `StudyRecommendation`, `ProgramRun`, `SqlQueryLog`, `ChatMessage`.

## Constats

| ID | Constat | Gravité | Preuve | Priorité |
|---|---|---|---|---|
| DB-01 | 12 tables V1 jamais écrites ; 3 sont encore **lues** pour afficher des « conséquences » trompeuses | Moyenne | Confirmé | P2 |
| DB-02 | Suppression d'une matière : avertissement incomplet, cascades massives, tentatives orphelines | **Élevée** | Confirmé (code) | P1 |
| DB-03 | Deux modèles de diagnostic (`ErrorDiagnosis` et `DiagnosisReport`) écrits en parallèle | Moyenne | Confirmé | P2 |
| DB-04 | `Document` garde des colonnes V1 qui dupliquent `DocumentVersion` | Moyenne | Confirmé | P2 |
| DB-05 | Embeddings en `Float[]` Postgres, 8 000 vecteurs chargés par question ; recherche `ILIKE` sans index | Moyenne (Élevée à l'échelle) | Confirmé (code) | P2 |
| DB-06 | `UserSettings` : 5 colonnes sur 8 ne pilotent rien ; `aiModel` par défaut `claude-sonnet-5-5` alors que Gemini est le fournisseur | Moyenne | Confirmé | P2 |
| DB-07 | Tables V1 `ProgramRun`, `SqlQueryLog`, `ChatMessage` sans clé étrangère vers `User` | Faible | Confirmé | P3 |
| DB-08 | 49 conversions `as unknown as` sur colonnes JSON (`payload`, `snapshot`, `config`, `reason`, `stateReasons`) | Moyenne | Confirmé | P2 |
| DB-09 | Script `db:reset` (`prisma migrate reset`) exposé dans `package.json`, pointe sur `DATABASE_URL` | Faible | Confirmé | P3 |
| DB-10 | Index et plans de requêtes non mesurés | — | À vérifier | P2 |

### DB-02 — Suppression d'une matière (Élevée, P1)
- **Où** : `src/app/api/subjects/[id]/route.ts:24-31, 61-69, 91-95` ; `src/features/subjects/subjects-view.tsx:63-64`.
- **Constat** : l'API calcule les « conséquences » avec `db.chapter`, `db.legacyExercise`, `db.session` (V1, toujours 0) et le dialogue n'affiche que `documents`. Or `Subject` supprime **en cascade** (`onDelete: Cascade`) : `Note`, `MindMap`, `Exercise` (et ses `Question`), `Concept` (donc `ConceptMastery`, `ConceptSource`, relations, nœuds), `Conversation`, `Folder`. Les `ExerciseAttempt` survivent avec `exerciseId = NULL` (`SetNull`), `LabWorkspace` perd son `subjectId`.
- **Conséquences** : l'étudiant confirme la suppression sans savoir qu'il perd ses notes, cartes, exercices et sa maîtrise ; l'historique d'essais reste **sans exercice ni notion** (progression incohérente, statistiques orphelines).
- **Correction** : compter les vrais enfants V2 dans les conséquences ; décider du sort des tentatives (suppression explicite ou conservation avec libellé figé) ; transaction unique. **Régression** : faible. Ne pas changer les `onDelete` sans migration de données.

### DB-01 / DB-07 — Tables V1
`db.chapter`, `db.legacyExercise`, `db.session` n'apparaissent que dans `subjects/[id]/route.ts`. Les neuf autres n'ont aucune lecture/écriture applicative. `docs/MIGRATION.md` + `prisma/optional/archive_v1_tables.sql` prévoient l'archivage : **non exécuté**. `Subject.chapters`, `User.documents` (relations V1) et `Document.chapterId` persistent dans le schéma. **Ne pas supprimer** sans sauvegarde (données V1 réelles possibles) ; archiver puis retirer du schéma en deux temps.

### DB-03 — Deux modèles de diagnostic
`src/server/services/exercises/attempts.ts:235-237` et `labs/labs.ts:367` écrivent `errorDiagnosis` ; `src/server/diagnosis/record.ts` écrit `diagnosisReport` ; `record.ts:36-38` relit `errorDiagnosis` pour compter les récidives. Deux sources de vérité pour « l'erreur de cet essai » : risque de divergence (suppression/regrade d'un côté seulement). **À vérifier** : contradiction réelle dans les données (pas de jeu de données réaliste). Simplification : `DiagnosisReport` comme source unique et `ErrorDiagnosis` en vue/migration (avec mapping des catégories).

### DB-04 — Duplication Document / DocumentVersion
`Document` : `status`, `extractedText`, `pageCount`, `size`, `type`, `meta`, `error` ; `DocumentVersion` : `extractStatus`, `pageCount`, `size`, `mime`, `extractError`… Seul `extractedText` est vérifiablement mort (aucune lecture hors tests). Les autres sont écrits en double (ex. `documents.ts:225-226`, `497-498`) → états contradictoires possibles si une écriture échoue entre les deux.

### DB-05 — Recherche et vecteurs
`DocumentChunk.embedding Float[]`. `retrieval.ts:127` charge jusqu'à 8 000 vecteurs (`take: 8000`) **par question de chat** puis calcule la similarité en Node ; `retrieval.ts:108` filtre en `ILIKE %mot%` (pas d'index trigramme). Bon pour quelques cours ; à 100 documents de 300 pages le coût devient prohibitif (le projet l'annonce : « pas de pgvector »). Aucune mesure réalisée.

### DB-06 — Réglages
Lus par le code : `theme`, `maxUploadMB`. Écrits mais **sans effet** : `defaultMode`, `hintsEnabled` (seulement copié dans le store), `aiModel`, `exerciseLang`, `retentionDays` (aucune purge n'existe : « conservation illimitée » est la seule réalité). Voir `AUDIT_FONCTIONNEL.md` FUN-01.

### DB-08 — Typage des colonnes JSON
Le schéma Prisma ne type pas les JSON ; le code force le type (`snapshot as unknown as Snapshot`, `attempts.ts:127`). Une évolution de format casse silencieusement les anciennes lignes. Recommandation : schémas zod de lecture versionnés pour `Question.payload/answerKey`, `ExerciseAttempt.snapshot`, `DiagnosisReport.*`.

## Isolation des utilisateurs (schéma)
Toutes les tables V2 portent `userId` avec `onDelete: Cascade` vers `User` ; les services filtrent par `userId` (testé : `journey.test.ts`, tests d'isolement dans chat/diagnostic/labs, et test réel inter-comptes : voir `AUDIT_SECURITE.md`). **Redondance volontaire** `userId` sur les enfants (`Answer`, `Question`, `ConceptSource`…) : correcte pour l'isolation, mais nécessite que chaque création le renseigne cohéremment (aucun contrôle de base : pas de clé composite). **À vérifier** : un test de cohérence `child.userId = parent.userId`.

## Migrations
Rejeu des 10 migrations sur PGlite : OK. Le test `migration-v2.test.ts` (9 tests) couvre V1→V2. Limites : jamais essayé sur la base réelle (`docs/FONCTIONNALITES-ET-LIMITES.md` §« Non vérifié ») ; la migration `20261104000000_niala_theme_default` modifie les données (`system` → `dark`) ; `20261101000200_v2_backfill` est une migration de données non idempotente par construction (à rejouer **uniquement sur copie**). Procédure sûre : `pg_dump`/branche Neon-Supabase de test → `prisma migrate deploy` → comparer les comptes de lignes.

## Fusions de tables : ce qui ne doit pas être fait à la légère
Fusionner `ErrorDiagnosis` → `DiagnosisReport` impose un mapping de catégories (enum `ErrorCategory` vs texte) et la conservation des liens `answerId`/`labRunId` (cascade vs SetNull différents : `DiagnosisReport` supprime avec la réponse, `ErrorDiagnosis` conserve). Supprimer les colonnes V1 de `Document` impose d'abord de vérifier que 100 % des documents migrés ont un `currentVersionId`.
