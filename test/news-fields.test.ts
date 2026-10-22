// News classification beyond engineering (Phase 5): made-up headlines from many fields.

import { describe, expect, it } from 'vitest';
import { RuleBasedClassifier } from '../packages/core/src/news/classifier.js';
import type { RawItem } from '../packages/core/src/news/types.js';
import { defaultConfig } from './helpers/config.js';

const classifier = new RuleBasedClassifier(defaultConfig().keywords);

const news = (headline: string, topic: RawItem['topic'] = 'hiring'): RawItem => ({
  url: 'https://example.com/a',
  headline,
  excerpt: '',
  publishedAt: '2026-10-20T08:00:00.000Z',
  eventDate: null,
  eventEndDate: null,
  sourceId: 's',
  sourceName: 'S',
  topic,
  firstSeen: 0,
});

const CASES: Array<[string, string, string]> = [
  ['Kreiskrankenhaus vor der Klinikschließung: Stellenabbau in der Pflege', 'hiring_cuts', 'healthcare-nursing'],
  ['Pflegekräfte gesucht: Altenheime in Bayern bauen Personal auf', 'hiring_growth', 'healthcare-nursing'],
  ['Modekette kündigt Filialschließungen an, 1.200 Jobs fallen weg', 'hiring_cuts', 'sales-retail-ecommerce'],
  ['Sparkasse schafft 200 neue Stellen in der Baufinanzierung', 'hiring_growth', 'finance-banking-insurance'],
  ['Logistiker eröffnet neues Lager bei Leipzig und sucht Personal', 'hiring_growth', 'logistics-supply-chain'],
  ['Lehrkräfte gesucht: Land will 2.000 zusätzliche Lehrer an Grundschulen', 'hiring_growth', 'education-research'],
  ['Pharmakonzern baut in Deutschland 500 Stellen ab', 'hiring_cuts', 'pharma-life-sciences'],
  ['Legal-Tech-Startup für Kanzleien sammelt 12 Millionen Euro ein', 'funded_startup', 'law-compliance'],
  ['Hotels und Restaurants suchen Personal für die Saison', 'hiring_growth', 'hospitality-tourism'],
  ['Werbeagentur streicht ein Drittel der Stellen, Marketing-Budgets sinken', 'hiring_cuts', 'marketing-media'],
  ['Retailer announces store closures and job cuts in Germany', 'hiring_cuts', 'sales-retail-ecommerce'],
  ['Insurance group hires 300 claims handlers in Cologne', 'hiring_growth', 'finance-banking-insurance'],
  ['Stadtverwaltung startet Einstellungsoffensive für den öffentlichen Dienst', 'hiring_growth', 'public-sector'],
  ['Personaldienstleister meldet Insolvenz an, Recruiting-Teams betroffen', 'hiring_cuts', 'hr-recruiting'],
];

describe('news classification for all fields', () => {
  it.each(CASES)('%s → %s, %s', (headline, tag, domain) => {
    expect(classifier.classify(news(headline))).toEqual({ tag, domain });
  });

  it('still skips headlines that are no hiring, funding or fair signal', () => {
    expect(classifier.classify(news('DAX schließt leicht im Plus'))).toBeNull();
    expect(classifier.classify(news('Wetter: Sonnig und mild am Wochenende'))).toBeNull();
  });

  it('takes funding news from a startup source only when it names money', () => {
    expect(classifier.classify(news('Food-Startup für Bäckereien schließt Seed-Runde ab', 'funded_startup'))).toEqual({ tag: 'funded_startup', domain: 'agriculture-food' });
    expect(classifier.classify(news('Gründerin im Porträt', 'funded_startup'))).toBeNull();
  });
});
