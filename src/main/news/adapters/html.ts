// HTML adapters for sources without a usable feed. Each reads only the headline list of one page.
// Selectors were taken from the live pages in October 2026; see SOURCES.md for fragility notes.

import * as cheerio from 'cheerio';
import type { ParsedItem, SourceAdapter } from '../types.js';
import {
  absoluteUrl,
  calendarDateToTimestamp,
  cleanText,
  englishDateToIso,
  germanDateToIso,
  toIsoTimestamp,
  truncate,
} from '../text.js';

/** VDI nachrichten Recruiting Tag: table.recruiting-table rows of weekday | date | city | details link. */
export const parseIngenieurRecruitingTag: SourceAdapter = (html, pageUrl) => {
  const $ = cheerio.load(html);
  const items: ParsedItem[] = [];
  $('table.recruiting-table tr').each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length < 3) return;
    const city = cleanText(cells.eq(2).text());
    const href = $(row).find('a[href]').first().attr('href');
    const url = href ? absoluteUrl(href, pageUrl) : null;
    if (!city || !url) return;
    const eventDate = germanDateToIso(cells.eq(1).text());
    items.push({
      url,
      headline: `VDI nachrichten Recruiting Tag ${city}`,
      excerpt: `Career fair for engineers and IT specialists in ${city}.`,
      publishedAt: null,
      eventDate,
      eventEndDate: eventDate,
    });
  });
  return items;
};

/** messen.de category page: one <article> card per fair with "Termin:" and "Ort:" lines. */
export const parseMessenDe: SourceAdapter = (html, pageUrl) => {
  const $ = cheerio.load(html);
  const items: ParsedItem[] = [];
  $('article').each((_, el) => {
    const card = $(el);
    const link = card.find('h3 a[href]').first();
    const name = cleanText(link.text());
    const url = absoluteUrl(link.attr('href') ?? '', pageUrl);
    if (!name || !url) return;

    const labelled = (label: string) => {
      const span = card.find('span').filter((_, s) => cleanText($(s).text()) === label).first();
      return cleanText(span.next('span').text());
    };
    const when = labelled('Termin:');
    const where = labelled('Ort:');
    const dates = [...when.matchAll(/\d{1,2}\.\d{1,2}\.\d{4}/g)].map((m) => germanDateToIso(m[0]));
    const description = cleanText(card.find('p').first().text());

    items.push({
      url,
      headline: name,
      excerpt: truncate([description, where].filter(Boolean).join(' · ')),
      publishedAt: null,
      eventDate: dates[0] ?? null,
      eventEndDate: dates[dates.length - 1] ?? null,
    });
  });
  return items;
};

/** Eurofound European Restructuring Monitor search results (table.restructuring-events-table). */
export const parseEurofound: SourceAdapter = (html, pageUrl) => {
  const $ = cheerio.load(html);
  const items: ParsedItem[] = [];
  $('table.restructuring-events-table tbody tr').each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length < 6) return;
    const href = cells.eq(0).find('a[href]').attr('href');
    const url = href ? absoluteUrl(href, pageUrl) : null;
    const company = cleanText(cells.eq(2).text());
    if (!url || !company) return;
    const day = englishDateToIso(cleanText(cells.eq(0).text()));
    const country = cleanText(cells.eq(1).text());
    const sector = cleanText(cells.eq(3).text());
    const type = cleanText(cells.eq(4).text());
    const changeText = cleanText(cells.eq(5).text()).replace(/[^\d-]/g, '');
    const change = changeText ? Number(changeText) : NaN;

    let headline: string;
    let tagHint: ParsedItem['tagHint'];
    if (Number.isFinite(change) && change < 0) {
      headline = `${company}: ${Math.abs(change).toLocaleString('en-GB')} jobs to go`;
      tagHint = 'hiring_cuts';
    } else if (Number.isFinite(change) && change > 0) {
      headline = `${company}: ${change.toLocaleString('en-GB')} new jobs planned`;
      tagHint = 'hiring_growth';
    } else {
      headline = `${company}: ${type || 'restructuring'}`;
    }
    items.push({
      url,
      headline,
      excerpt: [type, sector, country].filter(Boolean).join(' · '),
      publishedAt: day ? calendarDateToTimestamp(day) : null,
      eventDate: null,
      eventEndDate: null,
      tagHint,
    });
  });
  return items;
};

/** produktion.de section page: article.article-teaser-box with schema.org itemprops. */
export const parseProduktionDe: SourceAdapter = (html, pageUrl) => {
  const $ = cheerio.load(html);
  const items: ParsedItem[] = [];
  $('article.article-teaser-box').each((_, el) => {
    const card = $(el);
    const url = absoluteUrl(card.find('a[itemprop="url"]').first().attr('href') ?? '', pageUrl);
    const headline = cleanText(card.find('[itemprop="headline"]').first().text());
    if (!url || !headline) return;
    items.push({
      url,
      headline,
      excerpt: truncate(cleanText(card.find('[itemprop="description"]').first().text())),
      publishedAt: toIsoTimestamp(card.find('time[itemprop="datePublished"]').first().attr('datetime')),
      eventDate: null,
      eventEndDate: null,
    });
  });
  return items;
};
