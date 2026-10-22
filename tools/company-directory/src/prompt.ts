// The request for company proposals: one per domain, built only from the domain file (id, labels,
// description). No CV, profile or user data ever goes into it.

import type { CompanyTier } from '../../../packages/core/src/contracts.js';
import type { DomainDefinition } from '../../../packages/core/src/domains.js';
import { COMPANY_TIERS } from '../../../packages/core/src/directory.js';
import type { LlmRequest } from './llm.js';

export interface ProposedCompany {
  name: string;
  website: string;
  careerUrl: string;
  tier: CompanyTier;
  /** Short English segment label, e.g. "Hospital groups". */
  segment: string;
}

export const SYSTEM_PROMPT = [
  'You help build a starter list of employers in Germany for job seekers, one field of work at a time.',
  'Only list companies you are confident exist and employ people in Germany in this field. Do not invent companies, websites or URLs; if you are unsure of a career page URL, give the company homepage.',
  'Every entry is checked automatically afterwards (the website must answer, the career page must look like one, a second source must confirm the company), so precision matters more than length.',
].join(' ');

const TIER_MEANING: Record<CompanyTier, string> = {
  top: 'the largest and best-known employers of the field in Germany',
  tier1: 'direct suppliers or the next level of large employers, or the field\'s direct equivalent',
  tier2: 'their suppliers or specialised mid-sized employers, or the field\'s direct equivalent',
  service: 'service-oriented companies: consultancies, service providers, staffing and engineering services where they make sense for the field',
  sme: 'well-known small and medium-sized employers (Mittelstand)',
  startup: 'young companies with funding that hire in Germany',
};

export const RESPONSE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['companies'],
  properties: {
    companies: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'website', 'careerUrl', 'tier', 'segment'],
        properties: {
          name: { type: 'string' },
          website: { type: 'string', description: 'Company homepage, https://...' },
          careerUrl: { type: 'string', description: 'Career or jobs page for Germany, https://...' },
          tier: { type: 'string', enum: [...COMPANY_TIERS] },
          segment: { type: 'string', description: 'Short English group label, e.g. "Hospital groups"' },
        },
      },
    },
  },
};

export function buildRequest(domain: DomainDefinition, maxCompanies: number, maxTokens: number): LlmRequest {
  const tiers = COMPANY_TIERS.map((t) => `- ${t}: ${TIER_MEANING[t]}`).join('\n');
  const prompt = [
    `Field of work: ${domain.label.en} (German: ${domain.label.de}).`,
    `Description: ${domain.description}`,
    '',
    `List up to ${maxCompanies} employers in Germany for this field, spread over these tiers where they make sense:`,
    tiers,
    '',
    'For each company give its name, its homepage, its career page for Germany, the tier and a short English segment label. Leave out a tier that does not fit the field.',
  ].join('\n');
  return { system: SYSTEM_PROMPT, prompt, schema: RESPONSE_SCHEMA, maxTokens };
}

/** Reads the structured answer; entries that break the shape are dropped and reported. */
export function parseProposals(text: string): { companies: ProposedCompany[]; problems: string[] } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { companies: [], problems: ['the answer is not JSON'] };
  }
  const list = (data as { companies?: unknown }).companies;
  if (!Array.isArray(list)) return { companies: [], problems: ['the answer has no "companies" list'] };
  const companies: ProposedCompany[] = [];
  const problems: string[] = [];
  list.forEach((c, i) => {
    const e = c as Record<string, unknown>;
    if (typeof e?.name !== 'string' || !e.name.trim() || typeof e.website !== 'string' || typeof e.careerUrl !== 'string' || typeof e.segment !== 'string' || !(COMPANY_TIERS as readonly unknown[]).includes(e.tier)) {
      problems.push(`entry ${i + 1} is incomplete and was dropped`);
      return;
    }
    companies.push({ name: e.name.trim(), website: e.website.trim(), careerUrl: e.careerUrl.trim(), tier: e.tier as CompanyTier, segment: e.segment.trim() || (e.tier as string) });
  });
  return { companies, problems };
}
