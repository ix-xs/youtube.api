---
title: "Annoncer les nouvelles vidéos sur Discord"
description: "Un processus qui publie un embed dans un salon Discord chaque fois qu'une des chaînes YouTube que vous suivez met en ligne une vidéo. Il demande une URL de webhook, aucune bibliothèque Discord et, tant que le flux de YouTube répond, aucun quota."
sidebar:
  order: 1
---

## Ce que vous obtenez

Un script qui vérifie une liste de chaînes YouTube toutes les cinq minutes et publie chaque nouvelle vidéo dans un salon Discord, avec son titre, sa miniature et sa date de publication. Il retient où il s'est arrêté : après un redémarrage, il rattrape ce qui a été mis en ligne entre-temps et ne publie rien deux fois.

## Ce qu'il faut

| | |
| --- | --- |
| `DISCORD_WEBHOOK_URL` | L'URL d'un webhook créé sur le salon Discord qui reçoit les messages |
| `YOUTUBE_API_KEY` | Une clé d'API, voir [Identifiants d'accès](/start/credentials/). Elle résout les handles et sert de solution de repli |
| `STATE_FILE` | Facultatif. L'endroit où le script garde son état. Par défaut `./notifier-state.json` |

Quota : aucun tant que le flux public de YouTube répond. Le reste est modeste :

| Quand | Coût |
| --- | --- |
| Résolution d'un handle ou d'une URL de chaîne, une fois par chaîne à chaque démarrage du processus | 1 unité. 2 pour un nom sans `@` qui se révèle être un ancien nom d'utilisateur |
| Un identifiant `UC...` ou une URL `/channel/UC...` | Rien |
| Le flux d'une chaîne échoue | 1 unité par tour pour cette chaîne, pendant les 30 minutes suivantes |

Une journée entière sans le flux coûte 288 unités par chaîne avec un intervalle de cinq minutes.

## Le programme

```ts title="notifier.ts"
import { readFile, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { YouTube, urls, type WatchedVideo } from "@ix-xs/youtube.api";

const channels = process.argv.slice(2);
const webhook = process.env.DISCORD_WEBHOOK_URL ?? "";
if (!channels.length || !webhook) {
  console.error("Usage: notifier.ts <channel> [more channels]");
  console.error("DISCORD_WEBHOOK_URL must be set.");
  process.exit(1);
}

const INTERVAL = 5 * 60_000;
// Le flux a quelques minutes de retard sur les envois : un redémarrage remonte jusque-là.
const OVERLAP = 15 * 60_000;
const STATE_FILE = process.env.STATE_FILE ?? "./notifier-state.json";

interface State {
  /** Le début du dernier tour complet, en millisecondes. */
  lastCheck?: number;
  /** Les identifiants des vidéos déjà publiées, la plus récente en dernier. */
  posted: string[];
}

async function loadState(): Promise<State> {
  try {
    const saved = JSON.parse(await readFile(STATE_FILE, "utf8"));
    return { posted: [], ...(saved as Partial<State>) };
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    if (missing) return { posted: [] }; // premier lancement
    throw error;
  }
}

const state = await loadState();
const saveState = () => writeFile(STATE_FILE, JSON.stringify(state));

const yt = new YouTube(); // lit YOUTUBE_API_KEY
const since =
  state.lastCheck === undefined ? Date.now() : state.lastCheck - OVERLAP;
const watcher = yt.watch(channels, { since });

let failed = false;
watcher.on("error", ({ channel, error }) => {
  failed = true;
  // `channel` est vide quand c'est un de vos écouteurs qui a échoué, pas une chaîne.
  const what = channel ? `Could not check ${channel}:` : "A listener failed:";
  console.warn(what, error instanceof Error ? error.message : error);
});

async function post(video: WatchedVideo): Promise<void> {
  const embed = {
    title: video.title,
    url: video.url,
    author: { name: video.channelTitle, url: urls.channel(video.channelId) },
    image: video.thumbnail ? { url: video.thumbnail } : undefined,
    timestamp: video.publishedAt,
    color: 0xff0000,
  };
  const response = await fetch(webhook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ embeds: [embed] }),
  });
  if (!response.ok) throw new Error(`Discord answered ${response.status}`);
}

const queue: WatchedVideo[] = [];
const stop = new AbortController();
process.once("SIGINT", () => stop.abort());
process.once("SIGTERM", () => stop.abort());

console.log(`Watching ${channels.join(", ")}. Ctrl+C to stop.`);

while (!stop.signal.aborted) {
  const startedAt = Date.now();
  failed = false;

  const found = await watcher.check();
  const fresh = found.filter((video) => !state.posted.includes(video.videoId));
  queue.push(...fresh);

  while (queue.length) {
    const video = queue[0]!;
    try {
      await post(video);
    } catch (error) {
      failed = true;
      const reason = error instanceof Error ? error.message : error;
      console.warn(`Could not post "${video.title}":`, reason);
      break; // elle reste dans la file pour le tour suivant
    }
    queue.shift();
    state.posted = [...state.posted, video.videoId].slice(-200);
    await saveState();
    console.log(`${video.channelTitle} uploaded "${video.title}"`);
  }

  // L'heure enregistrée n'avance qu'après un tour où tout s'est bien passé.
  if (!failed) {
    state.lastCheck = startedAt;
    await saveState();
  }
  await sleep(INTERVAL, undefined, { signal: stop.signal }).catch(() => {});
}
```

## Lancer le script

```bash
npm install @ix-xs/youtube.api

export YOUTUBE_API_KEY=...
export DISCORD_WEBHOOK_URL=...
node notifier.ts @GoogleDevelopers @YouTube
```

Node.js 22.18 et les versions suivantes exécutent directement un fichier `.ts`. Sur une version plus ancienne, utilisez `npx tsx notifier.ts` avec les mêmes arguments.

Les chaînes peuvent être des handles, des URL de chaîne ou des identifiants `UC...`. Le premier lancement part de maintenant : il ne publie pas les vidéos qui existent déjà.

## Comment ça marche

**`watcher.check()` au lieu de `watcher.start()`.** `start()` interroge sur une minuterie et émet des événements `video`. Ici, la boucle est écrite à la main, car le script doit savoir quand un tour est terminé et si tout s'y est bien passé avant de rien enregistrer. `check()` exécute un tour et renvoie les nouvelles vidéos, les plus anciennes d'abord.

**Le fichier d'état.** `since` demande à l'observateur de signaler les vidéos publiées après un instant donné. Sans lui, un observateur part du présent, et tout ce qui a été mis en ligne pendant que le processus était arrêté est perdu. Le script enregistre l'heure de début de chaque tour entièrement réussi et s'en sert au démarrage suivant.

**Le chevauchement.** Le flux public affiche une vidéo quelques minutes après sa mise en ligne. Une vidéo publiée peu avant l'heure enregistrée n'était peut-être pas encore dans le flux : un redémarrage passe donc un `since` antérieur de 15 minutes à l'heure enregistrée. La liste `posted` écarte ensuite ce qui a déjà été envoyé. Dans un même processus, l'observateur le fait lui-même : il retient les identifiants qu'il a vus.

**Les erreurs.** Une chaîne qui ne peut pas être vérifiée émet `error` avec son nom, et le tour continue avec les autres. Une publication qui échoue laisse la vidéo en tête de file. Dans les deux cas, `lastCheck` garde son ancienne valeur, donc rien n'est sauté : le tour suivant, ou le prochain démarrage, réessaie. Cela couvre aussi un webhook qui refuse un message, quelle qu'en soit la raison.

**Une chaîne qui n'existe pas.** Un handle ou une URL qui ne correspond à aucune chaîne est signalé une seule fois, par le même événement `error`. L'observateur la laisse ensuite de côté et la cherche à nouveau 6 heures plus tard : une faute de frappe ne dépense donc pas de quota à chaque tour. Les autres chaînes ne sont pas touchées.

**Le contenu de `error`.** C'est `{ channel, error }`. `channel` est la référence telle que vous l'avez donnée, ou une chaîne vide quand l'erreur vient d'un de vos propres écouteurs et non d'une chaîne. Ce script n'a pas d'autre écouteur, il ne voit donc que le premier cas. Le test est là pour le jour où vous ajouterez un écouteur `video` ou `poll`.

**La limite du rattrapage.** Le flux comme la solution de repli renvoient les 15 envois les plus récents d'une chaîne. Après un long arrêt, une chaîne qui a publié davantage n'est rattrapée que sur ses 15 dernières vidéos.

**`video.thumbnail`** vaut `undefined` quand YouTube n'en a fourni aucune, et `JSON.stringify` omet alors la clé `image`.

## Aller plus loin

### Le push plutôt que l'interrogation

Avec un point d'accès HTTPS public, le hub de YouTube vous appelle quelques secondes après un envoi et il n'y a plus de boucle à exécuter. `websub` ne coûte pas de quota non plus. Le hub notifie aussi quand un titre ou une description change : gardez donc la vérification sur l'identifiant de la vidéo.

```ts
import { createServer } from "node:http";
import { YouTube, websub } from "@ix-xs/youtube.api";
import { webSubListener } from "@ix-xs/youtube.api/node";

const secret = process.env.WEBSUB_SECRET;
const posted = new Set<string>();

createServer(
  webSubListener({
    secret,
    onNotification: (notification) => {
      if (notification.type !== "video") return;
      if (posted.has(notification.videoId)) return;
      posted.add(notification.videoId);
      console.log(notification.title, notification.url); // publiez sur Discord ici
    },
  }),
).listen(3000);

const yt = new YouTube();
const channelId = await yt.channels.resolveId("@GoogleDevelopers");
if (channelId) {
  const callbackUrl = "https://example.com/youtube";
  await websub.subscribe({ channelId, callbackUrl, secret });
}
```

Les abonnements expirent : appelez `subscribe` de nouveau avant la fin de leur durée de validité. [Notifications push](/notifications/push-notifications/) donne les détails.

### Écarter les Shorts

Le flux indique si une entrée est un Short. Filtrez dessus avant de mettre en file :

```ts
const watcher = yt.watch(["@GoogleDevelopers"]);
const found = await watcher.check();

const withoutShorts = found.filter((video) => video.isShort !== true);
```

`isShort` vaut `undefined` pour une vidéo que l'observateur a découverte par la solution de repli de l'API, où cette information n'existe pas. La comparaison avec `true` les laisse passer.

### Dans un bot Discord

Un bot déjà en marche n'a pas besoin du webhook. Déplacez la boucle dans une fonction, appelez-la une fois le bot connecté, et remplacez le `fetch` de `post()` par un message envoyé par le bot. L'observateur, le fichier d'état et la file restent tels quels.

### Autres variantes

- Un webhook par chaîne YouTube : indexez une `Map` par `video.channelId`.
- Une ligne de texte au-dessus de l'embed : ajoutez une chaîne `content` à côté de `embeds` dans le corps de la requête.
- Depuis une tâche cron : supprimez la boucle et le `sleep`, et exécutez le corps une fois par invocation. [Surveiller les nouvelles vidéos](/notifications/watching-uploads/) montre cette forme.
