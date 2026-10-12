---
title: OAuth 2.0
description: "Envoyez l'utilisateur sur l'écran de consentement de Google, échangez le code contre des jetons et laissez le client les garder valides. Indispensable pour les données privées et pour toute écriture."
sidebar:
  order: 1
---

```ts
import { OAuth2, YouTube } from "@ix-xs/youtube.api";

const oauth = new OAuth2({
  clientId: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  redirectUri: "https://example.com/oauth/callback",
  tokens: await loadTokens(), // enregistrés par une exécution précédente, ou undefined
  onTokens: saveTokens, // appelée à chaque changement des jetons
});

const yt = new YouTube({ oauth });
const me = await yt.channels.mine();
```

Une clé d'API lit les données publiques. Tout ce qui est privé (`mine`, vos abonnements, les statistiques) et toute écriture (playlists, commentaires, envois) demandent le consentement d'un utilisateur. `OAuth2` s'en charge : l'URL de consentement, l'échange du code, le rafraîchissement et la révocation.

Cette page suit un compte depuis le consentement jusqu'aux appels d'API. Un serveur où chaque visiteur connecte son propre compte a besoin d'un `OAuth2` par utilisateur : lisez [Servir de nombreux utilisateurs](/auth/many-users/) après cette page. Un script sur votre machine peut se passer des routes ci-dessous : voir [Scripts et appareils](/auth/scripts-and-devices/).

## Créer le client OAuth

Il vous faut un client OAuth créé dans la console Google Cloud, avec l'URL de rappel parmi ses URI de redirection. [Identifiants d'accès](/start/credentials/) montre où le créer.

```ts
const oauth = new OAuth2({
  clientId,
  clientSecret,
  redirectUri: "https://example.com/oauth/callback",
});
```

`redirectUri` doit correspondre, caractère pour caractère, à l'une des URI enregistrées côté Google. `clientSecret` peut être omis pour un client public (navigateur, mobile, bureau) qui s'appuie sur PKCE.

Rien n'est envoyé à Google à ce stade. L'objet garde les réglages et, plus tard, les jetons.

## Envoyer l'utilisateur chez Google

`authUrl()` construit l'URL de consentement. Elle renvoie trois valeurs :

```ts
const { url, state, codeVerifier } = await oauth.authUrl({
  scopes: ["youtube.readonly"],
});
```

| Valeur | Ce qu'il faut en faire |
| --- | --- |
| `url` | Redirigez-y l'utilisateur |
| `state` | Gardez-le pour ce visiteur. Google le renvoie tel quel, et la comparaison des deux valeurs bloque les attaques CSRF |
| `codeVerifier` | Gardez-le pour ce visiteur. `exchange()` en a besoin. `undefined` quand PKCE est désactivé |

`state` et `codeVerifier` doivent aller dans la session du visiteur ou dans un cookie que seul votre serveur peut lire. Ils ne servent plus à rien après le rappel.

`scopes` accepte des noms courts, des URL complètes ou la constante `Scopes`. [Scopes](/auth/scopes/) les liste et indique lequel convient à chaque tâche. `authUrl()` lève une `YouTubeArgumentError` quand il n'y a aucun scope, ou aucune `redirectUri` ni dans le client ni dans les options.

Les valeurs par défaut sont celles dont un serveur a besoin :

- `accessType: "offline"` demande un jeton de rafraîchissement : l'application continue de fonctionner quand l'utilisateur est absent.
- `pkce: true` ajoute un défi PKCE. Il est obligatoire pour les clients sans secret et recommandé pour tous.
- `includeGrantedScopes: true` conserve les scopes accordés auparavant à côté des nouveaux.
- `state` est généré quand vous n'en passez pas.

```ts
const { url } = await oauth.authUrl({
  scopes: ["youtube.readonly", "youtube.upload"],
  prompt: "consent", // affiche l'écran de consentement même à un utilisateur déjà connu
  loginHint: "someone@example.com", // présélectionne ce compte
  state: "my-own-opaque-value",
});
```

## Traiter le rappel

Google renvoie l'utilisateur vers votre URI de redirection avec `code` et `state` dans la chaîne de requête, ou avec `error` s'il a refusé. Vérifiez `state`, puis échangez le code contre des jetons avec `exchange()`.

Dans l'exemple, `app`, `req` et `res` représentent votre framework, et `session` l'endroit où vous gardez l'état de chaque visiteur.

```ts
app.get("/login", async (req, res) => {
  const { url, state, codeVerifier } = await oauth.authUrl({
    scopes: ["youtube.readonly"],
  });
  session.oauthState = state;
  session.codeVerifier = codeVerifier;
  res.redirect(url);
});

app.get("/oauth/callback", async (req, res) => {
  if (!session.oauthState || req.query.state !== session.oauthState) {
    return res
      .status(400)
      .send("This answer does not belong to your session.");
  }
  if (req.query.error) {
    return res.status(400).send(`Google answered: ${req.query.error}`);
  }

  await oauth.exchange(req.query.code, { codeVerifier: session.codeVerifier });
  session.oauthState = session.codeVerifier = undefined;
  res.redirect("/");
});
```

`exchange()` range les jetons dans l'objet `OAuth2`, appelle `onTokens` et les renvoie. Un code ne sert qu'une fois : l'échanger une seconde fois échoue avec `invalid_grant`.

Si vous avez passé une `redirectUri` à `authUrl()` pour remplacer celle du client, passez la même à `exchange()`.

## Le donner au client

Passez l'objet `OAuth2` au client :

```ts
const yt = new YouTube({ oauth });
```

Ou passez les options et laissez le client le construire. Il est alors disponible sous `yt.oauth`, et ses appels passent par le `fetch` du client, sauf si vous lui en donnez un autre :

```ts
const yt = new YouTube({
  oauth: { clientId, clientSecret, tokens: savedTokens, onTokens: saveTokens },
});

yt.oauth?.canRefresh; // true dès qu'il y a un jeton de rafraîchissement
```

Vous pouvez définir `apiKey` à côté de `oauth`. Un jeton l'emporte quand les deux sont utilisables, et les lectures publiques partent avec la clé tant qu'il n'y a pas de jeton utilisable. [Identifiants d'accès](/start/credentials/) donne les règles.

## Rafraîchissement automatique

À partir de là, vous ne manipulez plus les jetons d'accès. Avant chaque requête, le client demande à `OAuth2` un jeton valide.

- Un jeton d'accès absent, ou qui expire dans moins de 60 secondes, est d'abord rafraîchi.
- Si l'API répond encore 401 et qu'il existe un jeton de rafraîchissement, le jeton est rafraîchi une fois et l'appel est rejoué. Les envois, les téléchargements de rapports et le flux du chat en direct ne sont pas rejoués.
- Les appels qui ont besoin d'un rafraîchissement au même moment partagent une seule requête vers Google.

Un rafraîchissement exige un jeton de rafraîchissement. Sans lui, un jeton d'accès expiré ne peut pas être renouvelé : un appel qui a besoin de l'utilisateur lève une `YouTubeAuthError` avec le code `OAUTH_ERROR`, et l'utilisateur doit consentir de nouveau.

## Conserver les jetons

Les jetons sont de simples données. Stockez-les en JSON et redonnez-les au démarrage suivant.

```ts
const oauth = new OAuth2({
  clientId,
  clientSecret,
  tokens: await db.tokens.get("main"),
  onTokens: async (tokens) => {
    await db.tokens.set("main", tokens);
  },
});
```

`onTokens` s'exécute à chaque changement des jetons : après un échange, après chaque rafraîchissement, et après [`revoke()`](#signing-out), qui lui passe un objet vide. Elle reçoit l'ensemble complet des jetons. Google n'envoie le jeton de rafraîchissement qu'au premier consentement, donc la bibliothèque reporte celui qu'elle a dans chaque jeu suivant : enregistrer ce que vous recevez suffit toujours.

`onTokens` est attendue avec `await`. Si elle lève une erreur, l'appel qui l'a déclenchée échoue avec une `YouTubeAuthError` dont le code est `OAUTH_ERROR` et dont la `cause` est votre erreur. C'est voulu : des jetons qui n'ont pas pu être enregistrés ne se perdent pas en silence. L'objet `OAuth2` garde les nouveaux jetons en mémoire, seule votre copie stockée est en retard.

Pour observer les changements sans faire partie de l'appel, abonnez-vous avec la méthode du même nom. Un écouteur n'est pas attendu, et celui qui lève une erreur ne fait pas échouer l'appel. La méthode renvoie une fonction qui annule l'abonnement :

```ts
const stop = oauth.onTokens((tokens) => {
  console.log("Access token valid until", new Date(tokens.expiresAt ?? 0));
});

stop();
```

:::caution
Un jeton de rafraîchissement donne un accès durable au compte. Conservez-le comme un mot de passe, et gardez-le hors des journaux et hors du navigateur.
:::

## Lire l'état de la session

```ts
oauth.tokens; // une copie des jetons actuels
oauth.canRefresh; // true quand il y a un jeton de rafraîchissement
oauth.isExpired; // true quand le jeton d'accès est absent ou sur le point d'expirer
oauth.grantedScopes; // Set { "youtube.readonly" }, ou undefined
```

Ces lectures portent sur l'état local et ne coûtent rien. `isExpired` vaut true quand il n'y a pas de jeton d'accès, ou quand il expire dans moins de 60 secondes. Un jeton d'accès sans `expiresAt` est considéré comme valide. `grantedScopes` vaut `undefined` quand les jetons ne portent pas de `scope`.

`tokenInfo()` interroge Google à la place : c'est ainsi que vous vérifiez un jeton que vous n'avez pas créé vous-même.

```ts
const info = await oauth.tokenInfo();

info.clientId; // le client OAuth auquel le jeton a été délivré
info.scopes; // ["youtube.readonly"]
info.expiresIn; // secondes restantes
info.email; // seulement si un scope d'identité a été accordé
```

Sans argument, elle inspecte le jeton d'accès actuel, rafraîchi d'abord si nécessaire. Passez une chaîne pour en inspecter un autre : `oauth.tokenInfo(someAccessToken)`.

## Se déconnecter

`revoke()` révoque les jetons chez Google et les efface de l'objet. L'utilisateur doit ensuite consentir de nouveau.

```ts
await oauth.revoke();
await db.tokens.delete("main");
```

`revoke()` appelle `onTokens` avec un objet vide, et les écouteurs ajoutés avec `oauth.onTokens()` reçoivent la même chose. Un stockage qui enregistre ce qu'il reçoit contient alors un objet vide, qui se charge comme une absence totale de jetons. Supprimez l'entrée comme ci-dessus si vous préférez qu'elle disparaisse.

Trois précisions :

- Elle révoque le jeton de rafraîchissement s'il y en a un, le jeton d'accès sinon. Sans aucun jeton, elle ne fait rien et `onTokens` n'est pas appelée.
- Quand Google refuse la révocation, elle lève une `YouTubeAuthError` avec le code `OAUTH_ERROR` et conserve les jetons.
- Si `onTokens` lève une erreur ici, `revoke()` échoue avec une `YouTubeAuthError` dont le code est `OAUTH_ERROR` et dont la `cause` est votre erreur, comme après un rafraîchissement. Les jetons sont déjà révoqués et effacés, et les écouteurs ont été prévenus.

`setTokens()` remplace les jetons sans contacter Google et sans appeler `onTokens` :

```ts
oauth.setTokens({ refreshToken: process.env.YOUTUBE_REFRESH_TOKEN });
```

## Quand aucun jeton de rafraîchissement n'arrive

Google envoie un jeton de rafraîchissement la première fois qu'un utilisateur approuve votre application, pas lors des connexions suivantes. Si vous l'avez perdu, ou ne l'avez jamais stocké, `oauth.canRefresh` reste `false` après l'échange.

Forcez l'écran de consentement pour en obtenir un nouveau :

```ts
const { url } = await oauth.authUrl({
  scopes: ["youtube.readonly"],
  prompt: "consent",
});
```

Deux autres causes dépendent de vous : `accessType: "online"` n'en demande jamais, et un `onTokens` qui ne stocke que `accessToken` jette le jeton de rafraîchissement.

## Apporter votre propre jeton d'accès

Quand une autre partie de votre architecture gère déjà OAuth, laissez `OAuth2` de côté et passez le jeton d'accès :

```ts
const fixed = new YouTube({ accessToken: session.accessToken });

const dynamic = new YouTube({
  accessToken: async () => (await db.tokens.get("main")).accessToken,
});
```

Une fonction est appelée avant chaque requête : elle peut donc renvoyer un jeton frais à chaque fois. Ce mode n'a pas de rafraîchissement automatique ni de nouvel essai après un 401 : un jeton expiré remonte comme une `YouTubeApiError` avec le code `UNAUTHORIZED`. Les scopes ne sont pas vérifiés avant l'envoi non plus.

## Erreurs

Tout ce qui tourne mal avec les identifiants est une `YouTubeAuthError`. Quand Google a refusé quelque chose, `oauthError` porte le nom qu'il a donné.

```ts
try {
  await yt.channels.mine();
} catch (error) {
  if (
    error instanceof YouTubeAuthError &&
    error.oauthError === "invalid_grant"
  ) {
    // Le jeton de rafraîchissement ne fonctionne plus. Relancez le parcours de consentement.
    res.redirect("/login");
  } else {
    throw error;
  }
}
```

| `error.code` | Quand |
| --- | --- |
| `MISSING_CREDENTIALS` | L'objet `OAuth2` n'a pas de jetons : appelez `exchange()` ou passez des `tokens` enregistrés. Levée aussi quand un appel exige OAuth alors que le client n'a qu'une clé d'API, ou quand le client n'a aucun identifiant |
| `OAUTH_ERROR` | Google a refusé un échange, un rafraîchissement, une révocation, une inspection de jeton ou une demande d'appareil. Aussi : le jeton d'accès a expiré et il n'y a pas de jeton de rafraîchissement, `refresh()` a été appelée sans jeton, ou `onTokens` a levé une erreur |
| `INSUFFICIENT_SCOPE` | Le jeton ne porte aucun des scopes que la méthode accepte. Voir [Scopes](/auth/scopes/) |

| `error.oauthError` | Sens |
| --- | --- |
| `invalid_grant` | Le code ou le jeton de rafraîchissement n'est plus valide : utilisé deux fois, révoqué ou expiré. Renvoyez l'utilisateur sur l'écran de consentement |
| `redirect_uri_mismatch` | L'URI de redirection n'est pas l'une de celles enregistrées sur le client OAuth |

Quand Google a refusé quelque chose, le message de l'`OAUTH_ERROR` reprend la description renvoyée par Google. `MISSING_CREDENTIALS` et `INSUFFICIENT_SCOPE` sont levées avant tout envoi à l'API : elles ne coûtent aucun quota. [Erreurs](/basics/errors/) présente les autres classes d'erreurs.

## Référence

### `new OAuth2(options)`

| Option | Type | Sens |
| --- | --- | --- |
| `clientId` | `string` | Identifiant de votre client OAuth. Obligatoire |
| `clientSecret` | `string` | Secret du client. Omettez-le pour un client public qui utilise PKCE |
| `redirectUri` | `string` | Où Google renvoie l'utilisateur. Doit correspondre exactement à la configuration du client |
| `tokens` | `Tokens` | Jetons enregistrés lors d'une session précédente |
| `onTokens` | `(tokens) => void \| Promise<void>` | Appelée après un échange, après chaque rafraîchissement, et avec `{}` après `revoke()`. Attendue avec `await` |
| `fetch` | `typeof fetch` | `fetch` personnalisé pour les appels aux points d'accès OAuth de Google |

### `oauth.authUrl(options)`

| Option | Par défaut | Sens |
| --- | --- | --- |
| `scopes` | Obligatoire | Scopes à demander. Au moins un |
| `accessType` | `"offline"` | `"offline"` demande un jeton de rafraîchissement, `"online"` n'en demande pas |
| `prompt` | Aucun | `"none"`, `"consent"`, `"select_account"` ou `"consent select_account"` |
| `state` | Aléatoire | Valeur opaque renvoyée telle quelle à l'URI de redirection |
| `loginHint` | Aucun | Adresse e-mail ou identifiant de compte à présélectionner |
| `includeGrantedScopes` | `true` | Conserve les accords précédents en plus des nouveaux scopes |
| `pkce` | `true` | Ajoute un défi PKCE et renvoie un `codeVerifier` |
| `redirectUri` | Celle du client | Remplace l'URI de redirection pour cette URL |

### Méthodes et propriétés

| Membre | Renvoie | Ce qu'il fait |
| --- | --- | --- |
| `authUrl(options)` | `Promise<{ url, state, codeVerifier }>` | Construit l'URL de consentement |
| `exchange(code, { codeVerifier, redirectUri })` | `Promise<Tokens>` | Échange le code contre des jetons et les conserve |
| `getAccessToken()` | `Promise<string>` | Un jeton d'accès valide, rafraîchi d'abord si nécessaire |
| `refresh()` | `Promise<string>` | Force un rafraîchissement. Les appels simultanés partagent une requête |
| `revoke()` | `Promise<void>` | Révoque les jetons chez Google et les oublie |
| `tokenInfo(accessToken?)` | `Promise<TokenInfo>` | Client, scopes et durée de vie restante d'un jeton |
| `setTokens(tokens)` | `void` | Remplace les jetons |
| `onTokens(listener)` | `() => void` | S'abonne aux changements de jetons |
| `requestDeviceCode()`, `pollDeviceToken()` | | Le flux pour appareils, voir [Scripts et appareils](/auth/scripts-and-devices/) |
| `tokens` | `Readonly<Tokens>` | Une copie des jetons actuels |
| `canRefresh` | `boolean` | S'il existe un jeton de rafraîchissement |
| `isExpired` | `boolean` | Si le jeton d'accès est absent ou sur le point d'expirer |
| `grantedScopes` | `ReadonlySet<string> \| undefined` | Scopes accordés, en noms courts |
| `clientId` | `string` | L'identifiant du client |

### `Tokens`

| Champ | Sens |
| --- | --- |
| `accessToken` | Jeton de courte durée, envoyé avec chaque requête |
| `refreshToken` | Jeton de longue durée, utilisé pour obtenir de nouveaux jetons d'accès |
| `expiresAt` | Moment d'expiration du jeton d'accès, sous forme d'horodatage en millisecondes |
| `scope` | Scopes accordés, séparés par des espaces, tels que Google les renvoie |
| `tokenType` | Toujours `Bearer` |
| `idToken` | Jeton d'identité OpenID Connect, quand un scope `openid` a été demandé |

Tous les champs sont facultatifs.

## Voir aussi

- [Scopes](/auth/scopes/) : le scope dont un appel a besoin.
- [Scripts et appareils](/auth/scripts-and-devices/) : le même flux sans serveur web.
- [Servir de nombreux utilisateurs](/auth/many-users/) : un client, un `OAuth2` par utilisateur.
- [Identifiants d'accès](/start/credentials/) : créer le client OAuth dans la console Google Cloud.
