---
title: Abonnements
description: Abonnez-vous et désabonnez-vous par handle, URL ou identifiant, listez les chaînes qu'un utilisateur suit et ses abonnés, et lisez les membres d'une chaîne.
sidebar:
  order: 6
---

```ts
const subscription = await yt.subscriptions.to("@GoogleDevelopers");

if (!subscription) {
  await yt.subscriptions.subscribe("@GoogleDevelopers");
}
```

Tout ce qui touche aux abonnements de l'utilisateur authentifié exige OAuth. Une clé d'API ne liste que les abonnements d'une chaîne qui les a rendus publics.

## Vérifier un abonnement

`yt.subscriptions.to` cherche l'abonnement de l'utilisateur authentifié à une chaîne. Elle renvoie l'abonnement, ou `null` si l'utilisateur n'est pas abonné. La chaîne peut être un identifiant, un handle ou une URL.

```ts
const subscription = await yt.subscriptions.to(
  "https://www.youtube.com/@GoogleDevelopers",
);

if (subscription) {
  const { title, publishedAt } = subscription.snippet;

  console.log(subscription.id); // l'identifiant de l'abonnement, nécessaire pour le supprimer
  console.log(title, "since", publishedAt);
}
```

L'appel coûte 1 unité de quota, plus 1 la première fois qu'un handle ou un nom doit être converti en identifiant de chaîne. Une référence qui ne correspond à aucune chaîne lève une `YouTubeArgumentError`.

## S'abonner et se désabonner

`yt.subscriptions.subscribe` abonne l'utilisateur authentifié à une chaîne et renvoie le nouvel abonnement. Elle coûte 50 unités.

```ts
const subscription = await yt.subscriptions.subscribe("@GoogleDevelopers");

console.log(subscription.id, subscription.snippet.title);
```

`yt.subscriptions.unsubscribe` cherche l'abonnement, puis le supprime. Elle renvoie `false` quand l'utilisateur n'était pas abonné, ce qui coûte 1 unité. Un désabonnement effectif coûte 51 unités : 1 pour trouver l'abonnement, 50 pour le supprimer.

```ts
const removed = await yt.subscriptions.unsubscribe("@GoogleDevelopers");

console.log(removed ? "Unsubscribed" : "Was not subscribed");
```

S'abonner à une chaîne que l'utilisateur suit déjà échoue avec le motif `subscriptionDuplicate`. Interceptez l'erreur, ou vérifiez d'abord avec `to` pour 1 unité :

```ts
try {
  await yt.subscriptions.subscribe(channelId);
} catch (error) {
  if (
    error instanceof YouTubeApiError &&
    error.reason === "subscriptionDuplicate"
  ) {
    console.log("Already subscribed");
  } else {
    throw error;
  }
}
```

## Lister vos abonnements

La méthode brute `yt.subscriptions.list` avec `mine: true` liste les chaînes que l'utilisateur authentifié suit. Elle coûte 1 unité par page de 50.

```ts
const mine = yt.subscriptions.list({
  part: "snippet",
  mine: true,
  order: "alphabetical",
});

for await (const subscription of mine) {
  const { title, resourceId } = subscription.snippet;
  console.log(title, resourceId.channelId);
}
```

Dans le `snippet` d'un abonnement, `title`, `description` et `thumbnails` décrivent la chaîne à laquelle on est abonné. Son identifiant est `snippet.resourceId.channelId`. `snippet.channelId` désigne l'autre côté : la chaîne de l'abonné.

| `order` | Trie par |
| --- | --- |
| `"alphabetical"` | Ordre alphabétique |
| `"relevance"` | Pertinence |
| `"unread"` | Ordre d'activité |

La partie `contentDetails` ajoute des compteurs :

```ts
const subscriptions = await yt.subscriptions
  .list({ part: ["snippet", "contentDetails"], mine: true, order: "unread" })
  .take(20);

for (const subscription of subscriptions) {
  const { newItemCount } = subscription.contentDetails;
  console.log(subscription.snippet.title, newItemCount, "new");
}
```

Pour tester plusieurs chaînes d'un coup, passez leurs identifiants à `forChannelId`, séparés par des virgules. Seules celles que l'utilisateur suit sont renvoyées :

```ts
const followed = await yt.subscriptions
  .list({ part: "snippet", mine: true, forChannelId: ids.join(",") })
  .all();

const followedIds = new Set(
  followed.map((subscription) => subscription.snippet.resourceId.channelId),
);
```

C'est une méthode brute : attendue avec `await` sans `maxResults`, elle renvoie la page par défaut de l'API, soit 5 éléments. L'itération, `take` et `all` demandent des pages de 50.

## Lister les abonnements d'une chaîne

Avec `channelId`, la même méthode liste les chaînes qu'une chaîne suit. Cela fonctionne avec une clé d'API, mais seulement si la chaîne a rendu ses abonnements publics.

```ts
const subscriptions = await yt.subscriptions
  .list({ part: "snippet", channelId })
  .take(50);

for (const subscription of subscriptions) {
  console.log(subscription.snippet.title);
}
```

Quand ils sont privés, l'appel échoue avec le motif `subscriptionForbidden` :

```ts
try {
  await yt.subscriptions.list({ part: "snippet", channelId }).take(50);
} catch (error) {
  if (
    error instanceof YouTubeApiError &&
    error.reason === "subscriptionForbidden"
  ) {
    console.log("This channel keeps its subscriptions private");
  } else {
    throw error;
  }
}
```

## Lister vos abonnés

`mySubscribers: true` inverse la liste : elle renvoie les abonnements d'autres utilisateurs à la chaîne de l'utilisateur authentifié. Demandez la partie `subscriberSnippet`, qui décrit l'abonné.

```ts
const subscribers = yt.subscriptions.list({
  part: "subscriberSnippet",
  mySubscribers: true,
});

for await (const subscription of subscribers) {
  const subscriber = subscription.subscriberSnippet;
  console.log(subscriber.title, subscriber.channelId);
}
```

`myRecentSubscribers: true` les liste du plus récent au plus ancien :

```ts
const recent = await yt.subscriptions
  .list({ part: ["snippet", "subscriberSnippet"], myRecentSubscribers: true })
  .take(20);

for (const subscription of recent) {
  const { title } = subscription.subscriberSnippet;
  console.log(title, subscription.snippet.publishedAt);
}
```

Les deux exigent OAuth et coûtent 1 unité par page de 50. Pour connaître le nombre d'abonnés, lisez plutôt `statistics.subscriberCount` sur la [chaîne](/resources/channels/).

## Utiliser les méthodes brutes insert et delete

`subscribe` et `unsubscribe` reposent sur `yt.subscriptions.insert` et `yt.subscriptions.delete`. Utilisez-les quand vous avez déjà les identifiants. Chacune coûte 50 unités.

```ts
const created = await yt.subscriptions.insert({
  part: "snippet",
  body: { snippet: { resourceId: { kind: "youtube#channel", channelId } } },
});

await yt.subscriptions.delete({ id: created.id });
```

`delete` prend l'identifiant de l'abonnement, pas celui de la chaîne. Conservez-le à la création de l'abonnement, ou retrouvez-le avec `yt.subscriptions.to`.

## Lire les membres d'une chaîne

Les membres d'une chaîne sont ses membres payants, ce qui diffère de ses abonnés. Deux méthodes les lisent, pour la chaîne de l'utilisateur authentifié uniquement :

- `yt.members.list` liste les membres.
- `yt.membershipsLevels.list` liste les niveaux que la chaîne propose.

Les deux exigent l'accord préalable de YouTube pour votre projet. Les deux exigent OAuth avec le scope `youtube.channel-memberships.creator`, et coûtent 1 unité.

```ts
const members = await yt.members
  .list({ part: "snippet", mode: "all_current" })
  .all();

for (const member of members) {
  const details = member.snippet.memberDetails;
  const membership = member.snippet.membershipsDetails;
  const months = membership?.membershipsDuration?.memberTotalDurationMonths;

  console.log(details?.displayName, details?.channelId);
  console.log(membership?.highestAccessibleLevelDisplayName, months, "months");
}
```

| Option de `members.list` | Effet |
| --- | --- |
| `mode: "all_current"` | Tous les membres actuels, du plus récent au plus ancien |
| `mode: "updates"` | Seulement les membres arrivés après le premier appel fait avec ce mode |
| `hasAccessToLevel` | Seulement les membres qui ont accès à ce niveau (son identifiant) |
| `filterByMemberChannelId` | Seulement ces membres : des identifiants de chaînes séparés par des virgules |
| `maxResults` | 0-1000, 5 par défaut. L'itération et `all` utilisent 1000 |

```ts
const { items } = await yt.membershipsLevels.list({ part: "snippet" });

for (const level of items) {
  console.log(level.id, level.snippet.levelDetails?.displayName);
}
```

Le `snippet` d'un membre ou d'un niveau est présent quand vous le demandez. Chaque champ qu'il contient est optionnel dans le type : lisez-les avec `?.`.

## Référence

Raccourcis :

| Raccourci | Effet | Quota |
| --- | --- | --- |
| `yt.subscriptions.to(channel)` | L'abonnement de l'utilisateur à une chaîne, ou `null`. OAuth | 1 |
| `yt.subscriptions.subscribe(channel)` | Abonne l'utilisateur à une chaîne. OAuth | 50 |
| `yt.subscriptions.unsubscribe(channel)` | Désabonne. `false` si l'utilisateur n'était pas abonné. OAuth | 1, plus 50 quand un abonnement est supprimé |

Les trois raccourcis ajoutent 1 unité la première fois qu'ils résolvent un handle ou un nom, comme le fait [`yt.channels.resolveId`](/resources/channels/#getting-only-the-id). Passez un identifiant `UC...` pour l'éviter.

Méthodes brutes :

| Méthode | Quota | Authentification |
| --- | --- | --- |
| `yt.subscriptions.list` | 1 | Clé d'API avec `channelId`. OAuth pour `mine`, `mySubscribers` et `myRecentSubscribers` |
| `yt.subscriptions.insert` | 50 | OAuth |
| `yt.subscriptions.delete` | 50 | OAuth |
| `yt.members.list` | 1 | OAuth, `youtube.channel-memberships.creator` |
| `yt.membershipsLevels.list` | 1 | OAuth, `youtube.channel-memberships.creator` |

`insert` et `delete` acceptent les scopes `youtube`, `youtube.force-ssl` et `youtubepartner`. `list` accepte aussi `youtube.readonly`. La page [Scopes](/auth/scopes/) détaille ce que chacun accorde.

Parties d'un abonnement :

| Partie | Contenu | Toujours renvoyée quand demandée |
| --- | --- | --- |
| `snippet` | La chaîne à laquelle on est abonné (`title`, `description`, `thumbnails`, `resourceId`), le `channelId` de l'abonné, la date | Oui |
| `contentDetails` | `totalItemCount`, `newItemCount`, `activityType` | Oui |
| `subscriberSnippet` | L'abonné : `title`, `description`, `channelId`, `thumbnails` | Oui |
| `id` | Rien de plus : `kind`, `etag` et `id` figurent sur chaque résultat | Oui |

Un membre et un niveau d'abonnement payant portent leurs données dans une seule partie, `snippet`.

## Voir aussi

- [Chaînes](/resources/channels/) pour le nombre d'abonnés et la résolution des handles.
- [Scopes](/auth/scopes/) pour ce que chaque scope accorde.
- [OAuth](/auth/oauth/) pour obtenir un jeton pour l'utilisateur.
- [Surveiller les nouvelles vidéos](/notifications/watching-uploads/) pour suivre des chaînes sans s'y abonner.
