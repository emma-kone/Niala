# Audit des tests et de la qualité

Date : 2026-11-04 · Commandes exécutées sur la copie de travail, sans modification de test ni de code.

## Résultats exécutés

| Contrôle | Commande | Résultat |
|---|---|---|
| Tests | `npx vitest run` | **28 fichiers, 312 tests, tous réussis** (59 s ; chaque fichier d'intégration démarre sa propre base PGlite) |
| Types | `npx tsc --noEmit` | **0 erreur** |
| Lint (tel que configuré) | `npx eslint .` | **12 895 problèmes (2 248 erreurs)** — presque tout vient du dossier de build `.next-local` que la configuration n'ignore pas (`eslint.config.mjs`, `ignores` ne liste que `.next/**`) |
| Lint (code réel) | `npx eslint src scripts` | **51 erreurs, 12 avertissements** : 28 `react-hooks/set-state-in-effect`, 16 `react-hooks/static-components`, 7 `react-hooks/refs` |
| Dépendances | `npm audit --omit=dev` | 10 vulnérabilités (6 élevées) — voir `AUDIT_SECURITE.md` SEC-04/SEC-11 |
| Build de production | `npm run build` | **Non exécuté** (écrit dans `.next`, génère le client Prisma ; non destructif mais hors périmètre « diagnostic sans effet de bord ») → *tests non exécutés* |
| Tests E2E / navigateur | — | **Absents** (aucun Playwright/Cypress) |

La suite est **réelle** : elle s'exécute sur une vraie base (PGlite = vrai moteur Postgres en WASM) et lance **de vrais processus** pour le runner (QuickJS, Pyodide, sql.js). Ce n'est pas une suite de « la fonction existe ».

## Ce qui est testé (et bien testé)

| Zone | Fichiers (tests) | Qualité observée |
|---|---|---|
| Runner / sécurité du code étudiant | `host.test.ts` (12) | Attaques réelles : fichiers du serveur, variables secrètes, `process`, `fetch`, boucles infinies JS/Python/SQL, mémoire, sortie énorme |
| Parcours complet | `journey.test.ts` (10) | import → analyse → note → cartes → exercice → tentatives → maîtrise → tableau de bord → labo → **isolation entre utilisateurs** |
| Exercices et barème | `exercises` (17), `domain/exercise` (15) | Somme exacte des points, citations vérifiées, multi-sources, transversal |
| Labos code/SQL | `labs` (18), `lab-tests` (10), `diagnosis` (13) | Tests objectifs validés par solution de référence |
| Diagnostic et tuteur | `engine` (20), `exercise` (11), `tutor` (14) | Garde-fous contre solution divulguée, injection dans la réponse |
| Chat | `chat.test.ts` (16) | Isolement, citations, couverture, panne du modèle sans perte de message |
| Analyse, notes, cartes | 16 + 10 + 13 | Corrections manuelles, conflits 409, restauration de versions |
| Progression | `progress` (9), `mastery` (12), `progression` (13), `adaptation` (5) | Prudence sur peu d'observations, idempotence |
| Migration V1→V2 | `migration-v2.test.ts` (9) | Sur PGlite uniquement |

## Lacunes

| ID | Lacune | Risque | Priorité |
|---|---|---|---|
| TST-01 | **Couche HTTP non testée** : aucun test n'appelle les routes `src/app/api/**` (69 routes). La règle « toute route passe par `requireUser` » repose sur la discipline (vérifié par recherche : seules `auth/*` et `api/route.ts` n'en ont pas) | Une route nouvelle sans garde passe inaperçue | P1 |
| TST-02 | **Aucun test d'interface** (111 fichiers `.tsx`, 0 test). Les 51 erreurs `react-hooks` ne sont pas rattrapées par des tests | Régressions d'UI, bugs d'effets (ex. thème, FUN-02) | P2 |
| TST-03 | **Aucun test de sécurité des en-têtes, de la limitation de débit par route, de la révocation de session** (`auth.test.ts` : 4 tests seulement) | SEC-01, SEC-05 non détectés | P1 |
| TST-04 | **Fournisseur IA réel jamais testé** : tous les tests IA utilisent un faux fournisseur (`vitest.config.ts` force les clés vides) ; pas de test de contrat sur les schémas de sortie réels de Gemini | AI-03 | P1 |
| TST-05 | Pas de test de **charge/volume** (embeddings 8 000, gros PDF, concurrence du runner) | DB-05, SEC-03 | P2 |
| TST-06 | Pas de test de la limite mémoire SQL **après** `PRAGMA max_page_count` (le test existant borne la mémoire sans override) | SEC-02 | P1 |
| TST-07 | Pilote Supabase Storage non testé ; migrations non testées sur base réelle | Défaillance au premier déploiement | P1 |
| TST-08 | Aucun test de cohérence inter-tables (`child.userId = parent.userId`, diagnostics doublonnés DB-03) | Données contradictoires | P2 |
| TST-09 | Aucune CI visible dans le dépôt (pas de `.github/workflows`) | Les 312 tests ne protègent que si lancés | P2 |
| TST-10 | Lint inutilisable en l'état et règles désactivées en masse (`no-undef`, `exhaustive-deps`, `no-unused-vars` désactivés) | Qualité non contrôlée | P2 |

## Scénarios manquants à écrire en priorité
1. Test HTTP « toute route d'`/api` renvoie 401 sans cookie » généré à partir de la liste des `route.ts`.
2. Connexion : un attaquant à 11 requêtes ne bloque pas un autre compte (SEC-01).
3. `PRAGMA max_page_count` / `writable_schema` refusés dans le runner SQL (SEC-02).
4. Suppression d'une matière : les conséquences listées = lignes réellement supprimées ; tentatives restantes cohérentes (DB-02).
5. Section de 20 000 caractères : notions extraites de toute la section ou couverture < 100 % signalée (AI-01).
6. Connexion → thème serveur appliqué sans rechargement (FUN-02), test de composant.
7. Contrat de sortie : jeu d'échantillons **réels** enregistrés une fois depuis Gemini, rejoués contre les schémas zod.

## Tests non exécutables / nécessitant un environnement
- Supabase (stockage, base) : clés absentes.
- Gemini/Anthropic : clés volontairement vides pendant les tests.
- Build `next build --webpack` : non lancé.
- Lecteur PDF en navigateur : non automatisé.
