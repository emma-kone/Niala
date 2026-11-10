# Back-office administrateur Niala

Centre de pilotage de la plateforme : statistiques d'usage, gestion des comptes, traitement des demandes des étudiants,
supervision technique et IA, rapports, communications, journal d'audit. Tout est branché sur les données réelles de
l'application : aucun chiffre n'est fictif, et chaque indicateur dit s'il vient de l'historique complet ou de la collecte en direct.

## 1. Accès

| Élément | Valeur |
|---|---|
| Adresse | **Secrète** : `https://<domaine>/<ADMIN_PATH>` (voir ci-dessous). `/admin` et `/api/admin` répondent par la 404 ordinaire du site à quiconque n'est pas passé par l'adresse secrète. |
| Lien distinct | Variable `ADMIN_HOST` (ex. `admin.niala.app`). Une fois définie, le back-office n'est servi **que** sur ce domaine (le domaine de la plateforme répond 404 sur `/admin` et `/api/admin`) et l'espace étudiant n'est plus servi sur le domaine d'administration. Sans `ADMIN_HOST` (développement), tout reste sous `/admin`. |
| Authentification | Les mêmes moyens que la plateforme : e-mail + mot de passe (scrypt) ou Google via Supabase. |
| Session | **Distincte** de la session étudiante : cookie `niala_admin` (HttpOnly, SameSite=Lax), 8 h, jeton signé avec un autre domaine de séparation. Rôle, statut du compte et version de session sont relus en base à chaque requête. |
| Premier super administrateur | `node scripts/grant-admin.mjs <email> SUPER_ADMIN` (compte déjà inscrit) ou `SF_PASSWORD=… node scripts/grant-admin.mjs <email> SUPER_ADMIN --create --name "Nom"`. Ensuite, les rôles se gèrent dans *Paramètres d'administration*. |

Connexion Google : l'écran d'administration pose un cookie d'intention puis passe par `/auth/callback`. Ce chemin n'**ouvre que
des comptes déjà existants, liés à cette identité Google et porteurs d'un rôle** ; il ne crée jamais de compte. Pensez à
autoriser `https://<ADMIN_HOST>/auth/callback` dans Supabase (Authentication → URL Configuration).

### Adresse secrète (`ADMIN_PATH`)

Variable d'environnement : 8 caractères minimum (lettres, chiffres, `-`, `_`), jamais le nom d'une page existante. Une adresse lisible (ex. `nialaspace-admin`) est pratique mais devinable : la protection repose alors sur la connexion. Pour une vraie barrière, une valeur longue et aléatoire, par exemple
`node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`. À définir dans `.env` ET dans les variables de Vercel.
Visiter `https://<domaine>/<ADMIN_PATH>` dépose un cookie de passage (`niala_gate`, httpOnly, 30 jours) puis redirige vers la page de
connexion ; sans ce cookie, toute requête vers `/admin…` ou `/api/admin…` est réécrite vers une page inexistante (404 standard, aucun indice).
Une valeur trop courte est ignorée ; **en production sans `ADMIN_PATH`, le back-office est fermé**. Changer la valeur invalide tous les cookies de passage.
Ce n'est qu'une première barrière : mot de passe, rôles et audit restent vérifiés côté serveur. Ne partagez pas l'adresse et ne la placez pas dans un dépôt.

## 2. Rôles (RBAC) — `src/server/admin/rbac.ts`

| Rôle | Peut |
|---|---|
| Super administrateur | Tout, dont gérer les administrateurs, les paramètres globaux et reconstituer l'historique. |
| Administrateur | Utilisateurs (voir, suspendre, modifier, supprimer), statistiques, demandes, rapports, communications, journal. |
| Support | Demandes (lire, répondre, statut, notes, feuille de route) et fiche utilisateur **réduite** (pas de statistiques d'activité). |
| Analyste | Statistiques agrégées, supervision technique/IA, rapports et exports. Aucun accès aux fiches individuelles. |

Les permissions sont contrôlées **côté serveur** : `requireAdmin(permission)` dans chaque route `/api/admin/*`,
`requireAdminPage(permission)` dans chaque page. Un refus est consigné (`access.denied`). Masquer un bouton ne protège rien :
la matrice de test `src/server/admin/admin.test.ts` vérifie les droits de chaque rôle.

## 3. Rubriques

Vue d'ensemble · Utilisateurs · Activité et utilisation · Fonctionnalités · Activité pédagogique · Suggestions et demandes ·
Rapports et statistiques · Performance technique · Intelligence artificielle · Notifications et communications ·
Paramètres d'administration · Journal d'activité. La période d'analyse (aujourd'hui, 7 j, 30 j, 3/6/12 mois, personnalisée)
se choisit dans la barre supérieure et met à jour tous les indicateurs ; chacun est comparé à la période précédente de même durée.

## 4. Définitions des indicateurs — `src/server/analytics/definitions.ts`

* **Utilisateur actif** : au moins une action significative sur la période (ouverture de module, cours consulté, exercice généré/résolu, import, carte, message à l'assistant, labo, progression, suggestion). Connexion, déconnexion et chargement de page ne comptent pas.
* **Session** : actions d'un utilisateur sans pause de plus de 30 minutes ; durée = écart premier/dernier événement (0 pour un événement isolé). Collecte en direct uniquement.
* **Exercice terminé** : tentative soumise ou corrigée. **Réussi** : score ≥ 50 % du barème. **Abandonné** : en cours, sans activité depuis plus de 7 jours.
* **Rétention Jn** : part des inscrits ayant une action significative le n-ième jour calendaire (UTC) après l'inscription ; seules les cohortes assez anciennes sont comptées.
* **Mesuré / estimé / indisponible** : « Mesuré · historique complet » = lu dans les tables d'origine ; « Mesuré · collecte en direct » = événements, valables depuis le début de la collecte ; temps d'utilisation d'un compte = estimation ; jetons et coût d'IA = non collectés. Une évolution n'est calculée (« n/d » sinon) que si la période précédente est couverte.
* Fuseau d'analyse : UTC (identique à Abidjan).

## 5. Données ajoutées — migration `20261118000000_niala_admin`

Colonnes `User` : `adminRole`, `accountStatus`, `statusReason`, `statusChangedAt`, `actorKey`.
Tables : `AnalyticsEvent`, `RequestLog`, `SupportRequest`, `SupportMessage`, `RoadmapItem`, `AdminAuditLog` (ajout seul : déclencheurs SQL
contre UPDATE, DELETE et TRUNCATE), `AdminSetting`, `AdminAlert`, `Announcement`, `UserNotification`. RLS activé sur toutes.

Événements collectés (`AnalyticsEvent.type`) : `account.register`, `auth.login`, `auth.logout`, `module.open`, `course.view`,
`exercise.generate`, `exercise.start`, `exercise.complete`, `exercise.import`, `document.import`, `map.create`, `assistant.message`,
`lab.create`, `lab.run`, `progress.view`, `suggestion.submit`, `page.load`.
Un événement = type, module, utilisateur **pseudonymisé** (HMAC du secret applicatif), catégorie, date, résultat, durée, petites métadonnées techniques.
Jamais d'e-mail, de nom ni de contenu de travail. Les événements n'ont pas de clé étrangère : supprimer un compte conserve les statistiques agrégées, sans lien avec une personne.

* La collecte (`track()`) est lancée sans attente et n'échoue jamais : elle ne ralentit pas l'espace étudiant.
* Le temps de réponse de chaque requête d'API est enregistré par `handle()` (`RequestLog`, 90 jours) ; le proxy transmet la route.
* **Avant le début de la collecte**, connexions, ouvertures de module, consultations de cours et sessions n'existent pas et ne peuvent pas être reconstituées. Les inscriptions, exercices, tentatives, imports, cartes, labos et appels IA ont un historique daté : *Paramètres → Reconstituer l'historique* (super administrateur) en recrée les événements, marqués `BACKFILL`, sans doublon.

## 6. Étudiants : « Aide, suggestions et retours » (Paramètres)

Formulaire (type, objet, description, module, urgence facultative, jusqu'à 3 fichiers de 5 Mo vérifiés par signature), référence de suivi
`NL-AAMM-NNNN`, « Mes demandes » avec statuts et réponses, notifications (réponse, changement de statut, annonces). L'e-mail n'est jamais redemandé.
Les notes internes ne sont jamais renvoyées côté étudiant (toutes les lectures filtrent `internal = false`).

## 7. Exploitation

```bash
npm run db:deploy                     # applique la migration
node scripts/grant-admin.mjs vous@exemple.fr SUPER_ADMIN
```

Variables : `ADMIN_PATH` (obligatoire en production, voir §1), `ADMIN_HOST` (facultatif), `AUTH_SECRET` (obligatoire en production : sert aussi au pseudonyme d'analyse — la changer
rend les anciens événements inattribuables à un compte existant).

Développement local sans toucher à Supabase : `node scripts/dev-db.mjs` puis `node scripts/dev-admin.mjs 3200`.

## 8. Limites connues

* Disponibilité = part des requêtes sans erreur serveur sur le trafic réel ; une sonde externe est nécessaire pour détecter une panne totale.
* Seul le fournisseur d'IA est chronométré parmi les services externes (pas le stockage ni la recherche web).
* Jetons et coût d'IA : le fournisseur n'est pas interrogé pour ce chiffre ; seuls les caractères envoyés/reçus sont mesurés.
* Pas d'authentification à deux facteurs sur le back-office (à ajouter avant une ouverture large).
* Niala n'a ni atelier Merise, ni éditeur mathématique, ni éditeur algorithmique : ils ne sont donc pas mesurés (seuls le labo de code et le labo SQL existent).
* Cache des agrégats : 60 s en mémoire par instance.
