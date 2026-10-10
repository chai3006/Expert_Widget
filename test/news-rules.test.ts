import { describe, expect, it } from 'vitest';
import { RuleBasedClassifier } from '../src/main/news/classifier.js';
import { canonicalUrl, dedupe, isNearDuplicateHeadline } from '../src/main/news/dedupe.js';
import { allocateSlots, selectForProfile, type Selectable } from '../src/main/news/distribute.js';
import { isExpired } from '../src/main/news/expiry.js';
import type { RawItem } from '../src/main/news/types.js';
import { defaultConfig } from './helpers/config.js';

const DAY = 24 * 3600 * 1000;
const now = new Date(2026, 9, 10, 12, 0).getTime();

function item(over: Partial<RawItem>): RawItem {
  return {
    url: 'https://example.com/a',
    headline: '',
    excerpt: '',
    publishedAt: null,
    eventDate: null,
    eventEndDate: null,
    sourceId: 's',
    sourceName: 'Source',
    topic: 'hiring',
    firstSeen: now,
    ...over,
  };
}

describe('expiry', () => {
  it('drops news older than newsMaxAgeDays', () => {
    const fresh = item({ publishedAt: new Date(now - 6 * DAY).toISOString() });
    const old = item({ publishedAt: new Date(now - 8 * DAY).toISOString() });
    expect(isExpired(fresh, 'hiring_cuts', now, 7)).toBe(false);
    expect(isExpired(old, 'hiring_cuts', now, 7)).toBe(true);
  });

  it('uses the first sighting when a source gives no date', () => {
    expect(isExpired(item({ firstSeen: now - 3 * DAY }), 'funded_startup', now, 7)).toBe(false);
    expect(isExpired(item({ firstSeen: now - 9 * DAY }), 'funded_startup', now, 7)).toBe(true);
  });

  it('keeps fairs until their (last) event day is over, however old the announcement', () => {
    const fair = item({ firstSeen: now - 60 * DAY, eventDate: '2026-10-10', eventEndDate: '2026-10-10' });
    expect(isExpired(fair, 'career_fair', now, 7)).toBe(false);
    expect(isExpired(fair, 'career_fair', new Date(2026, 9, 11, 0, 0).getTime(), 7)).toBe(true);
    const twoDays = item({ eventDate: '2026-10-09', eventEndDate: '2026-10-10' });
    expect(isExpired(twoDays, 'career_fair', now, 7)).toBe(false);
  });

  it('keeps fairs without a date ("date to be confirmed")', () => {
    expect(isExpired(item({ firstSeen: now - 90 * DAY }), 'career_fair', now, 7)).toBe(false);
  });
});

describe('deduplication', () => {
  it('normalises URLs', () => {
    expect(canonicalUrl('http://WWW.Example.com/news/x/?utm_source=rss&id=3#top')).toBe('https://example.com/news/x?id=3');
  });

  it('removes items with the same canonical URL', () => {
    const items = [
      { url: 'https://www.example.com/a/', headline: 'One' },
      { url: 'https://example.com/a?utm_medium=feed', headline: 'Totally different words here' },
    ];
    expect(dedupe(items)).toHaveLength(1);
  });

  it('removes near-identical headlines from different sources', () => {
    expect(isNearDuplicateHeadline('BMW baut 8000 Stellen ab: Warum jetzt auch der letzte Autoriese sparen muss', 'BMW baut 8.000 Stellen ab – warum jetzt auch der letzte Autoriese sparen muss')).toBe(true);
    expect(isNearDuplicateHeadline('Bosch baut Stellen ab', 'Bosch baut neues Werk')).toBe(false);
    const items = [
      { url: 'https://a.example/1', headline: 'IAV streicht 1.400 Stellen' },
      { url: 'https://b.example/2', headline: 'IAV streicht 1.400 Stellen!' },
    ];
    expect(dedupe(items).map((i) => i.url)).toEqual(['https://a.example/1']);
  });
});

describe('keyword classification', () => {
  const classifier = new RuleBasedClassifier(defaultConfig().keywords);

  it('tags cuts, growth and funding from German and English keywords', () => {
    expect(classifier.classify(item({ headline: 'IAV streicht 1.400 Stellen, IG Metall kündigt Proteste an' }))?.tag).toBe('hiring_cuts');
    expect(classifier.classify(item({ headline: 'Zulieferer schafft Arbeitsplätze im neuen Werk' }))?.tag).toBe('hiring_growth');
    expect(classifier.classify(item({ headline: 'Carmaker announces layoffs at two plants' }))?.tag).toBe('hiring_cuts');
    expect(classifier.classify(item({ topic: 'funded_startup', headline: 'TODAY erhält 2,8 Millionen Euro' }))?.tag).toBe('funded_startup');
  });

  it('prefers cuts when cuts and growth score the same', () => {
    expect(classifier.classify(item({ headline: 'Stellenabbau in Wolfsburg, Expansion in Spanien' }))?.tag).toBe('hiring_cuts');
  });

  it('drops items that are not a signal', () => {
    expect(classifier.classify(item({ headline: 'Norwegen sprengt einen Rekordtunnel unter dem Meer' }))).toBeNull();
    expect(classifier.classify(item({ topic: 'funded_startup', headline: 'Startupnews zum Wochenende KW 41' }))).toBeNull();
  });

  it('uses the tag given by the source', () => {
    expect(classifier.classify(item({ headline: 'Bosch: 1,300 jobs to go', tagHint: 'hiring_cuts' }))?.tag).toBe('hiring_cuts');
  });

  it('matches domains via keywords, including German compounds and umlaut spellings', () => {
    expect(classifier.classify(item({ headline: 'Autobauer kündigt Stellenabbau bei Elektrofahrzeugen an' }))?.domain).toBe('automotive-emobility');
    expect(classifier.classify(item({ headline: 'Halbleiterwerk in Dresden schafft Arbeitsplätze' }))?.domain).toBe('semiconductors');
    expect(classifier.classify(item({ headline: 'Stellenabbau beim Steuergeraete-Hersteller' }))?.domain).toBe('automotive-emobility');
  });

  it('falls back to "all" when no domain keyword matches', () => {
    expect(classifier.classify(item({ headline: 'Dax-Konzerne: Tausende Jobs fallen weg' }))?.domain).toBe('all');
  });

  it('treats fairs as fairs and skips apprenticeship fairs', () => {
    expect(classifier.classify(item({ topic: 'career_fair', headline: 'Karrieretag Hamburg' }))?.tag).toBe('career_fair');
    expect(classifier.classify(item({ topic: 'career_fair', headline: 'AZUBISPOT Regensburg' }))).toBeNull();
    expect(classifier.classify(item({ topic: 'career_fair', headline: 'A-Zu-Bi! Neuburg' }))).toBeNull();
  });
});

describe('domain-weight distribution', () => {
  const weights = [
    { domain: 'automotive-emobility' as const, weight: 50 },
    { domain: 'embedded-iot' as const, weight: 30 },
    { domain: 'energy-storage' as const, weight: 20 },
  ];
  let t = 1000;
  const sel = (tag: Selectable['tag'], domain: Selectable['domain'], eventDate: string | null = null): Selectable => ({ tag, domain, date: t--, eventDate });
  const many = (n: number, tag: Selectable['tag'], domain: Selectable['domain']) => Array.from({ length: n }, () => sel(tag, domain));

  it('allocates whole slots proportionally', () => {
    expect([...allocateSlots(weights, 10).values()]).toEqual([5, 3, 2]);
    expect([...allocateSlots(weights, 4).values()]).toEqual([2, 1, 1]);
  });

  it('shows items in proportion to the weights when there are enough', () => {
    const items = [...many(10, 'hiring_cuts', 'automotive-emobility'), ...many(10, 'hiring_growth', 'embedded-iot'), ...many(10, 'hiring_cuts', 'energy-storage')];
    const picked = selectForProfile(items, weights, 10);
    const count = (d: string) => picked.filter((p) => p.domain === d).length;
    expect([count('automotive-emobility'), count('embedded-iot'), count('energy-storage')]).toEqual([5, 3, 2]);
  });

  it('lets other mix domains use slots a thin domain cannot fill, but never pads with other domains', () => {
    const items = [...many(10, 'hiring_cuts', 'automotive-emobility'), ...many(1, 'hiring_cuts', 'embedded-iot'), ...many(10, 'hiring_cuts', 'medtech')];
    const picked = selectForProfile(items, weights, 10);
    expect(picked.filter((p) => p.domain === 'medtech')).toHaveLength(0);
    expect(picked.filter((p) => p.domain === 'embedded-iot')).toHaveLength(1);
    expect(picked).toHaveLength(10);
  });

  it('does not pad when there are fewer relevant items', () => {
    const picked = selectForProfile([...many(2, 'hiring_cuts', 'automotive-emobility'), ...many(5, 'hiring_cuts', 'telecom')], weights, 10);
    expect(picked).toHaveLength(2);
  });

  it('fills remaining hiring slots with general items', () => {
    const picked = selectForProfile([...many(2, 'hiring_cuts', 'automotive-emobility'), ...many(3, 'hiring_cuts', 'all')], weights, 4);
    expect(picked.map((p) => p.domain)).toEqual(['automotive-emobility', 'automotive-emobility', 'all', 'all']);
  });

  it('shows general funded startups only when none match the mix', () => {
    const general = many(3, 'funded_startup', 'all');
    expect(selectForProfile(general, weights, 10)).toHaveLength(3);
    const withMatch = selectForProfile([...general, sel('funded_startup', 'energy-storage')], weights, 10);
    expect(withMatch.map((p) => p.domain)).toEqual(['energy-storage']);
  });

  it('orders fairs by event date with unconfirmed dates last', () => {
    const picked = selectForProfile(
      [sel('career_fair', 'all', null), sel('career_fair', 'all', '2026-11-02'), sel('career_fair', 'all', '2026-10-20'), sel('career_fair', 'medtech', '2026-10-15')],
      weights,
      10,
    );
    expect(picked.map((p) => p.eventDate)).toEqual(['2026-10-20', '2026-11-02', null]);
  });

  it('without a profile shows the newest items of every domain', () => {
    expect(selectForProfile(many(5, 'hiring_cuts', 'telecom'), [], 3)).toHaveLength(3);
  });
});
