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

Variable d'environnement : 8 caractères minimum (lettres, chiffres, `-`, `_`), jamais le nom d'une page existante. Une adresse lisible (ex. `espace-exemple`) est pratique mais devinable : la protection repose alors sur la connexion. Pour une vraie barrière, une valeur longue et aléatoire, par exemple
`node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`. À définir dans `.env` ET dans les variables de Vercel.
Visiter `https://<domaine>/<ADMIN_PATH>` dépose un cookie de passage (`niala_gate`, httpOnly, 30 jours) puis redirige vers la page de
connexion ; sans ce cookie, toute requête vers `/admin…` ou `/api/admin…` est réécrite vers une page inexistante (404 standard, aucun indice).
Une valeur trop courte est ignorée ; **en production sans `ADMIN_PATH`, le back-office est fermé**. Changer la valeur invalide tous les cookies de passage.
Ce n'est qu'une première barrière : mot de passe, rôles et audit restent vérifiés côté serveur. Ne partagez pas l'adresse et ne la placez pas dans un dépôt.

### Code d'accès (`ADMIN_ACCESS_HASH`)

`node scripts/admin-access-code.mjs` génère un code (3 mots + 4 chiffres, affiché une seule fois) et la ligne `ADMIN_ACCESS_HASH=…` à mettre dans `.env`
et dans Vercel ; `SF_ACCESS_CODE="votre code" node scripts/admin-access-code.mjs` hache un code de votre choix (8 caractères minimum).
Seul le hachage scrypt est stocké. Parcours : `/<ADMIN_PATH>` → page du code → `/admin/login` (e-mail + mot de passe) → dashboard.
Le code est vérifié par une action serveur ; 5 échecs par IP (ou 20 au total) sur 15 minutes verrouillent la saisie (comptage en base, consigné dans le journal,
alerte de supervision). Le cookie de passage est lié à l'adresse et au code : changer l'un ou l'autre déconnecte tous les appareils de la porte.
Sans `ADMIN_ACCESS_HASH`, l'adresse secrète seule ouvre la connexion.

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

## 6 bis. Assistant IA du back-office — `src/server/admin/assistant/`

Bouton « Assistant IA » en bas à droite de toutes les rubriques (`src/features/admin/admin-assistant.tsx`).

* **Lecture** : l'assistant interroge les mêmes fonctions que les pages (vue d'ensemble, activité, fonctionnalités, pédagogie,
  utilisateurs et fiches, demandes et feuille de route, rapports, performance, IA, annonces, paramètres et administrateurs,
  journal). Chaque outil exige la même permission que la page : l'assistant ne voit jamais plus que le rôle connecté (`tools.ts`).
* **Actions** (statut ou renseignements d'un compte, suppression, lien de réinitialisation, traitement des demandes, feuille de
  route, paramètres, rôles, annonces, alertes, reconstitution de l'historique) : le modèle ne fait que **proposer**. Une carte
  s'affiche ; rien n'est exécuté sans clic sur « Confirmer ». La proposition est signée (HMAC), liée à l'administrateur, valable
  10 minutes et utilisable une fois ; à la confirmation, la permission est revérifiée en base et l'action passe par la fonction
  métier habituelle (mêmes garde-fous, même audit) puis est tracée `assistant.action`. Une suppression exige de recopier
  l'adresse du compte, comme dans la fiche utilisateur (`actions.ts`, route `POST /api/admin/assistant/confirm`).
* **Confidentialité** (`privacy.ts`) : avant tout envoi au fournisseur d'IA, noms et e-mails sont retirés et remplacés par un
  libellé stable (« Utilisateur #a3f9c1 », « Admin #07be12 ») ; e-mails, numéros de téléphone et noms connus sont masqués dans
  les textes libres, y compris dans les messages de l'administrateur. Les vraies identités n'apparaissent que dans les cartes de
  confirmation, côté navigateur. Les liens de réinitialisation ne sont jamais montrés au modèle.
* **Sécurité** : les textes des étudiants sont présentés comme des données ; une instruction cachée dans une demande ne peut
  au pire que faire apparaître une proposition, que l'administrateur refuse.
* La conversation n'est pas enregistrée en base (`sessionStorage` de l'onglet). Chaque message compte dans le quota quotidien
  d'appels IA de l'administrateur (`AI_DAILY_CALL_LIMIT`) et apparaît dans la supervision de l'IA (« Assistant du back-office »).
  Nécessite Gemini (`GEMINI_API_KEY`) : le fournisseur Anthropic de repli ne gère pas les outils.

## 6 ter. Suppressions : rien n'est perdu pour les statistiques — `src/lib/soft-delete.ts`

Migration `20261121000000_niala_soft_delete` (colonne `deletedAt` sur `User` et sur 16 tables de contenus).

* **Contenus** (matière, dossier, document, exercice, carte, conversation, note et lien de note, tâche, séance de révision,
  pause, cours d'agenda, emploi du temps importé, labo, notion, section d'analyse) : la suppression par l'étudiant pose
  `deletedAt`. Le contenu disparaît de l'application mais reste en base ; seul le fichier d'origine est retiré du stockage.
  Les contenus dépendants sont marqués en cascade, et les liens qui étaient remis à NULL par la base le sont toujours sur les
  lignes encore visibles (un cours d'agenda est détaché d'une matière supprimée) : l'étudiant voit exactement ce qu'il voyait
  avant. Une tentative reste rattachée à son exercice supprimé (statistiques pédagogiques par matière).
* **Client `db`** (application) : ajoute « encore visible » à toutes les lectures et mises à jour (le modèle et ses ancêtres
  en cascade, calculés depuis le schéma) et **refuse toute suppression définitive** de ces tables (`HardDeleteError`).
  **Client `dbAll`** : voit tout ; utilisé par les statistiques (`src/server/admin/stats/*`, historique, fiche utilisateur).
  Les requêtes SQL brutes de l'administration voient tout également.
* **Compte** (par l'étudiant, par un administrateur ou via l'assistant IA) : **anonymisation** (`purgeAccount`). Nom, adresse
  (remplacée par `compte-supprime-<id>@anonyme.niala.invalid`), mot de passe, liaison Google, photo, rôle, notifications et liens
  de réinitialisation sont effacés ; fichiers d'origine et pièces jointes retirés du stockage ; sessions fermées ; statut
  `DELETED`. L'activité et le profil scolaire restent. L'adresse d'origine peut resservir à une nouvelle inscription.
  Les comptes supprimés sont masqués de la liste des utilisateurs (filtre « Supprimé (anonymisé) ») et n'acceptent plus
  aucune action. Vue d'ensemble : « Utilisateurs inscrits » = comptes existants à la date de fin ; nouveau KPI « Comptes
  supprimés » ; les inscriptions et cohortes comptent toujours les comptes supprimés depuis.
* Nouvelle suppression à coder : appeler `softDelete(tx, "Modèle", where)` ; pour une vraie purge technique (tests), `dbAll`.

## 6 quater. Demandes, assistance sans compte et annonces hors site

Migration `20261122000000_niala_assistance_push`.

* **Demandes** : liste avec sélection multiple (clôturer « résolues » / « refusées », autre statut, supprimer) et message
  complet dépliable ; fiche avec boutons « Clôturer », « Supprimer », aide sur les statuts (`REQUEST_STATUS_HELP`).
  Supprimer = suppression douce (masquée partout, comptée dans les statistiques). Routes `DELETE /api/admin/requests/[id]`,
  `POST /api/admin/requests/bulk`.
* **Assistance sans compte** : bouton sur la page de connexion → `/assistance`. La demande (`userId` nul, `guestEmail`)
  arrive dans la même file ; les réponses partent par e-mail avec un lien personnel `/assistance/suivi#jeton` (jeton dans le
  fragment : jamais journalisé), où le visiteur lit l'échange et répond. « Renvoyer un lien de suivi » invalide l'ancien.
  Limites : 5 envois/heure par IP, 3 demandes/jour par adresse, champ piège anti-robots.
* **Annonces** : « Tous les utilisateurs actifs » ou audience ciblée ; canaux en plus de la cloche : **e-mail** (Resend,
  désinscription en un clic `/desinscription`, réglage « Annonces par e-mail ») et **push** (service worker `public/sw.js`,
  l'étudiant active « Notifications sur cet appareil » dans Paramètres). Envoi après la réponse ; compteurs e-mail/push dans
  l'historique. « Supprimer » retire l'annonce et ses notifications dans Niala (les e-mails et push reçus restent).
* **Configuration** : `RESEND_API_KEY`, `EMAIL_FROM` (domaine vérifié chez Resend), `APP_URL` (liens des e-mails),
  `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (mailto: de contact). Sans elles, tout fonctionne dans le site et
  l'aperçu d'annonce signale que l'e-mail ou le push ne partira pas.

## 6 quinquies. Page d'accueil publique

`/accueil` (et `/` pour un visiteur sans session, réécrit par `src/proxy.ts`). Captures réelles d'un compte de démonstration
fictif dans `public/accueil/`. Pour les refaire : base locale (`scripts/dev-db.mjs`), `scripts/demo/seed-demo.ts`, une
instance `next dev` sur cette base, puis `scripts/demo/capture.mjs` (puppeteer-core + Edge/Chrome).

## 7. Exploitation

```bash
npm run db:deploy                     # applique la migration
node scripts/grant-admin.mjs vous@exemple.fr SUPER_ADMIN
```

Variables : `ADMIN_PATH` (obligatoire en production, voir §1), `ADMIN_HOST` (facultatif), `AUTH_SECRET` (obligatoire en production : sert aussi au pseudonyme d'analyse — la changer
rend les anciens événements inattribuables à un compte existant).

Développement local sans toucher à Supabase : `node scripts/dev-db.mjs` puis `node scripts/dev-admin.mjs 3200`.

## 7 bis. Anomalies, assistant en pleine page, actualisation

* **Anomalies à résoudre** (`/admin/anomalies`, permission `tech.view`) : `src/server/admin/anomalies.ts` croise les mesures réelles (routes lentes de `RequestLog`
  avec un seuil propre aux opérations longues, erreurs récurrentes, échecs et lenteurs d'IA, documents en erreur, alertes ouvertes, problèmes signalés par
  les étudiants) et les classe de P1 à P4. Chaque anomalie vient avec un prompt prêt à copier ; « Copier tous les prompts » donne la liste dans l'ordre de priorité.
  « Marquer traitée » est mémorisé dans le navigateur. L'assistant IA lit la même liste (outil `list_anomalies`).
* **Assistant IA en pleine page** : `/admin/assistant` (bouton « Pleine page » du panneau flottant). Même conversation que le panneau (stockée dans l'onglet).
* **Messages effaçables** : chaque message d'information (`Notice`) a une croix ; l'effacement est mémorisé dans le navigateur (empreinte du texte).
  « Réafficher les messages effacés » est dans le menu du profil.
* **Actualisation en arrière-plan** : `AutoRefresh` relit les données serveur chaque minute (onglet visible, pas pendant une saisie) sans recharger la page ; le bouton
  de la barre supérieure force l'actualisation.
* **Vitesse** : l'administrateur n'est lu qu'une fois par requête, l'évaluation des alertes se fait après la réponse (`after`), la pastille de notifications est mise
  en cache 20 s, et les liens du menu sont préchargés.

## 8. Limites connues

* Disponibilité = part des requêtes sans erreur serveur sur le trafic réel ; une sonde externe est nécessaire pour détecter une panne totale.
* Seul le fournisseur d'IA est chronométré parmi les services externes (pas le stockage ni la recherche web).
* Jetons et coût d'IA : le fournisseur n'est pas interrogé pour ce chiffre ; seuls les caractères envoyés/reçus sont mesurés.
* Pas d'authentification à deux facteurs sur le back-office (à ajouter avant une ouverture large).
* Niala n'a ni atelier Merise, ni éditeur mathématique, ni éditeur algorithmique : ils ne sont donc pas mesurés (seuls le labo de code et le labo SQL existent).
* Cache des agrégats : 60 s en mémoire par instance.
