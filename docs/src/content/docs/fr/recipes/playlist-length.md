---
title: Durée totale d'une playlist
description: "Un script qui prend l'URL d'une playlist et affiche combien de vidéos elle contient, leur durée totale et moyenne, et la plus longue. Une clé d'API suffit."
sidebar:
  order: 3
---

## Ce que vous obtenez

Une commande qui répond à la question « quelle est la durée de cette playlist ? » pour une playlist de n'importe quelle taille. Elle indique aussi combien d'entrées n'ont pas pu être comptées parce que la vidéo est supprimée ou privée.

## Ce qu'il faut

Une clé d'API dans `YOUTUBE_API_KEY`, voir [Identifiants d'accès](/start/credentials/). Une playlist privée n'est pas visible avec une clé d'API.

Quota : 1 unité pour la playlist elle-même, puis 2 unités par tranche de 50 entrées. Une playlist de 200 vidéos coûte 9 unités.

## Le programme

```ts title="playlist-length.ts"
import {
  YouTube,
  formatDuration,
  parseDuration,
  playlistIdFrom,
  urls,
} from "@ix-xs/youtube.api";

const input = process.argv[2];
const playlistId = input ? playlistIdFrom(input) : null;
if (!playlistId) {
  console.error("Usage: playlist-length.ts <playlist URL or id>");
  process.exit(1);
}

const yt = new YouTube(); // lit YOUTUBE_API_KEY

const part = ["snippet", "contentDetails"] as const;

const playlist = await yt.playlists.get(playlistId, { part });
if (!playlist) {
  console.error("This playlist does not exist or is private.");
  process.exit(1);
}

let count = 0;
let total = 0;
let longest: { title: string; seconds: number; url: string } | undefined;

for await (const video of yt.playlists.videos(playlistId, { part })) {
  const seconds = parseDuration(video.contentDetails.duration);
  count++;
  total += seconds;
  if (!longest || seconds > longest.seconds) {
    const url = urls.video(video.id);
    longest = { title: video.snippet.title, seconds, url };
  }
}

const entries = playlist.contentDetails.itemCount;
const skipped = entries > count ? ` of ${entries} entries` : "";

console.log(playlist.snippet.title);
console.log(`Videos:   ${count}${skipped}`);
console.log(`Total:    ${formatDuration(total)}`);
if (count) console.log(`Average:  ${formatDuration(total / count)}`);
if (longest) {
  const length = formatDuration(longest.seconds);
  console.log(`Longest:  ${length}  ${longest.title}  ${longest.url}`);
}
console.log(`Quota:    ${yt.quota.used} units`);
```

## Lancer le script

```bash
npm install @ix-xs/youtube.api

export YOUTUBE_API_KEY=...
node playlist-length.ts "https://www.youtube.com/playlist?list=PLBCF2DAC6FFB574DE"
```

Node.js 22.18 et les versions suivantes exécutent directement un fichier `.ts`. Sur une version plus ancienne, utilisez `npx tsx playlist-length.ts` avec le même argument. Mettez l'URL entre guillemets : une URL de lecture contenant `&list=` serait sinon coupée par le shell.

La sortie ressemble à ceci :

```txt
My playlist
Videos:   42 of 45 entries
Total:    12:34:56
Average:  17:58
Longest:  1:02:03  The longest one  https://www.youtube.com/watch?v=...
Quota:    3 units
```

## Comment ça marche

**`playlistIdFrom(input)`** accepte un identifiant de playlist, une URL de playlist ou une URL de lecture qui porte un paramètre `list`. Elle renvoie `null` pour tout le reste : le script peut ainsi afficher son mode d'emploi avant de dépenser du quota.

**`yt.playlists.videos`** fait les deux étapes que l'API impose. Un élément de playlist contient un titre et un identifiant de vidéo, pas une durée. Le raccourci lit les éléments par 50 (1 unité), puis récupère ces vidéos en un seul appel (1 unité), et les produit dans l'ordre de la playlist. Les pages sont demandées à mesure que la boucle avance : la mémoire reste stable sur une playlist de plusieurs milliers de vidéos.

**`part`** demande ce que le script lit : le titre est dans `snippet`, la durée dans `contentDetails`. Il est déclaré `as const` pour que les deux appels gardent les noms des parties dans les types de leur résultat. Omettre `statistics` allège les réponses, sans changer le coût.

**Les vidéos supprimées et privées sont ignorées** par le raccourci, car l'API ne les renvoie pas. `contentDetails.itemCount` est le nombre d'entrées que la playlist déclare. Quand il dépasse le nombre de vidéos comptées, la différence correspond à ce que le raccourci a laissé de côté. Une vidéo présente deux fois dans la playlist est comptée deux fois, puisqu'elle serait lue deux fois.

**Le coût suit les entrées, pas les vidéos.** Une page de 50 entrées coûte 2 unités, même si certaines sont ignorées.

**`parseDuration`** convertit la durée ISO 8601 de l'API (`PT4M13S`) en secondes. Un flux vidéo en direct qui n'est pas terminé renvoie `P0D`, ce qui donne 0.

**`formatDuration`** accepte des secondes ou une chaîne ISO 8601 et affiche `4:13` ou `1:02:03`. Les heures ne sont pas converties en jours : une playlist de 30 heures s'affiche `30:00:00`.

## Aller plus loin

### Le temps de visionnage à la vitesse 1,5

Divisez avant de formater :

```ts
import { formatDuration } from "@ix-xs/youtube.api";

const total = 45_296; // en secondes, issu de la boucle ci-dessus

for (const speed of [1.25, 1.5, 2]) {
  console.log(`At ${speed}x: ${formatDuration(total / speed)}`);
}
```

### Seulement les premières vidéos

`limit` arrête le parcours plus tôt. Il compte les vidéos que vous recevez, pas les entrées de playlist lues : les vidéos supprimées et privées ne l'entament pas.

```ts
let total = 0;

const first = yt.playlists.videos(playlistId, {
  part: "contentDetails",
  limit: 100,
});
for await (const video of first) {
  total += parseDuration(video.contentDetails.duration);
}
```

Cela fait 4 unités quand les 100 premières entrées sont toutes disponibles : deux pages d'éléments et deux appels pour les vidéos.

### Ignorer les vidéos courtes

La ressource vidéo n'indique pas si une vidéo est un Short. Une durée minimale n'en est qu'une approximation : elle écarte aussi les vidéos ordinaires sous le seuil, choisissez-la donc en fonction de la playlist concernée.

```ts
const MIN_SECONDS = 90; // votre propre seuil
let total = 0;

const walk = yt.playlists.videos(playlistId, { part: "contentDetails" });
for await (const video of walk) {
  const seconds = parseDuration(video.contentDetails.duration);
  if (seconds < MIN_SECONDS) continue;
  total += seconds;
}
```

### Exporter en CSV

Écrivez une ligne par vidéo et ouvrez le fichier dans un tableur :

```ts
import { createWriteStream } from "node:fs";
import { parseDuration, urls } from "@ix-xs/youtube.api";

const out = createWriteStream("playlist.csv");
const quote = (value: string | number) =>
  `"${String(value).replaceAll('"', '""')}"`;

out.write("position,title,seconds,url\n");
let position = 0;
const part = ["snippet", "contentDetails"] as const;
for await (const video of yt.playlists.videos(playlistId, { part })) {
  const seconds = parseDuration(video.contentDetails.duration);
  const url = urls.video(video.id);
  const cells = [++position, video.snippet.title, seconds, url];
  out.write(`${cells.map(quote).join(",")}\n`);
}
out.end();
```

### Pour en savoir plus

- [Playlists](/resources/playlists/) pour les autres raccourcis sur les playlists.
- [ID et URL](/basics/ids-and-urls/#formatting) pour `formatDuration`, `formatCount` et les constructeurs d'URL.
- [Quota](/basics/quota/) pour suivre ce que dépense un long parcours.
