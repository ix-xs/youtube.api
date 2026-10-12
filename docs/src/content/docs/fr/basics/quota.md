---
title: Quota
description: "YouTube accorde à chaque projet une allocation quotidienne, répartie en enveloppes. Le client connaît le coût de chaque méthode, compte ce que vous dépensez et peut refuser un appel qui dépasserait le budget."
sidebar:
  order: 3
---

```ts
import { quotaCost } from "@ix-xs/youtube.api";

quotaCost("playlistItems.insert"); // { cost: 50, bucket: "default" }
quotaCost("search.list"); // { cost: 1, bucket: "search.list" }

yt.quota.used; // unités dépensées aujourd'hui dans l'enveloppe commune
yt.quota.remaining("search.list"); // recherches restantes aujourd'hui
yt.quota.resetsAt; // Date : le prochain minuit, heure du Pacifique
```

## Enveloppes

Depuis juin 2026, YouTube compte le quota par enveloppes. Trois méthodes ont leur propre enveloppe, et toutes les autres méthodes de l'API Data en partagent une seule.

| Enveloppe | Facturée par | Allocation quotidienne par défaut |
| --- | --- | --- |
| `default` | Toutes les méthodes de l'API Data non listées ci-dessous | 10 000 unités |
| `search.list` | `yt.search.list` et les raccourcis de `yt.search` | 100 appels |
| `videos.insert` | `yt.videos.insert`, l'envoi d'une vidéo | 100 appels |
| `videos.batchGetStats` | `yt.videos.batchGetStats` | 10 000 appels |

Un appel à l'une de ces trois méthodes coûte 1 dans sa propre enveloppe et rien dans `default`. Une recherche ne puise donc pas dans les unités de vos lectures et écritures, mais vous n'en avez que 100 par jour.

Les enveloppes sont remises à zéro à minuit, heure du Pacifique. `yt.quota.resetsAt` donne cet instant sous forme de `Date`.

Les API Analytics et Reporting ne sont pas facturées en unités. Le compteur note leurs appels sous `analytics` et `reporting`, à titre indicatif et sans limite.

L'allocation appartient à votre projet Google Cloud. Toutes les clés et tous les clients OAuth du projet y puisent, tout comme chaque processus qui les utilise.

## Ce que coûte un appel

Dans l'enveloppe `default`, le coût dépend de la méthode, pas de ce qu'elle renvoie :

| Type d'appel | Coût | Exemples |
| --- | --- | --- |
| La plupart des lectures | 1 unité | `videos.list`, `channels.list`, `playlistItems.list`, `commentThreads.list` |
| Diffusions et flux vidéo en direct, en lecture et en écriture | 1 unité | `liveBroadcasts.insert`, `liveBroadcasts.transition`, `liveStreams.update` |
| Une page de chat en direct | 5 unités | `liveChatMessages.list` |
| Un message de chat en direct, envoyé ou supprimé | 20 unités | `liveChatMessages.insert`, `liveChatMessages.delete` |
| La plupart des écritures | 50 unités | `playlists.insert`, `playlistItems.insert`, `videos.update`, `videos.rate`, `commentThreads.insert`, `thumbnails.set` |
| Bannissements et modérateurs du chat en direct | 50 à 200 unités | `liveChatModerators.list` 50, `liveChatModerators.insert` 200, `liveChatBans.insert` 200 |
| Sous-titres | 50 à 450 unités | `captions.list` 50, `captions.download` 200, `captions.insert` 400, `captions.update` 450 |

Trois règles en découlent :

- Les parties sont gratuites. `videos.list` coûte 1 unité avec une partie comme avec dix.
- Les éléments sont gratuits. Une page de 50 coûte autant qu'une page de 1.
- Les pages ne le sont pas. Chaque page d'une liste est un appel et coûte à nouveau le prix de la méthode.

[Coûts en quota](/reference/quota-costs/) donne le coût de chaque méthode. `quotaCost()` donne les mêmes chiffres dans le code, et chaque méthode affiche son coût dans votre éditeur.

```ts
const { cost, bucket } = quotaCost("captions.insert");
// { cost: 400, bucket: "default" }
```

## Lire le compteur

`yt.quota` compte ce que le client dépense, par enveloppe et par méthode.

```ts
await yt.videos.get(videoId); // 1 unité
await yt.search.videos("lofi hip hop"); // 1 recherche

yt.quota.used; // 1 : unités dépensées dans l'enveloppe default
yt.quota.usage; // { default: 1, "search.list": 1 }
yt.quota.byMethod; // { "videos.list": 1, "search.list": 1 }

yt.quota.remaining(); // 9999
yt.quota.remaining("search.list"); // 99
yt.quota.canAfford(50); // true : une écriture passe encore
yt.quota.canAfford(1, "search.list"); // true
```

Les compteurs reviennent à zéro d'eux-mêmes quand le jour change, à l'heure du Pacifique.

Si votre projet a une autre allocation, indiquez-la au compteur pour que `remaining()` et `canAfford()` restent justes :

```ts
const yt = new YouTube({
  apiKey,
  quota: { limits: { default: 50_000, "search.list": 500 } },
});
```

## Refuser un appel avant son envoi

Par défaut, le compteur se contente de compter. Avec `enforce: true`, il refuse un appel qui ne tient pas dans ce qui reste de son enveloppe. L'appel lève une `YouTubeQuotaBudgetError`, rien n'est envoyé et rien n'est dépensé.

```ts
const yt = new YouTube({
  apiKey,
  quota: { enforce: true, limits: { default: 2000 } },
});

try {
  await yt.videos.get(videoId); // 1 unité
} catch (error) {
  if (error instanceof YouTubeQuotaBudgetError) {
    const { cost, remaining, bucket, resetsAt } = error;
    console.log(`${cost} needed, ${remaining} left in "${bucket}"`);
    console.log("Budget resets at", resetsAt.toISOString());
  } else {
    throw error;
  }
}
```

Ici, `limits` est votre budget, et il peut être inférieur à l'allocation du projet. Donner 2 000 des 10 000 unités à un service laisse le reste aux autres.

Les appels en cours sont retenus sur le budget jusqu'à leur fin. Dix écritures parallèles de 50 unités avec 120 unités restantes ne passent pas toutes : deux passent, huit sont refusées.

## Quand le vrai quota est épuisé

L'API répond par une erreur, que le client lève sous la forme d'une `YouTubeApiError` de code `QUOTA_EXCEEDED`. Elle n'est pas retentée, car une nouvelle tentative avant la remise à zéro ne peut pas réussir.

```ts
try {
  await yt.search.videos("lofi hip hop"); // 1 appel de recherche
} catch (error) {
  if (isYouTubeError(error, "QUOTA_EXCEEDED")) {
    const wait = yt.quota.resetsAt.getTime() - Date.now();
    console.log(`Out of quota for ${Math.round(wait / 60_000)} more minutes`);
  } else {
    throw error;
  }
}
```

Cela peut arriver alors que `yt.quota.remaining()` est encore positif. Voir la section suivante.

## Ce que le compteur sait

Le compteur est local au client. Il reflète ce que ce client a envoyé, pas ce que votre projet a dépensé.

- Un autre processus, un autre serveur ou un autre outil qui utilise le même projet lui échappe.
- Un redémarrage le remet à zéro, sauf si vous le restaurez.
- Les clients créés avec [`yt.as()`](/auth/many-users/) partagent le compteur du client dont ils viennent.

Ce qui est compté :

| Issue d'un appel | Compté |
| --- | --- |
| Succès | Le coût de la méthode |
| Servi depuis le [cache](/basics/caching/) | Rien |
| Revalidé avec un ETag (réponse `304`) | Le coût de la méthode |
| Rejeté par l'API avec un statut `4xx` | 1 unité dans l'enveloppe de la méthode. Une requête rejetée coûte toujours au moins 1 unité |
| `401`, ou l'erreur de quota elle-même | Rien |
| Erreur serveur, délai dépassé, panne réseau | Rien |
| Refusé en local : identifiants absents, scope manquant, budget, argument invalide | Rien. L'appel n'est jamais parti |

## Conserver le compteur d'un redémarrage à l'autre

`yt.quota.snapshot()` renvoie l'utilisation sous forme de données simples. Stockez-les, puis redonnez-les au client avec l'option `restore`.

```ts
const yt = new YouTube({
  apiKey,
  quota: { enforce: true, restore: await db.loadQuota() },
});

yt.on("quota", () => db.saveQuota(yt.quota.snapshot()));
```

Un instantané porte le jour du Pacifique auquel il appartient. Celui d'un autre jour est ignoré : après un redémarrage passé minuit, heure du Pacifique, le compteur repart donc de zéro.

## Surveiller la dépense

Le client émet un événement `quota` chaque fois qu'il facture quelque chose.

```ts
yt.on("quota", ({ method, bucket, cost, used, remaining }) => {
  console.log(`${method}: ${cost} from "${bucket}", ${used} used`);
  if (bucket === "default" && remaining < 500) {
    void notify("Less than 500 quota units left today");
  }
});
```

L'événement `response` porte lui aussi le coût de chaque appel. [Configuration](/basics/configuration/) liste tous les événements.

## Dépenser moins

### Lire la playlist des envois plutôt que chercher

« Les vidéos de cette chaîne » n'est pas une recherche. Lire la playlist des envois de la chaîne coûte 1 unité de l'enveloppe commune pour 50 vidéos.

```ts
// 1 appel de recherche, sur les 100 du jour.
const found = await yt.search.list({
  part: "snippet",
  channelId,
  type: "video",
  order: "date",
});

// 1 unité, sur les 10 000 du jour.
const uploads = await yt.channels.uploads(channelId).take(50);

// 2 unités : les mêmes 50, en vidéos complètes avec durées et statistiques.
const latest = await yt.channels.latestVideos(channelId, { limit: 50 });
```

`yt.channels.uploads(channel, { kind: "shorts" })` restreint la liste aux Shorts, aux vidéos classiques ou aux directs, au même prix. [ID et URL](/basics/ids-and-urls/) explique les playlists qui se cachent derrière.

### Récupérer les identifiants par lots

Un appel accepte 50 identifiants. Récupérer 50 vidéos une par une coûte 50 unités, et en un seul lot 1 unité.

```ts
const videos = await yt.videos.getMany(ids); // 1 unité par tranche de 50 identifiants
```

Un résultat de recherche contient un extrait (`snippet`), mais ni durée ni statistiques. Prenez-y les identifiants et récupérez les vidéos en un appel : 1 recherche et 1 unité en tout.

### Demander toutes les parties utiles en une fois

Les parties sont gratuites, les appels ne le sont pas. Un appel avec trois parties coûte 1 unité. Trois appels avec une partie chacun en coûtent 3.

### Stocker les identifiants de chaîne, pas les handles

Un handle ou un nom d'utilisateur doit être résolu en identifiant de chaîne, ce qui coûte 1 unité. Le client retient la réponse tant qu'il vit. D'un redémarrage à l'autre, conservez l'identifiant `UC...` dans votre propre stockage : `yt.channels.resolveId("@handle")` vous le donne.

### Mettre en cache ce qui ne change pas

Avec `cache: true`, une lecture répétée dans les cinq minutes ne coûte rien. Des listes comme `videoCategories.list` peuvent être gardées un jour. Voir [Cache](/basics/caching/).

### Interroger les statistiques depuis leur propre enveloppe

`videos.batchGetStats` renvoie des statistiques à jour pour 50 vidéos au plus par appel, et puise dans sa propre enveloppe : 10 000 appels par jour. Un tableau de bord qui actualise les vues chaque minute laisse alors l'enveloppe commune tranquille.

```ts
const { items } = await yt.videos.batchGetStats({
  part: "statistics",
  id: ids,
});

for (const stat of items) console.log(stat.id, stat.statistics.viewCount);
```

### Ne pas interroger l'API pour les nouveaux envois

`yt.watch()` lit le flux public de chaque chaîne, qui ne coûte aucun quota. Il ne se rabat sur l'API, à 1 unité par chaîne et par tour, que lorsque le flux est indisponible. Un handle coûte 1 unité à résoudre, une seule fois. Les notifications push via `websub` ne coûtent rien non plus.

```ts
const watcher = yt.watch(["@GoogleDevelopers", "@YouTube"], {
  interval: "5m",
});
watcher.on("video", (video) => console.log(video.title, video.url));
watcher.start();
```

Voir [Surveiller les nouvelles vidéos](/notifications/watching-uploads/) et [Notifications push](/notifications/push-notifications/).

### Donner une limite à chaque parcours

Chaque page d'une liste coûte à nouveau le prix de la méthode. `.take(n)` et `.all({ limit })` s'arrêtent à la page qui atteint la limite. C'est surtout important pour les recherches, où chaque page est l'un des 100 appels quotidiens. Voir [Listes](/basics/lists/).

### Ralentir un chat en direct

Lire un chat en direct coûte 5 unités par requête, toutes les quelques secondes. L'option `minInterval` de `chat.messages()` règle un rythme plus lent. Voir [Chat en direct](/live/live-chat/).

## Référence

### `yt.quota`

| Membre | Type | Ce que c'est |
| --- | --- | --- |
| `used` | `number` | Unités dépensées aujourd'hui dans l'enveloppe `default` |
| `usage` | `Partial<Record<QuotaBucket, number>>` | Unités dépensées aujourd'hui, par enveloppe |
| `byMethod` | `Record<string, number>` | Unités dépensées aujourd'hui, par méthode |
| `limits` | `Record<QuotaBucket, number>` | Limites quotidiennes en vigueur, par enveloppe |
| `resetsAt` | `Date` | Le prochain minuit, heure du Pacifique |
| `remaining(bucket?)` | `number` | Unités restantes aujourd'hui dans une enveloppe. Enveloppe par défaut : `"default"` |
| `canAfford(cost, bucket?)` | `boolean` | Indique si un appel de `cost` unités tient encore. Avec `enforce`, les appels en cours sont comptés |
| `snapshot()` | `QuotaSnapshot` | L'utilisation sous forme de données simples, à stocker |
| `restore(snapshot)` | `void` | Charge un instantané. Celui d'un autre jour du Pacifique est ignoré |
| `reset()` | `void` | Remet les compteurs à zéro |

### L'option `quota`

| Champ | Type | Par défaut | Ce qu'il fait |
| --- | --- | --- | --- |
| `limits` | `Partial<Record<QuotaBucket, number>>` | Les allocations du tableau ci-dessus | Limites quotidiennes de votre projet, ou votre propre budget |
| `enforce` | `boolean` | `false` | Refuse, avant son envoi, un appel qui dépasserait une limite |
| `restore` | `QuotaSnapshot` | Aucun | Utilisation enregistrée plus tôt avec `yt.quota.snapshot()` |

### `YouTubeQuotaBudgetError`

Levée uniquement avec `enforce: true`. Son `code` est `QUOTA_BUDGET_EXCEEDED`.

| Champ | Type | Ce que c'est |
| --- | --- | --- |
| `bucket` | `string` | Enveloppe sur laquelle l'appel est facturé |
| `cost` | `number` | Unités que l'appel aurait coûté |
| `remaining` | `number` | Unités restantes dans l'enveloppe, appels en cours déduits |
| `resetsAt` | `Date` | Moment de la remise à zéro de l'enveloppe |

### L'événement `quota`

| Champ | Type | Ce que c'est |
| --- | --- | --- |
| `method` | `string` | Méthode facturée, par exemple `videos.list` |
| `bucket` | `QuotaBucket` | Enveloppe sur laquelle elle a été facturée |
| `cost` | `number` | Unités facturées |
| `used` | `number` | Unités dépensées aujourd'hui dans cette enveloppe, cette facturation comprise |
| `remaining` | `number` | Unités restantes aujourd'hui dans cette enveloppe |

### Fonctions et constantes

| Export | Ce que c'est |
| --- | --- |
| `quotaCost(method)` | `{ cost, bucket }` d'une méthode. Pour les API Analytics et Reporting, le coût est un simple nombre d'appels. Lève une `YouTubeArgumentError` pour un nom inconnu |
| `nextQuotaReset(now?)` | Le prochain minuit, heure du Pacifique, sous forme de `Date` |
| `DEFAULT_QUOTA_LIMITS` | L'allocation quotidienne par défaut de chaque enveloppe |

## Voir aussi

- [Coûts en quota](/reference/quota-costs/) : le coût de chaque méthode.
- [Cache](/basics/caching/) : des lectures qui ne coûtent rien.
- [Listes](/basics/lists/) : comment les pages sont récupérées, et comment les borner.
- [Erreurs](/basics/errors/) : `QUOTA_EXCEEDED` et `QUOTA_BUDGET_EXCEEDED`.
