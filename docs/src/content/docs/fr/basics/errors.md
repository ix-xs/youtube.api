---
title: Erreurs
description: "Un appel qui échoue lève une erreur avec un code stable et, si l'API a répondu, la raison qu'elle a donnée. Les limites de débit sont retentées, ainsi que les erreurs serveur et les pannes réseau sur les lectures, avant que rien ne soit levé."
sidebar:
  order: 4
---

```ts
import { YouTubeApiError, isYouTubeError } from "@ix-xs/youtube.api";

try {
  await yt.commentThreads.post(videoId, "Nice one"); // 50 unités
} catch (error) {
  if (error instanceof YouTubeApiError && error.reason === "commentsDisabled") {
    // les commentaires sont désactivés sur cette vidéo
  } else if (isYouTubeError(error, "QUOTA_EXCEEDED")) {
    // attendre yt.quota.resetsAt
  } else {
    throw error;
  }
}
```

## Les classes d'erreur

Tout ce que la bibliothèque lève étend `YouTubeError` et porte un `code`. La classe indique où l'échec s'est produit.

| Classe | Levée quand | Envoyé à l'API |
| --- | --- | --- |
| `YouTubeApiError` | L'API a répondu avec un statut d'erreur | Oui |
| `YouTubeRequestError` | Aucune réponse exploitable : délai dépassé, panne réseau, annulation, corps illisible, échec du flux public ou du hub WebSub | Peut-être |
| `YouTubeUploadError` | Un envoi de média n'a pas pu aboutir | Oui |
| `YouTubeAuthError` | Les identifiants manquent ou sont insuffisants, ou un échange OAuth a échoué | Non, sauf pour l'échange OAuth |
| `YouTubeArgumentError` | Un argument ne peut pas être correct, ou une référence ne correspond à rien : un handle sans chaîne, une vidéo sans chat en direct | Non, sauf la recherche qui n'a rien trouvé |
| `YouTubeQuotaBudgetError` | L'appel dépasserait le budget fixé avec `quota.enforce` | Non |

Un appel qui n'est pas parti ne coûte aucun quota. [Identifiants d'accès](/start/credentials/) décrit les vérifications d'authentification et [Quota](/basics/quota/) le budget.

## Réagir selon le code

`error.code` appartient à un ensemble fixe de chaînes. Comparez-le plutôt que de lire les messages. `isYouTubeError(error, code)` vérifie la classe et le code en un seul appel :

```ts
try {
  await yt.playlists.add(playlistId, videoId); // 50 unités
} catch (error) {
  if (isYouTubeError(error, "NOT_FOUND")) {
    console.log("That playlist or that video does not exist");
  } else if (isYouTubeError(error, "MISSING_CREDENTIALS")) {
    console.log("Sign in first");
  } else {
    throw error;
  }
}
```

Sans code, `isYouTubeError(error)` distingue une erreur de la bibliothèque de toute autre, et vous donne un `error.code` typé sur lequel faire un `switch` :

```ts
function explain(error: unknown): string {
  if (!isYouTubeError(error)) return "Something else went wrong";
  switch (error.code) {
    case "QUOTA_EXCEEDED":
      return `Out of quota until ${yt.quota.resetsAt.toISOString()}`;
    case "RATE_LIMITED":
      return "Too many requests, try again in a moment";
    case "TIMEOUT":
    case "NETWORK":
      return "YouTube could not be reached";
    default:
      return error.message;
  }
}
```

Pour une erreur d'API, le code vient d'abord de la raison, ensuite du statut HTTP. Un `403` dont la raison est `quotaExceeded` a le code `QUOTA_EXCEEDED`, pas `FORBIDDEN`. Un `403` dont la raison est `rateLimitExceeded` a le code `RATE_LIMITED`.

La référence en fin de page liste tous les codes.

## Réagir selon la raison

Un code dit de quelle sorte d'échec il s'agit. La `reason` d'une `YouTubeApiError` dit ce que l'API reproche à l'appel. C'est la `reason` de la première entrée du corps de l'erreur. Quand le corps en contient une plus précise dans ses détails, par exemple une clé invalide ou un scope manquant, c'est celle-là qui est retenue.

```ts
try {
  await yt.videos.rate({ id: videoId, rating: "like" }); // 50 unités
} catch (error) {
  if (!(error instanceof YouTubeApiError)) throw error;

  if (error.reason === "videoRatingDisabled") {
    console.log("Ratings are turned off on that video");
  } else {
    console.log(error.status, error.reason, error.message);
  }
}
```

`error.reason` est typé avec les raisons sur lesquelles il vaut la peine de réagir, ce qui permet à votre éditeur de les compléter. Le type reste ouvert : l'API peut renvoyer une raison absente de la liste. [Codes d'erreur](/reference/errors/) explique chaque raison.

Une `YouTubeApiError` offre trois raccourcis pour les cas que vous traiterez le plus souvent :

| Accesseur | Vrai quand | Que faire |
| --- | --- | --- |
| `error.isQuotaExceeded` | Le projet a épuisé son quota du jour | Arrêtez. Réessayer avant minuit, heure du Pacifique, ne sert à rien |
| `error.isRateLimited` | Trop de requêtes dans une courte fenêtre | Réessayez après une pause. Le client l'a déjà fait, voir plus bas |
| `error.isNotFound` | La ressource n'existe pas, ou les identifiants ne la voient pas | Considérez-la comme absente |

```ts
try {
  const items = await yt.channels.uploads(channelId).take(10); // 1 unité
  console.log(items.length);
} catch (error) {
  if (error instanceof YouTubeApiError && error.isNotFound) {
    console.log("This channel never uploaded anything");
  } else {
    throw error;
  }
}
```

Les raccourcis nommés `get` ne lèvent pas d'erreur pour une ressource absente. `yt.videos.get`, `yt.channels.get` et `yt.playlists.get` se résolvent en `null`.

## Ce qui est retenté

Le client retente de lui-même un appel échoué quand une nouvelle tentative peut aider sans risque de dégât. Une erreur ne vous parvient qu'une fois les tentatives épuisées.

| Échec | Une lecture (`GET`) | Une écriture |
| --- | --- | --- |
| Limite de débit : un `429`, ou les raisons `rateLimitExceeded` et `userRateLimitExceeded` | Retentée | Retentée |
| Erreur serveur, `5xx` | Retentée | Non retentée |
| Délai dépassé ou panne réseau | Retentée | Non retentée |
| Quota dépassé | Non retentée | Non retentée |
| Tout autre `4xx` | Non retentée | Non retentée |
| Annulée avec `signal`, ou corps illisible | Non retentée | Non retentée |

Une limite de débit signifie que l'appel n'a pas été traité : on peut donc le renvoyer sans risque. Une erreur serveur ou un délai dépassé ne dit rien d'une écriture, qui a pu aboutir. Le client ne la renvoie jamais, si bien qu'une nouvelle tentative ne peut pas créer un second commentaire ni un second élément de playlist. Si une écriture échoue ainsi, lisez la ressource avant de la renvoyer.

Par défaut, il y a 3 nouvelles tentatives. Le délai commence à 500 ms et double à chaque fois, jusqu'à 30 secondes. Le client attend une durée aléatoire entre la moitié de ce délai et le délai entier, pour que de nombreux clients ne retentent pas tous en même temps. Quand l'API envoie un en-tête `Retry-After`, sa valeur remplace le délai. Si elle dépasse `maxDelay`, l'appel n'est pas retenté : l'erreur est levée aussitôt avec son `retryAfter`, et vous décidez s'il faut attendre.

Un cas est traité à part. Sur un `401`, un client dont l'`OAuth2` a un jeton de rafraîchissement rafraîchit le jeton d'accès une fois et renvoie l'appel. Cela ne compte pas comme une nouvelle tentative.

Un envoi avec reprise applique le même nombre de tentatives et les mêmes délais à chaque morceau, et reprend à l'octet que le serveur a confirmé. Voir [Envois](/resources/uploads/).

## Régler les nouvelles tentatives et les délais

Ce sont deux options du client, et chacune peut être remplacée pour un seul appel.

```ts
const yt = new YouTube({
  apiKey,
  retry: { attempts: 5, delay: "1s", maxDelay: "1m" },
  timeout: "10s",
});

// Aucune nouvelle tentative et un délai court pour cet appel.
await yt.videos.get(videoId, { retry: false, timeout: "3s" });

// Seul le nombre de tentatives change. Les délais restent ceux du client.
await yt.videos.get(videoId, { retry: { attempts: 1 } });
```

`timeout` est le temps accordé à une tentative, `"30s"` par défaut, et `0` le désactive. Un appel retenté trois fois peut donc durer quatre délais plus les attentes. Un délai dépassé lève une `YouTubeRequestError` de code `TIMEOUT`. Les envois, les téléchargements de rapports et le flux du chat en direct n'y sont pas soumis : donnez-leur un `signal`.

L'événement `retry` se déclenche avant chaque attente :

```ts
yt.on("retry", ({ method, attempt, delay, error }) => {
  console.warn(`${method}: retry ${attempt} in ${delay} ms (${error.message})`);
});
```

## Annuler un appel

Passez un `signal`. L'annuler interrompt la requête, ou l'attente entre deux tentatives, et l'appel lève une `YouTubeRequestError` de code `ABORTED`.

```ts
const controller = new AbortController();
setTimeout(() => controller.abort(), 5_000);
const { signal } = controller;

try {
  for await (const item of yt.playlists.items(playlistId, { signal })) {
    console.log(item.snippet.title);
  }
} catch (error) {
  if (!isYouTubeError(error, "ABORTED")) throw error;
}
```

`timeout` borne une tentative. Pour borner un appel entier, nouvelles tentatives comprises, utilisez un signal :

```ts
await yt.videos.get(videoId, { signal: AbortSignal.timeout(15_000) });
```

## Ce que contient une erreur

Le message d'une `YouTubeApiError` ou d'une `YouTubeRequestError` commence par la méthode qui a échoué, `videos.list: `, suivie de ce qui s'est passé. Une `YouTubeApiError` porte aussi le reste de la réponse.

```ts
try {
  await yt.videos.get(videoId); // 1 unité
} catch (error) {
  if (error instanceof YouTubeApiError) {
    console.error({
      code: error.code, // "FORBIDDEN"
      status: error.status, // 403
      reason: error.reason, // "accessNotConfigured"
      method: error.method, // "videos.list"
      url: error.url, // l'URL de la requête
      errors: error.errors, // chaque entrée du corps de l'erreur
    });
  }
  throw error;
}
```

`error.url` est expurgée de ses identifiants : vous pouvez la consigner sans risque. Il en va de même des URL dans les événements du client. De toute façon, la clé d'API ne figure pas dans l'URL : elle voyage dans un en-tête.

Une erreur qui en enveloppe une autre, une erreur réseau par exemple, la garde dans `error.cause`.

## Référence

### Codes

| `code` | Classe | Signification |
| --- | --- | --- |
| `BAD_REQUEST` | `YouTubeApiError` | Statut 400 |
| `UNAUTHORIZED` | `YouTubeApiError` | Statut 401 |
| `FORBIDDEN` | `YouTubeApiError` | Statut 403, pour une autre raison que le quota ou la limite de débit |
| `NOT_FOUND` | `YouTubeApiError` | Statut 404 |
| `CONFLICT` | `YouTubeApiError` | Statut 409 |
| `QUOTA_EXCEEDED` | `YouTubeApiError` | Raison `quotaExceeded` ou `dailyLimitExceeded` |
| `RATE_LIMITED` | `YouTubeApiError` | Statut 429, ou raison `rateLimitExceeded` ou `userRateLimitExceeded` |
| `SERVER_ERROR` | `YouTubeApiError` | Statut 500 et au-delà. Aussi une `YouTubeRequestError` quand `oEmbed` reçoit un statut d'erreur |
| `API_ERROR` | `YouTubeApiError` | Tout autre statut d'erreur |
| `TIMEOUT` | `YouTubeRequestError` | Aucune réponse dans le délai `timeout` |
| `NETWORK` | `YouTubeRequestError` | La requête n'a pas pu être faite |
| `ABORTED` | `YouTubeRequestError` | Votre `signal` a annulé l'appel |
| `PARSE_ERROR` | `YouTubeRequestError` | La réponse n'est pas du JSON valide |
| `FEED_UNAVAILABLE` | `YouTubeRequestError` | Le flux public d'une chaîne ou d'une playlist n'a pas pu être lu |
| `HUB_ERROR` | `YouTubeRequestError` | Le hub WebSub a répondu à une demande d'abonnement par un statut d'erreur |
| `UPLOAD_FAILED` | `YouTubeUploadError` | Un envoi de média n'a pas pu aboutir |
| `MISSING_CREDENTIALS` | `YouTubeAuthError` | Aucun identifiant, ou l'appel exige OAuth et il n'y a pas de jeton |
| `INSUFFICIENT_SCOPE` | `YouTubeAuthError` | Le jeton n'a aucun des scopes que la méthode accepte |
| `OAUTH_ERROR` | `YouTubeAuthError` | Une requête OAuth a échoué, ou le jeton d'accès a expiré et il n'y a pas de jeton de rafraîchissement |
| `INVALID_ARGUMENT` | `YouTubeArgumentError` | Un argument ne peut pas être correct, ou une référence ne correspond à rien |
| `QUOTA_BUDGET_EXCEEDED` | `YouTubeQuotaBudgetError` | L'appel ne tient pas dans le budget de `quota.enforce` |

[Codes d'erreur](/reference/errors/) indique, pour chaque code, ce qui est retenté et que faire. Elle liste aussi toutes les raisons et les champs de chaque classe d'erreur.

### Options de nouvelles tentatives et de délai

Elles existent sur le client et sur chaque appel.

| Option | Type | Par défaut | Ce qu'elle fait |
| --- | --- | --- | --- |
| `retry.attempts` | `number` | `3` | Nouvelles tentatives après la première. `0` les désactive |
| `retry.delay` | `Duration` | `"500ms"` | Premier délai, doublé à chaque nouvelle tentative |
| `retry.maxDelay` | `Duration` | `"30s"` | Borne supérieure d'un délai. Un `Retry-After` plus long n'est pas attendu |
| `retry` | `false` | | Désactive les nouvelles tentatives |
| `timeout` | `Duration` | `"30s"` | Temps accordé à une tentative. `0` le désactive |
| `signal` | `AbortSignal` | | Annule l'appel. Par appel uniquement |

Un `retry` passé à un appel ne remplace que les champs qu'il définit.

## Voir aussi

- [Codes d'erreur](/reference/errors/) : chaque code, chaque raison et les champs de chaque classe.
- [Quota](/basics/quota/) : `QUOTA_EXCEEDED`, et comment ne pas l'atteindre.
- [Identifiants d'accès](/start/credentials/) : les appels refusés avant d'être envoyés.
- [Dépannage](/help/troubleshooting/) : les erreurs que l'on rencontre en premier.
