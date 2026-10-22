// The Expert user interface. It draws the view model and talks to the outside only through an
// ExpertApi: the desktop widget passes the preload bridge (window.expert, see widget.ts), the
// Expert page passes HttpExpertApi (see expertPage.ts). No Node APIs, no direct network access.

import { eventDateLabel, lastUpdatedLabel, shortDateLabel } from '../../core/src/shared/format.js';
import { orderCompanies, orderNews, watchlistKey } from '../../core/src/shared/ordering.js';
import {
  TAG_LABELS,
  tagMatchesFilter,
  type CompanyChip,
  type DomainEvidenceView,
  type ExpertApi,
  type NewsCard,
  type NewsFilter,
  type ProviderHealthView,
  type Theme,
  type ViewModel,
  type WatchlistChip,
} from '../../core/src/shared/types.js';

export interface MountOptions {
  /** widget: the desktop window (round button or docked panel). page: inside a web page, fluid. */
  display: 'widget' | 'page';
  /** Element that gets data-theme, data-mode and data-display (the document root, or the custom element). */
  host: HTMLElement;
}

/** Draws Expert into `root` and keeps it up to date. Returns a function that unmounts it. */
export function mountExpert(root: HTMLElement, api: ExpertApi, options: MountOptions): () => void {
  const page = options.display === 'page';


  let view: ViewModel | null = null;
  let filter: NewsFilter = readStored('newsFilter', ['all', 'hiring', 'funded_startup', 'career_fair'], 'all');
  /** Watchlist key whose news the feed is narrowed to (the chip's news indicator), or null. */
  let companyFilter: string | null = null;
  const collapsed = new Set<string>();
  let healthOpen = false;
  /** The Domain mix card starts compact on every start. */
  let mixOpen = false;
  /** The domain editor is open inside the expanded Domain mix card. */
  let editingMix = false;
  /** Show the English translations (on) or the original texts (off). Remembered per PC. */
  let english = readStored('newsLanguage', ['en', 'de'], 'en') === 'en';
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
    close: 'M6 6l12 12M18 6 6 18',
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

  /** A domain's name from the registry list in the view (the id when the domain is unknown). */
  function domainLabel(v: ViewModel, id: string, short = false): string {
    const d = v.data.domains.find((x) => x.id === id);
    return d ? (short ? d.shortLabel : d.label) : id;
  }

  // ---- Rendering -----------------------------------------------------------------------------

  function render(): void {
    if (!view) return;
    options.host.dataset.theme = view.ui.theme;
    // The Expert page is always the full panel; only the widget collapses to the round button.
    options.host.dataset.mode = page ? 'expanded' : view.ui.mode;
    options.host.dataset.display = options.display;

    // Keep scroll position and keyboard focus across re-renders.
    const oldScroll = root.querySelector('.scroll')?.scrollTop ?? 0;
    const focusKey = ((root.getRootNode() as Document | ShadowRoot).activeElement as HTMLElement | null)?.dataset?.focusKey;

    if (view.ui.mode === 'collapsed' && !page) {
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
    const count = v.ui.unseenCount;
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
    const nextTheme: Theme = v.ui.theme === 'day' ? 'dark' : 'day';
    return h(
      'header',
      { class: 'header' },
      h('div', { class: 'brand' }, h('h1', { class: 'brand-title' }, 'Expert'), v.ui.mock ? h('span', { class: 'mock-badge', title: 'Mock data (npm run dev:mock)' }, 'Mock') : null),
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
            view = { ...view, ui: { ...view.ui, theme: nextTheme } };
            render();
            void api.setTheme(nextTheme);
          },
        },
        icon(v.ui.theme === 'day' ? 'moon' : 'sun'),
      ),
      h(
        'button',
        {
          class: 'refresh-button',
          type: 'button',
          'data-focus-key': 'refresh',
          'aria-busy': v.ui.refreshing ? 'true' : 'false',
          onclick: () => {
            if (view?.ui.refreshing) return;
            void api.refresh().then(setView);
          },
        },
        icon('refresh'),
        v.ui.refreshing ? 'Refreshing…' : 'Refresh',
      ),
      // The Expert page has no window to collapse or hide.
      page
        ? null
        : h(
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
      page
        ? null
        : h(
            'button',
            {
              class: 'icon-button',
              type: 'button',
              'data-focus-key': 'hide',
              'aria-label': v.ui.platform === 'linux' ? 'Collapse to the button (right-click it for the menu)' : `Hide to the ${trayName(v)} (the widget keeps running)`,
              title: v.ui.platform === 'linux' ? 'Collapse to the button. Right-click the widget for the menu with Quit.' : `Hide to the ${trayName(v)}. Bring it back with the ${trayName(v)} icon or the hotkey.`,
              onclick: () => void api.hideWindow(),
            },
            icon('close'),
          ),
    );
  }

  function renderBody(v: ViewModel): HTMLElement {
    const scroll = h('main', { class: 'scroll' });

    if (v.ui.configError) {
      scroll.append(
        h(
          'section',
          { class: 'card error-screen', role: 'alert' },
          h('h2', {}, 'Configuration problem'),
          h('pre', {}, v.ui.configError),
          h('p', { class: 'muted small' }, 'Fix the file, save it and press Refresh.'),
        ),
      );
      return scroll;
    }

    // Until a CV has been read, the welcome screen explains where it goes; the problem is shown there.
    const welcome = !v.data.profile;
    scroll.append(renderStatus(v, welcome));
    if (welcome) scroll.append(renderWelcome(v));
    if (!v.ui.hasData) return scroll;

    scroll.append(renderDomainMix(v), renderEmployers(v), renderWatchlist(v), renderNews(v));
    return scroll;
  }

  /** "tray" on Windows and Linux, "menu bar" on a Mac. */
  function trayName(v: ViewModel): string {
    return v.ui.platform === 'darwin' ? 'menu bar' : 'tray';
  }

  /**
   * First run, and whenever no CV could be read: where the CV goes, in plain words, with buttons to
   * open or change the folder. Neutral for every field of work.
   */
  function renderWelcome(v: ViewModel): HTMLElement {
    const problem = v.ui.cvStatus;
    return h(
      'section',
      { class: 'card welcome', 'aria-labelledby': 'welcome-title' },
      h('h2', { id: 'welcome-title' }, problem ? 'Your CV could not be read yet' : 'Welcome to Expert'),
      h('p', {}, 'Expert reads your CV on this computer, works out your fields of work, and shows employers and news for them in Germany.'),
      problem ? h('p', { class: `message ${problem.level}`, role: 'alert' }, problem.text) : null,
      h('h3', { class: 'welcome-step' }, '1. Put your CV in this folder'),
      h('p', { class: 'path', 'data-focus-key': 'cv-path' }, v.ui.cvFolder),
      v.ui.canManageFolder
        ? h(
            'div',
            { class: 'mix-actions' },
            h('button', { class: 'link-button', type: 'button', 'data-focus-key': 'open-folder', onclick: () => void api.openCvFolder() }, 'Open CV folder'),
            h('button', { class: 'link-button', type: 'button', 'data-focus-key': 'choose-folder', onclick: () => void api.chooseCvFolder().then(setView) }, 'Choose another folder'),
          )
        : null,
      h('p', { class: 'muted small' }, 'One file only: PDF, Word (.docx) or text (.txt), in German or English. A scanned PDF without text cannot be read.'),
      h('h3', { class: 'welcome-step' }, '2. Press Refresh'),
      h(
        'div',
        { class: 'mix-actions' },
        h(
          'button',
          {
            class: 'refresh-button',
            type: 'button',
            'data-focus-key': 'welcome-refresh',
            'aria-busy': v.ui.refreshing ? 'true' : 'false',
            onclick: () => {
              if (!view?.ui.refreshing) void api.refresh().then(setView);
            },
          },
          icon('refresh'),
          v.ui.refreshing ? 'Refreshing…' : 'Refresh',
        ),
      ),
      h(
        'p',
        { class: 'privacy-note' },
        h('strong', {}, 'Your CV stays on your computer. '),
        'Its text is never sent anywhere. The news searches use the same general search words for everyone; only the names of companies you put on your watchlist are sent as search words (you can switch that off in the Watchlist section).',
      ),
    );
  }

  function renderStatus(v: ViewModel, welcome = false): HTMLElement {
    const box = h('div', { class: 'status', role: 'status', 'aria-live': 'polite' });
    if (v.ui.cvStatus && !welcome) box.append(h('p', { class: `message ${v.ui.cvStatus.level}` }, v.ui.cvStatus.text));
    for (const m of v.ui.messages) box.append(h('p', { class: `message ${m.level}` }, m.text));
    return box;
  }

  /**
   * Compact Domain mix card (about 80px): title and "Updated <time>" on one row, a thin bar and a
   * one-line legend with short names. A click expands it to the full names and the CV file name.
   */
  function renderDomainMix(v: ViewModel): HTMLElement {
    const weights = v.data.profile?.weights ?? [];
    const detailsId = 'mix-details';
    const updated = h(
      'span',
      { class: 'mix-updated' },
      'Updated ',
      h('strong', { 'data-last-updated': v.data.lastUpdated ?? '' }, v.data.lastUpdated ? lastUpdatedLabel(v.data.lastUpdated, Date.now()) : 'never'),
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
      const bar = h('span', { class: 'mix-bar', role: 'img', 'aria-label': weights.map((w) => `${domainLabel(v, w.domain)} ${w.weight}%`).join(', ') });
      const line = h('span', { class: 'mix-line', 'aria-hidden': 'true' });
      weights.forEach((w, i) => {
        const seg = h('span', { class: `mix-${i + 1}` });
        seg.style.width = `${w.weight}%`;
        bar.append(seg);
        // Each name in the colour of its bar segment; the percentages are in the expanded details.
        line.append(h('span', { class: `mix-text-${i + 1}` }, domainLabel(v, w.domain, true)));
      });
      toggle.append(bar, line);
    }

    const profile = v.data.profile;
    const card = h('section', { class: 'card mix-card', 'aria-labelledby': 'mix-title' }, toggle);
    // A fallback or a hand-made mix says so even while the card is compact.
    if (profile?.source === 'fallback' && profile.notice && !mixOpen) card.append(h('p', { class: 'mix-notice' }, profile.notice));
    if (mixOpen) {
      const details = h('div', { class: 'mix-details', id: detailsId });
      if (editingMix) {
        details.append(renderMixEditor(v));
      } else if (weights.length > 0 && profile) {
        if (profile.source === 'fallback' && profile.notice) details.append(h('p', { class: 'mix-notice' }, profile.notice));
        const legend = h('ul', { class: 'legend' });
        weights.forEach((w, i) => {
          const reasons = (profile.evidence ?? []).filter((e) => e.domain === w.domain);
          legend.append(
            h(
              'li',
              {},
              h('span', { class: 'legend-row' }, h('span', { class: `swatch mix-${i + 1}` }), h('span', {}, domainLabel(v, w.domain)), h('span', { class: 'weight' }, `${w.weight}%`)),
              reasons.length > 0 ? h('ul', { class: 'evidence' }, ...reasons.map((e) => h('li', {}, evidenceLabel(e)))) : null,
            ),
          );
        });
        const source =
          profile.source === 'manual'
            ? 'Set manually'
            : profile.fileName
              ? `Based on your CV · ${profile.fileName} · read ${lastUpdatedLabel(profile.computedAt, Date.now())}`
              : 'Based on your CV';
        details.append(legend, h('p', { class: 'muted small' }, source));
        details.append(
          h(
            'div',
            { class: 'mix-actions' },
            h('button', { class: 'link-button', type: 'button', 'data-focus-key': 'mix-edit', onclick: () => openMixEditor(v) }, profile.source === 'fallback' ? 'Choose domains' : 'Adjust domains'),
            profile.source === 'manual'
              ? h(
                  'button',
                  {
                    class: 'link-button',
                    type: 'button',
                    'data-focus-key': 'mix-auto',
                    onclick: () => void api.clearManualDomains().then(setView),
                  },
                  'Back to automatic result',
                )
              : null,
          ),
        );
      } else {
        details.append(h('p', { class: 'path' }, v.ui.cvFolder));
        details.append(h('div', { class: 'mix-actions' }, h('button', { class: 'link-button', type: 'button', 'data-focus-key': 'mix-edit', onclick: () => openMixEditor(v) }, 'Choose domains')));
      }
      card.append(details);
    }
    return card;
  }

  const EVIDENCE_KINDS: Record<DomainEvidenceView['kind'], string> = {
    title: 'job title',
    education: 'education',
    certification: 'certificate',
    skill: 'skill',
    keyword: 'keyword',
  };

  /** "Pflegefachkraft · current role · 2020 to now". */
  function evidenceLabel(e: DomainEvidenceView): string {
    return [e.label, e.current ? 'current role' : EVIDENCE_KINDS[e.kind], e.period].filter(Boolean).join(' · ');
  }

  // ---- Choosing domains by hand ----------------------------------------------------------------

  /** The editor's draft: domain id → share (any positive number; normalised to 100 % when saved). */
  let mixDraft = new Map<string, number>();
  const MAX_DOMAINS = 4;

  function openMixEditor(v: ViewModel): void {
    mixDraft = new Map((v.data.profile?.source === 'fallback' ? [] : (v.data.profile?.weights ?? [])).map((w) => [w.domain, w.weight]));
    editingMix = true;
    mixOpen = true;
    render();
  }

  function renderMixEditor(v: ViewModel): HTMLElement {
    const full = mixDraft.size >= MAX_DOMAINS;
    const total = [...mixDraft.values()].reduce((a, b) => a + b, 0);
    const list = h('ul', { class: 'mix-editor-list' });
    for (const d of v.data.domains.filter((x) => x.id !== 'general')) {
      const checked = mixDraft.has(d.id);
      const id = `mix-pick-${d.id}`;
      const share = h('input', {
        class: 'mix-share',
        type: 'number',
        min: 1,
        max: 100,
        step: 1,
        value: checked ? String(mixDraft.get(d.id)) : '',
        disabled: !checked,
        'aria-label': `Share for ${d.label} in percent`,
        'data-focus-key': `mix-share:${d.id}`,
        onchange: (e: Event) => {
          const n = Number((e.target as HTMLInputElement).value);
          if (Number.isFinite(n) && n > 0) mixDraft.set(d.id, Math.min(100, Math.round(n)));
          render();
        },
      });
      list.append(
        h(
          'li',
          {},
          h('input', {
            type: 'checkbox',
            id,
            checked,
            disabled: !checked && full,
            'data-focus-key': `mix-pick:${d.id}`,
            onchange: () => {
              if (mixDraft.has(d.id)) mixDraft.delete(d.id);
              else if (mixDraft.size < MAX_DOMAINS) mixDraft.set(d.id, Math.max(1, Math.round((100 - Math.min(100, total)) / 2) || 25));
              render();
            },
          }),
          h('label', { for: id }, d.label),
          share,
        ),
      );
    }
    return h(
      'div',
      { class: 'mix-editor' },
      h('p', { class: 'small' }, `Choose up to ${MAX_DOMAINS} domains and their shares. They are turned into percentages that add up to 100 and replace the result from your CV until you go back to it. Stored on this computer only.`),
      list,
      h(
        'div',
        { class: 'mix-actions' },
        h(
          'button',
          {
            class: 'refresh-button',
            type: 'button',
            disabled: mixDraft.size === 0,
            'data-focus-key': 'mix-save',
            onclick: () => {
              editingMix = false;
              void api.setManualDomains([...mixDraft].map(([domain, weight]) => ({ domain, weight }))).then(setView);
            },
          },
          'Save',
        ),
        h(
          'button',
          {
            class: 'link-button',
            type: 'button',
            'data-focus-key': 'mix-cancel',
            onclick: () => {
              editingMix = false;
              render();
            },
          },
          'Cancel',
        ),
      ),
    );
  }

  function renderEmployers(v: ViewModel): HTMLElement {
    const section = h('section', { class: 'section', 'aria-labelledby': 'employers-title' }, h('h2', { class: 'section-title', id: 'employers-title' }, 'Employers for you'));
    if (v.data.employers.length === 0) {
      section.append(h('p', { class: 'note' }, 'Employers appear once your CV gives a domain mix.'));
      return section;
    }
    if (v.data.employers.some((d) => d.starterList)) section.append(h('p', { class: 'muted small starter-note' }, 'Starter list for Germany, may be incomplete.'));
    for (const domain of v.data.employers) {
      section.append(h('h3', { class: 'domain-title' }, h('span', {}, domain.label), h('span', {}, `${domain.weight}%`)));
      if (domain.segments.length === 0) {
        // No verified starter list for this domain yet: say so and point to how lists are made.
        section.append(
          h(
            'p',
            { class: 'note' },
            'No company list for this field yet. ',
            h(
              'a',
              {
                href: CONTRIBUTING_URL,
                'data-focus-key': `contribute:${domain.domain}`,
                onclick: (e: Event) => {
                  e.preventDefault();
                  void api.openExternal(CONTRIBUTING_URL);
                },
              },
              'How company lists are made and how to add one',
            ),
          ),
        );
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
            open ? renderSegmentChips(id, bodyId, seg.companies) : null,
          ),
        );
      }
    }
    return section;
  }

  /** Where the company-directory guide lives (placeholder until the repository's public home is decided). */
  const CONTRIBUTING_URL = 'https://github.com/chai3006/Expert_Widget/blob/feature/expert-page/docs/COMPANY_DIRECTORY.md';
  const SEGMENT_PREVIEW = 8;
  /** Segments whose full list the user opened with "Show more". */
  const expandedSegments = new Set<string>();

  function renderSegmentChips(id: string, bodyId: string, companies: CompanyChip[]): HTMLElement {
    const all = expandedSegments.has(id) || companies.length <= SEGMENT_PREVIEW + 2;
    const shown = all ? companies : companies.slice(0, SEGMENT_PREVIEW);
    const box = h('div', { class: 'chips', id: bodyId }, ...shown.map((c) => renderChip(c)));
    if (!all) {
      box.append(
        h(
          'button',
          {
            class: 'link-button',
            type: 'button',
            'data-focus-key': `more:${id}`,
            onclick: () => {
              expandedSegments.add(id);
              render();
            },
          },
          `Show ${companies.length - SEGMENT_PREVIEW} more`,
        ),
      );
    }
    return box;
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

  /** Companies from watchlist.json, whatever the domain mix. */
  function renderWatchlist(v: ViewModel): HTMLElement {
    const section = h('section', { class: 'section', 'aria-labelledby': 'watchlist-title' }, h('h2', { class: 'section-title', id: 'watchlist-title' }, 'Watchlist'));
    if (v.data.watchlist.length === 0) {
      section.append(h('p', { class: 'note' }, 'Add companies to watchlist.json to keep an eye on them.'));
      return section;
    }
    section.append(h('div', { class: 'card watch-card' }, h('div', { class: 'chips' }, ...v.data.watchlist.map((c) => renderWatchChip(c)))));
    // The watchlist names are the only words of the user's own that leave this computer.
    const on = v.ui.watchlistSearch;
    section.append(
      h(
        'div',
        { class: 'watch-search' },
        h(
          'button',
          {
            class: 'link-button',
            type: 'button',
            role: 'switch',
            'aria-checked': on ? 'true' : 'false',
            'data-focus-key': 'watch-search',
            onclick: () => void api.setWatchlistSearch(!on).then(setView),
          },
          on ? 'Searching the news for these names: on' : 'Searching the news for these names: off',
        ),
        h(
          'p',
          { class: 'muted small' },
          on
            ? 'These company names are sent to the news search (GDELT) as search words. Turn this off to keep them on this computer; news from the feeds still shows them.'
            : 'The names stay on this computer. News from the feeds still shows them.',
        ),
      ),
    );
    return section;
  }

  function renderWatchChip(c: WatchlistChip): HTMLElement {
    const visited = c.visitedAt !== null;
    let chip: HTMLElement;
    if (c.website) {
      const url = c.website;
      const open = (e: Event) => {
        e.preventDefault();
        void api.openExternal(url);
        markVisited(c.key);
      };
      chip = h(
        'a',
        {
          class: visited ? 'chip visited' : 'chip',
          href: url,
          'data-focus-key': `watch:${c.key}`,
          title: [`${c.name}: ${url}`, c.note].filter(Boolean).join('\n'),
          onclick: open,
          onauxclick: (e: Event) => {
            if ((e as MouseEvent).button === 1) open(e);
          },
        },
        c.name,
        visited ? h('span', { class: 'visited-label' }, 'visited') : null,
      );
    } else {
      // Not a link until the website is filled in; never guessed.
      chip = h('span', { class: 'chip no-link', title: `${c.name}: website to be added in watchlist.json` }, c.name, h('span', { class: 'visited-label' }, 'no link'));
    }
    const active = companyFilter === c.key;
    const label = c.newsCount === 1 ? '1 new news item' : `${c.newsCount} new news items`;
    const indicator = h(
      'button',
      {
        class: `watch-news${c.newsCount > 0 ? ' has-new' : ''}`,
        type: 'button',
        'aria-pressed': active ? 'true' : 'false',
        'aria-label': `${label} about ${c.name}. ${active ? 'Press to show all news.' : 'Press to show the news about this company.'}`,
        title: active ? 'Showing the news about this company (press to show all)' : `${label} about ${c.name}`,
        'data-focus-key': `watch-news:${c.key}`,
        onclick: () => {
          companyFilter = active ? null : c.key;
          if (companyFilter) filter = 'all';
          render();
          if (companyFilter) root.querySelector('#news-title')?.scrollIntoView({ block: 'start' });
        },
      },
      h('span', { class: 'watch-news-pill' }, `${c.newsCount} news`),
    );
    return h('span', { class: 'watch-item' }, chip, indicator);
  }

  const FILTERS: Array<{ id: NewsFilter; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'hiring', label: 'Hiring' },
    { id: 'funded_startup', label: 'Startups' },
    { id: 'career_fair', label: 'Fairs' },
  ];

  function renderNews(v: ViewModel): HTMLElement {
    const section = h(
      'section',
      { class: 'section', 'aria-labelledby': 'news-title' },
      h(
        'div',
        { class: 'section-head' },
        h('h2', { class: 'section-title', id: 'news-title' }, 'News feed'),
        h(
          'button',
          {
            class: 'lang-toggle',
            type: 'button',
            'aria-pressed': english ? 'true' : 'false',
            'aria-label': 'Show English translations',
            title: english ? 'English translations shown (press for the original German)' : 'Original texts shown (press for English translations)',
            'data-focus-key': 'lang',
            onclick: () => {
              english = !english;
              store('newsLanguage', english ? 'en' : 'de');
              render();
            },
          },
          h('span', { class: 'lang-pill' }, 'EN'),
        ),
      ),
    );
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

    const company = companyFilter ? v.data.watchlist.find((c) => c.key === companyFilter) : undefined;
    if (company) {
      section.append(
        h(
          'div',
          { class: 'company-filter', role: 'status' },
          h('span', {}, 'News about ', h('strong', {}, company.name)),
          h(
            'button',
            {
              class: 'undo-button',
              type: 'button',
              'data-focus-key': 'company-filter-clear',
              onclick: () => {
                companyFilter = null;
                render();
              },
            },
            'Show all news',
          ),
        ),
      );
    }
    const cards = v.data.news.filter((n) => tagMatchesFilter(n.tag, filter) && (!company || n.watchlist.some((w) => watchlistKey(w) === company.key)));
    if (cards.length === 0) {
      const empty = company ? `No news about ${company.name} right now.` : v.data.news.length === 0 ? 'No news yet. Press Refresh to load.' : 'Nothing in this category right now.';
      section.append(h('p', { class: 'note' }, empty));
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
    const { working, total, providers } = v.data.sourceHealth;
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
        h(
          'div',
          { class: 'band' },
          h('span', {}, TAG_LABELS[n.tag], n.watchlist.length > 0 ? h('span', { class: 'watch-label', title: `Watchlist: ${n.watchlist.join(', ')}` }, 'Watchlist') : null),
          h('span', { class: 'state' }, seen ? 'Seen' : 'New'),
        ),
        h(
          'div',
          { class: 'news-body' },
          h('h3', { class: 'headline', ...textAttrs(n.headline, english ? n.translated?.headline : null) }, english ? (n.translated?.headline ?? n.headline) : n.headline),
          isFair ? h('p', { class: 'event-date' }, eventDateLabel(n.eventDate, n.eventEndDate)) : null,
          n.summary ? h('p', { class: 'summary', ...textAttrs(n.summary, english ? n.translated?.summary : null) }, english ? (n.translated?.summary ?? n.summary) : n.summary) : null,
          h(
            'div',
            { class: 'news-footer' },
            // Watchlist cards name the company instead of the domain.
            h('span', {}, `${n.sourceName} · ${n.watchlist.length > 0 ? n.watchlist.join(', ') : n.domainLabel}`),
            isFair ? null : h('span', {}, shortDateLabel(n.date, Date.now())),
          ),
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

  /** A translated text says so (lang="en") and keeps the original as a tooltip. */
  function textAttrs(original: string, translation: string | null | undefined): Attrs {
    return translation ? { lang: 'en', title: `Original: ${original}` } : {};
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
      data: {
      ...view.data,
      employers: view.data.employers.map((d) => ({
        ...d,
        segments: d.segments.map((s) => ({
          ...s,
          companies: orderCompanies(s.companies.map((c) => (c.key === key ? { ...c, visitedAt: now } : c))),
        })),
      })),
      watchlist: orderCompanies(view.data.watchlist.map((c) => (c.key === key ? { ...c, visitedAt: now } : c))),
      },
    };
    render();
    void api.markVisited(key);
  }

  function markSeen(id: string): void {
    if (!view) return;
    const now = Date.now();
    const news = orderNews(view.data.news.map((n) => (n.id === id && n.seenAt === null ? { ...n, seenAt: now } : n)));
    view = withNews(view, news);
    render();
    void api.markSeen(id);
  }

  function removeNews(id: string): void {
    if (!view) return;
    // Keep keyboard focus in the list: move it to the next card's link (or the filters).
    const index = view.data.news.findIndex((n) => n.id === id);
    const news = view.data.news.filter((n) => n.id !== id);
    const next = news[Math.min(index, news.length - 1)];
    view = withNews(view, news);
    clearUndo();
    undo = { id, timer: window.setTimeout(() => {
      undo = null;
      render();
    }, UNDO_MS) };
    render();
    root.querySelector<HTMLElement>(next ? `[data-focus-key="${CSS.escape(`news:${next.id}`)}"]` : '[data-focus-key="undo"]')?.focus();
    void api.removeNews(id);
  }

  /** The view with a changed news list, and the counts that depend on it brought up to date. */
  function withNews(v: ViewModel, news: NewsCard[]): ViewModel {
    const unseen = news.filter((n) => n.seenAt === null);
    const watchlist = v.data.watchlist.map((c) => ({ ...c, newsCount: unseen.filter((n) => n.watchlist.some((w) => watchlistKey(w) === c.key)).length }));
    return { ui: { ...v.ui, unseenCount: unseen.length }, data: { ...v.data, news, watchlist } };
  }

  function clearUndo(): void {
    if (undo) window.clearTimeout(undo.timer);
    undo = null;
  }

  function toggleUseful(id: string): void {
    if (!view) return;
    view = { ...view, data: { ...view.data, news: view.data.news.map((n) => (n.id === id ? { ...n, useful: !n.useful } : n)) } };
    render();
    void api.toggleUseful(id).then(setView);
  }

  function setView(next: ViewModel): void {
    view = next;
    render();
  }

  // Keep "today, 07:12" correct when the widget stays open past midnight.
  const clock = setInterval(() => {
    const el = root.querySelector<HTMLElement>('[data-last-updated]');
    const ts = Number(el?.dataset.lastUpdated);
    if (el && ts) el.textContent = lastUpdatedLabel(ts, Date.now());
  }, 60_000);

  const unsubscribe = api.onView(setView);
  void api.getView().then(setView);
  return () => {
    clearInterval(clock);
    unsubscribe();
    root.replaceChildren();
  };
}
