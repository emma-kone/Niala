# Architecture actuelle de Niala (telle qu'observée)

Date : 2026-11-04. Ce document décrit ce que j'ai **vérifié dans le code**, et note les écarts avec `docs/ARCHITECTURE.md` (document du projet, globalement exact).

## Schéma

```
Navigateur (React 19, zustand, Tiptap, pdf.js, React Flow, CodeMirror)
  │  fetch JSON (client-api.ts ; 7 fetch directs pour l'autosauvegarde)
  ▼
Next.js 16 (App Router, `output: "standalone"`, build webpack)
  ├─ src/app/(app)/**        pages = coquilles → features/*  (garde d'accès CLIENT : AuthGuard)
  ├─ src/app/api/** (69 routes)  requireUser → zod → service → handle()   [aucun middleware/proxy]
  │       │
  │       ▼
  ├─ src/server/services/**  logique métier + Prisma, filtrée par propriétaire (ownership.ts)
  │     ├─ domain/**         règles pures (testées sans base)
  │     ├─ diagnosis/**      moteur de diagnostic + tuteur (IA validée)
  │     ├─ ai/**             provider (Gemini, repli Anthropic) → structured (quota, zod, réparation) → guard
  │     ├─ storage/          disque local | Supabase Storage (bucket privé)
  │     ├─ pdf/convert.ts    DOCX/PPTX/TXT/MD → PDF (pdf-lib)
  │     └─ labs/runner/      host.ts → `node --permission child.mjs` (QuickJS | Pyodide | sql.js)
  ▼
PostgreSQL (Prisma 6, RLS activée)        Gemini API        Supabase Storage
```

Authentification : cookie `sfs_session` (`userId.exp.HMAC-SHA256`, httpOnly, sameSite=lax, 7 j), mots de passe `scrypt` (N=16384), comptes créés **uniquement** par `scripts/create-user.mjs` (pas d'inscription en ligne). `next-auth` figure dans `package.json` mais n'est pas utilisé.

## Responsabilités

| Couche | Rôle | Qualité |
|---|---|---|
| Routes API | Garde + validation + délégation + `handle()` (erreurs centralisées, 500 génériques) | Bonne, uniforme (aucune logique métier observée dans les routes, sauf `subjects/[id]` qui contient la suppression : exception à la règle) |
| Services | Métier + accès base, toujours filtrés par `userId` | Bonne |
| Domaine pur | Barème, correction, plan, maîtrise, recommandations, tests de labo | Très bonne, testé |
| IA | Point d'entrée structuré unique + chat à part | Bonne, avec deux chemins (AI-04) |
| Runner | Processus Node isolé, WASM, nonce | Bonne conception, limites mémoire/réseau (SEC-02/03) |
| Frontend | `features/*` par module, shadcn/Radix | Correcte ; composants volumineux, effets nombreux |
| Persistance fichiers | Clés `<user>/<doc>/<v>/<aléa>` sans nom de fichier | Bonne |

## Forces
1. **Séparation nette** route → service → domaine pur ; testabilité réelle (PGlite).
2. **Isolation propriétaire** généralisée et testée ; 404 plutôt que 403.
3. **Honnêteté par conception** : provenance `DOCUMENT/AI_INFERRED/USER`, couverture, « non corrigée » sans IA, langages non exécutables non simulés.
4. **L'IA ne décide pas** du barème, du verdict, de la maîtrise ; sorties validées et ancrées.
5. **L'original prime** : octets conservés, versions immuables, snapshots de tentatives.

## Faiblesses architecturales
1. **Aucune garde centrale des routes** : l'authentification est répétée dans 66 routes (`requireUser`) ; une route oubliée = route ouverte (TST-01). Next 16 offre `proxy.ts` ; à évaluer.
2. **Traitements longs synchrones** dans HTTP (TECH-05) — incompatible avec un hébergement à délai court ; aucun modèle de tâche.
3. **État en mémoire de processus** (limiteur de débit, concurrence du runner, `getStorage` cache) : suppose **une seule instance**. Le nom de la branche (`mise-a-jour-vercel`) suggère un déploiement serverless : **À vérifier** que le runner (`spawn(process.execPath)` + Pyodide ~100 Mo) y fonctionne.
4. **Deux univers de données** coexistent (V1 + V2) dans un seul schéma ; frontières nettes dans le code mais non dans la base (DB-01, DB-04).
5. **JSON non typé** à la frontière base (`snapshot`, `payload`…) avec 49 casts.
6. **Frontend sans cache de données** : `@tanstack/react-query` installé mais non utilisé ; chaque vue gère ses états (chargement/erreur) à la main.
7. **Garde d'accès côté client uniquement** pour les pages (acceptable car les données sont protégées côté API).

## Dépendances circulaires / couplages
Pas de cycle détecté par lecture ; **non mesuré** (aucun outil type `madge` exécuté). Couplage fort identifié : `exercise-model` ↔ `grading` ↔ `diagnosis` ↔ `labs` autour de `Snapshot`.

## Variables d'environnement (noms uniquement)
`DATABASE_URL`, `DIRECT_URL`, `AUTH_SECRET` (≥ 32 car. exigé en production), `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `AI_DAILY_CALL_LIMIT`, `ANTHROPIC_API_KEY`(+`ANTHROPIC_MODEL`), `LAB_MAX_CONCURRENT`, `STORAGE_DIR`. `.env` local contient en plus des clés non documentées dans `.env.example` (`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `AI_PROVIDER`) lues seulement par les fichiers morts `lib/supabase/*` (ANON/PUBLISHABLE) ou par aucun code (`AI_PROVIDER`) : variables mortes.

## Déploiement
`npm run build` = `prisma generate && next build --webpack` ; `db:deploy` = `prisma migrate deploy`. Pas de CI, pas de `vercel.json`, pas de Dockerfile dans le dépôt. Le runner exige `node_modules` présent à l'exécution (`next.config.ts` force l'inclusion des moteurs dans le traçage standalone — **jamais vérifié sur un build déployé**).
