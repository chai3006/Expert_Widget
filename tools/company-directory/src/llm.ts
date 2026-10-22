// The language model behind the company-directory generator (maintainer tooling, never part of the
// app). The prompt contains only a domain's name and description from data/domains, never CV data.
// The API key comes from ANTHROPIC_API_KEY and is neither stored nor logged.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';

export interface LlmRequest {
  system: string;
  prompt: string;
  /** JSON Schema the answer must follow (structured output). */
  schema: Record<string, unknown>;
  maxTokens: number;
}

export interface LlmResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
  /** The model that answered (a refusal fallback may answer with another one). */
  model: string;
  cached: boolean;
}

export interface LlmClient {
  readonly model: string;
  complete(request: LlmRequest): Promise<LlmResponse>;
}

export const DEFAULT_MODEL = 'claude-opus-5-5';

/** US dollars per million tokens (input, output), first-party API prices as of October 2026. */
export const PRICES: Record<string, { input: number; output: number }> = {
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
};

/**
 * Worst-case cost of one request before sending it: the prompt at about 3.5 characters per token
 * plus every output token up to maxTokens (thinking counts as output). Real runs usually cost less.
 */
export function estimateCost(model: string, request: Pick<LlmRequest, 'system' | 'prompt' | 'maxTokens'>): number {
  const price = PRICES[model];
  if (!price) throw new Error(`no price known for model ${model}; add it to PRICES`);
  const inputTokens = Math.ceil((request.system.length + request.prompt.length) / 3.5);
  return (inputTokens * price.input + request.maxTokens * price.output) / 1_000_000;
}

export function actualCost(model: string, response: Pick<LlmResponse, 'inputTokens' | 'outputTokens' | 'cached'>): number {
  if (response.cached) return 0;
  const price = PRICES[model] ?? PRICES[DEFAULT_MODEL];
  return (response.inputTokens * price.input + response.outputTokens * price.output) / 1_000_000;
}

export class RefusedError extends Error {
  override name = 'RefusedError';
}

/** The Claude API through the official SDK, with structured output and the server-side refusal fallback. */
export class ClaudeClient implements LlmClient {
  private readonly client: Anthropic;

  constructor(
    readonly model: string = DEFAULT_MODEL,
    apiKey = process.env.ANTHROPIC_API_KEY,
  ) {
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
    this.client = new Anthropic({ apiKey });
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const response = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: request.maxTokens,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: request.schema } },
      system: request.system,
      messages: [{ role: 'user', content: request.prompt }],
    });
    if (response.stop_reason === 'refusal') throw new RefusedError('the model declined the request');
    if (response.stop_reason === 'max_tokens') throw new Error('the answer was cut off at max_tokens; raise --max-tokens');
    const text = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
    return { text, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens, model: response.model, cached: false };
  }
}

/** Keeps every answer on disk by a hash of model and request, so a rerun costs nothing. */
export class CachedLlmClient implements LlmClient {
  constructor(
    private readonly inner: LlmClient,
    private readonly dir: string,
  ) {}

  get model(): string {
    return this.inner.model;
  }

  keyFor(request: LlmRequest): string {
    return createHash('sha256').update(JSON.stringify([this.inner.model, request])).digest('hex');
  }

  cachedAnswer(request: LlmRequest): LlmResponse | null {
    const file = join(this.dir, `${this.keyFor(request)}.json`);
    if (!existsSync(file)) return null;
    return { ...(JSON.parse(readFileSync(file, 'utf8')) as LlmResponse), cached: true };
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const hit = this.cachedAnswer(request);
    if (hit) return hit;
    const response = await this.inner.complete(request);
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(join(this.dir, `${this.keyFor(request)}.json`), JSON.stringify(response, null, 2));
    return response;
  }
}
