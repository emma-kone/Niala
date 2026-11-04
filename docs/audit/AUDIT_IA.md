# Audit des services IA (Gemini) — Niala

Date : 2026-11-04 · Fichiers : `src/server/ai/*` (`provider`, `structured`, `guard`, `json`, `web-search`), `services/analysis/ai-services.ts`, `services/exercises/{generation,evaluation}.ts`, `services/chat/*`, `services/images.ts`, `services/labs/hints.ts`, `diagnosis/tutor.ts`.

**Limite majeure de cet audit** : aucune clé IA n'était disponible. J'ai donc lu le code et les 312 tests (qui utilisent un **faux fournisseur**), mais **aucune réponse réelle de Gemini n'a été observée par moi**. Le projet affirme dans `docs/FONCTIONNALITES-ET-LIMITES.md` à la fois « Aucune fonction IA n'a tourné contre le vrai modèle » (l.37) et « ✔ vu en réel avec Gemini » (chat, images, accompagnement, multi-sources : l.12, 18, 20, 21). Ces deux affirmations sont **contradictoires** ; je ne peux confirmer ni l'une ni l'autre.

## Synthèse

L'architecture IA est **la partie la mieux conçue** du projet : un seul point d'entrée structuré, validation zod stricte, citations vérifiées dans le texte réel, décisions critiques (barème, verdict de test, maîtrise) retirées à l'IA, document traité comme donnée non fiable. Les défauts sont ailleurs : troncature silencieuse des documents, chemins d'appel parallèles, quota rudimentaire, prompts jamais calibrés.

| ID | Constat | Gravité | Preuve | Priorité |
|---|---|---|---|---|
| AI-01 | L'analyse des notions n'envoie que les **6 000 premiers caractères** de chaque section, sans l'indiquer à l'étudiant | **Élevée** | Confirmé (code) | P1 |
| AI-02 | Repli de structure : seuls les **30 000 premiers caractères** du document sont lus | Moyenne | Confirmé (code) | P2 |
| AI-03 | Prompts jamais éprouvés sur un vrai modèle/cours ; documentation contradictoire | Élevée (qualité) | Confirmé (doc) | P1 |
| AI-04 | Deux chemins d'appel : `generateStructured` (quota, journal, réparation) et `chat.ts`/`images.ts`/web-search (journal et quota propres) | Moyenne | Confirmé | P2 |
| AI-05 | Quota = nombre de lignes de log sur 24 h (300 par défaut) : ni jetons, ni coût, ni verrou atomique ; les échecs comptent | Moyenne | Confirmé (code) | P2 |
| AI-06 | Génération/analyse **synchrones** dans la requête HTTP (jusqu'à 300 s) : pas de reprise, pas de file | Élevée en hébergement serverless | Confirmé (`maxDuration`) | P1 si Vercel |
| AI-07 | Contenu des cours envoyé à Google sans consentement/mention visible dans l'interface | Moyenne (vie privée) | À vérifier (aucune occurrence « Gemini » dans `src/features`) | P2 |
| AI-08 | Interprétations et seuils (confiance 0,4–0,65, demi-vie 30 j…) non calibrés | Moyenne | Confirmé (doc) | P2 |

## Ce qui est bien fait (Confirmé par lecture et tests)

- **Point d'entrée unique** : `generateStructured` (`structured.ts:50-108`) — quota, délai (`AbortSignal.timeout(120 s)`), journal `AIUsageLog`, validation **zod**, **une** réparation avec la liste des erreurs, version de prompt tracée (`op@promptVersion`). Aucun composant React ni route n'appelle l'IA (vérifié : `grep` des fournisseurs hors `src/server`).
- **Clé** : lue côté serveur seulement, en-tête `x-goog-api-key` (`provider.ts:93`), jamais journalisée.
- **Anti-injection** : `wrapUntrusted` (balise à jeton aléatoire) + `UNTRUSTED_RULES` dans les prompts d'analyse, de structure, d'aide ; code étudiant traité comme donnée (`hints.ts:132-139`).
- **Ancrage vérifié** : une notion n'est « DOCUMENT » que si sa citation est retrouvée mot pour mot (`ai-services.ts:117-120`, `quoteInText`) ; relations vers notions inconnues rejetées (l.131) ; questions d'exercices sans citation retrouvée **écartées** et comptées (« écartées : format invalide, citation introuvable, doublon », `generation.ts:430`).
- **Séparation IA / déterministe** : plan du document déterministe d'abord, cartes sans IA, barème et verdicts par règles/tests exécutés, IA bornée pour les réponses rédigées. C'est le bon choix : Gemini n'est utilisé que là où un humain l'aurait été (extraction de notions, énoncés, explications, réponses libres, transcription d'image).
- **Chat** : l'IA n'a pas de résumé ; elle **explore** par outils (`chat.ts:25` : 5 étapes max ; `retrieval.ts` : recherche hybride, lecture de 4 pages max, plan) et **répond avec la couverture réelle** (pages sans texte, vecteurs manquants). Les références `[n]` ne sont conservées que si le passage a été réellement consulté. Réponse à la question « utilise-t-elle réellement le contenu ? » : **oui pour le chat** (lecture de passages bruts), **partiellement pour l'analyse** (AI-01).

## Détail des défauts

### AI-01 — Troncature silencieuse de l'analyse (Élevée, P1)
`ai-services.ts:70` `MAX_SECTION_CHARS = 6_000`, appliqué en `:83` (`batchSections`) et `:108` (`extractConcepts`). Une section de 15 000 caractères (un chapitre sans sous-titres, un cours sans numérotation) n'est lue qu'à 40 % : les notions du reste n'existent pas, et rien ne l'indique (pas de `coverage` côté analyse, contrairement au chat). Conséquence directe sur les exercices ciblés « par notion » et la progression. **Correction** : découper les sections longues en fenêtres plutôt que tronquer, ou enregistrer et afficher la proportion analysée. **Régression** : coût IA ×N sur longs cours ; tests `analysis.test.ts` à étendre.
Les exercices utilisent des fenêtres de 12 000 caractères **par fenêtre** couvrant le document (`generation.ts:35-56`) : pas de troncature globale, mais l'extrait `half` (`:215`) en divise certaines par 2.

### AI-04 — Chemins d'appel parallèles
`checkQuota` est appelé depuis `structured.ts`, `chat.ts:286`, `images.ts:20`, mais **le journal du chat est écrit à part** (`chat.ts:274`, `op: "chat.turn@1"`) et la boucle d'outils appelle `provider` directement. Un tour de chat peut déclencher jusqu'à 6 appels modèle mais est compté **une fois** → le quota de 300 sous-estime la consommation réelle. Même remarque pour les embeddings (`indexing.ts`) et la recherche web.

### AI-05 — Quota
`checkQuota` (`structured.ts:42-48`) fait un `count` puis laisse passer : deux requêtes simultanées passent toutes deux (course). Aucune limite de **taille** par appel au-delà de `maxTokens`. Pas de budget en coût. Les appels en échec (réseau) comptent, alors que l'étudiant n'a rien reçu.

### AI-06 — Appels longs dans la requête
`exercises/route.ts` (300 s), `files/[id]/analysis` (300 s), `attempts/[id]/submit` (300 s) font tout le travail IA pendant la requête. Sur plateforme à délai court, la requête meurt **après** avoir consommé le quota et peut laisser un état partiel (l'analyse marque « Analyse interrompue » à la relance, `analysis-service.ts:91`). Pas de tâche en arrière-plan ni de reprise.

### AI-07 — Vie privée
Les cours (pages complètes) sont envoyés à Google (Gemini API). Aucun écran du produit ne le dit ni ne demande l'accord (recherche de « Gemini » dans `src/features` : 0 résultat). À vérifier avec le propriétaire du produit et le statut des données de l'API utilisée.

## Redondances de prompts
`UNTRUSTED_RULES` est factorisé (`guard.ts`). En revanche les consignes « moins de questions plutôt que d'invention », « citation verbatim », « JSON uniquement » sont réécrites dans chaque prompt (analyse, structure, génération, aide) : écart possible à la maintenance mais **pas de contradiction constatée**. Aucune comparaison systématique de l'ensemble des prompts n'a été faite (**À vérifier**).

## Recommandations
1. Avant toute nouvelle fonction IA : exécuter une fois les 5 services contre le vrai modèle sur 3 vrais cours et conserver les sorties (jeu de référence) ; corriger la documentation.
2. Corriger AI-01, puis exposer la couverture d'analyse.
3. Centraliser journal + quota dans un seul wrapper `callModel`, compter par appel réel.
4. Passer les traitements longs en tâche reprenable (table `Job`, statut, polling) avant tout déploiement serverless.
