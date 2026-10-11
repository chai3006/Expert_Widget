// Real implementations of the refresh providers: the local CV and the news providers (layers 1-3).

import { GDELT_PROVIDER_ID, GOOGLE_NEWS_PROVIDER_ID, domainOrder, type AppConfig, type SourceConfig, type SourceTopic } from './config.js';
import { findCv, describeCvLookupProblem } from './cv/cvFiles.js';
import { RuleBasedCvProfiler, type CvProfiler } from './cv/cvProfiler.js';
import { CvReadError, extractCvText } from './cv/extract.js';
import { ADAPTERS } from './news/adapters/index.js';
import { gdeltCompanyUrl, gdeltUrl, googleNewsCompanyUrl, googleNewsUrl, parseGdelt, parseGoogleNews } from './news/adapters/search.js';
import type { PoliteFetcher } from './news/fetcher.js';
import type { DomainQuery, NewsProvider, ProviderQuery } from './news/provider.js';
import type { ParsedItem } from './news/types.js';
import { WatchlistMatcher } from './news/watchlist.js';
import type { DomainId } from '../shared/types.js';
import type { CvProvider, CvResult } from './refresh.js';

export class LocalCvProvider implements CvProvider {
  constructor(
    private readonly makeProfiler: (config: AppConfig) => CvProfiler = (c) => new RuleBasedCvProfiler(c.keywords.domains, domainOrder(c)),
    private readonly now: () => number = Date.now,
  ) {}

  async readProfile(config: AppConfig, cvFolder: string): Promise<CvResult> {
    const lookup = await findCv(cvFolder);
    if (lookup.kind !== 'ok') return { ok: false, problem: describeCvLookupProblem(lookup) };

    let text: string;
    try {
      text = await extractCvText(lookup.path);
    } catch (err) {
      const reason = err instanceof CvReadError ? err.message : 'an unexpected error occurred';
      return { ok: false, problem: `Could not read ${lookup.fileName}: ${reason}.` };
    }
    const weights = await this.makeProfiler(config).computeWeights(text);
    // The text goes out of scope here; only the derived weights are kept.
    if (weights.length === 0) {
      return { ok: false, problem: `None of the domain keywords in config.json appear in ${lookup.fileName}.` };
    }
    return { ok: true, profile: { fileName: lookup.fileName, modifiedMs: lookup.modifiedMs, weights, computedAt: this.now() } };
  }
}

/** Layer 1: one configured source, read through its feed or HTML adapter. */
export class FeedProvider implements NewsProvider {
  readonly layer = 1 as const;
  readonly id: string;
  readonly name: string;
  readonly topic: SourceTopic;
  readonly domains: SourceConfig['domains'];

  constructor(
    private readonly source: SourceConfig,
    private readonly fetcher: PoliteFetcher,
  ) {
    this.id = source.id;
    this.name = source.name;
    this.topic = source.topic;
    this.domains = source.domains;
  }

  async fetch(): Promise<ParsedItem[]> {
    const body = await this.fetcher.getText(this.source.url);
    const items = ADAPTERS[this.source.adapter](body, this.source.url);
    if (items.length === 0 && this.source.adapter !== 'rss') {
      // An HTML adapter finding nothing almost always means the page layout changed.
      throw new Error('no items found, the page layout may have changed');
    }
    return items;
  }
}

/**
 * Layers 2 and 3: one search request per domain in the mix, then one per watchlist company (by
 * name only; only articles naming the company exactly are kept). Any failed request fails the
 * provider.
 */
abstract class SearchProvider implements NewsProvider {
  readonly topic = 'hiring' as const;
  readonly domains = 'all' as const;
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly layer: 2 | 3;

  constructor(protected readonly fetcher: PoliteFetcher) {}

  protected abstract url(q: DomainQuery, query: ProviderQuery): string;
  protected abstract companyUrl(name: string, query: ProviderQuery): string;
  protected abstract parse(body: string, domain?: DomainId): ParsedItem[];

  async fetch(query: ProviderQuery): Promise<ParsedItem[]> {
    const items: ParsedItem[] = [];
    for (const q of query.domains) {
      const body = await this.fetcher.getText(this.url(q, query));
      items.push(...this.parse(body, q.domain));
    }
    for (const name of query.companies) {
      const body = await this.fetcher.getText(this.companyUrl(name, query));
      const named = new WatchlistMatcher([name]);
      items.push(...this.parse(body).filter((i) => named.match(i).length > 0).map((i) => ({ ...i, queryCompany: name })));
    }
    return items;
  }
}

export class GdeltProvider extends SearchProvider {
  readonly id = GDELT_PROVIDER_ID;
  readonly name = 'GDELT news search';
  readonly layer = 2 as const;

  constructor(
    fetcher: PoliteFetcher,
    private readonly maxRecords: number,
  ) {
    super(fetcher);
  }

  protected url(q: DomainQuery, query: ProviderQuery): string {
    return gdeltUrl(q, query.signalKeywords, query.maxAgeDays, this.maxRecords);
  }

  protected companyUrl(name: string, query: ProviderQuery): string {
    return gdeltCompanyUrl(name, query.maxAgeDays, this.maxRecords);
  }

  protected parse(body: string, domain?: DomainId): ParsedItem[] {
    return parseGdelt(body, domain);
  }
}

export class GoogleNewsProvider extends SearchProvider {
  readonly id = GOOGLE_NEWS_PROVIDER_ID;
  readonly name = 'Google News search';
  readonly layer = 3 as const;

  protected url(q: DomainQuery, query: ProviderQuery): string {
    return googleNewsUrl(q, query.signalKeywords, query.maxAgeDays);
  }

  protected companyUrl(name: string, query: ProviderQuery): string {
    return googleNewsCompanyUrl(name, query.maxAgeDays);
  }

  protected parse(body: string, domain?: DomainId): ParsedItem[] {
    return parseGoogleNews(body, domain);
  }
}

/** The enabled providers for this config, in the order of enabledProviders(). */
export function buildProviders(config: AppConfig, fetcher: PoliteFetcher): NewsProvider[] {
  const providers: NewsProvider[] = config.sources.filter((s) => s.enabled).map((s) => new FeedProvider(s, fetcher));
  if (config.search.gdelt.enabled) providers.push(new GdeltProvider(fetcher, config.search.gdelt.maxRecords));
  if (config.search.googleNews.enabled) providers.push(new GoogleNewsProvider(fetcher));
  return providers;
}

/** GDELT asks for at most one request every 5 seconds; every other host gets 2 seconds. */
export const HOST_INTERVALS_MS: Record<string, number> = { 'api.gdeltproject.org': 5500 };
