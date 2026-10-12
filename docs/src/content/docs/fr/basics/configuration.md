---
title: Configuration
description: "Les options du client, les options que chaque appel accepte, et les événements qui disent ce que fait le client."
sidebar:
  order: 6
---

```ts
import { YouTube } from "@ix-xs/youtube.api";

const yt = new YouTube({
  apiKey: process.env.YOUTUBE_API_KEY,
  cache: { ttl: "10m" },
  quota: { enforce: true },
  retry: { attempts: 5 },
  timeout: "15s",
});

yt.on("response", ({ method, duration, cost, cached }) => {
  console.log(method, `${duration} ms`, cached ? "cached" : `${cost} units`);
});
```

## Options du client

Tous les champs sont facultatifs. `new YouTube()` sans argument lit la variable d'environnement `YOUTUBE_API_KEY`, et `new YouTube("key")` est un raccourci pour `{ apiKey: "key" }`.

| Option | Type | Par défaut | Ce qu'elle fait |
| --- | --- | --- | --- |
| `apiKey` | `string` | La variable d'environnement `YOUTUBE_API_KEY` | Clé d'API, suffisante pour lire les données publiques |
| `oauth` | `OAuth2 \| OAuth2Options` | Aucun | Client OAuth 2.0 qui garde les jetons à jour, ou les options pour en construire un |
| `accessToken` | `string \| (() => string \| Promise<string>)` | Aucun | Un jeton d'accès déjà obtenu, ou une fonction qui en renvoie un. Pas de rafraîchissement automatique |
| `cache` | `boolean \| CacheOptions` | Désactivé | Met en cache les lectures réussies. `true` les garde 5 minutes en mémoire |
| `quota` | `QuotaOptions` | Limites par défaut, sans application | Limites quotidiennes, application facultative de ces limites et utilisation restaurée |
| `retry` | `RetryOptions \| false` | 3 nouvelles tentatives, à partir de `"500ms"`, doublant jusqu'à `"30s"` | Nouvelles tentatives sur les limites de débit, les erreurs serveur et les pannes réseau. `false` les désactive |
| `timeout` | `Duration` | `"30s"` | Temps accordé à une tentative. `0` le désactive. Les envois, les téléchargements de rapports et le flux du chat en direct n'y sont pas soumis |
| `fetch` | `typeof fetch` | Le `fetch` global | `fetch` personnalisé, pour un proxy, un client instrumenté ou des tests |
| `baseUrl` | `string` | `https://youtube.googleapis.com/` | Racine de l'API Data, pour passer par un proxy |
| `headers` | `Record<string, string>` | Aucun | En-têtes ajoutés à chaque requête |
| `quotaUser` | `string` | Aucun | Clé de quota par utilisateur, envoyée avec chaque requête |
| `onBehalfOfContentOwner` | `string` | Aucun | Pour les partenaires de contenu : le propriétaire de contenu au nom duquel les requêtes sont faites, sur chaque méthode qui accepte ce paramètre |

Chaque groupe a sa propre page : [Identifiants d'accès](/start/credentials/) pour les trois premières options, [Cache](/basics/caching/), [Quota](/basics/quota/), et [Erreurs](/basics/errors/) pour `retry` et `timeout`.

## Options d'un appel

Chaque appel d'API accepte des options de requête en dernier argument. Elles ne valent que pour cet appel et l'emportent sur celles du client.

```ts
const { signal } = new AbortController();

// Méthodes brutes : après les paramètres. 1 unité.
await yt.videos.list(
  { part: "snippet", id: videoId },
  { timeout: "5s", retry: false },
);

// La plupart des raccourcis : dans le même objet que leurs propres options. 1 unité, puis 50.
await yt.videos.get(videoId, { part: "statistics", cache: false });
await yt.playlists.add(playlistId, videoId, { position: 0, signal });
```

| Option | Type | Ce qu'elle fait |
| --- | --- | --- |
| `signal` | `AbortSignal` | Annule l'appel. Il lève alors une erreur de code `ABORTED` |
| `timeout` | `Duration` | Remplace le délai du client |
| `retry` | `RetryOptions \| false` | Remplace la politique de nouvelles tentatives du client, champ par champ. `false` les désactive |
| `fields` | `string` | Sélecteur de réponse partielle : seuls les champs listés reviennent. Exemple : `"items(id,snippet/title),nextPageToken"` |
| `cache` | `Duration \| false` | `false` ignore le cache, une durée remplace la fraîcheur |
| `quotaUser` | `string` | Clé de quota par utilisateur, 40 caractères au plus |
| `accessToken` | `string` | Utilise ce jeton d'accès au lieu des identifiants du client |
| `headers` | `Record<string, string>` | En-têtes supplémentaires, fusionnés par-dessus ceux du client |

Sur une liste, les options s'appliquent à chaque page que la requête récupère.

## Durées

Partout où la bibliothèque attend une durée, elle accepte une `Duration` : un nombre de millisecondes, ou un nombre suivi d'une unité.

| Unité | Signification | Exemple |
| --- | --- | --- |
| `ms` | Millisecondes | `"500ms"` |
| `s` | Secondes | `"30s"` |
| `m` | Minutes | `"5m"` |
| `h` | Heures | `"2h"` |
| `d` | Jours | `"1d"` |

```ts
const yt = new YouTube({
  apiKey,
  timeout: 10_000, // un nombre vaut des millisecondes
  retry: { delay: "1s", maxDelay: "1m" },
  cache: { ttl: "1.5h" }, // les décimales fonctionnent
});

// @ts-expect-error "5 minutes" n'est pas une Duration
new YouTube({ apiKey, timeout: "5 minutes" });
```

Le type vérifie le format. Une chaîne construite à l'exécution qui ne correspond pas lève une `YouTubeArgumentError`, tout comme un nombre négatif.

## Événements

Le client émet un événement à chaque étape d'un appel. `yt.on(event, listener)` s'abonne et renvoie une fonction qui se désabonne. `yt.once` n'écoute qu'une seule occurrence, et `yt.off(event, listener)` retire un écouteur.

| Événement | Se déclenche quand | Contenu |
| --- | --- | --- |
| `request` | Une requête va être envoyée. Une fois par tentative | `{ method, verb, url, attempt }` |
| `response` | Un appel s'est terminé avec succès | `{ method, status, duration, cached, cost, bucket }` |
| `retry` | Une tentative échouée va être retentée | `{ method, attempt, delay, error }` |
| `quota` | Du quota a été facturé | `{ method, bucket, cost, used, remaining }` |
| `error` | Un écouteur a levé une erreur, ou le stockage du cache a échoué | L'erreur |

Ce que contiennent les champs :

- `method` est le nom de la méthode, par exemple `videos.list`. `verb` est le verbe HTTP.
- `url` est expurgée de ses identifiants : vous pouvez la consigner sans risque.
- `attempt` commence à 0 dans `request`. Dans `retry`, c'est le numéro de la nouvelle tentative, à partir de 1.
- `duration` et `delay` sont en millisecondes.
- Un appel servi depuis le cache déclenche `response` avec `cached: true`, une `duration` de 0 et un `cost` de 0. Il ne déclenche ni `request` ni `quota`.

Un journal pour tout :

```ts
yt.on("request", ({ verb, method, url, attempt }) => {
  const again = attempt ? ` (attempt ${attempt + 1})` : "";
  console.debug(`-> ${verb} ${method}${again} ${url}`);
});

yt.on("response", ({ method, status, duration, cached, cost, bucket }) => {
  const spent = cached ? "cached" : `${cost} from ${bucket}`;
  console.info(`<- ${method} ${status} in ${duration} ms, ${spent}`);
});

yt.on("retry", ({ method, attempt, delay, error }) => {
  console.warn(`${method}: retry ${attempt} in ${delay} ms`, error.message);
});

const stop = yt.on("quota", ({ bucket, remaining }) => {
  if (remaining === 0) console.error(`The "${bucket}" bucket is empty`);
});

stop(); // désabonne le dernier
```

Un écouteur qui lève une erreur, ou dont la promesse est rejetée, ne casse pas l'appel qui l'a déclenché. L'échec est transmis à l'événement `error` si quelqu'un l'écoute, et abandonné sinon.

Les appels échoués n'ont pas d'événement propre. Ils lèvent une erreur, que vous interceptez là où vous avez fait l'appel.

## Appeler une méthode par son nom

Les ressources typées, `yt.videos.list(...)`, sont la manière normale d'appeler l'API. `yt.request()` sert au cas rare où la méthode est choisie à l'exécution.

```ts
import type { MethodId, VideoListResponse } from "@ix-xs/youtube.api";

const response = await yt.request<VideoListResponse>("videos.list", {
  part: "id",
  chart: "mostPopular",
}); // 1 unité

function call(method: MethodId, params: Record<string, unknown>) {
  const { cost, bucket } = quotaCost(method);
  console.log(`${method}: ${cost} from "${bucket}"`);
  return yt.request(method, params);
}
```

Le nom de la méthode est vérifié par rapport à `MethodId`. Le reste est à votre charge :

- Les paramètres ne sont pas vérifiés par le typage, et le résultat est `unknown` tant que vous n'en nommez pas le type.
- Vous obtenez le corps de la réponse tel que l'API l'a envoyé. Il n'y a pas de `ListRequest` : pas de parcours des pages, et une liste d'identifiants n'est pas découpée.
- Une écriture a besoin de son `part`. Les méthodes typées le déduisent du corps, `yt.request()` non.

Les identifiants, le comptage du quota, le cache, les nouvelles tentatives et les événements fonctionnent comme pour tout autre appel. Les paramètres de chemin, les paramètres de requête, `body` et `media` vont tous dans le même objet `params`. `METHODS` est la table de toutes les méthodes, avec leur verbe, leur chemin, leur coût et leurs scopes.

## Agir pour un autre utilisateur

`yt.as(credentials)` renvoie un client qui envoie ses appels avec un autre jeton d'accès ou un autre client `OAuth2`. Il partage le cache, le compteur de quota, les événements et les réglages du client dont il vient : un serveur crée donc un seul `YouTube` au démarrage et en dérive un par requête. Un second argument remplace `quotaUser`, `headers` ou `onBehalfOfContentOwner` pour cet utilisateur. [Servir de nombreux utilisateurs](/auth/many-users/) montre le schéma complet.

```ts
// Dans un gestionnaire de requêtes de votre serveur :
const user = yt.as(session.accessToken);
const channel = await user.channels.mine(); // 1 unité
```

## Un fetch personnalisé

L'option `fetch` remplace la fonction qui envoie chaque requête. Utilisez-la pour mesurer, pour passer par un agent, ou pour répondre depuis des jeux de données dans les tests.

```ts
const yt = new YouTube({
  apiKey,
  fetch: async (input, init) => {
    const started = Date.now();
    const response = await fetch(input, init);
    console.log(response.status, `${Date.now() - started} ms`);
    return response;
  },
});
```

Dans un test, répondez sans aucun réseau :

```ts
const yt = new YouTube({
  apiKey: "test",
  retry: false,
  fetch: async () =>
    new Response(JSON.stringify({ items: [] }), {
      headers: { "content-type": "application/json" },
    }),
});

const video = await yt.videos.get("dQw4w9WgXcQ"); // null
```

La même fonction sert aux appels d'API, aux envois, aux requêtes de jeton d'un client `OAuth2` construit à partir des options `oauth`, et aux requêtes de flux de `yt.watch()`. Une instance `OAuth2` que vous créez vous-même a sa propre option `fetch`.

Sans cette option, le `fetch` global est utilisé. S'il n'y en a pas, le constructeur lève une `YouTubeArgumentError`.

## Passer par un proxy

`baseUrl` remplace la racine de l'API Data. Le chemin de chaque méthode, `youtube/v3/videos` par exemple, lui est ajouté.

```ts
const yt = new YouTube({
  apiKey,
  baseUrl: "https://youtube-proxy.example.com/",
});
```

Trois choses à savoir :

- Seule l'API Data change d'adresse, envois compris. Les API Analytics et Reporting gardent leurs propres hôtes.
- Le proxy reçoit les identifiants : la clé d'API dans `X-Goog-Api-Key`, ou le jeton d'accès dans `Authorization`. Ne pointez `baseUrl` que vers un hôte que vous contrôlez.
- `headers` est l'endroit pour ce dont votre proxy a besoin, comme sa propre authentification. Le client place l'en-tête d'identifiants qu'il utilise, `authorization` ou `x-goog-api-key`, après les vôtres : vous ne pouvez donc pas remplacer celui-là.

## Propriétaires de contenu

`onBehalfOfContentOwner` s'adresse aux partenaires de contenu YouTube. Le client l'ajoute à chaque appel d'une méthode qui accepte ce paramètre et qui ne le définit pas elle-même, dans les API Data, Analytics et Reporting. Les méthodes qui ne l'acceptent pas, comme `analytics.query` (qui nomme le propriétaire dans `ids`), ne sont pas touchées.

```ts
const yt = new YouTube({ oauth, onBehalfOfContentOwner: "CONTENT_OWNER_ID" });
```

Un appel qui le porte exige OAuth, même pour des lectures publiques comme `videos.list` : avec une clé d'API seule, il est refusé avec `MISSING_CREDENTIALS`.

## Référence

Les tableaux de `YouTubeOptions`, `RequestOptions` et `ClientEvents` se trouvent dans les sections ci-dessus. `RetryOptions` est sur la page [Erreurs](/basics/errors/), `CacheOptions` sur [Cache](/basics/caching/) et `QuotaOptions` sur [Quota](/basics/quota/).

### Membres du client

| Membre | Ce que c'est |
| --- | --- |
| `yt.quota` | Quota dépensé par ce client, par enveloppe et par méthode |
| `yt.oauth` | Le client `OAuth2`, quand le client a été créé avec l'un d'eux |
| `yt.on(event, listener)` | S'abonne à un événement. Renvoie une fonction qui se désabonne |
| `yt.once(event, listener)` | Comme `on`, pour une seule occurrence |
| `yt.off(event, listener)` | Retire un écouteur |
| `yt.as(credentials, overrides?)` | Un client qui agit pour un autre utilisateur et partage le cache, le compteur de quota, les événements et les réglages |
| `yt.request(method, params?, options?)` | Appelle une méthode par son nom |
| `yt.clearCache()` | Vide le cache des réponses |
| `yt.liveChat(liveChatId)`, `yt.liveChatOf(video)` | Un chat en direct, voir [Chat en direct](/live/live-chat/) |
| `yt.watch(channels, options?)` | Un observateur des nouveaux envois, voir [Surveiller les nouvelles vidéos](/notifications/watching-uploads/) |

Le client a aussi une propriété par ressource, comme `yt.videos` et `yt.channels`. [Toutes les méthodes](/reference/methods/) les liste.

### Contenu des événements

| Événement | Champ | Type |
| --- | --- | --- |
| `request` | `method`, `verb`, `url` | `string` |
| | `attempt` | `number` |
| `response` | `method` | `string` |
| | `status`, `duration`, `cost` | `number` |
| | `cached` | `boolean` |
| | `bucket` | `QuotaBucket` |
| `retry` | `method` | `string` |
| | `attempt`, `delay` | `number` |
| | `error` | `Error` |
| `quota` | `method` | `string` |
| | `bucket` | `QuotaBucket` |
| | `cost`, `used`, `remaining` | `number` |
| `error` | Le contenu lui-même | `unknown` |

Les types sont exportés sous les noms `YouTubeOptions`, `RequestOptions`, `RetryOptions`, `ClientEvents`, `QuotaEvent` et `Duration`.

## Voir aussi

- [Identifiants d'accès](/start/credentials/) : `apiKey`, `oauth` et `accessToken` en détail.
- [Erreurs](/basics/errors/) : ce que font `retry`, `timeout` et `signal` quand un appel échoue.
- [Cache](/basics/caching/) et [Quota](/basics/quota/) : les deux options qui ont leur propre page.
- [Environnements d'exécution](/reference/runtimes/) : ce que la bibliothèque attend de chaque plateforme.
