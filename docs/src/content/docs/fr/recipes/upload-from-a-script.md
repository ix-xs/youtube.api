---
title: Mettre en ligne depuis un script
description: "Un script en ligne de commande qui envoie un fichier vidéo avec un affichage de la progression, définit sa miniature et l'ajoute à une playlist. Un envoi interrompu reprend là où il s'était arrêté."
sidebar:
  order: 2
---

## Ce que vous obtenez

Une commande qui vous connecte par le navigateur la première fois, puis envoie un fichier sur votre chaîne comme vidéo privée. Si la connexion tombe ou si vous arrêtez le script, relancer la même commande reprend l'envoi au lieu de le recommencer.

## Ce qu'il faut

| | |
| --- | --- |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Un client OAuth de type **Desktop app**, voir [Identifiants d'accès](/start/credentials/) |
| Un navigateur sur la même machine | Pour la page de consentement, au premier lancement seulement. Sans navigateur, utilisez le flux pour appareils de [Scripts et appareils](/auth/scripts-and-devices/) |

Quota par exécution :

| Étape | Coût |
| --- | --- |
| `yt.videos.insert` | 1 appel de l'enveloppe `videos.insert`, qui en compte 100 par jour par défaut |
| `yt.thumbnails.set`, avec `--thumbnail` | 50 unités |
| `yt.playlists.add`, avec `--playlist` | 50 unités |

:::caution
Les vidéos envoyées par un projet d'API non vérifié sont verrouillées en privé tant que le projet n'a pas passé un audit. L'envoi lui-même fonctionne et la vidéo reste privée. La [FAQ](/help/faq/#how-do-i-get-more-quota) renvoie au formulaire qui demande l'audit.
:::

## Le programme

```ts title="upload.ts"
import { rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { parseArgs } from "node:util";
import {
  OAuth2,
  VideoCategories,
  YouTube,
  YouTubeUploadError,
  urls,
} from "@ix-xs/youtube.api";
import { authorize, fileMedia, tokenFile } from "@ix-xs/youtube.api/node";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    title: { type: "string" },
    description: { type: "string", default: "" },
    thumbnail: { type: "string" },
    playlist: { type: "string" },
    restart: { type: "boolean", default: false },
  },
});
const [path] = positionals;
const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
if (!path || !clientId || !clientSecret) {
  console.error("Usage: upload.ts <video file> [options]");
  console.error("  --title <text>  --description <text>  --thumbnail <image>");
  console.error("  --playlist <id or URL>  --restart");
  console.error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set.");
  process.exit(1);
}

// 1. Connexion. Le navigateur s'ouvre au premier lancement, ensuite le fichier contient les jetons.
const SCOPE = "youtube";
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

// 2. Envoi. La session d'un lancement interrompu est gardée à côté de la vidéo.
const sessionFile = `${path}.upload-session`;
const resumeUri = values.restart
  ? undefined
  : await readFile(sessionFile, "utf8").catch(() => undefined);
let savedUri = resumeUri;
const megabytes = (bytes: number) => (bytes / 1_048_576).toFixed(1);
const verb = resumeUri ? "Resuming" : "Uploading";

const media = await fileMedia(path, {
  resumeUri,
  onProgress: ({ uploaded, total, percent, sessionUri }) => {
    if (sessionUri && sessionUri !== savedUri) {
      writeFileSync(sessionFile, (savedUri = sessionUri));
    }
    const done = (percent ?? 0).toFixed(1).padStart(5);
    const size = `${megabytes(uploaded)} of ${megabytes(total ?? 0)} MB`;
    process.stdout.write(`\r${verb} ${done}%  ${size}`);
  },
});

function explain(error: unknown): never {
  if (!(error instanceof YouTubeUploadError)) throw error;
  console.error(`\n${error.message}`);
  if (error.sessionUri) {
    console.error(`${megabytes(error.uploaded)} MB are stored on YouTube.`);
    console.error("Run the same command again to resume.");
  } else {
    // Rien à reprendre : aucune session n'a été ouverte, ou la session a expiré.
    rmSync(sessionFile, { force: true });
    console.error("Run the same command again to start over.");
  }
  process.exit(1);
}

const video = await yt.videos
  .insert({
    body: {
      snippet: {
        title: values.title ?? basename(path),
        description: values.description,
        categoryId: VideoCategories.PeopleAndBlogs,
      },
      // D'abord en privé : vérifiez le résultat dans YouTube Studio, puis publiez.
      status: { privacyStatus: "private", selfDeclaredMadeForKids: false },
    },
    media,
  })
  .catch(explain);

rmSync(sessionFile, { force: true });
console.log(`\nUploaded: ${urls.video(video.id)}`);

// 3. Miniature et playlist.
if (values.thumbnail) {
  const cover = await fileMedia(values.thumbnail);
  await yt.thumbnails.set({ videoId: video.id, media: cover });
  console.log("Thumbnail set.");
}
if (values.playlist) {
  await yt.playlists.add(values.playlist, video.id);
  console.log("Added to the playlist.");
}

const uploads = yt.quota.usage["videos.insert"] ?? 0;
console.log(`Spent: ${uploads} upload call, ${yt.quota.used} units.`);
```

## Lancer le script

```bash
npm install @ix-xs/youtube.api

export GOOGLE_CLIENT_ID=...
export GOOGLE_CLIENT_SECRET=...
node upload.ts ./holiday.mp4 --title "Holiday 2026" \
  --thumbnail ./cover.png --playlist PLBCF2DAC6FFB574DE
```

Node.js 22.18 et les versions suivantes exécutent directement un fichier `.ts`. Sur une version plus ancienne, utilisez `npx tsx upload.ts` avec les mêmes arguments.

Le premier lancement affiche une URL de consentement et l'ouvre. Une fois que vous avez accepté, les jetons sont écrits dans `./tokens.json` et les lancements suivants passent directement à l'envoi. Gardez ce fichier hors du contrôle de version : il donne accès à la chaîne.

Pour voir la reprise à l'œuvre, arrêtez le script avec Ctrl+C au milieu d'un gros fichier, puis relancez la même commande.

## Comment ça marche

**Le scope.** `youtube.upload` suffit pour envoyer une vidéo et définir sa miniature. `playlistItems.insert`, qui ajoute une vidéo à une playlist, ne l'accepte pas. Le script demande donc `youtube`, que les trois appels acceptent. Le test sur `grantedScopes` vous renvoie vers le consentement quand `tokens.json` a été écrit par un script qui demandait moins.

**`fileMedia(path)`** ouvre le fichier sans le lire en mémoire et déduit le type MIME de l'extension. Un fichier de 5 Mio ou moins part en une seule requête. Au-delà, il passe par une session avec reprise, par morceaux de 8 Mio, et chaque morceau confirmé appelle `onProgress`.

**L'enregistrement de la session.** Pour un envoi par morceaux, `onProgress` reçoit le `sessionUri` de la session. Le script l'écrit dans `<video>.upload-session` dès qu'il apparaît, par une écriture synchrone, pour que le fichier existe même si le processus meurt juste après. Au lancement suivant, cette URI est passée en `resumeUri` : la bibliothèque demande à YouTube combien d'octets il détient et envoie le reste. Le titre et les autres métadonnées ont été donnés à l'ouverture de la session et ne sont pas renvoyés, donc `--title` n'a aucun effet sur un lancement qui reprend.

**Quand l'envoi échoue.** Un morceau qui échoue sur une erreur réseau ou une erreur du serveur fait l'objet d'une nouvelle tentative après une pause croissante, trois fois par défaut. Ensuite, `yt.videos.insert` lève une `YouTubeUploadError` qui porte le `sessionUri` et, dans `uploaded`, le nombre d'octets que YouTube a confirmés. Une session reste valide environ une semaine. Une fois expirée, l'erreur est toujours une `YouTubeUploadError`, et son `sessionUri` vaut `undefined` : le script supprime celui qu'il avait enregistré, et le lancement suivant repart du premier octet. `--restart` fait de même à la demande, quand vous voulez renvoyer le fichier depuis le début.

**Les autres erreurs repartent telles quelles.** Un refus de l'API, comme une enveloppe d'envoi épuisée ou un titre rejeté, est une `YouTubeApiError`. `explain` la laisse passer avec sa pile d'appels.

**`.catch(explain)`.** `explain` ne revient jamais, donc `video` garde le type d'une vidéo créée et `video.id` est un `string`.

**Trois appels séparés.** L'envoi, la miniature et la playlist sont indépendants. Si l'étape de la miniature échoue, la vidéo est déjà sur la chaîne. Ne relancez pas la commande, ce qui enverrait une seconde copie : définissez la miniature à la main ou avec un appel d'une ligne à `yt.thumbnails.set`.

**L'option `timeout` du client ne s'applique pas aux envois.** Un gros fichier peut prendre le temps qu'il lui faut.

## Aller plus loin

### Programmer la publication

Une vidéo privée peut porter la date à laquelle elle devient publique :

```ts
import { fileMedia } from "@ix-xs/youtube.api/node";

await yt.videos.insert({
  body: {
    snippet: {
      title: "Holiday 2026",
      categoryId: VideoCategories.TravelAndEvents,
    },
    status: {
      privacyStatus: "private",
      publishAt: "2026-12-24T17:00:00Z",
      selfDeclaredMadeForKids: false,
    },
  },
  media: await fileMedia("./holiday.mp4"),
});
```

### Envoyer sans prévenir les abonnés

`notifySubscribers` est un paramètre de l'appel, à côté de `body` et de `media`. Il vaut `true` par défaut.

```ts
import { fileMedia } from "@ix-xs/youtube.api/node";

await yt.videos.insert({
  notifySubscribers: false,
  body: {
    snippet: { title: "Test upload" },
    status: { privacyStatus: "private" },
  },
  media: await fileMedia("./test.mp4"),
});
```

### Ajouter des sous-titres

`yt.captions.insert` prend de la même façon un fichier `.srt` ou `.vtt`, pour 400 unités. Voir [Sous-titres](/resources/captions/).

### Pour en savoir plus

- [Envois](/resources/uploads/) pour toutes les options de `media`, les flux et les envois depuis le navigateur.
- [Vidéos](/resources/videos/#updating-a-video) pour modifier ensuite le titre ou la confidentialité.
- [Scripts et appareils](/auth/scripts-and-devices/) pour une machine sans navigateur.
