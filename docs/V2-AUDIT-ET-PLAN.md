# StudyForge V2 — Audit de la V1 et plan de migration

Statut : **étapes 1 (audit) et 2 (conception) terminées, étape 3 (validation) en attente.** Aucun code applicatif n'a été modifié.

## 1. Audit de la V1

Pile : Next 16 (webpack), React 19, Prisma 6 sur Postgres (Supabase), auth maison (cookie HMAC), Anthropic via `fetch`, zustand, CodeMirror, `unpdf`/`mammoth`/`jszip`, `better-sqlite3` pour le labo SQL. ~13 000 lignes, aucune suite de tests.

### 1.1 Ce qui correspond déjà à la vision (à conserver)
| Élément | Fichiers | Remarque |
|---|---|---|
| Garde `requireUser` + filtre `userId` sur la plupart des routes | `lib/auth.ts`, `api/*` | Bon réflexe, à systématiser |
| Enveloppe d'API `handle` + zod | `lib/api-helpers.ts` | À conserver, durcir (voir 1.5) |
| Couche IA unique + journal `AIUsageLog` + réparation JSON | `lib/ai.ts` | Base des futurs services |
| Index de recherche TF-IDF avec provenance (document + page) | `lib/rag.ts` | Réutilisable pour citations, à enrichir (offsets) |
| Moteur SQL en mémoire jetable, instructions dangereuses bloquées | `lib/sql-engine.ts` | Conservé, à borner (voir 1.5) |
| Éditeur CodeMirror, laboratoires code et SQL | `features/code-lab`, `sql-lab` | UI conservée, branchée sur le modèle V2 |
| Correction règle + IA, indices, session figée | `lib/grading.ts`, `api/sessions/*` | Réutilisé comme moteur de correction |
| Types de questions riches (20 types) | `lib/types.ts` | Base ; ajouter `matching`/`definition` si absents du mapping demandé |
| Réglages, thème, shell, composants shadcn | `components/ui`, `layout` | Conservés |

### 1.2 À modifier en profondeur
- **Chapitres obligatoires** : `Chapter` + `chapterId` imposé à l'import (`api/documents` POST refuse sans chapitre), routes `chapters/*`, page `bibliotheque/[chapterId]`, `library-view.tsx` (2 856 lignes, monolithique), `MoveChapterDialog`, etc. → remplacés par `Folder` récursif.
- **Document = texte extrait** : le fichier original n'est **jamais stocké** (seul `extractedText`, tronqué à 500 000 car.). Le lecteur (`chapter-reader-view.tsx`) affiche du texte brut. → stockage objet + lecteur PDF fidèle.
- **Analyse 1-1 et à plat** : `DocumentAnalysis.documentId @unique`, listes de chaînes sans hiérarchie ni références de page, tronquée à 40 000 car. et écrasée par `upsert` à chaque relance. → analyse versionnée, arbre `CourseSection`, `Concept` avec provenance.
- **Exercices** : généré à partir de plusieurs documents, `GenerateConfig.documentIds[]`, barème = « points par question » sans total contraint, difficulté à 5 niveaux fixes, pas de couverture par section/notion. `Exercise` et `Session` dupliquent les questions en JSON.
- **Progression** : `ConceptStat(userId, notion)` clé = **texte libre**. Moyenne mobile exponentielle (0,6/0,4) et seuil fixe `< 0.65` pour recommander. Pas d'ancienneté, pas de prérequis, pas de diagnostic d'erreur, pas de niveau de confiance.
- **Labos code/SQL** : indépendants du système pédagogique (`sessionId` optionnel), pas de mode exercice avec import de consigne, pas de jeux de tests cachés ni de cas limites.
- **Tableau de bord** : accumulation de statistiques (`api/stats` ramène 60 sessions + 200 logs IA), pas de « reprendre ».

### 1.3 Devenu inutile ou à fusionner
- `Chapter`, `/api/chapters/*`, `chapter-reader-view` : retirés **après** migration des données (1.7).
- `ChatMessage` / `api/chat` : le chat par document est utile, mais conservé comme panneau du lecteur (réutilise l'index de passages). Clé de conversation `a|b|c` bricolée → rattachée à `Document`.
- `Exercise` + `Session` + `SessionItem` : fusion en `Exercise` (définition immuable versionnée) + `ExerciseAttempt` + `Answer`.
- `StudyRecommendation` : remplacé par `LearningActivity` / `LearningPlan` calculés.
- `lib/subjects.ts` (6 lignes), `api/route.ts` : à vérifier/supprimer.

### 1.4 Fonctionnalités incomplètes ou absentes
Notes (aucun modèle), annotations, cartes mentales/conceptuelles, dossiers, versions de documents, lecteur PDF, analyse hiérarchique, prérequis, diagnostic d'erreurs, reprise d'activité, `LabWorkspace`, tests automatisés.

### 1.5 Problèmes de sécurité (constatés dans le code)
| # | Gravité | Constat | Correctif V2 |
|---|---|---|---|
| S1 | **Critique** | `executor.ts` lance Node/Python avec `env: { ...process.env }` : le code étudiant voit `DATABASE_URL`, `ANTHROPIC_API_KEY`, `AUTH_SECRET`. Python n'a aucune restriction fichiers/réseau. | Environnement vide, cwd jetable ; exécution via sandbox réelle (voir D3) |
| S2 | **Critique** | `vm.runInNewContext` n'est pas une barrière de sécurité (échappement connu via `constructor.constructor`). | Isolation processus/WASM/conteneur, pas `vm` seul |
| S3 | Haute | `db/custom.db` et `db/.auth-secret` sont **suivis par git** malgré le `.gitignore` (confirmé par `git ls-files`). Le secret de signature des sessions est donc dans l'historique. | `git rm --cached`, **rotation de `AUTH_SECRET`**, exigence de la variable d'env en production |
| S4 | Haute | Compte par défaut `etudiante@studyforge.local` / `studyforge2025` créé au premier lancement. | Supprimé ; inscription ou seed explicite hors production |
| S5 | Haute | Cookie `secure: false` codé en dur. | `secure` en production |
| S6 | Haute | `better-sqlite3` est synchrone : un `WITH RECURSIVE` infini ou une requête lourde **bloque tout le serveur Node**, sans timeout. | Exécution en worker avec timeout/kill, `progress_handler`/limite de pages, base lecture seule pour SELECT |
| S7 | Moyenne | Injection de prompt : le texte du document est inséré tel quel entre `<<<` `>>>`, sans neutralisation ni validation de sortie. La seule défense est une phrase dans le prompt système. | Délimiteurs étanches, schéma strict de sortie (zod), citations vérifiées côté serveur |
| S8 | Moyenne | `handle` renvoie `err.message` brut en 500 (fuite d'internes). | Messages génériques + identifiant de corrélation |
| S9 | Moyenne | Limitation de débit en mémoire (`Map`) : sans effet sur Vercel (instances multiples). | Table/Redis ou limite par utilisateur en base |
| S10 | Moyenne | `chapter.findFirst({ where: { id } })` sans filtre `userId` (import, PATCH document) : atténué par la comparaison avec la matière mais fragile. | Helper unique `ownedBy(userId)` pour toute lecture par id |
| S11 | Moyenne | Aucun `middleware`/`proxy` : la protection repose sur chaque route + `auth-guard` côté client. RLS activé mais sans politiques (Prisma s'y connecte via un rôle qui les contourne). | Garde centrale + tests d'isolation inter-utilisateurs |
| S12 | Basse | `typescript.ignoreBuildErrors: true` masque les erreurs de type. `prisma db push --accept-data-loss` dans les scripts. | Retirer ; migrations versionnées uniquement |
| S13 | Basse | Validation de format uniquement par extension. | Contrôle des signatures magiques (`%PDF-`, PK…) |

### 1.6 Problèmes de logique, de données et de performance
- `ConceptStat` fusionne les notions de **matières différentes** portant le même nom (viole la règle 8).
- Recherche de documents : quatre variantes de casse dans un `OR` au lieu de `mode: "insensitive"` (Postgres).
- `Document.extractedText` (jusqu'à 500 Ko) chargé dans les `findFirst` sans `select` ; `Document` ramène `chunks`.
- Import : doublon détecté par « nom + taille » (faux positifs/négatifs), extraction synchrone dans la requête (limites de durée serverless), boucle séquentielle de 12 fichiers.
- `buildIndex` reconstruit l'index entier à chaque requête de chat/correction ; `search` recalcule `df` à chaque appel.
- Pas de transactions autour de la correction d'une session (état incohérent possible si une étape échoue), pas de contrôle de concurrence.
- `Exercise.config`/`questions`, `DocumentAnalysis.*`, `Session.summary` : JSON stocké en `String` alors que la base est Postgres (`Json`/`jsonb` possible, intégrité nulle aujourd'hui).
- `PRAGMA` exécuté depuis une entrée utilisateur dans `runSqlScript` (par `db.pragma` sur le nom seul) : comportement tronqué (`PRAGMA x = y` perd la valeur).

### 1.7 Dépendances entre modules (V1)
`Subject → Chapter → Document → (Chunk, Analysis)` ; `Exercise/Session ← generateExercises ← RAG(Chunk)` ; `Session/Answer → ConceptStat → StudyRecommendation` ; `Code/SQL labs → ProgramRun/SqlQueryLog` (isolés). La suppression d'une matière/document passe par `onDelete` (SetNull sur `Exercise.subjectId`, Cascade sur chunks/analyses).

---

## 2. Conception V2

### 2.1 Navigation
`Tableau de bord` · `Mes matières` (→ matière : onglets **Fichiers / Notes / Analyses / Cartes / Exercices / Progression**) · `Lecteur` (route `/matieres/[id]/documents/[docId]`, espace de travail : document au centre, panneau latéral Notes · Analyse · Chat · Exercice) · `Laboratoire code` · `Laboratoire SQL` · `Progression` · `Réglages`.
Parcours : importer → lire (annoter) → analyser → cartographier → « Créer un exercice » → faire l'exercice → diagnostic → recommandation → reprise depuis le tableau de bord.

### 2.2 Modèle de données (Prisma, entités regroupées)
Principe : chaque table appartient à un `userId` (colonne dénormalisée sur les tables enfants fréquemment lues, pour filtrer sans jointure et pour la RLS). JSON typé (`Json`) uniquement pour ce qui est validé par zod.

- **Organisation** : `Subject` ; `Folder(subjectId, parentId?, name, @@unique[subjectId,parentId,name])` ; `Document(subjectId, folderId?, currentVersionId, name, kind)` ; `DocumentVersion(documentId, number, storageKey, mime, size, sha256, pageCount, extractStatus, extractError, createdAt)` ; `DocumentChunk(versionId, idx, page, charStart, charEnd, content)` — **l'extraction est liée à la version, le fichier original reste dans le stockage objet**.
- **Analyse pédagogique** : `DocumentAnalysis(versionId, status, model, promptVersion, createdAt)` (plusieurs par version) ; `CourseSection(analysisId, parentId?, label, numbering, level, position, pageStart, pageEnd, origin: DOCUMENT|AI_INFERRED|USER)` ; `Concept(subjectId, name, kind: NOTION|DEFINITION|RULE|EXAMPLE|PROPERTY, importance, origin, sectionId?, sourceRef)` — **unicité par matière** ; `ConceptRelation(fromId, toId, type, origin)` ; `SourceRef(chunkId|page, charStart, charEnd, quote)`.
- **Notes unifiées** : `Note(subjectId, kind: PERSONAL|DOCUMENT|ANNOTATION|SUMMARY, title, content Json (éditeur riche), updatedAt)` ; `NoteLink(noteId, documentId, versionId?, page?, anchor Json?)` (N:N, une note peut référencer plusieurs documents, une annotation porte son ancrage) ; pas de table de notes parallèle.
- **Cartes** : `MindMap(subjectId, analysisId?, kind: STRUCTURE|CONCEPT)`, `MindMapNode(mapId, label, x, y, origin, conceptId?|sectionId?)`, `MindMapEdge(mapId, from, to, type, origin)`, `MindMapRevision(mapId, snapshot Json)`.
- **Exercices** : `Exercise(subjectId, documentId, versionId, config Json, totalPoints, status)` ; `Question(exerciseId, position, type, points, difficulty, payload Json, answerKey Json, sourceRef)` ; `QuestionConcept(questionId, conceptId)` ; `ExerciseAttempt(exerciseId, snapshot Json, status, startedAt, finishedAt, score)` ; `Answer(attemptId, questionId, value Json, feedback Json, gradedBy)`. Un `ExerciseAttempt` fige la version exacte des questions.
- **Apprentissage** : `ErrorDiagnosis(answerId|labRunId, category: SYNTAX|LOGIC|CONCEPT|METHOD|INSTRUCTION|FORGETTING|CARELESS, confidence, evidence Json, conceptId?)` ; `ConceptMastery(userId, conceptId, level, confidence, lastEvidenceAt)` (recalculé à partir des preuves, pas stocké comme vérité absolue) ; `LearningActivity(userId, type, refId, status, lastPosition Json)` ; `LearningPlan/Recommendation(userId, conceptId, reason Json, createdFrom)`.
- **Labos** : `LabWorkspace(userId, subjectId?, kind: CODE|SQL, mode: FREE|EXERCISE, brief Json?, files Json, schemaSql?)` ; `LabRun(workspaceId, input, output, tests Json, evaluation Json)`.
- **Journal** : `AIUsageLog` conservé (ajout `promptVersion`, `cacheHit`).

### 2.3 Services métier (`src/server/services/*`)
Chacun : entrée structurée → schéma zod de sortie → erreurs typées. Un seul client IA (`lib/ai.ts` refondu) gère timeouts, quotas par utilisateur, journal, cache (hash du contexte + version de prompt), isolation du contenu documentaire (délimiteurs, jamais dans le prompt système).
`DocumentStructureService` · `ConceptExtractionService` · `DocumentAnalysisService` (orchestre les deux, par section pour contourner la limite de 40 000 car.) · `MindMapGenerationService` · `ExerciseGenerationService` (barème contraint côté serveur : la somme est recalculée, jamais confiée à l'IA) · `AnswerEvaluationService` · `CodeEvaluationService` / `SQLEvaluationService` (tests objectifs d'abord, IA ensuite pour l'explication) · `LearningDiagnosisService` · `LearningRecommendationService`.
Règle : l'IA propose, le serveur valide (citations retrouvées dans les chunks, totaux, droits, verdicts de tests).

### 2.4 Dépendances techniques à ajouter
`@xyflow/react` (cartes) · lecteur PDF : `pdfjs-dist` via `react-pdf` · éditeur de notes : **Tiptap** (le projet embarque déjà `@mdxeditor/editor`, mais le besoin de tableaux/ancrages/stockage JSON favorise Tiptap ; décision D5) · stockage objet : Supabase Storage (déjà `@supabase/supabase-js`) · `vitest` pour les tests.

### 2.5 Plan de migration des données
1. Migration Prisma **additive** (nouvelles tables, aucune suppression), générée avec `prisma migrate` (fin de `db push --accept-data-loss`).
2. Script de reprise idempotent : chaque `Chapter` → `Folder` (même nom, sans parent) ; `Document.chapterId` → `folderId` ; chaque `Document` → `DocumentVersion` n°1 (le fichier original n'ayant jamais été conservé, la version est marquée `originalMissing = true` et l'interface propose de réimporter le fichier pour activer le lecteur fidèle) ; `extractedText` + chunks → chunks de la version ; `DocumentAnalysis` V1 → archivée en lecture seule (`legacy`) ; `Session*/Answer` → `ExerciseAttempt/Answer` ; `ConceptStat` → `Concept` par matière (notions homonymes d'une même matière fusionnées, pas entre matières) + `ConceptMastery`.
3. Vérifications automatisées : comptes avant/après, orphelins, isolation par `userId`.
4. Bascule du code, puis **seulement ensuite** migration destructive retirant `Chapter`, `Session*`, `ConceptStat`, `StudyRecommendation`, avec sauvegarde (snapshot Neon/Supabase) préalable.

### 2.6 Phasage de l'implémentation
| Phase | Contenu | Critère de sortie |
|---|---|---|
| 0 | Hygiène : `git rm --cached db/*`, rotation du secret, retrait compte par défaut, cookie `secure`, retrait `ignoreBuildErrors`, `vitest`, helper `ownedBy` | build typé vert, tests d'isolation verts |
| 1 | Schéma V2 + migrations + script de reprise | migration jouée sur copie de la base |
| 2 | Matières, dossiers, import avec stockage objet, versions, états de traitement | dossiers libres, déplacements, recherche/tri |
| 3 | Lecteur PDF fidèle + panneau latéral | PDF affiché, page mémorisée |
| 4 | Notes unifiées + annotations | note libre et annotation visibles dans la même liste |
| 5 | Services IA + analyse hiérarchique + édition | arbre fidèle sur un cours réel |
| 6 | Cartes de structure et conceptuelle (React Flow) | édition, relations, révisions |
| 7 | Génération d'exercices configurable + passage + correction | barème exact, un seul document source |
| 8 | Labos code/SQL en mode exercice avec tests objectifs et sandbox | pas d'accès env/réseau/fichiers depuis le code étudiant |
| 9 | Progression adaptative, diagnostics, recommandations, tableau de bord, reprise | parcours complet bout en bout |
| 10 | Documentation, tests de parcours, limites restantes | `docs/` complet |

### 2.7 Décisions que je prends par défaut (modifiables)
- **D1 Stockage des fichiers** : Supabase Storage, bucket privé, URLs signées courtes générées après contrôle de propriété.
- **D2 Formats** : PDF (lecteur fidèle), images, TXT/MD (rendu natif) ; DOCX/PPTX conservés en original et téléchargeables, aperçu via conversion PDF **non disponible** dans cet environnement → affichage du texte extrait **étiqueté comme tel** à côté du bouton de téléchargement de l'original (limite documentée).
- **D3 Sandbox du code** : le conteneur n'est pas garanti sur Vercel ; par défaut JavaScript/TypeScript dans un worker WASM isolé (QuickJS) et Python via Pyodide en WASM dans un worker avec délai ; langages sans runtime sûr : correction par IA signalée comme telle. Un connecteur vers un service d'exécution externe est préparé (interface `CodeRunner`) mais non branché.
- **D4 IA** : Anthropic uniquement (déjà en place), derrière une interface de fournisseur pour en brancher d'autres.
- **D5 Éditeur de notes** : Tiptap, contenu JSON.
- **D6 Compte par défaut** : supprimé ; création de compte via un écran d'inscription (local/dev seulement) ou variable de seed.

## 3. Points qui demandent votre arbitrage
1. **Sauvegarde et base cible** : la migration doit-elle être jouée sur une branche/copie (Neon/Supabase) avant la base actuelle ? Je recommande une copie, puis bascule.
2. **Documents existants sans original** : acceptez-vous de ne pas pouvoir afficher fidèlement ces documents tant qu'ils ne sont pas réimportés ?
3. **Sandbox de code** : D3 (WASM) vous convient-il, ou disposez-vous d'un service d'exécution/d'un hébergement avec conteneurs ?
4. **Secret exposé** : `db/.auth-secret` figure dans l'historique git ; si le dépôt a été poussé ailleurs, le secret doit être considéré comme compromis (rotation de `AUTH_SECRET`).


## 4. Avancement

**Phase 0 — terminée** (vérifiée : `tsc --noEmit` sans erreur, `npx vitest run` vert)
- `db/custom.db` et `db/.auth-secret` retirés de l'index git (S3). **Reste à faire par vous : changer `AUTH_SECRET`** si le dépôt a été partagé, et purger l'historique si nécessaire.
- `AUTH_SECRET` (≥ 32 car.) obligatoire en production ; cookie `secure` en production (S5) ; compte par défaut et son affichage sur la page de connexion supprimés (S4) → `scripts/create-user.mjs`.
- Le code étudiant ne reçoit plus l'environnement du serveur (S1, correction partielle ; S1, S2 et S6 sont entièrement corrigés en phase 8).
- Erreurs 500 génériques avec référence (S8) ; erreurs métier converties en `ApiHttpError` (404/409/502) pour conserver leurs messages.
- `ignoreBuildErrors` retiré, `db:push` sans `--accept-data-loss`, `vitest` en place, helpers `ownedBy` / `assertFound`.

**Phase 1 — terminée** : schéma V2 (25 modèles, 14 enums), 4 migrations testées sur PGlite (voir `docs/MIGRATION.md`). **Aucune migration n'a été appliquée à votre base Supabase.** Les modèles V1 en collision de nom sont `Legacy*` ; le code V1 pointe dessus (`db.legacyExercise`…) et fonctionne comme avant.

**Fonctionnalités V2 utilisateur** : aucune pour l'instant (phases 2 à 10).

**Phase 2 — terminée** (matières, dossiers, import, versions). Vérifiée : 37 tests verts (dont 12 d'intégration sur Prisma + PGlite), `tsc` et `next build` OK, parcours réel dans le navigateur (création de matière et de dossier, import d'un vrai PDF et d'un Markdown, refus d'un `.exe` et d'un faux PDF, recherche dans le contenu, déplacement groupé, restitution octet pour octet de l'original) et test HTTP d'isolation entre deux comptes (tous les accès croisés renvoient 404, anonyme 401).
- Dossiers libres et récursifs (créer, renommer, déplacer, sous-dossiers, supprimer récursivement avec les fichiers), cycles et profondeur refusés, noms uniques par dossier.
- Import en 3 temps (préparation → dépôt → contrôle de signature, empreinte SHA-256, extraction, indexation par page avec décalages). L'original est stocké tel quel ; états de traitement visibles (Prêt, Partiel, Sans texte, Échec).
- Recherche (nom, et contenu indexé), filtre par type, tri, propriétés, téléchargement.
- Le chapitre obligatoire a disparu : `library-view`, `chapter-reader` et `/api/chapters` sont supprimés (`/bibliotheque` redirige vers `/matieres`). La génération d'exercices V1 reste alimentée par une écriture de compatibilité (`Document.extractedText`, `LegacyDocumentChunk`), retirée en phase 7.
- Supprimer une matière supprime désormais aussi ses documents et leurs originaux.

Limites connues de la phase 2 :
- Le stockage Supabase est implémenté mais **non testé ici** (pas de `SUPABASE_SERVICE_ROLE_KEY` dans le projet) ; le stockage local (`./storage`) est testé. Sur Vercel, définir `SUPABASE_SERVICE_ROLE_KEY` (bucket privé `documents` créé automatiquement) est obligatoire.
- Un import interrompu avant la finalisation laisse un document « En attente » visible et supprimable ; pas de nettoyage automatique.
- Pas de glisser-déposer pour déplacer (déplacement par dialogue) ; pas de déplacement entre matières ; pas encore de lecteur : « Ouvrir l'original » ouvre le fichier brut dans un onglet (le lecteur est la phase 3).
- Le contrôle de doublon est un avertissement (même empreinte dans la matière), jamais un blocage.

Développement local sans Supabase : `node scripts/dev-db.mjs` (PGlite, port 5433) puis `node scripts/dev-local.mjs` (port 3100).

**Phase 3 — terminée** (lecteur de documents). Vérifiée : 40 tests verts, `tsc` et `next build --webpack` OK, et parcours réel dans le navigateur sur un PDF de 12 pages (rendu fidèle, texte sélectionnable, miniatures, recherche avec surlignage et navigation entre résultats, saut de page, mémorisation puis reprise de la page 4 après rechargement).
- Route `/matieres/[id]/documents/[docId]` : espace de travail avec le document au centre et un panneau « Document » à droite (propriétés, état d'extraction, avertissements, dernière page lue).
- **PDF** : lecteur pdf.js (lecture seule) avec défilement continu, navigation, zoom et ajustement à la largeur, recherche, miniatures, plein écran, téléchargement ; pages rendues à l'approche de la zone visible et libérées ensuite.
- **TXT / Markdown** : original affiché tel quel (Markdown sans HTML brut).
- **DOCX / PPTX / original non conservé** : repli sur le **texte extrait**, avec un bandeau explicite « texte extrait, pas le document original » et le lien de téléchargement de l'original s'il existe.
- Reprise : la page lue est enregistrée (différée, et à la fermeture de l'onglet) dans `Document.lastPage` et dans une `LearningActivity` de type READING (supprimée avec le document). `?page=N` permet un lien direct (utilisé plus tard pour les citations).
- Le fichier original est servi avec une CSP `sandbox` et `nosniff`.

Limites de la phase 3 :
- Pas d'aperçu fidèle pour DOCX/PPTX (aucune conversion fiable disponible dans cet environnement) : repli texte extrait.
- Les onglets Notes, Analyse et Chat du panneau latéral n'existent pas encore : ils seront ajoutés avec les phases 4 et 5 (aucun bouton factice n'est affiché).
- La recherche PDF surligne les fragments de texte contenant le terme (pas le mot exact) et navigue de page en page ; les PDF scannés sans texte ne sont pas cherchables.
- Les PDF protégés par mot de passe affichent un message et proposent le téléchargement.
- Non vérifié visuellement : rendu mobile et plein écran réel (le panneau du navigateur de test ne dessinait pas toujours) ; panneau latéral masqué sous 1024 px.

**Phase 4 — terminée** (notes unifiées et annotations). Vérifiée : 56 tests verts (dont 10 d'intégration notes sur Prisma + PGlite et 6 de validation de contenu), `tsc` et `next build --webpack` OK, et parcours réel dans le navigateur (création d'une note, mise en forme riche, sauvegarde automatique, conflit de révision et « conserver ma version », lien vers un document, création d'une annotation depuis une sélection dans le PDF, surlignage et marqueur sur la page, liste des notes du document).
- **Un seul système** : `Note` + `NoteLink`. La nature (note personnelle, note de document, annotation de passage, fiche de synthèse) est **déduite des liens** (ancrage précis → annotation) : impossible qu'une note soit incohérente avec ses références. Une note peut référencer plusieurs documents de sa matière.
- **Éditeur riche Tiptap** : titres, gras/italique/souligné/barré, code en ligne et blocs de code, listes, citations, liens, tableaux (lignes/colonnes), annuler/rétablir. Sauvegarde automatique (800 ms), état visible (Enregistré / en attente / erreur avec « Réessayer » / conflit), envoi à la fermeture de l'onglet. Contrôle de concurrence optimiste (`revision`) : une modification faite ailleurs n'est jamais écrasée silencieusement.
- **Sécurité du contenu** : le JSON de l'éditeur est validé côté serveur (liste blanche de nœuds, marques et attributs ; liens `http(s)`/`mailto` uniquement ; taille et profondeur bornées).
- **Matière → onglet Notes** (`/matieres/[id]/notes`) : liste avec recherche (titre et contenu), filtres par nature et par document, création de notes personnelles et de fiches de synthèse.
- **Lecteur** : onglet Notes du panneau (notes du document, triées par page), « Nouvelle note (page N) », sélection d'un passage du PDF → « Annoter ce passage » : l'annotation conserve la citation, la page, la version du document et les rectangles (surlignage et marqueur sur la page, clic pour l'ouvrir). Sous 1024 px le panneau s'ouvre en feuille.
- Supprimer un document retire ses liens mais **conserve les notes et leurs citations**.

Limites de la phase 4 :
- Les annotations ancrées (surlignage) existent pour les **PDF**. Pour TXT/Markdown/texte extrait, on peut créer des notes liées au document mais pas annoter un passage.
- Les rectangles sont stockés pour la version courante du PDF ; une nouvelle version du document ne les reprojette pas.
- Pas d'images dans l'éditeur ni de pièces jointes (`NoteAttachment` non implémenté) ; pas de liste de tâches.
- Recherche de notes en mémoire (jusqu'à 500 notes par matière) : suffisant pour un usage étudiant, à indexer si le volume grossit.
- Non vérifié visuellement : feuille mobile du panneau, et sélection à la souris réelle (la sélection a été simulée par script, le panneau de test étant masqué).

**Phase 5 — terminée** (architecture IA et analyse hiérarchique). Vérifiée : 81 tests verts (dont 16 d'intégration de l'analyse avec **vrai PDF extrait** et 9 de l'analyseur de structure), `tsc` OK, et parcours réel dans le navigateur (import d'un PDF numéroté, analyse, arbre de 15 titres fidèle avec pages, renommage, suppression, ajout d'une notion).
- **Architecture** (`src/server/ai`, `src/server/services/analysis`) : aucun appel IA hors de cette couche. `generateStructured` impose quota quotidien par utilisateur, délai, journal (`AIUsageLog`, opération versionnée `analysis.concepts@analysis-v1`), validation stricte zod et une tentative de réparation. Fournisseur Anthropic derrière une interface (`AiProvider`).
- **DocumentStructureService** : l'analyseur de numérotation est **déterministe et sans IA** (CHAPITRE, I/II/III, A/B/C, 1/2/3, 1.1, a/b/c, 1°, titres Markdown ; désambiguïsation I romain / I lettre ; rejet des numéros hors séquence). Tout ce qu'il produit est `DOCUMENT`. Sans numérotation, repli IA (plan marqué `AI_INFERRED`, titres absents du texte écartés) ; sans IA, **aucun plan n'est inventé**.
- **ConceptExtractionService** : notions, définitions, propriétés, règles, exemples et relations, par lots de sections. Une notion n'est `DOCUMENT` que si sa citation est **retrouvée mot pour mot dans le texte** (vérifié côté serveur, avec la page) ; sinon elle est `AI_INFERRED`. Relations vers des notions inconnues rejetées. Notions **par matière** (jamais fusionnées entre matières).
- **Protection contre l'injection** : le document est encadré par une balise à jeton aléatoire et présenté comme donnée ; instruction injectée jamais présente dans le prompt système (testé) ; sortie hostile ou illisible → analyse terminée sans notions + avertissement, jamais d'échec silencieux.
- **DocumentAnalysisService** : une analyse par version, historique conservé, cache (analyse `READY` de même version de prompt réutilisée sans appel IA, `force` pour relancer), analyses « en cours » périmées détectées.
- **Corrections de l'étudiant** : titres, ajout/suppression de sections, monter/descendre/indenter/désindenter, notions (corriger, ajouter, supprimer) ; tout ce qu'il touche passe en `USER`/`modifié` ; relance d'**une** section qui remplace l'IA mais conserve les ajouts de l'étudiant ; suppression des notions orphelines.
- **Interface** : onglet « Analyse » du lecteur (arbre repliable, pages cliquables, étiquettes « Dans le document / Déduit par l'IA / Ajouté ou corrigé par vous », citations, historique des analyses).

Limites de la phase 5 :
- **Aucune clé `ANTHROPIC_API_KEY` n'est configurée dans ce projet** : l'extraction de notions et le repli IA n'ont été exercés qu'avec un **faux fournisseur de test** (identifié comme tel, uniquement dans les tests), **jamais contre le vrai modèle**. À vérifier dès que la clé est ajoutée.
- L'analyse s'exécute dans la requête (`maxDuration` 300 s) : un très long cours peut dépasser ; au-delà de 60 sections, seules les 60 premières reçoivent des notions (signalé).
- L'analyse d'une **nouvelle version** n'est pas déclenchable : le téléversement d'une nouvelle version d'un document existant n'est pas encore implémenté (le modèle et l'historique le supportent).
- Les corrections ne sont pas reportées sur une analyse relancée en entier (l'ancienne est conservée dans l'historique).
- La détection de plan dépend de la qualité de l'extraction du texte (sauts de ligne) : un PDF dont les lignes sont fusionnées sera traité sans plan.

**Phase 6 — terminée** (cartes de structure et conceptuelles). Vérifiée : 100 tests verts (13 d'intégration cartes + 6 de disposition/validation), `tsc` et `next build --webpack` OK, et parcours réel dans le navigateur (génération d'une carte de structure depuis l'analyse d'un vrai PDF : 15 nœuds, 14 relations, arbre propre ; ajout d'un nœud, édition par double-clic, suppression, sauvegarde automatique, point de restauration et retour à une version).
- **Structure de données éditable** (`MindMap`, `MindMapNode`, `MindMapEdge`, `MindMapRevision`), jamais une image. Éditeur **React Flow** : ajout/suppression de nœuds, édition du texte (double-clic ou panneau), déplacement, création de relations en tirant d'une poignée à l'autre, suppression, **type de relation modifiable** (prérequis, fait partie de, exemple de, définit, s'oppose à, est lié à) avec étiquette, zoom/déplacement/mini-carte, **réorganisation automatique**, commentaire par nœud, lien « Voir dans le document (p. N) ».
- **Deux représentations** : carte de **structure** (le plan réel du document, relations enfant → parent, racine = document) et carte **conceptuelle** (notions et relations de l'analyse ; prérequis à gauche, notions isolées en grille). Génération déterministe à partir de l'analyse : aucune donnée inventée.
- **Provenance décidée par le serveur** : chaque nœud/relation est « dans le document », « déduit par l'IA » ou « ajouté par vous » (couleur, trait pointillé, légende). Un nœud ajouté par l'étudiant est toujours `USER` quoi que le client déclare ; l'origine d'un élément existant ne peut pas être modifiée depuis le client ; un nœud dont le texte est corrigé garde son origine et reçoit `modifié` ; une relation dont le type/étiquette change passe à `USER`.
- **Sauvegarde automatique** avec révision (409 en cas de modification ailleurs, « recharger » / « conserver ma version »), validation stricte (pas de boucle, de doublon, de nœud inexistant, d'identifiant déjà utilisé par une autre carte).
- **Versions** : point de restauration automatique (au plus toutes les 5 min), point manuel, retour à une version (l'état actuel est lui-même conservé), 30 versions conservées.
- Onglet **Cartes** de la matière (liste, renommer, supprimer, cartes vides) et boutons « Carte de structure » / « Carte conceptuelle » dans l'onglet Analyse du lecteur.

Limites de la phase 6 :
- La carte conceptuelle n'existe que si des **notions ont été extraites**, donc seulement avec le service d'IA configuré (bouton désactivé sinon, avec explication). Elle n'a été testée qu'avec le faux fournisseur de test.
- Pas d'annuler/rétablir fin dans l'éditeur (remplacé par les versions) ; pas d'export image.
- La disposition automatique est simple (arbre horizontal, couches de prérequis) : un graphe conceptuel dense peut demander des ajustements manuels.
- Les liens vers notions/sections sont perdus si la notion ou la section est supprimée (le nœud reste, sans lien).
- Non vérifié : écran tactile et rendu mobile de l'éditeur.

**Phase 7 — terminée** (exercices générés à partir d'UN document). Vérifiée : 128 tests verts (dont 13 d'intégration exercices/tentatives et 15 de domaine), `tsc` et `next build --webpack` OK, et parcours réel dans le navigateur sur un **jeu de données de développement local** (exercice inséré à la main : IA non configurée ici) : liste, passage question par question avec enregistrement automatique, correction (QCM, vrai/faux, texte à trous, association), question rédigée « non corrigée » sans IA, formulaire de création et ses validations.
- **Bouton « Créer un exercice »** dans le lecteur et dans le menu de chaque fichier ; page globale « Exercices » ; onglet « Exercices » par matière.
- **Configuration** : nombre de questions (max configurable, `EXERCISE_MAX_QUESTIONS`), barème 10 / 20 / 100 / personnalisé ≤ 100 (la **somme des points est exactement le barème**, calculée par le serveur par plus fort reste au pas de 0,25 ; les questions difficiles valent plus), 12 types (QCM unique/multiple, vrai/faux, phrase à compléter avec/sans propositions, réponse courte, définition, ouverte, association, pratique, programmation, SQL — seuls les types cochés sont utilisés), couverture (tout le document, sections, notions, notions difficiles/principales), difficulté (facile, moyenne, difficile, progressive, mélangée).
- **Source unique** : seul le texte du document choisi (ou des sections/notions choisies) est envoyé à l'IA — testé : le contenu d'un autre document de la matière n'apparaît jamais dans les prompts.
- **Fiabilité** : chaque question doit citer un passage **retrouvé mot pour mot** dans le document (sinon rejetée) ; schéma strict par type + cohérences (indices, trous, doublons de propositions) ; doublons écartés ; **moins de questions plutôt que des questions inventées**, avec signalement et barème redistribué ; la bonne réponse n'est jamais dans la charge utile envoyée à l'étudiant avant la correction ; propositions mélangées côté serveur.
- **Exercice indépendant** du document (référence conservée vers le document et sa version ; `SetNull` si supprimé) ; notions liées aux questions (`QuestionConcept`, notions créées par matière si besoin).
- **Tentatives** : copie figée de l'exercice (modifier ou supprimer l'exercice ne change pas une tentative), reprise exacte (réponses enregistrées au fil de l'eau, dernière question mémorisée, activité « EXERCISE » pour la reprise), historique, nouvelle tentative, soumission idempotente.
- **Correction** (AnswerEvaluationService) : règles déterministes pour les types objectifs (crédit partiel QCM multiple avec pénalité, trous, paires, tolérance casse/accents/articles/virgule décimale) ; repli par mots-clés pour une définition (signalé) ; **IA uniquement pour les réponses rédigées**, avec critères et barème imposés, réponse de l'étudiant traitée comme donnée non fiable (testé : points bornés à [0, max], injection sans effet) ; sans IA : « non corrigée », jamais un faux score — le score est présenté sur les points corrigés, avec bouton « Corriger maintenant ».
- **Retiré de la V1** : page et API de génération, `api/documents/*`, `api/chat`, `api/search`, `api/exercises` V1. Conservés jusqu'à la phase 9 : `api/exercises/revision`, `api/sessions`, la vue de session, les statistiques et la **double écriture** (`Document.extractedText`, `LegacyDocumentChunk`) qui alimentent la révision ciblée et le tableau de bord actuels.

Limites de la phase 7 :
- **La génération et la correction par IA n'ont jamais tourné contre le vrai modèle** (pas de clé) : elles ne sont testées qu'avec un faux fournisseur de test. Les prompts sont à ajuster sur de vrais cours.
- Les exercices de **programmation** et **SQL** sont corrigés « par lecture » (comparaison IA à une référence) : les tests objectifs et l'exécution isolée sont l'objet de la phase 8 ; sans IA ils restent « non corrigés ».
- « Notions difficiles » utilise la maîtrise estimée quand elle existe (phase 9), sinon les notions principales du cours.
- Les très longs documents sont découpés en fenêtres de 12 000 caractères ; la génération s'exécute dans la requête (300 s maximum).
- Pas d'édition manuelle des questions générées ni de mode examen chronométré.

**Phase 8 — terminée** (laboratoires code et SQL, exécution isolée, tests objectifs). Vérifiée : 167 tests verts (dont 12 d'exécution réelle du runner, 17 d'intégration des laboratoires, 10 de domaine), `tsc` et `next build --webpack` OK (le runner et ses moteurs figurent dans le build `standalone`), et parcours réel dans le navigateur : exécution Python réelle, erreur affichée avec sa ligne et son diagnostic, indice, exercice SQL où une requête « codée en dur » réussit le jeu de l'énoncé mais échoue le jeu limite, exercice Python avec test caché, aucun défilement horizontal à 375 px.
- **Exécution réellement isolée** (corrige S1, S2 et S6) : chaque exécution lance un processus Node dédié (`src/server/labs/runner`) avec `--permission` (lecture limitée au runner et à ses moteurs ; ni écriture, ni processus enfant, ni worker, ni addon natif), un **environnement vide** (aucun secret du serveur), `--disallow-code-generation-from-strings`, et des moteurs **WebAssembly** : QuickJS (JavaScript et TypeScript transpilé par sucrase), Pyodide (Python 3), sql.js (SQLite). Le code étudiant n'est jamais exécuté par le moteur JavaScript du serveur. Chien de garde (arrêt brutal au délai), plafonds de sortie, de mémoire (QuickJS), de pages (SQLite), de récursion ; le processus est relancé pour les cas restants après un délai dépassé. Les résultats passent par un protocole signé par un nonce (le code étudiant ne peut pas les falsifier) ; `process`, `fetch`, `require` sont retirés de l'objet global avant le code étudiant (Pyodide expose `js`). Concurrence limitée (`LAB_MAX_CONCURRENT`, défaut 3). **Testé contre des attaques réelles** : lecture d'un fichier du serveur, lecture d'une variable d'environnement secrète, `js.process`, `js.fetch`, socket, `subprocess`, boucle infinie JS/Python/SQL (récursive), mémoire, sortie énorme.
- **Deux modes** : *libre* (jeu d'exemple SQL ou langage au choix, historique des exécutions, entrée standard) et *exercice* (énoncé, tests, indices, solution débloquée après une réussite ou 3 essais avec tests). Espaces de travail et exécutions dans `LabWorkspace` / `LabRun` ; activités `LAB_CODE` / `LAB_SQL` pour la reprise.
- **Tests objectifs** (aucune IA dans le verdict) : code par appel de fonction (valeur retournée comparée en JSON) ou par entrée/sortie standard ; SQL par comparaison du résultat (ou de requêtes de contrôle de l'état final) à celui d'une solution de référence sur le jeu de l'énoncé **et sur des jeux limites**. Cas limites et tests cachés (leur valeur attendue n'est jamais envoyée). Score pondéré.
- **Les tests proposés par l'IA ne sont que des candidats** : un test n'est retenu que si la solution de référence le réussit à l'exécution ; sinon il est écarté et signalé. Sans test fiable, l'exercice reste (exécution libre + indices) sans note inventée.
- **Import d'un document d'énoncés** : l'énoncé est cité verbatim depuis le document (vérifié), le document est traité comme donnée non fiable ; plusieurs exercices extraits d'un TP ; signalement des énoncés écartés, des tests écartés et des documents tronqués (24 000 caractères).
- **Questions de code/SQL des exercices générés** : correction par ces mêmes tests (points au prorata des tests réussis, détail et diagnostic dans la correction), bouton « Retravailler dans le laboratoire ».
- **Classification des erreurs** déterministe → `ErrorDiagnosis` (avec preuves) : syntaxe, exécution/plantage, boucle infinie, résultat faux, **cas limites** (les cas courants passent, pas les limites), format de sortie, consigne non respectée (nom de fonction/table/colonne, nombre de colonnes). **Concept, méthode, oubli, étourderie ne sont jamais déduits de simples tests** : seule l'explication IA peut les suggérer, enregistrés comme hypothèses faibles (confiance 0,5).
- **Aide sans donner la solution** : indices 1 (où regarder), 2 (la notion), 3 (la démarche) ; indices déterministes d'après les tests même sans IA ; l'IA voit la référence pour rester exacte mais sa sortie est filtrée (aucun bloc de code, aucune recopie de 6 mots de code consécutifs de la solution) sinon repli sur l'indice déterministe.
- **Retiré de la V1** : `executor.ts` (exécution par `vm`/processus non isolé), `sql-engine.ts` et la dépendance `better-sqlite3`, les anciennes vues Éditeur de code et Laboratoire SQL. Conservées jusqu'à la phase 9 : `/api/execute` et `/api/sql/run`, devenues de minces adaptateurs vers le nouveau runner pour la vue de session V1. Les tables V1 `ProgramRun` / `SqlQueryLog` ne sont plus alimentées (non supprimées).

Limites de la phase 8 :
- **Pas d'isolation réseau au niveau du système** : Node n'a pas d'option `--allow-net`. Le code Python/JS n'atteint pas le réseau (pas de `fetch`/`socket`, testé), mais pour un hébergement ouvert à des tiers, exécutez le serveur dans un conteneur sans accès sortant. Pas de limite mémoire dure pour Pyodide et SQLite (WebAssembly) : un programme gourmand est borné par le délai (5 s par cas), pas par un plafond d'octets ; sous Linux, ajoutez une limite de mémoire au conteneur.
- **Seuls Python, JavaScript, TypeScript et SQL (SQLite) sont exécutables.** Java, C, C++… ne sont jamais simulés : ils ne sont pas proposés. Un exercice généré dans un autre langage est corrigé par lecture (IA) ou « non corrigé ».
- Le premier lancement Python prend plusieurs secondes (chargement de Pyodide à chaque exécution : un processus par exécution, par choix d'isolation). Fichier unique par espace de travail (pas de projet multi-fichiers), pas de paquets Python tiers (bibliothèque standard seulement), pas de dialecte SQL autre que SQLite.
- Tests et solution de référence **écrits par l'IA** à l'import/à la génération : validés par cohérence (la référence les réussit), pas par un humain ; jamais testés contre le vrai modèle (pas de clé). Pas d'éditeur de tests.
- Les hypothèses CONCEPT/METHOD de l'IA sont enregistrées mais pas encore exploitées (phase 9). Non vérifié : écran tactile.
