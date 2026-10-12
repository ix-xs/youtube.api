---
title: Exporter les commentaires d'une vidéo
description: "Un script qui écrit tous les commentaires et toutes les réponses d'une vidéo dans un fichier JSON Lines ou CSV, une ligne par commentaire. Une clé d'API suffit."
sidebar:
  order: 4
---

## Ce que vous obtenez

Un fichier avec une ligne par commentaire : son identifiant, son parent s'il s'agit d'une réponse, l'auteur, le texte, le nombre de mentions J'aime et les dates. Le script écrit sur le disque au fur et à mesure de la lecture : les commentaires d'une vidéo n'ont jamais besoin de tenir en mémoire tous ensemble.

## Ce qu'il faut

Une clé d'API dans `YOUTUBE_API_KEY`, voir [Identifiants d'accès](/start/credentials/).

Quota : 1 unité par tranche de 100 fils, plus 1 unité par page de 100 réponses pour chaque fil qui a plus de réponses qu'il n'en porte. Une vidéo de 5 000 fils, dont 40 ont entre 6 et 100 réponses, coûte 90 unités.

## Le programme

```ts title="export-comments.ts"
import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { finished } from "node:stream/promises";
import {
  YouTube,
  YouTubeApiError,
  videoIdFrom,
  type Comment,
} from "@ix-xs/youtube.api";

const [input, output = "comments.jsonl"] = process.argv.slice(2);
const videoId = input ? videoIdFrom(input) : null;
if (!videoId) {
  console.error("Usage: export-comments.ts <video URL or id> [output file]");
  console.error("The output file ends in .csv, or in anything else for JSON.");
  process.exit(1);
}

const yt = new YouTube(); // lit YOUTUBE_API_KEY
const csv = output.endsWith(".csv");
const out = createWriteStream(output);

const COLUMNS = [
  "id",
  "parentId",
  "author",
  "authorChannelId",
  "text",
  "likes",
  "publishedAt",
  "updatedAt",
] as const;
type Row = Record<(typeof COLUMNS)[number], string | number>;

/** Attend quand le disque est plus lent que l'API. */
async function write(line: string): Promise<void> {
  if (!out.write(`${line}\n`)) await once(out, "drain");
}

const quote = (value: string | number) =>
  `"${String(value).replaceAll('"', '""')}"`;
let rows = 0;

async function save({ id, snippet }: Comment<"snippet">): Promise<void> {
  const row: Row = {
    id,
    parentId: snippet.parentId ?? "",
    author: snippet.authorDisplayName,
    authorChannelId: snippet.authorChannelId?.value ?? "",
    text: snippet.textDisplay,
    likes: snippet.likeCount,
    publishedAt: snippet.publishedAt,
    updatedAt: snippet.updatedAt,
  };
  const line = csv
    ? COLUMNS.map((column) => quote(row[column])).join(",")
    : JSON.stringify(row);
  await write(line);
  rows++;
}

if (csv) await write(COLUMNS.join(","));
let threads = 0;

try {
  const list = yt.commentThreads.forVideo(videoId, {
    part: ["snippet", "replies"],
    textFormat: "plainText",
  });
  for await (const thread of list) {
    threads++;
    await save(thread.snippet.topLevelComment);

    const inlined = thread.replies?.comments ?? [];
    if (thread.snippet.totalReplyCount > inlined.length) {
      // Le fil a plus de réponses qu'il n'en porte : les lire toutes.
      const all = yt.comments.replies(thread.id, { textFormat: "plainText" });
      for await (const reply of all) await save(reply);
    } else {
      for (const reply of inlined) await save(reply);
    }
    if (threads % 500 === 0) {
      console.log(`${threads} threads, ${rows} comments...`);
    }
  }
  console.log(`Wrote ${rows} comments from ${threads} threads to ${output}.`);
  console.log(`Quota: ${yt.quota.used} units.`);
} catch (error) {
  if (!(error instanceof YouTubeApiError)) throw error;
  if (error.reason === "commentsDisabled") {
    console.error("Comments are turned off on this video.");
  } else if (error.isNotFound) {
    console.error("This video does not exist or is private.");
  } else {
    throw error;
  }
  process.exitCode = 1;
} finally {
  out.end();
  await finished(out);
}
```

## Lancer le script

```bash
npm install @ix-xs/youtube.api

export YOUTUBE_API_KEY=...
node export-comments.ts https://youtu.be/dQw4w9WgXcQ comments.csv
```

Node.js 22.18 et les versions suivantes exécutent directement un fichier `.ts`. Sur une version plus ancienne, utilisez `npx tsx export-comments.ts` avec les mêmes arguments.

L'extension du deuxième argument choisit le format. `.csv` écrit un en-tête et des cellules entre guillemets. Toute autre extension écrit du JSON Lines, un objet par ligne :

```json
{"id":"Ugx...","parentId":"","author":"@someone","authorChannelId":"UC...","text":"First!","likes":12,"publishedAt":"2026-03-01T10:00:00Z","updatedAt":"2026-03-01T10:00:00Z"}
```

## Comment ça marche

**Les fils, puis les réponses.** Un fil de commentaires est un commentaire de premier niveau avec ses réponses. `yt.commentThreads.forVideo` liste les fils d'une vidéo. Elle demande des pages de 100, le maximum permis par l'API, que vous l'attendiez avec `await` ou que vous la parcouriez avec `for await`. Avec la partie `replies`, chaque fil porte jusqu'à cinq de ses réponses. `snippet.totalReplyCount` indique combien il y en a en tout.

**`yt.comments.replies(thread.id)`** liste toutes les réponses d'un fil, là aussi 100 par page. L'identifiant d'un fil est aussi celui de son commentaire de premier niveau, ce que `parentId` attend. Le script ne fait cet appel que si le fil a plus de réponses qu'il n'en porte, et prend alors toutes les réponses de cette seule source : aucune n'est écrite deux fois.

**`replies` reste facultatif dans le type.** Une partie demandée n'est obligatoire dans le type que si l'API la renvoie toujours, et ce n'est pas le cas de `replies`. D'où `thread.replies?.comments ?? []`.

**`textFormat: "plainText"`.** Par défaut, l'API renvoie le texte des commentaires en HTML. Le texte brut est une meilleure matière première pour un fichier. Il est passé aux deux appels pour que les réponses correspondent à leurs parents.

**`save` prend un `Comment<"snippet">`.** Le commentaire de premier niveau d'un fil, une réponse dans `replies.comments` et une réponse issue de `yt.comments.replies` ont tous ce type. Leurs `id` et `snippet` sont obligatoires, la fonction les lit donc sans `?.`. Une seule fonction traite les trois cas.

**`textDisplay`, pas `textOriginal`.** `textDisplay` est présent sur tous les commentaires. `textOriginal` est facultatif dans le type : la description de l'API ne le garantit que lorsque le lecteur est l'auteur du commentaire. `authorChannelId` est facultatif lui aussi, d'où le `?.` sur ce seul champ.

**`commentsDisabled`** est le `reason` de l'erreur quand le propriétaire a désactivé les commentaires. Elle mérite son propre message, car c'est une propriété de la vidéo et non une panne. Tout le reste est levé de nouveau avec sa pile d'appels. Les lignes écrites avant un échec restent dans le fichier.

**La contre-pression.** `out.write()` renvoie `false` quand son tampon est plein. Attendre `drain` empêche le script de lire plus vite qu'il n'écrit.

## Aller plus loin

### Seulement les commentaires qui mentionnent quelque chose

`searchTerms` filtre les fils côté serveur, ce qui économise aussi du quota :

```ts
const threads = yt.commentThreads.forVideo(videoId, {
  part: ["snippet", "replies"],
  searchTerms: "timestamp",
  textFormat: "plainText",
});
```

### Trié, et seulement les premiers fils

`order` prend `"time"` ou `"relevance"`. Combinez-le avec `take()` pour vous arrêter plus tôt :

```ts
const latest = await yt.commentThreads
  .forVideo(videoId, { order: "time", textFormat: "plainText" })
  .take(200);

for (const thread of latest) {
  const { publishedAt, textDisplay } = thread.snippet.topLevelComment.snippet;
  console.log(publishedAt, textDisplay);
}
```

Cela fait 2 unités : deux pages de 100. La description de l'API n'en dit pas plus sur `"time"` que « trier par date » : vérifiez sur vos propres données par quelle extrémité la liste commence avant de vous y fier.

### Pour en savoir plus

- [Commentaires](/resources/comments/) pour publier, répondre et modérer.
- [Listes](/basics/lists/) pour `take`, `all` et la lecture page par page.
- [Codes d'erreur](/reference/errors/#reasons) pour les autres raisons qui peuvent faire échouer un appel sur les commentaires.
