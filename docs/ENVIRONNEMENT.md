# Variables d'environnement

| Variable | Obligatoire | Rôle |
|---|---|---|
| `DATABASE_URL` | oui | Connexion Postgres (pooler Supabase en production : `?pgbouncer=true`) |
| `DIRECT_URL` | oui | Connexion directe (migrations Prisma) |
| `AUTH_SECRET` | oui en production | Secret de signature des sessions, **32 caractères minimum** (`openssl rand -hex 32`) |
| `NEXT_PUBLIC_SUPABASE_URL` | pour le stockage Supabase | URL du projet Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | oui en production | Stockage des fichiers originaux (bucket privé `documents`, créé automatiquement). **Serveur uniquement : ne jamais exposer au client.** Sans elle : stockage disque local (développement). |
| `SUPABASE_STORAGE_BUCKET` | non | Nom du bucket (défaut `documents`) |
| `STORAGE_DIR` | non | Dossier du stockage local (défaut `./storage`) |
| `ANTHROPIC_API_KEY` | pour les fonctions IA | Sans elle : l'analyse n'extrait que le plan issu de la numérotation, les autres fonctions IA sont indisponibles et le disent |
| `ANTHROPIC_MODEL` | non | Modèle utilisé par la V2 (défaut `claude-sonnet-5-5`) |
| `AI_DAILY_CALL_LIMIT` | non | Appels IA maximum par utilisateur et par 24 h (défaut 300) |
| `LAB_MAX_CONCURRENT` | non | Nombre maximum d'exécutions isolées simultanées (défaut 3 ; chaque exécution Python pèse ~100 Mo) |
| `EXERCISE_MAX_QUESTIONS` | non | Nombre maximum de questions par exercice (défaut 40, plafond 100) |
| `NEXT_DIST_DIR` | non | Dossier de build Next (utilisé par `scripts/dev-local.mjs` pour coexister avec un autre `next dev`) |
| `PRISMA_LOG_QUERIES` | non | `1` pour journaliser les requêtes SQL en développement |

Les variables `GEMINI_*`, `OPENROUTER_*` et `AI_PROVIDER` du `.env` actuel ne sont plus utilisées.

## Développement local sans Supabase

```bash
node scripts/dev-db.mjs      # Postgres local (PGlite) sur le port 5433, migrations appliquées
node scripts/dev-local.mjs   # Next.js sur http://localhost:3100 branché sur cette base
SF_PASSWORD='mot-de-passe-10-car-min' DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5433/postgres?connection_limit=1&pgbouncer=true' node scripts/create-user.mjs moi@exemple.fr "Mon nom"
```
