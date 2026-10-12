# Security policy

## Supported versions

The latest `2.x` release on npm receives security fixes.

| Version | Supported |
| --- | --- |
| 2.x | yes |
| 1.x | no |

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Report privately through GitHub's [security advisories](https://github.com/ix-xs/youtube.api/security/advisories/new),
or email **contact@ix-xs.dev**. Include a description, the affected versions, and a
minimal reproduction if possible.

You will get an acknowledgement, and a fix will be released as promptly as the
severity warrants, with credit unless you prefer to remain anonymous.

## What the library does with your credentials

- The API key is sent in the `X-Goog-Api-Key` header, never in a URL.
- Access tokens are only sent to Google's API hosts, unless you point
  `baseUrl` somewhere else: the key and the tokens then go to that host.
  `yt.reporting.download()` refuses any host but Google's.
- URLs in errors and events have credentials removed.
- Nothing is written to disk unless you call `tokenFile()`, which creates the
  file readable by the current user only.
