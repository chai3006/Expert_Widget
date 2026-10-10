import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateConfig, validateEmployers, type AppConfig, type EmployerSegment } from '../../src/main/config.js';

export const ROOT = join(__dirname, '..', '..');
export const FIXTURES = join(ROOT, 'test', 'fixtures');

export function defaultConfigJson(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(ROOT, 'defaults', 'config.json'), 'utf8'));
}

export function defaultConfig(): AppConfig {
  const result = validateConfig(defaultConfigJson());
  if (!result.ok) throw new Error(result.errors.join('\n'));
  return result.value;
}

export function defaultEmployers(): EmployerSegment[] {
  const result = validateEmployers(JSON.parse(readFileSync(join(ROOT, 'defaults', 'employers.json'), 'utf8')));
  if (!result.ok) throw new Error(result.errors.join('\n'));
  return result.value;
}

export function fixture(...parts: string[]): string {
  return readFileSync(join(FIXTURES, ...parts), 'utf8');
}
