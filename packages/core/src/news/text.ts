import * as cheerio from 'cheerio/slim';

/** Strips tags and decodes entities from an HTML fragment, collapsing whitespace. */
export function htmlToText(html: string): string {
  if (!html) return '';
  const $ = cheerio.load(`<div>${html}</div>`);
  return cleanText($('div').first().text());
}

export function cleanText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Shortens to at most `max` characters on a word boundary, adding an ellipsis. */
export function truncate(text: string, max = 200): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.–-]+$/, '')}…`;
}

export function absoluteUrl(href: string, base: string): string | null {
  try {
    const u = new URL(href, base);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** "28.10.2026" → "2026-10-28". */
export function germanDateToIso(text: string): string | null {
  const m = /(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(text);
  if (!m) return null;
  return isoDate(Number(m[3]), Number(m[2]), Number(m[1]));
}

const MONTHS_EN = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** "7 October 2026" → "2026-10-07". */
export function englishDateToIso(text: string): string | null {
  const m = /(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/.exec(text);
  if (!m) return null;
  const month = MONTHS_EN.indexOf(m[2].toLowerCase()) + 1;
  if (month === 0) return null;
  return isoDate(Number(m[3]), month, Number(m[1]));
}

function isoDate(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Parses any date string to an ISO timestamp, or null. */
export function toIsoTimestamp(value: string | undefined | null): string | null {
  if (!value) return null;
  const t = Date.parse(value.trim());
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** A calendar date "yyyy-mm-dd" as an ISO timestamp at noon UTC (stable across time zones). */
export function calendarDateToTimestamp(isoDay: string): string {
  return `${isoDay}T12:00:00.000Z`;
}
