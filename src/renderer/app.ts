// Renderer: draws the view model from the main process. No network access, no Node APIs;
// everything goes through `window.expert` (see preload.ts).

import { eventDateLabel, lastUpdatedLabel, shortDateLabel } from '../shared/format.js';
import { orderCompanies, orderNews } from '../shared/ordering.js';
import {
  DOMAIN_LABELS,
  TAG_LABELS,
  tagMatchesFilter,
  type CompanyChip,
  type ExpertApi,
  type NewsCard,
  type NewsFilter,
  type Theme,
  type ViewModel,
} from '../shared/types.js';

declare global {
  interface Window {
    expert: ExpertApi;
  }
}

const api = window.expert;
const root = document.getElementById('app') as HTMLElement;

let view: ViewModel | null = null;
let filter: NewsFilter = readStored('newsFilter', ['all', 'hiring', 'funded_startup', 'career_fair'], 'all');
const collapsed = new Set<string>();

// ---- Small DOM helpers ---------------------------------------------------------------------

type Child = Node | string | null | undefined | false;
type Attrs = Record<string, string | number | boolean | undefined | ((e: Event) => void)>;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (typeof value === 'function') el.addEventListener(key.replace(/^on/, '').toLowerCase(), value);
    else if (key === 'class') el.className = String(value);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return el;
}

const ICONS = {
  refresh: 'M20 11a8 8 0 1 0-2.3 5.6M20 4v7h-7',
  sun: 'M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  close: 'M6 6l12 12M18 6 6 18',
  chevron: 'M6 9l6 6 6-6',
};

function icon(name: keyof typeof ICONS): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', ICONS[name]);
  svg.append(path);
  return svg;
}

function readStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* only a convenience */
  }
}

// ---- Rendering -----------------------------------------------------------------------------

function render(): void {
  if (!view) return;
  document.documentElement.dataset.theme = view.theme;

  // Keep scroll position and keyboard focus across re-renders.
  const oldScroll = root.querySelector('.scroll')?.scrollTop ?? 0;
  const focusKey = (document.activeElement as HTMLElement | null)?.dataset?.focusKey;

  root.replaceChildren(renderHeader(view), renderBody(view));

  const scroll = root.querySelector('.scroll');
  if (scroll) scroll.scrollTop = oldScroll;
  if (focusKey) root.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(focusKey)}"]`)?.focus();
}

function renderHeader(v: ViewModel): HTMLElement {
  const nextTheme: Theme = v.theme === 'day' ? 'dark' : 'day';
  return h(
    'header',
    { class: 'header' },
    h('div', { class: 'brand' }, h('h1', { class: 'brand-title' }, 'Expert'), v.mock ? h('span', { class: 'mock-badge' }, 'Mock data') : null),
    h(
      'button',
      {
        class: 'icon-button',
        type: 'button',
        'data-focus-key': 'theme',
        'aria-label': nextTheme === 'dark' ? 'Switch to dark mode' : 'Switch to day mode',
        title: nextTheme === 'dark' ? 'Dark mode' : 'Day mode',
        onclick: () => {
          if (!view) return;
          view = { ...view, theme: nextTheme };
          render();
          void api.setTheme(nextTheme);
        },
      },
      icon(v.theme === 'day' ? 'moon' : 'sun'),
    ),
    h(
      'button',
      {
        class: 'refresh-button',
        type: 'button',
        'data-focus-key': 'refresh',
        'aria-busy': v.refreshing ? 'true' : 'false',
        onclick: () => {
          if (view?.refreshing) return;
          void api.refresh().then(setView);
        },
      },
      icon('refresh'),
      v.refreshing ? 'Refreshing…' : 'Refresh',
    ),
    h(
      'button',
      { class: 'icon-button', type: 'button', 'aria-label': 'Hide to tray', title: 'Hide to tray', onclick: () => void api.hideWindow() },
      icon('close'),
    ),
  );
}

function renderBody(v: ViewModel): HTMLElement {
  const scroll = h('main', { class: 'scroll' });

  if (v.configError) {
    scroll.append(
      h(
        'section',
        { class: 'card error-screen', role: 'alert' },
        h('h2', {}, 'Configuration problem'),
        h('pre', {}, v.configError),
        h('p', { class: 'muted small' }, 'Fix the file, save it and press Refresh.'),
      ),
    );
    return scroll;
  }

  scroll.append(renderStatus(v));

  if (!v.hasData) {
    scroll.append(
      h(
        'section',
        { class: 'card empty' },
        h('h2', {}, 'Press Refresh to load'),
        h('p', { class: 'muted' }, 'Put your CV (.pdf, .docx or .txt, German or English) in this folder:'),
        h('p', { class: 'path' }, v.cvFolder),
      ),
    );
    return scroll;
  }

  scroll.append(renderDomainMix(v), renderEmployers(v), renderNews(v));
  return scroll;
}

function renderStatus(v: ViewModel): HTMLElement {
  const box = h('div', { class: 'status', role: 'status', 'aria-live': 'polite' });
  box.append(
    h(
      'p',
      { class: 'last-updated' },
      'Last updated ',
      h('strong', { 'data-last-updated': v.lastUpdated ?? '' }, v.lastUpdated ? lastUpdatedLabel(v.lastUpdated, Date.now()) : 'never'),
    ),
  );
  if (v.cvStatus) box.append(h('p', { class: `message ${v.cvStatus.level}` }, v.cvStatus.text));
  for (const m of v.messages) box.append(h('p', { class: `message ${m.level}` }, m.text));
  return box;
}

function renderDomainMix(v: ViewModel): HTMLElement {
  const card = h('section', { class: 'card', 'aria-labelledby': 'mix-title' }, h('h2', { class: 'card-title', id: 'mix-title' }, 'Your domain mix'));
  if (!v.profile || v.profile.weights.length === 0) {
    card.append(h('p', { class: 'note' }, 'No domain mix yet. Put one CV in the folder and press Refresh.'), h('p', { class: 'path' }, v.cvFolder));
    return card;
  }
  const bar = h('div', { class: 'mix-bar', role: 'img', 'aria-label': v.profile.weights.map((w) => `${DOMAIN_LABELS[w.domain]} ${w.weight}%`).join(', ') });
  const legend = h('ul', { class: 'legend' });
  v.profile.weights.forEach((w, i) => {
    const seg = h('span', { class: `mix-${i + 1}` });
    seg.style.width = `${w.weight}%`;
    bar.append(seg);
    const label = DOMAIN_LABELS[w.domain];
    legend.append(h('li', {}, h('span', { class: `swatch mix-${i + 1}` }), h('span', {}, label), h('span', { class: 'weight' }, `${w.weight}%`)));
  });
  card.append(bar, legend, h('p', { class: 'muted small' }, `Based on your CV · ${v.profile.fileName}`));
  return card;
}

function renderEmployers(v: ViewModel): HTMLElement {
  const section = h('section', { class: 'section', 'aria-labelledby': 'employers-title' }, h('h2', { class: 'section-title', id: 'employers-title' }, 'Employers for you'));
  if (v.employers.length === 0) {
    section.append(h('p', { class: 'note' }, 'Employers appear once your CV gives a domain mix.'));
    return section;
  }
  for (const domain of v.employers) {
    section.append(h('h3', { class: 'domain-title' }, h('span', {}, domain.label), h('span', {}, `${domain.weight}%`)));
    if (domain.segments.length === 0) {
      section.append(h('p', { class: 'note' }, `No employers listed yet for ${domain.label}`));
      continue;
    }
    for (const seg of domain.segments) {
      const id = `${domain.domain}:${seg.segment}`;
      const open = !collapsed.has(id);
      const bodyId = `seg-${hashId(id)}`;
      section.append(
        h(
          'div',
          { class: 'card segment' },
          h(
            'button',
            {
              class: 'segment-toggle',
              type: 'button',
              'aria-expanded': open ? 'true' : 'false',
              'aria-controls': bodyId,
              'data-focus-key': `seg:${id}`,
              onclick: () => {
                if (open) collapsed.add(id);
                else collapsed.delete(id);
                render();
              },
            },
            icon('chevron'),
            h('span', {}, seg.segment),
            h('span', { class: 'count' }, `${seg.companies.length}`),
          ),
          open ? h('div', { class: 'chips', id: bodyId }, ...seg.companies.map((c) => renderChip(c))) : null,
        ),
      );
    }
  }
  return section;
}

function renderChip(c: CompanyChip): HTMLElement {
  const visited = c.visitedAt !== null;
  const open = (e: Event) => {
    e.preventDefault();
    void api.openExternal(c.careerUrl);
    markVisited(c.key);
  };
  return h(
    'a',
    {
      class: visited ? 'chip visited' : 'chip',
      href: c.careerUrl,
      'data-focus-key': `company:${c.key}`,
      title: `${c.name} careers: ${c.careerUrl}`,
      onclick: open,
      onauxclick: (e: Event) => {
        if ((e as MouseEvent).button === 1) open(e);
      },
    },
    c.name,
    visited ? h('span', { class: 'visited-label' }, 'visited') : null,
  );
}

const FILTERS: Array<{ id: NewsFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'hiring', label: 'Hiring signal' },
  { id: 'funded_startup', label: 'Funded startup' },
  { id: 'career_fair', label: 'Career fair' },
];

function renderNews(v: ViewModel): HTMLElement {
  const section = h('section', { class: 'section', 'aria-labelledby': 'news-title' }, h('h2', { class: 'section-title', id: 'news-title' }, 'News feed'));
  section.append(
    h(
      'div',
      { class: 'filters', role: 'group', 'aria-label': 'Filter news' },
      ...FILTERS.map((f) =>
        h(
          'button',
          {
            class: 'filter',
            type: 'button',
            'aria-pressed': filter === f.id ? 'true' : 'false',
            'data-focus-key': `filter:${f.id}`,
            onclick: () => {
              filter = f.id;
              store('newsFilter', f.id);
              render();
            },
          },
          f.label,
        ),
      ),
    ),
  );

  const cards = v.news.filter((n) => tagMatchesFilter(n.tag, filter));
  if (cards.length === 0) {
    section.append(h('p', { class: 'note' }, v.news.length === 0 ? 'No news yet. Press Refresh to load.' : 'Nothing in this category right now.'));
    return section;
  }
  section.append(h('ul', { class: 'news-list' }, ...cards.map((n) => h('li', {}, renderNewsCard(n)))));
  return section;
}

function renderNewsCard(n: NewsCard): HTMLElement {
  const seen = n.seenAt !== null;
  const open = (e: Event) => {
    e.preventDefault();
    void api.openExternal(n.url);
    markSeen(n.id);
  };
  const isFair = n.tag === 'career_fair';
  return h(
    'a',
    {
      class: `news-card tag-${n.tag}${seen ? ' seen' : ''}`,
      href: n.url,
      'data-focus-key': `news:${n.id}`,
      onclick: open,
      onauxclick: (e: Event) => {
        if ((e as MouseEvent).button === 1) open(e);
      },
    },
    h('div', { class: 'band' }, h('span', {}, TAG_LABELS[n.tag]), h('span', { class: 'state' }, seen ? 'Seen' : 'New')),
    h(
      'div',
      { class: 'news-body' },
      h('h3', { class: 'headline' }, n.headline),
      isFair ? h('p', { class: 'event-date' }, eventDateLabel(n.eventDate, n.eventEndDate)) : null,
      n.summary ? h('p', { class: 'summary' }, n.summary) : null,
      h('div', { class: 'news-footer' }, h('span', {}, `${n.sourceName} · ${n.domainLabel}`), isFair ? null : h('span', {}, shortDateLabel(n.date, Date.now()))),
    ),
  );
}

function hashId(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// ---- Interactions --------------------------------------------------------------------------

function markVisited(key: string): void {
  if (!view) return;
  const now = Date.now();
  view = {
    ...view,
    employers: view.employers.map((d) => ({
      ...d,
      segments: d.segments.map((s) => ({
        ...s,
        companies: orderCompanies(s.companies.map((c) => (c.key === key ? { ...c, visitedAt: now } : c))),
      })),
    })),
  };
  render();
  void api.markVisited(key);
}

function markSeen(id: string): void {
  if (!view) return;
  const now = Date.now();
  view = { ...view, news: orderNews(view.news.map((n) => (n.id === id && n.seenAt === null ? { ...n, seenAt: now } : n))) };
  render();
  void api.markSeen(id);
}

function setView(next: ViewModel): void {
  view = next;
  render();
}

// Keep "today, 07:12" correct when the widget stays open past midnight.
setInterval(() => {
  const el = root.querySelector<HTMLElement>('[data-last-updated]');
  const ts = Number(el?.dataset.lastUpdated);
  if (el && ts) el.textContent = lastUpdatedLabel(ts, Date.now());
}, 60_000);

api.onView(setView);
void api.getView().then(setView);
