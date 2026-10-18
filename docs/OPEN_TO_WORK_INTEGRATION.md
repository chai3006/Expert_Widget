# Expert page in Open_To_Work: integration guide

How to bring the Expert widget into the Open_To_Work dashboard as a normal page, and the prompt to use in that
project. The widget code is on branch `Universal` of https://github.com/chai3006/Expert_Widget
(local copy: `C:\Users\chcha\AI_Projects\Expert_Widget`).

---

## 1. What the Expert page does

For the logged-in user it shows:

1. **Domain mix**: up to 4 engineering domains (out of 12) with whole-number weights that add up to 100, worked
   out from the user's CV.
2. **Employers for you**: career-page links for the domains in the mix, grouped by segment ("OEMs and battery", "Tier 1 and tier 2 suppliers", ...).
   Visited links move to the end of the list.
3. **In your field**: news cards tagged *Hiring signal · growth*, *Hiring signal · cuts*, *Funded startup* or
   *Career fair*. Cards are picked in proportion to the domain mix and can be filtered by tag. Seen cards sink to
   the bottom; thumbs up keeps a card, thumbs down removes it.
4. **Watchlist** (optional): companies the user follows. News that mentions them comes first.

Today none of this needs an API key: news comes from RSS/HTML pages and the free GDELT search, and tags, domains
and the CV mix are rule-based (keyword lists in `config.json`).

---

## 2. What already exists

### In Expert_Widget (Electron + TypeScript, desktop, one user)

| Piece | File | Notes |
|---|---|---|
| Domains, tags, view shapes | `src/shared/types.ts` | 12 `DOMAIN_IDS` (e.g. `automotive-emobility`), `NewsCard`, `CvProfile` |
| Config and validation | `src/main/config.ts`, `defaults/config.json` | sources, keyword lists, limits |
| Employers | `defaults/employers.json` | 5 segments, 30 companies, all under `automotive-emobility` |
| Watchlist | `defaults/watchlist.json`, `src/main/news/watchlist.ts` | whole-word company match |
| CV text | `src/main/cv/extract.ts` | PDF/DOCX/TXT |
| CV → domain mix | `src/main/cv/cvProfiler.ts` | `CvProfiler` interface + `computeDomainMix` (5 % floor, top 4, largest remainder) |
| News tag + domain | `src/main/news/classifier.ts` | `Classifier` interface, rule-based |
| Polite fetching | `src/main/news/fetcher.ts` | UA, robots.txt, per-host spacing, ETag cache, size limit |
| Source adapters | `src/main/news/adapters/*.ts` | `rss`, `ingenieur-recruiting-tag`, `messen-de`, `eurofound-erm`, `produktion-de`, GDELT, Google News |
| Providers (3 layers) | `src/main/providers.ts` | 1 feeds/pages, 2 GDELT, 3 Google News |
| Pipeline | `src/main/news/pipeline.ts` | classify → drop removed → expire → dedupe → select by mix → cards |
| Selection by mix | `src/main/news/distribute.ts` | slots per domain in proportion to weights |
| Expiry | `src/main/news/expiry.ts` | news after `newsMaxAgeDays`; fairs after their last day |
| Dedupe | `src/main/news/dedupe.ts` | canonical URL + near-identical headlines |
| Ordering | `src/shared/ordering.ts` | visited / seen sink to the bottom |
| Translation DE→EN | `src/main/translate/*` | offline WASM in Electron; **don't port** (see section 7) |

Tests for all of this are in `test/` (182 tests, Vitest). They are the best spec for the Python port.

### In Open_To_Work (FastAPI + PostgreSQL + React, web, many users)

- Branch **`feature/expert-page-draft`** (pushed, 5 commits, last `aada506`) already has an Expert page in the
  dashboard with **mock data only**: `dashboard/src/expert/` (`ExpertPage.jsx`, `expert.css`, `domains.js`,
  `sources.js`, `mockData.js`, `expertData.js`, `ordering.js` + tests, `userState.js`), a nav item `expert` in
  `App.jsx`, and `Expert-page-draft.md`.
  - `expertData.js` → `getExpertData()` is the single data entry point, made to be swapped for an API call.
  - `userState.js` keeps visited/seen state in localStorage; its TODO says to move it to the backend.
  - Its domain ids are short (`automotive`, `embedded`, ...) while the widget uses `automotive-emobility`,
    `embedded-iot`, ... **Pick one set.** Use the widget's ids, because the keyword lists are keyed by them.
- CV text is already stored per user: `user_settings.cv_text` (migration 011, filled by `POST /cv/upload`).
- LLM calls go through `agents/llm_client.py` → `call_llm(prompt, user_id=...)`, using each user's own provider
  and key.
- Tabs are gated per user by `user_settings.allowed_tabs`. An admin has to enable `expert` for existing
  non-admin users.
- Last migration: `042_deterministic_scoring.sql` → the next one is `043`.
- Cron: `/run/pipeline/due` (hourly Mon–Fri) and `/run/pipeline/weekly` (Sunday), via `scripts/*.sh`.

---

## 3. Recommended approach: port the logic, don't embed the app

The widget is a desktop app, while Open_To_Work is a multi-user web app on EC2. So **reimplement the widget's data
layer in Python inside Open_To_Work** and reuse the React draft for the UI. Don't run Electron or Node on the server.

Why:
- News is the same for everyone, so **fetch it once on the server** and store it in PostgreSQL. Only the
  selection (by each user's domain mix) and the seen/visited state are per user.
- The CV is already in the database, and Open_To_Work already parses it, so there's no CV folder.
- The two AI seams (`Classifier`, `CvProfiler`) map directly onto `call_llm`, which already uses the user's own key.
  That makes the AI version an easy switch, with the rule-based version as the fallback when there's no key.
- Python and FastAPI match the rest of the backend, and the tests can be ported one to one to pytest.

The Expert_Widget repo stays the reference and the desktop version. The JSON files (`config.json`,
`employers.json`, `watchlist.json`) are copied into Open_To_Work, ideally in one place, so both stay in sync.

---

## 4. Target design in Open_To_Work

### Files

| New file | Ported from |
|---|---|
| `expert/config/config.json`, `employers.json` | `defaults/*.json` (Universal branch) |
| `expert/config.py` | `src/main/config.ts` (validation with exact JSON paths) |
| `expert/keywords.py` | `src/main/text/keywords.ts` (`foldText`, umlaut folding, whole-word match) |
| `expert/cv_profiler.py` | `src/main/cv/cvProfiler.ts` (`RuleBasedCvProfiler`, `compute_domain_mix`) |
| `expert/classifier.py` | `src/main/news/classifier.ts` |
| `expert/fetcher.py` | `src/main/news/fetcher.ts` (`requests`/`httpx`, robots.txt, spacing, ETag) |
| `expert/adapters/*.py` | `src/main/news/adapters/*.ts` |
| `expert/pipeline.py` | `pipeline.ts`, `distribute.ts`, `expiry.ts`, `dedupe.ts`, `watchlist.ts` |
| `agents/expert_agent.py` | `refresh.ts` + `providers.ts` → the server-side refresh |
| `tests/test_expert_*.py` | `test/*.test.ts` |

(Or use `agents/expert/...` if that fits the repo better. Keep it in one package.)

### Database (migration `043_expert_page.sql`)

```sql
-- Shared news cache: one row per canonical URL, filled by the refresh job.
CREATE TABLE expert_news_items (
  id            TEXT PRIMARY KEY,          -- itemId() from dedupe.ts
  canonical_url TEXT UNIQUE NOT NULL,
  url           TEXT NOT NULL,
  headline      TEXT NOT NULL,
  excerpt       TEXT NOT NULL DEFAULT '',
  source_id     TEXT NOT NULL,
  source_name   TEXT NOT NULL,
  topic         TEXT NOT NULL,             -- hiring | funded_startup | career_fair
  layer         SMALLINT NOT NULL,         -- 1 feeds, 2 GDELT, 3 Google News
  published_at  TIMESTAMPTZ,
  first_seen    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  event_date    DATE,
  event_end_date DATE
);

-- Per-source health (shown as "x of y sources working").
CREATE TABLE expert_source_health (
  source_id     TEXT PRIMARY KEY,
  status        TEXT NOT NULL,             -- ok | empty | failed | unchecked
  checked_at    TIMESTAMPTZ,
  item_count    INT NOT NULL DEFAULT 0,
  detail        TEXT,
  fail_streak   INT NOT NULL DEFAULT 0,
  etag          TEXT,
  last_modified TEXT
);

-- Per-user state.
CREATE TABLE expert_user_state (
  user_id       INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  domain_mix    JSONB,                     -- [{"domain": "...", "weight": 40}, ...]
  mix_source    TEXT,                      -- rules | ai
  cv_hash       TEXT,                      -- recompute only when the CV changes
  computed_at   TIMESTAMPTZ,
  visited       JSONB NOT NULL DEFAULT '{}',  -- companyKey -> epoch ms
  seen          JSONB NOT NULL DEFAULT '{}',  -- news id -> epoch ms
  removed       JSONB NOT NULL DEFAULT '{}',  -- canonical url -> epoch ms (thumbs down)
  useful        JSONB NOT NULL DEFAULT '{}',  -- news id -> card snapshot (thumbs up)
  watchlist     JSONB NOT NULL DEFAULT '[]'
);
```

Never store the CV text again here. `user_settings.cv_text` stays the only copy, as the widget's rule says.

### API (all behind the existing JWT auth)

| Method | Path | Does |
|---|---|---|
| GET | `/expert/me` | Returns the whole page payload (see below). Recomputes the domain mix when `cv_hash` changed. |
| POST | `/expert/visit` | `{ companyKey }` → marks it visited |
| POST | `/expert/seen` | `{ ids: [...] }` → marks cards seen |
| POST | `/expert/feedback` | `{ id, url, value: "useful" \| "removed" \| null }` |
| PUT | `/expert/watchlist` | Replaces the user's watchlist |
| POST | `/expert/refresh` | Admin only (or the cron script): fetches all sources now |

`/expert/me` response:
```json
{
  "updatedAt": "2026-10-18T07:00:00Z",
  "domainMix": [{ "domain": "automotive-emobility", "label": "Automotive & e-mobility", "weight": 60 }],
  "mixSource": "rules",
  "cvStatus": null,
  "employers": [{ "domain": "...", "label": "...", "weight": 60,
                  "segments": [{ "segment": "OEMs and battery", "companies": [{ "key": "bmw", "name": "BMW", "careerUrl": "...", "visitedAt": null }] }] }],
  "watchlist": [{ "key": "watchlist:celus", "name": "CELUS", "website": "...", "note": "", "visitedAt": null, "newsCount": 2 }],
  "news": [{ "id": "...", "tag": "hiring_growth", "headline": "...", "summary": "...", "url": "...",
             "sourceName": "...", "domain": "automotive-emobility", "domainLabel": "...", "date": "...",
             "eventDate": null, "eventEndDate": null, "seenAt": null, "useful": false, "watchlist": [] }],
  "unseenCount": 7,
  "sourceHealth": { "working": 9, "total": 11, "providers": [] }
}
```
These are the widget's own `ViewModel` / `NewsCard` shapes, minus the desktop-only fields (`mode`, `theme`, `cvFolder`,
`translated`).

### Refresh schedule

- News fetch: **once a day at 07:00 Munich time**, plus `POST /expert/refresh` for admins. Add it to
  `/etc/cron.d/opentowork` with a `scripts/run-expert.sh` like the others. It is one job for all users, not one per user.
- The rules from the widget still apply on the server: a clear User-Agent, respect robots.txt, at least a few seconds
  between requests to one host, ETag/If-Modified-Since, and a size limit.
- GDELT: one shared query set per run, ≥ 5.5 s apart, back off on HTTP 429 (the audit saw 429s). Build the queries
  from the **union of domains in all users' mixes**, not per user.
- Selection (distribute by mix), expiry, dedupe and ordering run when `/expert/me` is called, so config edits apply
  without refetching. That is the same as the widget.

### Frontend

Start from `feature/expert-page-draft`:
- `expertData.js`: replace the mock with `fetch(`${API_URL}/expert/me`, { headers: authHeaders() })`, following
  the `api.js` pattern (return `null` on error and show an "unavailable" note).
- `userState.js`: replace localStorage with the `/expert/visit`, `/expert/seen` and `/expert/feedback` calls.
  Update the UI first and send the call in the background.
- `domains.js`: switch to the widget's 12 ids and labels.
- `sources.js`: delete it; sources live on the server in `config.json`.
- Add thumbs up/down, the Watchlist block and the "x of y sources working" line, which the draft lacks.
- Keep the restyle (Sora / Bebas Neue / DM Mono, orange accent, glass cards) from the draft.

---

## 5. Where the optional AI fits (from the future-scope plan)

| Seam | Rule-based (default, no key) | AI version (when the user has a key in Settings) |
|---|---|---|
| `CvProfiler` | keyword hits → `compute_domain_mix` | `call_llm` returns per-domain scores; still normalise with `compute_domain_mix` (5 % floor, top 4, sum 100) |
| `Classifier` | tag + domain keyword lists | `call_llm` in batches over new items only; cache the result per item id so it's paid for once |

Rules: the AI is always optional, so without a key the page works as it does today. It costs money only on new items
or a changed CV, its calls are logged through the existing AgentOps path, and a timeout or bad answer falls back
to the rules. **No job-openings API**: that was deliberately left out, and Agents 1–2 already cover jobs.

---

## 6. Known problems to fix rather than copy (from FEATURE_AUDIT.md)

- Sources broken but still enabled: **VDI Recruiting Tag** (page layout changed, the adapter finds nothing) and
  **ingenieur.de Wirtschaft** (404). Fix the adapter/URL or disable them in `config.json`.
- **Google News RSS is blocked by robots.txt** for our fetcher. Keep it disabled.
- **GDELT returned 429**. Add backoff and a "rate limited" status, and don't retry straight away.
- Career URLs that failed `check-links`: VW (404), Mahle (404), Rohde & Schwarz (404), Tesla (403),
  Infineon and Siemens (connection reset). Re-check them and update `employers.json`.
- `employers.json` covers only **automotive-emobility**. Users whose mix is in other domains get the "nothing for
  this domain" note, so add segments for at least semiconductors, embedded-iot, industrial-automation and
  energy-storage.

---

## 7. Out of scope for the first version

- **Translation.** The widget translates German headlines offline with a WASM model in Electron. On the web, show
  the original first, then later add an optional DeepL key (server side, cached per item).
- Article images, per-user source lists and email digests of Expert news (that could later become part of Agent 5).

---

## 8. Phases

1. **Backend core.** Port config, keywords, the CV profiler and the classifier with their tests. Expose
   `GET /expert/me` with the domain mix + employers (no news yet). Add migration 043.
2. **News.** Port the fetcher, adapters, pipeline, health and the daily cron job, with tests using saved HTML/RSS
   fixtures (no live network in tests).
3. **Frontend.** Wire the draft to the API: real state, thumbs, watchlist, source health.
4. **Optional AI** profiler/classifier via `call_llm`.
5. **Content.** Fix the broken sources and dead links, and add employers for more domains.

---

## 9. Prompt to paste into the Open_To_Work project

```text
Goal: turn the Expert page in the Open_To_Work dashboard from mock data into a real, multi-user feature,
by porting the data layer of my Expert widget to this project's Python backend.

Read first, before writing code:
1. The integration guide: C:\Users\chcha\AI_Projects\Expert_Widget\docs\OPEN_TO_WORK_INTEGRATION.md
   (branch "Universal" of https://github.com/chai3006/Expert_Widget). It is the spec: architecture, files,
   migration, API shapes, schedule, known problems, phases.
2. The widget source it refers to (TypeScript, read-only reference — do not modify that repo):
   src/shared/types.ts, src/main/config.ts, defaults/*.json, src/main/text/keywords.ts,
   src/main/cv/cvProfiler.ts, src/main/news/*.ts, src/main/news/adapters/*.ts, src/main/providers.ts,
   src/main/refresh.ts, and the tests in test/ (they define the exact behaviour to keep).
3. In this repo: .claude/CLAUDE.md (follow its rules: no `git add -A`, tests after every change,
   update CLAUDE.md, work-log.md and STATUS.md), the branch feature/expert-page-draft
   (dashboard/src/expert/* and Expert-page-draft.md), server/api.py (auth, user_settings.cv_text),
   agents/llm_client.py (call_llm), db/migrations/ (next number is 043), scripts/run-*.sh.

Then:
- Create a new branch feature/expert-page from origin/main and bring in feature/expert-page-draft.
- Do Phase 1 only (backend core): port config validation, keyword matching, the rule-based CV profiler
  (compute_domain_mix: 5 % floor, top 4 domains, whole numbers summing to 100) and the rule-based classifier
  to Python, with pytest tests ported from the widget's Vitest tests. Add migration 043 as in the guide and
  GET /expert/me returning domainMix + employers (news: empty list for now). Use the widget's 12 domain ids.
- Keep the behaviour identical to the widget unless the guide says otherwise. Where the guide and the code
  disagree, the code and its tests win. Tell me about every such case.
- No API key may be required. AI comes later as an optional path through call_llm.
- Don't store the CV text anywhere new; read it from user_settings.cv_text.
- Before you start, show me a short plan (files you will add/change, migration, endpoints) and wait for my OK.
  After Phase 1, stop, run all tests, and report what passed, what you skipped and anything you were unsure of.
  Don't push or deploy until I say so.
```
