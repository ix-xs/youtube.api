---
title: Cache
description: "Une seule option garde les lectures réussies quelques minutes : un appel répété ne coûte ni quota ni aller-retour réseau. La fraîcheur se règle par client, par méthode ou par appel, et le stockage peut être le vôtre."
sidebar:
  order: 5
---

```ts
const yt = new YouTube({ apiKey, cache: true });

await yt.videos.get(videoId); // 1 unité, envoyé à l'API
await yt.videos.get(videoId); // aucun quota, servi depuis la mémoire
```

## L'activer

Le cache est désactivé par défaut. `cache: true` garde chaque lecture réussie pendant 5 minutes, en mémoire, jusqu'à 500 réponses. Au-delà, la moins récemment utilisée est supprimée.

Un objet règle les détails :

```ts
const yt = new YouTube({
  apiKey,
  cache: {
    ttl: "10m", // durée de fraîcheur d'une réponse
    max: 2000, // réponses gardées par le stockage en mémoire
  },
});
```

Une réponse est rangée sous l'appel qui l'a produite : l'URL de la requête, qui contient la méthode, tous les paramètres, `fields` et `quotaUser`, ainsi que l'identité de l'appelant. Changez un paramètre et c'est une autre entrée. Chaque page d'une liste a sa propre entrée.

Un appel servi depuis le cache ne coûte aucun quota et ne touche pas le réseau. L'événement `response` le signale avec `cached: true` et un coût de 0.

## Fraîcheur par méthode

Certaines réponses changent chaque minute, d'autres une fois par an. `methods` règle la fraîcheur d'une méthode, ou désactive le cache pour elle avec `false`. Tout le reste utilise `ttl`.

```ts
const yt = new YouTube({
  apiKey,
  cache: {
    ttl: "5m",
    methods: {
      "videoCategories.list": "1d", // change rarement
      "search.list": "1h", // chaque appel économisé est l'un des 100 du jour
      "videos.list": false, // toujours à jour
    },
  },
});
```

Les clés sont des noms de méthodes, écrits comme dans la [liste des méthodes](/reference/methods/). Elles ne sont pas vérifiées : un nom mal orthographié est ignoré. Un raccourci est mis en cache sous la méthode qu'il appelle : `yt.videos.get` correspond à `videos.list`, `yt.playlists.items` et `yt.channels.uploads` à `playlistItems.list`, `yt.search.videos` à `search.list`.

## Un appel à la fois

L'option de requête `cache` remplace la règle pour un seul appel.

```ts
// Ignorer le cache : l'appel est envoyé, et sa réponse n'est pas stockée.
const live = await yt.videos.get(videoId, { cache: false }); // 1 unité

// Garder la réponse de cet appel pendant une heure.
const categories = await yt.videoCategories.list(
  { part: "snippet", regionCode: "FR" },
  { cache: "1h" },
); // 1 unité
```

Une durée fixe combien de temps la réponse stockée par cet appel reste fraîche. Elle ne raccourcit pas une entrée déjà présente et encore fraîche. Pour forcer une nouvelle lecture, utilisez `cache: false`.

L'option ne fait rien sur un client créé sans `cache`.

## Après une écriture

Les écritures ne sont jamais mises en cache, et elles ne retirent rien du cache. Une lecture qui suit une écriture peut renvoyer l'état d'avant, jusqu'à ce que l'entrée périme.

```ts
await yt.playlists.add(playlistId, videoId); // 50 unités

// Lire en contournant le cache pour voir le nouvel élément. 1 unité par page.
const items = await yt.playlists.items(playlistId, { cache: false }).all();
```

`yt.clearCache()` vide tout le cache. La promesse se résout une fois le stockage vidé.

```ts
await yt.clearCache();
```

## Revalidation avec les ETags

Une entrée périmée n'est pas jetée. Quand une réponse porte un ETag, le client le garde avec l'entrée. Une fois l'entrée périmée, l'appel suivant envoie cet ETag dans `If-None-Match` :

- Si rien n'a changé, l'API répond `304 Not Modified` sans corps. L'entrée est de nouveau marquée fraîche et sa valeur est renvoyée.
- Si quelque chose a changé, l'API répond avec la nouvelle réponse, qui remplace l'entrée.

La revalidation économise le transfert, pas le quota. `yt.quota` compte un `304` au coût de la méthode. Seule une entrée fraîche est gratuite.

## Les entrées sont gardées par utilisateur

Une réponse en cache appartient aux identifiants qui l'ont obtenue.

- Les appels faits avec la clé d'API partagent leurs entrées.
- Les appels faits avec un jeton sont rangés sous une empreinte du jeton de l'utilisateur. Deux utilisateurs ne partagent jamais une entrée, même pour la même URL.
- Aucune partie d'un jeton n'atteint le stockage. La clé d'une entrée contient l'empreinte et l'URL de la requête, et la clé d'API n'est jamais dans une URL.

Cela vaut pour les clients créés avec [`yt.as()`](/auth/many-users/), qui partagent le cache du client dont ils viennent.

Deux conséquences découlent de l'empreinte. Un client `OAuth2` avec un jeton de rafraîchissement est identifié par ce jeton, donc ses entrées survivent à chaque rafraîchissement. Un `accessToken` seul est sa propre identité, et un nouveau jeton repart d'un cache vide. Enfin, dans un environnement d'exécution sans API Web Crypto, les appels faits avec un jeton ne sont pas mis en cache du tout.

## Les lectures identiques partagent une requête

Quand la même lecture est demandée plusieurs fois au même moment, une seule requête part et chaque appelant reçoit sa réponse. Cela fonctionne avec ou sans cache.

```ts
// Une requête, 1 unité.
const [a, b, c] = await Promise.all([
  yt.videos.get(videoId),
  yt.videos.get(videoId),
  yt.videos.get(videoId),
]);
```

« La même lecture » désigne la même URL et les mêmes identifiants. Un appel qui porte un `signal` n'est jamais partagé, afin que son annulation ne puisse pas interrompre la requête d'un autre.

## Ce qui n'est jamais mis en cache

- Les écritures. Seuls les appels `GET` réussis sont stockés.
- Les erreurs. Une lecture qui échoue est retentée ou levée, jamais stockée.
- Le chat en direct. `chat.messages()` lit en contournant le cache, car une page en cache rejouerait d'anciens messages comme s'ils étaient nouveaux.
- L'observateur d'envois. Quand `yt.watch()` se rabat sur l'API, il lit lui aussi en contournant le cache.
- Les envois de médias, les téléchargements de rapports avec `yt.reporting.download()` et le flux du chat en direct.

`yt.captions.download()` est une lecture comme une autre : son texte est mis en cache. Passez `cache: false` quand il vous faut la piste à jour.

## Un stockage personnalisé

Le stockage intégré vit dans la mémoire d'un seul processus. Pour partager le cache entre plusieurs processus, ou le conserver d'un redémarrage à l'autre, donnez au client un `CacheStore`. Il lui faut deux méthodes, `get` et `set`. `delete` et `clear` sont facultatives. Chacune peut être synchrone ou renvoyer une promesse.

Un stockage fondé sur une `Map` :

```ts
import type { CacheEntry, CacheStore } from "@ix-xs/youtube.api";

class MapStore implements CacheStore {
  readonly #entries = new Map<string, CacheEntry>();

  get(key: string) {
    return this.#entries.get(key);
  }
  set(key: string, entry: CacheEntry) {
    this.#entries.set(key, entry);
  }
  delete(key: string) {
    this.#entries.delete(key);
  }
  clear() {
    this.#entries.clear();
  }
}

const yt = new YouTube({ apiKey, cache: { store: new MapStore() } });
```

Un stockage fondé sur Redis :

```ts
import type { CacheEntry, CacheStore } from "@ix-xs/youtube.api";

const store: CacheStore = {
  async get(key) {
    const text: string | null = await redis.get(`yt:${key}`);
    return text ? (JSON.parse(text) as CacheEntry) : undefined;
  },
  async set(key, entry) {
    // Garder l'entrée un jour de plus que sa fraîcheur, pour pouvoir la revalider.
    const seconds = Math.ceil((entry.expires - Date.now()) / 1000) + 86_400;
    await redis.set(`yt:${key}`, JSON.stringify(entry), "EX", seconds);
  },
  async delete(key) {
    await redis.del(`yt:${key}`);
  },
};

const yt = new YouTube({ apiKey, cache: { store, ttl: "10m" } });
```

Ce qu'il faut savoir quand vous en écrivez un :

- Une entrée est `{ value, etag, expires }`. `value` est le corps de la réponse analysé, donc il se sérialise en JSON. `expires` est un horodatage en millisecondes.
- C'est le client qui décide si une entrée est fraîche. Renvoyez aussi les entrées dont `expires` est passé : une entrée périmée avec un ETag est ce qui rend la revalidation possible. Éliminez les entrées selon vos propres règles, par nombre ou après un délai plus long.
- Le client appelle `get`, `set` et, depuis `yt.clearCache()`, `clear`. Il n'appelle jamais `delete` : écrivez-la pour votre propre invalidation, ou omettez-la.
- `max` ne s'applique qu'au stockage intégré. Avec votre propre stockage, borner la taille vous revient.
- Sans `clear`, `yt.clearCache()` ne fait rien.

`MemoryCache`, le stockage intégré, est exporté. `new MemoryCache(max)` vous en donne un à partager entre plusieurs clients.

## Quand le stockage échoue

Un cache qui échoue ne fait jamais échouer l'appel qu'il devait accélérer. Si `get` lève une erreur, l'appel part comme si rien n'était en cache. Si `set` lève une erreur, la réponse est renvoyée sans être stockée. Dans les deux cas, l'échec est transmis à l'événement `error` du client :

```ts
yt.on("error", (error) => {
  console.warn("YouTube client:", error);
});
```

## Référence

### `CacheOptions`

| Champ | Type | Par défaut | Ce qu'il fait |
| --- | --- | --- | --- |
| `ttl` | `Duration` | `"5m"` | Durée de fraîcheur d'une réponse |
| `max` | `number` | `500` | Entrées gardées par le stockage en mémoire avant que la moins récemment utilisée soit supprimée |
| `methods` | `Record<string, Duration \| false>` | `{}` | Fraîcheur par méthode. `false` désactive le cache pour cette méthode |
| `store` | `CacheStore` | Un stockage en mémoire | Stockage personnalisé |

`cache: true` équivaut à `cache: {}`.

### L'option de requête `cache`

| Valeur | Effet |
| --- | --- |
| `false` | L'appel ignore le cache : rien n'y est lu, rien n'y est stocké |
| Une `Duration` | La réponse de cet appel reste fraîche pendant cette durée, quoi que disent `ttl` et `methods` |

### `CacheStore`

| Méthode | Signature |
| --- | --- |
| `get` | `(key: string) => CacheEntry \| undefined \| Promise<CacheEntry \| undefined>` |
| `set` | `(key: string, entry: CacheEntry) => void \| Promise<void>` |
| `delete` | `(key: string) => void \| Promise<void>`, facultative |
| `clear` | Facultative. `() => void \| Promise<void>` |

### `CacheEntry`

| Champ | Type | Ce que c'est |
| --- | --- | --- |
| `value` | `unknown` | Corps de la réponse analysé |
| `etag` | `string \| undefined` | ETag de la réponse, utilisé pour revalider une fois l'entrée périmée |
| `expires` | `number` | Horodatage en millisecondes après lequel l'entrée est périmée |

Une `Duration` est un nombre de millisecondes ou une chaîne comme `"30s"`, `"5m"`, `"2h"` ou `"1d"`. Voir [Configuration](/basics/configuration/).

## Voir aussi

- [Quota](/basics/quota/) : ce que coûte un appel qui n'est pas en cache.
- [Configuration](/basics/configuration/) : les autres options du client, et ses événements.
- [Servir de nombreux utilisateurs](/auth/many-users/) : un client, un cache, plusieurs jetons.
- [Chat en direct](/live/live-chat/) : les lectures qui doivent rester à jour.
