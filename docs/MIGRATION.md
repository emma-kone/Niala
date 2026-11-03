# Migrations V1 → V2 — mode d'emploi

Quatre migrations Prisma, dans `prisma/migrations/` :

| Migration | Rôle | Destructive ? |
|---|---|---|
| `20261101000000_v1_baseline` | Reflet exact du schéma V1 (base créée par `db push`). **À marquer comme déjà appliquée** sur une base existante. | — |
| `20261101000100_v2_foundation` | Renomme `DocumentChunk`, `DocumentAnalysis`, `Exercise`, `Answer` en `Legacy*` (lignes conservées) puis crée les tables, enums et colonnes V2. | Non |
| `20261101000200_v2_backfill` | Reprise des données : chapitres → dossiers, documents → versions, extraits → chunks, sessions → tentatives. Idempotente ; une incohérence de comptage ou d'isolation annule tout. | Non |
| `20261101000300_v2_rls` | Active la RLS sur les nouvelles tables. | Non |

## Procédure recommandée (base existante)

1. **Sauvegarder** : snapshot / branche Supabase ou Neon de la base. Faire d'abord un essai sur la copie.
2. Marquer la baseline comme appliquée (la base V1 existe déjà) :
   ```bash
   npx prisma migrate resolve --applied 20261101000000_v1_baseline
   ```
3. Appliquer les migrations V2 :
   ```bash
   npx prisma migrate deploy
   ```
4. Vérifier : nombre de dossiers = nombre de chapitres, de versions = documents, de chunks V2 = `LegacyDocumentChunk`, de tentatives = sessions (la migration le contrôle déjà).

Sur une base neuve : `npx prisma migrate deploy` suffit (la baseline est alors réellement jouée).

## Ce qui n'est PAS migré (et pourquoi)

- **Fichiers originaux** : jamais stockés en V1. Chaque version migrée a `originalMissing = true` et `storageKey = NULL` ; le lecteur fidèle exige de réimporter le fichier.
- **`ConceptStat`** : aucune matière n'y est enregistrée ; le rattacher automatiquement fusionnerait des notions de matières différentes. Phase 9 : la maîtrise (`ConceptMastery`) est désormais recalculée depuis les réponses corrigées et les tests de laboratoire (les tentatives V1 migrées n'ont pas de notions rattachées à un identifiant : elles ne comptent pas comme preuve). `ConceptStat` n'est plus lu ni écrit ; la table reste en place.
- **`LegacyExercise`, `LegacyDocumentAnalysis`** : conservés en lecture seule ; les formats V2 (questions typées, arbre de sections) ne se déduisent pas sans perte.
- **Ordre des chapitres** (`Chapter.position`) : les dossiers n'ont pas d'ordre manuel.
- **Offsets de caractères** des chunks migrés : inconnus (0/0) ; seule la page est reprise.
- **Chapter, Session, SessionItem, StudyRecommendation** : toujours présentes ; suppression prévue seulement après bascule du code et sauvegarde.

## Tests

`npm test` rejoue ces migrations sur un Postgres en mémoire (PGlite) avec des données V1 : conservation des données, dossiers homonymes, versions, pages, tentatives, isolation entre utilisateurs, idempotence, RLS.

## Comptes

Plus de compte par défaut. Création :

```bash
SF_PASSWORD='mot-de-passe-de-10-caractères-min' node scripts/create-user.mjs vous@exemple.fr "Votre nom"
```

`AUTH_SECRET` (≥ 32 caractères) est obligatoire en production.
