// ExpertApi over the local HTTP service (`expert-cli serve`), for the Expert page in a web
// dashboard. Window actions (collapse, hide, drag, folder dialogs) do nothing here: a page has no
// widget window. The token is sent on every request; the service checks it and the page's origin.

import type { DomainWeight, ExpertApi, Theme, ViewModel, WindowMode } from '../../core/src/shared/types.js';

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class HttpExpertApi implements ExpertApi {
  private readonly base: string;

  constructor(
    base: string,
    private readonly token: string,
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
    /** How often the page asks for news again on its own, in ms (0: never). */
    private readonly pollMs = 60_000,
  ) {
    this.base = base.replace(/\/+$/, '');
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!res.ok) throw new Error(`Expert service answered HTTP ${res.status}`);
    return (res.status === 204 ? undefined : await res.json()) as T;
  }

  private feedback(action: string, target: string): Promise<void> {
    return this.call('POST', '/v1/feedback', { schemaVersion: 1, action, target });
  }

  getView(): Promise<ViewModel> {
    return this.call('GET', '/v1/view');
  }

  async refresh(): Promise<ViewModel> {
    await this.call('POST', '/v1/refresh');
    return this.getView();
  }

  markVisited(companyKey: string): Promise<void> {
    return this.feedback('visited', companyKey);
  }

  markSeen(newsId: string): Promise<void> {
    return this.feedback('seen', newsId);
  }

  async openExternal(url: string): Promise<void> {
    if (/^https?:\/\//i.test(url)) window.open(url, '_blank', 'noopener,noreferrer');
  }

  removeNews(newsId: string): Promise<void> {
    return this.feedback('not-useful', newsId);
  }

  async undoRemove(newsId: string): Promise<ViewModel> {
    await this.feedback('undo-not-useful', newsId);
    return this.getView();
  }

  async toggleUseful(newsId: string): Promise<ViewModel> {
    await this.feedback('useful', newsId);
    return this.getView();
  }

  async setTheme(theme: Theme): Promise<void> {
    await this.call('POST', '/v1/settings', { theme });
  }

  setManualDomains(weights: DomainWeight[]): Promise<ViewModel> {
    return this.call('PUT', '/v1/profile/manual', { weights });
  }

  clearManualDomains(): Promise<ViewModel> {
    return this.call('DELETE', '/v1/profile/manual');
  }

  async openCvFolder(): Promise<void> {
    /* the page cannot open folders; the CV is set where the service runs */
  }

  chooseCvFolder(): Promise<ViewModel> {
    return this.getView();
  }

  setWatchlistSearch(on: boolean): Promise<ViewModel> {
    return this.call('POST', '/v1/settings', { watchlistSearch: on });
  }

  async setMode(_mode: WindowMode): Promise<void> {
    /* no window */
  }

  async hideWindow(): Promise<void> {
    /* no window */
  }

  dragStart(): void {}
  dragMove(): void {}
  dragEnd(): void {}

  onView(callback: (view: ViewModel) => void): () => void {
    if (this.pollMs <= 0) return () => undefined;
    const timer = setInterval(() => {
      this.getView().then(callback, () => undefined);
    }, this.pollMs);
    return () => clearInterval(timer);
  }
}
