# StudyForge V2

Environnement d'étude personnel assisté par IA : on y range ses cours, on les lit fidèlement, on prend des notes, on cartographie la structure et les notions, on s'exerce (exercices générés à partir d'un document, laboratoires de code et de SQL à tests objectifs) et on suit sa progression par notion — avec un niveau de confiance affiché et sans jamais confondre une note avec une maîtrise.

Next.js 16 · React 19 · Prisma 6 · Postgres (Supabase) · Anthropic.

## Démarrer
```bash
npm install
node scripts/dev-db.mjs      # base locale PGlite (terminal 1)
node scripts/dev-local.mjs   # http://localhost:3100 (terminal 2)
```
Détails, création de compte, production : [docs/INSTALLATION.md](docs/INSTALLATION.md).

## Documentation
| Document | Contenu |
|---|---|
| [INSTALLATION](docs/INSTALLATION.md) | Installation, démarrage, production, vérifications |
| [ENVIRONNEMENT](docs/ENVIRONNEMENT.md) | Variables d'environnement |
| [ARCHITECTURE](docs/ARCHITECTURE.md) | Couches, services IA, sécurité, exécution isolée, tests |
| [DONNEES](docs/DONNEES.md) | Schéma de données documenté |
| [MIGRATION](docs/MIGRATION.md) | Migration V1 → V2 sans perte, archivage des tables V1 |
| [FONCTIONNALITES-ET-LIMITES](docs/FONCTIONNALITES-ET-LIMITES.md) | Ce qui est terminé, vérifié, et ce qui ne l'est pas |
| [V2-AUDIT-ET-PLAN](docs/V2-AUDIT-ET-PLAN.md) | Audit de la V1, décisions, historique détaillé par phase |

## Principes
Aucun résultat d'IA simulé · l'original d'un fichier n'est jamais remplacé par son texte · l'IA propose, le serveur décide (barème, bonnes réponses, verdicts de tests, maîtrise) · le contenu des documents est une donnée non fiable · chaque utilisateur est isolé des autres.

## Tests
```bash
npm test          # domaine, services sur vraie base PGlite, exécution isolée réelle, parcours complet
npm run typecheck
```
