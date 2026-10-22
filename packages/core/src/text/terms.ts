// Term matching for the CV profiler: like KeywordMatcher (case and umlaut spelling do not matter,
// terms of 6+ characters also match inside German compounds), plus common inflections:
// - plural and female forms with an umlaut: "Kraft" also finds "Kräfte"/"Kraefte", "Koch" "Köchin";
// - short terms take German and English endings: "Arzt" finds "Arztes", "Nurse" finds "Nurses";
// - hyphens and spaces inside a term are interchangeable: "Kfz-Mechatroniker" = "Kfz Mechatroniker".
// Words that appear in CVs of every field (GENERIC_WORDS) are never used as evidence.

import type { WeightedTerm } from '../domains.js';
import { foldText } from './keywords.js';

/**
 * Words found in CVs of every field. They say nothing about the domain, so a domain file that
 * lists one has it ignored (test/domains.test.ts also refuses such entries). Folded spelling.
 */
export const GENERIC_WORDS: readonly string[] = [
  'projekt', 'projekte', 'project', 'projects', 'projektarbeit', 'team', 'teams', 'teamarbeit', 'teamwork', 'teamfaehigkeit',
  'kommunikation', 'communication', 'kommunikationsfaehigkeit', 'management', 'verantwortung', 'responsibility',
  'organisation', 'organization', 'office', 'ms office', 'microsoft office', 'excel', 'word', 'powerpoint', 'outlook',
  'englisch', 'deutsch', 'english', 'german', 'fuehrerschein', 'driving licence', 'driving license', 'belastbarkeit',
  'zuverlaessigkeit', 'flexibilitaet', 'motivation', 'kundenorientierung', 'analyse', 'analysis', 'planung', 'planning',
  'support', 'service', 'beratung', 'leitung', 'leadership', 'fuehrung', 'mitarbeiter', 'mitarbeiterin', 'entwicklung',
  'development', 'qualitaet', 'quality', 'dokumentation', 'documentation', 'prozess', 'prozesse', 'process', 'processes',
  'optimierung', 'optimization', 'optimisation', 'koordination', 'coordination', 'praesentation', 'presentation',
  'schulung', 'training', 'workshop', 'workshops', 'meeting', 'budget', 'strategie', 'strategy', 'digitalisierung',
  'digital', 'innovation', 'verwaltung', 'administration', 'sachbearbeitung', 'kunde', 'kunden', 'customer', 'customers',
  'berufserfahrung', 'experience', 'erfahrung', 'kenntnisse', 'skills', 'ausbildung', 'studium', 'abschluss', 'zertifikat',
  'certificate', 'manager', 'leiter', 'assistent', 'assistant', 'praktikum', 'internship', 'werkstudent', 'aushilfe',
  'sprachen', 'languages', 'hobbys', 'hobbies', 'lebenslauf', 'curriculum vitae', 'bewerbung', 'referenzen',
];

const SUBSTRING_MIN_LENGTH = 6;
const ENDINGS = '(?:e|en|er|ern|es|n|s|in|innen)?';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The term with its last a/o/u umlauted (folded spelling): "kraft" → "kraeft", "arzt" → "aerzt". */
export function umlautVariant(folded: string): string | null {
  for (let i = folded.length - 1; i >= 0; i--) {
    const c = folded[i];
    if (c !== 'a' && c !== 'o' && c !== 'u') continue;
    const next = folded[i + 1];
    const prev = folded[i - 1];
    // Not part of a digraph that is already an umlaut or a diphthong (ae, oe, ue, au, eu, ou).
    if (next === 'e' || next === 'u' || (c === 'u' && (prev === 'a' || prev === 'e' || prev === 'o'))) return null;
    return folded.slice(0, i) + c + 'e' + folded.slice(i + 1);
  }
  return null;
}

function bodyPattern(folded: string): string {
  return folded
    .split(/[-\s]+/)
    .filter(Boolean)
    .map(escapeRegExp)
    .join('[-\\s]*');
}

export interface TermHit {
  term: string;
  weight: number;
  count: number;
}

interface CompiledTerm {
  term: string;
  weight: number;
  re: RegExp;
}

export interface TermMatcherOptions {
  /**
   * Terms must start at a word boundary (they may still end inside a longer word). For job titles:
   * "Controller" is not found in "Microcontroller", "Pflegefachkraft" is found in "Pflegefachkräfte".
   */
  wordStart?: boolean;
}

export class TermMatcher {
  private readonly terms: CompiledTerm[];

  constructor(terms: readonly WeightedTerm[], ignore: ReadonlySet<string> = new Set(GENERIC_WORDS), options: TermMatcherOptions = {}) {
    const start = options.wordStart ? '(?<![\\p{L}\\p{N}])' : '';
    const compiled = terms
      .map((t) => ({ ...t, folded: foldText(t.term.trim()) }))
      .filter((t) => t.folded.length > 0 && !ignore.has(t.folded))
      .map((t) => {
        const variants = [t.folded, umlautVariant(t.folded)].filter((v): v is string => v !== null);
        const alternatives = [...new Set(variants)].map(bodyPattern).join('|');
        const re =
          t.folded.length >= SUBSTRING_MIN_LENGTH
            ? new RegExp(`${start}(?:${alternatives})`, 'gu')
            : new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives})${/[\p{L}]$/u.test(t.folded) ? ENDINGS : ''}(?![\\p{L}\\p{N}])`, 'gu');
        return { term: t.term.trim(), weight: t.weight, re };
      });
    // Spellings that compile to the same pattern ("Tier 1", "Tier-1") count once, with the higher weight.
    const bySource = new Map<string, CompiledTerm>();
    for (const t of compiled) {
      const seen = bySource.get(t.re.source);
      if (!seen) bySource.set(t.re.source, t);
      else if (t.weight > seen.weight) bySource.set(t.re.source, { ...t, term: seen.term });
    }
    this.terms = [...bySource.values()];
  }

  get size(): number {
    return this.terms.length;
  }

  /** Total occurrences of all terms in already folded text. */
  countFolded(folded: string): number {
    return this.hits(folded).reduce((a, h) => a + h.count, 0);
  }

  /** Every term found in already folded text, with how often it occurs. */
  hits(folded: string): TermHit[] {
    const out: TermHit[] = [];
    for (const t of this.terms) {
      t.re.lastIndex = 0;
      const m = folded.match(t.re);
      if (m) out.push({ term: t.term, weight: t.weight, count: m.length });
    }
    return out;
  }
}

/** The ignore set: the built-in generic words plus the user's own (config.json cvAnalysis.ignoreWords). */
export function ignoreSet(extra: readonly string[] = []): Set<string> {
  return new Set([...GENERIC_WORDS, ...extra.map((w) => foldText(w.trim())).filter(Boolean)]);
}
