---
title: Dépannage
description: Les échecs que l'on rencontre en premier, classés par symptôme. Chaque entrée donne la cause et la solution.
---

```ts
try {
  await yt.videos.get(videoId);
} catch (error) {
  if (error instanceof YouTubeApiError) {
    console.error(error.code, error.status, error.reason, error.message);
  } else if (isYouTubeError(error)) {
    console.error(error.code, error.message);
  }
  throw error;
}
```

Commencez par là. Le `code` et la `reason` sont les clés des entrées ci-dessous. [Codes d'erreur](/reference/errors/) les liste tous.

## Identifiants

### "API key not valid. Please pass a valid API key."

`error.reason` vaut `keyInvalid`.

**Cause.** La chaîne envoyée comme clé n'est la clé d'aucun projet : une copie tronquée, des guillemets ou une espace autour, une clé supprimée, ou un identifiant de client OAuth collé à sa place.

**Solution.** Copiez de nouveau la clé depuis **APIs & Services > Credentials** dans la console Google Cloud. Si vous comptez sur l'environnement, vérifiez que la variable s'appelle `YOUTUBE_API_KEY` et qu'elle est définie dans le processus qui exécute votre code.

La variable est lue chaque fois que `apiKey` est omis, y compris sur un client créé avec `oauth` ou `accessToken`. Une `YOUTUBE_API_KEY` oubliée dans l'environnement peut donc apparaître sur un client OAuth : les lectures publiques partent avec la clé tant qu'il n'y a pas de jeton utilisable. Supprimez la variable ou passez le bon `apiKey`.

### "YouTube Data API v3 has not been used in project ... before or it is disabled"

`error.reason` vaut `accessNotConfigured`.

**Cause.** La clé ou le client OAuth appartient à un projet où l'API n'est pas activée.

**Solution.** Dans **APIs & Services > Library**, activez **YouTube Data API v3** pour ce projet. `yt.analytics` et `yt.reporting` appellent deux autres API, à activer séparément : **YouTube Analytics API** et **YouTube Reporting API**.

### `MISSING_CREDENTIALS` sur une écriture

**Cause.** Une clé d'API ne lit que des données publiques. Toute écriture exige OAuth, tout comme les lectures qui concernent un utilisateur, par exemple avec `mine: true`. Le client refuse l'appel avant de l'envoyer : aucun quota n'est dépensé.

**Solution.** Créez le client avec `oauth` ou `accessToken`. L'erreur liste dans `error.scopes` les scopes que la méthode accepte. Voir [OAuth](/auth/oauth/).

```ts
try {
  await yt.playlists.create({ title: "Favourites" });
} catch (error) {
  if (!(error instanceof YouTubeAuthError)) throw error;
  if (error.code === "MISSING_CREDENTIALS") {
    console.log("Needs OAuth with one of:", error.scopes.join(", "));
  }
}
```

Le même code avec le message « This OAuth2 client has no tokens yet » signifie que l'objet `OAuth2` existe mais que l'utilisateur n'a jamais passé l'écran de consentement, ou que les jetons enregistrés n'ont pas été passés comme `tokens`.

### Une lecture publique échoue avant la connexion de l'utilisateur

**Cause.** Le client a été créé avec `oauth` seul. Tant que l'utilisateur n'est pas passé par l'écran de consentement, il n'y a ni jeton ni clé de repli : même `yt.videos.get` lève `MISSING_CREDENTIALS`.

**Solution.** Donnez au client une clé d'API en plus de `oauth`, ou définissez `YOUTUBE_API_KEY`. Une lecture publique part alors avec la clé tant qu'il n'y a pas de jeton utilisable, puis avec le jeton ensuite.

```ts
const yt = new YouTube({ apiKey, oauth });

await yt.videos.get(videoId); // fonctionne avant et après la connexion
```

### `INSUFFICIENT_SCOPE`

**Cause.** Le jeton a reçu des scopes, et la méthode n'en accepte aucun. Un jeton obtenu pour `youtube.readonly` ne peut pas écrire. `youtube.upload` ne peut pas ajouter une vidéo à une playlist. Toutes les méthodes de commentaires n'acceptent que `youtube.force-ssl`.

Une lecture publique n'est pas refusée quand le client a aussi une clé d'API : elle se rabat sur la clé. Cette erreur sur une lecture signifie donc que le client n'a pas de clé, ou que la lecture concerne l'utilisateur, avec `mine: true` par exemple.

**Solution.** Renvoyez l'utilisateur vers l'écran de consentement avec l'un des `error.scopes`. Les scopes accordés auparavant sont conservés. Dans un script qui utilise `tokenFile`, testez `oauth.grantedScopes` avant de décider d'ignorer `authorize()`. Voir [Scopes](/auth/scopes/).

### `ipRefererBlocked`

**Cause.** La clé est restreinte à certaines adresses IP ou à certains référents HTTP, et la requête vient d'ailleurs. Une clé restreinte à un site web ne fonctionne pas depuis un serveur, et inversement.

**Solution.** Utilisez une clé par environnement, chacune avec la restriction qui convient. Voir [Identifiants d'accès](/start/credentials/).

## Quota

### `quotaExceeded` alors que `yt.quota.used` est bas

**Cause.** `yt.quota` compte ce que ce client a envoyé. Il ignore ce que le reste du projet a dépensé : un autre processus, un autre déploiement, une exécution de tests ce matin, une seconde application sur le même projet Google Cloud. Le compteur repart aussi de zéro au démarrage du processus. Et `used` ne reflète que le budget commun : les recherches et les envois sont comptés à part, dans `yt.quota.usage`.

**Solution.** Conservez le compteur d'un redémarrage à l'autre avec `yt.quota.snapshot()` et l'option `quota.restore`. Pour le chiffre réel, ouvrez la page de quota de l'API YouTube Data v3 dans la console Google Cloud. Le quota est remis à zéro à minuit, heure du Pacifique, ce que donne `yt.quota.resetsAt`.

### La recherche s'arrête après 100 appels

**Cause.** `search.list` a une enveloppe à part : 100 appels par jour par défaut, quoi qu'il reste dans les 10 000 unités du budget commun. L'erreur est quand même `QUOTA_EXCEEDED`.

**Solution.** Réservez la recherche aux vraies recherches. Les envois d'une chaîne, les vidéos d'une playlist et une vidéo par identifiant ont tous des méthodes moins chères, qui ne touchent pas cette enveloppe. [Quota](/basics/quota/#buckets) liste les enveloppes et les alternatives.

```ts
// Appels restants aujourd'hui, d'après ce que ce client sait.
yt.quota.remaining("search.list");

// Aucun appel de recherche : 2 unités du budget commun, plus 1 pour le handle.
const latest = await yt.channels.latestVideos("@GoogleDevelopers", {
  limit: 10,
});
```

### `QUOTA_BUDGET_EXCEEDED`

**Cause.** Celle-ci vient de la bibliothèque, pas de YouTube. Le client a été créé avec `quota: { enforce: true }` et l'appel ne tient pas dans ce qui reste de son enveloppe. Rien n'a été envoyé.

**Solution.** Attendez `error.resetsAt`, ou augmentez `quota.limits` si votre projet dispose de plus que l'allocation par défaut.

## Résultats qui semblent faux

### Un appel `list` renvoie 5 éléments

**Cause.** Une méthode `list` brute envoie ce que vous lui donnez. Sans `maxResults`, un appel attendu avec `await` reçoit la page par défaut de l'API : 5 éléments pour la plupart des méthodes, 20 pour les commentaires et les fils de commentaires.

**Solution.** Définissez `maxResults`, ou parcourez la liste : `for await`, `all()` et `take()` demandent la plus grande page que la méthode autorise. Les raccourcis qui renvoient une liste, comme `yt.channels.uploads`, `yt.playlists.items`, `yt.search.videos` ou `yt.commentThreads.forVideo`, demandent des pages pleines même quand on les attend avec `await` : 50 éléments, 100 pour les commentaires. Voir [Listes](/basics/lists/).

```ts
const params = { part: "snippet", playlistId } as const;

const five = await yt.playlistItems.list(params);
const fifty = await yt.playlistItems.list({ ...params, maxResults: 50 });
const alsoFifty = await yt.playlists.items(playlistId);
```

### Une chaîne vaut `null` pour une URL `/c/`

**Cause.** L'API n'a pas de recherche pour les anciennes URL `/c/nom`. `yt.channels.get` essaie le nom comme handle, puis comme nom d'utilisateur. C'est le plus souvent juste, et parfois la chaîne utilise un autre handle.

**Solution.** Passez le `@handle` affiché sur la page de la chaîne, une URL `/channel/UC...`, ou l'identifiant de la chaîne. Les trois sont exacts.

### `subscriberCount` vaut `undefined`, ou semble arrondi

**Cause.** Une chaîne peut masquer son nombre d'abonnés. `statistics.hiddenSubscriberCount` l'indique alors, et `subscriberCount` est facultatif dans le type pour ce cas. Quand le nombre est présent, la bibliothèque remet la chaîne envoyée par l'API, telle quelle : un nombre qui semble arrondi a été envoyé ainsi.

**Solution.** Traitez le cas manquant. La bibliothèque n'a aucun réglage qui modifie le nombre. Voir [Chaînes](/resources/channels/).

```ts
const channel = await yt.channels.get("@GoogleDevelopers");

if (channel) {
  const { hiddenSubscriberCount, subscriberCount } = channel.statistics;
  const hidden = hiddenSubscriberCount || subscriberCount === undefined;
  console.log(hidden ? "hidden" : formatCount(subscriberCount));
}
```

### `likeCount` ou `commentCount` vaut `undefined`

**Cause.** L'API ne renvoie pas ces deux champs pour toutes les vidéos : c'est pourquoi ils sont facultatifs dans les types.

**Solution.** Lisez `undefined` comme « non affiché », pas comme zéro.

### Une vidéo vaut `null`, ou manque dans `getMany`

**Cause.** `yt.videos.get` renvoie `null`, et `yt.videos.getMany` omet la vidéo, quand elle n'existe pas ou qu'elle est privée. Aucune erreur n'est levée.

**Solution.** Comparez les identifiants envoyés avec ceux reçus. Pour lire vos propres vidéos privées, utilisez OAuth.

### Un élément de playlist n'a pas de miniature

**Cause.** La vidéo derrière l'élément a été supprimée ou rendue privée. L'élément reste dans la playlist, avec un `snippet.thumbnails` vide.

**Solution.** `bestThumbnail(item.snippet.thumbnails)` renvoie alors `undefined` : servez-vous-en comme test. `yt.playlists.videos` ignore tout simplement ces entrées.

### `videos.update` a effacé ma description

**Cause.** Une mise à jour remplace chaque partie qu'elle envoie. Un `snippet` qui ne contient qu'un nouveau titre est un `snippet` sans description et sans tags.

**Solution.** Lisez la partie, modifiez-la, renvoyez-la. [Vidéos](/resources/videos/#updating-a-video) donne le schéma complet.

```ts
const video = await yt.videos.get(videoId, { part: "snippet" });

if (video) {
  const snippet = { ...video.snippet, title: "A better title" };
  await yt.videos.update({ body: { id: video.id, snippet } });
}
```

### Une durée de 0

**Cause.** Un flux en direct qui n'est pas terminé indique la durée `P0D`, que `parseDuration` transforme en 0.

**Solution.** Vérifiez `snippet.liveBroadcastContent` ou `liveStreamingDetails` avant de faire confiance à la durée d'une vidéo qui peut être en direct.

## OAuth

### Aucun jeton de rafraîchissement n'est revenu

**Cause.** Google envoie le jeton de rafraîchissement la première fois qu'un utilisateur approuve l'application. Aux consentements suivants, il n'envoie qu'un jeton d'accès : `oauth.canRefresh` vaut donc `false` si le premier n'a pas été stocké.

**Solution.** Forcez l'écran de consentement, ce qui pousse Google à renvoyer un jeton de rafraîchissement. Laissez `accessType` à sa valeur par défaut, `"offline"`. `authorize()` fait déjà les deux.

```ts
const { url } = await oauth.authUrl({
  scopes: ["youtube.readonly"],
  prompt: "consent",
});
```

Stockez ensuite ce que reçoit `onTokens`. Il est appelé après l'échange et après chaque rafraîchissement.

### `invalid_grant`

L'erreur est une `YouTubeAuthError` avec le code `OAUTH_ERROR` et `error.oauthError === "invalid_grant"`.

**Cause.** Le code d'autorisation ou le jeton de rafraîchissement n'est plus valide :

- le code a été échangé deux fois, ou après son expiration ;
- l'utilisateur a révoqué l'accès, ou le jeton a été révoqué avec `oauth.revoke()` ;
- l'écran de consentement du projet a le statut de publication **Testing**. Google fait expirer au bout de 7 jours les jetons de rafraîchissement d'une telle application.

**Solution.** Renvoyez l'utilisateur vers l'écran de consentement. Pour la dernière cause, sortez l'application du statut **Testing** dans la console Google Cloud. Voir [Identifiants d'accès](/start/credentials/).

### `redirect_uri_mismatch`

**Cause.** L'URI de redirection de la requête n'est pas l'une de celles configurées sur le client OAuth. La comparaison est exacte : schéma, hôte, port, chemin et barre oblique finale.

**Solution.** Copiez l'URI que vous passez comme `redirectUri` dans **Authorized redirect URIs** du client. Pour `authorize()`, qui redirige vers `http://127.0.0.1` sur un port libre, créez le client avec le type **Desktop app** : il accepte toute adresse de boucle locale.

### "The access token expired and there is no refresh token"

**Cause.** Le client `OAuth2` a un jeton d'accès et rien pour le renouveler : les jetons ont été enregistrés sans leur `refreshToken`, ou Google n'en a jamais envoyé.

**Solution.** Enregistrez l'objet complet que donne `onTokens` et repassez-le comme `tokens`. S'il ne contient pas de `refreshToken`, voir la première entrée de cette section.

Un client créé avec une simple chaîne `accessToken` échoue autrement à l'expiration du jeton : l'API répond 401 et l'appel lève `UNAUTHORIZED`. Rien ne rafraîchit ce jeton à votre place. Passez plutôt une fonction qui renvoie un jeton à jour.

## Envois

### La vidéo envoyée est verrouillée en privé

**Cause.** Les vidéos envoyées par un projet d'API non vérifié sont verrouillées en privé tant que le projet n'a pas passé un audit. L'envoi lui-même réussit.

**Solution.** Demandez l'audit de votre projet. La [FAQ](/help/faq/#how-do-i-get-more-quota) donne le lien vers le formulaire.

### L'envoi échoue en cours de route

**Cause.** La connexion a coupé et les nouvelles tentatives d'un morceau sont épuisées. L'erreur est une `YouTubeUploadError` avec le code `UPLOAD_FAILED`.

**Solution.** Les octets déjà envoyés ne sont pas perdus. Repassez `error.sessionUri` comme `resumeUri` et l'envoi reprend au dernier octet confirmé, que `error.uploaded` indique. Une session reste valide environ une semaine.

Quand `sessionUri` vaut `undefined`, il n'y a rien à reprendre : le fichier était assez petit pour tenir en une seule requête, aucune session n'a pu être ouverte, ou la session a expiré. Une session expirée est signalée de la même façon, par une `YouTubeUploadError` sans `sessionUri`. Recommencez au premier octet.

```ts
import { fileMedia } from "@ix-xs/youtube.api/node";

const path = "./holiday.mp4";
const body = {
  snippet: { title: "Holiday 2026" },
  status: { privacyStatus: "private" },
} as const;

try {
  await yt.videos.insert({ body, media: await fileMedia(path) });
} catch (error) {
  if (!(error instanceof YouTubeUploadError)) throw error;
  const resumeUri = error.sessionUri;
  if (!resumeUri) throw error; // rien à reprendre
  await yt.videos.insert({ body, media: await fileMedia(path, { resumeUri }) });
}
```

Pour reprendre après la mort du processus lui-même, stockez le `sessionUri` que reçoit `onProgress`. [Mettre en ligne depuis un script](/recipes/upload-from-a-script/) le fait.

### « does not accept ... » avant tout envoi

**Cause.** Le type MIME du média n'est pas de ceux que la méthode accepte : une image pour `videos.insert`, une vidéo pour `thumbnails.set`. `fileMedia` déduit le type de l'extension du fichier, et un `Blob` porte le sien.

**Solution.** Vérifiez que vous passez le bon fichier. Pour une extension inhabituelle, définissez vous-même `mimeType`.

## Chat en direct

### `liveChatOf` lève « has no active live chat »

**Cause.** La vidéo existe et n'a pas de chat à rejoindre : elle n'est pas en direct pour le moment, ou son chat est désactivé. L'erreur est une `YouTubeArgumentError`.

**Solution.** Ouvrez le chat une fois la diffusion en direct. Pour votre propre diffusion, l'identifiant du chat figure aussi sur la ressource de diffusion : voir [Diffusions](/live/broadcasts/).

### La boucle se termine sans erreur

**Cause.** C'est ainsi que la fin d'un chat est signalée. `chat.messages()` se termine quand la diffusion passe hors ligne, quand l'API répond `liveChatEnded` ou `liveChatDisabled`, ou quand votre `signal` est interrompu.

**Solution.** Rien. Placez après la boucle ce qui doit se passer à la fin du flux.

### Les messages déjà présents dans le chat ne sont pas livrés

**Cause.** Par défaut, la boucle ne produit que les messages publiés après son démarrage.

**Solution.** Passez `history: true` à `chat.messages()`.

### Le quota est épuisé au bout de quelques heures

**Cause.** Chaque lecture du chat coûte 5 unités, et il y en a une toutes les quelques secondes.

**Solution.** Définissez `minInterval`. Chaque lecture reprend au jeton de page de la précédente et demande jusqu'à 2 000 messages : un intervalle plus long livre donc les mêmes messages plus tard, par lots plus gros. [Chat en direct](/live/live-chat/) détaille le calcul.

## Notifications

### `FEED_UNAVAILABLE`

**Cause.** Le flux public n'a pas répondu, ou a répondu par une erreur. YouTube ne garantit pas ce flux, et il a connu des pannes où tous les flux répondent 404 pendant des heures. Cela ne signifie pas que la chaîne a disparu.

**Solution.** Utilisez `yt.watch()` plutôt que `fetchFeed` dans une boucle : il bascule sur l'API pour cette chaîne quand le flux échoue. Ou lisez les envois par l'API avec `yt.channels.uploads()`, à 1 unité par appel. Voir [Flux et oEmbed](/notifications/feeds-and-oembed/).

### Le hub n'appelle jamais mon point de terminaison

Si `subscribe()` lève lui-même une erreur, le hub a refusé la requête : l'erreur a le code `HUB_ERROR` et son message contient la réponse du hub. Quand `subscribe()` se résout et que rien ne suit, passez en revue ces points dans l'ordre :

1. **L'URL n'est pas joignable.** `callbackUrl` doit être une URL HTTPS publique. `localhost`, une adresse privée ou une URL derrière une connexion ne conviennent pas. Utilisez un tunnel pendant le développement.
2. **La confirmation n'a pas reçu de réponse.** Après `subscribe()`, le hub envoie à votre URL un `GET` avec un défi, et l'abonnement ne devient actif qu'une fois la bonne réponse reçue. Routez `GET` comme `POST` vers `websub.receive` et renvoyez `result.response` tel quel.
3. **Le point de terminaison a démarré trop tard.** `subscribe()` se résout quand le hub a accepté la requête, avant la confirmation. Le serveur doit déjà écouter.
4. **La signature ne correspond pas.** Avec un `secret`, une notification dont la signature est fausse est abandonnée en silence : `notifications` est vide et `verified` vaut `false`. Utilisez le même secret dans `subscribe` et dans `receive`.
5. **L'abonnement a expiré.** Un abonnement dure 5 jours par défaut. Rappelez `subscribe` avant la fin.
6. **Votre fonction `confirm` l'a refusé.** Elle doit renvoyer `true` pour les chaînes que vous suivez.

[Notifications push](/notifications/push-notifications/) décrit chaque étape.

### Une notification arrive pour une ancienne vidéo

**Cause.** Le hub notifie la publication d'une vidéo, et aussi la modification de son titre ou de sa description. La notification ne dit pas laquelle.

**Solution.** Retenez les identifiants de vidéos déjà traités.

### L'observateur ne signale rien pour des vidéos qui existent déjà

**Cause.** Un observateur signale les vidéos publiées après sa création.

**Solution.** Passez `since` avec le moment de départ. Pour rattraper un retard après un redémarrage, donnez une heure de quelques minutes antérieure à votre dernière exécution, car le flux public a du retard sur les envois, et ignorez les identifiants de vidéos déjà traités. Voir [Surveiller les nouvelles vidéos](/notifications/watching-uploads/).

### L'observateur signale « No channel found » une fois, puis plus rien

**Cause.** Un handle ou une URL ne correspondait à aucune chaîne. L'observateur émet un seul `error` pour elle, puis laisse cette référence de côté et la recherche de nouveau 6 heures plus tard. La rechercher à chaque tour dépenserait du quota pour une faute de frappe.

**Solution.** Corrigez la référence et recréez l'observateur, ou faites `remove()` de la mauvaise et `add()` de la bonne. Les autres chaînes continuent d'être vérifiées entre-temps.

### L'événement `error` de l'observateur a un `channel` vide

**Cause.** La charge utile est `{ channel, error }`. `channel` est la référence de la chaîne qui n'a pas pu être vérifiée. C'est une chaîne vide quand l'erreur ne vient pas d'une chaîne : l'un de vos propres écouteurs `video` ou `poll` a levé une erreur, ou renvoyé une promesse rejetée.

**Solution.** Testez `channel` avant de signaler, et cherchez le bug dans votre écouteur quand il est vide.

```ts
const watcher = yt.watch(["@GoogleDevelopers"]);

watcher.on("error", ({ channel, error }) => {
  if (channel) console.warn(`Could not check ${channel}:`, error);
  else console.warn("A listener failed:", error);
});
```

### « is not a channel id » avec `new Watcher()`

**Cause.** Un `Watcher` construit directement n'a pas de client d'API : il ne peut donc pas résoudre les handles ni les URL.

**Solution.** Créez-le avec `yt.watch()`, ou passez des identifiants `UC...`.

## TypeScript

### "Property 'statistics' does not exist on type ..."

**Cause.** La partie n'a pas été demandée. Le type du résultat ne contient que les parties nommées dans `part`, car l'API ne renvoie que celles-ci.

**Solution.** Ajoutez la partie à l'appel. Voir [Parties et types](/basics/parts-and-types/).

```ts
const slim = await yt.videos.get(videoId, { part: "snippet" });
// @ts-expect-error statistics n'a pas été demandé
slim?.statistics;

const full = await yt.videos.get(videoId, { part: ["snippet", "statistics"] });
full?.statistics.viewCount;
```

### Un `part` construit dans une variable ne compile pas

**Cause.** Un tableau de chaînes déclaré sur sa propre ligne est typé `string[]`. Les noms de parties sont perdus, et avec eux le lien entre `part` et le résultat.

**Solution.** Déclarez-le `as const`.

```ts
const loose = ["snippet", "statistics"];
// @ts-expect-error string[] n'est pas une liste de parties de vidéo
yt.videos.list({ part: loose, id: videoId });

const part = ["snippet", "statistics"] as const;
const { items } = await yt.videos.list({ part, id: videoId });
items[0]?.statistics.viewCount;
```

### Un champ est `string | undefined` et je sais qu'il est là

**Cause.** Un champ est facultatif quand YouTube ne le renvoie pas pour toutes les ressources : les tags, un nombre de mentions « j'aime » masqué, les miniatures d'une vidéo supprimée.

**Solution.** Traitez le cas manquant. La [FAQ](/help/faq/#why-is-a-field-optional) explique comment la liste des champs obligatoires est décidée.

### Les types se résolvent en `any`, ou le module est introuvable

**Cause.** Ce n'est pas le réglage `moduleResolution` : le paquet livre des déclarations pour CommonJS et pour les modules ES, et les deux points d'entrée se résolvent sous `node16`, `nodenext`, `bundler` et l'ancien `node10`. Regardez plutôt ceci :

- **Le paquet n'est pas installé là où le compilateur cherche.** Dans un monorepo, vérifiez l'espace de travail qui l'importe. `npm ls @ix-xs/youtube.api` le dit.
- **La version 1 est installée.** La version 2 est une réécriture avec une API différente : `npm ls` montre laquelle vous avez. Voir [Migrer depuis la 1.x](/start/migrating-from-v1/).
- **`skipLibCheck` masque les erreurs dans les déclarations.** Les déclarations font référence à des types web comme `Request`, `Blob` et `ReadableStream`. Un projet qui n'a ni la bibliothèque `DOM` ni `@types/node` ne les a pas, et avec `skipLibCheck` le compilateur se tait et type en `any` ce qu'il ne peut pas résoudre. Ajoutez `@types/node`, ou `"DOM"` dans `lib`.
- **Le compilateur est ancien.** Les déclarations sont générées avec TypeScript 6. Si désactiver `skipLibCheck` montre des erreurs de syntaxe dans `index.d.ts`, mettez TypeScript à jour.

[Environnements d'exécution](/reference/runtimes/#typescript) donne la table de résolution.

## Voir aussi

- [Codes d'erreur](/reference/errors/) pour chaque code et chaque raison.
- [Erreurs](/basics/errors/) pour le traitement, les nouvelles tentatives et les délais.
- [FAQ](/help/faq/) pour les questions qui ne sont pas des échecs.
- [Issues GitHub](https://github.com/ix-xs/youtube.api/issues) quand rien de tout cela ne correspond.
