---
title: Servir de nombreux utilisateurs
description: "Gardez un seul client pour tout le serveur et dérivez-en un client par utilisateur. Ils partagent le cache, le décompte du quota et les réglages, mais pas les identifiants."
sidebar:
  order: 4
---

```ts
const yt = new YouTube({ apiKey, cache: true });

app.get("/me", async (req, res) => {
  const user = yt.as(req.session.accessToken);
  res.json(await user.channels.mine());
});
```

Un serveur qui détient les jetons de nombreux utilisateurs ne doit pas construire un client complet par utilisateur : chacun aurait son propre cache et son propre décompte de quota. Créez un seul client au démarrage, puis appelez `yt.as()` dans chaque requête.

## Dériver un client par utilisateur

`yt.as(credentials)` renvoie un nouveau `YouTube` qui agit pour un autre utilisateur. Il accepte l'une de ces trois choses :

```ts
// Un jeton d'accès.
const fromToken = yt.as(session.accessToken);
// Une fonction qui en renvoie un.
const fromFunction = yt.as(() => db.tokens.fresh(session.userId));
// Un objet OAuth2 : les jetons se rafraîchissent tout seuls.
const fromOAuth = yt.as(oauth);
```

En créer un n'envoie rien : vous pouvez le faire à chaque requête.

| | Partagé avec le client de base |
| --- | --- |
| Cache des réponses | Oui, le même stockage et les mêmes règles de fraîcheur |
| Décompte du quota | Oui, `user.quota` est le même objet que `yt.quota` |
| Événements | Oui, un écouteur ajouté avec `yt.on()` voit les appels de tous les clients dérivés |
| Réglages | Oui : `apiKey`, `retry`, `timeout`, `fetch`, `baseUrl`, `headers`, `quotaUser`, `onBehalfOfContentOwner` |
| Identifiants | Non. Le `oauth` ou l'`accessToken` du client de base est remplacé par ce que vous passez |

Un second argument modifie les trois réglages qui peuvent différer selon l'utilisateur : `quotaUser`, `headers` et `onBehalfOfContentOwner`. Les `headers` donnés ici remplacent ceux du client de base, ils ne sont pas fusionnés avec eux.

```ts
const user = yt.as(session.accessToken, { quotaUser: session.userId });
```

Les trois sortes d'identifiants ne se comportent pas de la même façon :

| Passé à `as()` | Rafraîchissement | Nouvel essai après un 401 | [Vérification des scopes](/auth/scopes/#how-the-client-checks-scopes) |
| --- | --- | --- | --- |
| Une chaîne de jeton | Non | Non | Non |
| Une fonction | À votre charge : elle est appelée avant chaque requête | Non | Non |
| Un objet `OAuth2` | Automatique | Une fois | Oui, quand les jetons portent leur `scope` |

Une chaîne de jeton convient quand autre chose, une bibliothèque de sessions ou un fournisseur d'identité, garde déjà le jeton d'accès à jour. Sinon, utilisez `OAuth2`.

## Un `OAuth2` par utilisateur

Construisez un `OAuth2` pour l'utilisateur de la requête, avec ses jetons chargés depuis votre stockage et un `onTokens` qui les réenregistre sous le même utilisateur.

```ts
import { OAuth2, type Tokens } from "@ix-xs/youtube.api";

function oauthFor(userId: string, tokens?: Tokens): OAuth2 {
  return new OAuth2({
    clientId,
    clientSecret,
    redirectUri: "https://example.com/oauth/callback",
    tokens,
    onTokens: (next) => db.tokens.set(userId, next),
  });
}

const tokens = await db.tokens.get(session.userId);
const user = yt.as(oauthFor(session.userId, tokens));
```

Tout ce que décrit [OAuth 2.0](/auth/oauth/) fonctionne alors par utilisateur : le jeton d'accès est rafraîchi avant son expiration, les nouveaux jetons passent par `onTokens` jusqu'à la bonne ligne, et un enregistrement raté fait échouer l'appel au lieu de perdre les jetons.

Un objet `OAuth2` ne détient aucune connexion : en construire un par requête ne pose pas de problème. Les requêtes d'un même utilisateur qui arrivent ensemble ont alors chacune le leur, et chacune peut se rafraîchir de son côté. Pour qu'elles partagent un seul rafraîchissement, gardez une instance par utilisateur dans une table et retirez-la quand l'utilisateur se déconnecte.

:::danger
Ne partagez jamais un même objet `OAuth2` entre des utilisateurs. `setTokens()` peut le basculer vers un autre utilisateur, mais une requête n'est pas atomique : entre deux de ses `await`, une autre requête peut échanger les jetons, et la première continue sous l'identité d'un autre. `onTokens` n'aurait pas non plus de moyen de savoir à qui appartiennent les jetons qu'elle enregistre.
:::

## Un exemple complet

La connexion, le rappel et une page de données privées. `app`, `req` et `res` représentent votre framework, `session` la session du visiteur et `db` votre stockage.

```ts
import {
  OAuth2,
  YouTube,
  YouTubeAuthError,
  type Tokens,
} from "@ix-xs/youtube.api";

const yt = new YouTube({
  apiKey: process.env.YOUTUBE_API_KEY,
  cache: { ttl: "5m" },
  quota: { enforce: true },
});

function oauthFor(userId: string, tokens?: Tokens): OAuth2 {
  return new OAuth2({
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    redirectUri: "https://example.com/oauth/callback",
    tokens,
    onTokens: (next) => db.tokens.set(userId, next),
  });
}

app.get("/login", async (req, res) => {
  const { url, state, codeVerifier } = await oauthFor(session.userId).authUrl({
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
  // exchange() appelle onTokens, qui stocke les jetons de cet utilisateur.
  await oauthFor(session.userId).exchange(req.query.code, {
    codeVerifier: session.codeVerifier,
  });
  res.redirect("/playlists");
});

app.get("/playlists", async (req, res) => {
  const tokens = await db.tokens.get(session.userId);
  if (!tokens) return res.redirect("/login");

  const user = yt.as(oauthFor(session.userId, tokens));
  try {
    const playlists = await user.playlists
      .list({ part: "snippet", mine: true })
      .all({ limit: 200 });
    res.json(
      playlists.map((playlist) => ({
        id: playlist.id,
        title: playlist.snippet.title,
      })),
    );
  } catch (error) {
    if (
      error instanceof YouTubeAuthError &&
      error.oauthError === "invalid_grant"
    ) {
      // L'utilisateur a révoqué l'accès, ou le jeton de rafraîchissement a expiré.
      await db.tokens.delete(session.userId);
      return res.redirect("/login");
    }
    throw error;
  }
});
```

`playlists.list` coûte 1 unité de quota par page de 50 : cette route dépense donc de 1 à 4 unités par visite qui n'est pas servie depuis le cache.

## Un jeton pour un seul appel

Chaque appel prend des options de requête en dernier argument, et `accessToken` en fait partie. Il remplace les identifiants du client pour cet appel seulement.

```ts
const mine = await yt.channels.mine({ accessToken: session.accessToken });

const page = await yt.playlists.list(
  { part: "snippet", mine: true },
  { accessToken: session.accessToken },
);
```

Il se comporte comme `yt.as(token)` pour un appel : pas de rafraîchissement, pas de nouvel essai après un 401, pas de vérification des scopes. Servez-vous-en pour l'appel isolé fait au nom de quelqu'un. Pour plusieurs appels à la suite, `as()` se lit mieux et ne peut pas être oublié sur l'un d'eux.

## Le cache sépare les utilisateurs

Une réponse mise en cache appartient aux identifiants qui l'ont récupérée. Les appels faits avec la clé d'API partagent leurs entrées. Les appels faits avec un jeton sont stockés par utilisateur, et deux utilisateurs ne lisent jamais les entrées l'un de l'autre. [Cache](/basics/caching/) explique comment.

Sur un serveur, deux conséquences :

1. **Les données publiques ne sont partagées que lues avec la clé.** Un client dérivé envoie le jeton de l'utilisateur dès qu'il le peut, lectures publiques comprises : `user.videos.get(id)` est donc mis en cache pour cet utilisateur seul. Lisez les données publiques par le client de base pour que tous les utilisateurs partagent l'entrée.
2. **Un jeton d'accès nu est sa propre identité.** Avec `yt.as(accessToken)`, un nouveau jeton d'accès pour le même utilisateur repart avec un cache vide. Un client `OAuth2` est identifié par son jeton de rafraîchissement : ses entrées survivent à chaque rafraîchissement.

```ts
app.get("/videos/:id", async (req, res) => {
  const user = yt.as(session.accessToken);

  // Public : lu avec la clé, mis en cache une fois pour tous les visiteurs.
  const video = await yt.videos.get(req.params.id);
  // Privé : lu avec le jeton, mis en cache pour cet utilisateur.
  const rating = await user.videos.ratingOf(req.params.id);

  res.json({ title: video?.snippet.title, rating });
});
```

`videos.get` et `videos.ratingOf` coûtent 1 unité chacun.

## Le quota est par projet, pas par utilisateur

Le quota quotidien appartient à votre projet Google Cloud. Chaque utilisateur de votre serveur y puise, c'est pourquoi les clients dérivés partagent un seul décompte :

```ts
yt.quota.used; // enveloppe par défaut, client de base et clients dérivés réunis
yt.quota.remaining("search.list");

yt.on("quota", ({ method, bucket, cost, remaining }) => {
  if (bucket === "default" && remaining < 500) {
    console.warn(`${method} cost ${cost}, ${remaining} units left today`);
  }
});
```

Avec `quota: { enforce: true }` sur le client de base, un appel qui dépasserait la limite est refusé avant d'être envoyé, quel que soit son destinataire. Le décompte est local au processus. [Quota](/basics/quota/) explique comment le conserver d'un redémarrage à l'autre.

### `quotaUser`

`quotaUser` est une clé d'au plus 40 caractères, envoyée à Google avec la requête, pour les applications serveur qui appliquent des limites par utilisateur. Elle peut être définie sur le client pour toutes les requêtes, ou appel par appel :

```ts
const user = yt.as(session.accessToken);

await user.channels.mine({ quotaUser: session.userId });
```

Un client dérivé hérite du `quotaUser` du client de base comme de n'importe quel autre réglage, sauf si vous lui en donnez un propre en second argument de `as()`. Rien de cela ne scinde le décompte local : `yt.quota` reste un total.

`quotaUser` fait partie de l'URL de la requête. Les lectures mises en cache avec des valeurs différentes ne partagent pas d'entrée, même avec la clé d'API.

## Référence

| API | Ce qu'elle fait |
| --- | --- |
| `yt.as(token)` | Client dérivé qui envoie ce jeton d'accès |
| `yt.as(() => token)` | Client dérivé qui appelle la fonction avant chaque requête. Elle peut renvoyer une promesse |
| `yt.as(oauth)` | Client dérivé qui utilise cet objet `OAuth2`. Disponible sous `user.oauth` |
| `yt.as(credentials, overrides)` | La même chose, avec son propre `quotaUser`, ses propres `headers` ou son propre `onBehalfOfContentOwner` |
| Option de requête `{ accessToken }` | Utilise ce jeton pour un appel, à la place des identifiants du client |
| Option de requête `{ quotaUser }` | Clé de quota par utilisateur pour un appel, 40 caractères au plus |
| Option de client `quotaUser` | La même clé pour toutes les requêtes du client |

Les erreurs à prévoir dans une route :

| Erreur | Sens | Que faire |
| --- | --- | --- |
| `YouTubeAuthError`, `oauthError: "invalid_grant"` | Le jeton de rafraîchissement de cet utilisateur ne fonctionne plus | Supprimez les jetons, renvoyez l'utilisateur au consentement |
| `YouTubeAuthError`, code `INSUFFICIENT_SCOPE` | L'utilisateur n'a pas accordé un scope que la méthode accepte | [Demandez-le](/auth/scopes/#asking-for-more-later) |
| `YouTubeApiError`, code `UNAUTHORIZED` | Un jeton d'accès simple a expiré ou a été révoqué | Obtenez un nouveau jeton auprès de ce qui l'a délivré |
| `YouTubeQuotaBudgetError` | `enforce` a refusé l'appel : le projet n'a plus de budget pour aujourd'hui | Répondez par une page d'erreur, réessayez après `error.resetsAt` |

## Voir aussi

- [OAuth 2.0](/auth/oauth/) : le parcours, le rafraîchissement et `onTokens`.
- [Scopes](/auth/scopes/) : demander à chaque utilisateur ce dont votre fonction a besoin.
- [Cache](/basics/caching/) et [Quota](/basics/quota/) : les deux choses que les clients dérivés partagent.
- [Configuration](/basics/configuration/) : les réglages qu'un client dérivé hérite.
