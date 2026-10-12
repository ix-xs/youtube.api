---
title: Bot de chat en direct
description: "Un bot pour votre propre diffusion en direct qui répond à des commandes, remercie les Super Chats et exclut temporairement les messages contenant des mots interdits. Il lit le chat par interrogation : le quota quotidien décide donc combien de temps il peut tourner."
sidebar:
  order: 5
---

## Ce que vous obtenez

Un processus qui reste dans le chat d'une diffusion, répond à `!uptime` et à `!discord`, remercie chaque Super Chat et bannit pendant cinq minutes quiconque poste un mot de votre liste. Il s'arrête de lui-même quand la diffusion se termine, ou avec Ctrl+C.

## Ce qu'il faut

| | |
| --- | --- |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Un client OAuth de type **Desktop app**, voir [Identifiants d'accès](/start/credentials/) |
| Le compte avec lequel vous vous connectez | La chaîne propriétaire de la diffusion, ou l'un de ses modérateurs de chat. C'est ce compte qui parle dans le chat |
| `BANNED_WORDS` | Facultatif. Des mots séparés par des virgules, qui valent une exclusion temporaire |
| `DISCORD_INVITE` | Facultatif. Le lien que `!discord` donne en réponse |

Quota, entièrement puisé dans le budget commun, de 10 000 unités par jour par défaut :

| Action | Coût |
| --- | --- |
| Démarrage : `channels.mine`, `liveChatOf`, `videos.get` | 3 unités |
| Chaque lecture du chat | 5 unités |
| Chaque message envoyé | 20 unités |
| Chaque bannissement | 200 unités |

Ce sont les lectures qui s'additionnent. À une lecture toutes les 10 secondes, comme réglé plus bas, une heure coûte 1 800 unités avant même que le bot dise quoi que ce soit : l'allocation par défaut couvre environ cinq heures et demie de diffusion par jour, moins chaque réponse et chaque bannissement. Une réponse coûte autant que quatre lectures, un bannissement autant que quarante. `minInterval` est le levier : avec `"30s"`, une heure de lecture tombe à 600 unités.

## Le programme

```ts title="chat-bot.ts"
import {
  OAuth2,
  YouTube,
  formatDuration,
  isYouTubeError,
  type ChatMessage,
} from "@ix-xs/youtube.api";
import { authorize, tokenFile } from "@ix-xs/youtube.api/node";

const video = process.argv[2];
const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
if (!video || !clientId || !clientSecret) {
  console.error("Usage: chat-bot.ts <URL or id of the live video>");
  console.error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set.");
  process.exit(1);
}

const DISCORD_INVITE =
  process.env.DISCORD_INVITE ?? "https://example.com/invite";
const BANNED_WORDS = (process.env.BANNED_WORDS ?? "")
  .split(",")
  .map((word) => word.trim().toLowerCase())
  .filter(Boolean);
const COOLDOWN = 30_000;

// 1. Connexion. Le navigateur s'ouvre au premier lancement, ensuite le fichier contient les jetons.
const SCOPE = "youtube.force-ssl";
const store = tokenFile("./tokens.json");
const oauth = new OAuth2({
  clientId,
  clientSecret,
  tokens: await store.load(),
  onTokens: store.save,
});
if (!oauth.canRefresh || !oauth.grantedScopes?.has(SCOPE)) {
  await authorize(oauth, { scopes: [SCOPE] });
}
const yt = new YouTube({ oauth });

// 2. Qui est le bot, quel chat il rejoint, et quand la diffusion a commencé.
const me = await yt.channels.mine({ part: "snippet" });
if (!me) {
  console.error("This Google account has no YouTube channel.");
  process.exit(1);
}
const chat = await yt.liveChatOf(video);
const live = await yt.videos.get(video, { part: "liveStreamingDetails" });
const startedAt =
  Date.parse(live?.liveStreamingDetails?.actualStartTime ?? "") || Date.now();

// 3. Ce qu'il répond.
const uptime = () => formatDuration((Date.now() - startedAt) / 1000, "short");
const commands: Record<string, () => string> = {
  "!uptime": () => `Live for ${uptime()}.`,
  "!discord": () => `Join the Discord: ${DISCORD_INVITE}`,
};
const lastUsed = new Map<string, number>();

async function handle(message: ChatMessage): Promise<void> {
  const { snippet, authorDetails: author } = message;

  if (snippet.type === "superChatEvent") {
    const amount = snippet.superChatDetails?.amountDisplayString;
    const gift = amount ?? "the Super Chat";
    await chat.send(`Thank you ${author.displayName} for ${gift}!`);
    return;
  }
  if (snippet.type !== "textMessageEvent") return;

  const raw = snippet.textMessageDetails?.messageText ?? snippet.displayMessage;
  const text = (raw ?? "").trim().toLowerCase();
  const staff = author.isChatOwner || author.isChatModerator;

  if (!staff && BANNED_WORDS.some((word) => text.includes(word))) {
    await chat.ban(author.channelId, { duration: "5m" });
    console.log(`Timed out ${author.displayName} for 5 minutes.`);
    return;
  }

  const name = text.split(/\s+/)[0] ?? "";
  const reply = commands[name];
  if (!reply) return;
  if (Date.now() - (lastUsed.get(name) ?? 0) < COOLDOWN) return;
  lastUsed.set(name, Date.now());
  await chat.send(reply());
}

// 4. Lire jusqu'à la fin de la diffusion ou jusqu'à Ctrl+C.
const stop = new AbortController();
process.once("SIGINT", () => stop.abort());
process.once("SIGTERM", () => stop.abort());

console.log(`${me.snippet.title} joined the chat. Ctrl+C to stop.`);

const messages = chat.messages({ signal: stop.signal, minInterval: "10s" });
for await (const message of messages) {
  if (message.authorDetails.channelId === me.id) continue; // ses propres messages
  try {
    await handle(message);
  } catch (error) {
    const code = isYouTubeError(error) ? error.code : undefined;
    if (code === "QUOTA_EXCEEDED" || code === "QUOTA_BUDGET_EXCEEDED") {
      console.error(`Out of quota until ${yt.quota.resetsAt.toISOString()}.`);
      break;
    }
    const reason = error instanceof Error ? error.message : error;
    console.warn("Could not handle a message:", reason);
  }
}

console.log(`Chat closed. Quota spent: ${yt.quota.used} units.`);
```

## Lancer le script

```bash
npm install @ix-xs/youtube.api

export GOOGLE_CLIENT_ID=...
export GOOGLE_CLIENT_SECRET=...
export BANNED_WORDS="spam.example,free followers"
node chat-bot.ts https://www.youtube.com/watch?v=jfKfPfyJRdk
```

Node.js 22.18 et les versions suivantes exécutent directement un fichier `.ts`. Sur une version plus ancienne, utilisez `npx tsx chat-bot.ts` avec le même argument.

Lancez-le une fois la diffusion en cours : `liveChatOf` lève une erreur quand la vidéo n'a pas de chat actif. Le premier lancement ouvre la page de consentement. Connectez-vous avec le compte au nom duquel le bot doit parler.

## Comment ça marche

**Le scope.** `youtube.force-ssl` est accepté par tous les appels du bot : lecture de la chaîne et de la vidéo, lecture du chat, envoi de messages et bannissement. `youtube` conviendrait aussi.

**`yt.liveChatOf(video)`** lit la vidéo une fois pour trouver l'identifiant de son chat, et renvoie l'objet qui le lit, y écrit et le modère. Le script récupère la vidéo une seconde fois pour `liveStreamingDetails.actualStartTime`, dont `!uptime` a besoin. Quand ce champ manque, le bot compte à partir de son propre démarrage.

**`chat.messages()`** est la boucle d'interrogation. Elle ne produit que les messages postés après le démarrage du bot, attend entre deux lectures aussi longtemps que YouTube le demande, et jamais moins que `minInterval`. Chaque lecture reprend au jeton de page de la précédente et demande jusqu'à 2 000 messages : un intervalle plus long livre donc les mêmes messages plus tard, par lots plus gros. `minInterval` est aussi, de ce fait, le temps d'attente maximal d'un spectateur avant une réponse.

**Ignorer ses propres messages.** Les réponses du bot reviennent par le chat comme n'importe quel autre message. Comparer `authorDetails.channelId` à l'identifiant de la chaîne connectée les écarte. Sans ce test, une réponse qui commence par le nom d'une commande déclencherait de nouveau le bot.

**Les Super Chats** arrivent dans le même flux avec `snippet.type === "superChatEvent"`. `superChatDetails.amountDisplayString` est le montant sous forme de chaîne à afficher. Il est facultatif dans le type, d'où le texte de repli.

**Le délai entre deux usages est propre à chaque commande**, pas par spectateur. Vingt personnes qui écrivent `!discord` dans la même demi-minute obtiennent une seule réponse, soit 20 unités au lieu de 400.

**L'exclusion temporaire.** `chat.ban` avec une `duration` est un bannissement temporaire. Sans `duration`, il est définitif. Le propriétaire et les modérateurs sont exemptés ici, si bien qu'un modérateur peut citer un mot interdit. La détection est un simple test de sous-chaîne sur le texte en minuscules : adaptez-la avant de lui confier un vrai public.

**L'arrêt.** Interrompre le signal termine le `for await` sans erreur, et la dernière ligne s'exécute quand même. La boucle se termine aussi d'elle-même quand la diffusion passe hors ligne ou que le chat est fermé.

**Un mauvais message n'arrête pas le bot.** Une réponse ou un bannissement qui échoue est consigné et la boucle continue. Un quota épuisé fait exception : tous les appels suivants échoueraient de la même manière jusqu'à la réinitialisation, le bot s'en va donc.

**Une lecture qui échoue, elle, l'arrête.** Quand `chat.messages()` lui-même ne peut pas lire le chat, après les nouvelles tentatives du client, l'erreur est levée hors du `for await` et le processus se termine avec elle. C'est le bon comportement pour des identifiants refusés ou un quota épuisé. Lancez le bot sous un superviseur si vous voulez qu'il revienne après une panne de réseau.

## Aller plus loin

### Supprimer aussi le message

Pour supprimer aussi le message fautif, `chat.delete` prend son identifiant. Cela coûte 20 unités :

```ts
const chat = await yt.liveChatOf(videoId);

for await (const message of chat.messages()) {
  if (message.snippet.displayMessage?.includes("spam.example")) {
    await chat.delete(message.id);
    await chat.ban(message.authorDetails.channelId, { duration: "5m" });
  }
}
```

### Plafonner ce que le bot peut dépenser

Donnez un budget au client : il refuse l'appel qui le dépasserait, avant de l'envoyer. Le reste du quota de la journée reste disponible pour vos autres outils.

```ts
import { YouTube } from "@ix-xs/youtube.api";

const yt = new YouTube({
  oauth,
  quota: { enforce: true, limits: { default: 6000 } },
});
```

L'appel refusé lève une erreur `QUOTA_BUDGET_EXCEEDED`. La boucle ci-dessus la traite comme un quota épuisé : le bot s'en va à la première réponse ou au premier bannissement qui ne tient pas dans le budget. Une lecture qui ne tient pas lève la même erreur hors du `for await`.

### Lire sans se connecter

Un bot qui se contente d'observer, pour consigner les Super Chats ou compter les messages, n'a pas besoin d'OAuth : la lecture fonctionne avec une clé d'API. Supprimez la connexion, la recherche de `me`, et les appels à `chat.send` et `chat.ban`.

### Pour en savoir plus

- [Chat en direct](/live/live-chat/) pour tous les types de message, les modérateurs et la forme à rappel `chat.listen`.
- [Quota](/basics/quota/) pour suivre la dépense pendant que le bot tourne.
- [Scripts et appareils](/auth/scripts-and-devices/) pour l'exécuter sur une machine sans navigateur.
