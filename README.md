<div align=center>
<span style="font-size:30px;">@ix-xs/youtube.api</span><br>
<br>
</div>

<h1>🌐API</h1>
<h3>🗝️Récupérer une clé</h3>
Pour créer votre clé, rendez-vous sur <a href="https://console.cloud.google.com/welcome">votre console google</a> et Créez un nouveau projet si ce n'est pas encore fait. Une fois votre projet créer, générez une clé en vous rendant dans <b>"API et services"</b> -> <b>"Identifiants"</b> -> <b>"Créer des identifiants"</b> -> <b>"Clé API"</b><br>
<br>
<h2>✨Installation</h2>

`npm install @ix-xs/youtube.api`
<br>
<h2>👀Utilisation</h2>
<h3>1. Créez un nouveau client en fournissant votre clé API Google :</h3>

```js
const YoutubeAPI = require("@ix-xs/youtube.api");

const client = new YoutubeAPI({ apiKey:"votre_clé_api" });
```
<h3>2. Liste des appels possibles</h3>

Méthode | options | Description |
| --- | --- | --- |
| `getChannelByUsername()` | `username`:string; | Récupère les informations d'une chaîne utilisateur. |
| `getChannelById()` | `id`:string; | Récupère les informations d'une chaîne utilisateur. |
| `getLastVideoByUsername()` | `username`:string; | Récupère les informations sur la dernière video de l'utilisateur. |
| `getLlastVideoByChannelId()` | `id`:string; | Récupère les informations sur la dernière video de l'utilisateur. |

<h3>3. Exemples</h3>

```js
const YoutubeAPI = require("@ix-xs/youtube.api");

const client = new YoutubeAPI({ apiKey:"votre_clé_api" });

client.getChannelByUsername("GoogleDevelopers").then(console.log); // Renvoi les informations de la chaine utilisateur.

client.getChannelById("UC_x5XG1OV2P6uZZ5FSM9Ttw").then(console.log); // Renvoi les informations de la chaine utilisateur.

client.getLastVideoByUsername("GoogleDevelopers").then(console.log); // Renvoi les informations sur la dernière video de l'utilisateur.

client.getLastVideoByChannelId("UC_x5XG1OV2P6uZZ5FSM9Ttw").then(console.log); // Renvoi les informations sur la dernière video de l'utilisateur.
```
