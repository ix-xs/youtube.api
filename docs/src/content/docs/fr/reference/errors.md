---
title: Codes d'erreur
description: "Tous les codes d'erreur que la bibliothèque lève, les raisons données par l'API et les propriétés de chaque classe d'erreur. Servez-vous-en pour savoir ce que signifie un échec et si une nouvelle tentative a déjà eu lieu."
---

```ts
try {
  await yt.playlists.add(playlistId, videoId);
} catch (error) {
  if (error instanceof YouTubeApiError) {
    error.code; // défini par la bibliothèque, par exemple "NOT_FOUND"
    error.reason; // envoyé par l'API, par exemple "playlistNotFound"
  }
  throw error;
}
```

Toute erreur étend `YouTubeError` et porte un `code`. Une `YouTubeApiError` porte aussi la `reason` donnée par l'API. [Erreurs](/basics/errors/) explique comment les traiter. Cette page est la table de consultation.

## Codes

`code` est un `YouTubeErrorCode`. Il en existe 21.

Dans les tableaux, « réessayé » signifie jusqu'à 3 nouvelles tentatives par défaut. Le délai démarre à 500 ms et double, jusqu'à 30 secondes, avec un peu d'aléa. Quand l'API envoie un `Retry-After`, cette attente est utilisée à la place. Un `Retry-After` plus long que `retry.maxDelay` n'est pas attendu : l'erreur est levée tout de suite, avec son `retryAfter`. Une lecture est un `GET`. [Erreurs](/basics/errors/) donne la politique complète et les options qui la modifient.

Ce qui est réessayé, en bref :

| Échec | Lectures | Écritures |
| --- | --- | --- |
| Limite de débit | Réessayé | Réessayé |
| Erreur du serveur, délai dépassé, échec réseau | Réessayé | Non réessayé : l'écriture a peut-être abouti |
| Statut 401, quand le client a un `OAuth2` capable de rafraîchir | Renvoyé une fois avec un nouveau jeton | Renvoyé une fois avec un nouveau jeton |
| Tout le reste | Non réessayé | Non réessayé |

### L'API a répondu par une erreur

Toutes ces erreurs sont levées sous la forme d'une `YouTubeApiError`. Le code suit le statut HTTP, sauf pour les raisons de quota et de limite de débit, qui l'emportent sur le statut. `SERVER_ERROR` a une autre source : `oEmbed` le lève sous la forme d'une `YouTubeRequestError` quand YouTube répond avec un statut inattendu.

| Code | Quand | Réessayé par la bibliothèque | Que faire |
| --- | --- | --- | --- |
| `BAD_REQUEST` | Statut 400 | Non | Corrigez l'appel. `error.reason` et `error.errors` désignent le paramètre ou le champ |
| `UNAUTHORIZED` | Statut 401 | Une fois, après avoir rafraîchi le jeton, quand le client a un `OAuth2` capable de rafraîchir | Renvoyez l'utilisateur vers l'écran de consentement, ou remplacez le jeton d'accès |
| `FORBIDDEN` | Statut 403 sans raison de quota ni de limite de débit | Non | Lisez `error.reason` : la clé, le projet, le compte ou la ressource refuse l'appel |
| `NOT_FOUND` | Statut 404 | Non | La ressource n'existe pas, ou ces identifiants ne peuvent pas la voir |
| `CONFLICT` | Statut 409 | Non | La ressource est dans un état qui refuse la modification. Relisez-la avant de réessayer |
| `QUOTA_EXCEEDED` | Raison `quotaExceeded` ou `dailyLimitExceeded`, quel que soit le statut | Non | Attendez `yt.quota.resetsAt`. Voir [Quota](/basics/quota/) |
| `RATE_LIMITED` | Statut 429, ou raison `rateLimitExceeded` ou `userRateLimitExceeded` | Oui, lectures et écritures | Ralentissez. Elle ne vous parvient qu'une fois les nouvelles tentatives épuisées, ou quand l'API a demandé une attente plus longue que `retry.maxDelay` |
| `SERVER_ERROR` | Statut 500 et au-delà. Pour `oEmbed` : tout statut d'erreur autre que 400, 401, 403 et 404, qui donnent `null` | Lectures seulement. `oEmbed` n'est pas réessayé | Réessayez plus tard. Pour une écriture, vérifiez si elle a été appliquée avant de la renvoyer |
| `API_ERROR` | Tout autre statut d'erreur | Non | Lisez `error.status` et `error.body` |

### La requête n'a produit aucune réponse exploitable

Toutes ces erreurs sont levées sous la forme d'une `YouTubeRequestError`.

| Code | Quand | Réessayé par la bibliothèque | Que faire |
| --- | --- | --- | --- |
| `TIMEOUT` | Aucune réponse dans le délai `timeout`, 30 secondes par défaut. Aussi un flux public ou une requête oEmbed sans réponse dans son propre `timeout`, 15 secondes par défaut | Lectures seulement. Les requêtes de flux public et oEmbed ne sont pas réessayées | Augmentez `timeout`, ou réessayez plus tard |
| `NETWORK` | `fetch` a échoué : DNS, connexion, TLS. Aussi une requête oEmbed ou un hub WebSub injoignable | Lectures seulement. Les requêtes oEmbed, les requêtes au hub et les téléchargements de rapports ne sont pas réessayés. Le flux du chat est rouvert jusqu'à trois fois de suite | Vérifiez la connexion. `error.cause` contient l'échec sous-jacent |
| `ABORTED` | Le `signal` que vous avez passé a été interrompu, pendant la requête ou pendant l'attente avant une nouvelle tentative | Non | Rien : vous l'avez demandé |
| `PARSE_ERROR` | L'API, ou `oEmbed`, a répondu par un statut de succès et un corps qui n'est pas du JSON valide | Non | Réessayez. Si un proxy se trouve entre vous et l'API, regardez ce qu'il renvoie |
| `FEED_UNAVAILABLE` | Le flux public d'une chaîne ou d'une playlist a répondu par un statut d'erreur, ou n'a pas pu être joint | Non. `yt.watch()` lit alors cette chaîne par l'API pendant les 30 minutes suivantes | Ne concluez pas que la chaîne a disparu. Voir [Flux et oEmbed](/notifications/feeds-and-oembed/) |
| `HUB_ERROR` | Le hub WebSub a refusé `websub.subscribe()` ou `websub.unsubscribe()` : il a répondu par un statut d'erreur | Non | Lisez le message, qui contient le statut et la réponse du hub. Voir [Notifications push](/notifications/push-notifications/) |

`SERVER_ERROR` venant de `oEmbed` appartient aussi à cette classe, voir le tableau ci-dessus.

### Refusé par la bibliothèque

Aucune de ces erreurs n'est réessayée. La première, la deuxième et la dernière sont levées avant l'envoi de la requête : elles ne dépensent donc aucun quota.

| Code | Classe | Quand | Que faire |
| --- | --- | --- | --- |
| `MISSING_CREDENTIALS` | `YouTubeAuthError` | Le client n'a pas d'identifiants. Ou l'appel exige OAuth et il n'y a qu'une clé d'API : toute écriture, tout appel Analytics et Reporting, quelques lectures privées par nature comme `captions.list`, et les lectures avec des paramètres comme `mine`. Ou le client `OAuth2` n'a pas encore de jetons | Passez `oauth` ou `accessToken`. `error.scopes` liste les scopes que la méthode accepte |
| `INSUFFICIENT_SCOPE` | `YouTubeAuthError` | Les scopes accordés au jeton n'incluent aucun de ceux que la méthode accepte. Une lecture publique n'est pas refusée quand le client a aussi une clé d'API : elle part avec la clé | Renvoyez l'utilisateur vers l'écran de consentement avec l'un des `error.scopes` |
| `INVALID_ARGUMENT` | `YouTubeArgumentError` | Un argument ne peut pas être correct : une chaîne qui n'est ni un identifiant ni une URL de vidéo, un nom de méthode inconnu, une durée invalide, un type de média que la méthode n'accepte pas, un fichier vide. Ou une référence n'a rien trouvé : un handle sans chaîne, une vidéo sans chat en direct. Ce second cas n'est connu qu'après une recherche, qui coûte son unité habituelle | Corrigez l'argument. Le message dit lequel |
| `QUOTA_BUDGET_EXCEEDED` | `YouTubeQuotaBudgetError` | Le client a été créé avec `quota.enforce` et l'appel ne tient pas dans ce qui reste de son enveloppe | Attendez `error.resetsAt`, ou augmentez `quota.limits` |

### OAuth et envois

| Code | Classe | Quand | Réessayé par la bibliothèque | Que faire |
| --- | --- | --- | --- | --- |
| `OAUTH_ERROR` | `YouTubeAuthError` | Google a refusé une demande de jeton : échange, rafraîchissement, révocation, flux pour appareils. Ou le jeton d'accès a expiré et il n'y a pas de jeton de rafraîchissement. Ou votre rappel `onTokens` a levé une erreur. Ou personne n'a terminé `authorize()` à temps | Non | Lisez `error.oauthError`. Voir [les noms ci-dessous](#oauth-error-names) |
| `UPLOAD_FAILED` | `YouTubeUploadError` | Un envoi de média n'a pas pu aboutir : une session n'a pas pu être ouverte ou jointe, les nouvelles tentatives d'un morceau sont épuisées, la session a expiré, ou la connexion a échoué pendant un envoi en une seule requête | Chaque morceau est réessayé, 3 fois par défaut, sur un échec réseau ou un statut 408, 429 ou 5xx. Un envoi en une seule requête n'est pas réessayé | Repassez `error.sessionUri` comme `resumeUri`. Quand il vaut `undefined`, recommencez l'envoi. Voir [Envois](/resources/uploads/) |

Pendant un envoi, un statut d'erreur qu'une nouvelle tentative ne peut pas corriger est levé sous la forme d'une `YouTubeApiError` avec les codes du premier tableau, et un `signal` interrompu donne `ABORTED`.

## Raisons

`error.reason` est la `reason` de la première entrée du corps d'erreur de l'API, dans `error.errors`. Le type `YouTubeErrorReason` liste les valeurs ci-dessous pour qu'elles soient proposées par l'autocomplétion. Il reste ouvert : l'API peut en envoyer d'autres, et la comparaison avec n'importe quelle chaîne compile.

La bibliothèque prend ces noms à l'API et ne définit pas ce qu'ils veulent dire. Les sens ci-dessous sont de courtes lectures des noms : pour un échec donné, `error.message` est ce que YouTube en dit.

```ts
try {
  await yt.commentThreads.post(videoId, "Nice one");
} catch (error) {
  if (!(error instanceof YouTubeApiError)) throw error;

  if (error.reason === "commentsDisabled") {
    console.log("Comments are off on this video.");
  } else if (error.reason === "someFutureReason") {
    console.log("Still compiles.");
  } else {
    throw error;
  }
}
```

Certains corps d'erreur nomment une cause plus précise dans une entrée `details`. Dans ce cas, c'est elle qui l'emporte et la bibliothèque la ramène aux mêmes raisons : `API_KEY_INVALID` devient `keyInvalid`, `API_KEY_EXPIRED` devient `keyExpired`, `SERVICE_DISABLED` devient `accessNotConfigured`, `ACCESS_TOKEN_SCOPE_INSUFFICIENT` devient `insufficientPermissions` et `RATE_LIMIT_EXCEEDED` devient `rateLimitExceeded`.

### Quota et limites de débit

| Raison | Sens |
| --- | --- |
| `quotaExceeded` | Le projet a dépensé son quota du jour, dans l'enveloppe où puise la méthode. Code `QUOTA_EXCEEDED` |
| `dailyLimitExceeded` | La limite quotidienne du projet est atteinte. Code `QUOTA_EXCEEDED` également |
| `rateLimitExceeded` | Trop de requêtes sur une courte période. Code `RATE_LIMITED`, réessayé |
| `userRateLimitExceeded` | Trop de requêtes sur une courte période pour un seul utilisateur. Code `RATE_LIMITED`, réessayé |

### Identifiants

| Raison | Sens |
| --- | --- |
| `keyInvalid` | La clé d'API n'est pas une clé valide |
| `keyExpired` | La clé d'API a expiré |
| `accessNotConfigured` | L'API n'est pas activée dans le projet Google Cloud des identifiants |
| `ipRefererBlocked` | La clé a une restriction d'adresse IP ou de référent HTTP, et la requête n'y correspond pas |
| `authError` | Le jeton d'accès est invalide ou expiré |
| `required` | L'appel exige une autorisation et la requête n'en portait aucune que l'API accepte |
| `forbidden` | Les identifiants sont valides et n'ont pas le droit de faire cela |
| `insufficientPermissions` | Il manque au jeton un scope dont la méthode a besoin. La bibliothèque refuse elle-même l'appel, avec `INSUFFICIENT_SCOPE`, quand elle connaît les scopes accordés |
| `youtubeSignupRequired` | Le compte Google n'a pas de chaîne YouTube |
| `accountClosed` | Le compte de l'utilisateur est fermé |
| `accountSuspended` | Le compte de l'utilisateur est suspendu |
| `channelClosed` | La chaîne est fermée |
| `channelSuspended` | La chaîne est suspendue |
| `emailNotVerified` | L'utilisateur doit vérifier son adresse e-mail avant de faire cela |

### Introuvable

Chacune de ces raisons signifie que la ressource n'existe pas, ou qu'elle existe mais est masquée aux identifiants utilisés.

| Raison | Ce qui est introuvable |
| --- | --- |
| `notFound` | La ressource, quand l'API n'en dit pas plus |
| `videoNotFound` | La vidéo |
| `channelNotFound` | La chaîne |
| `playlistNotFound` | La playlist |
| `playlistItemNotFound` | L'élément de playlist |
| `commentNotFound` | Le commentaire |
| `commentThreadNotFound` | Le fil de commentaires |
| `subscriptionNotFound` | L'abonnement |
| `captionNotFound` | La piste de sous-titres |
| `liveChatNotFound` | Le chat en direct |
| `liveBroadcastNotFound` | La diffusion |
| `liveStreamNotFound` | Le flux vidéo |

### Problèmes de requête

| Raison | Sens |
| --- | --- |
| `badRequest` | La requête n'est pas valide, sans plus de détail |
| `invalid` | Une valeur n'est pas valide. `error.errors[0].location` la désigne quand l'API le précise |
| `invalidParameter` | Un paramètre a une valeur que la méthode n'accepte pas |
| `missingRequiredParameter` | Un paramètre obligatoire est absent |
| `incompatibleParameters` | Deux paramètres incompatibles ont été envoyés |
| `invalidPageToken` | Le `pageToken` n'est pas un jeton émis par l'API pour cette requête |
| `invalidFilters` | La combinaison de filtres n'est pas valide |
| `unknownPart` | `part` nomme une partie que la ressource n'a pas |

Les noms de paramètres et de parties sont vérifiés à la compilation : la plupart de ces raisons n'apparaissent donc que lorsqu'un appel est construit à partir de données non typées.

### Commentaires, playlists, abonnements, envois

| Raison | Sens |
| --- | --- |
| `commentsDisabled` | Les commentaires sont désactivés sur la vidéo |
| `videoRatingDisabled` | Les évaluations sont désactivées sur la vidéo |
| `subscriptionDuplicate` | L'abonnement existe déjà |
| `subscriptionForbidden` | L'abonnement n'est pas autorisé |
| `playlistForbidden` | La playlist n'autorise pas l'opération, ou les identifiants n'ont pas le droit de l'effectuer |
| `playlistContainsMaximumNumberOfVideos` | La playlist est pleine |
| `videoAlreadyInPlaylist` | La vidéo est déjà dans la playlist |
| `uploadLimitExceeded` | La chaîne a atteint le nombre de vidéos qu'elle peut mettre en ligne pour le moment |
| `invalidTitle` | Le titre est vide ou n'est pas accepté |
| `invalidDescription` | La description n'est pas acceptée |
| `invalidTags` | Les tags ne sont pas acceptés |
| `invalidCategoryId` | `snippet.categoryId` n'est pas une catégorie à laquelle on peut affecter des vidéos |
| `invalidVideoMetadata` | Les métadonnées de la vidéo ne sont pas valides |
| `defaultLanguageNotSet` | Des détails localisés ont été envoyés pour une ressource sans langue par défaut |

### Chat en direct

| Raison | Sens |
| --- | --- |
| `liveChatDisabled` | Le chat de la diffusion est désactivé. `chat.messages()` se termine sans lever d'erreur |
| `liveChatEnded` | Le chat est terminé. `chat.messages()` se termine sans lever d'erreur |

`liveChatNotFound` figure dans le tableau des ressources introuvables.

### Serveur

| Raison | Sens |
| --- | --- |
| `processingFailure` | L'API n'a pas réussi à traiter la requête |
| `backendError` | Une erreur du côté de YouTube |
| `internalError` | Une erreur du côté de YouTube |
| `serviceUnavailable` | Le service n'est pas disponible pour le moment |

## Noms des erreurs OAuth

`error.oauthError` sur une `YouTubeAuthError` est le champ `error` de la réponse de Google, tel quel.

| `oauthError` | Sens |
| --- | --- |
| `invalid_grant` | Le code ou le jeton de rafraîchissement n'est plus valide : utilisé deux fois, révoqué ou expiré. Renvoyez l'utilisateur vers l'écran de consentement |
| `redirect_uri_mismatch` | L'URI de redirection n'est pas l'une de celles configurées sur le client OAuth. Elle doit correspondre caractère pour caractère |
| `authorization_pending`, `slow_down` | Flux pour appareils : l'utilisateur n'a pas encore approuvé. `pollDeviceToken()` gère les deux et continue d'attendre |
| `expired_token` | Flux pour appareils : le code a expiré avant que l'utilisateur l'approuve. Défini par la bibliothèque |
| Tout autre nom | Transmis tel que Google l'a envoyé. `authorize()` signale aussi le paramètre `error` que Google place sur la redirection quand l'utilisateur refuse |

`oauthError` vaut `undefined` quand l'échec ne vient pas de Google : un jeton de rafraîchissement manquant, un `onTokens` qui échoue, un consentement qui a expiré.

## Classes d'erreur

Toutes les classes sont exportées depuis l'entrée principale. `isYouTubeError(error, code?)` indique si une valeur est une `YouTubeError`, et éventuellement si elle porte un code donné.

### `YouTubeError`

La classe de base. Tout ce que la bibliothèque lève en est une.

| Propriété | Type | Ce que c'est |
| --- | --- | --- |
| `code` | `YouTubeErrorCode` | Code stable, utilisable dans un `switch` |
| `message` | `string` | Description lisible. Pour un appel qui a échoué, elle commence par la méthode, `videos.list: ` |
| `name` | `string` | Le nom de la classe, par exemple `"YouTubeApiError"` |
| `cause` | `unknown` | L'échec sous-jacent, quand l'erreur en enveloppe un |

### `YouTubeApiError`

L'API a répondu par un statut d'erreur.

| Propriété | Type | Ce que c'est |
| --- | --- | --- |
| `status` | `number` | Code de statut HTTP |
| `reason` | `YouTubeErrorReason \| undefined` | Première raison du corps d'erreur, ou la plus précise de ses `details` s'il y en a une |
| `errors` | `ApiErrorDetail[]` | Chaque entrée du corps d'erreur : `message` et, quand l'API les envoie, `domain`, `reason`, `location`, `locationType`. Vide quand le corps n'en avait aucune |
| `apiStatus` | `string \| undefined` | Statut de style gRPC, par exemple `PERMISSION_DENIED` |
| `method` | `string` | Méthode qui a échoué, par exemple `videos.list` |
| `url` | `string` | URL de la requête, identifiants retirés |
| `retryAfter` | `number \| undefined` | Secondes à attendre avant de réessayer, quand l'API a envoyé `Retry-After` |
| `body` | `unknown` | Le corps de la réponse analysé, ou son texte s'il n'était pas du JSON |
| `isQuotaExceeded` | `boolean` | `code === "QUOTA_EXCEEDED"` |
| `isRateLimited` | `boolean` | `code === "RATE_LIMITED"` |
| `isNotFound` | `boolean` | `code === "NOT_FOUND"` |

### `YouTubeAuthError`

Codes `MISSING_CREDENTIALS`, `INSUFFICIENT_SCOPE` et `OAUTH_ERROR`.

| Propriété | Type | Ce que c'est |
| --- | --- | --- |
| `scopes` | `readonly string[]` | Scopes qui auraient permis l'appel, en noms courts. Vide quand ils sont inconnus |
| `oauthError` | `string \| undefined` | Nom de l'erreur OAuth renvoyé par Google, par exemple `invalid_grant` |

### `YouTubeRequestError`

Codes `TIMEOUT`, `NETWORK`, `ABORTED`, `PARSE_ERROR`, `FEED_UNAVAILABLE`, `HUB_ERROR`, et `SERVER_ERROR` quand `oEmbed` reçoit un statut inattendu de YouTube.

| Propriété | Type | Ce que c'est |
| --- | --- | --- |
| `method` | `string` | Méthode qui a échoué, par exemple `videos.list`. Les raccourcis qui n'appellent pas l'API utilisent `feed`, `oembed`, `websub.subscribe`, `websub.unsubscribe` et `oauth.pollDeviceToken` |

### `YouTubeArgumentError`

Code `INVALID_ARGUMENT`. Aucune propriété propre : le message dit ce qui n'allait pas.

### `YouTubeQuotaBudgetError`

Code `QUOTA_BUDGET_EXCEEDED`.

| Propriété | Type | Ce que c'est |
| --- | --- | --- |
| `bucket` | `string` | Enveloppe à laquelle l'appel est facturé |
| `cost` | `number` | Unités que l'appel aurait coûté |
| `remaining` | `number` | Unités restantes dans l'enveloppe |
| `resetsAt` | `Date` | Moment où l'enveloppe est remise à zéro : minuit, heure du Pacifique |

### `YouTubeUploadError`

Code `UPLOAD_FAILED`.

| Propriété | Type | Ce que c'est |
| --- | --- | --- |
| `sessionUri` | `string \| undefined` | Session avec reprise, valide environ une semaine. Repassez-la comme `resumeUri`. `undefined` quand il n'y a rien à reprendre : l'envoi s'est fait en une seule requête, ou la session a expiré |
| `uploaded` | `number` | Octets confirmés par le serveur |

## Voir aussi

- [Erreurs](/basics/errors/) pour le traitement : branchement, nouvelles tentatives, délais, annulation.
- [Dépannage](/help/troubleshooting/) pour les échecs que l'on rencontre en premier, par symptôme.
- [Quota](/basics/quota/#buckets) pour le sens de `QUOTA_EXCEEDED` selon l'enveloppe.
- [Tous les exports](/reference/exports/) pour les classes d'erreur à côté de tout le reste.
