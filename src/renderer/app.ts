// Renderer: draws the view model from the main process. No network access, no Node APIs;
// everything goes through `window.expert` (see preload.ts).

import { eventDateLabel, lastUpdatedLabel, shortDateLabel } from '../shared/format.js';
import { orderCompanies, orderNews } from '../shared/ordering.js';
import {
  DOMAIN_LABELS,
  DOMAIN_SHORT_LABELS,
  TAG_LABELS,
  tagMatchesFilter,
  type CompanyChip,
  type ExpertApi,
  type NewsCard,
  type NewsFilter,
  type ProviderHealthView,
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
let healthOpen = false;
/** The Domain mix card starts compact on every start. */
let mixOpen = false;
/** The card just removed with thumbs down, while its Undo bar is showing. */
let undo: { id: string; timer: number } | null = null;
const UNDO_MS = 8000;

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
  minus: 'M5 12h14',
  chevron: 'M6 9l6 6 6-6',
  thumbUp: 'M7 10v11H3V10h4zm0 0 4-8a3 3 0 0 1 3 3v4h5.2a2 2 0 0 1 2 2.4l-1.5 7.6a2 2 0 0 1-2 1.6H7',
  thumbDown: 'M17 14V3h4v11h-4zm0 0-4 8a3 3 0 0 1-3-3v-4H4.8a2 2 0 0 1-2-2.4l1.5-7.6a2 2 0 0 1 2-1.6H17',
};

function icon(name: keyof typeof ICONS): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', `icon icon-${name}`);
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
  document.documentElement.dataset.mode = view.mode;

  // Keep scroll position and keyboard focus across re-renders.
  const oldScroll = root.querySelector('.scroll')?.scrollTop ?? 0;
  const focusKey = (document.activeElement as HTMLElement | null)?.dataset?.focusKey;

  if (view.mode === 'collapsed') {
    root.replaceChildren(renderButton(view));
  } else {
    root.replaceChildren(renderHeader(view), renderBody(view), renderUndoBar());
  }

  const scroll = root.querySelector('.scroll');
  if (scroll) scroll.scrollTop = oldScroll;
  if (focusKey) root.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(focusKey)}"]`)?.focus();
}

// ---- Collapsed: the floating button ----------------------------------------------------------

function renderButton(v: ViewModel): HTMLElement {
  const count = v.unseenCount;
  const label = `Expert Widget, ${count === 0 ? 'no new items' : `${count} new ${count === 1 ? 'item' : 'items'}`}. Double-click or press Enter to open.`;
  const button = h(
    'button',
    { class: 'fab', type: 'button', 'aria-label': label, title: label, 'data-focus-key': 'fab' },
    h('span', { class: 'fab-letter', 'aria-hidden': 'true' }, 'E'),
    count > 0 ? h('span', { class: 'badge', 'aria-hidden': 'true' }, count > 99 ? '99+' : String(count)) : null,
  );
  attachDrag(button);
  button.addEventListener('dblclick', expand);
  button.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      expand();
    }
  });
  return h('div', { class: 'fab-wrap' }, button);
}

/**
 * Manual dragging: the main process moves the window while the pointer is held down. Not
 * -webkit-app-region: drag, because that swallows double-clicks on Windows.
 */
function attachDrag(button: HTMLElement): void {
  let pressed: { x: number; y: number; moving: boolean } | null = null;
  button.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    pressed = { x: e.screenX, y: e.screenY, moving: false };
    button.setPointerCapture(e.pointerId);
  });
  button.addEventListener('pointermove', (e) => {
    if (!pressed) return;
    if (!pressed.moving) {
      // A few pixels of slack so a double-click with a shaky hand does not start a drag.
      if (Math.abs(e.screenX - pressed.x) + Math.abs(e.screenY - pressed.y) < 4) return;
      pressed.moving = true;
      button.classList.add('dragging');
      api.dragStart();
    }
    api.dragMove();
  });
  const end = (e: PointerEvent) => {
    if (!pressed) return;
    if (pressed.moving) api.dragEnd();
    pressed = null;
    button.classList.remove('dragging');
    if (button.hasPointerCapture(e.pointerId)) button.releasePointerCapture(e.pointerId);
  };
  button.addEventListener('pointerup', end);
  button.addEventListener('pointercancel', end);
}

function expand(): void {
  void api.setMode('expanded');
}

// ---- Expanded: the panel ---------------------------------------------------------------------

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
      {
        class: 'icon-button',
        type: 'button',
        'data-focus-key': 'collapse',
        'aria-label': 'Collapse to the button',
        title: 'Collapse',
        onclick: () => void api.setMode('collapsed'),
      },
      icon('minus'),
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
  if (v.cvStatus) box.append(h('p', { class: `message ${v.cvStatus.level}` }, v.cvStatus.text));
  for (const m of v.messages) box.append(h('p', { class: `message ${m.level}` }, m.text));
  return box;
}

/**
 * Compact Domain mix card (about 80px): title and "Updated <time>" on one row, a thin bar and a
 * one-line legend with short names. A click expands it to the full names and the CV file name.
 */
function renderDomainMix(v: ViewModel): HTMLElement {
  const weights = v.profile?.weights ?? [];
  const detailsId = 'mix-details';
  const updated = h(
    'span',
    { class: 'mix-updated' },
    'Updated ',
    h('strong', { 'data-last-updated': v.lastUpdated ?? '' }, v.lastUpdated ? lastUpdatedLabel(v.lastUpdated, Date.now()) : 'never'),
  );

  const toggle = h(
    'button',
    {
      class: 'mix-toggle',
      type: 'button',
      'aria-expanded': mixOpen ? 'true' : 'false',
      'aria-controls': detailsId,
      'data-focus-key': 'mix',
      onclick: () => {
        mixOpen = !mixOpen;
        render();
      },
    },
    h('span', { class: 'mix-head' }, h('span', { class: 'mix-title', id: 'mix-title' }, 'Domain mix'), updated),
  );

  if (weights.length === 0) {
    toggle.append(h('span', { class: 'mix-note' }, 'No domain mix yet. Put one CV in the folder and press Refresh.'));
  } else {
    const bar = h('span', { class: 'mix-bar', role: 'img', 'aria-label': weights.map((w) => `${DOMAIN_LABELS[w.domain]} ${w.weight}%`).join(', ') });
    const line = h('span', { class: 'mix-line', 'aria-hidden': 'true' });
    weights.forEach((w, i) => {
      const seg = h('span', { class: `mix-${i + 1}` });
      seg.style.width = `${w.weight}%`;
      bar.append(seg);
      // Same order as the bar segments; the expanded details repeat it with colour swatches.
      line.append(h('span', {}, DOMAIN_SHORT_LABELS[w.domain], h('span', { class: 'weight' }, `${w.weight}%`)));
    });
    toggle.append(bar, line);
  }

  const card = h('section', { class: 'card mix-card', 'aria-labelledby': 'mix-title' }, toggle);
  if (mixOpen) {
    const details = h('div', { class: 'mix-details', id: detailsId });
    if (weights.length > 0 && v.profile) {
      const legend = h('ul', { class: 'legend' });
      weights.forEach((w, i) => {
        legend.append(h('li', {}, h('span', { class: `swatch mix-${i + 1}` }), h('span', {}, DOMAIN_LABELS[w.domain]), h('span', { class: 'weight' }, `${w.weight}%`)));
      });
      details.append(legend, h('p', { class: 'muted small' }, `Based on your CV · ${v.profile.fileName}`));
    } else {
      details.append(h('p', { class: 'path' }, v.cvFolder));
    }
    card.append(details);
  }
  return card;
}

function renderEmployers(v: ViewModel): HTMLElement {
  const section = h('section', { class: 'section', 'aria-labelledby': 'employers-title' }, h('h2', { class: 'section-title', id: 'employers-title' }, 'Employers for you'));
  if (v.employers.length === 0) {
    section.append(h('p', { class: 'note' }, 'Employers appear once your CV gives a domain mix.'));
    return section;
  }
  // Domains without employers in employers.json are left out (no placeholder note).
  const listed = v.employers.filter((d) => d.segments.length > 0);
  if (listed.length === 0) return h('div', { hidden: true });
  for (const domain of listed) {
    section.append(h('h3', { class: 'domain-title' }, h('span', {}, domain.label), h('span', {}, `${domain.weight}%`)));
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
    renderSourceHealth(v),
  );

  const cards = v.news.filter((n) => tagMatchesFilter(n.tag, filter));
  if (cards.length === 0) {
    section.append(h('p', { class: 'note' }, v.news.length === 0 ? 'No news yet. Press Refresh to load.' : 'Nothing in this category right now.'));
    return section;
  }
  section.append(h('ul', { class: 'news-list' }, ...cards.map((n) => h('li', {}, renderNewsCard(n)))));
  return section;
}

const STATUS_LABELS: Record<ProviderHealthView['status'], string> = {
  ok: 'working',
  empty: 'working, no items this time',
  failed: 'failed',
  unchecked: 'not checked yet',
};

function renderSourceHealth(v: ViewModel): HTMLElement {
  const { working, total, providers } = v.sourceHealth;
  const attention = providers.some((p) => p.needsAttention);
  const failing = providers.some((p) => p.status === 'failed');
  const summary = total === 0 ? 'Sources: not checked yet' : `Sources: ${working} of ${total} working`;
  const listId = 'source-health-list';
  const box = h(
    'div',
    { class: `health${attention ? ' attention' : failing ? ' failing' : ''}` },
    h(
      'button',
      {
        class: 'health-toggle',
        type: 'button',
        'aria-expanded': healthOpen ? 'true' : 'false',
        'aria-controls': listId,
        'data-focus-key': 'health',
        onclick: () => {
          healthOpen = !healthOpen;
          render();
        },
      },
      icon('chevron'),
      h('span', {}, summary),
      attention ? h('span', { class: 'attention-label' }, 'needs attention') : null,
    ),
  );
  if (healthOpen) {
    box.append(
      h(
        'ul',
        { class: 'health-list', id: listId },
        ...providers.map((p) =>
          h(
            'li',
            { class: `health-item status-${p.status}` },
            h(
              'div',
              { class: 'health-row' },
              h('span', { class: 'health-name' }, p.name),
              h('span', { class: 'health-status' }, p.needsAttention ? 'needs attention' : STATUS_LABELS[p.status]),
            ),
            h(
              'p',
              { class: 'health-detail' },
              [
                `Layer ${p.layer}`,
                p.checkedAt ? `checked ${lastUpdatedLabel(p.checkedAt, Date.now())}` : null,
                p.status === 'ok' ? `${p.itemCount} ${p.itemCount === 1 ? 'item' : 'items'}` : null,
                p.status === 'failed' && p.detail ? p.detail : null,
              ]
                .filter(Boolean)
                .join(' · '),
            ),
          ),
        ),
      ),
    );
  }
  return box;
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
    'article',
    { class: `news-card tag-${n.tag}${seen ? ' seen' : ''}${n.useful ? ' useful' : ''}` },
    h(
      'a',
      {
        class: 'news-link',
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
    ),
    h(
      'div',
      { class: 'news-actions' },
      h(
        'button',
        {
          class: 'feedback-button',
          type: 'button',
          'aria-pressed': n.useful ? 'true' : 'false',
          'aria-label': n.useful ? `Useful (kept in your feed): ${n.headline}. Press to undo.` : `Mark as useful and keep: ${n.headline}`,
          title: n.useful ? 'Useful, kept in your feed (press to undo)' : 'Useful: keep this in my feed',
          'data-focus-key': `useful:${n.id}`,
          onclick: () => toggleUseful(n.id),
        },
        icon('thumbUp'),
      ),
      h(
        'button',
        {
          class: 'feedback-button',
          type: 'button',
          'aria-label': `Not useful, remove from your feed: ${n.headline}`,
          title: 'Not useful: remove from my feed',
          'data-focus-key': `remove:${n.id}`,
          onclick: () => removeNews(n.id),
        },
        icon('thumbDown'),
      ),
    ),
  );
}

function renderUndoBar(): HTMLElement | string {
  if (!undo) return '';
  const id = undo.id;
  return h(
    'div',
    { class: 'undo-bar', role: 'status' },
    h('span', {}, 'Removed from your feed'),
    h('span', { 'aria-hidden': 'true' }, '·'),
    h(
      'button',
      {
        class: 'undo-button',
        type: 'button',
        'data-focus-key': 'undo',
        onclick: () => {
          clearUndo();
          void api.undoRemove(id).then(setView);
        },
      },
      'Undo',
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
  const news = orderNews(view.news.map((n) => (n.id === id && n.seenAt === null ? { ...n, seenAt: now } : n)));
  view = { ...view, news, unseenCount: news.filter((n) => n.seenAt === null).length };
  render();
  void api.markSeen(id);
}

function removeNews(id: string): void {
  if (!view) return;
  // Keep keyboard focus in the list: move it to the next card's link (or the filters).
  const index = view.news.findIndex((n) => n.id === id);
  const news = view.news.filter((n) => n.id !== id);
  const next = news[Math.min(index, news.length - 1)];
  view = { ...view, news, unseenCount: news.filter((n) => n.seenAt === null).length };
  clearUndo();
  undo = { id, timer: window.setTimeout(() => {
    undo = null;
    render();
  }, UNDO_MS) };
  render();
  root.querySelector<HTMLElement>(next ? `[data-focus-key="${CSS.escape(`news:${next.id}`)}"]` : '[data-focus-key="undo"]')?.focus();
  void api.removeNews(id);
}

function clearUndo(): void {
  if (undo) window.clearTimeout(undo.timer);
  undo = null;
}

function toggleUseful(id: string): void {
  if (!view) return;
  view = { ...view, news: view.news.map((n) => (n.id === id ? { ...n, useful: !n.useful } : n)) };
  render();
  void api.toggleUseful(id).then(setView);
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
