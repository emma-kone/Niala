# Audit de sécurité — Niala

Date : 2026-11-04 · Branche : `chore/mise-a-jour-vercel` · Commit de départ : `0531d89`

**Légende de preuve** : *Confirmé* = reproduit ou démontré (commande, test, `npm audit`, lecture de code non ambiguë) · *Probable* = fortement indiqué, non reproduit · *À vérifier* = information insuffisante.
**Méthode** : lecture du code d'authentification, des routes, du stockage, du runner de code, des services IA ; tests réels sur une application locale branchée sur une base PGlite **jetable** (hors du dépôt, supprimable) avec 2 comptes de test ; `npm audit --omit=dev`. Aucun test destructif, aucune donnée réelle touchée. **Non testé** : hébergement réel (Vercel/Supabase), charge, fuzzing, mémoire extrême du runner (voir SEC-03).

## Synthèse

Les fondations sont **bonnes** : toutes les routes (sauf `/api/auth/*` et un reste `GET /api`) exigent `requireUser`, l'isolation entre utilisateurs est systématique (404, jamais 403), les fichiers sont validés par signature et servis avec CSP `sandbox`, les secrets ne sont lus que côté serveur, le runner de code est sérieusement conçu. Les faiblesses sont dans **le périmètre autour** : limitation de débit, en-têtes HTTP, dépendances, limites mémoire du runner, secrets dans l'historique Git.

| ID | Constat | Gravité | Preuve | Priorité |
|---|---|---|---|---|
| SEC-01 | Limite de débit de connexion **globale** (clé `"login"`) : 11 requêtes bloquent la connexion de tous | Élevée | Confirmé | P0 |
| SEC-02 | Labo SQL : `PRAGMA max_page_count` rédéfinissable → plafond mémoire contourné | Moyenne | Confirmé | P1 |
| SEC-03 | Runner : pas de plafond mémoire dur Python/WASM, pas d'isolation réseau OS | Élevée si ouvert à des tiers | Probable | P1 |
| SEC-04 | `pdfjs-dist` : exécution de JS arbitraire à l'ouverture d'un PDF malveillant (GHSA-hq66-cqwq-w95j) | Élevée | Confirmé (dépendance) / Probable (exploitation) | P1 |
| SEC-05 | Aucun en-tête de sécurité (CSP, X-Frame-Options, HSTS, Referrer-Policy) ; `X-Powered-By` actif | Moyenne | Confirmé | P1 |
| SEC-06 | `db/.auth-secret`, `db/custom.db` (données V1) et un `.env` ont été commités | Élevée | Confirmé (historique) / À vérifier (visibilité du dépôt) | P1 |
| SEC-07 | Limiteur de débit en mémoire d'un processus (inefficace multi-instances / serverless) | Moyenne | Confirmé (code) | P1 si Vercel |
| SEC-08 | Session sans révocation : le logout ne fait qu'effacer le cookie | Moyenne | Confirmé (code) | P2 |
| SEC-09 | Dépôt de fichier : limite de taille basée sur `Content-Length` ; bombes zip DOCX/PPTX non évaluées | Moyenne | Probable / À vérifier | P2 |
| SEC-10 | Routes V1 mortes `/api/execute`, `/api/sql/run`, `/api` (« Hello, world ») | Faible | Confirmé | P2 |
| SEC-11 | 10 vulnérabilités `npm audit` (6 élevées : pdfjs-dist, sharp, deepmerge-ts…) | Moyenne | Confirmé | P2 |
| SEC-12 | Le runner Python révèle un chemin absolu du serveur (`os.environ['_']`) | Faible | Confirmé | P3 |
| SEC-13 | Énumération de comptes par temps de réponse ; garde de pages côté client seulement ; `niala-theme` non scopé par utilisateur | Faible | Probable / Confirmé | P3 |

## Détail

### SEC-01 — Déni de service de la connexion (Élevée, P0)
- **Où** : `src/app/api/auth/login/route.ts:13` → `limit("login", 10, 60_000)` ; `src/lib/auth.ts:115` (`rateBuckets`).
- **Preuve** : 11 POST avec un e-mail inexistant → les 11e et suivants renvoient `429`. Une connexion **valide** d'un autre utilisateur lancée juste après reçoit aussi `429` « Trop de requêtes ».
- **Conditions** : aucune (route publique). **Conséquence** : un script à 11 requêtes/minute interdit la connexion à tous. À l'inverse, aucune protection **par compte** contre le bourrage de mots de passe (un attaquant qui cible un compte est bloqué avec tout le monde, mais le compteur est en mémoire et se réinitialise à chaque redémarrage).
- **Correction** : clé `login:${ip}` **et** `login:${email}` ; délai croissant par compte ; stockage partagé (voir SEC-07). **Régression** : faible ; tests `auth.test.ts` à étendre.

### SEC-02 — Plafond mémoire SQL contournable (Moyenne, P1)
- **Où** : `src/server/labs/runner/child.mjs:272` (`PRAGMA max_page_count = 5000`) ; `DANGEROUS` (l.260) n'interdit que ATTACH/DETACH/VACUUM INTO/load_extension.
- **Preuve** : `CREATE TABLE t(x); INSERT INTO t VALUES (zeroblob(40000000));` → « database or disk is full » (plafond 20 Mo OK). Avec `PRAGMA max_page_count=1000000;` en tête → **réussit** (40 Mo écrits, `length(x)=40000000`).
- **Conséquence** : l'étudiant dépasse la limite ; borné seulement par le délai (5 s) et la mémoire WASM ; trois exécutions concurrentes autorisées. **Correction** : refuser `PRAGMA` hors liste blanche (ou le ré-imposer après chaque instruction / via `sqlite3_limit`), vérifier aussi `PRAGMA query_only`, `writable_schema`. **Régression** : faible (labo SQL, `labs.test.ts`).

### SEC-03 — Pas d'isolation OS du runner (Élevée si hébergement ouvert, P1) — Probable
- **Où** : `src/server/labs/runner/host.ts:140` (`--max-old-space-size=160` ne borne **pas** la mémoire WebAssembly de Pyodide/sql.js), pas d'équivalent `--allow-net`.
- **Ce qui est solide (Confirmé par tests `host.test.ts` + test réel)** : environnement vide, `--permission` (lecture limitée), `process`/`fetch` retirés, pas d'accès à `/proc`, délai de 5 s, sortie bornée, résultats signés par nonce.
- **Non testé** (risque pour la machine) : allocation Python de plusieurs Go. **Conditions** : compte valide + `/api/labs/*/run` (30 exécutions/min/utilisateur). **Conséquence probable** : saturation mémoire du serveur. **Correction** : conteneur/microVM sans réseau et avec `memory.max`, ou service d'exécution séparé ; sinon ne pas ouvrir à des tiers. Le projet l'écrit déjà (`docs/ARCHITECTURE.md` §6) : c'est un **risque accepté**, pas une surprise.

### SEC-04 — pdfjs-dist (Élevée, P1)
- **Où** : `package.json` (`pdfjs-dist ^5.7.284`), `src/features/reader/pdf-viewer.tsx:108` (`getDocument`, aucune option `isEvalSupported: false`).
- **Preuve** : `npm audit` → GHSA-hq66-cqwq-w95j « exécution de JavaScript arbitraire à l'ouverture d'un PDF malveillant », corrigé en 6.2.108+. **Exploitation sur Niala non reproduite.**
- **Conséquence** : un PDF piégé (cours téléchargé ailleurs) exécute du JS **dans l'origine de l'application** : cookie `HttpOnly` non lisible, mais actions API au nom de l'étudiant possibles. **Correction** : mise à jour vers 6.x (vérifier l'API du lecteur) ; en attendant `isEvalSupported:false` + CSP (SEC-05).

### SEC-05 — En-têtes HTTP (Moyenne, P1)
- **Preuve** : `curl -I /login` → seul `X-Powered-By: Next.js` ; `next.config.ts` n'a pas de `headers()`. Pas de clickjacking protégé, pas de HSTS, pas de CSP pour les pages.
- **Correction** : `headers()` dans `next.config.ts` (CSP adaptée à pdf.js/CodeMirror/React Flow, `frame-ancestors 'none'`, HSTS, `Referrer-Policy`, `poweredByHeader:false`).

### SEC-06 — Secrets et données dans l'historique Git (Élevée, P1)
- **Preuve** : `git log --all --diff-filter=AM` liste `db/.auth-secret` (commit `fb4e0d0`), `db/custom.db` (`96d3d2b`, `fb4e0d0` ; blob de 393 216 octets), `.env` (`45291a3`, version SQLite `DATABASE_URL=file…`). Remote : `github.com/emma-kone/StudyForgeAI`. Valeurs non affichées ici.
- **À vérifier** : visibilité du dépôt. **Conséquences** : le secret de signature V1 permet de forger des sessions **si** cette valeur est encore utilisée en production ; `custom.db` contient des données V1 (hashes de mots de passe, documents). **Correction** : changer `AUTH_SECRET` en production, vérifier que le dépôt est privé, purger l'historique (`git filter-repo`) si nécessaire, forcer la rotation des mots de passe V1.

### SEC-07 — Limiteur en mémoire (Moyenne, P1 si hébergement serverless)
`rateBuckets` (`auth.ts:115`) et la file `running/waiters` du runner (`host.ts:93-105`) sont des variables de module : sur Vercel (la branche courante porte ce nom) chaque instance a ses compteurs → limites **non appliquées** ; sur un serveur unique, perdues au redémarrage ; la Map n'est jamais purgée (fuite lente). À vérifier : le runner (`process.execPath` + Pyodide) tourne-t-il sur le plan serverless visé ?

### SEC-08 — Sessions (Moyenne, P2)
Jeton `userId.exp.HMAC` sans identifiant de session (`auth.ts:50-66`). Conséquences : déconnexion = effacement local ; changement de mot de passe (`create-user.mjs --reset`) n'invalide pas les jetons existants ; durée 7 jours. Pas de fonctionnalité « changer le mot de passe » dans l'application. **Correction** : table `Session` ou `tokenVersion` sur `User`.

### SEC-09 — Dépôt de fichiers (Moyenne, P2)
`src/app/api/uploads/[versionId]/content/route.ts:14-15` ne contrôle que `Content-Length` ; une requête en `Transfer-Encoding: chunked` n'en a pas, puis `req.arrayBuffer()` charge tout en mémoire. Le plafond réel est ensuite vérifié (à confirmer dans `receiveLocalUpload`). DOCX/PPTX (zip) lus par `mammoth`/`jszip` : taux de décompression non borné à ma connaissance → **À vérifier**.

### SEC-10 — Routes mortes (Faible, P2)
`/api/execute` et `/api/sql/run` portent le commentaire « compatibilité V1 (supprimée en phase 9) » ; **aucun appel** dans `src/features` ni `src/components` (recherche exhaustive). Elles exposent un `setupSql` libre. `src/app/api/route.ts` renvoie « Hello, world! ». À supprimer.

### SEC-11 — Dépendances (Moyenne, P2)
`npm audit` : 6 élevées, 4 modérées. `pdfjs-dist` (SEC-04), `sharp ≤0.35.5-rc.1` (libvips/libheif/librsvg), `deepmerge-ts` via `@prisma/config`, `prismjs` via `react-syntax-highlighter` (paquet **inutilisé**, à retirer plutôt que mettre à jour).

### SEC-12 / SEC-13 — Faibles
- `os.environ` dans le runner Python renvoie `'_': 'C:/Users/konee/Desktop/site2V1/src/server/labs/runner/child.mjs'` : fuite de chemin.
- `login/route.ts:17-19` : `verifyPassword` n'est pas exécuté si l'utilisateur n'existe pas → réponse plus rapide (énumération). Pages `(app)` : `AuthGuard` côté client (pas de `middleware`/`proxy`) : le HTML de coquille est servi sans session, **aucune donnée** (les API renvoient 401, testé sur 5 routes). `localStorage["niala-theme"]` survit à la déconnexion et s'applique au compte suivant sur le même navigateur.

## Ce qui a été vérifié et est correct
- **401 sans session** sur `/api/subjects`, `/api/settings`, `/api/dashboard`, `/api/files/:id/content`, `/api/execute` (testé).
- **Isolation inter-utilisateurs** : le compte B reçoit **404** sur `/api/files/:id`, `/content`, `/text`, `/analysis`, `/index`, `/api/subjects/:id`, `/explorer`, et 404 sur le `PUT` de dépôt vers la version de A (testé en réel). Scan statique des `update/delete by id` : tous précédés d'un contrôle de propriété.
- **Traversée de chemins** : `assertSafeKey` (regex stricte) + vérification de préfixe (`storage/index.ts:35-46`). Clés sans nom de fichier.
- **Fichiers servis** avec `Content-Security-Policy: sandbox; default-src 'none'`, `nosniff` (`files/[id]/content/route.ts`). Markdown rendu avec `skipHtml` ; seuls usages de `dangerouslySetInnerHTML` : script de thème statique et `chart.tsx` (composant inutilisé).
- **Injection SQL** : aucun `$queryRaw` applicatif ; Prisma paramétré. Le SQL étudiant n'atteint jamais PostgreSQL (SQLite WASM jetable ; ATTACH refusé, testé).
- **Évasion du runner** : `os.listdir('/')` → système de fichiers mémoire Pyodide ; `/proc/self/environ` absent ; `globalThis` sans `process`/`fetch`/`require` (testé).
- **RLS** activée sur toutes les tables créées par les migrations (comparaison liste des `CREATE TABLE` / `ENABLE ROW LEVEL SECURITY`).
- **Clé API Gemini** envoyée en en-tête `x-goog-api-key` depuis le serveur uniquement (`provider.ts:93`).
- **Injection de prompt** : texte de document encadré (`wrapUntrusted`) + citations vérifiées (voir `AUDIT_IA.md`).
