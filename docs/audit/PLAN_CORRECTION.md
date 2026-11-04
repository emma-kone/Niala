# Plan de correction hiérarchisé

Date : 2026-11-04 · **Aucune correction n'a été appliquée.** Ce plan attend votre validation.
Difficulté : S (≤ ½ j) · M (1–3 j) · L (> 3 j). Les ID renvoient aux documents d'audit (`SEC-` sécurité, `DB-` base, `AI-` IA, `FUN-` fonctionnel, `PED-` pédagogie, `TECH-` technique, `TST-` tests).

## Principe d'ordre
1. Ce qui peut être **exploité ou nuire dès demain** (P0).
2. Ce qui rend le **suivi pédagogique faux ou destructeur** (P1) : avant toute nouvelle fonctionnalité.
3. Ce qui **bloque un déploiement** réel (P1 si Vercel/serverless).
4. Dette et confort (P2/P3).

## P0 — Immédiat

| # | Problème | Gravité | Diff. | Dépendances | Régression | Fonctions touchées | Stratégie |
|---|---|---|---|---|---|---|---|
| 1 | **SEC-01** limiteur de connexion global | Élevée | S | aucune | Faible | Connexion uniquement | Clés `login:ip` + `login:email`, délai croissant ; test « 11 essais n'interdisent pas un autre compte » |

## P1 — Avant toute évolution importante

| # | Problème | Gravité | Diff. | Dépendances | Régression | Touche | Stratégie |
|---|---|---|---|---|---|---|---|
| 2 | **SEC-06** secrets/données dans l'historique Git | Élevée | S–M | Accès GitHub, prod | Aucune (infra) | Auth production | Vérifier visibilité du dépôt ; changer `AUTH_SECRET` ; purger l'historique si public ; réinitialiser mots de passe V1 |
| 3 | **SEC-04** `pdfjs-dist` vulnérable | Élevée | M | Lecteur PDF | **Moyenne** (API 6.x) | Lecteur, annotations, sélection | Mettre à jour vers 6.2.108+ ; `isEvalSupported:false` ; test manuel sur 3 PDF |
| 4 | **DB-02 / PED-02** suppression de matière | Élevée | M | — | Moyenne | Matières, exercices, progression | Compter les enfants V2 dans les conséquences ; définir le sort des tentatives (supprimer ou figer) ; transaction |
| 5 | **PED-01** notions créées sans source | Élevée | S–M | PED-03 | Moyenne | Génération d'exercices, progression | Ne créer que des notions existantes ; sinon `QuestionConcept` sans notion ou notion `AI_INFERRED` marquée et exclue du suivi |
| 6 | **AI-01 / PED-03** troncature silencieuse de l'analyse | Élevée | M | — | Moyenne (coût IA) | Analyse, notions, exercices par notion | Fenêtrer les sections longues ; enregistrer et afficher la couverture d'analyse |
| 7 | **AI-03** valider les prompts en réel + corriger la doc | Élevée | M | Clé Gemini | Faible | Tout l'IA | 3 vrais cours ; sorties conservées comme jeu de contrat (TST-04) |
| 8 | **SEC-02** `PRAGMA max_page_count` | Moyenne | S | — | Faible | Labo SQL | Liste blanche des `PRAGMA` ; limite imposée par le moteur ; test TST-06 |
| 9 | **SEC-05** en-têtes HTTP | Moyenne | S–M | SEC-04 (CSP vs pdf.js) | Moyenne (CSP) | Toute l'UI | `headers()` ; `poweredByHeader:false` ; tester lecteur, éditeurs, cartes |
| 10 | **SEC-03 / SEC-07 / AI-06 / TECH-05** — *si hébergement serverless ou ouvert à des tiers* : exécution hors processus web, stockage de limites partagé, tâches reprenables | Élevée | L | Choix d'hébergement | Haute | Labos, analyse, génération | Décision d'hébergement d'abord ; sinon rester mono-instance et documenter |
| 11 | **TST-01** test « toutes les routes protégées » ; **TST-07** essai sur copie Supabase | Moyenne | S–M | — | Aucune | — | Générer la liste depuis `route.ts` ; rejouer les migrations sur copie |

## P2 — Prochaines phases

| # | Problème | Gravité | Diff. | Stratégie |
|---|---|---|---|---|
| 12 | **SEC-08** sessions révocables (+ changement de mot de passe) | Moyenne | M | `tokenVersion` sur `User` |
| 13 | **SEC-09** dépôts (chunked, zip) | Moyenne | S–M | Lecture en flux avec plafond ; taux de décompression |
| 14 | **SEC-10 / TECH-09** retirer `/api/execute`, `/api/sql/run`, `/api` | Faible | S | Supprimer après `grep` final ; aucun appelant |
| 15 | **SEC-11** dépendances | Moyenne | S–M | Retirer `react-syntax-highlighter`, mettre à jour `sharp`, `@prisma/*` |
| 16 | **FUN-02** thème après connexion | Moyenne | S | Resynchroniser à l'authentification ; purger `niala-theme` au logout |
| 17 | **FUN-01 / DB-06** réglages sans effet | Moyenne | S–M | Brancher (mode par défaut, indices) ou supprimer l'UI et les colonnes |
| 18 | **DB-03** un seul modèle de diagnostic | Moyenne | L | Mapping des catégories ; migration de données sur copie ; **ne pas** fusionner à la hâte |
| 19 | **DB-04** colonnes V1 de `Document` | Moyenne | M | Vérifier 100 % `currentVersionId` ; lecture uniquement `DocumentVersion` ; retirer en 2 temps |
| 20 | **DB-01** archiver les tables V1 | Moyenne | M | `prisma/optional/archive_v1_tables.sql` après sauvegarde |
| 21 | **DB-05 / TECH-06** pgvector + index trigramme | Moyenne | L | Quand le volume le justifie (mesurer d'abord) |
| 22 | **AI-04 / AI-05** wrapper IA unique, quota par appel réel | Moyenne | M | Un seul `callModel` pour journal + quota |
| 23 | **AI-07** information sur l'envoi des cours à Google | Moyenne | S | Mention + case d'accord |
| 24 | **PED-04** chat → activité/observation | Moyenne | M | Décision produit d'abord |
| 25 | **PED-07 / PED-09** calibrage des seuils ; reprise des données V1 | Moyenne | M | Avec vraies données |
| 26 | **TECH-01/03/04** nettoyage du store, lint (ignorer `.next*`, traiter les 51 erreurs), préférences unifiées | Moyenne | M | Après FUN-02 |
| 27 | **TST-02/03/08/09** tests d'UI, de sécurité, de cohérence, CI | Moyenne | M–L | Playwright sur le parcours principal ; CI sur PR |

## P3 — Secondaire
SEC-12 (chemin dans `os.environ`), SEC-13 (énumération par timing, `niala-theme` non scopé), FUN-03/04/05 (compteurs V1, constantes, docs périmées), PED-05/06/08 (`REVISION`, notions du document de départ), TECH-02 (26 composants et 21 dépendances inutilisés), TECH-08 (`fetch` directs), DB-07/09/10.

## Jalons proposés
- **Jalon A (1–2 j)** : #1, #2, #8, #14, #16 — risques immédiats, correctifs courts.
- **Jalon B (1 semaine)** : #3, #4, #5, #6, #9, #11 — rend le suivi fiable et protège les données.
- **Jalon C** : #7 puis P2 selon la décision d'hébergement (#10 conditionne beaucoup).

## À valider avec vous
1. **Hébergement visé** (serveur unique ou Vercel/serverless ; ouvert à des tiers ou usage personnel) : change la priorité de #10, SEC-03, SEC-07.
2. **Visibilité du dépôt GitHub** et usage de l'`AUTH_SECRET` historique (SEC-06).
3. **Sort des tentatives** lors de la suppression d'une matière (DB-02).
4. **Réglages inertes** : brancher ou retirer (FUN-01).
