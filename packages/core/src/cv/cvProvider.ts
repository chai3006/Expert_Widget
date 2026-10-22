// Reads the CV through a CvSource and turns it into a profile. Only the derived domain weights
// are kept; the text goes out of scope at the end of readProfile.

import { domainOrder, type AppConfig } from '../config.js';
import type { CvSource } from '../ports.js';
import type { CvProvider, CvResult } from '../refresh.js';
import { RuleBasedCvProfiler, type CvProfiler } from './cvProfiler.js';

export class ProfilingCvProvider implements CvProvider {
  constructor(
    private readonly sourceFor: (cvFolder: string) => CvSource,
    private readonly makeProfiler: (config: AppConfig) => CvProfiler = (c) => new RuleBasedCvProfiler(c.keywords.domains, domainOrder(c)),
    private readonly now: () => number = Date.now,
  ) {}

  async readProfile(config: AppConfig, cvFolder: string): Promise<CvResult> {
    const read = await this.sourceFor(cvFolder).read();
    if (!read.ok) return { ok: false, problem: read.problem };
    const { fileName, modifiedMs, text } = read.document;
    const weights = await this.makeProfiler(config).computeWeights(text);
    if (weights.length === 0) {
      return { ok: false, problem: `None of the domain keywords in config.json appear in ${fileName}.` };
    }
    return { ok: true, profile: { fileName, modifiedMs, weights, computedAt: this.now() } };
  }
}
