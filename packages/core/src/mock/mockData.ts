// MOCK DATA, used only by `npm run dev:mock` (--mock). No network access, no CV file.
// Every item produced here carries `mock: true` (added in refresh.ts) and mock mode keeps its state
// in a separate folder, so none of this can appear in a normal run.

import { enabledProviders, type AppConfig, type ProviderInfo, type SourceTopic } from '../config.js';
import type { NewsProvider, ProviderQuery } from '../news/provider.js';
import type { ParsedItem } from '../news/types.js';
import type { CvProvider, CvResult } from '../refresh.js';

const DAY = 24 * 60 * 60 * 1000;

export class MockCvProvider implements CvProvider {
  constructor(private readonly now: () => number = Date.now) {}

  async readProfile(_config: AppConfig, _cvFolder: string): Promise<CvResult> {
    return {
      ok: true,
      profile: {
        fileName: 'MOCK_Lebenslauf.pdf',
        modifiedMs: this.now() - 3 * DAY,
        computedAt: this.now(),
        weights: [
          { domain: 'automotive-emobility', weight: 52 },
          { domain: 'embedded-iot', weight: 26 },
          { domain: 'energy-storage', weight: 14 },
          { domain: 'software-ai', weight: 8 },
        ],
        source: 'auto',
        evidence: [
          { domain: 'automotive-emobility', label: 'AUTOSAR', kind: 'keyword', period: '2021 to now', current: true },
          { domain: 'automotive-emobility', label: 'Fahrzeugtechnik', kind: 'education', period: '2012 to 2017', current: false },
          { domain: 'embedded-iot', label: 'Embedded Software Engineer', kind: 'title', period: '2021 to now', current: true },
          { domain: 'energy-storage', label: 'Batteriemanagement', kind: 'keyword', period: '2017 to 2021', current: false },
          { domain: 'software-ai', label: 'Python', kind: 'skill', period: null, current: false },
        ],
        notice: null,
      },
    };
  }
}

type MockSeed = { headline: string; excerpt: string; ageDays: number; eventInDays?: number; eventDays?: number; tbc?: boolean };

const MOCK_SEEDS: Record<SourceTopic, MockSeed[]> = {
  hiring: [
    { headline: '[MOCK] Zulieferer schafft 400 neue Arbeitsplätze in neuem Werk für Leistungselektronik', excerpt: 'Der Automobilzulieferer baut die Fertigung von Wechselrichtern für Elektroautos in Sachsen aus.', ageDays: 0 },
    { headline: '[MOCK] Autobauer kündigt Stellenabbau in der Verwaltung an', excerpt: 'Bis 2028 sollen rund 2.000 Stellen in Deutschland wegfallen, die Entwicklung ist nicht betroffen.', ageDays: 1 },
    { headline: '[MOCK] Batteriezellwerk startet Einstellungsoffensive für Ingenieure', excerpt: 'Gesucht werden Fachkräfte für Zellchemie, Qualität und Batteriemanagement.', ageDays: 2 },
    { headline: '[MOCK] Embedded-Spezialist expandiert und sucht Fachkräfte für Firmware und IoT', excerpt: 'Neuer Standort in München mit 120 Stellen für Mikrocontroller- und Firmware-Entwicklung.', ageDays: 3 },
    { headline: '[MOCK] Maschinenbauer meldet Kurzarbeit an zwei Standorten', excerpt: 'Schwache Auftragslage im Maschinenbau trifft auch die Konstruktion.', ageDays: 4 },
    { headline: '[MOCK] Software house hiring 80 engineers for cloud and machine learning', excerpt: 'Expansion of the Berlin office focuses on Python and Kubernetes.', ageDays: 5 },
  ],
  funded_startup: [
    { headline: '[MOCK] Ladeinfrastruktur-Startup erhält 12 Millionen Euro in Series A', excerpt: 'Das Münchner Startup entwickelt Wallboxen für Flotten.', ageDays: 0 },
    { headline: '[MOCK] IoT-Sensorik-Startup sammelt 3 Millionen Euro Seed-Finanzierung ein', excerpt: 'Funksensoren mit eigener Firmware für die Industrie.', ageDays: 2 },
    { headline: '[MOCK] Battery recycling startup raises EUR 20 million funding round', excerpt: 'Lithium-ion recycling plant planned in Saxony-Anhalt.', ageDays: 3 },
    { headline: '[MOCK] Fintech erhält 5 Millionen Euro', excerpt: 'Payment-Lösung für Freiberufler.', ageDays: 1 },
  ],
  career_fair: [
    { headline: '[MOCK] VDI nachrichten Recruiting Tag Stuttgart', excerpt: 'Career fair for engineers and IT specialists in Stuttgart.', ageDays: 0, eventInDays: 9 },
    { headline: '[MOCK] Karrieretag Automotive München', excerpt: 'Karrieremesse für Fach- und Führungskräfte · München', ageDays: 0, eventInDays: 21, eventDays: 2 },
    { headline: '[MOCK] Engineering Career Day Berlin', excerpt: 'Karrieremesse · Berlin', ageDays: 0, tbc: true },
    { headline: '[MOCK] Startup-Karrieretag München mit CELUS und 30 weiteren Hardware-Startups', excerpt: 'Karrieremesse · München', ageDays: 0, eventInDays: 14 },
  ],
};

/** Watchlist search results, by company name (the names in defaults/watchlist.json). */
const MOCK_WATCHLIST_SEARCH: Record<string, MockSeed[]> = {
  CELUS: [
    { headline: '[MOCK] CELUS sammelt 25 Millionen Euro in Series B ein', excerpt: 'Article on example.com, found by the GDELT news search.', ageDays: 1 },
  ],
  Valispace: [
    { headline: '[MOCK] Valispace expandiert und schafft neue Stellen in Bremen', excerpt: 'Article on example.com, found by the GDELT news search.', ageDays: 2 },
    { headline: '[MOCK] Webinar: Valispace zeigt Requirements Engineering für Hardware-Teams', excerpt: 'Article on example.com, found by the GDELT news search.', ageDays: 0 },
  ],
  'Hefex Labs': [
    { headline: '[MOCK] Hefex Labs eröffnet Labor in Garching und sucht Fachkräfte', excerpt: 'Article on example.com, found by the GDELT news search.', ageDays: 3 },
  ],
};

function isoDay(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const MOCK_SEARCH: MockSeed[] = [
  { headline: '[MOCK] Elektroauto-Zulieferer stellt 250 Ingenieure für neue Plattform ein', excerpt: 'Article on example.com, found by the GDELT news search.', ageDays: 1 },
  { headline: '[MOCK] Embedded-Firma schließt Finanzierungsrunde über 8 Millionen Euro ab', excerpt: 'Article on example.com, found by the GDELT news search.', ageDays: 2 },
];

/**
 * Mock providers mirroring the enabled real ones (same ids, names and layers), so the source-health
 * line looks like a normal run. The first feed of each topic serves mock items, the search serves a
 * couple, and the second hiring feed always fails so the "needs attention" state can be designed.
 */
export function mockProviders(config: AppConfig, now: () => number = Date.now): NewsProvider[] {
  const served = new Set<SourceTopic>();
  let hiringFeeds = 0;
  return enabledProviders(config).map((info) => {
    let seeds: MockSeed[] = [];
    let fails = false;
    if (info.layer === 1) {
      if (info.topic === 'hiring' && ++hiringFeeds === 2) fails = true;
      else if (!served.has(info.topic)) {
        served.add(info.topic);
        seeds = MOCK_SEEDS[info.topic];
      }
    } else if (info.layer === 2) {
      seeds = MOCK_SEARCH;
    }
    return new MockProvider(info, seeds, fails, now);
  });
}

class MockProvider implements NewsProvider {
  readonly id: string;
  readonly name: string;
  readonly layer: 1 | 2 | 3;
  readonly topic: SourceTopic;
  readonly domains: ProviderInfo['domains'];

  constructor(
    info: ProviderInfo,
    private readonly seeds: MockSeed[],
    private readonly fails: boolean,
    private readonly now: () => number,
  ) {
    this.id = info.id;
    this.name = info.name;
    this.layer = info.layer;
    this.topic = info.topic;
    this.domains = info.domains;
  }

  async fetch(query: ProviderQuery): Promise<ParsedItem[]> {
    if (this.fails) throw new Error('[MOCK] simulated failure');
    const items = this.items(this.seeds, query, (i) => `${i + 1}`);
    if (this.layer === 2) {
      for (const name of query.companies) {
        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        items.push(...this.items(MOCK_WATCHLIST_SEARCH[name] ?? [], query, (i) => `watchlist-${slug}-${i + 1}`).map((item) => ({ ...item, queryCompany: name })));
      }
    }
    return items;
  }

  private items(seeds: MockSeed[], query: ProviderQuery, path: (i: number) => string): ParsedItem[] {
    const now = this.now();
    return seeds.map((seed, i) => {
      const start = seed.eventInDays !== undefined ? isoDay(now + seed.eventInDays * DAY) : null;
      return {
        url: `https://example.com/mock/${this.id}/${path(i)}`,
        headline: seed.headline,
        excerpt: seed.excerpt,
        publishedAt: this.topic === 'career_fair' ? null : new Date(now - seed.ageDays * DAY - i * 3600 * 1000).toISOString(),
        eventDate: seed.tbc ? null : start,
        eventEndDate: start && seed.eventDays ? isoDay(now + (seed.eventInDays! + seed.eventDays - 1) * DAY) : start,
        ...(this.layer > 1 ? { publisher: 'example.com', queryTopic: query.topics[0]?.topic } : {}),
      };
    });
  }
}
