---
title: Scopes
description: "Un scope dit ce qu'un jeton a le droit de faire. Choisissez le plus étroit qui couvre vos appels, et laissez le client refuser, avant l'envoi, un appel que le jeton ne peut pas faire."
sidebar:
  order: 3
---

```ts
import { Scopes } from "@ix-xs/youtube.api";

// Les noms courts et la constante sont interchangeables.
await oauth.authUrl({ scopes: ["youtube.readonly", "youtube.upload"] });
await oauth.authUrl({ scopes: [Scopes.readonly, Scopes.upload] });
```

Un scope se choisit au moment de construire l'URL de consentement. L'utilisateur le voit sur l'écran de consentement, et les jetons obtenus s'y limitent. Chaque méthode de l'API accepte un ensemble de scopes : un jeton doit en avoir un.

## Les scopes

Partout où un scope est attendu, vous pouvez écrire le nom court, l'URL complète ou la clé correspondante de `Scopes`.

| Nom court | Clé de `Scopes` | Ce qu'il autorise |
| --- | --- | --- |
| `youtube.readonly` | `readonly` | Consulter le compte YouTube |
| `youtube` | `manage` | Gérer le compte : vidéos, playlists, abonnements, diffusions en direct. Pas les commentaires ni les sous-titres |
| `youtube.force-ssl` | `forceSsl` | Tout ce que fait `youtube`, plus les commentaires et les sous-titres |
| `youtube.upload` | `upload` | Mettre en ligne des vidéos, des miniatures, des bannières et des filigranes |
| `youtube.channel-memberships.creator` | `channelMemberships` | Voir les membres actuels d'une chaîne, leur niveau et leur date d'adhésion |
| `yt-analytics.readonly` | `analytics` | Consulter les rapports YouTube Analytics |
| `yt-analytics-monetary.readonly` | `analyticsMonetary` | Consulter les rapports monétaires YouTube Analytics |
| `youtubepartner` | `partner` | Consulter et gérer les assets et les contenus, pour les partenaires de contenu |
| `youtubepartner-channel-audit` | `partnerChannelAudit` | Consulter les informations privées d'une chaîne utiles à l'audit d'un partenaire |

Les noms courts sont typés : l'éditeur les complète. L'URL complète est `https://www.googleapis.com/auth/` suivi du nom court.

## Quel scope choisir

| Vous voulez | Demandez | Remarques |
| --- | --- | --- |
| Lire votre propre chaîne, vos playlists, vos abonnements, vos notes | `youtube.readonly` | Couvre les lectures, sauf les commentaires, les sous-titres et les membres de la chaîne |
| Créer des playlists, s'abonner, noter, modifier ou supprimer des vidéos | `youtube` | |
| Mettre en ligne une vidéo, définir une miniature, une bannière ou un filigrane | `youtube.upload` | Ces quatre méthodes seulement. Modifier ensuite la vidéo demande `youtube` |
| Lire, publier, modifier ou modérer des commentaires | `youtube.force-ssl` | Le seul scope que les méthodes de commentaires acceptent |
| Lister, télécharger, envoyer ou supprimer des sous-titres | `youtube.force-ssl` | |
| Programmer des diffusions, envoyer ou modérer le chat en direct | `youtube` | `youtube.readonly` suffit pour lister les diffusions et lire un chat |
| Lister les membres d'une chaîne et les niveaux d'adhésion | `youtube.channel-memberships.creator` | Le seul scope que ces deux méthodes acceptent |
| Interroger Analytics, lancer des tâches Reporting | `yt-analytics.readonly` | Les requêtes Analytics acceptent aussi `youtube.readonly`. Pas Reporting |
| Interroger les métriques de revenus | `yt-analytics-monetary.readonly` | |

Deux règles pratiques :

- `youtube.force-ssl` est accepté par presque toutes les méthodes de l'API Data. Les exceptions sont les deux méthodes d'adhésion et les méthodes `thirdPartyLinks`, réservées aux partenaires. C'est celui à demander quand une application fait un peu de tout, commentaires compris.
- Demandez le scope le plus étroit qui couvre vos appels. Une application qui ne fait que lire doit demander `youtube.readonly`.

La lecture des commentaires est un cas particulier. `commentThreads.list` et `comments.list` fonctionnent avec une clé d'API. Avec un jeton, elles n'acceptent que `youtube.force-ssl`. Un client qui détient un jeton `youtube.readonly` ne peut pas lire les commentaires avec lui : l'appel part avec la clé d'API si le client en a une, et il est refusé sinon.

## Comment le client vérifie les scopes

Avant d'envoyer un appel, le client compare les scopes du jeton à ceux que la méthode accepte. Si aucun ne correspond, l'appel lève une `YouTubeAuthError` avec le code `INSUFFICIENT_SCOPE`. Rien n'a été envoyé : aucun quota n'a été dépensé.

Une exception : une lecture publique, c'est-à-dire un appel pour lequel une clé d'API suffit, n'échoue pas sur un client qui a aussi une clé d'API. Elle part avec la clé au lieu du jeton.

```ts
try {
  await yt.commentThreads.post(videoId, "Nice one");
} catch (error) {
  if (
    error instanceof YouTubeAuthError &&
    error.code === "INSUFFICIENT_SCOPE"
  ) {
    // N'importe lequel de ceux-ci aurait suffi : ["youtube.force-ssl"]
    console.log(error.scopes);
    // Nomme la méthode, les scopes acceptés et ceux du jeton.
    console.log(error.message);
  } else {
    throw error;
  }
}
```

La vérification doit savoir ce que le jeton contient. Elle s'exécute quand ces deux conditions sont réunies :

- Le client a été créé avec `oauth`.
- Les jetons portent leur chaîne `scope`. C'est le cas quand vous stockez les jetons en entier, tels que `exchange()`, `authorize()` et le flux pour appareils les renvoient. `oauth.grantedScopes` est alors un ensemble de noms courts.

Elle est sautée dans les cas suivants, car les scopes sont inconnus :

- Les jetons n'ont pas de `scope`. C'est le cas de jetons construits à partir d'un seul jeton de rafraîchissement. Un rafraîchissement renseigne `scope` quand la réponse de Google le contient.
- Le client a été créé avec un simple `accessToken`.
- L'appel porte sa propre option de requête `accessToken`.

Une vérification sautée ne fait pas fonctionner l'appel. L'API le refuse alors elle-même : une `YouTubeApiError` avec la raison `insufficientPermissions`, après un aller-retour.

Pour donner ses données à la vérification quand vous n'avez gardé qu'un jeton de rafraîchissement, stockez plutôt l'objet `Tokens` entier, comme le montre [Conserver les jetons](/auth/oauth/#storing-tokens).

## Trouver les scopes d'une méthode

Trois endroits, du plus proche de votre code au plus éloigné :

1. **Dans l'éditeur.** Survolez une méthode. Sa description contient une ligne comme « Auth: OAuth, with one of `youtube`, `youtube.force-ssl`, `youtubepartner` ».
2. **Dans le code.** `METHODS` contient les mêmes informations sous forme de données.
3. **Sur ce site.** [Toutes les méthodes](/reference/methods/) indique pour chacune si une clé d'API suffit ou si OAuth est obligatoire.

```ts
import { METHODS } from "@ix-xs/youtube.api";

METHODS["videos.rate"].scopes;
// ["youtube", "youtube.force-ssl", "youtubepartner"]
METHODS["videos.rate"].auth; // "oauth" : une clé d'API ne peut jamais suffire
METHODS["videos.list"].auth; // "any" : une clé suffit pour les données publiques
```

Avec `METHODS`, vous pouvez poser la même question que le client, par exemple pour masquer un bouton que l'utilisateur actuel ne peut pas utiliser :

```ts
import { METHODS, type MethodId } from "@ix-xs/youtube.api";

function canCall(method: MethodId): boolean {
  const granted = oauth.grantedScopes;
  const accepted = METHODS[method].scopes;
  // Inconnu : laissez l'API décider.
  if (!granted || accepted.length === 0) return true;
  return accepted.some((scope) => granted.has(scope));
}

canCall("playlists.insert");
```

## Demander plus tard

Vous n'avez pas à tout demander à la connexion. Demandez d'abord `youtube.readonly`, et un scope d'écriture le jour où l'utilisateur atteint une fonction qui en a besoin.

```ts
// À la connexion.
const first = await oauth.authUrl({ scopes: ["youtube.readonly"] });

// Plus tard, quand l'utilisateur veut envoyer une vidéo.
const second = await oauth.authUrl({ scopes: ["youtube.upload"] });
```

`includeGrantedScopes` vaut `true` par défaut : il demande à Google de conserver les scopes que l'utilisateur a accordés auparavant, en plus des nouveaux. Après le second échange, un seul jeu de jetons couvre les deux. Passez `includeGrantedScopes: false` pour laisser les accords précédents hors de la demande.

L'erreur `INSUFFICIENT_SCOPE` est un bon déclencheur. Dans une route, avec `app`, `req`, `res` et `session` pour représenter votre application :

```ts
app.post("/videos/:id/like", async (req, res) => {
  try {
    await yt.videos.like(req.params.id);
    res.sendStatus(204);
  } catch (error) {
    if (!isYouTubeError(error, "INSUFFICIENT_SCOPE")) throw error;

    const { url, state, codeVerifier } = await oauth.authUrl({
      scopes: ["youtube"],
    });
    session.oauthState = state;
    session.codeVerifier = codeVerifier;
    res.redirect(url);
  }
});
```

La route de rappel est celle de [OAuth 2.0](/auth/oauth/#handling-the-callback).

## Obtenir aussi l'identité

Les scopes OpenID Connect `openid`, `email` et `profile` sont acceptés à côté de ceux de YouTube. Avec `openid`, les jetons portent un `idToken`. Avec un scope d'identité, `tokenInfo()` renvoie l'`email` du compte.

```ts
await oauth.authUrl({ scopes: ["youtube.readonly", "openid", "email"] });
```

## Convertir les noms

`scopeUrl` développe un nom court en l'URL qu'attend Google. `scopeName` fait l'inverse. Vous en avez besoin quand vous appelez vous-même les points d'accès de Google, ou quand vous comparez des scopes venus d'une autre bibliothèque.

```ts
scopeUrl("youtube.readonly");
// "https://www.googleapis.com/auth/youtube.readonly"
scopeUrl("openid"); // "openid" : les scopes OpenID Connect restent tels quels
scopeUrl(Scopes.upload); // une URL complète est renvoyée inchangée

scopeName("https://www.googleapis.com/auth/youtube.upload"); // "youtube.upload"
```

La bibliothèque donne des noms courts dans `oauth.grantedScopes`, dans `tokenInfo().scopes`, dans `METHODS[id].scopes` et dans `error.scopes`. Seul `oauth.tokens.scope` garde la chaîne envoyée par Google.

## Référence

| Export | Ce que c'est |
| --- | --- |
| `Scopes` | Objet figé qui associe une clé (`readonly`, `upload`, ...) à l'URL complète du scope |
| `scopeUrl(scope)` | Nom court vers URL |
| `scopeName(scope)` | URL vers nom court |
| `Scope` | Type d'un scope : un nom court, une URL complète, `"openid"`, `"email"`, `"profile"` ou n'importe quelle chaîne |
| `ShortScope` | Union des neuf noms courts |
| `METHODS[id].scopes` | Scopes qu'une méthode accepte, en noms courts |
| `METHODS[id].auth` | `"oauth"` quand une clé d'API ne peut jamais suffire, `"any"` sinon |

| Où les scopes apparaissent | Type |
| --- | --- |
| `oauth.grantedScopes` | `ReadonlySet<string> \| undefined` |
| `(await oauth.tokenInfo()).scopes` | `string[]` |
| `oauth.tokens.scope` | `string \| undefined`, séparés par des espaces, tels que Google les renvoie |
| `YouTubeAuthError.scopes` | `readonly string[]` : les scopes qui auraient autorisé l'appel. Vide quand ils sont inconnus |

## Voir aussi

- [OAuth 2.0](/auth/oauth/) : où `scopes` est passé.
- [Toutes les méthodes](/reference/methods/) : quelles méthodes exigent OAuth.
- [Erreurs](/basics/errors/) : `YouTubeAuthError` et les autres classes.
- [Scripts et appareils](/auth/scripts-and-devices/) : le flux pour appareils accepte moins de scopes.
