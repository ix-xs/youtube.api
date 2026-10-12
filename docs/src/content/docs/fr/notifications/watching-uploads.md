---
title: Surveiller les nouvelles vidéos
description: Soyez prévenu quand une chaîne publie une vidéo, par interrogation. Rien à héberger. La lecture ne coûte aucun quota tant que le flux public de YouTube répond.
sidebar:
  order: 1
---

```ts
const watcher = yt.watch(["@GoogleDevelopers", "@YouTube"], { interval: "5m" });

watcher.on("video", (video) => {
  console.log(`${video.channelTitle} uploaded ${video.title}: ${video.url}`);
});
watcher.on("error", ({ channel, error }) => console.warn(channel, error));

watcher.start();
```

## Fonctionnement

`yt.watch(channels, options)` renvoie un `Watcher`. Les chaînes se donnent sous forme d'identifiants, de handles ou d'URL, une seule ou une liste.

Un tour vérifie toutes les chaînes, quatre à la fois. `start()` lance un tour tout de suite, puis un par `interval`. Pour chaque chaîne, l'observateur lit ses 15 vidéos les plus récentes et signale celles qui sont nouvelles.

Une vidéo est nouvelle quand les deux conditions sont réunies :

- elle a été publiée après `since` ;
- cet observateur ne l'a jamais vue.

Par défaut, `since` est l'instant où l'observateur est créé : un observateur tout neuf ne signale donc que les vidéos publiées à partir de maintenant. Il ne vous noie jamais sous le catalogue ancien.

Une vidéo sans date exploitable ne peut pas être comparée à `since`. Elle est signalée une fois la chaîne lue une première fois : ce que trouve cette première lecture est considéré comme déjà connu.

## Réagir aux événements

```ts
const watcher = yt.watch("@GoogleDevelopers");

const off = watcher.on("video", async (video) => {
  await notify(`${video.title} ${video.url}`);
});

watcher.on("error", ({ channel, error }) => {
  if (channel) console.warn(`Could not check ${channel}:`, error);
  else console.warn("A listener failed:", error);
});
watcher.on("poll", ({ channel, source, found }) => {
  console.log(channel, source, found);
});

watcher.start();

// Plus tard.
off(); // retire cet écouteur
watcher.stop(); // arrête l'interrogation
```

| Événement | Contenu | Quand |
| --- | --- | --- |
| `video` | Un `WatchedVideo` | Une nouvelle vidéo a été trouvée. Au sein d'un tour, la plus ancienne d'abord |
| `error` | `{ channel, error }` | La vérification d'une chaîne a échoué, ou l'un de vos écouteurs a échoué. L'observateur continue |
| `poll` | `{ channel, channelId, source, found }` | Une chaîne a été vérifiée, avec le nombre de nouvelles vidéos |

`on` renvoie une fonction qui retire l'écouteur. `once` et `off` existent aussi.

Dans le contenu d'un événement `error`, `channel` est la chaîne telle que vous l'avez donnée. C'est une chaîne vide quand l'échec ne concerne pas une chaîne : l'un de vos propres écouteurs a levé une erreur, ou renvoyé une promesse rejetée. Un écouteur qui échoue n'arrête jamais l'observateur.

Écoutez `error`. Sans écouteur, tous les échecs passent sous silence : un handle mal saisi, une panne du flux public en mode `feed`, un problème de quota, un de vos écouteurs qui a levé une erreur.

Une référence qui ne correspond à aucune chaîne est signalée une fois par `error`, sous la forme d'une `YouTubeArgumentError`. L'observateur la laisse ensuite de côté pendant 6 heures avant de la chercher de nouveau, pour qu'une faute de frappe ne dépense pas de quota à chaque tour.

## Sous forme de flux asynchrone

Un observateur est aussi un itérable asynchrone. La boucle démarre l'observateur et l'arrête quand vous en sortez.

```ts
const uploads = yt.watch(["@GoogleDevelopers"], { interval: "10m" });

for await (const video of uploads) {
  console.log(video.title, video.url);
  if (video.title.includes("Keynote")) break; // arrête aussi l'observateur
}
```

## Ajouter et retirer des chaînes

```ts
const watcher = yt.watch([]).start();

watcher.add("@GoogleDevelopers").add("https://www.youtube.com/@YouTube");
watcher.remove("@GoogleDevelopers");

watcher.channels; // ["https://www.youtube.com/@YouTube"]
watcher.running; // true
```

`remove` prend la chaîne telle que vous l'avez donnée à `add`. Une chaîne ajoutée par son handle ne se retire pas par son identifiant.

Les identifiants de chaîne sont comparés tels quels, majuscules et minuscules comprises. Les handles et les URL sont comparés sans tenir compte de la casse : `remove("@googledevelopers")` retire `"@GoogleDevelopers"`. Ajouter une chaîne déjà présente ne fait rien.

Une chaîne ajoutée avec `add()` après la création de l'observateur part de l'instant où elle est ajoutée : ce qu'elle a publié avant n'est pas signalé, quelle que soit la valeur de `since`.

## Depuis une tâche cron

Quand il n'y a pas de processus de longue durée, lancez un seul tour par exécution avec `check()`. Elle renvoie les nouvelles vidéos, la plus ancienne d'abord. Elles sont aussi émises comme événements `video`.

Donnez à `since` un instant situé quelques minutes avant votre exécution précédente. Le flux public prend du retard sur les publications : une vidéo publiée juste avant une exécution peut n'apparaître dans le flux qu'après. La marge fait se chevaucher deux exécutions, alors retenez les vidéos que vous avez traitées et ignorez-les :

```ts
const MARGIN = 10 * 60_000;
const startedAt = Date.now();
const lastRun: number | undefined = await db.get("lastRun");

const watcher = yt.watch(["@GoogleDevelopers", "@YouTube"], {
  since: lastRun === undefined ? startedAt : lastRun - MARGIN,
});

let failed = false;
watcher.on("error", ({ channel, error }) => {
  failed = true;
  console.warn(channel, error);
});

for (const video of await watcher.check()) {
  if (await db.has(`seen:${video.videoId}`)) continue;
  await notify(`${video.channelTitle}: ${video.title} ${video.url}`);
  await db.set(`seen:${video.videoId}`, true);
}

// Ne faire avancer le repère que si toutes les chaînes ont été lues.
if (!failed) await db.set("lastRun", startedAt);
```

Deux détails rendent ce schéma fiable :

- Le repère est l'instant où l'exécution a démarré, pas celui où elle s'est terminée. Une vidéo publiée pendant l'exécution est récupérée par la suivante.
- `check()` n'est pas rejetée quand une chaîne échoue. Elle émet `error` et renvoie ce que les autres chaînes ont donné. Si vous faisiez avancer le repère malgré tout, les vidéos de la chaîne en échec seraient perdues définitivement.

La même option permet de rattraper le retard après le redémarrage d'un observateur de longue durée. Le rattrapage remonte à 15 vidéos par chaîne au plus, car c'est ce que lit un tour.

`since` accepte un `Date`, une chaîne ISO ou un horodatage en millisecondes. Une date invalide lève une `YouTubeArgumentError`.

## Où l'observateur va chercher

L'option `source` en décide.

| `source` | Lit | Coût |
| --- | --- | --- |
| `"auto"` (par défaut) | Le flux public. Quand le flux d'une chaîne échoue, l'API pour cette chaîne | Rien tant que le flux fonctionne |
| `"feed"` | Le flux public seulement | Rien |
| `"api"` | La playlist des envois, par l'API Data | 1 unité par chaîne et par tour |

En plus, un handle coûte 1 unité pour être résolu en identifiant, une seule fois. Les identifiants de chaîne et les URL `/channel/` ne coûtent rien : voir [Chaînes](/resources/channels/).

### Le flux public, sans détour

Le flux public est un document Atom que YouTube sert pour chaque chaîne. Il ne demande ni clé ni quota. YouTube ne le garantit pas :

- Il prend quelques minutes de retard sur les publications.
- Il a des pannes pendant lesquelles tous les flux répondent 404, parfois des heures.

C'est pourquoi `auto` est la valeur par défaut. Quand le flux d'une chaîne échoue, l'observateur lit cette chaîne par l'API dans le même tour, et continue ainsi pendant 30 minutes avant de réessayer le flux. Les 30 minutes sont comptées par chaîne : les autres chaînes restent sur le flux jusqu'à l'échec de leur propre flux. Pendant une panne, un tour coûte 1 unité par chaîne.

Le coût d'une panne dépend du rythme. Avec 10 chaînes toutes les 5 minutes, il y a 12 tours par heure : 120 unités par heure de panne, et 2 880 unités si elle durait toute la journée. `source: "api"` coûte cela chaque jour.

Avec `source: "feed"`, un échec est un événement `error` et le tour ne signale rien pour cette chaîne. L'erreur est une `YouTubeRequestError` avec le code `FEED_UNAVAILABLE`, ou `TIMEOUT` quand le flux n'a pas répondu en 15 secondes. Les vidéos publiées pendant la panne sont signalées au retour du flux, tant qu'elles figurent encore parmi les 15 plus récentes.

[Flux et oEmbed](/notifications/feeds-and-oembed/) décrit le flux public lui-même.

## À quoi ressemble une vidéo

```ts
const watcher = yt.watch("@GoogleDevelopers");

watcher.on("video", (video) => {
  video.videoId; // "dQw4w9WgXcQ"
  video.channelId; // "UC..."
  video.channelTitle;
  video.title;
  video.url;
  video.publishedAt; // ISO 8601
  video.thumbnail; // string | undefined
  video.isShort; // boolean | undefined
  video.source; // "feed" | "api"
});
```

`isShort` n'est connu que si la vidéo vient du flux public. Par l'API, il vaut `undefined` : testez `video.source`, ou gérez les trois cas.

Pour en savoir plus, récupérez la vidéo. Un appel à `videos.list` coûte 1 unité :

```ts
const watcher = yt.watch("@GoogleDevelopers");

watcher.on("video", async ({ videoId }) => {
  const video = await yt.videos.get(videoId);
  if (!video) return;
  console.log(formatDuration(video.contentDetails.duration));
  console.log(video.statistics.viewCount);
});
```

## Sans clé d'API

`Watcher` s'utilise seul, à partir du flux public uniquement. Il n'accepte alors que des identifiants de chaîne : résoudre un handle demande l'API.

```ts
import { Watcher } from "@ix-xs/youtube.api";

const watcher = new Watcher(["UC_x5XG1OV2P6uZZ5FSM9Ttw"], { interval: "10m" });

watcher.on("video", (video) => console.log(video.title, video.url));
watcher.on("error", ({ channel, error }) => console.warn(channel, error));
watcher.start();
```

Il n'y a pas d'API de repli ici : `auto` signifie le flux public seul, et une panne se traduit par des événements `error` jusqu'à son terme. Un handle, une URL ou `source: "api"` lève une `YouTubeArgumentError`.

## Interrogation ou push

L'interrogation ne demande qu'un processus en cours d'exécution, et vous prévient d'une publication après le retard du flux public, plus au plus un `interval`.

Les [notifications push](/notifications/push-notifications/) vous parviennent en quelques secondes, sans interrogation et sans quota. Elles demandent un point de terminaison HTTPS public, et des abonnements que vous renouvelez.

Utilisez l'observateur pour un bot, un script ou une tâche cron. Utilisez le push quand vous faites déjà tourner un serveur web et que le délai compte.

## Référence

### `WatcherOptions`

| Option | Par défaut | Signification |
| --- | --- | --- |
| `interval` | `"5m"` | Durée entre deux tours : des millisecondes, ou une chaîne comme `"30s"`, `"5m"`, `"2h"` |
| `source` | `"auto"` | `"auto"`, `"feed"` ou `"api"` |
| `since` | Heure de création | Signaler les vidéos publiées après cet instant. Pour les chaînes données à la création |
| `fetch` | Celui du client | `fetch` personnalisé pour les requêtes vers le flux public |

### `Watcher`

| Membre | Ce qu'il fait |
| --- | --- |
| `on(event, listener)` | S'abonne. Renvoie une fonction qui se désabonne |
| `once(event, listener)`, `off(event, listener)` | Une seule occurrence, et retrait |
| `hasListeners(event)` | Indique si quelqu'un écoute l'événement |
| `start()` | Un tour tout de suite, puis un par intervalle. Renvoie l'observateur |
| `stop()` | Arrête l'interrogation |
| `check()` | Lance un tour et renvoie les nouvelles vidéos, la plus ancienne d'abord |
| `add(channel)`, `remove(channel)` | Modifie la liste. Les deux renvoient l'observateur |
| `channels` | Les chaînes surveillées, telles qu'elles ont été données |
| `running` | Indique si l'observateur interroge |
| `for await (const video of watcher)` | Démarre, produit les nouvelles vidéos, s'arrête à la sortie de la boucle |

Appeler `check()` pendant qu'un tour est en cours renvoie ce tour au lieu d'en lancer un second. `check()` n'est jamais rejetée à cause de l'échec d'une chaîne.

### `WatchedVideo`

| Champ | Type | Remarques |
| --- | --- | --- |
| `videoId` | `string` | |
| `channelId` | `string` | |
| `channelTitle` | `string` | |
| `title` | `string` | |
| `url` | `string` | Depuis le flux public, un Short renvoie vers le lecteur Shorts |
| `publishedAt` | `string` | Date ISO 8601 de la mise en ligne publique de la vidéo |
| `thumbnail` | `string \| undefined` | La plus grande miniature disponible |
| `isShort` | `boolean \| undefined` | Connu seulement depuis le flux public |
| `source` | `"feed" \| "api"` | D'où l'observateur l'a apprise |

## Voir aussi

- [Notifications push](/notifications/push-notifications/) pour une remise en quelques secondes.
- [Flux et oEmbed](/notifications/feeds-and-oembed/) pour le flux que lit l'observateur.
- [Annoncer les nouvelles vidéos sur Discord](/recipes/discord-upload-notifier/) pour un programme complet.
- [Quota](/basics/quota/) pour voir ce que dépense le repli sur l'API.
