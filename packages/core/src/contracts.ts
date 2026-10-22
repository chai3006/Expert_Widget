// The integration contracts (contracts/*.schema.json) as TypeScript types, and the functions that
// build them from the view data. The types are written by hand and checked against the JSON
// Schemas in test/contracts.test.ts, so a change on either side that the other does not follow
// fails the tests. Every document carries schemaVersion; a breaking change bumps it and adds a
// new schema file next to the old one.

import type { CvProfile, ItemDomain, NewsCard, NewsTag, SourceHealthView } from './shared/types.js';

export const SCHEMA_VERSION = 1 as const;

export type EvidenceKind = 'title' | 'education' | 'certification' | 'skill' | 'keyword';

export interface DomainEvidence {
  domain: string;
  /** A term from the domain registry, never text copied from the CV. */
  label: string;
  kind: EvidenceKind;
  /** e.g. "2021 to now", or null when the CV gives no dates. */
  period: string | null;
  current: boolean;
}

export type ProfileSource = 'auto' | 'manual' | 'fallback';

export interface DomainProfile {
  schemaVersion: typeof SCHEMA_VERSION;
  source: ProfileSource;
  weights: Array<{ domain: string; label: string; weight: number }>;
  evidence: DomainEvidence[];
  computedAt: number | null;
  notice: string | null;
}

export type CompanyTier = 'top' | 'tier1' | 'tier2' | 'service' | 'sme' | 'startup';
export type CompanyStatus = 'proposed' | 'verified';

export interface LocalizedText {
  de: string;
  en: string;
}

export interface DirectoryCompany {
  name: string;
  website: string;
  careerUrl: string;
  status: CompanyStatus;
  confidence: number;
  lastVerified: string;
  generatedBy: string;
  sources: string[];
  checks?: Record<string, string>;
}

export interface DirectorySegment {
  tier: CompanyTier;
  label: LocalizedText;
  companies: DirectoryCompany[];
}

export interface EmployerDirectory {
  schemaVersion: typeof SCHEMA_VERSION;
  domain: string;
  segments: DirectorySegment[];
}

export interface NewsItem {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  tag: NewsTag;
  headline: string;
  summary: string;
  url: string;
  source: string;
  domain: ItemDomain;
  date: string;
  eventDate: string | null;
  eventEndDate: string | null;
  translated: { headline: string | null; summary: string | null } | null;
  companies: string[];
  seen: boolean;
  useful: boolean;
}

export interface CompanySignal {
  schemaVersion: typeof SCHEMA_VERSION;
  company: string;
  tag: NewsTag;
  date: string;
  url: string;
  domain: ItemDomain;
  source: string;
}

export interface SourceHealth extends SourceHealthView {
  schemaVersion: typeof SCHEMA_VERSION;
}

export const FEEDBACK_ACTIONS = ['seen', 'visited', 'useful', 'not-useful', 'undo-not-useful'] as const;
export type FeedbackAction = (typeof FEEDBACK_ACTIONS)[number];

export interface UserFeedback {
  schemaVersion: typeof SCHEMA_VERSION;
  action: FeedbackAction;
  target: string;
}

/** The profile as a contract: weights with labels and evidence, without the file name. */
export function toDomainProfile(profile: CvProfile, labelOf: (domain: string) => string): DomainProfile {
  return {
    schemaVersion: SCHEMA_VERSION,
    source: profile.source ?? 'auto',
    weights: profile.weights.map((w) => ({ domain: w.domain, label: labelOf(w.domain), weight: w.weight })),
    evidence: profile.evidence ?? [],
    computedAt: profile.computedAt,
    notice: profile.notice ?? null,
  };
}

export function toNewsItem(card: NewsCard): NewsItem {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: card.id,
    tag: card.tag,
    headline: card.headline,
    summary: card.summary,
    url: card.url,
    source: card.sourceName,
    domain: card.domain,
    date: card.date,
    eventDate: card.eventDate,
    eventEndDate: card.eventEndDate,
    translated: card.translated,
    companies: card.companies ?? card.watchlist,
    seen: card.seenAt !== null,
    useful: card.useful,
  };
}

/** One signal per company a card names. */
export function toCompanySignals(cards: readonly NewsCard[]): CompanySignal[] {
  return cards.flatMap((card) =>
    (card.companies ?? card.watchlist).map((company) => ({
      schemaVersion: SCHEMA_VERSION,
      company,
      tag: card.tag,
      date: card.date,
      url: card.url,
      domain: card.domain,
      source: card.sourceName,
    })),
  );
}

export function toSourceHealth(view: SourceHealthView): SourceHealth {
  return { schemaVersion: SCHEMA_VERSION, ...view };
}

/** Checks a feedback document from outside (HTTP API, CLI). Returns an error text or null. */
export function feedbackProblem(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return 'feedback must be an object';
  const f = raw as Record<string, unknown>;
  if (f.schemaVersion !== SCHEMA_VERSION) return `schemaVersion must be ${SCHEMA_VERSION}`;
  if (!(FEEDBACK_ACTIONS as readonly unknown[]).includes(f.action)) return `action must be one of ${FEEDBACK_ACTIONS.join(', ')}`;
  if (typeof f.target !== 'string' || f.target.length === 0 || f.target.length > 300) return 'target must be a string of 1 to 300 characters';
  const extra = Object.keys(f).filter((k) => !['schemaVersion', 'action', 'target'].includes(k));
  return extra.length > 0 ? `unknown field ${extra[0]}` : null;
}
