---
title: FAQ
description: Des réponses courtes aux questions qui se posent avant et après l'installation de la bibliothèque, chacune avec un lien vers la page qui traite le sujet.
---

## Est-ce officiel ?

Non. `@ix-xs/youtube.api` est un projet open source indépendant, sous licence MIT. Il n'est affilié ni à YouTube ni à Google.

Il appelle les API officielles et rien d'autre : les règles de ces API s'appliquent donc à vous. Les utiliser, c'est accepter les [conditions d'utilisation des services d'API YouTube](https://developers.google.com/youtube/terms/api-services-terms-of-service).

## Fonctionne-t-il sans clé d'API ?

Seulement pour ce qui n'appelle pas l'API :

| Quoi | Fonctions |
| --- | --- |
| Flux publics d'une chaîne ou d'une playlist | `fetchFeed`, `parseFeed`, `feedUrl`, et un `Watcher` construit à partir d'identifiants de chaînes |
| oEmbed | `oEmbed` |
| Notifications push | `websub` |
| URL et identifiants | `parseUrl`, `videoIdFrom`, `playlistIdFrom`, `parseChannelRef`, `channelPlaylistId`, `urls` |
| Mise en forme | `parseDuration`, `formatDuration`, `formatCount`, `bestThumbnail` |

```ts
const info = await oEmbed("https://youtu.be/dQw4w9WgXcQ"); // sans clé, sans quota
console.log(info?.title, info?.authorName);
```

Tout ce qui passe par le client, `yt.videos`, `yt.channels` et le reste, exige une clé d'API ou OAuth. [Démarrage rapide](/start/quick-start/) montre comment créer une clé. [Flux et oEmbed](/notifications/feeds-and-oembed/) décrit ce qui fonctionne sans.

## Ai-je encore besoin d'une clé d'API avec OAuth ?

Non, mais c'est utile d'en avoir une. Un jeton suffit pour tous les appels. Avec une clé à côté, les lectures publiques continuent de fonctionner dans deux cas où le jeton ne peut pas servir : avant que l'utilisateur se soit connecté, et quand le jeton n'a pas un scope que la méthode accepte. Les lectures qui concernent l'utilisateur, et toute écriture, utilisent toujours le jeton.

```ts
const yt = new YouTube({ apiKey, oauth });
```

Quand `apiKey` est omis, le client lit la variable d'environnement `YOUTUBE_API_KEY`. Il le fait aussi avec `oauth` et `accessToken` : définir la variable a donc le même effet que la ligne ci-dessus.

## Peut-il télécharger des vidéos ou lire les sous-titres des autres ?

Non. L'API YouTube ne permet ni de télécharger des vidéos ni de lire les sous-titres des vidéos d'autrui, et cette bibliothèque ne fait qu'envelopper l'API officielle.

`yt.captions.download` existe, avec OAuth, pour 200 unités. Il sert aux pistes de sous-titres de vos propres vidéos. Voir [Sous-titres](/resources/captions/).

## En quoi diffère-t-il de `googleapis` ?

`googleapis` est le client Node.js de Google lui-même. Il couvre de nombreuses API Google, dont YouTube. Si votre application l'utilise déjà pour d'autres services Google, un seul client pour tout est une bonne raison de le garder.

Cette bibliothèque ne couvre que les API YouTube. Ce qu'elle offre :

- **Aucune dépendance, et aucun module Node.js dans l'entrée principale.** Elle fonctionne partout où `fetch` existe. Voir [Environnements d'exécution](/reference/runtimes/).
- **Des résultats réduits selon `part`.** Le type d'un résultat contient les parties que vous avez demandées, et aucune autre. Voir [Parties et types](/basics/parts-and-types/).
- **Des listes que l'on peut parcourir.** Chaque `list` s'attend avec `await` pour une page ou se parcourt avec `for await`. Les raccourcis qui renvoient une liste demandent des pages pleines, 50 éléments ou 100 pour les commentaires. Une méthode `list` brute attendue sans `maxResults` reçoit la valeur par défaut de l'API, 5 pour la plupart des méthodes. Voir [Listes](/basics/lists/).
- **Le suivi du quota.** Le client connaît le coût de chaque méthode et compte ce qu'il dépense. Voir [Quota](/basics/quota/).
- **Des handles et des URL en entrée.** Les raccourcis acceptent `"@handle"`, une URL ou un identifiant. Voir [ID et URL](/basics/ids-and-urls/).

## La liste des méthodes est-elle complète ?

Elle suit les documents de découverte de Google : 82 méthodes de l'API Data v3, diffusion en direct comprise, 8 de l'API Analytics et 8 de l'API Reporting.

Les méthodes, leurs paramètres et les types de ressources sont générés à partir de ces documents, qui sont épinglés dans le dépôt. Le générateur s'arrête avec une erreur tant qu'une méthode des documents n'a pas d'entrée. Une fois par semaine, une tâche d'intégration continue compare les documents épinglés avec ce que Google sert et échoue quand ils diffèrent : c'est le signal pour mettre à jour.

[Toutes les méthodes](/reference/methods/) les liste toutes.

## Comment obtenir plus de quota ?

Demandez à Google. La bibliothèque compte un nouveau projet à 10 000 unités par jour, plus 100 recherches et 100 envois dans des enveloppes à part. Les extensions de quota passent par le [formulaire d'audit et d'extension de quota des services d'API YouTube](https://support.google.com/youtube/contact/yt_api_form). Ce même formulaire sert à demander l'audit qui lève le verrouillage en privé des vidéos envoyées par un projet non vérifié.

Une fois votre allocation modifiée, dites-le au client, pour que `yt.quota.remaining()` et `quota.enforce` utilisent les bons chiffres :

```ts
const yt = new YouTube({ apiKey, quota: { limits: { default: 50_000 } } });
```

Avant de demander, vérifiez que vous en avez besoin : [Quota](/basics/quota/) donne les moyens de dépenser moins.

## Pourquoi les compteurs sont-ils des chaînes ?

Parce que l'API les envoie sous forme de chaînes. Les nombres de vues, de mentions « j'aime » et d'abonnés sont des entiers de 64 bits, et un nombre JSON ne peut pas porter exactement toutes les valeurs sur 64 bits. La bibliothèque garde ce que l'API a envoyé au lieu de l'arrondir en silence.

```ts
const video = await yt.videos.get(videoId);

if (video) {
  Number(video.statistics.viewCount); // pour calculer
  formatCount(video.statistics.viewCount); // "1.2M", pour l'affichage
}
```

Les champs qui ne sont pas des entiers de 64 bits sont des nombres : `likeCount` sur un commentaire, `itemCount` sur une playlist. Les métriques des rapports [Analytics](/analytics/analytics/) aussi.

## Pourquoi un champ est-il facultatif ?

Parce que YouTube ne le renvoie pas pour toutes les ressources. `tags`, `likeCount` sur une vidéo et `subscriberCount` sur une chaîne en sont des exemples, tout comme les miniatures d'une vidéo supprimée dans une playlist.

La description de l'API par Google ne marque rien comme obligatoire : tous les champs seraient donc facultatifs si les types la suivaient aveuglément. La bibliothèque tient une liste des champs que l'API renvoie sur toutes les ressources, privées ou supprimées comprises, et seuls ceux-là sont obligatoires dans les types. Un test qui appelle la vraie API compare la liste avec ce que renvoie YouTube. Un champ laissé facultatif est un champ que vous devez traiter.

Il en va de même pour des parties entières : `liveStreamingDetails` reste facultatif même quand vous le demandez, car une vidéo qui n'a jamais été en direct n'en a pas. [Parties et types](/basics/parts-and-types/) donne les règles.

## Puis-je l'utiliser dans le navigateur ?

Oui. L'entrée principale n'utilise que des API web standard. Deux choses changent : une clé d'API dans une page est visible de tous les visiteurs, restreignez-la donc par référent HTTP, et un secret client ne doit jamais être embarqué. Les envois acceptent un `File`.

[Environnements d'exécution](/reference/runtimes/#browsers) couvre les navigateurs, Bun, Deno et les environnements edge.

## CommonJS ou ESM ?

Les deux. Le paquet livre une construction et des déclarations de types pour chacun, et Node.js choisit la bonne selon la façon dont vous le chargez.

```ts
import { YouTube } from "@ix-xs/youtube.api";
```

```js
const { YouTube } = require("@ix-xs/youtube.api");
```

## Fait-il de nouvelles tentatives ?

Oui, quand une nouvelle tentative peut aider sans faire de mal. Les limites de débit sont réessayées pour tout appel. Les erreurs du serveur, les délais dépassés et les échecs réseau ne sont réessayés que pour les lectures, car une écriture a peut-être abouti. Il y a 3 nouvelles tentatives par défaut, avec un délai qui double à partir de 500 ms jusqu'à 30 secondes. Un `Retry-After` de l'API sert de délai. Quand il dépasse `retry.maxDelay`, 30 secondes par défaut, l'appel n'est pas réessayé : l'erreur est levée avec son `retryAfter`.

`retry` et `timeout` sont des options du client et de chaque appel. Voir [Erreurs](/basics/errors/).

## Comment journaliser les requêtes ?

Abonnez-vous aux événements du client. Les URL des charges utiles n'ont plus leurs identifiants : vous pouvez donc les afficher sans risque.

```ts
yt.on("request", ({ method, verb, url, attempt }) => {
  console.log(verb, method, url, `attempt ${attempt}`);
});
yt.on("response", ({ method, status, duration, cached, cost }) => {
  const spent = cached ? "from cache" : `${cost} units`;
  console.log(method, status, `${duration} ms`, spent);
});
yt.on("retry", ({ method, attempt, delay }) => {
  console.warn(`${method}: retry ${attempt} in ${delay} ms`);
});
```

Il existe aussi un événement `quota`, un événement `error` pour un écouteur ou un magasin de cache qui a échoué, et une option `fetch` quand vous voulez voir ou modifier les requêtes brutes. Voir [Configuration](/basics/configuration/).

## Où signaler un bug ?

Dans les [issues GitHub](https://github.com/ix-xs/youtube.api/issues). Indiquez la version du paquet, l'environnement d'exécution, l'appel, ainsi que le `code`, la `reason` et le `message` de l'erreur. Retirez d'abord les clés et les jetons : `error.url` est déjà nettoyée, vos propres journaux ne le sont peut-être pas.

Pour un problème de sécurité, n'ouvrez pas d'issue publique. Utilisez le [formulaire d'avis privé](https://github.com/ix-xs/youtube.api/security/advisories/new) du dépôt.

[Dépannage](/help/troubleshooting/) a peut-être la réponse avant que vous ayez besoin de demander.

## Voir aussi

- [Dépannage](/help/troubleshooting/) pour les échecs, par symptôme.
- [Démarrage rapide](/start/quick-start/) pour installer le paquet et faire un premier appel.
- [Toutes les méthodes](/reference/methods/) pour toute l'API sur une page.
- [Migrer depuis la 1.x](/start/migrating-from-v1/) si vous venez de la version 1.
