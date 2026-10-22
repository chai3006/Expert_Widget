// Translation worker thread: runs the Bergamot engine (the offline translator Firefox uses,
// compiled to WebAssembly) with a German→English model from local files. No network access.
//
// The npm package's own worker cannot be used: it is an ES module that calls require(), and it
// builds Windows file paths from URL pathnames. This is a small replacement that loads the same
// Emscripten glue and .wasm file and calls the same bindings.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInThisContext } from 'node:vm';
import { parentPort, workerData } from 'node:worker_threads';

export interface WorkerInput {
  /** Folder with bergamot-translator-worker.js and .wasm (from @browsermt/bergamot-translator). */
  engineDir: string;
  /** Folder with model.deen.intgemm.alphas.bin, lex.50.50.deen.s2t.bin and vocab.deen.spm. */
  modelDir: string;
}

export type WorkerRequest = { id: number; texts: string[] };
export type WorkerMessage = { ready: true } | { fatal: string } | { id: number; out: string[] } | { id: number; error: string };

// Embedded fallbacks for the matrix functions Firefox Nightly can provide natively.
const GEMM: Record<string, string> = {
  int8_prepare_a: 'int8PrepareAFallback',
  int8_prepare_b: 'int8PrepareBFallback',
  int8_prepare_b_from_transposed: 'int8PrepareBFromTransposedFallback',
  int8_prepare_b_from_quantized_transposed: 'int8PrepareBFromQuantizedTransposedFallback',
  int8_prepare_bias: 'int8PrepareBiasFallback',
  int8_multiply_and_add_bias: 'int8MultiplyAndAddBiasFallback',
  int8_select_columns_of_b: 'int8SelectColumnsOfBFallback',
};

// Same settings as the package's worker (defaults plus its fixed overrides).
const MODEL_CONFIG = [
  'beam-size: 1',
  'normalize: 1.0',
  'word-penalty: 0',
  'cpu-threads: 0',
  'gemm-precision: int8shiftAlphaAll',
  'skip-cost: true',
  'alignment: soft',
  'quiet: true',
  'quiet-translation: true',
  'max-length-break: 128',
  'mini-batch-words: 1024',
  'workspace: 128',
  'max-length-factor: 2.0',
].join('\n');

/* eslint-disable @typescript-eslint/no-explicit-any -- the Emscripten module has no types */
type Bergamot = any;
// The main-process tsconfig has no DOM lib, so the WebAssembly global is declared loosely here.
declare const WebAssembly: { instantiate(bytes: Uint8Array, imports: object): Promise<{ instance: unknown }> };

function loadEngine(engineDir: string): Promise<Bergamot> {
  return new Promise((resolve, reject) => {
    const wasm = readFileSync(join(engineDir, 'bergamot-translator-worker.wasm'));
    const Module: Record<string, any> = {
      instantiateWasm(info: object, accept: (instance: unknown) => void) {
        const gemm = Object.fromEntries(Object.entries(GEMM).map(([name, fallback]) => [name, (...args: unknown[]) => Module.asm[fallback](...args)]));
        WebAssembly.instantiate(wasm, { ...info, wasm_gemm: gemm })
          .then(({ instance }) => accept(instance))
          .catch(reject);
        return {};
      },
      onRuntimeInitialized: () => resolve(Module),
      print: () => undefined,
      printErr: () => undefined,
    };
    // The glue code expects these as globals, like in a classic script.
    const g = globalThis as any;
    g.Module = Module;
    g.require = require;
    g.__dirname = engineDir;
    g.__filename = join(engineDir, 'bergamot-translator-worker.js');
    runInThisContext(readFileSync(g.__filename, 'utf8'), { filename: g.__filename });
  });
}

function aligned(M: Bergamot, data: Buffer, alignment: number): Bergamot {
  const bytes = new Int8Array(data.buffer, data.byteOffset, data.byteLength);
  const memory = new M.AlignedMemory(bytes.byteLength, alignment);
  memory.getByteArrayView().set(bytes);
  return memory;
}

async function main(): Promise<void> {
  const port = parentPort;
  if (!port) return;
  const { engineDir, modelDir } = workerData as WorkerInput;
  try {
    const M = await loadEngine(engineDir);
    const service = new M.BlockingService({ cacheSize: 0 });
    const vocabs = new M.AlignedMemoryList();
    vocabs.push_back(aligned(M, readFileSync(join(modelDir, 'vocab.deen.spm')), 64));
    const model = new M.TranslationModel(
      `${MODEL_CONFIG}\n`,
      aligned(M, readFileSync(join(modelDir, 'model.deen.intgemm.alphas.bin')), 256),
      aligned(M, readFileSync(join(modelDir, 'lex.50.50.deen.s2t.bin')), 64),
      vocabs,
      null,
    );

    port.on('message', ({ id, texts }: WorkerRequest) => {
      try {
        const input = new M.VectorString();
        const options = new M.VectorResponseOptions();
        for (const text of texts) {
          input.push_back(text);
          options.push_back({ alignment: false, html: false, qualityScores: false });
        }
        const responses = service.translate(model, input, options);
        const out = texts.map((_, i) => String(responses.get(i).getTranslatedText()));
        input.delete();
        options.delete();
        responses.delete();
        port.postMessage({ id, out } satisfies WorkerMessage);
      } catch (err) {
        port.postMessage({ id, error: err instanceof Error ? err.message : String(err) } satisfies WorkerMessage);
      }
    });
    port.postMessage({ ready: true } satisfies WorkerMessage);
  } catch (err) {
    port.postMessage({ fatal: err instanceof Error ? err.message : String(err) } satisfies WorkerMessage);
  }
}

void main();
