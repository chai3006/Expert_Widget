// The CV folder on this computer as a CvSource: exactly one .pdf, .docx or .txt file, read locally.

import type { AppConfig } from '../../../core/src/config.js';
import { ProfilingCvProvider } from '../../../core/src/cv/cvProvider.js';
import type { CvProfiler } from '../../../core/src/cv/cvProfiler.js';
import type { CvReadResult, CvSource } from '../../../core/src/ports.js';
import { describeCvLookupProblem, findCv } from './cvFiles.js';
import { CvReadError, extractCvText } from './extract.js';

export class FolderCvSource implements CvSource {
  constructor(readonly folder: string) {}

  async read(): Promise<CvReadResult> {
    const lookup = await findCv(this.folder);
    if (lookup.kind !== 'ok') return { ok: false, problem: describeCvLookupProblem(lookup) };
    try {
      const text = await extractCvText(lookup.path);
      return { ok: true, document: { fileName: lookup.fileName, modifiedMs: lookup.modifiedMs, sizeBytes: lookup.sizeBytes, text } };
    } catch (err) {
      const reason = err instanceof CvReadError ? err.message : 'an unexpected error occurred';
      return { ok: false, problem: `Could not read ${lookup.fileName}: ${reason}.` };
    }
  }
}

/** The CV in the given folder, profiled with the rules in config.json. */
export class LocalCvProvider extends ProfilingCvProvider {
  constructor(makeProfiler?: (config: AppConfig) => CvProfiler, now?: () => number) {
    super((folder) => new FolderCvSource(folder), makeProfiler, now);
  }
}
