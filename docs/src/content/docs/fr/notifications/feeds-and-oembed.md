---
title: Flux et oEmbed
description: Deux points d'accès publics de YouTube qui n'ont besoin d'aucune clé d'API et ne coûtent aucun quota. Le flux liste les 15 dernières vidéos d'une chaîne ou d'une playlist. oEmbed décrit une vidéo à partir de son URL.
sidebar:
  order: 3
---

```ts
import { fetchFeed, oEmbed } from "@ix-xs/youtube.api";

const feed = await fetchFeed("UC_x5XG1OV2P6uZZ5FSM9Ttw");
console.log(feed.title, feed.entries[0]?.title);

const info = await oEmbed("https://youtu.be/dQw4w9WgXcQ");
console.log(info?.title, info?.authorName);
```

Ce sont de simples fonctions : pas de client, pas de clé, pas de quota. Aucune des deux ne fait partie de l'API YouTube Data, et YouTube ne garantit pas le flux. Utilisez-les là où une réponse manquante est acceptable, et l'API là où elle ne l'est pas.

## Lire un flux

`fetchFeed(id)` prend un identifiant de chaîne (`UC...`) ou de playlist et renvoie les 15 vidéos les plus récentes, la plus récente d'abord.

```ts
const feed = await fetchFeed("UC_x5XG1OV2P6uZZ5FSM9Ttw");

for (const entry of feed.entries) {
  console.log(entry.publishedAt, entry.title, entry.url);
  console.log(entry.isShort ? "Short" : "Video", entry.views);
  console.log(entry.thumbnail?.url);
}
```

Un flux demande un identifiant. Un handle ou une URL lève une `YouTubeArgumentError`. Résolvez-le d'abord avec `yt.channels.resolveId()`, qui coûte 1 unité la première fois pour un handle :

```ts
const id = await yt.channels.resolveId("@GoogleDevelopers");
const feed = id ? await fetchFeed(id) : undefined;
```

Il y a toujours 15 entrées au plus, et aucun moyen de remonter plus loin. Pour une chaîne entière, lisez sa playlist des envois par l'API : voir [Chaînes](/resources/channels/).

`views` et `likes` sont les compteurs au moment où le flux a été généré. Les flux ont quelques minutes de retard sur l'API.

## Seulement les Shorts, ou seulement les vidéos longues

Chaque chaîne a des playlists que YouTube génère : une avec ses seuls Shorts, une avec ses seules vidéos classiques, et d'autres. `channelPlaylistId()` en déduit les identifiants sans aucun appel, et `fetchFeed` les accepte comme n'importe quel identifiant de playlist.

```ts
const shorts = await fetchFeed(channelPlaylistId(channelId, "shorts"));
const longVideos = await fetchFeed(channelPlaylistId(channelId, "videos"));
const liveStreams = await fetchFeed(channelPlaylistId(channelId, "live"));
```

[ID et URL](/basics/ids-and-urls/) liste les types. Seul `uploads` est documenté par YouTube.

## Quand un flux échoue

Un échec lève une `YouTubeRequestError`. Testez `error.code` :

| Code | Signification |
| --- | --- |
| `FEED_UNAVAILABLE` | YouTube a répondu par un statut d'erreur, ou n'a pas pu être joint |
| `TIMEOUT` | Pas de réponse dans le délai `timeout`, 15 secondes par défaut |
| `ABORTED` | Votre `signal` a été annulé |

`FEED_UNAVAILABLE` ne veut pas dire que la chaîne a disparu. Le service des flux a des pannes pendant lesquelles tous les flux répondent 404 pendant des heures : un 404 signifie donc l'une de deux choses, soit l'identifiant est faux, soit le service est en panne. Le flux ne peut pas vous dire laquelle.

```ts
try {
  const feed = await fetchFeed(channelId, { timeout: "10s" });
  console.log(feed.entries.length);
} catch (error) {
  if (!isYouTubeError(error, "FEED_UNAVAILABLE")) throw error;
  // Demandez plutôt à l'API : 1 unité, et une vraie réponse.
  const uploads = await yt.channels.uploads(channelId).take(15);
  console.log(uploads.length);
}
```

`yt.watch()` fait ce repli à votre place : voir [Surveiller les nouvelles vidéos](/notifications/watching-uploads/).

## Analyser un flux récupéré vous-même

`feedUrl(id)` donne l'adresse, et `parseFeed(xml)` transforme le document en le même objet `Feed`. Utilisez-les quand la requête doit passer par votre propre client HTTP ou votre propre cache.

```ts
const url = feedUrl("UC_x5XG1OV2P6uZZ5FSM9Ttw");
// "https://www.youtube.com/feeds/videos.xml?channel_id=UC_x5XG1OV2P6uZZ5FSM9Ttw"

const response = await fetch(url);
const feed = parseFeed(await response.text());
```

`feedUrl` lève une `YouTubeArgumentError` pour tout ce qui n'est pas un identifiant de chaîne ou de playlist. `parseFeed` en lève une quand le document n'est pas un flux Atom.

## Décrire une vidéo avec oEmbed

`oEmbed(url)` renvoie le titre, l'auteur, la miniature et le code d'intégration prêt à l'emploi pour l'URL d'une vidéo ou d'une playlist. Un simple identifiant de vidéo fonctionne aussi.

```ts
const info = await oEmbed("https://www.youtube.com/watch?v=dQw4w9WgXcQ", {
  maxWidth: 640,
  maxHeight: 360,
});

if (info) {
  console.log(info.title, "by", info.authorName, info.authorUrl);
  console.log(info.thumbnailUrl, info.thumbnailWidth, info.thumbnailHeight);
  console.log(info.html); // une <iframe>, de taille info.width sur info.height
}
```

`maxWidth` et `maxHeight` bornent la taille du lecteur dans `html`.

Cela suffit pour un aperçu de lien. Il n'y a ni durée, ni statistiques, ni description : il faut pour cela `yt.videos.get()`, 1 unité.

## Vérifier gratuitement qu'une vidéo existe

`oEmbed` renvoie `null` quand la vidéo n'existe pas, est privée ou ne peut pas être intégrée. C'est donc une vérification d'existence qui ne coûte rien :

```ts
async function isWatchable(videoId: string): Promise<boolean> {
  return (await oEmbed(videoId)) !== null;
}
```

Lisez le résultat dans le bon sens. Une réponse non nulle signifie que la vidéo existe, n'est pas privée et peut être intégrée. `null` recouvre trois cas, dont l'un est une vidéo qui existe mais dont l'intégration est désactivée. Quand vous devez savoir lequel, interrogez `yt.videos.get()`, 1 unité.

Tout le reste lève une `YouTubeRequestError`. Testez `error.code` :

| Code | Signification |
| --- | --- |
| `TIMEOUT` | Pas de réponse dans le délai `timeout`, 15 secondes par défaut |
| `ABORTED` | Votre `signal` a été annulé |
| `NETWORK` | YouTube n'a pas pu être joint |
| `SERVER_ERROR` | YouTube a répondu par un statut que la fonction n'attend pas : tout sauf un succès, 400, 401, 403 ou 404 |
| `PARSE_ERROR` | YouTube a répondu par un statut de succès et un corps qui n'est pas du JSON |

Les quatre statuts cités sur la ligne `SERVER_ERROR` sont ceux qui donnent `null`.

## Référence

### Fonctions

| Fonction | Renvoie | Ce qu'elle fait |
| --- | --- | --- |
| `fetchFeed(id, options?)` | `Promise<Feed>` | Lit le flux d'un identifiant de chaîne ou de playlist |
| `feedUrl(id)` | `string` | L'URL de ce flux |
| `parseFeed(xml)` | `Feed` | Analyse le XML d'un flux |
| `oEmbed(url, options?)` | `Promise<OEmbed \| null>` | Décrit l'URL d'une vidéo ou d'une playlist |
| `channelPlaylistId(channelId, kind?)` | `string` | L'identifiant de l'une des playlists générées automatiquement pour une chaîne |

Options de `fetchFeed` et de `oEmbed` :

| Option | Par défaut | Signification |
| --- | --- | --- |
| `timeout` | `"15s"` | Délai accordé à la requête |
| `signal` | aucun | Annule la requête |
| `fetch` | Le `fetch` global | `fetch` personnalisé |
| `maxWidth`, `maxHeight` | aucun | `oEmbed` seulement : plus grande taille du lecteur, en pixels |

Les deux fonctions respectent `timeout` et `signal` ensemble : la requête se termine quand elle obtient une réponse, quand le délai est écoulé (code `TIMEOUT`) ou quand vous l'annulez (code `ABORTED`).

### `Feed`

| Champ | Type | Remarques |
| --- | --- | --- |
| `title` | `string` | |
| `channelId` | `string \| undefined` | Renseigné pour les flux de chaîne |
| `playlistId` | `string \| undefined` | Renseigné pour les flux de playlist |
| `url` | `string \| undefined` | Page de la chaîne ou de la playlist |
| `author` | `{ name, url } \| undefined` | |
| `entries` | `FeedEntry[]` | Les 15 vidéos les plus récentes, la plus récente d'abord |

### `FeedEntry`

| Champ | Type | Remarques |
| --- | --- | --- |
| `videoId` | `string` | |
| `channelId` | `string` | |
| `title` | `string` | |
| `url` | `string` | Lien vers la vidéo. Un Short renvoie vers le lecteur Shorts |
| `isShort` | `boolean` | Indique si `url` pointe vers le lecteur Shorts |
| `author` | `{ name, url }` | `url` peut valoir `undefined` |
| `publishedAt` | `string` | Date ISO 8601 de la mise en ligne publique de la vidéo |
| `updatedAt` | `string` | Date ISO 8601 de la dernière modification de l'entrée |
| `description` | `string` | |
| `thumbnail` | `{ url, width, height } \| undefined` | `width` et `height` peuvent valoir `undefined` |
| `views` | `number \| undefined` | Au moment de la génération du flux |
| `likes` | `number \| undefined` | Au moment de la génération du flux |

### `OEmbed`

| Champ | Type | Remarques |
| --- | --- | --- |
| `title` | `string` | |
| `authorName` | `string` | |
| `authorUrl` | `string` | Page de la chaîne |
| `type` | `"video" \| "rich"` | |
| `html` | `string` | Code `<iframe>` prêt à l'emploi |
| `width`, `height` | `number` | Taille du lecteur dans `html` |
| `thumbnailUrl` | `string` | |
| `thumbnailWidth`, `thumbnailHeight` | `number` | |

## Voir aussi

- [Surveiller les nouvelles vidéos](/notifications/watching-uploads/), qui s'appuie sur le flux et se rabat sur l'API.
- [Notifications push](/notifications/push-notifications/) pour être appelé au lieu de demander.
- [ID et URL](/basics/ids-and-urls/) pour `channelPlaylistId`, `urls.embed` et les autres raccourcis.
- [Chaînes](/resources/channels/) pour la façon fiable de lister les envois.
