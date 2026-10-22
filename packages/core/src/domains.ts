// The domain registry: every field of work Expert knows, loaded from data/domains/<id>.json.
// Adding a domain means adding one file there (the Node layer reads the folder; the core only
// validates what it is given). The registry order (the files' `order`) is the tie-break order.

export const DOMAIN_SCHEMA_VERSION = 1;

/** A term with a weight. Plain strings in a domain file count with weight 1. */
export interface WeightedTerm {
  term: string;
  weight: number;
}

export interface DomainDefinition {
  schemaVersion: number;
  id: string;
  order: number;
  /** Broad sector for the fixed news searches (the same for every user). */
  sector: string;
  label: { de: string; en: string };
  shortLabel: { de: string; en: string };
  /** One sentence in English; also what the company-directory generator is told about the domain. */
  description: string;
  /** The `general` domain: used when nothing in a CV can be recognised. */
  fallback: boolean;
  /** Words of the field, German and English. Weak signal in a CV body, medium in a skills section. */
  keywords: WeightedTerm[];
  /** Job titles. Strong signal in the experience section. */
  titles: WeightedTerm[];
  /** Degrees, vocational training and certificates. Strong signal in education and certificates. */
  education: WeightedTerm[];
}

export type Validated<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function text(v: unknown, path: string, errors: string[]): { de: string; en: string } {
  if (!isObject(v) || typeof v.de !== 'string' || v.de.trim() === '' || typeof v.en !== 'string' || v.en.trim() === '') {
    errors.push(`${path}: must be { "de": "...", "en": "..." }`);
    return { de: '', en: '' };
  }
  return { de: v.de.trim(), en: v.en.trim() };
}

function terms(v: unknown, path: string, errors: string[]): WeightedTerm[] {
  if (!Array.isArray(v)) {
    errors.push(`${path}: must be a list`);
    return [];
  }
  const out: WeightedTerm[] = [];
  const seen = new Set<string>();
  v.forEach((t, i) => {
    const entry = typeof t === 'string' ? { term: t, weight: 1 } : t;
    if (!isObject(entry) || typeof entry.term !== 'string' || entry.term.trim() === '') {
      errors.push(`${path}[${i}]: must be a non-empty string or { "term": "...", "weight": 1 }`);
      return;
    }
    const weight = entry.weight ?? 1;
    if (typeof weight !== 'number' || !(weight > 0 && weight <= 3)) {
      errors.push(`${path}[${i}].weight: must be a number above 0 and at most 3`);
      return;
    }
    const key = entry.term.trim().toLowerCase();
    if (seen.has(key)) {
      errors.push(`${path}[${i}]: "${entry.term}" is listed twice`);
      return;
    }
    seen.add(key);
    out.push({ term: entry.term.trim(), weight });
  });
  return out;
}

/** Validates one domain file; `fileId` is the file name without .json and must equal the id. */
export function validateDomain(raw: unknown, fileId?: string): Validated<DomainDefinition> {
  const errors: string[] = [];
  const where = fileId ? `${fileId}.json` : 'domain';
  if (!isObject(raw)) return { ok: false, errors: [`${where}: the top level must be an object`] };
  if (raw.schemaVersion !== DOMAIN_SCHEMA_VERSION) errors.push(`${where} schemaVersion: must be ${DOMAIN_SCHEMA_VERSION}`);
  if (typeof raw.id !== 'string' || !ID.test(raw.id)) errors.push(`${where} id: must be lowercase letters, digits and single dashes`);
  else if (fileId !== undefined && raw.id !== fileId) errors.push(`${where} id: "${raw.id}" must match the file name`);
  if (typeof raw.order !== 'number' || !Number.isFinite(raw.order)) errors.push(`${where} order: must be a number`);
  if (typeof raw.sector !== 'string' || !ID.test(raw.sector)) errors.push(`${where} sector: must be an id such as "health"`);
  if (typeof raw.description !== 'string' || raw.description.trim() === '') errors.push(`${where} description: must be a sentence`);
  if (raw.fallback !== undefined && typeof raw.fallback !== 'boolean') errors.push(`${where} fallback: must be true or false`);
  const label = text(raw.label, `${where} label`, errors);
  const shortLabel = text(raw.shortLabel, `${where} shortLabel`, errors);
  const keywords = terms(raw.keywords, `${where} keywords`, errors);
  const titles = terms(raw.titles, `${where} titles`, errors);
  const education = terms(raw.education, `${where} education`, errors);
  const fallback = raw.fallback === true;
  if (!fallback && keywords.length + titles.length === 0) errors.push(`${where}: needs keywords or titles`);
  for (const key of Object.keys(raw)) {
    if (!['schemaVersion', 'id', 'order', 'sector', 'label', 'shortLabel', 'description', 'fallback', 'keywords', 'titles', 'education'].includes(key)) {
      errors.push(`${where}: unknown field "${key}"`);
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      schemaVersion: DOMAIN_SCHEMA_VERSION,
      id: raw.id as string,
      order: raw.order as number,
      sector: raw.sector as string,
      label,
      shortLabel,
      description: (raw.description as string).trim(),
      fallback,
      keywords,
      titles,
      education,
    },
  };
}

export class DomainRegistry {
  readonly domains: readonly DomainDefinition[];
  private readonly byId: Map<string, DomainDefinition>;

  private constructor(domains: DomainDefinition[]) {
    this.domains = [...domains].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    this.byId = new Map(this.domains.map((d) => [d.id, d]));
  }

  /** Checks the set as a whole: unique ids and orders, exactly one fallback domain. */
  static create(domains: DomainDefinition[]): Validated<DomainRegistry> {
    const errors: string[] = [];
    const ids = new Set<string>();
    const orders = new Map<number, string>();
    for (const d of domains) {
      if (ids.has(d.id)) errors.push(`domain "${d.id}" is defined twice`);
      ids.add(d.id);
      const other = orders.get(d.order);
      if (other) errors.push(`domains "${other}" and "${d.id}" have the same order ${d.order}`);
      orders.set(d.order, d.id);
    }
    const fallbacks = domains.filter((d) => d.fallback);
    if (fallbacks.length !== 1) errors.push(`exactly one domain must have "fallback": true (found ${fallbacks.length})`);
    return errors.length > 0 ? { ok: false, errors } : { ok: true, value: new DomainRegistry(domains) };
  }

  /** Validates raw domain documents (file id → parsed JSON) and builds the registry. */
  static fromRaw(files: ReadonlyArray<{ id: string; raw: unknown }>): Validated<DomainRegistry> {
    const errors: string[] = [];
    const defs: DomainDefinition[] = [];
    for (const f of files) {
      const r = validateDomain(f.raw, f.id);
      if (r.ok) defs.push(r.value);
      else errors.push(...r.errors);
    }
    if (errors.length > 0) return { ok: false, errors };
    return DomainRegistry.create(defs);
  }

  get ids(): string[] {
    return this.domains.map((d) => d.id);
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  get(id: string): DomainDefinition | undefined {
    return this.byId.get(id);
  }

  get fallback(): DomainDefinition {
    return this.domains.find((d) => d.fallback) as DomainDefinition;
  }

  /** The domains that can be recognised in a CV or a headline (all but the fallback). */
  get recognisable(): DomainDefinition[] {
    return this.domains.filter((d) => !d.fallback);
  }

  label(id: string, lang: 'de' | 'en' = 'en'): string {
    return this.byId.get(id)?.label[lang] ?? id;
  }

  shortLabel(id: string, lang: 'de' | 'en' = 'en'): string {
    return this.byId.get(id)?.shortLabel[lang] ?? id;
  }
}
