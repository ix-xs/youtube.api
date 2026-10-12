# Contributing to `@ix-xs/youtube.api`

Thanks for helping out. Everything below runs from the repository root.

## How the code is organised

| Path | What it is |
| --- | --- |
| `scripts/discovery/` | Google's discovery documents, pinned. The source of truth for types |
| `scripts/api.config.mjs` | What the discovery documents do not say: a summary, the quota cost and an example for each method, and which fields are always present |
| `scripts/generate.mjs` | Turns the two above into `src/generated/` |
| `src/generated/` | Generated. Never edit by hand |
| `src/core/` | Request pipeline, pagination, quota, cache, uploads, errors |
| `src/auth/` | OAuth 2.0 |
| `src/resources/`, `src/live/`, `src/feeds/` | Hand-written helpers on top of the generated methods |
| `src/node.ts` | The `@ix-xs/youtube.api/node` entry point, the only code that needs Node.js itself |
| `test/` | Unit tests (`*.test.ts`), type-level tests (`types/`), smoke tests of the build (`smoke/`), checks against the real API (`live/`) |
| `docs/` | The documentation site |

## Everyday commands

| Command | What it does |
| --- | --- |
| `npm run check` | Everything CI runs: generated files up to date, prose, types, build, unit tests, smoke tests. Run it before pushing |
| `npm test` | Unit tests |
| `npm run test:types` | Type-level tests, plus every doc example and README sample |
| `npm run generate` | Rebuild `src/generated/` after touching the config or the generator |
| `npm run discovery:update` | Fetch the current discovery documents and list what changed |
| `npm run live` | Check the library against the real API. Needs `YOUTUBE_API_KEY` in `.env`, costs about 15 quota units |
| `npm run attw` | Verify the published types resolve in CommonJS, ESM and bundlers |
| `npm run docs` | Serve the docs site locally |

## When YouTube changes the API

1. `npm run discovery:update` prints the new and removed methods and schemas.
2. Describe each new method in `scripts/api.config.mjs`: a summary written for
   someone discovering it in their editor, its quota cost, an example. The
   generator refuses to run while a method has no entry.
3. `npm run generate`, then `npm run check`. The examples are compiled, so a
   wrong one fails here.
4. Add a line to `CHANGELOG.md`.

## Marking a field as always present

The discovery documents mark nothing as required, so every field would be
`T | undefined`. `required` in `scripts/api.config.mjs` lists the fields the
API returns for every resource. Be conservative: a field only belongs there if
it is present on private, deleted and brand new resources too. `npm run live`
checks the list against real responses.

## Style

- Doc comments are written for the person reading them in a tooltip: what the
  thing does, what it costs, one example. No history, no implementation notes.
- No long dashes anywhere (`npm run lint:prose` enforces it). Use a spaced
  hyphen, a comma or a new sentence.
- No runtime dependency. The library runs wherever `fetch` does.
- One change per pull request, with a test.
