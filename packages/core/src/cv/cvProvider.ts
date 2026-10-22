// Reads the CV through a CvSource and turns it into a profile. Only the derived domain weights
// are kept; the text goes out of scope at the end of readProfile.

import type { AppConfig } from '../config.js';
import type { CvSource } from '../ports.js';
import type { CvProvider, CvResult } from '../refresh.js';
import type { CvProfiler } from './cvProfiler.js';
import { StructuredCvProfiler } from './structuredProfiler.js';

export class ProfilingCvProvider implements CvProvider {
  private readonly makeProfiler: (config: AppConfig) => CvProfiler;

  constructor(
    private readonly sourceFor: (cvFolder: string) => CvSource,
    makeProfiler?: (config: AppConfig) => CvProfiler,
    private readonly now: () => number = Date.now,
  ) {
    this.makeProfiler = makeProfiler ?? ((c) => new StructuredCvProfiler(c.domains, c.cvAnalysis, this.now));
  }

  async readProfile(config: AppConfig, cvFolder: string): Promise<CvResult> {
    const read = await this.sourceFor(cvFolder).read();
    if (!read.ok) return { ok: false, problem: read.problem };
    const { fileName, modifiedMs, sizeBytes, text } = read.document;
    const profiler = this.makeProfiler(config);
    if (profiler.analyse) {
      const a = profiler.analyse(text);
      return { ok: true, profile: { fileName, modifiedMs, sizeBytes, weights: a.weights, computedAt: this.now(), source: a.source, evidence: a.evidence, notice: a.notice } };
    }
    const weights = await profiler.computeWeights(text);
    if (weights.length === 0) {
      return { ok: false, problem: `None of the domain keywords appear in ${fileName}.` };
    }
    return { ok: true, profile: { fileName, modifiedMs, sizeBytes, weights, computedAt: this.now(), source: 'auto', evidence: [], notice: null } };
  }
}
