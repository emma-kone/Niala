# Audit technique — redondances, dette, performance, maintenabilité

Date : 2026-11-04. Base : ~35 900 lignes dans `src/`, `prisma/`, `scripts/` (332 fichiers suivis). Aucune mesure de performance n'a été faite : **les constats de scalabilité sont des analyses de code, pas des mesures.**

## Synthèse

Le **serveur** est propre : couches nettes (route fine → service → domaine pur), types stricts (`tsc` : 0 erreur), logique pure testée. La **dette** est concentrée dans trois endroits : les restes de la V1 (tables, routes, état client, composants, dépendances), le **frontend** (composants volumineux, effets React, lint cassé), et l'**exécution synchrone** de traitements longs.

| ID | Constat | Gravité | Preuve | Priorité |
|---|---|---|---|---|
| TECH-01 | `app-store.ts` : ~170 lignes d'état V1 persistées en `localStorage` et **jamais lues** (`importDraft`, `generateConfig`, `sessionDrafts`, `codeLabCode`, `sqlLabSql`, `libraryMode`…) | Moyenne | Confirmé (`grep` : 0 usage hors du store) | P2 |
| TECH-02 | 26 composants `components/ui` sur 48 (3 719 lignes sur 5 397) sans importeur ; 21 dépendances sans import apparent | Faible | Confirmé | P3 |
| TECH-03 | Lint inutilisable : balaie `.next-local` (12 895 problèmes) ; 51 erreurs réelles ; ~25 règles désactivées | Moyenne | Confirmé | P2 |
| TECH-04 | Trois mécanismes de préférences locales : `niala-theme`, `niala-ui-v1` (zustand), clé web du chat ; plus `UserSettings` serveur | Moyenne | Confirmé | P2 |
| TECH-05 | Traitements IA/extraction **dans** la requête HTTP (analyse, génération, correction, import) ; pas de file | Élevée (serverless) | Confirmé | P1 si Vercel |
| TECH-06 | Recherche sémantique en mémoire et `ILIKE` non indexé | Moyenne | Confirmé | P2 |
| TECH-07 | Composants volumineux : `pdf-viewer` 696, `files-view` 620, `settings-view` 552, `map-editor` 526, `analysis-panel` 470, `chat-panel` 478 ; 91 `useEffect` dans `features/` | Moyenne | Confirmé | P2 |
| TECH-08 | Deux clients réseau côté navigateur (`api` de `client-api.ts` et 7 `fetch` directs, probablement pour `keepalive`/`pagehide`) | Faible | Confirmé | P3 |
| TECH-09 | Deux chemins d'appel IA (voir AI-04) ; deux diagnostics (DB-03) ; routes V1 mortes (SEC-10) | Moyenne | Confirmé | P2 |
| TECH-10 | `AGENTS.md` demande de lire `node_modules/next/dist/docs/` : Next 16 — vérifier les conventions avant d'ajouter un `proxy.ts` (ex-middleware) | Info | — | — |

## Redondances (élément · rôle · chevauchement · risque · simplification)

1. **État client V1 dans `app-store.ts`** · persistance UI · jamais consommée · localStorage grossit, clé `niala-ui-v1` + migration de `studyforge-ui-v1` (`app-store.ts:223-228`) · *Retirer* ces champs, ne garder que `user`/`auth`.
2. **Thème** : `theme-provider.tsx` (maison, `niala-theme`) + `next-themes` (dépendance **non importée**) + `UserSettings.theme` · trois sources de vérité · cause de FUN-02 · *Garder le provider maison, retirer `next-themes`, synchroniser à la connexion.*
3. **Diagnostics** : `ErrorDiagnosis` + `DiagnosisReport` (DB-03).
4. **Document / DocumentVersion** : colonnes dupliquées (DB-04).
5. **Routes d'exécution** : `/api/execute`, `/api/sql/run` (mortes) vs `/api/labs/*` (vivantes) · même runner · *supprimer les premières.*
6. **Tables V1** (DB-01) et relations V1 (`Subject.chapters`, `legacyExercise`).
7. **Appels IA** : `generateStructured` vs boucles directes (chat, images, recherche web).
8. **Constantes divergentes** : `MAX_FILES_PER_IMPORT` 20 vs 50 dans `prepare`.
9. **Réglages morts** (FUN-01).
10. **Bibliothèque** : `src/app/(app)/bibliotheque/page.tsx` et `/assistant` coexistent avec `/matieres` et le chat ; **À vérifier** s'il s'agit de redirections ou de doublons (non ouverts).

Rien n'est à « factoriser pour réduire les lignes » : les services d'analyse/exercices/labs se ressemblent mais portent des règles différentes — **ne pas les fusionner**.

## Dépendances et fichiers inutilisés (probable : recherche d'import textuelle, à confirmer par `knip`/`depcheck`)
Sans import dans `src/` : `@codemirror/lang-css`, `lang-html`, `lang-java`, `@dnd-kit/*` (3), `@hookform/resolvers`, `@mdxeditor/editor` (lourd), `@reactuses/core`, `@tanstack/react-query`, `@tanstack/react-table`, `date-fns`, `framer-motion`, `next-auth` (auth maison !), `next-intl`, `next-themes`, `react-syntax-highlighter` (+ prismjs vulnérable), `uuid`. (`sharp`, `react-dom`, `@tiptap/pm` sont des dépendances implicites légitimes.) `src/lib/supabase/{client,server}.ts` : aucun importeur → fichiers morts ainsi que `@supabase/ssr`. `next-auth` + `next-intl` portent un faux signal d'architecture (on croit à Auth.js).

## Performance et scalabilité (analyse, non mesurée)
- **Recherche de chat** : `retrieval.ts:127` charge jusqu'à 8 000 vecteurs (`Float[]`) **à chaque message**, calcule en JS ; `ILIKE` (`:108`) sans trigramme. Linéaire en nombre de passages indexés.
- **Pas de pagination** vérifiée sur : liste de documents/explorateur, dashboard ; `take` présents ailleurs (`labs.ts:124` 100, `chat.ts:58` 50, `resolveDocs` 500). **À vérifier** par `EXPLAIN` sur 10 000 documents.
- **Concurrence du runner** : 3 par processus (`host.ts:93`) ; au-delà, mise en file **dans la mémoire du processus web** (bloque les connexions HTTP en attente, jusqu'à 120 s).
- **Traitements bloquants** : extraction de PDF/DOCX et conversion PDF (`convert.ts` 708 lignes) dans la requête ; analyse IA 300 s ; correction 300 s.
- **Embeddings** : indexation « progressive » reprise au message suivant (bonne idée, `indexing.ts`), mais aucune tâche d'arrière-plan.
- **Cache** : aucune stratégie (pas de `revalidate`, pas de React Query malgré la dépendance) ; chaque page refait ses `fetch`.
- **Capacité** : *aucune estimation honnête possible sans test de charge.* Raisonnement : un utilisateur actif peut occuper 1 des 3 emplacements de runner pendant 5 à 40 s ; 10 étudiants simultanés dans un TP de SQL saturent déjà le pool d'un serveur unique. Pour une classe, prévoir un service d'exécution séparé.

## Maintenabilité
- **Points sensibles** (une modification en casse plusieurs) : `domain/exercise-model.ts` ↔ `exercise-grading.ts` ↔ `labs/lab-tests` ↔ `diagnosis/*` (le même `ExerciseAttempt.snapshot` est lu par 4 modules, 49 casts `as unknown as`) ; `domain/mastery.ts` ↔ `recommend.ts` ↔ `progress.ts` ; `runner/host.ts` ↔ `child.mjs` (protocole JSON non typé partagé).
- **Points forts** : `domain/` pur et testé, `ownership.ts`, `handle()` centralisé, messages d'erreur génériques en 500, `docs/` détaillé.
- **Dette de documentation** : chiffres périmés (FUN-05).
