// RSS 2.0 and Atom feeds. Takes title, link, date and the short description only; full article
// content (content:encoded) is deliberately ignored. Entries missing a title, link or date are
// passed on as they are, so the contract check fails the provider loudly instead of hiding it.

import * as cheerio from 'cheerio/slim';
import type { ParsedItem, SourceAdapter } from '../types.js';
import { absoluteUrl, cleanText, htmlToText, toIsoTimestamp, truncate } from '../text.js';

// WordPress appends "Der Beitrag X erschien zuerst auf Y." / "The post X appeared first on Y."
const WP_FOOTER = /\s*(Der Beitrag .* erschien zuerst auf .*|The post .* appeared first on .*)$/;

export const parseFeed: SourceAdapter = (xml, pageUrl) => {
  const $ = cheerio.load(xml, { xml: true });
  const items: ParsedItem[] = [];

  $('item').each((_, el) => {
    const node = $(el);
    const href = cleanText(node.children('link').first().text()) || cleanText(node.children('guid').first().text());
    // An empty href would resolve to the feed's own URL; keep it empty so the contract notices.
    const url = href ? absoluteUrl(href, pageUrl) : null;
    const headline = htmlToText(node.children('title').first().text());
    items.push({
      url: url ?? '',
      headline,
      excerpt: truncate(htmlToText(node.children('description').first().text()).replace(WP_FOOTER, '')),
      publishedAt: toIsoTimestamp(node.children('pubDate').first().text() || node.children('dc\\:date').first().text()),
      eventDate: null,
      eventEndDate: null,
    });
  });

  $('entry').each((_, el) => {
    const node = $(el);
    const links = node.children('link');
    const alt = links.filter((_, l) => ($(l).attr('rel') ?? 'alternate') === 'alternate').first();
    const href = alt.attr('href') ?? links.first().attr('href');
    const url = href ? absoluteUrl(href, pageUrl) : null;
    const headline = htmlToText(node.children('title').first().text());
    items.push({
      url: url ?? '',
      headline,
      excerpt: truncate(htmlToText(node.children('summary').first().text())),
      publishedAt: toIsoTimestamp(node.children('published').first().text() || node.children('updated').first().text()),
      eventDate: null,
      eventEndDate: null,
    });
  });

  return items;
};
