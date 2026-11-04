# Audit fonctionnel — inventaire et état réel

Date : 2026-11-04.

**Comment lire le niveau de preuve.** Trois sources, de la plus forte à la plus faible :
- **Réel** : exécuté par moi sur l'application locale (base PGlite jetable, 2 comptes de test, **sans clé IA**, stockage disque).
- **Auto** : couvert par les 312 tests automatisés (tous verts, voir `AUDIT_TESTS.md`) — le plus souvent sur un *faux* fournisseur IA et une base PGlite.
- **Lecture** : code lu, comportement non exécuté.

Statuts demandés : *Fonctionnelle et validée* · *Fonctionnelle mais fragile* · *Partiellement implémentée* · *Interface seule* · *Simulée* · *Inachevée* · *Non fonctionnelle* · *Redondante* · *À vérifier*.
**Aucune fonctionnalité n'est classée « Fonctionnelle et validée » de bout en bout avec le vrai modèle IA**, faute de clé : c'est honnête, pas pessimiste.

## A. Matières et organisation

| Fonctionnalité | Statut | Preuve | Remarques |
|---|---|---|---|
| Créer/lister/renommer une matière | Fonctionnelle et validée | Réel (création, liste), Auto | Doublons refusés (normalisation, `subjects/[id]/route.ts:46`) |
| Supprimer une matière | **Fragile** | Lecture | Avertissement **incomplet** : voir DB-02 |
| Dossiers récursifs (créer, renommer, déplacer, supprimer) | Fonctionnelle et validée | Auto (`services.test.ts`) | Pas de glisser-déposer ; pas de déplacement entre matières (documenté) |
| Import de documents (PDF, DOCX, PPTX, TXT, MD, PNG/JPG/WebP) | Fonctionnelle | Réel (MD : prepare → PUT → finalize → `READY`), Auto | Contrôle de signature, SHA-256 ; limites : voir SEC-09 |
| Gestion des versions | **Partielle** | Lecture | Modèle prêt (`DocumentVersion`), **aucun moyen d'ajouter une version depuis l'interface** (documenté) |
| Stockage de l'original | Fonctionnelle (disque) / **À vérifier** (Supabase) | Réel (disque), Auto | Pilote Supabase jamais exécuté |
| Recherche (nom + contenu) | Fonctionnelle | Auto | `ILIKE` sans index |
| Notes liées (document/passage/page) | Fonctionnelle | Auto | Révision optimiste + 409 |

## B. Documents et analyse

| Fonctionnalité | Statut | Preuve | Remarques |
|---|---|---|---|
| Lecteur fidèle (pdf.js, texte, image) | Fonctionnelle mais **fragile** | Auto (octets identiques) ; Lecture | `pdfjs-dist` vulnérable (SEC-04) ; non ouvert en navigateur par moi |
| Aperçu PDF de DOCX/PPTX/TXT/MD | Partielle | Auto (8 tests) | Mise en page reconstruite ; caractères hors Latin-1 → `?` ; jamais comparé à de vrais cours |
| Extraction par page, indexation en passages | Fonctionnelle | Réel (MD → READY) | PDF scannés : pas d'OCR (documenté) |
| Plan hiérarchique (déterministe) | Fonctionnelle | Auto (document réel `analysis.test.ts`) | Dépend d'une numérotation ; sinon repli IA (AI-02) |
| Notions + relations (IA) | **Fragile / non validée en réel** | Auto (faux fournisseur) | Troncature à 6 000 car./section (AI-01) |
| Cartes mentales (structure + conceptuelle, éditables) | Fonctionnelle | Auto (13 tests) | Construites **sans IA** ; non testées en navigateur ni tactile |
| Recherche dans le document | À vérifier | — | Recherche globale ; pas de test de recherche intra-lecteur |
| Références page/passage | Fonctionnelle | Auto (`quoteInText`, `retrieval.test.ts`) | |
| Gros fichiers | **Fragile** | Lecture | Plafond 20–50 Mo, tout en mémoire (SEC-09) ; extraction synchrone dans la requête |
| Erreurs d'extraction | Fonctionnelle | Auto | États `FAILED/PARTIAL`, avertissements |

## C. Chat IA

| Fonctionnalité | Statut | Preuve |
|---|---|---|
| Chat global et par document | Fonctionnelle (faux fournisseur) / **À vérifier** (Gemini) | Auto (16 tests : isolement, citations, couverture, panne modèle) |
| Historique, renommage, suppression | Fonctionnelle | Auto |
| Sources et références `[n]` | Fonctionnelle | Auto |
| Limites de contexte | Fonctionnelle (historique borné, 5 étapes) | Lecture |
| Recherche web | À vérifier | Moteur absent sans clé (`/api/ai/status` → `web.available:false`, Réel) |
| Persistance et isolation | Fonctionnelle | Auto |

## D. Exercices

| Fonctionnalité | Statut | Preuve |
|---|---|---|
| Configuration (nombre, barème exact ≤ 100, 12 types, difficulté, couverture) | Fonctionnelle | Auto (`exercises.test.ts`, 451 lignes) |
| Génération IA mono et **multi-sources** | **Non validée en réel** | Auto (faux fournisseur) |
| Fondement dans les sources sélectionnées | Fonctionnelle par conception | Auto : citation vérifiée, question écartée sinon ; version exacte conservée par source |
| Correction (règles / mots-clés / IA bornée) | Fonctionnelle (règles) ; **IA non validée** | Auto |
| Séparation énoncé / clé de correction (pas de fuite avant soumission) | Fonctionnelle | Lecture (`exercise-model.ts:172-229`, `attempts.ts:125-160`) |
| Tentatives figées, reprise | Fonctionnelle | Auto |
| Association aux notions | **Fragile** | Lecture : `generation.ts:438-439` crée une notion **sans source** (PED-01) |
| Édition manuelle des questions / mode examen chronométré | **Absent** (documenté) | — |

## E. Éditeur de code

| Langage | Affiché | Exécutable | Preuve |
|---|---|---|---|
| Python | Oui | **Oui** (Pyodide, isolé) | Réel (`print`, `os.environ`), Auto |
| JavaScript / TypeScript | Oui | **Oui** (QuickJS / sucrase) | Auto (12 tests runner) |
| SQL (SQLite) | Oui | **Oui** (sql.js) | Réel, Auto |
| C, C# | Oui (modèle + coloration) | **Non** — bouton désactivé et expliqué, rien de simulé | Auto, Lecture (`lab-workspace.tsx:119` `editorOnly`) |
| Java, C++ (`lang-java` installé) | Non proposés | Non | Dépendance `@codemirror/lang-java` inutilisée |

Analyse en direct sans exécution (JS, Python `compile`, SQL `EXPLAIN`) : fonctionnelle (Auto, 11 tests). Sauvegarde/historique des exécutions (`LabRun`, 30 derniers) : fonctionnelle. Diagnostic IA : voir §G. **L'isolation est solide mais limitée** (SEC-02, SEC-03). Bibliothèque standard Python seulement (pas de `numpy`) ; démarrage Pyodide lent (~5 s, Réel : 10 ms pour `exec`, mais chargement par processus).

## F. Laboratoire SQL
Fonctionnelle : jeux de test (`SQL_FIXTURES`), schéma relationnel extrait (`PRAGMA table_info/foreign_key_list`), comparaison de résultats avec référence, tests cachés. Preuve : Réel (`/api/sql/run`) et Auto (`labs.test.ts`, 397 lignes). Faille de limite mémoire : SEC-02. Pas d'import de données utilisateur dans ce labo (hors énoncés issus de documents, `labs/import.ts`).

## G. Progression et suivi
- 6 états de maîtrise, recalcul idempotent, prérequis mesurés, recommandations justifiées : **Fonctionnelle** (Auto : 9 + 12 + 13 tests ; Réel : `/api/dashboard` vide → `hasData:true`, `mastery:null`, ce qui est cohérent).
- **Formules non calibrées** (demi-vie 30 j, seuils) : documenté, à valider sur de vrais usages.
- Reprise d'activité : lecture (page), exercices, labos créent un `LearningActivity` ; **chat et notes n'en créent pas** ; le type `REVISION` n'est écrit nulle part (`grep` : 0 écriture).
- Profil pédagogique / diagnostics : Auto (31 + 20 + 14 tests).

## H. Paramètres

| Réglage | Statut | Preuve |
|---|---|---|
| Thème (sombre par défaut, clair, système) | Fonctionnelle **avec défaut** (FUN-02) | Réel |
| Taille maximale d'import | Fonctionnelle | Lecture (`documents.ts`) |
| Mode par défaut (`defaultMode`) | **Interface seule** : enregistré, jamais lu | `grep` : lu uniquement par la page de réglages |
| Indices activés (`hintsEnabled`) | **Interface seule** | idem (copie dans le store) |
| Langue des exercices / modèle IA / rétention | **Affichage seul** (lecture seule ou inerte) | idem ; aucune purge de rétention n'existe |

## Défauts fonctionnels constatés

- **FUN-01 (Moyenne, P2, Confirmé)** — Réglages sans effet : `defaultMode`, `hintsEnabled`, `exerciseLang`, `retentionDays`, `aiModel`. L'interface laisse croire à une personnalisation. Soit brancher (mode par défaut dans `create-view`, indices dans le labo), soit retirer.
- **FUN-02 (Moyenne, P2, Confirmé en réel)** — *Thème personnel non restauré après connexion.* Compte A avec `theme:"light"` en base ; connexion par le formulaire → la page reste **sombre**, `localStorage["niala-theme"]` absent. Après rechargement : clair, avec éclair sombre avant (le script d'initialisation lit le stockage local, pas le serveur). Cause : `theme-provider.tsx:80-91` ne synchronise qu'**au montage** (déjà exécuté sur `/login`, réponse 401) ; le provider est dans le layout racine, donc pas relancé à la navigation. Le **thème sombre par défaut au premier chargement fonctionne** (Réel : classe `dark` + `color-scheme: dark`). Correction : relancer la synchronisation quand `useAppStore.user` passe à connecté ; nettoyer `niala-theme` à la déconnexion.
- **FUN-03 (Faible, Confirmé)** — `GET /api/subjects` renvoie `_count.exercises/sessions` **V1** (`subjects/route.ts:22`) : toujours 0, non utilisé par l'interface ; trompeur pour un futur développeur.
- **FUN-04 (Faible, Confirmé)** — `prepare` accepte 50 fichiers (`uploads/prepare/route.ts`) alors que `MAX_FILES_PER_IMPORT = 20` (`file-validation.ts:21`) : deux constantes qui divergent.
- **FUN-05 (Faible, Confirmé)** — Documentation périmée : `docs/ARCHITECTURE.md` §7 annonce 198 tests (réels : **312**) ; `docs/V2-AUDIT-ET-PLAN.md` dit « étape 3 en attente » ; contradiction sur les essais en réel (voir `AUDIT_IA.md`).

## Fonctionnalités absentes ou factices
- **Simulées** : *aucune détectée*. Le projet n'utilise le faux fournisseur que dans les tests (`docs/ARCHITECTURE.md` §4 ; vérifié : pas de données fictives dans les routes).
- **Interface seule** : réglages ci-dessus ; `/bibliotheque` et `/assistant` : **À vérifier** (non ouverts).
- **Inachevées (documentées)** : nouvelle version de document, OCR, glisser-déposer, édition manuelle des questions, mode examen, rappel espacé, courbe de maîtrise.

## Parcours réel exécuté (limité)
Connexion A/B → création de matière → import `cours.md` (prepare, PUT, finalize → `READY`, 1 page) → lecture API du document → isolation (8 routes) → réglages (`PUT theme`) → tableau de bord → `/api/sql/run` → `/api/execute` (Python) → login par navigateur → thème. **Non exécutés** : lecteur, analyse (même déterministe), chat, exercices, labos par l'interface, progression avec données, fermeture/reprise de session. Raison : pas de clé IA et temps ; ces parcours sont couverts seulement par `journey.test.ts` (faux IA).
