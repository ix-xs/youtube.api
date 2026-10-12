---
title: Vidéos
description: Lisez une vidéo ou des centaines à partir d'identifiants et d'URL, listez le classement des plus populaires, modifiez les métadonnées, notez, signalez et supprimez.
sidebar:
  order: 2
---

```ts
const video = await yt.videos.get("https://youtu.be/dQw4w9WgXcQ");

if (video) {
  const { duration } = video.contentDetails;
  const { viewCount } = video.statistics;

  console.log(video.snippet.title);
  console.log(formatDuration(duration), formatCount(viewCount));
}
```

## Récupérer une vidéo

`yt.videos.get` accepte un identifiant de vidéo ou n'importe quelle URL de vidéo : une page de lecture, un lien `youtu.be`, une URL de Short, de direct ou d'intégration. Elle coûte 1 unité de quota et renvoie `null` quand la vidéo n'existe pas ou est privée.

```ts
await yt.videos.get("dQw4w9WgXcQ");
await yt.videos.get("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s");
await yt.videos.get("https://www.youtube.com/shorts/dQw4w9WgXcQ");
```

Une chaîne de caractères qui n'est ni un identifiant ni une URL de vidéo lève une `YouTubeArgumentError` avant tout envoi, donc sans rien coûter.

Les parties par défaut sont `snippet`, `contentDetails` et `statistics`. Passez `part` pour les changer, et le type du résultat suit :

```ts
const video = await yt.videos.get(videoId, { part: ["snippet", "status"] });

if (video) console.log(video.snippet.title, video.status.privacyStatus);
```

## Récupérer plusieurs vidéos

`yt.videos.getMany` récupère une liste d'identifiants ou d'URL, 50 par appel, à 1 unité par appel.

```ts
const found = await yt.videos.getMany(ids);

const foundIds = new Set(found.map((video) => video.id));
const missing = ids.filter((id) => !foundIds.has(id));
```

Le résultat respecte l'ordre que vous avez donné. Les vidéos inexistantes ou privées sont omises, donc le tableau peut être plus court que la liste passée. Un doublon n'est récupéré qu'une fois et n'apparaît qu'une fois.

## Lister les vidéos populaires

`yt.videos.popular` liste les vidéos les plus populaires d'une région, éventuellement dans une catégorie. Elle coûte 1 unité par page de 50. Attendue avec `await`, elle renvoie une page de 50.

```ts
const top = await yt.videos.popular({ regionCode: "FR" }).take(10);

const gaming = await yt.videos
  .popular({ regionCode: "US", videoCategoryId: VideoCategories.Gaming })
  .take(25);
```

Depuis juillet 2025, le classement est construit à partir des classements tendance Musique, Films et Jeux vidéo.

`VideoCategories` contient les identifiants de catégorie par nom. Ils sont les mêmes dans toutes les régions. Celles qu'une région propose, c'est [`videoCategories.list`](#listing-video-categories) qui vous le dit. `hl` choisit la langue de `snippet.localized`.

## Utiliser `videos.list` brut

Les trois raccourcis ci-dessus appellent `yt.videos.list`. Elle coûte 1 unité et accepte exactement un des trois filtres :

| Filtre | Renvoie | Authentification |
| --- | --- | --- |
| `id` | Les vidéos ayant ces identifiants. Un identifiant ou une liste de n'importe quelle longueur | Clé |
| `chart: "mostPopular"` | Le classement des plus populaires, restreint par `regionCode` et `videoCategoryId` | Clé |
| `myRating` | Les vidéos que l'utilisateur authentifié a notées « j'aime » (`"like"`) ou « je n'aime pas » (`"dislike"`) | OAuth |

```ts
const liked = await yt.videos
  .list({ part: "snippet", myRating: "like" })
  .take(100);

for (const video of liked) console.log(video.snippet.title);
```

`maxResults` et `pageToken` s'appliquent à `chart` et à `myRating`. Attendue sans `maxResults`, la méthode brute renvoie la page par défaut de l'API, soit 5 éléments, là où `popular` en demande 50. Une recherche par `id` renvoie exactement ces identifiants : les listes de plus de 50 sont découpées en appels de 50, puis fusionnées.

## Lire les parties

La durée est une chaîne ISO 8601 comme `PT15M51S`. `parseDuration` la convertit en secondes et `formatDuration` en texte :

```ts
const video = await yt.videos.get(videoId, { part: "contentDetails" });

if (video) {
  parseDuration(video.contentDetails.duration); // 951
  formatDuration(video.contentDetails.duration); // "15:51"
  formatDuration(video.contentDetails.duration, "short"); // "15m 51s"
}
```

Un direct qui n'est pas terminé indique `P0D`, ce qui donne 0.

Les statistiques sont des chaînes de caractères, car ce sont des entiers sur 64 bits. Seul le nombre de vues est toujours présent :

| Champ | Type | Remarques |
| --- | --- | --- |
| `viewCount` | `string` | Toujours présent |
| `likeCount` | `string \| undefined` | Absent quand le propriétaire le masque |
| `commentCount` | `string \| undefined` | Absent quand les commentaires sont désactivés |
| `dislikeCount` | `string \| undefined` | Facultatif dans le type |

Dans le snippet, `tags`, `defaultLanguage` et `defaultAudioLanguage` sont facultatifs. Les miniatures le sont toutes aussi : [`bestThumbnail`](/basics/ids-and-urls/#formatting) choisit la plus grande disponible.

Certaines parties restent facultatives même quand vous les demandez, parce qu'elles n'existent que dans certains cas. `liveStreamingDetails` est la plus courante. [Parties et types](/basics/parts-and-types/) explique la règle.

## Distinguer un direct d'une vidéo classique

`snippet.liveBroadcastContent` vaut `"live"` tant qu'une vidéo est en direct et `"upcoming"` tant qu'elle est programmée. `liveStreamingDetails` n'est présent que pour une diffusion à venir, en cours ou terminée : cela permet de distinguer un direct passé d'un envoi classique.

```ts
const video = await yt.videos.get(videoId, {
  part: ["snippet", "liveStreamingDetails"],
});

if (video) {
  const live = video.liveStreamingDetails;

  switch (video.snippet.liveBroadcastContent) {
    case "live":
      console.log("Live now,", live?.concurrentViewers ?? "?", "watching");
      break;
    case "upcoming":
      console.log("Starts at", live?.scheduledStartTime);
      break;
    default:
      if (live) console.log("A past broadcast, ended at", live.actualEndTime);
      else console.log("A regular upload");
  }
}
```

`liveStreamingDetails.activeLiveChatId` est l'identifiant du chat tant que la diffusion est en direct : voir [Chat en direct](/live/live-chat/). Programmer et mener une diffusion fait l'objet de [Diffusions](/live/broadcasts/).

## Mettre à jour une vidéo

`yt.videos.update` modifie les métadonnées de l'une de vos vidéos. Elle exige OAuth et coûte 50 unités.

Une partie que vous envoyez remplace toute la partie. Envoyer un `snippet` qui ne contient qu'un nouveau titre efface la description et les tags. Lisez donc la partie, modifiez-la, puis renvoyez-la :

```ts
const video = await yt.videos.get(videoId, { part: "snippet" });

if (video) {
  await yt.videos.update({
    body: {
      id: video.id,
      snippet: {
        ...video.snippet,
        title: "A better title",
        tags: [...(video.snippet.tags ?? []), "typescript"],
      },
    },
  });
}
```

Cela fait 51 unités : 1 pour la lecture, 50 pour l'écriture. Un `snippet` doit contenir `title` et `categoryId`, que la lecture vous fournit.

Il en va de même pour les autres parties. Pour publier une vidéo privée, lisez `status` et renvoyez-le avec la nouvelle valeur :

```ts
const video = await yt.videos.get(videoId, { part: "status" });

if (video) {
  await yt.videos.update({
    body: {
      id: video.id,
      status: { ...video.status, privacyStatus: "public" },
    },
  });
}
```

`part` est facultatif pour une écriture : omis, il vaut la liste des parties présentes dans `body`. Passez-le pour recevoir un résultat réduit :

```ts
const video = await yt.videos.get(videoId, { part: "snippet" });

if (video) {
  const updated = await yt.videos.update({
    part: "snippet",
    body: {
      id: video.id,
      snippet: { ...video.snippet, categoryId: VideoCategories.Education },
    },
  });

  updated.snippet.categoryId; // "27"
}
```

## Noter une vidéo

Noter une vidéo exige OAuth. Chaque changement coûte 50 unités, lire la note actuelle en coûte 1.

```ts
if ((await yt.videos.ratingOf(videoId)) !== "like") {
  await yt.videos.like(videoId);
}

await yt.videos.dislike(videoId);
await yt.videos.unrate(videoId); // retire le « j'aime » ou le « je n'aime pas »
```

`ratingOf` renvoie `"like"`, `"dislike"` ou `"none"`. Les quatre raccourcis acceptent un identifiant ou une URL.

Les méthodes brutes sont `rate` et `getRating`. Elles n'acceptent que des identifiants. `getRating` prend un identifiant ou une liste et répond pour chacun :

```ts
await yt.videos.rate({ id: videoId, rating: "like" });

const { items } = await yt.videos.getRating({ id: ids });
for (const item of items) console.log(item.videoId, item.rating);
```

Quand les notes sont désactivées sur une vidéo, `rate` échoue avec la raison `videoRatingDisabled` :

```ts
try {
  await yt.videos.like(videoId);
} catch (error) {
  if (
    error instanceof YouTubeApiError &&
    error.reason === "videoRatingDisabled"
  ) {
    console.log("Ratings are off on this video");
  } else {
    throw error;
  }
}
```

## Supprimer une vidéo

`yt.videos.delete` supprime l'une de vos vidéos. Elle exige OAuth et coûte 50 unités. Il n'y a pas d'annulation possible.

```ts
await yt.videos.delete({ id: videoId });
```

## Signaler une vidéo

`yt.videos.reportAbuse` signale une vidéo pour contenu abusif, avec OAuth, pour 50 unités. Le motif est un identifiant issu de `yt.videoAbuseReportReasons.list`, qui coûte 1 unité :

```ts
const { items } = await yt.videoAbuseReportReasons.list({
  part: "snippet",
  hl: "en",
});

for (const reason of items) {
  console.log(reason.id, reason.snippet.label);

  for (const secondary of reason.snippet.secondaryReasons ?? []) {
    console.log("  ", secondary.id, secondary.label);
  }
}
```

```ts
await yt.videos.reportAbuse({
  body: {
    videoId,
    reasonId: "S",
    comments: "Repeated links to a scam site",
    language: "en",
  },
});
```

`secondaryReasonId` précise le signalement quand le motif a des motifs secondaires.

## Lister les catégories de vidéos

`yt.videoCategories.list` liste les catégories disponibles dans une région, ou récupère des catégories par identifiant. Elle coûte 1 unité.

```ts
const { items } = await yt.videoCategories.list({
  part: "snippet",
  regionCode: "FR",
  hl: "fr",
});

const assignable = items.filter((category) => category.snippet.assignable);
for (const category of assignable) {
  console.log(category.id, category.snippet.title);
}
```

La catégorie d'une vidéo est `snippet.categoryId`. Les identifiants ne changent pas d'une région à l'autre, donc la constante `VideoCategories` couvre le cas courant sans appel :

```ts
VideoCategories.Music; // "10"
VideoCategories.Gaming; // "20"
VideoCategories.Education; // "27"
```

Si vous les listez quand même, donnez à la méthode une longue durée de [cache](/basics/caching/).

## Interroger les statistiques

`yt.videos.batchGetStats` récupère des statistiques à jour pour de nombreuses vidéos. Elle puise dans [sa propre enveloppe](/basics/quota/#buckets), de 10 000 appels par jour par défaut : interroger les nombres de vues n'entame donc pas le budget commun. `id` est obligatoire. Un appel couvre 50 identifiants. Les listes plus longues sont découpées, à raison d'un appel par tranche de 50.

```ts
const { items } = await yt.videos.batchGetStats({
  part: "statistics",
  id: ids,
});

for (const stat of items) {
  console.log(stat.id, stat.statistics.viewCount, stat.statistics.likeCount);
}
```

Le résultat n'est pas une vidéo mais une ressource plus légère, avec trois parties : `statistics` (`viewCount`, `likeCount`, `commentCount`), `snippet` (`publishTime`) et `contentDetails` (`duration`). Utilisez `videos.list` pour tout le reste.

Ici, la durée n'est pas en ISO 8601. C'est un nombre de secondes suivi de `s`, que `parseDuration` et `formatDuration` savent lire aussi :

```ts
const { items } = await yt.videos.batchGetStats({
  part: "contentDetails",
  id: ids,
});

for (const stat of items) {
  const { duration } = stat.contentDetails; // "212s", ou undefined
  if (duration) console.log(stat.id, parseDuration(duration)); // 212
}
```

## Vérifier l'autorisation d'entraînement d'IA

`yt.videoTrainability.get` indique quels tiers, le cas échéant, le propriétaire autorise à entraîner des modèles d'IA sur une vidéo. Elle coûte 1 unité et fonctionne avec une clé d'API.

```ts
const { permitted } = await yt.videoTrainability.get({ id: videoId });
// ["all"], ["none"], ou une liste de tiers autorisés
```

## Mettre en ligne une vidéo

`yt.videos.insert` envoie un fichier, par morceaux, avec progression et reprise. Elle a sa propre enveloppe : 100 envois par jour par défaut. La page [Envois](/resources/uploads/) la décrit, avec les miniatures.

## Référence

Raccourcis :

| Raccourci | Ce qu'il fait | Quota |
| --- | --- | --- |
| `yt.videos.get(video, { part })` | Une vidéo à partir d'un identifiant ou d'une URL. `null` si elle est absente ou privée | 1 |
| `yt.videos.getMany(videos, { part })` | Plusieurs vidéos, dans l'ordre donné, les absentes étant omises | 1 par tranche de 50 |
| `yt.videos.popular({ regionCode, videoCategoryId, hl, maxResults, part })` | Le classement des plus populaires d'une région | 1 par page de 50 |
| `yt.videos.like(video)` | Aime une vidéo. OAuth | 50 |
| `yt.videos.dislike(video)` | N'aime pas une vidéo. OAuth | 50 |
| `yt.videos.unrate(video)` | Retire le « j'aime » ou le « je n'aime pas ». OAuth | 50 |
| `yt.videos.ratingOf(video)` | `"like"`, `"dislike"` ou `"none"`. OAuth | 1 |

Méthodes brutes :

| Méthode | Quota | Authentification |
| --- | --- | --- |
| `yt.videos.list` | 1 | Clé. OAuth pour `myRating` |
| `yt.videos.insert` | 1 appel de l'enveloppe `videos.insert` | OAuth |
| `yt.videos.update` | 50 | OAuth |
| `yt.videos.delete` | 50 | OAuth |
| `yt.videos.rate` | 50 | OAuth |
| `yt.videos.getRating` | 1 | OAuth |
| `yt.videos.reportAbuse` | 50 | OAuth |
| `yt.videos.batchGetStats` | 1 appel de l'enveloppe `videos.batchGetStats` | Clé |
| `yt.videoCategories.list` | 1 | Clé |
| `yt.videoAbuseReportReasons.list` | 1 | Clé |
| `yt.videoTrainability.get` | 1 | Clé |

`update`, `delete`, `rate` et `reportAbuse` acceptent les scopes `youtube`, `youtube.force-ssl` et `youtubepartner`. `getRating` accepte aussi `youtube.readonly`. La page [Scopes](/auth/scopes/) liste ce que chacun autorise.

Parties d'une vidéo :

| Partie | Ce qu'elle contient | Toujours renvoyée quand elle est demandée |
| --- | --- | --- |
| `snippet` | Titre, description, tags, catégorie, chaîne, date de publication, miniatures, `liveBroadcastContent` | Oui |
| `contentDetails` | Durée, définition, dimension, indicateur de sous-titres, projection, classification du contenu | Oui |
| `statistics` | Nombres de vues, de « j'aime » et de commentaires | Oui |
| `status` | Statut de confidentialité et d'envoi, licence, intégrable, indicateurs « conçu pour les enfants », `publishAt` programmé | Oui |
| `player` | Le HTML `<iframe>` d'un lecteur intégré | Oui |
| `liveStreamingDetails` | Horaires prévus et réels, spectateurs simultanés, identifiant du chat actif. Diffusions uniquement | Non |
| `localizations` | Titre et description par langue | Non |
| `topicDetails` | URL Wikipédia qui décrivent le contenu | Non |
| `recordingDetails` | Où et quand la vidéo a été enregistrée | Non |
| `paidProductPlacementDetails` | Indique si la vidéo contient une promotion payante. Propriétaire uniquement | Non |
| `fileDetails` | Le fichier envoyé : conteneur, flux, débit. Propriétaire uniquement | Non |
| `processingDetails` | Statut et progression du traitement. Propriétaire uniquement | Non |
| `suggestions` | Conseils de traitement, avertissements et suggestions de tags. Propriétaire uniquement | Non |
| `ageGating` | Détails de la restriction d'âge. Propriétaire uniquement | Non |
| `monetizationDetails` | Indique si la vidéo peut être monétisée | Non |
| `brandPartner` | Le partenaire de marque lié à la vidéo | Non |
| `projectDetails` | Déprécié | Non |
| `id` | Rien de plus : `kind`, `etag` et `id` sont présents sur chaque résultat | Oui |

## Voir aussi

- [Envois](/resources/uploads/) pour `videos.insert` et les miniatures.
- [Parties et types](/basics/parts-and-types/) pour savoir comment le type du résultat suit `part`.
- [Sous-titres](/resources/captions/) pour les pistes de sous-titres d'une vidéo.
- [Commentaires](/resources/comments/) pour lire et publier des commentaires.
