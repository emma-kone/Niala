# Audit global de Niala — synthèse

Date : 2026-11-04 · Branche `chore/mise-a-jour-vercel`, commit `0531d89` · **Audit seulement : aucun fichier source, test, migration ou donnée n'a été modifié.** Seuls les dix documents de `docs/audit/` ont été ajoutés.

Dossier : [ARCHITECTURE](ARCHITECTURE.md) · [AUDIT_FONCTIONNEL](AUDIT_FONCTIONNEL.md) · [AUDIT_SECURITE](AUDIT_SECURITE.md) · [AUDIT_DATABASE](AUDIT_DATABASE.md) · [AUDIT_IA](AUDIT_IA.md) · [AUDIT_PEDAGOGIQUE](AUDIT_PEDAGOGIQUE.md) · [AUDIT_TECHNIQUE](AUDIT_TECHNIQUE.md) · [AUDIT_TESTS](AUDIT_TESTS.md) · [PLAN_CORRECTION](PLAN_CORRECTION.md)

## Ce qui a réellement été fait (et pas fait)

| Fait | Pas fait |
|---|---|
| Lecture ciblée de l'auth, des routes, du stockage, du runner, du schéma, des services IA, des services d'exercices/chat/progression, du thème, des réglages, du store | Lecture exhaustive de tout le frontend (~8 400 lignes de `features/`) ; relecture ligne à ligne des 69 routes |
| `vitest` (312 ✔), `tsc` (0 erreur), `eslint`, `npm audit` | `next build`, tests de charge, `EXPLAIN` |
| Application lancée **en local sur une base PGlite jetable** (hors dépôt), 2 comptes de test : isolation inter-utilisateurs (8 routes), import d'un fichier, réglages, SQL, Python, limite de débit, thème (navigateur) | Chat, analyse, génération/correction IA, lecteur PDF, cartes, éditeur par l'interface : **pas de clé IA** (volontairement vidée) ; stockage Supabase ; plateforme d'hébergement réelle |

Tout constat est étiqueté *Confirmé / Probable / À vérifier* dans les documents détaillés. J'ai arrêté mes processus de test ; le serveur de développement que vous aviez déjà sur le port 3000 n'a pas été touché.

## État réel de Niala, en un paragraphe

Niala est un **produit de qualité d'ingénierie nettement supérieure à la moyenne d'un projet personnel** : serveur en couches propres, logique pédagogique pure et testée, isolation des utilisateurs systématique, IA encadrée (validation, ancrage par citations, décisions critiques non déléguées), runner de code sérieusement isolé, 312 tests réels qui passent, 0 erreur de types. Il n'est cependant **pas encore prêt à être ouvert à des tiers** : des angles morts de sécurité périphérique (limite de débit de connexion globale, en-têtes HTTP, dépendance PDF vulnérable, secrets V1 dans l'historique Git, plafonds mémoire du runner), une **IA jamais validée contre le vrai modèle** et une **fiabilité pédagogique minée par trois défauts précis** (notions sans source, analyse tronquée en silence, suppression de matière destructrice et mal signalée).

## Réponses aux 12 questions

1. **État réel** : solide côté serveur et logique métier ; frontend correct mais lourd en effets React et sans test ; périphérie sécurité/hébergement à compléter ; héritage V1 encore présent partout.
2. **Réellement opérationnelles** (vérifié en réel ou par tests sur vraie base) : authentification, matières, dossiers, import et conservation des originaux, extraction, plan déterministe, notes, cartes, exercices et correction par règles, laboratoires Python/JS/TS/SQL isolés, diagnostic déterministe, maîtrise et recommandations, tableau de bord. *Opérationnelles sans l'IA réelle uniquement.*
3. **Partielles** : versions de documents (modèle sans interface), aperçu DOCX/PPTX (mise en page reconstruite), réglages (2 sur 8 actifs), analyse des notions (troncature), progression (sans chat/notes), recherche web (désactivée sans moteur).
4. **Fictives ou incomplètes** : **aucune donnée simulée** n'a été trouvée. « Interface seule » : `defaultMode`, `hintsEnabled`, `exerciseLang`, `retentionDays`, `aiModel`. Non exécutables par conception et affichés comme tels : C, C#.
5. **Failles les plus importantes** : SEC-01 (déni de service de la connexion, confirmé), SEC-06 (secrets/données V1 dans l'historique), SEC-04 (pdf.js, exécution de JS), SEC-03/SEC-02 (mémoire du runner, SEC-02 confirmé), SEC-05 (aucun en-tête de sécurité).
6. **Incohérences d'architecture** : authentification répétée route par route sans garde centrale ; état en mémoire de processus (limites, concurrence) ; deux univers V1/V2 dans un schéma ; traitements longs dans la requête HTTP ; deux chemins d'appel IA.
7. **Redondances les plus gênantes** : `ErrorDiagnosis`/`DiagnosisReport` ; colonnes dupliquées `Document`/`DocumentVersion` ; trois mécanismes de préférences ; état client V1 mort ; routes d'exécution V1 mortes ; 21 dépendances et 26 composants UI inutilisés.
8. **Risques de bugs aux prochaines évolutions** : le format `ExerciseAttempt.snapshot` lu par 4 modules via 49 casts ; le protocole `host.ts` ↔ `child.mjs` ; toute nouvelle route sans `requireUser` (aucun test ne le détecte) ; l'absence de test d'interface avec 51 erreurs `react-hooks`.
9. **À refactorer** : suppression de matière (conséquences + sort des tentatives), `generation.ts` (création de notions), `ai-services.ts` (fenêtrage), `theme-provider` + store (préférences), diagnostic (unification), gros composants (`pdf-viewer`, `files-view`, `settings-view`, `map-editor`).
10. **À reconstruire** : *rien à reconstruire entièrement.* Seule exception éventuelle : le **mode d'exécution des traitements longs** (tâches reprenables) si vous visez le serverless, et l'**isolation d'exécution** (conteneur) si vous ouvrez à des tiers.
11. **À conserver absolument** : `src/server/domain/*`, `ownership.ts` + la discipline de 404, `generateStructured` + `guard`, le principe « l'original prime » (versions immuables, snapshots), la séparation payload/clé de correction, le runner `--permission` + WASM, la suite de tests réels (PGlite).
12. **Ordre de correction** : voir `PLAN_CORRECTION.md` — P0 (SEC-01) ; P1 sécurité et intégrité pédagogique (SEC-06, SEC-04, DB-02, PED-01, AI-01, SEC-02, SEC-05, validation en réel) ; puis dette. Décisions à prendre d'abord : hébergement visé, visibilité du dépôt.

## Maturité par dimension (appréciations argumentées, sans note)

| Dimension | Appréciation | Arguments observés |
|---|---|---|
| Architecture | **Avancée, avec un point faible d'exploitation** | Couches nettes, domaine pur ; mais état en mémoire de processus, traitements synchrones, V1/V2 mêlés |
| Frontend | **Correcte, à consolider** | 51 erreurs `react-hooks`, composants de 500–700 lignes, 91 `useEffect`, état client mort ; mais interface cohérente, thème sombre par défaut opérationnel (vérifié) |
| Backend | **Solide** | Routes fines, `handle()` central, validation zod, 404 cohérents ; exceptions : suppression de matière dans la route, quota non atomique |
| Base de données | **Saine mais encombrée** | Contraintes et cascades pensées, RLS partout ; 12 tables mortes, doublons de modèles, JSON non typé, perf non mesurée |
| Sécurité | **Bonne au cœur, lacunes en périphérie** | Isolation et validation de fichiers vérifiées ; limite de connexion cassée (confirmé), pas d'en-têtes, dépendance vulnérable, secrets dans l'historique |
| Fonctionnalités | **Riches et honnêtes** | Pas de simulation ; limites documentées ; réglages inertes et versions de documents incomplètes |
| Intelligence artificielle | **Bien conçue, non éprouvée** | Garde-fous remarquables ; jamais observée contre le vrai modèle (documentation contradictoire) ; troncature d'analyse |
| Cohérence pédagogique | **Réellement intégrée, avec 3 brèches** | Chaîne complète document→maîtrise testée ; notions sans source, analyse partielle, suppression destructrice |
| Expérience utilisateur | **Bonne base, détails à corriger** | Sombre par défaut OK ; préférence de thème non restaurée à la connexion (confirmé) ; avertissements trompeurs à la suppression ; accessibilité non auditée |
| Tests | **Forts sur le serveur, absents ailleurs** | 312 tests réels, parcours complet ; 0 test HTTP/UI/E2E, pas de CI, IA jamais testée en réel |
| Performance | **Inconnue, risques identifiés** | Aucune mesure ; vecteurs chargés en mémoire à chaque message, `ILIKE`, pool de runner de 3 |
| Maintenabilité | **Bonne côté serveur, moyenne côté client** | Documentation riche mais périmée par endroits ; dette V1 visible ; lint inutilisable |

## Liste des constats par gravité

- **Critique** : aucun constat *confirmé* de compromission de données ou d'accès non autorisé entre utilisateurs.
- **Élevée** : SEC-01, SEC-04, SEC-06, DB-02, PED-01, AI-01, AI-03 (+ SEC-03 et AI-06 selon l'hébergement).
- **Moyenne** : SEC-02, 05, 07, 08, 09, 11 ; DB-01 à 06, 08 ; AI-02, 04, 05, 07, 08 ; FUN-01, 02 ; PED-04, 07, 09, 10 ; TECH-01, 03, 04, 06, 07, 09 ; TST-01 à 10.
- **Faible** : SEC-10, 12, 13 ; DB-07, 09 ; FUN-03 à 05 ; PED-05, 06, 08 ; TECH-02, 08.

**Aucune correction ne sera faite avant votre validation explicite de ce rapport et du plan.**
