---
title: Notifications push
description: Faites appeler votre serveur par le hub de YouTube quelques secondes après une publication, grâce à WebSub. Pas de clé d'API, pas de quota, pas d'interrogation. Il faut un point de terminaison HTTPS public.
sidebar:
  order: 2
---

```ts
import { websub } from "@ix-xs/youtube.api";

const secret = process.env.WEBSUB_SECRET;

// Une fois : demander au hub de notifier votre point de terminaison.
await websub.subscribe({
  channelId: "UC_x5XG1OV2P6uZZ5FSM9Ttw",
  callbackUrl: "https://example.com/youtube/webhook",
  secret,
});

// À chaque requête que le hub envoie à cette URL.
export async function handler(request: Request): Promise<Response> {
  const result = await websub.receive(request, { secret });

  for (const notification of result.notifications) {
    if (notification.type !== "video") continue;
    console.log("New or updated:", notification.title, notification.url);
  }
  return result.response;
}
```

## Fonctionnement

YouTube publie les nouvelles vidéos de chaque chaîne sur un hub WebSub public. Vous indiquez au hub la chaîne qui vous intéresse et l'adresse où vous appeler. Trois choses se passent alors sur votre point de terminaison :

1. Le hub envoie un `GET` pour confirmer que vous avez bien demandé l'abonnement. Vous répondez avec le code de vérification qu'il a envoyé.
2. À chaque changement, le hub envoie un `POST` avec un petit document Atom.
3. L'abonnement expire à la fin de sa durée de validité. Vous vous réabonnez avant.

`websub.receive()` s'occupe des deux premiers points. Rien ici ne touche à l'API YouTube Data : il n'y a pas de clé à fournir ni de quota à dépenser.

## S'abonner

```ts
await websub.subscribe({
  channelId,
  callbackUrl: "https://example.com/youtube/webhook",
  secret,
  lease: "5d",
});
```

| Option | Signification |
| --- | --- |
| `channelId` | La chaîne à suivre, sous forme d'identifiant `UC...` |
| `callbackUrl` | URL HTTPS publique de votre point de terminaison |
| `secret` | Secret partagé. Le hub signe chaque notification avec lui |
| `lease` | Durée de l'abonnement. `"5d"` par défaut. Le hub la plafonne à environ 10 jours |
| `signal` | Annule la requête vers le hub. Sinon, il n'y a pas de délai maximal |
| `fetch` | `fetch` personnalisé |

`subscribe` se résout quand le hub a accepté la requête. L'abonnement n'est pas encore actif : le hub appelle d'abord votre point de terminaison pour confirmer. Votre point de terminaison doit donc être en ligne avant que vous vous abonniez.

`channelId` doit être un identifiant. Toute autre valeur lève une `YouTubeArgumentError`. Résolvez d'abord le handle, ce qui coûte 1 unité de quota la première fois :

```ts
const id = await yt.channels.resolveId("@GoogleDevelopers");

if (id) {
  await websub.subscribe({
    channelId: id,
    callbackUrl: "https://example.com/youtube/webhook",
    secret,
  });
}
```

Pour arrêter, appelez `unsubscribe` avec la même chaîne et la même URL de rappel. Le hub le confirme aussi.

```ts
await websub.unsubscribe({
  channelId,
  callbackUrl: "https://example.com/youtube/webhook",
});
```

## Recevoir

Passez chaque requête qui arrive sur l'URL de rappel à `websub.receive()`, et renvoyez la `response` qu'elle vous donne. Toujours, quoi que vous fassiez d'autre du résultat.

```ts
const result = await websub.receive(request, { secret });

result.response; // à renvoyer au hub
result.notifications; // ce qui a changé, éventuellement rien
result.confirmation; // renseigné quand le hub confirmait un abonnement
result.verified; // false quand la requête a été rejetée
```

| Champ | Contenu |
| --- | --- |
| `response` | La réponse HTTP pour le hub. Elle porte le code de vérification pour une confirmation et le bon statut dans les autres cas |
| `notifications` | Les notifications de la requête. Vide pour une confirmation ou une requête rejetée |
| `confirmation` | `{ mode, topic, channelId, leaseSeconds }` quand la requête était une confirmation, sinon `undefined` |
| `verified` | `false` quand un secret était attendu et que la signature manquait ou était fausse, ou quand le corps était trop gros |

Répondez vite. Le hub n'attend que quelques secondes : renvoyez la réponse d'abord, et faites le travail lent ensuite.

### Dans un gestionnaire de style fetch

`receive` prend une `Request` standard et renvoie une `Response` standard : elle convient donc à tout environnement d'exécution construit dessus. Un gestionnaire de route Next.js :

```ts
// app/youtube/webhook/route.ts
import { websub } from "@ix-xs/youtube.api";

const secret = process.env.WEBSUB_SECRET;

async function handle(request: Request): Promise<Response> {
  const { response, notifications } = await websub.receive(request, { secret });

  for (const notification of notifications) {
    if (notification.type === "video") console.log(notification.title);
  }
  return response;
}

export { handle as GET, handle as POST };
```

Hono, où `c.req.raw` est la `Request` :

```ts
app.all("/youtube/webhook", async (c: { req: { raw: Request } }) => {
  const { response, notifications } = await websub.receive(c.req.raw, {
    secret,
  });
  for (const notification of notifications) console.log(notification);
  return response;
});
```

Un Cloudflare Worker, qui continue de s'exécuter après la réponse grâce à `waitUntil` :

```ts
import { websub, type WebSubNotification } from "@ix-xs/youtube.api";

interface Env {
  WEBSUB_SECRET: string;
}

interface Context {
  waitUntil(promise: Promise<unknown>): void;
}

async function handleAll(notifications: WebSubNotification[]): Promise<void> {
  for (const notification of notifications) {
    console.log(notification.type, notification.videoId);
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: Context): Promise<Response> {
    const { response, notifications } = await websub.receive(request, {
      secret: env.WEBSUB_SECRET,
    });
    ctx.waitUntil(handleAll(notifications));
    return response;
  },
};
```

### Avec `node:http` ou Express

`webSubListener()` enveloppe `receive` pour les objets requête et réponse de Node. Elle répond d'abord au hub, puis appelle vos gestionnaires.

```ts
import { createServer } from "node:http";
import { webSubListener } from "@ix-xs/youtube.api/node";

createServer(
  webSubListener({
    secret: process.env.WEBSUB_SECRET,
    onNotification: async (notification) => {
      if (notification.type !== "video") return;
      await notify(`${notification.title} ${notification.url}`);
    },
    onConfirmation: ({ mode, channelId, leaseSeconds }) => {
      console.log(mode, channelId, leaseSeconds);
    },
    onError: (error) => console.error("Handler failed:", error),
  }),
).listen(3000);
```

Dans Express, montez-la sur la route, pour toutes les méthodes :

```ts
import { webSubListener } from "@ix-xs/youtube.api/node";

app.all(
  "/youtube/webhook",
  webSubListener({
    secret: process.env.WEBSUB_SECRET,
    onNotification: (notification) => console.log(notification),
  }),
);
```

L'écouteur lit lui-même le corps de la requête, car la signature est calculée sur les octets exacts. Montez-le avant tout middleware qui consomme le corps de cette route.

| Option | Signification |
| --- | --- |
| `onNotification` | Obligatoire. Appelée pour chaque notification dont la signature est valide, l'une après l'autre |
| `onConfirmation` | Appelée quand le hub confirme un abonnement ou sa suppression |
| `onError` | Appelée quand un gestionnaire lève une erreur. Par défaut, écrit dans la console |
| `secret`, `confirm` | Les options de `receive` |

Sans `onNotification`, `webSubListener` lève une `YouTubeArgumentError`.

## Signatures

L'URL de rappel est publique. Quiconque la trouve peut lui envoyer une fausse notification. Définissez toujours un `secret`.

Avec un secret, le hub signe chaque notification dans un en-tête `X-Hub-Signature`, et `receive` le vérifie :

- Une notification sans signature valide est écartée. `notifications` est vide et `verified` vaut `false`.
- La réponse reste un statut de succès. La spécification WebSub le demande, pour qu'un faussaire n'apprenne rien.

Donnez le même secret à `subscribe` et à `receive`. Sans l'option `secret`, `receive` ne vérifie aucune signature.

```ts
const { response, notifications, verified } = await websub.receive(request, {
  secret,
});

if (!verified) console.warn("Dropped a request with a bad signature");
```

## Ne confirmer que ce que vous avez demandé

Par défaut, `receive` confirme tous les abonnements dont le hub s'enquiert. N'importe qui peut demander au hub d'abonner votre URL à une chaîne quelconque : limitez-la donc aux chaînes que vous suivez avec `confirm` :

```ts
const wanted = new Set(["UC_x5XG1OV2P6uZZ5FSM9Ttw"]);

const result = await websub.receive(request, {
  secret,
  confirm: ({ mode, channelId }) => {
    if (!channelId) return false;
    return mode === "subscribe" ? wanted.has(channelId) : !wanted.has(channelId);
  },
});
```

Ce code confirme l'abonnement à une chaîne que vous voulez, et la suppression d'une chaîne que vous ne voulez plus. La seconde moitié compte autant : elle empêche un inconnu de vous désabonner.

`confirm` reçoit `{ mode, topic, channelId }` et peut être asynchrone. Renvoyer `false` répond 404 au hub.

## Renouveler

Un abonnement s'achève avec sa durée de validité. La confirmation vous dit combien de temps le hub a accordé :

```ts
const { response, confirmation } = await websub.receive(request, { secret });

if (confirmation?.mode === "subscribe" && confirmation.channelId) {
  const expiresAt = Date.now() + (confirmation.leaseSeconds ?? 0) * 1000;
  await db.set(`lease:${confirmation.channelId}`, expiresAt);
}
```

Pour renouveler, appelez de nouveau `subscribe` avec les mêmes arguments avant la fin de la durée de validité. Avec la durée par défaut de 5 jours, une tâche quotidienne qui renouvelle tout suffit :

```ts
const followed: string[] = await db.get("channels");

for (const id of followed) {
  await websub.subscribe({
    channelId: id,
    callbackUrl: "https://example.com/youtube/webhook",
    secret,
  });
}
```

## Ce que contient une notification

```ts
const { notifications } = await websub.receive(request, { secret });

for (const notification of notifications) {
  if (notification.type === "video") {
    notification.videoId;
    notification.channelId;
    notification.title;
    notification.url;
    notification.author; // { name, url }
    notification.publishedAt; // date ISO 8601 de la mise en ligne publique de la vidéo
    notification.updatedAt; // date ISO 8601 de ce changement
  } else {
    notification.videoId;
    notification.channelId; // string | undefined
    notification.deletedAt; // string | undefined
  }
}
```

| `type` | Signification |
| --- | --- |
| `"video"` | Une vidéo a été publiée, ou son titre ou sa description a changé. YouTube ne précise pas lequel |
| `"deleted"` | Une vidéo a été supprimée ou passée en privé |

### Distinguer une nouvelle vidéo d'une modification

La même vidéo vous parvient plusieurs fois : une fois à sa publication, puis à chaque changement de titre ou de description, et le hub peut livrer la même notification plus d'une fois. Retenez les identifiants que vous avez déjà traités :

```ts
const { response, notifications } = await websub.receive(request, { secret });

for (const notification of notifications) {
  if (notification.type !== "video") continue;
  const isNew = await redis.set(`seen:${notification.videoId}`, "1", "NX");
  if (isNew) await notify(`New video: ${notification.title} ${notification.url}`);
}
```

Une notification contient peu de choses. Pour la durée, les statistiques ou l'état de confidentialité, récupérez la vidéo avec `yt.videos.get(videoId)`, pour 1 unité.

## Référence

| Membre | Ce qu'il fait |
| --- | --- |
| `websub.subscribe(options)` | Demande au hub de notifier votre URL de rappel. L'appeler de nouveau renouvelle l'abonnement |
| `websub.unsubscribe(options)` | Demande au hub d'arrêter |
| `websub.receive(request, options)` | Traite une requête du hub : confirmations, signatures, analyse |
| `websub.parse(xml)` | Analyse le corps Atom d'une notification |
| `websub.verify(body, header, secret)` | Vérifie un en-tête `X-Hub-Signature` avec votre secret. Renvoie un booléen |
| `websub.topicUrl(channelId)` | L'URL de sujet qui identifie une chaîne auprès du hub : `https://www.youtube.com/xml/feeds/videos.xml?channel_id=...` |
| `websub.hub` | Adresse du hub : `https://pubsubhubbub.appspot.com/subscribe` |
| `webSubListener(options)` | Équivalent de `receive`, pour `node:http` et Express. Vient de `@ix-xs/youtube.api/node` |

`parse` et `verify` servent quand un framework vous donne le corps sous forme de texte et non de `Request`. `verify` accepte le corps sous forme de chaîne ou d'octets, et le veut exactement tel qu'il a été reçu.

### Comment `receive` répond

| Requête | Statut | Résultat |
| --- | --- | --- |
| `GET` avec une confirmation valide | 200, le code de vérification comme corps | `confirmation` est renseignée |
| `GET` refusée par `confirm` | 404 | |
| `GET` qui n'est pas une confirmation | 400 | |
| `POST` avec une signature valide, ou sans secret attendu | 204 | `notifications` est remplie |
| `POST` avec une signature absente ou fausse | 202 | `verified` vaut `false` |
| `POST` avec un corps de plus de 1 Mio | 413 | `verified` vaut `false` |
| Toute autre méthode | 405 | |

## Limites et erreurs

- `subscribe` et `unsubscribe` lèvent une `YouTubeRequestError`. Le code est `NETWORK` quand le hub est injoignable, `HUB_ERROR` quand le hub refuse et répond par un statut d'erreur, et `ABORTED` quand votre `signal` a été annulé. Le message d'une `HUB_ERROR` contient le statut et le début de la réponse du hub.
- `receive` lit le corps jusqu'à 1 Mio, compté en octets. Au-delà, elle arrête la lecture, ne garde plus rien en mémoire et répond 413. `webSubListener` fait de même. Une notification pèse quelques kilo-octets.
- Le hub a besoin d'une URL publique. En développement local, exposez votre machine par un tunnel et abonnez-vous avec l'URL du tunnel.
- Une durée de validité écoulée arrête les notifications sans aucune erreur de votre côté. Stockez la date d'expiration et renouvelez.
- Les notifications ne concernent que les vidéos : publiées, titre ou description modifiés, supprimées ou passées en privé.

## Voir aussi

- [Surveiller les nouvelles vidéos](/notifications/watching-uploads/) quand vous n'avez pas de point de terminaison public.
- [Flux et oEmbed](/notifications/feeds-and-oembed/) pour lire les mêmes données à la demande.
- [Chaînes](/resources/channels/) pour `resolveId` et les autres façons de désigner une chaîne.
- [Environnements d'exécution](/reference/runtimes/) pour savoir où les raccourcis Node sont disponibles.
