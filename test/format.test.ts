import { describe, expect, it } from 'vitest';
import { eventDateLabel, lastUpdatedLabel, shortDateLabel } from '../packages/core/src/shared/format.js';

// All dates are local time, built with the Date(y, m, d, h, min) constructor.
const now = new Date(2026, 9, 10, 16, 30).getTime(); // Sat 10 Oct 2026, 16:30

describe('Last updated label', () => {
  it('says "today" for the same calendar day', () => {
    expect(lastUpdatedLabel(new Date(2026, 9, 10, 7, 12).getTime(), now)).toBe('today, 07:12');
    expect(lastUpdatedLabel(new Date(2026, 9, 10, 0, 0).getTime(), now)).toBe('today, 00:00');
  });

  it('says "yesterday" for the previous calendar day, even late at night', () => {
    expect(lastUpdatedLabel(new Date(2026, 9, 9, 19, 40).getTime(), now)).toBe('yesterday, 19:40');
    expect(lastUpdatedLabel(new Date(2026, 9, 9, 23, 59).getTime(), new Date(2026, 9, 10, 0, 1).getTime())).toBe('yesterday, 23:59');
  });

  it('uses weekday, day and month for anything older', () => {
    expect(lastUpdatedLabel(new Date(2026, 9, 6, 7, 12).getTime(), now)).toBe('Tue 6 Oct, 07:12');
    expect(lastUpdatedLabel(new Date(2026, 9, 8, 23, 5).getTime(), now)).toBe('Thu 8 Oct, 23:05');
  });

  it('handles month and year boundaries', () => {
    const jan1 = new Date(2027, 0, 1, 9, 0).getTime();
    expect(lastUpdatedLabel(new Date(2026, 11, 31, 18, 0).getTime(), jan1)).toBe('yesterday, 18:00');
  });
});

describe('other date labels', () => {
  it('formats fair dates and missing dates', () => {
    expect(eventDateLabel('2026-10-28', '2026-10-28')).toBe('Wed 28 Oct');
    expect(eventDateLabel('2026-10-09', '2026-10-10')).toBe('Fri 9 Oct – Sat 10 Oct');
    expect(eventDateLabel(null, null)).toBe('Date to be confirmed');
  });

  it('formats news dates', () => {
    expect(shortDateLabel(new Date(2026, 9, 10, 8).toISOString(), now)).toBe('today');
    expect(shortDateLabel(new Date(2026, 9, 9, 8).toISOString(), now)).toBe('yesterday');
    expect(shortDateLabel(new Date(2026, 9, 2, 8).toISOString(), now)).toBe('2 Oct');
  });
});
