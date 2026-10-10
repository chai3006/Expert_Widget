import { describe, expect, it } from 'vitest';
import { orderCompanies, orderNews } from '../src/shared/ordering.js';
import { buildEmployerView } from '../src/main/view.js';
import { defaultEmployers } from './helpers/config.js';

const chip = (name: string, visitedAt: number | null) => ({ key: name.toLowerCase(), name, careerUrl: `https://${name}.example`, visitedAt });

describe('visited companies', () => {
  it('keeps unvisited order and moves visited to the end, earliest visit first', () => {
    const ordered = orderCompanies([chip('A', 300), chip('B', null), chip('C', 100), chip('D', null)]);
    expect(ordered.map((c) => c.name)).toEqual(['B', 'D', 'C', 'A']);
  });

  it('a newly visited company goes after previously visited ones', () => {
    const before = orderCompanies([chip('A', null), chip('B', 50), chip('C', null)]);
    const after = orderCompanies(before.map((c) => (c.name === 'A' ? { ...c, visitedAt: 999 } : c)));
    expect(after.map((c) => c.name)).toEqual(['C', 'B', 'A']);
  });

  it('applies visited state from storage when building the employer view', () => {
    const view = buildEmployerView(defaultEmployers(), [{ domain: 'automotive-emobility', weight: 100 }], { bosch: 10 });
    const suppliers = view[0].segments.find((s) => s.segment.startsWith('Tier 1'))!;
    expect(suppliers.companies.at(-1)?.name).toBe('Bosch');
    expect(suppliers.companies.at(-1)?.visitedAt).toBe(10);
    expect(suppliers.companies[0].name).toBe('Continental');
  });

  it('shows segments only for domains in the mix, with an empty list for domains without employers', () => {
    const view = buildEmployerView(defaultEmployers(), [
      { domain: 'medtech', weight: 60 },
      { domain: 'automotive-emobility', weight: 40 },
    ], {});
    expect(view.map((d) => d.domain)).toEqual(['medtech', 'automotive-emobility']);
    expect(view[0].segments).toEqual([]);
    expect(view[1].segments).toHaveLength(5);
  });
});

describe('seen news', () => {
  it('puts unseen first in original order and seen at the bottom, earliest seen first', () => {
    const cards = [
      { id: '1', seenAt: 20 },
      { id: '2', seenAt: null },
      { id: '3', seenAt: 10 },
      { id: '4', seenAt: null },
    ];
    expect(orderNews(cards).map((c) => c.id)).toEqual(['2', '4', '3', '1']);
  });
});
