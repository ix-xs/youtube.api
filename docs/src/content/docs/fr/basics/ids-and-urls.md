---
title: "ID, URL et mise en forme"
description: "Des fonctions qui lisent les URL YouTube, vérifient et dérivent des identifiants, construisent des liens, et mettent en forme les durées et les compteurs. Aucune n'appelle l'API, donc aucune ne coûte de quota."
sidebar:
  order: 7
---

```ts
import {
  formatDuration,
  parseUrl,
  urls,
  videoIdFrom,
} from "@ix-xs/youtube.api";

parseUrl("https://youtu.be/dQw4w9WgXcQ?t=42");
// { type: "video", videoId: "dQw4w9WgXcQ", format: "watch", start: 42 }

videoIdFrom("https://www.youtube.com/shorts/dQw4w9WgXcQ"); // "dQw4w9WgXcQ"

urls.video("dQw4w9WgXcQ", { start: 42 });
// "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s"

formatDuration("PT1H2M3S"); // "1:02:03"
```

## Quand en avez-vous besoin

Souvent, vous n'en avez pas besoin. Les raccourcis du client acceptent un identifiant ou une URL et s'en occupent eux-mêmes. Chacun de ces appels coûte 1 unité :

```ts
await yt.videos.get("https://youtu.be/dQw4w9WgXcQ");
await yt.playlists.items(
  "https://www.youtube.com/playlist?list=PLBCF2DAC6FFB574DE",
);
await yt.channels.get("https://www.youtube.com/@GoogleDevelopers");
```

Les fonctions de cette page servent à votre propre code : valider ce qu'un utilisateur a collé, aiguiller un lien vers le bon traitement, stocker un identifiant propre, ou construire un lien à afficher. Ce sont de simples fonctions. Elles marchent sans client et sans identifiants.

## Lire une URL

`parseUrl` dit vers quoi pointe une URL YouTube. Le résultat a un `type` et les champs qui l'accompagnent. Elle renvoie `null` pour tout ce qui n'est pas un lien YouTube.

```ts
function describe(input: string): string {
  const link = parseUrl(input);
  if (!link) return "Not a YouTube link";

  switch (link.type) {
    case "video": {
      const from = link.start ? `, from ${link.start} s` : "";
      return `Video ${link.videoId}${from}`;
    }
    case "playlist":
      return `Playlist ${link.playlistId}`;
    case "channel": {
      const { channelId, handle, username, customUrl } = link;
      return `Channel ${channelId ?? handle ?? username ?? customUrl}`;
    }
  }
}
```

Les formes qu'elle comprend :

| URL | Résultat |
| --- | --- |
| `youtube.com/watch?v=ID` | `{ type: "video", videoId, format: "watch" }` |
| `youtu.be/ID` | `{ type: "video", videoId, format: "watch" }` |
| `youtube.com/shorts/ID` | `{ type: "video", videoId, format: "short" }` |
| `youtube.com/live/ID` | `{ type: "video", videoId, format: "live" }` |
| `youtube.com/embed/ID`, `/v/ID`, `/e/ID` | `{ type: "video", videoId, format: "embed" }` |
| `youtube.com/playlist?list=ID` | `{ type: "playlist", playlistId }` |
| `youtube.com/embed/videoseries?list=ID` | `{ type: "playlist", playlistId }` |
| `youtube.com/channel/UC...` | `{ type: "channel", channelId }` |
| `youtube.com/@handle`, avec ou sans onglet comme `/videos` | `{ type: "channel", handle }`, avec le `@` initial |
| `youtube.com/user/name` | `{ type: "channel", username }` |
| `youtube.com/c/name` | `{ type: "channel", customUrl }` |
| `youtube.com/name` | `{ type: "channel", customUrl }` |

Sur un lien de vidéo, deux paramètres de requête ajoutent un champ :

- `list` donne `playlistId`, la playlist dans laquelle le lien lit la vidéo.
- `t` ou `start` donne `start`, en secondes. `42`, `42s`, `1m30s` et `1h2m3s` sont tous lus.

```ts
parseUrl(
  "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLBCF2DAC6FFB574DE&t=1m30s",
);
// {
//   type: "video",
//   videoId: "dQw4w9WgXcQ",
//   format: "watch",
//   playlistId: "PLBCF2DAC6FFB574DE",
//   start: 90,
// }
```

Les hôtes acceptés sont `youtube.com` et `youtube-nocookie.com`, seuls ou précédés de `www.`, `m.`, `music.` ou `gaming.`, ainsi que `youtu.be`. Le schéma peut être omis : `"youtube.com/@GoogleDevelopers"` fonctionne.

Elle renvoie `null` pour un autre site, pour une page YouTube qui n'est ni une vidéo, ni une playlist, ni une chaîne (`/feed/subscriptions`, `/results`), et pour un lien de vidéo dont l'identifiant ne fait pas 11 caractères. Un identifiant seul n'est pas une URL : `parseUrl("dQw4w9WgXcQ")` vaut `null`. Utilisez `videoIdFrom` pour une saisie qui peut être l'un ou l'autre.

Un `customUrl` est une ancienne adresse `/c/name` ou `/name`. L'API n'a pas de recherche pour elles. `yt.channels.get` essaie le nom comme handle, puis comme nom d'utilisateur, ce qui est souvent juste.

## Extraire un identifiant de n'importe quoi

`videoIdFrom` et `playlistIdFrom` acceptent un identifiant ou une URL et renvoient l'identifiant, ou `null` s'il n'y en a pas. Ce sont elles que les raccourcis appliquent à leurs arguments.

```ts
videoIdFrom("dQw4w9WgXcQ"); // "dQw4w9WgXcQ"
videoIdFrom("https://www.youtube.com/shorts/abcdefghijk"); // "abcdefghijk"
videoIdFrom("https://www.youtube.com/@GoogleDevelopers"); // null

const watch = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

playlistIdFrom("PLBCF2DAC6FFB574DE"); // "PLBCF2DAC6FFB574DE"
playlistIdFrom(`${watch}&list=PLBCF2DAC6FFB574DE`); // "PLBCF2DAC6FFB574DE"
playlistIdFrom(watch); // null
```

Un usage typique consiste à nettoyer un champ de formulaire avant de l'enregistrer :

```ts
function videoIdOrThrow(input: string): string {
  const id = videoIdFrom(input);
  if (!id) throw new Error("Paste a YouTube video link or a video id");
  return id;
}
```

## Références de chaîne

Une chaîne peut être désignée de quatre façons. `parseChannelRef` détermine laquelle correspond à une chaîne de caractères.

```ts
parseChannelRef("UC_x5XG1OV2P6uZZ5FSM9Ttw");
// { by: "id", value: "UC_x5XG1OV2P6uZZ5FSM9Ttw" }

parseChannelRef("@GoogleDevelopers");
// { by: "handle", value: "@GoogleDevelopers" }

parseChannelRef("GoogleDevelopers");
// { by: "handle", value: "@GoogleDevelopers" }

parseChannelRef("https://www.youtube.com/user/GoogleDevelopers");
// { by: "username", value: "GoogleDevelopers" }

parseChannelRef("youtube.com/c/GoogleDevelopers");
// { by: "custom", value: "GoogleDevelopers" }
```

| `by` | Provient de | Recherche |
| --- | --- | --- |
| `"id"` | Un identifiant `UC...`, ou une URL `/channel/UC...` | Rien à résoudre |
| `"handle"` | Un `@handle`, une URL `/@handle`, ou un nom seul | `channels.list` avec `forHandle`, 1 unité. Un nom seul est ensuite essayé comme nom d'utilisateur, 1 unité de plus |
| `"username"` | Une URL `/user/name` | `channels.list` avec `forUsername`, 1 unité |
| `"custom"` | Une URL `/c/name` ou `/name` | Pas de recherche directe. Essayé comme handle, puis comme nom d'utilisateur |

Un nom seul est lu comme un handle, car les handles sont de loin les plus courants aujourd'hui. `parseChannelRef` lève une `YouTubeArgumentError` pour une chaîne vide et pour une URL qui n'est pas celle d'une chaîne.

Elle n'appelle pas l'API. Pour obtenir l'identifiant `UC...` de n'importe quelle référence, passez par le client :

```ts
const id = await yt.channels.resolveId("@GoogleDevelopers");
// "UC_x5XG1OV2P6uZZ5FSM9Ttw"
```

Un identifiant ou une URL `/channel/` ne coûte rien. Un handle ou un nom d'utilisateur coûte 1 unité la première fois, 2 pour un nom seul qui se révèle être un ancien nom d'utilisateur, et le client retient la réponse.

## Vérifier un identifiant

`isVideoId`, `isChannelId` et `isPlaylistId` vérifient la forme d'une chaîne. Ils ne disent pas si la ressource existe.

```ts
isVideoId("dQw4w9WgXcQ"); // true : 11 caractères sûrs pour une URL
isChannelId("UC_x5XG1OV2P6uZZ5FSM9Ttw"); // true : "UC" suivi de 22 caractères
isPlaylistId("PLBCF2DAC6FFB574DE"); // true
isPlaylistId("UU_x5XG1OV2P6uZZ5FSM9Ttw"); // true : une playlist d'envois

isChannelId("@GoogleDevelopers"); // false
isPlaylistId("dQw4w9WgXcQ"); // false
```

Ces vérifications sont volontairement souples. N'importe quels 11 caractères parmi les lettres, les chiffres, `-` et `_` ressemblent à un identifiant de vidéo, `"hello_world"` compris. Pour savoir qu'une vidéo existe, récupérez-la : `yt.videos.get` se résout en `null` si elle n'existe pas.

## Les playlists d'une chaîne

Une chaîne a des playlists que YouTube génère. Leurs identifiants sont l'identifiant de la chaîne avec un autre préfixe : `channelPlaylistId` les dérive sans aucun appel.

```ts
channelPlaylistId("UC_x5XG1OV2P6uZZ5FSM9Ttw");
// "UU_x5XG1OV2P6uZZ5FSM9Ttw"

channelPlaylistId("UC_x5XG1OV2P6uZZ5FSM9Ttw", "shorts");
// "UUSH_x5XG1OV2P6uZZ5FSM9Ttw"
```

| Type | Préfixe | Contenu | Documenté par YouTube |
| --- | --- | --- | --- |
| `"uploads"` (par défaut) | `UU` | Tout ce que la chaîne a mis en ligne | Oui. C'est `contentDetails.relatedPlaylists.uploads` sur la chaîne |
| `"videos"` | `UULF` | Les envois sans les Shorts ni les directs | Non |
| `"shorts"` | `UUSH` | Uniquement les Shorts | Non |
| `"live"` | `UULV` | Uniquement les directs | Non |
| `"popularVideos"` | `UULP` | Les vidéos classiques, triées par vues | Non |
| `"popularShorts"` | `UUPS` | Les Shorts, triés par vues | Non |
| `"popularLive"` | `UUPV` | Les directs, triés par vues | Non |
| `"membersOnlyVideos"` | `UUMO` | Les vidéos réservées aux membres | Non |

:::caution
Seul `uploads` fait partie de l'API documentée. Les autres préfixes ne sont pas documentés par YouTube. Ils sont stables depuis des années, mais rien ne le garantit. Si votre code en dépend, prévoyez le cas où il cesse de fonctionner.
:::

Lire l'une de ces playlists est un `playlistItems.list` : 1 unité pour 50 vidéos. Une recherche pour obtenir la même liste prendrait l'un de vos 100 appels de recherche quotidiens.

```ts
const shortsId = channelPlaylistId(channelId, "shorts");
const shorts = await yt.playlists.items(shortsId).take(50); // 1 unité

// Le même résultat, depuis n'importe quelle référence de chaîne :
const sameShorts = await yt.channels
  .uploads("@GoogleDevelopers", { kind: "shorts" })
  .take(50);
```

`channelPlaylistId` vérifie la forme de l'identifiant de chaîne et lève une `YouTubeArgumentError` pour tout le reste. Une chaîne qui n'a jamais rien mis en ligne n'a pas de playlist d'envois : la lire échoue avec une erreur `NOT_FOUND`.

## Construire des URL

`urls` construit les liens que vous montrez aux gens.

```ts
urls.video("dQw4w9WgXcQ");
// "https://www.youtube.com/watch?v=dQw4w9WgXcQ"

urls.video("dQw4w9WgXcQ", { start: 42 });
// "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s"

urls.video("dQw4w9WgXcQ", { short: true, start: 42 });
// "https://youtu.be/dQw4w9WgXcQ?t=42s"

urls.video("dQw4w9WgXcQ", { playlistId: "PLBCF2DAC6FFB574DE" });
// "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLBCF2DAC6FFB574DE"

urls.short("dQw4w9WgXcQ");
// "https://www.youtube.com/shorts/dQw4w9WgXcQ"

urls.channel("@GoogleDevelopers");
// "https://www.youtube.com/@GoogleDevelopers"

urls.channel("UC_x5XG1OV2P6uZZ5FSM9Ttw");
// "https://www.youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw"

urls.playlist("PLBCF2DAC6FFB574DE");
// "https://www.youtube.com/playlist?list=PLBCF2DAC6FFB574DE"
```

`urls.embed` donne le `src` d'un lecteur `<iframe>` :

```ts
urls.embed("dQw4w9WgXcQ"); // "https://www.youtube.com/embed/dQw4w9WgXcQ"

urls.embed("dQw4w9WgXcQ", {
  noCookie: true,
  start: 30,
  autoplay: true,
  mute: true,
});
// "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=30&autoplay=1&mute=1"
```

`noCookie` sert le lecteur depuis `youtube-nocookie.com`, qui ne dépose aucun cookie avant la lecture. `loop` ajoute aussi la vidéo comme sa propre playlist, car le lecteur ne boucle que sur une playlist.

`urls.thumbnail` donne l'adresse de la miniature d'une vidéo sans aucun appel d'API :

```ts
urls.thumbnail("dQw4w9WgXcQ");
// "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"

urls.thumbnail("dQw4w9WgXcQ", "maxres");
// "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg"
```

Les qualités sont `"default"`, `"medium"`, `"high"` (celle par défaut), `"standard"` et `"maxres"`. `maxres` n'existe pas pour les envois anciens ou en basse résolution, et l'URL est construite sans vérification. Quand vous avez déjà la vidéo, `bestThumbnail`, plus bas, en choisit une qui existe.

## Mise en forme

L'API renvoie les durées sous forme de chaînes ISO 8601 et les compteurs sous forme de chaînes de chiffres. Ces fonctions les convertissent en nombres et en texte à afficher.

```ts
const video = await yt.videos.get(videoId); // 1 unité

if (video) {
  parseDuration(video.contentDetails.duration); // 253
  formatDuration(video.contentDetails.duration); // "4:13"
  formatCount(video.statistics.viewCount); // "1.2M"
  bestThumbnail(video.snippet.thumbnails)?.url; // la plus grande disponible
}
```

### Durées

`parseDuration` convertit `contentDetails.duration` en secondes.

```ts
parseDuration("PT4M13S"); // 253
parseDuration("PT1H2M3S"); // 3723
parseDuration("P1DT2H"); // 93600
parseDuration("P0D"); // 0
parseDuration("253s"); // 253 : la forme qu'utilise videos.batchGetStats
```

Un direct qui n'est pas terminé indique `P0D`, ce qui donne 0. Une chaîne qui n'a ni l'une ni l'autre forme lève une `YouTubeArgumentError`.

`formatDuration` accepte des secondes ou une chaîne que `parseDuration` sait lire, et un style :

| Appel | Résultat |
| --- | --- |
| `formatDuration("PT1H2M3S")` | `"1:02:03"` |
| `formatDuration(253)` | `"4:13"` |
| `formatDuration("PT45S")` | `"0:45"` |
| `formatDuration("PT1H2M3S", "short")` | `"1h 2m 3s"` |
| `formatDuration("PT4M13S", "short")` | `"4m 13s"` |
| `formatDuration(3600, "short")` | `"1h"` |
| `formatDuration(0, "short")` | `"0s"` |

`"clock"` est le style par défaut. Les heures ne sont pas converties en jours : `formatDuration(90_061)` vaut `"25:01:01"`.

### Compteurs

`formatCount` écrit un nombre comme YouTube l'affiche. L'API renvoie les statistiques sous forme de chaînes, donc les chaînes sont acceptées telles quelles.

```ts
formatCount("1234567"); // "1.2M"
formatCount(34_100); // "34.1K"
formatCount("999"); // "999"
formatCount("1234567", "de"); // "1,2 Mio."
```

Le second argument est une locale, ou une liste de locales. Par défaut, c'est `"en"`. Le texte vient de `Intl.NumberFormat`, il dépend donc des données de locale de l'environnement d'exécution. Certaines locales placent une espace insécable avant l'unité : comparez avec précaution de telles chaînes dans les tests.

Une valeur qui n'est pas un nombre lève une `YouTubeArgumentError`. Certains compteurs sont facultatifs, `likeCount` par exemple : vérifiez avant de formater.

```ts
const video = await yt.videos.get(videoId); // 1 unité
const likes = video?.statistics.likeCount;

console.log(likes === undefined ? "not available" : formatCount(likes));
```

### Miniatures

`bestThumbnail` choisit la plus grande image d'un objet `snippet.thumbnails` et la renvoie en entier, avec son `url`, sa `width` et sa `height`. Elle renvoie `undefined` s'il n'y en a aucune, ce qui arrive pour les vidéos supprimées ou privées d'une playlist. Elle accepte `undefined` et `null`, donc elle s'enchaîne.

```ts
// 1 unité par page de 50 éléments.
for await (const item of yt.playlists.items(playlistId)) {
  const image = bestThumbnail(item.snippet.thumbnails);
  console.log(item.snippet.title, image?.url ?? "(no thumbnail)");
}
```

### Catégories

`VideoCategories` nomme les identifiants des catégories de vidéos, pour que vous n'écriviez pas `"20"` pour les jeux vidéo.

```ts
const top = await yt.videos
  .popular({ regionCode: "FR", videoCategoryId: VideoCategories.Gaming })
  .take(10); // 1 unité
```

| Nom | Identifiant | Nom | Identifiant |
| --- | --- | --- | --- |
| `FilmAndAnimation` | `"1"` | `Comedy` | `"23"` |
| `AutosAndVehicles` | `"2"` | `Entertainment` | `"24"` |
| `Music` | `"10"` | `NewsAndPolitics` | `"25"` |
| `PetsAndAnimals` | `"15"` | `HowtoAndStyle` | `"26"` |
| `Sports` | `"17"` | `Education` | `"27"` |
| `TravelAndEvents` | `"19"` | `ScienceAndTechnology` | `"28"` |
| `Gaming` | `"20"` | `NonprofitsAndActivism` | `"29"` |
| `PeopleAndBlogs` | `"22"` | | |

Les identifiants sont les mêmes dans toutes les régions. Seule leur disponibilité diffère, que `yt.videoCategories.list({ part: "snippet", regionCode })` indique pour 1 unité.

## Référence

| Fonction | Renvoie | Ce qu'elle fait |
| --- | --- | --- |
| `parseUrl(input)` | `YouTubeLink \| null` | Lit une URL YouTube |
| `videoIdFrom(input)` | `string \| null` | L'identifiant de vidéo d'un identifiant ou de n'importe quelle URL de vidéo |
| `playlistIdFrom(input)` | `string \| null` | L'identifiant de playlist d'un identifiant ou d'une URL avec un paramètre `list` |
| `parseChannelRef(input)` | `ChannelRef` | Distingue un identifiant, un handle, un nom d'utilisateur ou une URL personnalisée. Lève une erreur pour tout le reste |
| `isVideoId(value)` | `boolean` | 11 caractères sûrs pour une URL |
| `isChannelId(value)` | `boolean` | `UC` suivi de 22 caractères |
| `isPlaylistId(value)` | `boolean` | Un préfixe de playlist comme `PL` ou `UU` et au moins 10 caractères de plus, ou `WL` ou `LL` seuls. Jamais une chaîne de la forme d'un identifiant de vidéo |
| `channelPlaylistId(channelId, kind?)` | `string` | L'identifiant de l'une des playlists générées d'une chaîne |
| `urls.video(videoId, options?)` | `string` | Page de lecture. Options : `start`, `playlistId`, `short` |
| `urls.short(videoId)` | `string` | Lecteur de Shorts |
| `urls.channel(channel)` | `string` | Page de la chaîne, depuis un identifiant ou un `@handle` |
| `urls.playlist(playlistId)` | `string` | Page de la playlist |
| `urls.embed(videoId, options?)` | `string` | Lecteur pour un `<iframe>`. Options : `start`, `end`, `autoplay`, `mute`, `loop`, `controls`, `noCookie`, `hl` |
| `urls.thumbnail(videoId, quality?)` | `string` | Image de miniature. Qualité par défaut : `"high"` |
| `parseDuration(iso)` | `number` | Durée ISO 8601 en secondes |
| `formatDuration(duration, style?)` | `string` | Des secondes ou de l'ISO 8601 vers `"1:02:03"` ou `"1h 2m 3s"` |
| `formatCount(count, locale?)` | `string` | Nombre compact : `"1.2M"` |
| `bestThumbnail(thumbnails)` | Une miniature, ou `undefined` | La plus grande image d'un objet `snippet.thumbnails` |
| `VideoCategories` | Un objet | Les identifiants de catégories, par nom |

Les types sont aussi exportés : `YouTubeLink`, `ChannelRef`, `ChannelPlaylistKind`, `VideoUrlOptions`, `EmbedUrlOptions` et `ThumbnailQuality`.

## Voir aussi

- [Chaînes](/resources/channels/) : `yt.channels.get`, `resolveId` et `uploads`, qui utilisent ces fonctions.
- [Quota](/basics/quota/) : pourquoi la playlist des envois vaut mieux qu'une recherche.
- [Flux et oEmbed](/notifications/feeds-and-oembed/) : titres et miniatures sans clé et sans quota.
- [Tous les exports](/reference/exports/) : tout ce que le paquet exporte.
