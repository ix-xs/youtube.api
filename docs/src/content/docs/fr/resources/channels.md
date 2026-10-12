---
title: Chaînes
description: Lisez une chaîne à partir d'un handle, d'une URL ou d'un identifiant, listez ses envois et modifiez son image de marque et son onglet d'accueil.
sidebar:
  order: 1
---

```ts
const channel = await yt.channels.get("@GoogleDevelopers");

if (channel) {
  console.log(channel.id, channel.snippet.title);
  console.log(channel.statistics.videoCount, "videos");
}
```

## Récupérer une chaîne

`yt.channels.get` accepte ce que vous avez sous la main et renvoie la chaîne, ou `null` si rien ne correspond. Elle coûte 1 unité de quota, ou 2 quand un nom doit être essayé deux fois.

```ts
await yt.channels.get("UC_x5XG1OV2P6uZZ5FSM9Ttw"); // un identifiant
await yt.channels.get("@GoogleDevelopers"); // un handle
await yt.channels.get("GoogleDevelopers"); // un nom seul

// URL : un handle sur n'importe quel onglet, un identifiant de chaîne, un ancien nom d'utilisateur.
await yt.channels.get("https://www.youtube.com/@GoogleDevelopers/videos");
await yt.channels.get("youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw");
await yt.channels.get("https://www.youtube.com/user/GoogleDevelopers");
```

Ce qui est envoyé dépend de ce que vous passez :

| Vous passez | Recherche par | Coût |
| --- | --- | --- |
| Un identifiant, ou une URL `/channel/UC...` | `id` | 1 |
| `@handle`, ou une URL `/@handle` | `forHandle` | 1 |
| Une URL `/user/name` | `forUsername` | 1 |
| Un nom seul | `forHandle`, puis `forUsername` si aucun handle ne correspond | 1 ou 2 |
| Une URL `/c/name`, ou `youtube.com/name` | `forHandle`, puis `forUsername` si aucun handle ne correspond | 1 ou 2 |

Un nom seul est d'abord essayé comme handle, car c'est de loin le cas le plus courant aujourd'hui. Les anciens comptes répondent encore à un nom d'utilisateur, d'où le second essai. Un point ne transforme pas un nom seul en URL : `"some.name"` est lu comme un handle.

L'API n'a aucune recherche pour les anciennes URL `/c/name`. Le raccourci essaie le nom comme handle, puis comme nom d'utilisateur, car le nom survit le plus souvent sous forme de handle. C'est une supposition : elle peut aboutir à `null` pour une chaîne qui existe. Gardez donc l'URL `/channel/UC...` ou le handle quand vous avez le choix.

Une chaîne vide, ou une URL qui n'est pas celle d'une chaîne, lève une `YouTubeArgumentError` avant tout envoi.

Les parties par défaut sont `snippet`, `contentDetails` et `statistics`. Passez `part` pour les changer :

```ts
const slim = await yt.channels.get("@GoogleDevelopers", { part: "snippet" });
// Channel<"snippet"> | null
```

## Récupérer votre propre chaîne

`yt.channels.mine` récupère la chaîne de l'utilisateur authentifié. Elle exige OAuth et coûte 1 unité. Elle renvoie `null` pour un compte Google sans chaîne YouTube.

```ts
const me = await yt.channels.mine({ part: ["snippet", "status"] });

if (me) console.log(me.snippet.title, me.status.privacyStatus);
```

## Obtenir seulement l'identifiant

La plus grande partie de l'API veut un identifiant `UC...`. `yt.channels.resolveId` en tire un de n'importe quelle référence, et renvoie `null` si aucune chaîne ne correspond.

```ts
// Aucun appel : l'identifiant est lu dans la chaîne de caractères.
await yt.channels.resolveId("UC_x5XG1OV2P6uZZ5FSM9Ttw");
await yt.channels.resolveId("youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw");

// 1 unité la première fois.
await yt.channels.resolveId("@GoogleDevelopers");

// Aucun appel : le même handle, écrit autrement.
await yt.channels.resolveId("https://www.youtube.com/@googledevelopers");
```

Les identifiants et les URL `/channel/` ne coûtent rien. Un handle ou un nom d'utilisateur coûte 1 unité la première fois, ou 2 pour un nom seul qui se révèle être un ancien nom d'utilisateur. Le client retient ensuite la réponse tant qu'il vit, quelle que soit la façon d'écrire le handle : avec ou sans `@`, dans une autre casse, ou sous forme d'URL. Il retient aussi chaque chaîne trouvée par `get`.

Les raccourcis qui prennent une chaîne (`uploads`, `latestVideos`, `latestVideo` et ceux de `yt.subscriptions`) la résolvent de cette façon. C'est le « plus 1 la première fois » de leurs coûts.

## Lister les envois d'une chaîne

`yt.channels.uploads` lit la playlist des envois de la chaîne, du plus récent au plus ancien. Elle coûte 1 unité par page de 50 vidéos, là où une recherche consommerait l'un de vos 100 appels de recherche quotidiens. Attendue avec `await`, elle renvoie une page de 50.

```ts
for await (const item of yt.channels.uploads("@GoogleDevelopers")) {
  console.log(item.contentDetails.videoId, item.snippet.title);
}

const lastTenShorts = await yt.channels
  .uploads(channelId, { kind: "shorts" })
  .take(10);
```

Les éléments sont des éléments de playlist, avec les parties `snippet` et `contentDetails` par défaut : un titre et l'identifiant de la vidéo, mais ni durée ni statistiques. La page [Playlists](/resources/playlists/) les décrit.

`kind` restreint la liste :

| `kind` | Ce qui est listé |
| --- | --- |
| `"uploads"` (par défaut) | Tout ce que la chaîne a envoyé |
| `"videos"` | Les vidéos classiques, sans les Shorts ni les directs |
| `"shorts"` | Les Shorts uniquement |
| `"live"` | Les directs uniquement |

Quatre autres valeurs existent : `"popularVideos"`, `"popularShorts"`, `"popularLive"` et `"membersOnlyVideos"`. Seule la playlist des envois est documentée par YouTube. [ID et URL](/basics/ids-and-urls/) donne les détails.

Une chaîne qui n'a jamais rien envoyé n'a pas de playlist d'envois : la requête échoue alors avec une erreur `NOT_FOUND`. Une référence qui ne correspond à aucune chaîne lève une `YouTubeArgumentError`.

```ts
try {
  const items = await yt.channels.uploads(channelId).take(50);
  console.log(items.length);
} catch (error) {
  if (isYouTubeError(error, "NOT_FOUND")) {
    console.log("This channel has no uploads");
  } else {
    throw error;
  }
}
```

## Récupérer les dernières vidéos

`yt.channels.latestVideos` va un cran plus loin : elle lit la playlist des envois, puis récupère les vidéos elles-mêmes, ce qui vous donne les durées et les statistiques.

```ts
const videos = await yt.channels.latestVideos("@GoogleDevelopers", {
  limit: 3,
});

for (const video of videos) {
  const duration = formatDuration(video.contentDetails.duration);
  console.log(video.snippet.title, duration, video.statistics.viewCount);
}
```

Elle coûte 2 unités pour 50 vidéos au plus, plus 1 pour résoudre un handle la première fois. `limit` vaut 5 par défaut. `kind` fonctionne comme pour `uploads`, et `part` choisit les parties des vidéos (`snippet`, `contentDetails` et `statistics` par défaut).

Une chaîne sans envois donne un tableau vide, pas une erreur. Une référence qui ne correspond à aucune chaîne lève une `YouTubeArgumentError`.

`yt.channels.latestVideo` renvoie la plus récente, ou `null` :

```ts
const video = await yt.channels.latestVideo("@GoogleDevelopers", {
  kind: "videos",
});

if (video) console.log(`Latest video: ${video.snippet.title}`);
```

Pour être prévenu quand une chaîne publie, n'interrogez pas cette méthode en boucle : utilisez [Surveiller les nouvelles vidéos](/notifications/watching-uploads/).

## Lire les statistiques

Les compteurs sont des chaînes de caractères, car ce sont des entiers sur 64 bits. Convertissez-les avec `Number()` ou affichez-les avec [`formatCount`](/basics/ids-and-urls/#formatting).

```ts
const channel = await yt.channels.get("@GoogleDevelopers", {
  part: "statistics",
});

if (channel) {
  const { viewCount, videoCount, subscriberCount, hiddenSubscriberCount } =
    channel.statistics;

  console.log(Number(videoCount), formatCount(viewCount));
  console.log(
    hiddenSubscriberCount ? "hidden" : formatCount(subscriberCount ?? "0"),
  );
}
```

| Champ | Type | Remarques |
| --- | --- | --- |
| `viewCount` | `string` | Toujours présent |
| `videoCount` | `string` | Toujours présent |
| `hiddenSubscriberCount` | `boolean` | `true` quand la chaîne masque son nombre d'abonnés |
| `subscriberCount` | `string \| undefined` | Absent quand le nombre est masqué |

YouTube arrondit le nombre d'abonnés public à la baisse, à trois chiffres significatifs : une chaîne de 123 456 abonnés indique `"123000"`. C'est l'API qui arrondit, pas la bibliothèque, donc aucune option ne le désactive.

## Utiliser `channels.list` brut

Les raccourcis appellent `yt.channels.list`, que vous pouvez utiliser directement. Elle coûte 1 unité et accepte un seul filtre :

| Filtre | Renvoie | Authentification |
| --- | --- | --- |
| `id` | Les chaînes ayant ces identifiants. Un identifiant ou une liste | Clé |
| `forHandle` | La chaîne ayant ce handle | Clé |
| `forUsername` | La chaîne ayant cet ancien nom d'utilisateur | Clé |
| `mine: true` | La chaîne de l'utilisateur authentifié | OAuth |
| `managedByMe: true` | Les chaînes gérées par l'utilisateur authentifié | OAuth |
| `mySubscribers: true` | Les chaînes abonnées à l'utilisateur authentifié | OAuth |

```ts
const { items } = await yt.channels.list({
  part: ["snippet", "statistics"],
  id: ids,
});

for (const channel of items) {
  console.log(channel.snippet.title, channel.statistics.videoCount);
}
```

`id` accepte autant d'identifiants que vous voulez. Les listes de plus de 50 sont découpées en appels de 50, à 1 unité chacun, puis fusionnées. `hl` choisit la langue de `snippet.localized`.

## Modifier les réglages d'image de marque

`yt.channels.update` modifie les réglages d'image de marque d'une chaîne, ses localisations ou son statut « conçu pour les enfants ». Elle exige OAuth et coûte 50 unités.

Une partie que vous envoyez remplace toute la partie. Lisez-la, modifiez-la, renvoyez-la :

```ts
const channel = await yt.channels.mine({ part: "brandingSettings" });

if (channel) {
  const branding = channel.brandingSettings;

  await yt.channels.update({
    body: {
      id: channel.id,
      brandingSettings: {
        ...branding,
        channel: { ...branding.channel, description: "New description" },
      },
    },
  });
}
```

La bannière se définit de la même façon, après l'envoi de l'image : voir [Envois](/resources/uploads/).

## Modifier l'onglet d'accueil

Les sections de chaîne sont les étagères de l'onglet d'accueil. Les lire coûte 1 unité et fonctionne avec une clé d'API. Les écrire exige OAuth et coûte 50 unités par appel.

```ts
const { items } = await yt.channelSections.list({
  part: ["snippet", "contentDetails"],
  channelId,
});

for (const section of items) {
  const { position, type, title } = section.snippet;
  console.log(position, type, title);
}
```

```ts
const section = await yt.channelSections.insert({
  body: {
    snippet: { type: "singlePlaylist", position: 0 },
    contentDetails: { playlists: [playlistId] },
  },
});

await yt.channelSections.update({
  body: {
    id: section.id,
    snippet: { type: "singlePlaylist", position: 2 },
    contentDetails: { playlists: [playlistId] },
  },
});

await yt.channelSections.delete({ id: section.id });
```

Une chaîne peut avoir 10 sections au plus. `snippet.type` indique ce que montre l'étagère : `"singlePlaylist"`, `"multiplePlaylists"`, `"multipleChannels"`, `"recentUploads"`, `"popularUploads"` et d'autres, tous listés par le type. `contentDetails.playlists` porte les identifiants de playlist des deux types de playlist, `contentDetails.channels` les identifiants de chaîne de `"multipleChannels"`. Comme pour toute mise à jour, une partie que vous envoyez remplace toute la partie.

`list` accepte `channelId`, `mine: true` ou `id`.

## Lire l'activité récente

`yt.activities.list` liste ce qu'une chaîne a fait récemment : envois, mentions « j'aime » rendues publiques, ajouts à des playlists, etc. Elle coûte 1 unité par page de 50 au plus, et accepte `channelId` avec une clé d'API ou `mine: true` avec OAuth.

```ts
const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

const activities = await yt.activities
  .list({
    part: ["snippet", "contentDetails"],
    channelId,
    publishedAfter: since,
  })
  .take(20);

for (const activity of activities) {
  console.log(activity.snippet.type, activity.snippet.title);

  if (activity.snippet.type === "upload") {
    console.log(activity.contentDetails.upload?.videoId);
  }
}
```

`publishedAfter` et `publishedBefore` acceptent un `Date` ou une chaîne ISO 8601. Dans `contentDetails`, seul l'objet qui porte le nom de `snippet.type` est rempli.

## Référence

Raccourcis :

| Raccourci | Ce qu'il fait | Quota |
| --- | --- | --- |
| `yt.channels.get(channel, { part })` | Une chaîne à partir d'un identifiant, d'un handle, d'un nom ou d'une URL. `null` si introuvable | 1, ou 2 pour un nom seul ou une URL `/c/` qui n'est pas un handle |
| `yt.channels.mine({ part })` | La chaîne de l'utilisateur authentifié. `null` sans chaîne. OAuth | 1 |
| `yt.channels.resolveId(channel)` | L'identifiant `UC...` de n'importe quelle référence, ou `null` | 0 pour un identifiant. Sinon 1 la première fois, ou 2 pour un nom seul qui est un ancien nom d'utilisateur |
| `yt.channels.uploads(channel, { kind, part })` | Les envois de la chaîne sous forme d'éléments de playlist, du plus récent au plus ancien | 1 par page de 50 |
| `yt.channels.latestVideos(channel, { limit, kind, part })` | Les derniers envois sous forme de vidéos complètes. `[]` sans envois | 2 par tranche de 50 vidéos |
| `yt.channels.latestVideo(channel, { kind, part })` | Le dernier envoi sous forme de vidéo complète, ou `null` | 2 |

`uploads`, `latestVideos` et `latestVideo` ajoutent le coût de `resolveId` la première fois qu'ils voient un handle ou un nom. Les trois lèvent une `YouTubeArgumentError` quand aucune chaîne ne correspond.

Méthodes brutes :

| Méthode | Quota | Authentification |
| --- | --- | --- |
| `yt.channels.list` | 1 | Clé. OAuth pour `mine`, `managedByMe` et `mySubscribers` |
| `yt.channels.update` | 50 | OAuth |
| `yt.channelSections.list` | 1 | Clé. OAuth pour `mine` |
| `yt.channelSections.insert` | 50 | OAuth |
| `yt.channelSections.update` | 50 | OAuth |
| `yt.channelSections.delete` | 50 | OAuth |
| `yt.activities.list` | 1 | Clé. OAuth pour `mine` |

Les écritures acceptent les scopes `youtube`, `youtube.force-ssl` et `youtubepartner`. La page [Scopes](/auth/scopes/) liste ce que chacun autorise.

Parties d'une chaîne :

| Partie | Ce qu'elle contient | Toujours renvoyée quand elle est demandée |
| --- | --- | --- |
| `snippet` | Titre, description, URL personnalisée, date de création, miniatures, pays | Oui |
| `contentDetails` | `relatedPlaylists` : les identifiants des playlists d'envois et de mentions « j'aime » | Oui |
| `statistics` | Nombres de vues, de vidéos et d'abonnés | Oui |
| `status` | Statut de confidentialité, indicateurs « conçu pour les enfants », statut des vidéos longues | Oui |
| `brandingSettings` | Titre de la chaîne, description, mots-clés, pays, bande-annonce, image de bannière | Oui |
| `localizations` | Titre et description par langue | Non |
| `topicDetails` | URL Wikipédia qui décrivent le contenu de la chaîne | Non |
| `auditDetails` | Situation de la chaîne, pour les partenaires YouTube pendant un audit | Non |
| `contentOwnerDetails` | Le propriétaire de contenu lié à la chaîne, pour les partenaires YouTube | Non |
| `conversionPings` | Déprécié | Non |
| `id` | Rien de plus : `kind`, `etag` et `id` sont présents sur chaque résultat | Oui |

## Voir aussi

- [ID et URL](/basics/ids-and-urls/) pour analyser et construire vous-même des liens de chaîne.
- [Playlists](/resources/playlists/) pour les éléments de playlist que renvoie `uploads`.
- [Surveiller les nouvelles vidéos](/notifications/watching-uploads/) pour réagir aux nouvelles vidéos sans interroger l'API.
- [Abonnements](/resources/subscriptions/) pour savoir qui une chaîne suit et qui la suit.
