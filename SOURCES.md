# News sources

First checked on 10 October 2026; the source list, privacy design and new sources were checked
again on 22 October 2026 (see "Changes on 22 October 2026" and the check-sources results at the end). Every source has an adapter test in
`test/adapters.test.ts` that runs against a saved copy of the page in `test/fixtures/sources/`,
and `test/providers.test.ts` checks every saved page against the provider contract.

The built-in sources are listed in `data/sources.json` (`domains`: `"all"` or a list of domain
ids), the search topics and signal words in `data/news.json`. Every source is a **provider**
behind one interface (`NewsProvider`, `packages/core/src/news/provider.ts`).
Three layers feed the same list:

| Layer | Providers | Used for |
|---|---|---|
| 1 | The sources below: their RSS/Atom feed, or a small HTML adapter | Everything |
| 2 | GDELT DOC 2.0 search (no key) | Hiring signals and funded startups, one query per fixed broad topic (the same for every user) |
| 3 | Google News RSS search (no key, unofficial) | Fallback for topics GDELT left empty. **Off by default**, see below |

**Privacy.** The requests never depend on the CV. Every enabled source is fetched on every Refresh
for every user (a source's `domains` list is used only on this computer, to lend its domain to items
no keyword matched), and the searches use the seven fixed topics of `data/news.json`. The domain
mix only filters and ranks the results locally. Watchlist company names are the only words of the
user's that are sent, one search each, and the user can switch that off. `test/privacy.test.ts`
fails if any request differs between two different CVs.

**Contract.** Every response is checked before it is used: each item needs a title, an http(s)
link and a publication date. Career fairs may have no event date ("date to be confirmed") but a
date that is given must be readable. One bad item marks the provider as **failed** for this
Refresh; its earlier items stay in the cache, the others are not affected. The adapters pass an
incomplete entry on rather than skipping it, so a changed page layout shows up as a failure.

**Source health.** Each Refresh records per provider `ok`, `empty` or `failed` with a time. The
News feed shows "Sources: N of M working"; the list under it shows each provider, and one that
failed three Refreshes in a row is marked "needs attention". An offline Refresh is not counted
against the providers. `npm run check-sources` calls every provider (also the disabled ones) once
with a test query and prints the same information.

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
| Startbase | Funded startup | RSS | yes | works (one "no network connection" on 22 Oct) |
| Munich Startup | Funded startup | RSS | **no** (Munich only, per brief) | works |
| tagesschau.de Wirtschaft | Hiring signal, all fields | RSS | yes | works, added 22 Oct |
| Handelsblatt Schlagzeilen | Hiring signal, all fields | RSS | yes | works, added 22 Oct |
| Deutsches Ärzteblatt | Hiring signal, health and care | RSS | yes | works, added 22 Oct |

On 22 October 2026 two of the original sources were broken: the **VDI nachrichten Recruiting Tag**
adapter found no items (the page layout has changed; the adapter needs updating) and
**ingenieur.de Wirtschaft** (`/wirtschaft/feed/`) answered HTTP 404 (the feed has moved or gone).
Both are left as they are and show as failed in the source-health list until someone fixes them.

The engineering sources (both ingenieur.de feeds, VDI Recruiting Tag, produktion.de) are now limited
to the engineering, IT and construction domains in `data/sources.json`, so their unmatched items
no longer reach a nurse or a lawyer.

## Changes on 22 October 2026: sources for all fields

Candidates were checked live with the app's User-Agent: the feed URL, robots.txt (parsed with the
same `robots-parser` as the app) and the site's terms for RSS use. A source was added **only** when
the feed worked, robots.txt allowed it and the terms were found and fit personal use.

| Candidate | Feed | robots.txt | Terms found | Decision |
|---|---|---|---|---|
| tagesschau.de Wirtschaft `https://www.tagesschau.de/wirtschaft/index~rss2.xml` | 200, 38 items, contract ok | allowed | infoservices/rssfeeds: use "only for private, non-commercial use", no publication | **added**, domains all |
| Handelsblatt `https://www.handelsblatt.com/contentexport/feed/schlagzeilen` | 200, 50 items, contract ok | allowed | rss-feeds page: free for a personal RSS reader, **commercial use only with the publisher's permission** | **added**, domains all |
| Deutsches Ärzteblatt `https://www.aerzteblatt.de/rss/news.asp` | 200, 10 items, contract ok | allowed | service/rss: offers the feeds for use in RSS readers; no other conditions found | **added**, health, pharma, medtech, social work |
| personalwirtschaft.de `/feed/` | 200 | allowed | none found (imprint, RSS page) | not added: terms not verified |
| deutsche-startups.de `/feed/` | 200 | allowed | none found | not added: terms not verified |
| Deutsche Handwerks Zeitung `/rss` | 200 | allowed | none found | not added: terms not verified |
| agrarheute `/rss.xml` | 200 | allowed | none found | not added: terms not verified |
| HORIZONT `/news/feed/` | 200 | allowed | none found | not added: terms not verified |
| LOGISTIK HEUTE `/rss.xml` | 200 | allowed, crawl-delay 1 | none found | not added: terms not verified |
| Behörden Spiegel `/feed/` | 200 | robots.txt could not be fetched | not checked | not added |
| LTO, Haufe Personal, idw, AHGZ, Versicherungsbote, Bibliomed Pflege | 404 at the guessed feed address | not checked | not checked | not added |

Note: several of these sites' robots.txt files block AI crawlers (GPTBot, ClaudeBot and similar).
The widget is not one: it fetches a feed for one person's reader when that person presses Refresh.

**Terms to keep in mind:** tagesschau.de allows private, non-commercial use only, and Handelsblatt
requires permission for commercial use. If Expert is ever offered commercially or as a hosted
service, both must be checked again or switched off.

Not added on purpose: Google News (robots.txt disallows the search, see below).

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

## GDELT DOC 2.0 (layer 2)

- **URL:** `https://api.gdeltproject.org/api/v2/doc/doc?query=…&mode=artlist&format=json&maxrecords=75&timespan=7d&sort=datedesc`
- **Query:** `(topic words OR …) (signal words OR …) sourcecountry:germany sourcelang:german`, one
  per topic of `data/news.json` (industry; energy and construction; IT and telecoms; health, care and
  social; finance, law, consulting and HR; retail, logistics, hospitality and food; public sector,
  education and media): seven requests, the same for every user.
  The syntax follows GDELT's own description of the API (blog.gdeltproject.org, "GDELT DOC 2.0 API
  debuts"): OR blocks in parentheses with upper-case OR, not nested; phrases in double quotes;
  `sourcecountry:` takes the country name without spaces; `sourcelang:` the language name.
  `timespan` is `newsMaxAgeDays` + `d`.
- **Watchlist queries:** one more request per company in `watchlist.json`: `query="<name>"`, no
  `sourcecountry`/`sourcelang` filter, same `timespan` and `maxrecords`. Only articles whose title
  names the company exactly are kept. Google News, when enabled, gets the same:
  `q="<name>" when:7d`.
- **Keywords:** the first 8 usable words of each topic and the first 5 of each of `hiring_cuts`,
  `hiring_growth` and `funded_startup` in `data/news.json`. Usable means letters, digits, spaces
  and hyphens, at least 4 characters. Nothing from the CV is ever part of a query, and the queries
  do not depend on the domain mix either.
- **Answer:** JSON `{ "articles": [ { url, title, seendate, domain, language, sourcecountry, … } ] }`,
  `{}` when nothing matched. GDELT answers query problems with a plain-text sentence (HTTP 200),
  which is reported as a failure with that sentence.
- **Cards:** headline from `title`, source shown as the publisher (`domain`), summary written by
  the code ("Article on example.de, found by the GDELT news search."), date from `seendate`.
- **Politeness:** GDELT asks for at most one request every 5 seconds, so the fetcher keeps 5.5 s
  between GDELT requests (the seven topics take about 40 s, plus 5.5 s per watchlist company). GDELT's index changes every 15 minutes, so it
  is asked at most every 15 minutes (and 15 minutes after an HTTP 429), however often Refresh is
  pressed. No robots.txt on that host (404).
- **Status on 10 Oct 2026: failing.** Every request from this PC was answered with HTTP 429
  ("Please limit requests to one every 5 seconds…"), including the very first one after several
  quiet minutes. That looks like a block on the network address rather than on this app's pace.
  The provider therefore stays enabled, reports "HTTP 429 (too many requests, try again later)"
  in the source-health list, and Google News would take over its topics if it were enabled. Still
  answering HTTP 429 from this PC on 22 October 2026.
- **Fixture:** because no live answer could be saved, `test/fixtures/sources/gdelt-artlist.json` is
  a small **hand-made** file in the ArtList JSON format with example.de addresses. Replace it
  with a real answer once GDELT responds (`mode=artlist&format=json`).
- **Fragility:** low for the format, but no contract and no key: GDELT can throttle or change at
  any time.

## Google News RSS search (layer 3, disabled by default)

- **URL:** `https://news.google.com/rss/search?q=…&hl=de&gl=DE&ceid=DE:de`, query
  `(topic words) (signal words) when:7d`.
- **Why it is off:** `https://news.google.com/robots.txt` says `Disallow: /` for every user agent
  and only allows a few paths (`/topics/`, `/publications/`, `/stories/`, …), not `/rss/search`.
  The widget obeys robots.txt, so with `"googleNews": { "enabled": true }` the provider would fail
  with "robots.txt does not allow fetching this page". It is built and tested so that it can be
  used if that ever changes, but it is never used against the robots.txt.
- **Parsing:** title is "Headline - Publisher"; the publisher (from `<source>`) is cut off and
  shown as the source. Article links are `news.google.com/rss/articles/CBMi…` redirects: older ids
  contain the publisher URL and are decoded locally; newer ids do not, and those keep the Google
  link (no extra request is made to resolve them).
- **Fixture:** `test/fixtures/sources/google-news.rss.xml` is **hand-made** in the Google News RSS
  format (fetching a real one would have broken the robots.txt rule).
- **Fragility:** high. Unofficial, no contract, link format changes without notice.

## check-sources result (10 Oct 2026, 19:36)

`npm run check-sources -- --domains automotive-emobility,energy-storage`:

| Provider | Layer | Enabled | Status | Items | Sample / error |
|---|---|---|---|---|---|
| VDI nachrichten Recruiting Tag | 1 | yes | ok | 1 | VDI nachrichten Recruiting Tag Hamburg |
| messen.de | 1 | yes | ok | 25 | WESER-JOBS |
| ingenieur.de Wirtschaft | 1 | yes | ok | 10 | Automotive-Ingenieure wechseln in die Rüstungsindustrie … |
| ingenieur.de | 1 | yes | ok | 10 | Rogfast: Norwegen sprengt einen Rekordtunnel unter dem Meer |
| Eurofound ERM | 1 | yes | ok | 10 | Aaronia: 150 new jobs planned |
| produktion.de | 1 | yes | ok | 43 | Wirtschaftswachstum: Deutschland überrascht positiv |
| Startbase | 1 | yes | ok | 10 | Boomerent: Wie zwei Gründer mit KI den … Immobilienmarkt aufmischen |
| Munich Startup | 1 | no | ok | 20 | Defencetech: Warum Europas Milliarden nach München fließen |
| GDELT news search | 2 | yes | failed | 0 | HTTP 429 (too many requests) |
| Google News search | 3 | no | failed | 0 | robots.txt does not allow fetching this page |

An earlier run the same evening had produktion.de and Startbase fail once with "no network
connection"; both answered normally a minute later.

## check-sources result (22 Oct 2026, 18:10)

`npm run check-sources` (seven broad topics, 15 signal words, last 7 days):

| Provider | Layer | Enabled | Status | Items | Sample / error |
|---|---|---|---|---|---|
| VDI nachrichten Recruiting Tag | 1 | yes | failed | 0 | no items found, the page layout may have changed |
| messen.de | 1 | yes | ok | 25 | Media For You München |
| ingenieur.de Wirtschaft | 1 | yes | failed | 0 | HTTP 404 |
| ingenieur.de | 1 | yes | ok | 10 | Autorecycling: Wie BMW, Bosch und BASF Autoteile vor dem Schredder retten wollen |
| Eurofound ERM | 1 | yes | ok | 10 | EEW: 100 jobs to go |
| produktion.de | 1 | yes | failed | 0 | no network connection (intermittent, as on 10 Oct) |
| tagesschau.de Wirtschaft | 1 | yes | ok | 38 | Welche wirtschaftlichen Folgen die PHP-Sicherheitslücke haben könnte |
| Handelsblatt | 1 | yes | ok | 50 | Märkte Insight: Folgt auf vier gute Börsenjahre auch noch ein fünftes? |
| Deutsches Ärzteblatt | 1 | yes | ok | 10 | Suizidassistenz: Empfehlungen zum Umgang mit Anfragen vorgelegt |
| Startbase | 1 | yes | failed | 0 | no network connection (intermittent) |
| Munich Startup | 1 | no | ok | 20 | Big-Wave-Weltrekordhalter Sebastian Steudtner investiert in Startup Regulate |
| GDELT news search | 2 | yes | failed | 0 | HTTP 429 (too many requests) |
| Google News search | 3 | no | failed | 0 | robots.txt does not allow fetching this page |
