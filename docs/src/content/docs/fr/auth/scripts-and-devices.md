---
title: Scripts et appareils
description: "Autorisez un script sur votre machine en un appel, gardez les jetons dans un fichier, connectez-vous depuis un appareil sans navigateur et exécutez le résultat sur un serveur."
sidebar:
  order: 2
---

```ts
import { OAuth2, YouTube } from "@ix-xs/youtube.api";
import { authorize, tokenFile } from "@ix-xs/youtube.api/node";

const store = tokenFile("./tokens.json");
const oauth = new OAuth2({
  clientId: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  tokens: await store.load(),
  onTokens: store.save,
});

if (!oauth.canRefresh) {
  // Ouvre le navigateur.
  await authorize(oauth, { scopes: ["youtube.readonly"] });
}

const yt = new YouTube({ oauth });
```

La première exécution ouvre la page de consentement et écrit `tokens.json`. Chaque exécution suivante lit le fichier et passe directement à l'API.

`authorize` et `tokenFile` viennent de `@ix-xs/youtube.api/node`, le point d'entrée des raccourcis qui ont besoin de Node.js lui-même : les fichiers sur disque, un serveur HTTP local, le navigateur par défaut. Le flux pour appareils, plus bas, fait partie du point d'entrée principal et fonctionne partout où `fetch` existe.

## Autoriser sur votre propre machine

`authorize()` exécute tout le [parcours OAuth](/auth/oauth/) en local : un script n'a donc besoin ni de serveur web ni de route de rappel.

Créez dans la console Google Cloud un client OAuth de type **Desktop app** (application de bureau). Ce type accepte n'importe quel port de bouclage comme redirection, ce qui rend utilisable un port local libre. [Identifiants d'accès](/start/credentials/) montre où faire cela.

```ts
const tokens = await authorize(oauth, { scopes: ["youtube.upload"] });
```

Ce que fait l'appel :

1. Il démarre un serveur HTTP sur `127.0.0.1`, sur un port libre quelconque.
2. Il construit l'URL de consentement avec cette adresse comme URI de redirection, avec PKCE, et avec `prompt: "consent"` pour qu'un jeton de rafraîchissement soit renvoyé.
3. Il affiche l'URL et l'ouvre dans le navigateur par défaut.
4. Il attend que Google redirige l'utilisateur, et vérifie `state`. Une requête qui porte un autre `state` reçoit une page d'erreur, et l'attente continue.
5. Il échange le code contre des jetons. Ils sont rangés dans `oauth`, passés à `onTokens` et renvoyés.

Le serveur local est fermé, que l'appel réussisse ou échoue.

Le navigateur doit tourner sur la même machine que le script, car Google redirige vers `127.0.0.1`. Pour une machine que vous n'atteignez que par SSH, autorisez depuis votre propre ordinateur et [copiez les jetons](#running-on-a-server), ou utilisez le [flux pour appareils](#signing-in-on-a-device).

### Options

```ts
await authorize(oauth, {
  scopes: ["youtube.readonly"],
  port: 8085, // écoute sur ce port plutôt que sur un port libre
  open: false, // ne lance pas le navigateur
  // Remplace le message par défaut.
  onUrl: (url) => console.log(`Sign in at ${url}`),
  timeout: "2m", // abandonne après deux minutes, "5m" par défaut
});
```

`onUrl` est appelée, que le navigateur soit ouvert ou non. Avec un `port` fixe, l'URI de redirection est `http://127.0.0.1:8085`. Si le port est pris, l'appel est rejeté avec l'erreur d'écoute propre à Node.

### Quand cela échoue

`authorize()` lève une `YouTubeAuthError` avec le code `OAUTH_ERROR` dans deux cas :

- Personne n'a terminé l'écran de consentement avant `timeout`.
- L'utilisateur a refusé, ou Google a renvoyé une autre erreur. `error.oauthError` contient alors le nom donné par Google.

L'échange qui termine le parcours peut échouer lui aussi, comme [`exchange()`](/auth/oauth/).

```ts
try {
  await authorize(oauth, { scopes: ["youtube.readonly"], timeout: "2m" });
} catch (error) {
  if (error instanceof YouTubeAuthError) {
    console.error("Not authorized:", error.oauthError ?? error.message);
    process.exit(1);
  }
  throw error;
}
```

## Garder les jetons dans un fichier

`tokenFile(path)` renvoie deux fonctions faites pour `OAuth2` : `load` pour l'option `tokens` et `save` pour `onTokens`.

```ts
const store = tokenFile("./secrets/tokens.json");

const saved = await store.load(); // Tokens, ou undefined sans fichier
await store.save({ refreshToken: "1//example" });
```

- `load()` renvoie `undefined` tant que le fichier n'existe pas. Un fichier illisible ou qui n'est pas du JSON valide la fait lever une erreur.
- `save()` crée le dossier s'il manque et écrit les jetons en JSON indenté.

Sous Linux et macOS, le fichier n'est lisible que par l'utilisateur courant. Windows ignore ce réglage : ce sont alors les permissions du dossier qui s'appliquent. Placez le fichier là où les autres comptes ne peuvent pas le lire, et gardez-le hors du contrôle de version.

Comme `save` est branchée sur `onTokens`, le fichier est réécrit après chaque rafraîchissement. Si l'écriture échoue, l'appel d'API qui a déclenché le rafraîchissement échoue aussi : voir [Conserver les jetons](/auth/oauth/#storing-tokens). Après `oauth.revoke()`, le fichier contient un objet vide.

## Un script complet

Ce script affiche votre chaîne et vos playlists. Lancez-le deux fois : la seconde exécution n'ouvre pas le navigateur.

```ts
import { OAuth2, YouTube } from "@ix-xs/youtube.api";
import { authorize, tokenFile } from "@ix-xs/youtube.api/node";

const SCOPE = "youtube.readonly";

const store = tokenFile("./tokens.json");
const oauth = new OAuth2({
  clientId: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  tokens: await store.load(),
  onTokens: store.save,
});

// Le consentement est nécessaire la première fois, et de nouveau quand le script demande
// un scope que le fichier n'a pas.
if (!oauth.canRefresh || !oauth.grantedScopes?.has(SCOPE)) {
  await authorize(oauth, { scopes: [SCOPE] });
}

const yt = new YouTube({ oauth });

const me = await yt.channels.mine();
console.log(me?.snippet.title, me?.statistics.subscriberCount);

const playlists = yt.playlists.list({
  part: ["snippet", "contentDetails"],
  mine: true,
});

for await (const playlist of playlists) {
  console.log(playlist.snippet.title, playlist.contentDetails.itemCount);
}
```

```bash
GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... node script.mjs
```

Il dépense 1 unité de quota pour la chaîne et 1 par page de 50 playlists.

Tester `grantedScopes` compte dès que le script grandit. Un fichier écrit pour `youtube.readonly` contient déjà un jeton de rafraîchissement : `canRefresh` seul sauterait le consentement dont une nouvelle fonction d'envoi a besoin. Les accords précédents sont conservés quand vous en demandez plus : voir [Scopes](/auth/scopes/#asking-for-more-later).

[Mettre en ligne depuis un script](/recipes/upload-from-a-script/) repart du même début.

## Se connecter depuis un appareil

Le flux pour appareils sert pour une télévision, une console ou un outil en ligne de commande sur une machine sans navigateur. L'appareil affiche un code court. L'utilisateur le saisit sur un autre appareil, et le script attend.

Créez un client OAuth de type **TVs and Limited Input devices** (téléviseurs et appareils à saisie limitée).

```ts
import { OAuth2, YouTube } from "@ix-xs/youtube.api";
import { tokenFile } from "@ix-xs/youtube.api/node";

const store = tokenFile("./tokens.json");
const oauth = new OAuth2({
  clientId,
  clientSecret,
  tokens: await store.load(),
  onTokens: store.save,
});

if (!oauth.canRefresh) {
  const device = await oauth.requestDeviceCode({
    scopes: ["youtube.readonly"],
  });
  console.log(`Open ${device.verificationUrl} and enter ${device.userCode}`);

  await oauth.pollDeviceToken(device); // se résout dès que l'utilisateur a approuvé
}

const yt = new YouTube({ oauth });
```

`requestDeviceCode()` demande les codes à Google. `pollDeviceToken()` interroge ensuite Google toutes les `device.interval` secondes, ralentit quand Google le demande, et se résout avec les jetons. Ils sont rangés dans `oauth` et passés à `onTokens`, exactement comme après un `exchange()`.

Si les codes expirent avant, `pollDeviceToken()` lève une `YouTubeAuthError` dont l'`oauthError` est `expired_token`. Demandez un nouveau code et affichez-le de nouveau. Tout autre refus est levé comme une `YouTubeAuthError` avec le nom donné par Google.

Pour cesser d'attendre plus tôt, passez un `signal`. Quand il s'interrompt, la promesse est rejetée avec une `YouTubeRequestError` dont le code est `ABORTED` :

```ts
const device = await oauth.requestDeviceCode({ scopes: ["youtube.readonly"] });

try {
  await oauth.pollDeviceToken(device, { signal: AbortSignal.timeout(120_000) });
} catch (error) {
  if (!isYouTubeError(error, "ABORTED")) throw error;
  console.log("Nobody approved the device within two minutes.");
}
```

:::caution
Google limite les scopes que le flux pour appareils accepte. Avant de vous appuyer sur l'un d'eux, consultez [la liste des scopes autorisés pour les appareils](https://developers.google.com/identity/protocols/oauth2/limited-input-device#allowedscopes) chez Google.
:::

## Exécuter sur un serveur

Une tâche cron ou un worker n'a personne pour cliquer à travers un écran de consentement. Faites le consentement une fois sur votre machine, puis donnez le résultat au serveur.

1. Lancez en local un script avec `authorize()`, comme ci-dessus. Il écrit `tokens.json`.
2. Déplacez les jetons vers le serveur, de l'une des deux façons ci-dessous.
3. Créez l'objet `OAuth2` sur le serveur avec les mêmes `clientId` et `clientSecret`.

**Copier le fichier.** Faites-y pointer `tokenFile()`. Le processus doit pouvoir écrire dans le fichier, car `save` s'exécute après chaque rafraîchissement.

```ts
const store = tokenFile("/var/lib/my-app/tokens.json");
const oauth = new OAuth2({
  clientId,
  clientSecret,
  tokens: await store.load(),
  onTokens: store.save,
});
```

**Passer le seul jeton de rafraîchissement.** Cela convient à un système de fichiers en lecture seule ou à une plateforme qui injecte les secrets comme variables d'environnement. Copiez la valeur de `refreshToken` depuis `tokens.json` :

```ts
const oauth = new OAuth2({
  clientId: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  tokens: { refreshToken: process.env.YOUTUBE_REFRESH_TOKEN },
});

const yt = new YouTube({ oauth });
```

Le premier appel va chercher un jeton d'accès, et les suivants le renouvellent en mémoire. Rien n'a besoin d'être réécrit : la bibliothèque garde le jeton de rafraîchissement qu'on lui a donné.

Si un rafraîchissement échoue un jour avec `oauthError: "invalid_grant"`, le jeton de rafraîchissement n'est plus valide : il a été révoqué ou il a expiré. Recommencez l'étape 1. Tant que l'application a le statut « Test », ses jetons de rafraîchissement expirent au bout de 7 jours : voir [Identifiants d'accès](/start/credentials/).

## Référence

### `authorize(oauth, options)`

Renvoie `Promise<Tokens>`.

| Option | Par défaut | Sens |
| --- | --- | --- |
| `scopes` | Obligatoire | Scopes à demander |
| `port` | N'importe quel port libre | Port local sur lequel écouter |
| `open` | `true` | Ouvre la page de consentement dans le navigateur par défaut |
| `onUrl` | Affiche l'URL | Appelée avec l'URL de consentement |
| `timeout` | `"5m"` | Combien de temps attendre l'utilisateur. En millisecondes, ou une chaîne comme `"90s"` ou `"10m"` |

### `tokenFile(path)`

| Membre | Renvoie | Ce qu'il fait |
| --- | --- | --- |
| `load()` | `Promise<Tokens \| undefined>` | Lit le fichier. `undefined` s'il n'existe pas |
| `save(tokens)` | `Promise<void>` | Écrit le fichier, en créant son dossier si besoin |

### Flux pour appareils

| Méthode | Renvoie | Ce qu'elle fait |
| --- | --- | --- |
| `oauth.requestDeviceCode({ scopes })` | `Promise<DeviceCode>` | Démarre le flux |
| `oauth.pollDeviceToken(device, { signal })` | `Promise<Tokens>` | Attend l'approbation, puis range et renvoie les jetons |

| Champ de `DeviceCode` | Sens |
| --- | --- |
| `userCode` | Code que l'utilisateur saisit sur la page de vérification |
| `verificationUrl` | Page que l'utilisateur ouvre sur un autre appareil |
| `expiresIn` | Secondes avant l'expiration des codes |
| `interval` | Secondes à attendre entre deux interrogations. 5 quand Google n'en donne pas |
| `deviceCode` | Code que `pollDeviceToken()` envoie à Google pendant l'attente |

## Voir aussi

- [OAuth 2.0](/auth/oauth/) : le parcours qui se cache derrière `authorize()`, le rafraîchissement et les erreurs.
- [Scopes](/auth/scopes/) : ce qu'il faut mettre dans `scopes`.
- [Mettre en ligne depuis un script](/recipes/upload-from-a-script/) : un programme complet construit sur cette page.
- [Environnements d'exécution](/reference/runtimes/) : ce dont le point d'entrée `/node` a besoin.
