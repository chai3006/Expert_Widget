// Validators for the JSON Schemas in contracts/ (Ajv, JSON Schema 2020-12).

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { ROOT } from './config.js';

export const CONTRACTS = join(ROOT, 'contracts');

const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addFormat('date-time', (s: string) => !Number.isNaN(Date.parse(s)) && /^\d{4}-\d{2}-\d{2}T/.test(s));

export const schemaFiles = readdirSync(CONTRACTS).filter((f) => f.endsWith('.schema.json'));
const validators = new Map(schemaFiles.map((f) => [f.replace(/\.v\d+\.schema\.json$/, ''), ajv.compile(JSON.parse(readFileSync(join(CONTRACTS, f), 'utf8')))]));

/** Returns the schema errors for a document, or [] when it is valid. */
export function schemaErrors(name: string, doc: unknown): string[] {
  const validate = validators.get(name);
  if (!validate) throw new Error(`no schema named ${name}`);
  return validate(doc) ? [] : (validate.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message}`);
}
