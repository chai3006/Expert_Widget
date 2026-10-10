// Keyword matching shared by the CV profiler and the news classifier.
//
// Rules (documented in the README):
// - Case-insensitive. German umlauts and ß are folded (ä→ae, ö→oe, ü→ue, ß→ss) on both sides,
//   so "Steuergeraet" matches "Steuergerät".
// - Keywords of 6 or more characters match anywhere, so German compounds count
//   ("Batterie" matches "Batteriezelle", "Fahrzeug" matches "Elektrofahrzeug").
// - Shorter keywords (acronyms like ECU, PLC, KI) must stand alone as a word.

export function foldText(text: string): string {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/\s+/g, ' ');
}

const SUBSTRING_MIN_LENGTH = 6;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class KeywordMatcher {
  private readonly patterns: RegExp[];

  constructor(keywords: readonly string[]) {
    this.patterns = keywords
      .map((k) => foldText(k.trim()))
      .filter((k) => k.length > 0)
      .map((k) => {
        const body = escapeRegExp(k);
        return k.length >= SUBSTRING_MIN_LENGTH
          ? new RegExp(body, 'gu')
          : new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, 'gu');
      });
  }

  /** Total number of keyword occurrences in already folded text. */
  countFolded(folded: string): number {
    let hits = 0;
    for (const re of this.patterns) {
      re.lastIndex = 0;
      const m = folded.match(re);
      if (m) hits += m.length;
    }
    return hits;
  }

  count(text: string): number {
    return this.countFolded(foldText(text));
  }
}

/** True if any of the phrases occurs anywhere in the text (folded, substring match). */
export function containsAny(text: string, phrases: readonly string[]): boolean {
  const folded = foldText(text);
  return phrases.some((p) => {
    const f = foldText(p.trim());
    return f.length > 0 && folded.includes(f);
  });
}
