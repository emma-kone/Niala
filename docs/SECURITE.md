# Sécurité de Niala

Ce document décrit les protections en place, ce qui reste à régler chez l'hébergeur (Vercel) et quoi surveiller pendant
un test d'intrusion.

## 1. Ce que le code protège

| Attaque | Protection | Où |
|---|---|---|
| **DoS** (une seule source qui martèle) | Plafond par adresse IP : 400 requêtes par 10 s (réglable : `FLOOD_MAX_PER_10S`), réponse `429` avant tout accès à la base | `src/proxy.ts` |
| DoS par gros envois | Corps refusé d'après `Content-Length` (25 Mo pour l'API, 64 Mo pour le dépôt de fichiers), sans être lu : `413` | `src/proxy.ts` |
| DoS par hachage | Mots de passe bornés à 200 caractères avant hachage scrypt | routes de connexion |
| **Force brute — connexion étudiante** | 30 tentatives/min par IP ; 10 échecs par compte et par IP, 50 par compte toutes IP confondues, sur 15 min | `src/app/api/auth/login/route.ts` |
| **Force brute — back-office** | Adresse secrète (`ADMIN_PATH`) + code d'accès (5 essais par IP / 15 min) ; puis connexion : 20 tentatives par IP / 10 min, verrouillage 15 min après 5 échecs par IP ou 10 par compte, délai sur chaque échec, journal d'audit | `src/proxy.ts`, `src/server/admin/gate-attempt.ts`, `src/app/api/admin/auth/login/route.ts` |
| Contournement des limites | Les compteurs des routes publiques sont **en base** (table `RateLimit`), donc communs à toutes les instances « serverless » ; les clés sont des empreintes HMAC (ni IP ni e-mail en clair) | `src/lib/rate-limit.ts` |
| Énumération de comptes | Messages identiques et temps de réponse constant (hachage calculé même pour un compte inconnu) | `checkPassword` dans `src/lib/auth.ts` |
| **CSRF** (OWASP A01) | Cookies `SameSite=Lax` + refus des écritures d'API dont l'en-tête `Origin` est un autre site : `403` | `src/proxy.ts` |
| **XSS / injection de contenu** (A03) | Politique de contenu (CSP) : scripts, connexions et cadres limités à Niala et Supabase ; fichiers importés servis en bac à sable | `next.config.ts`, routes `/api/files` |
| Détournement de clic | `X-Frame-Options: SAMEORIGIN` et `frame-ancestors 'self'` | `next.config.ts` |
| Mauvaise configuration (A05) | `Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, pas d'en-tête `X-Powered-By` | `next.config.ts` |
| Injection SQL (A03) | Prisma et requêtes paramétrées uniquement | — |
| Contrôle d'accès (A01) | Session relue en base à chaque requête, filtrage par propriétaire, rôles du back-office vérifiés côté serveur | `src/lib/auth.ts`, `src/server/admin/session.ts` |
| Fuite d'informations (A09) | Erreurs 500 génériques avec référence ; détail dans les journaux serveur uniquement | `src/lib/api-helpers.ts` |

## 2. Avant de déployer

La table `RateLimit` est créée par la migration `20261123000000_niala_rate_limit` :

```bash
npm run db:deploy
```

Tant qu'elle n'est pas appliquée, le site fonctionne normalement mais les compteurs retombent en mémoire (protection
affaiblie sur Vercel) ; un message `[rate-limit] compteur en base indisponible` apparaît alors dans les journaux.

## 3. DDoS : à régler dans Vercel

Une attaque **distribuée** (des milliers d'adresses) ne s'arrête pas dans le code : chaque requête qui atteint
l'application a déjà consommé une fonction. La défense se fait en amont, dans le pare-feu de Vercel.

1. **Atténuation DDoS automatique** : active sur tous les projets, sans réglage. Les requêtes bloquées ne sont pas facturées.
2. **Règles de limitation** (projet → *Firewall* → *Add New Rule*), à créer d'abord en action *Log*, puis à passer en *Rate Limit* après avoir vérifié qu'aucun utilisateur réel n'est touché :
   - `Path` commence par `/api/auth` → 30 requêtes / 60 s par IP ;
   - `Path` commence par `/api/` → 600 requêtes / 60 s par IP ;
   - `Path` égal à `/api/assistance` → 10 requêtes / 60 s par IP.
3. **Bot Protection** (*Firewall* → *Bot Management*) : activer le défi pour les robots non vérifiés.
4. **En cas d'attaque en cours** : *Firewall* → **Attack Mode** (tous les visiteurs passent un défi). À désactiver une fois l'attaque terminée.
5. **Bloquer une adresse** : *Firewall* → *IP Blocking*.

Les compteurs de Vercel sont par région ; ceux du code sont par instance. Les deux se complètent.

## 4. Pendant un test d'intrusion

- **Back-office → Journal** : chaque échec de connexion ou de code d'accès y figure (`Échec de connexion administrateur`, `Code d'accès refusé`), avec l'adresse IP ; les verrouillages portent le motif `locked`.
- **Back-office → Performance / Anomalies** : pics de réponses `429`, `401`, `403`, `413` et de temps de réponse.
- **Vercel → Firewall → Traffic** : volume, adresses, règles déclenchées.
- Un administrateur verrouillé par erreur patiente 15 minutes, ou se connecte avec Google.
- Garder `ADMIN_PATH`, `ADMIN_ACCESS_HASH` et `AUTH_SECRET` hors de tout dépôt et de toute capture d'écran ; les changer après le test si le testeur les a vus.

## 5. Limites connues

- La CSP autorise les scripts en ligne (`'unsafe-inline'`), nécessaires à Next.js sans rendu dynamique généralisé : elle bloque le chargement de scripts externes et l'exfiltration, pas un script injecté dans la page elle-même. La défense principale contre le XSS reste l'échappement de React.
- Les limites des routes **authentifiées** (IA, exécution de code, sauvegardes) restent en mémoire, par utilisateur.
- `npm audit` signale 4 alertes **faibles** (KaTeX embarqué par `rehype-katex` / `remark-math`) : le correctif proposé impose une version incompatible.
