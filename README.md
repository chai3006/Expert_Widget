# Expert Widget

A desktop widget for job seekers in Germany, for every field of work. It has three tasks:

1. **Read your CV and find your fields.** You put one CV (German or English, PDF, Word or text) in
   a folder. The widget reads it on your computer and works out your domain mix (up to 4 of 31
   fields, in whole percentages), giving your current role the most weight.
2. **Show employers for those fields**: career pages of top companies, suppliers, service and
   staffing companies in Germany, from a checked starter list.
3. **Show news for those fields in Germany**: hiring growth, hiring cuts, funded startups and
   career fairs.

It sits on the screen as a small round button and opens into a panel docked to the right edge. It
changes only when you press **Refresh**: no refresh at start-up, no timer. The same code can also
run as an **Expert page** inside a web dashboard (see `docs/EXPERT_PAGE_INTEGRATION.md`).

**Tested on:** Windows 11 only. macOS and Linux are supported in the code, the build config and the
CI workflow, but **no person has run the widget on a Mac or a Linux PC yet**. Do not rely on them
until someone has.

More pages: [`docs/installation.html`](docs/installation.html) (installing step by step) and
[`docs/how-it-works.html`](docs/how-it-works.html) (what happens on Refresh). Both were written for
the earlier engineering-only version and are not yet updated for all fields.

## Privacy

- **Your CV stays on your computer.** Its text is read in memory, turned into domain weights, and
  dropped. It is never stored, logged, sent anywhere, or given to an AI service. What is kept: the
  file name, size and modified time, the domain weights, and short evidence labels (terms from the
  domain list such as "Pflegefachkraft" plus dates such as "2021 to now").
- **The news requests are the same for everyone.** Every enabled news feed is fetched, and the
  GDELT search (and Google News, if switched on) is asked the same seven broad topic queries for
  every user, whatever the CV says. Your domain mix only filters and ranks the results on your
  computer. `test/privacy.test.ts` checks that a nurse's, an engineer's and a lawyer's CV produce
  exactly the same requests.
- **Watchlist names are the only words of yours that are sent.** Each company on your watchlist is
  searched by its name. Switch this off in the Watchlist section ("Searching the news for these
  names") or with `"search": { "watchlist": false }` in `config.json`.
- **No AI at runtime.** The app makes no AI calls and needs no key. AI is used only by maintainers
  to propose company lists, which are then checked automatically (`docs/COMPANY_DIRECTORY.md`).
- Requests identify themselves, obey robots.txt, are spaced per host (5.5 s for GDELT), cached, and
  made only when you press Refresh (GDELT at most every 15 minutes).

## Install and build

Needs Node.js 20 or newer (developed with Node 24) and npm.

```sh
npm install
npm run dev:mock    # full UI with built-in mock data, no network, no CV needed
npm start           # real data
```

| Script | What it does |
|---|---|
| `npm run dev` / `dev:mock` / `start` | Compile and start (DevTools open / mock data / plain) |
| `npm test` | Unit tests (no network; sources are tested against saved pages) |
| `npm run typecheck` | Type-check core (without Node or DOM types), Node, desktop, UI, tests and tools |
| `npm run build` | Installer for the system you are on, into `release/` |
| `npm run build:win` / `build:mac` / `build:linux` | NSIS installer / `.dmg` for the Mac's own CPU / AppImage and `.deb` |
| `npm run cli -- --cv <file> --json` | `expert-cli`: the pipeline without Electron (see below) |
| `npm run check-sources` | Call every news provider once and print status and a sample |
| `npm run check-links` | Check the links in your own `employers.json` and `watchlist.json` |
| `npm run directory:generate` / `directory:verify` / `directory:review` | Company directory tooling (maintainers) |
| `npm run icons` | Regenerate the app and tray icons |

`npm run compile` downloads the offline German→English translation model once
(`assets/translation/README.md`). Without it the widget works, without translations.

**Build each installer on its own system** (the CI workflow does this, one runner per system and
per Mac CPU type): PDF reading needs a native module per system and CPU.

| System | Installer | Not signed: what you see | Known limits |
|---|---|---|---|
| Windows 10/11 x64 | `Expert Widget Setup <version>.exe` | SmartScreen: **More info › Run anyway** | none known; Windows on ARM has no PDF module |
| macOS (Apple silicon, Intel) | `.dmg` | First start blocked: **System Settings › Privacy & Security › Open Anyway** | untested; the hotkey is Control+Option+E; macOS asks once for access to Documents |
| Linux x64 | AppImage, `.deb` | none | untested; needs a tray (GNOME: AppIndicator extension), otherwise right-click the widget for the menu; runs under XWayland; global hotkeys may not work on Wayland |

## Using the widget

- **First start:** a welcome screen names the CV folder, with **Open CV folder** and **Choose
  another folder** buttons. Put one CV there and press **Refresh**.
- **Collapsed:** a round **E** button, always on top, with a badge counting unseen news. Drag it
  anywhere; double-click (or Enter/Space) to expand.
- **Expanded:** a 420 px panel docked to the right edge. **–** collapses it. **×** hides it to the
  tray (menu bar on a Mac); on Linux it collapses to the button instead, because many Linux desktops
  show no tray icon.
- **Domain mix** card: the mix as a bar. Click it for the percentages, the evidence for each domain
  ("Pflegefachkraft · current role · 2020 to now"), which CV file was read and when, and **Adjust
  domains** to choose up to 4 domains by hand ("Set manually"; **Back to automatic result** undoes
  it). If no field can be recognised (very short CV, another language, nothing matching), the
  widget says so, uses **General** (news for all fields) and offers to choose domains.
- **Employers for you:** the starter list for each domain in your mix, by tier (top companies, tier
  1, tier 2, service providers, SMEs, startups), with **Show more** for long lists. Click a company
  to open its career page; it is then marked *visited*. Domains without a list yet say so.
- **Watchlist:** the companies in `watchlist.json`, whatever your CV says, with a count of their
  news.
- **News feed:** filters All / Hiring / Startups / Fairs, an **EN** switch for the translations made
  on your computer, thumbs up (keep) and thumbs down (remove for good). **Sources: N of M working**
  lists each provider's last result.
- **Can't find it?** The tray icon (a teal E; on a Mac in the menu bar), the hotkey **Ctrl+Alt+E**
  (Control+Option+E on a Mac), or starting the app again (it comes to the front). **Start at login**
  is on by default after installing; switch it in the tray menu. Right-clicking the widget opens the
  same menu.

## Your files

The widget keeps your files in **ExpertWidget** in your Documents folder (the system's Documents
folder, also when it is moved or synced by OneDrive; earlier versions used `<home>/Documents`, and
an existing folder there keeps being used):

```
ExpertWidget/
  CV/              exactly one CV: .pdf, .docx or .txt, German or English
  config.json      settings (all optional additions; the lists ship in data/)
  employers.json   companies of your own, added after the starter list
  watchlist.json   companies you keep an eye on
```

Edit, save, press Refresh. A broken file shows the exact problem instead of crashing.

**CV problems** each have a plain message and a next step: no file, several files, an unsupported
type (.doc, .odt, images…), a password-protected PDF, a scanned PDF without text, almost no text,
a file over 20 MB, a file open in another program, no permission for the folder. A replaced CV
(other name, size or modified time) is noticed on Refresh and replaces the old profile.

### config.json

| Key | Meaning |
|---|---|
| `cvFolder` | `""` (default): the `CV` folder next to `config.json`. Or a path; `~`, `%VAR%` and (macOS/Linux) `$VAR` are expanded. "Choose another folder" in the app overrides it. |
| `cvAnalysis` | `{ "halfLifeYears": 5, "currentRoleBoost": 1.5, "ignoreWords": [] }`, see "How the domain mix is computed" |
| `newsMaxAgeDays` | Hide news older than this (default 7). Fairs disappear after their date. |
| `maxItemsPerTag` | Most cards per group (default 12) |
| `hotkey` | `"default"` (Ctrl+Alt+E; Control+Option+E on a Mac), a combination such as `"Ctrl+Shift+X"`, or `""` for none |
| `search` | `{ "gdelt": { "enabled": true, "maxRecords": 75 }, "googleNews": { "enabled": false }, "watchlist": true }` |
| `sources` | `[{ "id": "munich-startup", "enabled": true }]` switches a built-in source on or off; an entry with a new id and every field adds a source of your own |
| `keywords` | Extra words: `{ "domains": { "<id>": [...] }, "tags": { "hiring_growth": [...] }, "fairExclude": [...] }`, added to the lists in `data/` |

Older `config.json` files with the full keyword and source lists keep working: built-in sources
only take their `enabled` setting from them, and the keyword lists are added to the shipped ones.

### employers.json and watchlist.json

`employers.json`: `{ "segments": [{ "domain": "<id>", "segment": "My list", "companies": [{ "name": "…", "careerUrl": "https://…" }] }] }`.
Your companies appear after the starter list, without duplicates.

`watchlist.json`: `{ "companies": [{ "name": "…", "website": "", "note": "" }] }`. A news item
counts for a company when it names it exactly as a whole word.

## How the domain mix is computed

The CV is split into its sections (Berufserfahrung / Work experience, Ausbildung / Education,
Kenntnisse / Skills, Zertifikate / Certifications, Projekte / Projects, Sprachen / Languages) and,
in experience and education, into entries with their dates ("01/2020 – heute", "2016 - 2020",
"seit März 2021", "Jan 2019 – Present"). Each domain in `data/domains` scores points:

| Signal | Points per hit |
|---|---|
| job title in an experience entry | 6 × entry weight |
| degree, training or certificate | 4 (education entries × education weight) |
| domain word in a skills or certificates list | 2 (each word once) |
| domain word in an experience entry | 1 × entry weight (each word at most 3 times) |
| job title in the profile or header | 3 |
| domain word anywhere else | 0.5 (each word at most twice) |

**Entry weight** (current and previous experience):

```
recency  = 0.5 ^ (years since the role ended / halfLifeYears)     a current role has ended "now"
duration = min(1, 0.5 + years in the role / 4)
weight   = recency × duration × (currentRoleBoost for the current or most recent role, else 1)
```

Undated entries count 0.6. Education fades half as fast. `halfLifeYears` (default 5) and
`currentRoleBoost` (default 1.5) are set in `config.json` `cvAnalysis`. A CV without any known
heading is read as one block (titles 4, education 3, words 1).

Matching: case and umlaut spelling do not matter (ä = ae); words of 6+ letters also match inside
compounds; plurals and female forms with an umlaut are found ("Pflegefachkräfte", "Köchin"); short
words take German and English endings; job titles must start at a word ("Controller" is not found
in "Microcontroller"). Words every CV has ("Projekt", "Team", "Kommunikation", …) never count; add
your own in `cvAnalysis.ignoreWords`.

Then: each domain's share of all points, domains under 5 % dropped, at most 4 kept, whole numbers
summing to 100, ties in registry order. Under 30 words, another language, or under 3 points in all:
the **General** domain with a note.

## Adding a domain, a source or a company

- **A domain:** add `data/domains/<id>.json` (format: `data/domains.schema.json`: labels in German
  and English, a one-sentence description, a `sector` from `data/news.json`, keywords with weights,
  job titles, education patterns). Nothing else changes; `npm test` checks every file.
- **A news source:** add it to `data/sources.json` (RSS preferred; HTML adapters live in
  `packages/core/src/news/adapters/`). Check robots.txt and the site's terms first and document
  both in `SOURCES.md`. Users can add their own in `config.json` `sources`.
- **A company:** see `docs/COMPANY_DIRECTORY.md` (format, verification, generator, review).

## expert-cli and the local service

```sh
npm run compile
node dist/packages/cli/src/cli.js --cv ./Lebenslauf.pdf --no-network          # short summary
node dist/packages/cli/src/cli.js --cv ./Lebenslauf.pdf --json                 # data payload
node dist/packages/cli/src/cli.js serve --cv ./Lebenslauf.pdf                  # local API for the Expert page
```

`--config <dir>` uses that folder's `config.json`, `employers.json` and `watchlist.json`;
`--state <dir>` keeps state between runs. The service (`serve`) listens on 127.0.0.1 only and
needs its token on every request; see `docs/EXPERT_PAGE_INTEGRATION.md`.

## Project layout

```
packages/core/     pure TypeScript: types, contracts, config validation, domain registry, CV profiler,
                   news rules and adapters (parsing only), refresh pipeline, view, engine.
                   No Electron, DOM, files or network (checked by test/boundaries.test.ts and tsconfig.core.json)
packages/node/     Node adapters: CV text extraction, JSON state files, HTTP cache, polite fetcher, translator
packages/ui/       the UI (no framework); widget.ts for the desktop, expertPage.ts (<expert-page>) for web pages
packages/cli/      expert-cli and the local service
apps/desktop/      the Electron shell: main process, preload, tray, window, start at login
contracts/         JSON Schemas with schemaVersion: DomainProfile, EmployerDirectory, CompanySignal, NewsItem, SourceHealth, UserFeedback
data/              domains/, news.json (topics, signal words), sources.json, employers/
defaults/          the files copied to ExpertWidget on first start
tools/             company-directory (maintainer tooling with the Claude API)
examples/          expert-page/: a page that mounts <expert-page>
docs/              guides; AI_PROFILER_DESIGN.md (an optional later AI profiler, not implemented)
```

The packages are folders compiled by the root `tsconfig` files, not npm workspaces yet, so
packaging stays unchanged.

## Local state

In Electron's `userData` folder (`%APPDATA%\Expert Widget\`, `~/Library/Application Support/Expert Widget/`,
`~/.config/Expert Widget/`), plain JSON written via temp file and rename: `feed-cache.json`,
`profile.json` (file name, size, modified time, weights, evidence, a manual choice, the last CV
problem), `interactions.json`, `ui.json` (theme, window, chosen CV folder, watchlist search
switch), `health.json`, `http-cache/`. A damaged file is set aside as
`<name>.corrupt-<time>.json`. Mock mode uses `mock-state/`.

## Development aids (from source only)

`EXPERT_WIDGET_HOME=<folder>` (another ExpertWidget folder), `EXPERT_WIDGET_USER_DATA=<folder>`
(throw-away state), `EXPERT_WIDGET_CAPTURE=<file.png>` with optional `EXPERT_WIDGET_CAPTURE_JS`
(save an image of the window after start-up).

## Licence

Not decided yet (`package.json` says UNLICENSED). The repository is private.
