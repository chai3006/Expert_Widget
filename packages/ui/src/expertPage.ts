// <expert-page api="http://127.0.0.1:PORT" token="…"> : the Expert UI as a custom element with its
// own Shadow DOM, so any web dashboard can mount it without style clashes. It talks to the local
// Expert service (`expert-cli serve`), which reads the CV on the user's computer.
//
// Attributes: api (service base URL), token (the service's access token), stylesheet (optional
// URL of styles.css; default: next to this script). Fonts fall back to the system UI font, because
// @font-face rules do not apply inside a Shadow DOM.

import { mountExpert } from './app.js';
import { HttpExpertApi } from './httpApi.js';

export class ExpertPageElement extends HTMLElement {
  static observedAttributes = ['api', 'token'];
  private unmount: (() => void) | null = null;

  connectedCallback(): void {
    this.start();
  }

  disconnectedCallback(): void {
    this.unmount?.();
    this.unmount = null;
  }

  attributeChangedCallback(): void {
    if (this.isConnected) this.start();
  }

  private start(): void {
    this.unmount?.();
    this.unmount = null;
    const api = this.getAttribute('api');
    const token = this.getAttribute('token');
    const shadow = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = this.getAttribute('stylesheet') ?? new URL('styles.css', import.meta.url).href;
    const root = document.createElement('div');
    root.className = 'app';
    shadow.replaceChildren(link, root);
    if (!api || !token) {
      root.textContent = 'Expert: set the api and token attributes (see docs/EXPERT_PAGE_INTEGRATION.md).';
      return;
    }
    this.unmount = mountExpert(root, new HttpExpertApi(api, token), { display: 'page', host: this });
  }
}

if (!customElements.get('expert-page')) customElements.define('expert-page', ExpertPageElement);
