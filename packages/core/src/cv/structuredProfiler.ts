// The CV profiler: reads the CV's structure and scores every domain of the registry.
//
// Signals, strongest first (points per hit):
//   job title in an experience entry ........ 6  × entry weight
//   degree, training or certificate .......... 4  (education entries × education weight)
//   keyword in a skills or certificates list . 2  (each keyword once)
//   keyword in an experience entry ........... 1  × entry weight (each keyword at most 3 times)
//   job title in the profile or header ....... 3
//   keyword anywhere else .................... 0.5 (each keyword at most 2 times)
// A CV without any known heading is read as one block: titles 4, education 3, keywords 1.
//
// Entry weight (current and previous experience):
//   recency  = 0.5 ^ (years since the entry ended / halfLifeYears)        (ended = now for a current role)
//   duration = min(1, 0.5 + years in the role / 4)                         (3 months: 0.56, 2 years or more: 1)
//   weight   = recency × duration × (currentRoleBoost for the current or most recent role, else 1)
//   An entry without dates counts 0.6. Education decays half as fast (halfLifeYears × 2), undated 0.7.
// halfLifeYears (default 5) and currentRoleBoost (default 1.5) are set in config.json "cvAnalysis".
//
// The domain mix is then computeDomainMix: shares of the total score, domains under 5 % dropped,
// at most 4, whole numbers summing to 100, ties by registry order. Words that every field uses
// ("Projekt", "Team", "Kommunikation"; see GENERIC_WORDS) never count.

import type { CvAnalysisConfig } from '../config.js';
import type { DomainEvidence, EvidenceKind } from '../contracts.js';
import type { DomainDefinition, DomainRegistry } from '../domains.js';
import { languageOf } from '../language.js';
import type { DomainWeight } from '../shared/types.js';
import { TermMatcher, ignoreSet } from '../text/terms.js';
import { computeDomainMix, type CvProfiler } from './cvProfiler.js';
import { parseCv, periodLabel, type CvEntry, type ParsedCv } from './cvStructure.js';

export const POINTS = { title: 6, education: 4, skill: 2, entryKeyword: 1, profileTitle: 3, otherKeyword: 0.5 } as const;
const UNSTRUCTURED = { title: 4, education: 3, keyword: 1 } as const;
const UNDATED_ENTRY = 0.6;
const UNDATED_EDUCATION = 0.7;
/** Below this total score the CV says too little to name a domain. */
export const MIN_TOTAL_SCORE = 3;
/** Fewer words than this is "very short". */
export const MIN_WORDS = 30;
const EVIDENCE_PER_DOMAIN = 3;
const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;

export type FallbackReason = 'short' | 'language' | 'no-match';

export interface CvAnalysis {
  weights: DomainWeight[];
  evidence: DomainEvidence[];
  source: 'auto' | 'fallback';
  fallbackReason: FallbackReason | null;
  notice: string | null;
  /** Score per domain before normalising (for tests and the CLI). */
  scores: Map<string, number>;
}

export const FALLBACK_NOTICES: Record<FallbackReason, string> = {
  short: 'Your CV has very little text, so no field of work could be recognised. Showing news for all fields. You can choose your domains by hand.',
  language: 'Your CV does not seem to be in German or English, so no field of work could be recognised. Showing news for all fields. You can choose your domains by hand.',
  'no-match': 'No field of work could be recognised in your CV. Showing news for all fields. You can choose your domains by hand.',
};

interface Matchers {
  domain: DomainDefinition;
  keywords: TermMatcher;
  titles: TermMatcher;
  education: TermMatcher;
}

interface Contribution {
  domain: string;
  label: string;
  kind: EvidenceKind;
  points: number;
  period: string | null;
  current: boolean;
}

/** The current year as a fractional year. */
export function yearOf(ms: number): number {
  return 1970 + ms / YEAR_MS;
}

export class StructuredCvProfiler implements CvProfiler {
  private readonly matchers: Matchers[];

  constructor(
    private readonly registry: DomainRegistry,
    private readonly options: CvAnalysisConfig,
    private readonly now: () => number = Date.now,
  ) {
    const ignore = ignoreSet(options.ignoreWords);
    this.matchers = registry.recognisable.map((domain) => ({
      domain,
      keywords: new TermMatcher(domain.keywords, ignore),
      titles: new TermMatcher(domain.titles, ignore, { wordStart: true }),
      education: new TermMatcher(domain.education, ignore),
    }));
  }

  async computeWeights(cvText: string): Promise<DomainWeight[]> {
    return this.analyse(cvText).weights;
  }

  analyse(cvText: string): CvAnalysis {
    const nowYear = yearOf(this.now());
    const cv = parseCv(cvText, nowYear);
    const contributions = cv.structured ? this.scoreStructured(cv, nowYear) : this.scoreUnstructured(cv);
    const scores = new Map<string, number>(this.registry.recognisable.map((d) => [d.id, 0]));
    for (const c of contributions) scores.set(c.domain, (scores.get(c.domain) ?? 0) + c.points);

    const fallback = (reason: FallbackReason): CvAnalysis => ({
      weights: [{ domain: this.registry.fallback.id, weight: 100 }],
      evidence: [],
      source: 'fallback',
      fallbackReason: reason,
      notice: FALLBACK_NOTICES[reason],
      scores,
    });

    if (cv.wordCount < MIN_WORDS) return fallback('short');
    if (languageOf(cv.folded) === 'other') return fallback('language');
    const total = [...scores.values()].reduce((a, b) => a + b, 0);
    if (total < MIN_TOTAL_SCORE) return fallback('no-match');
    const weights = computeDomainMix(scores, this.registry.ids);
    if (weights.length === 0) return fallback('no-match');
    return { weights, evidence: topEvidence(contributions, weights), source: 'auto', fallbackReason: null, notice: null, scores };
  }

  private scoreStructured(cv: ParsedCv, nowYear: number): Contribution[] {
    const out: Contribution[] = [];
    const experience = cv.entries.filter((e) => e.section === 'experience');
    const latestEnd = Math.max(-Infinity, ...experience.flatMap((e) => (e.range ? [e.range.end] : [])));
    const { halfLifeYears, currentRoleBoost } = this.options;

    const entryWeight = (e: CvEntry, half: number, undated: number, boost: number): number => {
      if (!e.range) return undated;
      const yearsAgo = Math.max(0, nowYear - e.range.end);
      const recency = 0.5 ** (yearsAgo / half);
      const duration = Math.min(1, 0.5 + Math.max(0.25, e.range.end - e.range.start) / 4);
      const isLatest = e.range.present || Math.abs(e.range.end - latestEnd) < 1 / 24;
      return recency * duration * (isLatest ? boost : 1);
    };

    for (const e of cv.entries) {
      const isCurrent = e.section === 'experience' && e.range !== null && (e.range.present || Math.abs(e.range.end - latestEnd) < 1 / 24);
      const period = periodLabel(e.range);
      if (e.section === 'experience') {
        const w = entryWeight(e, halfLifeYears, UNDATED_ENTRY, currentRoleBoost);
        for (const m of this.matchers) {
          for (const h of m.titles.hits(e.head)) out.push({ domain: m.domain.id, label: h.term, kind: 'title', points: POINTS.title * h.weight * w, period, current: isCurrent });
          for (const h of m.keywords.hits(e.body)) out.push({ domain: m.domain.id, label: h.term, kind: 'keyword', points: POINTS.entryKeyword * h.weight * Math.min(h.count, 3) * w, period, current: isCurrent });
        }
      } else if (e.section === 'education') {
        const w = entryWeight(e, halfLifeYears * 2, UNDATED_EDUCATION, 1);
        for (const m of this.matchers) {
          // A degree or training, or a job title inside it ("Ausbildung zur Pflegefachkraft"), counts once per entry.
          const edu = [...m.education.hits(e.body), ...m.titles.hits(e.head)];
          const best = edu.sort((a, b) => b.weight - a.weight)[0];
          if (best) out.push({ domain: m.domain.id, label: best.term, kind: 'education', points: POINTS.education * best.weight * w, period, current: false });
          for (const h of m.keywords.hits(e.body)) out.push({ domain: m.domain.id, label: h.term, kind: 'keyword', points: POINTS.otherKeyword * h.weight * Math.min(h.count, 2) * w, period, current: false });
        }
      } else if (e.section === 'certifications') {
        for (const m of this.matchers) {
          for (const h of m.education.hits(e.body)) out.push({ domain: m.domain.id, label: h.term, kind: 'certification', points: POINTS.education * h.weight, period, current: false });
          for (const h of m.keywords.hits(e.body)) out.push({ domain: m.domain.id, label: h.term, kind: 'skill', points: POINTS.skill * h.weight, period, current: false });
        }
      } else {
        for (const m of this.matchers) {
          for (const h of m.keywords.hits(e.body)) out.push({ domain: m.domain.id, label: h.term, kind: 'keyword', points: POINTS.entryKeyword * h.weight * Math.min(h.count, 2), period, current: false });
        }
      }
    }

    for (const s of cv.sections) {
      if (s.kind === 'skills') {
        for (const m of this.matchers) {
          for (const h of m.keywords.hits(s.text)) out.push({ domain: m.domain.id, label: h.term, kind: 'skill', points: POINTS.skill * h.weight, period: null, current: false });
        }
      } else if (s.kind === 'header' || s.kind === 'profile' || s.kind === 'other') {
        for (const m of this.matchers) {
          for (const h of m.titles.hits(s.text)) out.push({ domain: m.domain.id, label: h.term, kind: 'title', points: POINTS.profileTitle * h.weight, period: null, current: false });
          for (const h of m.keywords.hits(s.text)) out.push({ domain: m.domain.id, label: h.term, kind: 'keyword', points: POINTS.otherKeyword * h.weight * Math.min(h.count, 2), period: null, current: false });
        }
      }
      // Languages say nothing about the field; experience, education, certificates and projects are scored per entry above.
    }
    return out;
  }

  private scoreUnstructured(cv: ParsedCv): Contribution[] {
    const out: Contribution[] = [];
    for (const m of this.matchers) {
      for (const h of m.titles.hits(cv.folded)) out.push({ domain: m.domain.id, label: h.term, kind: 'title', points: UNSTRUCTURED.title * h.weight, period: null, current: false });
      for (const h of m.education.hits(cv.folded)) out.push({ domain: m.domain.id, label: h.term, kind: 'education', points: UNSTRUCTURED.education * h.weight, period: null, current: false });
      for (const h of m.keywords.hits(cv.folded)) out.push({ domain: m.domain.id, label: h.term, kind: 'keyword', points: UNSTRUCTURED.keyword * h.weight * Math.min(h.count, 3), period: null, current: false });
    }
    return out;
  }
}

/** The strongest reasons per domain in the mix: one line per term, its best occurrence. */
function topEvidence(contributions: readonly Contribution[], weights: readonly DomainWeight[]): DomainEvidence[] {
  const out: DomainEvidence[] = [];
  for (const { domain } of weights) {
    const best = new Map<string, Contribution>();
    for (const c of contributions) {
      if (c.domain !== domain) continue;
      const key = c.label.toLowerCase();
      const seen = best.get(key);
      if (!seen || c.points > seen.points) best.set(key, c);
    }
    const ranked = [...best.values()].sort((a, b) => b.points - a.points).slice(0, EVIDENCE_PER_DOMAIN);
    for (const c of ranked) out.push({ domain, label: c.label, kind: c.kind, period: c.period, current: c.current });
  }
  return out;
}
