# Optional AI profiler: design (not implemented)

Status: **design only**. This version of Expert has no AI profiler. The app reads CVs with
the rule-based `StructuredCvProfiler` (`packages/core/src/cv/structuredProfiler.ts`), which runs
on the user's computer and needs no key. This document describes how an optional AI profiler
could be added later without weakening the privacy rule.

## The rule it must keep

The CV text never leaves the user's computer unless the user has explicitly agreed, for that
provider, on a screen that says exactly what is sent. The default is **off**. Without consent
nothing changes: the rule-based profiler runs as today.

## Where it plugs in

`CvProfiler` (`packages/core/src/cv/cvProfiler.ts`) is the seam:

```ts
interface CvProfiler {
  computeWeights(cvText: string): Promise<DomainWeight[]>;
  analyse?(cvText: string): ProfileAnalysis; // weights, evidence, source, notice
}
```

An AI profiler implements the same interface and returns the same `ProfileAnalysis`, so the domain
mix, the evidence list, the manual override and the `DomainProfile` contract stay unchanged. It may
only return domain ids that exist in the registry (`data/domains`). Anything else is dropped and
the rule-based result is used instead.

## Two possible kinds

| | Local model | User's own API key |
|---|---|---|
| Where the CV goes | Nowhere: a small model runs on the computer (for example via a local runtime the user installed) | To the provider the user chose, over HTTPS |
| Setup | Download of a model (hundreds of MB), enough RAM | Key pasted once, stored with Electron `safeStorage` (OS keychain), never in a file in plain text |
| Cost | None | Paid by the user per call |
| Quality | Lower than large hosted models | Higher |
| Default | Off | Off |

## Consent screen (required before the first call)

Shown when the user switches the profiler on, and again if the provider or what is sent changes:

1. What is sent: "The text of your CV file `<file name>`", shown in full, so the user can see it.
2. Where it goes: the provider name and its privacy-policy link (local model: "nothing leaves this
   computer").
3. When it is sent: only when you press Refresh and your CV has changed since the last analysis.
4. What is kept: only the domain weights and short evidence labels, as today. The provider's answer
   is not stored.
5. Two buttons: "Use the AI profiler" and "Keep the built-in profiler". Closing the screen means no.

The setting is stored locally, with the date of consent. Switching it off deletes the stored key.

## Safeguards

- One call per changed CV (name, size and modified time decide), never on start-up or in the
  background, with a timeout and a size cap.
- Personal data is removed before sending where it can be found locally (e-mail addresses, phone
  numbers, street addresses, dates of birth), and the consent screen says that this is best effort.
- The answer is validated against a JSON shape (domain ids, weights, short labels); evidence labels
  longer than 80 characters or containing text copied from the CV are cut.
- Errors fall back to the rule-based profiler with a short note. The app never blocks on the AI.
- No logging of the CV text or the prompt, also not in development builds.

## Not planned

- Sending the CV to any server run by the project or a dashboard.
- Training on users' CVs.
- Turning the profiler on by default, or asking again and again after the user said no.

## Work needed (estimate)

About 3 to 5 days: settings and consent screen, key storage, one provider adapter behind
`CvProfiler`, answer validation, tests with a mocked provider, documentation.
