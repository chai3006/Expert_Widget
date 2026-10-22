// Watchlist matching: which watchlist companies a news item mentions, and whether it is an event.
//
// A company matches only by its exact name as a whole word in the headline or summary, so
// look-alikes do not count ("Celusion" or "Marcelus" are not CELUS, "Hefex" alone is not
// "Hefex Labs"). Case and German umlaut spelling do not matter; any run of spaces in the name
// matches any run of spaces in the text.

import { KeywordMatcher, foldText } from '../text/keywords.js';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class WatchlistMatcher {
  private readonly companies: Array<{ name: string; pattern: RegExp }>;

  constructor(names: readonly string[]) {
    this.companies = names
      .map((name) => ({ name, folded: foldText(name.trim()) }))
      .filter((c) => c.folded.length > 0)
      .map(({ name, folded }) => ({
        name,
        pattern: new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(folded).replace(/ /g, '\\s+')}(?![\\p{L}\\p{N}])`, 'u'),
      }));
  }

  /** Names of the watchlist companies mentioned in the item, in watchlist order. */
  match(item: { headline: string; excerpt: string }): string[] {
    if (this.companies.length === 0) return [];
    const text = foldText(`${item.headline} \n ${item.excerpt}`);
    return this.companies.filter((c) => c.pattern.test(text)).map((c) => c.name);
  }
}

/**
 * Words that make a watchlist item a company event (fair, expo, webinar, meetup). Same matching
 * rules as the keyword lists in config.json: 6+ characters also match inside longer words.
 */
const EVENT_WORDS = [
  'Karrieremesse',
  'Jobmesse',
  'Fachmesse',
  'Messe',
  'Recruiting Tag',
  'Recruiting-Tag',
  'Karrieretag',
  'Career Fair',
  'Career Day',
  'Expo',
  'Webinar',
  'Event',
  'Events',
  'Veranstaltung',
  'Konferenz',
  'Kongress',
  'Conference',
  'Meetup',
  'Hackathon',
  'Tag der offenen Tür',
  'Open House',
];

const eventMatcher = new KeywordMatcher(EVENT_WORDS);

export function isCompanyEvent(item: { headline: string; excerpt: string }): boolean {
  return eventMatcher.count(`${item.headline} ${item.excerpt}`) > 0;
}
