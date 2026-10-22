# Bringing Expert into a dashboard (the "Expert page")

Expert today is a desktop widget. The same code can run as a page inside any web dashboard. This
guide is generic: it does not assume a particular dashboard, language or hosting.

## The privacy rule

1. **Profiling stays on the user's computer.** The CV is read and turned into a domain mix only by
   a process running on the user's own machine (the desktop app or `expert-cli serve`).
2. **Only derived domain weights may be shared with a server, and only with the user's opt-in.**
   That is the `DomainProfile` contract: weights, short evidence labels (terms from the domain
   registry and dates), no CV text, no file name.
3. News requests never depend on the CV (see the README, "Privacy"). Watchlist company names are
   the only user-chosen search words, and the user can switch them off.

## What a dashboard gets

| Contract | File | Use |
|---|---|---|
| `DomainProfile` | `contracts/DomainProfile.v1.schema.json` | Domain weights (sum 100, at most 4) and evidence, `source` auto / manual / fallback. The input for any scoring. |
| `CompanySignal` | `contracts/CompanySignal.v1.schema.json` | `{ company, tag, date, url, domain, source }`: hiring growth or cuts, funding or a career fair about a named company. |
| `NewsItem` | `contracts/NewsItem.v1.schema.json` | One news card: headline, short summary, link, tag, domain, dates, seen/useful. |
| `EmployerDirectory` | `contracts/EmployerDirectory.v1.schema.json` | Verified companies per domain and tier. |
| `SourceHealth` | `contracts/SourceHealth.v1.schema.json` | Which news sources worked on the last Refresh. |
| `UserFeedback` | `contracts/UserFeedback.v1.schema.json` | seen, visited, useful, not-useful, undo-not-useful. |

Every document carries `schemaVersion`. A breaking change adds a `v2` schema next to `v1`. The
TypeScript types in `packages/core/src/contracts.ts` are written by hand and checked against the
schemas in `test/contracts.test.ts` and `test/service.test.ts`.

## Three ways to integrate

### Option A: shared core package in a Node backend

The dashboard's backend imports `packages/core` (pure TypeScript, no file or network access) and
`packages/node` (fetcher, caches, state files) and runs `ExpertEngine` itself.

- Pros: one deployment; the backend can combine company signals with its own data; no local
  process on the user's machine.
- Cons: **the CV would have to reach the server to be profiled, which breaks rule 1.** Only usable
  if the backend never profiles CVs, for example if it receives a `DomainProfile` the user
  produced locally and chose to upload (rule 2), and uses the core only for news and employers.
- Work: package `packages/core` as an npm package (it is already free of Electron and Node APIs;
  `npm run typecheck` enforces it), give it a database-backed `StateStore`.

### Option B: local service called by the dashboard page (recommended)

The user runs `expert-cli serve` (or, later, the desktop app in service mode) on their computer.
The dashboard page calls it on `http://127.0.0.1:<port>` from the browser, or mounts the ready-made
UI with `<expert-page>`.

- Pros: rule 1 holds by construction; the dashboard server sees nothing unless the page sends the
  `DomainProfile` on with the user's consent; works with any dashboard stack.
- Cons: the user must run a local program; the page must know the port and the token.
- Status: implemented and tested (`packages/cli/src/serve.ts`, `test/service.test.ts`). Not yet in
  the desktop app; not tested on macOS or Linux.

### Option C: embedded UI with the core in the backend

The dashboard shows the Expert UI (`<expert-page>`), and its backend runs the core as in option A,
serving the same `/v1` API.

- Pros: same look as the widget; no local program.
- Cons: same CV problem as option A; only valid when profiling happens elsewhere on the user's
  machine and just the `DomainProfile` reaches the backend.

## The local service (option B)

```sh
npm run compile
node dist/packages/cli/src/cli.js serve --cv <path to CV> --allow-origin http://localhost:3000
# prints the URL, a token, and an example page link with #token=…
```

- Listens on `127.0.0.1` only. Every `/v1` request needs `Authorization: Bearer <token>`.
- Requests with an `Origin` header are accepted only from the service itself and from
  `--allow-origin` origins (CORS headers only for those). The `Host` header must be
  `127.0.0.1:<port>` or `localhost:<port>`.
- Bodies of at most 64 KB. Answers never contain CV text; `/v1/view` also hides the CV file name
  and folder path.

| Method and path | Answer |
|---|---|
| `GET /v1/health` | `{ schemaVersion, status, refreshing, lastUpdated, sources: SourceHealth }` |
| `GET /v1/profile` | `DomainProfile`, or 404 before the first readable CV |
| `GET /v1/employers` | `{ schemaVersion, domains: [{ domain, label, weight, starterList: EmployerDirectory \| null, own }], watchlist }` |
| `GET /v1/news` | `{ schemaVersion, items: NewsItem[], companySignals: CompanySignal[] }` |
| `POST /v1/refresh` | Runs a Refresh, answers `SourceHealth` |
| `POST /v1/feedback` | Body `UserFeedback`, answers 204 |
| `POST /v1/settings` | `{ theme?, watchlistSearch? }` |
| `PUT` / `DELETE /v1/profile/manual` | Set domains by hand `{ weights: [{ domain, weight }] }` / back to automatic |
| `GET /v1/view` | The UI's view model (for `<expert-page>` only; may change without a version bump) |

### Mounting the UI

```html
<script type="module" src="http://127.0.0.1:4317/ui/packages/ui/src/expertPage.js"></script>
<expert-page api="http://127.0.0.1:4317" token="…"></expert-page>
```

The element uses Shadow DOM, so dashboard styles do not leak in or out. It has no round button and
no window controls; it fills its container. Fonts fall back to the system font inside the Shadow
DOM. See `examples/expert-page/index.html`, served at `/example/`.

## Open points before a real integration

Questions about the dashboard that decide the option and the work:

1. In which language and framework is the dashboard's front end built, and can it load a module
   script or a web component?
2. Where does the dashboard run (local only, a private server, the internet), and who can reach it?
3. Does each user run something on their own computer already, or must everything be in the browser?
4. Where do users' CVs live today, and is any CV processed on a server now?
5. Should the domain weights be stored on the server, and is an opt-in screen acceptable there?
6. How does the scoring system expect its input (push, pull, batch), and how often?
7. Are there users outside Germany or outside the 31 domains?
8. Is one CV per user enough, or are there several profiles per user?
9. How should the dashboard learn the local service's port and token (manual paste, a pairing
   step, a fixed port)?
10. Must the Expert page work offline, and what should it show when the local service is not running?
11. Which origins (scheme, host, port) will call the service?

## Not done yet

- A service mode inside the desktop app (today only `expert-cli serve`).
- A pairing flow for the token; today it is copied from the terminal.
- Packaging `packages/core` as a published npm package.
