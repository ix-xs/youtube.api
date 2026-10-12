---
title: Chat en direct
description: Lisez le chat d'une diffusion en direct au fil des messages, distinguez les Super Chats et les nouveaux membres du texte simple, puis envoyez, supprimez, bannissez et modérez. La lecture fonctionne avec une clé d'API.
sidebar:
  order: 2
---

```ts
const chat = await yt.liveChatOf("https://www.youtube.com/watch?v=jfKfPfyJRdk");

for await (const message of chat.messages()) {
  const { displayName } = message.authorDetails;
  console.log(`${displayName}: ${message.snippet.displayMessage}`);
}
```

## Ouvrir un chat

`yt.liveChatOf(video)` prend un identifiant de vidéo ou n'importe quelle URL de vidéo, et trouve le chat de cette diffusion. Quota : 1 unité, pour un appel à `videos.list`.

```ts
const chat = await yt.liveChatOf(videoId);

chat.id; // l'identifiant du chat en direct
```

La méthode lève une `YouTubeArgumentError` quand la chaîne n'est pas une vidéo, quand la vidéo n'existe pas ou est privée, et quand elle n'a pas de chat actif : la vidéo n'est pas en direct en ce moment, ou son chat est désactivé.

Quand vous avez déjà l'identifiant du chat, `yt.liveChat(liveChatId)` construit le même objet sans aucun appel. L'identifiant est `liveStreamingDetails.activeLiveChatId` sur une vidéo, ou `snippet.liveChatId` sur [votre propre diffusion](/live/broadcasts/).

```ts
const chat = yt.liveChat(liveChatId);
```

## Lire les messages

`chat.messages()` est un générateur asynchrone. Il demande les nouveaux messages à YouTube, les produit, attend le délai que YouTube indique, puis recommence. Quota : 5 unités par requête.

```ts
const chat = yt.liveChat(liveChatId);

const stop = new AbortController();
process.once("SIGINT", () => stop.abort());

const messages = chat.messages({ signal: stop.signal, minInterval: "10s" });

for await (const { snippet, authorDetails } of messages) {
  console.log(snippet.publishedAt, authorDetails.displayName);
  console.log(snippet.displayMessage);
}

console.log("Chat closed.");
```

Chaque message est un `ChatMessage` : un message de chat avec son `snippet` et ses `authorDetails`.

| Option | Par défaut | Effet |
| --- | --- | --- |
| `history` | `false` | `true` produit aussi les messages déjà présents dans le chat au début de la lecture |
| `minInterval` | aucun | Ne jamais demander plus souvent que cet intervalle, même quand YouTube le permet. En mode `"stream"`, la pause avant la reconnexion |
| `signal` | aucun | L'annuler termine la boucle sans erreur |
| `profileImageSize` | valeur par défaut de l'API | Taille en pixels de `authorDetails.profileImageUrl`, de 16 à 720 |
| `hl` | valeur par défaut de l'API | Langue des messages système, par exemple `"fr"` |
| `mode` | `"poll"` | `"stream"` garde une seule connexion ouverte. [Expérimental](#one-connection-instead-of-polling) |

Sans `history`, la première requête est tout de même faite. Ses messages sont ignorés, et elle indique à la boucle où se trouve « maintenant ».

## Avec une fonction de rappel

`chat.listen()` exécute la même boucle en arrière-plan et vous appelle pour chaque message. Elle renvoie un objet de contrôle.

```ts
const chat = yt.liveChat(liveChatId);

const subscription = chat.listen(
  (message) => {
    if (message.snippet.displayMessage === "!hello") void chat.send("Hello!");
  },
  {
    minInterval: "5s",
    onError: (error) => console.error("Chat reading failed:", error),
  },
);

// Plus tard.
subscription.stop();
await subscription.done;
```

`done` se résout quand l'écoute est terminée : le chat s'est fini, `stop()` a été appelé ou la lecture a échoué. Un échec va à `onError` si vous en avez donné un. Sinon, il rejette `done`.

La fonction de rappel peut être asynchrone. Les messages sont remis un par un : le suivant attend la fin de votre fonction. Une fonction qui lève une erreur arrête la boucle et compte comme un échec.

`listen` accepte les options de `messages()` sauf `signal` : `stop()` le remplace.

## Distinguer les types de message

Un chat transporte plus que du texte. Faites un `switch` sur `message.snippet.type`, puis lisez l'objet de détails qui l'accompagne.

```ts
const chat = yt.liveChat(liveChatId);

for await (const { snippet, authorDetails } of chat.messages()) {
  const author = authorDetails.displayName;

  switch (snippet.type) {
    case "textMessageEvent":
      console.log(`${author}: ${snippet.textMessageDetails?.messageText}`);
      break;
    case "superChatEvent": {
      const paid = snippet.superChatDetails;
      const comment = paid?.userComment ?? "";
      console.log(`${author} sent ${paid?.amountDisplayString}: ${comment}`);
      break;
    }
    case "superStickerEvent": {
      const amount = snippet.superStickerDetails?.amountDisplayString;
      console.log(`${author} sent a sticker worth ${amount}`);
      break;
    }
    case "newSponsorEvent": {
      const level = snippet.newSponsorDetails?.memberLevelName ?? "no level";
      console.log(`${author} joined as a member (${level})`);
      break;
    }
    case "memberMilestoneChatEvent": {
      const months = snippet.memberMilestoneChatDetails?.memberMonth;
      console.log(`${author}: member for ${months} months`);
      break;
    }
    case "membershipGiftingEvent": {
      const count = snippet.membershipGiftingDetails?.giftMembershipsCount;
      console.log(`${author} gifted ${count} memberships`);
      break;
    }
    default:
      if (snippet.displayMessage) console.log(snippet.displayMessage);
  }
}
```

Dans cette API, YouTube appelle les membres des « sponsors » : `newSponsorEvent` est un nouveau membre, `isChatSponsor` signifie « est membre ».

Dans les types, chaque objet de détails est facultatif, car il n'est renseigné que pour son propre type de message. `displayMessage` est le texte à afficher pour le message, quel que soit son type. Il est absent de `tombstone` et de `chatEndedEvent`, qui sont silencieux.

Les montants arrivent sous forme de texte à afficher et de micros. Divisez par un million pour obtenir le montant :

```ts
function superChatAmount(message: ChatMessage) {
  const details = message.snippet.superChatDetails;
  if (!details?.amountMicros || !details.currency) return undefined;
  return {
    amount: Number(details.amountMicros) / 1_000_000,
    currency: details.currency,
  };
}
```

Le rôle de l'auteur se trouve dans `authorDetails` :

```ts
const chat = yt.liveChat(liveChatId);

for await (const { snippet, authorDetails: author } of chat.messages()) {
  const text = snippet.displayMessage;

  if (author.isChatOwner || author.isChatModerator) console.log("staff:", text);
  else if (author.isChatSponsor) console.log("member:", text);
  else if (author.isVerified) console.log("verified:", text);
}
```

## Ce que coûte la lecture

Chaque requête coûte 5 unités, et la boucle en fait une après chaque attente tant qu'elle tourne. L'attente est celle que YouTube renvoie avec chaque réponse, ou 5 secondes quand la réponse n'en donne aucune.

Avec une attente de 5 secondes :

| Rythme | Requêtes par heure | Unités par heure | Durée des 10 000 unités quotidiennes |
| --- | --- | --- | --- |
| 5 secondes | 720 | 3 600 | 2 h 46 min |
| `minInterval: "15s"` | 240 | 1 200 | 8 h 20 min |
| `minInterval: "30s"` | 120 | 600 | 16 h 40 min |
| `minInterval: "1m"` | 60 | 300 | Toute la journée : 7 200 unités en 24 heures |

`minInterval` est un plancher. Quand YouTube demande une attente plus longue, c'est la plus longue qui l'emporte. Un rythme plus lent ne fait perdre aucun message : chaque requête en demande jusqu'à 2 000 et reprend là où la précédente s'est arrêtée. Ils vous parviennent seulement plus tard.

Deux chats lus en même temps coûtent deux fois plus. [Quota](/basics/quota/) montre comment suivre le compteur et comment refuser les appels au-delà d'un budget.

## Quand la boucle s'arrête

La boucle s'arrête sans erreur quand :

- la réponse indique que la diffusion est passée hors ligne, ou que l'API répond que le chat est terminé (`liveChatEnded`) ou désactivé (`liveChatDisabled`) ;
- `signal` a été annulé, ou `stop()` a été appelé.

Tout le reste lève une erreur hors du `for await`, après les nouvelles tentatives du client : quota épuisé, identifiants refusés, réseau coupé.

```ts
const chat = yt.liveChat(liveChatId);

try {
  for await (const message of chat.messages()) {
    console.log(message.snippet.displayMessage);
  }
  console.log("The chat is over.");
} catch (error) {
  if (!isYouTubeError(error, "QUOTA_EXCEEDED")) throw error;
  console.log("Out of quota until", yt.quota.resetsAt);
}
```

La lecture du chat n'utilise jamais le cache des réponses, même quand le client en a un : une page mise en cache rejouerait d'anciens messages comme s'ils étaient nouveaux. Si vous appelez vous-même la méthode brute `yt.liveChatMessages.list` sur un client avec cache, passez `{ cache: false }`.

## Envoyer et supprimer

Écrire demande OAuth avec le scope `youtube` ou `youtube.force-ssl`.

```ts
const chat = yt.liveChat(liveChatId);

const sent = await chat.send("Thanks for watching!"); // 20 unités
console.log(sent.id, sent.snippet.publishedAt);

await chat.delete(messageId); // 20 unités
```

`send` publie au nom de l'utilisateur authentifié et renvoie le message créé. `delete` est réservé au propriétaire de la chaîne et aux modérateurs. L'identifiant d'un message est `message.id`.

## Bannir

`chat.ban()` prend l'identifiant de chaîne de l'utilisateur. Avec `duration`, le bannissement est temporaire. Sans, il est définitif. Quota : 200 unités.

```ts
const chat = yt.liveChat(liveChatId);

for await (const message of chat.messages()) {
  if (!message.snippet.displayMessage?.includes("spam.example")) continue;

  await chat.delete(message.id); // 20 unités
  const ban = await chat.ban(message.authorDetails.channelId, {
    duration: "5m",
  });
  console.log("Banned for 5 minutes, ban id", ban.id);
}
```

Conservez l'`id` du bannissement : c'est ce que `unban` prend. Quota : 200 unités.

```ts
const chat = yt.liveChat(liveChatId);

const ban = await chat.ban(channelId); // définitif
await chat.unban(ban.id);
```

`duration` est un nombre de millisecondes ou une chaîne comme `"30s"`, `"5m"`, `"2h"`. Elle est envoyée en secondes entières, une au minimum.

## Modérateurs

```ts
const chat = yt.liveChat(liveChatId);

const moderators = await chat.moderators(); // 50 unités par page

for (const moderator of moderators) {
  console.log(moderator.id, moderator.snippet.moderatorDetails?.displayName);
}

const added = await chat.addModerator(channelId); // 200 unités
await chat.removeModerator(added.id); // 200 unités
```

`moderators()` lit toutes les pages et renvoie un seul tableau. `addModerator` prend un identifiant de chaîne. `removeModerator` prend l'identifiant de la ressource modérateur, celui que renvoient `addModerator` et `moderators()`, et non l'identifiant de chaîne.

## Historique des Super Chats

`superChatEvents.list` renvoie les Super Chats et les Super Stickers reçus par votre chaîne durant les 30 derniers jours, sans lire aucun chat. Quota : 1 unité par page. OAuth est requis.

```ts
for await (const event of yt.superChatEvents.list({ part: "snippet" })) {
  const { supporterDetails, displayString, createdAt } = event.snippet;
  const what = event.snippet.isSuperStickerEvent
    ? "(sticker)"
    : event.snippet.commentText;
  console.log(createdAt, supporterDetails?.displayName, displayString, what);
}
```

`amountMicros` et `currency` donnent le montant en chiffres, comme dans le chat.

## Une seule connexion plutôt que l'interrogation

`mode: "stream"` lit le chat sur une seule connexion de longue durée :

```ts
const chat = yt.liveChat(liveChatId);

for await (const message of chat.messages({ mode: "stream" })) {
  console.log(message.snippet.displayMessage);
}
```

:::caution
Ce mode est expérimental. YouTube ne documente cette méthode que pour gRPC. La bibliothèque passe par la correspondance HTTP de la même méthode, que Google ne documente pas. Préférez l'interrogation par défaut quand vous avez besoin de fiabilité.
:::

Quota : 5 unités par connexion. Quand le serveur ferme la connexion, la boucle fait une pause, puis se reconnecte depuis la dernière position. La pause vaut `minInterval`, et 1 seconde au minimum.

Une connexion est une seule requête, et le `timeout` du client ne s'y applique pas. Une connexion coupée est rouverte depuis la dernière position, avec une pause plus longue à chaque fois. Après trois coupures de suite sans message, la boucle lève une `YouTubeRequestError` avec le code `NETWORK`. Passez un `signal` pour l'arrêter.

La méthode sous-jacente est `yt.liveChatMessages.stream()`. Chaque valeur est un lot qui a la forme d'une réponse de `list`. Passez son `nextPageToken` comme `pageToken` pour reprendre après une déconnexion.

```ts
const batches = yt.liveChatMessages.stream({
  liveChatId,
  part: ["snippet", "authorDetails"],
});

for await (const batch of batches) {
  console.log(batch.items.length, "messages, resume at", batch.nextPageToken);
}
```

## Référence

### `LiveChat`

| Membre | Coût | Authentification | Ce qu'il fait |
| --- | --- | --- | --- |
| `yt.liveChatOf(video)` | 1 | Clé d'API | Ouvre le chat d'une vidéo en direct |
| `yt.liveChat(liveChatId)` | 0 | | Ouvre un chat à partir de son identifiant |
| `chat.id` | | | L'identifiant du chat en direct |
| `chat.messages(options)` | 5 par requête | Clé d'API | Produit les messages à mesure qu'ils arrivent |
| `chat.listen(onMessage, options)` | 5 par requête | Clé d'API | Pareil, avec une fonction de rappel. Renvoie `{ stop, done }` |
| `chat.send(text)` | 20 | OAuth | Envoie un message texte |
| `chat.delete(messageId)` | 20 | OAuth | Supprime un message |
| `chat.ban(channelId, { duration })` | 200 | OAuth | Bannit un utilisateur, définitivement ou pour `duration` |
| `chat.unban(banId)` | 200 | OAuth | Lève un bannissement |
| `chat.moderators()` | 50 par page | OAuth | Liste les modérateurs |
| `chat.addModerator(channelId)` | 200 | OAuth | Nomme un utilisateur modérateur |
| `chat.removeModerator(moderatorId)` | 200 | OAuth | Retire un modérateur |

En mode `"stream"`, `messages` et `listen` coûtent 5 unités par connexion.

`liveChatOf` et les méthodes à partir de `send` acceptent aussi les [options d'un appel](/basics/configuration/) comme dernier argument. `ban` les prend à côté de `duration`.

Les méthodes brutes sont aussi disponibles : `yt.liveChatMessages` (`list`, `insert`, `delete`, `stream`, et `transition`, qui clôt un sondage en cours pour 20 unités), `yt.liveChatBans`, `yt.liveChatModerators` et `yt.superChatEvents`.

### Valeurs de `snippet.type`

| Type | Détails dans | Ce qui s'est passé |
| --- | --- | --- |
| `textMessageEvent` | `textMessageDetails` | Un spectateur a écrit un message : `messageText` |
| `superChatEvent` | `superChatDetails` | Un Super Chat : `amountDisplayString`, `amountMicros`, `currency`, `tier`, `userComment` |
| `superStickerEvent` | `superStickerDetails` | Un Super Sticker : les mêmes champs de montant et `tier`, avec `superStickerMetadata` |
| `newSponsorEvent` | `newSponsorDetails` | Un spectateur est devenu membre : `memberLevelName`, `isUpgrade` |
| `memberMilestoneChatEvent` | `memberMilestoneChatDetails` | Le message d'étape d'un membre : `memberMonth`, `memberLevelName`, `userComment` |
| `membershipGiftingEvent` | `membershipGiftingDetails` | Un spectateur a acheté des abonnements en cadeau : `giftMembershipsCount`, `giftMembershipsLevelName` |
| `giftMembershipReceivedEvent` | `giftMembershipReceivedDetails` | Un spectateur a reçu un abonnement en cadeau : `memberLevelName`, `gifterChannelId`, `associatedMembershipGiftingMessageId` |
| `giftEvent` | `giftDetails` | Un cadeau virtuel envoyé pour soutenir le créateur |
| `pollEvent` | `pollDetails` | Un sondage : `status`, et `metadata` avec la question et les choix |
| `userBannedEvent` | `userBannedDetails` | Un modérateur a banni un utilisateur : `bannedUserDetails`, `banType`, `banDurationSeconds` |
| `messageDeletedEvent` | `messageDeletedDetails` | Un message a été supprimé. Les détails sont dépréciés |
| `messageRetractedEvent` | `messageRetractedDetails` | Un auteur a retiré un message. Les détails sont dépréciés |
| `sponsorOnlyModeStartedEvent` | | Le mode réservé aux membres a été activé |
| `sponsorOnlyModeEndedEvent` | | Le mode réservé aux membres a été désactivé |
| `chatEndedEvent` | | Le chat est terminé. Silencieux : pas de `displayMessage` |
| `tombstone` | | Silencieux : pas de `displayMessage` |
| `fanFundingEvent` | `fanFundingEventDetails` | Les détails sont dépréciés |
| `invalidType` | | Type de message non valide |

Champs de `snippet` toujours présents : `type`, `liveChatId`, `publishedAt`, `hasDisplayContent`. `authorChannelId` n'est pas toujours renseigné : lisez l'auteur dans `authorDetails`.

### `authorDetails`

`channelId`, `channelUrl`, `displayName`, `profileImageUrl`, et quatre indicateurs : `isChatOwner`, `isChatModerator`, `isChatSponsor`, `isVerified`. Tous sont toujours présents.

## Limites et erreurs

| Situation | Ce que vous obtenez |
| --- | --- |
| Une écriture avec une clé d'API seule | `YouTubeAuthError`, code `MISSING_CREDENTIALS`, levée avant tout envoi. Aucun quota dépensé |
| Une écriture avec un jeton dont on sait qu'il n'a ni `youtube` ni `youtube.force-ssl` | `YouTubeAuthError`, code `INSUFFICIENT_SCOPE`, levée avant tout envoi |
| `liveChatOf` sur une vidéo qui n'est pas en direct | `YouTubeArgumentError` |
| Le chat se termine ou est désactivé pendant la lecture | La boucle s'arrête, sans erreur |
| Quota épuisé | `YouTubeApiError`, code `QUOTA_EXCEEDED` |

Lister les modérateurs et l'historique des Super Chats accepte aussi le scope `youtube.readonly`.

Pour les autres appels, les valeurs de `error.reason` propres au chat sont `liveChatNotFound`, `liveChatEnded` et `liveChatDisabled`.

La modération coûte cher : un bannissement coûte 200 unités, donc 50 bannissements consomment une journée entière du quota par défaut. Comptez-les avant d'automatiser.

## Voir aussi

- [Diffusions et flux vidéo](/live/broadcasts/) pour créer la diffusion à laquelle le chat appartient.
- [Un bot pour le chat en direct](/recipes/live-chat-bot/) pour un programme complet.
- [Quota](/basics/quota/) pour suivre ce que dépense une longue session de lecture.
- [Erreurs](/basics/errors/) pour `error.code` et `error.reason`.
