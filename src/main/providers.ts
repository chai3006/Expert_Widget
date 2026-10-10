// Real implementations of the refresh providers: the local CV and the network sources.

import { domainOrder, type AppConfig, type SourceConfig } from './config.js';
import { findCv, describeCvLookupProblem } from './cv/cvFiles.js';
import { RuleBasedCvProfiler, type CvProfiler } from './cv/cvProfiler.js';
import { CvReadError, extractCvText } from './cv/extract.js';
import { ADAPTERS } from './news/adapters/index.js';
import type { PoliteFetcher } from './news/fetcher.js';
import type { ParsedItem } from './news/types.js';
import type { CvProvider, CvResult, NewsProvider } from './refresh.js';

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

export class WebNewsProvider implements NewsProvider {
  constructor(
    private readonly fetcher: PoliteFetcher,
    private readonly online: () => boolean,
  ) {}

  isOnline(): boolean {
    return this.online();
  }

  async fetchSource(source: SourceConfig): Promise<ParsedItem[]> {
    const body = await this.fetcher.getText(source.url);
    const items = ADAPTERS[source.adapter](body, source.url);
    if (items.length === 0 && source.adapter !== 'rss') {
      // An HTML adapter finding nothing almost always means the page layout changed.
      throw new Error('no items found, the page layout may have changed');
    }
    return items;
  }
}
