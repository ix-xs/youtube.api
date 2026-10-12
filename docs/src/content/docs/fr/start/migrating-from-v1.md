---
title: Migrer depuis la 1.x
description: La version 2 est une réécriture. Les quatre méthodes de la 1.x deviennent deux raccourcis, les résultats sont les données elles-mêmes et les échecs lèvent une erreur.
---

```js
// 1.x
const YoutubeAPI = require("@ix-xs/youtube.api");

const youtube = new YoutubeAPI({ apiKey: process.env.YOUTUBE_API_KEY });
const { ok, data } = await youtube.getChannelById("UC_x5XG1OV2P6uZZ5FSM9Ttw");
```

```ts
// 2.x
import { YouTube } from "@ix-xs/youtube.api";

const yt = new YouTube({ apiKey: process.env.YOUTUBE_API_KEY });
const channel = await yt.channels.get("UC_x5XG1OV2P6uZZ5FSM9Ttw"); // 1 unité
```

## Ce qui a changé

| 1.x | 2.x |
| --- | --- |
| Un export par défaut, `YoutubeAPI` | Un export nommé, `YouTube` |
| `getChannelByUsername(username)`, `getChannelById(id)` | `yt.channels.get(channel)` |
| `getLastVideoByUsername(username)`, `getLastVideoByChannelId(id)` | `yt.channels.latestVideo(channel)` |
| Chaque appel renvoie `{ ok, status, statusText, data }` | Un appel renvoie les données, ou lève une erreur |
| La dernière vidéo est le snippet d'un élément de playlist | La dernière vidéo est une ressource vidéo complète |
| Licence ISC | Licence MIT |

## L'import

La classe est désormais un export nommé, `YouTube`.

```js
// 1.x
const YoutubeAPI = require("@ix-xs/youtube.api");
const youtube = new YoutubeAPI({ apiKey: "..." });
```

```ts
// 2.x, modules ES
import { YouTube } from "@ix-xs/youtube.api";
const yt = new YouTube({ apiKey });
```

```js
// 2.x, CommonJS
const { YouTube } = require("@ix-xs/youtube.api");
const yt = new YouTube({ apiKey: process.env.YOUTUBE_API_KEY });
```

Le constructeur prend toujours `{ apiKey }`. Sans `apiKey`, il lit la variable d'environnement `YOUTUBE_API_KEY`. [Identifiants d'accès](/start/credentials/) donne les détails.

## getChannelByUsername

```js
// 1.x
const result = await youtube.getChannelByUsername("GoogleDevelopers");
if (result.ok) console.log(result.data);
```

```ts
// 2.x
const channel = await yt.channels.get("GoogleDevelopers");
if (channel) {
  console.log(channel.snippet.title, channel.statistics.subscriberCount);
}
```

`yt.channels.get` accepte une chaîne sous toutes ses formes : identifiant, `@handle`, ancien nom d'utilisateur ou URL de chaîne. Elle renvoie `null` quand rien ne correspond.

Un nom seul, comme `"GoogleDevelopers"`, est d'abord essayé comme handle, puis comme ancien nom d'utilisateur. Cela coûte 1 unité de quota, ou 2 quand la seconde recherche est nécessaire. Pour éviter la devinette, dites lequel vous voulez :

```ts
// Un handle : 1 unité.
await yt.channels.get("@GoogleDevelopers");

// Un ancien nom d'utilisateur, par son URL : 1 unité.
await yt.channels.get("https://www.youtube.com/user/GoogleDevelopers");

// Un ancien nom d'utilisateur, par la méthode brute : 1 unité.
await yt.channels
  .list({ part: ["snippet", "statistics"], forUsername: "GoogleDevelopers" })
  .first();
```

## getChannelById

```js
// 1.x
const result = await youtube.getChannelById("UC_x5XG1OV2P6uZZ5FSM9Ttw");
if (result.ok) console.log(result.data);
```

```ts
// 2.x
const channel = await yt.channels.get("UC_x5XG1OV2P6uZZ5FSM9Ttw");
if (channel) console.log(channel.snippet.title);
```

L'appel coûte 1 unité. Le résultat contient les parties `snippet`, `contentDetails` et `statistics`. Passez `part` pour en choisir d'autres, et le type suit :

```ts
const slim = await yt.channels.get(channelId, { part: "snippet" });
// Channel<"snippet"> | null
```

[Parties et types](/basics/parts-and-types/) explique comment le type du résultat est construit.

## getLastVideoByUsername

```js
// 1.x
const result = await youtube.getLastVideoByUsername("GoogleDevelopers");
if (result.ok) console.log(result.data.title, result.data.resourceId.videoId);
```

```ts
// 2.x
const video = await yt.channels.latestVideo("GoogleDevelopers");
if (video) console.log(video.snippet.title, video.id);
```

L'appel renvoie `null` quand la chaîne n'a aucun envoi. Il coûte 2 unités : une pour lire la playlist des envois, une pour récupérer la vidéo. Résoudre un nom en identifiant de chaîne coûte 1 unité de plus la première fois (2 pour un nom seul qui se révèle être un ancien nom d'utilisateur), et le client retient la réponse.

## getLastVideoByChannelId

```js
// 1.x
const id = "UC_x5XG1OV2P6uZZ5FSM9Ttw";
const result = await youtube.getLastVideoByChannelId(id);
if (result.ok) console.log(result.data.title, result.data.resourceId.videoId);
```

```ts
// 2.x
const video = await yt.channels.latestVideo("UC_x5XG1OV2P6uZZ5FSM9Ttw");
if (video) console.log(video.snippet.title, video.id);
```

2 unités. Pour plus d'une vidéo, `yt.channels.latestVideos(channel, { limit })` coûte les mêmes 2 unités jusqu'à 50 vidéos.

## La forme de la dernière vidéo

La 1.x renvoyait le snippet d'un élément de playlist : l'entrée de la vidéo dans la playlist des envois de la chaîne. La 2.x renvoie la vidéo elle-même, avec `snippet`, `contentDetails` et `statistics`. Les champs que vous lisiez ont changé de place :

| 1.x, sur `data` | 2.x, sur `video` |
| --- | --- |
| `resourceId.videoId` | `id` |
| `title` | `snippet.title` |
| `description` | `snippet.description` |
| `publishedAt` | `snippet.publishedAt` |
| `thumbnails` | `snippet.thumbnails` |
| `channelId` | `snippet.channelId` |
| `channelTitle` | `snippet.channelTitle` |
| `playlistId`, `position` | Absents d'une vidéo. Voir plus bas |

Vous obtenez aussi ce qu'un élément de playlist ne porte pas :

```ts
const video = await yt.channels.latestVideo(channelId); // 2 unités

if (video) {
  video.contentDetails.duration; // "PT4M13S"
  video.statistics.viewCount; // string
  formatDuration(video.contentDetails.duration); // "4:13"
}
```

Si vous voulez l'ancien objet, lisez vous-même la playlist des envois. Le `snippet` de son premier élément est ce que la 1.x renvoyait dans `data` :

```ts
const item = await yt.channels.uploads(channelId, { part: "snippet" }).first();

if (item) {
  item.snippet.title;
  item.snippet.resourceId.videoId;
  item.snippet.position;
}
```

Cela fait 1 unité au lieu de 2, sans durée ni statistiques.

## Gestion des erreurs

La 1.x renvoyait un objet de résultat quoi qu'il arrive. Vous vérifiiez `ok`, puis lisiez `status` et `statusText`. La 2.x renvoie les données et lève une erreur quand l'appel échoue.

```js
// 1.x
const result = await youtube.getChannelById(id);
if (!result.ok) {
  console.error(result.status, result.statusText);
  return;
}
use(result.data);
```

```ts
// 2.x
try {
  const channel = await yt.channels.get(channelId);
  if (channel) console.log(channel.snippet.title);
} catch (error) {
  if (error instanceof YouTubeApiError) {
    console.error(error.status, error.reason, error.message);
  } else {
    throw error;
  }
}
```

Trois points à retenir :

- Une chaîne qui n'existe pas n'est pas une erreur de l'API. `yt.channels.get` renvoie `null`. `yt.channels.latestVideo` renvoie `null` pour une chaîne sans envoi, et lève une `YouTubeArgumentError` quand la chaîne elle-même est introuvable.
- `error.status` est le statut HTTP. `error.code` et `error.reason` sont plus pratiques pour brancher votre logique : `isYouTubeError(error, "QUOTA_EXCEEDED")`, `error.reason === "keyInvalid"`.
- Ces appels sont des lectures. Pour une lecture, les limites de débit, les erreurs serveur et les pannes réseau font l'objet de nouvelles tentatives avant qu'une erreur soit levée.

[Erreurs](/basics/errors/) liste les classes et les codes.

## Prérequis

- Node.js 20 ou plus récent. La bibliothèque repose sur le `fetch` global et n'a aucune dépendance.
- Le paquet fournit des builds ES module et CommonJS, chacun avec ses déclarations de types.
- La licence est MIT. Elle était ISC.

## Référence

| 1.x | 2.x | Quota |
| --- | --- | --- |
| `new YoutubeAPI({ apiKey })` | `new YouTube({ apiKey })` | |
| `getChannelByUsername(username)` | `yt.channels.get(username)` | 1 unité, 2 quand un nom seul est un ancien nom d'utilisateur |
| `getChannelById(id)` | `yt.channels.get(id)` | 1 unité |
| `getLastVideoByUsername(username)` | `yt.channels.latestVideo(username)` | 2 unités, plus la résolution du nom la première fois |
| `getLastVideoByChannelId(id)` | `yt.channels.latestVideo(id)` | 2 unités |
| `result.ok === false` | Une erreur levée : une `YouTubeApiError` quand l'API a répondu par un statut d'erreur | |
| `result.status`, `result.statusText` | `error.status`, `error.message` | |
| `result.data` | La valeur résolue | |

## Voir aussi

- [Démarrage rapide](/start/quick-start/) : les premiers appels de la version 2.
- [Chaînes](/resources/channels/) : tous les raccourcis sur les chaînes.
- [Erreurs](/basics/errors/) : ce qui est levé et ce qui fait l'objet d'une nouvelle tentative.
- [Quota](/basics/quota/) : ce que coûtent les appels.
