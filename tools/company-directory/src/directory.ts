// Merging proposals into data/employers/<domain>.json and comparing two versions for review.

import type { DirectoryCompany, EmployerDirectory } from '../../../packages/core/src/contracts.js';
import { COMPANY_TIERS } from '../../../packages/core/src/directory.js';
import type { ProposedCompany } from './prompt.js';
import { normaliseName } from './verify.js';

/**
 * Adds proposals that are not yet in the directory (by normalised name) as "proposed" entries in a
 * segment of their tier and label. Existing entries, manual ones included, are never removed or
 * overwritten here; verification decides their status.
 */
export function mergeProposals(existing: EmployerDirectory, proposals: readonly ProposedCompany[], generatedBy: string): EmployerDirectory {
  const next: EmployerDirectory = structuredClone(existing);
  const known = new Set(next.segments.flatMap((s) => s.companies.map((c) => normaliseName(c.name))));
  for (const p of proposals) {
    const key = normaliseName(p.name);
    if (!key || known.has(key)) continue;
    known.add(key);
    let segment = next.segments.find((s) => s.tier === p.tier && s.label.en.toLowerCase() === p.segment.toLowerCase());
    if (!segment) {
      segment = { tier: p.tier, label: { de: p.segment, en: p.segment }, companies: [] };
      next.segments.push(segment);
    }
    segment.companies.push({ name: p.name, website: p.website, careerUrl: p.careerUrl, status: 'proposed', confidence: 0, lastVerified: '', generatedBy, sources: [] });
  }
  next.segments.sort((a, b) => COMPANY_TIERS.indexOf(a.tier) - COMPANY_TIERS.indexOf(b.tier));
  return next;
}

export interface DirectoryDiff {
  added: DirectoryCompany[];
  removed: DirectoryCompany[];
  changed: Array<{ before: DirectoryCompany; after: DirectoryCompany; fields: Array<'website' | 'careerUrl' | 'status' | 'confidence'> }>;
  lowConfidence: DirectoryCompany[];
}

const companies = (d: EmployerDirectory | null) => new Map((d?.segments ?? []).flatMap((s) => s.companies).map((c) => [normaliseName(c.name), c]));

export const LOW_CONFIDENCE = 0.75;

export function diffDirectories(before: EmployerDirectory | null, after: EmployerDirectory): DirectoryDiff {
  const a = companies(before);
  const b = companies(after);
  const diff: DirectoryDiff = { added: [], removed: [], changed: [], lowConfidence: [] };
  for (const [key, c] of b) {
    const old = a.get(key);
    if (!old) diff.added.push(c);
    else {
      const fields = (['website', 'careerUrl', 'status', 'confidence'] as const).filter((f) => old[f] !== c[f]);
      if (fields.length > 0) diff.changed.push({ before: old, after: c, fields });
    }
    if (c.confidence < LOW_CONFIDENCE || c.status === 'proposed') diff.lowConfidence.push(c);
  }
  for (const [key, c] of a) if (!b.has(key)) diff.removed.push(c);
  return diff;
}

const line = (c: DirectoryCompany) => `${c.name} · ${c.status} · confidence ${c.confidence.toFixed(2)} · ${c.careerUrl}`;

export function formatReview(domain: string, diff: DirectoryDiff): string {
  const out = [`Company directory review: ${domain}`, ''];
  const block = (title: string, rows: string[]) => out.push(`${title} (${rows.length})`, ...(rows.length ? rows.map((r) => `  ${r}`) : ['  none']), '');
  block('Added', diff.added.map(line));
  block('Removed', diff.removed.map(line));
  block('Changed', diff.changed.map((c) => `${c.after.name}: ${c.fields.map((f) => `${f} ${String(c.before[f])} → ${String(c.after[f])}`).join(', ')}`));
  block(
    'Needs a look (proposed, or confidence below 0.75; hidden in the app until verified)',
    diff.lowConfidence.map((c) => `${line(c)}${c.checks ? ` · ${Object.entries(c.checks).filter(([, v]) => v !== 'ok').map(([k, v]) => `${k}: ${v}`).join('; ')}` : ''}`),
  );
  out.push('Approve by committing data/employers/' + domain + '.json; discard with git checkout on that file.');
  return out.join('\n');
}
