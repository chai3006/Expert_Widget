// MOCK DATA, used only by `npm run dev:mock` (--mock). No network access, no CV file.
// Every item produced here carries `mock: true` (added in refresh.ts) and mock mode keeps its state
// in a separate folder, so none of this can appear in a normal run.

import type { AppConfig, SourceConfig, SourceTopic } from '../config.js';
import type { ParsedItem } from '../news/types.js';
import type { CvProvider, CvResult, NewsProvider } from '../refresh.js';

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
  ],
};

function isoDay(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export class MockNewsProvider implements NewsProvider {
  private readonly served = new Set<SourceTopic>();

  constructor(private readonly now: () => number = Date.now) {}

  isOnline(): boolean {
    return true;
  }

  async fetchSource(source: SourceConfig): Promise<ParsedItem[]> {
    // Only the first source of each topic gets mock items, so nothing shows up twice.
    if (this.served.has(source.topic)) return [];
    this.served.add(source.topic);
    const now = this.now();
    return MOCK_SEEDS[source.topic].map((seed, i) => {
      const start = seed.eventInDays !== undefined ? isoDay(now + seed.eventInDays * DAY) : null;
      return {
        url: `https://example.com/mock/${source.topic}/${i + 1}`,
        headline: seed.headline,
        excerpt: seed.excerpt,
        publishedAt: source.topic === 'career_fair' ? null : new Date(now - seed.ageDays * DAY - i * 3600 * 1000).toISOString(),
        eventDate: seed.tbc ? null : start,
        eventEndDate: start && seed.eventDays ? isoDay(now + (seed.eventInDays! + seed.eventDays - 1) * DAY) : start,
      };
    });
  }
}
