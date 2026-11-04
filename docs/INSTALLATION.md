# Installation

## Prérequis
- Node.js 24 (l'exécution isolée utilise l'option `--permission` : Node ≥ 22 recommandé, testé avec 24)
- Postgres (Supabase en production) — ou rien en développement (PGlite local)
- Une clé Google Gemini pour les fonctions IA (facultatif : sans elle, plan issu de la numérotation, lecteur, notes, cartes de structure, laboratoires libres et exercices déjà créés fonctionnent)

## Développement local sans compte externe
```bash
npm install
node scripts/dev-db.mjs        # Postgres local (PGlite), port 5433, migrations appliquées
node scripts/dev-local.mjs     # http://localhost:3100 branché sur cette base (autre terminal)
```
Créer un utilisateur (aucun compte par défaut n'existe) :
```bash
SF_PASSWORD='mot-de-passe-10-car-min' DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5433/postgres?connection_limit=1&pgbouncer=true' node scripts/create-user.mjs moi@exemple.fr "Mon nom"
```
Ajoutez `GEMINI_API_KEY` dans `.env` pour activer les fonctions IA.

## Production (Supabase + hébergeur Node)
1. Variables : voir `docs/ENVIRONNEMENT.md` (`DATABASE_URL`, `DIRECT_URL`, `AUTH_SECRET` ≥ 32 caractères, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `ANTHROPIC_API_KEY`).
2. **Base neuve** : `npx prisma migrate deploy`.
   **Base V1 existante** : suivre `docs/MIGRATION.md` (sauvegarde, essai sur une copie, `migrate resolve` puis `migrate deploy`).
3. Compte : `scripts/create-user.mjs` (jamais de mot de passe dans le dépôt).
4. Build et démarrage :
   ```bash
   npm run build      # prisma generate + next build --webpack (sortie standalone)
   npm run start
   ```
   La sortie `standalone` embarque le runner d'exécution isolée et ses moteurs WebAssembly (`outputFileTracingIncludes`). Le runner est localisé à partir du dossier courant : lancez `npm run start` depuis la racine du projet, ou `node server.js` depuis `.next/standalone`.
5. Le bucket privé `documents` est créé automatiquement au premier import.
6. **Hébergement ouvert à d'autres personnes** : exécutez l'application dans un conteneur **sans accès réseau sortant** (hors Postgres, stockage et API IA) et avec une **limite de mémoire** ; voir `docs/ARCHITECTURE.md` §6.

## Commandes utiles
| Commande | Effet |
|---|---|
| `npm test` | Tous les tests (≈ 1 min ; Pyodide et PGlite démarrent à chaque fichier) |
| `npm run typecheck` | Vérification TypeScript |
| `npm run build` | Build de production |
| `node scripts/enable-rls.mjs` | Réactive la RLS (si une table a été ajoutée) |

## Vérifier l'installation
1. Connectez-vous, créez une matière, importez un PDF : le lecteur doit afficher l'original.
2. Ouvrez « Éditeur de code » → espace libre Python → Exécuter : une sortie doit s'afficher (le 1ᵉʳ lancement prend quelques secondes).
3. Avec la clé IA : onglet Analyse du lecteur → Analyser ; puis « Créer un exercice ».
