---
title: Environnements d'exécution
description: Où la bibliothèque fonctionne, ce que le projet teste et ce que l'entrée principale demande à la plateforme. L'entrée principale n'utilise que des API web standard, et une entrée séparée contient ce qui exige Node.js.
---

```ts
// Partout où fetch existe.
import { YouTube } from "@ix-xs/youtube.api";
// Node.js : fichiers, serveur local, navigateur par défaut.
import { fileMedia } from "@ix-xs/youtube.api/node";
```

Le paquet a deux points d'entrée. Tout sauf quatre raccourcis se trouve dans l'entrée principale, qui n'a aucune dépendance et n'importe aucun module Node.js. Importer le paquet n'a aucun effet de bord : rien ne s'exécute tant que vous n'appelez rien.

## Node.js

Node.js 20 ou plus récent, comme l'indique `engines` dans `package.json`. Les deux systèmes de modules sont construits et typés :

```ts
import { YouTube } from "@ix-xs/youtube.api";
```

```js
const { YouTube } = require("@ix-xs/youtube.api");
```

`@ix-xs/youtube.api/node` ajoute ce qui exige la machine elle-même :

| Export | Ce qu'il fait | Utilise |
| --- | --- | --- |
| `fileMedia(path)` | Prépare un fichier du disque pour l'envoi, sans le lire en mémoire | `node:fs`, `node:path` |
| `tokenFile(path)` | Conserve les jetons OAuth dans un fichier JSON | `node:fs/promises`, `node:path` |
| `authorize(oauth, options)` | Exécute le parcours de consentement en local : un serveur sur la boucle locale, et la page de consentement ouverte dans le navigateur par défaut | `node:http`, `node:child_process` |
| `webSubListener(options)` | Transforme `websub.receive` en écouteur pour `node:http` et les frameworks construits dessus | Les objets de requête et de réponse de Node |

L'entrée `/node` construite importe ces modules avec le préfixe `node:`.

Quand `apiKey` est omis, le client lit la variable d'environnement `YOUTUBE_API_KEY` dans `process.env`. Cela vaut aussi pour un client créé avec `oauth` ou `accessToken`.

Ce que l'intégration continue du projet exécute :

| Node.js | Ce qui est exécuté |
| --- | --- |
| 22 et 24 | La suite de tests : vérification de types, tests au niveau des types, construction, tests unitaires et un test rapide des fichiers construits |
| 20 | Ce test rapide, sur des fichiers construits avec Node.js 22 : `require` et `import` des deux points d'entrée, un appel par le client avec un `fetch` de remplacement, `tokenFile` et `fileMedia` sur un vrai fichier |

Les outils de test ne tournent plus sur Node.js 20, c'est pourquoi cette version n'a que le test rapide.

## Bun et Deno

Aucun des deux ne fait partie de l'intégration continue du projet : rien n'est testé dessus. Voici ce que disent le code source et la construction :

- L'entrée principale n'utilise que les API web listées dans [le tableau plus bas](#what-the-main-entry-needs-from-the-platform).
- L'entrée `/node` importe `node:child_process`, `node:fs`, `node:fs/promises`, `node:http` et `node:path`. Elle fonctionne là où l'environnement d'exécution les implémente sous ces noms.
- Le repli sur `YOUTUBE_API_KEY` lit `process.env`. Là où l'environnement n'a pas cet objet, passez `apiKey` vous-même.

## Navigateurs

L'entrée principale est écrite pour s'exécuter dans une page. L'API de Google autorise les requêtes d'origine croisée depuis les navigateurs : les appels à l'API n'ont donc besoin d'aucun proxy. Ce qui change, c'est ce que vous pouvez garder secret, c'est-à-dire rien.

**La clé d'API est visible de tous les visiteurs.** Restreignez-la dans la console Google Cloud à votre site, par référent HTTP, et à l'API YouTube Data. [Identifiants d'accès](/start/credentials/) montre où.

**N'embarquez jamais un secret client.** Omettez `clientSecret` dans un `OAuth2` créé dans une page. `oauth.authUrl()` utilise PKCE par défaut et renvoie le `codeVerifier` à conserver jusqu'au retour de l'utilisateur. Quand votre client OAuth exige un secret pour l'échange du code, faites cette seule étape sur votre serveur et transmettez le jeton d'accès à la page :

```ts
// Dans la page, avec un jeton que votre serveur a obtenu pour cet utilisateur.
const yt = new YouTube({ accessToken: () => session.accessToken });
```

[OAuth](/auth/oauth/) décrit le parcours, [Servir de nombreux utilisateurs](/auth/many-users/) le côté serveur.

**Les envois acceptent un `File` ou un `Blob`.** `fileMedia` est réservé à Node.js. Dans une page, passez ce que vous donne un `<input type="file">` :

```ts
await yt.videos.insert({
  body: {
    snippet: { title: file.name },
    status: { privacyStatus: "private" },
  },
  media: {
    body: file,
    onProgress: ({ percent }) => console.log(percent),
  },
});
```

Autres différences :

- Le repli sur `YOUTUBE_API_KEY` lit `process.env`, qu'une page n'a pas : passez `apiKey` explicitement.
- `yt.quota` compte ce que cette page a envoyé depuis son chargement. Tous les visiteurs puisent dans le même quota du projet.
- PKCE, les signatures WebSub et les clés de cache des appels faits avec un jeton exigent `crypto.subtle`, que les navigateurs n'exposent que dans les contextes sécurisés.
- `fetchFeed`, `oEmbed` et `websub.subscribe` n'appellent pas l'API : ils appellent `www.youtube.com` et le hub. Le projet ne vérifie pas si ces hôtes acceptent une requête venant d'une page. Appelez-les depuis un serveur.

Aucun navigateur ne fait partie de l'intégration continue du projet.

## Cloudflare Workers et autres environnements edge

Utilisez l'entrée principale. L'entrée `/node` est écrite pour une machine avec un disque et un navigateur : `fileMedia` et `tokenFile` lisent et écrivent des fichiers, `authorize` écoute sur un port local et ouvre le navigateur par défaut.

`websub.receive` s'adapte tel quel à un gestionnaire de requêtes. Il prend une `Request` et renvoie la `Response` à retourner :

```ts
import { websub } from "@ix-xs/youtube.api";

interface Env {
  WEBSUB_SECRET: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { response, notifications } = await websub.receive(request, {
      secret: env.WEBSUB_SECRET,
    });
    for (const notification of notifications) {
      if (notification.type !== "video") continue;
      console.log(notification.title, notification.url);
    }
    return response;
  },
};
```

Ce qu'il faut garder en tête là où un processus ne reste pas en vie :

- **Boucles.** `watcher.start()` et `chat.messages()` attendent sur des minuteries entre deux requêtes. La durée qu'une requête ou une invocation peut prendre est la limite de la plateforme, pas celle de la bibliothèque. Pour les notifications d'envoi, exécutez un tour par invocation planifiée avec `watcher.check()`. Passez un `since` de quelques minutes avant l'exécution précédente, et ignorez les identifiants de vidéos déjà traités. Voir [Surveiller les nouvelles vidéos](/notifications/watching-uploads/).
- **Mémoire.** Le cache des réponses et le compteur de quota vivent en mémoire : ils durent aussi longtemps que l'instance. Donnez au cache un `store` adossé au stockage clé-valeur de la plateforme, et transportez le compteur de quota avec `yt.quota.snapshot()` et l'option `quota.restore`. Voir [Cache](/basics/caching/) et [Quota](/basics/quota/).
- **Environnement.** Le repli sur `YOUTUBE_API_KEY` n'existe que là où l'environnement fournit `process.env`. Passez `apiKey` depuis les liaisons de la plateforme.

Aucun environnement edge ne fait partie de l'intégration continue du projet.

## Hôtes appelés par la bibliothèque

Pour un environnement qui restreint les requêtes sortantes, ou pour une politique de sécurité du contenu :

| Hôte | Utilisé par |
| --- | --- |
| `youtube.googleapis.com` | L'API Data, envois compris. L'option `baseUrl` le remplace |
| `youtubeanalytics.googleapis.com` | `yt.analytics` |
| `youtubereporting.googleapis.com` | `yt.reporting` |
| `oauth2.googleapis.com` | `OAuth2` : échange du code, rafraîchissement, révocation, flux pour appareils, `tokenInfo` |
| `www.youtube.com` | `fetchFeed`, les requêtes de flux public d'un observateur, `oEmbed` |
| `pubsubhubbub.appspot.com` | `websub.subscribe` et `websub.unsubscribe` |

Un envoi avec reprise continue à l'URL de session que renvoie l'API, et un téléchargement de rapport va à l'URL que donne l'API. Les deux sont un choix de l'API. La page de consentement sur `accounts.google.com` est ouverte par le navigateur de l'utilisateur, pas demandée par la bibliothèque.

## Ce que l'entrée principale demande à la plateforme

| API | Sert à | Sans elle |
| --- | --- | --- |
| `fetch` | Chaque appel | Créer un client lève `INVALID_ARGUMENT`. Passez le vôtre avec l'option `fetch` |
| `Request`, `Response` | `websub.receive`, qui lit l'une et construit l'autre | Seul `websub.receive` est touché |
| `URL`, `URLSearchParams` | Construire les requêtes, analyser les URL YouTube, les requêtes OAuth et vers le hub | Obligatoire |
| `AbortController`, `AbortSignal` | Délais dépassés et annulation | Obligatoire |
| `TextEncoder`, `TextDecoder` | Envois de texte, PKCE, signatures et notifications WebSub, flux du chat, clés de cache des appels faits avec un jeton | Seuls ces usages sont touchés |
| `Blob` | Envois depuis un `Blob` ou un `File`, et envois multipart | Seuls les envois sont touchés |
| `ReadableStream` | Envois depuis un flux, corps d'une requête donnée à `websub.receive`, et le `mode: "stream"` expérimental du chat en direct | Seuls ces usages sont touchés |
| Web Crypto : `crypto.subtle`, `crypto.getRandomValues` | PKCE et le `state` généré par `oauth.authUrl()`, signatures WebSub, clés de cache des appels faits avec un jeton | `oauth.authUrl()` échoue, sauf si vous passez `state` et `pkce: false`. Les notifications signées ne peuvent pas être vérifiées. Les réponses des appels faits avec un jeton ne sont pas mises en cache |
| `btoa` | PKCE et le `state` généré | Comme ci-dessus pour `oauth.authUrl()` |
| `Intl.DateTimeFormat` avec le fuseau horaire `America/Los_Angeles` | Le jour de quota et `yt.quota.resetsAt`. Les formateurs sont construits à la première utilisation, c'est-à-dire à la création d'un client | La création d'un client échoue |
| `Intl.NumberFormat` avec la notation compacte | `formatCount` | Seul `formatCount` est touché |
| `setTimeout` | Délais dépassés, délais entre tentatives, interrogation | Obligatoire |

Le JavaScript est construit pour ES2022 et n'est pas minifié.

## TypeScript

Les types sont inclus, il n'y a pas de paquet `@types` pour la bibliothèque. Chaque point d'entrée livre un fichier de déclaration pour CommonJS et un pour les modules ES : les types que vous obtenez correspondent donc au système de modules pour lequel vous compilez.

| `moduleResolution` | Entrée principale | Entrée `/node` |
| --- | --- | --- |
| `node16`, `nodenext` | Résolue par `exports` | Résolue par `exports` |
| `bundler` | Résolue par `exports` | Résolue par `exports` |
| `node10`, l'ancien `node` | Résolue par `main` et `types` | Résolue par `typesVersions` |

L'intégration continue du projet vérifie cela à chaque modification, en empaquetant le paquet et en lançant `@arethetypeswrong/cli` dessus.

Les déclarations font référence à des types web comme `Request`, `Response`, `Blob`, `ReadableStream` et `AbortSignal`. Votre projet les obtient de la bibliothèque `DOM` ou de `@types/node`. L'entrée `/node` exige `@types/node`.

## Taille du bundle

Mesurée sur la construction en module ES de la version 2.0.0, avec gzip à son niveau par défaut :

| Fichier | Brut | Compressé avec gzip |
| --- | --- | --- |
| `index.mjs` | 129 ko | 26 ko |
| Le morceau qu'il partage avec l'entrée `/node` : erreurs, utilitaires d'URL, flux publics, oEmbed, WebSub | 26 ko | 8 ko |
| `node.mjs` | 6 ko | 2 ko |

Importer l'entrée principale charge les deux premiers : environ 34 ko compressés avec gzip, avant que votre bundler minifie quoi que ce soit. Les commentaires de documentation sont retirés du JavaScript et conservés dans les fichiers de déclaration, où les éditeurs les lisent. Aucune source map n'est publiée.

Le paquet déclare `"sideEffects": false` : un bundler peut donc supprimer ce que vous n'importez pas. Le gain dépend de ce que vous utilisez : la classe `YouTube` atteint toutes les ressources, donc l'importer conserve l'essentiel de la bibliothèque.

## Référence

| Environnement | Entrée principale | Entrée `/node` | Dans l'intégration continue du projet |
| --- | --- | --- | --- |
| Node.js 20 | Oui | Oui | Test de fumée de la construction |
| Node.js 22, 24 | Oui | Oui | Suite de tests |
| Bun, Deno | API web standard seulement | Exige les modules `node:` de l'environnement | Non |
| Navigateurs | API web standard seulement | Non | Non |
| Cloudflare Workers, environnements edge | API web standard seulement | Non | Non |

## Voir aussi

- [Démarrage rapide](/start/quick-start/) pour installer le paquet et faire un premier appel.
- [Identifiants d'accès](/start/credentials/) pour restreindre une clé d'API.
- [Envois](/resources/uploads/) pour `File`, `Blob`, les flux et `fileMedia`.
- [Notifications push](/notifications/push-notifications/) pour `websub.receive` dans un gestionnaire de requêtes.
