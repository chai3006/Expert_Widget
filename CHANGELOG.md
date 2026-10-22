# Changelog

## Unreleased (branch feature/expert-page)

Expert for every field of work, and ready to become an "Expert page" in a dashboard.

### Added
- 31 domains as data files in `data/domains/` (the 12 original ids plus healthcare, pharma,
  finance, accounting, law, consulting, sales and retail, marketing and media, logistics,
  hospitality, education and research, public sector, HR, skilled trades, agriculture and food,
  creative industries, construction, social work, and a `general` fallback). Adding a domain means
  adding a file.
- CV analysis by section, job title, education and certificates, with the current role weighted
  most and older roles fading (`cvAnalysis` in config.json); evidence per domain; a `general`
  fallback with a message; choosing domains by hand.
- Welcome screen with the CV folder, **Open CV folder** and **Choose another folder**; a plain
  message with the next step for every CV problem; a replaced CV is noticed.
- Employer starter list as data (`data/employers/`), shown by tier with "Show more"; maintainer
  tooling in `tools/company-directory/` that proposes companies with the Claude API and verifies
  them automatically.
- News sources for all fields: tagesschau.de Wirtschaft, Handelsblatt, Deutsches Ärzteblatt;
  signal words for non-technical fields.
- `expert-cli` (the pipeline without Electron) and `expert-cli serve`, a local JSON API on
  127.0.0.1 with a token; `<expert-page>` custom element and an example page.
- JSON Schema contracts with `schemaVersion` in `contracts/`.
- CI workflow building unsigned installers on Windows, macOS (both CPU types) and Linux.
- macOS menu-bar template icon, Documents permission text, window on all Spaces; Linux X button
  collapses instead of hiding.

### Changed
- **Privacy:** the news searches no longer use the domain mix. Every user's Refresh sends the same
  requests (seven broad topics); results are filtered locally. Watchlist name searches can be
  switched off. The README's privacy statement now matches the code.
- Code moved into `packages/core`, `packages/node`, `packages/ui`, `packages/cli` and `apps/desktop`.
- The CV folder is `ExpertWidget/CV` in the system's Documents folder (an existing folder from
  earlier versions keeps being used).
- Sources, signal words and the starter list ship in `data/`; `config.json` only adds to them.
- "Start at login" everywhere; default hotkey Control+Option+E on a Mac.
- "Logistik" moved from Rail to Logistics, "Pharma" from Civil & chemical to Pharma, "Healthcare"
  and "clinical" from Medtech to Healthcare.

### Not tested
- macOS and Linux (no one has run them), the installer's new finish page (it builds), the CI
  workflow (not run yet).
