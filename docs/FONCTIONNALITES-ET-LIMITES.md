# Fonctionnalités terminées, vérifications et limites restantes

Légende : **✔ testé** = test automatisé sur vraie base PGlite / vraie exécution ; **✔ vu** = parcouru dans le navigateur sur une base locale de développement ; **⚠ non testé contre le vrai service** = dépend de l'IA ou de Supabase, jamais exécuté ici faute de clé.

## Ce qui est terminé

| Domaine | Fonctionnalité | Vérification |
|---|---|---|
| Matières et fichiers | Matières ; dossiers libres et récursifs (créer, renommer, déplacer, supprimer) ; import PDF/texte/Markdown/etc. en 3 temps avec contrôle de signature, SHA-256, extraction par page ; états de traitement ; recherche dans le contenu ; déplacement groupé ; suppression (fichiers du stockage compris) | ✔ testé, ✔ vu |
| Lecteur fidèle | Original affiché tel quel (pdf.js, texte, Markdown, image), pages, reprise à la dernière page, texte extrait seulement en repli | ✔ vu, ✔ testé (octet pour octet) |
| Aperçu PDF des documents Office/texte | À l'import, DOCX, PPTX, TXT et MD sont convertis en PDF (pdf-lib, 100 % JS, stocké à côté de l'original sous la clé `<original>-pdf`, régénéré à l'ouverture s'il manque) et lus dans le lecteur PDF (pages, sélection, annotations). **Limite** : la mise en page est reconstruite (titres, paragraphes, listes, tableaux, images PNG/JPEG, code), pas reproduite à l'identique ; polices, colonnes, formes, animations et notes de diapositives sont perdues. Caractères hors Latin-1 remplacés par `?`. L'original reste téléchargeable. Repli sur le texte extrait si la conversion échoue. | ✔ testé (`src/server/pdf/convert.test.ts`), ✘ pas comparé à Word/PowerPoint sur de vrais cours |
| Chat IA (global et par document) | Assistant « Assistant IA » (bibliothèque entière) et onglet « Chat » dans chaque cours. L'IA **explore** les documents par outils (recherche hybride mots-clés + vecteurs Gemini, lecture de 4 pages max à la fois, plan) au lieu de recevoir un résumé. Chaque passage consulté est numéroté ; seules les références `[n]` correspondant à un passage réellement consulté sont conservées. Historique, nouvelle conversation, renommage, suppression ; un chat de document ne voit jamais un autre document. La couverture (pages sans texte, extraction partielle, vecteurs manquants) est calculée côté serveur, donnée au modèle et affichée. Vectorisation progressive (budget de temps, reprise au message suivant). **Recherche web** (interrupteur dans les réglages du chat) : l'IA peut appuyer un cours par des sources externes ; le serveur classe chaque domaine « source reconnue » (documentation officielle, universités, administrations, références) ou « source à vérifier » et l'affiche ; sans réponse fiable, l'IA doit le dire. Désactivée si aucun moteur n'est utilisable. **Limites** : la liste des domaines reconnus est une liste fixe (`src/server/domain/web-trust.ts`), pas une garantie d'exactitude ; pas de pgvector (similarité calculée en mémoire, jusqu'à 8 000 passages par requête) ; OCR des pages scannées, images et DOC/PPT anciens **pas encore pris en charge** ; chat indisponible sans `GEMINI_API_KEY` | ✔ testé (faux fournisseur : isolement, citations, couverture), ✔ vu en réel avec Gemini |
| Éditeur : C et C# | Proposés dans l'éditeur de code avec modèle de départ et coloration syntaxique (CodeMirror). **Aucune exécution** : pas de compilateur sûr sur ce type d'hébergement, donc le bouton Exécuter est désactivé avec explication et rien n'est simulé. Exécuter ces langages demanderait un service d'exécution externe. | ✔ testé (création, refus d'exécution), ✔ vu |
| Notes unifiées | Notes personnelles, de document, annotations de passage, fiches de synthèse ; éditeur riche (titres, listes, tableaux, code, citations…) ; sauvegarde automatique avec révision et gestion de conflit ; liens vers documents/passages/pages | ✔ testé, ✔ vu |
| Analyse hiérarchique | Plan fidèle à la numérotation (CHAPITRE > I > A > 1 > a), sans IA ; notions avec citations **vérifiées** ; distinction « dans le document » / « déduit par l'IA » ; analyse versionnée par version de document ; correction manuelle (renommer, déplacer, indenter) | ✔ testé (faux fournisseur) ; ⚠ non testé contre le vrai modèle |
| Cartes | Carte de structure et carte conceptuelle éditables (React Flow) : nœuds, relations typées, provenance, réorganisation automatique, versions restaurables, sauvegarde automatique | ✔ testé, ✔ vu |
| Exercices | Création à partir d'UN document : nombre, barème 10/20/100/personnalisé ≤ 100 (**somme exacte**), 12 types, couverture, difficulté ; citations vérifiées ; « moins de questions plutôt que d'invention » ; tentatives figées et reprises ; correction par règles, mots-clés ou IA bornée ; « non corrigée » sans IA | ✔ testé (faux fournisseur), ✔ vu ; ⚠ génération/correction IA non testées contre le vrai modèle |
| Laboratoires code/SQL | Python, JavaScript, TypeScript, SQL (SQLite) en **exécution isolée** ; modes libre et exercice ; import d'énoncés depuis un document ; **tests objectifs** (appel de fonction, entrée/sortie, comparaison de résultats SQL, jeux limites, tests cachés) validés par une solution de référence ; indices progressifs sans solution ; solution débloquée après réussite ou 3 essais | ✔ testé (attaques réelles incluses), ✔ vu |
| Diagnostic | Erreurs classées (syntaxe, exécution, boucle infinie, résultat faux, cas limites, format, consigne) avec preuves | ✔ testé |
| Progression | Maîtrise par notion **avec confiance**, recalculée depuis les preuves ; recommandations justifiées (prérequis d'abord) ; reprise d'activité | ✔ testé, ✔ vu |
| Tableau de bord | « Où j'en suis ? », « Qu'est-ce qui demande mon attention ? », « Quelle prochaine activité ? » | ✔ testé, ✔ vu |
| Sécurité | Auth, isolation entre utilisateurs (404), validation de fichiers, isolation du code étudiant, RLS, secrets hors dépôt | ✔ testé |

Parcours de bout en bout automatisé : `src/server/journey.test.ts`.

## Ce que la V2 ne fait pas (limites assumées)

**IA**
- Aucune fonction IA n'a tourné contre le **vrai modèle** (pas de clé dans l'environnement de travail). Les prompts, les schémas de réponse et les seuils sont à ajuster sur de vrais cours dès la première utilisation.
- Sans `GEMINI_API_KEY` : pas de notions, pas de génération d'exercices, pas de correction de réponses rédigées ; l'interface le dit au lieu de simuler.
- Tests et solutions de référence des exercices de code/SQL sont écrits par l'IA : validés par cohérence (la référence les réussit), pas par un humain ; pas d'éditeur de tests.

**Documents**
- Pas de nouvelle version d'un document existant depuis l'interface (le modèle de données la prévoit), ni de déplacement par glisser-déposer, ni de déplacement d'un fichier vers une autre matière.
- Documents scannés sans texte : consultables, mais non analysables (pas d'OCR).
- Les fichiers originaux des documents créés en V1 n'ont jamais été stockés : à réimporter pour obtenir le lecteur fidèle.

**Exécution du code**
- Pas d'isolation réseau au niveau du système et pas de plafond mémoire dur pour Python/SQL : voir `docs/ARCHITECTURE.md` §6 (conteneur sans réseau sortant recommandé hors usage personnel).
- Seuls Python, JavaScript, TypeScript et SQLite sont exécutables ; Java, C, C++… ne sont jamais simulés. Un fichier par espace de travail ; bibliothèque standard Python seulement.
- Premier lancement Python lent (plusieurs secondes) : un processus par exécution, par choix d'isolation.

**Progression**
- Les formules (demi-vie 30 jours, poids de difficulté, seuils de confiance, règles de recommandation) sont raisonnées, **non calibrées sur de vrais étudiants** ; isolées dans `domain/mastery.ts` et `domain/recommend.ts`.
- Pas de courbe de maîtrise dans le temps ni de suivi du temps de travail.
- Les sessions V1 ne comptent pas comme preuves (pas d'identifiant de notion) et ne sont plus consultables dans l'interface ; leurs données sont conservées.

**Exercices**
- Pas d'édition manuelle des questions générées, pas de mode examen chronométré ; génération synchrone (300 s maximum par requête).

**Non vérifié**
- Stockage **Supabase** (seul le disque local a été exercé) et les migrations sur **votre** base (essayées seulement sur PGlite) ; écran tactile et rendu mobile fin de l'éditeur de cartes ; accessibilité au lecteur d'écran (structure ARIA soignée, mais pas auditée).

## À faire de votre côté
1. Renseigner `GEMINI_API_KEY` et `SUPABASE_SERVICE_ROLE_KEY`.
2. Changer `AUTH_SECRET` si le dépôt a été partagé (la V1 en avait un dans l'historique).
3. Rejouer les migrations sur une **copie** de la base Supabase (`docs/MIGRATION.md`) avant la vraie.
4. Facultatif : archiver les tables V1 (`prisma/optional/archive_v1_tables.sql`) après le nettoyage de code décrit dans `docs/MIGRATION.md`.
