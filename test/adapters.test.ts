// Source adapters against saved copies of the real pages (fetched October 2026), no network.

import { describe, expect, it } from 'vitest';
import { parseEurofound, parseIngenieurRecruitingTag, parseMessenDe, parseProduktionDe } from '../packages/core/src/news/adapters/html.js';
import { parseFeed } from '../packages/core/src/news/adapters/rss.js';
import { fixture } from './helpers/config.js';

describe('RSS adapter', () => {
  it('reads the ingenieur.de Wirtschaft feed', () => {
    const items = parseFeed(fixture('sources', 'ingenieur-wirtschaft.rss.xml'), 'https://www.ingenieur.de/wirtschaft/feed/');
    expect(items).toHaveLength(10);
    const hensoldt = items[0];
    expect(hensoldt.headline).toMatch(/^Automotive-Ingenieure wechseln in die Rüstungsindustrie/);
    expect(hensoldt.url).toBe('https://www.ingenieur.de/wirtschaft/hensoldt-schafft-300-jobs-bei-stuttgart-ruestung-sucht-automotive-kompetenzen/');
    expect(hensoldt.publishedAt).toBe('2026-09-09T13:00:00.000Z');
    expect(items.every((i) => i.excerpt.length <= 200)).toBe(true);
    expect(items.some((i) => /erschien zuerst auf/.test(i.excerpt))).toBe(false);
  });

  it('reads the Startbase feed', () => {
    const items = parseFeed(fixture('sources', 'startbase.rss.xml'), 'https://www.startbase.de/feed/');
    expect(items).toHaveLength(10);
    expect(items.map((i) => i.headline)).toContain('TODAY erhält 2,8 Millionen Euro');
  });

  it('reads the Munich Startup feed', () => {
    const items = parseFeed(fixture('sources', 'munich-startup.rss.xml'), 'https://www.munich-startup.de/feed/');
    expect(items.length).toBeGreaterThan(5);
    expect(items.every((i) => i.url.startsWith('https://www.munich-startup.de/') && i.publishedAt)).toBe(true);
  });

  it('reads Atom feeds', () => {
    const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Werk &amp; Jobs</title>
      <link rel="alternate" href="/news/1"/><updated>2026-10-01T10:00:00Z</updated><summary>&lt;p&gt;Kurz&lt;/p&gt;</summary></entry></feed>`;
    expect(parseFeed(atom, 'https://example.com/feed')).toEqual([
      { url: 'https://example.com/news/1', headline: 'Werk & Jobs', excerpt: 'Kurz', publishedAt: '2026-10-01T10:00:00.000Z', eventDate: null, eventEndDate: null },
    ]);
  });
});

describe('VDI nachrichten Recruiting Tag adapter', () => {
  it('reads the dates table', () => {
    const items = parseIngenieurRecruitingTag(fixture('sources', 'ingenieur-recruiting-tag.html'), 'https://www.ingenieur.de/recruiting-tag/');
    expect(items).toEqual([
      {
        url: 'https://www.ingenieur.de/recruiting-tage/hamburg/',
        headline: 'VDI nachrichten Recruiting Tag Hamburg',
        excerpt: 'Career fair for engineers and IT specialists in Hamburg.',
        publishedAt: null,
        eventDate: '2026-10-28',
        eventEndDate: '2026-10-28',
      },
    ]);
  });
});

describe('messen.de adapter', () => {
  it('reads fair cards with dates and places', () => {
    const items = parseMessenDe(fixture('sources', 'messen-karrieremessen.html'), 'https://www.messen.de/de/1594/branche/karrieremessen');
    expect(items).toHaveLength(25);
    expect(items[0]).toEqual({
      url: 'https://www.messen.de/de/24358/bremen/weser-jobs/info',
      headline: 'WESER-JOBS',
      excerpt: 'Ausbildungsmesse und Karrieremesse · Bremen, Weserpark Bremen',
      publishedAt: null,
      eventDate: '2026-10-09',
      eventEndDate: '2026-10-10',
    });
    expect(items.every((i) => i.eventDate !== null)).toBe(true);
  });
});

describe('Eurofound ERM adapter', () => {
  it('reads restructuring events with job loss or creation', () => {
    const items = parseEurofound(fixture('sources', 'eurofound-germany.html'), 'https://apps.eurofound.europa.eu/restructuring-events/search?Country=Germany');
    expect(items).toHaveLength(10);
    const first = items[0];
    expect(first.url).toMatch(/^https:\/\/apps\.eurofound\.europa\.eu\/restructuring-events\/detail\/\d+$/);
    expect(first.publishedAt).toBe('2026-10-02T12:00:00.000Z');
    expect(items.filter((i) => i.tagHint === 'hiring_cuts')).toHaveLength(9);
    expect(items.filter((i) => i.tagHint === 'hiring_growth')).toHaveLength(1);
    const bosch = items.find((i) => i.headline.startsWith('Bosch'));
    expect(bosch?.headline).toMatch(/^Bosch: [\d,]+ jobs to go$/);
    expect(bosch?.excerpt).toMatch(/Germany$/);
  });
});

describe('produktion.de adapter', () => {
  it('reads article teasers with dates', () => {
    const items = parseProduktionDe(fixture('sources', 'produktion-wirtschaft.html'), 'https://www.produktion.de/wirtschaft/');
    expect(items.length).toBeGreaterThan(10);
    const first = items.find((i) => i.headline.startsWith('Wirtschaftswachstum'));
    expect(first).toEqual({
      url: 'https://www.produktion.de/wirtschaft/wirtschaftswachstum-deutschland-ueberrascht-positiv/2749583',
      headline: 'Wirtschaftswachstum: Deutschland überrascht positiv',
      excerpt: expect.stringMatching(/^Die deutsche Wirtschaft wächst 2026/),
      publishedAt: '2026-10-09T06:21:08.000Z',
      eventDate: null,
      eventEndDate: null,
    });
    expect(items.every((i) => i.publishedAt !== null)).toBe(true);
  });
});

describe('adapters on unexpected input', () => {
  it('return nothing instead of throwing', () => {
    for (const parse of [parseFeed, parseIngenieurRecruitingTag, parseMessenDe, parseEurofound, parseProduktionDe]) {
      expect(parse('<html><body>Wartungsarbeiten</body></html>', 'https://example.com/')).toEqual([]);
    }
  });
});
