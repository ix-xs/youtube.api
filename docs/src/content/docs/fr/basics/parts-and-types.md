---
title: Parties et types
description: "YouTube ne renvoie que les parties d'une ressource que vous demandez. Le type du résultat suit cette liste : une partie absente devient une erreur de compilation, au lieu d'un undefined à l'exécution."
sidebar:
  order: 1
---

```ts
const { items } = await yt.videos.list({
  part: ["snippet", "statistics"],
  id: "dQw4w9WgXcQ",
}); // 1 unité
const video = items[0];

if (video) {
  video.snippet.title; // string
  video.statistics.viewCount; // string
  // @ts-expect-error contentDetails n'a pas été demandée
  video.contentDetails;
}
```

## Ce qu'est une partie

Une ressource YouTube est découpée en parties. Une vidéo a `snippet` (titre, description, miniatures), `contentDetails` (durée, définition), `statistics` (vues, mentions « j'aime »), `status` (confidentialité) et 13 autres. Une lecture qui prend un paramètre `part` renvoie ces parties et rien d'autre. Demander plus de parties alourdit la réponse. Cela ne change pas le coût en quota.

`part` accepte un nom ou une liste. Chacun de ces appels coûte 1 unité :

```ts
await yt.channels.list({ part: "snippet", forHandle: "@GoogleDevelopers" });
await yt.channels.list({
  part: ["snippet", "statistics"],
  forHandle: "@GoogleDevelopers",
});
```

Les noms sont vérifiés. Une faute de frappe, ou une partie d'une autre ressource, ne compile pas :

```ts
// @ts-expect-error "snipet" n'est pas une partie d'une vidéo
yt.videos.list({ part: "snipet", id: videoId });
```

## Ce que contient le type du résultat

Le type de chaque élément est construit à partir des parties de l'appel.

| Sur le résultat | Typé comme |
| --- | --- |
| `kind`, `etag`, `id` | Toujours présents, jamais optionnels |
| Une partie demandée que l'API renvoie toujours | Obligatoire : `video.snippet` |
| Une partie demandée que l'API peut omettre | Optionnelle : `video.liveStreamingDetails?` |
| Une partie qui n'a pas été demandée | Absente. La lire est une erreur de compilation |

Certaines parties n'existent que dans certaines situations, même quand vous les demandez. `liveStreamingDetails` n'est là que si la vidéo est une diffusion en direct à venir, en cours ou terminée. Ces parties restent optionnelles, si bien que le compilateur vous oblige à traiter le cas :

```ts
const video = await yt.videos
  .list({ part: ["snippet", "liveStreamingDetails"], id: videoId })
  .first(); // 1 unité

const chatId = video?.liveStreamingDetails?.activeLiveChatId;
```

Les parties toujours renvoyées quand on les demande, pour les trois ressources que vous utiliserez le plus :

| Ressource | Toujours renvoyées |
| --- | --- |
| Vidéo | `snippet`, `contentDetails`, `statistics`, `status`, `player` |
| Chaîne | `snippet`, `contentDetails`, `statistics`, `status`, `brandingSettings` |
| Playlist | `snippet`, `contentDetails`, `status`, `player` |

## Les champs d'une partie

Dans une partie, certains champs sont obligatoires et d'autres optionnels. Les champs optionnels méritent d'être connus, car c'est là que casse le code écrit à partir d'un seul exemple :

```ts
const video = await yt.videos.get(videoId); // 1 unité

if (video) {
  video.snippet.title; // string
  video.snippet.tags; // string[] | undefined
  video.statistics.viewCount; // string
  video.statistics.likeCount; // string | undefined
  video.statistics.commentCount; // string | undefined
}
```

Les compteurs sont des entiers sur 64 bits, que l'API envoie sous forme de chaînes. Convertissez-les avec `Number()` quand vous avez besoin de calculer, ou affichez-les avec [`formatCount`](/basics/ids-and-urls/#formatting).

Un jeu de miniatures peut être vide : une vidéo supprimée ou privée dans une playlist n'en a aucune. [`bestThumbnail`](/basics/ids-and-urls/#formatting) choisit la plus grande qui existe.

## Nommer les types

Chaque ressource a un type qui prend les parties en argument. Servez-vous-en pour typer vos propres fonctions :

```ts
import type { Video } from "@ix-xs/youtube.api";

function describe(video: Video<"snippet" | "statistics">): string {
  return `${video.snippet.title} (${video.statistics.viewCount} views)`;
}

const video = await yt.videos.get(videoId, {
  part: ["snippet", "statistics", "status"],
});
if (video) describe(video); // plus de parties que nécessaire, ce n'est pas un problème
```

`Video` sans argument est la ressource complète, avec toutes les parties optionnelles. Toute vidéo réduite peut être passée là où l'on attend un `Video` simple : c'est donc le bon type pour « une vidéo quelconque, je vérifierai ce qu'elle contient » :

```ts
import type { Video } from "@ix-xs/youtube.api";

function titleOf(video: Video): string {
  return video.snippet?.title ?? "(no snippet)";
}

const video = await yt.videos.get(videoId, { part: "snippet" });
if (video) titleOf(video);
```

## Les raccourcis choisissent les parties pour vous

Les raccourcis qui prennent un identifiant ou une URL ont des parties par défaut, de sorte que le cas courant n'a pas besoin de liste. Passez `part` pour les changer, et le type suit comme d'habitude.

```ts
const video = await yt.videos.get("https://youtu.be/dQw4w9WgXcQ");
// Video<"snippet" | "contentDetails" | "statistics"> | null

const slim = await yt.videos.get(videoId, { part: "status" });
// Video<"status"> | null
```

| Raccourci | Parties par défaut |
| --- | --- |
| `yt.videos.get`, `getMany`, `popular`, `yt.channels.latestVideo`, `latestVideos`, `yt.playlists.videos` | `snippet`, `contentDetails`, `statistics` |
| `yt.channels.get`, `mine` | `snippet`, `contentDetails`, `statistics` |
| `yt.playlists.get` | `snippet`, `contentDetails`, `status` |
| `yt.channels.uploads`, `yt.playlists.items` | `snippet`, `contentDetails` |
| `yt.commentThreads.forVideo`, `yt.comments.replies` | `snippet` |

## Les écritures

Une écriture envoie des parties et récupère les mêmes parties. `part` y est facultatif : s'il est omis, c'est la liste des parties présentes dans `body`. Chacun de ces deux appels coûte 50 unités :

```ts
const playlist = await yt.playlists.insert({
  body: {
    snippet: { title: "Favourites" },
    status: { privacyStatus: "private" },
  },
});
playlist.id; // string : une ressource créée a toujours son identifiant

const typed = await yt.playlists.insert({
  part: ["snippet", "status"],
  body: {
    snippet: { title: "Favourites" },
    status: { privacyStatus: "private" },
  },
});
typed.snippet.title; // string : avec une partie explicite, le résultat est réduit
```

Les corps acceptent n'importe quel sous-ensemble de la ressource, à toute profondeur, et leurs valeurs restent vérifiées :

```ts
await yt.playlists.insert({
  body: {
    snippet: { title: "Favourites" },
    // @ts-expect-error privacyStatus vaut "public", "unlisted" ou "private"
    status: { privacyStatus: "secret" },
  },
});
```

:::caution
Une mise à jour remplace en entier chaque partie qu'elle envoie. Ce que vous omettez dans une partie n'est pas conservé. Lisez la partie, modifiez-la, renvoyez-la. [Vidéos](/resources/videos/#updating-a-video) montre le schéma à suivre.
:::

## Des réponses plus légères avec `fields`

`part` choisit des parties entières. L'option de requête `fields` va plus loin : elle nomme les champs exacts à renvoyer, ce qui réduit la charge utile. Elle ne réduit pas les types, donc ne lisez que ce que vous avez demandé.

```ts
const page = await yt.playlistItems.list(
  { part: "snippet", playlistId },
  { fields: "items(snippet(title,resourceId/videoId)),nextPageToken" },
); // 1 unité
```

## Référence

| Type | Ce que c'est |
| --- | --- |
| `Video<P>`, `Channel<P>`, `Playlist<P>`, ... | Une ressource réduite aux parties `P` |
| `Video`, `Channel`, ... sans argument | La ressource complète, toutes les parties optionnelles |
| `VideoPart`, `ChannelPart`, ... | L'union des noms de parties d'une ressource |
| `VideoResource`, `ChannelResource`, ... | La même ressource complète, sous son propre nom |
| `Identified<T>` | Ce qu'une écriture renvoie sans `part` : `kind`, `etag` et `id` sont connus, chaque partie est optionnelle |
| `Body<T>` | Un corps de requête : la ressource avec chaque champ optionnel, à toute profondeur |

26 ressources sont typées ainsi. [Tous les exports](/reference/exports/#resources) les liste.

## Voir aussi

- [Listes](/basics/lists/) pour ce que renvoie `list` et la façon de la parcourir.
- [Quota](/basics/quota/) : les parties sont gratuites, les appels non.
- [Vidéos](/resources/videos/) et [Chaînes](/resources/channels/) pour le détail des parties de chacune.
