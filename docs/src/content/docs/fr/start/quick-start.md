---
title: Démarrage rapide
description: Installez le paquet, obtenez une clé d'API, puis lisez une chaîne, ses dernières vidéos et une playlist. Aucun OAuth n'est nécessaire.
---

```ts
import { YouTube } from "@ix-xs/youtube.api";

const yt = new YouTube({ apiKey: process.env.YOUTUBE_API_KEY });

const channel = await yt.channels.get("@GoogleDevelopers"); // 1 unité
console.log(channel?.snippet.title, channel?.statistics.subscriberCount);
```

## Installer

```bash
npm install @ix-xs/youtube.api
```

Le paquet demande Node.js 20 ou plus récent et n'a aucune dépendance. Pour Bun, Deno, les navigateurs et les environnements edge, voyez [Environnements d'exécution](/reference/runtimes/).

Les deux systèmes de modules fonctionnent :

```ts
import { YouTube } from "@ix-xs/youtube.api";
```

```js
const { YouTube } = require("@ix-xs/youtube.api");
```

## Obtenir une clé d'API

Une clé d'API suffit pour lire les données publiques. Créez-en une dans la [console Google Cloud](https://console.cloud.google.com/) : activez **YouTube Data API v3** pour un projet, puis créez une clé dans **APIs & Services > Credentials**.

Gardez la clé hors de votre code. Placez-la dans une variable d'environnement nommée `YOUTUBE_API_KEY` : le client la lit quand vous ne passez pas `apiKey`.

```ts
const yt = new YouTube(); // utilise process.env.YOUTUBE_API_KEY
```

[Identifiants d'accès](/start/credentials/) détaille les étapes, la façon de restreindre la clé et ce qui exige OAuth à la place.

## Lire une chaîne

Une chaîne peut être donnée sous forme d'identifiant, de `@handle`, d'ancien nom d'utilisateur ou d'URL. L'appel coûte 1 unité et renvoie `null` quand rien ne correspond.

```ts
const channel = await yt.channels.get(
  "https://www.youtube.com/@GoogleDevelopers",
);

if (channel) {
  console.log(channel.id); // "UC_x5XG1OV2P6uZZ5FSM9Ttw"
  console.log(channel.snippet.title);
  console.log(channel.statistics.videoCount);
}
```

## Lire ses dernières vidéos

```ts
const videos = await yt.channels.latestVideos("@GoogleDevelopers", {
  limit: 5,
});

for (const video of videos) {
  console.log(video.snippet.title);
  console.log(
    formatDuration(video.contentDetails.duration),
    formatCount(video.statistics.viewCount),
  );
}
```

Le client lit la playlist des envois de la chaîne, puis récupère les vidéos : 2 unités de quota pour 50 vidéos au plus, plus 1 la première fois qu'un handle est résolu. Une recherche consommerait l'un de vos 100 appels de recherche par jour et ne renverrait ni durées ni statistiques.

## Parcourir une liste

Chaque méthode `list`, et chaque raccourci qui renvoie une liste, peut être attendu avec `await` pour obtenir une page ou parcouru jusqu'au bout. Une page de `yt.playlists.items` contient jusqu'à 50 éléments et coûte 1 unité.

```ts
// Une page.
const page = await yt.playlists.items("PLBCF2DAC6FFB574DE");
console.log(page.items.length, page.nextPageToken);

// Chaque élément, récupéré page par page à mesure que la boucle avance.
for await (const item of yt.playlists.items("PLBCF2DAC6FFB574DE")) {
  console.log(item.snippet.position, item.snippet.title);
}

// Un tableau borné.
const firstHundred = await yt.playlists.items("PLBCF2DAC6FFB574DE").take(100);
```

## Utiliser l'API brute

Les raccourcis ci-dessus ne sont qu'un confort. Chaque méthode de l'API existe aussi sous son propre nom, avec des paramètres typés. [Toutes les méthodes](/reference/methods/) les liste.

```ts
const { items } = await yt.videos.list({
  part: ["snippet", "statistics"],
  chart: "mostPopular",
  regionCode: "FR",
  maxResults: 10,
}); // 1 unité
```

Le type du résultat suit `part` : ici, chaque vidéo a `id`, `snippet` et `statistics`, et lire une autre partie ne compile pas. C'est le sujet de [Parties et types](/basics/parts-and-types/).

## Gérer les erreurs

Un appel qui échoue lève une erreur. Elle porte un `code` sur lequel vous pouvez brancher votre logique.

```ts
try {
  await yt.videos.get(videoId); // 1 unité
} catch (error) {
  if (isYouTubeError(error, "QUOTA_EXCEEDED")) {
    console.log("Out of quota until", yt.quota.resetsAt);
  } else {
    throw error;
  }
}
```

[Erreurs](/basics/errors/) liste les codes et précise ce qui fait l'objet d'une nouvelle tentative.

## Voir aussi

- [Parties et types](/basics/parts-and-types/) : comment les types des résultats sont construits.
- [Listes](/basics/lists/) : pages, itération, limites.
- [Quota](/basics/quota/) : ce que coûtent les appels et comment dépenser moins.
- [OAuth](/auth/oauth/) : données privées et écritures.
