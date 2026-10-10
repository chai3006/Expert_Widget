// Date labels shown in the UI. Plain English, local time, no locale-dependent formatting.

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function time(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** "today, 07:12", "yesterday, 19:40" or "Tue 6 Oct, 07:12". */
export function lastUpdatedLabel(timestamp: number, now: number): string {
  const d = new Date(timestamp);
  const today = startOfDay(new Date(now));
  const day = startOfDay(d);
  if (day === today) return `today, ${time(d)}`;
  // Compare calendar days, not 24h spans, so DST changes do not matter.
  const yesterday = startOfDay(new Date(today - 12 * 3600 * 1000));
  if (day === yesterday) return `yesterday, ${time(d)}`;
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}, ${time(d)}`;
}

/** Parses "yyyy-mm-dd" as a local calendar date. */
export function parseLocalDate(isoDate: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** "Wed 28 Oct" or "Fri 9 – Sat 10 Oct" for career fair dates. */
export function eventDateLabel(start: string | null, end: string | null): string {
  if (!start) return 'Date to be confirmed';
  const s = parseLocalDate(start);
  if (!s) return 'Date to be confirmed';
  const fmt = (d: Date) => `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  const e = end && end !== start ? parseLocalDate(end) : null;
  return e ? `${fmt(s)} – ${fmt(e)}` : fmt(s);
}

/** Short publication date for news cards: "today", "yesterday" or "6 Oct". */
export function shortDateLabel(iso: string, now: number): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const today = startOfDay(new Date(now));
  const day = startOfDay(d);
  if (day === today) return 'today';
  if (day === startOfDay(new Date(today - 12 * 3600 * 1000))) return 'yesterday';
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
