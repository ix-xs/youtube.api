---
title: "Identifiants d'accès"
description: "Ce que permet une clé d'API, ce qui exige OAuth, et comment créer les deux dans la console Google Cloud. Un appel qui exige OAuth ou un scope absent est refusé avant l'envoi, donc sans coût en quota."
---

```ts
import { YouTube } from "@ix-xs/youtube.api";

// Données publiques : une clé d'API.
const reader = new YouTube({ apiKey: process.env.YOUTUBE_API_KEY });

// Données privées et écritures : OAuth.
const writer = new YouTube({
  oauth: { clientId, clientSecret, tokens: savedTokens, onTokens: saveTokens },
});
```

## Ce que peut faire une clé d'API

Une clé d'API lit les données publiques, et rien d'autre.

19 des 82 méthodes de l'API Data acceptent une clé :

| Ressource | Méthodes qui fonctionnent avec une clé |
| --- | --- |
| Vidéos | `videos.list`, `videos.batchGetStats`, `videoTrainability.get`, `videoCategories.list`, `videoAbuseReportReasons.list` |
| Chaînes | `channels.list`, `channelSections.list`, `activities.list`, `subscriptions.list` |
| Playlists | `playlists.list`, `playlistItems.list`, `playlistImages.list` |
| Recherche | `search.list` |
| Commentaires | `commentThreads.list`, `comments.list` |
| Chat en direct | `liveChatMessages.list`, `liveChatMessages.stream` |
| Localisation | `i18nLanguages.list`, `i18nRegions.list` |

Les raccourcis construits sur ces méthodes fonctionnent aussi avec une clé : `yt.channels.get`, `yt.channels.latestVideos`, `yt.videos.get`, `yt.playlists.items`, `yt.search.videos`, `yt.liveChatOf` et les autres raccourcis qui lisent des données publiques.

Une clé ne suffit jamais pour :

- Toute écriture : envois, modifications de playlist, commentaires, notes, abonnements.
- Les 63 autres méthodes de l'API Data, y compris les diffusions en direct et les sous-titres.
- L'API Analytics et l'API Reporting.
- Une lecture qui demande les données de l'utilisateur lui-même. Sur les méthodes ci-dessus, ces paramètres exigent OAuth : `mine`, `myRating`, `mySubscribers`, `myRecentSubscribers`, `forMine`, `home`, `managedByMe`, `forContentOwner`, `forDeveloper`, `onBehalfOfContentOwner`, `onBehalfOfContentOwnerChannel`.

[Toutes les méthodes](/reference/methods/) indique ce que chaque appel accepte.

## Créer une clé d'API

1. Ouvrez la [console Google Cloud](https://console.cloud.google.com/) et créez un projet, ou choisissez-en un.
2. Activez **YouTube Data API v3** pour le projet. Sans cela, les appels échouent avec la raison `accessNotConfigured`.
3. Dans **APIs & Services > Credentials**, créez une clé d'API.
4. Restreignez la clé avant de l'utiliser. La section suivante explique comment.

Le quota appartient au projet, pas à la clé : deux clés d'un même projet partagent la même allocation quotidienne. [Quota](/basics/quota/) donne les chiffres.

## Restreindre la clé

Une clé peut être restreinte de trois façons. Appliquez toujours la première, et l'une des deux autres quand elle convient.

| Restriction | À utiliser quand |
| --- | --- |
| Par API : n'autoriser que YouTube Data API v3 | Toujours. Une clé qui fuite ne peut alors pas appeler les autres API de votre projet |
| Par adresse IP | La clé tourne sur un serveur dont l'adresse est connue |
| Par référent HTTP | La clé est livrée dans une page web |

Une clé dans une page web est publique : n'importe qui peut la lire dans les requêtes que son navigateur envoie. Une restriction par référent limite les endroits où elle peut servir. Si possible, gardez la clé sur un serveur et appelez l'API depuis là.

Sur un serveur, gardez la clé hors du code et hors du dépôt. Placez-la dans une variable d'environnement.

## Le repli sur `YOUTUBE_API_KEY`

Quand `apiKey` est omis, le client lit la variable d'environnement `YOUTUBE_API_KEY` :

```ts
const yt = new YouTube(); // utilise process.env.YOUTUBE_API_KEY
```

Cela vaut aussi à côté de `oauth`. Les lectures publiques partent alors avec la clé tant que l'utilisateur ne s'est pas connecté, voir [Une clé et un jeton ensemble](#a-key-and-a-token-together).

Une chaîne est un raccourci pour `{ apiKey }` :

```ts
const yt = new YouTube(apiKey);
```

## Trois façons de s'authentifier

| Option | Ce que vous donnez | À utiliser quand |
| --- | --- | --- |
| `apiKey` | Une clé | Vous ne lisez que des données publiques |
| `oauth` | Un client `OAuth2`, ou les options pour en construire un | Vous avez besoin de données privées ou d'écritures. Les jetons sont rafraîchis pour vous |
| `accessToken` | Un jeton, ou une fonction qui en renvoie un | Autre chose gère déjà les jetons. Rien n'est rafraîchi |

```ts
import { OAuth2, YouTube } from "@ix-xs/youtube.api";

// 1. Une clé.
const withKey = new YouTube({ apiKey });

// 2. Un client OAuth. Passez une instance, ou ses options.
const client = new OAuth2({
  clientId,
  clientSecret,
  tokens: savedTokens,
  onTokens: saveTokens,
});
const withOAuth = new YouTube({ oauth: client });

// 3. Un jeton obtenu ailleurs. Une fonction est appelée à chaque appel.
const withToken = new YouTube({
  accessToken: () => session.accessToken as string,
});
```

Que vous passiez une instance ou des options, le client `OAuth2` est disponible sous `yt.oauth`. [OAuth](/auth/oauth/) couvre le flux de consentement, et [Scripts et appareils](/auth/scripts-and-devices/) les flux qui n'ont pas besoin de serveur web.

Un appel peut utiliser un autre jeton que celui du client, avec l'option de requête `accessToken`. Celui-ci coûte 1 unité :

```ts
const mine = await yt.channels.mine({ accessToken: session.accessToken });
```

Pour un serveur qui détient les jetons de nombreux utilisateurs, [`yt.as()`](/auth/many-users/) est le meilleur outil.

## Une clé et un jeton ensemble

Vous pouvez définir `apiKey` à côté de `oauth`. Les règles sont les suivantes :

- Quand un jeton est disponible, il est utilisé. Un jeton voit tout ce que voit une clé, plus les données privées de l'utilisateur.
- Quand le client `OAuth2` n'a aucun jeton utilisable (pas de jeton d'accès ou un jeton expiré, et pas de jeton de rafraîchissement), une lecture publique part avec la clé.
- Quand les scopes du jeton sont connus et que la méthode n'en accepte aucun, une lecture publique part aussi avec la clé.
- Un appel qui exige OAuth ne se replie jamais sur la clé. Il est refusé, voir plus bas.

Un seul client suffit donc pour une application où la connexion est facultative :

```ts
const oauth = new OAuth2({
  clientId,
  clientSecret,
  redirectUri: "https://example.com/oauth/callback",
});
const yt = new YouTube({ apiKey, oauth });

await yt.videos.get(videoId); // 1 unité. Pas encore de jetons : envoyé avec la clé

await oauth.exchange(code, { codeVerifier });
await yt.videos.get(videoId); // 1 unité, envoyé avec le jeton de l'utilisateur
await yt.channels.mine(); // 1 unité, fonctionne maintenant
```

Il n'y a pas de tel repli avec `accessToken` : le jeton que vous donnez est toujours envoyé.

## Comment les identifiants voyagent

- La clé d'API passe dans l'en-tête `X-Goog-Api-Key`, jamais dans une URL.
- Un jeton d'accès passe dans l'en-tête `Authorization`. `yt.reporting.download()` refuse une URL de téléchargement sur tout hôte autre que `youtubereporting.googleapis.com`.
- Les URL des erreurs et des [événements du client](/basics/configuration/) sont purgées de leurs identifiants.
- Rien n'est écrit sur le disque, sauf si vous utilisez `tokenFile()` de `@ix-xs/youtube.api/node`.
- Avec `baseUrl`, les requêtes de l'API Data et leurs identifiants vont à l'hôte que vous nommez. Voir [Configuration](/basics/configuration/).

## Ce qui est refusé avant l'envoi

Le client sait quelles méthodes et quels paramètres exigent OAuth, et quels scopes chaque méthode accepte. Il vérifie avant d'envoyer. Un appel refusé lève une `YouTubeAuthError`. Rien n'est envoyé à l'API et aucun quota n'est dépensé.

| `error.code` | Levée quand |
| --- | --- |
| `MISSING_CREDENTIALS` | L'appel exige OAuth et il n'y a pas de jeton. Ou le client n'a aucun identifiant |
| `INSUFFICIENT_SCOPE` | Les scopes du jeton sont connus, la méthode n'en accepte aucun, et l'appel ne peut pas partir avec la clé |
| `OAUTH_ERROR` | Le client `OAuth2` détient un jeton d'accès expiré et aucun jeton de rafraîchissement |

`error.scopes` liste les scopes qui auraient convenu :

```ts
const yt = new YouTube({ apiKey });

try {
  await yt.playlists.insert({ body: { snippet: { title: "Favourites" } } });
} catch (error) {
  if (error instanceof YouTubeAuthError) {
    console.log(error.code); // "MISSING_CREDENTIALS"
    // ["youtube", "youtube.force-ssl", "youtubepartner"]
    console.log(error.scopes);
  }
}
```

La vérification des scopes doit savoir ce que l'utilisateur a accordé. Un client `OAuth2` le sait grâce au champ `scope` de ses jetons. Avec `accessToken`, sur le client ou sur un seul appel, la bibliothèque ne peut pas le savoir : l'appel part et l'API répond. [Scopes](/auth/scopes/) liste ce que permet chaque scope.

## Créer un client OAuth

1. Dans la console Google Cloud, activez **YouTube Data API v3** pour le projet, comme pour une clé d'API.
2. Configurez l'écran de consentement OAuth du projet.
3. Créez un client OAuth et choisissez son type d'application.

| Type d'application | Pour | Remarques |
| --- | --- | --- |
| Web application (application web) | Un serveur qui reçoit la redirection | Listez chaque URI de redirection. Elle doit correspondre à `redirectUri` caractère pour caractère |
| Desktop app (application de bureau) | Un script ou un outil en ligne de commande sur votre machine | Accepte toute redirection de boucle locale, ce qu'utilise `authorize()` |
| TVs and Limited Input devices (téléviseurs et appareils à saisie limitée) | Un appareil sans navigateur ni clavier | Requis par le flux pour appareils, `oauth.requestDeviceCode()` |

Le client OAuth a un identifiant client et un secret client. Gardez le secret sur un serveur. Un client sans secret (navigateur, mobile, bureau) s'appuie sur PKCE, que `oauth.authUrl()` active par défaut.

## Le statut « Testing »

Tant que l'écran de consentement de votre application a le statut **Testing**, deux choses s'appliquent :

- Seuls les comptes que vous listez comme utilisateurs de test peuvent donner leur consentement.
- Ses jetons de rafraîchissement expirent au bout de 7 jours.

:::caution
Un script qui a fonctionné pendant une semaine, puis n'arrive plus à rafraîchir son jeton, a sans doute rencontré ce cas. Le rafraîchissement lève une `YouTubeAuthError` avec le code `OAUTH_ERROR` et `error.oauthError === "invalid_grant"`. Renvoyez l'utilisateur vers l'écran de consentement. Pour obtenir des jetons de rafraîchissement durables, sortez l'application du statut Testing.
:::

```ts
try {
  await yt.channels.mine(); // 1 unité
} catch (error) {
  const expired =
    error instanceof YouTubeAuthError && error.oauthError === "invalid_grant";
  if (!expired) throw error;
  // Le jeton de rafraîchissement n'est plus valide : relancez le flux de consentement.
}
```

## Référence

| Option de `new YouTube()` | Type | Remarques |
| --- | --- | --- |
| `apiKey` | `string` | Se replie sur `YOUTUBE_API_KEY` quand elle est omise |
| `oauth` | `OAuth2 \| OAuth2Options` | Rafraîchit les jetons seul. Disponible ensuite sous `yt.oauth` |
| `accessToken` | `string \| (() => string \| Promise<string>)` | Pas de rafraîchissement, pas de vérification locale des scopes |

| Option de requête | Type | Remarques |
| --- | --- | --- |
| `accessToken` | `string` | Utilise ce jeton pour un seul appel, à la place des identifiants du client. Pas de vérification locale des scopes |

| Erreur | `code` | Champs utiles |
| --- | --- | --- |
| `YouTubeAuthError` | `MISSING_CREDENTIALS` | `scopes` |
| `YouTubeAuthError` | `INSUFFICIENT_SCOPE` | `scopes` |
| `YouTubeAuthError` | `OAUTH_ERROR` | `oauthError`, par exemple `"invalid_grant"` |
| `YouTubeApiError` | Selon le statut HTTP | `reason` quand l'API rejette la clé : `keyInvalid`, `keyExpired`, `accessNotConfigured`, `ipRefererBlocked` |

## Voir aussi

- [OAuth](/auth/oauth/) : le flux de consentement, le stockage et le rafraîchissement des jetons.
- [Scripts et appareils](/auth/scripts-and-devices/) : `authorize()` et le flux pour appareils.
- [Scopes](/auth/scopes/) : le scope qu'exige chaque type d'appel.
- [Erreurs](/basics/errors/) : tous les codes d'erreur, et ce qui fait l'objet d'une nouvelle tentative.
