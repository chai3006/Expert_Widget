// The employer directory (data/employers/<domain>.json, contract EmployerDirectory): companies in
// Germany per domain, grouped in segments by tier. The app shows only companies with status
// "verified"; tools/company-directory proposes and verifies them.

import { isHttpUrl, type Validated } from './config.js';
import type { CompanyStatus, CompanyTier, DirectoryCompany, DirectorySegment, EmployerDirectory } from './contracts.js';
import type { DomainRegistry } from './domains.js';

export const COMPANY_TIERS: readonly CompanyTier[] = ['top', 'tier1', 'tier2', 'service', 'sme', 'startup'];
const STATUSES: readonly CompanyStatus[] = ['proposed', 'verified'];

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Validates one directory file; `fileId` is the file name without .json and must equal the domain. */
export function validateDirectory(raw: unknown, registry: DomainRegistry, fileId?: string): Validated<EmployerDirectory> {
  const where = fileId ? `employers/${fileId}.json` : 'directory';
  const errors: string[] = [];
  if (!isObject(raw)) return { ok: false, errors: [`${where}: the top level must be an object`] };
  if (raw.schemaVersion !== 1) errors.push(`${where} schemaVersion: must be 1`);
  if (typeof raw.domain !== 'string' || !registry.has(raw.domain)) errors.push(`${where} domain: unknown domain "${String(raw.domain)}"`);
  else if (fileId !== undefined && raw.domain !== fileId) errors.push(`${where} domain: "${raw.domain}" must match the file name`);
  const segments: DirectorySegment[] = [];
  if (!Array.isArray(raw.segments)) errors.push(`${where} segments: must be a list`);
  else
    raw.segments.forEach((s, i) => {
      const p = `${where} segments[${i}]`;
      if (!isObject(s)) return void errors.push(`${p}: must be an object`);
      if (!(COMPANY_TIERS as readonly unknown[]).includes(s.tier)) errors.push(`${p}.tier: must be one of ${COMPANY_TIERS.join(', ')}`);
      const label = isObject(s.label) && typeof s.label.de === 'string' && typeof s.label.en === 'string' && s.label.de && s.label.en ? { de: s.label.de, en: s.label.en } : null;
      if (!label) errors.push(`${p}.label: must be { "de": "...", "en": "..." }`);
      const companies: DirectoryCompany[] = [];
      if (!Array.isArray(s.companies)) errors.push(`${p}.companies: must be a list`);
      else
        s.companies.forEach((c, j) => {
          const cp = `${p}.companies[${j}]`;
          if (!isObject(c)) return void errors.push(`${cp}: must be an object`);
          const before = errors.length;
          if (typeof c.name !== 'string' || c.name.trim() === '') errors.push(`${cp}.name: must be a non-empty string`);
          if (!isHttpUrl(c.website)) errors.push(`${cp}.website: must be an http or https URL`);
          if (!isHttpUrl(c.careerUrl)) errors.push(`${cp}.careerUrl: must be an http or https URL`);
          if (!(STATUSES as readonly unknown[]).includes(c.status)) errors.push(`${cp}.status: must be "proposed" or "verified"`);
          if (typeof c.confidence !== 'number' || c.confidence < 0 || c.confidence > 1) errors.push(`${cp}.confidence: must be a number from 0 to 1`);
          if (typeof c.lastVerified !== 'string' || (c.lastVerified !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(c.lastVerified))) errors.push(`${cp}.lastVerified: must be empty or a date like 2026-10-22`);
          if (c.status === 'verified' && c.lastVerified === '') errors.push(`${cp}: a verified company needs lastVerified`);
          if (typeof c.generatedBy !== 'string' || c.generatedBy === '') errors.push(`${cp}.generatedBy: must be a non-empty string`);
          if (!Array.isArray(c.sources) || c.sources.some((x) => typeof x !== 'string')) errors.push(`${cp}.sources: must be a list of strings`);
          if (errors.length > before) return;
          companies.push({
            name: (c.name as string).trim(),
            website: c.website as string,
            careerUrl: c.careerUrl as string,
            status: c.status as CompanyStatus,
            confidence: c.confidence as number,
            lastVerified: c.lastVerified as string,
            generatedBy: c.generatedBy as string,
            sources: c.sources as string[],
            ...(isObject(c.checks) ? { checks: c.checks as Record<string, string> } : {}),
          });
        });
      if (label && (COMPANY_TIERS as readonly unknown[]).includes(s.tier)) segments.push({ tier: s.tier as CompanyTier, label, companies });
    });
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { schemaVersion: 1, domain: raw.domain as string, segments } };
}

/** Segments in tier order (top, tier1, tier2, service, sme, startup), only verified companies, empty segments left out. */
export function visibleSegments(directory: EmployerDirectory): DirectorySegment[] {
  return [...directory.segments]
    .sort((a, b) => COMPANY_TIERS.indexOf(a.tier) - COMPANY_TIERS.indexOf(b.tier))
    .map((s) => ({ ...s, companies: s.companies.filter((c) => c.status === 'verified') }))
    .filter((s) => s.companies.length > 0);
}
