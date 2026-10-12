---
title: Playlists
description: Lisez une playlist et parcourez ses vidéos quelle que soit sa longueur, créez des playlists, puis ajoutez, déplacez ou retirez leurs éléments.
sidebar:
  order: 3
---

```ts
for await (const item of yt.playlists.items("PLBCF2DAC6FFB574DE")) {
  const { position, title } = item.snippet;
  console.log(position, title, item.contentDetails.videoId);
}
```

## Récupérer une playlist

`yt.playlists.get` accepte un identifiant de playlist, ou n'importe quelle URL qui contient un paramètre `list` : une page de playlist, ou une page de lecture qui joue une vidéo de la playlist. Elle coûte 1 unité de quota et renvoie `null` quand la playlist n'existe pas ou est privée.

```ts
const playlist = await yt.playlists.get(
  "https://www.youtube.com/playlist?list=PLBCF2DAC6FFB574DE",
);

if (playlist) {
  const { title, channelTitle } = playlist.snippet;

  console.log(title, "by", channelTitle);
  console.log(playlist.contentDetails.itemCount, "videos");
  console.log(playlist.status.privacyStatus);
}
```

Les parties par défaut sont `snippet`, `contentDetails` et `status`. Une chaîne de caractères qui n'est ni une telle URL ni de la forme d'un identifiant de playlist (`PL...`, `UU...` et leurs semblables) lève une `YouTubeArgumentError` avant tout envoi.

## Lister les éléments d'une playlist

`yt.playlists.items` liste le contenu d'une playlist, dans l'ordre de la playlist. Elle coûte 1 unité par page de 50. Attendue avec `await`, elle renvoie une page de 50.

```ts
const firstHundred = await yt.playlists.items(playlistId).take(100); // 2 unités

for (const item of firstHundred) {
  console.log(item.snippet.position, item.snippet.title);
  console.log(item.contentDetails.videoId, item.snippet.videoOwnerChannelTitle);
}
```

Un élément de playlist n'est pas une vidéo. C'est une entrée légère qui pointe vers une vidéo :

| Champ | Ce que c'est |
| --- | --- |
| `item.id` | L'identifiant de l'élément lui-même. C'est celui que prennent la mise à jour et la suppression |
| `item.contentDetails.videoId` | L'identifiant de la vidéo |
| `item.snippet.position` | Position dans la playlist, à partir de 0 |
| `item.snippet.title`, `description`, `thumbnails` | Titre, description et miniatures de l'entrée |
| `item.snippet.publishedAt` | Date d'ajout de l'élément à la playlist |
| `item.contentDetails.videoPublishedAt` | Date de publication de la vidéo. Facultatif |
| `item.snippet.videoOwnerChannelId`, `videoOwnerChannelTitle` | La chaîne de la vidéo. Facultatif |
| `item.snippet.channelId`, `channelTitle` | La chaîne qui a ajouté l'élément |
| `item.contentDetails.note` | Une note écrite par le propriétaire de la playlist. Facultatif |

Il n'y a ni durée ni nombre de vues. Pour les obtenir, utilisez [`yt.playlists.videos`](#walking-the-videos-of-a-playlist).

Une vidéo supprimée ou privée garde son élément dans la liste. L'élément a pour titre « Deleted video » ou « Private video » et n'a pas de miniatures : [`bestThumbnail`](/basics/ids-and-urls/#formatting) renvoie donc `undefined` pour lui.

`get` renvoie `null` pour une playlist qui n'existe pas. Lister les éléments d'une telle playlist échoue en revanche, avec une erreur `NOT_FOUND`.

## Parcourir les vidéos d'une playlist

`yt.playlists.videos` produit des ressources vidéo complètes, dans l'ordre de la playlist. Pour chaque page de 50 éléments, elle fait un appel de plus pour récupérer les vidéos, donc elle coûte 2 unités pour 50 vidéos.

```ts
for await (const video of yt.playlists.videos(playlistId)) {
  const duration = formatDuration(video.contentDetails.duration);
  console.log(video.snippet.title, duration, video.statistics.viewCount);
}
```

Les vidéos supprimées et privées sont ignorées. Une vidéo présente deux fois dans la playlist est produite deux fois. `part` choisit les parties des vidéos, `snippet`, `contentDetails` et `statistics` par défaut. `limit` arrête le parcours plus tôt :

```ts
const firstTen = [];

for await (const video of yt.playlists.videos(playlistId, {
  part: "snippet",
  limit: 10,
})) {
  firstTen.push(video.snippet.title);
}
```

`limit` compte les vidéos que vous recevez. Une vidéo supprimée ou privée ne l'entame pas : le parcours continue jusqu'à ce que la limite soit atteinte ou que la playlist se termine.

Contrairement à `items`, c'est un simple générateur asynchrone : il n'a ni `take` ni `all`. Utilisez `for await` et `limit`.

## Calculer la durée d'une playlist

La durée totale d'une playlist demande la durée de chaque vidéo, que seule la ressource vidéo possède. Demandez `contentDetails` seule pour garder des réponses légères :

```ts
const walk = yt.playlists.videos(playlistId, { part: "contentDetails" });
let seconds = 0;
let count = 0;

for await (const video of walk) {
  seconds += parseDuration(video.contentDetails.duration);
  count++;
}

console.log(count, "videos,", formatDuration(seconds, "short"));
// par exemple : 212 videos, 31h 4m 12s
```

Une playlist de 500 vidéos coûte ainsi 20 unités : 10 pages d'éléments et 10 appels pour les vidéos. La recette [Durée totale d'une playlist](/recipes/playlist-length/) en fait un script complet.

## Créer une playlist

`yt.playlists.create` crée une playlist sur la chaîne de l'utilisateur authentifié. Elle exige OAuth et coûte 50 unités.

```ts
const playlist = await yt.playlists.create({
  title: "Favourites",
  description: "Things worth watching twice",
  privacy: "unlisted",
});

console.log(playlist.id, playlist.status.privacyStatus);
```

| Champ | Par défaut | Signification |
| --- | --- | --- |
| `title` | Obligatoire | Titre de la playlist |
| `description` | Aucune | Description |
| `privacy` | `"private"` | `"public"`, `"unlisted"` ou `"private"` |
| `defaultLanguage` | Aucune | Langue du titre et de la description, par exemple `"en"` |

## Ajouter et retirer des vidéos

`yt.playlists.add` ajoute une vidéo à la fin d'une playlist, ou à `position`. Elle exige OAuth et coûte 50 unités. Les deux arguments acceptent un identifiant ou une URL.

```ts
await yt.playlists.add(playlistId, "https://youtu.be/dQw4w9WgXcQ");

const item = await yt.playlists.add(playlistId, videoId, {
  position: 0,
  note: "Start here",
});

console.log(item.id); // l'identifiant de l'élément de playlist
```

`yt.playlists.removeVideo` retire toutes les occurrences d'une vidéo d'une playlist et renvoie le nombre d'éléments retirés. Elle exige OAuth. Elle coûte 1 unité pour trouver les éléments, puis 50 par élément retiré.

```ts
const removed = await yt.playlists.removeVideo(playlistId, videoId);
console.log(removed); // 0 quand la vidéo n'était pas dans la playlist
```

## Manipuler directement les éléments de playlist

`removeVideo` existe parce que les méthodes brutes n'acceptent pas d'identifiant de vidéo. `playlistItems.update` et `playlistItems.delete` prennent l'identifiant de l'élément de playlist, qui est une autre chaîne. Vous l'obtenez dans une liste, ou dans le résultat d'une insertion.

```ts
const item = await yt.playlistItems.insert({
  body: {
    snippet: { playlistId, resourceId: { kind: "youtube#video", videoId } },
  },
});

await yt.playlistItems.delete({ id: item.id }); // pas videoId
```

Pour déplacer un élément, modifiez son `snippet.position`. Le snippet doit aussi contenir `playlistId` et `resourceId`, puisqu'une partie que vous envoyez remplace toute la partie :

```ts
const item = await yt.playlistItems
  .list({ part: "snippet", playlistId, videoId })
  .first();

if (item) {
  await yt.playlistItems.update({
    body: {
      id: item.id,
      snippet: { playlistId, position: 0, resourceId: item.snippet.resourceId },
    },
  });
}
```

`playlistItems.list` accepte `playlistId`, éventuellement restreint par `videoId` comme ci-dessus, ou une liste d'identifiants d'éléments dans `id`. Elle coûte 1 unité par page de 50. Attendue sans `maxResults`, elle renvoie la page par défaut de l'API, soit 5 éléments, là où `yt.playlists.items` en demande 50. Les trois écritures coûtent 50 unités chacune et exigent OAuth.

## Utiliser les méthodes brutes de `playlists`

`yt.playlists.list` récupère des playlists par `id`, les playlists d'une chaîne avec `channelId`, ou les vôtres avec `mine: true`. Elle coûte 1 unité par page de 50.

```ts
const playlists = await yt.playlists
  .list({ part: ["snippet", "contentDetails"], channelId })
  .all();

for (const playlist of playlists) {
  console.log(playlist.snippet.title, playlist.contentDetails.itemCount);
}
```

`insert`, `update` et `delete` exigent OAuth et coûtent 50 unités chacune. Une mise à jour remplace les parties qu'elle envoie, et un `snippet` doit contenir `title`. Lisez la partie, modifiez-la, renvoyez-la :

```ts
const playlist = await yt.playlists.get(playlistId, {
  part: ["snippet", "status"],
});

if (playlist) {
  await yt.playlists.update({
    body: {
      id: playlist.id,
      snippet: { ...playlist.snippet, description: "Updated every Friday" },
      status: { ...playlist.status, privacyStatus: "public" },
    },
  });
}
```

```ts
await yt.playlists.delete({ id: playlistId });
```

## Lire les playlists spéciales d'une chaîne

Chaque chaîne a des playlists que YouTube construit pour elle : ses envois, ses Shorts, ses directs et quelques autres. `channelPlaylistId` en déduit les identifiants à partir de celui de la chaîne, sans appel. En lire une coûte 1 unité par tranche de 50 vidéos, comme n'importe quelle playlist.

```ts
import { channelPlaylistId } from "@ix-xs/youtube.api";

channelPlaylistId("UC_x5XG1OV2P6uZZ5FSM9Ttw"); // "UU_x5XG1OV2P6uZZ5FSM9Ttw"

const popularId = channelPlaylistId(channelId, "popularVideos");
const popular = await yt.playlists.items(popularId).take(10);
```

[ID et URL](/basics/ids-and-urls/) liste les huit types et précise lequel YouTube documente.

La fonction veut un identifiant `UC...` et lève une `YouTubeArgumentError` pour tout le reste. Avec un handle ou une URL, utilisez [`yt.channels.uploads`](/resources/channels/), qui résout d'abord la chaîne.

## Définir l'image d'une playlist

Une playlist peut avoir une miniature personnalisée, gérée par `yt.playlistImages`. La lecture coûte 1 unité et fonctionne avec une clé d'API. `insert`, `update` et `delete` exigent OAuth et coûtent 50 unités chacune. L'image est un JPEG ou un PNG de 50 Mo au plus.

```ts
const { items } = await yt.playlistImages.list({
  part: "snippet",
  parent: playlistId,
});

const created = await yt.playlistImages.insert({
  body: { snippet: { playlistId, type: "hero", width: 1080, height: 1080 } },
  media: image,
});

await yt.playlistImages.update({
  body: { id: created.id, snippet: { playlistId, type: "hero" } },
  media: image,
});

await yt.playlistImages.delete({ id: created.id });
```

`media` accepte un `Blob`, des octets, un flux ou un fichier sur disque. La page [Envois](/resources/uploads/) décrit chaque forme.

## Gérer les erreurs

Un appel que l'API refuse lève une `YouTubeApiError` dont `reason` indique la cause. Celles qui sont typées pour les playlists :

| `error.reason` | Quand |
| --- | --- |
| `playlistNotFound` | La playlist est introuvable |
| `playlistItemNotFound` | Aucun élément n'a cet identifiant d'élément de playlist |
| `videoNotFound` | La vidéo est introuvable |
| `videoAlreadyInPlaylist` | La vidéo est déjà dans la playlist |
| `playlistContainsMaximumNumberOfVideos` | La playlist est pleine |
| `playlistForbidden` | La requête n'est pas autorisée sur cette playlist |

```ts
try {
  await yt.playlists.add(playlistId, videoId);
} catch (error) {
  if (
    error instanceof YouTubeApiError &&
    error.reason === "playlistContainsMaximumNumberOfVideos"
  ) {
    console.log("The playlist is full");
  } else {
    throw error;
  }
}
```

## Référence

Raccourcis :

| Raccourci | Ce qu'il fait | Quota |
| --- | --- | --- |
| `yt.playlists.get(playlist, { part })` | Une playlist à partir d'un identifiant ou d'une URL. `null` si elle est absente ou privée | 1 |
| `yt.playlists.items(playlist, { part })` | Les éléments d'une playlist : position, titre, identifiant de la vidéo | 1 par page de 50 |
| `yt.playlists.videos(playlist, { part, limit })` | Les vidéos d'une playlist sous forme de ressources complètes, les indisponibles étant ignorées | 2 par tranche de 50 |
| `yt.playlists.create({ title, description, privacy, defaultLanguage })` | Crée une playlist. OAuth | 50 |
| `yt.playlists.add(playlist, video, { position, note })` | Ajoute une vidéo. OAuth | 50 |
| `yt.playlists.removeVideo(playlist, video)` | Retire toutes les occurrences d'une vidéo et renvoie leur nombre. OAuth | 1, plus 50 par élément retiré |
| `channelPlaylistId(channelId, kind)` | L'identifiant de l'une des playlists spéciales d'une chaîne | 0 |

Méthodes brutes :

| Méthode | Quota | Authentification |
| --- | --- | --- |
| `yt.playlists.list` | 1 | Clé. OAuth pour `mine` |
| `yt.playlists.insert` | 50 | OAuth |
| `yt.playlists.update` | 50 | OAuth |
| `yt.playlists.delete` | 50 | OAuth |
| `yt.playlistItems.list` | 1 | Clé, ou OAuth pour voir les données privées |
| `yt.playlistItems.insert` | 50 | OAuth |
| `yt.playlistItems.update` | 50 | OAuth |
| `yt.playlistItems.delete` | 50 | OAuth |
| `yt.playlistImages.list` | 1 | Clé, ou OAuth pour voir les données privées |
| `yt.playlistImages.insert` | 50 | OAuth |
| `yt.playlistImages.update` | 50 | OAuth |
| `yt.playlistImages.delete` | 50 | OAuth |

Toute écriture accepte les scopes `youtube`, `youtube.force-ssl` et `youtubepartner`. La page [Scopes](/auth/scopes/) liste ce que chacun autorise.

Parties d'une playlist :

| Partie | Ce qu'elle contient | Toujours renvoyée quand elle est demandée |
| --- | --- | --- |
| `snippet` | Titre, description, chaîne, date de création, miniatures | Oui |
| `contentDetails` | `itemCount`, le nombre d'éléments | Oui |
| `status` | Statut de confidentialité, statut de podcast | Oui |
| `player` | Le HTML `<iframe>` d'un lecteur intégré | Oui |
| `localizations` | Titre et description par langue | Non |
| `id` | Rien de plus : `kind`, `etag` et `id` sont présents sur chaque résultat | Oui |

Parties d'un élément de playlist :

| Partie | Ce qu'elle contient | Toujours renvoyée quand elle est demandée |
| --- | --- | --- |
| `snippet` | Position, titre, description, miniatures, `resourceId`, les chaînes concernées | Oui |
| `contentDetails` | `videoId`, `videoPublishedAt`, `note` | Oui |
| `status` | Statut de confidentialité de l'élément | Oui |
| `id` | Rien de plus : `kind`, `etag` et `id` sont présents sur chaque résultat | Oui |

## Voir aussi

- [Listes](/basics/lists/) pour `take`, `all`, les pages et l'itération.
- [Chaînes](/resources/channels/) pour `uploads` et `latestVideos`, qui lisent la playlist des envois d'une chaîne.
- [Vidéos](/resources/videos/) pour les ressources vidéo que produit `yt.playlists.videos`.
- [Durée totale d'une playlist](/recipes/playlist-length/) pour l'exemple complet sous forme de script.
