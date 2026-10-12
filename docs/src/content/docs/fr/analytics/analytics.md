---
title: Analytics
description: "Lancez des rapports YouTube Analytics sur votre chaîne. Vues, temps de visionnage, abonnés et revenus, répartis par jour, vidéo, pays ou source de trafic, reviennent sous forme de lignes typées."
sidebar:
  order: 1
---

```ts
const report = await yt.analytics.query({
  startDate: "2026-01-01",
  endDate: "2026-01-31",
  metrics: ["views", "estimatedMinutesWatched", "subscribersGained"],
  dimensions: "day",
  sort: "day",
});

for (const row of report.rows) {
  console.log(row.day, row.views, row.estimatedMinutesWatched);
  console.log(row.subscribersGained);
}
```

## Ce qu'est une requête

Un rapport répond à une question : ces `metrics`, entre deux dates, réparties selon ces `dimensions`.

- Une métrique est une mesure : `views`, `likes`, `estimatedMinutesWatched`, `subscribersGained`.
- Une dimension est la façon de répartir les chiffres : `day`, `video`, `country`, `deviceType`.

Sans dimension, le rapport tient en une seule ligne de totaux :

```ts
const totals = await yt.analytics.query({
  startDate: "2026-01-01",
  endDate: "2026-12-31",
  metrics: ["views", "likes", "comments"],
});

console.log(totals.rows[0]?.views);
```

Analytics exige OAuth : voir [Scopes](#scopes). Les appels ne sont pas facturés en unités de quota : voir [Quota](#quota).

## Lire le résultat

`report.rows` contient un objet par ligne, indexé par les noms que vous avez demandés. Les métriques sont des nombres. Les dimensions sont des chaînes.

```ts
const report = await yt.analytics.query({
  startDate: "2026-01-01",
  endDate: "2026-01-31",
  metrics: ["views", "averageViewDuration"],
  dimensions: "country",
});

const first = report.rows[0];
if (first) {
  first.country; // string, par exemple "FR"
  first.views; // number
  first.averageViewDuration; // number
  // @ts-expect-error likes n'a pas été demandé
  first.likes;
}
```

Le type d'une ligne suit `metrics` et `dimensions`, comme le type d'une ressource suit `part`.

| Sur le rapport | Contenu |
| --- | --- |
| `rows` | Un objet par ligne. Vide quand la requête ne correspond à aucune donnée |
| `columns` | `{ name, type, dataType }` par colonne, dimensions d'abord, dans l'ordre de la requête. `type` vaut `"DIMENSION"` ou `"METRIC"` |
| `raw` | La réponse telle que l'API l'a envoyée, avec les lignes sous forme de tableaux |

Un rapport avec la dimension `day` n'a pas de lignes pour les tout derniers jours.

## Dates

`startDate` est le premier jour du rapport et `endDate` le dernier. Chacune est une chaîne `YYYY-MM-DD` ou un `Date`. Les jours d'Analytics suivent l'heure du Pacifique.

Un `Date` est lu dans votre propre calendrier : l'année, le mois et le jour qu'il affiche dans le fuseau horaire local du processus. Il n'est pas converti en UTC : « aujourd'hui » reste aujourd'hui où que vous l'exécutiez.

```ts
const today = new Date();
const monthAgo = new Date(
  today.getFullYear(),
  today.getMonth() - 1,
  today.getDate(),
);

const lastMonth = await yt.analytics.query({
  startDate: monthAgo,
  endDate: today,
  metrics: "views",
  dimensions: "day",
});
```

Une chaîne dans un autre format, ou un `Date` invalide, lève une `YouTubeArgumentError` avant tout envoi.

## Filtrer et trier

`filters` restreint les données. Un objet est la forme lisible. Une valeur de tableau signifie « l'un quelconque de ».

```ts
const report = await yt.analytics.query({
  startDate: "2026-01-01",
  endDate: "2026-03-31",
  metrics: ["views", "estimatedMinutesWatched"],
  dimensions: "day",
  filters: { video: videoId, country: ["FR", "BE", "CH"] },
  sort: "-views",
});
```

La syntaxe propre à l'API fonctionne aussi : `filters: "video==dQw4w9WgXcQ;country==FR"`.

`sort` accepte une colonne ou une liste. Préfixez un nom par `-` pour un ordre décroissant : `sort: ["-views", "day"]`. Il n'accepte que les métriques et les dimensions de la requête. Tout autre nom est une erreur de compilation :

```ts
await yt.analytics.query({
  startDate: "2026-01-01",
  endDate: "2026-01-31",
  metrics: "views",
  dimensions: "day",
  // @ts-expect-error likes n'est pas une colonne de cette requête
  sort: "-likes",
});
```

`maxResults` plafonne le nombre de lignes, et `startIndex` est l'index (à partir de 1) de la première ligne, pour parcourir un long rapport page par page.

## Exemples concrets

### Les vues quotidiennes sur un mois

```ts
const daily = await yt.analytics.query({
  startDate: "2026-03-01",
  endDate: "2026-03-31",
  metrics: ["views", "estimatedMinutesWatched"],
  dimensions: "day",
  sort: "day",
});

const total = daily.rows.reduce((sum, row) => sum + row.views, 0);
console.log(`${total} views over ${daily.rows.length} days`);
```

### Les 10 vidéos les plus vues

La dimension `video` donne des identifiants, pas des titres. Récupérez les titres avec un seul appel `videos.list`, 1 unité :

```ts
const top = await yt.analytics.query({
  startDate: "2026-01-01",
  endDate: "2026-12-31",
  metrics: ["views", "likes", "estimatedMinutesWatched"],
  dimensions: "video",
  sort: "-views",
  maxResults: 10,
});

const videos = await yt.videos.getMany(
  top.rows.map((row) => row.video),
  { part: "snippet" },
);
const titles = new Map(videos.map((video) => [video.id, video.snippet.title]));

for (const row of top.rows) {
  console.log(row.views, titles.get(row.video) ?? row.video);
}
```

Certains rapports exigent `maxResults`. Celui des vidéos les plus vues en fait partie.

### Sources de trafic

```ts
const sources = await yt.analytics.query({
  startDate: "2026-01-01",
  endDate: "2026-03-31",
  metrics: ["views", "estimatedMinutesWatched"],
  dimensions: "insightTrafficSourceType",
  sort: "-views",
});

for (const row of sources.rows) {
  console.log(row.insightTrafficSourceType, row.views);
}
```

### Audience par pays

```ts
const countries = await yt.analytics.query({
  startDate: "2026-01-01",
  endDate: "2026-03-31",
  metrics: ["views", "averageViewDuration"],
  dimensions: "country",
  sort: "-views",
  maxResults: 25,
});

for (const row of countries.rows) {
  const seconds = Math.round(row.averageViewDuration);
  console.log(row.country, row.views, `${seconds} s`);
}
```

### Revenus

Les métriques de revenus demandent le scope `yt-analytics-monetary.readonly`. `currency` est un code ISO 4217, `USD` par défaut.

```ts
const revenue = await yt.analytics.query({
  startDate: "2026-01-01",
  endDate: "2026-01-31",
  metrics: ["estimatedRevenue", "estimatedAdRevenue", "cpm"],
  dimensions: "day",
  currency: "EUR",
});

const earned = revenue.rows.reduce((sum, row) => sum + row.estimatedRevenue, 0);
console.log(`${earned.toFixed(2)} EUR`);
```

## Toutes les combinaisons n'existent pas

L'API répond 400 pour une combinaison de métriques et de dimensions qu'elle ne prend pas en charge. Les combinaisons valides sont listées dans la [référence des rapports de chaîne](https://developers.google.com/youtube/analytics/channel_reports) de YouTube.

```ts
try {
  await yt.analytics.query({
    startDate: "2026-01-01",
    endDate: "2026-01-31",
    metrics: ["viewerPercentage"],
    dimensions: ["ageGroup", "gender", "insightTrafficSourceType"],
  });
} catch (error) {
  if (!(error instanceof YouTubeApiError) || error.status !== 400) throw error;
  console.error("No such report:", error.message);
}
```

Les noms sont typés : votre éditeur complète les métriques et les dimensions documentées. Les types restent ouverts aux noms que YouTube ajoutera plus tard. Ils ne savent pas quelles combinaisons sont valides : seule l'API le sait.

## De qui sont les données

`ids` indique sur les données de qui porte le rapport. Par défaut, c'est `"channel==MINE"`, la chaîne de l'utilisateur authentifié.

```ts
await yt.analytics.query({
  ids: `channel==${channelId}`,
  startDate: "2026-01-01",
  endDate: "2026-01-31",
  metrics: "views",
});
```

Les détenteurs de contenu utilisent `"contentOwner==NAME"`, avec le nom du détenteur dans le CMS de YouTube. `includeHistoricalChannelData: true` ajoute les données antérieures au rattachement d'une chaîne au détenteur.

L'option `onBehalfOfContentOwner` du client n'est pas envoyée avec `query` : une requête nomme le détenteur dans `ids`. Les méthodes de groupes ci-dessous prennent bien `onBehalfOfContentOwner`, appel par appel ou depuis l'option du client. [Configuration](/basics/configuration/) décrit cette option.

## Groupes

Un groupe est une collection personnalisée d'au plus 500 vidéos, playlists, chaînes ou assets sur lesquels vous établissez un rapport commun. Les groupes se trouvent sous `yt.analytics.groups`, leur contenu sous `yt.analytics.groupItems`.

```ts
const group = await yt.analytics.groups.insert({
  body: {
    snippet: { title: "Tutorials" },
    contentDetails: { itemType: "youtube#video" },
  },
});

if (group.id) {
  await yt.analytics.groupItems.insert({
    body: {
      groupId: group.id,
      resource: { kind: "youtube#video", id: videoId },
    },
  });

  const report = await yt.analytics.query({
    startDate: "2026-01-01",
    endDate: "2026-03-31",
    metrics: ["views", "estimatedMinutesWatched"],
    filters: { group: group.id },
  });
  console.log(report.rows[0]?.views);
}
```

`itemType` vaut `youtube#video`, `youtube#playlist`, `youtube#channel` ou `youtubePartner#asset`. Un groupe contient un seul type.

```ts
const { items } = await yt.analytics.groups.list({ mine: true });
for (const group of items) {
  console.log(group.id, group.snippet?.title);
  console.log(group.contentDetails?.itemCount); // une chaîne
}

const content = await yt.analytics.groupItems.list({ groupId });
for (const item of content.items) console.log(item.id, item.resource?.id);

await yt.analytics.groups.update({
  body: { id: groupId, snippet: { title: "Tutorials 2026" } },
});
await yt.analytics.groups.delete({ id: groupId });
```

`groupItems.delete` prend l'identifiant de l'élément du groupe, `item.id` ci-dessus, et non l'identifiant de la vidéo.

## Référence

### `yt.analytics.query(query, options?)`

| Champ | Type | Sens |
| --- | --- | --- |
| `startDate` | `string \| Date` | Premier jour, inclus. Obligatoire |
| `endDate` | `string \| Date` | Dernier jour, inclus. Obligatoire |
| `metrics` | un nom ou une liste | Ce qu'il faut mesurer. Obligatoire |
| `dimensions` | un nom ou une liste | Comment répartir les chiffres. Sans elle, une seule ligne de totaux |
| `filters` | objet ou chaîne | Restreint les données |
| `sort` | un nom ou une liste | Colonnes de tri, parmi les métriques et les dimensions de la requête. `-` pour l'ordre décroissant |
| `maxResults` | `number` | Nombre maximal de lignes à renvoyer. Certains rapports l'exigent |
| `startIndex` | `number` | Index, à partir de 1, de la première ligne |
| `currency` | `string` | Devise des métriques de revenus, ISO 4217. `USD` par défaut |
| `ids` | `string` | `"channel==MINE"` par défaut, `channel==ID` ou `contentOwner==NAME` |
| `includeHistoricalChannelData` | `boolean` | Pour les détenteurs de contenu : inclut les données antérieures au rattachement de la chaîne |

`options` sont les [options d'un appel](/basics/configuration/).

### Groupes

| Méthode | Ce qu'elle fait |
| --- | --- |
| `yt.analytics.groups.list({ mine: true })` | Liste vos groupes, ou certains d'entre eux par `id` |
| `yt.analytics.groups.insert({ body })` | Crée un groupe |
| `yt.analytics.groups.update({ body })` | Renomme un groupe |
| `yt.analytics.groups.delete({ id })` | Supprime un groupe |
| `yt.analytics.groupItems.list({ groupId })` | Liste les éléments d'un groupe |
| `yt.analytics.groupItems.insert({ body })` | Ajoute une vidéo, une playlist, une chaîne ou un asset à un groupe |
| `yt.analytics.groupItems.delete({ id })` | Retire un élément d'un groupe |

### Types

| Type | Ce que c'est |
| --- | --- |
| `AnalyticsMetric` | Les noms de métriques documentés, ouverts à d'autres |
| `AnalyticsDimension` | Les noms de dimensions documentés, ouverts à d'autres |
| `AnalyticsQuery<M, D>` | Les paramètres de `query` |
| `AnalyticsReport<M, D>` | Le résultat : `rows`, `columns`, `raw` |

## Limites et erreurs

### Scopes

| Scope | Donne accès à |
| --- | --- |
| `yt-analytics.readonly` | Les rapports YouTube Analytics |
| `yt-analytics-monetary.readonly` | Les rapports monétaires : les métriques de revenus |

Demandez-les en construisant l'URL de consentement : voir [OAuth](/auth/oauth/) et [Scopes](/auth/scopes/). Les méthodes Analytics acceptent aussi `youtube`, `youtube.readonly` et `youtubepartner`.

Avec une clé d'API seule, tout appel Analytics lève une `YouTubeAuthError` avec le code `MISSING_CREDENTIALS` avant tout envoi. Quand le client connaît les scopes du jeton et qu'aucun n'est accepté, l'appel lève `INSUFFICIENT_SCOPE`.

### Quota

Google ne facture pas les appels Analytics en unités de quota. Ils ne puisent pas dans les 10 000 unités quotidiennes de l'API Data.

Le client les compte tout de même, un par appel, dans une enveloppe à part sans limite. Ce décompte est donné à titre indicatif :

```ts
yt.quota.usage.analytics; // appels faits aujourd'hui
yt.quota.used; // inchangé : c'est l'enveloppe de l'API Data
```

### Erreurs

| Situation | Ce que vous obtenez |
| --- | --- |
| Une combinaison de métriques et de dimensions que l'API ne prend pas en charge | `YouTubeApiError`, statut 400, code `BAD_REQUEST` |
| Une date qui n'est pas au format `YYYY-MM-DD`, ou un `Date` invalide | `YouTubeArgumentError`, rien n'est envoyé |
| Une clé d'API et pas d'OAuth | `YouTubeAuthError`, code `MISSING_CREDENTIALS`, rien n'est envoyé |

Lisez `error.message` sur une erreur 400 : c'est le message renvoyé par l'API.

## Voir aussi

- [Reporting](/analytics/reporting/) pour les exports en masse sous forme de fichiers CSV quotidiens.
- [Scopes](/auth/scopes/) pour les deux scopes Analytics.
- [Erreurs](/basics/errors/) pour `error.code` et `error.reason`.
- [Vidéos](/resources/videos/) pour transformer les identifiants d'un rapport en titres.
