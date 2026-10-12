---
title: Commentaires
description: Lisez les commentaires d'une vidéo avec leurs réponses, publiez, répondez, modifiez et supprimez, et modérez les commentaires de vos propres vidéos.
sidebar:
  order: 5
---

```ts
const threads = await yt.commentThreads
  .forVideo(videoId, { order: "relevance" })
  .take(20);

for (const thread of threads) {
  const comment = thread.snippet.topLevelComment.snippet;
  console.log(comment.authorDisplayName, comment.textDisplay);
}
```

## Fils et commentaires

L'API a deux ressources, et le client aussi :

- Un fil de commentaires est un commentaire de premier niveau avec ce que l'on sait de ses réponses. `yt.commentThreads` liste les fils d'une vidéo ou d'une chaîne, et en publie de nouveaux.
- Un commentaire est un message, de premier niveau ou réponse. `yt.comments` liste les réponses, et permet de répondre, modifier, supprimer et modérer.

L'identifiant d'un fil est aussi celui de son commentaire de premier niveau.

## Lire les commentaires d'une vidéo

`yt.commentThreads.forVideo` accepte un identifiant ou une URL de vidéo. Elle fonctionne avec une clé d'API et coûte 1 unité de quota par page de 100 fils au plus.

```ts
const url = "https://youtu.be/dQw4w9WgXcQ";
const threads = yt.commentThreads.forVideo(url, { textFormat: "plainText" });

for await (const thread of threads) {
  console.log(thread.snippet.topLevelComment.snippet.textDisplay);
}
```

Cette boucle parcourt tous les fils de la vidéo, 100 par appel. Une vidéo de 10 000 commentaires de premier niveau coûte 100 unités. Utilisez `take` quand les premiers suffisent.

| Option | Valeurs | Effet |
| --- | --- | --- |
| `order` | `"time"`, `"relevance"` | Ordre de tri |
| `searchTerms` | Texte | Seulement les fils qui contiennent ces mots |
| `textFormat` | `"html"` (par défaut), `"plainText"` | Format de `textDisplay` |
| `moderationStatus` | `"published"` (par défaut), `"heldForReview"`, `"likelySpam"` | Seulement les fils dans cet état de modération. Les deux derniers ne sont visibles que du propriétaire de la chaîne ou de la vidéo |
| `maxResults` | 1-100 | Taille d'une page. Sans cette option, le raccourci demande 100 |
| `part` | `"snippet"` (par défaut), `"replies"`, `"id"` | Parties à récupérer |

```ts
const mentions = await yt.commentThreads
  .forVideo(videoId, { searchTerms: "subtitles", order: "time" })
  .take(50);
```

## La forme d'un fil

```ts
const thread = await yt.commentThreads.forVideo(videoId).first();

if (thread) {
  thread.id; // string, aussi l'identifiant du commentaire de premier niveau
  thread.snippet.totalReplyCount; // number
  thread.snippet.canReply; // boolean
  thread.snippet.videoId; // string | undefined

  const top = thread.snippet.topLevelComment;
  top.id; // string
  top.snippet.textDisplay; // string
  top.snippet.likeCount; // number
}
```

Un commentaire imbriqué dans un fil, `topLevelComment` ou une réponse en ligne, est typé avec son `snippet`. Inutile d'écrire `?.` pour le lire.

Dans le `snippet` d'un commentaire :

| Champ | Type | Remarques |
| --- | --- | --- |
| `textDisplay` | `string` | Le texte tel qu'il s'affiche, en HTML ou en texte brut selon `textFormat`. Il peut différer de ce qui a été saisi : les liens vers des vidéos deviennent des titres, par exemple |
| `textOriginal` | `string \| undefined` | Le texte brut tel que publié ou modifié en dernier. Garanti seulement si vous en êtes l'auteur |
| `authorDisplayName`, `authorProfileImageUrl`, `authorChannelUrl` | `string` | L'auteur |
| `authorChannelId` | `{ value?: string } \| undefined` | L'identifiant de la chaîne de l'auteur, dans `value` |
| `likeCount` | `number` | Un nombre, contrairement aux compteurs des vidéos et des chaînes |
| `publishedAt`, `updatedAt` | `string` | Dates ISO 8601 |
| `viewerRating` | `"none" \| "like" \| "dislike"` | La note que l'utilisateur authentifié a donnée au commentaire |
| `parentId` | `string \| undefined` | Identifiant du commentaire de premier niveau. Présent seulement sur les réponses |
| `videoId`, `channelId` | `string \| undefined` | L'objet du commentaire |
| `moderationStatus` | `"published" \| "heldForReview" \| "likelySpam" \| "rejected" \| undefined` | Absent quand le commentaire a été récupéré par identifiant |
| `imageUrl` | `string \| undefined` | Seulement si le commentaire contient une image ou un GIF. Le lien expire au bout de six heures |

## Lire les réponses

Demandez la partie `replies` et chaque fil arrive avec cinq réponses au plus, en ligne. La partie est optionnelle dans le type, parce qu'un fil sans réponse n'en a pas.

```ts
const threads = await yt.commentThreads
  .forVideo(videoId, { part: ["snippet", "replies"] })
  .take(20);

for (const thread of threads) {
  const inline = thread.replies?.comments ?? [];
  const { totalReplyCount } = thread.snippet;

  console.log(totalReplyCount, "replies,", inline.length, "inline");

  for (const reply of inline) console.log("  ", reply.snippet.textDisplay);
}
```

Pour toutes les réponses d'un fil, utilisez `yt.comments.replies` avec l'identifiant du fil. Elle coûte 1 unité par page de 100 réponses au plus.

```ts
const threads = await yt.commentThreads.forVideo(videoId).take(20);

for (const thread of threads) {
  // Rien à récupérer, rien à payer.
  if (thread.snippet.totalReplyCount === 0) continue;

  const replies = yt.comments.replies(thread.id, { textFormat: "plainText" });

  for await (const reply of replies) {
    console.log(reply.snippet.authorDisplayName, reply.snippet.textDisplay);
  }
}
```

Pour un export complet, demandez `replies` avec les fils, et n'appelez `yt.comments.replies` que pour les fils dont le `totalReplyCount` dépasse ce qui est arrivé en ligne. La recette [Exporter les commentaires d'une vidéo](/recipes/export-comments/) le montre.

## Publier un commentaire

`yt.commentThreads.post` publie un commentaire de premier niveau sur une vidéo. Elle exige OAuth et coûte 50 unités.

```ts
const thread = await yt.commentThreads.post(
  videoId,
  "Thanks for the walkthrough, the part on generics helped.",
);

console.log(thread.id, thread.snippet.topLevelComment.snippet.textDisplay);
```

## Répondre à un commentaire

`yt.comments.reply` prend l'identifiant du commentaire de premier niveau, qui est celui du fil. Elle exige OAuth et coûte 50 unités.

```ts
const thread = await yt.commentThreads
  .forVideo(videoId, { order: "time" })
  .first();

if (thread) {
  const reply = await yt.comments.reply(thread.id, "Thanks!");
  console.log(reply.id, reply.snippet.parentId);
}
```

YouTube n'a qu'un niveau de réponses. Pour répondre à une réponse, répondez à son fil : l'identifiant à utiliser est le `snippet.parentId` de cette réponse.

## Modifier et supprimer

`yt.comments.edit` remplace le texte d'un de vos commentaires. `yt.comments.delete` supprime un commentaire. Chacune exige OAuth et coûte 50 unités.

```ts
const edited = await yt.comments.edit(
  commentId,
  "Thanks! (edited: fixed the link)",
);

console.log(edited.snippet.textOriginal, edited.snippet.updatedAt);

await yt.comments.delete({ id: commentId });
```

## Modérer les commentaires

`yt.comments.setModerationStatus` publie des commentaires de votre chaîne ou de vos vidéos, les met en attente de validation ou les rejette. Elle accepte un identifiant ou une liste, et coûte 50 unités par appel.

```ts
const held = await yt.commentThreads
  .forVideo(videoId, { moderationStatus: "heldForReview" })
  .take(50);

for (const thread of held) {
  console.log(thread.id, thread.snippet.topLevelComment.snippet.textOriginal);
}

// Les approuver tous en un seul appel.
await yt.comments.setModerationStatus({
  id: held.map((thread) => thread.id),
  moderationStatus: "published",
});
```

`banAuthor: true` ajoute aussi l'auteur à la liste des utilisateurs bannis : ses futurs commentaires sont alors rejetés automatiquement. Cette option n'est valide qu'avec `"rejected"`.

```ts
await yt.comments.setModerationStatus({
  id: commentId,
  moderationStatus: "rejected",
  banAuthor: true,
});
```

Les états que vous pouvez définir sont `"published"`, `"heldForReview"` et `"rejected"`. `"likelySpam"` sert à filtrer, pas à définir, et le type le refuse :

```ts
await yt.comments.setModerationStatus({
  id: commentId,
  // @ts-expect-error "likelySpam" se lit, mais ne se définit pas
  moderationStatus: "likelySpam",
});
```

`yt.comments.markAsSpam` est dépréciée : YouTube ne la prend plus en charge. Rejetez plutôt le commentaire avec `setModerationStatus`.

## Lire les commentaires de toute une chaîne

La méthode brute `yt.commentThreads.list` accepte d'autres filtres qu'une vidéo. `allThreadsRelatedToChannelId` renvoie les fils de toutes les vidéos d'une chaîne, ainsi que les commentaires de la chaîne elle-même. Elle coûte 1 unité par page de 100 au plus, comme le reste.

```ts
const recent = await yt.commentThreads
  .list({
    part: "snippet",
    allThreadsRelatedToChannelId: channelId,
    order: "time",
  })
  .take(100);

for (const thread of recent) {
  const top = thread.snippet.topLevelComment;
  console.log(thread.snippet.videoId, top.snippet.textDisplay);
}
```

| Filtre de `commentThreads.list` | Renvoie |
| --- | --- |
| `videoId` | Les fils d'une vidéo. C'est ce qu'utilise `forVideo` |
| `allThreadsRelatedToChannelId` | Les fils de toutes les vidéos d'une chaîne, plus les commentaires de la chaîne elle-même |
| `channelId` | Les fils qui concernent la chaîne elle-même, sans ceux laissés sur ses vidéos |
| `id` | Les fils qui portent ces identifiants |

`yt.comments.list` récupère des commentaires par `id`, ou les réponses d'un commentaire avec `parentId`, ce qu'utilise `yt.comments.replies`.

```ts
const { items } = await yt.comments.list({
  part: "snippet",
  id: [commentId],
  textFormat: "plainText",
});
```

Attendues avec `await` sans `maxResults`, les deux méthodes brutes `list` renvoient la page par défaut de l'API, soit 20 éléments, alors que `forVideo` et `replies` en demandent 100.

## Ce que cela coûte

| Appel | Quota |
| --- | --- |
| Lire des fils ou des réponses | 1 unité par page de 100 au plus |
| Publier, répondre, modifier, supprimer | 50 unités chacun |
| Définir un état de modération | 50 unités par appel, quel que soit le nombre d'identifiants |

Lire coûte peu, écrire coûte cher : 200 réponses dans une journée consomment tout le budget par défaut de 10 000 unités.

## Scope et identifiants

La lecture fonctionne avec une clé d'API. Toute écriture exige OAuth avec le scope `youtube.force-ssl`, le seul que les méthodes de commentaires acceptent.

```ts
const { url } = await oauth.authUrl({ scopes: ["youtube.force-ssl"] });
```

Le client vérifie avant d'envoyer. Une écriture avec une simple clé d'API lève une `YouTubeAuthError` de code `MISSING_CREDENTIALS`. Une écriture avec un jeton accordé sans ce scope en lève une de code `INSUFFICIENT_SCOPE`. Ni l'une ni l'autre ne coûte de quota.

Une lecture avec un tel jeton part avec la clé d'API quand le client en a une. Sans clé, elle lève aussi `INSUFFICIENT_SCOPE`. La page [Scopes](/auth/scopes/) donne les détails.

## Gérer les erreurs

Un appel que l'API refuse lève une `YouTubeApiError`. Les motifs qui méritent une branche :

| `error.reason` | Quand |
| --- | --- |
| `commentsDisabled` | Les commentaires sont désactivés sur la vidéo |
| `forbidden` | La requête n'est pas autorisée avec ces identifiants |
| `videoNotFound`, `commentThreadNotFound`, `commentNotFound` | La vidéo, le fil ou le commentaire est introuvable |

```ts
try {
  await yt.commentThreads.post(videoId, "Nice one");
} catch (error) {
  if (!(error instanceof YouTubeApiError)) throw error;

  if (error.reason === "commentsDisabled") {
    console.log("Comments are turned off on this video");
  } else if (error.reason === "forbidden") {
    console.log("Not allowed:", error.message);
  } else {
    throw error;
  }
}
```

## Référence

Raccourcis :

| Raccourci | Effet | Quota |
| --- | --- | --- |
| `yt.commentThreads.forVideo(video, options)` | Les fils de commentaires d'une vidéo | 1 par page de 100 |
| `yt.commentThreads.post(video, text)` | Publie un commentaire de premier niveau. OAuth | 50 |
| `yt.comments.replies(parentId, { part, textFormat, maxResults })` | Toutes les réponses à un commentaire de premier niveau | 1 par page de 100 |
| `yt.comments.reply(parentId, text)` | Répond à un commentaire. OAuth | 50 |
| `yt.comments.edit(commentId, text)` | Remplace le texte d'un de vos commentaires. OAuth | 50 |

Méthodes brutes :

| Méthode | Quota | Authentification |
| --- | --- | --- |
| `yt.commentThreads.list` | 1 | Clé d'API, ou OAuth pour voir les données privées |
| `yt.commentThreads.insert` | 50 | OAuth |
| `yt.comments.list` | 1 | Clé d'API, ou OAuth pour voir les données privées |
| `yt.comments.insert` | 50 | OAuth |
| `yt.comments.update` | 50 | OAuth |
| `yt.comments.delete` | 50 | OAuth |
| `yt.comments.setModerationStatus` | 50 | OAuth |
| `yt.comments.markAsSpam` (déprécié) | 50 | OAuth |

Parties d'un fil de commentaires :

| Partie | Contenu | Toujours renvoyée quand demandée |
| --- | --- | --- |
| `snippet` | Le commentaire de premier niveau, `totalReplyCount`, `canReply`, `isPublic`, `videoId` | Oui |
| `replies` | Cinq réponses au plus, dans `comments` | Non |
| `id` | Rien de plus : `kind`, `etag` et `id` figurent sur chaque résultat | Oui |

Parties d'un commentaire :

| Partie | Contenu | Toujours renvoyée quand demandée |
| --- | --- | --- |
| `snippet` | Texte, auteur, nombre de mentions J'aime, dates, `parentId` | Oui |
| `id` | Rien de plus : `kind`, `etag` et `id` figurent sur chaque résultat | Oui |

## Voir aussi

- [Exporter les commentaires d'une vidéo](/recipes/export-comments/) pour un script d'export complet.
- [Listes](/basics/lists/) pour `take`, `all` et l'itération.
- [Scopes](/auth/scopes/) pour `youtube.force-ssl` et les autres.
- [Chat en direct](/live/live-chat/) pour les messages d'une diffusion en direct, qui ne sont pas des commentaires.
