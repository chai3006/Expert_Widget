import { describe, expect, it } from 'vitest';
import { orderCompanies, orderNews } from '../packages/core/src/shared/ordering.js';
import { buildEmployerView } from '../packages/core/src/view.js';
import { defaultEmployers, appData } from './helpers/config.js';

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

  // Changed on purpose (Phase 4): the companies come from the directory in data/employers.
  it('applies visited state from storage when building the employer view', () => {
    const view = buildEmployerView([], [{ domain: 'automotive-emobility', weight: 100 }], { bosch: 10 }, undefined, appData().employers);
    const suppliers = view[0].segments.find((s) => s.segment.startsWith('Tier 1'))!;
    expect(suppliers.companies.at(-1)?.name).toBe('Bosch');
    expect(suppliers.companies.at(-1)?.visitedAt).toBe(10);
    expect(suppliers.companies[0].name).toBe('Continental');
  });

  it('shows segments only for domains in the mix, in tier order, with an empty list for domains without employers', () => {
    const view = buildEmployerView([], [
      { domain: 'medtech', weight: 60 },
      { domain: 'automotive-emobility', weight: 40 },
    ], {}, undefined, appData().employers);
    expect(view.map((d) => d.domain)).toEqual(['medtech', 'automotive-emobility']);
    expect(view[0]).toMatchObject({ segments: [], starterList: false });
    expect(view[1].starterList).toBe(true);
    expect(view[1].segments.map((s) => s.tier)).toEqual(['top', 'tier1', 'tier2', 'tier2', 'service']);
  });

  it('hides companies that are only proposed and adds the user\'s own without duplicates', () => {
    const own = [{ domain: 'automotive-emobility', segment: 'My list', companies: [{ name: 'Bosch', careerUrl: 'https://x.de', lastVerified: '' }, { name: 'Acme Antriebe', careerUrl: 'https://acme.example', lastVerified: '' }] }];
    const view = buildEmployerView(own, [{ domain: 'automotive-emobility', weight: 100 }], {}, undefined, appData().employers);
    const names = view[0].segments.flatMap((s) => s.companies.map((c) => c.name));
    expect(names).not.toContain('Volkswagen Group'); // status "proposed" in the directory
    expect(names.filter((n) => n === 'Bosch')).toHaveLength(1);
    expect(view[0].segments.at(-1)).toMatchObject({ segment: 'My list', tier: null, companies: [{ name: 'Acme Antriebe' }] });
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
