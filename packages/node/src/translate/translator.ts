// German → English translation of headlines and summaries, entirely on this PC.
// `Translator` is the seam; `BergamotTranslator` runs the offline engine in a worker thread.

import { existsSync } from 'node:fs';
import { join, sep } from 'node:path';
import { Worker } from 'node:worker_threads';
import { looksGerman } from '../../../core/src/language.js';
import type { Translator } from '../../../core/src/ports.js';
import type { WorkerMessage } from './worker.js';

export type { Translator };
export { looksGerman };

export const MODEL_FILES = ['model.deen.intgemm.alphas.bin', 'lex.50.50.deen.s2t.bin', 'vocab.deen.spm'] as const;

/** The compiled worker script next to this file. */
export const TRANSLATOR_WORKER = join(__dirname, 'worker.js');

const BATCH = 40;
const TIMEOUT_MS = 60_000;

/** Files listed in electron-builder's asarUnpack live next to app.asar, in app.asar.unpacked. */
export function unpacked(path: string): string {
  return path.replace(`${sep}app.asar${sep}`, `${sep}app.asar.unpacked${sep}`);
}

export class TranslatorUnavailable extends Error {
  override name = 'TranslatorUnavailable';
}

export class BergamotTranslator implements Translator {
  private worker: Worker | null = null;
  private ready: Promise<void> | null = null;
  private serial = 0;
  private readonly pending = new Map<number, { accept: (out: string[]) => void; reject: (e: Error) => void }>();

  constructor(
    private readonly workerScript: string,
    private readonly engineDir: string,
    private readonly modelDir: string,
  ) {}

  private start(): Promise<void> {
    if (this.ready) return this.ready;
    const missing = MODEL_FILES.filter((f) => !existsSync(join(this.modelDir, f)));
    if (missing.length > 0) return Promise.reject(new TranslatorUnavailable(`the translation model is missing (${missing.join(', ')})`));

    this.ready = new Promise<void>((resolve, reject) => {
      const worker = new Worker(this.workerScript, { workerData: { engineDir: this.engineDir, modelDir: this.modelDir } });
      this.worker = worker;
      const timer = setTimeout(() => reject(new TranslatorUnavailable('the translator did not start in time')), TIMEOUT_MS);
      worker.on('message', (m: WorkerMessage) => {
        if ('ready' in m) {
          clearTimeout(timer);
          resolve();
        } else if ('fatal' in m) {
          clearTimeout(timer);
          reject(new TranslatorUnavailable(`the translator could not start (${m.fatal})`));
        } else {
          const p = this.pending.get(m.id);
          if (!p) return;
          this.pending.delete(m.id);
          if ('error' in m) p.reject(new Error(m.error));
          else p.accept(m.out);
        }
      });
      worker.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
        for (const p of this.pending.values()) p.reject(err);
        this.pending.clear();
      });
    });
    return this.ready;
  }

  async translate(texts: string[]): Promise<string[]> {
    if (texts.length === 0) return [];
    await this.start();
    const out: string[] = [];
    for (let i = 0; i < texts.length; i += BATCH) out.push(...(await this.request(texts.slice(i, i + BATCH))));
    return out;
  }

  private request(texts: string[]): Promise<string[]> {
    const worker = this.worker;
    if (!worker) return Promise.reject(new TranslatorUnavailable('the translator is not running'));
    const id = ++this.serial;
    return new Promise<string[]>((accept, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('translation timed out'));
      }, TIMEOUT_MS);
      this.pending.set(id, {
        accept: (o) => (clearTimeout(timer), accept(o)),
        reject: (e) => (clearTimeout(timer), reject(e)),
      });
      worker.postMessage({ id, texts });
    });
  }

  /** Stops the worker; the model is loaded again (quickly) on the next Refresh. */
  async close(): Promise<void> {
    const worker = this.worker;
    this.worker = null;
    this.ready = null;
    if (worker) await worker.terminate();
  }
}
