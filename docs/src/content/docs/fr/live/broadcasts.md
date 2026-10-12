---
title: Diffusions et flux vidéo
description: Programmez une diffusion en direct, connectez-y un encodeur, lancez-la puis terminez-la. Toutes les méthodes de diffusion et de flux vidéo demandent OAuth et coûtent 1 unité.
sidebar:
  order: 1
---

```ts
const stream = await yt.liveStreams.insert({
  part: ["snippet", "cdn"],
  body: {
    snippet: { title: "Main encoder" },
    cdn: {
      ingestionType: "rtmp",
      resolution: "variable",
      frameRate: "variable",
    },
  },
});

const broadcast = await yt.liveBroadcasts.insert({
  part: ["snippet", "status", "contentDetails"],
  body: {
    snippet: {
      title: "Friday stream",
      scheduledStartTime: "2027-01-01T18:00:00Z",
    },
    status: { privacyStatus: "unlisted", selfDeclaredMadeForKids: false },
    contentDetails: { enableAutoStart: true, enableAutoStop: true },
  },
});

await yt.liveBroadcasts.bind({
  id: broadcast.id,
  streamId: stream.id,
  part: ["id", "contentDetails"],
});

const info = stream.cdn.ingestionInfo;
console.log(info?.ingestionAddress, info?.streamName);
```

## Deux objets

Passer en direct met en jeu deux ressources, et l'API les garde séparées.

| Ressource | Ce que c'est | Client |
| --- | --- | --- |
| Diffusion | L'événement que les spectateurs regardent : titre, programmation, confidentialité, état | `yt.liveBroadcasts` |
| Flux vidéo | Le point d'entrée auquel un encodeur envoie la vidéo | `yt.liveStreams` |

Une diffusion a un seul flux vidéo. Un flux vidéo peut alimenter plusieurs diffusions : une même configuration d'encodeur sert alors les émissions que vous programmez à des moments différents.

La séquence complète est la suivante : créer un flux vidéo, programmer une diffusion, les lier, démarrer l'encodeur, passer en direct, terminer. Chaque appel coûte 1 unité. Une clé d'API est refusée avant tout envoi : voir [Limites et erreurs](#limits-and-errors).

## Créer un flux vidéo

`liveStreams.insert` crée le point d'entrée et renvoie ce dont l'encodeur a besoin. Demandez la partie `cdn` pour le recevoir. Quota : 1 unité.

```ts
const stream = await yt.liveStreams.insert({
  part: ["snippet", "cdn", "contentDetails"],
  body: {
    snippet: { title: "Main encoder" },
    cdn: {
      ingestionType: "rtmp",
      resolution: "variable",
      frameRate: "variable",
    },
    contentDetails: { isReusable: true },
  },
});

const info = stream.cdn.ingestionInfo;
console.log(info?.ingestionAddress); // l'adresse à laquelle l'encodeur se connecte
console.log(info?.streamName); // la clé de flux
console.log(info?.rtmpsIngestionAddress); // le même point d'entrée en RTMPS
console.log(info?.backupIngestionAddress); // second point d'entrée, facultatif
```

Certains encodeurs prennent l'adresse et la clé dans deux champs. D'autres veulent une seule URL de la forme `ingestionAddress/streamName`.

`contentDetails.isReusable` décide si le flux vidéo peut être lié à plus d'une diffusion. Un flux vidéo non réutilisable ne peut être lié qu'une fois, peut être supprimé par YouTube à la fin de sa diffusion et n'apparaît pas dans `liveStreams.list({ mine: true })` : lisez-le plutôt par son `id`.

## Programmer une diffusion

`liveBroadcasts.insert` inscrit l'événement au programme. Quota : 1 unité.

```ts
const broadcast = await yt.liveBroadcasts.insert({
  part: ["snippet", "status", "contentDetails"],
  body: {
    snippet: {
      title: "Friday stream",
      description: "Questions welcome in the chat.",
      scheduledStartTime: "2027-01-01T18:00:00Z",
    },
    status: { privacyStatus: "unlisted", selfDeclaredMadeForKids: false },
    contentDetails: {
      enableAutoStart: true,
      enableAutoStop: true,
      enableDvr: true,
      latencyPreference: "low",
    },
  },
});

broadcast.status.lifeCycleStatus; // "ready" une fois les réglages complets
```

`enableAutoStart` et `enableAutoStop` demandent à YouTube de démarrer et de terminer la diffusion à votre place. Les deux sont désactivées par défaut. Laissez-les ainsi si vous voulez choisir vous-même le moment avec [`transition`](#going-live).

Une diffusion est une vidéo YouTube. Son titre, sa description et sa confidentialité se modifient par la diffusion ou par la ressource vidéo.

## Lier les deux

`liveBroadcasts.bind` rattache la diffusion au flux vidéo. Quota : 1 unité.

```ts
const bound = await yt.liveBroadcasts.bind({
  id: broadcastId,
  streamId,
  part: ["id", "contentDetails"],
});

bound.contentDetails.boundStreamId; // le flux vidéo qui alimente cette diffusion
```

Appelez la méthode sans `streamId` pour détacher le flux vidéo :

```ts
await yt.liveBroadcasts.bind({ id: broadcastId, part: "id" });
```

## Passer en direct

Démarrez l'encodeur, puis attendez que le flux vidéo indique `active`. Une diffusion ne peut pas passer à `testing` ni à `live` avant.

```ts
async function waitUntilActive(id: string): Promise<void> {
  for (;;) {
    const stream = await yt.liveStreams
      .list({ part: "status", id }, { cache: false })
      .first();
    if (stream?.status.streamStatus === "active") return;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

await waitUntilActive(streamId);
```

Chaque vérification est un appel à `liveStreams.list`, soit 1 unité. `cache: false` compte quand le client a un [cache](/basics/caching/) : une réponse mise en cache resterait la même jusqu'à son expiration.

Faites ensuite avancer la diffusion avec `liveBroadcasts.transition`. Quota : 1 unité par appel.

```ts
// Facultatif : une répétition que vous seul pouvez voir.
await yt.liveBroadcasts.transition({
  id: broadcastId,
  broadcastStatus: "testing",
  part: "status",
});

// Visible de son public.
const live = await yt.liveBroadcasts.transition({
  id: broadcastId,
  broadcastStatus: "live",
  part: "status",
});
live.status.lifeCycleStatus; // "liveStarting" pendant la transition

// Termine la diffusion.
await yt.liveBroadcasts.transition({
  id: broadcastId,
  broadcastStatus: "complete",
  part: "status",
});
```

## Lister vos diffusions

`liveBroadcasts.list` filtre par état. Quota : 1 unité par page.

```ts
const upcoming = await yt.liveBroadcasts.list({
  part: ["snippet", "status"],
  broadcastStatus: "upcoming",
});

for (const { snippet, status } of upcoming.items) {
  console.log(snippet.title, snippet.scheduledStartTime);
  console.log(status.lifeCycleStatus);
}

// Tout, sur toutes les pages.
const all = yt.liveBroadcasts.list({
  part: "snippet",
  broadcastStatus: "all",
});
for await (const broadcast of all) {
  console.log(broadcast.id, broadcast.snippet.title);
}
```

`broadcastStatus` vaut `"upcoming"`, `"active"`, `"completed"` ou `"all"`. Passez `id` à la place pour lire des diffusions précises. Au-delà de 50 identifiants, la demande est répartie en plusieurs appels, à 1 unité chacun.

Tant qu'une diffusion est en direct, la partie `statistics` indique le nombre de personnes qui la regardent :

```ts
const current = await yt.liveBroadcasts
  .list({ part: ["snippet", "statistics"], id: broadcastId }, { cache: false })
  .first();

// Une chaîne de caractères. Absente quand le propriétaire masque le nombre.
console.log(current?.statistics?.concurrentViewers);
```

## Modifier une diffusion

`liveBroadcasts.update` change le titre, la programmation, la confidentialité ou les réglages. Quota : 1 unité.

```ts
const current = await yt.liveBroadcasts
  .list({ part: "snippet", id: broadcastId })
  .first();

if (current) {
  await yt.liveBroadcasts.update({
    body: {
      id: broadcastId,
      snippet: {
        title: "Friday stream, part 2",
        description: current.snippet.description,
        scheduledStartTime: current.snippet.scheduledStartTime,
      },
    },
  });
}
```

:::caution
Lisez la partie, puis renvoyez ce que vous voulez conserver, comme le fait l'exemple. [Vidéos](/resources/videos/#updating-a-video) en explique la raison.
:::

`liveStreams.update` fait de même pour un flux vidéo. Une fois le flux vidéo créé, seuls le titre, la description et quelques réglages du CDN peuvent changer.

## Insérer une coupure publicitaire

`liveBroadcasts.insertCuepoint` insère une coupure publicitaire dans une diffusion en cours. Quota : 1 unité.

```ts
const cuepoint = await yt.liveBroadcasts.insertCuepoint({
  id: broadcastId,
  body: { cueType: "cueTypeAd", durationSecs: 30 },
});
```

Pour placer la coupure à un moment donné, ajoutez `insertionOffsetTimeMs` (un décalage par rapport au début réel de la diffusion) ou `walltimeMs` (une heure d'horloge). Les deux sont des nombres de millisecondes écrits sous forme de chaînes. Indiquez l'un ou l'autre, pas les deux. YouTube peut déplacer un point de repère de 5 secondes au plus.

## Lire l'état d'un flux vidéo

La partie `status` d'un flux vidéo indique si la vidéo arrive et sa qualité. Quota : 1 unité.

```ts
const stream = await yt.liveStreams
  .list({ part: ["snippet", "status"], id: streamId }, { cache: false })
  .first();

if (stream) {
  // "created" | "ready" | "active" | "inactive" | "error"
  console.log(stream.status.streamStatus);
  // "good" | "ok" | "bad" | "noData" | "revoked"
  console.log(stream.status.healthStatus?.status);

  for (const issue of stream.status.healthStatus?.configurationIssues ?? []) {
    console.log(issue.severity, issue.reason, issue.description);
  }
}
```

`configurationIssues` est l'endroit où YouTube signale ce qui ne va pas dans ce que l'encodeur envoie : débit, intervalle d'images clés, codec, résolution. Chaque problème a une `severity` valant `info`, `warning` ou `error`.

Listez tous les flux vidéo réutilisables du compte avec `mine: true` :

```ts
const { items } = await yt.liveStreams.list({
  part: ["snippet", "cdn", "status"],
  mine: true,
});
```

## Ouvrir le chat d'une diffusion

La diffusion porte l'identifiant de son chat dans `snippet.liveChatId`.

```ts
const broadcast = await yt.liveBroadcasts
  .list({ part: "snippet", id: broadcastId })
  .first(); // 1 unité

if (broadcast?.snippet.liveChatId) {
  const chat = yt.liveChat(broadcast.snippet.liveChatId);
  await chat.send("We are live."); // 20 unités
}
```

[Chat en direct](/live/live-chat/) couvre la lecture, l'écriture et la modération.

## Supprimer

Les deux suppressions coûtent 1 unité.

```ts
await yt.liveBroadcasts.delete({ id: broadcastId });
await yt.liveStreams.delete({ id: streamId });
```

## Une chaîne est-elle en direct en ce moment ?

Tout ce qui précède concerne vos propres diffusions et demande OAuth. Pour savoir si une chaîne quelconque est en direct, une clé d'API suffit.

Une recherche limitée aux événements en direct répond pour une chaîne que vous ne connaissez que par son identifiant :

```ts
const [live] = await yt.search.live("", { channelId }).take(1);

if (live) console.log("Live now:", live.snippet.title, live.id.videoId);
```

C'est un appel à `search.list`. Il est compté dans l'enveloppe de recherche, qui contient 100 appels par jour par défaut : voir [Quota](/basics/quota/#buckets). Ne l'interrogez pas toutes les minutes.

Quand vous avez déjà l'identifiant d'une vidéo, `videos.list` coûte 1 unité de l'enveloppe commune et en dit plus :

```ts
const video = await yt.videos.get(videoId, {
  part: ["snippet", "liveStreamingDetails"],
});

if (video?.snippet.liveBroadcastContent === "live") {
  console.log(video.liveStreamingDetails?.actualStartTime);
  console.log(video.liveStreamingDetails?.concurrentViewers);
  console.log(video.liveStreamingDetails?.activeLiveChatId);
}
```

[Vidéos](/resources/videos/) décrit `liveBroadcastContent` et `liveStreamingDetails`.

## Référence

### Méthodes

Toutes les méthodes coûtent 1 unité et demandent OAuth.

| Méthode | Ce qu'elle fait |
| --- | --- |
| `yt.liveStreams.insert` | Crée un flux vidéo et renvoie l'adresse d'entrée et la clé de flux |
| `yt.liveStreams.list` | Liste vos flux vidéo avec `mine: true`, ou en lit certains par `id` |
| `yt.liveStreams.update` | Change le titre, la description ou quelques réglages du CDN |
| `yt.liveStreams.delete` | Supprime un flux vidéo |
| `yt.liveBroadcasts.insert` | Programme une diffusion |
| `yt.liveBroadcasts.bind` | Rattache une diffusion à un flux vidéo, ou la détache sans `streamId` |
| `yt.liveBroadcasts.transition` | Fait passer une diffusion à `testing`, `live` ou `complete` |
| `yt.liveBroadcasts.list` | Liste vos diffusions par `broadcastStatus`, ou en lit certaines par `id` |
| `yt.liveBroadcasts.update` | Change le titre, la programmation, la confidentialité ou les réglages |
| `yt.liveBroadcasts.insertCuepoint` | Insère une coupure publicitaire |
| `yt.liveBroadcasts.delete` | Supprime une diffusion |

`part` est obligatoire sur `list`, `bind` et `transition`. Sur `insert` et `update`, il prend par défaut les parties présentes dans `body`.

### `status.lifeCycleStatus` d'une diffusion

| Valeur | Signification |
| --- | --- |
| `created` | Valide, mais ses réglages sont incomplets |
| `ready` | Réglages complets |
| `testStarting` | Un passage à `testing` a été demandé |
| `testing` | Visible de vous seul |
| `liveStarting` | Un passage à `live` a été demandé |
| `live` | À l'antenne |
| `complete` | Terminée |
| `revoked` | Retirée par une action d'administration |

### `status.streamStatus` d'un flux vidéo

`created`, `ready`, `active`, `inactive` ou `error`. Une diffusion ne peut passer à `testing` ou à `live` que si son flux vidéo est `active`.

### Réglages de `contentDetails` d'une diffusion

| Champ | Signification |
| --- | --- |
| `enableAutoStart` | Démarrer la diffusion automatiquement. Faux par défaut |
| `enableAutoStop` | Terminer la diffusion automatiquement. Faux par défaut |
| `enableDvr` | Les spectateurs peuvent mettre en pause, revenir en arrière et avancer. Vrai par défaut |
| `enableEmbed` | La diffusion peut être lue dans un lecteur intégré |
| `recordFromStart` | Enregistrer dès que la diffusion passe en direct. Vrai par défaut |
| `latencyPreference` | `"normal"`, `"low"` ou `"ultraLow"`. `ultraLow` ne prend en charge ni les sous-titres codés, ni le 1440p, ni la 4K |
| `monitorStream.enableMonitorStream` | Active un flux que vous seul voyez, pour vérifier le contenu. Ne peut plus être modifié une fois la diffusion à l'état `testing` ou `live` |
| `monitorStream.broadcastStreamDelayMs` | Retard de la diffusion quand le flux de contrôle est activé |
| `closedCaptionsType` | `"closedCaptionsDisabled"`, `"closedCaptionsHttpPost"` ou `"closedCaptionsEmbedded"` |
| `projection` | `"rectangular"` (par défaut), `"360"` ou `"mesh"` |
| `boundStreamId` | Le flux vidéo lié à la diffusion |

Pour que l'archive soit lisible dès la fin de la diffusion, laissez `enableDvr` et `recordFromStart` à vrai.

## Limites et erreurs

Avec une clé d'API et sans OAuth, chaque méthode de la référence ci-dessus lève une `YouTubeAuthError` avec le code `MISSING_CREDENTIALS` avant tout envoi. Aucun quota n'est dépensé, et le message liste les scopes qui conviennent.

| Appels | Scopes, un seul suffit |
| --- | --- |
| `list` sur les diffusions et les flux vidéo | `youtube.readonly`, `youtube`, `youtube.force-ssl` |
| Toute écriture | `youtube`, `youtube.force-ssl` |
| `insertCuepoint` | `youtube`, `youtube.force-ssl`, `youtubepartner` |

Quand le client connaît les scopes du jeton et qu'aucun ne convient, l'appel échoue de la même façon avec `INSUFFICIENT_SCOPE`. [Scopes](/auth/scopes/) donne la liste complète.

Les erreurs de l'API arrivent sous la forme d'une `YouTubeApiError`. Les raisons sur lesquelles il vaut la peine de brancher ici :

| `error.reason` | Quand |
| --- | --- |
| `liveBroadcastNotFound` | Aucune diffusion ne correspond à l'identifiant |
| `liveStreamNotFound` | Aucun flux vidéo ne correspond à l'identifiant |

```ts
try {
  await yt.liveBroadcasts.transition({
    id: broadcastId,
    broadcastStatus: "live",
    part: "status",
  });
} catch (error) {
  if (!(error instanceof YouTubeApiError)) throw error;
  console.error(error.status, error.reason, error.message);
}
```

Une transition que l'API refuse, par exemple passer à `live` alors que le flux vidéo n'est pas `active`, revient aussi sous la forme d'une `YouTubeApiError`. Journalisez `error.reason` et `error.message`.

## Voir aussi

- [Chat en direct](/live/live-chat/) pour lire et modérer le chat d'une diffusion.
- [OAuth](/auth/oauth/) et [Scopes](/auth/scopes/) pour les identifiants que ces appels demandent.
- [Recherche](/resources/search/) pour les autres filtres de `yt.search.live`.
- [Toutes les méthodes](/reference/methods/) pour la liste complète avec les coûts.
