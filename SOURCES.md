# News sources

Checked on 10 October 2026 against the live sites. Every source has an adapter test in
`test/adapters.test.ts` that runs against a saved copy of the page in `test/fixtures/sources/`.

All sources are fetched politely: User-Agent
`ExpertWidget/<version> (personal desktop widget; manual refresh only)`, robots.txt checked (cached
for a day), at least 2 s between requests to the same host, ETag / Last-Modified revalidation, at
most one fetch per source per Refresh. Only headline, a short excerpt, date, source and link are
kept.

None of the robots.txt files checked disallow the pages used.

| Source | Topic | Method | Enabled | Status |
|---|---|---|---|---|
| VDI nachrichten Recruiting Tag | Career fair | HTML adapter | yes | works |
| messen.de Karrieremessen | Career fair | HTML adapter | yes | works |
| ingenieur.de Wirtschaft | Hiring signal | RSS | yes | works, slow-moving |
| ingenieur.de (all news) | Hiring signal | RSS | yes | works (added, see below) |
| Eurofound Restructuring Monitor | Hiring signal | HTML adapter | yes | works, lags about a week |
| produktion.de Wirtschaft | Hiring signal | HTML adapter | yes | works |
| Startbase | Funded startup | RSS | yes | works |
| Munich Startup | Funded startup | RSS | **no** (Munich only, per brief) | works |

## VDI nachrichten Recruiting Tag (ingenieur.de)

- **URL:** `https://www.ingenieur.de/recruiting-tag/` (the brief's `/recruiting-tage/` redirects here).
- **Feed:** none. `/recruiting-tag/feed/` exists but is a WordPress *comments* feed with no items.
- **Adapter:** `ingenieur-recruiting-tag`. Reads `table.recruiting-table`; each row is weekday,
  date (`28.10.2026`), city and a "Details ansehen" link to the city page.
- **Works:** event date, city, link. Headline is built as "VDI nachrichten Recruiting Tag <city>".
- **Does not:** no exhibitor list or times (they are on the city pages, which are not fetched).
- **Fragility:** the table class and the column order. Usually only one or two upcoming dates are
  listed. If the table is ever empty, the refresh reports "no items found".

## messen.de career fairs

- **URL:** `https://www.messen.de/de/1594/branche/karrieremessen`
- **Feed:** none (`/rss`, `/feed` are 404; no `<link rel="alternate">`). The page has JSON-LD, but
  only names and links, no dates.
- **Adapter:** `messen-de`. Reads each `<article>` card: `h3 a` (name, link), first `<p>`
  (description), the span after "Termin:" (one date or a range `09.10.2026 – 10.10.2026`) and the
  span after "Ort:".
- **Works:** 25 fairs on the first page, all with dates and places.
- **Does not:** only the first page (soonest fairs). Many listings are apprenticeship or
  school-leaver fairs; they are dropped by `keywords.fairExclude` (Azubi, Ausbildung, Abi, Schule
  …). The list also includes a few fairs in Austria. Fairs are not matched to domains beyond
  "All domains" unless their name contains a domain keyword.
- **Fragility:** relies on the visible labels "Termin:" and "Ort:" and on `<article>`/`h3`;
  Tailwind class names are deliberately not used. Fair slots are shared between sources, so this
  long list cannot push out the VDI Recruiting Tag.

## ingenieur.de Wirtschaft

- **URL:** `https://www.ingenieur.de/wirtschaft/feed/` (WordPress category feed; found by trying the
  common `/feed/` path, the page itself does not advertise it).
- **Adapter:** `rss`. Title, link, `pubDate` and the short `description` (the WordPress
  "Der Beitrag … erschien zuerst auf …" footer is removed). `content:encoded` (full article) is
  ignored.
- **Works:** 10 newest items with dates.
- **Does not:** the category is updated irregularly. On 10 Oct 2026 the newest item was from
  9 Sep 2026, so with `newsMaxAgeDays: 7` it often contributes nothing.
- **Fragility:** low (standard feed).

## ingenieur.de (all news), added

- **URL:** `https://www.ingenieur.de/feed/`
- **Why:** the Wirtschaft feed alone is too slow for a 7-day window. The site-wide feed is updated
  several times a day. Only items that match the hiring keywords are shown, the rest are dropped.
- **Adapter:** `rss`. Same notes as above. Disable it in `config.json` if you prefer only the
  economy section.

## Eurofound European Restructuring Monitor

- **URL:** `https://apps.eurofound.europa.eu/restructuring-events/search?Country=Germany`
  (the search form's own `Country` parameter, so only German events are fetched).
- **Feed:** none.
- **Adapter:** `eurofound-erm`. Reads `table.restructuring-events-table`: announcement date,
  country, company, sector, restructuring type, employment change. The headline is written by the
  code from these fields ("Bosch: 900 jobs to go", "Aaronia: 150 new jobs planned"), the excerpt is
  "type · sector · country". A negative change is tagged hiring cuts, a positive one growth.
- **Works:** the 10 newest German events with dates, linked to the event factsheet.
- **Does not:** events are added about a week after the announcement, so with
  `newsMaxAgeDays: 7` many are already too old when they appear. Raise `newsMaxAgeDays` to 14 if
  you want to see them. Sectors are broad ("Manufacturing"), so the domain usually comes only from
  company-name keywords.
- **Fragility:** table class and column order. No robots.txt on that host.

## produktion.de Wirtschaft (optional in the brief, enabled)

- **URL:** `https://www.produktion.de/wirtschaft/`
- **Feed:** none (`/feed/`, `/wirtschaft/feed/`, `/rss.xml` are 404 or time out).
- **Adapter:** `produktion-de`. Reads `article.article-teaser-box` using schema.org attributes:
  `a[itemprop=url]`, `[itemprop=headline]`, `[itemprop=description]`,
  `time[itemprop=datePublished]`.
- **Works:** about 40 teasers with exact publication times.
- **Does not:** most teasers are general economy news; only those matching hiring keywords are
  shown.
- **Fragility:** low to medium. The itemprop attributes are more stable than CSS classes.

## Startbase

- **URL:** `https://www.startbase.de/feed/` (the home page `https://www.startbase.de/` timed out
  during the check; the feed answered normally).
- **Adapter:** `rss`.
- **Works:** 10 newest items with dates, including funding news ("TODAY erhält 2,8 Millionen
  Euro").
- **Does not:** the feed mixes funding news with founder portraits and weekly round-ups. Only items
  matching the funded-startup keywords are kept. Many funded startups are not engineering
  (real estate, fintech); they appear only as a fallback when nothing matches your domains.
- **Fragility:** low.

## Munich Startup (disabled by default)

- **URL:** `https://www.munich-startup.de/feed/`
- **Adapter:** `rss`. Works (20 items with dates). Disabled as the brief asks (Munich only). Set
  `"enabled": true` to use it.
