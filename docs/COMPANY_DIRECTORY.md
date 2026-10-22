# Company directory

The "Employers for you" section shows career pages of companies in Germany for each domain in
your mix. They come from `data/employers/<domain>.json`, one file per domain, shipped with the app.
The app shows only companies whose status is `verified`, and labels the list "Starter list for
Germany, may be incomplete". Domains without a file show a short note and a link to this page.

Today only `automotive-emobility` has a list (30 companies, converted from the original hand-made
list). The other domains are waiting for a generator run (see "Generating a list" below).

## File format

Contract: [`contracts/EmployerDirectory.v1.schema.json`](../contracts/EmployerDirectory.v1.schema.json).

```json
{
  "schemaVersion": 1,
  "domain": "healthcare-nursing",
  "segments": [
    {
      "tier": "top",
      "label": { "de": "Klinikgruppen", "en": "Hospital groups" },
      "companies": [
        {
          "name": "Example Kliniken",
          "website": "https://www.example-kliniken.de",
          "careerUrl": "https://karriere.example-kliniken.de",
          "status": "verified",
          "confidence": 1,
          "lastVerified": "2026-10-22",
          "generatedBy": "claude-opus-5-5 via tools/company-directory 2026-10-22",
          "sources": ["http-check 2026-10-22", "impressum /impressum"],
          "checks": { "url": "ok", "website": "ok", "career": "ok", "jobs": "ok", "duplicate": "ok", "second": "ok" }
        }
      ]
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `tier` | `top` (largest employers), `tier1` / `tier2` (suppliers and their suppliers, or the field's equivalent), `service` (consultancies, service, staffing and engineering providers), `sme` (Mittelstand), `startup`. The app shows segments in this order. |
| `status` | `verified` (shown) or `proposed` (hidden until it passes verification). |
| `confidence` | 0 to 1, the share of the checks below that passed (look-alike names lose 0.3). |
| `lastVerified` | Date of the last passing verification; required for `verified`. |
| `generatedBy` | `manual (…)` for hand-made entries, or the model and date of the generator run. |
| `sources` | What confirmed the company. |
| `checks` | Result of the last verification, per check. |

## How verification works

`npm run directory:verify -- --domain <id>` checks every entry; the generator runs the same checks
after each proposal. A company is `verified` only when **all** of these pass:

1. **url**: website and career URL are valid web addresses.
2. **website**: the homepage answers (redirects followed) and is not a parked or for-sale domain.
3. **career**: the career URL answers and ends on the company's own site, on the same brand under
   another top-level domain (`bmwgroup.jobs` for `bmwgroup.com`, `webasto.com` for
   `webasto-group.com`), or on a known hosted job board (Personio, softgarden, Workday, …) whose
   address names the company.
4. **jobs**: the career page contains job words in German or English (Karriere, Stellenangebote,
   bewerben, careers, vacancies, …).
5. **duplicate**: no other entry has the same normalised name, a look-alike name (one or two letters
   apart) or the same website.
6. **second**: a second source confirms the company: the legal notice (Impressum) on its site names
   it, or the GDELT news index has an article naming it in the last three months.

All requests go through the app's polite fetcher: it identifies itself, obeys robots.txt, waits
between requests to the same host (5.5 seconds for GDELT) and caches answers.

**Known false negatives.** A first live run on the automotive list (22 October 2026) passed 16 of
30. The failures were mostly not wrong companies but sites the checks cannot read: bot protection
(HTTP 403), robots.txt rules, connection resets, career pages built entirely with JavaScript (no
job words in the HTML), and GDELT not answering every query. Such entries stay `proposed` until a
person confirms them; see "Correcting a company" below.

## Generating a list (maintainers)

The generator asks the Claude API for companies. It is maintainer tooling only: the app never
calls an AI service, and users need no key.

```sh
# 1. Dry run (the default): prints the exact request and its worst-case cost. Sends nothing.
npm run directory:generate -- --domain healthcare-nursing

# 2. Real run: calls the API once, caches the answer, merges and verifies.
export ANTHROPIC_API_KEY=...        # PowerShell: $env:ANTHROPIC_API_KEY = "..."
npm run directory:generate -- --domain healthcare-nursing --confirm --max-cost 0.50

# 3. Look at what changed and at everything that needs a person.
npm run directory:review -- --domain healthcare-nursing

# 4. Approve with git commit, or discard with: git checkout data/employers/healthcare-nursing.json
```

Options: `--max-companies N` (default 40), `--max-cost USD` (default 1.00; the run stops before
calling when the worst case is higher), `--max-tokens N` (default 16000), `--model` (default
`claude-opus-5-5`).

- **What is sent**: only the domain's English and German name and its one-sentence description
  from `data/domains/<id>.json`, plus fixed instructions (`tools/company-directory/src/prompt.ts`).
  Never CV data, profiles or anything about a user.
- **Key**: read from `ANTHROPIC_API_KEY`, never stored or logged.
- **Answer**: structured JSON (name, website, career URL, tier, segment). The request uses the
  server-side refusal fallback (`fallbacks: "default"`), so a declined request is answered by
  another model; the model that answered is recorded in `generatedBy`.
- **Cache**: answers are kept in `tools/company-directory/.cache/llm/` (git-ignored) by a hash of
  model and request, so running the same request again costs nothing.

### Cost estimate

Worst case per domain, as the tool computes it before calling: prompt characters ÷ 3.5 input tokens
at $4 per million plus `--max-tokens` output tokens (thinking included) at $20 per million for
`claude-opus-5-5`. With the defaults that is about **$0.32 per domain**, so about **$9.30** for all
29 domains other than `general` (automotive already has a list: about $9). A typical answer of
40 companies uses far fewer output tokens than the cap; expect roughly **$0.05 to $0.15 per domain**,
**$1.50 to $4.50 in total**. The tool prints the real token counts and cost after each call.

## Correcting a company

Edit `data/employers/<domain>.json` directly:

- Fix a URL, then run `npm run directory:verify -- --domain <id>` and `directory:review`.
- If you have checked a company by hand that the automatic checks cannot read (bot protection,
  JavaScript-only pages), set `"status": "verified"`, today's date in `lastVerified`, and say how you
  checked it in `sources` (for example `"manual check 2026-10-22"`). Do not mark anything verified
  that you have not opened yourself.
- Remove a company by deleting its entry.

`npm test` checks every file against the schema (`test/directory.test.ts`).

## Contributing

Changes to company lists are welcome as pull requests that touch only `data/employers/` and include
the `directory:review` output in the description. Placeholder: the repository is private and its
public home, licence and contribution rules are not decided yet.

Users can also add companies of their own in `employers.json` next to `config.json` in the
ExpertWidget folder (same format as before: segments with `domain`, `segment` and `companies` with
`name` and `careerUrl`). They appear after the starter list, without duplicates.
