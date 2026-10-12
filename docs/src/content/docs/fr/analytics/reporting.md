---
title: Reporting
description: Planifiez une fois des rapports en masse, puis récupérez-les sous forme de fichiers CSV, un par jour. Pour exporter toutes les données d'une chaîne vers votre propre base.
sidebar:
  order: 2
---

```ts
// Une seule fois.
const job = await yt.reporting.jobs.create({
  body: { reportTypeId: "channel_basic_a3", name: "Channel basics" },
});

// Un jour ou deux plus tard, puis chaque jour.
if (job.id) {
  for await (const report of yt.reporting.reports.list({ jobId: job.id })) {
    const csv = await yt.reporting.download(report);
    console.log(report.startTime, csv.length);
  }
}
```

## Comment fonctionnent les rapports en masse

L'API Reporting ne répond pas à des questions. Elle livre des fichiers.

1. Vous choisissez un type de rapport, un jeu de colonnes fixe que YouTube définit.
2. Vous créez une tâche pour ce type, une seule fois.
3. YouTube génère un fichier CSV par jour pour cette tâche, le premier dans les 48 heures.
4. Vous listez les fichiers de la tâche et téléchargez les nouveaux.

Pour une question comme « les meilleures vidéos du mois », [Analytics](/analytics/analytics/) répond en un appel. [Reporting ou Analytics](#reporting-or-analytics) compare les deux.

Tout ici demande OAuth, et rien n'est facturé en unités de quota : voir [Limites et erreurs](#limits-and-errors).

## Choisir un type de rapport

`reportTypes.list` renvoie les types que votre chaîne ou votre détenteur de contenu peut planifier.

```ts
const types = await yt.reporting.reportTypes.list().all();

for (const type of types) {
  console.log(type.id, type.name, type.deprecateTime ?? "");
}
```

`type.id` est ce qu'une tâche attend. `deprecateTime` est renseigné sur un type qui a été déprécié ou qui le sera.

`includeSystemManaged: true` liste aussi les types gérés par le système. YouTube crée lui-même les tâches de ces types : ils ne peuvent donc pas être passés à `jobs.create`.

## Planifier une tâche

```ts
const job = await yt.reporting.jobs.create({
  body: { reportTypeId: "channel_basic_a3", name: "Daily channel stats" },
});

console.log(job.id, job.createTime);
```

Créez la tâche une fois et gardez son identifiant. Le reste du temps, vous ne faites que lister et télécharger.

```ts
const jobs = await yt.reporting.jobs.list().all();
const one = await yt.reporting.jobs.get({ jobId });

await yt.reporting.jobs.delete({ jobId });
```

Une tâche a un `expireTime` : passé ce moment, plus aucun rapport n'est généré. Les rapports déjà générés pour une tâche supprimée restent téléchargeables un certain temps.

`jobs.list({ includeSystemManaged: true })` ajoute les tâches que YouTube gère. Elles ne peuvent être ni modifiées ni supprimées.

## Lister les fichiers

`reports.list` renvoie les fichiers générés pour une tâche. Trois filtres gardent la liste courte :

```ts
const lastWeek = new Date(Date.now() - 7 * 86_400_000);
const reports = yt.reporting.reports.list({ jobId, createdAfter: lastWeek });

for await (const report of reports) {
  console.log(report.id, report.startTime, report.endTime, report.createTime);
}
```

| Filtre | Garde les rapports |
| --- | --- |
| `createdAfter` | Créés après ce moment |
| `startTimeAtOrAfter` | Dont la période commence à ce moment ou plus tard |
| `startTimeBefore` | Dont la période commence avant ce moment |

Chacun prend une `Date` ou une chaîne ISO 8601.

Un rapport couvre la période qui va de `startTime`, inclus, à `endTime`, exclu. `createTime` est le moment où le fichier a été généré.

Utilisez `createdAfter` pour ne récupérer que les nouveautés. Enregistrez le `createTime` du rapport le plus récent que vous avez traité, et passez-le la fois suivante :

```ts
const since: string | undefined = await db.get("reports:lastCreateTime");
let newest = since;

const reports = yt.reporting.reports.list({
  jobId,
  ...(since ? { createdAfter: since } : {}),
});

for await (const report of reports) {
  const csv = await yt.reporting.download(report);
  await db.insert("reports", { id: report.id, day: report.startTime, csv });

  const created = report.createTime;
  if (created && (!newest || created > newest)) newest = created;
}

if (newest) await db.set("reports:lastCreateTime", newest);
```

`reports.get({ jobId, reportId })` récupère les métadonnées d'un seul fichier.

## Télécharger

`yt.reporting.download()` prend un rapport, ou son `downloadUrl`, et se résout en texte CSV.

```ts
const report = await yt.reporting.reports.get({ jobId, reportId });
const csv = await yt.reporting.download(report);

const [header, ...lines] = csv.trim().split("\n");
console.log(header?.split(","), lines.length);
```

Pour un gros fichier, `downloadResponse()` se résout en `Response` brute. Écrivez son corps sur le disque au fil de l'eau, sans le garder en mémoire :

```ts
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream } from "node:stream/web";

const report = await yt.reporting.reports.get({ jobId, reportId });
const response = await yt.reporting.downloadResponse(report);

if (response.body) {
  await pipeline(
    Readable.fromWeb(response.body as ReadableStream),
    createWriteStream(`report-${report.id}.csv`),
  );
}
```

Un téléchargement fait une seule tentative. Il n'est jamais retenté, et il n'a pas de délai : ni le `timeout` du client ni celui de l'appel ne s'appliquent. Passez un `signal` pour le borner :

```ts
const report = await yt.reporting.reports.get({ jobId, reportId });
const csv = await yt.reporting.download(report, {
  signal: AbortSignal.timeout(60_000),
});
```

### Le contrôle de l'hôte de téléchargement

Un téléchargement emporte votre jeton d'accès. Le client ne l'envoie donc qu'à `https://youtubereporting.googleapis.com`. Une URL avec un autre schéma ou un autre hôte lève une `YouTubeArgumentError`, et rien n'est envoyé.

```ts
try {
  await yt.reporting.download("https://example.com/report.csv");
} catch (error) {
  console.log(isYouTubeError(error, "INVALID_ARGUMENT")); // true
}
```

Vous pouvez donc repasser sans risque un `downloadUrl` que vous avez enregistré vous-même : une URL falsifiée ne peut pas envoyer le jeton ailleurs. Un rapport sans `downloadUrl` lève la même erreur.

## Détenteurs de contenu

Chaque méthode de `reportTypes`, `jobs` et `reports` accepte `onBehalfOfContentOwner`, pour les partenaires de contenu YouTube.

```ts
const owner = "CONTENT_OWNER_ID";

const types = await yt.reporting.reportTypes
  .list({ onBehalfOfContentOwner: owner })
  .all();
const jobs = await yt.reporting.jobs
  .list({ onBehalfOfContentOwner: owner })
  .all();

for (const job of jobs) {
  if (!job.id) continue;
  const reports = yt.reporting.reports.list({
    jobId: job.id,
    onBehalfOfContentOwner: owner,
  });
  for await (const report of reports) console.log(job.name, report.startTime);
}
```

Passez-le à chaque appel, ou une fois avec l'option `onBehalfOfContentOwner` du client, qui s'applique aussi à ces méthodes : voir [Configuration](/basics/configuration/). `download` ne prend pas ce paramètre : il utilise l'URL du rapport telle quelle.

## Reporting ou Analytics

| | Reporting | Analytics |
| --- | --- | --- |
| Vous recevez | Des fichiers CSV, un par jour et par tâche | Les lignes du rapport que vous avez demandé |
| Quand | Le premier fichier dans les 48 heures après la création de la tâche, puis chaque jour | Tout de suite |
| Forme | Les colonnes du type de rapport | Les métriques, dimensions, filtres et tri de votre choix |
| Mise en place | Une tâche à créer et des fichiers à récupérer | Aucune |
| Convient à | Un export complet vers votre propre base | Un tableau de bord, une question ponctuelle, un top 10 |

Commencez par Analytics. Passez à Reporting quand vous voulez toutes les données chaque jour, et non la réponse à une question.

## Référence

### Méthodes

| Méthode | Ce qu'elle fait |
| --- | --- |
| `yt.reporting.reportTypes.list(params?)` | Liste les types de rapport que vous pouvez planifier |
| `yt.reporting.jobs.create({ body })` | Planifie un rapport : `body.reportTypeId` et `body.name` |
| `yt.reporting.jobs.list(params?)` | Liste vos tâches |
| `yt.reporting.jobs.get({ jobId })` | Récupère une tâche |
| `yt.reporting.jobs.delete({ jobId })` | Supprime une tâche |
| `yt.reporting.reports.list({ jobId, ... })` | Liste les fichiers générés pour une tâche |
| `yt.reporting.reports.get({ jobId, reportId })` | Récupère les métadonnées d'un fichier |
| `yt.reporting.download(report, options?)` | Télécharge un fichier et se résout en texte CSV |
| `yt.reporting.downloadResponse(report, options?)` | Télécharge un fichier et se résout en `Response` brute |

Les trois méthodes `list` renvoient une [requête de liste](/basics/lists/) : attendez-la avec `await` pour une page, parcourez-la, ou appelez `.all()`. Elles prennent `pageSize` là où l'API Data prend `maxResults`.

### `ReportingReportType`

| Champ | Signification |
| --- | --- |
| `id` | Identifiant du type de rapport. C'est le `reportTypeId` d'une tâche |
| `name` | Nom du type de rapport |
| `deprecateTime` | Moment où le type a été déprécié ou le sera |
| `systemManaged` | Vrai pour un type dont YouTube crée lui-même les tâches |

### `ReportingJob`

| Champ | Signification |
| --- | --- |
| `id` | Identifiant de la tâche, généré par le serveur |
| `name` | Le nom que vous avez donné, 100 caractères au plus |
| `reportTypeId` | Le type de rapport que la tâche produit |
| `createTime` | Moment où la tâche a été créée |
| `expireTime` | Moment où la tâche expire. Aucun rapport n'est généré ensuite |
| `systemManaged` | Vrai pour une tâche que YouTube gère. Elle ne peut pas être modifiée |

### `ReportingReport`

| Champ | Signification |
| --- | --- |
| `id` | Identifiant du rapport, généré par le serveur |
| `jobId` | La tâche qui l'a créé |
| `startTime` | Début de la période couverte, inclus |
| `endTime` | Fin de la période couverte, exclue |
| `createTime` | Moment où le fichier a été généré |
| `downloadUrl` | Où le télécharger. Passez le rapport lui-même à `download` |
| `jobExpireTime` | Moment où la tâche de ce rapport expire |

Tous les champs de ces trois types sont optionnels : testez `id` avant de vous y fier.

## Limites et erreurs

Scopes, l'un ou l'autre :

| Scope | Constante |
| --- | --- |
| `yt-analytics.readonly` | `Scopes.analytics` |
| `yt-analytics-monetary.readonly` | `Scopes.analyticsMonetary` |

Avec une clé d'API seule, chaque appel lève une `YouTubeAuthError` de code `MISSING_CREDENTIALS` avant tout envoi. Quand le client connaît les scopes du jeton et que celui-ci n'a aucun des deux, l'appel lève `INSUFFICIENT_SCOPE`.

Google ne facture pas les appels à Reporting en unités de quota. Le client les compte à titre indicatif, un par appel et par téléchargement, sous `yt.quota.usage.reporting`. Ils ne touchent jamais à l'enveloppe de l'API Data.

| Situation | Ce que vous obtenez |
| --- | --- |
| Une URL de téléchargement sur un autre hôte ou un autre port, pas en `https`, ou qui n'est pas une URL | `YouTubeArgumentError`, rien n'est envoyé |
| Un rapport sans `downloadUrl` | `YouTubeArgumentError`, rien n'est envoyé |
| Un téléchargement que le serveur refuse | `YouTubeApiError` avec le statut |
| Un téléchargement qui échoue sur le réseau, avant la réponse ou pendant que `download()` lit le fichier | `YouTubeRequestError`, code `NETWORK`. Pas de nouvelle tentative |
| Un téléchargement dont le `signal` est interrompu | `YouTubeRequestError`, code `ABORTED` |

## Voir aussi

- [Analytics](/analytics/analytics/) pour des rapports à la demande.
- [Listes](/basics/lists/) pour `.all()`, `for await` et les pages.
- [Scopes](/auth/scopes/) et [OAuth](/auth/oauth/) pour les identifiants.
- [Configuration](/basics/configuration/) pour les options du client.
