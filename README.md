# Expert Widget

A small standalone Windows desktop widget for personal use. It reads your CV from a local folder,
works out your domain mix, and shows matching engineering employers in Germany (with career-page
links) plus a news feed of hiring signals, funded startups and career fairs.

It changes only when you press **Refresh**: no refresh at start-up, no timer.

## Requirements

- Windows 10 or 11
- Node.js 20 or newer (developed with Node 24.19) and npm

## Setup

```powershell
npm install
npm run dev:mock    # full UI with built-in mock data, no network, no CV needed
npm run dev         # real data; opens DevTools in a separate window
```

| Script | What it does |
|---|---|
| `npm run dev` | Compile and start with real data, DevTools open |
| `npm run dev:mock` | Compile and start with mock data (separate state folder, no network) |
| `npm start` | Compile and start with real data |
| `npm test` | Unit tests (no network: sources are tested against saved pages) |
| `npm run typecheck` | Type-check main, renderer and tests |
| `npm run build` | Build the NSIS installer into `release/` |
| `npm run check-links` | Check every career URL in `defaults/employers.json` (add `-- --write` to record `lastVerified`, `-- --file <path>` for another file) |
| `npm run icons` | Regenerate the app and tray icons |

Electron 44 downloads its binary on first start. If `npm run dev` says it is downloading Electron,
let it finish once.

## Using the widget

- The window docks to the right edge of the primary screen, stays on top and remembers its
  position and size. Drag it by the header. The **×** button and closing hide it to the tray.
- Tray menu: Show/Hide, Refresh now, Start with Windows, Quit. Clicking the tray icon toggles the
  window. Only one instance runs at a time.
- **Refresh** reads the CV, recomputes the domain mix, updates employers, fetches the news sources
  and updates **Last updated**. If the PC is offline or a source fails, cached data stays and a
  short message says so.
- Click a company chip to open its career page in your browser. It is then marked *visited* and
  moves to the end of its segment. Click a news card to open the article; it becomes *Seen* and
  sinks to the bottom.
- The sun/moon button switches day and dark mode.

## Your files

On first start the widget creates `%USERPROFILE%\Documents\ExpertWidget\`:

```
Documents\ExpertWidget\
  CV\              put exactly one CV here (.pdf, .docx or .txt, German or English)
  config.json      settings, sources and keyword lists
  employers.json   employer segments and career links
```

Edit the JSON files with any text editor, save, and press Refresh. If a file is invalid, the
widget shows the exact problem (file, path inside the JSON, what is expected) instead of
crashing.

### The CV stays on this PC

The CV is read and scored in the main process. Its text is never stored and never sent anywhere,
not even as part of a search: news and career lookups use only fixed source URLs. Only the result
is kept: file name, modified time and domain weights.

If the folder has no CV or more than one, the widget says so and names the folder. If the CV cannot
be read (locked, damaged, a scanned PDF without text), the previous domain mix stays and the reason
is shown.

### config.json

| Key | Meaning |
|---|---|
| `cvFolder` | CV folder. `%VARIABLES%` are expanded. Default `%USERPROFILE%\Documents\ExpertWidget\CV` |
| `newsMaxAgeDays` | News older than this is hidden (default 7). Career fairs are hidden after their event date instead. |
| `maxItemsPerTag` | Most cards per group (hiring signals, funded startups, career fairs). Default 12. |
| `sources` | News sources, see below |
| `keywords.domains` | Keyword list per domain, German and English. Used to score the CV and to match news to domains. **The order of the domains is the tie-break order.** |
| `keywords.tags` | Keywords for `hiring_cuts`, `hiring_growth` and `funded_startup` |
| `keywords.fairExclude` | Career fairs whose name contains one of these are skipped (apprenticeship and school-leaver fairs) |

Domain ids: `automotive-emobility`, `semiconductors`, `embedded-iot`, `industrial-automation`,
`energy-storage`, `aerospace-defense`, `machinery-household`, `medtech`, `rail-transport`,
`telecom`, `software-ai`, `civil-chemical`.

**How keywords match:** case-insensitive; umlauts are folded (ä = ae, ö = oe, ü = ue, ß = ss);
keywords of 6 or more characters also match inside longer words ("Batterie" matches
"Batteriezelle"); shorter keywords and acronyms (ECU, PLC, KI) must stand alone as a word.

**Domain mix:** each domain's share of all keyword hits in the CV. Domains below 5 % are dropped,
at most 4 are kept, and the shares are re-normalised to whole numbers summing to 100.

**News selection:** each item gets a tag (cuts, growth, funded, fair) and a domain (the domain
with most keyword hits, or "All domains"). Items for domains outside your mix are not shown.
Hiring signals and funded startups are shared out in proportion to your domain weights; general
hiring news fills free slots; general startup news is shown only when none matches your domains.
Nothing is padded with unrelated items.

### employers.json

```json
{
  "segments": [
    {
      "domain": "automotive-emobility",
      "segment": "OEMs and battery",
      "companies": [
        { "name": "Mercedes-Benz", "careerUrl": "https://group.mercedes-benz.com/karriere", "lastVerified": "2026-10-10" }
      ]
    }
  ]
}
```

Only segments for domains in your CV mix are shown, highest weight first. A domain in your mix with
no segments shows "No employers listed yet for …". `lastVerified` is the date a link last answered
successfully in `npm run check-links`. Leave it empty for new entries.

## Adding a news source

1. Look for a feed first: `<link rel="alternate" type="application/rss+xml">` in the page, or paths
   like `/feed/`, `/rss`. If there is one, add a source with `"adapter": "rss"`:

   ```json
   {
     "id": "my-source",
     "topic": "hiring",
     "name": "My Source",
     "url": "https://example.com/feed/",
     "adapter": "rss",
     "enabled": true,
     "domains": "all"
   }
   ```

   `topic` is `hiring`, `funded_startup` or `career_fair`. `domains` is `"all"` or a list of
   domain ids. A source limited to domains is only fetched when your mix contains one of them, and
   lends its domain to items that no keyword matched.

2. Without a feed, write an adapter: a function `(html, pageUrl) => ParsedItem[]` in
   `src/main/news/adapters/html.ts` that reads only headlines, short teasers, dates and links.
   Register it in `src/main/news/adapters/index.ts` and in `ADAPTER_IDS` in `src/main/config.ts`.
   Save a copy of the page under `test/fixtures/sources/` and add a test in
   `test/adapters.test.ts`.
3. Document it in `SOURCES.md`.

Fetching is polite: a clear User-Agent, robots.txt is obeyed, requests to one host are at least
2 seconds apart, responses are cached and revalidated (ETag / Last-Modified), and every source is
fetched at most once per Refresh. Only headline, a short excerpt (max. 200 characters), date,
source and link are stored. Full article text is never stored.

## Local state

Stored in `%APPDATA%\Expert Widget\` (Electron's `userData`) as plain JSON, written via temp file
and rename:

| File | Contents |
|---|---|
| `feed-cache.json` | Items per source, Last updated time |
| `profile.json` | CV file name, modified time, domain weights, last CV problem |
| `interactions.json` | Visited companies, seen news ids |
| `ui.json` | Theme, window position and size |
| `http-cache\` | Cached responses and robots.txt |

A damaged file is renamed to `<name>.corrupt-<time>.json` and the widget starts fresh. Mock mode
uses the sub-folder `mock-state\` so mock data never mixes with real data.

## Project layout

```
src/main/          Electron main process (window, tray, IPC, refresh)
  cv/              CV file lookup, text extraction, CvProfiler (rule-based)
  news/            fetcher, adapters, Classifier (rule-based), dedupe, expiry, distribution
  state/           JSON state files
  mock/            mock data for dev:mock
src/renderer/      HTML, CSS and the UI script (no framework)
src/shared/        types, date labels, ordering rules used by both sides
defaults/          config.json and employers.json copied to Documents on first start
test/              unit tests and saved source pages
scripts/           build helpers, check-links, icon generator
```

`CvProfiler` (`src/main/cv/cvProfiler.ts`) and `Classifier` (`src/main/news/classifier.ts`) are
the seams for AI-based replacements later. This version makes no AI calls and needs no API key.

## Development aids

Only active when running from source (never in the installed app):

- `EXPERT_WIDGET_HOME=<folder>` uses another folder instead of `Documents\ExpertWidget`.
- `EXPERT_WIDGET_USER_DATA=<folder>` uses a throw-away state folder.
- `EXPERT_WIDGET_CAPTURE=<file.png>` saves an image of the window after start-up;
  `EXPERT_WIDGET_CAPTURE_JS` runs a snippet in the page first (for example to scroll).

Renderer console output is forwarded to the terminal.
