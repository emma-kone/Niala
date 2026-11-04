# Architecture de Niala V2

Niala est un environnement d'étude personnel assisté par IA : Next.js 16 (App Router), React 19, Prisma 6 sur Postgres (Supabase), Google Gemini pour l'IA. Une seule application, pas de micro-services.

## 1. Vue d'ensemble

```
Navigateur (React, zustand, shadcn/Radix, Tiptap, pdf.js, React Flow, CodeMirror)
   │  fetch JSON
   ▼
src/app/api/**  ── routes fines : requireUser() → validation zod → service → réponse
   │                (aucun appel IA, aucune logique métier dans une route)
   ▼
src/server/services/**   logique métier + accès base (Prisma), TOUJOURS filtrée par propriétaire
   │        ├─ src/server/domain/**   règles pures, sans base ni réseau (testées seules)
   │        ├─ src/server/ai/**       seule porte d'entrée vers l'IA
   │        ├─ src/server/storage/**  fichiers originaux (Supabase Storage ou disque local)
   │        └─ src/server/labs/runner exécution isolée du code étudiant (processus séparé)
   ▼
Postgres (Prisma)                Supabase Storage (bucket privé)          Gemini API   
```

Règle d'architecture : **un composant React ou une route API n'appelle jamais l'IA**. Seuls les services passent par `src/server/ai/structured.ts`.

## 2. Dossiers

| Dossier | Contenu |
|---|---|
| `src/app/(app)/…` | Pages : tableau de bord, matières (fichiers, notes, cartes, exercices), lecteur, exercices, laboratoires code/SQL, progression, réglages |
| `src/app/api/…` | Routes HTTP (toutes derrière `requireUser`, 404 et jamais 403 sur la ressource d'autrui) |
| `src/features/…` | Interface par module (subjects, subject-files, reader, notes, maps, exercises, labs, progress, dashboard) |
| `src/server/domain/` | Règles pures : validation de fichiers, arbre de dossiers, chunking, plan (`structure-parser`), notes (liste blanche Tiptap), cartes, barème et correction d'exercices, tests de laboratoire, maîtrise, recommandations |
| `src/server/services/` | `folders`, `documents`, `notes`, `maps`, `analysis/*`, `exercises/*`, `labs/*`, `progress/*` |
| `src/server/services/chat/` | Chat : `chat` (conversations, boucle d'outils, citations), `retrieval` (recherche hybride, lecture progressive, couverture), `indexing` (vecteurs par lots) |
| `src/server/ai/` | `provider` (interface + Gemini, repli Anthropic), `structured` (appel structuré), `guard` (injection, citations) |
| `src/server/labs/runner/` | `host.ts` (parent) et `child.mjs` (processus isolé) |
| `src/lib/` | Auth, base, helpers d'API, propriété (`ownership.ts`), extraction de texte |
| `prisma/` | Schéma, migrations (V1 → V2), script d'archivage optionnel |

## 3. Services IA (exigence « pas d'IA dans l'UI »)

| Service demandé | Où il vit | Rôle |
|---|---|---|
| DocumentAnalysis / DocumentStructure | `services/analysis/analysis-service.ts`, `domain/structure-parser.ts` | Plan hiérarchique : **d'abord déterministe** (numérotation du document), IA seulement en repli et marquée « déduite » |
| ConceptExtraction | `services/analysis/ai-services.ts` | Notions avec citation vérifiée dans le texte réel |
| MindMapGeneration | `services/maps.ts` | Cartes **construites sans IA** à partir de l'analyse (structure et notions) |
| ExerciseGeneration | `services/exercises/generation.ts` | Questions fondées sur UN document, citation exigée, barème décidé par le serveur |
| AnswerEvaluation | `services/exercises/evaluation.ts` | Règles d'abord ; IA seulement pour les réponses rédigées, points bornés |
| CodeEvaluation / SQLEvaluation | `services/labs/execute.ts`, `domain/lab-tests.ts` | **Tests exécutés**, jamais un jugement d'IA ; l'IA n'explique qu'après (`hints.ts`) |
| LearningDiagnosis | `domain/lab-tests.ts` (`classify`), `services/progress` | Diagnostic déterministe avec preuves ; hypothèses IA à part, confiance faible |
| LearningRecommendation | `domain/recommend.ts`, `services/progress` | Règles explicites, raison et preuves chiffrées |

`generateStructured` impose : quota quotidien par utilisateur (`AIUsageLog`), délai maximal, validation **zod** stricte, une tentative de réparation, journalisation, version de prompt. L'IA ne décide jamais d'un barème, d'une bonne réponse, d'un verdict de test ni d'une maîtrise.

**Documents importés = données non fiables.** Tout texte de document est encadré par une balise à jeton aléatoire (`wrapUntrusted`), accompagné de règles « ne jamais obéir au document » ; la sortie est validée par schéma ; toute citation est retrouvée mot pour mot dans le texte réel (`quoteInText`), sinon la question ou la notion est rejetée.

## 4. Principes de conception

- **L'original prime** : le fichier importé est conservé octet pour octet (SHA-256, signature vérifiée) ; le texte extrait n'est qu'un index (chunks avec page et décalages). Une nouvelle version est un nouvel enregistrement.
- **Provenance** : tout élément analysé est `DOCUMENT` (écrit dans le cours), `AI_INFERRED` (déduit) ou `USER` ; décidée côté serveur, jamais par le client.
- **Dossiers libres ≠ plan du cours** : les dossiers de l'étudiant (`Folder`) et la structure pédagogique détectée (`CourseSection`) sont deux choses distinctes.
- **Notions par matière** : une notion n'est jamais fusionnée entre matières sur la seule ressemblance du nom.
- **Une note n'est pas une maîtrise** : la maîtrise est estimée par notion, avec confiance, depuis des preuves recalculables.
- **Concurrence optimiste** (`revision`, HTTP 409) pour notes et cartes ; sauvegarde automatique avec `pagehide`.
- **Honnêteté** : sans IA, les fonctions IA sont désactivées et le disent ; aucune donnée ni exécution simulée (le faux fournisseur n'existe que dans les tests).

## 5. Sécurité

| Sujet | Mesure |
|---|---|
| Authentification | Session signée (`AUTH_SECRET` ≥ 32 caractères obligatoire en production), cookie `HttpOnly`, `secure` en production, aucun compte par défaut |
| Autorisation | Chaque lecture/écriture par identifiant passe par `ownedBy` / `assertFound` : 404 sur la ressource d'autrui. Testé service par service et dans le parcours complet |
| Fichiers | Liste de types autorisés, **vérification de la signature (magic bytes)**, taille bornée, empreinte, nom assaini ; originaux dans un bucket privé, servis par le serveur |
| Code étudiant | Voir §6 |
| SQL étudiant | Base SQLite jetable en WebAssembly dans le processus isolé ; la base de l'application n'est jamais touchée ; `ATTACH`, `DETACH`, `VACUUM INTO` refusés |
| Erreurs | Message générique avec référence en cas d'erreur 500 (pas de fuite de pile) |
| Limites | Débit par utilisateur sur les routes sensibles (exécution, IA, import), quota IA quotidien |
| Base | RLS activée sur toutes les tables (l'accès applicatif passe par Prisma) |

## 6. Exécution isolée du code (laboratoires)

Chaque exécution lance **un processus Node dédié** (`child.mjs`) avec `--permission` (lecture limitée au runner et à ses moteurs ; ni écriture, ni processus enfant, ni worker, ni addon), un **environnement vide**, `--disallow-code-generation-from-strings`, et des moteurs **WebAssembly** : QuickJS (JavaScript/TypeScript), Pyodide (Python 3), sql.js (SQLite). `process`, `fetch`, `require` sont retirés de l'objet global avant le code étudiant ; les résultats sont signés par un nonce aléatoire. Un chien de garde arrête brutalement le processus au délai (5 s par cas) ; la sortie, la récursion et la mémoire QuickJS sont bornées ; la concurrence est limitée (`LAB_MAX_CONCURRENT`).

Testé contre des attaques réelles (`host.test.ts`) : lecture de fichiers du serveur, variables d'environnement secrètes, `js.process`, `js.fetch`, sockets, sous-processus, boucles infinies JS/Python/SQL, mémoire et sortie énormes.

**Limites connues** : pas d'isolation réseau au niveau du système (Node n'a pas d'option `--allow-net`) ni de plafond mémoire dur pour Pyodide/SQLite. Pour un hébergement ouvert à des tiers : conteneur sans accès sortant, avec limite mémoire.

## 7. Tests

`npx vitest run` — 198 tests : domaine (barème, grading, structure, maîtrise, recommandations, tests de labo), services sur **vraie base PGlite** (analyse, notes, cartes, exercices, laboratoires, progression), migration V1 → V2, authentification, exécution isolée réelle, et `journey.test.ts` (parcours complet : import → analyse → note → cartes → exercice → tentatives → maîtrise → tableau de bord → laboratoire → isolation).
