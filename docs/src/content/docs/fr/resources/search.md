---
title: Recherche
description: Recherchez des vidéos, des chaînes, des playlists et des diffusions en direct avec des résultats typés, et sachez quand une méthode moins chère répond à la question.
sidebar:
  order: 4
---

```ts
const results = await yt.search
  .videos("lofi hip hop", { order: "viewCount", videoDuration: "long" })
  .take(10);

for (const result of results) {
  console.log(result.id.videoId, result.snippet.title);
}
```

## Quand ne pas chercher

La recherche a [sa propre enveloppe de quota](/basics/quota/#buckets) : 100 appels par jour par défaut. Chaque page de résultats est un appel. Après cent pages, c'est fini pour la journée.

Avant de chercher, vérifiez donc si une autre méthode répond à la question :

| Vous voulez | Utilisez | Coût |
| --- | --- | --- |
| Ce qu'une chaîne a envoyé | [`yt.channels.uploads`](/resources/channels/) ou `latestVideos` | 1 ou 2 unités par tranche de 50 vidéos |
| Les vidéos d'une playlist | [`yt.playlists.items`](/resources/playlists/) ou `videos` | 1 ou 2 unités par tranche de 50 vidéos |
| Une vidéo à partir de son identifiant ou de son URL | [`yt.videos.get`](/resources/videos/) | 1 unité |
| Une chaîne à partir de son handle ou de son URL | [`yt.channels.get`](/resources/channels/) | 1 ou 2 unités |
| Savoir quand une chaîne publie | [`yt.watch`](/notifications/watching-uploads/) | Aucun avec le flux public |

La recherche sert à ce que seule la recherche sait faire : trouver des choses à partir de mots.

## Rechercher des vidéos, des chaînes et des playlists

Il y a un raccourci par type de résultat. Chacun prend la requête, puis les filtres, et renvoie une liste que vous pouvez attendre avec `await`, parcourir ou borner avec `take`.

```ts
const videos = await yt.search.videos("typescript tutorial").take(10);
for (const result of videos) {
  console.log(result.id.videoId, result.snippet.title);
}

const [channel] = await yt.search.channels("Google for Developers").take(1);
if (channel) console.log(channel.id.channelId, channel.snippet.title);

const playlists = await yt.search.playlists("typescript course").take(5);
for (const result of playlists) {
  console.log(result.id.playlistId, result.snippet.title);
}
```

Les résultats sont typés par le raccourci. `result.id.videoId` est une `string` sur les résultats de `videos`, `result.id.channelId` sur ceux de `channels`, `result.id.playlistId` sur ceux de `playlists`. Aucune vérification n'est nécessaire avant de les utiliser.

Chaque page récupérée coûte 1 appel de l'enveloppe `search.list`. `take(10)` demande une page de 10 : c'est donc un seul appel. `take(120)` fait trois appels de 50.

Une requête vide n'envoie aucun terme de recherche : `yt.search.videos("", { channelId })` liste à partir des seuls filtres.

## Trouver des diffusions en direct

`yt.search.live` recherche les diffusions qui sont en direct à l'instant, pour une requête, éventuellement dans une chaîne. Ses résultats sont des résultats de vidéo.

```ts
const live = await yt.search.live("speedrun").take(5);

for (const result of live) {
  const { title, channelTitle } = result.snippet;
  console.log(result.id.videoId, title, channelTitle);
}

const onOneChannel = await yt.search.live("speedrun", { channelId }).take(5);
```

Pour les diffusions à venir ou terminées, utilisez `yt.search.videos` avec `eventType: "upcoming"` ou `"completed"`.

## Filtrer les résultats

Le second argument accepte tous les filtres de l'API. Les types vérifient les valeurs.

```ts
const lastWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

const recent = await yt.search
  .videos("typescript", {
    order: "date",
    publishedAfter: lastWeek,
    regionCode: "FR",
    relevanceLanguage: "fr",
    videoDefinition: "high",
    safeSearch: "strict",
  })
  .take(25);
```

`publishedAfter` et `publishedBefore` acceptent un `Date` ou une chaîne ISO 8601.

| Filtre | Valeurs | Effet |
| --- | --- | --- |
| `order` | `"relevance"` (par défaut), `"date"`, `"viewCount"`, `"rating"`, `"title"`, `"videoCount"` | Ordre de tri. `"date"` met les plus récents en premier. `"videoCount"` trie les chaînes par nombre de vidéos envoyées |
| `publishedAfter`, `publishedBefore` | `Date` ou chaîne | Uniquement les ressources publiées après ou avant cette date |
| `channelId` | Identifiant de chaîne | Uniquement les ressources de cette chaîne |
| `regionCode` | Code de pays | Résultats tels que les voient les spectateurs de ce pays |
| `relevanceLanguage` | Code de langue | Résultats pertinents pour cette langue |
| `safeSearch` | `"moderate"` (par défaut), `"none"`, `"strict"` | Niveau de filtrage du contenu restreint |
| `eventType` | `"live"`, `"upcoming"`, `"completed"`, `"none"` | Statut de direct des vidéos |
| `videoDuration` | `"any"` (par défaut), `"short"`, `"medium"`, `"long"` | Moins de 4 minutes, de 4 à 20 minutes, plus de 20 minutes |
| `videoDefinition` | `"any"`, `"standard"`, `"high"` | Uniquement SD ou uniquement HD |
| `videoDimension` | `"any"` (par défaut), `"2d"`, `"3d"` | Sans les vidéos 3D, ou uniquement elles |
| `videoCaption` | `"any"`, `"closedCaption"`, `"none"` | Avec ou sans sous-titres |
| `videoLicense` | `"any"`, `"youtube"`, `"creativeCommon"` | Licence standard ou Creative Commons |
| `videoEmbeddable` | `"any"`, `"true"` | Uniquement les vidéos qui peuvent être intégrées |
| `videoSyndicated` | `"any"`, `"true"` | Uniquement les vidéos syndiquées |
| `videoPaidProductPlacement` | `"any"`, `"true"` | Uniquement les vidéos avec placement de produit payant |
| `videoType` | `"any"`, `"movie"`, `"episode"` | Uniquement les films ou les épisodes d'émissions |
| `videoCategoryId` | Identifiant de catégorie | Uniquement les vidéos de cette catégorie. `VideoCategories` contient les identifiants |
| `channelType` | `"any"`, `"show"` | Uniquement les émissions, dans une recherche de chaînes |
| `topicId` | Identifiant de sujet | Uniquement les résultats sur ce sujet |
| `location`, `locationRadius` | Chaînes | Uniquement les vidéos situées à une certaine distance d'un point |
| `forMine`, `forDeveloper`, `forContentOwner` | `true` | Se limite aux vidéos de l'utilisateur authentifié, à celles envoyées par votre projet, ou à celles d'un propriétaire de contenu. OAuth |
| `maxResults` | 0 à 50 | Taille d'une page. Omis, les raccourcis en demandent 50 |

`location` et `locationRadius` vont ensemble. `location` vaut `"latitude,longitude"`, et `locationRadius` est une distance comme `"10km"` :

```ts
const nearby = await yt.search
  .videos("street food", { location: "48.8566,2.3522", locationRadius: "10km" })
  .take(10);
```

`yt.search.live` accepte les mêmes filtres, sauf `eventType`, qu'elle fixe elle-même.

## Obtenir les durées et les statistiques

Un résultat de recherche n'est pas une vidéo. Il contient un identifiant et un snippet : `title`, `description`, `channelId`, `channelTitle`, `publishedAt`, `thumbnails` et `liveBroadcastContent`. Il n'y a ni durée, ni nombre de vues, ni tags.

Passez les identifiants à `yt.videos.getMany` pour le reste. Cela coûte 1 unité du budget commun par tranche de 50 vidéos :

```ts
const results = await yt.search
  .videos("lofi hip hop", { order: "viewCount" })
  .take(25);

const videoIds = results.map((result) => result.id.videoId);
const found = await yt.videos.getMany(videoIds);

for (const video of found) {
  const duration = formatDuration(video.contentDetails.duration);
  const views = formatCount(video.statistics.viewCount);

  console.log(video.snippet.title, duration, views);
}
```

`getMany` garde l'ordre de la recherche. Pour des résultats de chaînes, passez de la même façon les identifiants à `yt.channels.list`.

## Compter les résultats

Attendre une recherche avec `await` donne une page, avec la taille de l'ensemble des résultats telle que l'API la rapporte :

```ts
const page = await yt.search.videos("lofi hip hop");

console.log(page.items.length); // jusqu'à 50
console.log(page.totalResults); // une estimation
console.log(page.nextPageToken);
```

Trois choses à savoir sur ces nombres :

- Un raccourci attendu avec `await` demande la plus grande page, 50, sauf si vous passez `maxResults`. La méthode brute `search.list` garde la valeur par défaut de l'API, qui est 5.
- `totalResults` est une estimation, plafonnée à 1 000 000. Ne l'affichez pas comme un nombre exact.
- Une requête ne renvoie jamais plus d'environ 500 résultats, quoi qu'indique `totalResults`. Parcourir une recherche jusqu'au bout coûte donc environ 10 appels, un dixième de l'allocation quotidienne.

Bornez toujours une recherche :

```ts
// Un appel.
const top = await yt.search.videos("lofi hip hop").take(50);

// Jusqu'à dix appels. Seulement si vous avez besoin de tout.
const everything = await yt.search.videos("lofi hip hop").all();
```

## Utiliser `search.list` brut

Les raccourcis appellent `yt.search.list` avec `part: "snippet"` et un seul `type`. Appelez-la vous-même pour mélanger les types :

```ts
const { items } = await yt.search.list({
  part: "snippet",
  q: "typescript",
  type: ["video", "playlist"],
  maxResults: 25,
});

for (const result of items) {
  const { videoId, playlistId } = result.id;

  if (videoId) {
    console.log("video", videoId, result.snippet.title);
  } else if (playlistId) {
    console.log("playlist", playlistId, result.snippet.title);
  }
}
```

Ici, les trois identifiants sont facultatifs dans le type, puisqu'un résultat peut être de n'importe lequel des types demandés. `result.id.kind` indique lequel : `"youtube#video"`, `"youtube#channel"` ou `"youtube#playlist"`. Omettez `type` pour obtenir les trois.

`q` est facultatif. Ce code liste les vidéos les plus récentes d'une chaîne, au prix d'un appel de recherche. `yt.channels.uploads` fait la même chose pour 1 unité :

```ts
const newest = await yt.search
  .list({ part: "snippet", channelId, type: "video", order: "date" })
  .take(10);
```

## Référence

Raccourcis :

| Raccourci | Ce qu'il fait | Quota |
| --- | --- | --- |
| `yt.search.videos(query, filters)` | Recherche des vidéos. `result.id.videoId` est renseigné | 1 appel de recherche par page de 50 |
| `yt.search.channels(query, filters)` | Recherche des chaînes. `result.id.channelId` est renseigné | 1 appel de recherche par page de 50 |
| `yt.search.playlists(query, filters)` | Recherche des playlists. `result.id.playlistId` est renseigné | 1 appel de recherche par page de 50 |
| `yt.search.live(query, filters)` | Recherche les diffusions en direct à l'instant. `result.id.videoId` est renseigné | 1 appel de recherche par page de 50 |

Chaque raccourci accepte en troisième argument les options de requête habituelles.

Méthodes brutes :

| Méthode | Quota | Authentification |
| --- | --- | --- |
| `yt.search.list` | 1 appel de l'enveloppe `search.list`, 100 par jour par défaut | Clé. OAuth pour `forMine`, `forDeveloper` et `forContentOwner` |

Parties d'un résultat de recherche :

| Partie | Ce qu'elle contient | Toujours renvoyée quand elle est demandée |
| --- | --- | --- |
| `snippet` | Titre, description, chaîne, date de publication, miniatures, `liveBroadcastContent` | Oui |
| `id` | Rien de plus : `id` est présent sur chaque résultat. C'est un objet avec `kind` et `videoId`, `channelId` ou `playlistId` | Oui |

Types, pour vos propres fonctions :

| Type | Ce que c'est |
| --- | --- |
| `VideoSearchResult` | Un résultat de `yt.search.videos` ou de `live` |
| `ChannelSearchResult` | Un résultat de `yt.search.channels` |
| `PlaylistSearchResult` | Un résultat de `yt.search.playlists` |
| `SearchFilters` | Le second argument des raccourcis |

## Voir aussi

- [Quota](/basics/quota/) pour les enveloppes et le suivi de ce qui reste.
- [Listes](/basics/lists/) pour `take`, `all` et les pages.
- [Vidéos](/resources/videos/) pour `getMany` et les parties d'une vidéo.
- [Cache](/basics/caching/) pour éviter de payer deux fois la même requête.
