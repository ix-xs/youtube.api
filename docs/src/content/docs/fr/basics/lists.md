---
title: Listes
description: "Chaque méthode de liste renvoie une requête que vous pouvez attendre avec await pour une page, parcourir jusqu'au bout ou rassembler dans un tableau. Rien n'est envoyé tant que vous ne faites pas l'un des trois."
sidebar:
  order: 2
---

```ts
const request = yt.playlistItems.list({ part: "snippet", playlistId });

// Une page, 1 unité.
const page = await request;
console.log(page.items.length, page.nextPageToken);

// Chaque élément, récupéré page par page à mesure que la boucle avance. 1 unité par page.
for await (const item of request) {
  console.log(item.snippet.title);
}

// Un tableau borné.
const firstHundred = await request.take(100);
```

## Ce que renvoie une méthode de liste

Chaque méthode `list`, et chaque raccourci qui renvoie une liste (`yt.playlists.items`, `yt.channels.uploads`, `yt.search.videos`, `yt.commentThreads.forVideo`...), renvoie une `ListRequest`. C'est la description d'un appel, pas un appel en cours :

- Rien n'est envoyé à sa création. Créer une requête ne coûte aucun quota.
- `await` l'envoie et renvoie la première `Page`.
- `for await` l'envoie et parcourt chaque élément de chaque page.
- `.all()`, `.take(n)`, `.first()` et `.pages()` sont les autres façons de la consommer.

Une requête peut être consommée plusieurs fois. Chaque consommation l'envoie de nouveau et coûte de nouveau du quota.

## Une page

Attendez la requête avec `await`. Vous obtenez une `Page` : les éléments, et ce que l'API a dit du reste.

```ts
const page = await yt.search.videos("lofi hip hop"); // 1 appel de recherche

page.items; // les résultats de cette page
page.nextPageToken; // string | undefined
page.totalResults; // number | undefined
page.hasNext; // indique si une autre page suit
```

Une page est itérable, et elle se déstructure comme la réponse brute :

```ts
const popular = yt.videos.list({ part: "snippet", chart: "mostPopular" });

const { items } = await popular; // 1 unité

for (const video of await popular) {
  console.log(video.snippet.title);
}
```

La taille de cette page dépend de ce que vous avez attendu :

- Une méthode `list` brute est envoyée telle que vous l'avez écrite. Sans `maxResults`, la taille de page par défaut de l'API s'applique.
- Un raccourci qui renvoie une liste demande la plus grande page que la méthode autorise, car une page coûte autant quelle que soit sa taille : 50, ou 100 pour les commentaires. Cela couvre `yt.channels.uploads`, `yt.playlists.items`, `yt.videos.popular`, `yt.commentThreads.forVideo`, `yt.comments.replies` et les quatre raccourcis de `yt.search`. La recherche ci-dessus renvoie jusqu'à 50 résultats.

`totalResults` est la taille de l'ensemble des résultats telle que l'API l'annonce. Pour une recherche, c'est une estimation, plafonnée à 1 000 000. Ne vous en servez pas pour décider du nombre de pages à récupérer : parcourez jusqu'à ce qu'il n'y ait plus de page suivante.

## Chaque élément

Parcourez la requête. Les pages sont récupérées une par une, au moment où la boucle a besoin de la suivante. Ici, chaque page coûte 1 unité :

```ts
for await (const thread of yt.commentThreads.forVideo(videoId)) {
  console.log(thread.snippet.topLevelComment.snippet?.textDisplay);
}
```

Quitter la boucle avec `break` ou `return` arrête la récupération. Une page inutile n'est jamais demandée.

Pendant le parcours, la requête utilise la plus grande taille de page que la méthode autorise, car c'est la moins chère en quota : 50 pour la plupart des méthodes, 100 pour les commentaires. Si vous définissez vous-même `maxResults`, votre valeur est utilisée.

## Un tableau borné

`.all()` rassemble tous les éléments dans un tableau. `.all({ limit })` s'arrête dès qu'il en a autant, et `.take(n)` en est un raccourci.

```ts
const everything = await yt.playlists.items(playlistId).all();
const firstHundred = await yt.playlists.items(playlistId).all({ limit: 100 });
const sameThing = await yt.playlists.items(playlistId).take(100);
```

La taille de page suit la limite. Sur une méthode dont la plus grande page est de 50, `.take(10)` demande une page de 10 éléments, et `.take(120)` demande trois pages de 50 et garde 120 éléments.

Préférez une limite à un `.all()` nu sur tout ce qui ne vous appartient pas. Une longue playlist ou une section de commentaires très active représente beaucoup de pages, et chaque page est un appel.

## Le premier élément

`.first()` renvoie le premier élément, ou `undefined` s'il n'y en a aucun. Il demande à l'API un seul élément quand la méthode le permet.

```ts
const video = await yt.videos
  .list({ part: ["snippet", "liveStreamingDetails"], id: videoId })
  .first(); // 1 unité

const newest = await yt.channels.uploads("@GoogleDevelopers").first();
```

Le second appel coûte 1 unité, plus 1 la première fois que le handle est résolu.

Les raccourcis nommés `get` sont construits dessus et renvoient `null` au lieu de `undefined` : `yt.videos.get`, `yt.channels.get`, `yt.playlists.get`.

## Page par page

`.pages()` parcourt des pages entières au lieu des éléments. Utilisez-le quand vous travaillez par lots :

```ts
for await (const page of yt.playlists.items(playlistId).pages()) {
  const ids = page.items.map((item) => item.contentDetails.videoId);
  await db.saveVideoIds(ids);
}
```

`.pages({ limit })` s'arrête après la page qui atteint la limite. Il produit des pages entières, donc la dernière peut la dépasser.

À partir d'une page, `page.next()` récupère la suivante. Elle renvoie `null` sur la dernière page.

```ts
const first = await yt.commentThreads.list({
  part: "snippet",
  videoId,
  maxResults: 100,
}); // 1 unité
const second = await first.next(); // 1 unité

if (second) console.log(second.items.length);
```

Quand les pages sont demandées par quelqu'un d'autre, un navigateur par exemple, passez le jeton vous-même. Envoyez `page.nextPageToken` au client et reprenez-le comme `pageToken` :

```ts
const params = { part: "snippet", playlistId, maxResults: 25 } as const;

const page = await yt.playlistItems.list(params);
const pageToken = page.nextPageToken;

// Plus tard, dans une autre requête de votre serveur :
const next = await yt.playlistItems.list({ ...params, pageToken });
```

## Plus de 50 identifiants

L'API accepte au plus 50 identifiants par appel. La bibliothèque en accepte autant que vous voulez : une liste plus longue est découpée en appels de 50, doublons retirés.

```ts
const { items } = await yt.videos.list({ part: "statistics", id: ids });
```

La façon dont les appels sont faits dépend de la façon dont vous consommez la requête :

| Vous écrivez | Ce qui se passe |
| --- | --- |
| `await request`, `.first()` | Les appels s'exécutent en parallèle, quatre à la fois. Leurs éléments sont fusionnés en une seule page |
| `for await`, `.all()`, `.take()`, `.pages()` | Un appel par tranche de 50 identifiants, fait quand la boucle y arrive |

Chaque appel coûte le quota de la méthode : 300 identifiants de vidéos font 6 appels à `videos.list`, soit 6 unités.

Une page fusionnée n'a pas de page suivante. `totalResults` et `resultsPerPage` valent le nombre d'éléments fusionnés. `raw` est le corps du premier appel avec ces deux compteurs.

`yt.videos.getMany(ids)` est le raccourci pour les vidéos. Il accepte des URL aussi bien que des identifiants, et renvoie les vidéos dans l'ordre où vous les avez données. Les vidéos qui n'existent pas ou qui sont privées sont omises, donc le résultat peut être plus court que la liste.

Méthodes qui découpent leur liste `id` : `captions.list`, `channels.list`, `channelSections.list`, `comments.list`, `commentThreads.list`, `liveBroadcasts.list`, `liveStreams.list`, `playlistItems.list`, `playlists.list`, `subscriptions.list`, `videoCategories.list`, `videos.list`, `videos.getRating` et `videos.batchGetStats`.

## La réponse brute

`page.raw` est le corps de la réponse tel que l'API l'a envoyé, entièrement typé. Utilisez-le pour les champs qui ne sont ni des éléments ni des jetons de page :

```ts
const page = await yt.liveChatMessages.list({
  part: ["snippet", "authorDetails"],
  liveChatId,
});

// Le délai que YouTube vous demande d'attendre avant l'appel suivant.
page.raw.pollingIntervalMillis;
page.raw.offlineAt; // défini une fois la diffusion terminée
```

Cet appel coûte 5 unités. [Chat en direct](/live/live-chat/) enveloppe cette boucle pour vous.

## Faire circuler une requête

Une `ListRequest` se comporte comme une promesse quand on l'attend avec `await`. Cela a une conséquence à connaître : une fonction `async` attend ce qu'elle renvoie, donc elle renvoie la première page, pas la requête.

```ts
// Renvoie la requête. L'appelant choisit comment la consommer.
function itemsOf(playlist: string) {
  return yt.playlists.items(playlist);
}

// Renvoie une promesse de la première page.
async function firstPageOf(playlist: string) {
  return yt.playlists.items(playlist);
}

const all = await itemsOf(playlistId).all();
const page = await firstPageOf(playlistId);
// @ts-expect-error une Page n'a pas de all() : la requête a déjà été attendue
page.all();
```

Les options de requête se placent dans le dernier argument de la méthode de liste et valent pour chaque page :

```ts
const controller = new AbortController();
const options = { signal: controller.signal, timeout: "10s" } as const;

for await (const item of yt.playlists.items(playlistId, options)) {
  console.log(item.snippet.title);
}
```

## Ce que cela coûte

Chaque page est un appel, et chaque appel coûte de nouveau le quota de la méthode. Le quota se compte par appel, pas par élément, c'est pourquoi la plus grande taille de page est la moins chère.

| Parcours | Taille de page | Coût |
| --- | --- | --- |
| `yt.playlists.items(id)`, `yt.channels.uploads(channel)` | 50 | 1 unité par page |
| `yt.commentThreads.forVideo(video)` | 100 | 1 unité par page |
| `yt.videos.list({ id: [...] })` | 50 identifiants | 1 unité par appel |
| `yt.search.videos(query)` | 50 | 1 appel de l'enveloppe de recherche par page |

:::caution
La recherche a une enveloppe de 100 appels par jour. Un `for await` sur une recherche qui a beaucoup de résultats peut la consommer entièrement en une seule boucle. Donnez une limite aux recherches : `yt.search.videos(query).take(50)` fait un seul appel.
:::

[Quota](/basics/quota/#buckets) explique les enveloppes.

## Référence

### `ListRequest<T, R>`

`T` est le type des éléments et `R` le type du corps de la réponse brute.

| Membre | Renvoie | Ce qu'il fait |
| --- | --- | --- |
| `await request` | `Page<T, R>` | Récupère la première page. Avec plus de 50 identifiants, récupère chaque morceau en parallèle et les fusionne |
| `for await (const item of request)` | `T` | Parcourt chaque élément de chaque page |
| `.page()` | `Promise<Page<T, R>>` | Ce que fait `await`, sous forme de méthode |
| `.pages({ limit? })` | `AsyncGenerator<Page<T, R>>` | Parcourt les pages une par une |
| `.all({ limit? })` | `Promise<T[]>` | Rassemble les éléments sur plusieurs pages |
| `.take(n)` | `Promise<T[]>` | Raccourci pour `.all({ limit: n })` |
| `.first()` | `Promise<T \| undefined>` | Le premier élément |
| `.then()`, `.catch()`, `.finally()` | Une promesse | Ceux de la promesse de la première page |

### `Page<T, R>`

| Membre | Type | Ce que c'est |
| --- | --- | --- |
| `items` | `T[]` | Éléments de cette page |
| `nextPageToken` | `string \| undefined` | Jeton de la page suivante, quand il y en a une |
| `prevPageToken` | `string \| undefined` | Jeton de la page précédente, quand l'API en fournit un |
| `totalResults` | `number \| undefined` | Taille de l'ensemble des résultats telle que l'API l'annonce. Une estimation pour les recherches |
| `resultsPerPage` | `number \| undefined` | Éléments que l'API a mis dans une page pleine |
| `raw` | `R` | Le corps de la réponse tel que l'API l'a envoyé |
| `hasNext` | `boolean` | Indique si une autre page suit |
| `next()` | `Promise<Page<T, R> \| null>` | Récupère la page suivante, `null` sur la dernière |

Une page est aussi itérable : `for (const item of page)`.

### Plus grandes tailles de page

| Taille de page | Méthodes |
| --- | --- |
| 50 | `activities.list`, `channels.list`, `liveBroadcasts.list`, `liveChatModerators.list`, `liveStreams.list`, `playlistImages.list`, `playlistItems.list`, `playlists.list`, `search.list`, `subscriptions.list`, `superChatEvents.list`, `videos.list` |
| 100 | `comments.list`, `commentThreads.list` |
| 1 000 | `members.list` |
| 2 000 | `liveChatMessages.list`. Sa plus petite page est de 200, donc `.first()` en demande 200 |

Pour les autres méthodes de liste, la bibliothèque ne définit aucune taille de page. Elle n'en définit pas non plus quand l'appel désigne ses éléments avec `id`.

## Voir aussi

- [Parties et types](/basics/parts-and-types/) : ce que contient chaque élément.
- [Quota](/basics/quota/) : ce que coûte une page et comment dépenser moins.
- [Playlists](/resources/playlists/) et [Commentaires](/resources/comments/) : les listes que vous parcourrez le plus.
- [Durée totale d'une playlist](/recipes/playlist-length/) : une playlist entière parcourue en quelques lignes.
