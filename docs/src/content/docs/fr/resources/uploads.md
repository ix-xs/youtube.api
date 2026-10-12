---
title: Envois
description: Envoyez une vidéo depuis un fichier, un Blob ou un flux, avec progression, nouvelles tentatives et reprise. Le même paramètre media envoie miniatures, bannières, images de playlist, filigranes et fichiers de sous-titres.
sidebar:
  order: 8
---

```ts
import { fileMedia } from "@ix-xs/youtube.api/node";

const video = await yt.videos.insert({
  body: {
    snippet: {
      title: "Holiday 2026",
      description: "Uploaded from code",
      categoryId: "22",
    },
    status: { privacyStatus: "private", selfDeclaredMadeForKids: false },
  },
  media: await fileMedia("./holiday.mp4", {
    onProgress: ({ percent }) => console.log(`${percent}%`),
  }),
});

console.log(`https://youtu.be/${video.id}`);
```

`videos.insert` coûte 1 appel de sa propre enveloppe de quota, qui contient 100 appels par jour par défaut. Elle exige OAuth avec l'un des scopes `youtube.upload`, `youtube`, `youtube.force-ssl` ou `youtubepartner`. La page [Scripts et appareils](/auth/scripts-and-devices/) montre comment un script obtient ces jetons.

:::caution
Les vidéos envoyées par un projet d'API non vérifié sont verrouillées en privé tant que le projet n'a pas passé un audit. Définir `privacyStatus: "public"` n'y change rien.
:::

## Décrire la vidéo

`body` est la ressource vidéo : n'importe quel sous-ensemble, vérifié par le compilateur. `part` est optionnel et prend par défaut les parties présentes dans `body`.

```ts
const video = await yt.videos.insert({
  body: {
    snippet: {
      title: "Holiday 2026",
      description: "Two weeks on the coast.",
      tags: ["travel", "coast"],
      categoryId: VideoCategories.TravelAndEvents,
    },
    status: {
      privacyStatus: "private",
      // Publication programmée. Valable seulement sur une vidéo privée.
      publishAt: "2026-12-01T15:00:00Z",
      selfDeclaredMadeForKids: false,
    },
  },
  media: file,
  notifySubscribers: false,
});
```

Les paramètres à côté de `body` et de `media` :

| Paramètre | Par défaut | Signification |
| --- | --- | --- |
| `notifySubscribers` | `true` | Prévenir les abonnés de la chaîne de la nouvelle vidéo |
| `autoLevels` | | Appliquer l'ajustement automatique des niveaux à l'envoi |
| `stabilize` | | Appliquer la stabilisation à l'envoi |
| `part` | Parties de `body` | Parties que la requête écrit et que la réponse renvoie |
| `onBehalfOfContentOwner`, `onBehalfOfContentOwnerChannel` | | Pour les partenaires de contenu YouTube uniquement |

Sans `part`, le résultat a un `id` connu et toutes les parties sont optionnelles. Avec un `part` explicite, le type est réduit comme dans n'importe quel autre appel :

```ts
const video = await yt.videos.insert({
  part: ["snippet", "status"],
  body: {
    snippet: { title: "Holiday 2026" },
    status: { privacyStatus: "private" },
  },
  media: file,
});

video.status.uploadStatus; // typé, car status a été demandé
```

## Choisir le média

`media` accepte les octets sous la forme où vous les avez.

| Forme | Taille connue | Type MIME si vous n'en donnez pas |
| --- | --- | --- |
| Un `File` ou un `Blob` | Oui | Son `type`, ou `application/octet-stream` s'il est vide |
| Un `Uint8Array` ou un `ArrayBuffer` | Oui | `application/octet-stream` |
| Un `ReadableStream` ou un itérable asynchrone de morceaux d'octets | Non | `application/octet-stream` |
| Une chaîne de caractères | Oui | `text/plain; charset=UTF-8`. Elle est envoyée comme du texte UTF-8, ce qui convient aux fichiers de sous-titres |
| `{ body, ...options }` | Celle de son `body` | Celui de son `body` |

La forme objet enveloppe toutes les autres et ajoute des options :

```ts
await yt.videos.insert({
  body: {
    snippet: { title: "Holiday 2026" },
    status: { privacyStatus: "private" },
  },
  media: {
    body: file,
    mimeType: "video/mp4",
    chunkSize: 16 * 1024 * 1024,
    onProgress: ({ uploaded, total }) => console.log(uploaded, "of", total),
  },
});
```

Un flux sert pour des octets qui ne sont pas sur le disque, comme un téléchargement que vous retransmettez. Il est lu une seule fois, dans l'ordre, et jamais conservé en entier en mémoire :

```ts
const source = await fetch("https://example.com/exports/holiday.mp4");

await yt.videos.insert({
  body: {
    snippet: { title: "Holiday 2026" },
    status: { privacyStatus: "private" },
  },
  media: {
    body: source.body!,
    mimeType: "video/mp4",
    size: Number(source.headers.get("content-length")) || undefined,
  },
});
```

`size` ne vaut que pour les flux, et seulement pour que la progression affiche un pourcentage. Le flux est lu jusqu'à sa fin, quel que soit ce nombre.

## Envoyer un fichier du disque

`fileMedia()`, de `@ix-xs/youtube.api/node`, ouvre un fichier comme un `Blob` sans le lire en mémoire. Elle renvoie la forme objet de `media`.

```ts
import { fileMedia } from "@ix-xs/youtube.api/node";

const media = await fileMedia("./holiday.mp4");
const tuned = await fileMedia("./holiday.bin", {
  mimeType: "video/mp4",
  chunkSize: 32 * 1024 * 1024,
});
```

Le type MIME vient de l'extension, sauf si vous passez `mimeType` :

| Extensions | Type MIME |
| --- | --- |
| `.mp4`, `.m4v`, `.mov`, `.webm`, `.mkv`, `.avi`, `.wmv`, `.flv`, `.mpg`, `.mpeg`, `.3gp` | Le type `video/...` correspondant |
| `.jpg`, `.jpeg`, `.png` | `image/jpeg`, `image/png` |
| `.srt`, `.vtt`, `.ttml`, `.sbv` | `application/x-subrip`, `text/vtt`, `application/ttml+xml`, `text/plain` |
| Toute autre | `application/octet-stream` |

Elle accepte aussi `chunkSize`, `resumeUri` et `onProgress`, décrits plus bas.

## Ce qui se passe en coulisses

Avant l'envoi du moindre octet, le média est vérifié par rapport à ce que la méthode accepte. Un type MIME que la méthode refuse, ou une taille connue nulle ou supérieure à la limite, lève une `YouTubeArgumentError`. Aucun quota n'est dépensé. Un flux n'a pas de taille connue, donc les vérifications de taille ne s'y appliquent pas : voir [Erreurs](#errors).

Ensuite, l'un des deux cas suivants se produit :

- **Une seule requête**, quand la taille est connue et ne dépasse pas 5 Mio. Les métadonnées et les octets partent ensemble.
- **Une session avec reprise** dans les autres cas, ce qui est toujours le cas pour un flux. Le client ouvre une session avec les métadonnées, puis envoie les octets par morceaux. Le serveur confirme chaque morceau avant que le suivant parte.

Un morceau fait 8 Mio par défaut. `chunkSize` le modifie. La valeur est arrondie à un multiple de 256 Kio, avec 256 Kio au minimum. Un seul morceau est en mémoire à la fois : un fichier de 40 Gio s'envoie donc avec la mémoire d'un seul morceau.

Un morceau plus grand veut dire moins de requêtes. Un morceau plus petit donne une progression plus fine et moins à renvoyer après un échec.

## Afficher la progression

`onProgress` est appelée à l'ouverture de la session et après chaque morceau confirmé. Un envoi en une seule requête l'appelle une fois, quand il est terminé.

```ts
const megabytes = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);

await yt.videos.insert({
  body: {
    snippet: { title: "Holiday 2026" },
    status: { privacyStatus: "private" },
  },
  media: await fileMedia("./holiday.mp4", {
    onProgress: ({ uploaded, total, percent }) => {
      const done = `${megabytes(uploaded)} / ${megabytes(total ?? 0)} MiB`;
      process.stdout.write(`\r${done} (${percent ?? 0}%)`);
    },
  }),
});
```

| Champ | Type | Signification |
| --- | --- | --- |
| `uploaded` | `number` | Octets confirmés par le serveur |
| `total` | `number \| undefined` | Taille totale en octets, quand elle est connue. Pour un flux, le `size` que vous avez déclaré |
| `percent` | `number \| undefined` | De 0 à 100 avec une décimale, quand le total est connu |
| `sessionUri` | `string \| undefined` | La session avec reprise. `undefined` pour un envoi en une seule requête |

La progression compte les octets confirmés, pas les octets envoyés. Avec le morceau par défaut, un fichier de 20 Mio signale quatre fois : une fois à 0, puis après chacun de ses trois morceaux. Réduisez `chunkSize` pour une barre plus fluide.

## Nouvelles tentatives, délais et annulation

Dans une session avec reprise, une panne réseau ou une erreur du serveur sur un morceau n'est pas fatale. Le client attend, demande au serveur combien d'octets il détient, et reprend à partir de là. L'attente s'allonge à chaque échec consécutif, selon la [politique de nouvelles tentatives](/basics/configuration/) du client. Un morceau confirmé remet le compte à zéro.

L'envoi abandonne après plus d'échecs consécutifs que `retry.attempts` n'en autorise, 3 par défaut. Il lève alors une `YouTubeUploadError`. Passez `retry` dans les options de la requête pour changer la politique d'un envoi :

```ts
await yt.videos.insert(
  { body: { snippet: { title: "Holiday 2026" } }, media: file },
  { retry: { attempts: 8, maxDelay: "2m" } },
);
```

Un envoi en une seule requête n'est pas retenté, pas plus que la requête qui ouvre une session. Pour un petit fichier, c'est important : relancez l'appel vous-même.

L'option `timeout` du client ne s'applique pas aux envois. Pour en borner un ou l'annuler, passez un `signal` :

```ts
const controller = new AbortController();
const cancelButton = document.querySelector("button#cancel")!;
cancelButton.addEventListener("click", () => controller.abort());

try {
  await yt.videos.insert(
    { body: { snippet: { title: "Holiday 2026" } }, media: file },
    { signal: controller.signal },
  );
} catch (error) {
  if (!isYouTubeError(error, "ABORTED")) throw error;
  console.log("Upload cancelled");
}
```

Un envoi annulé lève une `YouTubeRequestError` de code `ABORTED`.

## Reprendre après un plantage

Une session avec reprise survit à votre processus. Elle reste valide environ une semaine. Conservez son URI : une exécution ultérieure continue là où l'envoi s'est arrêté, au lieu de repartir de zéro.

L'URI figure dans chaque rapport de progression d'un envoi avec reprise. Stockez-la dès qu'elle apparaît, puis repassez-la comme `resumeUri` :

```ts
import { fileMedia } from "@ix-xs/youtube.api/node";

const saved: string | undefined = await db.uploads.get("holiday");

const video = await yt.videos.insert({
  body: {
    snippet: { title: "Holiday 2026" },
    status: { privacyStatus: "private" },
  },
  media: await fileMedia("./holiday.mp4", {
    resumeUri: saved,
    onProgress: ({ sessionUri }) => {
      if (sessionUri && sessionUri !== saved) {
        void db.uploads.set("holiday", sessionUri);
      }
    },
  }),
});

await db.uploads.delete("holiday");
```

Avec un `resumeUri`, le client demande d'abord au serveur jusqu'où l'envoi est allé, saute autant d'octets du média, et envoie le reste. Si le serveur a déjà tout, l'appel renvoie la vidéo aussitôt. Passez le même fichier : les octets ne sont pas comparés.

Les métadonnées et les paramètres ont été envoyés à l'ouverture de la session. Lors d'une reprise, `body` reste exigé par le type, mais ni lui ni les paramètres ne sont renvoyés.

L'URI figure aussi sur l'erreur quand une session abandonne, avec le nombre d'octets confirmés :

```ts
try {
  await yt.videos.insert({
    body: { snippet: { title: "Holiday 2026" } },
    media: await fileMedia("./holiday.mp4"),
  });
} catch (error) {
  if (error instanceof YouTubeUploadError && error.sessionUri) {
    console.log(`Stopped after ${error.uploaded} bytes`);
    await db.uploads.set("holiday", error.sessionUri);
  } else {
    throw error;
  }
}
```

Une session expirée ne peut pas être reprise. L'appel lève alors une `YouTubeUploadError` dont le `sessionUri` vaut `undefined`, puisqu'il n'y a plus rien à reprendre. Supprimez l'URI stockée et renvoyez le fichier sans `resumeUri`.

La reprise fonctionne mieux avec un fichier ou un `Blob`, où sauter des octets ne coûte rien. Un flux ne peut être repris que si vous pouvez le reproduire depuis son premier octet : le client lit et écarte ce que le serveur a déjà.

## Après l'envoi

`videos.insert` rend la main quand YouTube a le fichier. Le traitement vient ensuite. Lisez `status` pour le suivre, pour 1 unité par appel :

```ts
const uploaded = await yt.videos.get(videoId, { part: "status" });

switch (uploaded?.status.uploadStatus) {
  case "processed":
    console.log("Ready");
    break;
  case "failed":
    console.log("Processing failed:", uploaded.status.failureReason);
    break;
  case "rejected":
    console.log("Rejected:", uploaded.status.rejectionReason);
    break;
}
```

Pour changer plus tard le titre, la description ou la confidentialité, utilisez `videos.update` : voir [Mettre à jour une vidéo](/resources/videos/#updating-a-video).

## Définir une miniature

`thumbnails.set` envoie une miniature personnalisée pour une vidéo. JPEG ou PNG, 50 Mio au plus. 50 unités.

```ts
import { fileMedia } from "@ix-xs/youtube.api/node";

await yt.thumbnails.set({ videoId, media: await fileMedia("./cover.png") });
```

## Envoyer des sous-titres

`captions.insert` et `captions.update` acceptent un fichier de sous-titres par le même paramètre `media`, sous forme de texte ou de fichier. Elles coûtent 400 et 450 unités. La page [Sous-titres](/resources/captions/) les traite.

```ts
await yt.captions.insert({
  body: { snippet: { videoId, language: "en", name: "English" } },
  media: { body: srtText, mimeType: "application/x-subrip" },
});
```

## Changer la bannière de la chaîne

Une bannière demande deux étapes. `channelBanners.insert` envoie l'image et renvoie une URL. La bannière n'est en ligne qu'une fois cette URL enregistrée dans `brandingSettings.image.bannerExternalUrl` avec `channels.update`.

`channels.update` remplace toute la partie qu'elle reçoit : lisez donc d'abord les réglages de marque, puis renvoyez-les avec la nouvelle URL :

```ts
const { url } = await yt.channelBanners.insert({ media: image });

const channel = await yt.channels.mine({ part: "brandingSettings" });

if (channel && url) {
  const branding = channel.brandingSettings;

  await yt.channels.update({
    body: {
      id: channel.id,
      brandingSettings: {
        ...branding,
        image: { ...branding.image, bannerExternalUrl: url },
      },
    },
  });
}
```

Cela fait 50 unités pour l'envoi, 1 pour la lecture et 50 pour la mise à jour. L'image est un JPEG ou un PNG, 6 Mio au plus.

## Définir une image de playlist

`playlistImages.insert` définit une miniature personnalisée sur une playlist, et `playlistImages.update` la remplace. JPEG ou PNG, 50 Mio au plus. 50 unités chacune.

```ts
const created = await yt.playlistImages.insert({
  body: { snippet: { playlistId, type: "hero", width: 1080, height: 1080 } },
  media: image,
});

await yt.playlistImages.update({
  body: { id: created.id, snippet: { playlistId, type: "hero" } },
  media: image,
});
```

`media` est optionnel sur `update`. Lire et supprimer l'image sont des appels simples :

```ts
// 1 unité.
const { items } = await yt.playlistImages.list({
  part: "snippet",
  parent: playlistId,
});

// 50 unités chacune.
for (const item of items) await yt.playlistImages.delete({ id: item.id });
```

## Définir un filigrane

`watermarks.set` envoie une image affichée sur toutes les vidéos d'une chaîne. `body` indique quand elle apparaît. JPEG ou PNG, 10 Mio au plus. 50 unités.

```ts
await yt.watermarks.set({
  channelId,
  body: {
    timing: { type: "offsetFromStart", offsetMs: "15000" },
    position: { type: "corner", cornerPosition: "topRight" },
  },
  media: image,
});

await yt.watermarks.unset({ channelId }); // 50 unités
```

`offsetMs` est une chaîne de caractères parce que c'est un entier de 64 bits. `watermarks.unset` n'accepte pas le scope `youtube.upload` : elle exige `youtube`, `youtube.force-ssl` ou `youtubepartner`.

## Envoyer depuis le navigateur

Un `File` issu d'un `<input type="file">` est un `Blob` : il va directement dans `media`. Il porte son propre type MIME et sa taille.

```ts
const input = document.querySelector<HTMLInputElement>("input[type=file]")!;
const bar = document.querySelector("progress")!;

input.addEventListener("change", async () => {
  const picked = input.files?.[0];
  if (!picked) return;

  const video = await yt.videos.insert({
    body: {
      snippet: { title: picked.name },
      status: { privacyStatus: "private" },
    },
    media: {
      body: picked,
      onProgress: ({ percent }) => {
        bar.value = percent ?? 0;
      },
    },
  });

  console.log("Uploaded", video.id);
});
```

Les octets vont du navigateur à YouTube, par morceaux lus dans le fichier au fur et à mesure. Le client dans la page a besoin d'un jeton de l'utilisateur : la page [Environnements d'exécution](/reference/runtimes/) explique ce que cela implique dans un navigateur.

## Erreurs

```ts
try {
  await yt.videos.insert({
    body: { snippet: { title: "Holiday 2026" } },
    media: file,
  });
} catch (error) {
  if (error instanceof YouTubeArgumentError) {
    // Refusé par le client : mauvais type MIME, média vide ou trop volumineux.
  } else if (error instanceof YouTubeUploadError) {
    // Le transfert a abandonné. error.sessionUri peut permettre une reprise.
  } else if (
    error instanceof YouTubeApiError &&
    error.reason === "uploadLimitExceeded"
  ) {
    // L'API a refusé l'envoi : la limite d'envois est atteinte.
  } else if (isYouTubeError(error, "QUOTA_EXCEEDED")) {
    // Le projet a épuisé ses envois du jour. Voir yt.quota.resetsAt.
  } else {
    throw error;
  }
}
```

| Erreur | Code | Quand |
| --- | --- | --- |
| `YouTubeArgumentError` | `INVALID_ARGUMENT` | Le type MIME n'est pas accepté, une taille connue est nulle ou dépasse la limite, ou le corps n'est pas une forme prise en charge. Rien n'a été envoyé. Un flux vide est refusé aussi, une fois sa session ouverte |
| `YouTubeUploadError` | `UPLOAD_FAILED` | Le transfert a échoué : une requête unique n'est pas passée, aucune session n'a pu être ouverte ou jointe, trop d'échecs consécutifs, ou la session a expiré. Porte `uploaded`, et `sessionUri` quand la session peut encore être reprise |
| `YouTubeApiError` | Selon le statut | L'API a refusé l'envoi. `reason` en donne la cause : `uploadLimitExceeded`, `invalidTitle`, `invalidDescription`, `invalidTags`, `invalidCategoryId`, `invalidVideoMetadata` |
| `YouTubeApiError` | `QUOTA_EXCEEDED` | Le projet a épuisé ses envois du jour |
| `YouTubeQuotaBudgetError` | `QUOTA_BUDGET_EXCEEDED` | Avec `quota.enforce`, le compte local indique que l'enveloppe est vide. Rien n'a été envoyé |
| `YouTubeRequestError` | `ABORTED` | Le `signal` a été interrompu |

La vérification du type MIME lit le type que vous avez donné, ou celui que porte le média. Un message comme celui-ci signifie que le type est mauvais, pas le fichier :

```ts
await yt.thumbnails.set({
  videoId,
  media: { body: image, mimeType: "image/webp" },
});
// YouTubeArgumentError: thumbnails.set does not accept "image/webp".
// Accepted types: image/jpeg, image/png, application/octet-stream.
// Set `media.mimeType`.
```

Une limite de taille ne peut être vérifiée avant l'envoi que si la taille est connue. Pour un flux, c'est l'API qui refuse.

## Référence

### Méthodes qui acceptent `media`

| Méthode | Types acceptés | Limite | Quota |
| --- | --- | --- | --- |
| `yt.videos.insert` | `video/*`, `application/octet-stream` | 256 Gio | 1 appel, enveloppe `videos.insert` |
| `yt.thumbnails.set` | `image/jpeg`, `image/png`, `application/octet-stream` | 50 Mio | 50 |
| `yt.captions.insert` | Tous | 100 Mio | 400 |
| `yt.captions.update` | Tous | 100 Mio | 450 |
| `yt.channelBanners.insert` | `image/jpeg`, `image/png`, `application/octet-stream` | 6 Mio | 50 |
| `yt.playlistImages.insert` | `image/jpeg`, `image/png`, `application/octet-stream` | 50 Mio | 50 |
| `yt.playlistImages.update` | `image/jpeg`, `image/png`, `application/octet-stream` | 50 Mio | 50 |
| `yt.watermarks.set` | `image/jpeg`, `image/png`, `application/octet-stream` | 10 Mio | 50 |

Toutes exigent OAuth. Les mêmes chiffres sont disponibles dans le code sous `METHODS["thumbnails.set"].upload`, avec `accept` et `maxSize` en octets. La page [Quota](/basics/quota/#buckets) explique l'enveloppe `videos.insert`.

### La forme objet de `media`

| Option | Par défaut | Signification |
| --- | --- | --- |
| `body` | Obligatoire | Les octets : un `Blob`, un `Uint8Array`, un `ArrayBuffer`, un `ReadableStream`, un itérable asynchrone d'octets ou une chaîne de caractères |
| `mimeType` | Celui du corps | Type MIME envoyé à l'API |
| `size` | | Taille totale en octets d'un flux, uniquement pour le pourcentage de progression |
| `chunkSize` | 8 Mio | Octets par requête dans une session avec reprise. Arrondi à un multiple de 256 Kio |
| `onProgress` | | Appelée avec un `UploadProgress` à l'ouverture de la session et après chaque morceau confirmé |
| `resumeUri` | | URI de session d'un envoi interrompu, pour continuer là où il s'est arrêté |

### `fileMedia(path, options)`

Renvoie `Promise<MediaOptions>`. Options : `mimeType`, `chunkSize`, `resumeUri`, `onProgress`, avec les significations ci-dessus. Node.js uniquement.

### Types

| Type | Ce que c'est |
| --- | --- |
| `MediaInput` | Ce que `media` accepte : un `MediaBody` ou un `MediaOptions` |
| `MediaBody` | Les octets seuls |
| `MediaOptions` | La forme objet |
| `UploadProgress` | Ce que reçoit `onProgress` |
| `YouTubeUploadError` | `sessionUri: string \| undefined`, `uploaded: number` |

## Voir aussi

- [Sous-titres](/resources/captions/) : les pistes de sous-titres, l'autre envoi de fichier.
- [Vidéos](/resources/videos/) : lire et mettre à jour ce que vous avez envoyé.
- [Mettre en ligne depuis un script](/recipes/upload-from-a-script/) : un programme complet, du consentement à l'URL de la vidéo.
- [Quota](/basics/quota/) : l'enveloppe `videos.insert` et comment la surveiller.
