---
title: Sous-titres
description: Listez les pistes de sous-titres de vos vidéos, téléchargez-les en texte, et envoyez, mettez à jour ou supprimez des pistes. Chaque appel exige OAuth, et la plupart coûtent cher.
sidebar:
  order: 7
---

```ts
const { items } = await yt.captions.list({ part: "snippet", videoId });

for (const track of items) {
  const { language, name, trackKind } = track.snippet;
  console.log(track.id, language, name, trackKind);
}
```

Cet appel coûte 50 unités de quota. Les méthodes de sous-titres sont parmi les plus chères de l'API :

| Appel | Quota |
| --- | --- |
| `yt.captions.list` | 50 |
| `yt.captions.download` | 200 |
| `yt.captions.insert` | 400 |
| `yt.captions.update` | 450 |
| `yt.captions.delete` | 50 |

Avec les 10 000 unités par défaut par jour, cela fait 25 envois, ou 40 tours de « lister les pistes d'une vidéo puis télécharger l'une d'elles ».

## Ce qu'il faut

Les cinq méthodes exigent OAuth. Une clé d'API ne suffit jamais, pas même pour lister les pistes d'une vidéo publique : l'appel est refusé avant l'envoi, avec une `YouTubeAuthError` de code `MISSING_CREDENTIALS`.

Le scope est `youtube.force-ssl`. Les partenaires de contenu peuvent utiliser `youtubepartner` à la place. Le scope `youtube`, qui semble plus large, ne couvre pas les sous-titres. La page [Scopes](/auth/scopes/) donne le tableau complet.

Les méthodes ne fonctionnent que sur les vidéos que l'utilisateur peut modifier : voir [Les vidéos des autres](#other-peoples-videos).

## Lister les pistes d'une vidéo

`captions.list` renvoie toutes les pistes d'une vidéo en une seule réponse. Il n'y a pas de pages à parcourir.

```ts
const { items } = await yt.captions.list({ part: "snippet", videoId });

const english = items.find((track) => track.snippet.language === "en");
const published = items.filter((track) => !track.snippet.isDraft);
```

Le `snippet` décrit chaque piste :

- `language` est une balise BCP-47 comme `en` ou `pt-BR`. `name` est le libellé que les spectateurs voient dans le lecteur.
- `trackKind` vaut `"standard"`, `"ASR"` (reconnaissance vocale automatique) ou `"forced"`.
- `status` vaut `"serving"`, `"syncing"` ou `"failed"`. Quand il vaut `"failed"`, `failureReason` en donne la cause.
- `isDraft` est vrai pour une piste qui n'est pas visible publiquement.

Le texte d'une piste ne figure pas dans la liste. Récupérez-le avec `download`.

Pour cibler des pistes précises, passez leurs identifiants avec la vidéo :

```ts
const { items } = await yt.captions.list({
  part: "snippet",
  videoId,
  id: [captionId],
});
```

## Télécharger une piste

`captions.download` renvoie la piste sous forme de chaîne de caractères. Elle coûte 200 unités.

```ts
const original = await yt.captions.download({ id: captionId });
const vtt = await yt.captions.download({ id: captionId, tfmt: "vtt" });
```

Sans `tfmt`, vous obtenez la piste dans le format où elle a été envoyée. Avec `tfmt`, YouTube convertit la piste. Les valeurs acceptées sont `"sbv"`, `"scc"`, `"srt"`, `"ttml"` et `"vtt"`.

`tlang` demande une traduction automatique dans une autre langue :

```ts
const french = await yt.captions.download({
  id: captionId,
  tfmt: "srt",
  tlang: "fr",
});
```

Trouver une piste et l'enregistrer sur le disque, pour 250 unités au total :

```ts
import { writeFile } from "node:fs/promises";

const { items } = await yt.captions.list({ part: "snippet", videoId });
const english = items.find((track) => track.snippet.language === "en");

if (english) {
  const srt = await yt.captions.download({ id: english.id, tfmt: "srt" });
  await writeFile("./captions.en.srt", srt);
}
```

## Envoyer une piste

`captions.insert` ajoute une piste à l'une de vos vidéos. Elle coûte 400 unités. Le corps nomme la vidéo, la langue et le libellé. `media` est le fichier de sous-titres, et il doit porter son propre minutage : depuis avril 2024, YouTube ne synchronise plus une transcription sans minutage.

Passez le fichier sous forme de texte, avec son type MIME :

```ts
const track = await yt.captions.insert({
  body: { snippet: { videoId, language: "en", name: "English" } },
  media: { body: srtText, mimeType: "application/x-subrip" },
});

console.log(track.id);
```

Ou depuis le disque, avec Node.js. `fileMedia()` déduit le type MIME de l'extension : `.srt`, `.vtt`, `.ttml` et `.sbv` sont reconnues.

```ts
import { fileMedia } from "@ix-xs/youtube.api/node";

await yt.captions.insert({
  body: { snippet: { videoId, language: "fr", name: "Français" } },
  media: await fileMedia("./captions.fr.vtt"),
});
```

Une simple chaîne de caractères fonctionne aussi comme `media`. Elle part alors en `text/plain` : indiquez le format avec `mimeType` quand c'est autre chose. Cette méthode accepte tous les types MIME, et un fichier de 100 Mio au plus. La page [Envois](/resources/uploads/) décrit tout ce que `media` accepte.

`isDraft: true` dans le `snippet` garde la piste cachée des spectateurs jusqu'à ce que vous la publiez avec `update` :

```ts
await yt.captions.insert({
  body: {
    snippet: { videoId, language: "en", name: "English", isDraft: true },
  },
  media: { body: srtText, mimeType: "application/x-subrip" },
});
```

Le paramètre `sync` de `insert` et de `update` figure encore dans les types, mais il n'est plus pris en charge. Ne l'utilisez pas.

### Vérifier que le fichier a été accepté

Un `insert` réussi signifie que YouTube a reçu le fichier, pas qu'il a pu le lire. Redemandez le `snippet` et regardez `status` :

```ts
const track = await yt.captions.insert({
  part: "snippet",
  body: { snippet: { videoId, language: "en", name: "English" } },
  media: { body: srtText, mimeType: "application/x-subrip" },
});

if (track.snippet.status === "failed") {
  console.error("Processing failed:", track.snippet.failureReason);
}
```

`failureReason` vaut `"unknownFormat"`, `"unsupportedFormat"` ou `"processingFailed"`. Une piste encore en `"syncing"` peut être revérifiée plus tard avec `captions.list`, pour 50 unités.

## Mettre à jour une piste

`captions.update` change l'état de brouillon d'une piste, remplace son fichier, ou les deux. Elle coûte 450 unités.

Publier un brouillon :

```ts
await yt.captions.update({
  body: { id: captionId, snippet: { isDraft: false } },
});
```

Remplacer le fichier et publier en un seul appel :

```ts
await yt.captions.update({
  body: { id: captionId, snippet: { isDraft: false } },
  media: { body: srtText, mimeType: "application/x-subrip" },
});
```

Ici, `media` est optionnel.

## Supprimer une piste

```ts
await yt.captions.delete({ id: captionId });
```

50 unités. La promesse se résout sans valeur.

## Les vidéos des autres

Les méthodes de sous-titres ne fonctionnent que sur les vidéos que l'utilisateur peut modifier. Aucune méthode ne renvoie le texte des sous-titres d'une vidéo qui appartient à quelqu'un d'autre, quel que soit le scope du jeton.

Un appel refusé lève une `YouTubeApiError`. Gérez-la là où un utilisateur peut saisir n'importe quel identifiant de vidéo :

```ts
try {
  const text = await yt.captions.download({ id: captionId, tfmt: "vtt" });
  console.log(text);
} catch (error) {
  if (error instanceof YouTubeApiError) {
    const why = `${error.status} ${error.reason ?? ""}`;
    console.error(`Captions not available (${why})`);
  } else {
    throw error;
  }
}
```

Un appel refusé compte quand même : `yt.quota` y ajoute une unité.

## Référence

### Méthodes

| Méthode | Quota | Renvoie |
| --- | --- | --- |
| `yt.captions.list({ part, videoId, id? })` | 50 | Les pistes, dans `items` |
| `yt.captions.download({ id, tfmt?, tlang? })` | 200 | `string` |
| `yt.captions.insert({ body, media, part? })` | 400 | La piste créée |
| `yt.captions.update({ body, media?, part? })` | 450 | La piste mise à jour |
| `yt.captions.delete({ id })` | 50 | `void` |

Toutes acceptent `onBehalfOfContentOwner`, pour les partenaires de contenu YouTube. Toutes exigent OAuth avec `youtube.force-ssl` ou `youtubepartner`.

### Parties

Un sous-titre a deux parties : `id` et `snippet`. `snippet` est toujours renvoyée quand elle est demandée.

### Champs de `snippet`

| Champ | Type | Signification |
| --- | --- | --- |
| `videoId` | `string` | La vidéo à laquelle la piste appartient |
| `language` | `string` | Balise de langue BCP-47 |
| `name` | `string` | Libellé affiché aux spectateurs pendant la lecture |
| `trackKind` | `"standard" \| "ASR" \| "forced"` | Type de la piste |
| `status` | `"serving" \| "syncing" \| "failed"` | État de la piste |
| `failureReason` | `"unknownFormat" \| "unsupportedFormat" \| "processingFailed"` | Cause de l'échec du traitement. Seulement quand `status` vaut `"failed"` |
| `lastUpdated` | `string` | Date et heure ISO 8601 de la dernière mise à jour |
| `isDraft` | `boolean` | Un brouillon n'est pas visible publiquement |
| `isAutoSynced` | `boolean` | Indique si YouTube a synchronisé la piste avec l'audio. Si c'est faux, les codes temporels du fichier sont utilisés |
| `isCC` | `boolean` | Sous-titres pour sourds et malentendants |
| `isEasyReader` | `boolean` | Rédigés au niveau de lecture du CE2, pour les apprenants d'une langue |
| `isLarge` | `boolean` | Utilise de grands caractères pour les personnes malvoyantes |
| `audioTrackType` | `"unknown" \| "primary" \| "commentary" \| "descriptive"` | Type de piste audio auquel les sous-titres sont associés |

`videoId`, `language`, `name`, `trackKind`, `status` et `lastUpdated` sont toujours présents. Les autres sont optionnels.

### Erreurs

| Erreur | Quand |
| --- | --- |
| `YouTubeAuthError`, code `MISSING_CREDENTIALS` | Le client n'a qu'une clé d'API |
| `YouTubeAuthError`, code `INSUFFICIENT_SCOPE` | Le jeton n'a ni `youtube.force-ssl` ni `youtubepartner`. Levée avant l'envoi quand le client connaît les scopes du jeton |
| `YouTubeApiError`, motif `captionNotFound` | Aucune piste ne porte cet identifiant |
| `YouTubeApiError`, code `QUOTA_EXCEEDED` | Le projet a épuisé son quota du jour |
| `YouTubeArgumentError` | Le fichier de sous-titres est vide, ou dépasse 100 Mio |

## Voir aussi

- [Envois](/resources/uploads/) : le paramètre `media`, les fichiers, la progression.
- [Scopes](/auth/scopes/) : pourquoi les sous-titres exigent `youtube.force-ssl`.
- [Quota](/basics/quota/) : budgéter des appels qui coûtent des centaines d'unités.
- [Vidéos](/resources/videos/) : `contentDetails.caption` vaut `"true"` ou `"false"`, et indique pour 1 unité si une vidéo a des sous-titres.
